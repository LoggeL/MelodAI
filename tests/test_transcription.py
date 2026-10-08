"""Local transcription: worker protocol (real worker process with the fake engine), the CPU gate shared with the
separation worker, the lyrics stage with its Replicate fallback, and stage 5 with force-aligned reference lyrics.
Offline; no models needed.

Run: uv run python -m unittest tests.test_transcription -v
"""

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from src.services import separation as sep
from src.services import transcription as tr
from src.services.compute_gate import ComputeGate, default_path
from src.services.reference_lyrics import synced_times
from src.services.transcription_worker import validate_spec
from src.utils.file_handling import get_track_file_path, load_lyrics, save_lyrics_raw
from tests.test_separation import SeparationTestBase

REFERENCE = ["hello fake world", "this is a test", "and one more line"]


class TranscriptionTestBase(SeparationTestBase):
    fake_env = {**SeparationTestBase.fake_env, "MELODAI_FAKE_ASR_STEPS": "4", "MELODAI_FAKE_ASR_DELAY": "0.02"}

    def setUp(self):
        super().setUp()
        self.addCleanup(lambda: tr.get_manager(self.app).stop())

    def make_app(self, **overrides):
        config = {
            "TRANSCRIBE_BACKEND": "local",
            "TRANSCRIBE_ENGINE": "fake",
            "TRANSCRIBE_SOCKET": os.path.join(self.sock_dir, "asr.sock"),
            "TRANSCRIBE_NICE": 0,
            "TRANSCRIBE_THREADS": 1,
            "TRANSCRIBE_START_TIMEOUT": 20.0,
            "TRANSCRIBE_FAILURE_BACKOFF": 0.0,
            "TRANSCRIBE_IDLE_TIMEOUT": 10.0,
            "TRANSCRIBE_HEARTBEAT": 0.3,
        }
        config.update(overrides)
        return super().make_app(**config)

    def make_vocals(self, track_id="123"):
        song_dir = self.make_song(track_id, stems=(b"VOCALS", b"INSTRUMENTAL"))
        return song_dir

    def manager(self):
        return tr.get_manager(self.app)


class WorkerTest(TranscriptionTestBase):
    def transcribe(self, **kwargs):
        with self.app.app_context():
            return tr.transcribe_track_locally("123", **kwargs)

    def test_asr_job_reports_progress_and_returns_whisperx_shape(self):
        song_dir = self.make_vocals()
        events = []
        raw, record = self.transcribe(on_event=events.append)
        kinds = [e["event"] for e in events]
        self.assertIn("started", kinds)
        self.assertEqual([(e["done"], e["total"]) for e in events if e["event"] == "progress"],
                         [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)])
        words = [w for s in raw["segments"] for w in s["words"]]
        self.assertEqual(" ".join(w["word"] for w in words), "hello fake world. this is a test")
        for w in words:
            self.assertTrue(0 <= w["start"] < w["end"])
            self.assertIn("score", w)
        self.assertEqual(record["backend"], "local")
        self.assertEqual(record["engine"], "fake")
        self.assertEqual(record["mode"], "asr")
        self.assertEqual(record["chosen"], "asr")
        self.assertFalse((song_dir / tr.REFERENCE_FILE).exists())
        self.assertFalse([n for n in os.listdir(song_dir) if n.startswith(tr.TEMP_PREFIX)])
        self.assertNotEqual(self.manager().status()["pid"], os.getpid())

    def test_shadow_mode_keeps_the_reference_alignment_but_uses_the_transcription(self):
        song_dir = self.make_vocals()
        raw, record = self.transcribe(reference_lines=REFERENCE)
        self.assertEqual(record["mode"], "shadow")
        self.assertEqual(record["chosen"], "asr")
        self.assertTrue(record["reference"]["gate"]["passed"])
        self.assertNotIn("line_starts", raw)
        shadow = json.loads((song_dir / tr.REFERENCE_FILE).read_text())
        self.assertEqual(shadow["source"], "reference")
        self.assertEqual(shadow["line_starts"], [0, 3, 7])

    def test_prefer_mode_uses_the_reference_when_the_gate_passes(self):
        self.app = self.make_app(TRANSCRIBE_REFERENCE_MODE="prefer")
        self.make_vocals()
        raw, record = self.transcribe(reference_lines=REFERENCE, reference_times=[1.0, 3.0, 5.0])
        self.assertEqual(record["chosen"], "reference")
        self.assertEqual(raw["source"], "reference")
        self.assertEqual(raw["line_starts"], [0, 3, 7])

    def test_prefer_mode_transcribes_when_the_gate_fails(self):
        self.app = self.make_app(TRANSCRIBE_REFERENCE_MODE="prefer")
        self.make_vocals()
        raw, record = self.transcribe(reference_lines=["badref lyrics"])
        self.assertEqual(record["chosen"], "asr")
        self.assertFalse(record["reference"]["gate"]["passed"])
        self.assertNotIn("source", raw)

    def test_off_mode_ignores_the_reference(self):
        self.app = self.make_app(TRANSCRIBE_REFERENCE_MODE="off")
        song_dir = self.make_vocals()
        _, record = self.transcribe(reference_lines=REFERENCE)
        self.assertEqual(record["mode"], "asr")
        self.assertFalse((song_dir / tr.REFERENCE_FILE).exists())

    def test_missing_vocals_fail_without_the_worker(self):
        self.make_song()
        with self.assertRaises(sep.SeparationFailed):
            self.transcribe()

    def test_job_error_raises_failed(self):
        self.make_vocals()
        with patch.dict(os.environ, {"MELODAI_FAKE_ASR_MODE": "fail"}), self.assertRaises(sep.SeparationFailed):
            self.transcribe()

    def test_missing_engine_is_unavailable(self):
        self.app = self.make_app(TRANSCRIBE_ENGINE="turbo")
        self.make_vocals()
        with patch("importlib.util.find_spec", return_value=None), \
                self.assertRaisesRegex(sep.SeparationUnavailable, "turbo-lyrics is not installed"):
            self.transcribe()

    def test_command_shares_the_compute_lock_with_separation(self):
        cmd = self.manager().command()
        lock = cmd[cmd.index("--compute-lock") + 1]
        self.assertEqual(lock, default_path(os.path.join(self.sock_dir, "sep.sock")))
        self.assertEqual(lock, sep.get_manager(self.app).compute_lock())
        self.assertEqual(cmd[cmd.index("-m") + 1], "src.services.transcription_worker")


class ValidateSpecTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.input = os.path.join(self.dir.name, "vocals.mp3")
        Path(self.input).write_bytes(b"V")

    def spec(self, **overrides):
        spec = {"input": self.input, "outputs": {"asr": os.path.join(self.dir.name, "a.json"),
                                                 "reference": os.path.join(self.dir.name, "r.json")},
                "mode": "shadow", "reference": {"lines": ["a b"], "times": [1.5]}}
        spec.update(overrides)
        return spec

    def test_valid(self):
        self.assertTrue(validate_spec(self.spec()))
        self.assertTrue(validate_spec(self.spec(mode="asr", reference=None, language="de")))

    def test_invalid(self):
        for bad in (
            {"input": "relative.mp3"},
            {"outputs": {"vocals": "/tmp/x"}},
            {"outputs": {"asr": "/nonexistent-dir/a.json"}},
            {"mode": "magic"},
            {"outputs": {"asr": os.path.join(self.dir.name, "a.json")}},  # shadow needs a reference output
            {"priority": "urgent"},
            {"language": 7},
            {"reference": {"lines": "a b"}},
            {"reference": {"lines": ["a", "b"], "times": [1.0]}},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_spec(self.spec(**bad))


class ComputeGateTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "melodai-compute.lock")

    def test_gate_is_exclusive_and_released(self):
        a, b = ComputeGate(self.path), ComputeGate(self.path)
        self.assertTrue(a.try_acquire())
        self.assertFalse(b.try_acquire())
        a.release()
        self.assertTrue(b.try_acquire())
        b.release()

    def test_interactive_waiting_is_visible_to_other_workers(self):
        a, b = ComputeGate(self.path), ComputeGate(self.path)
        self.assertFalse(b.interactive_waiting())
        a.mark_waiting()
        self.assertTrue(b.interactive_waiting())
        a.unmark_waiting()
        self.assertFalse(b.interactive_waiting())


class SharedGateTest(TranscriptionTestBase):
    """The separation and transcription workers never compute at the same time."""

    def test_interactive_transcription_preempts_batch_separation(self):
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_CHUNKS": "40", "MELODAI_FAKE_SEP_DELAY": "0.05"}):
            song_dir = self.make_vocals()
            self.assertTrue(sep.get_manager(self.app).ensure_running())
            self.assertTrue(self.manager().ensure_running())
            finished, batch_events = [], []

            def separate():
                sep.run_job(sep.get_manager(self.app), self.spec(song_dir, "batch", out="batch"), batch_events.append)
                finished.append("separation")

            thread = threading.Thread(target=separate)
            thread.start()
            deadline = time.time() + 10
            while not any(e["event"] == "progress" and e["done"] >= 2 for e in batch_events):
                self.assertLess(time.time(), deadline)
                time.sleep(0.02)
            with self.app.app_context():
                tr.transcribe_track_locally("123")
            finished.append("transcription")
            thread.join(30)
        self.assertEqual(finished, ["transcription", "separation"])
        self.assertIn("preempted", [e["event"] for e in batch_events])
        self.assertTrue((song_dir / "batch" / "v.mp3").exists())

    def test_interactive_jobs_take_turns(self):
        with patch.dict(os.environ, {"MELODAI_FAKE_SEP_CHUNKS": "8", "MELODAI_FAKE_SEP_DELAY": "0.05",
                                     "MELODAI_FAKE_ASR_STEPS": "8", "MELODAI_FAKE_ASR_DELAY": "0.05"}):
            song_dir = self.make_vocals()
            self.assertTrue(sep.get_manager(self.app).ensure_running())
            self.assertTrue(self.manager().ensure_running())
            spans = {}

            def timed(name):
                def on_event(message):
                    if message["event"] == "started":
                        spans[name] = [time.monotonic(), None]
                return on_event

            def separate():
                sep.run_job(sep.get_manager(self.app), self.spec(song_dir, out="s"), timed("separation"))
                spans["separation"][1] = time.monotonic()

            def transcribe():
                with self.app.app_context():
                    tr.transcribe_track_locally("123", on_event=timed("transcription"))
                spans["transcription"][1] = time.monotonic()

            threads = [threading.Thread(target=separate), threading.Thread(target=transcribe)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(30)
        (a0, a1), (b0, b1) = sorted(spans.values())
        self.assertLessEqual(a1, b0 + 0.05, f"jobs overlapped: {spans}")


class StageLyricsTest(TranscriptionTestBase):
    def run_stage(self, stage="_stage_lyrics"):
        from src.routes import track
        statuses = []
        real = __import__("src.utils.status_checks", fromlist=["set_processing_status"]).set_processing_status

        def record(track_id, status, progress, detail=""):
            statuses.append((progress, detail))
            real(track_id, status, progress, detail)

        with self.app.app_context(), patch("src.routes.track.set_processing_status", side_effect=record):
            getattr(track, stage)("123")
        return statuses

    def write_references(self, song_dir, lines=REFERENCE, verified=True):
        refs = {"version": 2, "lines": lines, "source": "lrclib",
                "candidates": [{"source": "lrclib", "lines": lines, "identity_verified": verified}]}
        (song_dir / "reference_lyrics.json").write_text(json.dumps(refs))

    def test_local_transcription_saves_lyrics_raw_and_record(self):
        song_dir = self.make_vocals()
        self.write_references(song_dir)
        with patch("src.routes.track._transcribe_replicate") as replicate:
            statuses = self.run_stage()
        replicate.assert_not_called()
        raw = json.loads(Path(song_dir / "lyrics_raw.json").read_text())
        self.assertTrue(raw["segments"])
        record = json.loads((song_dir / tr.RECORD_FILE).read_text())
        self.assertEqual((record["backend"], record["mode"], record["chosen"]), ("local", "shadow", "asr"))
        self.assertTrue((song_dir / tr.REFERENCE_FILE).exists())
        progress = [p for p, _ in statuses]
        self.assertEqual(progress, sorted(progress))
        self.assertIn("Transcribing vocals...", [d for _, d in statuses])
        self.assertEqual(statuses[-1][1], "Lyrics extracted")

    def test_falls_back_to_replicate_when_the_worker_is_unavailable(self):
        self.app = self.make_app(TRANSCRIBE_WORKER_AUTOSTART=False,
                                 TRANSCRIBE_SOCKET=os.path.join(self.sock_dir, "none.sock"))
        song_dir = self.make_vocals()
        self.write_references(song_dir)
        replicated = {"segments": [{"start": 1, "end": 2, "words": [{"word": "cloud", "start": 1, "end": 2}]}]}
        with patch("src.routes.track._transcribe_replicate", return_value=replicated) as replicate:
            statuses = self.run_stage()
        replicate.assert_called_once_with("123", REFERENCE)
        self.assertIn("Switching to cloud transcription...", [d for _, d in statuses])
        self.assertEqual(json.loads((song_dir / "lyrics_raw.json").read_text()), replicated)
        record = json.loads((song_dir / tr.RECORD_FILE).read_text())
        self.assertEqual(record["backend"], "replicate")
        self.assertIn("autostart", record["local_error"])

    def test_broken_local_output_falls_back_to_replicate(self):
        song_dir = self.make_vocals()
        with patch.dict(os.environ, {"MELODAI_FAKE_ASR_MODE": "empty"}), \
                patch("src.routes.track._transcribe_replicate", return_value={"segments": []}) as replicate:
            self.run_stage()
        replicate.assert_called_once()
        self.assertEqual(json.loads((song_dir / tr.RECORD_FILE).read_text())["backend"], "replicate")

    def test_replicate_backend_skips_the_worker(self):
        self.app = self.make_app(TRANSCRIBE_BACKEND="replicate")
        self.make_vocals()
        with patch("src.services.transcription.transcribe_track_locally") as local, \
                patch("src.routes.track._transcribe_replicate", return_value={"segments": []}) as replicate:
            self.run_stage()
        local.assert_not_called()
        replicate.assert_called_once()

    def test_unverified_references_are_not_passed_on(self):
        song_dir = self.make_vocals()
        self.write_references(song_dir, verified=False)
        self.run_stage()
        record = json.loads((song_dir / tr.RECORD_FILE).read_text())
        self.assertEqual(record["mode"], "asr")

    def test_prefetched_references_are_used(self):
        song_dir = self.make_vocals()
        from src.routes import track
        refs = {"version": 2, "lines": REFERENCE, "source": "lrclib",
                "candidates": [{"source": "lrclib", "lines": REFERENCE, "identity_verified": True}]}
        with patch("src.services.reference_lyrics.fetch_references", return_value=refs) as fetch:
            with self.app.app_context():
                track._prefetch_references("123")
            self.run_stage()
        fetch.assert_called_once()
        self.assertTrue((song_dir / "reference_lyrics.json").exists())
        self.assertEqual(json.loads((song_dir / tr.RECORD_FILE).read_text())["mode"], "shadow")

    def test_forced_alignment_skips_the_llm_and_keeps_reference_lines(self):
        self.app = self.make_app(TRANSCRIBE_REFERENCE_MODE="prefer")
        song_dir = self.make_vocals()
        self.write_references(song_dir)
        self.run_stage()
        with patch("requests.post", side_effect=AssertionError("no LLM call expected")):
            self.run_stage("_stage_process_lyrics")
        with self.app.app_context():
            lyrics = load_lyrics("123")
        self.assertEqual([" ".join(w["word"] for w in s["words"]) for s in lyrics["segments"]], REFERENCE)
        self.assertEqual(lyrics["lyrics_source"], "reference")
        self.assertEqual(lyrics["correction_stats"]["method"], "forced_alignment")

    def test_existing_lyrics_raw_skips_transcription(self):
        self.make_vocals()
        with self.app.app_context():
            save_lyrics_raw("123", {"segments": []})
        with patch("src.services.transcription.transcribe_track_locally") as local:
            self.run_stage()
        local.assert_not_called()


class HelpersTest(unittest.TestCase):
    def test_status_messages_are_monotonic_and_inside_the_stage(self):
        values = [tr.status_for_event({"event": "queued", "position": 2})[0],
                  tr.status_for_event({"event": "started"})[0]]
        values += [tr.status_for_event({"event": "progress", "done": k, "total": 100})[0] for k in (0, 50, 100)]
        self.assertEqual(values, sorted(values))
        self.assertGreater(values[0], 35)
        self.assertLess(values[-1], 65)
        self.assertIsNone(tr.status_for_event({"event": "heartbeat", "state": "ready"}))

    def test_config_from_env(self):
        cfg = tr.config_from_env({"TRANSCRIBE_BACKEND": "Replicate", "TRANSCRIBE_THREADS": "6",
                                  "TRANSCRIBE_REFERENCE_MODE": "Prefer"})
        self.assertEqual(cfg["TRANSCRIBE_BACKEND"], "replicate")
        self.assertEqual(cfg["TRANSCRIBE_THREADS"], 6)
        self.assertEqual(cfg["TRANSCRIBE_REFERENCE_MODE"], "prefer")
        self.assertEqual(tr.config_from_env({})["TRANSCRIBE_BACKEND"], "local")

    def test_synced_times(self):
        lrc = "[00:01.50] Hello world\n[00:03.00]\n[00:04.25] [Chorus]\n[01:05.10] Second line\n"
        self.assertEqual(synced_times(lrc, ["Hello world", "Second line"]), [1.5, 65.1])
        self.assertIsNone(synced_times(lrc, ["Hello world"]))
        self.assertIsNone(synced_times("Hello world", ["Hello world"]))
        self.assertIsNone(synced_times(None, ["x"]))


if __name__ == "__main__":
    unittest.main()
