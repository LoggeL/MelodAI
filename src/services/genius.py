import os
import re

import requests


def _get_token():
    token = os.getenv("GENIUS_BEARER_TOKEN", "")
    return token or None


def _clean_lyrics(raw_lyrics):
    """Clean raw Genius lyrics text into a plain list of lines.

    Removes the trailing 'NNNEmbed' suffix, contributor counts,
    and any remaining section headers like [Chorus].
    """
    if not raw_lyrics:
        return []

    text = raw_lyrics.strip()

    # Remove trailing "123Embed" or "Embed" that Genius appends
    text = re.sub(r"\d*Embed$", "", text).strip()

    # Remove "You might also like" injected by Genius
    text = text.replace("You might also like", "")

    # Split into lines and filter
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # Skip section headers like [Chorus], [Verse 1], etc.
        if re.match(r"^\[.*\]$", line):
            continue
        lines.append(line)

    return lines


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


def _scrape_genius(title, artist):
    """Search Genius API and scrape lyrics from the song page."""
    token = _get_token()
    if not token:
        return None

    # Search via Genius API
    try:
        resp = requests.get(
            "https://api.genius.com/search",
            params={"q": f"{title} {artist}"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        hits = resp.json().get("response", {}).get("hits", [])
    except Exception as e:
        print(f"WARNING: Genius API search failed for '{title}' by '{artist}': {e}")
        return None

    if not hits:
        return None

    song_url = hits[0].get("result", {}).get("url")
    if not song_url:
        return None

    # Scrape lyrics page
    try:
        from bs4 import BeautifulSoup

        resp = requests.get(
            song_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            },
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        containers = soup.select("div[data-lyrics-container='true']")
        if not containers:
            return None

        parts = []
        for container in containers:
            for br in container.find_all("br"):
                br.replace_with("\n")
            parts.append(container.get_text())

        raw = "\n".join(parts)
        return _clean_lyrics(raw) if raw else None
    except Exception as e:
        print(f"WARNING: Genius lyrics scrape failed for {song_url}: {e}")
        return None


def fetch_lyrics(title, artist):
    """Fetch lyrics, trying lrclib.net first, then Genius scraping.

    Returns a list of lyric lines (strings), or None if not found.
    """
    # Try lrclib first (free, no auth, no Cloudflare issues)
    lines = _fetch_lrclib(title, artist)
    if lines:
        return lines

<<<<<<< HEAD
    try:
        song = client.search_song(title, artist)
        # Fallback: search with title only if artist-specific search fails
        if not song and artist:
            song = client.search_song(title)
    except Exception as e:
        print(f"WARNING: Genius search failed for '{title}' by '{artist}': {e}")
        return None
=======
    # Fall back to Genius scraping
    lines = _scrape_genius(title, artist)
    if lines:
        return lines
>>>>>>> 9f9af69f (Use lrclib.net with Genius API fallback for lyrics fetching)

    return None
