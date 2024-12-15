# src/models/db.py

import sqlite3
import os
from flask import g, current_app

# Define database path relative to the application root
DATABASE = os.path.join('src', 'database.db')

def get_db():
    """Get database connection for the current request."""
    if "db" not in g:
        g.db = sqlite3.connect(
            DATABASE, detect_types=sqlite3.PARSE_DECLTYPES, timeout=20.0
        )
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    """Close database connection."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Initialize the database with schema."""
    with current_app.app_context():
        db = get_db()
        with current_app.open_resource("schema.sql", mode="r") as f:
            db.cursor().executescript(f.read())
        db.commit()


def migrate_db():
    """Run database migrations."""
    with current_app.app_context():
        db = get_db()
        try:
            # Check if last_online column exists
            db.execute("SELECT last_online FROM users LIMIT 1")
        except sqlite3.OperationalError:
            print("Adding last_online column to users table")
            db.execute("ALTER TABLE users ADD COLUMN last_online TIMESTAMP")
            db.commit()

        try:
            # Check if email column exists
            db.execute("SELECT email FROM users LIMIT 1")
        except sqlite3.OperationalError:
            print("Adding email column to users table")
            db.execute("ALTER TABLE users ADD COLUMN email TEXT")
            db.commit()

        try:
            # Add password_resets table if it doesn't exist
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS password_resets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token TEXT NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    used BOOLEAN DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            """
            )
            db.commit()
        except sqlite3.OperationalError as e:
            print(f"Migration error: {e}")

        try:
            # Add auth_tokens table if it doesn't exist
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            """
            )
            db.commit()
        except sqlite3.OperationalError as e:
            print(f"Migration error: {e}")

        try:
            # Add invite_keys table if it doesn't exist
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS invite_keys (
                    key TEXT PRIMARY KEY,
                    created_by INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    used_by INTEGER,
                    used_at TIMESTAMP,
                    FOREIGN KEY (created_by) REFERENCES users (id),
                    FOREIGN KEY (used_by) REFERENCES users (id)
                )
            """
            )
            db.commit()
        except sqlite3.OperationalError as e:
            print(f"Migration error: {e}")


def create_invite_key(created_by, key):
    """Create a new invite key."""
    db = get_db()
    db.execute(
        "INSERT INTO invite_keys (key, created_by) VALUES (?, ?)",
        (key, created_by),
    )
    db.commit()


def get_invite_key(key):
    """Get invite key details."""
    db = get_db()
    return db.execute("SELECT * FROM invite_keys WHERE key = ?", (key,)).fetchone()


def use_invite_key(key, user_id):
    """Mark an invite key as used."""
    db = get_db()
    db.execute(
        "UPDATE invite_keys SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE key = ?",
        (user_id, key),
    )
    db.commit()


def update_last_online(user_id):
    """Update user's last online timestamp."""
    if not user_id:
        return

    try:
        db = get_db()
        with db:
            db.execute(
                """UPDATE users 
                   SET last_online = CURRENT_TIMESTAMP 
                   WHERE id = ?""",
                (user_id,),
            )
    except sqlite3.OperationalError as e:
        print(f"Error updating last_online for user {user_id}: {e}")
        return


def get_user_by_username(username):
    """Get user by username."""
    db = get_db()
    return db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def get_user_by_id(user_id):
    """Get user by ID."""
    db = get_db()
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def create_user(username, password_hash, is_admin=False, is_approved=False):
    """Create a new user."""
    db = get_db()
    try:
        db.execute(
            """INSERT INTO users 
               (username, password_hash, is_admin, is_approved) 
               VALUES (?, ?, ?, ?)""",
            (username, password_hash, is_admin, is_approved),
        )
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False


def create_auth_token(user_id, token, expires_at):
    """Create a new authentication token."""
    db = get_db()
    db.execute(
        """INSERT INTO auth_tokens 
           (token, user_id, expires_at) 
           VALUES (?, ?, ?)""",
        (token, user_id, expires_at),
    )
    db.commit()


def get_auth_token(token):
    """Get authentication token."""
    db = get_db()
    return db.execute(
        """SELECT user_id, expires_at 
           FROM auth_tokens 
           WHERE token = ?""",
        (token,),
    ).fetchone()


def delete_auth_token(token):
    """Delete authentication token."""
    db = get_db()
    db.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    db.commit()


def log_user_action(user_id, track_id, action):
    """Log user action."""
    db = get_db()
    db.execute(
        """INSERT INTO usage_logs 
           (user_id, track_id, action) 
           VALUES (?, ?, ?)""",
        (user_id, track_id, action),
    )
    db.commit()


def init_app(app):
    """Initialize database with Flask app."""
    app.teardown_appcontext(close_db)

    # Initialize or migrate database as needed
    import os

    if not os.path.isfile("src/database.db"):
        init_db()
    else:
        migrate_db()
