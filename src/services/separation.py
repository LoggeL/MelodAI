"""Vocal separation from the Flask side: worker supervision, job client, stem installation and records.

Local separation runs in ``src/services/separation_worker.py``, a separate long-lived process that this module
starts on demand (``WorkerManager``) and talks to over a unix socket. ``separate_track_locally`` runs one track
through it, writes the stems via temporary files and atomic renames, and records the producer in
``songs/<id>/separation.json``. Any problem reaching the worker raises ``SeparationUnavailable`` so the pipeline
can fall back to Replicate.
"""

from __future__ import annotations

import atexit
import importlib.util
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime

log = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RECORD_FILE = "separation.json"
BACKUP_FILES = {"vocals": "vocals.demucs.mp3", "no_vocals": "no_vocals.demucs.mp3"}
STEM_FILES = {"vocals": "vocals.mp3", "no_vocals": "no_vocals.mp3"}
TEMP_PREFIX = ".separation-"
STALE_TEMP_SECONDS = 6 * 3600
DEMUCS_MODEL = "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953"

DEFAULTS = {
    "SPLIT_BACKEND": "local",
    "SEPARATION_SOCKET": "/tmp/melodai-separation.sock",
    "SEPARATION_ENGINE": "turbo",
    "SEPARATION_MODEL": "resurrection",
    "SEPARATION_PRECISION": "bf16",
    "SEPARATION_THREADS": 8,
    "SEPARATION_OVERLAP": 2.0,
    "SEPARATION_BITRATE": "128k",
    "SEPARATION_NICE": 10,
    "SEPARATION_PREEMPT": True,
    "SEPARATION_MODEL_DIR": None,
    "SEPARATION_WORKER_AUTOSTART": True,
    "SEPARATION_START_TIMEOUT": 30.0,
    "SEPARATION_FAILURE_BACKOFF": 600.0,
    "SEPARATION_IDLE_TIMEOUT": 60.0,
    "SEPARATION_STALL_TIMEOUT": 600.0,
    "SEPARATION_JOB_TIMEOUT": 1800.0,
}


class SeparationUnavailable(RuntimeError):
    """The worker could not be reached, crashed, timed out or could not load its model."""


class SeparationFailed(RuntimeError):
    """The worker ran the job and reported an error for this input."""


class SeparationAborted(RuntimeError):
    """The caller cancelled the job."""


def _env_bool(value):
    return str(value).strip().lower() not in ("0", "false", "no", "off", "")


def config_from_env(environ=None):
    """Settings for ``app.config`` from environment variables (same names as the config keys)."""
    environ = os.environ if environ is None else environ
    config = {}
    for key, default in DEFAULTS.items():
        raw = environ.get(key)
        if raw is None or raw == "":
            config[key] = default
        elif isinstance(default, bool):
            config[key] = _env_bool(raw)
        elif isinstance(default, int):
            config[key] = int(raw)
        elif isinstance(default, float):
            config[key] = float(raw)
        else:
            config[key] = raw
    config["SPLIT_BACKEND"] = str(config["SPLIT_BACKEND"]).strip().lower()
    return config


def settings(app=None):
    """Effective separation settings for ``app`` (or the current app, or the environment)."""
    if app is None:
        from flask import current_app, has_app_context
        app = current_app._get_current_object() if has_app_context() else None
    base = config_from_env()
    if app is not None:
        for key in DEFAULTS:
            if key in app.config:
                base[key] = app.config[key]
    return base


def split_backend(app=None):
    backend = str(settings(app)["SPLIT_BACKEND"]).lower()
    return backend if backend in ("local", "replicate") else "local"


def installed_version():
    """turbo-roformer version installed in this environment (without importing torch), or None."""
    try:
        from importlib.metadata import PackageNotFoundError, version
        return version("turbo-roformer")
    except (ImportError, PackageNotFoundError):
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------- worker process

class WorkerManager:
    """Starts and supervises the worker process; one per app (``app.extensions['separation_worker']``)."""

    def __init__(self, cfg):
        self.cfg = dict(cfg)
        self.socket_path = self.cfg["SEPARATION_SOCKET"]
        self._lock = threading.Lock()
        self._proc = None
        self._crashes = []
        self._atexit_registered = False
        self._unavailable_until = 0.0
        self.last_error = ""

    # -------------------------------------------------------------- low level
    def connect(self, timeout=5.0):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            sock.connect(self.socket_path)
        except OSError:
            sock.close()
            raise
        return sock

    def ping(self, timeout=3.0):
        """Worker status dict, or None when nothing answers on the socket."""
        try:
            sock = self.connect(timeout)
        except OSError:
            return None
        try:
            sock.sendall(b'{"op": "ping"}\n')
            line = sock.makefile("rb").readline(256 * 1024)
            return json.loads(line) if line else None
        except (OSError, ValueError):
            return None
        finally:
            _close(sock)

    def command(self):
        c = self.cfg
        cmd = [sys.executable, "-m", "src.services.separation_worker",
               "--socket", self.socket_path,
               "--engine", str(c["SEPARATION_ENGINE"]),
               "--model", str(c["SEPARATION_MODEL"]),
               "--precision", str(c["SEPARATION_PRECISION"]),
               "--threads", str(int(c["SEPARATION_THREADS"])),
               "--nice", str(int(c["SEPARATION_NICE"])),
               "--parent-pid", str(os.getpid())]
        if c.get("SEPARATION_MODEL_DIR"):
            cmd += ["--model-dir", str(c["SEPARATION_MODEL_DIR"])]
        if not c["SEPARATION_PREEMPT"]:
            cmd.append("--no-preempt")
        return cmd

    def engine_installed(self):
        if self.cfg["SEPARATION_ENGINE"] != "turbo":
            return True
        return importlib.util.find_spec("turbo_roformer") is not None

    # -------------------------------------------------------------- supervision
    def ensure_running(self):
        """True when a worker answers (starting it if needed); False when local separation is unavailable."""
        status = self.ping()
        if status and status.get("state") != "failed":
            return True
        with self._lock:
            status = self.ping()
            if status and status.get("state") != "failed":
                return True
            if not self.cfg["SEPARATION_WORKER_AUTOSTART"]:
                self.last_error = "worker is not running and autostart is disabled"
                return False
            if time.monotonic() < self._unavailable_until:
                return False
            if not self.engine_installed():
                self.last_error = "turbo-roformer is not installed"
                self._unavailable_until = time.monotonic() + float(self.cfg["SEPARATION_FAILURE_BACKOFF"])
                log.warning("Local separation unavailable: turbo-roformer is not installed")
                return False
            if self._proc is None or self._proc.poll() is not None:
                if self._proc is not None:
                    log.warning("Separation worker exited with code %s; restarting", self._proc.returncode)
                self._spawn()
            deadline = time.monotonic() + float(self.cfg["SEPARATION_START_TIMEOUT"])
            while time.monotonic() < deadline:
                status = self.ping(timeout=1.0)
                if status and status.get("state") != "failed":
                    return True
                if self._proc.poll() is not None:
                    break
                time.sleep(0.1)
            code = self._proc.poll()
            self.last_error = (f"worker exited during startup (code {code})" if code is not None
                               else "worker did not answer in time")
            log.warning("Local separation unavailable: %s", self.last_error)
            self._unavailable_until = time.monotonic() + float(self.cfg["SEPARATION_FAILURE_BACKOFF"])
            return False

    def _spawn(self):
        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("OMP_NUM_THREADS", str(int(self.cfg["SEPARATION_THREADS"])))
        log.info("Starting separation worker: %s", " ".join(self.command()))
        self._proc = subprocess.Popen(self.command(), cwd=PROJECT_ROOT, env=env, stdin=subprocess.DEVNULL)
        if not self._atexit_registered:
            atexit.register(self.stop, 3.0)
            self._atexit_registered = True

    def stop(self, timeout=10.0):
        with self._lock:
            proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(5)

    def mark_crashed(self):
        """A job lost its worker. The next job restarts it; a second crash within the backoff window disables
        local separation for the backoff period (the pipeline then falls back to Replicate)."""
        with self._lock:
            now = time.monotonic()
            backoff = float(self.cfg["SEPARATION_FAILURE_BACKOFF"])
            self._crashes = [t for t in self._crashes if now - t < backoff] + [now]
            if len(self._crashes) >= 2:
                self.last_error = "separation worker crashed repeatedly"
                self._unavailable_until = now + backoff

    def status(self):
        status = self.ping()
        if status:
            return {"available": status.get("state") != "failed", **status}
        return {"available": False, "state": "stopped", "error": self.last_error,
                "engine_installed": self.engine_installed()}


def get_manager(app=None):
    if app is None:
        from flask import current_app
        app = current_app._get_current_object()
    manager = app.extensions.get("separation_worker")
    if manager is None:
        manager = app.extensions.setdefault("separation_worker", WorkerManager(settings(app)))
    return manager


# ---------------------------------------------------------------------------------------------- job client

def run_job(manager, spec, on_event=None, *, should_abort=None, idle_timeout=60.0, stall_timeout=600.0,
            total_timeout=None):
    """Submit ``spec`` and block until the worker finishes it. Returns the worker's result dict.

    ``on_event(message)`` sees every queued/started/progress/preempted/heartbeat message. Raises
    SeparationUnavailable (worker gone, timeouts), SeparationFailed (job error) or SeparationAborted.
    """
    if not manager.ensure_running():
        raise SeparationUnavailable(manager.last_error or "separation worker is not available")
    try:
        sock = manager.connect(timeout=5.0)
    except OSError as e:
        raise SeparationUnavailable(f"cannot connect to the separation worker: {e}") from e
    started = time.monotonic()
    last_activity = None
    try:
        sock.sendall((json.dumps({"op": "separate", "job": spec}) + "\n").encode())
        sock.settimeout(idle_timeout)
        reader = sock.makefile("rb")
        while True:
            try:
                line = reader.readline(256 * 1024)
            except TimeoutError as e:
                raise SeparationUnavailable("the separation worker stopped responding") from e
            except OSError as e:
                raise SeparationUnavailable(f"lost the separation worker: {e}") from e
            if not line:
                manager.mark_crashed()
                raise SeparationUnavailable("the separation worker closed the connection")
            try:
                message = json.loads(line)
            except ValueError as e:
                raise SeparationUnavailable("invalid message from the separation worker") from e
            event = message.get("event")
            if event == "done":
                return message.get("result") or {}
            if event == "error":
                text = str(message.get("message") or "separation failed")
                if message.get("retryable"):
                    raise SeparationUnavailable(text)
                raise SeparationFailed(text)
            now = time.monotonic()
            if event in ("started", "progress"):
                last_activity = now
            elif event in ("queued", "preempted"):
                last_activity = None
            if on_event is not None:
                on_event(message)
            if should_abort is not None and should_abort():
                raise SeparationAborted("separation cancelled")
            if total_timeout and now - started > total_timeout:
                raise SeparationUnavailable(f"separation took longer than {int(total_timeout)} s")
            if last_activity is not None and now - last_activity > stall_timeout:
                raise SeparationUnavailable(f"no separation progress for {int(stall_timeout)} s")
    finally:
        _close(sock)


def _close(sock):
    """Shut the connection down even while a makefile() reader still references the socket."""
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        sock.close()
    except OSError:
        pass


def status_for_event(message):
    """Map a worker event to ``(progress_percent, detail)`` for the splitting stage, or None to keep the last."""
    event = message.get("event")
    if event == "queued":
        return 26, f"Waiting in queue (position {int(message.get('position') or 1)})..."
    if event == "accepted" and message.get("state") == "loading":
        return 26, "Loading separation model..."
    if event == "heartbeat" and message.get("state") == "loading":
        return 26, "Loading separation model..."
    if event == "preempted":
        return 26, "Waiting in queue..."
    if event == "started":
        return 27, "Separating vocals..."
    if event == "progress":
        # 27..34 keeps the bar monotonic up to the stage's final 35 % ("Vocals separated")
        done, total = int(message.get("done") or 0), int(message.get("total") or 0)
        if total <= 0:
            return 27, "Separating vocals..."
        return 27 + int(7 * min(done, total) / total), f"Separating vocals ({done}/{total})..."
    return None


# ---------------------------------------------------------------------------------------------- files

def _now():
    return datetime.now(UTC).isoformat()


def record_path(track_id):
    from src.utils.file_handling import get_song_dir
    return os.path.join(get_song_dir(track_id, create=False), RECORD_FILE)


def load_record(track_id):
    try:
        with open(record_path(track_id), encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save_record(track_id, record):
    path = record_path(track_id)
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
        os.chmod(temporary, 0o644)  # like the stems next to it (mkstemp creates 0600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def remove_record(track_id):
    try:
        os.remove(record_path(track_id))
    except (OSError, ValueError):
        pass


def replicate_record():
    return {"backend": "replicate", "engine": "demucs", "model": DEMUCS_MODEL, "version": None,
            "created_at": _now()}


def is_current(record, cfg=None, version=None):
    """True when the stems already come from the configured local model, package version and overlap."""
    cfg = cfg or settings()
    version = version if version is not None else installed_version()
    return bool(
        record
        and record.get("backend") == "local"
        and record.get("model_key", record.get("model")) == cfg["SEPARATION_MODEL"]
        and version is not None
        and record.get("version") == version
        and float(record.get("overlap") or 0) == float(cfg["SEPARATION_OVERLAP"])
    )


def backup_stems(track_id):
    """Keep the pre-local stems once as ``*.demucs.mp3`` (hard link when possible). Returns the backups made."""
    from src.utils.file_handling import get_song_dir
    song_dir = get_song_dir(track_id, create=False)
    made = []
    for key, backup in BACKUP_FILES.items():
        src = os.path.join(song_dir, STEM_FILES[key])
        dst = os.path.join(song_dir, backup)
        if os.path.exists(dst) or not os.path.isfile(src):
            continue
        tmp = dst + ".tmp"
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
            try:
                os.link(src, tmp)
            except OSError:
                shutil.copy2(src, tmp)
            os.replace(tmp, dst)
            made.append(backup)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return made


def _clean_stale_temp_dirs(song_dir):
    now = time.time()
    try:
        names = os.listdir(song_dir)
    except OSError:
        return
    for name in names:
        path = os.path.join(song_dir, name)
        if name.startswith(TEMP_PREFIX) and os.path.isdir(path):
            try:
                if now - os.path.getmtime(path) > STALE_TEMP_SECONDS:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                pass


def clean_temp_dirs(app=None):
    """Remove every leftover ``.separation-*`` directory (call at startup, before any job runs)."""
    from flask import has_app_context
    from src.utils.file_handling import get_all_track_ids, get_song_dir

    def run():
        removed = 0
        for track_id in get_all_track_ids():
            song_dir = get_song_dir(track_id, create=False)
            try:
                names = os.listdir(song_dir)
            except OSError:
                continue
            for name in names:
                path = os.path.join(song_dir, name)
                if name.startswith(TEMP_PREFIX) and os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                    removed += 1
        return removed

    if app is not None and not has_app_context():
        with app.app_context():
            return run()
    return run()


def separate_track_locally(track_id, *, priority="interactive", on_event=None, should_abort=None,
                           should_install=None, app=None):
    """Separate ``song.mp3`` of a track with the local worker and install ``vocals.mp3``/``no_vocals.mp3``.

    The stems are written into a temporary directory inside the song directory and moved into place with
    ``os.replace`` only after both were produced, so a failure keeps the previous stems. ``should_install()``
    is checked right before the move (the batch uses it to back off when the track started reprocessing).
    Returns the separation record that was written to ``separation.json``.
    """
    from src.utils.file_handling import get_song_dir, get_track_file_path

    cfg = settings(app)
    manager = get_manager(app)
    song_path = get_track_file_path(track_id, "song", create=False)
    if not os.path.isfile(song_path) or os.path.getsize(song_path) == 0:
        raise SeparationFailed("song.mp3 is missing")
    song_dir = get_song_dir(track_id, create=False)
    _clean_stale_temp_dirs(song_dir)
    workdir = tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=song_dir)
    try:
        spec = {
            "input": os.path.abspath(song_path),
            "outputs": {key: os.path.join(workdir, name) for key, name in STEM_FILES.items()},
            "priority": priority,
            "overlap": float(cfg["SEPARATION_OVERLAP"]),
            "bitrate": str(cfg["SEPARATION_BITRATE"]),
            "label": str(track_id),
        }
        result = run_job(
            manager, spec, on_event,
            should_abort=should_abort,
            idle_timeout=float(cfg["SEPARATION_IDLE_TIMEOUT"]),
            stall_timeout=float(cfg["SEPARATION_STALL_TIMEOUT"]),
            total_timeout=float(cfg["SEPARATION_JOB_TIMEOUT"]) if priority == "interactive" else None,
        )
        for path in spec["outputs"].values():
            if not os.path.isfile(path) or os.path.getsize(path) == 0:
                raise SeparationFailed("the separation worker did not produce both stems")
        if should_install is not None and not should_install():
            raise SeparationAborted("track changed while separating; result discarded")
        record = {
            "backend": "local",
            "engine": result.get("engine", "turbo-roformer"),
            "model": result.get("model"),
            "model_key": result.get("model_key", cfg["SEPARATION_MODEL"]),
            "version": result.get("version"),
            "precision": result.get("precision"),
            "compute_backend": result.get("compute_backend"),
            "overlap": result.get("overlap", float(cfg["SEPARATION_OVERLAP"])),
            "bitrate": spec["bitrate"],
            "duration_s": result.get("duration_s"),
            "wall_s": result.get("wall_s"),
            "rtf": result.get("rtf"),
            "created_at": _now(),
        }
        for key, name in STEM_FILES.items():
            os.replace(spec["outputs"][key], os.path.join(song_dir, name))
        save_record(track_id, record)
        return record
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
