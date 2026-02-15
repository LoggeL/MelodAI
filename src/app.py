import os
from datetime import timedelta
from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def create_app():
    app = Flask(__name__, static_folder=None)
    app.secret_key = os.getenv("SECRET_KEY", os.urandom(32).hex())
    app.permanent_session_lifetime = timedelta(days=30)

    CORS(app)

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
