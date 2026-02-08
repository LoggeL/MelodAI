# Processing status constants
STATUS_PENDING = "pending"
STATUS_METADATA = "metadata"
STATUS_DOWNLOADING = "downloading"
STATUS_SPLITTING = "splitting"
STATUS_LYRICS = "lyrics"
STATUS_PROCESSING = "processing"
STATUS_COMPLETE = "complete"
STATUS_ERROR = "error"

# Progress percentages for each stage
PROGRESS = {
    STATUS_PENDING: 0,
    STATUS_METADATA: 5,
    STATUS_DOWNLOADING: 15,
    STATUS_SPLITTING: 35,
    STATUS_LYRICS: 65,
    STATUS_PROCESSING: 87,
    STATUS_COMPLETE: 100,
}

# Songs directory (relative to src/)
SONGS_DIR = "songs"

# Files per track
TRACK_FILES = {
    "metadata": "metadata.json",
    "song": "song.mp3",
    "vocals": "vocals.mp3",
    "no_vocals": "no_vocals.mp3",
    "lyrics": "lyrics.json",
    "lyrics_raw": "lyrics_raw.json",
}
