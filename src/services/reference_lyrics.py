"""External lyric references with identity checks and source provenance."""
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from urllib.parse import quote

import requests

MAX_LYRICS_CHARS = 50000
HEADERS = {"User-Agent": "MelodAI/1.0 (https://melodai.logge.top)"}


def normalize(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return " ".join(re.findall(r"[^\W_]+", "".join(c for c in text if not unicodedata.combining(c))))


def lyric_lines(text):
    if not isinstance(text, str) or len(text) > MAX_LYRICS_CHARS:
        return []
    lines = []
    for line in text.splitlines():
        line = re.sub(r"^(?:\[\d+:\d+(?:[.:]\d+)?\])+\s*", "", line).strip()
        if not line or re.fullmatch(r"\[.*\]", line):
            continue
        # lyrics.ovh sometimes prepends a French page heading.
        if line.startswith("Paroles de la chanson "):
            continue
        lines.append(line)
    return lines if any(normalize(line) for line in lines) and sum(len(line.split()) for line in lines) <= 3000 else []


def synced_times(synced, lines):
    """Start time (seconds) of each of ``lines`` from LRC ``synced`` text, or None when they do not correspond."""
    if not isinstance(synced, str) or not lines:
        return None
    times = []
    for raw in synced.splitlines():
        match = re.match(r"^\[(\d+):(\d+(?:[.:]\d+)?)\]", raw.strip())
        text = lyric_lines(raw)
        if not text:
            continue
        if match is None:
            return None
        times.append((int(match.group(1)) * 60 + float(match.group(2).replace(":", ".")), text[0]))
    if [text for _, text in times] != list(lines):
        return None
    return [round(t, 2) for t, _ in times]


def _json(url, **kwargs):
    response = requests.get(url, headers=HEADERS, timeout=(3, 8), **kwargs)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def _identity_matches(result, title, artist, duration):
    for key, wanted, threshold in (("trackName", title, 0.9), ("artistName", artist, 0.85)):
        actual = result.get(key)
        if not isinstance(actual, str) or SequenceMatcher(None, normalize(actual), normalize(wanted)).ratio() < threshold:
            return False
    actual_duration = result.get("duration")
    if duration and isinstance(actual_duration, (int, float)) and abs(actual_duration - duration) > max(8, duration * 0.05):
        return False
    return True


def _fetch_lrclib(title, artist, duration=None, album=None):
    params = {"track_name": title, "artist_name": artist}
    if album:
        params["album_name"] = album
    if duration:
        params["duration"] = duration
    result = _json("https://lrclib.net/api/get", params=params)
    candidates = [result] if isinstance(result, dict) and _identity_matches(result, title, artist, duration) and lyric_lines(result.get("plainLyrics") or result.get("syncedLyrics")) else []
    if not candidates:
        results = _json("https://lrclib.net/api/search", params={"track_name": title, "artist_name": artist})
        candidates = [r for r in results if isinstance(r, dict) and _identity_matches(r, title, artist, duration)] if isinstance(results, list) else []
    candidates.sort(key=lambda r: abs((r.get("duration") or 0) - (duration or 0)))
    for result in candidates:
        lines = lyric_lines(result.get("plainLyrics") or result.get("syncedLyrics"))
        if lines:
            candidate = {"source": "lrclib", "lines": lines, "record_id": result.get("id"), "identity_verified": True}
            times = synced_times(result.get("syncedLyrics"), lines)
            if times:  # line start times guide local forced alignment
                candidate["times"] = times
            return candidate
    return None


def _fetch_lyrics_ovh(title, artist, **_kwargs):
    result = _json(f"https://api.lyrics.ovh/v1/{quote(artist, safe='')}/{quote(title, safe='')}")
    lines = lyric_lines(result.get("lyrics")) if isinstance(result, dict) else []
    # This endpoint does not return song identity metadata. Keep that limitation
    # explicit; content is checked against the transcript before correction.
    return {"source": "lyrics.ovh", "lines": lines, "identity_verified": False} if lines else None


def text_similarity(left, right):
    a, b = normalize(" ".join(left)).split(), normalize(" ".join(right)).split()
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def select_reference(candidates, raw_text=None):
    """Prefer transcript agreement, then agreement across external sources."""
    if not candidates:
        return None
    def score(candidate):
        others = [other for other in candidates if other is not candidate]
        agreement = max((text_similarity(candidate["lines"], other["lines"]) for other in others), default=0)
        transcript = text_similarity(candidate["lines"], [raw_text]) if raw_text else 0
        return (transcript if raw_text else agreement, candidate.get("identity_verified", False))
    return max(candidates, key=score)


def fetch_references(title, artist, track_id=None, duration=None, album=None):
    from src.utils.error_logging import log_event
    candidates = []
    # Fetch both even when LRCLIB succeeds so disagreement remains inspectable.
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [(name, pool.submit(fetch, title, artist, duration=duration, album=album))
                   for name, fetch in (("lrclib", _fetch_lrclib), ("lyrics.ovh", _fetch_lyrics_ovh))]
        for name, future in futures:
            try:
                candidate = future.result()
                if candidate:
                    candidates.append(candidate)
            except Exception as error:
                # Avoid logging URLs or provider response bodies.
                log_event("WARNING", name, f"Lyrics lookup failed ({type(error).__name__})", track_id=track_id)
    selected = select_reference(candidates)
    return {"version": 2, "lines": selected["lines"] if selected else [],
            "source": selected["source"] if selected else None, "candidates": candidates}


def fetch_lyrics(title, artist, vocals_path=None, raw_text=None, track_id=None):
    """Compatibility wrapper; generated text is never an external reference."""
    references = fetch_references(title, artist, track_id=track_id)
    selected = select_reference(references["candidates"], raw_text)
    return selected["lines"] if selected else None
