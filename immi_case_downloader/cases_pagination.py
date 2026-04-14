"""Internal pagination planning for the `/api/v1/cases` endpoint.

This module keeps the public API page-number contract intact while allowing
the backend to use seek pagination when the query shape is compatible.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any


SEEK_SORT_FIELDS = frozenset({"date", "year"})
ANCHOR_INTERVAL_PAGES = 10
ANCHOR_TTL_SECONDS = 300
MAX_ANCHOR_SIGNATURES = 128
HEAD_SEEK_MAX_PAGE = 3
TAIL_SEEK_WINDOW_PAGES = 2


@dataclass(frozen=True)
class SeekAnchor:
    """Stable seek cursor for `/api/v1/cases`."""

    year: int
    case_id: str


@dataclass(frozen=True)
class CaseListQuery:
    """Normalized query fields relevant to pagination strategy."""

    court: str = ""
    year: int | None = None
    visa_type: str = ""
    source: str = ""
    tag: str = ""
    nature: str = ""
    keyword: str = ""
    sort_by: str = "date"
    sort_dir: str = "desc"

    def canonical_payload(self) -> dict[str, Any]:
        """Return a stable JSON payload for cache key generation."""
        return {
            "court": self.court or "",
            "year": self.year,
            "visa_type": self.visa_type or "",
            "source": self.source or "",
            "tag": self.tag or "",
            "nature": self.nature or "",
            "keyword": self.keyword or "",
            "sort_by": self.sort_by or "date",
            "sort_dir": self.sort_dir or "desc",
        }

    def signature_hash(self) -> str:
        payload = json.dumps(self.canonical_payload(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class PaginationPlan:
    """Concrete execution plan for a target page."""

    strategy: str
    fallback_reason: str | None = None
    anchor: SeekAnchor | None = None
    anchor_page: int = 0


def can_seek_cases_query(query: CaseListQuery) -> bool:
    """Return True when the query can use seek pagination safely."""
    return query.sort_by in SEEK_SORT_FIELDS and not query.keyword


def backend_kind_for_repo(repo: Any) -> str:
    """Return a stable backend kind for cache partitioning."""
    explicit = getattr(repo, "pagination_backend_kind", None)
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    return type(repo).__name__.strip().lower()


def anchor_from_case(case: Any) -> SeekAnchor:
    """Extract the stable seek cursor from a case-like object."""
    return SeekAnchor(
        year=int(getattr(case, "year", 0) or 0),
        case_id=str(getattr(case, "case_id", "") or ""),
    )


@dataclass
class _AnchorBucket:
    anchors: dict[int, SeekAnchor]
    last_seen_at: float


class _AnchorCache:
    """Short-lived query anchor cache with TTL + LRU eviction."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: OrderedDict[str, _AnchorBucket] = OrderedDict()

    def _cache_key(self, backend_kind: str, query: CaseListQuery) -> str:
        return f"{backend_kind}:{query.signature_hash()}:{query.sort_dir}"

    def _prune_locked(self, now: float) -> None:
        expired = [
            key
            for key, bucket in self._entries.items()
            if now - bucket.last_seen_at > ANCHOR_TTL_SECONDS
        ]
        for key in expired:
            self._entries.pop(key, None)

        while len(self._entries) > MAX_ANCHOR_SIGNATURES:
            self._entries.popitem(last=False)

    def get_nearest_anchor(
        self,
        *,
        backend_kind: str,
        query: CaseListQuery,
        target_page: int,
    ) -> tuple[int, SeekAnchor] | None:
        if target_page < 1:
            return None

        now = time.time()
        key = self._cache_key(backend_kind, query)
        with self._lock:
            self._prune_locked(now)
            bucket = self._entries.get(key)
            if not bucket:
                return None

            candidates = [
                (page, anchor)
                for page, anchor in bucket.anchors.items()
                if page <= target_page
            ]
            if not candidates:
                return None

            page, anchor = max(candidates, key=lambda item: item[0])
            bucket.last_seen_at = now
            self._entries.move_to_end(key)
            return page, anchor

    def store_anchor(
        self,
        *,
        backend_kind: str,
        query: CaseListQuery,
        page: int,
        anchor: SeekAnchor,
    ) -> None:
        if page < 1 or page % ANCHOR_INTERVAL_PAGES != 0 or not anchor.case_id:
            return

        now = time.time()
        key = self._cache_key(backend_kind, query)
        with self._lock:
            self._prune_locked(now)
            bucket = self._entries.get(key)
            if bucket is None:
                bucket = _AnchorBucket(anchors={}, last_seen_at=now)
                self._entries[key] = bucket

            bucket.anchors[page] = anchor
            bucket.last_seen_at = now
            self._entries.move_to_end(key)
            self._prune_locked(now)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


_ANCHOR_CACHE = _AnchorCache()


def clear_cases_anchor_cache() -> None:
    """Test helper to reset in-memory anchor state."""
    _ANCHOR_CACHE.clear()


def choose_pagination_plan(
    *,
    repo: Any,
    query: CaseListQuery,
    page: int,
    total_pages: int,
) -> PaginationPlan:
    """Choose the most suitable pagination strategy for this request."""
    supports_seek = bool(
        getattr(repo, "supports_seek_pagination", False)
        and hasattr(repo, "list_cases_seek")
    )

    if not supports_seek:
        return PaginationPlan("offset_fallback", fallback_reason="repo_not_seek_capable")

    if not can_seek_cases_query(query):
        if query.keyword:
            return PaginationPlan("offset_fallback", fallback_reason="keyword_present")
        return PaginationPlan("offset_fallback", fallback_reason="sort_not_seek_supported")

    if page <= 1:
        return PaginationPlan("seek_forward")

    if total_pages > 0 and page > total_pages:
        return PaginationPlan("offset_fallback", fallback_reason="page_out_of_range")

    if total_pages > 0 and page >= max(1, total_pages - TAIL_SEEK_WINDOW_PAGES):
        return PaginationPlan("seek_reverse")

    backend_kind = backend_kind_for_repo(repo)
    anchor_hit = _ANCHOR_CACHE.get_nearest_anchor(
        backend_kind=backend_kind,
        query=query,
        target_page=page - 1,
    )
    if anchor_hit is not None:
        anchor_page, anchor = anchor_hit
        return PaginationPlan(
            "seek_forward",
            anchor=anchor,
            anchor_page=anchor_page,
        )

    if page <= HEAD_SEEK_MAX_PAGE:
        return PaginationPlan("seek_forward")

    return PaginationPlan(
        "offset_fallback",
        fallback_reason="deep_page_without_anchor",
    )


def remember_page_anchor(
    *,
    repo: Any,
    query: CaseListQuery,
    page: int,
    page_cases: list[Any],
) -> None:
    """Store an anchor after a successful seek page fetch."""
    if not page_cases:
        return

    _ANCHOR_CACHE.store_anchor(
        backend_kind=backend_kind_for_repo(repo),
        query=query,
        page=page,
        anchor=anchor_from_case(page_cases[-1]),
    )
