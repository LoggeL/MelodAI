import os
import threading
from datetime import timedelta
from flask import Flask, request
from werkzeug.exceptions import HTTPException
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def _load_secret_key():
    # `os.getenv(..., default)` doesn't kick in for SECRET_KEY= set to an
    # empty string (as in example.env) — Flask then has no usable key and
    # every session call 500s. And a fresh os.urandom key per process would
    # log everyone out on restart and break multi-worker deployments, so
    # persist the generated key.
    key = os.getenv("SECRET_KEY", "").strip()
    if key:
        return key
    key_path = os.path.join(os.path.dirname(__file__), ".secret_key")
    try:
        import fcntl
        descriptor = os.open(key_path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "r+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            stored = handle.read().strip()
            if stored:
                return stored
            key = os.urandom(32).hex()
            handle.write(key)
            handle.flush()
            return key
    except OSError:
        print("WARNING: SECRET_KEY not set and could not persist a generated key; sessions will reset on every restart.")
        return os.urandom(32).hex()


def create_app(config=None):
    """Build an app with injectable storage and optional external startup work."""
    app = Flask(__name__, static_folder=None)
    app.permanent_session_lifetime = timedelta(days=30)
    app.config.update(
        DATABASE=os.getenv("MELODAI_DATABASE", os.path.join(app.root_path, "database.db")),
        SONGS_PATH=os.getenv("MELODAI_SONGS_PATH", os.path.join(app.root_path, "songs")),
        STARTUP_HOOKS=os.getenv("MELODAI_STARTUP_HOOKS", "1") != "0",
        MAX_PROCESSING_WORKERS=int(os.getenv("MELODAI_MAX_PROCESSING_WORKERS", "2")),
        MAX_CONTENT_LENGTH=1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "1") != "0",
    )
    app.config.update(config or {})
    if type(app.config["MAX_PROCESSING_WORKERS"]) is not int or app.config["MAX_PROCESSING_WORKERS"] < 1:
        raise ValueError("MAX_PROCESSING_WORKERS must be a positive integer")
    app.extensions["processing_slots"] = threading.BoundedSemaphore(app.config["MAX_PROCESSING_WORKERS"])
    if not app.config.get("SECRET_KEY"):
        app.secret_key = os.urandom(32) if app.testing else _load_secret_key()

    # Same-origin requests work without CORS. Cross-origin credential access
    # must name trusted origins instead of reflecting every caller.
    cors_origins = app.config.get("CORS_ORIGINS") or os.getenv("CORS_ORIGINS", "")
    if cors_origins:
        origins = cors_origins.split(",") if isinstance(cors_origins, str) else cors_origins
        CORS(app, supports_credentials=True, origins=origins)

    from src.models.db import init_db, close_db
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()

    from src.routes.auth import auth_bp
    from src.routes.track import track_bp
    from src.routes.static import static_bp
    from src.routes.admin import admin_bp
    from src.routes.sync import sync_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(track_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(static_bp)

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        if request.path.startswith(("/api/", "/songs/")):
            response = error.get_response()
            response.data = app.json.dumps({"error": error.description})
            response.content_type = "application/json"
            return response
        return error

    @app.errorhandler(500)
    def handle_500(e):
        import traceback
        from src.utils.error_logging import log_api_error
        log_api_error(str(e), traceback.format_exc())
        return {"error": "Internal server error"}, 500

    with app.app_context():
        if app.config["STARTUP_HOOKS"] and not app.testing:
            _startup_hooks(app)

    return app


def _startup_hooks(app):
    from src.services.deezer import init_deezer_session, test_deezer_login
    import threading

    _ensure_admin_account()

    from src.utils.error_logging import log_event
    log_event("info", "system", "Application started")

    try:
        init_deezer_session()
        test_deezer_login()
    except Exception as e:
        print(f"WARNING: Deezer init failed: {e}")
        log_event("warning", "system", f"Deezer init failed: {e}")

    # Auto-reprocess unfinished tracks after a delay
    def delayed_reprocess():
        import time
        time.sleep(5)
        with app.app_context():
            from src.utils.status_checks import reprocess_unfinished_tracks
            reprocess_unfinished_tracks(app)

    t = threading.Thread(target=delayed_reprocess, daemon=True)
    t.start()


def _ensure_admin_account():
    """Create the admin account from ADMIN_USERNAME/ADMIN_PASSWORD env vars if it doesn't exist."""
    admin_user = os.getenv("ADMIN_USERNAME", "").strip()
    admin_pass = os.getenv("ADMIN_PASSWORD", "").strip()
    if not admin_user or not admin_pass:
        return

    from src.models.db import query_db, insert_db
    from werkzeug.security import generate_password_hash

    existing = query_db("SELECT id FROM users WHERE username = ?", [admin_user], one=True)
    if existing:
        return

    display_name = os.getenv("ADMIN_DISPLAY_NAME", "Logge").strip()
    password_hash = generate_password_hash(admin_pass)
    insert_db(
        "INSERT INTO users (username, display_name, password_hash, is_admin, is_approved) VALUES (?, ?, ?, 1, 1)",
        [admin_user, display_name, password_hash],
    )
    print(f"Admin account '{admin_user}' created from environment variables.")
