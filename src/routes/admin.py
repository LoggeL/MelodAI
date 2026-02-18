import os
import secrets
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify

from src.utils.decorators import admin_required
from src.models.db import query_db, execute_db, insert_db

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@admin_bp.route("/users")
@admin_required
def list_users():
    users = query_db("SELECT id, username, display_name, is_admin, is_approved, credits, created_at, last_online FROM users ORDER BY created_at DESC")
    result = []
    for u in users:
        activity = query_db("SELECT COUNT(*) as c FROM usage_logs WHERE user_id = ?", [u["id"]], one=True)
        result.append({
            "id": u["id"],
            "username": u["username"],
            "display_name": u["display_name"],
            "is_admin": bool(u["is_admin"]),
            "is_approved": bool(u["is_approved"]),
            "credits": u["credits"] or 0,
            "created_at": u["created_at"],
            "last_online": u["last_online"],
            "activity_count": activity["c"] if activity else 0,
        })
    return jsonify(result)


@admin_bp.route("/users/<int:user_id>/approve", methods=["POST"])
@admin_required
def approve_user(user_id):
    execute_db("UPDATE users SET is_approved = 1 WHERE id = ?", [user_id])
    return jsonify({"success": True})


@admin_bp.route("/users/<int:user_id>/promote", methods=["POST"])
@admin_required
def promote_user(user_id):
    execute_db("UPDATE users SET is_admin = 1 WHERE id = ?", [user_id])
    return jsonify({"success": True})


@admin_bp.route("/users/<int:user_id>/demote", methods=["POST"])
@admin_required
def demote_user(user_id):
    from flask import session as flask_session
    if flask_session.get("user_id") == user_id:
        return jsonify({"error": "Cannot demote your own account"}), 400
    execute_db("UPDATE users SET is_admin = 0 WHERE id = ?", [user_id])
    return jsonify({"success": True})


@admin_bp.route("/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    from flask import session as flask_session
    if flask_session.get("user_id") == user_id:
        return jsonify({"error": "Cannot delete your own account"}), 400
    execute_db("DELETE FROM usage_logs WHERE user_id = ?", [user_id])
    execute_db("DELETE FROM auth_tokens WHERE user_id = ?", [user_id])
    execute_db("DELETE FROM password_resets WHERE user_id = ?", [user_id])
    execute_db("DELETE FROM users WHERE id = ?", [user_id])
    return jsonify({"success": True})


@admin_bp.route("/users/<int:user_id>/credits", methods=["POST"])
@admin_required
def set_credits(user_id):
    data = request.get_json()
    credits = data.get("credits")
    if credits is None:
        return jsonify({"error": "credits required"}), 400
    execute_db("UPDATE users SET credits = ? WHERE id = ?", [int(credits), user_id])
    return jsonify({"success": True})


@admin_bp.route("/invite-keys", methods=["GET"])
@admin_required
def list_invite_keys():
    keys = query_db("SELECT * FROM invite_keys ORDER BY created_at DESC")
    return jsonify([{
        "id": k["id"],
        "key": k["key"],
        "created_at": k["created_at"],
        "used_by": k["used_by"],
        "used_at": k["used_at"],
    } for k in keys])


@admin_bp.route("/invite-keys", methods=["POST"])
@admin_required
def generate_invite_key():
    from flask import session as flask_session
    key = secrets.token_urlsafe(16)
    user_id = flask_session.get("user_id")
    insert_db(
        "INSERT INTO invite_keys (key, created_by) VALUES (?, ?)",
        [key, user_id],
    )
    return jsonify({"key": key})


@admin_bp.route("/invite-keys/used", methods=["DELETE"])
@admin_required
def delete_used_invite_keys():
    count = query_db("SELECT COUNT(*) as c FROM invite_keys WHERE used_by IS NOT NULL", one=True)["c"]
    execute_db("DELETE FROM invite_keys WHERE used_by IS NOT NULL")
    return jsonify({"success": True, "deleted": count})


@admin_bp.route("/stats")
@admin_required
def stats():
    total_users = query_db("SELECT COUNT(*) as c FROM users", one=True)["c"]
    total_plays = query_db("SELECT COUNT(*) as c FROM usage_logs WHERE action = 'play'", one=True)["c"]
    total_downloads = query_db("SELECT COUNT(*) as c FROM usage_logs WHERE action = 'download'", one=True)["c"]
    total_searches = query_db("SELECT COUNT(*) as c FROM usage_logs WHERE action = 'search'", one=True)["c"]
    most_active = query_db(
        "SELECT username, COUNT(*) as c FROM usage_logs GROUP BY username ORDER BY c DESC LIMIT 1",
        one=True,
    )

    return jsonify({
        "total_users": total_users,
        "total_plays": total_plays,
        "total_downloads": total_downloads,
        "total_searches": total_searches,
        "most_active_user": most_active["username"] if most_active else None,
        "most_active_count": most_active["c"] if most_active else 0,
    })


@admin_bp.route("/usage-logs")
@admin_required
def usage_logs():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    username_filter = request.args.get("username", "")
    action_filter = request.args.get("action", "")

    offset = (page - 1) * per_page
    query = "SELECT * FROM usage_logs WHERE 1=1"
    args = []

    if username_filter:
        query += " AND username LIKE ?"
        args.append(f"%{username_filter}%")
    if action_filter:
        query += " AND action = ?"
        args.append(action_filter)

    # Count total
    count_query = query.replace("SELECT *", "SELECT COUNT(*) as c")
    total = query_db(count_query, args, one=True)["c"]

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    args.extend([per_page, offset])

    logs = query_db(query, args)
    return jsonify({
        "logs": [{
            "id": l["id"],
            "username": l["username"],
            "action": l["action"],
            "detail": l["detail"],
            "created_at": l["created_at"],
        } for l in logs],
        "total": total,
        "page": page,
        "per_page": per_page,
    })


@admin_bp.route("/storage")
@admin_required
def storage():
    import shutil
    from src.utils.file_handling import get_all_track_ids, SONGS_PATH

    # System disk usage
    disk = shutil.disk_usage("/")

    # Songs directory size
    songs_total = 0
    song_count = 0
    if os.path.exists(SONGS_PATH):
        for track_id in get_all_track_ids():
            track_dir = os.path.join(SONGS_PATH, track_id)
            for f in os.listdir(track_dir):
                fp = os.path.join(track_dir, f)
                if os.path.isfile(fp):
                    songs_total += os.path.getsize(fp)
            song_count += 1

    # Database size
    db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database.db")
    db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

    return jsonify({
        "disk_total": disk.total,
        "disk_used": disk.used,
        "disk_free": disk.free,
        "songs_size": songs_total,
        "songs_count": song_count,
        "db_size": db_size,
    })


@admin_bp.route("/songs")
@admin_required
def list_songs():
    from src.utils.file_handling import get_all_track_ids, load_metadata, load_lyrics, is_track_complete, get_track_file_sizes

    track_ids = get_all_track_ids()
    songs = []
    for tid in track_ids:
        meta = load_metadata(tid)
        if meta:
            img_url = meta.get("img_url", "")
            if img_url:
                img_url = img_url.replace("/56x56", "/200x200", 1)
            lyrics = load_lyrics(tid)
            has_lyrics = False
            if lyrics:
                has_lyrics = bool(lyrics.get("segments")) or bool(lyrics.get("plain_lyrics"))
            songs.append({
                "id": tid,
                "title": meta.get("title", "Unknown"),
                "artist": meta.get("artist", "Unknown"),
                "img_url": img_url,
                "complete": is_track_complete(tid),
                "file_sizes": get_track_file_sizes(tid),
                "avg_confidence": lyrics.get("avg_confidence") if lyrics else None,
                "has_lyrics": has_lyrics,
            })
    return jsonify(songs)


@admin_bp.route("/songs/<track_id>/details")
@admin_required
def song_details(track_id):
    import json
    from src.utils.file_handling import (
        load_metadata, load_lyrics, is_track_complete, get_song_dir
    )
    from src.utils.constants import TRACK_FILES

    meta = load_metadata(track_id)
    if not meta:
        return jsonify({"error": "Track not found"}), 404

    song_dir = get_song_dir(track_id)
    files = {}
    for key, filename in TRACK_FILES.items():
        path = os.path.join(song_dir, filename)
        exists = os.path.exists(path)
        files[key] = {
            "exists": exists,
            "size": os.path.getsize(path) if exists else 0,
        }

    lyrics = load_lyrics(track_id)

    lyrics_raw = None
    raw_path = os.path.join(song_dir, TRACK_FILES["lyrics_raw"])
    if os.path.exists(raw_path):
        with open(raw_path, "r") as f:
            lyrics_raw = json.load(f)

    ref_lyrics = None
    ref_lyrics_path = os.path.join(song_dir, "reference_lyrics.json")
    if os.path.exists(ref_lyrics_path):
        with open(ref_lyrics_path, "r") as f:
            ref_lyrics = json.load(f)

    failures = query_db(
        "SELECT * FROM processing_failures WHERE track_id = ? ORDER BY updated_at DESC",
        [track_id]
    )

    errors = query_db(
        "SELECT * FROM error_log WHERE track_id = ? ORDER BY created_at DESC LIMIT 20",
        [track_id]
    )

    play_count = query_db(
        "SELECT COUNT(*) as c FROM usage_logs WHERE action = 'play' AND detail = ?",
        [track_id], one=True
    )["c"]
    download_count = query_db(
        "SELECT COUNT(*) as c FROM usage_logs WHERE action = 'download' AND detail = ?",
        [track_id], one=True
    )["c"]
    recent_plays = query_db(
        "SELECT username, created_at FROM usage_logs WHERE action = 'play' AND detail = ? ORDER BY created_at DESC LIMIT 10",
        [track_id]
    )

    fav_count = query_db(
        "SELECT COUNT(*) as c FROM favorites WHERE track_id = ?",
        [track_id], one=True
    )["c"]

    playlist_count = query_db(
        "SELECT COUNT(*) as c FROM playlist_tracks WHERE track_id = ?",
        [track_id], one=True
    )["c"]

    return jsonify({
        "id": track_id,
        "metadata": meta,
        "complete": is_track_complete(track_id),
        "files": files,
        "lyrics": lyrics,
        "lyrics_raw": lyrics_raw,
        "reference_lyrics": ref_lyrics,
        "processing_failures": [{
            "id": f["id"],
            "stage": f["stage"],
            "error_message": f["error_message"],
            "failure_count": f["failure_count"],
            "created_at": f["created_at"],
            "updated_at": f["updated_at"],
        } for f in failures],
        "errors": [{
            "id": e["id"],
            "error_type": e["error_type"],
            "source": e["source"],
            "error_message": e["error_message"],
            "stack_trace": e["stack_trace"],
            "created_at": e["created_at"],
        } for e in errors],
        "usage": {
            "play_count": play_count,
            "download_count": download_count,
            "recent_plays": [{
                "username": p["username"],
                "created_at": p["created_at"],
            } for p in recent_plays],
        },
        "favorites_count": fav_count,
        "playlist_count": playlist_count,
    })


@admin_bp.route("/songs/<track_id>/reference-lyrics", methods=["POST"])
@admin_required
def fetch_reference_lyrics(track_id):
    import json
    from src.utils.file_handling import load_metadata, get_song_dir

    meta = load_metadata(track_id)
    if not meta:
        return jsonify({"error": "Track not found"}), 404

    title = meta.get("title", "")
    artist = meta.get("artist", "")
    if not title or not artist:
        return jsonify({"error": "Missing title or artist in metadata"}), 400

    try:
        from src.services.reference_lyrics import fetch_lyrics
        lines = fetch_lyrics(title, artist)
    except Exception as e:
        return jsonify({"error": f"Lyrics fetch failed: {e}"}), 500

    if not lines:
        return jsonify({"error": "No lyrics found"}), 404

    song_dir = get_song_dir(track_id)
    ref_lyrics_path = os.path.join(song_dir, "reference_lyrics.json")
    with open(ref_lyrics_path, "w") as f:
        json.dump({"lines": lines}, f, indent=2)

    return jsonify({"lines": lines})


@admin_bp.route("/songs/<track_id>/reference-lyrics/ai", methods=["POST"])
@admin_required
def fetch_reference_lyrics_ai(track_id):
    """Trigger the OpenRouter/Gemini fallback to generate reference lyrics from
    the isolated vocals audio + WhisperX transcript, bypassing lrclib."""
    import json
    from src.utils.file_handling import load_metadata, get_song_dir
    from src.services.reference_lyrics import _fetch_openrouter

    meta = load_metadata(track_id)
    if not meta:
        return jsonify({"error": "Track not found"}), 404

    song_dir = get_song_dir(track_id)
    vocals_path = os.path.join(song_dir, "vocals.mp3")
    lyrics_raw_path = os.path.join(song_dir, "lyrics_raw.json")

    raw_text = None
    if os.path.exists(lyrics_raw_path):
        with open(lyrics_raw_path) as f:
            raw_data = json.load(f)
        words = []
        segments = raw_data.get("segments", raw_data if isinstance(raw_data, list) else [])
        for seg in (segments if isinstance(segments, list) else []):
            for w in seg.get("words", []):
                t = w.get("word", "").strip()
                if t:
                    words.append(t)
        raw_text = " ".join(words) or None

    vp = vocals_path if os.path.exists(vocals_path) else None
    if not vp and not raw_text:
        return jsonify({"error": "No vocals file or raw lyrics available for this track"}), 400

    try:
        lines = _fetch_openrouter(raw_text=raw_text, vocals_path=vp)
    except Exception as e:
        return jsonify({"error": f"AI lyrics fetch failed: {e}"}), 500

    if not lines:
        return jsonify({"error": "AI returned no lyrics"}), 404

    ref_lyrics_path = os.path.join(song_dir, "reference_lyrics.json")
    with open(ref_lyrics_path, "w") as f:
        json.dump({"lines": lines}, f, indent=2)

    return jsonify({"lines": lines})


@admin_bp.route("/songs/<track_id>", methods=["DELETE"])
@admin_required
def delete_song(track_id):
    from src.utils.file_handling import delete_track
    from src.utils.status_checks import remove_from_queue
    deleted = delete_track(track_id)
    if deleted:
        remove_from_queue(track_id)
        execute_db("DELETE FROM processing_failures WHERE track_id = ?", [track_id])
        return jsonify({"success": True})
    # Even if files don't exist, clean up queue and DB
    remove_from_queue(track_id)
    execute_db("DELETE FROM processing_failures WHERE track_id = ?", [track_id])
    return jsonify({"success": True})


@admin_bp.route("/songs/<track_id>/reprocess", methods=["POST"])
@admin_required
def reprocess_song(track_id):
    from flask import current_app, request as flask_request
    from src.routes.track import process_track
    from src.utils.status_checks import set_processing_status
    from src.utils.constants import STATUS_METADATA, PROGRESS
    from src.utils.file_handling import get_song_dir, get_track_file_path
    import threading

    app = current_app._get_current_object()

    # Determine which stage to start from
    data = flask_request.get_json(silent=True) or {}
    from_stage = data.get("from_stage", "all")

    # Map stages to files that need to be deleted to force re-run
    stage_artifacts = {
        "splitting": ["vocals", "no_vocals", "lyrics_raw", "lyrics"],
        "lyrics": ["lyrics_raw", "lyrics"],
        "processing": ["lyrics"],
    }

    if from_stage in stage_artifacts:
        song_dir = get_song_dir(track_id)
        for file_key in stage_artifacts[from_stage]:
            path = get_track_file_path(track_id, file_key)
            if os.path.exists(path):
                os.remove(path)
        # Also remove reference_lyrics.json if re-running lyrics stage
        if from_stage in ("splitting", "lyrics"):
            ref_lyrics_path = os.path.join(song_dir, "reference_lyrics.json")
            if os.path.exists(ref_lyrics_path):
                os.remove(ref_lyrics_path)

    set_processing_status(track_id, STATUS_METADATA, PROGRESS[STATUS_METADATA], "Reprocessing...")

    t = threading.Thread(target=process_track, args=(track_id, app), daemon=True)
    t.start()

    return jsonify({"success": True, "message": f"Reprocessing started (from: {from_stage})"})


@admin_bp.route("/status/checks", methods=["POST"])
@admin_required
def run_checks():
    from src.utils.status_checks import run_health_checks

    results = run_health_checks()

    # Save to database
    for component, data in results.items():
        insert_db(
            "INSERT INTO system_status (component, status, message) VALUES (?, ?, ?)",
            [component, data["status"], data["message"]],
        )

    return jsonify(results)


@admin_bp.route("/status/history")
@admin_required
def status_history():
    rows = query_db("SELECT * FROM system_status ORDER BY checked_at DESC LIMIT 100")
    return jsonify([{
        "id": r["id"],
        "component": r["component"],
        "status": r["status"],
        "message": r["message"],
        "checked_at": r["checked_at"],
    } for r in rows])


@admin_bp.route("/status/queue")
@admin_required
def processing_queue():
    from src.utils.status_checks import get_processing_status
    return jsonify(get_processing_status())


@admin_bp.route("/status/unfinished")
@admin_required
def unfinished_tracks():
    from src.utils.file_handling import get_all_track_ids, is_track_complete, load_metadata
    failures = query_db("SELECT * FROM processing_failures ORDER BY updated_at DESC")

    result = []
    for f in failures:
        meta = load_metadata(f["track_id"])
        result.append({
            "track_id": f["track_id"],
            "title": meta.get("title", "Unknown") if meta else "Unknown",
            "artist": meta.get("artist", "Unknown") if meta else "Unknown",
            "stage": f["stage"],
            "error_message": f["error_message"],
            "failure_count": f["failure_count"],
            "updated_at": f["updated_at"],
            "complete": is_track_complete(f["track_id"]),
        })
    return jsonify(result)


@admin_bp.route("/logs")
@admin_required
def app_logs_list():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    level_filter = request.args.get("level", "")
    source_filter = request.args.get("source", "")

    offset = (page - 1) * per_page
    query = "SELECT * FROM app_logs WHERE 1=1"
    args = []

    if level_filter:
        query += " AND level = ?"
        args.append(level_filter)
    if source_filter:
        query += " AND source = ?"
        args.append(source_filter)

    count_query = query.replace("SELECT *", "SELECT COUNT(*) as c")
    total = query_db(count_query, args, one=True)["c"]

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    args.extend([per_page, offset])

    rows = query_db(query, args)
    return jsonify({
        "logs": [{
            "id": r["id"],
            "level": r["level"],
            "source": r["source"],
            "message": r["message"],
            "details": r["details"],
            "track_id": r["track_id"],
            "username": r["username"],
            "created_at": r["created_at"],
        } for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    })


@admin_bp.route("/logs/clear", methods=["DELETE"])
@admin_required
def clear_logs():
    execute_db("DELETE FROM app_logs")
    return jsonify({"success": True})


@admin_bp.route("/errors")
@admin_required
def error_log_list():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))
    type_filter = request.args.get("type", "")
    resolved_filter = request.args.get("resolved", "")

    offset = (page - 1) * per_page
    query = "SELECT * FROM error_log WHERE 1=1"
    args = []

    if type_filter:
        query += " AND error_type = ?"
        args.append(type_filter)
    if resolved_filter != "":
        query += " AND resolved = ?"
        args.append(int(resolved_filter))

    count_query = query.replace("SELECT *", "SELECT COUNT(*) as c")
    total = query_db(count_query, args, one=True)["c"]

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    args.extend([per_page, offset])

    rows = query_db(query, args)
    return jsonify({
        "errors": [{
            "id": r["id"],
            "error_type": r["error_type"],
            "source": r["source"],
            "error_message": r["error_message"],
            "stack_trace": r["stack_trace"],
            "track_id": r["track_id"],
            "request_method": r["request_method"],
            "request_path": r["request_path"],
            "user_id": r["user_id"],
            "username": r["username"],
            "resolved": bool(r["resolved"]),
            "resolved_at": r["resolved_at"],
            "created_at": r["created_at"],
        } for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
    })


@admin_bp.route("/errors/<int:error_id>/resolve", methods=["POST"])
@admin_required
def resolve_error(error_id):
    row = query_db("SELECT resolved FROM error_log WHERE id = ?", [error_id], one=True)
    if not row:
        return jsonify({"error": "Not found"}), 404
    new_val = 0 if row["resolved"] else 1
    resolved_at = datetime.now(timezone.utc).isoformat() if new_val else None
    execute_db(
        "UPDATE error_log SET resolved = ?, resolved_at = ? WHERE id = ?",
        [new_val, resolved_at, error_id],
    )
    return jsonify({"success": True, "resolved": bool(new_val)})


@admin_bp.route("/errors/resolved", methods=["DELETE"])
@admin_required
def clear_resolved_errors():
    execute_db("DELETE FROM error_log WHERE resolved = 1")
    return jsonify({"success": True})


@admin_bp.route("/songs/compress", methods=["POST"])
@admin_required
def compress_songs():
    from flask import current_app
    import threading

    app = current_app._get_current_object()

    def _run_compress():
        with app.app_context():
            from src.utils.file_handling import (
                get_all_track_ids, get_track_file_path, compress_audio_file, get_audio_bitrate
            )
            from src.utils.error_logging import log_event

            track_ids = get_all_track_ids()
            compressed = 0
            skipped = 0
            failed = 0

            for tid in track_ids:
                for file_key in ("vocals", "no_vocals"):
                    path = get_track_file_path(tid, file_key)
                    if not os.path.exists(path):
                        continue
                    bitrate = get_audio_bitrate(path)
                    if bitrate is not None and bitrate <= 160:
                        skipped += 1
                        continue
                    try:
                        compress_audio_file(path)
                        compressed += 1
                    except Exception as e:
                        print(f"Failed to compress {file_key} for track {tid}: {e}")
                        failed += 1

            log_event(
                "info", "admin",
                f"Bulk compress complete: {compressed} files compressed, {skipped} skipped, {failed} failed"
            )

    t = threading.Thread(target=_run_compress, daemon=True)
    t.start()

    return jsonify({"success": True, "message": "Compression started in background"})
