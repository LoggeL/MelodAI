import contextlib
import json
from pathlib import Path

@contextlib.contextmanager
def safe_open_mp3(path, mode='rb'):
    """Safely open and close MP3 files."""
    file = None
    try:
        file = open(path, mode)
        yield file
    finally:
        if file:
            file.close()

def load_track_metadata(track_id):
    """Load track metadata with safe file handling."""
    metadata_path = Path(f'src/songs/{track_id}/metadata.json')
    if metadata_path.exists():
        with open(metadata_path, 'r') as f:
            return json.load(f)
    return None

def save_track_metadata(track_id, metadata):
    """Save track metadata with safe file handling."""
    metadata_path = Path(f'src/songs/{track_id}/metadata.json')
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f) 