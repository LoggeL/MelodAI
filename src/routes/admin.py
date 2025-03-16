from flask import (
    Blueprint,
    jsonify,
    request,
    session,
    render_template,
    redirect,
    url_for,
    send_from_directory,
)
import secrets
from ..models.db import get_db
from ..utils.decorators import admin_required
from ..models.db import create_invite_key
from ..utils.status_checks import (
    run_all_checks,
    get_processing_queue,
    get_unfinished_songs,
    save_status_check,
    STATUS_ERROR,
)
import time

admin_bp = Blueprint("admin", __name__)


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
    unfinished_songs = get_unfinished_songs()

    # Format timestamps to readable format
    for song in unfinished_songs:
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

    # Import here to avoid circular imports
    from ..routes.track import de_add_track
    import threading
    from flask import current_app
    from ..utils.status_checks import update_queue_item_status

    # Store user_id from session before starting the thread
    user_id = session.get("user_id")

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

    # Start processing in a new thread with app instance and user_id
    thread = threading.Thread(
        target=process_track,
        args=(current_app._get_current_object(), track_id, user_id),
    )
    thread.start()

    return jsonify(
        {"success": True, "message": f"Track {track_id} reprocessing started"}
    )


# Temporary route to promote a user to admin status - remove in production
@admin_bp.route("/admin/promote/<int:user_id>", methods=["GET"])
def promote_to_admin(user_id):
    """Temporary route to promote a user to admin status"""
    try:
        db = get_db()
        db.execute(
            """
            UPDATE users SET is_admin = 1 WHERE id = ?
            """,
            (user_id,),
        )
        db.commit()
        return jsonify(
            {"success": True, "message": f"User {user_id} promoted to admin"}
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500
