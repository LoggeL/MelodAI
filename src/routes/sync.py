"""Validated queue persistence and per-application live playback messages."""

import json
import math
import threading
from queue import Queue, Empty, Full

from flask import Blueprint, Response, request, session, stream_with_context, current_app
from werkzeug.exceptions import BadRequest

from src.utils.decorators import login_required
from src.utils.file_handling import is_valid_track_id
from src.utils.validation import json_object, integer_field, boolean_field, text_field
from src.models.db import get_db, transaction

sync_bp = Blueprint("sync", __name__, url_prefix="/api/sync")
_lock = threading.RLock()


def _subscribers():
    return current_app.extensions.setdefault("sync_subscribers", {})


def _broadcast(user_id, exclude_client_id, message):
    """Keep bounded queues without stranding a slow subscriber forever."""
    with _lock:
        for client_id, queue in _subscribers().get(user_id, {}).items():
            if client_id == exclude_client_id:
                continue
            try:
                queue.put_nowait(message)
            except Full:
                try:
                    queue.get_nowait()
                except Empty:
                    pass
                queue.put_nowait(message)


def _get_sync_state(user_id):
    row = get_db().execute(
        "SELECT queue_data, current_index, is_playing, version FROM sync_state WHERE user_id = ?",
        [user_id],
    ).fetchone()
    if row is None:
        return None
    return {
        "queue": json.loads(row["queue_data"]),
        "currentIndex": row["current_index"],
        "isPlaying": bool(row["is_playing"]),
        "version": row["version"],
    }


@sync_bp.route("/stream")
@login_required
def stream():
    user_id = session["user_id"]
    client_id = request.args.get("clientId", "").strip()
    if not client_id or len(client_id) > 128:
        raise BadRequest("clientId is required and must be at most 128 characters")
    last_version = request.args.get("lastVersion", 0, type=int) or 0
    queue = Queue(maxsize=64)
    subscribers = _subscribers()

    # Register and load the initial state while broadcasts are blocked. A
    # concurrent update is either visible here or delivered by its broadcast.
    with _lock:
        state = _get_sync_state(user_id)
        subscribers.setdefault(user_id, {})[client_id] = queue
        if state and state["version"] > last_version:
            queue.put_nowait({"event": "sync_state", "data": {**state, "initial": True}})
        # Sent even when there is no newer saved state. The client can then
        # distinguish first hydration from subsequent live updates.
        queue.put_nowait({"event": "sync_ready", "data": {}})

    def generate():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    message = queue.get(timeout=25)
                    yield f"event: {message['event']}\ndata: {json.dumps(message['data'])}\n\n"
                except Empty:
                    yield ": keepalive\n\n"
        finally:
            with _lock:
                clients = subscribers.get(user_id)
                # A reconnect with the same ID may already have replaced us.
                if clients and clients.get(client_id) is queue:
                    del clients[client_id]
                    if not clients:
                        subscribers.pop(user_id, None)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _validated_queue(body):
    queue = body.get("queue", [])
    if not isinstance(queue, list) or len(queue) > 500:
        raise BadRequest("queue must be an array of at most 500 tracks")
    for item in queue:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not is_valid_track_id(item["id"]):
            raise BadRequest("Each queue entry must contain a valid track id")
        for field in ("title", "artist", "thumbnail"):
            text_field(item, field, max_length=2000)
    index = integer_field(body, "currentIndex", -1, minimum=-1, maximum=max(len(queue) - 1, -1))
    playing = boolean_field(body, "isPlaying")
    if playing and index < 0:
        raise BadRequest("Select a track before starting playback")
    return queue, index, playing


@sync_bp.route("/queue", methods=["PUT"])
@login_required
def push_queue():
    user_id = session["user_id"]
    queue, index, playing = _validated_queue(json_object())
    # Keep commit order and delivery order identical. Otherwise a paused
    # request can broadcast version N after another request delivered N + 1.
    with _lock:
        with transaction() as db:
            row = db.execute(
                """INSERT INTO sync_state (user_id, queue_data, current_index, is_playing, version)
                   VALUES (?, ?, ?, ?, 1)
                   ON CONFLICT(user_id) DO UPDATE SET queue_data = excluded.queue_data,
                       current_index = excluded.current_index, is_playing = excluded.is_playing,
                       version = sync_state.version + 1, updated_at = CURRENT_TIMESTAMP
                   RETURNING version""",
                [user_id, json.dumps(queue), index, int(playing)],
            ).fetchone()
        state = {"queue": queue, "currentIndex": index, "isPlaying": playing, "version": row["version"]}
        _broadcast(user_id, request.headers.get("X-Client-Id", ""), {"event": "sync_state", "data": state})
    return {"ok": True, "version": row["version"]}


@sync_bp.route("/command", methods=["POST"])
@login_required
def send_command():
    user_id = session["user_id"]
    body = json_object()
    command = text_field(body, "command")
    if command not in {"play", "pause", "next", "prev", "playIndex", "seek"}:
        raise BadRequest("Unsupported playback command")
    payload = body.get("payload", {})
    if not isinstance(payload, dict):
        raise BadRequest("payload must be a JSON object")
    if command == "seek":
        position = payload.get("time")
        if type(position) not in (int, float) or not math.isfinite(position) or position < 0:
            raise BadRequest("time must be a non-negative finite number")
    if command == "playIndex":
        integer_field(payload, "index")

    with _lock:
        if command in {"play", "pause", "playIndex"}:
            with transaction() as db:
                state = _get_sync_state(user_id)
                if state:
                    index = payload["index"] if command == "playIndex" else state["currentIndex"]
                    playing = command != "pause"
                    if command == "playIndex" and index >= len(state["queue"]):
                        raise BadRequest("Invalid queue index")
                    if playing and (index < 0 or index >= len(state["queue"])):
                        raise BadRequest("Select a track before starting playback")
                    db.execute(
                        """UPDATE sync_state SET current_index = ?, is_playing = ?,
                           version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?""",
                        [index, int(playing), user_id],
                    )

        _broadcast(user_id, request.headers.get("X-Client-Id", ""), {
            "event": "command", "data": {"command": command, "payload": payload},
        })
    return {"ok": True}
