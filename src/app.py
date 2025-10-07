# src/app.py
from flask import Flask, session
from flask_cors import CORS
import os
import logging
from datetime import timedelta
from .models.db import init_app, update_last_online
from .services.deezer import init_deezer_session, test_deezer_login
from .utils.extensions import socketio

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log')
    ]
)
logger = logging.getLogger(__name__)

# Import and register blueprints
from .routes.auth import auth_bp
from .routes.admin import admin_bp
from .routes.track import track_bp
from .routes.static import static_bp

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)
app.permanent_session_lifetime = timedelta(days=30)
socketio.init_app(app, cors_allowed_origins="*")

# Setup CORS
CORS(app, supports_credentials=True)

# Initialize database
with app.app_context():
    init_app(app)

# Initialize Deezer session
logger.info("Starting Deezer")
init_deezer_session()
test_deezer_login()

app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(track_bp)
app.register_blueprint(static_bp)


# WebSocket events
@socketio.on("connect")
def handle_connect():
    logger.info("Client connected")


@socketio.on("disconnect")
def handle_disconnect():
    logger.info("Client disconnected")


# Before request handler
@app.before_request
def before_request():
    """Update user's last online timestamp before each request."""
    if "user_id" in session:
        update_last_online(session["user_id"])


if __name__ == "__main__":
    socketio.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", 5000)),
        debug=bool(os.getenv("DEBUG", True)),
        allow_unsafe_werkzeug=True,
    )
