# MelodAI

AI-powered karaoke web application. Search for any song, and MelodAI automatically separates vocals from instrumentals, extracts word-level timed lyrics, and presents a synchronized karaoke player.

![Player](docs/screenshots/02-player.png)

## How It Works

1. **Search** for a song via Deezer's catalog
2. **Download** and decrypt the audio
3. **Split** vocals and instrumentals using [Demucs](https://github.com/adefossez/demucs) (via Replicate)
4. **Transcribe** lyrics with word-level timestamps using [WhisperX](https://github.com/m-bain/whisperX) (via Replicate)
5. **Process** lyrics into karaoke lines using an LLM (via OpenRouter)
6. **Play** with real-time word-highlighting, independent vocal/instrumental volume, and speaker colorization

## Screenshots

| Login | Library |
|-------|---------|
| ![Login](docs/screenshots/01-login.png) | ![Library](docs/screenshots/03-library.png) |

| Admin - Songs | Admin - Users |
|---------------|---------------|
| ![Admin Songs](docs/screenshots/04-admin-songs.png) | ![Admin Users](docs/screenshots/06-admin-users.png) |

| Song Detail | About |
|-------------|-------|
| ![Song Detail](docs/screenshots/05-song-detail.png) | ![About](docs/screenshots/07-about.png) |

## Tech Stack

- **Backend:** Python 3.12, Flask, SQLite
- **Frontend:** React, TypeScript, Vite, CSS Modules
- **Audio:** Web Audio API with dual GainNodes (vocals + instrumental)
- **AI Services:** Replicate (Demucs, WhisperX), OpenRouter (LLM lyrics processing)
- **Song Source:** Deezer

## Setup

### Prerequisites

- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 18+
- API keys for: Replicate, OpenRouter, Deezer ARL cookie
- Optional: Resend (for password reset emails)

### Installation

```bash
# Clone and install dependencies
git clone <repo-url> && cd MelodAI
uv sync
cd frontend && npm install
```

### Configuration

Copy `example.env` to `.env` and fill in your API keys:

```
DEEZER_ARL=<your deezer ARL cookie>
REPLICATE_API_TOKEN=<your replicate token>
HF_READ_TOKEN=<your huggingface token>
OPENROUTER_API_KEY=<your openrouter key>
RESEND_API_KEY=<optional, for password reset emails>
```

### Running

```bash
# Backend (port 5000)
uv run python main.py

# Frontend dev server (port 3000, proxies API to Flask)
cd frontend && npm run dev

# Production build (serves from Flask directly)
cd frontend && npm run build
```

### Testing

All tests require Flask running on port 5000.

```bash
cd frontend && npm run test:e2e         # Integration tests (62 tests)
cd frontend && npm run test:browser     # Puppeteer browser tests (32 tests)
cd frontend && npm run test:pipeline    # Live API pipeline test (~2.5 min)
```

## Architecture

```
MelodAI/
  main.py                  # Entry point
  src/
    app.py                 # Flask factory (create_app)
    routes/
      auth.py              # Login, register, password reset
      track.py             # Search, process, play (6-stage pipeline)
      admin.py             # User/song management, analytics
      static.py            # SPA serving + song file serving
    services/
      deezer.py            # Deezer API client + decryption
      lyrics.py            # LLM-based lyrics line splitting
    utils/
      helpers.py           # Lyrics post-processing pipeline
  frontend/
    src/
      hooks/usePlayer.ts   # Core audio engine (Web Audio API)
      components/Player/   # Karaoke display, controls
      pages/               # Login, Library, Admin, About
      services/api.ts      # API client layer
```

## License

Private project.
