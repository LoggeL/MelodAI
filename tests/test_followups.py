"""Offline tests for the redesign follow-ups: SPA 404, durations, playlist covers, admin usage/keys/dates, profile stats.

Run: uv run python -m unittest tests.test_followups -v
"""

import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from werkzeug.security import generate_password_hash

from src.app import create_app
from src.models.db import query_db, transaction
from src.utils.file_handling import get_track_file_path, load_metadata, save_lyrics, save_metadata


class FollowupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        network = patch("requests.sessions.Session.request", side_effect=AssertionError("Network calls forbidden in offline tests"))
        network.start()
        self.addCleanup(network.stop)
        self.app = create_app({
            "TESTING": True,
            "DATABASE": str(self.root / "database.db"),
            "SONGS_PATH": str(self.root / "songs"),
            "SECRET_KEY": "isolated-followup-test-secret",
            "SESSION_COOKIE_SECURE": False,
        })
        password_hash = generate_password_hash("test-password")
        with self.app.app_context(), transaction() as db:
            for username, admin in (("admin", 1), ("member", 0)):
                db.execute(
                    "INSERT INTO users (username, password_hash, is_admin, is_approved, credits) VALUES (?, ?, ?, 1, 10)",
                    [username, password_hash, admin],
                )
        self.admin = self.client_for(1)
        self.member = self.client_for(2)

    def client_for(self, user_id):
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
            session["session_version"] = 0
        return client

    def add_song(self, track_id, title="Demo", duration=180, img_url="https://example.test/56x56/a.jpg", complete=True):
        with self.app.app_context():
            meta = {"id": track_id, "title": title, "artist": "Demo Artist", "album": "Demo"}
            if duration is not None:
                meta["duration"] = duration
            if img_url is not None:
                meta["img_url"] = img_url
            save_metadata(track_id, meta)
            if complete:
                save_lyrics(track_id, {"segments": []})
                for key in ("song", "vocals", "no_vocals"):
                    Path(get_track_file_path(track_id, key)).write_bytes(b"audio")

    def log(self, user_id, action, detail, created_at=None):
        with self.app.app_context(), transaction() as db:
            if created_at:
                db.execute("INSERT INTO usage_logs (user_id, username, action, detail, created_at) VALUES (?, 'x', ?, ?, ?)",
                           [user_id, action, detail, created_at])
            else:
                db.execute("INSERT INTO usage_logs (user_id, username, action, detail) VALUES (?, 'x', ?, ?)",
                           [user_id, action, detail])

    # ─── SPA fallback ───

    def test_unknown_page_serves_spa_with_404_status(self):
        for path in ("/does-not-exist", "/admin/unknown/deep/path", "/library/extra"):
            with self.subTest(path=path):
                response = self.member.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertTrue(response.content_type.startswith("text/html"))
                self.assertIn(b'id="root"', response.data)
        self.assertEqual(self.member.head("/nope").status_code, 404)

    def test_unknown_api_static_and_file_urls_keep_plain_404(self):
        for path in ("/api/no-such-route", "/api/admin/nothing-here"):
            response = self.admin.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json, {"error": response.json["error"]})
        self.assertEqual(self.admin.post("/api/no-such-route", json={}).status_code, 404)
        for path in ("/assets/missing-abc.js", "/robots.txt", "/songs/123/song.mp3"):
            with self.subTest(path=path):
                response = self.member.get(path)
                self.assertEqual(response.status_code, 404)
                self.assertNotIn(b'id="root"', response.data)
        # A POST to an unknown page is not an SPA navigation.
        self.assertNotIn(b'id="root"', self.member.post("/does-not-exist").data)

    def test_known_spa_routes_still_return_200(self):
        for path in ("/", "/login", "/library", "/admin/songs", "/song/123"):
            with self.subTest(path=path):
                self.assertEqual(self.member.get(path).status_code, 200)

    # ─── Durations ───

    def test_search_returns_deezer_durations_and_library_fallback(self):
        self.add_song("222", duration=201)
        payload = {"data": [
            {"id": 111, "title": "Remote", "duration": 245, "preview": "p", "artist": {"name": "A"},
             "album": {"id": 9, "title": "Al", "cover_small": "https://example.test/56x56/c.jpg"}},
            {"id": 222, "title": "Local", "artist": {"name": "B"}, "album": {"id": 8, "title": "Bl", "cover_small": ""}},
            {"broken": True},
        ]}
        session = MagicMock()
        session.get.return_value.json.return_value = payload
        with patch("src.services.deezer.session", session):
            response = self.member.get("/api/search?q=demo")
        self.assertEqual(response.status_code, 200)
        rows = {row["id"]: row for row in response.json}
        self.assertEqual(set(rows), {"111", "222"})
        self.assertEqual(rows["111"]["duration"], 245)
        self.assertEqual(rows["111"]["img_url"], "https://example.test/200x200/c.jpg")
        self.assertEqual(rows["222"]["duration"], 201)
        self.assertEqual(session.get.call_args.kwargs["params"], {"q": "demo"})

    def test_missing_duration_is_probed_once_and_cached(self):
        self.add_song("333", duration=None)
        self.add_song("334", duration=0)
        with patch("src.utils.file_handling.probe_duration", return_value=187) as probe:
            first = {t["id"]: t["duration"] for t in self.member.get("/api/track/library").json}
            second = {t["id"]: t["duration"] for t in self.member.get("/api/track/library").json}
        self.assertEqual(first, {"333": 187, "334": 187})
        self.assertEqual(second, first)
        self.assertEqual(probe.call_count, 2)  # one per song, the second request reads metadata.json
        with self.app.app_context():
            self.assertEqual(load_metadata("333")["duration"], 187)

    def test_failed_probe_is_not_repeated_and_requests_are_bounded(self):
        from src.routes import track
        for index in range(track.DURATION_PROBES_PER_REQUEST + 3):
            self.add_song(str(500 + index), duration=None)
        with patch("src.utils.file_handling.probe_duration", return_value=None) as probe:
            self.member.get("/api/track/library")
            self.assertEqual(probe.call_count, track.DURATION_PROBES_PER_REQUEST)
            self.member.get("/api/track/library")
            self.member.get("/api/track/library")
        self.assertEqual(probe.call_count, track.DURATION_PROBES_PER_REQUEST + 3)

    def test_track_info_and_queue_sync_carry_duration(self):
        self.add_song("444", duration=93)
        self.assertEqual(self.member.get("/api/track/444").json["metadata"]["duration"], 93)
        ok = self.member.put("/api/sync/queue", json={"queue": [{"id": "444", "title": "t", "duration": 93}], "currentIndex": 0, "isPlaying": False})
        self.assertEqual(ok.status_code, 200)
        for bad in ('"3"', "true", "-1", "1e999"):
            with self.subTest(duration=bad):
                body = '{"queue": [{"id": "444", "duration": %s}], "currentIndex": 0}' % bad
                response = self.member.put("/api/sync/queue", data=body, content_type="application/json")
                self.assertEqual(response.status_code, 400)

    # ─── Playlist covers ───

    def test_playlists_return_up_to_four_covers_in_position_order(self):
        for index in range(6):
            self.add_song(str(600 + index), img_url=f"https://example.test/56x56/{index}.jpg" if index != 1 else "")
        playlist = self.member.post("/api/playlists", json={"name": "Abend"}).json["id"]
        empty = self.member.post("/api/playlists", json={"name": "Leer"}).json["id"]
        for index in (5, 1, 0, 3, 2, 4):
            self.member.post(f"/api/playlists/{playlist}/tracks", json={"track_id": str(600 + index)})
        self.member.post(f"/api/playlists/{playlist}/tracks", json={"track_id": "699"})  # no metadata
        rows = {p["id"]: p for p in self.member.get("/api/playlists").json}
        self.assertEqual(rows[playlist]["covers"], [f"https://example.test/200x200/{i}.jpg" for i in (5, 0, 3, 2)])
        self.assertEqual(rows[playlist]["track_count"], 7)
        self.assertEqual(rows[empty]["covers"], [])
        # Another user's playlists never leak covers.
        self.assertEqual(self.admin.get("/api/playlists").json, [])

    # ─── Admin ───

    def test_admin_revokes_only_unused_invite_keys(self):
        with self.app.app_context(), transaction() as db:
            db.execute("INSERT INTO invite_keys (key, created_by) VALUES ('fresh', 1)")
            db.execute("INSERT INTO invite_keys (key, created_by, used_by) VALUES ('spent', 1, 'member')")
            ids = {r["key"]: r["id"] for r in db.execute("SELECT id, key FROM invite_keys").fetchall()}
        self.assertEqual(self.member.delete(f"/api/admin/invite-keys/{ids['fresh']}").status_code, 403)
        self.assertEqual(self.admin.delete(f"/api/admin/invite-keys/{ids['spent']}").status_code, 409)
        self.assertEqual(self.admin.delete(f"/api/admin/invite-keys/{ids['fresh']}").json, {"success": True})
        self.assertEqual(self.admin.delete(f"/api/admin/invite-keys/{ids['fresh']}").status_code, 404)
        with self.app.app_context():
            self.assertEqual([r["key"] for r in query_db("SELECT key FROM invite_keys")], ["spent"])
        # The revoked key cannot be used to register any more.
        response = self.app.test_client().post("/api/auth/register", json={"username": "late", "password": "new-password", "invite_key": "fresh"})
        self.assertEqual(response.status_code, 400)

    def test_daily_usage_aggregates_per_day_with_credit_estimate(self):
        today = datetime.now(timezone.utc).date()
        stamp = today.isoformat() + " 08:00:00"
        for action in ("play", "play", "search", "download"):
            self.log(2, action, "1", stamp)        # member: 2×1 + 5 credits
        self.log(1, "play", "1", stamp)            # admin plays are free
        self.log(1, "download", "1", stamp)
        self.log(2, "play", "1", "2001-01-01 10:00:00")  # outside the window
        response = self.admin.get("/api/admin/usage/daily?days=3")
        self.assertEqual(response.status_code, 200)
        days = response.json
        self.assertEqual(len(days), 3)
        self.assertEqual(days[0], {"day": today.isoformat(), "plays": 3, "searches": 1, "downloads": 2, "credits": 7})
        self.assertEqual(days[1]["plays"], 0)
        self.assertEqual(self.member.get("/api/admin/usage/daily").status_code, 403)
        self.assertEqual(len(self.admin.get("/api/admin/usage/daily?days=1000").json), 90)

    def test_admin_songs_have_added_date_and_files_have_mtime(self):
        self.add_song("777")
        self.add_song("778")
        with self.app.app_context():
            song = get_track_file_path("777", "song", create=False)
        old = time.mktime((2026, 1, 2, 3, 4, 5, 0, 0, -1))
        os.utime(song, (old, old))
        self.log(2, "download", "778", "2025-05-06 07:08:09")
        songs = {s["id"]: s for s in self.admin.get("/api/admin/songs").json}
        self.assertEqual(songs["777"]["added_at"], datetime.fromtimestamp(old, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        self.assertEqual(songs["778"]["added_at"], "2025-05-06T07:08:09Z")
        files = self.admin.get("/api/admin/songs/777/details").json["files"]
        self.assertEqual(files["song"]["modified"], songs["777"]["added_at"])
        self.assertRegex(files["metadata"]["modified"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertIsNone(files["lyrics_raw"]["modified"])

    # ─── Profile ───

    def test_profile_stats_include_favorite_song_and_this_month(self):
        self.add_song("801", title="Oft")
        self.add_song("802", title="Selten")
        self.log(2, "play", "801", "2001-01-01 10:00:00")
        self.log(2, "play", "801", "2001-01-02 10:00:00")
        self.log(2, "play", "802")
        self.log(2, "play", "999")   # deleted song, played most this month
        self.log(2, "play", "999")
        self.log(2, "play", "999")
        self.log(1, "play", "802")   # other user
        stats = self.member.get("/api/auth/profile/stats").json
        self.assertEqual(stats["plays_this_month"], 4)
        self.assertEqual(stats["favorite_song"]["id"], "801")
        self.assertEqual(stats["favorite_song"]["plays"], 2)
        self.assertEqual(stats["favorite_song"]["img_url"], "https://example.test/200x200/a.jpg")
        fresh = self.client_for(1).get("/api/auth/profile/stats").json
        self.assertEqual(fresh["favorite_song"]["id"], "802")
        with self.app.app_context(), transaction() as db:
            db.execute("DELETE FROM usage_logs")
        self.assertIsNone(self.member.get("/api/auth/profile/stats").json["favorite_song"])

    def test_migration_indexes_are_additive(self):
        with self.app.app_context():
            names = {r["name"] for r in query_db("SELECT name FROM sqlite_master WHERE type = 'index'")}
        self.assertTrue({"usage_logs_created", "usage_logs_action_detail"} <= names)
        # Re-running init on an existing database keeps data.
        self.log(2, "play", "1")
        create_app({"TESTING": True, "DATABASE": str(self.root / "database.db"), "SONGS_PATH": str(self.root / "songs"),
                    "SECRET_KEY": "x", "SESSION_COOKIE_SECURE": False})
        with self.app.app_context():
            self.assertEqual(query_db("SELECT COUNT(*) FROM usage_logs", one=True)[0], 1)


if __name__ == "__main__":
    unittest.main()
