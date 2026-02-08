import sqlite3
import os
from flask import g, current_app

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database.db")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=20)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH, timeout=20)
    schema_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "schema.sql")
    with open(schema_path, "r") as f:
        db.executescript(f.read())
    _run_migrations(db)
    db.close()


def _run_migrations(db):
    """Add columns/tables that may not exist in older databases."""
    cur = db.execute("PRAGMA table_info(users)")
    columns = [row[1] for row in cur.fetchall()]
    if "credits" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 50")
        db.commit()
    if "display_name" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
        db.commit()
    if "email" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE")
        db.commit()

    # Ensure error_log table exists
    db.execute("""CREATE TABLE IF NOT EXISTS error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_type TEXT NOT NULL,
        source TEXT NOT NULL,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        track_id TEXT,
        request_method TEXT,
        request_path TEXT,
        user_id INTEGER,
        username TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")
    db.commit()


def query_db(query, args=(), one=False):
    db = get_db()
    cur = db.execute(query, args)
    rv = cur.fetchall()
    return (rv[0] if rv else None) if one else rv


def execute_db(query, args=()):
    db = get_db()
    db.execute(query, args)
    db.commit()


def insert_db(query, args=()):
    db = get_db()
    cur = db.execute(query, args)
    db.commit()
    return cur.lastrowid
