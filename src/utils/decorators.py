from functools import wraps
from flask import session, request, jsonify, redirect
from src.models.db import query_db
from datetime import datetime


def _wants_json():
    # fetch() defaults to "Accept: */*" and <audio> sends "audio/*", so the
    # Accept header alone misses most API/file requests — those would get a
    # 302 → 200 HTML page the frontend can't distinguish from success.
    return (
        request.path.startswith(("/api/", "/songs/"))
        or request.headers.get("Accept", "").startswith("application/json")
        or request.is_json
    )


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            if _wants_json():
                return jsonify({"error": "Authentication required"}), 401
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            if _wants_json():
                return jsonify({"error": "Authentication required"}), 401
            return redirect("/login")
        if not user["is_admin"]:
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated


def _get_current_user():
    # Check session first
    user_id = session.get("user_id")
    if user_id:
        user = query_db("SELECT * FROM users WHERE id = ?", [user_id], one=True)
        if user and user["is_approved"] and session.get("session_version", 0) == user["session_version"]:
            return user
        session.clear()

    # Check auth_token cookie (remember me)
    token = request.cookies.get("auth_token")
    if token:
        user = query_db(
            """SELECT users.* FROM users JOIN auth_tokens ON auth_tokens.user_id = users.id
               WHERE auth_tokens.token = ? AND auth_tokens.expires_at > ? AND users.is_approved = 1""",
            [token, datetime.utcnow().isoformat()],
            one=True,
        )
        if user:
            session["user_id"] = user["id"]
            session["session_version"] = user["session_version"]
            session.permanent = True
            return user

    return None
