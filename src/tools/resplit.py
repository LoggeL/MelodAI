"""Re-split existing songs with the local separation worker (resumable batch).

For every song with ``song.mp3`` the batch
  * skips it when ``separation.json`` says the stems already come from the current local model/version/overlap,
  * keeps the previous stems once as ``vocals.demucs.mp3`` / ``no_vocals.demucs.mp3``,
  * separates it with *batch* priority (interactive pipeline jobs run first),
  * replaces ``vocals.mp3`` / ``no_vocals.mp3`` atomically and writes ``separation.json``.
A failure keeps the old stems. Lyrics are not touched. The batch state lives next to the database (on /data in
the container), so a restarted app resumes a running batch automatically.

CLI (runs in the foreground; refuses to run while the app's own batch runner holds the lock):
    python -m src.tools.resplit --all [--force]
    python -m src.tools.resplit --track 3135556 [--track ...] [--force]
    python -m src.tools.resplit --status
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
import threading
import time
from datetime import UTC, datetime

log = logging.getLogger(__name__)

STATE_VERSION = 1
MAX_ATTEMPTS = 3
UNAVAILABLE_LIMIT = 5
RETRY_DELAYS = (15, 60, 180, 300, 600)
ACTIVE_STATUSES = ("running",)


def _now():
    return datetime.now(UTC).isoformat()


class BatchBusy(RuntimeError):
    """Another batch runner (app thread or CLI) holds the lock."""


class ResplitBatch:
    def __init__(self, app, *, separate=None, sleep=None):
        self.app = app
        self._separate = separate
        self._sleep = sleep or self._interruptible_sleep
        self._lock = threading.RLock()
        self._thread = None
        self._stop = threading.Event()
        self._lock_handle = None
        self.current = None

    # -------------------------------------------------------------- persistence
    @property
    def state_path(self):
        configured = self.app.config.get("RESPLIT_STATE_PATH")
        if configured:
            return configured
        db_dir = os.path.dirname(os.path.realpath(self.app.config["DATABASE"]))
        return os.path.join(db_dir, "resplit_state.json")

    def load_state(self):
        try:
            with open(self.state_path, encoding="utf-8") as handle:
                state = json.load(handle)
            if isinstance(state, dict) and state.get("version") == STATE_VERSION:
                return state
        except (OSError, ValueError):
            pass
        return None

    def save_state(self, state):
        state["updated_at"] = _now()
        path = self.state_path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".json.tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, indent=1)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.remove(temporary)

    def _acquire(self):
        import fcntl
        if self._lock_handle is not None:
            return True
        handle = open(self.state_path + ".lock", "a+")  # noqa: SIM115 - held while the runner works
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self._lock_handle = handle
        return True

    def _release(self):
        if self._lock_handle is not None:
            self._lock_handle.close()
            self._lock_handle = None

    # -------------------------------------------------------------- control
    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def create(self, track_ids=None, force=False):
        """Write a fresh batch state. ``track_ids=None`` means every song with ``song.mp3``."""
        from src.services.separation import installed_version, settings
        from src.utils.file_handling import get_all_track_ids, track_file_exists

        with self.app.app_context():
            if track_ids is None:
                track_ids = sorted(get_all_track_ids(), key=lambda t: int(t))
            items = {str(t): {"status": "pending", "attempts": 0} for t in track_ids
                     if track_file_exists(str(t), "song")}
            cfg = settings(self.app)
        state = {
            "version": STATE_VERSION,
            "status": "running",
            "force": bool(force),
            "model": cfg["SEPARATION_MODEL"],
            "package_version": installed_version(),
            "overlap": float(cfg["SEPARATION_OVERLAP"]),
            "created_at": _now(),
            "finished_at": None,
            "error": None,
            "order": list(items),
            "items": items,
        }
        self.save_state(state)
        return state

    def start(self, track_ids=None, force=False, background=True):
        """Start a new batch, or resume the stored one when it is unfinished and no ids/force are given."""
        with self._lock:
            if self.is_running():
                raise BatchBusy("the re-split batch is already running")
            if not self._acquire():
                raise BatchBusy("another re-split runner is active")
            try:
                state = self.load_state()
                resumable = (state and state.get("status") in ("running", "stopped", "error")
                             and any(i["status"] == "pending" for i in state["items"].values()))
                if track_ids is not None or force or not resumable:
                    state = self.create(track_ids, force)
                else:
                    state["status"] = "running"
                    state["error"] = None
                    self.save_state(state)
                self._stop.clear()
                if background:
                    self._thread = threading.Thread(target=self._run_safely, name="resplit", daemon=True)
                    self._thread.start()
                    return state
            except BaseException:
                self._release()
                raise
        self.run()
        return self.load_state()

    def resume_if_running(self):
        state = self.load_state()
        if state and state.get("status") in ACTIVE_STATUSES and not self.is_running():
            pending = sum(1 for i in state["items"].values() if i["status"] == "pending")
            print(f"Resuming the re-split batch ({pending} songs pending)")
            self._stop.clear()
            with self._lock:
                self._thread = threading.Thread(target=self._run_safely, name="resplit", daemon=True)
                self._thread.start()
            return True
        return False

    def stop(self):
        self._stop.set()
        with self._lock:
            state = self.load_state()
            if state and state.get("status") == "running":
                state["status"] = "stopped"
                self.save_state(state)
        return state

    def wait(self, timeout=None):
        if self._thread is not None:
            self._thread.join(timeout)

    # -------------------------------------------------------------- status
    def status(self):
        state = self.load_state()
        if not state:
            return {"status": "idle", "counts": {}, "total": 0, "current": None, "failures": [],
                    "running": self.is_running()}
        counts = {}
        for item in state["items"].values():
            counts[item["status"]] = counts.get(item["status"], 0) + 1
        failures = [{"track_id": tid, "error": item.get("error"), "title": self._title(tid)}
                    for tid, item in state["items"].items() if item["status"] == "failed"][:50]
        return {
            "status": state["status"],
            "running": self.is_running(),
            "force": state.get("force", False),
            "total": len(state["items"]),
            "counts": counts,
            "current": dict(self.current) if self.current else None,
            "failures": failures,
            "created_at": state.get("created_at"),
            "updated_at": state.get("updated_at"),
            "finished_at": state.get("finished_at"),
            "error": state.get("error"),
            "model": state.get("model"),
            "package_version": state.get("package_version"),
        }

    def _title(self, track_id):
        from src.utils.file_handling import load_metadata
        with self.app.app_context():
            meta = load_metadata(track_id) or {}
        title, artist = meta.get("title"), meta.get("artist")
        return f"{artist} – {title}" if title and artist else (title or str(track_id))

    # -------------------------------------------------------------- runner
    def _interruptible_sleep(self, seconds):
        self._stop.wait(seconds)

    def _run_safely(self):
        try:
            self.run()
        except BatchBusy as e:
            log.warning("Re-split batch not started: %s", e)
        except Exception as e:
            log.exception("Re-split batch crashed")
            with self._lock:
                state = self.load_state()
                if state:
                    state["status"] = "error"
                    state["error"] = f"{type(e).__name__}: {e}"[:300]
                    self.save_state(state)

    def run(self):
        """Process pending items until done, stopped or the worker stays unavailable. Holds the file lock."""
        if not self._acquire():
            raise BatchBusy("another re-split runner is active")
        try:
            self._run_locked()
        finally:
            self.current = None
            self._release()

    def _run_locked(self):
        unavailable_in_a_row = 0
        while not self._stop.is_set():
            with self._lock:
                state = self.load_state()
                if not state or state.get("status") != "running":
                    return
                pending = [t for t in state["order"] if state["items"][t]["status"] == "pending"]
                if not pending:
                    state["status"] = "done"
                    state["finished_at"] = _now()
                    self.save_state(state)
                    counts = self.status()["counts"]
                    print(f"Re-split batch finished: {counts}")
                    from src.utils.error_logging import log_event
                    with self.app.app_context():
                        log_event("info", "resplit", f"Re-split batch finished: {counts}")
                    return
            track_id = pending[0]
            outcome, error, info = self._process(track_id, force=state.get("force", False))
            if self._stop.is_set() and outcome == "aborted":
                return
            with self._lock:
                state = self.load_state()
                if not state or track_id not in state["items"]:
                    return
                item = state["items"][track_id]
                if outcome == "unavailable":
                    unavailable_in_a_row += 1
                    item["attempts"] = item.get("attempts", 0) + 1
                    item["error"] = error
                    if unavailable_in_a_row >= UNAVAILABLE_LIMIT:
                        state["status"] = "error"
                        state["error"] = f"Local separation unavailable: {error}"[:300]
                        self.save_state(state)
                        log.error("Re-split batch stopped: %s", state["error"])
                        return
                    self.save_state(state)
                    delay = RETRY_DELAYS[min(unavailable_in_a_row - 1, len(RETRY_DELAYS) - 1)]
                    log.warning("Separation worker unavailable for %s (%s); retrying in %s s", track_id, error, delay)
                    self._sleep(delay)
                    continue
                unavailable_in_a_row = 0
                if outcome == "deferred":
                    item["attempts"] = item.get("attempts", 0) + 1
                    if item["attempts"] >= MAX_ATTEMPTS * 3:
                        item.update(status="skipped", reason="busy", finished_at=_now())
                    else:
                        state["order"].remove(track_id)
                        state["order"].append(track_id)
                elif outcome == "aborted":
                    item["attempts"] = item.get("attempts", 0) + 1
                    if item["attempts"] >= MAX_ATTEMPTS:
                        item.update(status="failed", error=error, finished_at=_now())
                    else:
                        state["order"].remove(track_id)
                        state["order"].append(track_id)
                elif outcome == "failed":
                    item.update(status="failed", error=(error or "")[:300], finished_at=_now())
                    from src.utils.error_logging import log_event
                    with self.app.app_context():
                        log_event("warning", "resplit", f"Re-split failed, kept old stems: {error}"[:500],
                                  track_id=str(track_id))
                elif outcome == "skipped":
                    item.update(status="skipped", reason=error, finished_at=_now())
                else:
                    item.update(status="done", error=None, finished_at=_now(),
                                rtf=(info or {}).get("rtf"), backups=(info or {}).get("backups"))
                self.save_state(state)
            if outcome == "deferred":
                self._sleep(5)

    def _process(self, track_id, force=False):
        """Returns (outcome, message, info) with outcome in done|skipped|deferred|failed|unavailable|aborted."""
        from src.services import separation as sep
        from src.utils.file_handling import track_file_exists
        from src.utils.status_checks import get_processing_status

        separate = self._separate or sep.separate_track_locally
        with self.app.app_context():
            try:
                if not track_file_exists(track_id, "song"):
                    return "skipped", "no song.mp3", None
                record = sep.load_record(track_id)
                if not force and sep.is_current(record, sep.settings(self.app)):
                    return "skipped", "already current", None

                def busy():
                    status = get_processing_status(track_id)
                    return bool(status and status.get("status") not in ("complete", "error"))

                if busy():
                    return "deferred", "track is processing", None
                backups = []
                if not (record and record.get("backend") == "local"):
                    backups = sep.backup_stems(track_id)
                title = self._title(track_id)
                self.current = {"track_id": track_id, "title": title, "detail": "Waiting for the worker...",
                                "progress": 0, "started_at": _now()}

                def on_event(message):
                    update = sep.status_for_event(message)
                    if update is not None and self.current is not None:
                        done, total = message.get("done"), message.get("total")
                        pct = int(100 * done / total) if message.get("event") == "progress" and total else None
                        self.current = {**self.current, "detail": update[1],
                                        "progress": pct if pct is not None else self.current.get("progress", 0)}

                record = separate(
                    track_id, priority="batch", on_event=on_event,
                    should_abort=self._stop.is_set,
                    should_install=lambda: not busy() and track_file_exists(track_id, "song"),
                    app=self.app,
                )
                print(f"Re-split {track_id} done (rtf {record.get('rtf')}, {record.get('compute_backend')})")
                return "done", None, {"rtf": record.get("rtf"), "backups": backups}
            except sep.SeparationUnavailable as e:
                return "unavailable", str(e), None
            except sep.SeparationAborted as e:
                return "aborted", str(e), None
            except sep.SeparationFailed as e:
                return "failed", str(e), None
            except Exception as e:  # keep going with the next song; old stems stay in place
                log.exception("Re-split of %s failed", track_id)
                return "failed", f"{type(e).__name__}: {e}", None
            finally:
                self.current = None


def get_batch(app):
    batch = app.extensions.get("resplit_batch")
    if batch is None:
        batch = app.extensions.setdefault("resplit_batch", ResplitBatch(app))
    return batch


def _print_status(status):
    counts = status.get("counts", {})
    print(f"status: {status['status']}  total: {status.get('total', 0)}  "
          + "  ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    if status.get("error"):
        print(f"error: {status['error']}")
    for failure in status.get("failures", [])[:20]:
        print(f"  failed {failure['track_id']} ({failure['title']}): {failure['error']}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m src.tools.resplit",
                                     description="Re-split song stems with the local separation worker.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--all", action="store_true", help="every song with song.mp3 (resumes an unfinished batch)")
    target.add_argument("--track", action="append", help="one track id (repeatable)")
    target.add_argument("--status", action="store_true", help="print the stored batch state and exit")
    parser.add_argument("--force", action="store_true", help="re-split even when separation.json is current")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.environ.setdefault("MELODAI_STARTUP_HOOKS", "0")
    from src.app import create_app
    from src.utils.file_handling import is_valid_track_id

    app = create_app({"STARTUP_HOOKS": False})
    batch = get_batch(app)
    if args.status:
        _print_status(batch.status())
        return 0
    from src.services.separation import split_backend
    if split_backend(app) != "local":
        print("SPLIT_BACKEND is not 'local'; nothing to do", file=sys.stderr)
        return 2
    track_ids = None
    if args.track:
        bad = [t for t in args.track if not is_valid_track_id(t)]
        if bad:
            print(f"invalid track id(s): {', '.join(bad)}", file=sys.stderr)
            return 2
        track_ids = [str(t) for t in args.track]
    try:
        t0 = time.time()
        batch.start(track_ids=track_ids, force=args.force, background=False)
    except BatchBusy as e:
        print(f"{e}; use --status to watch it", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        batch.stop()
        print("stopped; run again with --all to resume")
        return 130
    finally:
        from src.services.separation import get_manager
        get_manager(app).stop()
    _print_status(batch.status())
    print(f"wall time: {time.time() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
