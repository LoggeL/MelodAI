import json
import os
import re
from typing import Any

import requests


SUPPORTED_TRANSLATION_LANGUAGES = {
    "de": "German",
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
}

VISIBLE_TRANSLATION_LANGUAGES = {"de", "en"}


def normalize_language(value: str | None) -> str:
    code = (value or "").strip().lower().split("-")[0]
    if code not in SUPPORTED_TRANSLATION_LANGUAGES:
        raise ValueError("unsupported_language")
    return code


def extract_lyric_lines(lyrics: dict[str, Any]) -> list[str]:
    """Return one display line per lyric segment, preserving UI line order."""
    if not lyrics:
        return []

    plain = lyrics.get("plain_lyrics")
    if lyrics.get("untimed") and isinstance(plain, list):
        return [str(line).strip() for line in plain if str(line).strip()]

    lines: list[str] = []
    for segment in lyrics.get("segments") or []:
        words = []
        for word in segment.get("words") or []:
            text = str(word.get("word") or "").strip()
            if text:
                words.append(text)
        line = " ".join(words).strip()
        if line:
            lines.append(line)
    return lines


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def translate_lines(lines: list[str], target_language: str, *, track_id: str | None = None) -> dict[str, Any]:
    """Translate lyrics line-by-line through the configured OpenRouter LLM endpoint."""
    from src.utils.error_logging import log_event

    target_language = normalize_language(target_language)
    target_label = SUPPORTED_TRANSLATION_LANGUAGES[target_language]

    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    if not lines:
        raise ValueError("no_lyrics")

    model = os.getenv("LYRICS_TRANSLATION_MODEL", os.getenv("LYRICS_GEMINI_MODEL", "google/gemini-3-flash-preview"))

    prompt = {
        "task": "Translate song lyrics line-by-line for live karaoke reading.",
        "target_language": target_language,
        "target_language_name": target_label,
        "rules": [
            "Preserve the exact number of lines and line order.",
            "Translate meaning, mood, idioms, imagery, and emotional tone; do not be literal if it sounds wooden.",
            "Keep each translated line reasonably concise so it can be read while listening.",
            "Do not add commentary, section labels, timestamps, or markdown.",
            "If a line is already in the target language, keep it natural and lightly normalize only if needed.",
        ],
        "output_schema": {
            "source_language": "ISO 639-1 code if clear, otherwise auto",
            "target_language": target_language,
            "lines": [
                {"index": 0, "original": "original lyric line", "translation": "translated line"}
            ],
        },
        "lyrics": [{"index": idx, "text": line} for idx, line in enumerate(lines)],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "https://melodai.logge.top",
        "X-Title": "MelodAI",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You translate lyrics for a karaoke app. Reply with valid JSON only."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.35,
        "max_tokens": min(6000, max(1200, len(lines) * 80)),
    }

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

    content = data["choices"][0]["message"]["content"]
    parsed = _parse_json_object(content)
    translated = parsed.get("lines") or []
    by_index: dict[int, dict[str, Any]] = {}
    for item in translated:
        try:
            idx = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(lines):
            by_index[idx] = {
                "index": idx,
                "original": str(item.get("original") or lines[idx]),
                "translation": str(item.get("translation") or "").strip(),
            }

    aligned = []
    for idx, original in enumerate(lines):
        item = by_index.get(idx, {})
        aligned.append({
            "index": idx,
            "original": original,
            "translation": item.get("translation") or original,
        })

    log_event("INFO", "lyrics_translation", f"Translated {len(aligned)} lyric lines to {target_language} using {model}", track_id=track_id)
    return {
        "source_language": str(parsed.get("source_language") or "auto").lower(),
        "target_language": target_language,
        "model": model,
        "lines": aligned,
    }
