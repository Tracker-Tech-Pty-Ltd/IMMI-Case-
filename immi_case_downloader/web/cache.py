"""In-memory cache with TTL for analytics and stats payloads.

Thread-safe dict+lock pattern extracted into a reusable class so
analytics endpoints share a single consistent caching strategy.
"""

import threading
import time


class AnalyticsCache:
    """TTL-based in-memory cache for pre-computed analytics payloads.

    Each entry is a ``(payload, timestamp)`` tuple. Reads are lock-free
    (dict lookup is atomic in CPython); writes acquire a lock to prevent
    lost updates under concurrent requests.
    """

    def __init__(self, ttl: float = 300.0) -> None:
        self._ttl = ttl
        self._store: dict[str, tuple[dict, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> dict | None:
        """Return cached payload if still fresh, else ``None``."""
        entry = self._store.get(key)
        if entry and (time.time() - entry[1]) < self._ttl:
            return entry[0]
        return None

    def set(self, key: str, payload: dict) -> None:
        """Store *payload* under *key* with the current timestamp."""
        with self._lock:
            self._store[key] = (payload, time.time())

    def invalidate(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()
