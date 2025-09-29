# src/app.py
from flask import Flask, session
from flask_cors import CORS
import os
from datetime import timedelta
from .models.db import init_app, update_last_online
from .services.deezer import init_deezer_session, test_deezer_login

# Import and register blueprints
from .routes.auth import auth_bp
from .routes.admin import admin_bp
from .routes.track import track_bp
from .routes.static import static_bp

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.urandom(24)
app.permanent_session_lifetime = timedelta(days=30)

# Setup CORS
CORS(app, supports_credentials=True)

# Initialize database
with app.app_context():
    init_app(app)

# Initialize Deezer session
print("Starting Deezer")
init_deezer_session()
test_deezer_login()

app.register_blueprint(auth_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(track_bp)
app.register_blueprint(static_bp)


# Before request handler
@app.before_request
def before_request():
    """Update user's last online timestamp before each request."""
    if "user_id" in session:
        update_last_online(session["user_id"])
