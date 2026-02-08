from functools import wraps
from flask import session, request, jsonify, redirect
from src.models.db import query_db
from datetime import datetime


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            if request.headers.get("Accept", "").startswith("application/json") or request.is_json:
                return jsonify({"error": "Authentication required"}), 401
            return redirect("/login")
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = _get_current_user()
        if not user:
            if request.headers.get("Accept", "").startswith("application/json") or request.is_json:
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
        if user and user["is_approved"]:
            return user

    # Check auth_token cookie (remember me)
    token = request.cookies.get("auth_token")
    if token:
        auth = query_db(
            "SELECT * FROM auth_tokens WHERE token = ? AND expires_at > ?",
            [token, datetime.utcnow().isoformat()],
            one=True,
        )
        if auth:
            user = query_db("SELECT * FROM users WHERE id = ?", [auth["user_id"]], one=True)
            if user and user["is_approved"]:
                session["user_id"] = user["id"]
                return user

    return None
