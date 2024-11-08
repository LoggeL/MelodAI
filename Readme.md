# MelodAI - Karaoke App

**MelodAI** is a karaoke application that lets users search for songs, download them, split audio into vocals and instrumentals, and display synchronized lyrics. The project consists of a Flask backend and a JavaScript/HTML frontend.

## Features

- **Song Search**: Search for songs using Deezer's API.
- **Audio Processing**: Downloads, splits audio (vocals/instrumentals), and extracts lyrics with AI models.
- **Real-time Lyrics**: Displays synchronized lyrics that highlight along with playback.
- **Playback Controls**: Allows volume adjustments for vocals and music, progress control, and queue management.

## Setup

### Requirements

- **Python 3.10+**
- Deezer ARL Token, Replicate API, and Hugging Face Access (read-only) token

### Installation

1. Clone the repo and install dependencies:
   ```bash
   git clone <repo-url>
   cd melodai
   pip install -r requirements.txt
   ```
2. Add environment variables in a `.env` file:
   ```plaintext
   HF_READ_TOKEN=<Your Hugging Face Token>
   REPLICATE_API_TOKEN=<Your Replicate Token>
   DEEZER_ARL=<Your Deezer ARL Token>
   ```
3. Start the backend:
   ```bash
   python app.py
   ```
4. Open `http://localhost:3000` in your browser to run the frontend.

## API Endpoints

- **`GET /search?q=<query>`**: Search for a song on Deezer.
- **`GET /add?id=<track_id>`**: Download, split, and extract lyrics for a track.

## Usage

1. Use the search bar to find a song.
2. Add a song to the queue and start playback.
3. Control playback with play/pause, volume adjustments, and progress.

## License

This project is licensed under the MIT License. Enjoy singing with MelodAI! 🎶
