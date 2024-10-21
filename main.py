import deezer
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import replicate
import requests
import json

# env
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

print("Starting Deezer")
deezer.init_deezer_session()
deezer.test_deezer_login()


def de_search_track(search_term):

    print("Searching for", search_term)
    
    results = deezer.deezer_search(search_term, deezer.TYPE_TRACK)

    output = []
    for track in results:  # Assuming results is a list
        print(track)
        output.append({
            "id": track["id"],
            "title": track["title"],
            "artist": track["artist"],
            "thumb": track["img_url"],
        })

    # Prevent duplicates in trackName trackArtist
    seen = set()
    output = [x for x in output if not (x["title"] + x["artist"] in seen or seen.add(x["title"] + x["artist"]))]

    return output

@app.route('/search', methods=['GET'])
def search():
    search_term = request.args.get('q')
    if not search_term:
        return jsonify({"error": "Missing search term"}), 400
    
    results = de_search_track(search_term)
    return jsonify(results)

def de_add_track(track_id):

    os.makedirs("songs/{}".format(track_id), exist_ok=True)

    print("Processing Song", track_id)

    # Download song from deezer if it doesnt exist yet
    if not os.path.isfile("songs/{}/song.mp3".format(track_id)) or os.path.getsize("songs/{}/song.mp3".format(track_id)) > 0:
        print("Downloading Song")
        track_info = deezer.get_song_infos_from_deezer_website(deezer.TYPE_TRACK, track_id)
        print(track_info)
        deezer.download_song(track_info, "songs/{}/song.mp3".format(track_id))

    if not os.path.isfile("songs/{}/vocals.mp3".format(track_id)) or not os.path.isfile("songs/{}/no_vocals.mp3".format(track_id)):

        print("Splitting Song")

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
                "output_format": "mp3"
            }
        )
        print(output)

        # Save the vocals
        with open("songs/{}/vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["vocals"]).content)

        # Save the instrumental
        with open("songs/{}/no_vocals.mp3".format(track_id), "wb") as f:
            f.write(requests.get(output["no_vocals"]).content)

    # exists and file is not empty
    if not os.path.isfile("songs/{}/lyrics.json".format(track_id)) or os.path.getsize("songs/{}/vocals.mp3".format(track_id)) > 0:
        print("Extracting Lyrics")

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
                "huggingface_access_token": os.getenv("HF_READ_TOKEN")
            }
        )
        print(output)

        # Save the lyrics
        with open("songs/{}/lyrics.json".format(track_id), "w") as f:
            f.write(json.dumps(output))
        #=> {"segments":[{"end":30.811,"text":" The little tales they...","start":0.0},{"end":60.0,"text":" The little tales they...","start":30.811},...

    print("Done")

    return True

@app.route('/add', methods=['GET'])
def add():
    track_id = request.args.get('id')
    if not track_id:
        return jsonify({"error": "Missing track ID"}), 400
    
    de_add_track(track_id)
    return jsonify({"success": True})

if __name__ == '__main__':
    app.run(debug=True)