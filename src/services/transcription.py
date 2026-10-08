"""Local lyrics transcription from the Flask side: worker supervision, jobs and the ``transcription.json`` record.

The work happens in ``src/services/transcription_worker.py`` (turbo-lyrics), a long-lived process that shares the
supervision and job client of the separation worker (``WorkerManager``/``run_job`` in ``separation.py``) and its CPU
gate. ``transcribe_track_locally`` runs the vocals of one track through it and returns WhisperX-shaped lyrics; the
caller decides whether to keep them and records the producer with ``save_record``. Any problem reaching the worker
raises ``SeparationUnavailable`` (shared exception types) so the pipeline can fall back to Replicate WhisperX.

``TRANSCRIBE_REFERENCE_MODE``:

- ``shadow`` (default): when verified reference lyrics exist, they are also force-aligned and kept in
  ``lyrics_raw_reference.json`` with their gate result and agreement with the transcription; the transcription is
  used. This collects data to calibrate the gate on real songs.
- ``prefer``: the reference alignment is used when it passes the gate (no Whisper run, no LLM correction).
- ``off``: transcription only.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
from datetime import UTC, datetime

from src.services import separation
from src.services.separation import SeparationAborted, SeparationFailed, WorkerManager, run_job

RECORD_FILE = "transcription.json"
REFERENCE_FILE = "lyrics_raw_reference.json"
TEMP_PREFIX = ".transcription-"
REFERENCE_MODES = {"off": "asr", "shadow": "shadow", "prefer": "prefer_reference"}

DEFAULTS = {
    "TRANSCRIBE_BACKEND": "local",
    "TRANSCRIBE_SOCKET": "/tmp/melodai-transcription.sock",
    "TRANSCRIBE_ENGINE": "turbo",
    "TRANSCRIBE_MODEL": "large-v3-turbo",
    "TRANSCRIBE_COMPUTE_TYPE": "int8",
    "TRANSCRIBE_ALIGN_PRECISION": "auto",
    "TRANSCRIBE_THREADS": 8,
    "TRANSCRIBE_NICE": 10,
    "TRANSCRIBE_PREEMPT": True,
    "TRANSCRIBE_LANGUAGES": "en,de",
    "TRANSCRIBE_CACHE_DIR": None,
    "TRANSCRIBE_REFERENCE_MODE": "shadow",
    "TRANSCRIBE_WORKER_AUTOSTART": True,
    "TRANSCRIBE_START_TIMEOUT": 30.0,
    "TRANSCRIBE_FAILURE_BACKOFF": 600.0,
    "TRANSCRIBE_IDLE_TIMEOUT": 60.0,
    "TRANSCRIBE_HEARTBEAT": 5.0,
    "TRANSCRIBE_STALL_TIMEOUT": 300.0,
    "TRANSCRIBE_JOB_TIMEOUT": 900.0,
    "TRANSCRIBE_QUEUE_TIMEOUT": 900.0,
    "COMPUTE_LOCK": None,
}


def config_from_env(environ=None):
    config = separation.config_from_env(environ, defaults=DEFAULTS)
    config["TRANSCRIBE_BACKEND"] = str(config["TRANSCRIBE_BACKEND"]).strip().lower()
    config["TRANSCRIBE_REFERENCE_MODE"] = str(config["TRANSCRIBE_REFERENCE_MODE"]).strip().lower()
    return config


def settings(app=None):
    return separation.settings(app, defaults=DEFAULTS)


def transcribe_backend(app=None):
    backend = str(settings(app)["TRANSCRIBE_BACKEND"]).lower()
    return backend if backend in ("local", "replicate") else "local"


def installed_version():
    try:
        from importlib.metadata import PackageNotFoundError, version
        return version("turbo-lyrics")
    except (ImportError, PackageNotFoundError):
        return None
    except Exception:
        return None


class TranscriptionWorkerManager(WorkerManager):
    prefix = "TRANSCRIBE"
    label = "transcription"
    module = "src.services.transcription_worker"
    package = "turbo-lyrics"

    def command(self):
        c = self.cfg
        cmd = [sys.executable, "-m", self.module,
               "--socket", self.socket_path,
               "--engine", str(c["TRANSCRIBE_ENGINE"]),
               "--model", str(c["TRANSCRIBE_MODEL"]),
               "--compute-type", str(c["TRANSCRIBE_COMPUTE_TYPE"]),
               "--align-precision", str(c["TRANSCRIBE_ALIGN_PRECISION"]),
               "--threads", str(int(c["TRANSCRIBE_THREADS"])),
               "--languages", str(c["TRANSCRIBE_LANGUAGES"] or ""),
               "--nice", str(int(c["TRANSCRIBE_NICE"])),
               "--heartbeat", str(float(c["TRANSCRIBE_HEARTBEAT"])),
               "--parent-pid", str(os.getpid()),
               "--compute-lock", self.compute_lock()]
        if c.get("TRANSCRIBE_CACHE_DIR"):
            cmd += ["--cache-dir", str(c["TRANSCRIBE_CACHE_DIR"])]
        if not c["TRANSCRIBE_PREEMPT"]:
            cmd.append("--no-preempt")
        return cmd

    def engine_installed(self):
        if self.cfg["TRANSCRIBE_ENGINE"] != "turbo":
            return True
        return all(importlib.util.find_spec(name) is not None for name in ("turbo_lyrics", "faster_whisper"))


def get_manager(app=None):
    if app is None:
        from flask import current_app
        app = current_app._get_current_object()
    manager = app.extensions.get("transcription_worker")
    if manager is None:
        manager = app.extensions.setdefault("transcription_worker", TranscriptionWorkerManager(settings(app)))
    return manager


def status_for_event(message):
    """Map a worker event to ``(progress_percent, detail)`` for the lyrics stage (40..63), or None."""
    event = message.get("event")
    if event == "queued":
        return 40, f"Waiting in queue (position {int(message.get('position') or 1)})..."
    if event in ("accepted", "heartbeat") and message.get("state") == "loading":
        return 40, "Loading transcription model..."
    if event == "preempted":
        return 40, "Waiting in queue..."
    if event == "started":
        return 42, "Transcribing vocals..."
    if event == "progress":
        done, total = int(message.get("done") or 0), int(message.get("total") or 0)
        if total <= 0:
            return 42, "Transcribing vocals..."
        return 42 + int(21 * min(done, total) / total), "Transcribing vocals..."
    return None


def _now():
    return datetime.now(UTC).isoformat()


def _song_file(track_id, name):
    from src.utils.file_handling import get_song_dir
    return os.path.join(get_song_dir(track_id, create=False), name)


def _write_json(path, data):
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=1, ensure_ascii=False)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def load_record(track_id):
    try:
        with open(_song_file(track_id, RECORD_FILE), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save_record(track_id, record):
    _write_json(_song_file(track_id, RECORD_FILE), record)


def replicate_record(reason=None):
    record = {"backend": "replicate", "engine": "whisperx", "created_at": _now()}
    if reason:
        record["local_error"] = str(reason)[:300]
    return record


def _load_output(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or not isinstance(data.get("segments"), list):
        raise SeparationFailed("the transcription worker produced no segments")
    return data


def transcribe_track_locally(track_id, *, reference_lines=None, reference_times=None, language=None,
                             priority="interactive", on_event=None, should_abort=None, app=None):
    """Transcribe ``vocals.mp3`` of a track with the local worker.

    Returns ``(lyrics_raw, record)``: WhisperX-shaped lyrics (from the transcription, or from the reference
    alignment in ``prefer`` mode when it passed the gate) and the record for ``save_record``. A reference
    alignment is kept in ``lyrics_raw_reference.json`` whenever one was produced.
    """
    from src.utils.file_handling import get_song_dir, get_track_file_path

    cfg = settings(app)
    manager = get_manager(app)
    vocals = get_track_file_path(track_id, "vocals", create=False)
    if not os.path.isfile(vocals) or os.path.getsize(vocals) == 0:
        raise SeparationFailed("vocals.mp3 is missing")
    lines = [line for line in (reference_lines or []) if isinstance(line, str)]
    times = reference_times if reference_times and len(reference_times) == len(lines) else None
    mode = REFERENCE_MODES.get(cfg["TRANSCRIBE_REFERENCE_MODE"], "shadow") if lines else "asr"
    song_dir = get_song_dir(track_id, create=False)
    workdir = tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=song_dir)
    try:
        spec = {
            "input": os.path.abspath(vocals),
            "outputs": {"asr": os.path.join(workdir, "asr.json"), "reference": os.path.join(workdir, "ref.json")},
            "priority": priority,
            "mode": mode,
            "language": language,
            "reference": {"lines": lines, "times": times} if lines else None,
            "label": str(track_id),
        }
        result = run_job(
            manager, spec, on_event,
            should_abort=should_abort,
            idle_timeout=float(cfg["TRANSCRIBE_IDLE_TIMEOUT"]),
            stall_timeout=float(cfg["TRANSCRIBE_STALL_TIMEOUT"]),
            total_timeout=float(cfg["TRANSCRIBE_JOB_TIMEOUT"]) if priority == "interactive" else None,
            queue_timeout=float(cfg["TRANSCRIBE_QUEUE_TIMEOUT"] or 0) if priority == "interactive" else None,
            op="transcribe",
        )
        chosen = result.get("chosen")
        if chosen not in ("asr", "reference"):
            raise SeparationFailed("the transcription worker did not say which result to use")
        lyrics_raw = _load_output(spec["outputs"][chosen])
        if os.path.isfile(spec["outputs"]["reference"]):
            os.replace(spec["outputs"]["reference"], os.path.join(song_dir, REFERENCE_FILE))
        record = {
            "backend": "local",
            "engine": result.get("engine", "turbo-lyrics"),
            "version": result.get("version"),
            "model": result.get("model"),
            "compute_type": result.get("compute_type"),
            "align_precision": result.get("align_precision"),
            "mode": mode,
            "chosen": chosen,
            "language": lyrics_raw.get("detected_language"),
            "duration_s": result.get("duration_s"),
            "wall_s": result.get("wall_s"),
            "rtf": result.get("rtf"),
            "asr": result.get("asr"),
            "reference": result.get("reference"),
            "agreement": result.get("agreement"),
            "created_at": _now(),
        }
        return lyrics_raw, record
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

