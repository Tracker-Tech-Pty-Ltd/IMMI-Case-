"""In-memory cache with TTL for analytics and stats payloads.

Thread-safe OrderedDict+lock pattern extracted into a reusable class so
analytics endpoints share a single consistent caching strategy.
"""

import threading
import time
from collections import OrderedDict

# Cap on distinct cached analytics payloads.  Each entry is a full aggregate
# response, so an unbounded map is a slow memory leak under varied query
# strings.  Mirrors the MAX_ANCHOR_SIGNATURES policy in cases_pagination.py.
DEFAULT_MAX_ENTRIES = 256


class AnalyticsCache:
    """TTL- and size-bounded in-memory cache for pre-computed analytics payloads.

    Each entry is a ``(payload, timestamp)`` tuple.  Both reads and writes take
    the lock: a read evicts the entry when it has expired, and refreshes its
    LRU position when it has not.
    """

    def __init__(self, ttl: float = 300.0, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        self._ttl = ttl
        self._max_entries = max_entries
        self._store: OrderedDict[str, tuple[dict, float]] = OrderedDict()
        self._lock = threading.Lock()

    def _prune_locked(self, now: float) -> None:
        """Drop expired entries, then evict least-recently-used down to capacity."""
        expired = [key for key, (_, ts) in self._store.items() if (now - ts) >= self._ttl]
        for key in expired:
            self._store.pop(key, None)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)

    def get(self, key: str) -> dict | None:
        """Return cached payload if still fresh, else ``None`` (evicting if stale)."""
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            payload, ts = entry
            if (now - ts) >= self._ttl:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return payload

    def set(self, key: str, payload: dict) -> None:
        """Store *payload* under *key* with the current timestamp."""
        now = time.time()
        with self._lock:
            self._store[key] = (payload, now)
            self._store.move_to_end(key)
            self._prune_locked(now)

    def invalidate(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()
