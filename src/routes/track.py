from flask import Blueprint, jsonify, request, session, current_app
from ..models.db import get_db
from ..utils.decorators import login_required
from ..services.deezer import (
    deezer_search,
    get_song_infos_from_deezer_website,
    download_song,
)
from ..services.lyrics import process_lyrics
import os
import random
import json
from pathlib import Path
import threading
from ..utils.extensions import socketio
import replicate
import requests

track_bp = Blueprint("track", __name__)


def de_search_track(search_term):
    print("Searching for", search_term)
    results = deezer_search(search_term, "track")

    output = []
    for track in results:
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


def split_track(track_id):
    if not os.path.isfile(
        "src/songs/{}/vocals.mp3".format(track_id)
    ) or not os.path.isfile("src/songs/{}/no_vocals.mp3".format(track_id)):

        print("Splitting Song")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "splitting", "progress": 30},
        )

        with open("src/songs/{}/song.mp3".format(track_id), "rb") as song_file:
            output = replicate.run(
                "ryan5453/demucs:7a9db77ed93f8f4f7e233a94d8519a867fbaa9c6d16ea5b53c1394f1557f9c61",
                input={
                    "jobs": 0,
                    "audio": song_file,
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
        with open("src/songs/{}/vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["vocals"]).content)  # type: ignore

        # Save the instrumental
        with open("src/songs/{}/no_vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["no_vocals"]).content)  # type: ignore

        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "split_complete", "progress": 50},
        )


def download_track(track_id):
    # Download song
    if (
        not os.path.isfile(f"src/songs/{track_id}/song.mp3")
        or os.path.getsize(f"src/songs/{track_id}/song.mp3") == 0
    ):
        print("Downloading Song")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "downloading", "progress": 10},
        )
        track_info = get_song_infos_from_deezer_website("track", track_id)
        download_song(track_info, f"src/songs/{track_id}/song.mp3")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "downloaded", "progress": 20},
        )


def de_add_track(track_id):
    with current_app.app_context():
        os.makedirs(f"src/songs/{track_id}", exist_ok=True)

        print("Processing Song", track_id)
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "starting", "progress": 0},
        )

        # Check if metadata exists
        if (
            not os.path.isfile(f"src/songs/{track_id}/metadata.json")
            or os.path.getsize(f"src/songs/{track_id}/metadata.json") == 0
        ):
            print("Fetching Metadata")
            track_info = get_song_infos_from_deezer_website("track", track_id)
            metadata = {
                "title": track_info["SNG_TITLE"],  # type: ignore
                "artist": track_info["ART_NAME"],  # type: ignore
                "duration": track_info["DURATION"],  # type: ignore
                "cover": track_info["ALB_PICTURE"],  # type: ignore
                "album": track_info["ALB_TITLE"],  # type: ignore
            }
            with open(f"src/songs/{track_id}/metadata.json", "w") as f:
                json.dump(metadata, f)

            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "metadata_complete", "progress": 10},
            )

        download_track(track_id)

        split_track(track_id)

        lyrics_success = process_lyrics(track_id)
        
        if not lyrics_success:
            print(f"Failed to process lyrics for track {track_id}")
            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "error", "progress": 100, "error": "Failed to process lyrics"},
            )
            return False

        print("Done")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "complete", "progress": 100},
        )
        return True


@track_bp.route("/search", methods=["GET"])
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


@track_bp.route("/add", methods=["GET"])
@login_required
def add():
    track_id = request.args.get("id")
    if not track_id:
        return jsonify({"error": "Missing track ID"}), 400

    # Start processing in background
    def process_track(app):
        with app.app_context():
            try:
                de_add_track(track_id)
                socketio.emit("track_ready", {"track_id": track_id})
            except Exception as e:
                print("Error processing track", e)
                socketio.emit("track_error", {"track_id": track_id, "error": str(e)})
                
                # Log the failure to database
                db = get_db()
                existing_failure = db.execute(
                    "SELECT * FROM track_failures WHERE track_id = ?", (track_id,)
                ).fetchone()
                
                if existing_failure:
                    # Increment failure count
                    db.execute(
                        """UPDATE track_failures 
                           SET failure_count = failure_count + 1, 
                               error_message = ?, 
                               last_attempt = CURRENT_TIMESTAMP 
                           WHERE track_id = ?""",
                        (str(e), track_id)
                    )
                else:
                    # Create new failure record
                    db.execute(
                        """INSERT INTO track_failures (track_id, error_message) 
                           VALUES (?, ?)""",
                        (track_id, str(e))
                    )
                db.commit()

    # Log the download
    db = get_db()
    db.execute(
        "INSERT INTO usage_logs (user_id, track_id, action) VALUES (?, ?, ?)",
        (session["user_id"], track_id, "download"),
    )
    db.commit()

    # Start processing in a new thread with app instance
    thread = threading.Thread(
        target=process_track, args=(current_app._get_current_object(),)
    )
    thread.start()

    return jsonify({"success": True})


@track_bp.route("/random", methods=["POST"])
@login_required
def random_song():
    try:
        data = request.get_json()
        exclude_ids = data.get("exclude_ids", [])

        # Get all processed songs
        processed_songs = []
        songs_dir = "src/songs"
        for track_id in os.listdir(songs_dir):
            if os.path.isfile(
                os.path.join(songs_dir, track_id, "metadata.json")
            ) and os.path.isfile(os.path.join(songs_dir, track_id, "lyrics.json")):
                if track_id not in exclude_ids:
                    processed_songs.append(track_id)

        if not processed_songs:
            return jsonify({"error": "No available songs"}), 404

        track_id = random.choice(processed_songs)

        with open(f"src/songs/{track_id}/metadata.json") as f:
            metadata = json.load(f)

        # Log the random play
        db = get_db()
        db.execute(
            "INSERT INTO usage_logs (user_id, track_id, action) VALUES (?, ?, ?)",
            (session["user_id"], track_id, "random_play"),
        )
        db.commit()

        return jsonify({"track_id": track_id, "metadata": metadata})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@track_bp.route("/track/<track_id>", methods=["GET"])
def get_track_metadata(track_id):
    metadata_path = Path(f"src/songs/{track_id}/metadata.json")
    if metadata_path.exists():
        with open(metadata_path) as f:
            metadata = json.load(f)
        return jsonify(metadata)

    track_info = get_song_infos_from_deezer_website("track", track_id)
    metadata = {
        "title": track_info["SNG_TITLE"],  # type: ignore
        "artist": track_info["ART_NAME"],  # type: ignore
        "duration": track_info["DURATION"],  # type: ignore
        "cover": track_info["ALB_PICTURE"],  # type: ignore
        "album": track_info["ALB_TITLE"],  # type: ignore
    }
    return jsonify(metadata)
