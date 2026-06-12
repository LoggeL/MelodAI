import threading
import os
import requests
from datetime import datetime

# Thread-safe processing queue
_processing_queue = {}
_queue_lock = threading.Lock()


def set_processing_status(track_id, status, progress, detail=""):
    with _queue_lock:
        _processing_queue[str(track_id)] = {
            "status": status,
            "progress": progress,
            "detail": detail,
            "updated_at": datetime.utcnow().isoformat(),
        }


def get_processing_status(track_id=None):
    with _queue_lock:
        if track_id:
            return _processing_queue.get(str(track_id))
        return dict(_processing_queue)


def remove_from_queue(track_id):
    with _queue_lock:
        _processing_queue.pop(str(track_id), None)


def claim_processing(track_id, status, progress, detail=""):
    """Atomically claim a track for processing.

    Check-then-set must happen under the queue lock: two concurrent /add
    requests (or /add racing the startup auto-reprocessor) would otherwise
    both pass the "already processing" check and spawn duplicate pipelines.
    Returns the existing entry if the track is already actively processing,
    or None after writing the new status (claim succeeded).
    """
    with _queue_lock:
        existing = _processing_queue.get(str(track_id))
        if existing and existing["status"] not in ("complete", "error"):
            return existing
        _processing_queue[str(track_id)] = {
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
        from src.utils.file_handling import SONGS_PATH
        os.makedirs(SONGS_PATH, exist_ok=True)
        stat = os.statvfs(SONGS_PATH)
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

    # Processing queue check
    with _queue_lock:
        active = [k for k, v in _processing_queue.items() if v["status"] not in ("complete", "error")]
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

    # OpenRouter check
    try:
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        resp = requests.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        if resp.status_code == 200:
            results["openrouter"] = {"status": "ok", "message": "OpenRouter API accessible"}
        else:
            results["openrouter"] = {"status": "error", "message": f"HTTP {resp.status_code}"}
    except Exception as e:
        results["openrouter"] = {"status": "error", "message": str(e)}

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
