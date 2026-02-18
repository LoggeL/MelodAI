import os
import json
import random
import threading
import time
import traceback
import requests
from datetime import datetime
from flask import Blueprint, request, jsonify, session

from src.utils.decorators import login_required
from src.utils.constants import STATUS_METADATA, STATUS_DOWNLOADING, STATUS_SPLITTING, STATUS_LYRICS, STATUS_PROCESSING, STATUS_COMPLETE, STATUS_ERROR, PROGRESS

# Simple TTL cache for Deezer search results
_search_cache: dict[str, tuple[float, list]] = {}
_SEARCH_CACHE_TTL = 300  # 5 minutes
from src.utils.file_handling import (
    get_song_dir, load_metadata, save_metadata, load_lyrics,
    save_lyrics, save_lyrics_raw, track_file_exists, get_track_file_path,
    is_track_complete, get_all_track_ids, SONGS_PATH, compress_audio_file,
)
from src.utils.status_checks import set_processing_status, get_processing_status, remove_from_queue

track_bp = Blueprint("track", __name__, url_prefix="/api")


def _upgrade_cover_url(url: str) -> str:
    """Replace Deezer cover_small (56x56) with 200x200."""
    if not url:
        return url
    return url.replace("/56x56", "/200x200", 1)


@track_bp.route("/search")
@login_required
def search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])

    # Check cache
    cache_key = q.lower()
    if cache_key in _search_cache:
        cached_time, cached_results = _search_cache[cache_key]
        if time.time() - cached_time < _SEARCH_CACHE_TTL:
            _log_usage("search", q)
            return jsonify(cached_results)

    from src.services.deezer import deezer_search, TYPE_TRACK
    try:
        results = deezer_search(q, TYPE_TRACK)
    except Exception as e:
        from src.utils.error_logging import log_api_error
        log_api_error(str(e), traceback.format_exc(), source="/search")
        return jsonify({"error": str(e)}), 500

    # Upgrade cover images from 56x56 to 500x500
    for r in results:
        if "img_url" in r:
            r["img_url"] = _upgrade_cover_url(r["img_url"])

    # Store in cache
    _search_cache[cache_key] = (time.time(), results)

    _log_usage("search", q)
    return jsonify(results)


@track_bp.route("/add")
@login_required
def add():
    track_id = request.args.get("id", "").strip()
    if not track_id:
        return jsonify({"error": "Track ID required"}), 400

    # Check if already in queue
    status = get_processing_status(track_id)
    if status and status["status"] not in (STATUS_COMPLETE, STATUS_ERROR):
        return jsonify({"status": "already_processing", "progress": status["progress"]})

    # Check if already complete (no credit cost for existing songs)
    if is_track_complete(track_id):
        meta = load_metadata(track_id)
        if meta and "img_url" in meta:
            meta["img_url"] = _upgrade_cover_url(meta["img_url"])
        return jsonify({
            "status": "ready",
            "progress": 100,
            "metadata": meta,
        })

    # Credit check for new processing (5 credits)
    from src.utils.decorators import _get_current_user
    from src.models.db import query_db as _qdb, execute_db as _edb
    user = _get_current_user()
    if user and not user["is_admin"]:
        credits = user["credits"] or 0
        if credits < 5:
            return jsonify({"error": "insufficient_credits", "credits": credits, "required": 5}), 403
        _edb("UPDATE users SET credits = credits - 5 WHERE id = ?", [user["id"]])

    _log_usage("download", track_id)

    from src.utils.error_logging import log_event
    username = user["username"] if user else "unknown"
    log_event("info", "pipeline", f"Processing started for track {track_id}", user_id=user["id"] if user else None, username=username, track_id=str(track_id))

    # Start processing in background
    from flask import current_app
    app = current_app._get_current_object()

    set_processing_status(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Getting song info...")

    t = threading.Thread(target=process_track, args=(track_id, app), daemon=True)
    t.start()

    # Return updated credits for non-admin users
    updated_credits = None
    if user and not user["is_admin"]:
        refreshed = _qdb("SELECT credits FROM users WHERE id = ?", [user["id"]], one=True)
        updated_credits = refreshed["credits"] if refreshed else 0

    resp = {"status": "processing", "progress": 0}
    if updated_credits is not None:
        resp["credits"] = updated_credits
    return jsonify(resp)


@track_bp.route("/track/<track_id>")
@login_required
def track_info(track_id):
    meta = load_metadata(track_id)
    if not meta:
        return jsonify({"error": "Track not found"}), 404

    status = get_processing_status(track_id)
    complete = is_track_complete(track_id)

    if "img_url" in meta:
        meta["img_url"] = _upgrade_cover_url(meta["img_url"])

    return jsonify({
        "metadata": meta,
        "complete": complete,
        "status": status,
    })


@track_bp.route("/track/<track_id>/lyrics")
@login_required
def track_lyrics(track_id):
    lyrics = load_lyrics(track_id)
    if not lyrics:
        return jsonify({"error": "Lyrics not found"}), 404
    return jsonify(lyrics)


@track_bp.route("/track/library")
@login_required
def library():
    track_ids = get_all_track_ids()
    tracks = []
    for tid in track_ids:
        meta = load_metadata(tid)
        if meta:
            tracks.append({
                "id": tid,
                "title": meta.get("title", "Unknown"),
                "artist": meta.get("artist", "Unknown"),
                "album": meta.get("album", ""),
                "duration": meta.get("duration", 0),
                "img_url": _upgrade_cover_url(meta.get("img_url", "")),
                "complete": is_track_complete(tid),
            })
    return jsonify(tracks)


@track_bp.route("/track/status")
@login_required
def status():
    track_id = request.args.get("id")
    if track_id:
        s = get_processing_status(track_id)
        if not s:
            if is_track_complete(track_id):
                return jsonify({"status": STATUS_COMPLETE, "progress": 100})
            return jsonify({"status": "unknown", "progress": 0})
        return jsonify(s)
    return jsonify(get_processing_status())


@track_bp.route("/track/<track_id>/lyrics", methods=["PUT"])
@login_required
def update_lyrics(track_id):
    """Update a single word in the lyrics."""
    data = request.get_json()
    seg_idx = data.get("segmentIndex")
    word_idx = data.get("wordIndex")
    new_word = data.get("word", "").strip()

    if seg_idx is None or word_idx is None or not new_word:
        return jsonify({"error": "segmentIndex, wordIndex, and word required"}), 400

    lyrics = load_lyrics(track_id)
    if not lyrics:
        return jsonify({"error": "Lyrics not found"}), 404

    segments = lyrics.get("segments", [])
    if seg_idx < 0 or seg_idx >= len(segments):
        return jsonify({"error": "Invalid segment index"}), 400

    words = segments[seg_idx].get("words", [])
    if word_idx < 0 or word_idx >= len(words):
        return jsonify({"error": "Invalid word index"}), 400

    words[word_idx]["word"] = new_word
    save_lyrics(track_id, lyrics)
    return jsonify({"success": True})


@track_bp.route("/favorites", methods=["GET"])
@login_required
def get_favorites():
    from src.models.db import query_db
    user_id = session.get("user_id")
    rows = query_db("SELECT track_id FROM favorites WHERE user_id = ?", [user_id])
    return jsonify([r["track_id"] for r in rows])


@track_bp.route("/favorites/<track_id>", methods=["POST"])
@login_required
def add_favorite(track_id):
    from src.models.db import query_db, insert_db
    user_id = session.get("user_id")
    existing = query_db("SELECT id FROM favorites WHERE user_id = ? AND track_id = ?", [user_id, str(track_id)], one=True)
    if not existing:
        insert_db("INSERT INTO favorites (user_id, track_id) VALUES (?, ?)", [user_id, str(track_id)])
    return jsonify({"success": True})


@track_bp.route("/favorites/<track_id>", methods=["DELETE"])
@login_required
def remove_favorite(track_id):
    from src.models.db import execute_db
    user_id = session.get("user_id")
    execute_db("DELETE FROM favorites WHERE user_id = ? AND track_id = ?", [user_id, str(track_id)])
    return jsonify({"success": True})


@track_bp.route("/play/<track_id>")
@login_required
def log_play(track_id):
    _log_usage("play", track_id)
    return jsonify({"success": True})


@track_bp.route("/play/<track_id>/credit", methods=["POST"])
@login_required
def play_credit(track_id):
    """Deduct 1 credit for playing a song (after 15s). Admins are exempt."""
    from src.utils.decorators import _get_current_user
    from src.models.db import query_db, execute_db
    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    if user["is_admin"]:
        return jsonify({"success": True, "credits": user["credits"] or 0})

    credits = user["credits"] or 0
    if credits < 1:
        return jsonify({"error": "insufficient_credits", "credits": credits}), 403

    execute_db("UPDATE users SET credits = credits - 1 WHERE id = ?", [user["id"]])
    refreshed = query_db("SELECT credits FROM users WHERE id = ?", [user["id"]], one=True)
    updated = refreshed["credits"] if refreshed else 0
    return jsonify({"success": True, "credits": updated})


@track_bp.route("/random")
@login_required
def random_track():
    track_ids = get_all_track_ids()
    complete_ids = [tid for tid in track_ids if is_track_complete(tid)]
    if not complete_ids:
        return jsonify({"error": "No songs available"}), 404

    exclude = request.args.get("exclude", "").split(",")
    available = [tid for tid in complete_ids if tid not in exclude]
    if not available:
        available = complete_ids

    chosen = random.choice(available)
    meta = load_metadata(chosen)
    if meta and "img_url" in meta:
        meta["img_url"] = _upgrade_cover_url(meta["img_url"])
    return jsonify({"id": chosen, "metadata": meta})


# ─── Playlists ───

@track_bp.route("/playlists", methods=["GET"])
@login_required
def list_playlists():
    from src.models.db import query_db
    user_id = session.get("user_id")
    playlists = query_db("SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC", [user_id])
    result = []
    for p in playlists:
        track_count = query_db("SELECT COUNT(*) as c FROM playlist_tracks WHERE playlist_id = ?", [p["id"]], one=True)
        result.append({
            "id": p["id"],
            "name": p["name"],
            "track_count": track_count["c"] if track_count else 0,
            "created_at": p["created_at"],
        })
    return jsonify(result)


@track_bp.route("/playlists", methods=["POST"])
@login_required
def create_playlist():
    from src.models.db import insert_db
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    user_id = session.get("user_id")
    pid = insert_db("INSERT INTO playlists (user_id, name) VALUES (?, ?)", [user_id, name])
    return jsonify({"id": pid, "name": name})


@track_bp.route("/playlists/<int:playlist_id>", methods=["DELETE"])
@login_required
def delete_playlist(playlist_id):
    from src.models.db import execute_db, query_db
    user_id = session.get("user_id")
    pl = query_db("SELECT id FROM playlists WHERE id = ? AND user_id = ?", [playlist_id, user_id], one=True)
    if not pl:
        return jsonify({"error": "Not found"}), 404
    execute_db("DELETE FROM playlist_tracks WHERE playlist_id = ?", [playlist_id])
    execute_db("DELETE FROM playlists WHERE id = ?", [playlist_id])
    return jsonify({"success": True})


@track_bp.route("/playlists/<int:playlist_id>/tracks", methods=["GET"])
@login_required
def get_playlist_tracks(playlist_id):
    from src.models.db import query_db
    user_id = session.get("user_id")
    pl = query_db("SELECT id FROM playlists WHERE id = ? AND user_id = ?", [playlist_id, user_id], one=True)
    if not pl:
        return jsonify({"error": "Not found"}), 404
    rows = query_db(
        "SELECT track_id, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
        [playlist_id],
    )
    tracks = []
    for r in rows:
        meta = load_metadata(r["track_id"])
        if meta:
            tracks.append({
                "id": r["track_id"],
                "title": meta.get("title", "Unknown"),
                "artist": meta.get("artist", "Unknown"),
                "album": meta.get("album", ""),
                "duration": meta.get("duration", 0),
                "img_url": _upgrade_cover_url(meta.get("img_url", "")),
                "complete": is_track_complete(r["track_id"]),
                "position": r["position"],
            })
    return jsonify(tracks)


@track_bp.route("/playlists/<int:playlist_id>/tracks", methods=["POST"])
@login_required
def add_to_playlist(playlist_id):
    from src.models.db import query_db, insert_db
    user_id = session.get("user_id")
    pl = query_db("SELECT id FROM playlists WHERE id = ? AND user_id = ?", [playlist_id, user_id], one=True)
    if not pl:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json()
    track_id = data.get("track_id", "").strip()
    if not track_id:
        return jsonify({"error": "track_id required"}), 400
    # Get next position
    last = query_db("SELECT MAX(position) as p FROM playlist_tracks WHERE playlist_id = ?", [playlist_id], one=True)
    pos = (last["p"] or 0) + 1
    try:
        insert_db("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)", [playlist_id, track_id, pos])
    except Exception:
        return jsonify({"error": "Track already in playlist"}), 409
    return jsonify({"success": True})


@track_bp.route("/playlists/<int:playlist_id>/tracks/<track_id>", methods=["DELETE"])
@login_required
def remove_from_playlist(playlist_id, track_id):
    from src.models.db import execute_db, query_db
    user_id = session.get("user_id")
    pl = query_db("SELECT id FROM playlists WHERE id = ? AND user_id = ?", [playlist_id, user_id], one=True)
    if not pl:
        return jsonify({"error": "Not found"}), 404
    execute_db("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", [playlist_id, track_id])
    return jsonify({"success": True})


@track_bp.route("/credits")
@login_required
def get_credits():
    from src.utils.decorators import _get_current_user
    user = _get_current_user()
    return jsonify({"credits": user["credits"] or 0 if user else 0})


def process_track(track_id, app):
    """6-stage processing pipeline. Runs in a background thread."""
    from src.utils.error_logging import log_pipeline_error

    stages = [
        ("metadata", _stage_metadata),
        ("download", _stage_download),
        ("splitting", _stage_split),
        ("lyrics", _stage_lyrics),
        ("processing", _stage_process_lyrics),
        ("complete", _stage_complete),
    ]

    with app.app_context():
        for stage_name, stage_fn in stages:
            try:
                stage_fn(track_id)
            except Exception as e:
                tb = traceback.format_exc()
                print(f"ERROR processing track {track_id} at stage '{stage_name}': {e}")
                set_processing_status(track_id, STATUS_ERROR, 0, str(e))
                _record_failure(track_id, stage_name, str(e))
                log_pipeline_error(track_id, stage_name, str(e), tb)
                return


def _stage_metadata(track_id):
    """Stage 1: Fetch metadata from Deezer (0-10%)"""
    if track_file_exists(track_id, "metadata"):
        set_processing_status(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Song info ready")
        return

    set_processing_status(track_id, STATUS_METADATA, 2, "Getting song info...")

    from src.services.deezer import get_song_infos_from_deezer_website, TYPE_TRACK, get_picture_link
    song = get_song_infos_from_deezer_website(TYPE_TRACK, track_id)

    metadata = {
        "id": track_id,
        "title": song.get("SNG_TITLE", "Unknown"),
        "artist": song.get("ART_NAME", "Unknown"),
        "album": song.get("ALB_TITLE", "Unknown"),
        "duration": int(song.get("DURATION", 0)),
        "img_url": get_picture_link(song.get("ALB_PICTURE", "")),
        "deezer_data": song,
    }
    save_metadata(track_id, metadata)
    set_processing_status(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Song info ready")


def _stage_download(track_id):
    """Stage 2: Download + decrypt from Deezer (10-20%)"""
    if track_file_exists(track_id, "song"):
        set_processing_status(track_id, STATUS_DOWNLOADING, PROGRESS[STATUS_DOWNLOADING], "Song downloaded")
        return

    set_processing_status(track_id, STATUS_DOWNLOADING, 12, "Downloading song...")

    meta = load_metadata(track_id)
    song_data = meta.get("deezer_data", {})
    output_path = get_track_file_path(track_id, "song")

    from src.services.deezer import download_song
    download_song(song_data, output_path)

    set_processing_status(track_id, STATUS_DOWNLOADING, PROGRESS[STATUS_DOWNLOADING], "Song downloaded")


def _stage_split(track_id):
    """Stage 3: Split vocals/instrumental via Demucs on Replicate (20-50%)"""
    if track_file_exists(track_id, "vocals") and track_file_exists(track_id, "no_vocals"):
        set_processing_status(track_id, STATUS_SPLITTING, PROGRESS[STATUS_SPLITTING], "Vocals separated")
        return

    set_processing_status(track_id, STATUS_SPLITTING, 25, "Preparing audio...")

    from src.services.lyrics import upload_audio_to_replicate, split_audio_demucs

    song_path = get_track_file_path(track_id, "song")
    audio_url = upload_audio_to_replicate(song_path)

    set_processing_status(track_id, STATUS_SPLITTING, 30, "Separating vocals...")

    output = split_audio_demucs(audio_url)

    set_processing_status(track_id, STATUS_SPLITTING, 45, "Saving vocal tracks...")

    print(f"Demucs output type: {type(output)}, repr: {repr(output)}")

    # Demucs with stem="vocals" returns a FileOutput or dict with vocals/other URLs
    vocals_url = None
    no_vocals_url = None

    if isinstance(output, dict):
        vocals_url = str(output.get("vocals", ""))
        no_vocals_url = str(output.get("other", "") or output.get("no_vocals", "") or output.get("accompaniment", ""))
    elif isinstance(output, (list, tuple)) and len(output) >= 1:
        # Some Replicate models return a list of URLs
        vocals_url = str(output[0])
        if len(output) >= 2:
            no_vocals_url = str(output[1])
    elif hasattr(output, 'vocals'):
        vocals_url = str(output.vocals)
        no_vocals_url = str(getattr(output, 'other', '') or getattr(output, 'no_vocals', ''))
    elif hasattr(output, 'url'):
        # FileOutput with .url attribute
        vocals_url = str(output.url)
    else:
        # Single output - it's the vocals
        vocals_url = str(output)

    print(f"Demucs parsed: vocals_url={vocals_url!r}, no_vocals_url={no_vocals_url!r}")

    if vocals_url:
        _download_file(vocals_url, get_track_file_path(track_id, "vocals"))
        print(f"Downloaded vocals to {get_track_file_path(track_id, 'vocals')}")
    else:
        print(f"WARNING: No vocals URL extracted from Demucs output")

    if no_vocals_url:
        _download_file(no_vocals_url, get_track_file_path(track_id, "no_vocals"))
        print(f"Downloaded no_vocals to {get_track_file_path(track_id, 'no_vocals')}")
    else:
        print(f"WARNING: No no_vocals URL from Demucs (stem=vocals mode). Generating from original...")
        # If Demucs only returned vocals, we don't have the instrumental.
        # This can happen with stem="vocals" on some Demucs versions.

    # Compress split audio from 320kbps to 128kbps
    set_processing_status(track_id, STATUS_SPLITTING, 48, "Compressing audio...")
    for file_key in ("vocals", "no_vocals"):
        path = get_track_file_path(track_id, file_key)
        if os.path.exists(path):
            try:
                compress_audio_file(path)
                print(f"Compressed {file_key} for track {track_id}")
            except Exception as e:
                print(f"WARNING: Failed to compress {file_key} for track {track_id}: {e}")

    set_processing_status(track_id, STATUS_SPLITTING, PROGRESS[STATUS_SPLITTING], "Vocals separated")


def _stage_lyrics(track_id):
    """Stage 4: Extract lyrics via WhisperX on Replicate (50-85%)"""
    if track_file_exists(track_id, "lyrics_raw"):
        set_processing_status(track_id, STATUS_LYRICS, PROGRESS[STATUS_LYRICS], "Lyrics extracted")
        return

    set_processing_status(track_id, STATUS_LYRICS, 55, "Fetching reference lyrics...")

    from src.services.lyrics import upload_audio_to_replicate, extract_lyrics_whisperx

    # Fetch reference lyrics early so WhisperX can cross-check its output
    reference_lines = None
    meta = load_metadata(track_id)
    if meta:
        title = meta.get("title", "")
        artist = meta.get("artist", "")
        if title and artist:
            try:
                from src.services.reference_lyrics import fetch_lyrics
                reference_lines = fetch_lyrics(title, artist)
                if reference_lines:
                    ref_lyrics_path = os.path.join(get_song_dir(track_id), "reference_lyrics.json")
                    with open(ref_lyrics_path, "w") as gf:
                        json.dump({"lines": reference_lines}, gf, indent=2)
            except Exception as e:
                print(f"WARNING: Reference lyrics fetch failed for {track_id}: {e}")

    set_processing_status(track_id, STATUS_LYRICS, 58, "Analyzing vocals...")

    vocals_path = get_track_file_path(track_id, "vocals")
    audio_url = upload_audio_to_replicate(vocals_path)

    set_processing_status(track_id, STATUS_LYRICS, 60, "Extracting lyrics...")

    output = extract_lyrics_whisperx(audio_url, reference_lines=reference_lines,
                                     vocals_path=vocals_path)

    set_processing_status(track_id, STATUS_LYRICS, 80, "Saving lyrics...")

    # Save raw output
    if isinstance(output, dict):
        raw_data = output
    else:
        raw_data = json.loads(str(output)) if not isinstance(output, (list, dict)) else output

    save_lyrics_raw(track_id, raw_data)
    set_processing_status(track_id, STATUS_LYRICS, PROGRESS[STATUS_LYRICS], "Lyrics extracted")


def _extract_whisperx_text(raw_data):
    """Concatenate all words from WhisperX output into a plain-text string."""
    words = []
    segments = raw_data.get("segments", raw_data if isinstance(raw_data, list) else [])
    for seg in (segments if isinstance(segments, list) else []):
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if text:
                words.append(text)
    return " ".join(words)


def _stage_process_lyrics(track_id):
    """Stage 5: Split lyrics into karaoke lines (85-90%)"""
    if track_file_exists(track_id, "lyrics"):
        set_processing_status(track_id, STATUS_PROCESSING, PROGRESS[STATUS_PROCESSING], "Lyrics synced")
        return

    set_processing_status(track_id, STATUS_PROCESSING, 86, "Fetching reference lyrics...")

    from src.utils.helpers import postprocess_lyrics_heuristic, correct_lyrics_with_reference

    # Load raw lyrics
    raw_path = get_track_file_path(track_id, "lyrics_raw")
    with open(raw_path, "r") as f:
        raw_data = json.load(f)

    # Correct WhisperX transcription with reference lyrics
    ref_line_breaks = []
    ref_stats = None
    ref_lines = None

    # Load cached reference lyrics (saved in stage 4) or fetch fresh
    ref_lyrics_path = os.path.join(get_song_dir(track_id), "reference_lyrics.json")
    if os.path.exists(ref_lyrics_path):
        try:
            with open(ref_lyrics_path, "r") as gf:
                ref_lines = json.load(gf).get("lines", [])
        except Exception:
            pass

    if not ref_lines:
        meta = load_metadata(track_id)
        if meta:
            title = meta.get("title", "")
            artist = meta.get("artist", "")
            if title and artist:
                try:
                    from src.services.reference_lyrics import fetch_lyrics
                    vocals_path = get_track_file_path(track_id, "vocals")
                    raw_text = _extract_whisperx_text(raw_data)
                    set_processing_status(track_id, STATUS_PROCESSING, 87, "Fetching reference lyrics (Gemini fallback)...")
                    ref_lines = fetch_lyrics(
                        title, artist,
                        vocals_path=vocals_path,
                        raw_text=raw_text or None,
                    )
                    if ref_lines:
                        with open(ref_lyrics_path, "w") as gf:
                            json.dump({"lines": ref_lines}, gf, indent=2)
                except Exception as e:
                    print(f"WARNING: Reference lyrics fetch failed for {track_id}: {e}")

    # Check if WhisperX returned empty segments
    raw_segments = raw_data.get("segments", raw_data if isinstance(raw_data, list) else [])
    has_words = any(
        w.get("word", "").strip()
        for seg in (raw_segments if isinstance(raw_segments, list) else [])
        for w in seg.get("words", [])
    )

    if not has_words and ref_lines:
        # WhisperX failed but we have external lyrics — save as untimed
        print(f"INFO: WhisperX returned no words for {track_id}, using untimed reference lyrics")
        set_processing_status(track_id, STATUS_PROCESSING, 89, "Using external lyrics (untimed)...")
        processed = {
            "segments": [],
            "untimed": True,
            "plain_lyrics": ref_lines,
            "lyrics_source": "reference",
        }
        save_lyrics(track_id, processed)
        set_processing_status(track_id, STATUS_PROCESSING, PROGRESS[STATUS_PROCESSING], "Lyrics synced (untimed)")
        return

    if ref_lines:
        try:
            segments = raw_data.get("segments", raw_data if isinstance(raw_data, list) else [])
            corrected, ref_line_breaks, ref_stats = correct_lyrics_with_reference(segments, ref_lines)
            raw_data["segments"] = corrected
            # Save corrected raw data back
            save_lyrics_raw(track_id, raw_data)
        except Exception as e:
            print(f"WARNING: Reference lyrics correction failed for {track_id}: {e}")

    set_processing_status(track_id, STATUS_PROCESSING, 89, "Processing lyrics...")

    # Split into karaoke lines using reference line breaks or heuristic fallback
    processed = postprocess_lyrics_heuristic(
        raw_data, ref_line_breaks=ref_line_breaks, ref_stats=ref_stats
    )

    save_lyrics(track_id, processed)
    set_processing_status(track_id, STATUS_PROCESSING, PROGRESS[STATUS_PROCESSING], "Lyrics synced")


def _stage_complete(track_id):
    """Stage 6: Mark as complete (100%)"""
    from src.utils.error_logging import log_event
    log_event("info", "pipeline", f"Processing complete for track {track_id}", track_id=str(track_id))
    set_processing_status(track_id, STATUS_COMPLETE, 100, "Ready to play!")

    # Clean up deezer_data from metadata (it's large and no longer needed)
    meta = load_metadata(track_id)
    if meta and "deezer_data" in meta:
        del meta["deezer_data"]
        save_metadata(track_id, meta)


def _download_file(url, output_path):
    """Download a file from URL to local path."""
    resp = requests.get(str(url), stream=True, timeout=300)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)


def _record_failure(track_id, stage, error_msg):
    """Record a processing failure in the database."""
    try:
        from src.models.db import query_db, execute_db, insert_db
        existing = query_db(
            "SELECT * FROM processing_failures WHERE track_id = ?",
            [str(track_id)],
            one=True,
        )
        if existing:
            execute_db(
                "UPDATE processing_failures SET failure_count = failure_count + 1, stage = ?, error_message = ?, updated_at = ? WHERE track_id = ?",
                [stage, error_msg, datetime.utcnow().isoformat(), str(track_id)],
            )
        else:
            insert_db(
                "INSERT INTO processing_failures (track_id, stage, error_message) VALUES (?, ?, ?)",
                [str(track_id), stage, error_msg],
            )
    except Exception as e:
        print(f"WARNING: Could not record failure: {e}")


def _log_usage(action, detail=""):
    """Log a usage event."""
    try:
        from src.models.db import insert_db
        user_id = session.get("user_id")
        from src.utils.decorators import _get_current_user
        user = _get_current_user()
        username = user["username"] if user else "unknown"
        insert_db(
            "INSERT INTO usage_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)",
            [user_id, username, action, detail],
        )
    except Exception:
        pass
