# MelodAI - Karaoke App

**MelodAI** is a karaoke application that lets users search for songs, download them, split audio into vocals and instrumentals, and display synchronized lyrics. The project consists of a Flask backend and a JavaScript/HTML frontend.

## Features

- **Song Search**: Search for songs using Deezer's API.
- **Audio Processing**: Downloads, splits audio (vocals/instrumentals), and extracts lyrics with AI models.
- **Real-time Lyrics**: Displays synchronized lyrics that highlight along with playback.
- **Playback Controls**: Allows volume adjustments for vocals and music, progress control, and queue management.
- **User Authentication**: Secure login system with password reset and "Remember Me" functionality.

## Setup

### Requirements

- **Python 3.10+**
- Deezer ARL Token
- Replicate API Token
- Hugging Face Access Token (read-only)
- SMTP Server (for password reset emails)

### Installation (Without Docker)

1. Clone the repo and install dependencies:
   ```bash
   # Setup repository
   git clone <repo-url>
   cd melodai-min

   # Optional: Setup virtual environment
   python -m venv .venv
   source .venv/bin/activate

   # Install requirements
   pip install -r requirements.txt
   ```
2. Add environment variables in a `.env` file:
   ```plaintext
   HF_READ_TOKEN=<Your Hugging Face Token>
   REPLICATE_API_TOKEN=<Your Replicate Token>
   DEEZER_ARL=<Your Deezer ARL Token>
   
   # SMTP Configuration for Password Reset
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-email@example.com
   SMTP_PASSWORD=your-password
   BASE_URL=http://localhost:5000
   ```
3. Start the backend:
   ```bash
   # Start the backend via
   python main.py
   # OR
   flask --app main run --port 5000
   ```
4. Open `http://localhost:5000` in your browser to run the frontend.

### Installation (With Docker)

Prerequisites: Docker is installed

```bash
docker compose up
```

Access the frontend at `http://localhost`

## API Endpoints

### Song Management
- **`GET /search?q=<query>`**: Search for a song on Deezer.
- **`GET /add?id=<track_id>`**: Download, split, and extract lyrics for a track.

### Authentication
- **`POST /auth/login`**: Login with username and password
- **`POST /auth/register`**: Create a new account
- **`POST /auth/logout`**: End the current session
- **`POST /auth/forgot-password`**: Request a password reset
- **`POST /auth/reset-password`**: Reset password with token

## Usage

1. Register an account or login if you already have one.
2. Use the search bar to find a song.
3. Add a song to the queue and start playback.
4. Control playback with play/pause, volume adjustments, and progress.

## Security Features

- Secure password hashing
- Session-based authentication
- Remember me functionality (30-day persistence)
- Password reset via email
- Rate limiting on authentication endpoints
- CSRF protection
- Secure cookie handling

## License

This project is licensed under the MIT License. Enjoy singing with MelodAI! 🎶
