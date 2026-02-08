import os
import json
import logging
import replicate
from replicate.exceptions import ModelError

logger = logging.getLogger(__name__)


def extract_lyrics_whisperx(audio_url):
    """Run WhisperX on Replicate to get word-level timed lyrics with speaker diarization.
    Falls back to running without diarization if the diarization pipeline fails."""
    hf_token = os.getenv("HF_READ_TOKEN", "")

    try:
        output = replicate.run(
            "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
            input={
                "audio_file": audio_url,
                "batch_size": 16,
                "align_output": True,
                "diarization": True,
                "huggingface_access_token": hf_token,
                "min_speakers": 1,
                "max_speakers": 6,
            },
        )
        return output
    except ModelError as e:
        logger.warning("WhisperX failed with diarization enabled: %s. Retrying without diarization.", e)

    output = replicate.run(
        "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
        input={
            "audio_file": audio_url,
            "batch_size": 16,
            "align_output": True,
            "diarization": False,
        },
    )

    return output


def upload_audio_to_replicate(file_path):
    """Upload a local audio file to Replicate for processing."""
    with open(file_path, "rb") as f:
        file_obj = replicate.files.create(f)
    # File object has urls dict with 'get' key for the download URL
    return file_obj.urls.get("get", str(file_obj))


def split_audio_demucs(audio_url):
    """Run Demucs on Replicate to separate vocals from instrumental."""
    output = replicate.run(
        "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
        input={
            "audio": audio_url,
            "stem": "vocals",
        },
    )

    return output
