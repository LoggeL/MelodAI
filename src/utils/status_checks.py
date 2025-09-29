import os
import sqlite3
import time
import requests
from ..models.db import get_db
from ..services.deezer import init_deezer_session, test_deezer_login
import logging
import threading
import json
from .constants import STATUS_OK, STATUS_WARNING, STATUS_ERROR, STATUS_UNKNOWN

# Track processing queue tracker
# Dictionary of {track_id: {start_time, metadata, status, progress}}
_processing_queue = {}
_queue_lock = threading.Lock()


def add_to_processing_queue(track_id, metadata=None):
    """Add a track to the processing queue tracker"""
    with _queue_lock:
        _processing_queue[track_id] = {
            "start_time": time.time(),
            "metadata": metadata or {},
            "status": "started",
            "progress": 0,
        }


def update_queue_item_status(track_id, status, progress=None):
    """Update status of a track in the processing queue"""
    with _queue_lock:
        if track_id in _processing_queue:
            _processing_queue[track_id]["status"] = status
            if progress is not None:
                _processing_queue[track_id]["progress"] = progress


def remove_from_processing_queue(track_id):
    """Remove a track from the processing queue tracker"""
    with _queue_lock:
        if track_id in _processing_queue:
            del _processing_queue[track_id]


def get_processing_queue():
    """Get a copy of the current processing queue"""
    with _queue_lock:
        # Return a copy to avoid threading issues
        return {k: v.copy() for k, v in _processing_queue.items()}


def get_unfinished_songs():
    """Get a list of songs that are incomplete and can be reprocessed"""
    unfinished_songs = []
    songs_dir = "src/songs"

    # Check if directory exists
    if not os.path.exists(songs_dir):
        return unfinished_songs

    for track_id in os.listdir(songs_dir):
        track_path = os.path.join(songs_dir, track_id)

        # Skip if not a directory
        if not os.path.isdir(track_path):
            continue

        # Skip if track is currently in the processing queue
        with _queue_lock:
            if track_id in _processing_queue:
                continue

        # Check for required files
        has_metadata = os.path.isfile(os.path.join(track_path, "metadata.json"))
        has_song = os.path.isfile(os.path.join(track_path, "song.mp3"))
        has_vocals = os.path.isfile(os.path.join(track_path, "vocals.mp3"))
        has_no_vocals = os.path.isfile(os.path.join(track_path, "no_vocals.mp3"))
        has_lyrics_raw = os.path.isfile(os.path.join(track_path, "lyrics_raw.json"))
        has_lyrics = os.path.isfile(os.path.join(track_path, "lyrics.json"))

        # Calculate missing items
        missing_items = []
        if not has_metadata:
            missing_items.append("metadata")
        if not has_song:
            missing_items.append("song")
        if not has_vocals:
            missing_items.append("vocals")
        if not has_no_vocals:
            missing_items.append("no_vocals")
        if not has_lyrics_raw:
            missing_items.append("lyrics_raw")
        if not has_lyrics:
            missing_items.append("lyrics")

        # If any required component is missing, mark as unfinished
        if missing_items:
            # Try to get metadata if available
            metadata = {}
            if has_metadata:
                try:
                    with open(os.path.join(track_path, "metadata.json"), "r") as f:
                        metadata = json.load(f)
                except:
                    pass

            # Add to unfinished list
            unfinished_songs.append(
                {
                    "track_id": track_id,
                    "missing_items": missing_items,
                    "title": metadata.get("title", "Unknown"),
                    "artist": metadata.get("artist", "Unknown"),
                    "last_modified": os.path.getmtime(track_path),
                    "completion_status": calculate_completion_status(
                        has_song, has_vocals, has_no_vocals, has_lyrics
                    ),
                }
            )

    # Sort by last modified time (newest first)
    unfinished_songs.sort(key=lambda x: x["last_modified"], reverse=True)
    return unfinished_songs


def calculate_completion_status(has_song, has_vocals, has_no_vocals, has_lyrics):
    """Calculate completion percentage based on the presence of required files"""
    total_items = 4
    completed_items = sum([has_song, has_vocals, has_no_vocals, has_lyrics])
    return (completed_items / total_items) * 100


def save_status_check(component, status, details=None, checked_by=None):
    """Save status check results to the database"""
    try:
        db = get_db()
        db.execute(
            """
            INSERT INTO system_status (component, status, details, checked_by)
            VALUES (?, ?, ?, ?)
            """,
            (component, status, details, checked_by),
        )
        db.commit()
        return True
    except sqlite3.OperationalError as e:
        # If the table doesn't exist, log a message but don't crash
        if "no such table" in str(e):
            print(
                f"Warning: system_status table does not exist. Status check for {component} not saved."
            )
            print(f"Run 'python src/add_system_status_table.py' to create the table.")
            return False
        # For other database errors, re-raise
        raise


def check_database():
    """Check if the database is accessible and working"""
    try:
        db = get_db()
        # Try a simple query
        result = db.execute("SELECT COUNT(*) FROM users").fetchone()
        if result is not None:
            return {
                "component": "Database",
                "status": STATUS_OK,
                "details": f"Database is accessible. User count: {result[0]}",
            }
        else:
            return {
                "component": "Database",
                "status": STATUS_WARNING,
                "details": "Database query returned unexpected result",
            }
    except sqlite3.Error as e:
        return {
            "component": "Database",
            "status": STATUS_ERROR,
            "details": f"Database error: {str(e)}",
        }
    except Exception as e:
        return {
            "component": "Database",
            "status": STATUS_ERROR,
            "details": f"Unexpected error: {str(e)}",
        }


def check_deezer_api():
    """Check if Deezer API is accessible and login is working"""
    try:
        # Initialize Deezer session
        init_deezer_session(proxy_server="", quality="mp3")

        # Test login
        login_status = test_deezer_login()

        if login_status:
            return {
                "component": "Deezer API",
                "status": STATUS_OK,
                "details": "Deezer API login successful",
            }
        else:
            return {
                "component": "Deezer API",
                "status": STATUS_ERROR,
                "details": "Deezer API login failed. Check credentials.",
            }
    except Exception as e:
        return {
            "component": "Deezer API",
            "status": STATUS_ERROR,
            "details": f"Deezer API error: {str(e)}",
        }


def check_file_system():
    """Check if file system is accessible and has enough space"""
    try:
        # Check if songs directory exists
        songs_dir = "src/songs"
        if not os.path.exists(songs_dir):
            os.makedirs(songs_dir)

        # Check available disk space (in GB)
        if os.name == "posix":  # Linux/Mac
            stat = os.statvfs(songs_dir)
            free_space = (stat.f_bavail * stat.f_frsize) / (1024 * 1024 * 1024)
        else:  # Windows or other
            import shutil

            total, used, free = shutil.disk_usage(songs_dir)
            free_space = free / (1024 * 1024 * 1024)

        # Define thresholds (in GB)
        warning_threshold = 5
        error_threshold = 1

        if free_space < error_threshold:
            return {
                "component": "File System",
                "status": STATUS_ERROR,
                "details": f"Critical low disk space: {free_space:.2f} GB free",
            }
        elif free_space < warning_threshold:
            return {
                "component": "File System",
                "status": STATUS_WARNING,
                "details": f"Low disk space: {free_space:.2f} GB free",
            }
        else:
            return {
                "component": "File System",
                "status": STATUS_OK,
                "details": f"File system OK: {free_space:.2f} GB free",
            }
    except Exception as e:
        return {
            "component": "File System",
            "status": STATUS_ERROR,
            "details": f"File system error: {str(e)}",
        }


def check_replicate_api():
    """Check if the Replicate API is accessible"""
    try:
        # Check for API token
        api_token = os.environ.get("REPLICATE_API_TOKEN")
        if not api_token:
            return {
                "component": "Replicate API",
                "status": STATUS_WARNING,
                "details": "REPLICATE_API_TOKEN environment variable not set",
            }

        # Check API connectivity
        headers = {"Authorization": f"Token {api_token}"}
        response = requests.get("https://api.replicate.com/v1/models", headers=headers)

        if response.status_code == 200:
            return {
                "component": "Replicate API",
                "status": STATUS_OK,
                "details": "Replicate API is accessible",
            }
        else:
            return {
                "component": "Replicate API",
                "status": STATUS_ERROR,
                "details": f"Replicate API returned status code {response.status_code}: {response.text}",
            }
    except requests.exceptions.RequestException as e:
        return {
            "component": "Replicate API",
            "status": STATUS_ERROR,
            "details": f"Replicate API connection error: {str(e)}",
        }
    except Exception as e:
        return {
            "component": "Replicate API",
            "status": STATUS_ERROR,
            "details": f"Unexpected error: {str(e)}",
        }


def check_processing_queue():
    """Check the status of any ongoing processing tasks"""
    try:
        # Count songs in various states of processing
        songs_dir = "src/songs"
        if not os.path.exists(songs_dir):
            return {
                "component": "Processing Queue",
                "status": STATUS_WARNING,
                "details": "Songs directory does not exist",
            }

        total_songs = 0
        completed_songs = 0
        processing_songs = 0

        for track_id in os.listdir(songs_dir):
            track_path = os.path.join(songs_dir, track_id)
            if not os.path.isdir(track_path):
                continue

            total_songs += 1

            # Check if song is fully processed
            has_lyrics = os.path.exists(os.path.join(track_path, "lyrics.json"))
            has_vocals = os.path.exists(os.path.join(track_path, "vocals.mp3"))
            has_no_vocals = os.path.exists(os.path.join(track_path, "no_vocals.mp3"))

            if has_lyrics and has_vocals and has_no_vocals:
                completed_songs += 1
            else:
                processing_songs += 1

        if processing_songs > 0:
            return {
                "component": "Processing Queue",
                "status": STATUS_WARNING,
                "details": f"{processing_songs} songs currently processing. {completed_songs} songs completed.",
            }
        else:
            return {
                "component": "Processing Queue",
                "status": STATUS_OK,
                "details": f"No songs currently processing. {completed_songs} songs completed.",
            }
    except Exception as e:
        return {
            "component": "Processing Queue",
            "status": STATUS_ERROR,
            "details": f"Error checking processing queue: {str(e)}",
        }


def check_openrouter_api():
    """Check if the OpenRouter API is accessible"""
    try:
        # Check for API token
        api_token = os.environ.get("OPENROUTER_API_KEY")
        if not api_token:
            return {
                "component": "OpenRouter API",
                "status": STATUS_WARNING,
                "details": "OPENROUTER_API_KEY environment variable not set",
            }

        # Check API connectivity
        headers = {
            "Authorization": f"Bearer {api_token}",
            "HTTP-Referer": "https://melodai.local",  # Replace with your actual domain
        }
        response = requests.get("https://openrouter.ai/api/v1/models", headers=headers)

        if response.status_code == 200:
            return {
                "component": "OpenRouter API",
                "status": STATUS_OK,
                "details": "OpenRouter API is accessible",
            }
        else:
            return {
                "component": "OpenRouter API",
                "status": STATUS_ERROR,
                "details": f"OpenRouter API returned status code {response.status_code}: {response.text}",
            }
    except requests.exceptions.RequestException as e:
        return {
            "component": "OpenRouter API",
            "status": STATUS_ERROR,
            "details": f"OpenRouter API connection error: {str(e)}",
        }
    except Exception as e:
        return {
            "component": "OpenRouter API",
            "status": STATUS_ERROR,
            "details": f"Unexpected error: {str(e)}",
        }


def run_all_checks(user_id=None):
    """Run all system checks and save results to database"""
    checks = [
        check_database(),
        check_deezer_api(),
        check_file_system(),
        check_replicate_api(),
        check_processing_queue(),
        check_openrouter_api(),
    ]

    # Save all check results to database
    for check in checks:
        save_status_check(
            check["component"], check["status"], check["details"], user_id
        )

    return checks
