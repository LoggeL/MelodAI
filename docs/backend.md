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

## Deployment boundary

Processing claims, worker limits and SSE fan-out are in-process. Use one application process for these features. Running multiple independent web workers requires a shared job queue, distributed claim/refund bookkeeping and shared pub/sub. SQLite transactions protect credit balances and persisted sync versions, but do not make the in-memory coordinator distributed. A process termination during a charged job is also outside the automatic exception-refund guarantee.
