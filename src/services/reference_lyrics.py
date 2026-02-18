import os
import re

import requests


def _fetch_lrclib(title, artist):
    """Fetch lyrics from lrclib.net (free, no API key, no Cloudflare)."""
    try:
        resp = requests.get(
            "https://lrclib.net/api/search",
            params={"q": f"{title} {artist}"},
            timeout=10,
        )
        resp.raise_for_status()
        results = resp.json()
    except Exception as e:
        print(f"WARNING: lrclib search failed for '{title}' by '{artist}': {e}")
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


def _fetch_gemini(raw_text=None, vocals_path=None):
    """Use Gemini Flash to produce formatted lyric lines from ASR transcript + vocals audio.

    Falls back gracefully if the package is missing or GOOGLE_API_KEY is unset.

    Args:
        raw_text:    Plain-text WhisperX transcript (all words joined, may have errors).
        vocals_path: Path to the vocals .mp3 file for audio-grounded correction.

    Returns a list of lyric line strings, or None on failure.
    """
    if not raw_text and not vocals_path:
        return None

    try:
        import google.generativeai as genai
    except ImportError:
        print("WARNING: google-generativeai not installed — Gemini lyrics fallback unavailable")
        return None

    api_key = os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        print("WARNING: GOOGLE_API_KEY not set — Gemini lyrics fallback skipped")
        return None

    genai.configure(api_key=api_key)
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

    parts = []
    uploaded_file = None

    # Upload vocals audio via the Files API
    if vocals_path and os.path.exists(vocals_path):
        try:
            import time
            print(f"INFO: Uploading vocals to Gemini Files API ({os.path.basename(vocals_path)})…")
            uploaded_file = genai.upload_file(vocals_path, mime_type="audio/mpeg")
            # Poll until the file is ready
            while uploaded_file.state.name == "PROCESSING":
                time.sleep(2)
                uploaded_file = genai.get_file(uploaded_file.name)
            if uploaded_file.state.name != "ACTIVE":
                print(f"WARNING: Gemini file upload finished with state {uploaded_file.state.name!r}")
                uploaded_file = None
            else:
                parts.append(uploaded_file)
                print("INFO: Vocals uploaded to Gemini successfully")
        except Exception as e:
            print(f"WARNING: Gemini audio upload failed: {e}")
            uploaded_file = None

    # Build the text prompt
    prompt_parts = ["You are a lyrics transcription assistant."]
    if raw_text:
        prompt_parts.append(
            "Below is a rough automatic speech recognition (ASR) transcript of the song's "
            "vocals. It may contain errors, wrong words, or incorrect punctuation.\n\n"
            f"ASR transcript:\n{raw_text}"
        )
    if uploaded_file:
        prompt_parts.append(
            "I have also attached the isolated vocals audio track. "
            "Use it to verify and correct the transcript."
        )
    prompt_parts.append(
        "Output the correct, cleaned-up song lyrics formatted as one lyric line per text line. "
        "Do NOT include timestamps, line numbers, section labels (like [Chorus]), "
        "or any other formatting — just the lyric lines themselves. "
        "If a line repeats (e.g. a chorus), include it each time it is sung."
    )
    parts.append("\n\n".join(prompt_parts))

    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(parts)
        text = response.text.strip()
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        print(f"INFO: Gemini lyrics fallback produced {len(lines)} lines")
        return lines if lines else None
    except Exception as e:
        print(f"WARNING: Gemini generate_content failed: {e}")
        return None
    finally:
        if uploaded_file:
            try:
                genai.delete_file(uploaded_file.name)
            except Exception:
                pass


def fetch_lyrics(title, artist, vocals_path=None, raw_text=None):
    """Fetch lyrics from lrclib.net, with a Gemini Flash fallback.

    Returns a list of lyric line strings, or None if all sources fail.

    Args:
        title:       Song title.
        artist:      Artist name.
        vocals_path: Path to the vocals .mp3 (for Gemini fallback).
        raw_text:    WhisperX plain-text transcript (for Gemini fallback).
    """
    result = _fetch_lrclib(title, artist)
    if result:
        return result

    # lrclib returned nothing — try Gemini if we have something to work with
    if vocals_path or raw_text:
        print(f"INFO: lrclib found no lyrics for '{title}' by '{artist}', trying Gemini fallback")
        return _fetch_gemini(raw_text=raw_text, vocals_path=vocals_path)

    return None
