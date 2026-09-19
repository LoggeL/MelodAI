# HTTP and browser tests

Run the HTTP integration suite from the repository root:

```sh
uv run python scripts/run_integration.py
```

Or run `npm run test:integration` from `frontend/`. Install Python dependencies with `uv sync` and JavaScript dependencies with `npm ci --prefix frontend` first.

The runner creates its own temporary database and song directory, generates an admin password, binds Flask to an available loopback port, and removes its files when it exits. Startup hooks are disabled. Catalog searches and provider health results use deterministic fixtures. Unexpected provider, email, processing, or outgoing socket calls fail the run, including calls caught by a route's error handler. The suite excludes both the browser tests and the paid processing pipeline.

The generated audio is a one-second PCM WAV stored under the API's expected filenames. It verifies authentication, non-empty file handling, and HTTP byte ranges. These tests do not validate MP3 decoding, browser playback, music separation, or provider availability.

To target a dedicated live test instance, set `E2E_BASE_URL`, `E2E_ADMIN_USER`, and `E2E_ADMIN_PASS`, then run:

```sh
cd frontend
npx vitest run --config e2e/vitest.config.ts e2e/integration/
```

Live tests create and delete accounts, favorites, playlists, invite keys, and resolved error records. They require completed tracks `139470659`, `12345`, and `67890`, plus at least one error record. They assert these prerequisites instead of silently passing when fixtures are absent. The completed-track test verifies readiness before submitting `/api/add`, so missing fixtures cannot start paid processing. Set no `E2E_OFFLINE` flag when testing real catalog metadata.

Browser tests share the same explicit connection settings. The separate paid pipeline requires `E2E_ALLOW_PAID_PIPELINE=1`, `E2E_DEDICATED_PIPELINE_SERVER=1`, and an explicit `http://127.0.0.1:<port>` URL. Start it with disabled startup hooks and fresh, disposable storage. It verifies the catalog identity before submitting one processing request, never deletes data or retries a run, and preserves resulting files for audio/browser checks. Provider-internal retries still apply. A custom `E2E_TRACK_ID` also requires `E2E_TRACK_TITLE` and `E2E_TRACK_ARTIST`. It is never invoked by the offline runner.
