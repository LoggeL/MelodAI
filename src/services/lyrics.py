from flask import current_app
import replicate
import json
import os
from ..utils.helpers import split_long_lyrics_lines
from ..utils.status_checks import save_status_check, update_queue_item_status
from ..utils.constants import STATUS_OK, STATUS_ERROR
import librosa
import soundfile as sf
from pathlib import Path


def process_lyrics(track_id):
    """Process lyrics for a track using Whisper and other services."""

    with current_app.app_context():
        try:
            # Check if lyrics already exist
            if (
                not os.path.isfile(f"src/songs/{track_id}/lyrics_raw.json")
                or os.path.getsize(f"src/songs/{track_id}/lyrics_raw.json") == 0
            ):
                print("Extracting Lyrics")

                update_queue_item_status(track_id, "extracting_lyrics", 60)

                with open(f"src/songs/{track_id}/vocals.mp3", "rb") as vocals_file:
                    output = replicate.run(
                        "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
                        input={
                            "debug": False,
                            "vad_onset": 0.5,
                            "audio_file": vocals_file,
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

                # Log successful lyrics extraction
                save_status_check(
                    "Lyrics Extraction",
                    STATUS_OK,
                    f"Successfully extracted raw lyrics for track {track_id}",
                )

            update_queue_item_status(track_id, "raw_lyrics_complete", 70)

            # If the full lyrics don't exist or are empty, process them
            if (
                not os.path.isfile(f"src/songs/{track_id}/lyrics.json")
                or os.path.getsize(f"src/songs/{track_id}/lyrics.json") == 0
            ):
                # Load the raw lyrics
                with open(f"src/songs/{track_id}/lyrics_raw.json", "r") as f:
                    raw_lyrics = json.load(f)

                print("Processing Lyrics")

                update_queue_item_status(track_id, "processing_lyrics", 75)

                update_queue_item_status(track_id, "lyrics_merged", 80)

                # Split long lines into more manageable chunks
                split_lyrics = split_long_lyrics_lines(track_id)

                update_queue_item_status(track_id, "lyrics_split", 85)

                # Save the processed lyrics
                with open(f"src/songs/{track_id}/lyrics.json", "w") as f:
                    json.dump(split_lyrics, f)

                # Log successful lyrics processing
                save_status_check(
                    "Lyrics Processing",
                    STATUS_OK,
                    f"Successfully processed lyrics for track {track_id}",
                )

            update_queue_item_status(track_id, "lyrics_complete", 90)

            return True

        except Exception as e:
            # Update queue status on error
            update_queue_item_status(track_id, "lyrics_error", 0)

            # Log error
            save_status_check(
                "Lyrics Processing",
                STATUS_ERROR,
                f"Error processing lyrics for track {track_id}: {str(e)}",
            )
            raise
