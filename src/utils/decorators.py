from functools import wraps
from flask import session, redirect, request, jsonify
from datetime import datetime
from ..models.db import get_db


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            # Check for token in cookie
            token = request.cookies.get("auth_token")
            if token:
                db = get_db()
                token_data = db.execute(
                    """
                    SELECT user_id, expires_at 
                    FROM auth_tokens 
                    WHERE token = ?
                    """,
                    (token,),
                ).fetchone()

                # Verify token is valid and not expired
                if token_data and token_data["expires_at"] > datetime.now():
                    session["user_id"] = token_data["user_id"]
                    return f(*args, **kwargs)

            return redirect("/login?next=" + request.path)
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.cookies.get("auth_token")

        if not token:
            return redirect("/login?next=" + request.path)

        db = get_db()
        token_data = db.execute(
            """
            SELECT user_id FROM auth_tokens WHERE token = ?
            """,
            (token,),
        ).fetchone()

        if not token_data:
            return redirect("/login?next=" + request.path)

        user = db.execute(
            """
            SELECT is_admin FROM users WHERE id = ?
            """,
            (token_data["user_id"],),
        ).fetchone()

        if not user or not user["is_admin"]:
            return jsonify({"error": "Admin access required"}), 403

        # add user_id to session
        session["user_id"] = token_data["user_id"]

        return f(*args, **kwargs)

    return decorated_function
