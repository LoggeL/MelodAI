# MelodAI - Karaoke App

**MelodAI** is a karaoke application that lets users search for songs, download them, split audio into vocals and instrumentals, and display synchronized lyrics. The project consists of a Flask backend and a JavaScript/HTML frontend.

## Features

- **Song Search**: Search for songs using Deezer's API
- **Audio Processing**: Downloads, splits audio (vocals/instrumentals), and extracts lyrics with AI models
- **Real-time Lyrics**: Displays synchronized lyrics that highlight along with playback
- **Playback Controls**: Allows volume adjustments for vocals and music, progress control, and queue management
- **User Authentication**: Secure login system with password reset and "Remember Me" functionality
- **Dark Mode**: Supports light and dark theme
- **Shareable Links**: Share songs via URLs (e.g., http://localhost:5000/#song=3122055081)
- **Queue Management**: Add multiple songs to queue and manage playback order
- **Random Song**: Play a random song from your processed collection

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
   git clone <repo-url>
   cd melodai

   # Optional: Setup virtual environment
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate

   # Install requirements
   pip install -r requirements.txt
   ```

2. Add environment variables in a `.env` file:

   ```plaintext
   HF_READ_TOKEN=<Your Hugging Face Token>
   REPLICATE_API_TOKEN=<Your Replicate Token>
   DEEZER_ARL=<Your Deezer ARL Token>

   # SMTP Configuration for Password Reset (optional, untested)
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-email@example.com
   SMTP_PASSWORD=your-password
   BASE_URL=http://localhost:5000
   ```

3. Start the backend:
   ```bash
   python main.py
   ```
4. Open `http://localhost:5000` in your browser

### Installation (With Docker)

Prerequisites: Docker installed

```bash
docker compose up
```

Access the frontend at `http://localhost`

## API Endpoints

### Song Management

- **`GET /search?q=<query>`**: Search for songs on Deezer
- **`GET /add?id=<track_id>`**: Process a track (download, split, extract lyrics)
- **`GET /track/<track_id>`**: Get track metadata
- **`POST /random`**: Get a random processed song

### Authentication

- **`POST /auth/login`**: Login with username and password
- **`POST /auth/register`**: Create a new account
- **`POST /auth/logout`**: End the current session
- **`POST /auth/forgot-password`**: Request a password reset
- **`POST /auth/reset-password`**: Reset password with token
- **`GET /auth/check`**: Check authentication status

## WebSocket Events

- **`track_progress`**: Real-time processing status updates
- **`track_ready`**: Notification when track processing is complete
- **`track_error`**: Error notifications during track processing

## Usage

1. Register an account (and wait for approval) or login (first user is admin)
2. Use the search bar to find songs
3. Click on a song to add it to your queue
4. Control playback with:
   - Play/Pause
   - Volume adjustments
   - Progress control
   - Queue management

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
