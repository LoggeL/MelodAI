import os
from src.utils.validation import json_object, text_field, boolean_field
import secrets
import time
import threading
from collections import deque
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, make_response, current_app
from werkzeug.security import generate_password_hash, check_password_hash
from src.models.db import query_db, execute_db, insert_db, transaction
from src.services.email import send_password_reset_email
from src.utils.decorators import login_required

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

MIN_PASSWORD_LENGTH = 8
LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60
MAX_LOGIN_ATTEMPTS = 8
_login_lock = threading.Lock()


def _password_length_error(prefix="Password"):
    return f"{prefix} must be at least {MIN_PASSWORD_LENGTH} characters"


def _login_rate_key(username):
    # Only trust Flask's peer address. Forwarding headers require a trusted
    # reverse-proxy configuration; accepting arbitrary X-Forwarded-For bypasses limits.
    return f"{request.remote_addr or 'unknown'}:{username.lower()}"


def _login_attempt_store():
    return current_app.extensions.setdefault("login_attempts", {})


def _is_login_rate_limited(username):
    now = time.monotonic()
    with _login_lock:
        store = _login_attempt_store()
        for key in list(store):
            attempts = store[key]
            while attempts and now - attempts[0] > LOGIN_ATTEMPT_WINDOW_SECONDS:
                attempts.popleft()
            if not attempts:
                del store[key]
        return len(store.get(_login_rate_key(username), ())) >= MAX_LOGIN_ATTEMPTS


def _record_failed_login(username):
    with _login_lock:
        store = _login_attempt_store()
        if len(store) >= 10000:
            store.pop(next(iter(store)))
        store.setdefault(_login_rate_key(username), deque()).append(time.monotonic())


def _clear_failed_logins(username):
    with _login_lock:
        _login_attempt_store().pop(_login_rate_key(username), None)


@auth_bp.route("/register", methods=["POST"])
def register():
    data = json_object()
    username = text_field(data, "username")
    email = text_field(data, "email")
    password = text_field(data, "password", strip=False)
    invite_key = text_field(data, "invite_key")

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": _password_length_error()}), 400

    display_name = text_field(data, "display_name") or username
    password_hash = generate_password_hash(password)
    # Reserve the writer before checking names or invites. Concurrent requests
    # cannot both bootstrap an admin or consume the same invite.
    with transaction() as db:
        if db.execute("SELECT id FROM users WHERE username = ?", [username]).fetchone():
            return jsonify({"error": "Username already taken"}), 409
        if email and db.execute("SELECT id FROM users WHERE email = ?", [email]).fetchone():
            return jsonify({"error": "Email already in use"}), 409
        is_first = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        is_admin = int(is_first)
        is_approved = int(is_first)
        if not is_first and invite_key:
            claimed = db.execute(
                "UPDATE invite_keys SET used_by = ?, used_at = ? WHERE key = ? AND used_by IS NULL",
                [username, datetime.utcnow().isoformat(), invite_key],
            )
            if claimed.rowcount != 1:
                return jsonify({"error": "Invalid invite key"}), 400
            is_approved = 1
        user_id = db.execute(
            "INSERT INTO users (username, email, display_name, password_hash, is_admin, is_approved) VALUES (?, ?, ?, ?, ?, ?)",
            [username, email or None, display_name, password_hash, is_admin, is_approved],
        ).lastrowid

    from src.utils.error_logging import log_event
    log_event("info", "auth", f"New user registered: '{username}'" + (" (approved)" if is_approved else " (pending)"), user_id=user_id, username=username)

    if is_approved:
        session.clear()
        session["session_version"] = 0
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
    data = json_object()
    username = text_field(data, "username")
    password = text_field(data, "password", strip=False)
    remember = boolean_field(data, "remember")

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    if _is_login_rate_limited(username):
        return jsonify({"error": "Too many failed login attempts. Please try again later."}), 429

    user = query_db("SELECT * FROM users WHERE username = ? OR email = ?", [username, username], one=True)
    if not user or not check_password_hash(user["password_hash"], password):
        from src.utils.error_logging import log_event
        log_event("warning", "auth", f"Failed login attempt for '{username}'")
        _record_failed_login(username)
        return jsonify({"error": "Invalid credentials"}), 401

    if not user["is_approved"]:
        return jsonify({"error": "Account pending approval"}), 403

    token = secrets.token_urlsafe(48) if remember else None
    old_token = request.cookies.get("auth_token")
    # Password verification is expensive, so do it outside the writer lock,
    # then verify the credential snapshot before issuing any new credentials.
    # A concurrent password reset must not leave a newly minted remember token.
    with transaction() as db:
        updated = db.execute(
            """UPDATE users SET last_online = ? WHERE id = ? AND password_hash = ?
               AND session_version = ? AND is_approved = 1""",
            [datetime.utcnow().isoformat(), user["id"], user["password_hash"], user["session_version"]],
        )
        if updated.rowcount != 1:
            return jsonify({"error": "Credentials changed. Please sign in again."}), 401
        if old_token:
            db.execute("DELETE FROM auth_tokens WHERE token = ?", [old_token])
        if token:
            expires = datetime.utcnow() + timedelta(days=30)
            db.execute(
                "INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
                [user["id"], token, expires.isoformat()],
            )

    _clear_failed_logins(username)
    session.clear()
    session["session_version"] = user["session_version"]
    session.permanent = True
    session["user_id"] = user["id"]

    resp_data = {
        "success": True,
        "username": user["username"],
        "display_name": user["display_name"] or user["username"],
        "is_admin": bool(user["is_admin"]),
    }

    from src.utils.error_logging import log_event
    log_event("info", "auth", f"User '{user['username']}' logged in", user_id=user["id"], username=user["username"])

    response = make_response(jsonify(resp_data))

    if token:
        response.set_cookie(
            "auth_token", token, max_age=30 * 86400, httponly=True, samesite="Lax",
            secure=current_app.config["SESSION_COOKIE_SECURE"],
        )
    elif old_token:
        response.delete_cookie("auth_token")

    return response


@auth_bp.route("/logout", methods=["POST"])
def logout():
    # Revoke the remember-me token server-side, not just the cookie —
    # otherwise the token stays valid in the DB for up to 30 days.
    token = request.cookies.get("auth_token")
    if token:
        execute_db("DELETE FROM auth_tokens WHERE token = ?", [token])
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
    data = json_object()
    username = text_field(data, "username")

    if not username:
        return jsonify({"error": "Username required"}), 400

    user = query_db("SELECT * FROM users WHERE username = ? OR email = ?", [username, username], one=True)
    # Don't reveal whether the account exists; accounts without an email
    # can't receive a reset link, so skip sending (a bare username is not
    # a deliverable address) but log it so admins can help out-of-band.
    if not user or not user["email"]:
        if user:
            from src.utils.error_logging import log_event
            log_event("warning", "auth",
                      f"Password reset requested for '{user['username']}' but no email is set",
                      user_id=user["id"], username=user["username"])
        return jsonify({"success": True, "message": "If the account exists, a reset email has been sent."})

    token = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(hours=1)
    insert_db(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
        [user["id"], token, expires.isoformat()],
    )

    if not send_password_reset_email(user["email"], token):
        from src.utils.error_logging import log_event
        log_event("error", "auth",
                  f"Failed to send password reset email for '{user['username']}'",
                  user_id=user["id"], username=user["username"])

    return jsonify({"success": True, "message": "If the account exists, a reset email has been sent."})


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    data = json_object()
    token = text_field(data, "token")
    new_password = text_field(data, "password", strip=False)

    if not token or not new_password:
        return jsonify({"error": "Token and new password required"}), 400
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": _password_length_error()}), 400

    password_hash = generate_password_hash(new_password)
    with transaction() as db:
        reset = db.execute(
            "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?",
            [token, datetime.utcnow().isoformat()],
        ).fetchone()
        if not reset:
            return jsonify({"error": "Invalid or expired reset token"}), 400
        db.execute(
            "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?",
            [password_hash, reset["user_id"]],
        )
        db.execute("DELETE FROM auth_tokens WHERE user_id = ?", [reset["user_id"]])
        db.execute("UPDATE password_resets SET used = 1 WHERE user_id = ?", [reset["user_id"]])

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
    page = max(request.args.get("page", 1, type=int) or 1, 1)
    per_page = min(max(request.args.get("per_page", 20, type=int) or 20, 1), 100)
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

    data = json_object()
    current_password = text_field(data, "current_password", strip=False)
    new_password = text_field(data, "new_password", strip=False)

    if not current_password or not new_password:
        return jsonify({"error": "Both passwords required"}), 400
    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": _password_length_error("New password")}), 400
    if not check_password_hash(user["password_hash"], current_password):
        return jsonify({"error": "Current password is incorrect"}), 401

    new_hash = generate_password_hash(new_password)
    with transaction() as db:
        updated = db.execute(
            "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? AND password_hash = ?",
            [new_hash, user["id"], user["password_hash"]],
        )
        if updated.rowcount != 1:
            return jsonify({"error": "Password changed on another device. Please sign in again."}), 409
        db.execute("DELETE FROM auth_tokens WHERE user_id = ?", [user["id"]])
        db.execute("UPDATE password_resets SET used = 1 WHERE user_id = ?", [user["id"]])
    session["session_version"] = user["session_version"] + 1

    return jsonify({"success": True, "message": "Password changed successfully"})
