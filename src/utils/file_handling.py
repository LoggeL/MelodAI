import json
import os
import shutil
import subprocess
import tempfile
from flask import current_app, has_app_context
from src.utils.constants import SONGS_DIR, TRACK_FILES

SONGS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), SONGS_DIR)
def get_songs_path():
    return current_app.config.get("SONGS_PATH", SONGS_PATH) if has_app_context() else SONGS_PATH


def _validate_song_path(path):
    """Resolve *path* and verify it stays within the songs directory.

    Raises ValueError if the resolved path escapes SONGS_PATH.
    """
    root = os.path.realpath(get_songs_path())
    resolved = os.path.realpath(path)
    if resolved == root:
        return root
    # Include the separator so a sibling such as "songs-backup" cannot match.
    # Resolve both paths first to reject escapes through symlinks as well as "..".
    if not resolved.startswith(os.path.join(root, "")):
        raise ValueError("Path traversal detected")
    return resolved


def normalize_track_id(track_id):
    """Return a safe Deezer track id for filesystem use."""
    track_id = str(track_id).strip()
    if not track_id.isascii() or not track_id.isdigit() or len(track_id) > 32:
        raise ValueError("Invalid track ID")
    return track_id


def is_valid_track_id(track_id):
    try:
        normalize_track_id(track_id)
        return True
    except ValueError:
        return False


def get_song_dir(track_id, *, create=True):
    track_id = normalize_track_id(track_id)
    path = os.path.join(get_songs_path(), track_id)
    resolved = _validate_song_path(path)
    if create:
        os.makedirs(resolved, exist_ok=True)
    return resolved


def _load_json(track_id, file_key):
    if not is_valid_track_id(track_id):
        return None
    path = get_track_file_path(track_id, file_key, create=False)
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        allowed = (dict, list) if file_key == "lyrics_raw" else (dict,)
        return data if isinstance(data, allowed) else None
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def _save_json(track_id, file_key, data):
    """Readers see the old complete document or the new complete document."""
    path = get_track_file_path(track_id, file_key)
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def load_metadata(track_id):
    return _load_json(track_id, "metadata")


def save_metadata(track_id, data):
    _save_json(track_id, "metadata", data)


def load_lyrics(track_id):
    return _load_json(track_id, "lyrics")


def save_lyrics(track_id, data):
    _save_json(track_id, "lyrics", data)


def save_lyrics_raw(track_id, data):
    _save_json(track_id, "lyrics_raw", data)


def track_file_exists(track_id, file_key):
    if not is_valid_track_id(track_id):
        return False
    path = get_track_file_path(track_id, file_key, create=False)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return False
    if file_key in ("metadata", "lyrics", "lyrics_raw"):
        return _load_json(track_id, file_key) is not None
    return True


def get_track_file_path(track_id, file_key, *, create=True):
    path = os.path.join(get_song_dir(track_id, create=create), TRACK_FILES.get(file_key, file_key))
    return _validate_song_path(path)


def is_track_complete(track_id):
    return all(track_file_exists(track_id, key) for key in ("metadata", "song", "vocals", "no_vocals", "lyrics"))


def get_all_track_ids():
    songs_path = get_songs_path()
    if not os.path.exists(songs_path):
        return []
    return [
        d for d in os.listdir(songs_path)
        if os.path.isdir(os.path.join(songs_path, d)) and not os.path.islink(os.path.join(songs_path, d)) and is_valid_track_id(d)
    ]


def get_track_file_sizes(track_id):
    if not is_valid_track_id(track_id):
        return {}
    song_dir = get_song_dir(track_id, create=False)
    sizes = {}
    for key, filename in TRACK_FILES.items():
        path = os.path.join(song_dir, filename)
        if os.path.exists(path):
            sizes[key] = os.path.getsize(path)
    return sizes


def delete_track(track_id):
    track_id = normalize_track_id(track_id)
    song_dir = os.path.join(get_songs_path(), track_id)
    resolved = _validate_song_path(song_dir)
    if os.path.exists(resolved):
        shutil.rmtree(resolved)
        return True
    return False


def compress_audio_file(file_path, bitrate="128k"):
    """Re-encode an audio file in-place at the given bitrate using ffmpeg.
    Writes to a temp file in the same directory, then atomically replaces."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    dir_name = os.path.dirname(file_path)
    fd, tmp_path = tempfile.mkstemp(suffix=".mp3", dir=dir_name)
    os.close(fd)

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-b:a", bitrate, "-map", "a", tmp_path],
            capture_output=True, check=True, timeout=300,
        )
        shutil.move(tmp_path, file_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def get_audio_bitrate(file_path):
    """Return the audio bitrate of a file in kbps using ffprobe, or None on failure."""
    if not os.path.exists(file_path):
        return None
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-select_streams", "a:0",
             "-show_entries", "stream=bit_rate", "-of", "csv=p=0", file_path],
            capture_output=True, text=True, check=True, timeout=30,
        )
        bps = int(result.stdout.strip())
        return bps // 1000
    except Exception:
        return None


def file_mtime_iso(path):
    """Modification time of *path* as a UTC ISO string ("2026-10-08T14:21:00Z"), or None."""
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probe_duration(path):
    """Length of an audio file in seconds (rounded) via ffprobe, or None."""
    if not os.path.isfile(path):
        return None
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True, text=True, check=True, timeout=30,
        )
        seconds = float(result.stdout.strip())
    except Exception:
        return None
    return int(round(seconds)) if seconds > 0 else None


# Tracks whose song.mp3 could not be measured in this process; they are not probed again.
_DURATION_MISSES = set()


def stored_duration(meta):
    """Duration in whole seconds from metadata.json (Deezer value or a cached probe), else 0."""
    value = (meta or {}).get("duration")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return 0
    return int(round(value))


def track_duration(track_id, meta, probe_budget=None):
    """Duration of a song in seconds for lists.

    Uses metadata.json first. Older songs without a Deezer duration are measured once with ffprobe and the
    result is cached in metadata.json, so list requests never re-run ffprobe for the same song. probe_budget
    (a one-element list with the number of probes this request may still run) bounds the work per request;
    None disables probing.
    """
    seconds = stored_duration(meta)
    if seconds or meta is None or probe_budget is None or probe_budget[0] <= 0:
        return seconds
    key = (get_songs_path(), str(track_id))
    if key in _DURATION_MISSES or not is_track_complete(track_id):
        return 0
    from src.utils.status_checks import get_processing_status
    if get_processing_status(track_id):
        return 0  # the pipeline may be rewriting metadata.json right now
    probe_budget[0] -= 1
    seconds = probe_duration(get_track_file_path(track_id, "song", create=False))
    if not seconds:
        _DURATION_MISSES.add(key)
        return 0
    current = load_metadata(track_id)
    if current is not None and not stored_duration(current):
        current["duration"] = seconds
        save_metadata(track_id, current)
    meta["duration"] = seconds
    return seconds
