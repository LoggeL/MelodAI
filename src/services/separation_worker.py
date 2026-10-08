"""Local vocal separation worker: one long-lived process per container.

The Flask app starts this module as a child process (see ``src/services/separation.py``). The worker loads the
turbo-roformer model once and runs exactly one separation at a time, always on its main thread (the fast bf16
kernels and their preallocated buffers are tuned for that). Clients talk to it over a unix stream socket with
newline-delimited JSON:

    -> {"op": "ping"}                          <- {"event": "pong", "state": ..., "info": {...}, "queue": [...]}
    -> {"op": "separate", "job": {...}}        <- {"event": "accepted", "job_id": ..., "state": ...}
                                               <- {"event": "queued", "position": p}       (1 = next up)
                                               <- {"event": "started"}
                                               <- {"event": "progress", "done": k, "total": n}
                                               <- {"event": "preempted"}                   (batch job paused)
                                               <- {"event": "heartbeat", "state": ...}     (every few seconds)
                                               <- {"event": "done", "result": {...}}  or
                                               <- {"event": "error", "message": ..., "retryable": bool}

A job is ``{"input": song.mp3, "outputs": {"vocals": a.mp3, "no_vocals": b.mp3}, "priority": "interactive" |
"batch", "overlap": 2.0, "bitrate": "128k", "label": "..."}``. Interactive jobs run before batch jobs; with
preemption enabled a running batch job is interrupted at the next chunk boundary and put back at the head of
the batch queue. Closing the connection cancels the job (queued or running).
"""

from __future__ import annotations

import argparse
import heapq
import itertools
import json
import logging
import os
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import uuid

log = logging.getLogger("melodai.separation_worker")

PRIORITIES = {"interactive": 0, "batch": 10}
SAMPLE_RATE = 44100
EXIT_LOAD_FAILED = 3
EXIT_ALREADY_RUNNING = 4
MAX_LINE = 64 * 1024


class JobAborted(Exception):
    """Raised from the progress callback to stop a running separation."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason  # "preempted" | "cancelled" | "shutdown"


# ---------------------------------------------------------------------------------------------- audio helpers

def decode_audio(path, sample_rate=SAMPLE_RATE):
    """Decode any ffmpeg-readable file to float32 stereo (2, n) at ``sample_rate``."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-vn", "-f", "f32le", "-acodec", "pcm_f32le",
         "-ac", "2", "-ar", str(sample_rate), "pipe:1"],
        capture_output=True, timeout=600, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not decode the input: {proc.stderr.decode(errors='replace').strip()[-300:]}")
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size < 2:
        raise RuntimeError("the input contains no audio")
    return np.ascontiguousarray(data[: data.size - data.size % 2].reshape(-1, 2).T)


def encode_mp3(audio, path, sample_rate=SAMPLE_RATE, bitrate="128k"):
    """Encode float32 (2, n) to MP3 with ffmpeg (same encoder as the existing compress path)."""
    import numpy as np

    interleaved = np.ascontiguousarray(audio.T, dtype=np.float32).tobytes()
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(sample_rate), "-ac", "2",
         "-i", "pipe:0", "-vn", "-b:a", str(bitrate), str(path)],
        input=interleaved, capture_output=True, timeout=600, check=False,
    )
    if proc.returncode != 0 or not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise RuntimeError(f"ffmpeg could not encode {os.path.basename(path)}: "
                           f"{proc.stderr.decode(errors='replace').strip()[-300:]}")


# ---------------------------------------------------------------------------------------------- engines

class TurboEngine:
    """turbo-roformer (BS-RoFormer on the CPU). Imports torch, so only ever constructed inside the worker."""

    name = "turbo-roformer"

    def __init__(self, model="resurrection", precision="bf16", threads=8, model_dir=None):
        from turbo_roformer import Separator, __version__

        t0 = time.perf_counter()
        self.separator = Separator(model=model, precision=precision, threads=threads, model_dir=model_dir,
                                   progress=False)
        self.info = {
            "engine": self.name,
            "version": __version__,
            "model": self.separator.model_name,
            "model_key": model,
            "precision": self.separator.precision,
            "compute_backend": self.separator.backend,
            "threads": threads,
            "load_s": round(time.perf_counter() - t0, 2),
        }

    def run(self, spec, progress, check_abort):
        t0 = time.perf_counter()
        mix = decode_audio(spec["input"])
        duration = mix.shape[1] / SAMPLE_RATE
        overlap = float(spec.get("overlap", 2.0))
        total = self.separator.n_chunks(mix.shape[1], overlap)
        progress(0, total)
        t1 = time.perf_counter()
        inst = self.separator.separate(mix, sr=SAMPLE_RATE, overlap=overlap, progress=progress)
        vocals = mix - inst
        t2 = time.perf_counter()
        check_abort()
        bitrate = spec.get("bitrate", "128k")
        encode_mp3(vocals, spec["outputs"]["vocals"], bitrate=bitrate)
        encode_mp3(inst, spec["outputs"]["no_vocals"], bitrate=bitrate)
        t3 = time.perf_counter()
        return {
            "duration_s": round(duration, 3),
            "decode_s": round(t1 - t0, 3),
            "separate_s": round(t2 - t1, 3),
            "encode_s": round(t3 - t2, 3),
            "wall_s": round(t3 - t0, 3),
            "rtf": round((t3 - t0) / duration, 4) if duration else None,
            "separate_rtf": round((t2 - t1) / duration, 4) if duration else None,
            "chunks": total,
            "overlap": overlap,
        }


class FakeEngine:
    """Test double without a model: reports chunks and writes placeholder files.

    Tuned through environment variables so tests can drive a real worker process cheaply:
    ``MELODAI_FAKE_SEP_CHUNKS`` (default 4), ``MELODAI_FAKE_SEP_DELAY`` seconds per chunk (0.05),
    ``MELODAI_FAKE_SEP_LOAD_DELAY`` (0), ``MELODAI_FAKE_SEP_FAIL_LOAD`` (unset), ``MELODAI_FAKE_SEP_MODE``
    (``fail`` | ``crash`` | ``hang``). An input whose file name contains ``fail``/``crash``/``hang`` behaves the
    same: raise, kill the worker process, or stop reporting progress until the job is cancelled.
    """

    name = "fake"

    def __init__(self, **_kwargs):
        time.sleep(float(os.environ.get("MELODAI_FAKE_SEP_LOAD_DELAY", "0")))
        if os.environ.get("MELODAI_FAKE_SEP_FAIL_LOAD"):
            raise RuntimeError("fake model failed to load")
        self.info = {"engine": "fake", "version": "0.0-test", "model": "fake", "model_key": "fake",
                     "precision": "none", "compute_backend": "none", "threads": 1, "load_s": 0.0}

    def run(self, spec, progress, check_abort):
        name = os.path.basename(spec["input"]) + " " + os.environ.get("MELODAI_FAKE_SEP_MODE", "")
        total = int(os.environ.get("MELODAI_FAKE_SEP_CHUNKS", "4"))
        delay = float(os.environ.get("MELODAI_FAKE_SEP_DELAY", "0.05"))
        progress(0, total)
        if "crash" in name:
            os._exit(9)
        if "fail" in name:
            raise RuntimeError("fake separation failed")
        for k in range(1, total + 1):
            time.sleep(delay)
            while "hang" in name:
                time.sleep(0.05)
                check_abort()
            progress(k, total)
        check_abort()
        with open(spec["input"], "rb") as handle:
            payload = handle.read()
        for key in ("vocals", "no_vocals"):
            with open(spec["outputs"][key], "wb") as handle:
                handle.write(f"FAKE-{key.upper()}:".encode() + payload)
        return {"duration_s": 1.0, "wall_s": total * delay, "rtf": total * delay, "chunks": total,
                "overlap": float(spec.get("overlap", 2.0))}


ENGINES = {"turbo": TurboEngine, "fake": FakeEngine}


# ---------------------------------------------------------------------------------------------- server

class Connection:
    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()
        self.closed = False

    def send(self, message):
        data = (json.dumps(message) + "\n").encode()
        with self.lock:
            if self.closed:
                return False
            try:
                self.sock.sendall(data)
                return True
            except OSError:
                self.closed = True
                return False

    def close(self):
        with self.lock:
            self.closed = True
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                self.sock.close()
            except OSError:
                pass


class Job:
    def __init__(self, spec, conn, priority, seq):
        self.id = uuid.uuid4().hex[:12]
        self.spec = spec
        self.conn = conn
        self.priority = priority
        self.seq = seq
        self.state = "queued"  # queued | running | finished
        self.cancelled = False
        self.preempt = False
        self.position = None
        self.progress = None
        self.submitted = time.time()

    def __lt__(self, other):
        return (self.priority, self.seq) < (other.priority, other.seq)

    def summary(self):
        return {"job_id": self.id, "priority": self.spec.get("priority"), "label": self.spec.get("label", ""),
                "state": self.state, "progress": self.progress, "position": self.position}


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("job must be an object")
    src = spec.get("input")
    outputs = spec.get("outputs")
    if not isinstance(src, str) or not os.path.isabs(src) or not os.path.isfile(src):
        raise ValueError("input must be an existing absolute file path")
    if not isinstance(outputs, dict) or set(outputs) != {"vocals", "no_vocals"}:
        raise ValueError("outputs must name 'vocals' and 'no_vocals'")
    for path in outputs.values():
        if not isinstance(path, str) or not os.path.isabs(path) or not os.path.isdir(os.path.dirname(path)):
            raise ValueError("outputs must be absolute paths in existing directories")
    if spec.get("priority", "interactive") not in PRIORITIES:
        raise ValueError("priority must be 'interactive' or 'batch'")
    overlap = spec.get("overlap", 2.0)
    if not isinstance(overlap, (int, float)) or not 1.0 <= float(overlap) <= 16.0:
        raise ValueError("overlap must be between 1 and 16")
    return spec


class Worker:
    def __init__(self, engine_factory, socket_path, *, preempt=True, heartbeat=5.0, parent_pid=None):
        self.engine_factory = engine_factory
        self.socket_path = socket_path
        self.preempt_enabled = preempt
        self.heartbeat_s = heartbeat
        self.parent_pid = parent_pid
        self.cond = threading.Condition()
        self.queue = []
        self.seq = itertools.count()
        self.current = None
        self.state = "starting"
        self.engine = None
        self.info = {}
        self.stopping = False
        self.stats = {"completed": 0, "failed": 0, "preempted": 0, "cancelled": 0}
        self.started_at = time.time()
        self.server = None

    # -------------------------------------------------------------- socket side (background threads)
    def listen(self):
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        old_umask = os.umask(0o177)
        try:
            server.bind(self.socket_path)
        finally:
            os.umask(old_umask)
        server.listen(64)
        self.server = server
        threading.Thread(target=self._accept_loop, name="accept", daemon=True).start()
        threading.Thread(target=self._heartbeat_loop, name="heartbeat", daemon=True).start()

    def _accept_loop(self):
        while not self.stopping:
            try:
                sock, _ = self.server.accept()
            except OSError:
                if self.stopping:
                    return
                time.sleep(0.1)
                continue
            sock.settimeout(None)
            try:  # a client that stops reading must not block the queue lock forever
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDTIMEO, struct.pack("ll", 10, 0))
            except (OSError, struct.error):
                pass
            threading.Thread(target=self._handle, args=(sock,), name="conn", daemon=True).start()

    def _handle(self, sock):
        conn = Connection(sock)
        job = None
        try:
            reader = sock.makefile("rb")
            while True:
                line = reader.readline(MAX_LINE)
                if not line:
                    break
                try:
                    message = json.loads(line)
                    op = message.get("op")
                except (ValueError, AttributeError):
                    conn.send({"event": "error", "message": "invalid request", "retryable": False})
                    break
                if op in ("ping", "status"):
                    conn.send(self.status())
                elif op == "separate":
                    if job is not None:
                        conn.send({"event": "error", "message": "one job per connection", "retryable": False})
                        break
                    try:
                        spec = validate_spec(message.get("job"))
                    except ValueError as e:
                        conn.send({"event": "error", "message": str(e), "retryable": False})
                        break
                    job = self.submit(spec, conn)
                    if job is None:
                        break
                else:
                    conn.send({"event": "error", "message": f"unknown op {op!r}", "retryable": False})
                    break
        except OSError:
            pass
        finally:
            if job is not None and job.state != "finished":
                self.cancel(job)
            conn.close()

    def _heartbeat_loop(self):
        while not self.stopping:
            time.sleep(self.heartbeat_s)
            if self.parent_pid and os.getppid() != self.parent_pid:
                log.warning("parent process exited; stopping the separation worker")
                self.stop()
                return
            with self.cond:
                jobs = [j for j in self._queued_jobs()] + ([self.current] if self.current else [])
                state = self.state
            for job in jobs:
                if not job.conn.send({"event": "heartbeat", "state": state}):
                    self.cancel(job)

    # -------------------------------------------------------------- queue
    def _queued_jobs(self):
        return sorted(j for j in self.queue if not j.cancelled)

    def _broadcast_positions(self):
        """Tell every waiting client its position (1 = next). Caller holds ``self.cond``."""
        for index, job in enumerate(self._queued_jobs()):
            if job.position != index + 1:
                job.position = index + 1
                job.conn.send({"event": "queued", "position": job.position, "running": self.current is not None})

    def submit(self, spec, conn):
        with self.cond:
            if self.stopping or self.state == "failed":
                conn.send({"event": "error", "message": "separation worker is shutting down", "retryable": True})
                return None
            priority = PRIORITIES[spec.get("priority", "interactive")]
            job = Job(spec, conn, priority, next(self.seq))
            heapq.heappush(self.queue, job)
            conn.send({"event": "accepted", "job_id": job.id, "state": self.state})
            current = self.current
            if (self.preempt_enabled and current is not None and current.state == "running"
                    and priority < current.priority and not current.preempt):
                log.info("preempting batch job %s for interactive job %s", current.id, job.id)
                current.preempt = True
            self._broadcast_positions()
            self.cond.notify_all()
        return job

    def cancel(self, job):
        with self.cond:
            if job.state == "finished" or job.cancelled:
                return
            job.cancelled = True
            self.stats["cancelled"] += 1
            if job.state == "queued":
                self.queue = [j for j in self.queue if j is not job]
                heapq.heapify(self.queue)
                job.state = "finished"
            self._broadcast_positions()
            self.cond.notify_all()

    def status(self):
        with self.cond:
            return {
                "event": "pong",
                "state": self.state,
                "pid": os.getpid(),
                "info": self.info,
                "uptime_s": round(time.time() - self.started_at, 1),
                "current": self.current.summary() if self.current else None,
                "queue": [j.summary() for j in self._queued_jobs()],
                "stats": dict(self.stats),
                "preempt": self.preempt_enabled,
            }

    def stop(self):
        with self.cond:
            self.stopping = True
            self.cond.notify_all()
        try:
            self.server and self.server.close()
        except OSError:
            pass

    # -------------------------------------------------------------- main thread
    def load(self):
        with self.cond:
            self.state = "loading"
        try:
            engine = self.engine_factory()
        except Exception as e:  # import errors, missing weights, kernel trouble that has no fallback
            log.exception("separation model failed to load")
            with self.cond:
                self.state = "failed"
                jobs = self._queued_jobs()
                self.queue = []
            for job in jobs:
                job.conn.send({"event": "error", "message": f"separation model failed to load: {e}"[:500],
                               "retryable": True})
                job.conn.close()
            return False
        with self.cond:
            self.engine = engine
            self.info = dict(engine.info)
            self.state = "ready"
            self.cond.notify_all()
        log.info("separation worker ready: %s", self.info)
        return True

    def serve_forever(self):
        while True:
            with self.cond:
                while not self.stopping and not self._queued_jobs():
                    self.cond.wait(1.0)
                if self.stopping:
                    break
                job = heapq.heappop(self.queue)
                if job.cancelled:
                    continue
                job.state = "running"
                job.position = None
                self.current = job
                self._broadcast_positions()
            try:
                self._run(job)
            finally:
                with self.cond:
                    self.current = None
                    self._broadcast_positions()
        self._shutdown_jobs()

    def _shutdown_jobs(self):
        with self.cond:
            jobs = self._queued_jobs()
            self.queue = []
        for job in jobs:
            job.conn.send({"event": "error", "message": "separation worker is shutting down", "retryable": True})
            job.conn.close()

    def _check(self, job, allow_preempt=True):
        if self.stopping:
            raise JobAborted("shutdown")
        if job.cancelled:
            raise JobAborted("cancelled")
        if allow_preempt and job.preempt:
            raise JobAborted("preempted")

    def _run(self, job):
        job.conn.send({"event": "started"})

        def progress(done, total):
            self._check(job)
            job.progress = [int(done), int(total)]
            if not job.conn.send({"event": "progress", "done": int(done), "total": int(total)}):
                self.cancel(job)
                raise JobAborted("cancelled")

        try:
            result = self.engine.run(job.spec, progress, lambda: self._check(job, allow_preempt=False))
        except JobAborted as e:
            if e.reason == "preempted" and not job.cancelled and not self.stopping:
                with self.cond:
                    job.preempt = False
                    job.state = "queued"
                    job.progress = None
                    self.stats["preempted"] += 1
                    heapq.heappush(self.queue, job)  # same seq: back at the head of the batch queue
                job.conn.send({"event": "preempted"})
                return
            job.state = "finished"
            if e.reason == "shutdown":
                job.conn.send({"event": "error", "message": "separation worker is shutting down", "retryable": True})
            job.conn.close()
            return
        except Exception as e:
            log.exception("separation job %s failed", job.id)
            job.state = "finished"
            self.stats["failed"] += 1
            job.conn.send({"event": "error", "message": f"{type(e).__name__}: {e}"[:500], "retryable": False})
            job.conn.close()
            return
        job.state = "finished"
        self.stats["completed"] += 1
        result = dict(result)
        result.update({k: v for k, v in self.info.items() if k not in result})
        log.info("separation job %s (%s) done: %s", job.id, job.spec.get("label", ""), result)
        job.conn.send({"event": "done", "result": result})
        job.conn.close()


def _acquire_singleton(socket_path):
    """Hold an exclusive lock next to the socket for the process lifetime; None if another worker has it."""
    import fcntl

    handle = open(socket_path + ".lock", "a+")  # noqa: SIM115 - kept open for the process lifetime
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def main(argv=None):
    parser = argparse.ArgumentParser(description="MelodAI local separation worker")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--engine", choices=sorted(ENGINES), default="turbo")
    parser.add_argument("--model", default="resurrection")
    parser.add_argument("--precision", choices=["bf16", "fp32"], default="bf16")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--model-dir", default=None)
    parser.add_argument("--nice", type=int, default=10)
    parser.add_argument("--no-preempt", action="store_true")
    parser.add_argument("--heartbeat", type=float, default=5.0)
    parser.add_argument("--parent-pid", type=int, default=None)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s separation-worker %(levelname)s %(message)s")
    lock = _acquire_singleton(args.socket)
    if lock is None:
        log.info("another separation worker already owns %s", args.socket)
        return EXIT_ALREADY_RUNNING
    if args.nice:
        try:
            os.nice(args.nice)
        except OSError:
            pass
    if args.threads:
        os.environ.setdefault("OMP_NUM_THREADS", str(args.threads))

    def factory():
        cls = ENGINES[args.engine]
        return cls(model=args.model, precision=args.precision, threads=args.threads, model_dir=args.model_dir)

    worker = Worker(factory, args.socket, preempt=not args.no_preempt, heartbeat=args.heartbeat,
                    parent_pid=args.parent_pid)

    def on_signal(signum, _frame):
        log.info("signal %s: stopping", signum)
        worker.stop()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    worker.listen()
    try:
        if not worker.load():
            time.sleep(0.2)  # let clients read the error
            return EXIT_LOAD_FAILED
        worker.serve_forever()
    finally:
        worker.stop()
        try:
            os.unlink(args.socket)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
