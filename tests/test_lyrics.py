"""Provider request tests use mocks and never submit paid predictions."""

import os
import unittest
import httpx
import replicate
from types import SimpleNamespace
from unittest.mock import patch

from replicate.exceptions import ModelError, ReplicateError

from src.services.lyrics import extract_lyrics_whisperx, _PredictionCreationTransport


class LyricsProviderTest(unittest.TestCase):
    output = {"segments": [{"words": [{"word": "Hello", "start": 0, "end": 1}]}]}

    def test_missing_token_skips_diarization_and_preserves_word_alignment(self):
        for token in ("", "   "):
            with self.subTest(token=token):
                with patch.dict(os.environ, {"HF_READ_TOKEN": token}), patch(
                    "src.services.lyrics._replicate_client.run", return_value=self.output,
                ) as run:
                    self.assertEqual(extract_lyrics_whisperx("mock-audio"), self.output)
                run.assert_called_once()
                params = run.call_args.kwargs["input"]
                self.assertFalse(params["diarization"])
                self.assertTrue(params["align_output"])
                self.assertNotIn("huggingface_access_token", params)
                self.assertNotIn("min_speakers", params)
                self.assertNotIn("max_speakers", params)

    def test_configured_token_enables_speaker_detection(self):
        with patch.dict(os.environ, {"HF_READ_TOKEN": "test-token"}), patch(
            "src.services.lyrics._replicate_client.run", return_value=self.output,
        ) as run:
            extract_lyrics_whisperx("mock-audio")
        params = run.call_args.kwargs["input"]
        self.assertTrue(params["diarization"])
        self.assertEqual(params["huggingface_access_token"], "test-token")

    def test_failed_diarization_stays_disabled_for_quality_retries(self):
        error = ModelError(SimpleNamespace(error="Speaker model unavailable"))
        with patch.dict(os.environ, {"HF_READ_TOKEN": "test-token"}), patch(
            "src.services.lyrics._replicate_client.run",
            side_effect=[error, {"segments": []}, self.output],
        ) as run:
            self.assertEqual(extract_lyrics_whisperx("mock-audio"), self.output)
        self.assertEqual([call.kwargs["input"]["diarization"] for call in run.call_args_list],
                         [True, False, False])

    def test_model_failure_without_diarization_is_not_repeated_as_fallback(self):
        error = ModelError(SimpleNamespace(error="Transcription unavailable"))
        with patch.dict(os.environ, {"HF_READ_TOKEN": ""}), patch(
            "src.services.lyrics._replicate_client.run", side_effect=error,
        ) as run:
            with self.assertRaises(ModelError):
                extract_lyrics_whisperx("mock-audio")
        run.assert_called_once()


class PredictionCreationRetryTest(unittest.TestCase):
    def test_explicit_throttling_retries_creation_and_honors_retry_after(self):
        responses = [httpx.Response(429, headers={"Retry-After": "5"}), httpx.Response(201)]
        requests = []

        def handle(request):
            requests.append(request)
            return responses[len(requests) - 1]

        transport = _PredictionCreationTransport(httpx.MockTransport(handle))
        with httpx.Client(transport=transport) as client, patch("src.services.lyrics.time.sleep") as sleep:
            response = client.post("https://provider.test/v1/predictions", json={"input": {}})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].content, requests[1].content)
        self.assertTrue(responses[0].is_closed)
        sleep.assert_called_once_with(5.0)

    def test_retries_are_bounded_and_do_not_exceed_long_retry_after(self):
        for retry_after, attempts, wait in (("", 4, 30), ("1", 4, 3), ("31", 1, 0)):
            with self.subTest(retry_after=retry_after):
                requests = []

                def handle(request):
                    requests.append(request)
                    return httpx.Response(429, headers={"Retry-After": retry_after})

                with httpx.Client(transport=_PredictionCreationTransport(httpx.MockTransport(handle))) as client:
                    with patch("src.services.lyrics.time.sleep") as sleep:
                        response = client.post("https://provider.test/v1/predictions", json={})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(len(requests), attempts)
                self.assertEqual(sum(call.args[0] for call in sleep.call_args_list), wait)

    def test_other_http_operations_and_ambiguous_failures_are_not_retried(self):
        for method, path, status in (("GET", "/v1/predictions/job", 429),
                                     ("POST", "/v1/files", 429),
                                     ("POST", "/v1/predictions", 500),
                                     ("POST", "/v1/predictions", 503)):
            with self.subTest(method=method, path=path, status=status):
                requests = []

                def handle(request):
                    requests.append(request)
                    return httpx.Response(status)

                with httpx.Client(transport=_PredictionCreationTransport(httpx.MockTransport(handle))) as client:
                    with patch("src.services.lyrics.time.sleep") as sleep:
                        self.assertEqual(client.request(method, "https://provider.test" + path).status_code, status)
                self.assertEqual(len(requests), 1)
                sleep.assert_not_called()

    def test_network_error_does_not_repeat_a_potentially_accepted_post(self):
        requests = []

        def handle(request):
            requests.append(request)
            raise httpx.ReadTimeout("Response lost", request=request)

        with httpx.Client(transport=_PredictionCreationTransport(httpx.MockTransport(handle))) as client:
            with patch("src.services.lyrics.time.sleep") as sleep:
                with self.assertRaises(httpx.ReadTimeout):
                    client.post("https://provider.test/v1/predictions", json={})
        self.assertEqual(len(requests), 1)
        sleep.assert_not_called()

    def test_sdk_poll_failure_never_creates_a_second_prediction(self):
        requests = []

        def handle(request):
            requests.append((request.method, request.url.path))
            if request.method == "POST":
                return httpx.Response(201, json={"id": "accepted-job", "model": "test/model",
                                                "version": "abc", "status": "starting"})
            if "/versions/" in request.url.path:
                return httpx.Response(200, json={"id": "abc", "created_at": "2026-01-01T00:00:00Z",
                                                "cog_version": "test", "openapi_schema": {}})
            return httpx.Response(500, json={"detail": "Polling unavailable"})

        client = replicate.Client(api_token="test-only", base_url="https://provider.test",
                                  transport=_PredictionCreationTransport(httpx.MockTransport(handle)))
        self.addCleanup(client._client.close)
        with patch("replicate.prediction.time.sleep"):
            with self.assertRaises(ReplicateError):
                client.run("test/model:abc", input={})
        self.assertEqual(requests.count(("POST", "/v1/predictions")), 1)
        self.assertIn(("GET", "/v1/predictions/accepted-job"), requests)


if __name__ == "__main__":
    unittest.main()
