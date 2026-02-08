import os
import secrets
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, make_response
from werkzeug.security import generate_password_hash, check_password_hash
from src.models.db import query_db, execute_db, insert_db
from src.services.email import send_password_reset_email
from src.utils.decorators import login_required

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "")
    invite_key = data.get("invite_key", "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400

    existing = query_db("SELECT id FROM users WHERE username = ?", [username], one=True)
    if existing:
        return jsonify({"error": "Username already taken"}), 409
    if email:
        existing_email = query_db("SELECT id FROM users WHERE email = ?", [email], one=True)
        if existing_email:
            return jsonify({"error": "Email already in use"}), 409

    # First user becomes admin and is auto-approved
    user_count = query_db("SELECT COUNT(*) as c FROM users", one=True)["c"]
    is_first = user_count == 0
    is_admin = 1 if is_first else 0
    is_approved = 1 if is_first else 0

    # Check invite key
    if not is_first and invite_key:
        key_row = query_db(
            "SELECT * FROM invite_keys WHERE key = ? AND used_by IS NULL",
            [invite_key],
            one=True,
        )
        if key_row:
            is_approved = 1
            execute_db(
                "UPDATE invite_keys SET used_by = ?, used_at = ? WHERE id = ?",
                [username, datetime.utcnow().isoformat(), key_row["id"]],
            )
        else:
            return jsonify({"error": "Invalid invite key"}), 400

    display_name = data.get("display_name", "").strip() or username
    password_hash = generate_password_hash(password)
    user_id = insert_db(
        "INSERT INTO users (username, email, display_name, password_hash, is_admin, is_approved) VALUES (?, ?, ?, ?, ?, ?)",
        [username, email or None, display_name, password_hash, is_admin, is_approved],
    )

    from src.utils.error_logging import log_event
    log_event("info", "auth", f"New user registered: '{username}'" + (" (approved)" if is_approved else " (pending)"), user_id=user_id, username=username)

    if is_approved:
        session.permanent = True
        session["user_id"] = user_id
        return jsonify({
            "success": True,
            "message": "Registration successful",
            "is_admin": bool(is_admin),
        })
    else:
        return jsonify({
            "success": True,
            "message": "Registration submitted. Waiting for admin approval.",
            "pending": True,
        })


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    remember = data.get("remember", False)

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    user = query_db("SELECT * FROM users WHERE username = ? OR email = ?", [username, username], one=True)
    if not user or not check_password_hash(user["password_hash"], password):
        from src.utils.error_logging import log_event
        log_event("warning", "auth", f"Failed login attempt for '{username}'")
        return jsonify({"error": "Invalid credentials"}), 401

    if not user["is_approved"]:
        return jsonify({"error": "Account pending approval"}), 403

    session.permanent = True
    session["user_id"] = user["id"]

    # Update last_online
    execute_db("UPDATE users SET last_online = ? WHERE id = ?",
               [datetime.utcnow().isoformat(), user["id"]])

    resp_data = {
        "success": True,
        "username": user["username"],
        "display_name": user["display_name"] or user["username"],
        "is_admin": bool(user["is_admin"]),
    }

    from src.utils.error_logging import log_event
    log_event("info", "auth", f"User '{user['username']}' logged in", user_id=user["id"], username=user["username"])

    response = make_response(jsonify(resp_data))

    if remember:
        token = secrets.token_urlsafe(48)
        expires = datetime.utcnow() + timedelta(days=30)
        insert_db(
            "INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
            [user["id"], token, expires.isoformat()],
        )
        response.set_cookie("auth_token", token, max_age=30 * 86400, httponly=True, samesite="Lax")

    return response


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    response = make_response(jsonify({"success": True}))
    response.delete_cookie("auth_token")
    return response


@auth_bp.route("/check")
def check():
    from src.utils.decorators import _get_current_user

    user = _get_current_user()
    if user:
        # Update last_online
        execute_db("UPDATE users SET last_online = ? WHERE id = ?",
                   [datetime.utcnow().isoformat(), user["id"]])
        return jsonify({
            "authenticated": True,
            "username": user["username"],
            "display_name": user["display_name"] or user["username"],
            "is_admin": bool(user["is_admin"]),
            "credits": user["credits"] or 0,
        })
    return jsonify({"authenticated": False})


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json()
    username = data.get("username", "").strip()

    if not username:
        return jsonify({"error": "Username required"}), 400

    user = query_db("SELECT * FROM users WHERE username = ? OR email = ?", [username, username], one=True)
    if not user:
        # Don't reveal if user exists
        return jsonify({"success": True, "message": "If the account exists, a reset email has been sent."})

    token = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(hours=1)
    insert_db(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
        [user["id"], token, expires.isoformat()],
    )

    # Send email to the user's email address
    email_addr = user["email"] or user["username"]
    send_password_reset_email(email_addr, token)

    return jsonify({"success": True, "message": "If the account exists, a reset email has been sent."})


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json()
    token = data.get("token", "").strip()
    new_password = data.get("password", "")

    if not token or not new_password:
        return jsonify({"error": "Token and new password required"}), 400
    if len(new_password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400

    reset = query_db(
        "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?",
        [token, datetime.utcnow().isoformat()],
        one=True,
    )
    if not reset:
        return jsonify({"error": "Invalid or expired reset token"}), 400

    password_hash = generate_password_hash(new_password)
    execute_db("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash, reset["user_id"]])
    execute_db("UPDATE password_resets SET used = 1 WHERE id = ?", [reset["id"]])

    return jsonify({"success": True, "message": "Password reset successful"})


@auth_bp.route("/profile")
def profile():
    from src.utils.decorators import _get_current_user

    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    return jsonify({
        "username": user["username"],
        "display_name": user["display_name"] or user["username"],
        "is_admin": bool(user["is_admin"]),
        "created_at": user["created_at"],
    })


@auth_bp.route("/profile/stats")
@login_required
def profile_stats():
    from src.utils.decorators import _get_current_user

    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    user_id = user["id"]

    songs = query_db(
        "SELECT COUNT(*) as c FROM usage_logs WHERE user_id = ? AND action = 'download'",
        [user_id], one=True
    )
    plays = query_db(
        "SELECT COUNT(*) as c FROM usage_logs WHERE user_id = ? AND action = 'play'",
        [user_id], one=True
    )
    playlists = query_db(
        "SELECT COUNT(*) as c FROM playlists WHERE user_id = ?",
        [user_id], one=True
    )
    favs = query_db(
        "SELECT COUNT(*) as c FROM favorites WHERE user_id = ?",
        [user_id], one=True
    )

    return jsonify({
        "credits": user["credits"] or 0,
        "songs_processed": songs["c"] if songs else 0,
        "total_plays": plays["c"] if plays else 0,
        "playlists_count": playlists["c"] if playlists else 0,
        "favorites_count": favs["c"] if favs else 0,
        "member_since": user["created_at"],
        "display_name": user["display_name"] or user["username"],
        "username": user["username"],
        "is_admin": bool(user["is_admin"]),
    })


@auth_bp.route("/profile/activity")
@login_required
def profile_activity():
    from src.utils.decorators import _get_current_user
    from src.utils.file_handling import load_metadata

    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    user_id = user["id"]
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))
    offset = (page - 1) * per_page

    # Optional filters
    action_filter = request.args.get("action", "")  # "play" or "download"
    sort = request.args.get("sort", "date_desc")  # date_desc, date_asc

    where = "user_id = ? AND action IN ('play', 'download')"
    params: list = [user_id]
    if action_filter in ("play", "download"):
        where = "user_id = ? AND action = ?"
        params = [user_id, action_filter]

    total = query_db(
        f"SELECT COUNT(*) as c FROM usage_logs WHERE {where}",
        params, one=True
    )["c"]

    order = "created_at DESC"
    if sort == "date_asc":
        order = "created_at ASC"

    rows = query_db(
        f"SELECT action, detail, created_at FROM usage_logs WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        params + [per_page, offset]
    )

    # Resolve track metadata (cache per request to avoid repeated disk reads)
    meta_cache: dict = {}
    items = []
    for r in rows:
        track_id = r["detail"]
        if track_id not in meta_cache:
            meta = load_metadata(track_id)
            meta_cache[track_id] = meta
        meta = meta_cache[track_id]
        img_url = ""
        if meta:
            img_url = meta.get("img_url", "")
            if img_url:
                img_url = img_url.replace("/56x56", "/200x200", 1)
        items.append({
            "action": r["action"],
            "track_id": track_id,
            "title": meta.get("title", "Unknown") if meta else "Unknown",
            "artist": meta.get("artist", "Unknown") if meta else "Unknown",
            "img_url": img_url,
            "cost": 5 if r["action"] == "download" else 1,
            "created_at": r["created_at"],
        })

    return jsonify({
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
    })


@auth_bp.route("/change-password", methods=["POST"])
@login_required
def change_password():
    from src.utils.decorators import _get_current_user

    user = _get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")

    if not current_password or not new_password:
        return jsonify({"error": "Both passwords required"}), 400
    if len(new_password) < 4:
        return jsonify({"error": "New password must be at least 4 characters"}), 400
    if not check_password_hash(user["password_hash"], current_password):
        return jsonify({"error": "Current password is incorrect"}), 401

    new_hash = generate_password_hash(new_password)
    execute_db("UPDATE users SET password_hash = ? WHERE id = ?", [new_hash, user["id"]])

    return jsonify({"success": True, "message": "Password changed successfully"})
