from flask import Blueprint, send_from_directory, session, redirect
from ..utils.decorators import login_required, admin_required, _validate_auth

static_bp = Blueprint("static", __name__)


@static_bp.route("/", methods=["GET"])
def index():
    # Check both session and auth token
    if not _validate_auth():
        return redirect("/login")

    return send_from_directory("static", "index.html")


@static_bp.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory("static/css", filename)


@static_bp.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory("static/js", filename)


@static_bp.route("/about", methods=["GET"])
def about_html():
    return send_from_directory("static", "about.html")


@static_bp.route("/login", methods=["GET"])
def login_html():
    if _validate_auth():
        return redirect("/")
    return send_from_directory("static", "login.html")


@static_bp.route("/admin", methods=["GET"])
@admin_required
def admin_html():
    return send_from_directory("static", "admin.html")


@static_bp.route("/songs/<path:path>", methods=["GET"])
@login_required
def song_file(path):
    print("Sending song file", path)
    return send_from_directory("songs", path)


@static_bp.route("/logo.png", methods=["GET"])
def logo():
    return send_from_directory("static", "logo.png")


@static_bp.route("/logo.svg", methods=["GET"])
def logo_svg():
    return send_from_directory("static", "logo.svg")
