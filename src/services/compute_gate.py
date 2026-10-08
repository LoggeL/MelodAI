"""Cross-process CPU gate for the heavy local workers (separation, transcription).

Both workers saturate the same 8 cores, and running them side by side only makes each job slower. A worker holds
the gate (an exclusive ``flock`` on ``<dir>/melodai-compute.lock``) while a job computes. A worker whose next job
is *interactive* advertises that it is waiting (a shared lock on ``<lock>.interactive``). The worker that holds the
gate then preempts its running *batch* job at the next chunk boundary, and batch jobs do not take the gate while
someone interactive is waiting.

flock locks belong to the open file description and disappear with the process, so a crashed or killed worker can
never leave the gate locked.
"""

from __future__ import annotations

import fcntl
import os


class ComputeGate:
    def __init__(self, path: str):
        self.path = path
        self.wait_path = path + ".interactive"
        self._held = None
        self._waiting = None

    def _open(self, path):
        return open(path, "a+")  # noqa: SIM115 - the handle is the lock and lives until release

    def try_acquire(self) -> bool:
        if self._held is not None:
            return True
        handle = self._open(self.path)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self._held = handle
        return True

    def release(self):
        handle, self._held = self._held, None
        if handle is not None:
            handle.close()

    @property
    def held(self) -> bool:
        return self._held is not None

    def mark_waiting(self):
        if self._waiting is None:
            handle = self._open(self.wait_path)
            fcntl.flock(handle, fcntl.LOCK_SH)
            self._waiting = handle

    def unmark_waiting(self):
        handle, self._waiting = self._waiting, None
        if handle is not None:
            handle.close()

    def interactive_waiting(self) -> bool:
        """True while another worker waits for the gate on behalf of an interactive job."""
        handle = self._open(self.wait_path)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return True
        finally:
            handle.close()
        return False


def default_path(socket_path: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(socket_path)), "melodai-compute.lock")
