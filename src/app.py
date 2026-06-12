import os
from datetime import timedelta
from flask import Flask
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
        with open(key_path) as f:
            stored = f.read().strip()
        if stored:
            return stored
    except OSError:
        pass
    key = os.urandom(32).hex()
    try:
        with open(key_path, "w") as f:
            f.write(key)
        print("WARNING: SECRET_KEY not set; generated one and stored it in src/.secret_key. Set SECRET_KEY in .env for production.")
    except OSError:
        print("WARNING: SECRET_KEY not set and could not persist a generated key; sessions will reset on every restart.")
    return key


def create_app():
    app = Flask(__name__, static_folder=None)
    app.secret_key = _load_secret_key()
    app.permanent_session_lifetime = timedelta(days=30)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "1") != "0",
    )

    CORS(app, supports_credentials=True)

    from src.models.db import init_db, close_db
    init_db()
    app.teardown_appcontext(close_db)

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

    @app.errorhandler(500)
    def handle_500(e):
        import traceback
        from src.utils.error_logging import log_api_error
        log_api_error(str(e), traceback.format_exc())
        return {"error": "Internal server error"}, 500

    with app.app_context():
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
