"""Offline source selection, model validation and processing-stage regression tests."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests

from src.app import create_app
from src.routes.track import _stage_process_lyrics
from src.services.reference_lyrics import fetch_references, select_reference, lyric_lines
from src.services.lyric_correction import correct_lyrics_with_luna, MODEL
from src.utils.file_handling import get_song_dir, get_track_file_path, save_lyrics_raw, save_metadata, load_lyrics

REFERENCE = ["We sail home", "Across the silver sea"]
RAW = {"language": "en", "segments": [{"start": 1, "end": 8, "speaker": "SPEAKER_01", "words": [
    {"word": word, "start": i + 1, "end": i + 1.5, "speaker": "SPEAKER_01", "score": 0.7}
    for i, word in enumerate("We sale home Across the silver sea".split())
]}]}
VALID = {"matched": True, "corrections": [{"index": 1, "text": "sail"}], "line_starts": [0, 3]}


def response(data, status=200):
    result = Mock(status_code=status)
    result.json.return_value = data
    return result


def completion(data=VALID, finish="stop"):
    return response({"choices": [{"finish_reason": finish, "message": {"content": json.dumps(data)}}]})


@patch("src.utils.error_logging.log_event")
class ReferenceTest(unittest.TestCase):
    def test_sources_are_both_queried_and_cached_with_provenance(self, _log):
        record = {"trackName": "Home", "artistName": "Sailors", "duration": 100, "plainLyrics": '\n'.join(REFERENCE), "id": 42}
        def get(url, **kwargs):
            return response(record if "lrclib" in url else {"lyrics": '\n'.join(REFERENCE)})
        with patch("requests.get", side_effect=get) as lookup:
            refs = fetch_references("Home", "Sailors", duration=100)
        self.assertEqual(lookup.call_count, 2)
        self.assertEqual([c["source"] for c in refs["candidates"]], ["lrclib", "lyrics.ovh"])
        self.assertEqual(refs["source"], "lrclib")
        self.assertEqual(refs["version"], 2)

    def test_search_rejects_wrong_artist_title_and_recording_duration(self, _log):
        correct = {"trackName": "Home", "artistName": "Sailors", "duration": 100, "plainLyrics": '\n'.join(REFERENCE)}
        wrong = [{**correct, "artistName": "Different artist"}, {**correct, "trackName": "Elsewhere"}, {**correct, "duration": 250}]
        def get(url, **kwargs):
            if "api/get" in url: return response(None, 404)
            if "api/search" in url: return response(wrong + [correct])
            return response(None, 404)
        with patch("requests.get", side_effect=get):
            refs = fetch_references("Home", "Sailors", duration=100)
        self.assertEqual(refs["lines"], REFERENCE)
        self.assertEqual(len(refs["candidates"]), 1)

    def test_one_failed_provider_does_not_discard_other_result_and_encodes_path(self, _log):
        def get(url, **kwargs):
            if "lrclib" in url: raise requests.Timeout()
            self.assertIn("A%2FB/Stay%3F%20%231", url)
            return response({"lyrics": '\n'.join(REFERENCE)})
        with patch("requests.get", side_effect=get):
            refs = fetch_references("Stay? #1", "A/B")
        self.assertEqual(refs["source"], "lyrics.ovh")
        self.assertFalse(refs["candidates"][0]["identity_verified"])

    def test_bad_provider_shapes_and_empty_results_are_not_references(self, _log):
        with patch("requests.get", return_value=response({"lyrics": [], "plainLyrics": 7})):
            self.assertEqual(fetch_references("Home", "Sailors")["candidates"], [])

    def test_transcript_match_outweighs_first_source(self, _log):
        wrong = {"source": "lrclib", "lines": ["A completely unrelated verse"], "identity_verified": True}
        right = {"source": "lyrics.ovh", "lines": REFERENCE, "identity_verified": False}
        self.assertIs(select_reference([wrong, right], "We sale home Across the silver sea"), right)

    def test_timestamp_tags_and_section_headers_are_removed(self, _log):
        self.assertEqual(lyric_lines("[Chorus]\n[01:02.30]We sail home\n\n[02:03.00]Across the silver sea"), REFERENCE)
        self.assertEqual(lyric_lines("[00:01.00]\n[Chorus]"), [])


@patch("src.utils.error_logging.log_event")
class CorrectionTest(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-only"})
        env.start()
        self.addCleanup(env.stop)
        self.original = copy.deepcopy(RAW)

    def test_corrects_only_supported_text_and_preserves_all_timing_speaker_metadata(self, _log):
        with patch("requests.post", return_value=completion()) as post:
            result, starts, stats = correct_lyrics_with_luna(self.original, REFERENCE)
        self.assertEqual(self.original, RAW)
        expected = copy.deepcopy(RAW)
        expected["segments"][0]["words"][1]["word"] = "sail"
        self.assertEqual(result, expected)
        self.assertEqual(starts, [0, 3])
        self.assertTrue(stats["applied"])
        self.assertEqual(stats["model"], MODEL)
        self.assertEqual(post.call_args.kwargs["json"]["model"], "openai/gpt-5.6-luna")
        self.assertNotIn("input_audio", json.dumps(post.call_args.kwargs["json"]))

    def test_rejects_invalid_or_hallucinated_edits_atomically(self, _log):
        invalid = [
            {**VALID, "corrections": [{"index": -1, "text": "sail"}]},
            {**VALID, "corrections": [{"index": 90, "text": "sail"}]},
            {**VALID, "corrections": [{"index": True, "text": "sail"}]},
            {**VALID, "corrections": VALID["corrections"] * 2},
            {**VALID, "corrections": [{"index": 1, "text": ""}]},
            {**VALID, "corrections": [{"index": 1, "text": "invented"}]},
            {**VALID, "line_starts": [0, 999]},
            {**VALID, "line_starts": [3, 0]},
            {**VALID, "line_starts": [0, 0]},
            {**VALID, "matched": "true"},
            {**VALID, "corrections": "not an array"},
        ]
        for bad in invalid:
            with self.subTest(bad=bad), patch("requests.post", return_value=completion(bad)):
                result, starts, stats = correct_lyrics_with_luna(self.original, REFERENCE)
                self.assertEqual(result, RAW)
                self.assertEqual(starts, [])
                self.assertFalse(stats["applied"])

    def test_missing_key_or_unrelated_reference_does_not_call_model(self, _log):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}), patch("requests.post") as post:
            self.assertEqual(correct_lyrics_with_luna(RAW, REFERENCE)[2]["reason"], "missing_api_key")
            post.assert_not_called()
        with patch("requests.post") as post:
            self.assertEqual(correct_lyrics_with_luna(RAW, ["An entirely different lyric"])[2]["reason"], "reference_mismatch")
            post.assert_not_called()

    def test_failed_truncated_or_rejected_model_keeps_original(self, _log):
        for result in (completion(finish="length"), completion({**VALID, "matched": False}), response({"error": "unavailable"})):
            with patch("requests.post", return_value=result):
                corrected, starts, stats = correct_lyrics_with_luna(RAW, REFERENCE)
                self.assertEqual(corrected, RAW)
                self.assertEqual(starts, [])
                self.assertFalse(stats["applied"])
        with patch("requests.post", side_effect=requests.Timeout()):
            self.assertEqual(correct_lyrics_with_luna(RAW, REFERENCE)[2]["reason"], "provider_error")

    def test_pipeline_preserves_raw_and_records_actual_correction(self, _log):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app({"TESTING": True, "STARTUP_HOOKS": False, "DATABASE": directory + "/test.db", "SONGS_PATH": directory + "/songs", "SECRET_KEY": "test"})
            with app.app_context():
                save_metadata("123", {"title": "Home", "artist": "Sailors"})
                save_lyrics_raw("123", RAW)
                raw_path = Path(get_track_file_path("123", "lyrics_raw"))
                original = raw_path.read_bytes()
                refs = {"version": 2, "candidates": [{"source": "lrclib", "lines": REFERENCE, "identity_verified": True}]}
                Path(get_song_dir("123"), "reference_lyrics.json").write_text(json.dumps(refs))
                with patch("requests.post", return_value=completion()), patch("src.services.reference_lyrics.fetch_references") as fetch:
                    _stage_process_lyrics("123")
                fetch.assert_not_called()
                self.assertEqual(raw_path.read_bytes(), original)
                lyrics = load_lyrics("123")
                self.assertTrue(lyrics["correction_stats"]["applied"])
                self.assertEqual(lyrics["reference_sources"]["selected"], "lrclib")
                self.assertEqual(lyrics["segments"][0]["words"][1]["word"], "sail")

    def test_empty_transcript_uses_untimed_external_lyrics_without_model(self, _log):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app({"TESTING": True, "STARTUP_HOOKS": False, "DATABASE": directory + "/test.db", "SONGS_PATH": directory + "/songs", "SECRET_KEY": "test"})
            with app.app_context():
                save_lyrics_raw("123", {"segments": []})
                refs = {"version": 2, "candidates": [{"source": "lyrics.ovh", "lines": REFERENCE}]}
                Path(get_song_dir("123"), "reference_lyrics.json").write_text(json.dumps(refs))
                with patch("requests.post") as post:
                    _stage_process_lyrics("123")
                post.assert_not_called()
                self.assertTrue(load_lyrics("123")["untimed"])
                self.assertEqual(load_lyrics("123")["plain_lyrics"], REFERENCE)


if __name__ == "__main__":
    unittest.main()
