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


def fetch_lyrics(title, artist):
    """Fetch lyrics from lrclib.net.

    Returns a list of lyric lines (strings), or None if not found.
    """
    return _fetch_lrclib(title, artist)
