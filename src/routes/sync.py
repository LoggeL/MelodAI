import json
import threading
import time
from queue import Queue, Empty
from flask import Blueprint, Response, request, session, stream_with_context
from src.utils.decorators import login_required
from src.models.db import get_db

sync_bp = Blueprint("sync", __name__, url_prefix="/api/sync")

# In-memory pub/sub: {user_id: {client_id: Queue}}
_subscribers = {}
_lock = threading.Lock()


def _broadcast(user_id, exclude_client_id, message):
    """Fan out a message to all SSE clients for a user, except the sender."""
    with _lock:
        clients = _subscribers.get(user_id)
        if not clients:
            return
        dead = []
        for client_id, q in clients.items():
            if client_id == exclude_client_id:
                continue
            try:
                q.put_nowait(message)
            except Exception:
                dead.append(client_id)
        for cid in dead:
            clients.pop(cid, None)


def _get_sync_state(user_id):
    """Load sync state from DB."""
    db = get_db()
    row = db.execute(
        "SELECT queue_data, current_index, is_playing, version FROM sync_state WHERE user_id = ?",
        [user_id],
    ).fetchone()
    if not row:
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
    client_id = request.args.get("clientId", "")
    last_version = int(request.args.get("lastVersion", "0"))

    q = Queue(maxsize=64)

    # Send initial state if server has newer data
    state = _get_sync_state(user_id)
    if state and state["version"] > last_version:
        q.put({"event": "sync_state", "data": state})

    with _lock:
        if user_id not in _subscribers:
            _subscribers[user_id] = {}
        _subscribers[user_id][client_id] = q

    def generate():
        try:
            while True:
                try:
                    msg = q.get(timeout=25)
                    event = msg.get("event", "message")
                    data = json.dumps(msg.get("data", msg))
                    yield f"event: {event}\ndata: {data}\n\n"
                except Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _lock:
                clients = _subscribers.get(user_id)
                if clients:
                    clients.pop(client_id, None)
                    if not clients:
                        _subscribers.pop(user_id, None)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@sync_bp.route("/queue", methods=["PUT"])
@login_required
def push_queue():
    user_id = session["user_id"]
    client_id = request.headers.get("X-Client-Id", "")
    body = request.get_json(force=True)

    queue_data = json.dumps(body.get("queue", []))
    current_index = body.get("currentIndex", -1)
    is_playing = 1 if body.get("isPlaying", False) else 0

    db = get_db()
    row = db.execute("SELECT version FROM sync_state WHERE user_id = ?", [user_id]).fetchone()
    if row:
        new_version = row["version"] + 1
        db.execute(
            """UPDATE sync_state
               SET queue_data = ?, current_index = ?, is_playing = ?, version = ?, updated_at = CURRENT_TIMESTAMP
               WHERE user_id = ?""",
            [queue_data, current_index, is_playing, new_version, user_id],
        )
    else:
        new_version = 1
        db.execute(
            """INSERT INTO sync_state (user_id, queue_data, current_index, is_playing, version)
               VALUES (?, ?, ?, ?, ?)""",
            [user_id, queue_data, current_index, is_playing, new_version],
        )
    db.commit()

    state = {
        "queue": body.get("queue", []),
        "currentIndex": current_index,
        "isPlaying": body.get("isPlaying", False),
        "version": new_version,
    }
    _broadcast(user_id, client_id, {"event": "sync_state", "data": state})

    return {"ok": True, "version": new_version}


@sync_bp.route("/command", methods=["POST"])
@login_required
def send_command():
    user_id = session["user_id"]
    client_id = request.headers.get("X-Client-Id", "")
    body = request.get_json(force=True)

    command = body.get("command")
    payload = body.get("payload", {})

    # Update DB state for relevant commands
    if command in ("play", "pause", "next", "prev", "playIndex"):
        db = get_db()
        row = db.execute("SELECT version, current_index FROM sync_state WHERE user_id = ?", [user_id]).fetchone()
        if row:
            updates = []
            params = []
            if command == "play":
                updates.append("is_playing = 1")
            elif command == "pause":
                updates.append("is_playing = 0")
            elif command == "playIndex":
                updates.append("current_index = ?")
                params.append(payload.get("index", 0))
                updates.append("is_playing = 1")

            if updates:
                new_version = row["version"] + 1
                updates.append("version = ?")
                params.append(new_version)
                params.append(user_id)
                db.execute(
                    f"UPDATE sync_state SET {', '.join(updates)} WHERE user_id = ?",
                    params,
                )
                db.commit()

    _broadcast(
        user_id,
        client_id,
        {"event": "command", "data": {"command": command, "payload": payload}},
    )

    return {"ok": True}
