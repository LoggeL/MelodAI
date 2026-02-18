import base64
import os

import requests


def _fetch_lrclib(title, artist, track_id=None):
    """Fetch lyrics from lrclib.net (free, no API key, no Cloudflare)."""
    from src.utils.error_logging import log_event
    try:
        resp = requests.get(
            "https://lrclib.net/api/search",
            params={"q": f"{title} {artist}"},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
    except Exception as e:
        log_event("WARNING", "lrclib", f"lrclib search failed for '{title}' by '{artist}': {e}", track_id=track_id)
        return None

    if not results:
        return None

    # Use the first result with plain lyrics
    for result in results:
        plain = result.get("plainLyrics", "")
        if plain:
            lines = [l.strip() for l in plain.split("\n") if l.strip()]
            if lines:
                return lines

    return None


def _fetch_openrouter(raw_text=None, vocals_path=None, track_id=None):
    """Use Gemini Flash via OpenRouter to produce formatted lyric lines.

    Sends the WhisperX plain-text transcript and, optionally, the isolated
    vocals audio (base64-encoded) so Gemini can correct transcription errors
    and group words into proper lyric lines.

    Falls back to text-only if the audio payload is rejected by the API.

    Returns a list of lyric line strings, or None on failure.
    """
    from src.utils.error_logging import log_event
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        log_event("WARNING", "openrouter", "OPENROUTER_API_KEY not set — Gemini lyrics fallback skipped", track_id=track_id)
        return None

    if not raw_text and not vocals_path:
        return None

    model = os.getenv("LYRICS_GEMINI_MODEL", "google/gemini-3-flash-preview")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://melodai.logge.top",
        "X-Title": "MelodAI",
        "Content-Type": "application/json",
    }

    # Build the text prompt once — shared across both attempts
    prompt_parts = ["You are a lyrics transcription assistant."]
    if raw_text:
        prompt_parts.append(
            "Below is a rough automatic speech recognition (ASR) transcript of the "
            "song's vocals. It may contain errors, wrong words, or broken punctuation.\n\n"
            f"ASR transcript:\n{raw_text}"
        )
    if vocals_path and os.path.exists(vocals_path):
        prompt_parts.append(
            "I have also attached the isolated vocals audio track. "
            "Use it to verify and correct the transcript."
        )
    prompt_parts.append(
        "Output the correct, cleaned-up song lyrics formatted as one lyric line per "
        "text line. Do NOT include timestamps, line numbers, or section labels like "
        "[Chorus] — just the lyric lines themselves. "
        "If a line repeats (e.g. a chorus), include it each time it is sung."
    )
    prompt = "\n\n".join(prompt_parts)

    # Try hybrid (audio + text) first, then fall back to text-only
    attempts = []
    if vocals_path and os.path.exists(vocals_path):
        attempts.append("hybrid")
    attempts.append("text_only")

    for attempt in attempts:
        if attempt == "hybrid":
            try:
                with open(vocals_path, "rb") as f:
                    audio_b64 = base64.b64encode(f.read()).decode()
                content = [
                    {"type": "text", "text": prompt},
                    {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "mp3"}},
                ]
            except Exception as e:
                log_event("WARNING", "openrouter", f"Audio encoding for OpenRouter failed: {e}", track_id=track_id)
                continue
        else:
            content = prompt  # plain string — OpenRouter accepts both forms

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 2048,
        }

        try:
            resp = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise RuntimeError(data["error"])
            text = data["choices"][0]["message"]["content"].strip()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            log_event("INFO", "openrouter", f"Gemini fallback produced {len(lines)} lines (attempt={attempt})", track_id=track_id)
            return lines if lines else None
        except Exception as e:
            if attempt == "hybrid":
                log_event("WARNING", "openrouter", f"OpenRouter hybrid attempt failed, retrying text-only: {e}", track_id=track_id)
                continue
            log_event("ERROR", "openrouter", f"OpenRouter Gemini lyrics fallback failed: {e}", track_id=track_id)
            return None

    return None


def fetch_lyrics(title, artist, vocals_path=None, raw_text=None, track_id=None):
    """Fetch lyrics from lrclib.net, with an OpenRouter Gemini Flash fallback.

    Returns a list of lyric line strings, or None if all sources fail.

    Args:
        title:       Song title.
        artist:      Artist name.
        vocals_path: Path to the vocals .mp3 (used in Gemini fallback).
        raw_text:    WhisperX plain-text transcript (used in Gemini fallback).
        track_id:    Track ID for log correlation.
    """
    from src.utils.error_logging import log_event
    result = _fetch_lrclib(title, artist, track_id=track_id)
    if result:
        return result

    # lrclib returned nothing — fall back to OpenRouter/Gemini
    if vocals_path or raw_text:
        log_event("INFO", "lrclib", f"lrclib found no lyrics for '{title}' by '{artist}', trying Gemini fallback", track_id=track_id)
        return _fetch_openrouter(raw_text=raw_text, vocals_path=vocals_path, track_id=track_id)

    return None
