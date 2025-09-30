from flask import Blueprint, jsonify, request, session
import secrets
from ..models.db import get_db
from ..utils.decorators import admin_required
from ..models.db import create_invite_key

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
    keys = db.execute("""
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
    """).fetchall()
    return jsonify([dict(key) for key in keys])


@admin_bp.route("/admin/failed-tracks", methods=["GET"])
@admin_required
def list_failed_tracks():
    db = get_db()
    failed_tracks = db.execute("""
        SELECT 
            id,
            track_id, 
            error_message,
            failure_count,
            last_attempt,
            created_at
        FROM track_failures
        ORDER BY failure_count DESC, last_attempt DESC
    """).fetchall()
    return jsonify([dict(track) for track in failed_tracks])


@admin_bp.route("/admin/failed-tracks/<track_id>", methods=["DELETE"])
@admin_required
def delete_failed_track(track_id):
    import shutil
    import os
    
    db = get_db()
    
    # Delete from database
    db.execute("DELETE FROM track_failures WHERE track_id = ?", (track_id,))
    db.commit()
    
    # Delete track folder if it exists
    track_path = f"src/songs/{track_id}"
    if os.path.exists(track_path):
        try:
            shutil.rmtree(track_path)
        except Exception as e:
            print(f"Error deleting track folder: {e}")
    
    return jsonify({"message": "Track deleted successfully"})
