"""Health checks must not contact retired audio providers, even with legacy credentials."""
import os
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlparse

from src.app import create_app
from src.utils.status_checks import run_health_checks


class LocalAudioPolicyTest(unittest.TestCase):
    def test_health_checks_ignore_replicate_and_mistral_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app({"TESTING": True, "STARTUP_HOOKS": False, "DATABASE": directory + "/test.db",
                              "SONGS_PATH": directory + "/songs", "SECRET_KEY": "test"})
            with app.app_context(), patch.dict(os.environ, {
                "REPLICATE_API_TOKEN": "legacy-test", "MISTRAL_API_KEY": "legacy-test",
                "OPENAI_API_KEY": "", "OPENROUTER_API_KEY": "router-test",
            }), patch("src.services.deezer.test_deezer_login", return_value=True), \
                    patch("requests.get", return_value=Mock(status_code=200)) as get:
                checks = run_health_checks()
            self.assertNotIn("replicate", checks)
            self.assertNotIn("voxtral", checks)
            self.assertIn("separation", checks)
            self.assertIn("transcription", checks)
            hosts = {urlparse(call.args[0]).hostname for call in get.call_args_list}
            self.assertNotIn("api.replicate.com", hosts)
            self.assertNotIn("api.mistral.ai", hosts)
