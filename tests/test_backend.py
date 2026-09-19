"""Offline regression coverage. Run: uv run python -m unittest discover -s tests -v."""

import tempfile
import sqlite3
import threading
import time
from contextlib import ExitStack
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from werkzeug.security import generate_password_hash

from src.app import create_app
from src.models.db import get_db, query_db, transaction
from src.utils.file_handling import (
    get_song_dir, get_track_file_path, is_track_complete, load_metadata,
    save_metadata, save_lyrics, save_lyrics_raw,
)
from src.utils.status_checks import claim_processing, get_processing_status


class BackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = generate_password_hash("test-password")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.network = patch("requests.sessions.Session.request", side_effect=AssertionError("Network calls forbidden in offline tests"))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.app = self.make_app(self.root)
        with self.app.app_context():
            with transaction() as db:
                for username, admin in (("admin", 1), ("member", 0)):
                    db.execute(
                        "INSERT INTO users (username, password_hash, is_admin, is_approved, credits) VALUES (?, ?, ?, 1, 10)",
                        [username, self.password_hash, admin],
                    )
        self.client = self.client_for(1)

    def make_app(self, root):
        return create_app({
            "TESTING": True,
            "DATABASE": str(root / "database.db"),
            "SONGS_PATH": str(root / "songs"),
            "SECRET_KEY": "isolated-regression-test-secret",
            "SESSION_COOKIE_SECURE": False,
        })

    def client_for(self, user_id):
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
            session["session_version"] = 0
        return client

    def scalar(self, sql, params=()):
        with self.app.app_context():
            return query_db(sql, params, one=True)[0]

    def test_factory_skips_external_startup_and_isolates_storage(self):
        with patch("src.app._startup_hooks") as startup:
            second = self.make_app(self.root / "second")
        startup.assert_not_called()
        with self.app.app_context():
            save_metadata("123", {"title": "Only first app"})
            claim_processing("123", "metadata", 5)
        with second.app_context():
            self.assertEqual(query_db("SELECT COUNT(*) FROM users", one=True)[0], 0)
            self.assertIsNone(load_metadata("123"))
            self.assertIsNone(get_processing_status("123"))
        self.assertFalse((self.root / "second" / "songs").exists())

    def test_json_validation_returns_useful_json_errors(self):
        for body in ([], "hello", 7, {"username": None}, {"password": []}):
            with self.subTest(body=body):
                response = self.client.post("/api/auth/login", json=body)
                self.assertEqual(response.status_code, 400)
                self.assertIsInstance(response.json["error"], str)
        for path in ("/api/add", "/api/playlists", "/api/admin/users/2/credits", "/api/sync/command"):
            self.assertEqual(self.client.post(path, json=[]).status_code, 400)
        response = self.client.post("/api/auth/login", data='{broken', content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/no-such-route").status_code, 404)
        self.assertIn("error", self.client.get("/api/no-such-route").json)

    def test_invite_is_consumed_once_under_concurrent_signup(self):
        with self.app.app_context():
            with transaction() as db:
                db.execute("INSERT INTO invite_keys (key, created_by) VALUES ('invite', 1)")
        def register(index):
            return self.app.test_client().post("/api/auth/register", json={
                "username": f"invited-{index}", "password": "new-password", "invite_key": "invite",
            }).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(register, range(2)))
        self.assertEqual(sorted(statuses), [200, 400])
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM users WHERE username LIKE 'invited-%'"), 1)

    def test_first_admin_bootstrap_is_serialized(self):
        with self.app.app_context():
            with transaction() as db:
                db.execute("DELETE FROM users")
        def register(index):
            return self.app.test_client().post("/api/auth/register", json={
                "username": f"first-{index}", "password": "new-password",
            }).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(register, range(2))), [200, 200])
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM users WHERE is_admin = 1"), 1)

    def test_password_reset_revokes_sessions_and_is_single_use(self):
        other = self.client_for(2)
        with self.app.app_context():
            with transaction() as db:
                db.execute("INSERT INTO password_resets (user_id, token, expires_at) VALUES (2, 'reset', ?)", [(datetime.utcnow() + timedelta(hours=1)).isoformat()])
                db.execute("INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (2, 'remember', ?)", [(datetime.utcnow() + timedelta(days=1)).isoformat()])
        response = self.client.post("/api/auth/reset-password", json={"token": "reset", "password": "changed-password"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(other.get("/api/auth/check").json["authenticated"])
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM auth_tokens WHERE user_id = 2"), 0)
        self.assertEqual(self.client.post("/api/auth/reset-password", json={"token": "reset", "password": "another-password"}).status_code, 400)
        self.assertEqual(other.post("/api/auth/login", json={"username": "member", "password": "changed-password"}).status_code, 200)

    def test_password_change_keeps_caller_and_revokes_other_session(self):
        member = self.client_for(2)
        other = self.client_for(2)
        response = member.post("/api/auth/change-password", json={"current_password": "test-password", "new_password": "changed-password"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(member.get("/api/auth/check").json["authenticated"])
        self.assertFalse(other.get("/api/auth/check").json["authenticated"])

    def test_secure_remember_cookie_and_unchecked_remember_clears_old_token(self):
        self.app.config["SESSION_COOKIE_SECURE"] = True
        client = self.app.test_client()
        response = client.post("/api/auth/login", json={"username": "member", "password": "test-password", "remember": True})
        remember = next(cookie for cookie in response.headers.getlist("Set-Cookie") if cookie.startswith("auth_token="))
        self.assertIn("Secure;", remember)
        self.assertIn("HttpOnly;", remember)
        self.app.config["SESSION_COOKIE_SECURE"] = False
        response = client.post("/api/auth/login", json={"username": "admin", "password": "test-password", "remember": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM auth_tokens"), 0)

    def test_login_limit_cannot_be_bypassed_with_forwarded_header(self):
        client = self.app.test_client()
        for index in range(8):
            response = client.post("/api/auth/login", json={"username": "missing", "password": "wrong"}, headers={"X-Forwarded-For": f"10.0.0.{index}"})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(client.post("/api/auth/login", json={"username": "missing", "password": "wrong"}, headers={"X-Forwarded-For": "1.1.1.1"}).status_code, 429)

    def test_admin_credit_edits_are_bounded(self):
        for value in (-1, True, "3", 2.5, 1000001, None):
            self.assertEqual(self.client.post("/api/admin/users/2/credits", json={"credits": value}).status_code, 400)
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 10)
        self.assertEqual(self.client.post("/api/admin/users/999/credits", json={"credits": 5}).status_code, 404)

    def test_user_delete_cleans_dependents_atomically(self):
        with self.app.app_context():
            with transaction() as db:
                playlist = db.execute("INSERT INTO playlists (user_id, name) VALUES (2, 'Example')").lastrowid
                db.execute("INSERT INTO playlist_tracks (playlist_id, track_id) VALUES (?, '123')", [playlist])
                db.execute("INSERT INTO invite_keys (key, created_by) VALUES ('member-invite', 2)")
                db.execute("INSERT INTO favorites (user_id, track_id) VALUES (2, '123')")
        self.assertEqual(self.client.delete("/api/admin/users/2").status_code, 200)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM playlist_tracks"), 0)
        self.assertIsNone(self.scalar("SELECT created_by FROM invite_keys WHERE key = 'member-invite'"))
        with self.app.app_context():
            self.assertEqual(get_db().execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_transaction_rolls_back_all_writes(self):
        with self.app.app_context():
            with self.assertRaises(RuntimeError):
                with transaction() as db:
                    db.execute("UPDATE users SET credits = 999 WHERE id = 2")
                    raise RuntimeError("abort")
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 10)

    def test_failed_database_helpers_leave_connection_usable(self):
        from src.models.db import execute_db, insert_db
        with self.app.app_context():
            for write in (execute_db, insert_db):
                with self.assertRaises(sqlite3.IntegrityError):
                    write("INSERT INTO usage_logs (user_id, action) VALUES (999, 'test')")
                self.assertFalse(get_db().in_transaction)
                with transaction() as db:
                    db.execute("UPDATE users SET credits = credits + 1 WHERE id = 2")
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 12)

    def test_password_reset_during_login_cannot_mint_remember_token(self):
        def reset_after_password_check(*_):
            with transaction() as db:
                db.execute("UPDATE users SET session_version = session_version + 1 WHERE id = 2")
                db.execute("DELETE FROM auth_tokens WHERE user_id = 2")
            return True
        with patch("src.routes.auth.check_password_hash", side_effect=reset_after_password_check):
            client = self.app.test_client()
            response = client.post("/api/auth/login", json={
                "username": "member", "password": "test-password", "remember": True,
            })
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM auth_tokens"), 0)
        self.assertFalse(client.get("/api/auth/check").json["authenticated"])

    def test_remember_token_restores_only_current_approved_session(self):
        with self.app.app_context():
            with transaction() as db:
                db.execute("INSERT INTO auth_tokens (user_id, token, expires_at) VALUES (2, 'remember', ?)",
                           [(datetime.utcnow() + timedelta(days=1)).isoformat()])
        client = self.app.test_client()
        client.set_cookie("auth_token", "remember")
        self.assertTrue(client.get("/api/auth/check").json["authenticated"])
        with self.app.app_context():
            with transaction() as db:
                db.execute("UPDATE users SET session_version = session_version + 1 WHERE id = 2")
                db.execute("DELETE FROM auth_tokens WHERE user_id = 2")
        self.assertFalse(client.get("/api/auth/check").json["authenticated"])

    def test_admin_storage_uses_configured_database(self):
        response = self.client.get("/api/admin/storage")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["db_size"], (self.root / "database.db").stat().st_size)

    def test_reprocess_database_failure_releases_claim_and_keeps_artifacts(self):
        with self.app.app_context():
            save_metadata("123", {"title": "Keep"})
            save_lyrics("123", {"segments": []})
        with patch("src.routes.admin.execute_db", side_effect=sqlite3.OperationalError("database unavailable")):
            response = self.client.post("/api/admin/songs/123/reprocess", json={"from_stage": "all"})
        self.assertEqual(response.status_code, 503)
        with self.app.app_context():
            self.assertIsNone(get_processing_status("123"))
            self.assertTrue(Path(get_track_file_path("123", "lyrics")).exists())

    def test_concurrent_play_charges_do_not_overdraw(self):
        with self.app.app_context():
            with transaction() as db:
                db.execute("UPDATE users SET credits = 1 WHERE id = 2")
        def charge(_):
            return self.client_for(2).post("/api/play/123/credit").status_code
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(charge, range(10)))
        self.assertEqual(statuses.count(200), 1)
        self.assertEqual(statuses.count(403), 9)
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 0)

    def test_duplicate_processing_is_claimed_and_charged_once(self):
        def add(_):
            return self.client_for(2).post("/api/add", json={"id": "123"}).json["status"]
        # Start worker stubs only after executor threads have been created.
        class Worker:
            def __init__(self, *args, **kwargs):
                pass
            def start(self):
                pass
        with patch("src.routes.track.threading", wraps=__import__("threading")) as threading_module:
            threading_module.Thread = Worker
            with ThreadPoolExecutor(max_workers=6) as pool:
                statuses = list(pool.map(add, range(10)))
        self.assertEqual(statuses.count("processing"), 1)
        self.assertEqual(statuses.count("already_processing"), 9)
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 5)

    def test_worker_launch_failure_releases_claim_and_refunds(self):
        with patch("src.routes.track.threading.Thread.start", side_effect=RuntimeError("no worker")):
            response = self.client_for(2).post("/api/add", json={"id": "123"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 10)
        with self.app.app_context():
            self.assertIsNone(get_processing_status("123"))

    def test_active_processing_blocks_delete_and_reprocess(self):
        with self.app.app_context():
            save_metadata("123", {"title": "Keep"})
            claim_processing("123", "lyrics", 60)
        self.assertEqual(self.client.delete("/api/admin/songs/123").status_code, 409)
        self.assertEqual(self.client.post("/api/admin/songs/123/reprocess", json={"from_stage": "lyrics"}).status_code, 409)
        self.assertEqual(self.client.post("/api/admin/songs/123/reprocess", json={"from_stage": "invalid"}).status_code, 400)
        with self.app.app_context():
            self.assertEqual(load_metadata("123")["title"], "Keep")

    def test_song_delete_holds_claim_until_cleanup_finishes(self):
        from src.utils.file_handling import delete_track
        observed = []
        with self.app.app_context():
            save_metadata("123", {"title": "Incomplete"})

        def delete_with_concurrent_add(track_id):
            def add():
                return self.client_for(2).post("/api/add", json={"id": track_id})
            with ThreadPoolExecutor(max_workers=1) as pool:
                response = pool.submit(add).result()
            observed.append(response.json["status"])
            delete_track(track_id)

        with patch("src.utils.file_handling.delete_track", side_effect=delete_with_concurrent_add):
            self.assertEqual(self.client.delete("/api/admin/songs/123").status_code, 200)
        self.assertEqual(observed, ["already_processing"])
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 10)
        with self.app.app_context():
            self.assertIsNone(get_processing_status("123"))

    def test_sync_queue_validates_shape_and_commands(self):
        for body in ({"queue": {}}, {"queue": [None]}, {"queue": [], "currentIndex": 0}, {"isPlaying": "yes"}):
            self.assertEqual(self.client.put("/api/sync/queue", json=body).status_code, 400)
        for body in ({"command": "unknown"}, {"command": "seek", "payload": {"time": -2}}, {"command": "playIndex", "payload": {"index": True}}):
            self.assertEqual(self.client.post("/api/sync/command", json=body).status_code, 400)
        self.assertEqual(self.client.put("/api/sync/queue", json={"queue": [{"id": "123"}], "currentIndex": 0}).status_code, 200)
        self.assertEqual(self.client.post("/api/sync/command", json={"command": "playIndex", "payload": {"index": 1}}).status_code, 400)

    def test_concurrent_sync_updates_have_unique_versions(self):
        def update(_):
            return self.client_for(2).put("/api/sync/queue", json={"queue": [{"id": "123"}], "currentIndex": 0}).json["version"]
        with ThreadPoolExecutor(max_workers=6) as pool:
            versions = list(pool.map(update, range(12)))
        self.assertEqual(sorted(versions), list(range(1, 13)))
        self.assertEqual(self.scalar("SELECT version FROM sync_state WHERE user_id = 2"), 12)

    def test_sync_updates_broadcast_in_commit_order(self):
        first_broadcast = threading.Event()
        second_finished = threading.Event()
        delivered = []

        def broadcast(_user, _exclude, message):
            version = message["data"]["version"]
            if version == 1:
                first_broadcast.set()
                second_finished.wait(timeout=0.1)
            delivered.append(version)

        def update(second=False):
            if second:
                self.assertTrue(first_broadcast.wait(timeout=2))
            response = self.client_for(2).put("/api/sync/queue", json={"queue": [{"id": "123"}], "currentIndex": 0})
            if second:
                second_finished.set()
            return response.status_code

        with patch("src.routes.sync._broadcast", side_effect=broadcast):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(update)
                second = pool.submit(update, True)
                self.assertEqual([first.result(), second.result()], [200, 200])
        self.assertEqual(delivered, [1, 2])

    def test_sync_stream_sends_saved_state_and_cleans_up(self):
        queue = [{"id": "123", "title": "Saved song"}]
        self.client.put("/api/sync/queue", json={"queue": queue, "currentIndex": 0})
        response = self.client.get("/api/sync/stream?clientId=listener", buffered=False)
        try:
            chunks = iter(response.response)
            self.assertEqual(next(chunks), b": connected\n\n")
            event = next(chunks).decode()
            self.assertIn("event: sync_state", event)
            self.assertIn('"version": 1', event)
            self.assertIn("Saved song", event)
            self.assertIn('"initial": true', event)
            self.assertIn(b"event: sync_ready", next(chunks))
            self.client.put("/api/sync/queue", json={"queue": queue, "currentIndex": 0, "isPlaying": True})
            live = next(chunks).decode()
            self.assertIn('"version": 2', live)
            self.assertNotIn('"initial"', live)
        finally:
            response.close()
        self.assertEqual(self.app.extensions["sync_subscribers"], {})

    def test_sync_stream_finishes_hydration_without_a_new_snapshot(self):
        for saved in (False, True):
            with self.subTest(saved=saved):
                if saved:
                    self.client.put("/api/sync/queue", json={"queue": [{"id": "123"}], "currentIndex": 0})
                response = self.client.get("/api/sync/stream?clientId=listener&lastVersion=1", buffered=False)
                try:
                    chunks = iter(response.response)
                    self.assertEqual(next(chunks), b": connected\n\n")
                    self.assertIn(b"event: sync_ready", next(chunks))
                finally:
                    response.close()

    def test_missing_track_reads_do_not_create_phantom_songs(self):
        self.assertEqual(self.client.get("/api/track/123").status_code, 404)
        self.assertFalse((self.root / "songs").exists())

    def test_atomic_artifact_write_preserves_previous_file_on_failure(self):
        with self.app.app_context():
            save_metadata("123", {"title": "Before"})
            with patch("src.utils.file_handling.os.replace", side_effect=OSError("disk failure")):
                with self.assertRaises(OSError):
                    save_metadata("123", {"title": "After"})
            self.assertEqual(load_metadata("123")["title"], "Before")
            self.assertEqual(list(Path(get_song_dir("123")).glob("*.tmp")), [])

    def test_corrupt_or_empty_artifacts_are_not_ready(self):
        with self.app.app_context():
            save_metadata("123", {"title": "Example"})
            save_lyrics("123", {"segments": []})
            for key in ("song", "vocals", "no_vocals"):
                Path(get_track_file_path("123", key)).write_bytes(b"audio")
            self.assertTrue(is_track_complete("123"))
            Path(get_track_file_path("123", "vocals")).write_bytes(b"")
            self.assertFalse(is_track_complete("123"))
            Path(get_track_file_path("123", "metadata")).write_text("{truncated")
            self.assertIsNone(load_metadata("123"))

    def test_song_serving_rejects_symlink_escape(self):
        outside = self.root / "outside.txt"
        outside.write_text("private")
        with self.app.app_context():
            Path(get_song_dir("123"), "escape.txt").symlink_to(outside)
        self.assertEqual(self.client.get("/songs/123/escape.txt").status_code, 404)

    def test_favorite_insert_is_idempotent(self):
        def favorite(_):
            return self.client_for(2).post("/api/favorites/123").status_code
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(favorite, range(8))), [200] * 8)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM favorites WHERE user_id = 2"), 1)

    def test_pipeline_worker_limit_bounds_provider_concurrency(self):
        from src.routes.track import process_track
        active = 0
        peak = 0
        lock = threading.Lock()
        def stage(_):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.01)
            with lock:
                active -= 1
        with ExitStack() as mocks:
            mocks.enter_context(patch("src.routes.track._stage_metadata", side_effect=stage))
            for name in ("download", "split", "lyrics", "process_lyrics", "complete"):
                mocks.enter_context(patch("src.routes.track._stage_" + name))
            with ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(lambda index: process_track(str(index), self.app), range(6)))
        self.assertEqual(peak, 2)

    def test_pipeline_failure_refunds_and_hides_internal_error(self):
        from src.routes.track import process_track
        with self.app.app_context():
            with transaction() as db:
                db.execute("UPDATE users SET credits = 5 WHERE id = 2")
        with patch("src.routes.track._stage_metadata", side_effect=RuntimeError("internal-provider-detail")):
            process_track("123", self.app, charged_user_id=2)
        self.assertEqual(self.scalar("SELECT credits FROM users WHERE id = 2"), 10)
        with self.app.app_context():
            status = get_processing_status("123")
            self.assertEqual(status["status"], "error")
            self.assertNotIn("internal-provider-detail", status["detail"])
            self.assertEqual(query_db("SELECT COUNT(*) FROM processing_failures", one=True)[0], 1)

    def test_reprocess_all_invalidates_generated_artifacts_only(self):
        with self.app.app_context():
            save_metadata("123", {"title": "Example"})
            save_lyrics("123", {"segments": []})
            for key in ("song", "vocals", "no_vocals"):
                Path(get_track_file_path("123", key)).write_bytes(b"audio")
        with patch("threading.Thread.start"):
            response = self.client.post("/api/admin/songs/123/reprocess", json={"from_stage": "all"})
        self.assertEqual(response.status_code, 200)
        with self.app.app_context():
            self.assertIsNotNone(load_metadata("123"))
            self.assertTrue(Path(get_track_file_path("123", "song")).exists())
            for key in ("lyrics", "vocals", "no_vocals"):
                self.assertFalse(Path(get_track_file_path("123", key)).exists())

    def test_search_cache_expires_and_stays_bounded(self):
        from src.utils.cache import TTLCache
        cache = TTLCache(max_entries=2, ttl=10)
        with patch("src.utils.cache.time.monotonic", return_value=100):
            cache.set("old", [1])
            cache.set("recent", [2])
            cache.set("new", [3])
            self.assertIsNone(cache.get("old"))
            self.assertEqual(cache.get("recent"), [2])
        with patch("src.utils.cache.time.monotonic", return_value=111):
            self.assertIsNone(cache.get("recent"))
            self.assertIsNone(cache.get("new"))

    def test_list_form_whisperx_result_can_be_processed(self):
        from src.routes.track import _extract_whisperx_text, _stage_process_lyrics
        raw = [{"start": 0, "end": 1, "words": [{"word": "Hello", "start": 0, "end": 1}]}]
        self.assertEqual(_extract_whisperx_text(raw), "Hello")
        with self.app.app_context():
            save_lyrics_raw("123", raw)
            _stage_process_lyrics("123")
            self.assertTrue(Path(get_track_file_path("123", "lyrics")).exists())


if __name__ == "__main__":
    unittest.main()
