from flask import current_app
import replicate
import json
import os
from ..utils.helpers import chunk_lyrics, merge_lyrics
from ..utils.extensions import socketio


def process_lyrics(track_id):
    """Process lyrics for a track using Whisper and other services."""

    with current_app.app_context():

        # Check if lyrics already exist
        if (
            not os.path.isfile(f"src/songs/{track_id}/lyrics_raw.json")
            or os.path.getsize(f"src/songs/{track_id}/lyrics_raw.json") == 0
        ):
            print("Extracting Lyrics")
            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "extracting_lyrics", "progress": 60},
            )

            output = replicate.run(
                "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
                input={
                    "debug": False,
                    "vad_onset": 0.5,
                    "audio_file": open(f"src/songs/{track_id}/vocals.mp3", "rb"),
                    "batch_size": 64,
                    "vad_offset": 0.363,
                    "diarization": True,
                    "temperature": 0,
                    "align_output": True,
                    "language_detection_min_prob": 0,
                    "language_detection_max_tries": 5,
                    "huggingface_access_token": os.getenv("HF_READ_TOKEN"),
                },
            )

            # Save the lyrics
            with open(f"src/songs/{track_id}/lyrics_raw.json", "w") as f:
                f.write(json.dumps(output))

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "merging_lyrics", "progress": 70},
        )

        # Merge lyrics
        if (
            not os.path.isfile(f"src/songs/{track_id}/lyrics_merged.json")
            or os.path.getsize(f"src/songs/{track_id}/lyrics_merged.json") == 0
        ):
            try:
                print("Merging Lyrics")
                merge_lyrics(track_id)
            except Exception as e:
                print("Error Merging lyrics", e)
                # copy lyrics_raw to lyrics.json
                with open(f"src/songs/{track_id}/lyrics_raw.json", "r") as f:
                    data = json.load(f)
                with open(f"src/songs/{track_id}/lyrics.json", "w") as f:
                    json.dump(data, f)
                socketio.emit(
                    "track_progress",
                    {"track_id": track_id, "status": "error", "progress": 80},
                )

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "chunking_lyrics", "progress": 80},
        )

        # Chunk lyrics
        if (
            not os.path.isfile(f"src/songs/{track_id}/lyrics.json")
            or os.path.getsize(f"src/songs/{track_id}/lyrics.json") == 0
        ):
            try:
                print("Chunking Lyrics")
                chunk_lyrics(track_id)
            except Exception as e:
                print("Error chunking lyrics", e)
                # copy lyrics_raw to lyrics.json
                with open(f"src/songs/{track_id}/lyrics_raw.json", "r") as f:
                    data = json.load(f)
                with open(f"src/songs/{track_id}/lyrics.json", "w") as f:
                    json.dump(data, f)
                socketio.emit(
                    "track_progress",
                    {"track_id": track_id, "status": "error", "progress": 90},
                )

            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "lyrics_chunked", "progress": 90},
            )
