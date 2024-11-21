import random
import deezer
from flask import Flask, redirect, request, jsonify, send_from_directory, session
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import os
import replicate
import requests
import json
import sqlite3
from functools import wraps
import time
from datetime import timedelta

# env
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)
CORS(app, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")
app.permanent_session_lifetime = timedelta(days=30)

print("Starting Deezer")
deezer.init_deezer_session()
deezer.test_deezer_login()


def get_db():
    db = sqlite3.connect("database.db")
    db.row_factory = sqlite3.Row
    return db


def init_db():
    with app.app_context():
        db = get_db()
        with app.open_resource("schema.sql", mode="r") as f:
            db.cursor().executescript(f.read())
        db.commit()


if not os.path.isfile("database.db"):
    init_db()


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized"}), 401

        db = get_db()
        user = db.execute(
            "SELECT is_admin FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()

        if not user or not user["is_admin"]:
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)

    return decorated_function


@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Missing credentials"}), 400

    db = get_db()

    # if first user, make them admin
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        is_admin = True
        is_approved = True
    else:
        is_admin = False
        is_approved = False

    try:
        db.execute(
            "INSERT INTO users (username, password_hash, is_admin, is_approved) VALUES (?, ?, ?, ?)",
            (username, generate_password_hash(password), is_admin, is_approved),
        )
        db.commit()
        return jsonify({"message": "Registration successful. Waiting for approval."})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 400


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    remember_me = data.get("remember_me", False)

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    if user and check_password_hash(user["password_hash"], password):
        if not user["is_approved"]:
            return jsonify({"error": "Account pending approval"}), 403
        session["user_id"] = user["id"]
        if remember_me:
            session.permanent = True
            app.permanent_session_lifetime = timedelta(days=30)
        else:
            session.permanent = False
        return jsonify({"message": "Login successful", "is_admin": user["is_admin"]})

    return jsonify({"error": "Invalid credentials"}), 401


@app.route("/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})


@app.route("/admin/users", methods=["GET"])
@admin_required
def list_users():
    db = get_db()
    users = db.execute(
        "SELECT id, username, is_approved, is_admin, created_at FROM users"
    ).fetchall()
    return jsonify([dict(user) for user in users])


@app.route("/admin/users/<int:user_id>/approve", methods=["POST"])
@admin_required
def approve_user(user_id):
    db = get_db()
    db.execute("UPDATE users SET is_approved = TRUE WHERE id = ?", (user_id,))
    db.commit()
    return jsonify({"message": "User approved"})


@app.route("/", methods=["GET"])
def index():
    # if not logged in, redirect to login
    if "user_id" not in session:
        return redirect("/login")
    return send_from_directory(".", "index.html")


@app.route("/login", methods=["GET"])
def login_html():
    return send_from_directory(".", "login.html")


@app.route("/admin", methods=["GET"])
@admin_required
def admin_html():
    return send_from_directory(".", "admin.html")


# Route song files
@login_required
@app.route("/songs/<path:path>", methods=["GET"])
def song_file(path):
    return send_from_directory("songs", path)


# Logo.png
@app.route("/logo.png", methods=["GET"])
def logo():
    return send_from_directory("static", "logo.png")


# logo.svg
@app.route("/logo.svg", methods=["GET"])
def logo_svg():
    return send_from_directory("static", "logo.svg")


def de_search_track(search_term):

    print("Searching for", search_term)

    results = deezer.deezer_search(search_term, deezer.TYPE_TRACK)

    output = []
    for track in results:  # Assuming results is a list
        output.append(
            {
                "id": track["id"],
                "title": track["title"],
                "artist": track["artist"],
                "thumb": track["img_url"],
            }
        )

    # Prevent duplicates in trackName trackArtist
    seen = set()
    output = [
        x
        for x in output
        if not (x["title"] + x["artist"] in seen or seen.add(x["title"] + x["artist"]))
    ]

    return output


@app.route("/search", methods=["GET"])
@login_required
def search():
    search_term = request.args.get("q")
    if not search_term:
        return jsonify({"error": "Missing search term"}), 400

    results = de_search_track(search_term)

    # Log the search
    db = get_db()
    db.execute(
        "INSERT INTO usage_logs (user_id, track_id, action) VALUES (?, ?, ?)",
        (session["user_id"], search_term, "search"),
    )
    db.commit()

    return jsonify(results)


def de_add_track(track_id):

    os.makedirs("songs/{}".format(track_id), exist_ok=True)

    print("Processing Song", track_id)
    socketio.emit(
        "track_progress", {"track_id": track_id, "status": "starting", "progress": 0}
    )

    # Check if metadata exists
    if (
        not os.path.isfile("songs/{}/metadata.json".format(track_id))
        or os.path.getsize("songs/{}/metadata.json".format(track_id)) == 0
    ):
        print("Fetching Metadata")
        track_info = deezer.get_song_infos_from_deezer_website(
            deezer.TYPE_TRACK, track_id
        )
        metadata = {
            "title": track_info["SNG_TITLE"],
            "artist": track_info["ART_NAME"],
            "duration": track_info["DURATION"],
            "cover": track_info["ART_PICTURE"],
            "album": track_info["ALB_TITLE"],
        }
        with open("songs/{}/metadata.json".format(track_id), "w") as f:
            json.dump(metadata, f)

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "metadata_complete", "progress": 10},
        )

    # Download song from deezer if it doesnt exist yet
    if (
        not os.path.isfile("songs/{}/song.mp3".format(track_id))
        or os.path.getsize("songs/{}/song.mp3".format(track_id)) == 0
    ):
        print("Downloading Song")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "downloading", "progress": 10},
        )
        track_info = deezer.get_song_infos_from_deezer_website(
            deezer.TYPE_TRACK, track_id
        )
        deezer.download_song(track_info, "songs/{}/song.mp3".format(track_id))
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "downloaded", "progress": 30},
        )

    if not os.path.isfile("songs/{}/vocals.mp3".format(track_id)) or not os.path.isfile(
        "songs/{}/no_vocals.mp3".format(track_id)
    ):

        print("Splitting Song")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "splitting", "progress": 40},
        )

        output = replicate.run(
            "ryan5453/demucs:7a9db77ed93f8f4f7e233a94d8519a867fbaa9c6d16ea5b53c1394f1557f9c61",
            input={
                "jobs": 0,
                "audio": open("songs/{}/song.mp3".format(track_id), "rb"),
                "stem": "vocals",
                "model": "htdemucs",
                "split": True,
                "shifts": 1,
                "overlap": 0.25,
                "clip_mode": "rescale",
                "mp3_preset": 2,
                "wav_format": "int24",
                "mp3_bitrate": 320,
                "output_format": "mp3",
            },
        )

        # Save the vocals
        with open("songs/{}/vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["vocals"]).content)

        # Save the instrumental
        with open("songs/{}/no_vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["no_vocals"]).content)

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "split_complete", "progress": 50},
        )

    # exists and file is not empty
    if (
        not os.path.isfile("songs/{}/lyrics.json".format(track_id))
        or os.path.getsize("songs/{}/lyrics.json".format(track_id)) == 0
    ):
        print("Extracting Lyrics")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "extracting_lyrics", "progress": 80},
        )

        output = replicate.run(
            "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
            input={
                "debug": False,
                "vad_onset": 0.5,
                "audio_file": open("songs/{}/vocals.mp3".format(track_id), "rb"),
                "batch_size": 64,
                "vad_offset": 0.363,
                "diarization": True,
                "temperature": 0,
                "align_output": True,
                "language_detection_min_prob": 0,
                "language_detection_max_tries": 5,
                "huggingface_access_token": os.getenv("HF_READ_TOKEN"),
            },
        )

        # Save the lyrics
        with open("songs/{}/lyrics.json".format(track_id), "w") as f:
            f.write(json.dumps(output))
        # => {"segments":[{"end":30.811,"text":" The little tales they...","start":0.0},{"end":60.0,"text":" The little tales they...","start":30.811},...

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "lyrics_complete", "progress": 90},
        )

    print("Done")
    socketio.emit(
        "track_progress", {"track_id": track_id, "status": "complete", "progress": 100}
    )

    return True


@app.route("/add", methods=["GET"])
@login_required
def add():
    track_id = request.args.get("id")
    if not track_id:
        return jsonify({"error": "Missing track ID"}), 400

    # Start processing in background
    def process_track():
        try:
            de_add_track(track_id)
            socketio.emit("track_ready", {"track_id": track_id})
        except Exception as e:
            socketio.emit("track_error", {"track_id": track_id, "error": str(e)})

    # Log the download
    db = get_db()
    db.execute(
        "INSERT INTO usage_logs (user_id, track_id, action) VALUES (?, ?, ?)",
        (session["user_id"], track_id, "download"),
    )
    db.commit()

    # Start processing in a new thread
    import threading

    thread = threading.Thread(target=process_track)
    thread.start()

    return jsonify({"success": True})


# WebSocket events for progress updates
@socketio.on("connect")
def handle_connect():
    print("Client connected")


@socketio.on("disconnect")
def handle_disconnect():
    print("Client disconnected")


@app.route("/auth/check", methods=["GET"])
def check_auth():
    if "user_id" not in session:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()
    user = db.execute(
        "SELECT is_admin FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()

    return jsonify(
        {"authenticated": True, "is_admin": user["is_admin"] if user else False}
    )


@app.route("/admin/usage", methods=["GET"])
@admin_required
def get_usage_logs():
    db = get_db()

    # Get query parameters
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    action = request.args.get("action")
    username = request.args.get("username")

    # Build the query
    query = """
        SELECT u.username, l.track_id, l.action, l.created_at 
        FROM usage_logs l 
        JOIN users u ON l.user_id = u.id 
        WHERE 1=1
    """
    params = []

    if action:
        query += " AND l.action = ?"
        params.append(action)
    if username:
        query += " AND u.username LIKE ?"
        params.append(f"%{username}%")

    # Get total count
    count_query = query.replace(
        "u.username, l.track_id, l.action, l.created_at", "COUNT(*)"
    )
    total = db.execute(count_query, params).fetchone()[0]

    # Add pagination
    query += " ORDER BY l.created_at DESC LIMIT ? OFFSET ?"
    params.extend([per_page, (page - 1) * per_page])

    # Execute final query
    logs = db.execute(query, params).fetchall()

    return jsonify(
        {
            "logs": [dict(log) for log in logs],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }
    )


@app.route("/random", methods=["GET"])
@login_required
def get_random_song():
    try:
        # Get all song folders
        song_dirs = [
            d for d in os.listdir("songs") if os.path.isdir(os.path.join("songs", d))
        ]

        if not song_dirs:
            return jsonify({"error": "No songs available"}), 404

        # Pick a random song ID
        track_id = random.choice(song_dirs)

        # Try to get metadata
        try:
            with open(f"songs/{track_id}/metadata.json", "r") as f:
                metadata = json.load(f)
        except FileNotFoundError:
            # If no metadata exists, fetch it from Deezer
            track_info = deezer.get_song_infos_from_deezer_website(
                deezer.TYPE_TRACK, track_id
            )
            # 'SNG_ID, PRODUCT_TRACK_ID, UPLOAD_ID, SNG_TITLE, ART_ID, PROVIDER_ID, ART_NAME, ARTIST_IS_DUMMY, ARTISTS, ALB_ID, ALB_TITLE, TYPE, MD5_ORIGIN, VIDEO, DURATION, ALB_PICTURE, ART_PICTURE, RANK_SNG, FILESIZE_AAC_64, FILESIZE_AC4_IMS, FILESIZE_DD_JOC, FILESIZE_MP3_64, FILESIZE_MP3_128, FILESIZE_MP3_256, FILESIZE_MP3_320, FILESIZE_MP4_RA1, FILESIZE_MP4_RA2, FILESIZE_MP4_RA3, FILESIZE_MHM1_RA1, FILESIZE_MHM1_RA2, FILESIZE_MHM1_RA3, FILESIZE_FLAC, FILESIZE, GAIN, MEDIA_VERSION, DISK_NUMBER, TRACK_NUMBER, TRACK_TOKEN, TRACK_TOKEN_EXPIRE, VERSION, MEDIA, EXPLICIT_LYRICS, RIGHTS, ISRC, HIERARCHICAL_TITLE, SNG_CONTRIBUTORS, LYRICS_ID, EXPLICIT_TRACK_CONTENT, COPYRIGHT, PHYSICAL_RELEASE_DATE, S_MOD, S_PREMIUM, DATE_START_PREMIUM, DATE_START, STATUS, USER_ID, URL_REWRITING, SNG_STATUS, AVAILABLE_COUNTRIES, UPDATE_DATE, __TYPE__, DIGITAL_RELEASE_DATE'
            metadata = {
                "title": track_info["SNG_TITLE"],
                "artist": track_info["ART_NAME"],
                "duration": track_info["DURATION"],
                "cover": track_info["ART_PICTURE"],
                "album": track_info["ALB_TITLE"],
            }
            # Save metadata for future use
            with open(f"songs/{track_id}/metadata.json", "w") as f:
                json.dump(metadata, f)

        # Log the random selection
        db = get_db()
        db.execute(
            "INSERT INTO usage_logs (user_id, track_id, action) VALUES (?, ?, ?)",
            (session["user_id"], track_id, "random_play"),
        )
        db.commit()

        return jsonify({"track_id": track_id, "metadata": metadata})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/admin/stats", methods=["GET"])
@admin_required
def get_usage_stats():
    db = get_db()

    stats = {
        "total_users": db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "total_downloads": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'download'"
        ).fetchone()[0],
        "total_searches": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'search'"
        ).fetchone()[0],
        "total_random_plays": db.execute(
            "SELECT COUNT(*) FROM usage_logs WHERE action = 'random_play'"
        ).fetchone()[0],
        "most_active_user": db.execute(
            """
            SELECT u.username, COUNT(*) as count 
            FROM usage_logs l 
            JOIN users u ON l.user_id = u.id 
            GROUP BY u.id 
            ORDER BY count DESC 
            LIMIT 1
        """
        ).fetchone(),
    }

    if stats["most_active_user"]:
        stats["most_active_user"] = dict(stats["most_active_user"])

    return jsonify(stats)


if __name__ == "__main__":
    socketio.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=os.getenv("PORT", 5000),
        debug=os.getenv("DEBUG", True),
        allow_unsafe_werkzeug=True,
    )
