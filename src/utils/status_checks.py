import threading
import os
import requests
from datetime import datetime
from flask import current_app, has_app_context

# Thread-safe processing queue
_processing_queue = {}
_queue_lock = threading.Lock()


def _queue():
    if has_app_context():
        return current_app.extensions.setdefault("processing_queue", {})
    return _processing_queue


def set_processing_status(track_id, status, progress, detail=""):
    with _queue_lock:
        _queue()[str(track_id)] = {
            "status": status,
            "progress": progress,
            "detail": detail,
            "updated_at": datetime.utcnow().isoformat(),
        }


def get_processing_status(track_id=None):
    with _queue_lock:
        if track_id:
            status = _queue().get(str(track_id))
            return dict(status) if status else None
        return {key: dict(value) for key, value in _queue().items()}


def remove_from_queue(track_id):
    with _queue_lock:
        _queue().pop(str(track_id), None)


def claim_processing(track_id, status, progress, detail=""):
    """Atomically claim a track for processing.

    Check-then-set must happen under the queue lock: two concurrent /add
    requests (or /add racing the startup auto-reprocessor) would otherwise
    both pass the "already processing" check and spawn duplicate pipelines.
    Returns the existing entry if the track is already actively processing,
    or None after writing the new status (claim succeeded).
    """
    with _queue_lock:
        existing = _queue().get(str(track_id))
        if existing and existing["status"] not in ("complete", "error"):
            return dict(existing)
        _queue()[str(track_id)] = {
            "status": status,
            "progress": progress,
            "detail": detail,
            "updated_at": datetime.utcnow().isoformat(),
        }
        return None


def run_health_checks():
    results = {}

    # Database check
    try:
        from src.models.db import get_db
        db = get_db()
        db.execute("SELECT 1")
        results["database"] = {"status": "ok", "message": "Database connection successful"}
    except Exception as e:
        results["database"] = {"status": "error", "message": str(e)}

    # Deezer check
    try:
        from src.services.deezer import test_deezer_login
        if test_deezer_login():
            results["deezer"] = {"status": "ok", "message": "Deezer login active"}
        else:
            results["deezer"] = {"status": "error", "message": "Deezer login failed"}
    except Exception as e:
        results["deezer"] = {"status": "error", "message": str(e)}

    # File system check
    try:
        from src.utils.file_handling import get_songs_path
        songs_path = get_songs_path()
        os.makedirs(songs_path, exist_ok=True)
        stat = os.statvfs(songs_path)
        free_gb = (stat.f_bavail * stat.f_frsize) / (1024 ** 3)
        results["filesystem"] = {"status": "ok", "message": f"{free_gb:.1f} GB free"}
    except Exception as e:
        results["filesystem"] = {"status": "error", "message": str(e)}

    # Replicate check
    try:
        token = os.getenv("REPLICATE_API_TOKEN", "")
        resp = requests.get(
            "https://api.replicate.com/v1/models",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if resp.status_code == 200:
            results["replicate"] = {"status": "ok", "message": "Replicate API accessible"}
        else:
            results["replicate"] = {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        results["replicate"] = {"status": "error", "message": str(e)}

    # Local separation worker check
    try:
        from src.services.separation import get_manager, split_backend
        if split_backend() != "local":
            results["separation"] = {"status": "ok", "message": "Local separation disabled; using Replicate Demucs"}
        else:
            worker = get_manager().status()
            info = worker.get("info") or {}
            if worker.get("available"):
                detail = ", ".join(str(v) for v in (info.get("model"), info.get("compute_backend"), info.get("precision")) if v)
                queue = len(worker.get("queue") or [])
                results["separation"] = {
                    "status": "ok",
                    "message": f"Worker {worker.get('state')}" + (f" ({detail})" if detail else "") + f", {queue} queued",
                }
            else:
                results["separation"] = {
                    "status": "error",
                    "message": f"Worker unavailable ({worker.get('error') or worker.get('state')}); falling back to Replicate",
                }
    except Exception as e:
        results["separation"] = {"status": "error", "message": str(e)}

    # Local transcription worker check
    try:
        from src.services.transcription import get_manager as get_transcription_manager, transcribe_backend
        if transcribe_backend() != "local":
            results["transcription"] = {"status": "ok", "message": "Local transcription disabled; using Replicate WhisperX"}
        else:
            worker = get_transcription_manager().status()
            info = worker.get("info") or {}
            if worker.get("available"):
                detail = ", ".join(str(v) for v in (info.get("model"), info.get("compute_type"), info.get("align_precision")) if v)
                queue = len(worker.get("queue") or [])
                results["transcription"] = {
                    "status": "ok",
                    "message": f"Worker {worker.get('state')}" + (f" ({detail})" if detail else "") + f", {queue} queued",
                }
            else:
                results["transcription"] = {
                    "status": "error",
                    "message": f"Worker unavailable ({worker.get('error') or worker.get('state')}); falling back to Replicate",
                }
    except Exception as e:
        results["transcription"] = {"status": "error", "message": str(e)}

    # Processing queue check
    with _queue_lock:
        active = [k for k, v in _queue().items() if v["status"] not in ("complete", "error")]
        if len(active) == 0:
            results["queue"] = {"status": "ok", "message": "No active processing"}
        else:
            results["queue"] = {"status": "ok", "message": f"{len(active)} tracks processing"}

    # lrclib check
    try:
        resp = requests.get(
            "https://lrclib.net/api/search",
            params={"q": "test"},
            timeout=10,
        )
        if resp.status_code == 200:
            results["lrclib"] = {"status": "ok", "message": "lrclib.net accessible"}
        else:
            results["lrclib"] = {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        results["lrclib"] = {"status": "error", "message": str(e)}

    # Voxtral (Mistral) check
    try:
        mistral_key = os.getenv("MISTRAL_API_KEY", "")
        if not mistral_key:
            results["voxtral"] = {"status": "error", "message": "MISTRAL_API_KEY not set"}
        else:
            resp = requests.get(
                "https://api.mistral.ai/v1/models",
                headers={"Authorization": f"Bearer {mistral_key}"},
                timeout=10,
            )
            if resp.status_code == 200:
                results["voxtral"] = {"status": "ok", "message": "Mistral API accessible (Voxtral fallback)"}
            else:
                results["voxtral"] = {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        results["voxtral"] = {"status": "error", "message": str(e)}

    # Check the preferred lyrics provider.
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    provider = "openai" if openai_key else "openrouter"
    try:
        api_key = openai_key or os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            results[provider] = {"status": "error", "message": "OPENAI_API_KEY or OPENROUTER_API_KEY not set"}
        else:
            endpoint = "https://api.openai.com/v1/models/gpt-6-luna" if openai_key else "https://openrouter.ai/api/v1/models"
            resp = requests.get(endpoint, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
            if resp.status_code == 200:
                label = "OpenAI GPT-6 Luna" if openai_key else "OpenRouter"
                results[provider] = {"status": "ok", "message": f"{label} API accessible"}
            else:
                results[provider] = {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        results[provider] = {"status": "error", "message": str(e)}

    return results


def reprocess_unfinished_tracks(app):
    from src.utils.file_handling import get_all_track_ids, is_track_complete, load_metadata
    from src.routes.track import process_track
    from src.utils.constants import STATUS_METADATA, PROGRESS

    # Tracks that keep failing (e.g. region-blocked) would otherwise re-run
    # on every restart, burning Replicate/OpenRouter cost each time.
    max_auto_retries = 5
    with app.app_context():
        from src.models.db import query_db
        failure_counts = {
            str(row["track_id"]): row["failure_count"]
            for row in query_db("SELECT track_id, failure_count FROM processing_failures")
        }

    track_ids = get_all_track_ids()
    for track_id in track_ids:
        if not is_track_complete(track_id):
            if failure_counts.get(str(track_id), 0) >= max_auto_retries:
                print(f"Skipping auto-reprocess of track {track_id}: failed {failure_counts[str(track_id)]} times")
                continue
            meta = load_metadata(track_id)
            if meta:
                if claim_processing(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Auto-reprocessing...") is not None:
                    continue  # already being processed
                print(f"Auto-reprocessing unfinished track {track_id}: {meta.get('title', 'Unknown')}")
                t = threading.Thread(
                    target=process_track,
                    args=(track_id, app),
                    daemon=True,
                )
                t.start()
