"""Registry of in-memory cache invalidators owned by the route modules.

POST /api/v1/cache/invalidate has to clear caches that live in several route
modules. Having api.py import its siblings to reach them created a genuine
import cycle, which api.py used to dodge with a function-body import. Each
module now registers its own invalidator at import time instead, so imports
only ever point one way.
"""
from typing import Callable

_invalidators: list[Callable[[], None]] = []


def register_cache_invalidator(fn: Callable[[], None]) -> Callable[[], None]:
    """Register `fn` to run on POST /api/v1/cache/invalidate. Idempotent."""
    if fn not in _invalidators:
        _invalidators.append(fn)
    return fn


def invalidate_registered_caches() -> None:
    """Run every registered invalidator."""
    for fn in _invalidators:
        fn()
