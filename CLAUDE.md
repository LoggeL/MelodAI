# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MelodAI is an AI-powered karaoke web app. Users search for songs (via Deezer), which are then processed through a pipeline: download → vocal/instrumental separation (local BS-RoFormer worker via turbo-roformer, Replicate Demucs fallback) → speech-to-text with word-level timestamps (WhisperX via Replicate) → LLM-based lyrics line splitting (OpenRouter) → playback with synchronized word-highlighting karaoke display.

## Commands

### Running the App
```bash
uv run python main.py              # Start Flask backend (port 5000)
cd frontend && npm run dev          # Start Vite dev server (port 3000, proxies API to :5000)
cd frontend && npm run build        # Production build → outputs to src/static/
```

### Testing
Unit and integration tests run offline; the integration command starts an isolated Flask app with temporary storage. Browser tests require a separate running test app. Live pipeline tests require explicit opt-in and real provider credentials; see `frontend/e2e/README.md`.
```bash
uv run python -m unittest discover -s tests -v # Offline backend tests
cd frontend && npm test                 # Frontend unit and React regression tests
cd frontend && npm run test:integration # Isolated offline HTTP integration tests
cd frontend && npm run test:browser     # Browser tests against a dedicated test app
cd frontend && npm run test:pipeline    # Opt-in paid provider pipeline test
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
- **Audio engine**: `frontend/src/hooks/AudioPlayback.ts` owns audio resources; `usePlayer.ts` coordinates queue, route, and synchronization state
- **API layer**: `frontend/src/services/http.ts` handles bounded safe retries and errors; `api.ts` defines endpoint contracts
- **Styling**: CSS Modules + CSS custom properties for dark/light theming

### Processing Pipeline (6 threaded stages in `src/routes/track.py`)
1. **Metadata** (5%) — Fetch from Deezer API
2. **Downloading** (15%) — Download + decrypt via `src/services/deezer.py`
3. **Splitting** (35%) — local separation worker (`src/services/separation_worker.py`, BS-RoFormer via turbo-roformer, CPU) with automatic fallback to Demucs on Replicate; `SPLIT_BACKEND=local|replicate` (default `local`)
4. **Lyrics** (65%) — WhisperX on Replicate (word-level timestamps + speaker diarization)
5. **Processing** (87%) — LLM via OpenRouter (lyrics line splitting in `src/services/lyrics.py`)
6. **Complete** (100%)

### Song Storage
Each processed track produces 6 files at `src/songs/{track_id}/`: `metadata.json`, `song.mp3`, `vocals.mp3`, `no_vocals.mp3`, `lyrics.json`, `lyrics_raw.json`. `separation.json` records which backend/model produced the stems; a local re-split keeps the previous stems once as `vocals.demucs.mp3` / `no_vocals.demucs.mp3`.

### Local Separation
- The Flask process starts `python -m src.services.separation_worker` as a child process (unix socket `SEPARATION_SOCKET`, newline-delimited JSON). The worker loads the model once, runs one separation at a time on its main thread (8 threads, nice 10), and orders jobs by priority: interactive pipeline jobs first, batch re-split jobs after (a running batch job is preempted at the next chunk).
- `src/services/separation.py` supervises the worker, submits jobs, installs stems atomically (temp dir + `os.replace`) and writes `separation.json`. Worker unavailable/crash/timeout → `_stage_split` falls back to Replicate.
- Re-split all songs: `python -m src.tools.resplit --all` or the admin Songs tab (`/api/admin/separation*`). State in `resplit_state.json` next to the database (on `/data`), auto-resumed after restarts. Lyrics are not re-run.
- The Docker image installs the `separation` extra (CPU torch), downloads the checkpoint and compiles the kernels at build time (`scripts/prepare_separation.py`). Locally, `uv sync --extra separation` is optional; without it the app uses Replicate.
- Tests use the fake engine (`SEPARATION_ENGINE=fake`), no torch needed: `uv run python -m unittest tests.test_separation -v`.

### Dev Server Proxy
Vite dev server (port 3000) proxies `/api/*` and `/songs/*` to Flask (port 5000). All backend routes use the `/api` prefix (`/api/auth`, `/api/admin`, `/api/*` for track operations). Production serves the built SPA directly from Flask via the `static` blueprint.

## External Services
- **Deezer** — Song search, download, metadata (requires `DEEZER_ARL` cookie)
- **Replicate** — WhisperX + Demucs fallback (requires `REPLICATE_API_TOKEN`, `HF_READ_TOKEN`)
- **turbo-roformer** — local vocal separation (optional `separation` extra; weights downloaded from the model author's Hugging Face upload)
- **OpenRouter** — LLM for lyrics processing (requires `OPENROUTER_API_KEY`, model set via `LLM_MODEL`)
- **lrclib.net** — Reference lyrics fetching (no API key required)
- **Resend** — Password reset emails (optional, requires `RESEND_API_KEY`)

Copy `example.env` to `.env` and fill in the required values.

## Design System
- Concept „Bühne“: dark stage with a warm spotlight (default), paper-white light theme via `[data-theme='light']`
- Tokens in `frontend/src/styles/tokens.css` (colours only there); utilities (`.btn`, `.seg`, `.chip`, `.table`, `.stats`, …) in `frontend/src/styles/globals.css`; components use CSS Modules
- Red `--vocal` = voice, blue `--inst` = instrumental, `--spot` = spotlight accent
- Fonts: Archivo Variable (UI, condensed lyrics, wide headlines) and JetBrains Mono (numbers, kickers), self-hosted
- Icons: `<Icon name=… />` from `frontend/src/components/common/icons.ts`, no icon font
- UI copy is German with real umlauts; backend messages are mapped through `de()` in `frontend/src/utils/messages.ts`
- Keep e2e selector classes (`controls`, `resultItem`, `navTab`, `actionBtn`, …) and `data-testid`s stable; details in `docs/frontend.md`

## Important Constraints
- **Do NOT modify `src/services/deezer.py`** — Complex decryption logic, 707 lines
- **TypeScript strict mode** — No unused locals/parameters allowed
- **Auto-reprocess on startup**: Flask auto-reprocesses incomplete tracks after 5s. Isolated tests disable startup hooks through `STARTUP_HOOKS=False`; live pipeline tests use a fresh dedicated store.
- **Admin auto-creation**: If `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars are set, the admin account is created on startup if it doesn't exist.
- **Error logging**: 500 errors are caught by Flask's error handler and logged via `src/utils/error_logging.py`.
- Pipeline test track: Deezer ID 3135556 ("Harder, Better, Faster, Stronger" by Daft Punk)
