# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MelodAI is an AI-powered karaoke web app. Users search for songs (via Deezer), which are then processed through a pipeline: download → vocal/instrumental separation (Demucs via Replicate) → speech-to-text with word-level timestamps (WhisperX via Replicate) → LLM-based lyrics line splitting (OpenRouter) → playback with synchronized word-highlighting karaoke display.

## Commands

### Running the App
```bash
uv run python main.py              # Start Flask backend (port 5000)
cd frontend && npm run dev          # Start Vite dev server (port 3000, proxies API to :5000)
cd frontend && npm run build        # Production build → outputs to src/static/
```

### Testing
All tests require Flask running on port 5000.
```bash
cd frontend && npm run test:e2e         # All E2E tests (62 tests, ~60s timeout)
cd frontend && npm run test:integration # Integration tests only (auth, track, admin)
cd frontend && npm run test:browser     # Puppeteer browser tests (32 tests)
cd frontend && npm run test:pipeline    # Live API pipeline test (~2.5 min, costs ~$0.05-0.10)
```

Run a single test file:
```bash
cd frontend && npx vitest run --config e2e/vitest.config.ts e2e/integration/auth.test.ts
cd frontend && npx vitest run --config e2e/vitest.config.ts e2e/browser/player.test.ts
```

### Linting
```bash
cd frontend && npm run lint    # ESLint (TypeScript + React)
```

### Dependencies
```bash
uv sync                        # Python deps
cd frontend && npm install     # Frontend deps
```

## Architecture

### Backend (Flask + SQLite)
- **Entry**: `main.py` → `src/app.py` (factory pattern with `create_app()`)
- **Blueprints**: `auth` (login/register/reset), `track` (search/process/play), `admin` (users/analytics/songs), `static` (SPA + file serving)
- **Database**: SQLite at `src/database.db`, schema in `src/schema.sql` (8 tables: users, usage_logs, auth_tokens, password_resets, invite_keys, system_status, processing_failures, favorites)
- **Auth**: Session-based + 30-day remember-me tokens, `@login_required` and `@admin_required` decorators in `src/utils/decorators.py`

### Frontend (React + TypeScript + Vite)
- **Routing**: React Router with 5 pages — `/login`, `/` (player), `/about`, `/library`, `/admin/*`
- **Audio engine**: `frontend/src/hooks/usePlayer.ts` — Web Audio API with dual GainNodes (vocals + instrumental), independent volume control, preloading, animation-frame lyrics sync
- **API layer**: `frontend/src/services/api.ts` — Fetch wrapper with retry logic
- **Styling**: CSS Modules + CSS custom properties for dark/light theming

### Processing Pipeline (6 threaded stages in `src/routes/track.py`)
1. **Metadata** (5%) — Fetch from Deezer API
2. **Downloading** (15%) — Download + decrypt via `src/services/deezer.py`
3. **Splitting** (35%) — Demucs on Replicate (vocals/instrumental separation)
4. **Lyrics** (65%) — WhisperX on Replicate (word-level timestamps + speaker diarization)
5. **Processing** (87%) — LLM via OpenRouter (lyrics line splitting in `src/services/lyrics.py`)
6. **Complete** (100%)

### Song Storage
Each processed track produces 6 files at `src/songs/{track_id}/`: `metadata.json`, `song.mp3`, `vocals.mp3`, `no_vocals.mp3`, `lyrics.json`, `lyrics_raw.json`.

### Dev Server Proxy
Vite dev server (port 3000) proxies `/api/*` and `/songs/*` to Flask (port 5000). All backend routes use the `/api` prefix (`/api/auth`, `/api/admin`, `/api/*` for track operations). Production serves the built SPA directly from Flask via the `static` blueprint.

## External Services
- **Deezer** — Song search, download, metadata (requires `DEEZER_ARL` cookie)
- **Replicate** — Demucs + WhisperX models (requires `REPLICATE_API_TOKEN`, `HF_READ_TOKEN`)
- **OpenRouter** — LLM for lyrics processing (requires `OPENROUTER_API_KEY`, model set via `LLM_MODEL`)
- **Genius** — Lyrics fetching (optional, requires `GENIUS_BEARER_TOKEN`)
- **Resend** — Password reset emails (optional, requires `RESEND_API_KEY`)

Copy `example.env` to `.env` and fill in the required values.

## Design System
- Primary gradient: `#d90429` → `#8b0000` (red/crimson)
- Fonts: Barlow Condensed (headings), Poppins (body)
- Dark mode default via `[data-theme='dark']` CSS variables
- Glassmorphism containers, brutalist tags, pill buttons

## Important Constraints
- **Do NOT modify `src/services/deezer.py`** — Complex decryption logic, 707 lines
- **TypeScript strict mode** — No unused locals/parameters allowed
- **Auto-reprocess on startup**: Flask auto-reprocesses incomplete tracks after 5s. During tests, clear the processing queue via `remove_from_queue()` when deleting tracks to avoid race conditions.
- **Admin auto-creation**: If `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars are set, the admin account is created on startup if it doesn't exist.
- **Error logging**: 500 errors are caught by Flask's error handler and logged via `src/utils/error_logging.py`.
- Pipeline test track: Deezer ID 3135556 ("Harder, Better, Faster, Stronger" by Daft Punk)
