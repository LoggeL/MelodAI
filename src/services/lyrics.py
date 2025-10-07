from flask import current_app
import replicate
import json
import os
from ..utils.helpers import chunk_lyrics, merge_lyrics
from ..utils.extensions import socketio
import librosa
import soundfile as sf
from pathlib import Path
import logging
import time
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


def validate_lyrics_data(data: Dict[str, Any]) -> bool:
    """Validate that lyrics data has the expected structure."""
    if not isinstance(data, dict):
        return False
    if "segments" not in data:
        return False
    if not isinstance(data["segments"], list):
        return False
    # Check if segments have required fields
    for segment in data["segments"]:
        if not isinstance(segment, dict):
            return False
        if "words" not in segment or not isinstance(segment["words"], list):
            return False
    return True


def extract_lyrics_with_retry(track_id: str, max_retries: int = 3) -> Optional[Dict[str, Any]]:
    """Extract lyrics from vocals using WhisperX with retry logic."""
    for attempt in range(max_retries):
        try:
            logger.info(f"Extracting lyrics for track {track_id}, attempt {attempt + 1}/{max_retries}")
            
            vocals_path = f"src/songs/{track_id}/vocals.mp3"
            if not os.path.exists(vocals_path):
                logger.error(f"Vocals file not found: {vocals_path}")
                return None
            
            with open(vocals_path, "rb") as vocals_file:
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
            
            # Validate output
            if not validate_lyrics_data(output):
                logger.error(f"Invalid lyrics data structure for track {track_id}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                return None
            
            return output
            
        except Exception as e:
            logger.error(f"Error extracting lyrics for track {track_id}, attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                return None
    
    return None


def process_lyrics(track_id):
    """Process lyrics for a track using Whisper and other services."""

    with current_app.app_context():

        # Check if lyrics already exist
        lyrics_raw_path = f"src/songs/{track_id}/lyrics_raw.json"
        if (
            not os.path.isfile(lyrics_raw_path)
            or os.path.getsize(lyrics_raw_path) == 0
        ):
            logger.info(f"Extracting Lyrics for track {track_id}")
            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "extracting_lyrics", "progress": 60},
            )

            output = extract_lyrics_with_retry(track_id)
            
            if output is None:
                logger.error(f"Failed to extract lyrics for track {track_id}")
                socketio.emit(
                    "track_progress",
                    {"track_id": track_id, "status": "error", "progress": 60, "error": "Failed to extract lyrics"},
                )
                return False

            # Save the lyrics
            try:
                with open(lyrics_raw_path, "w", encoding="utf-8") as f:
                    json.dump(output, f, ensure_ascii=False, indent=2)
                logger.info(f"Saved raw lyrics for track {track_id}")
            except Exception as e:
                logger.error(f"Error saving raw lyrics for track {track_id}: {e}")
                return False

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "merging_lyrics", "progress": 70},
        )

        # Merge lyrics
        lyrics_merged_path = f"src/songs/{track_id}/lyrics_merged.json"
        if (
            not os.path.isfile(lyrics_merged_path)
            or os.path.getsize(lyrics_merged_path) == 0
        ):
            try:
                logger.info(f"Merging Lyrics for track {track_id}")
                merge_lyrics(track_id)
                
                # Validate merged lyrics
                if os.path.exists(lyrics_merged_path):
                    with open(lyrics_merged_path, "r", encoding="utf-8") as f:
                        merged_data = json.load(f)
                    if not validate_lyrics_data(merged_data):
                        raise ValueError("Invalid merged lyrics data structure")
                        
            except Exception as e:
                logger.error(f"Error Merging lyrics for track {track_id}: {e}")
                # Fallback: copy lyrics_raw to lyrics_merged
                try:
                    with open(f"src/songs/{track_id}/lyrics_raw.json", "r", encoding="utf-8") as f:
                        data = json.load(f)
                    with open(lyrics_merged_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    logger.info(f"Used raw lyrics as fallback for merged lyrics for track {track_id}")
                except Exception as fallback_error:
                    logger.error(f"Error during fallback for track {track_id}: {fallback_error}")
                    socketio.emit(
                        "track_progress",
                        {"track_id": track_id, "status": "error", "progress": 70, "error": str(e)},
                    )
                    return False

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "chunking_lyrics", "progress": 80},
        )

        # Chunk lyrics
        lyrics_final_path = f"src/songs/{track_id}/lyrics.json"
        if (
            not os.path.isfile(lyrics_final_path)
            or os.path.getsize(lyrics_final_path) == 0
        ):
            try:
                logger.info(f"Chunking Lyrics for track {track_id}")
                chunk_lyrics(track_id)
                
                # Validate chunked lyrics
                if os.path.exists(lyrics_final_path):
                    with open(lyrics_final_path, "r", encoding="utf-8") as f:
                        chunked_data = json.load(f)
                    if not validate_lyrics_data(chunked_data):
                        raise ValueError("Invalid chunked lyrics data structure")
                        
            except Exception as e:
                logger.error(f"Error chunking lyrics for track {track_id}: {e}")
                # Fallback: copy lyrics_merged to lyrics.json
                try:
                    fallback_path = f"src/songs/{track_id}/lyrics_merged.json"
                    if os.path.exists(fallback_path):
                        with open(fallback_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                    else:
                        with open(f"src/songs/{track_id}/lyrics_raw.json", "r", encoding="utf-8") as f:
                            data = json.load(f)
                    
                    with open(lyrics_final_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    logger.info(f"Used fallback lyrics for track {track_id}")
                except Exception as fallback_error:
                    logger.error(f"Error during chunking fallback for track {track_id}: {fallback_error}")
                    socketio.emit(
                        "track_progress",
                        {"track_id": track_id, "status": "error", "progress": 80, "error": str(e)},
                    )
                    return False

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "lyrics_chunked", "progress": 90},
        )
        
        return True


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
