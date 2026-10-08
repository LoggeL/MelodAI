"""Local separation: worker protocol (real worker process with the fake engine), failure handling, stem
installation, re-split batch and admin endpoints. Offline; no torch needed.

Run: uv run python -m unittest tests.test_separation -v
"""

import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from werkzeug.security import generate_password_hash

from src.app import create_app
from src.models.db import transaction
from src.services import separation as sep
from src.utils.file_handling import get_song_dir, get_track_file_path, save_metadata, save_lyrics
from src.utils.status_checks import claim_processing, get_processing_status


def _short_tmp():
    # unix socket paths are limited to ~104 bytes on macOS
    return tempfile.mkdtemp(prefix="msep-", dir="/tmp" if os.path.isdir("/tmp") else None)


class SeparationTestBase(unittest.TestCase):
    fake_env = {"MELODAI_FAKE_SEP_CHUNKS": "4", "MELODAI_FAKE_SEP_DELAY": "0.02"}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sock_dir = _short_tmp()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.sock_dir, ignore_errors=True))
        env = patch.dict(os.environ, self.fake_env)
        env.start()
        self.addCleanup(env.stop)
        self.network = patch("requests.sessions.Session.request",
                             side_effect=AssertionError("Network calls forbidden in offline tests"))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.app = self.make_app()
        self.addCleanup(lambda: sep.get_manager(self.app).stop())

    def make_app(self, **overrides):
        config = {
            "TESTING": True,
            "DATABASE": str(self.root / "db" / "database.db"),
            "SONGS_PATH": str(self.root / "songs"),
            "SECRET_KEY": "isolated-separation-test-secret",
            "SESSION_COOKIE_SECURE": False,
            "SPLIT_BACKEND": "local",
            "SEPARATION_ENGINE": "fake",
            "SEPARATION_SOCKET": os.path.join(self.sock_dir, "sep.sock"),
            "SEPARATION_NICE": 0,
            "SEPARATION_THREADS": 1,
            "SEPARATION_START_TIMEOUT": 20.0,
            "SEPARATION_FAILURE_BACKOFF": 0.0,
            "SEPARATION_IDLE_TIMEOUT": 10.0,
            "SEPARATION_HEARTBEAT": 0.3,
        }
        config.update(overrides)
        os.makedirs(self.root / "db", exist_ok=True)
        return create_app(config)

    def make_song(self, track_id="123", name_hint=None, stems=None, record=None):
        with self.app.app_context():
            save_metadata(track_id, {"id": track_id, "title": f"Song {track_id}", "artist": "Artist"})
            song = get_track_file_path(track_id, "song")
            Path(song).write_bytes(b"MIX-" + track_id.encode() + (name_hint or "").encode())
            if stems:
                Path(get_track_file_path(track_id, "vocals")).write_bytes(stems[0])
                Path(get_track_file_path(track_id, "no_vocals")).write_bytes(stems[1])
            if record is not None:
                sep.save_record(track_id, record)
            return Path(get_song_dir(track_id))

    def spec(self, song_dir, priority="interactive", input_name="song.mp3", out="out"):
        out_dir = song_dir / out
        out_dir.mkdir(exist_ok=True)
        src = song_dir / input_name
        if not src.exists():
            src.write_bytes(b"MIX")
        return {"input": str(src), "outputs": {"vocals": str(out_dir / "v.mp3"), "no_vocals": str(out_dir / "i.mp3")},
                "priority": priority, "overlap": 2.0, "label": out}


class WorkerProtocolTest(SeparationTestBase):
    def manager(self):
        return sep.get_manager(self.app)

    def test_job_reports_queue_progress_and_writes_outputs(self):
        song_dir = self.make_song()
        events = []
        result = sep.run_job(self.manager(), self.spec(song_dir), events.append)
        kinds = [e["event"] for e in events]
        self.assertIn("accepted", kinds)
        self.assertIn("started", kinds)
        progress = [(e["done"], e["total"]) for e in events if e["event"] == "progress"]
        self.assertEqual(progress, [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)])
        self.assertEqual(result["engine"], "fake")
        self.assertEqual(result["chunks"], 4)
        self.assertTrue((song_dir / "out" / "v.mp3").read_bytes().startswith(b"FAKE-VOCALS:"))
        self.assertTrue((song_dir / "out" / "i.mp3").read_bytes().startswith(b"FAKE-NO_VOCALS:"))
        status = self.manager().status()
        self.assertTrue(status["available"])
        self.assertEqual(status["state"], "ready")
        self.assertEqual(status["stats"]["completed"], 1)

    def test_worker_is_a_separate_long_lived_process(self):
        song_dir = self.make_song()
        sep.run_job(self.manager(), self.spec(song_dir, out="a"))
        pid = self.manager().status()["pid"]
        self.assertNotEqual(pid, os.getpid())
        sep.run_job(self.manager(), self.spec(song_dir, out="b"))
        self.assertEqual(self.manager().status()["pid"], pid)

    def test_interactive_job_preempts_running_batch_job(self):
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_CHUNKS": "40", "MELODAI_FAKE_SEP_DELAY": "0.05"}):
            song_dir = self.make_song()
            self.assertTrue(self.manager().ensure_running())
            finished, batch_events = [], []

            def run(priority, out, sink):
                sep.run_job(self.manager(), self.spec(song_dir, priority, out=out), sink.append)
                finished.append(priority)

            batch = threading.Thread(target=run, args=("batch", "batch", batch_events))
            batch.start()
            deadline = time.time() + 10
            while not any(e["event"] == "progress" and e["done"] >= 2 for e in batch_events):
                self.assertLess(time.time(), deadline)
                time.sleep(0.02)
            interactive_events = []
            run("interactive", "inter", interactive_events)
            batch.join(30)
        self.assertEqual(finished, ["interactive", "batch"])
        self.assertIn("preempted", [e["event"] for e in batch_events])
        self.assertTrue((song_dir / "batch" / "v.mp3").exists())
        self.assertEqual(self.manager().status()["stats"]["preempted"], 1)

    def test_queue_positions_put_interactive_jobs_before_batch_jobs(self):
        self.app = self.make_app(SEPARATION_PREEMPT=False, SEPARATION_SOCKET=os.path.join(self.sock_dir, "np.sock"))
        self.addCleanup(lambda: sep.get_manager(self.app).stop())
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_CHUNKS": "10", "MELODAI_FAKE_SEP_DELAY": "0.05"}):
            song_dir = self.make_song()
            self.assertTrue(self.manager().ensure_running())
            order, events = [], {}

            def run(priority, out):
                events[out] = []
                sep.run_job(self.manager(), self.spec(song_dir, priority, out=out), events[out].append)
                order.append(out)

            first = threading.Thread(target=run, args=("batch", "b1"))
            first.start()
            time.sleep(0.2)
            second = threading.Thread(target=run, args=("batch", "b2"))
            second.start()
            time.sleep(0.2)
            third = threading.Thread(target=run, args=("interactive", "i1"))
            third.start()
            for t in (first, second, third):
                t.join(30)
        self.assertEqual(order, ["b1", "i1", "b2"])
        self.assertEqual([e["position"] for e in events["i1"] if e["event"] == "queued"], [1])
        self.assertEqual([e["position"] for e in events["b2"] if e["event"] == "queued"], [1, 2, 1])

    def test_closing_the_connection_cancels_a_queued_job(self):
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_CHUNKS": "20", "MELODAI_FAKE_SEP_DELAY": "0.05"}):
            song_dir = self.make_song()
            self.assertTrue(self.manager().ensure_running())
            runner = threading.Thread(target=sep.run_job, args=(self.manager(), self.spec(song_dir, out="r")))
            runner.start()
            time.sleep(0.2)
            client = self.manager().connect()
            client.sendall((json.dumps({"op": "separate", "job": self.spec(song_dir, "batch", out="c")}) + "\n").encode())
            reader = client.makefile("rb")
            self.assertEqual(json.loads(reader.readline())["event"], "accepted")
            reader.close()
            client.close()
            runner.join(30)
            time.sleep(0.2)
        status = self.manager().status()
        self.assertEqual(status["queue"], [])
        self.assertEqual(status["stats"]["cancelled"], 1)
        self.assertFalse((song_dir / "c" / "v.mp3").exists())

    def test_job_error_raises_separation_failed(self):
        song_dir = self.make_song()
        with self.assertRaises(sep.SeparationFailed):
            sep.run_job(self.manager(), self.spec(song_dir, input_name="fail.mp3"))
        # the worker keeps serving
        sep.run_job(self.manager(), self.spec(song_dir, out="after"))

    def test_invalid_job_is_rejected(self):
        song_dir = self.make_song()
        bad = self.spec(song_dir)
        bad["input"] = "relative.mp3"
        with self.assertRaises(sep.SeparationFailed):
            sep.run_job(self.manager(), bad)

    def test_crash_raises_unavailable_and_the_next_job_restarts_the_worker(self):
        song_dir = self.make_song()
        self.assertTrue(self.manager().ensure_running())
        first_pid = self.manager().status()["pid"]
        with self.assertRaises(sep.SeparationUnavailable):
            sep.run_job(self.manager(), self.spec(song_dir, input_name="crash.mp3"))
        sep.run_job(self.manager(), self.spec(song_dir, out="again"))
        self.assertNotEqual(self.manager().status()["pid"], first_pid)

    def test_stalled_worker_times_out(self):
        song_dir = self.make_song()
        with self.assertRaises(sep.SeparationUnavailable):
            sep.run_job(self.manager(), self.spec(song_dir, input_name="hang.mp3"), stall_timeout=1.0)

    def test_uncancellable_hang_kills_and_replaces_the_worker(self):
        song_dir = self.make_song()
        self.assertTrue(self.manager().ensure_running())
        first_pid = self.manager().status()["pid"]
        started = time.monotonic()
        with self.assertRaises(sep.WorkerLost):
            sep.run_job(self.manager(), self.spec(song_dir, input_name="freeze.mp3"), stall_timeout=1.0)
        self.assertLess(time.monotonic() - started, 15)
        sep.run_job(self.manager(), self.spec(song_dir, out="after"))
        self.assertNotEqual(self.manager().status()["pid"], first_pid)

    def test_waiting_job_kills_a_worker_stuck_on_another_job(self):
        song_dir = self.make_song()
        self.assertTrue(self.manager().ensure_running())
        first_pid = self.manager().status()["pid"]
        stuck_errors = []

        def stuck_batch():
            try:
                sep.run_job(self.manager(), self.spec(song_dir, priority="batch", input_name="freeze.mp3",
                                                      out="stuck"), stall_timeout=60.0)
            except sep.SeparationUnavailable as e:
                stuck_errors.append(e)

        thread = threading.Thread(target=stuck_batch)
        thread.start()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (self.manager().status().get("current") or {}).get("job_id"):
            time.sleep(0.05)
        with self.assertRaises(sep.WorkerLost):
            sep.run_job(self.manager(), self.spec(song_dir, out="waiting"), stall_timeout=1.0)
        thread.join(15)
        self.assertEqual(len(stuck_errors), 1)
        self.assertIsInstance(stuck_errors[0], sep.WorkerLost)
        self.assertEqual(self.manager()._crashed_pids, {first_pid})  # two clients, one crash
        sep.run_job(self.manager(), self.spec(song_dir, out="fresh"))
        self.assertNotEqual(self.manager().status()["pid"], first_pid)

    def test_queue_timeout_gives_up_without_killing_the_worker(self):
        song_dir = self.make_song()
        self.assertTrue(self.manager().ensure_running())
        pid = self.manager().status()["pid"]
        stop = threading.Event()

        def long_job():
            try:
                sep.run_job(self.manager(), self.spec(song_dir, input_name="hang.mp3", out="long"),
                            should_abort=stop.is_set, stall_timeout=60.0)
            except sep.SeparationAborted:
                pass

        thread = threading.Thread(target=long_job)
        thread.start()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (self.manager().status().get("current") or {}).get("job_id"):
            time.sleep(0.05)
        with self.assertRaises(sep.SeparationUnavailable) as caught:
            sep.run_job(self.manager(), self.spec(song_dir, out="queued"), queue_timeout=1.0, stall_timeout=60.0)
        self.assertNotIsInstance(caught.exception, sep.WorkerLost)
        stop.set()
        thread.join(15)
        self.assertEqual(self.manager().status()["pid"], pid)

    def test_interactive_jobs_avoid_a_worker_without_kernels(self):
        self.make_song("55", stems=(b"v", b"i"))
        manager = sep.get_manager(self.app)
        with patch.object(sep.WorkerManager, "ensure_running", return_value=True), \
                patch.object(sep.WorkerManager, "ping",
                             return_value={"state": "ready", "info": {"compute_backend": "torch"}}), \
                self.app.app_context():
            with self.assertRaises(sep.SeparationUnavailable):
                sep.separate_track_locally("55", priority="interactive", app=self.app)
        self.assertIsNotNone(manager)

    def test_model_load_failure_reports_unavailable(self):
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_FAIL_LOAD": "1"}):
            song_dir = self.make_song()
            with self.assertRaises(sep.SeparationUnavailable):
                sep.run_job(self.manager(), self.spec(song_dir))

    def test_missing_engine_is_unavailable_without_spawning(self):
        app = self.make_app(SEPARATION_ENGINE="turbo", SEPARATION_SOCKET=os.path.join(self.sock_dir, "t.sock"))
        manager = sep.get_manager(app)
        with patch("importlib.util.find_spec", return_value=None), patch("subprocess.Popen") as popen:
            self.assertFalse(manager.ensure_running())
        popen.assert_not_called()
        self.assertIn("not installed", manager.last_error)

    def test_second_worker_on_the_same_socket_exits(self):
        self.assertTrue(self.manager().ensure_running())
        import subprocess
        import sys
        code = subprocess.run([sys.executable, "-m", "src.services.separation_worker", "--engine", "fake",
                               "--socket", self.manager().socket_path, "--nice", "0"],
                              cwd=sep.PROJECT_ROOT, capture_output=True, timeout=30).returncode
        self.assertEqual(code, 4)
        self.assertTrue(self.manager().status()["available"])


class StatusMessageTest(unittest.TestCase):
    def test_messages(self):
        self.assertEqual(sep.status_for_event({"event": "queued", "position": 2}),
                         (26, "Waiting in queue (position 2)..."))
        self.assertEqual(sep.status_for_event({"event": "accepted", "state": "loading"}),
                         (26, "Loading separation model..."))
        self.assertEqual(sep.status_for_event({"event": "progress", "done": 5, "total": 40}),
                         (27, "Separating vocals (5/40)..."))
        self.assertEqual(sep.status_for_event({"event": "progress", "done": 20, "total": 40}),
                         (30, "Separating vocals (20/40)..."))
        self.assertEqual(sep.status_for_event({"event": "progress", "done": 40, "total": 40}),
                         (34, "Separating vocals (40/40)..."))
        self.assertEqual(sep.status_for_event({"event": "started"}), (27, "Separating vocals..."))
        self.assertIsNone(sep.status_for_event({"event": "heartbeat", "state": "ready"}))

    def test_config_from_env(self):
        cfg = sep.config_from_env({"SPLIT_BACKEND": "Replicate", "SEPARATION_THREADS": "6",
                                   "SEPARATION_PREEMPT": "0", "SEPARATION_OVERLAP": "3"})
        self.assertEqual(cfg["SPLIT_BACKEND"], "local")
        self.assertEqual(cfg["SEPARATION_THREADS"], 6)
        self.assertFalse(cfg["SEPARATION_PREEMPT"])
        self.assertEqual(cfg["SEPARATION_OVERLAP"], 3.0)
        self.assertEqual(sep.config_from_env({})["SPLIT_BACKEND"], "local")


class StageSplitTest(SeparationTestBase):
    def run_stage(self):
        from src.routes.track import _stage_split
        statuses = []
        real = __import__("src.utils.status_checks", fromlist=["set_processing_status"]).set_processing_status

        def record(track_id, status, progress, detail=""):
            statuses.append((progress, detail))
            real(track_id, status, progress, detail)

        with self.app.app_context(), patch("src.routes.track.set_processing_status", side_effect=record), \
                patch("src.routes.track._prefetch_references"), \
                patch("requests.sessions.Session.request", side_effect=AssertionError("Audio must stay local")):
            _stage_split("123")
        return statuses

    def test_local_split_installs_stems_records_backend_and_reports_progress(self):
        song_dir = self.make_song()
        statuses = self.run_stage()
        self.assertTrue((song_dir / "vocals.mp3").read_bytes().startswith(b"FAKE-VOCALS:MIX-123"))
        self.assertTrue((song_dir / "no_vocals.mp3").read_bytes().startswith(b"FAKE-NO_VOCALS:MIX-123"))
        record = json.loads((song_dir / "separation.json").read_text())
        self.assertEqual(record["backend"], "local")
        self.assertEqual(record["engine"], "fake")
        self.assertEqual(record["overlap"], 2.0)
        self.assertIn("created_at", record)
        details = [d for _, d in statuses]
        self.assertIn("Separating vocals (2/4)...", details)
        self.assertEqual(details[-1], "Vocals separated")
        self.assertEqual([p for p, _ in statuses], sorted(p for p, _ in statuses))
        self.assertFalse([n for n in os.listdir(song_dir) if n.startswith(".separation-")])

    def test_worker_unavailable_stops_without_uploading_audio(self):
        self.app = self.make_app(SEPARATION_WORKER_AUTOSTART=False,
                                 SEPARATION_SOCKET=os.path.join(self.sock_dir, "none.sock"))
        self.make_song()
        with self.assertRaisesRegex(sep.SeparationUnavailable, "autostart"):
            self.run_stage()

    def test_worker_crash_stops_without_uploading_audio(self):
        song_dir = self.make_song(stems=None)
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_MODE": "crash"}), self.assertRaises(sep.WorkerLost):
            self.run_stage()
        self.assertFalse((song_dir / "vocals.mp3").exists())
        self.assertFalse([n for n in os.listdir(song_dir) if n.startswith(".separation-")])

    def test_legacy_replicate_setting_still_uses_the_local_worker(self):
        self.app = self.make_app(SPLIT_BACKEND="replicate")
        self.make_song()
        with patch("src.services.separation.separate_track_locally", return_value={}) as local:
            self.run_stage()
        local.assert_called_once()


    def test_existing_stems_skip_separation(self):
        self.make_song(stems=(b"old-v", b"old-i"))
        with patch("src.services.separation.separate_track_locally") as local:
            statuses = self.run_stage()
        local.assert_not_called()
        self.assertEqual(statuses, [(35, "Vocals separated")])


class InstallTest(SeparationTestBase):
    def test_failure_keeps_old_stems_and_cleans_up(self):
        song_dir = self.make_song(stems=(b"old-v", b"old-i"))
        with self.app.app_context(), patch("src.services.separation.run_job",
                                           side_effect=sep.SeparationFailed("boom")):
            with self.assertRaises(sep.SeparationFailed):
                sep.separate_track_locally("123", priority="batch")
        self.assertEqual((song_dir / "vocals.mp3").read_bytes(), b"old-v")
        self.assertEqual((song_dir / "no_vocals.mp3").read_bytes(), b"old-i")
        self.assertFalse((song_dir / "separation.json").exists())
        self.assertFalse([n for n in os.listdir(song_dir) if n.startswith(".separation-")])

    def test_should_install_false_discards_result(self):
        song_dir = self.make_song(stems=(b"old-v", b"old-i"))
        with self.app.app_context():
            with self.assertRaises(sep.SeparationAborted):
                sep.separate_track_locally("123", priority="batch", should_install=lambda: False)
        self.assertEqual((song_dir / "vocals.mp3").read_bytes(), b"old-v")

    def test_backup_is_made_once_and_survives_replacement(self):
        song_dir = self.make_song(stems=(b"demucs-v", b"demucs-i"))
        with self.app.app_context():
            self.assertEqual(sep.backup_stems("123"), ["vocals.demucs.mp3", "no_vocals.demucs.mp3"])
            sep.separate_track_locally("123", priority="batch")
            self.assertEqual(sep.backup_stems("123"), [])
        self.assertEqual((song_dir / "vocals.demucs.mp3").read_bytes(), b"demucs-v")
        self.assertEqual((song_dir / "no_vocals.demucs.mp3").read_bytes(), b"demucs-i")
        self.assertTrue((song_dir / "vocals.mp3").read_bytes().startswith(b"FAKE-VOCALS"))

    def test_clean_temp_dirs_removes_old_leftovers_only(self):
        song_dir = self.make_song(stems=(b"v", b"i"))
        (song_dir / ".separation-abc").mkdir()
        (song_dir / ".separation-abc" / "vocals.mp3").write_bytes(b"partial")
        old = time.time() - sep.STARTUP_TEMP_MIN_AGE - 60
        os.utime(song_dir / ".separation-abc", (old, old))
        (song_dir / ".separation-live").mkdir()  # e.g. the previous container's job during a deploy
        self.assertEqual(sep.clean_temp_dirs(self.app), 1)
        self.assertFalse((song_dir / ".separation-abc").exists())
        self.assertTrue((song_dir / ".separation-live").exists())
        self.assertEqual((song_dir / "vocals.mp3").read_bytes(), b"v")

    def test_is_current(self):
        cfg = sep.config_from_env({})
        record = {"backend": "local", "model_key": "resurrection", "version": "0.1.0", "overlap": 2.0}
        self.assertTrue(sep.is_current(record, cfg, "0.1.0"))
        self.assertFalse(sep.is_current(record, cfg, "0.2.0"))
        self.assertFalse(sep.is_current({**record, "backend": "replicate"}, cfg, "0.1.0"))
        self.assertFalse(sep.is_current({**record, "overlap": 3.0}, cfg, "0.1.0"))
        self.assertFalse(sep.is_current(None, cfg, "0.1.0"))
        with patch("src.services.separation.installed_version", return_value=None):  # turbo-roformer not installed
            self.assertFalse(sep.is_current(record, cfg, None))


class ResplitTest(SeparationTestBase):
    def setUp(self):
        super().setUp()
        from src.tools import resplit
        self.resplit = resplit
        self.version = patch("src.services.separation.installed_version", return_value="0.0-test")
        self.version.start()
        self.addCleanup(self.version.stop)
        self.app = self.make_app(SEPARATION_MODEL="fake")
        self.addCleanup(lambda: sep.get_manager(self.app).stop())

    def batch(self, **kwargs):
        return self.resplit.ResplitBatch(self.app, sleep=lambda s: None, **kwargs)

    def test_batch_skips_backs_up_replaces_and_records(self):
        current = {"backend": "local", "model_key": "fake", "version": "0.0-test", "overlap": 2.0}
        d1 = self.make_song("1", stems=(b"demucs-v1", b"demucs-i1"))
        d2 = self.make_song("2", stems=(b"local-v2", b"local-i2"), record=current)
        d3 = self.make_song("3", stems=(b"demucs-v3", b"demucs-i3"), name_hint="")
        os.rename(d3 / "song.mp3", d3 / "fail.mp3")  # no song.mp3 -> not part of the batch
        batch = self.batch()
        batch.start(background=False)
        status = batch.status()
        self.assertEqual(status["status"], "done")
        self.assertEqual(status["total"], 2)
        self.assertEqual(status["counts"], {"done": 1, "skipped": 1})
        self.assertTrue((d1 / "vocals.mp3").read_bytes().startswith(b"FAKE-VOCALS:MIX-1"))
        self.assertEqual((d1 / "vocals.demucs.mp3").read_bytes(), b"demucs-v1")
        self.assertEqual((d1 / "no_vocals.demucs.mp3").read_bytes(), b"demucs-i1")
        self.assertEqual(json.loads((d1 / "separation.json").read_text())["backend"], "local")
        self.assertEqual((d2 / "vocals.mp3").read_bytes(), b"local-v2")
        self.assertFalse((d2 / "vocals.demucs.mp3").exists())
        self.assertEqual((d3 / "vocals.mp3").read_bytes(), b"demucs-v3")
        state = json.loads(Path(batch.state_path).read_text())
        self.assertEqual(state["items"]["1"]["status"], "done")
        self.assertEqual(state["items"]["2"]["reason"], "already current")

    def test_failure_keeps_old_stems_and_continues(self):
        d1 = self.make_song("1", stems=(b"demucs-v1", b"demucs-i1"))
        d2 = self.make_song("2", stems=(b"demucs-v2", b"demucs-i2"))

        def flaky(track_id, **kwargs):
            if track_id == "1":
                raise sep.SeparationFailed("decoder error")
            return sep.separate_track_locally(track_id, **kwargs)

        batch = self.batch(separate=flaky)
        batch.start(background=False)
        status = batch.status()
        self.assertEqual(status["counts"], {"failed": 1, "done": 1})
        self.assertEqual(status["failures"][0]["track_id"], "1")
        self.assertEqual((d1 / "vocals.mp3").read_bytes(), b"demucs-v1")
        self.assertTrue((d2 / "vocals.mp3").read_bytes().startswith(b"FAKE-VOCALS"))

    def test_state_persists_and_a_new_runner_resumes(self):
        for tid in ("1", "2", "3"):
            self.make_song(tid, stems=(b"v", b"i"))
        calls = []

        def stop_after_first(track_id, **kwargs):
            calls.append(track_id)
            record = sep.separate_track_locally(track_id, **kwargs)
            first_batch.stop()
            return record

        first_batch = self.batch(separate=stop_after_first)
        first_batch.start(background=False)
        self.assertEqual(first_batch.status()["counts"], {"done": 1, "pending": 2})
        # simulate a container restart while running: status is "running" on disk
        state = first_batch.load_state()
        state["status"] = "running"
        first_batch.save_state(state)
        restarted = self.batch()
        self.assertTrue(restarted.resume_if_running())
        restarted.wait(30)
        self.assertEqual(restarted.status()["counts"], {"done": 3})
        self.assertEqual(calls, ["1"])

    def test_stopped_batch_is_not_auto_resumed_but_can_be_resumed_manually(self):
        self.make_song("1", stems=(b"v", b"i"))
        batch = self.batch()
        state = batch.create()
        state["status"] = "stopped"
        batch.save_state(state)
        self.assertFalse(self.batch().resume_if_running())
        resumed = self.batch()
        resumed.start(background=False)
        self.assertEqual(resumed.status()["counts"], {"done": 1})

    def test_processing_track_is_deferred(self):
        self.make_song("1", stems=(b"v", b"i"))
        self.make_song("2", stems=(b"v", b"i"))
        with self.app.app_context():
            claim_processing("1", "lyrics", 60, "Extracting lyrics...")
        order = []

        def track(track_id, **kwargs):
            order.append(track_id)
            if track_id == "2":
                with self.app.app_context():
                    from src.utils.status_checks import set_processing_status
                    set_processing_status("1", "complete", 100, "Ready to play!")
            return sep.separate_track_locally(track_id, **kwargs)

        batch = self.batch(separate=track)
        batch.start(background=False)
        self.assertEqual(order, ["2", "1"])
        self.assertEqual(batch.status()["counts"], {"done": 2})

    def test_unavailable_worker_stops_the_batch_with_an_error(self):
        self.make_song("1", stems=(b"v", b"i"))
        batch = self.batch(separate=lambda *a, **k: (_ for _ in ()).throw(sep.SeparationUnavailable("down")))
        batch.start(background=False)
        status = batch.status()
        self.assertEqual(status["status"], "error")
        self.assertIn("down", status["error"])
        self.assertEqual(status["counts"], {"pending": 1})
        self.assertEqual((Path(get_song_dir_for(self.app, "1")) / "vocals.mp3").read_bytes(), b"v")

    def test_song_that_keeps_losing_the_worker_is_failed_and_skipped(self):
        d1 = self.make_song("1", stems=(b"demucs-v1", b"demucs-i1"))
        self.make_song("2", stems=(b"v", b"i"))
        calls = []

        def poison(track_id, **kwargs):
            calls.append(track_id)
            if track_id == "1":
                raise sep.WorkerLost("the separation worker closed the connection")
            return sep.separate_track_locally(track_id, **kwargs)

        batch = self.batch(separate=poison)
        batch.start(background=False)
        status = batch.status()
        self.assertEqual(status["status"], "done")
        self.assertEqual(status["counts"], {"failed": 1, "done": 1})
        self.assertEqual(calls, ["1", "2", "1", "1"])
        self.assertIn("worker lost 3x", status["failures"][0]["error"])
        self.assertEqual((d1 / "vocals.mp3").read_bytes(), b"demucs-v1")

    def test_resume_waits_for_a_runner_that_is_still_shutting_down(self):
        self.make_song("1", stems=(b"v", b"i"))
        old = self.batch()
        old.create()
        self.assertTrue(old._acquire())  # the previous container still holds the lock
        threading.Timer(0.5, old._release).start()
        restarted = self.resplit.ResplitBatch(self.app, sleep=lambda s: time.sleep(0.05))
        self.assertTrue(restarted.resume_if_running())
        restarted.wait(30)
        self.assertEqual(restarted.status()["counts"], {"done": 1})

    def test_second_runner_is_refused(self):
        self.make_song("1", stems=(b"v", b"i"))
        first = self.batch()
        self.assertTrue(first._acquire())
        try:
            with self.assertRaises(self.resplit.BatchBusy):
                self.batch().start(background=False)
        finally:
            first._release()

    def test_cli_status(self):
        with patch.dict(os.environ, {"MELODAI_DATABASE": self.app.config["DATABASE"],
                                     "MELODAI_SONGS_PATH": self.app.config["SONGS_PATH"],
                                     "SECRET_KEY": "cli-test-secret"}), \
                patch("builtins.print") as printed:
            self.assertEqual(self.resplit.main(["--status"]), 0)
        self.assertIn("status: idle", printed.call_args_list[0].args[0])


def get_song_dir_for(app, track_id):
    with app.app_context():
        return get_song_dir(track_id)


class AdminSeparationApiTest(SeparationTestBase):
    def setUp(self):
        super().setUp()
        self.version = patch("src.services.separation.installed_version", return_value="0.0-test")
        self.version.start()
        self.addCleanup(self.version.stop)
        self.app = self.make_app(SEPARATION_MODEL="fake")
        with self.app.app_context():
            with transaction() as db:
                db.execute("INSERT INTO users (username, password_hash, is_admin, is_approved, credits) "
                           "VALUES ('admin', ?, 1, 1, 10)", [generate_password_hash("x")])
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session["user_id"] = 1
            session["session_version"] = 0

    def test_start_status_and_listing(self):
        self.make_song("7", stems=(b"v", b"i"))
        with self.app.app_context():
            save_lyrics("7", {"segments": []})
        response = self.client.post("/api/admin/separation/resplit", json={})
        self.assertEqual(response.status_code, 200, response.get_json())
        from src.tools.resplit import get_batch
        get_batch(self.app).wait(30)
        status = self.client.get("/api/admin/separation").get_json()
        self.assertEqual(status["split_backend"], "local")
        self.assertTrue(status["worker"]["available"])
        self.assertEqual(status["batch"]["status"], "done")
        self.assertEqual(status["batch"]["counts"], {"done": 1})
        songs = self.client.get("/api/admin/songs").get_json()
        self.assertEqual(songs[0]["separation_backend"], "local")
        details = self.client.get("/api/admin/songs/7/details").get_json()
        self.assertEqual(details["separation"]["backend"], "local")
        self.assertEqual(self.client.post("/api/admin/separation/resplit/stop").status_code, 200)

    def test_legacy_backend_setting_cannot_disable_local_resplit(self):
        self.app.config["SPLIT_BACKEND"] = "replicate"
        response = self.client.post("/api/admin/separation/resplit", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sep.split_backend(self.app), "local")

    def test_start_reports_unavailable_worker(self):
        self.app.config["SEPARATION_WORKER_AUTOSTART"] = False
        sep.get_manager(self.app).cfg["SEPARATION_WORKER_AUTOSTART"] = False
        response = self.client.post("/api/admin/separation/resplit", json={})
        self.assertEqual(response.status_code, 503)

    def test_force_must_be_boolean(self):
        self.assertEqual(self.client.post("/api/admin/separation/resplit", json={"force": "yes"}).status_code, 400)

    def test_reprocess_from_splitting_removes_the_record(self):
        song_dir = self.make_song("8", stems=(b"v", b"i"), record={"backend": "local"})
        with patch("src.routes.track.process_track"):
            response = self.client.post("/api/admin/songs/8/reprocess", json={"from_stage": "splitting"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse((song_dir / "separation.json").exists())


if __name__ == "__main__":
    unittest.main()
