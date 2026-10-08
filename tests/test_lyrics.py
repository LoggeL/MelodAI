"""Offline quality checks for local lyrics transcription."""
import unittest

from src.services.lyrics import _is_bad_output


class LyricsOutputValidationTest(unittest.TestCase):
    @staticmethod
    def output(text):
        return {"segments": [{"words": [{"word": word} for word in text.split()]}]}

    def test_repeated_lyrics_with_small_transcription_errors_are_accepted(self):
        for reference, transcript in (
            ("We sail home across the silver sea", "We sale home across the silver sea"),
            ("Wir fahren heute wieder nach Hause", "Wir fahren heute wider nach Hause"),
        ):
            with self.subTest(reference=reference):
                self.assertFalse(_is_bad_output(self.output(" ".join([transcript] * 12)), [reference] * 12))

    def test_unrelated_repeated_lyrics_are_rejected(self):
        self.assertTrue(_is_bad_output(
            self.output(" ".join(["orbit galaxy planet moon"] * 12)),
            ["We sail home across the silver sea"] * 12,
        ))

    def test_empty_and_character_level_outputs_are_rejected(self):
        for text in ("", "a b c d e f g h i j k l"):
            with self.subTest(text=text):
                self.assertTrue(_is_bad_output(self.output(text)))
