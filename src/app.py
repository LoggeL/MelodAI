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


# Auto-reprocess unfinished tracks on startup
def auto_reprocess_unfinished_tracks():
    """Automatically reprocess all unfinished tracks on app startup"""
    import threading
    import time
    import json
    from .utils.status_checks import (
        get_unfinished_songs,
        is_track_in_queue,
        add_to_processing_queue,
        update_queue_item_status,
    )
    from .routes.track import de_add_track
    
    def reprocess_worker():
        # Wait a bit for the app to fully initialize
        time.sleep(5)
        
        with app.app_context():
            try:
                print("🔄 Checking for unfinished tracks to reprocess...")
                unfinished_songs = get_unfinished_songs()
                
                if not unfinished_songs:
                    print("✅ No unfinished tracks found")
                    return
                
                print(f"📋 Found {len(unfinished_songs)} unfinished track(s)")
                
                for song in unfinished_songs:
                    track_id = song["track_id"]
                    
                    # Skip if already in queue
                    if is_track_in_queue(track_id):
                        print(f"⏭️  Skipping {track_id} - already in queue")
                        continue
                    
                    # Get metadata if available
                    metadata_path = f"src/songs/{track_id}/metadata.json"
                    metadata = {}
                    
                    if os.path.isfile(metadata_path) and os.path.getsize(metadata_path) > 0:
                        try:
                            with open(metadata_path, "r") as f:
                                metadata = json.load(f)
                        except Exception as e:
                            print(f"⚠️  Error loading metadata for {track_id}: {e}")
                    
                    # Add to processing queue
                    add_to_processing_queue(track_id, metadata)
                    
                    print(f"🔄 Auto-reprocessing: {metadata.get('title', track_id)} - {metadata.get('artist', 'Unknown')}")
                    
                    # Start reprocessing in a separate thread
                    def process_track(track_id):
                        with app.app_context():
                            try:
                                de_add_track(track_id)
                                update_queue_item_status(track_id, "complete", 100)
                                print(f"✅ Completed reprocessing: {track_id}")
                            except Exception as e:
                                print(f"❌ Error reprocessing track {track_id}: {e}")
                                update_queue_item_status(track_id, "error", 0)
                    
                    thread = threading.Thread(
                        target=process_track,
                        args=(track_id,),
                        daemon=True
                    )
                    thread.start()
                    
                    # Small delay between starting tracks to avoid overwhelming the system
                    time.sleep(2)
                
                print(f"✅ Auto-reprocessing initiated for {len(unfinished_songs)} track(s)")
                
            except Exception as e:
                print(f"❌ Error in auto-reprocess: {e}")
    
    # Start the reprocessing worker in a background thread
    thread = threading.Thread(target=reprocess_worker, daemon=True)
    thread.start()


# Start auto-reprocessing on app initialization
print("🚀 Starting auto-reprocess worker...")
auto_reprocess_unfinished_tracks()
