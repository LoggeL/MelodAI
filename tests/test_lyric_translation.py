"""Offline translation request contracts; no provider requests are submitted."""
import json
import os
import unittest
from unittest.mock import Mock, patch

from src.services.lyric_translation import translate_lines


@patch("src.utils.error_logging.log_event")
class TranslationModelTest(unittest.TestCase):
    def response(self):
        response = Mock()
        response.json.return_value = {"choices": [{"message": {"content": json.dumps({
            "source_language": "en", "lines": [{"index": 0, "translation": "Wir segeln nach Hause"}],
        })}}]}
        return response

    def test_default_model_uses_luna_parameters_and_preserves_line_order(self, _log):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-only"}, clear=True), \
                patch("requests.post", return_value=self.response()) as post:
            result = translate_lines(["We sail home"], "de")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "openai/gpt-6-luna")
        self.assertEqual(payload["reasoning_effort"], "none")
        self.assertNotIn("temperature", payload)
        self.assertEqual(result["model"], "openai/gpt-6-luna")
        self.assertEqual(result["lines"], [{"index": 0, "original": "We sail home", "translation": "Wir segeln nach Hause"}])

    def test_explicit_translation_and_legacy_model_overrides_are_preserved(self, _log):
        for key in ("LYRICS_TRANSLATION_MODEL", "LYRICS_GEMINI_MODEL"):
            with self.subTest(key=key), patch.dict(os.environ, {
                "OPENROUTER_API_KEY": "test-only", key: "google/gemini-3.1-flash-lite",
            }, clear=True), patch("requests.post", return_value=self.response()) as post:
                result = translate_lines(["We sail home"], "de")
                payload = post.call_args.kwargs["json"]
                self.assertEqual(result["model"], "google/gemini-3.1-flash-lite")
                self.assertEqual(payload["temperature"], 0.35)
                self.assertNotIn("reasoning_effort", payload)
