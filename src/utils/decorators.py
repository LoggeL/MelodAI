from functools import wraps
from flask import session, redirect, request
from datetime import datetime
from ..models.db import get_db


def _validate_auth():
    """Helper function to validate authentication via session or token.
    Returns user_id if valid, None otherwise."""
    # Check session first
    if "user_id" in session:
        return session["user_id"]

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
            return token_data["user_id"]

    return None


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = _validate_auth()
        if not user_id:
            return redirect("/login?next=" + request.path)
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = _validate_auth()
        if not user_id:
            return redirect("/login?next=" + request.path)

        # Check if user is admin
        db = get_db()
        user = db.execute(
            "SELECT is_admin FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

        if not user or not user["is_admin"]:
            print("User is not admin")
            return redirect("/")

        return f(*args, **kwargs)

    return decorated_function
