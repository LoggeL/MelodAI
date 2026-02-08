import os
import re
import lyricsgenius


def _get_client():
    """Create a lyricsgenius client using the GENIUS_BEARER_TOKEN env var."""
    token = os.getenv("GENIUS_BEARER_TOKEN", "")
    if not token:
        return None
    client = lyricsgenius.Genius(token, verbose=False, remove_section_headers=True)
    client.timeout = 10
    client.retries = 2
    return client


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


def fetch_lyrics(title, artist):
    """Search Genius for a song and return cleaned lyrics lines.

    Returns a list of lyric lines (strings), or None if not found.
    """
    client = _get_client()
    if not client:
        print("WARNING: GENIUS_BEARER_TOKEN not set, skipping lyrics fetch")
        return None

    try:
        song = client.search_song(title, artist)
        # Fallback: search with title only if artist-specific search fails
        if not song and artist:
            song = client.search_song(title)
    except Exception as e:
        print(f"WARNING: Genius search failed for '{title}' by '{artist}': {e}")
        return None

    if not song or not song.lyrics:
        return None

    return _clean_lyrics(song.lyrics)
