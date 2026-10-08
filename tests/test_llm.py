"""Provider routing and request compatibility without any real API credentials."""
import os
import unittest
from unittest.mock import Mock, patch

import requests

from src.services.llm import chat_completion, has_api_key


class LLMProviderTest(unittest.TestCase):
    payload = {"model": "openai/gpt-6-luna", "messages": [{"role": "user", "content": "test"}],
               "reasoning_effort": "none", "max_tokens": 1200, "response_format": {"type": "json_object"}}

    def response(self):
        result = Mock()
        result.json.return_value = {"choices": []}
        return result

    def test_openai_key_takes_priority_and_uses_direct_api_parameters(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "direct-test", "OPENROUTER_API_KEY": "router-test"}, clear=True), \
                patch("requests.post", return_value=self.response()) as post:
            _, producer = chat_completion(self.payload, timeout=5)
        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], "https://api.openai.com/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer direct-test")
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["model"], "gpt-6-luna")
        self.assertEqual(body["max_completion_tokens"], 1200)
        self.assertNotIn("max_tokens", body)
        self.assertEqual(self.payload["max_tokens"], 1200)
        self.assertEqual(producer, {"provider": "openai", "model": "gpt-6-luna"})

    def test_openrouter_is_used_without_an_openai_key(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": "router-test"}, clear=True), \
                patch("requests.post", return_value=self.response()) as post:
            _, producer = chat_completion(self.payload, timeout=5)
        self.assertEqual(post.call_args.args[0], "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["json"]["max_tokens"], 1200)
        self.assertEqual(producer, {"provider": "openrouter", "model": "openai/gpt-6-luna"})

    def test_non_openai_model_override_stays_on_openrouter(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "direct-test", "OPENROUTER_API_KEY": "router-test"}, clear=True), \
                patch("requests.post", return_value=self.response()) as post:
            _, producer = chat_completion({**self.payload, "model": "google/gemini-3.1-flash-lite"}, timeout=5)
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer router-test")
        self.assertEqual(producer["provider"], "openrouter")

    def test_failed_direct_request_is_not_repeated_on_openrouter(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "direct-test", "OPENROUTER_API_KEY": "router-test"}, clear=True), \
                patch("requests.post", side_effect=requests.Timeout()) as post:
            with self.assertRaises(requests.Timeout):
                chat_completion(self.payload, timeout=5)
        post.assert_called_once()

    def test_missing_or_blank_keys_do_not_send_requests(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": " ", "OPENROUTER_API_KEY": " "}, clear=True), patch("requests.post") as post:
            self.assertFalse(has_api_key(self.payload["model"]))
            with self.assertRaisesRegex(RuntimeError, "No API key"):
                chat_completion(self.payload, timeout=5)
        post.assert_not_called()
