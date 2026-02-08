import json
import os
import shutil
import subprocess
import tempfile
from src.utils.constants import SONGS_DIR, TRACK_FILES

SONGS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), SONGS_DIR)


def get_song_dir(track_id):
    path = os.path.join(SONGS_PATH, str(track_id))
    os.makedirs(path, exist_ok=True)
    return path


def load_metadata(track_id):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES["metadata"])
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return None


def save_metadata(track_id, data):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES["metadata"])
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def load_lyrics(track_id):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES["lyrics"])
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return None


def save_lyrics(track_id, data):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES["lyrics"])
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def save_lyrics_raw(track_id, data):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES["lyrics_raw"])
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def track_file_exists(track_id, file_key):
    path = os.path.join(get_song_dir(track_id), TRACK_FILES.get(file_key, file_key))
    return os.path.exists(path)


def get_track_file_path(track_id, file_key):
    return os.path.join(get_song_dir(track_id), TRACK_FILES.get(file_key, file_key))


def is_track_complete(track_id):
    song_dir = get_song_dir(track_id)
    required = ["metadata", "song", "vocals", "no_vocals", "lyrics"]
    return all(
        os.path.exists(os.path.join(song_dir, TRACK_FILES[k])) for k in required
    )


def get_all_track_ids():
    if not os.path.exists(SONGS_PATH):
        return []
    return [
        d for d in os.listdir(SONGS_PATH)
        if os.path.isdir(os.path.join(SONGS_PATH, d)) and d.isdigit()
    ]


def get_track_file_sizes(track_id):
    song_dir = get_song_dir(track_id)
    sizes = {}
    for key, filename in TRACK_FILES.items():
        path = os.path.join(song_dir, filename)
        if os.path.exists(path):
            sizes[key] = os.path.getsize(path)
    return sizes


def delete_track(track_id):
    song_dir = os.path.join(SONGS_PATH, str(track_id))
    if os.path.exists(song_dir):
        shutil.rmtree(song_dir)
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
