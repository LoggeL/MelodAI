from flask import current_app
import replicate
import json
import os
from ..utils.helpers import chunk_lyrics, merge_lyrics
from ..utils.extensions import socketio
from ..utils.status_checks import save_status_check, update_queue_item_status
import librosa
import soundfile as sf
from pathlib import Path

# Status constants
STATUS_OK = "OK"
STATUS_WARNING = "WARNING"
STATUS_ERROR = "ERROR"


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
                socketio.emit(
                    "track_progress",
                    {
                        "track_id": track_id,
                        "status": "extracting_lyrics",
                        "progress": 60,
                    },
                )
                # Update queue status
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

            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "raw_lyrics_complete", "progress": 70},
            )
            # Update queue status
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
                socketio.emit(
                    "track_progress",
                    {
                        "track_id": track_id,
                        "status": "processing_lyrics",
                        "progress": 80,
                    },
                )
                # Update queue status
                update_queue_item_status(track_id, "processing_lyrics", 80)

                # Process the raw lyrics
                processed_lyrics = {
                    "segments": [],
                    "word_segments": [],
                }

                # Process the segments
                for segment in raw_lyrics.get("segments", []):
                    processed_segment = {
                        "start": segment.get("start"),
                        "end": segment.get("end"),
                        "text": segment.get("text"),
                    }
                    processed_lyrics["segments"].append(processed_segment)

                # Process the word segments
                for word in raw_lyrics.get("word_segments", []):
                    processed_word = {
                        "start": word.get("start"),
                        "end": word.get("end"),
                        "text": word.get("text"),
                    }
                    processed_lyrics["word_segments"].append(processed_word)

                # Save the processed lyrics
                with open(f"src/songs/{track_id}/lyrics.json", "w") as f:
                    json.dump(processed_lyrics, f)

                # Log successful lyrics processing
                save_status_check(
                    "Lyrics Processing",
                    STATUS_OK,
                    f"Successfully processed lyrics for track {track_id}",
                )

            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "lyrics_complete", "progress": 90},
            )
            # Update queue status
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


def transcribe_lyrics(track_id):
    """Transcribe lyrics from vocals using Whisper."""
    vocals_path = f"src/songs/{track_id}/vocals.mp3"
    lyrics_path = f"src/songs/{track_id}/lyrics.json"

    # Check if lyrics already exist
    if os.path.exists(lyrics_path):
        with open(lyrics_path, "r") as f:
            return json.load(f)

    # Load and process vocals file
    try:
        with open(vocals_path, "rb") as vocals_file:
            output = replicate.run(
                "openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7",
                input={"audio": vocals_file},
            )
    except Exception as e:
        print(f"Error transcribing lyrics: {e}")
        return {"error": "Failed to transcribe lyrics"}

    # Save transcribed lyrics
    lyrics_data = {"text": output["text"], "segments": output.get("segments", [])}
    os.makedirs(os.path.dirname(lyrics_path), exist_ok=True)

    with open(lyrics_path, "w") as f:
        json.dump(lyrics_data, f)

    return lyrics_data
