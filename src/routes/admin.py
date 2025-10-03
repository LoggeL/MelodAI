from flask import (
    Blueprint,
    jsonify,
    request,
    session,
    send_from_directory,
)
import secrets
import shutil
import os
from ..models.db import get_db
from ..utils.decorators import admin_required
from ..models.db import create_invite_key
from ..utils.status_checks import (
    run_all_checks,
    get_processing_queue,
    get_unfinished_songs,
    save_status_check,
    add_to_processing_queue,
    is_track_in_queue,
    remove_from_processing_queue,
    update_queue_item_status,
)
from ..utils.constants import STATUS_ERROR
import time

admin_bp = Blueprint("admin", __name__)


@admin_bp.route("/admin/me", methods=["GET"])
@admin_required
def get_current_admin():
    """Get current admin user info"""
    return jsonify({"user_id": session.get("user_id")})


@admin_bp.route("/admin/users", methods=["GET"])
@admin_required
def list_users():
    db = get_db()
    users = db.execute(
        """
        SELECT id, username, is_approved, is_admin, created_at, 
               last_online,
               (SELECT COUNT(*) FROM usage_logs WHERE user_id = users.id) as activity_count
        FROM users
        ORDER BY last_online DESC
    """
    ).fetchall()
    return jsonify([dict(user) for user in users])


@admin_bp.route("/admin/users/<int:user_id>/approve", methods=["POST"])
@admin_required
def approve_user(user_id):
    db = get_db()
    db.execute("UPDATE users SET is_approved = TRUE WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "User approved"})


@admin_bp.route("/admin/users/<int:user_id>/promote", methods=["POST"])
@admin_required
def promote_user(user_id):
    """Promote a user to admin"""
    db = get_db()

    # Prevent promoting yourself (optional safety check)
    if user_id == session.get("user_id"):
        return jsonify({"error": "Cannot modify your own admin status"}), 400

    db.execute("UPDATE users SET is_admin = TRUE WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "User promoted to admin"})


@admin_bp.route("/admin/users/<int:user_id>/demote", methods=["POST"])
@admin_required
def demote_user(user_id):
    """Demote a user from admin"""
    db = get_db()

    # Prevent demoting yourself
    if user_id == session.get("user_id"):
        return jsonify({"error": "Cannot modify your own admin status"}), 400

    db.execute("UPDATE users SET is_admin = FALSE WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "User demoted from admin"})


@admin_bp.route("/admin/users/<int:user_id>", methods=["DELETE"])
@admin_required
def delete_user(user_id):
    """Delete a user account"""
    db = get_db()

    # Prevent deleting yourself
    if user_id == session.get("user_id"):
        return jsonify({"error": "Cannot delete your own account"}), 400

    # Delete user's usage logs first (foreign key constraint)
    db.execute("DELETE FROM usage_logs WHERE user_id = ?", (user_id,))

    # Delete the user
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    db.commit()

    return jsonify({"message": "User deleted successfully"})


@admin_bp.route("/admin/invite-keys", methods=["POST"])
@admin_required
def create_invite_key_route():
    key = secrets.token_urlsafe(16)  # Generate a secure random key
    create_invite_key(session["user_id"], key)
    return jsonify({"key": key})


@admin_bp.route("/admin/usage", methods=["GET"])
@admin_required
def get_usage_logs():
    db = get_db()

    # Get query parameters
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    action = request.args.get("action")
    username = request.args.get("username")

    # Build the query
    query = """
        SELECT u.username, l.track_id, l.action, l.created_at 
        FROM usage_logs l 
        JOIN users u ON l.user_id = u.id 
        WHERE 1=1
    """
    params = []

    if action:
        query += " AND l.action = ?"
        params.append(action)
    if username:
        query += " AND u.username LIKE ?"
        params.append(f"%{username}%")

    # Get total count
    count_query = query.replace(
        "u.username, l.track_id, l.action, l.created_at", "COUNT(*)"
    )
    total = db.execute(count_query, params).fetchone()[0]

    # Add pagination
    query += " ORDER BY l.created_at DESC LIMIT ? OFFSET ?"
    params.extend([per_page, (page - 1) * per_page])

    # Execute final query
    logs = db.execute(query, params).fetchall()

    return jsonify(
        {
            "logs": [dict(log) for log in logs],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }
    )


@admin_bp.route("/admin/stats", methods=["GET"])
@admin_required
def get_usage_stats():
    db = get_db()

    stats = {
        "total_users": db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "total_downloads": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'download'"
        ).fetchone()[0],
        "total_searches": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'search'"
        ).fetchone()[0],
        "total_random_plays": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'random_play'"
        ).fetchone()[0],
        "most_active_user": db.execute(
            """
            SELECT u.username, COUNT(*) as count 
            FROM usage_logs l 
            JOIN users u ON l.user_id = u.id 
            GROUP BY u.id 
            ORDER BY count DESC 
            LIMIT 1
        """
        ).fetchone(),
    }

    if stats["most_active_user"]:
        stats["most_active_user"] = dict(stats["most_active_user"])

    return jsonify(stats)


@admin_bp.route("/admin/invite-keys", methods=["GET"])
@admin_required
def list_invite_keys():
    db = get_db()
    keys = db.execute(
        """
        SELECT 
            ik.key, 
            ik.created_at,
            creator.username as created_by,
            user.username as used_by,
            ik.used_at
        FROM invite_keys ik
        JOIN users creator ON ik.created_by = creator.id
        LEFT JOIN users user ON ik.used_by = user.id
        ORDER BY ik.created_at DESC
    """
    ).fetchall()
    return jsonify([dict(key) for key in keys])


@admin_bp.route("/admin/status", methods=["GET"])
@admin_required
def show_status_page():
    """Render the system status page for admins"""
    return send_from_directory("static", "status.html")


@admin_bp.route("/admin/status/check", methods=["GET", "POST"])
@admin_required
def check_system_status():
    """Run system status checks and return results"""
    db = get_db()

    # Run all system checks
    check_results = run_all_checks(session.get("user_id"))

    # For each component, get the last 90 days of history
    for check in check_results:
        history = db.execute(
            """
            SELECT status, details, last_checked
            FROM system_status
            WHERE component = ?
            AND last_checked >= datetime('now', '-90 days')
            ORDER BY last_checked ASC
        """,
            (check["component"],),
        ).fetchall()

        # Calculate uptime percentage
        total_checks = len(history) if history else 1
        ok_checks = (
            sum(1 for h in history if h["status"] == "OK")
            if history
            else (1 if check["status"] == "OK" else 0)
        )
        uptime = (ok_checks / total_checks) * 100

        # Add history and uptime to check results
        check["history"] = [dict(h) for h in history]
        check["uptime"] = f"{uptime:.2f}%"
        check["last_checked"] = (
            check["history"][-1]["last_checked"] if history else None
        )

    # Return the results as JSON
    return jsonify(
        {"checks": check_results, "timestamp": request.args.get("timestamp")}
    )


@admin_bp.route("/admin/status/history", methods=["GET"])
@admin_required
def get_status_history():
    """Get historical status check data"""
    db = get_db()

    # Get query parameters
    component = request.args.get("component")
    limit = request.args.get("limit", 50, type=int)

    # Build the query
    query = """
        SELECT 
            s.id,
            s.component,
            s.status,
            s.details,
            s.last_checked,
            u.username as checked_by
        FROM system_status s
        LEFT JOIN users u ON s.checked_by = u.id
        WHERE 1=1
    """
    params = []

    if component:
        query += " AND s.component = ?"
        params.append(component)

    # Add sorting and limit
    query += " ORDER BY s.last_checked DESC LIMIT ?"
    params.append(limit)

    # Execute the query
    history = db.execute(query, params).fetchall()

    # Get list of unique components for filtering
    components = db.execute(
        "SELECT DISTINCT component FROM system_status ORDER BY component"
    ).fetchall()

    return jsonify(
        {
            "history": [dict(item) for item in history],
            "components": [item["component"] for item in components],
        }
    )


@admin_bp.route("/admin/status/queue", methods=["GET"])
@admin_required
def get_track_queue():
    """Get the current track processing queue"""
    # Get the current processing queue
    queue = get_processing_queue()

    # Format the queue data for display
    formatted_queue = []
    for track_id, info in queue.items():
        # Calculate elapsed time
        elapsed_seconds = time.time() - info.get("start_time", 0)
        elapsed_minutes = elapsed_seconds // 60
        elapsed_seconds = elapsed_seconds % 60

        # Format queue item
        formatted_item = {
            "track_id": track_id,
            "title": info.get("metadata", {}).get("title", "Unknown"),
            "artist": info.get("metadata", {}).get("artist", "Unknown"),
            "status": info.get("status", "unknown"),
            "progress": info.get("progress", 0),
            "elapsed_time": f"{int(elapsed_minutes)}m {int(elapsed_seconds)}s",
            "start_time": info.get("start_time", 0),
        }
        formatted_queue.append(formatted_item)

    # Sort by start time (oldest first)
    formatted_queue.sort(key=lambda x: x.get("start_time", 0))

    return jsonify({"queue": formatted_queue})


@admin_bp.route("/admin/status/unfinished", methods=["GET"])
@admin_required
def get_unfinished_songs_list():
    """Get the list of unfinished songs that can be reprocessed"""
    db = get_db()
    unfinished_songs = get_unfinished_songs()

    # Add failure count information to each song
    for song in unfinished_songs:
        failure_info = db.execute(
            "SELECT failure_count, error_message FROM processing_failures WHERE track_id = ?",
            (song["track_id"],)
        ).fetchone()
        
        song["failure_count"] = failure_info["failure_count"] if failure_info else 0
        song["error_message"] = failure_info["error_message"] if failure_info else None
        song["last_modified"] = time.strftime(
            "%Y-%m-%d %H:%M:%S", time.localtime(song["last_modified"])
        )

    return jsonify({"unfinished_songs": unfinished_songs})


@admin_bp.route("/admin/status/reprocess", methods=["POST"])
@admin_required
def reprocess_track():
    """Reprocess a track that was not completed successfully"""
    data = request.get_json()
    track_id = data.get("track_id")

    if not track_id:
        return jsonify({"error": "Missing track ID"}), 400

    # Check if track is already being processed
    if is_track_in_queue(track_id):
        return (
            jsonify({"error": "Track is already being processed", "in_queue": True}),
            400,
        )

    # Import here to avoid circular imports
    from ..routes.track import de_add_track
    import threading
    from flask import current_app
    import json as json_lib
    import os

    # Store user_id from session before starting the thread
    user_id = session.get("user_id")

    # Try to get existing metadata
    metadata_path = f"src/songs/{track_id}/metadata.json"
    metadata = {}

    if os.path.isfile(metadata_path) and os.path.getsize(metadata_path) > 0:
        try:
            with open(metadata_path, "r") as f:
                metadata = json_lib.load(f)
        except Exception as e:
            print(f"Error loading metadata: {e}")

    # Add to processing queue BEFORE starting the thread
    add_to_processing_queue(track_id, metadata)

    # Start reprocessing in background
    def process_track(app, track_id, user_id):
        with app.app_context():
            try:
                save_status_check(
                    "Track Reprocessing",
                    "OK",
                    f"Started reprocessing track {track_id} manually",
                    user_id,
                )
                de_add_track(track_id)
                # Status updates are stored in database instead of socket emit
                update_queue_item_status(track_id, "complete", 100)
            except Exception as e:
                print(f"Error reprocessing track {track_id}:", e)
                # Update error status in database
                update_queue_item_status(track_id, "error", 0)

                # Log the processing error
                save_status_check(
                    "Track Reprocessing",
                    STATUS_ERROR,
                    f"Failed to reprocess track {track_id}: {str(e)}",
                    user_id,
                )

                # Track the failure in database
                db = get_db()
                db.execute(
                    """
                    INSERT INTO processing_failures (track_id, failure_count, error_message)
                    VALUES (?, 1, ?)
                    ON CONFLICT(track_id) DO UPDATE SET
                        failure_count = failure_count + 1,
                        last_failure = CURRENT_TIMESTAMP,
                        error_message = ?
                    """,
                    (track_id, str(e), str(e))
                )
                db.commit()

                # Ensure cleanup on error
                remove_from_processing_queue(track_id)

    # Start processing in a new thread with app instance and user_id
    thread = threading.Thread(
        target=process_track,
        args=(current_app._get_current_object(), track_id, user_id),
    )
    thread.daemon = True  # Make thread daemon so it doesn't prevent app shutdown
    thread.start()

    return jsonify(
        {"success": True, "message": f"Track {track_id} reprocessing started"}
    )


@admin_bp.route("/admin/track/<track_id>", methods=["DELETE"])
@admin_required
def delete_track(track_id):
    """Delete a failed track and all its associated files"""
    db = get_db()
    
    # Get failure count to verify this track has failed
    failure_info = db.execute(
        "SELECT failure_count FROM processing_failures WHERE track_id = ?",
        (track_id,)
    ).fetchone()
    
    if not failure_info:
        return jsonify({"error": "Track has no failure record"}), 400
    
    try:
        # Delete the track directory if it exists
        track_dir = f"src/songs/{track_id}"
        if os.path.exists(track_dir):
            shutil.rmtree(track_dir)
        
        # Remove from processing failures table
        db.execute("DELETE FROM processing_failures WHERE track_id = ?", (track_id,))
        
        # Remove any usage logs for this track
        db.execute("DELETE FROM usage_logs WHERE track_id = ?", (track_id,))
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "message": f"Track {track_id} deleted successfully"
        })
    except Exception as e:
        return jsonify({"error": f"Failed to delete track: {str(e)}"}), 500


@admin_bp.route("/admin/songs", methods=["GET"])
@admin_required
def show_songs_page():
    """Render the songs management page for admins"""
    return send_from_directory("static", "admin_songs.html")


@admin_bp.route("/admin/songs/list", methods=["GET"])
@admin_required
def list_all_songs():
    """Get all songs in the library with metadata"""
    import json
    from pathlib import Path
    
    songs_dir = Path("src/songs")
    if not songs_dir.exists():
        return jsonify({"songs": [], "count": 0})
    
    songs = []
    
    # Get all song directories
    for song_dir in songs_dir.iterdir():
        if not song_dir.is_dir():
            continue
        
        track_id = song_dir.name
        metadata_file = song_dir / "metadata.json"
        
        # Check if song has metadata
        if metadata_file.exists():
            try:
                with open(metadata_file, "r") as f:
                    metadata = json.load(f)
                
                # Check file existence
                has_song = (song_dir / "song.mp3").exists()
                has_vocals = (song_dir / "vocals.mp3").exists()
                has_no_vocals = (song_dir / "no_vocals.mp3").exists()
                has_lyrics = (song_dir / "lyrics.json").exists()
                
                # Calculate total size
                total_size = 0
                for file in song_dir.glob("*"):
                    if file.is_file():
                        total_size += file.stat().st_size
                
                songs.append({
                    "track_id": track_id,
                    "title": metadata.get("title", "Unknown"),
                    "artist": metadata.get("artist", "Unknown"),
                    "album": metadata.get("album", "Unknown"),
                    "duration": metadata.get("duration", 0),
                    "cover": metadata.get("cover", ""),
                    "has_song": has_song,
                    "has_vocals": has_vocals,
                    "has_no_vocals": has_no_vocals,
                    "has_lyrics": has_lyrics,
                    "size_mb": round(total_size / (1024 * 1024), 2),
                    "last_modified": song_dir.stat().st_mtime,
                })
            except Exception as e:
                print(f"Error reading metadata for {track_id}: {e}")
                continue
    
    # Sort by title
    songs.sort(key=lambda x: x["title"].lower())
    
    return jsonify({"songs": songs, "count": len(songs)})


@admin_bp.route("/admin/songs/<track_id>", methods=["DELETE"])
@admin_required
def delete_any_song(track_id):
    """Delete any song and all its associated files (admin only)"""
    db = get_db()
    
    try:
        # Check if the track directory exists
        track_dir = f"src/songs/{track_id}"
        if not os.path.exists(track_dir):
            return jsonify({"error": "Track not found"}), 404
        
        # Delete the track directory
        shutil.rmtree(track_dir)
        
        # Remove from processing failures table if exists
        db.execute("DELETE FROM processing_failures WHERE track_id = ?", (track_id,))
        
        # Remove any usage logs for this track
        db.execute("DELETE FROM usage_logs WHERE track_id = ?", (track_id,))
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "message": f"Track {track_id} deleted successfully"
        })
    except Exception as e:
        return jsonify({"error": f"Failed to delete track: {str(e)}"}), 500
