"""Deezer catalog search with song durations.

`deezer.deezer_search` drops the duration that the public search API returns. The player shows durations in
search results, so this module asks the same endpoint and keeps it. `deezer.py` itself stays untouched.
"""

import requests

SEARCH_URL = "https://api.deezer.com/search/track"


def _http():
    from src.services import deezer
    return deezer.session or requests


def search_tracks(query):
    """Search Deezer tracks. Returns the fields of `deezer_search(q, TYPE_TRACK)` plus `duration` (seconds)."""
    from src.services.deezer import DeezerApiException, TYPE_TRACK
    try:
        response = _http().get(SEARCH_URL, params={"q": query}, timeout=15)
        response.raise_for_status()
        items = response.json()["data"]
    except (requests.exceptions.RequestException, KeyError, TypeError, ValueError) as e:
        raise DeezerApiException(f"Could not search for track '{query}': {e}") from e
    results = []
    for item in items if isinstance(items, list) else []:
        try:
            album = item.get("album") or {}
            duration = item.get("duration")
            results.append({
                "id": str(item["id"]),
                "id_type": TYPE_TRACK,
                "title": item["title"],
                "img_url": album.get("cover_small") or "",
                "album": album.get("title") or "",
                "album_id": album.get("id"),
                "artist": (item.get("artist") or {}).get("name") or "",
                "preview_url": item.get("preview") or "",
                "duration": int(duration) if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration > 0 else 0,
            })
        except (KeyError, TypeError, AttributeError):
            continue  # skip malformed rows instead of failing the whole search
    return results
