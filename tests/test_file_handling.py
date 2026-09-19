"""Filesystem containment regressions; no network or application database needed."""

import tempfile
import unittest
from pathlib import Path

from flask import Flask

from src.utils.file_handling import (
    _validate_song_path, delete_track, get_song_dir, get_track_file_path,
)


class SongPathTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.songs = self.root / "songs"
        self.songs.mkdir()
        self.app = Flask(__name__)
        self.app.config["SONGS_PATH"] = str(self.songs)
        context = self.app.app_context()
        context.push()
        self.addCleanup(context.pop)

    def test_uncreated_song_path_remains_within_root(self):
        path = get_track_file_path("123", "song", create=False)
        self.assertEqual(path, str(self.songs / "123" / "song.mp3"))
        self.assertFalse(Path(path).parent.exists())

    def test_accepts_storage_root_itself(self):
        self.assertEqual(_validate_song_path(self.songs), str(self.songs))

    def test_normalizes_internal_parent_segments(self):
        path = self.songs / "123" / ".." / "456" / "song.mp3"
        self.assertEqual(
            _validate_song_path(path), str(self.songs / "456" / "song.mp3"),
        )

    def test_rejects_parent_traversal_and_absolute_paths(self):
        for path in (self.songs / ".." / "secret", self.root / "secret"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                _validate_song_path(path)

    def test_rejects_sibling_with_same_prefix(self):
        sibling = self.root / "songs-backup" / "song.mp3"
        with self.assertRaises(ValueError):
            _validate_song_path(sibling)

    def test_rejects_file_symlink_outside_root(self):
        outside = self.root / "secret"
        outside.write_text("must remain private")
        song_dir = Path(get_song_dir("123"))
        (song_dir / "song.mp3").symlink_to(outside)
        with self.assertRaises(ValueError):
            get_track_file_path("123", "song", create=False)
        self.assertEqual(outside.read_text(), "must remain private")

    def test_rejects_directory_symlink_for_reads_creation_and_deletion(self):
        outside = self.root / "private"
        outside.mkdir()
        protected = outside / "song.mp3"
        protected.write_bytes(b"must remain untouched")
        (self.songs / "123").symlink_to(outside, target_is_directory=True)
        for action in (
            lambda: get_track_file_path("123", "song", create=False),
            lambda: get_song_dir("123"),
            lambda: delete_track("123"),
        ):
            with self.subTest(action=action), self.assertRaises(ValueError):
                action()
        self.assertEqual(protected.read_bytes(), b"must remain untouched")

    def test_allows_symlinks_that_stay_within_root(self):
        target = Path(get_song_dir("456"))
        (self.songs / "123").symlink_to(target, target_is_directory=True)
        self.assertEqual(get_song_dir("123", create=False), str(target))

    def test_supports_configured_storage_symlink(self):
        alias = self.root / "storage"
        alias.symlink_to(self.songs, target_is_directory=True)
        self.app.config["SONGS_PATH"] = str(alias)
        self.assertEqual(
            get_track_file_path("123", "song", create=False),
            str(self.songs / "123" / "song.mp3"),
        )


if __name__ == "__main__":
    unittest.main()
