# Backend development and verification

The Flask factory accepts a configuration dictionary. Storage locations, cookie settings and startup work can be controlled without patching module globals:

```python
from src.app import create_app

app = create_app({
    "TESTING": True,
    "DATABASE": "/tmp/melodai-test/database.db",
    "SONGS_PATH": "/tmp/melodai-test/songs",
    "SECRET_KEY": "test-only-secret",
    "SESSION_COOKIE_SECURE": False,
})
```

Use a dedicated directory per test run. `TESTING=True` skips startup hooks, including admin bootstrap, Deezer initialization and automatic processing. It does not stub provider calls made by individual API endpoints. Seed test users explicitly and mock external providers when exercising search, processing, translations, reset email or health checks.

For a local server, `STARTUP_HOOKS=False` disables startup work without enabling Flask test behavior. Environment equivalents are `MELODAI_DATABASE`, `MELODAI_SONGS_PATH` and `MELODAI_STARTUP_HOOKS=0`. Default database and song locations remain `src/database.db` and `src/songs`.

## Local regression suite

```bash
uv run python -m unittest discover -s tests -v
```

These tests use temporary SQLite databases and song directories. HTTP provider requests are blocked. Coverage includes concurrent credit charges, signup and invite claims, processing claims and refunds, session revocation, sync version increments, request validation, foreign-key cleanup, atomic artifact replacement, path confinement and list-form transcription output.

The frontend API integration suite (`cd frontend && npm run test:integration`) starts its own temporary offline server. Browser tests and `test:integration:live` require an explicitly configured isolated server. Real song download, separation, transcription, translation and email delivery require provider credentials and a separate live run.

## Runtime behavior

- JSON API errors use `{"error": "..."}`. Mutation bodies must be JSON objects; text, integer, boolean, playback command and queue inputs are validated before writes.
- SQLite connections enable foreign keys and WAL. Signup/invite consumption, password changes, password resets, user deletion and sync updates use transactions. Credit deductions retain conditional SQL updates so concurrent requests cannot overdraw an account.
- Password changes invalidate other signed sessions and remember tokens. Password resets invalidate every existing session. The migration adds `users.session_version` with a default of zero, preserving sessions until credentials change.
- Remember cookies follow `SESSION_COOKIE_SECURE`. Production should set a stable `SECRET_KEY`. If absent, the generated local key is created with private permissions and protected against concurrent initialization.
- Same-origin requests are the default. Configure `CORS_ORIGINS` with explicit trusted origins only when a separate frontend origin is needed.
- `MAX_PROCESSING_WORKERS` (environment: `MELODAI_MAX_PROCESSING_WORKERS`) limits simultaneous pipelines, default two. Waiting tracks remain claimed, preventing duplicate charges within the app process. Worker launch or pipeline failure refunds the processing debit.
- Reprocessing an active song returns 409. Reprocess `all` replaces generated stems, lyrics and translations while retaining metadata and the original audio download. Song deletion returns 409 while processing is active.
- Metadata and lyrics replace files atomically. Reads of missing songs do not create directories; empty audio and corrupt JSON do not count as completed artifacts.
- Unknown non-API GET/HEAD paths without a file extension return the SPA `index.html` with status 404, so the German 404 page renders. Unknown `/api/*`, `/songs/*` and `/assets/*` paths keep JSON 404s.
- Song durations come from `metadata.json` (`duration`) or the search result. A complete local song without a stored duration is probed once with ffprobe and the result is written back into `metadata.json`; a request probes at most a few songs (`DURATION_PROBES_PER_REQUEST`), misses are remembered per process. Playlists include `covers` (up to four cover URLs, in playlist order).
- Admin: `DELETE /api/admin/invite-keys/<id>` revokes an unused key (409 once redeemed), `GET /api/admin/usage/daily?days=14` (1–90) returns per-day plays, searches, downloads and estimated credits (UTC days), `GET /api/admin/songs` adds `added_at`, song details add the file `modified` time. `GET /api/auth/profile/stats` adds `favorite_song` and `plays_this_month`. The migration only adds two indexes on `usage_logs` (`created_at`; `action, detail`).
- Search results use a bounded cache. Processing status, rate limits, cached searches and SSE subscribers belong to the app instance.
- Separation and transcription are local only. Their failures stop processing and refund charged credits; no audio is uploaded to Replicate. Legacy backend settings cannot enable cloud processing.

## Local vocal separation

Splitting (pipeline stage 3) runs BS-RoFormer locally with [turbo-roformer](https://github.com/LoggeL/turbo-roformer) exclusively. If the local worker is unavailable, crashes, stalls or reports an error, the stage fails without uploading audio.

**Process model.** `src/services/separation.py` (`WorkerManager`) starts `python -m src.services.separation_worker` as a child of the Flask process: at startup when startup hooks are enabled, otherwise on the first split. The worker loads the model once and serves a unix socket (`SEPARATION_SOCKET`, mode 0600) with newline-delimited JSON. It runs exactly one separation at a time, always on its main thread, with `SEPARATION_THREADS` torch threads at `nice` `SEPARATION_NICE`. A lock file next to the socket keeps it a singleton, and it exits when its parent process exits. If it crashes, the next job restarts it. A second crash, or a model that fails to load, disables local separation for `SEPARATION_FAILURE_BACKOFF` seconds; during that time splitting fails locally.

**Priorities.** Pipeline jobs are `interactive`; re-split jobs are `batch`. Interactive jobs always run first. With `SEPARATION_PREEMPT` (on by default), a running batch job stops at the next chunk boundary (about 6 s) when an interactive job arrives, and goes back to the head of the batch queue. Closing a job's connection cancels it. The client raises `SeparationUnavailable` when the worker sends nothing for `SEPARATION_IDLE_TIMEOUT` seconds (it sends a heartbeat every `SEPARATION_HEARTBEAT` s), when a running job makes no chunk progress for `SEPARATION_STALL_TIMEOUT` seconds, when an interactive job exceeds `SEPARATION_JOB_TIMEOUT` seconds, or when an interactive job waits longer than `SEPARATION_QUEUE_TIMEOUT` seconds in the queue.

**Hangs.** A job stuck inside native code never reaches a cancellation point while the worker's socket threads keep answering. Heartbeats therefore carry `running_idle_s` (seconds since the running job's last chunk). Any client that sees the running job idle for more than `SEPARATION_STALL_TIMEOUT` seconds, or that gets no message for `SEPARATION_IDLE_TIMEOUT` seconds, SIGKILLs the worker (`WorkerManager.kill_worker`) and raises `WorkerLost`; the next job starts a fresh worker. Several clients losing the same worker process count as one crash. The portable torch path is allowed by default. `SEPARATION_INTERACTIVE_REQUIRE_KERNELS=1` can require the fast kernels, and inputs longer than `SEPARATION_MAX_DURATION` seconds are refused. These failures stay local.

**Status texts.** While splitting, the status detail shows `Waiting in queue (position p)...`, `Loading separation model...` and `Separating vocals (k/n)...` (chunk k of n), with progress moving from 26 to 34 %. A worker failure stops the stage.

**Files.** The worker decodes `song.mp3` with ffmpeg and writes the separated instrumental to `no_vocals.mp3`. `vocals.mp3` is the mix minus the instrumental. Both are 128 kbit/s MP3. Outputs go into a temporary `.separation-*` directory inside the song folder and are moved into place with `os.replace` only after both exist. `separation.json` records the producer:

```json
{"backend": "local", "engine": "turbo-roformer", "model": "resurrection", "model_key": "resurrection", "version": "0.1.0",
 "precision": "bf16", "compute_backend": "kernels", "overlap": 2.0, "bitrate": "128k", "duration_s": 252.4,
 "wall_s": 180.2, "rtf": 0.714, "created_at": "..."}
```

Historical cloud-produced stems and their producer records remain readable; they do not trigger provider requests. Reprocessing from `splitting` or `all` deletes the record together with the stems.

**Re-split batch.** `python -m src.tools.resplit --all` (foreground) or `POST /api/admin/separation/resplit` (the admin Songs tab) re-separates every song that has `song.mp3`:

- It skips songs whose `separation.json` already names the configured model, the installed turbo-roformer version and the configured overlap. `--force` / `{"force": true}` re-splits them anyway.
- It keeps the previous non-local stems once, as `vocals.demucs.mp3` and `no_vocals.demucs.mp3` (hard links where possible).
- It runs the song with `batch` priority, then replaces both stems atomically and writes `separation.json`.
- On failure the old stems stay in place. The failure is logged and the batch moves on.
- A song on which the worker crashes or hangs (`WorkerLost`) is moved to the end of the queue and marked failed after three such losses, so one bad file cannot block the batch.
- It defers songs that are currently being processed and does not install a result if processing started meanwhile.
- Lyrics and timings are not changed.

The batch state is `resplit_state.json` in the database directory (`/data/db` in the container). A batch that was running when the container restarted resumes automatically about 15 s after startup (it waits up to 3 minutes for the lock while the previous container shuts down during a start-first deploy); a stopped batch does not. If the state says `running` but no runner is active, the admin panel offers **Resume**. Eight worker-unavailable results in a row (retries spread over about 50 minutes, longer than the crash backoff) stop the batch with status `error`. At startup only `.separation-*` folders older than 30 minutes are removed, so a deploy does not delete the previous container's in-flight output. `POST /api/admin/separation/resplit/stop` stops it. `GET /api/admin/separation` returns the worker state and the batch progress. A file lock lets only one runner work at a time, so the CLI refuses to run while the app's batch is active. Prefer the admin button: the CLI runs in its own process and cannot see the app's in-memory pipeline state, so it cannot defer songs that the app is processing at that moment.

**Configuration** (environment variables, also accepted as `create_app` config keys):

| Variable | Default | Meaning |
|---|---|---|
| `SPLIT_BACKEND` | `local` | local only; legacy values are ignored |
| `SEPARATION_THREADS` | `8` | torch threads; use the physical core count |
| `SEPARATION_NICE` | `10` | niceness of the worker process |
| `SEPARATION_OVERLAP` | `2.0` | predictions per sample (quality/speed) |
| `SEPARATION_PRECISION` | `bf16` | `bf16` (AVX512-BF16 kernels) or `fp32` |
| `SEPARATION_MODEL` | `resurrection` | turbo-roformer model name |
| `SEPARATION_SOCKET` | `/tmp/melodai-separation.sock` | worker socket |
| `SEPARATION_PREEMPT` | `1` | interactive jobs interrupt running batch jobs |
| `SEPARATION_WORKER_AUTOSTART` | `1` | start the worker on demand |
| `SEPARATION_IDLE_TIMEOUT` / `SEPARATION_STALL_TIMEOUT` / `SEPARATION_JOB_TIMEOUT` | `60` / `300` / `1800` | seconds, see above |
| `SEPARATION_QUEUE_TIMEOUT` | `900` | seconds an interactive job may wait in the queue before failing |
| `SEPARATION_HEARTBEAT` | `5` | seconds between worker heartbeats |
| `SEPARATION_MAX_DURATION` | `1200` | longest input (seconds); longer songs are refused |
| `SEPARATION_INTERACTIVE_REQUIRE_KERNELS` | `0` | refuse interactive jobs on the portable torch path when explicitly enabled |
| `SEPARATION_FAILURE_BACKOFF` | `600` | seconds without local separation after a load failure or repeated crash |
| `MELODAI_RESPLIT_STATE_PATH` | next to the database | re-split state file |

**Docker image.** The image installs the `separation` extra (CPU-only torch from the PyTorch CPU index) and runs `scripts/prepare_separation.py` at build time. That script downloads and sha256-checks the checkpoint into `/opt/turbo-roformer/models`, compiles the AVX512-BF16 kernels with `-march=native` into `/opt/turbo-roformer/kernels`, and runs a short smoke separation; a failing smoke test fails the build, and so does a kernel build failure on a CPU that supports the kernels (override with the build env `SEPARATION_ALLOW_TORCH_FALLBACK=1`). The image runs under `tini`, which forwards signals and reaps orphaned processes; `git` is needed by uv to install turbo-roformer from its tag. Dokploy builds on the production host, so the kernels match its CPU. `g++` stays in the image: on a different CPU the kernels are rebuilt on first use, and on a CPU without AVX512-BF16 the worker logs that it is using the slower exact fp32 torch path.

**Tests.** `tests/test_separation.py` starts real worker processes with the fake engine (`SEPARATION_ENGINE=fake`, no torch). It covers the protocol, priorities and preemption, cancellation, crashes, stalls, uncancellable hangs (worker killed and replaced, also from a waiting client), queue timeouts, load failures, local failure handling, atomic installs, backups, the batch (skip, failure, poison songs, resume incl. waiting for the lock, deferral, single runner) and the admin endpoints.

## Local lyrics transcription

The lyrics stage (pipeline stage 4) always runs [turbo-lyrics](https://github.com/LoggeL/turbo-lyrics) locally. A missing, crashed or stalled worker, a job error, or an unusable transcript fails the stage without an audio upload. Legacy `TRANSCRIBE_BACKEND` values cannot enable a cloud backend.

The engine transcribes the separated vocal stem in five steps:

1. An energy VAD finds the voiced regions.
2. Those regions are packed into as few 30 s Whisper windows as possible.
3. faster-whisper (large-v3-turbo, int8, greedy decoding) transcribes the windows in batches.
4. wav2vec2 CTC alignment adds word times.
5. The output has the WhisperX shape (`segments[].words[]` with `word`, `start`, `end`, `score`); every word has `end > start`, and words never overlap.

There is no speaker diarization, so every word is one speaker.

On an Apple M5 Pro CPU a 4:12 song takes about 41–48 s. Forced alignment of known lyrics takes about 14 s.

**Process model.** `src/services/transcription_worker.py` is a second long-lived worker, next to the separation worker. It reuses that worker's machinery:

- the `Worker` class: unix socket, priority queue, preemption, heartbeats, kill-on-hang;
- supervision and the job client (`WorkerManager`, `run_job` with op `transcribe`).

It runs in its own process for two reasons:

- CTranslate2 brings its own OpenMP runtime;
- a crash must not take separation down.

The worker loads Whisper and the aligners for `TRANSCRIBE_LANGUAGES` at startup. Other languages are loaded on demand.

**Shared CPU gate.** Both workers want all cores, and running them side by side only slows both down. A job computes only while its worker holds `melodai-compute.lock`, an exclusive `flock` (`src/services/compute_gate.py`; it sits next to the sockets, or at `COMPUTE_LOCK`). The rules:

- A worker whose next job is interactive registers that it is waiting.
- A batch job on the other worker (re-split) then stops at its next progress step and goes back to its queue.
- Batch jobs do not take the gate while an interactive job waits.
- Interactive jobs never preempt each other; they take turns.

A killed worker cannot leave the gate locked, because flock locks disappear with the process.

**Reference lyrics.** Verified reference lyrics are lrclib results whose title, artist and duration match the track.

- **Prefetch.** They are fetched in the background while the vocals are being separated, and the lyrics stage waits up to 20 s for them.
- **Synced times.** lrclib's synced line times are kept as `times` on the candidate. They help the alignment, and the cache stays version 2.
- **Language.** The language comes from the lyrics text, through a stopword count. Otherwise Whisper detects it on the fullest windows.

`TRANSCRIBE_REFERENCE_MODE` decides what happens to the lyrics:

- `shadow` (default): the lyrics are also force-aligned to the vocals, and the transcription is used.
  - The alignment goes to `lyrics_raw_reference.json`.
  - `transcription.json` records the alignment's quality gate and its agreement with the transcription (median start difference, share of words within 100/300 ms).
  - This collects real data before `prefer` is switched on.
- `prefer`: the alignment is used directly when it passes the gate, with no Whisper run (about 3× faster).
  - It carries `source: "reference"` and `line_starts`.
  - Stage 5 then skips the LLM correction and splits lines exactly at the reference lines (`correction_stats.method = "forced_alignment"`).
- `off`: transcription only.

The gate rejects an alignment for any of these reasons:

- mean word score below 0.6;
- more than 15 % of words below 0.3;
- more than 40 % of the voiced time left without words (the lyrics are missing parts);
- less than 70 % of the vocal stem voiced;
- line times more than 1.5 s away from lrclib's synced times.

**Status texts and files.**

- Progress runs from 37 to 65 %, with these status texts: `Waiting in queue (position p)...`, `Loading transcription model...`, `Transcribing vocals...`.
- Outputs go into a temporary `.transcription-*` folder in the song directory.
- `transcription.json` records the producer, for example `{"backend": "local", "engine": "turbo-lyrics", "mode": "shadow", "chosen": "asr", "language": "de", "rtf": 0.16, ...}`.
- The record is shown in the admin song details.
- Reprocessing from `lyrics`, `splitting` or `all` deletes it.
- `GET /api/admin/transcription` returns the worker state, and the status checks include a `transcription` entry.

**Configuration:**

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_BACKEND` | `local` | local only; legacy values are ignored |
| `TRANSCRIBE_REFERENCE_MODE` | `shadow` | `shadow`, `prefer` or `off`, see above |
| `TRANSCRIBE_THREADS` | `8` | CTranslate2/torch threads; use the physical core count |
| `TRANSCRIBE_MODEL` / `TRANSCRIBE_COMPUTE_TYPE` | `large-v3-turbo` / `int8` | Whisper model and weight type |
| `TRANSCRIBE_ALIGN_PRECISION` | `auto` | wav2vec2 in bf16 on CPUs with AVX512-BF16/AMX, else fp32 |
| `TRANSCRIBE_LANGUAGES` | `en,de` | aligners loaded at startup and downloaded into the image |
| `TRANSCRIBE_SOCKET` | `/tmp/melodai-transcription.sock` | worker socket |
| `TRANSCRIBE_NICE` / `TRANSCRIBE_PREEMPT` / `TRANSCRIBE_WORKER_AUTOSTART` | `10` / `1` / `1` | like the separation settings |
| `TRANSCRIBE_IDLE_TIMEOUT` / `TRANSCRIBE_STALL_TIMEOUT` / `TRANSCRIBE_JOB_TIMEOUT` / `TRANSCRIBE_QUEUE_TIMEOUT` | `60` / `300` / `900` / `900` | seconds |
| `TRANSCRIBE_FAILURE_BACKOFF` | `600` | seconds without local transcription after a load failure or repeated crash |
| `COMPUTE_LOCK` | next to the sockets | CPU gate shared by both workers |

**Docker image.** The image installs the `transcription` extra and runs `scripts/prepare_transcription.py` at build time. That script downloads Whisper and the `TRANSCRIBE_LANGUAGES` aligners into `$HF_HOME` (`/opt/huggingface`, about 3 GB) and runs a smoke transcription. Only Apache-licensed aligners are used (`facebook/wav2vec2-base-960h`, `jonatasgrosman/wav2vec2-large-xlsr-53-*`).

**Tests.** `tests/test_transcription.py` starts real worker processes with the fake engine (`TRANSCRIBE_ENGINE=fake`, no models). It covers:

- the protocol and the three reference modes;
- job validation;
- the shared gate: interactive transcription preempts a batch re-split, and interactive jobs never overlap;
- the lyrics stage with local failures, credit refunds and the reference prefetch;
- stage 5 with force-aligned lyrics.

## Deployment boundary

Processing claims, worker limits and SSE fan-out are in-process. Use one application process for these features. Running multiple independent web workers requires a shared job queue, distributed claim/refund bookkeeping and shared pub/sub. SQLite transactions protect credit balances and persisted sync versions, but do not make the in-memory coordinator distributed. A process termination during a charged job is also outside the automatic exception-refund guarantee.
