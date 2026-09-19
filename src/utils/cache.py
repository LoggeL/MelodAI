"""Bounded, thread-safe TTL storage for repeatable external reads."""

import threading
import time
from collections import OrderedDict


class TTLCache:
    def __init__(self, max_entries=500, ttl=300):
        self.max_entries = max_entries
        self.ttl = ttl
        self._entries = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            created, value = entry
            if time.monotonic() - created >= self.ttl:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return value

    def set(self, key, value):
        with self._lock:
            self._entries[key] = (time.monotonic(), value)
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
