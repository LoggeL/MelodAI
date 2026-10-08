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
- Search results use a bounded cache. Processing status, rate limits, cached searches and SSE subscribers belong to the app instance.
- Replicate prediction creation retries explicit HTTP 429 responses at most three times, with at most 30 seconds of cumulative waiting. Accepted jobs, ambiguous network failures and HTTP 5xx responses are not resubmitted. WhisperX skips speaker detection when `HF_READ_TOKEN` is absent while retaining word alignment.

## Local vocal separation

Splitting (pipeline stage 3) runs BS-RoFormer locally with [turbo-roformer](https://github.com/LoggeL/turbo-roformer) when `SPLIT_BACKEND=local` (the default) and falls back to Demucs on Replicate when the local worker is unavailable, crashes, stalls or reports an error. `SPLIT_BACKEND=replicate` skips the worker entirely.

**Process model.** `src/services/separation.py` (`WorkerManager`) starts `python -m src.services.separation_worker` as a child of the Flask process: at startup when startup hooks are enabled, otherwise on the first split. The worker loads the model once and serves a unix socket (`SEPARATION_SOCKET`, mode 0600) with newline-delimited JSON. It runs exactly one separation at a time, always on its main thread, with `SEPARATION_THREADS` torch threads at `nice` `SEPARATION_NICE`. A lock file next to the socket keeps it a singleton, and it exits when its parent process exits. If it crashes, the next job restarts it. A second crash, or a model that fails to load, disables local separation for `SEPARATION_FAILURE_BACKOFF` seconds; during that time every split goes to Replicate.

**Priorities.** Pipeline jobs are `interactive`; re-split jobs are `batch`. Interactive jobs always run first. With `SEPARATION_PREEMPT` (on by default), a running batch job stops at the next chunk boundary (about 6 s) when an interactive job arrives, and goes back to the head of the batch queue. Closing a job's connection cancels it. The client raises `SeparationUnavailable` when the worker sends nothing for `SEPARATION_IDLE_TIMEOUT` seconds (it sends a heartbeat every `SEPARATION_HEARTBEAT` s), when a running job makes no chunk progress for `SEPARATION_STALL_TIMEOUT` seconds, when an interactive job exceeds `SEPARATION_JOB_TIMEOUT` seconds, or when an interactive job waits longer than `SEPARATION_QUEUE_TIMEOUT` seconds in the queue.

**Hangs.** A job stuck inside native code never reaches a cancellation point while the worker's socket threads keep answering. Heartbeats therefore carry `running_idle_s` (seconds since the running job's last chunk). Any client that sees the running job idle for more than `SEPARATION_STALL_TIMEOUT` seconds, or that gets no message for `SEPARATION_IDLE_TIMEOUT` seconds, SIGKILLs the worker (`WorkerManager.kill_worker`) and raises `WorkerLost`; the next job starts a fresh worker. Several clients losing the same worker process count as one crash. Interactive jobs also skip the worker when it runs without its fast kernels (`SEPARATION_INTERACTIVE_REQUIRE_KERNELS`), and inputs longer than `SEPARATION_MAX_DURATION` seconds are refused (both fall back to Replicate).

**Status texts.** While splitting, the status detail shows `Waiting in queue (position p)...`, `Loading separation model...` and `Separating vocals (k/n)...` (chunk k of n), with progress moving from 26 to 34 %. If the stage falls back, the detail reads `Switching to cloud separation...`.

**Files.** The worker decodes `song.mp3` with ffmpeg and writes the separated instrumental to `no_vocals.mp3`. `vocals.mp3` is the mix minus the instrumental. Both are 128 kbit/s MP3, like the compressed Replicate stems. Outputs go into a temporary `.separation-*` directory inside the song folder and are moved into place with `os.replace` only after both exist. `separation.json` records the producer:

```json
{"backend": "local", "engine": "turbo-roformer", "model": "resurrection", "model_key": "resurrection", "version": "0.1.0",
 "precision": "bf16", "compute_backend": "kernels", "overlap": 2.0, "bitrate": "128k", "duration_s": 252.4,
 "wall_s": 180.2, "rtf": 0.714, "created_at": "..."}
```

Replicate splits write `{"backend": "replicate", "engine": "demucs", "model": "cjwbw/demucs:...", ...}`. Reprocessing from `splitting` or `all` deletes the record together with the stems.

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
| `SPLIT_BACKEND` | `local` | `local` (worker, Replicate fallback) or `replicate` |
| `SEPARATION_THREADS` | `8` | torch threads; use the physical core count |
| `SEPARATION_NICE` | `10` | niceness of the worker process |
| `SEPARATION_OVERLAP` | `2.0` | predictions per sample (quality/speed) |
| `SEPARATION_PRECISION` | `bf16` | `bf16` (AVX512-BF16 kernels) or `fp32` |
| `SEPARATION_MODEL` | `resurrection` | turbo-roformer model name |
| `SEPARATION_SOCKET` | `/tmp/melodai-separation.sock` | worker socket |
| `SEPARATION_PREEMPT` | `1` | interactive jobs interrupt running batch jobs |
| `SEPARATION_WORKER_AUTOSTART` | `1` | start the worker on demand |
| `SEPARATION_IDLE_TIMEOUT` / `SEPARATION_STALL_TIMEOUT` / `SEPARATION_JOB_TIMEOUT` | `60` / `300` / `1800` | seconds, see above |
| `SEPARATION_QUEUE_TIMEOUT` | `900` | seconds an interactive job may wait in the queue before falling back to Replicate |
| `SEPARATION_HEARTBEAT` | `5` | seconds between worker heartbeats |
| `SEPARATION_MAX_DURATION` | `1200` | longest input (seconds) separated locally; longer songs go to Replicate |
| `SEPARATION_INTERACTIVE_REQUIRE_KERNELS` | `1` | send interactive jobs to Replicate when the worker runs on the slow torch path |
| `SEPARATION_FAILURE_BACKOFF` | `600` | seconds without local separation after a load failure or repeated crash |
| `MELODAI_RESPLIT_STATE_PATH` | next to the database | re-split state file |

**Docker image.** The image installs the `separation` extra (CPU-only torch from the PyTorch CPU index) and runs `scripts/prepare_separation.py` at build time. That script downloads and sha256-checks the checkpoint into `/opt/turbo-roformer/models`, compiles the AVX512-BF16 kernels with `-march=native` into `/opt/turbo-roformer/kernels`, and runs a short smoke separation; a failing smoke test fails the build, and so does a kernel build failure on a CPU that supports the kernels (override with the build env `SEPARATION_ALLOW_TORCH_FALLBACK=1`). The image runs under `tini`, which forwards signals and reaps orphaned processes; `git` is needed by uv to install turbo-roformer from its tag. Dokploy builds on the production host, so the kernels match its CPU. `g++` stays in the image: on a different CPU the kernels are rebuilt on first use, and on a CPU without AVX512-BF16 the worker logs that it is using the slower exact fp32 torch path.

**Tests.** `tests/test_separation.py` starts real worker processes with the fake engine (`SEPARATION_ENGINE=fake`, no torch). It covers the protocol, priorities and preemption, cancellation, crashes, stalls, uncancellable hangs (worker killed and replaced, also from a waiting client), queue timeouts, load failures, the Replicate fallback, atomic installs, backups, the batch (skip, failure, poison songs, resume incl. waiting for the lock, deferral, single runner) and the admin endpoints.

## Deployment boundary

Processing claims, worker limits and SSE fan-out are in-process. Use one application process for these features. Running multiple independent web workers requires a shared job queue, distributed claim/refund bookkeeping and shared pub/sub. SQLite transactions protect credit balances and persisted sync versions, but do not make the in-memory coordinator distributed. A process termination during a charged job is also outside the automatic exception-refund guarantee.
