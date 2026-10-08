import os
from src.utils.validation import json_object, text_field, integer_field, boolean_field
import json
import sqlite3
import random
import threading
import traceback
import requests
from datetime import datetime
from flask import Blueprint, request, jsonify, session, current_app

from src.utils.decorators import login_required
from src.utils.constants import STATUS_METADATA, STATUS_DOWNLOADING, STATUS_SPLITTING, STATUS_LYRICS, STATUS_PROCESSING, STATUS_COMPLETE, STATUS_ERROR, PROGRESS

from src.utils.cache import TTLCache
from src.utils.file_handling import (
    get_song_dir, load_metadata, save_metadata, load_lyrics,
    save_lyrics, save_lyrics_raw, track_file_exists, get_track_file_path,
    is_track_complete, get_all_track_ids, compress_audio_file,
    is_valid_track_id,
)
from src.utils.status_checks import set_processing_status, get_processing_status, remove_from_queue, claim_processing

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

    if len(q) > 500:
        return jsonify({"error": "Search query must be at most 500 characters"}), 400
    cache = current_app.extensions.setdefault("search_cache", TTLCache())
    cache_key = q.casefold()
    cached_results = cache.get(cache_key)
    if cached_results is not None:
        _log_usage("search", q)
        return jsonify(cached_results)

    from src.services.deezer import deezer_search, TYPE_TRACK
    try:
        results = deezer_search(q, TYPE_TRACK)
    except Exception as e:
        from src.utils.error_logging import log_api_error
        log_api_error(str(e), traceback.format_exc(), source="/search")
        # Don't leak internal exception details to users
        return jsonify({"error": "Search is temporarily unavailable"}), 500

    # Upgrade cover images from 56x56 to 500x500
    for r in results:
        if "img_url" in r:
            r["img_url"] = _upgrade_cover_url(r["img_url"])

    cache.set(cache_key, results)

    _log_usage("search", q)
    return jsonify(results)


@track_bp.route("/add", methods=["POST"])
@login_required
def add():
    data = json_object(optional=True)
    track_id = str(data.get("id") or request.args.get("id", "")).strip()
    if not track_id:
        return jsonify({"error": "Track ID required"}), 400
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

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

    # Atomically claim the queue slot BEFORE charging credits — two
    # concurrent /add requests for the same track would otherwise both pass
    # a plain status check, both deduct credits and spawn duplicate pipelines.
    existing = claim_processing(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Getting song info...")
    if existing is not None:
        return jsonify({
            "status": "already_processing",
            "stage": existing["status"],
            "progress": existing["progress"],
        })

    # Credit check for new processing (5 credits)
    from src.utils.decorators import _get_current_user
    from src.models.db import query_db as _qdb, get_db
    user = _get_current_user()
    if user and not user["is_admin"]:
        db = get_db()
        try:
            cur = db.execute(
                "UPDATE users SET credits = credits - 5 WHERE id = ? AND credits >= 5",
                [user["id"]],
            )
            db.commit()
        except sqlite3.Error:
            db.rollback()
            remove_from_queue(track_id)
            raise
        if cur.rowcount != 1:
            remove_from_queue(track_id)  # release the claim
            refreshed = _qdb("SELECT credits FROM users WHERE id = ?", [user["id"]], one=True)
            credits = refreshed["credits"] if refreshed else 0
            return jsonify({"error": "insufficient_credits", "credits": credits, "required": 5}), 403

    _log_usage("download", track_id)

    from src.utils.error_logging import log_event
    username = user["username"] if user else "unknown"
    log_event("info", "pipeline", f"Processing started for track {track_id}", user_id=user["id"] if user else None, username=username, track_id=str(track_id))

    # Start processing in background (status already set by claim_processing)
    app = current_app._get_current_object()

    charged_user_id = user["id"] if user and not user["is_admin"] else None
    t = threading.Thread(target=process_track, args=(track_id, app, charged_user_id), daemon=True)
    try:
        t.start()
    except RuntimeError:
        remove_from_queue(track_id)
        if charged_user_id is not None:
            from src.models.db import execute_db
            execute_db("UPDATE users SET credits = credits + 5 WHERE id = ?", [charged_user_id])
        return jsonify({"error": "Processing is temporarily unavailable"}), 503

    # Return updated credits for non-admin users
    updated_credits = None
    if user and not user["is_admin"]:
        refreshed = _qdb("SELECT credits FROM users WHERE id = ?", [user["id"]], one=True)
        updated_credits = refreshed["credits"] if refreshed else 0

    resp = {"status": "processing", "progress": PROGRESS[STATUS_METADATA]}
    if updated_credits is not None:
        resp["credits"] = updated_credits
    return jsonify(resp)


@track_bp.route("/track/<track_id>")
@login_required
def track_info(track_id):
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

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
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    lyrics = load_lyrics(track_id)
    if not lyrics:
        return jsonify({"error": "Lyrics not found"}), 404
    return jsonify(lyrics)


@track_bp.route("/track/<track_id>/lyrics/translations")
@login_required
def get_lyric_translation(track_id):
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    from src.models.db import query_db
    from src.services.lyric_translation import normalize_language, SUPPORTED_TRANSLATION_LANGUAGES

    try:
        target_language = normalize_language(request.args.get("lang") or "de")
    except ValueError:
        return jsonify({"error": "Unsupported language"}), 400

    row = query_db(
        "SELECT track_id, target_language, source_language, model, status, translated_lines_json, created_at, updated_at "
        "FROM lyric_translations WHERE track_id = ? AND target_language = ?",
        [str(track_id), target_language],
        one=True,
    )
    if not row:
        return jsonify({
            "available": False,
            "track_id": str(track_id),
            "target_language": target_language,
            "target_language_name": SUPPORTED_TRANSLATION_LANGUAGES[target_language],
        })

    return jsonify({
        "available": True,
        "track_id": row["track_id"],
        "target_language": row["target_language"],
        "target_language_name": SUPPORTED_TRANSLATION_LANGUAGES[row["target_language"]],
        "source_language": row["source_language"],
        "model": row["model"],
        "status": row["status"],
        "lines": json.loads(row["translated_lines_json"] or "[]"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    })


@track_bp.route("/track/<track_id>/lyrics/translations", methods=["POST"])
@login_required
def create_lyric_translation(track_id):
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    from src.models.db import query_db, get_db
    from src.services.lyric_translation import (
        extract_lyric_lines,
        normalize_language,
        translate_lines,
        SUPPORTED_TRANSLATION_LANGUAGES,
    )

    data = json_object(optional=True)
    try:
        target_language = normalize_language(text_field(data, "target_language") or text_field(data, "lang") or "de")
    except ValueError:
        return jsonify({"error": "Unsupported language"}), 400

    existing = query_db(
        "SELECT track_id, target_language, source_language, model, status, translated_lines_json, created_at, updated_at "
        "FROM lyric_translations WHERE track_id = ? AND target_language = ?",
        [str(track_id), target_language],
        one=True,
    )
    force = boolean_field(data, "force")
    if existing and not force:
        return jsonify({
            "available": True,
            "track_id": existing["track_id"],
            "target_language": existing["target_language"],
            "target_language_name": SUPPORTED_TRANSLATION_LANGUAGES[existing["target_language"]],
            "source_language": existing["source_language"],
            "model": existing["model"],
            "status": existing["status"],
            "lines": json.loads(existing["translated_lines_json"] or "[]"),
            "created_at": existing["created_at"],
            "updated_at": existing["updated_at"],
        })

    lyrics = load_lyrics(track_id)
    if not lyrics:
        return jsonify({"error": "Lyrics not found"}), 404

    lyric_lines = extract_lyric_lines(lyrics)
    if not lyric_lines:
        return jsonify({"error": "No translatable lyrics"}), 400

    try:
        translated = translate_lines(lyric_lines, target_language, track_id=str(track_id))
    except Exception as e:
        from src.utils.error_logging import log_api_error
        log_api_error(str(e), traceback.format_exc(), source="/lyrics/translations")
        return jsonify({"error": "Translation failed"}), 502

    translated_json = json.dumps(translated["lines"], ensure_ascii=False)
    db = get_db()
    db.execute(
        "INSERT INTO lyric_translations (track_id, target_language, source_language, model, status, translated_lines_json, updated_at) "
        "VALUES (?, ?, ?, ?, 'complete', ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(track_id, target_language) DO UPDATE SET "
        "source_language = excluded.source_language, model = excluded.model, status = 'complete', "
        "translated_lines_json = excluded.translated_lines_json, updated_at = CURRENT_TIMESTAMP",
        [str(track_id), target_language, translated.get("source_language"), translated.get("model"), translated_json],
    )
    db.commit()

    _log_usage("translate_lyrics", f"{track_id}:{target_language}")
    return jsonify({
        "available": True,
        "track_id": str(track_id),
        "target_language": target_language,
        "target_language_name": SUPPORTED_TRANSLATION_LANGUAGES[target_language],
        "source_language": translated.get("source_language"),
        "model": translated.get("model"),
        "status": "complete",
        "lines": translated["lines"],
    })


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
        if not is_valid_track_id(track_id):
            return jsonify({"error": "Invalid track ID"}), 400

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
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    data = json_object()
    seg_idx = integer_field(data, "segmentIndex")
    word_idx = integer_field(data, "wordIndex")
    new_word = text_field(data, "word")

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
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    user_id = session.get("user_id")
    insert_db("INSERT OR IGNORE INTO favorites (user_id, track_id) VALUES (?, ?)", [user_id, str(track_id)])
    return jsonify({"success": True})


@track_bp.route("/favorites/<track_id>", methods=["DELETE"])
@login_required
def remove_favorite(track_id):
    from src.models.db import execute_db
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    user_id = session.get("user_id")
    execute_db("DELETE FROM favorites WHERE user_id = ? AND track_id = ?", [user_id, str(track_id)])
    return jsonify({"success": True})


@track_bp.route("/play/<track_id>")
@login_required
def log_play(track_id):
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    _log_usage("play", track_id)
    return jsonify({"success": True})


@track_bp.route("/play/<track_id>/credit", methods=["POST"])
@login_required
def play_credit(track_id):
    """Deduct 1 credit for playing a song (after 15s). Admins are exempt."""
    from src.utils.decorators import _get_current_user
    from src.models.db import query_db, get_db
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    if user["is_admin"]:
        return jsonify({"success": True, "credits": user["credits"] or 0})

    db = get_db()
    cur = db.execute(
        "UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1",
        [user["id"]],
    )
    db.commit()
    if cur.rowcount != 1:
        refreshed = query_db("SELECT credits FROM users WHERE id = ?", [user["id"]], one=True)
        credits = refreshed["credits"] if refreshed else 0
        return jsonify({"error": "insufficient_credits", "credits": credits}), 403

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
    playlists = query_db("""
        SELECT playlists.*, COUNT(playlist_tracks.id) AS track_count
        FROM playlists LEFT JOIN playlist_tracks ON playlist_tracks.playlist_id = playlists.id
        WHERE playlists.user_id = ? GROUP BY playlists.id ORDER BY playlists.created_at DESC
    """, [user_id])
    result = []
    for p in playlists:
        result.append({
            "id": p["id"],
            "name": p["name"],
            "track_count": p["track_count"],
            "created_at": p["created_at"],
        })
    return jsonify(result)


@track_bp.route("/playlists", methods=["POST"])
@login_required
def create_playlist():
    from src.models.db import insert_db
    data = json_object()
    name = text_field(data, "name")
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
    data = json_object()
    track_id = text_field(data, "track_id")
    if not track_id:
        return jsonify({"error": "track_id required"}), 400
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400
    from src.models.db import transaction
    try:
        with transaction() as db:
            db.execute(
                """INSERT INTO playlist_tracks (playlist_id, track_id, position)
                   SELECT ?, ?, COALESCE(MAX(position), 0) + 1
                   FROM playlist_tracks WHERE playlist_id = ?""",
                [playlist_id, track_id, playlist_id],
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "Track already in playlist"}), 409
    return jsonify({"success": True})


@track_bp.route("/playlists/<int:playlist_id>/tracks/<track_id>", methods=["DELETE"])
@login_required
def remove_from_playlist(playlist_id, track_id):
    from src.models.db import execute_db, query_db
    if not is_valid_track_id(track_id):
        return jsonify({"error": "Invalid track ID"}), 400

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


def process_track(track_id, app, charged_user_id=None):
    """6-stage processing pipeline. Runs in a background thread.

    charged_user_id: user who paid 5 credits for this run (None when the
    run is free — admin, reprocess, auto-reprocess). Refunded on failure.
    """
    from src.utils.error_logging import log_pipeline_error

    stages = [
        ("metadata", _stage_metadata),
        ("download", _stage_download),
        ("splitting", _stage_split),
        ("lyrics", _stage_lyrics),
        ("processing", _stage_process_lyrics),
        ("complete", _stage_complete),
    ]

    with app.extensions["processing_slots"], app.app_context():
        for stage_name, stage_fn in stages:
            try:
                stage_fn(track_id)
            except Exception as e:
                tb = traceback.format_exc()
                print(f"ERROR processing track {track_id} at stage '{stage_name}': {e}")
                set_processing_status(track_id, STATUS_ERROR, 0, f"The {stage_name} stage failed. Please try again.")
                _record_failure(track_id, stage_name, str(e))
                log_pipeline_error(track_id, stage_name, str(e), tb)
                if charged_user_id is not None:
                    from src.models.db import execute_db
                    from src.utils.error_logging import log_event
                    execute_db("UPDATE users SET credits = credits + 5 WHERE id = ?", [charged_user_id])
                    log_event("info", "pipeline",
                              f"Refunded 5 credits for failed processing of track {track_id}",
                              user_id=charged_user_id, track_id=str(track_id))
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

    meta = load_metadata(track_id) or {}
    song_data = meta.get("deezer_data")
    if not song_data:
        # deezer_data is stripped from metadata.json on completion. If the
        # song file is later lost or a reprocess needs to re-download, the
        # metadata stage early-returns and this stage would fail forever
        # with an empty dict — re-fetch from Deezer instead.
        from src.services.deezer import get_song_infos_from_deezer_website, TYPE_TRACK
        song_data = get_song_infos_from_deezer_website(TYPE_TRACK, track_id)
        meta["deezer_data"] = song_data
        save_metadata(track_id, meta)
    output_path = get_track_file_path(track_id, "song")

    from src.services.deezer import download_song
    download_song(song_data, output_path)

    set_processing_status(track_id, STATUS_DOWNLOADING, PROGRESS[STATUS_DOWNLOADING], "Song downloaded")


def _stage_split(track_id):
    """Stage 3: Split vocals/instrumental (20-50%).

    SPLIT_BACKEND=local (default) runs BS-RoFormer in the local separation worker and falls back to Demucs on
    Replicate when the worker is unavailable, crashes, times out or fails. SPLIT_BACKEND=replicate always uses
    Replicate. The producing backend is recorded in songs/<id>/separation.json.
    """
    if track_file_exists(track_id, "vocals") and track_file_exists(track_id, "no_vocals"):
        set_processing_status(track_id, STATUS_SPLITTING, PROGRESS[STATUS_SPLITTING], "Vocals separated")
        return

    set_processing_status(track_id, STATUS_SPLITTING, 25, "Preparing audio...")
    if not track_file_exists(track_id, "lyrics_raw"):
        _prefetch_references(track_id)

    from src.services import separation

    if separation.split_backend() == "local":
        try:
            _split_local(track_id)
            set_processing_status(track_id, STATUS_SPLITTING, PROGRESS[STATUS_SPLITTING], "Vocals separated")
            return
        except Exception as e:  # worker unavailable/crashed/timed out, job error, unexpected I/O problem
            from src.utils.error_logging import log_event
            print(f"WARNING: Local separation failed for track {track_id}, falling back to Replicate: {e}")
            log_event("warning", "pipeline", f"Local separation failed, using Replicate Demucs: {e}",
                      track_id=str(track_id))
            set_processing_status(track_id, STATUS_SPLITTING, 25, "Switching to cloud separation...")

    _split_replicate(track_id)
    set_processing_status(track_id, STATUS_SPLITTING, PROGRESS[STATUS_SPLITTING], "Vocals separated")


def _split_local(track_id):
    """Separate with the local turbo-roformer worker (interactive priority) and report queue/chunk progress."""
    from src.services.separation import separate_track_locally, status_for_event

    def on_event(message):
        update = status_for_event(message)
        if update is not None:
            set_processing_status(track_id, STATUS_SPLITTING, update[0], update[1])

    record = separate_track_locally(track_id, priority="interactive", on_event=on_event)
    print(f"Local separation for track {track_id}: rtf={record.get('rtf')} backend={record.get('compute_backend')}")


def _split_replicate(track_id):
    """Separate with Demucs on Replicate (cloud fallback)."""
    from src.services.lyrics import upload_audio_to_replicate, split_audio_demucs
    from src.services.separation import remove_record, replicate_record, save_record

    song_path = get_track_file_path(track_id, "song")
    audio_url = upload_audio_to_replicate(song_path)

    set_processing_status(track_id, STATUS_SPLITTING, 30, "Separating vocals...")

    output = split_audio_demucs(audio_url)

    set_processing_status(track_id, STATUS_SPLITTING, 45, "Saving vocal tracks...")

    print(f"Demucs output type: {type(output).__name__}")

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

    print(f"Demucs stems: vocals={bool(vocals_url)}, instrumental={bool(no_vocals_url)}")

    remove_record(track_id)

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

    missing = [file_key for file_key in ("vocals", "no_vocals") if not track_file_exists(track_id, file_key)]
    if missing:
        raise RuntimeError(f"Demucs did not produce required split file(s): {', '.join(missing)}")

    save_record(track_id, replicate_record())


_prefetches = {}
_prefetches_lock = threading.Lock()


def _cached_references(track_id):
    """reference_lyrics.json when it holds external sources (version 2); older caches can contain generated text."""
    path = os.path.join(get_song_dir(track_id), "reference_lyrics.json")
    try:
        with open(path, "r") as gf:
            cached = json.load(gf)
    except (OSError, ValueError):
        return None
    if isinstance(cached, dict) and cached.get("version") == 2 and isinstance(cached.get("candidates"), list):
        return cached
    return None


def _fetch_and_cache_references(track_id):
    meta = load_metadata(track_id) or {}
    if not (meta.get("title") and meta.get("artist")):
        return None
    from src.services.reference_lyrics import fetch_references
    references = fetch_references(meta["title"], meta["artist"], track_id=track_id,
                                  duration=meta.get("duration"), album=meta.get("album"))
    path = os.path.join(get_song_dir(track_id), "reference_lyrics.json")
    with open(path + ".tmp", "w") as gf:
        json.dump(references, gf, indent=2, ensure_ascii=False)
    os.replace(path + ".tmp", path)
    return references


def _prefetch_references(track_id):
    """Fetch reference lyrics in the background while the vocals are separated."""
    if _cached_references(track_id) is not None:
        return
    app = current_app._get_current_object()

    def run():
        with app.app_context():
            try:
                _fetch_and_cache_references(track_id)
            except Exception as e:
                print(f"WARNING: Reference lyrics prefetch failed for {track_id}: {e}")

    with _prefetches_lock:
        if track_id in _prefetches and _prefetches[track_id].is_alive():
            return
        thread = threading.Thread(target=run, daemon=True)
        _prefetches[track_id] = thread
    thread.start()


def _references(track_id, wait=20.0):
    """Reference lyrics for a track: the prefetched or cached record, else fetched now."""
    with _prefetches_lock:
        thread = _prefetches.pop(track_id, None)
    if thread is not None:
        thread.join(wait)
    cached = _cached_references(track_id)
    if cached is not None:
        return cached
    return _fetch_and_cache_references(track_id)


def _stage_lyrics(track_id):
    """Stage 4: Word-timed lyrics (35-65%).

    TRANSCRIBE_BACKEND=local (default) runs turbo-lyrics in the local transcription worker and falls back to
    WhisperX on Replicate when the worker is unavailable, fails or its output looks broken. The producer is
    recorded in songs/<id>/transcription.json.
    """
    if track_file_exists(track_id, "lyrics_raw"):
        set_processing_status(track_id, STATUS_LYRICS, PROGRESS[STATUS_LYRICS], "Lyrics extracted")
        return

    set_processing_status(track_id, STATUS_LYRICS, 37, "Fetching reference lyrics...")

    # Verified reference lyrics guide the transcription (language, forced alignment, output checks)
    reference = None
    try:
        references = _references(track_id) or {}
        # An endpoint without identity metadata must not trigger paid
        # transcription retries based on an unrelated lyric response.
        reference = next((c for c in references.get("candidates", []) if c.get("identity_verified")), None)
    except Exception as e:
        print(f"WARNING: Reference lyrics fetch failed for {track_id}: {e}")
    reference_lines = reference["lines"] if reference else None

    from src.services import transcription

    raw_data = None
    local_error = None
    if transcription.transcribe_backend() == "local":
        try:
            raw_data = _transcribe_local(track_id, reference_lines, reference.get("times") if reference else None)
        except Exception as e:  # worker unavailable/crashed/timed out, job error, broken output
            from src.utils.error_logging import log_event
            local_error = e
            print(f"WARNING: Local transcription failed for track {track_id}, falling back to Replicate: {e}")
            log_event("warning", "pipeline", f"Local transcription failed, using Replicate WhisperX: {e}",
                      track_id=str(track_id))
            set_processing_status(track_id, STATUS_LYRICS, 40, "Switching to cloud transcription...")

    if raw_data is None:
        raw_data = _transcribe_replicate(track_id, reference_lines)
        transcription.save_record(track_id, transcription.replicate_record(local_error))

    set_processing_status(track_id, STATUS_LYRICS, 64, "Saving lyrics...")
    save_lyrics_raw(track_id, raw_data)
    set_processing_status(track_id, STATUS_LYRICS, PROGRESS[STATUS_LYRICS], "Lyrics extracted")


def _transcribe_local(track_id, reference_lines, reference_times):
    """Transcribe with the local turbo-lyrics worker; raises when the result must not be used."""
    from src.services.lyrics import _is_bad_output
    from src.services.transcription import save_record, status_for_event, transcribe_track_locally

    def on_event(message):
        update = status_for_event(message)
        if update is not None:
            set_processing_status(track_id, STATUS_LYRICS, update[0], update[1])

    set_processing_status(track_id, STATUS_LYRICS, 40, "Analyzing vocals...")
    raw_data, record = transcribe_track_locally(track_id, reference_lines=reference_lines,
                                                reference_times=reference_times, on_event=on_event)
    if _is_bad_output(raw_data, reference_lines):
        raise RuntimeError("local transcription output looks broken")
    save_record(track_id, record)
    print(f"Local transcription for track {track_id}: rtf={record.get('rtf')} chosen={record.get('chosen')} "
          f"language={record.get('language')}")
    return raw_data


def _transcribe_replicate(track_id, reference_lines):
    """WhisperX on Replicate (cloud fallback, Voxtral as its own fallback)."""
    from src.services.lyrics import upload_audio_to_replicate, extract_lyrics_whisperx

    set_processing_status(track_id, STATUS_LYRICS, 40, "Analyzing vocals...")
    vocals_path = get_track_file_path(track_id, "vocals")
    audio_url = upload_audio_to_replicate(vocals_path)

    set_processing_status(track_id, STATUS_LYRICS, 45, "Extracting lyrics...")
    output = extract_lyrics_whisperx(audio_url, reference_lines=reference_lines, vocals_path=vocals_path)
    if isinstance(output, dict):
        return output
    return json.loads(str(output)) if not isinstance(output, (list, dict)) else output


def _extract_whisperx_text(raw_data):
    """Concatenate all words from WhisperX output into a plain-text string."""
    words = []
    segments = raw_data if isinstance(raw_data, list) else raw_data.get("segments", [])
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

    from src.utils.helpers import postprocess_lyrics_heuristic
    from src.services.lyric_correction import correct_lyrics_with_luna
    from src.services.reference_lyrics import select_reference

    # Load raw lyrics
    raw_path = get_track_file_path(track_id, "lyrics_raw")
    with open(raw_path, "r") as f:
        raw_data = json.load(f)

    if isinstance(raw_data, list):
        raw_data = {"segments": raw_data}

    # Correct WhisperX transcription with reference lyrics
    ref_line_breaks = []
    ref_stats = None
    ref_lines = None

    references = _references(track_id)
    candidates = (references or {}).get("candidates", [])
    selected = select_reference(candidates, _extract_whisperx_text(raw_data))
    if selected:
        ref_lines = selected["lines"]
    provenance = {"selected": selected["source"] if selected else None,
                  "sources": [candidate["source"] for candidate in candidates]}

    # Check if WhisperX returned empty segments
    raw_segments = raw_data if isinstance(raw_data, list) else raw_data.get("segments", [])
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
            "reference_sources": provenance,
        }
        save_lyrics(track_id, processed)
        set_processing_status(track_id, STATUS_PROCESSING, PROGRESS[STATUS_PROCESSING], "Lyrics synced (untimed)")
        return

    line_starts = raw_data.get("line_starts") if raw_data.get("source") == "reference" else None
    if isinstance(line_starts, list) and line_starts:
        # Reference lyrics were force-aligned to the vocals and passed the gate: the words are the reference
        # text and its line breaks are known, so there is nothing for the LLM to correct.
        ref_line_breaks = line_starts
        ref_stats = {"applied": True, "method": "forced_alignment", "gate": raw_data.get("gate")}
    elif ref_lines:
        set_processing_status(track_id, STATUS_PROCESSING, 88, "Validating and correcting lyrics...")
        raw_data, ref_line_breaks, ref_stats = correct_lyrics_with_luna(raw_data, ref_lines, track_id=track_id)
        # Keep lyrics_raw.json untouched for retries and comparison with ASR.

    set_processing_status(track_id, STATUS_PROCESSING, 89, "Processing lyrics...")

    # Split into karaoke lines using reference line breaks or heuristic fallback
    processed = postprocess_lyrics_heuristic(
        raw_data, ref_line_breaks=ref_line_breaks, ref_stats=ref_stats
    )

    processed["reference_sources"] = provenance
    if ref_stats:
        processed["correction_stats"] = ref_stats
        if ref_stats.get("applied"):
            processed["lyrics_source"] = "reference"
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
    """Download a file from URL to local path.

    Streams to a temp file and renames atomically: a connection drop
    mid-download must not leave a truncated file at the final path, because
    the stage early-returns treat any existing file as complete and would
    skip regeneration forever.
    """
    tmp_path = f"{output_path}.tmp"
    try:
        with requests.get(str(url), stream=True, timeout=300) as resp:
            resp.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
        if os.path.getsize(tmp_path) == 0:
            raise RuntimeError("The audio provider returned an empty file")
        os.replace(tmp_path, output_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


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
