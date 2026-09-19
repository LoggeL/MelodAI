import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from flask import current_app, has_app_context
from src.utils.constants import SONGS_DIR, TRACK_FILES

SONGS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), SONGS_DIR)
def get_songs_path():
    return current_app.config.get("SONGS_PATH", SONGS_PATH) if has_app_context() else SONGS_PATH


def _validate_song_path(path):
    """Resolve *path* and verify it stays within the songs directory.

    Raises ValueError if the resolved path escapes SONGS_PATH.
    """
    resolved = Path(path).resolve()
    try:
        resolved.relative_to(Path(get_songs_path()).resolve())
    except ValueError:
        raise ValueError("Path traversal detected")
    return str(resolved)


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
