import os
import json
import logging
import replicate
from difflib import SequenceMatcher
from replicate.exceptions import ModelError

logger = logging.getLogger(__name__)


def _extract_text(output):
    """Concatenate all word tokens from WhisperX output into a single string."""
    if not isinstance(output, dict):
        return ""
    words = []
    for seg in output.get("segments", []):
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if text:
                words.append(text)
    return " ".join(words)


def _is_bad_output(output, reference_lines=None):
    """Detect if transcription output is broken (character-level or wrong content).

    Checks two things:
    1. Character-level tokenization (>50% single-char 'words')
    2. If reference lyrics provided, low text similarity to reference
    """
    if not isinstance(output, dict):
        return False
    segments = output.get("segments", [])
    total = 0
    single = 0
    for seg in segments:
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if text:
                total += 1
                if len(text) <= 1:
                    single += 1

    # Character-level check
    if total > 10 and single / total > 0.5:
        logger.warning("Character-level tokenization detected (%d/%d single-char words)", single, total)
        return True

    # Cross-check against reference lyrics (lrclib)
    if reference_lines and total > 10:
        asr_text = _extract_text(output).lower()
        ref_text = " ".join(reference_lines).lower()
        similarity = SequenceMatcher(None, asr_text, ref_text).ratio()
        if similarity < 0.3:
            logger.warning("Transcription doesn't match reference lyrics (similarity: %.2f)", similarity)
            return True

    return False


def _run_whisperx(audio_url, diarization=True):
    """Single WhisperX call with optional diarization."""
    hf_token = os.getenv("HF_READ_TOKEN", "")
    params = {
        "audio_file": audio_url,
        "batch_size": 16,
        "align_output": True,
        "diarization": diarization,
    }
    if diarization:
        params["huggingface_access_token"] = hf_token
        params["min_speakers"] = 1
        params["max_speakers"] = 6
    return replicate.run(
        "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
        input=params,
    )


def _run_voxtral(file_path):
    """Run Voxtral on Mistral API for word-level transcription.

    Returns output in WhisperX-compatible format (segments with words).
    """
    import requests

    api_key = os.getenv("MISTRAL_API_KEY", "")
    if not api_key:
        raise RuntimeError("MISTRAL_API_KEY not set")

    with open(file_path, "rb") as f:
        resp = requests.post(
            "https://api.mistral.ai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": ("audio.mp3", f, "audio/mpeg")},
            data={"model": "voxtral-mini-2602", "timestamp_granularities": "word"},
            timeout=120,
        )
    resp.raise_for_status()
    data = resp.json()

    # Convert Voxtral format (each segment = one word) to WhisperX format
    # (segments containing word lists)
    voxtral_segs = data.get("segments", [])
    if not voxtral_segs:
        return {"segments": []}

    # Group words into lines using timing gaps
    lines = []
    current_words = []
    for seg in voxtral_segs:
        word_text = seg.get("text", "").strip()
        if not word_text:
            continue
        word_dict = {
            "word": word_text,
            "start": seg.get("start", 0),
            "end": seg.get("end", 0),
            "speaker": "SPEAKER_00",
            "score": 0.95,
        }
        # Start new line on large gap (>1.5s)
        if current_words:
            gap = word_dict["start"] - current_words[-1]["end"]
            if gap > 1.5:
                lines.append(current_words)
                current_words = []
        current_words.append(word_dict)

    if current_words:
        lines.append(current_words)

    # Build WhisperX-compatible segments
    segments = []
    for words in lines:
        segments.append({
            "start": words[0]["start"],
            "end": words[-1]["end"],
            "words": words,
            "speaker": "SPEAKER_00",
        })

    return {"segments": segments}


def extract_lyrics_whisperx(audio_url, max_retries=2, reference_lines=None,
                            vocals_path=None):
    """Run WhisperX on Replicate to get word-level timed lyrics.

    Falls back to Voxtral (Mistral) if WhisperX output is broken after retries.
    """
    # Try with diarization first
    try:
        output = _run_whisperx(audio_url, diarization=True)
    except ModelError as e:
        logger.warning("WhisperX failed with diarization: %s. Retrying without.", e)
        output = _run_whisperx(audio_url, diarization=False)

    # Retry if output looks broken
    for attempt in range(max_retries):
        if not _is_bad_output(output, reference_lines):
            return output
        logger.warning(
            "WhisperX output looks broken (attempt %d/%d), retrying...",
            attempt + 1, max_retries,
        )
        try:
            output = _run_whisperx(audio_url, diarization=True)
        except ModelError:
            output = _run_whisperx(audio_url, diarization=False)

    # Fall back to Voxtral if WhisperX still broken
    if _is_bad_output(output, reference_lines) and vocals_path:
        mistral_key = os.getenv("MISTRAL_API_KEY", "")
        if mistral_key:
            logger.warning("WhisperX broken after %d retries, falling back to Voxtral", max_retries)
            try:
                output = _run_voxtral(vocals_path)
                if not _is_bad_output(output, reference_lines):
                    logger.info("Voxtral fallback succeeded")
                    return output
                logger.warning("Voxtral output also looks bad")
            except Exception as e:
                logger.warning("Voxtral fallback failed: %s", e)
        else:
            logger.warning("WhisperX broken, no MISTRAL_API_KEY for Voxtral fallback")

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
