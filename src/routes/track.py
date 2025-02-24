from flask import Blueprint, jsonify, request, session, current_app
from ..models.db import get_db
from ..utils.decorators import login_required
from ..services.deezer import (
    deezer_search,
    get_song_infos_from_deezer_website,
    download_song,
)
from ..services.lyrics import process_lyrics
from ..utils.status_checks import (
    save_status_check,
    add_to_processing_queue,
    update_queue_item_status,
    remove_from_processing_queue,
)
import os
import random
import json
from pathlib import Path
import threading
from ..utils.extensions import socketio
import replicate
import requests

track_bp = Blueprint("track", __name__)

# Status constants
STATUS_OK = "OK"
STATUS_WARNING = "WARNING"
STATUS_ERROR = "ERROR"


def de_search_track(search_term):
    print("Searching for", search_term)
    try:
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
            if not (
                x["title"] + x["artist"] in seen or seen.add(x["title"] + x["artist"])
            )
        ]

        # Log successful search to status
        save_status_check(
            "Deezer Search",
            STATUS_OK,
            f"Successfully searched for '{search_term}' with {len(output)} results",
        )

        return output
    except Exception as e:
        # Log error to status
        save_status_check(
            "Deezer Search",
            STATUS_ERROR,
            f"Error searching for '{search_term}': {str(e)}",
        )
        raise


def split_track(track_id):
    if not os.path.isfile(
        "src/songs/{}/vocals.mp3".format(track_id)
    ) or not os.path.isfile("src/songs/{}/no_vocals.mp3".format(track_id)):

        print("Splitting Song")
        socketio.emit(
            "track_progress",
            {"track_id": track_id, "status": "splitting", "progress": 30},
        )
        # Update queue status
        update_queue_item_status(track_id, "splitting", 30)

        try:
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
            # Update queue status
            update_queue_item_status(track_id, "split_complete", 50)

            # Log successful split
            save_status_check(
                "Track Splitting", STATUS_OK, f"Successfully split track {track_id}"
            )

        except Exception as e:
            # Update queue status on error
            update_queue_item_status(track_id, "split_error", 30)

            # Log error
            save_status_check(
                "Track Splitting",
                STATUS_ERROR,
                f"Error splitting track {track_id}: {str(e)}",
            )
            raise


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
        # Update queue status
        update_queue_item_status(track_id, "downloading", 10)

        try:
            track_info = get_song_infos_from_deezer_website("track", track_id)
            download_song(track_info, f"src/songs/{track_id}/song.mp3")
            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "downloaded", "progress": 20},
            )
            # Update queue status
            update_queue_item_status(track_id, "downloaded", 20)

            # Log successful download
            save_status_check(
                "Track Download",
                STATUS_OK,
                f"Successfully downloaded track {track_id}: {track_info.get('SNG_TITLE', 'Unknown')} by {track_info.get('ART_NAME', 'Unknown')}",
            )

        except Exception as e:
            # Update queue status on error
            update_queue_item_status(track_id, "download_error", 0)

            # Log error
            save_status_check(
                "Track Download",
                STATUS_ERROR,
                f"Error downloading track {track_id}: {str(e)}",
            )
            raise


def de_add_track(track_id):
    with current_app.app_context():
        try:
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

                # Add to processing queue with metadata
                add_to_processing_queue(track_id, metadata)

                socketio.emit(
                    "track_progress",
                    {
                        "track_id": track_id,
                        "status": "metadata_complete",
                        "progress": 10,
                    },
                )
            else:
                # Load existing metadata
                with open(f"src/songs/{track_id}/metadata.json", "r") as f:
                    metadata = json.load(f)
                # Add to processing queue with metadata
                add_to_processing_queue(track_id, metadata)

            download_track(track_id)

            split_track(track_id)

            process_lyrics(track_id)

            print("Done")
            socketio.emit(
                "track_progress",
                {"track_id": track_id, "status": "complete", "progress": 100},
            )

            # Remove from processing queue when complete
            remove_from_processing_queue(track_id)

            # Log successful processing
            save_status_check(
                "Track Processing",
                STATUS_OK,
                f"Successfully processed track {track_id}",
            )

            return True

        except Exception as e:
            # Remove from processing queue on error
            remove_from_processing_queue(track_id)

            # Log error
            save_status_check(
                "Track Processing",
                STATUS_ERROR,
                f"Error processing track {track_id}: {str(e)}",
            )
            raise


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

                # Log the processing error
                save_status_check(
                    "Track Processing",
                    STATUS_ERROR,
                    f"Failed to process track {track_id}: {str(e)}",
                )

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
        # Log the error
        save_status_check(
            "Random Track Selection",
            STATUS_ERROR,
            f"Error selecting random track: {str(e)}",
        )
        return jsonify({"error": str(e)}), 500


@track_bp.route("/track/<track_id>", methods=["GET"])
def get_track_metadata(track_id):
    try:
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
    except Exception as e:
        # Log the error
        save_status_check(
            "Track Metadata",
            STATUS_ERROR,
            f"Error retrieving metadata for track {track_id}: {str(e)}",
        )
        raise
