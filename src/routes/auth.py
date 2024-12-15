from flask import Blueprint, jsonify, request, session
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from ..models.db import get_db, get_invite_key, use_invite_key
import sqlite3

auth_bp = Blueprint("auth", __name__)


def generate_auth_token():
    return secrets.token_urlsafe(32)


def send_reset_email(email, reset_token):
    sender_email = os.getenv("SMTP_USER")
    sender_password = os.getenv("SMTP_PASSWORD")

    msg = MIMEMultipart()
    msg["From"] = str(sender_email)
    msg["To"] = str(email)
    msg["Subject"] = "Password Reset Request"

    body = f"""
    You requested a password reset for your MelodAI account.
    Click the following link to reset your password:
    
    {os.getenv('BASE_URL')}/reset-password?token={reset_token}
    
    If you didn't request this, please ignore this email.
    """

    msg.attach(MIMEText(body, "plain"))
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = os.getenv("SMTP_PORT")
    if smtp_host is None or smtp_port is None:
        raise ValueError("SMTP_HOST or SMTP_PORT is not set")

    with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
        server.starttls()
        server.login(str(sender_email), str(sender_password))
        server.send_message(msg)


@auth_bp.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    invite_key = data.get("invite_key")

    if not username or not password:
        return jsonify({"error": "Missing credentials"}), 400

    db = get_db()

    # if first user, make them admin
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        is_admin = True
        is_approved = True
    else:
        is_admin = False
        is_approved = False

    # Check if using an invite key
    if invite_key:
        invite = get_invite_key(invite_key)
        if not invite or invite["used_by"]:
            return jsonify({"error": "Invalid or used invite key"}), 400
        is_approved = True

    try:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin, is_approved) VALUES (?, ?, ?, ?)",
            (username, generate_password_hash(password), is_admin, is_approved),
        )
        db.commit()

        # Get the new user's ID
        new_user_id = db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()["id"]

        # Mark invite key as used if present
        if invite_key:
            use_invite_key(invite_key, new_user_id)
            
            # Automatically log in the user
            session["user_id"] = new_user_id
            return jsonify({
                "message": "Registration successful. Logged in automatically.",
                "auto_login": True
            })

        return jsonify({"message": "Registration successful. Waiting for approval."})

    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 400


@auth_bp.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    remember_me = data.get("remember_me", False)

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    if user and check_password_hash(user["password_hash"], password):
        if not user["is_approved"]:
            return jsonify({"error": "Account pending approval"}), 403

        session["user_id"] = user["id"]
        response = jsonify(
            {
                "message": "Login successful",
                "is_admin": user["is_admin"],
            }
        )

        if remember_me:
            token = generate_auth_token()
            expires = datetime.now() + timedelta(days=30)

            db.execute(
                "INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
                (token, user["id"], expires),
            )
            db.commit()

            response.set_cookie(
                "auth_token",
                token,
                httponly=True,
                secure=True,
                samesite="Strict",
                expires=expires,
                max_age=30 * 24 * 60 * 60,
            )

        return response

    return jsonify({"error": "Invalid credentials"}), 401


@auth_bp.route("/auth/logout", methods=["POST"])
def logout():
    if "user_id" in session:
        # Remove token from database and clear cookie
        token = request.cookies.get("auth_token")
        if token:
            db = get_db()
            db.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
            db.commit()

    response = jsonify({"message": "Logged out"})
    response.delete_cookie("auth_token")
    session.clear()
    return response


@auth_bp.route("/auth/check", methods=["GET"])
def check_auth():
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    user = db.execute(
        "SELECT is_admin FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()

    return jsonify(
        {"authenticated": True, "is_admin": user["is_admin"] if user else False}
    )


@auth_bp.route("/auth/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json()
    username = data.get("username")

    db = get_db()
    user = db.execute(
        "SELECT id, email FROM users WHERE username = ?", (username,)
    ).fetchone()

    if not user or not user["email"]:
        # Don't reveal if user exists
        return jsonify({"message": "If an account exists, a reset link will be sent"})

    # Generate reset token
    reset_token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(hours=1)

    # Store reset token
    db.execute(
        """INSERT INTO password_resets 
           (user_id, token, expires_at) 
           VALUES (?, ?, ?)""",
        (user["id"], reset_token, expires),
    )
    db.commit()

    # Send email
    try:
        send_reset_email(user["email"], reset_token)
    except Exception as e:
        print(f"Error sending reset email: {e}")
        return jsonify({"error": "Error sending reset email"}), 500

    return jsonify({"message": "If an account exists, a reset link will be sent"})


@auth_bp.route("/auth/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json()
    token = data.get("token")
    new_password = data.get("password")

    if not token or not new_password:
        return jsonify({"error": "Missing required fields"}), 400

    db = get_db()
    reset = db.execute(
        """SELECT user_id, expires_at FROM password_resets 
           WHERE token = ? AND used = 0""",
        (token,),
    ).fetchone()

    if (
        not reset
        or datetime.strptime(reset["expires_at"], "%Y-%m-%d %H:%M:%S.%f")
        < datetime.now()
    ):
        return jsonify({"error": "Invalid or expired reset token"}), 400

    # Update password and mark token as used
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(new_password), reset["user_id"]),
    )
    db.execute("UPDATE password_resets SET used = 1 WHERE token = ?", (token,))
    db.commit()

    return jsonify({"message": "Password reset successful"})


def validate_auth_token():
    auth_token = request.cookies.get("auth_token")
    if not auth_token:
        return False

    db = get_db()
    token = db.execute(
        "SELECT * FROM auth_tokens WHERE token = ? AND expires_at > ?",
        (auth_token, datetime.now()),
    ).fetchone()

    if token:
        # Set the user_id in session if token is valid
        session["user_id"] = token["user_id"]
        return True
    return False


@auth_bp.route("/auth/profile", methods=["GET"])
def get_profile():
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    user = db.execute(
        """SELECT username, email, is_admin 
           FROM users 
           WHERE id = ?""",
        (session["user_id"],),
    ).fetchone()

    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(
        {"name": user["username"], "email": user["email"], "is_admin": user["is_admin"]}
    )


@auth_bp.route("/admin/invite-keys/<key>", methods=["DELETE"])
def cancel_invite_key(key):
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    
    # Check if user is admin
    user = db.execute(
        "SELECT is_admin FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()
    
    if not user or not user["is_admin"]:
        return jsonify({"error": "Unauthorized"}), 401

    # Check if key exists and is unused
    invite = db.execute(
        "SELECT * FROM invite_keys WHERE key = ? AND used_by IS NULL", 
        (key,)
    ).fetchone()
    
    if not invite:
        return jsonify({"error": "Invalid or already used invite key"}), 400

    # Delete the key
    db.execute("DELETE FROM invite_keys WHERE key = ?", (key,))
    db.commit()

    return jsonify({"message": "Invite key cancelled successfully"})
