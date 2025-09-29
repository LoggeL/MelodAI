# src/models/db.py

import sqlite3
import os
from flask import g, current_app

# Define database path relative to the application root
DATABASE = os.path.join("src", "database.db")


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

        try:
            # Add system_status table if it doesn't exist
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS system_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    component TEXT NOT NULL,
                    status TEXT NOT NULL,
                    details TEXT,
                    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    checked_by INTEGER,
                    FOREIGN KEY (checked_by) REFERENCES users (id)
                )
            """
            )
            db.commit()
            print("Added system_status table")
        except sqlite3.OperationalError as e:
            print(f"Migration error when creating system_status table: {e}")


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


def init_app(app):
    """Initialize database with Flask app."""
    app.teardown_appcontext(close_db)

    # Initialize or migrate database as needed
    import os

    if not os.path.isfile("src/database.db"):
        init_db()
    else:
        migrate_db()


def reset_db():
    """Reset the database by recreating all tables.
    This should only be used in development or when specifically needed.
    WARNING: This will delete all data in the database!
    """
    with current_app.app_context():
        import os

        if os.path.exists(DATABASE):
            os.rename(DATABASE, f"{DATABASE}.backup")
            print(f"Existing database backed up to {DATABASE}.backup")

        init_db()
        print("Database has been reset with the current schema")
