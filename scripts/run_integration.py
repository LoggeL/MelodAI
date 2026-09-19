"""Run HTTP integration tests against a disposable, offline Flask instance.

From the repository: uv run python scripts/run_integration.py
Optional arguments are forwarded to Vitest, for example --reporter=verbose.
No real account, provider API, audio download, or persistent database is used.
"""

from contextlib import ExitStack
import copy
import json
import logging
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# Loading a developer's .env is unnecessary for an isolated test server.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"

from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server, WSGIRequestHandler
from src.app import create_app
from src.models.db import transaction
from src.utils.file_handling import get_track_file_path, save_lyrics, save_metadata

FIXTURES = json.loads((ROOT / "frontend/e2e/fixtures.json").read_text())


class QuietHandler(WSGIRequestHandler):
    def log(self, *_args, **_kwargs):
        pass


def seed(app, username, password):
    with app.app_context():
        with transaction() as db:
            db.execute(
                "INSERT INTO users (username, email, display_name, password_hash, is_admin, is_approved, credits) VALUES (?, ?, ?, ?, 1, 1, 50)",
                [username, "admin@example.test", "Integration Admin", generate_password_hash(password)],
            )
            db.execute(
                "INSERT INTO error_log (error_type, source, error_message, track_id) VALUES ('pipeline', 'offline-fixture', 'Synthetic fixture error', ?)",
                [FIXTURES["tracks"][0]["id"]],
            )
            db.execute("INSERT INTO usage_logs (user_id, action, detail) VALUES (1, 'search', 'offline fixture')")
        for track in FIXTURES["tracks"]:
            save_metadata(track["id"], track)
            save_lyrics(track["id"], FIXTURES["lyrics"])
            # Valid PCM generated locally. API tests verify file serving and range
            # responses; this is not an MP3 codec or browser playback test.
            for kind in ("song", "vocals", "no_vocals"):
                with wave.open(get_track_file_path(track["id"], kind), "wb") as audio:
                    audio.setnchannels(1)
                    audio.setsampwidth(2)
                    audio.setframerate(8000)
                    audio.writeframes(b"\0\0" * 8000)


def main():
    unexpected = []

    def forbid_network(*args, **kwargs):
        unexpected.append("Unexpected provider/network call")
        raise AssertionError("External network is forbidden in offline integration tests")

    def search(_query, _kind):
        return copy.deepcopy(FIXTURES["tracks"])

    def health_checks():
        from src.models.db import query_db
        assert query_db("SELECT 1", one=True)[0] == 1
        return {"database": {"status": "ok", "message": "Isolated database available"},
                "providers": {"status": "ok", "message": "Offline deterministic fixtures"}}

    username = "integration-admin"
    password = secrets.token_urlsafe(24)
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    with tempfile.TemporaryDirectory(prefix="melodai-integration-") as directory, ExitStack() as patches:
        # Catch requests, SDKs using raw sockets, email, and accidental pipeline
        # work. Any such attempt fails the entire run even if a route catches it.
        patches.enter_context(patch("socket.socket.connect", side_effect=forbid_network))
        patches.enter_context(patch("requests.sessions.Session.request", side_effect=forbid_network))
        patches.enter_context(patch("src.services.deezer.deezer_search", side_effect=search))
        patches.enter_context(patch("src.utils.status_checks.run_health_checks", side_effect=health_checks))
        patches.enter_context(patch("src.routes.track.process_track", side_effect=forbid_network))
        patches.enter_context(patch("src.routes.auth.send_password_reset_email", side_effect=forbid_network))
        app = create_app({
            "TESTING": True,
            "STARTUP_HOOKS": False,
            "DATABASE": str(Path(directory) / "database.db"),
            "SONGS_PATH": str(Path(directory) / "songs"),
            "SECRET_KEY": secrets.token_hex(32),
            "SESSION_COOKIE_SECURE": False,
        })
        seed(app, username, password)
        server = make_server("127.0.0.1", 0, app, threaded=True, request_handler=QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = {**os.environ, "E2E_BASE_URL": f"http://127.0.0.1:{server.server_port}",
               "E2E_ADMIN_USER": username, "E2E_ADMIN_PASS": password, "E2E_OFFLINE": "1"}
        command = [str(ROOT / "frontend/node_modules/.bin/vitest"), "run", "--config", "e2e/vitest.config.ts", "e2e/integration/", *sys.argv[1:]]
        print("Running API integration tests with temporary storage and offline fixtures.", flush=True)
        try:
            result = subprocess.run(command, cwd=ROOT / "frontend", env=env, check=False)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        if unexpected:
            print(f"FAILED: {len(unexpected)} unexpected external call(s) were blocked.", file=sys.stderr)
            return 1
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
