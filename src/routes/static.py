import os
from html import escape
from flask import Blueprint, send_from_directory, request

from ..utils.file_handling import load_metadata

static_bp = Blueprint("static", __name__)

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
SONGS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "songs")

_DEFAULT_OG = (
    '<meta property="og:title" content="MelodAI">'
    '<meta property="og:description" content="AI-Powered Karaoke">'
    '<meta property="og:type" content="website">'
    '<meta property="og:image" content="{origin}/logo.svg">'
)


def _serve_spa(og_tags=None):
    """Serve the React SPA index.html, optionally injecting OG meta tags."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r") as f:
        html = f.read()

    origin = request.host_url.rstrip("/")
    tags = og_tags or _DEFAULT_OG.format(origin=origin)
    html = html.replace("</head>", f"    {tags}\n  </head>", 1)
    return html


@static_bp.route("/")
def index():
    return _serve_spa()


@static_bp.route("/login")
def login_page():
    return _serve_spa()


@static_bp.route("/about")
def about_page():
    return _serve_spa()


@static_bp.route("/admin")
@static_bp.route("/admin/users")
@static_bp.route("/admin/keys")
@static_bp.route("/admin/usage")
@static_bp.route("/admin/songs")
@static_bp.route("/admin/songs/<track_id>")
@static_bp.route("/admin/status")
@static_bp.route("/admin/errors")
def admin_page(**_kwargs):
    return _serve_spa()


@static_bp.route("/song/<track_id>")
def song_page(track_id):
    meta = load_metadata(track_id)
    if meta:
        origin = request.host_url.rstrip("/")
        title = escape(meta.get("title", "Unknown"))
        artist = escape(meta.get("artist", "Unknown"))
        img = escape(meta.get("img_url", f"{origin}/logo.svg"))
        url = f"{origin}/song/{escape(track_id)}"
        og = (
            f'<meta property="og:title" content="{title} - {artist}">'
            f'<meta property="og:description" content="Listen to {title} by {artist} on MelodAI">'
            f'<meta property="og:type" content="music.song">'
            f'<meta property="og:image" content="{img}">'
            f'<meta property="og:url" content="{url}">'
        )
        return _serve_spa(og_tags=og)
    return _serve_spa()


@static_bp.route("/library")
def library_page():
    return _serve_spa()


@static_bp.route("/profile")
def profile_page():
    return _serve_spa()


@static_bp.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "assets"), filename)


@static_bp.route("/logo.svg")
def logo():
    return send_from_directory(STATIC_DIR, "logo.svg")


@static_bp.route("/favicon.svg")
def favicon():
    return send_from_directory(STATIC_DIR, "favicon.svg")


@static_bp.route("/songs/<path:filename>")
def song_file(filename):
    return send_from_directory(SONGS_DIR, filename)
