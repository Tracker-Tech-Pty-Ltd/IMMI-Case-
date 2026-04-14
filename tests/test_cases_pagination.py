"""Unit tests for immi_case_downloader/cases_pagination.py.

Covers: CaseListQuery, AnchorCache (TTL/LRU), choose_pagination_plan (all
branches), remember_page_anchor, backend_kind_for_repo, anchor_from_case.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from immi_case_downloader.cases_pagination import (
    ANCHOR_INTERVAL_PAGES,
    HEAD_SEEK_MAX_PAGE,
    MAX_ANCHOR_SIGNATURES,
    TAIL_SEEK_WINDOW_PAGES,
    CaseListQuery,
    PaginationPlan,
    SeekAnchor,
    _ANCHOR_CACHE,
    anchor_from_case,
    backend_kind_for_repo,
    can_seek_cases_query,
    choose_pagination_plan,
    clear_cases_anchor_cache,
    remember_page_anchor,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _seek_repo(**extra):
    """Minimal repo that supports seek pagination."""
    attrs = {"supports_seek_pagination": True, "list_cases_seek": lambda **_: []}
    attrs.update(extra)
    return SimpleNamespace(**attrs)


def _no_seek_repo():
    """Repo that does NOT support seek pagination."""
    return SimpleNamespace()


def _query(**kw) -> CaseListQuery:
    defaults = {"sort_by": "date", "sort_dir": "desc"}
    defaults.update(kw)
    return CaseListQuery(**defaults)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def reset_anchor_cache():
    """Isolate every test from anchor state left by prior tests."""
    clear_cases_anchor_cache()
    yield
    clear_cases_anchor_cache()


# ── CaseListQuery ─────────────────────────────────────────────────────────────

class TestCaseListQuery:
    def test_canonical_payload_is_stable(self):
        q = _query(court="AATA", year=2022, sort_by="year", sort_dir="asc")
        payload = q.canonical_payload()
        assert payload["court"] == "AATA"
        assert payload["year"] == 2022
        assert payload["sort_by"] == "year"
        assert payload["sort_dir"] == "asc"

    def test_canonical_payload_defaults(self):
        q = CaseListQuery()
        payload = q.canonical_payload()
        assert payload["court"] == ""
        assert payload["year"] is None
        assert payload["keyword"] == ""

    def test_signature_hash_is_16_hex_chars(self):
        q = _query(court="FCA")
        h = q.signature_hash()
        assert len(h) == 16
        assert all(c in "0123456789abcdef" for c in h)

    def test_signature_hash_differs_for_different_queries(self):
        q1 = _query(court="FCA")
        q2 = _query(court="AATA")
        assert q1.signature_hash() != q2.signature_hash()

    def test_signature_hash_stable_across_calls(self):
        q = _query(court="HCA", year=2020)
        assert q.signature_hash() == q.signature_hash()


# ── can_seek_cases_query ──────────────────────────────────────────────────────

class TestCanSeekCasesQuery:
    def test_date_sort_no_keyword_returns_true(self):
        assert can_seek_cases_query(_query(sort_by="date")) is True

    def test_year_sort_no_keyword_returns_true(self):
        assert can_seek_cases_query(_query(sort_by="year")) is True

    def test_title_sort_returns_false(self):
        assert can_seek_cases_query(_query(sort_by="title")) is False

    def test_keyword_present_returns_false(self):
        assert can_seek_cases_query(_query(sort_by="date", keyword="minister")) is False


# ── backend_kind_for_repo ─────────────────────────────────────────────────────

class TestBackendKindForRepo:
    def test_uses_explicit_attribute_when_set(self):
        repo = SimpleNamespace(pagination_backend_kind="supabase")
        assert backend_kind_for_repo(repo) == "supabase"

    def test_falls_back_to_class_name(self):
        class MyCustomRepo:
            pass
        assert backend_kind_for_repo(MyCustomRepo()) == "mycustomrepo"

    def test_strips_whitespace_from_explicit(self):
        repo = SimpleNamespace(pagination_backend_kind="  sqlite  ")
        assert backend_kind_for_repo(repo) == "sqlite"

    def test_ignores_blank_explicit_attribute(self):
        repo = SimpleNamespace(pagination_backend_kind="  ")
        assert backend_kind_for_repo(repo) == "simplenamespace"


# ── anchor_from_case ──────────────────────────────────────────────────────────

class TestAnchorFromCase:
    def test_extracts_year_and_case_id(self):
        case = SimpleNamespace(year=2023, case_id="abc123def456")
        anchor = anchor_from_case(case)
        assert anchor.year == 2023
        assert anchor.case_id == "abc123def456"

    def test_handles_missing_attributes_gracefully(self):
        case = SimpleNamespace()
        anchor = anchor_from_case(case)
        assert anchor.year == 0
        assert anchor.case_id == ""

    def test_converts_string_year_to_int(self):
        case = SimpleNamespace(year="2021", case_id="xyz")
        anchor = anchor_from_case(case)
        assert anchor.year == 2021


# ── _AnchorCache (via choose_pagination_plan / remember_page_anchor) ──────────

class TestAnchorCache:
    def test_store_and_retrieve_anchor(self):
        q = _query(sort_by="year")
        anchor = SeekAnchor(year=2022, case_id="abc123def456")
        _ANCHOR_CACHE.store_anchor(
            backend_kind="test",
            query=q,
            page=ANCHOR_INTERVAL_PAGES,
            anchor=anchor,
        )
        hit = _ANCHOR_CACHE.get_nearest_anchor(
            backend_kind="test",
            query=q,
            target_page=ANCHOR_INTERVAL_PAGES,
        )
        assert hit is not None
        page, retrieved = hit
        assert page == ANCHOR_INTERVAL_PAGES
        assert retrieved == anchor

    def test_no_anchor_returns_none(self):
        q = _query(sort_by="year")
        hit = _ANCHOR_CACHE.get_nearest_anchor(
            backend_kind="test",
            query=q,
            target_page=5,
        )
        assert hit is None

    def test_store_skips_non_multiple_pages(self):
        q = _query()
        anchor = SeekAnchor(year=2020, case_id="abc123def456")
        _ANCHOR_CACHE.store_anchor(backend_kind="t", query=q, page=7, anchor=anchor)
        assert _ANCHOR_CACHE.get_nearest_anchor(backend_kind="t", query=q, target_page=7) is None

    def test_store_skips_empty_case_id(self):
        q = _query()
        anchor = SeekAnchor(year=2020, case_id="")
        _ANCHOR_CACHE.store_anchor(
            backend_kind="t", query=q, page=ANCHOR_INTERVAL_PAGES, anchor=anchor
        )
        assert (
            _ANCHOR_CACHE.get_nearest_anchor(
                backend_kind="t", query=q, target_page=ANCHOR_INTERVAL_PAGES
            )
            is None
        )

    def test_nearest_anchor_picks_closest_below_target(self):
        q = _query(sort_by="year")
        a1 = SeekAnchor(year=2020, case_id="aaa123456789")
        a2 = SeekAnchor(year=2019, case_id="bbb123456789")
        _ANCHOR_CACHE.store_anchor(backend_kind="t", query=q, page=10, anchor=a1)
        _ANCHOR_CACHE.store_anchor(backend_kind="t", query=q, page=20, anchor=a2)
        hit = _ANCHOR_CACHE.get_nearest_anchor(backend_kind="t", query=q, target_page=15)
        assert hit is not None
        page, anchor = hit
        assert page == 10
        assert anchor == a1

    def test_lru_eviction_when_over_max(self):
        """Inserting MAX+1 distinct signatures evicts the oldest."""
        anchor = SeekAnchor(year=2000, case_id="abc123def456")
        # Fill to MAX with unique court values (unique signatures)
        first_key: CaseListQuery = CaseListQuery()
        for i in range(MAX_ANCHOR_SIGNATURES + 1):
            q = CaseListQuery(sort_by="year", sort_dir="desc", court=f"COURT{i:04d}")
            if i == 0:
                first_key = q
            _ANCHOR_CACHE.store_anchor(
                backend_kind="t", query=q, page=ANCHOR_INTERVAL_PAGES, anchor=anchor
            )
        # The very first entry should have been evicted
        assert (
            _ANCHOR_CACHE.get_nearest_anchor(
                backend_kind="t",
                query=first_key,
                target_page=ANCHOR_INTERVAL_PAGES,
            )
            is None
        )

    def test_ttl_expiry(self):
        q = _query(sort_by="year")
        anchor = SeekAnchor(year=2022, case_id="abc123def456")
        with patch(
            "immi_case_downloader.cases_pagination.time.time",
            side_effect=[0.0, 9999.0],
        ):
            _ANCHOR_CACHE.store_anchor(
                backend_kind="t", query=q, page=ANCHOR_INTERVAL_PAGES, anchor=anchor
            )
            # Immediately expired
            hit = _ANCHOR_CACHE.get_nearest_anchor(
                backend_kind="t", query=q, target_page=ANCHOR_INTERVAL_PAGES
            )
        assert hit is None


# ── choose_pagination_plan ────────────────────────────────────────────────────

class TestChoosePaginationPlan:
    def _plan(self, repo, query=None, page=1, total_pages=10) -> PaginationPlan:
        return choose_pagination_plan(
            repo=repo,
            query=query or _query(),
            page=page,
            total_pages=total_pages,
        )

    def test_repo_not_seek_capable_returns_offset(self):
        plan = self._plan(_no_seek_repo())
        assert plan.strategy == "offset_fallback"
        assert plan.fallback_reason == "repo_not_seek_capable"

    def test_repo_missing_list_cases_seek_returns_offset(self):
        repo = SimpleNamespace(supports_seek_pagination=True)  # no list_cases_seek
        plan = self._plan(repo)
        assert plan.strategy == "offset_fallback"

    def test_keyword_query_returns_offset(self):
        repo = _seek_repo()
        plan = self._plan(repo, query=_query(sort_by="date", keyword="visa"))
        assert plan.strategy == "offset_fallback"
        assert plan.fallback_reason == "keyword_present"

    def test_unsupported_sort_returns_offset(self):
        repo = _seek_repo()
        plan = self._plan(repo, query=_query(sort_by="court"))
        assert plan.strategy == "offset_fallback"
        assert plan.fallback_reason == "sort_not_seek_supported"

    def test_page_1_returns_seek_forward(self):
        plan = self._plan(_seek_repo(), query=_query(sort_by="year"), page=1)
        assert plan.strategy == "seek_forward"
        assert plan.anchor is None

    def test_page_beyond_total_returns_offset(self):
        plan = self._plan(_seek_repo(), query=_query(sort_by="year"), page=20, total_pages=10)
        assert plan.strategy == "offset_fallback"
        assert plan.fallback_reason == "page_out_of_range"

    @pytest.mark.parametrize("offset", range(TAIL_SEEK_WINDOW_PAGES + 1))
    def test_tail_pages_return_seek_reverse(self, offset):
        total = 20
        page = total - offset
        plan = self._plan(_seek_repo(), query=_query(sort_by="year"), page=page, total_pages=total)
        assert plan.strategy == "seek_reverse"

    def test_head_seek_for_pages_up_to_max(self):
        repo = _seek_repo()
        for p in range(2, HEAD_SEEK_MAX_PAGE + 1):
            plan = self._plan(repo, query=_query(sort_by="date"), page=p, total_pages=100)
            assert plan.strategy == "seek_forward", f"page={p} should be seek_forward"
            assert plan.anchor is None

    def test_deep_page_without_anchor_returns_offset(self):
        page = HEAD_SEEK_MAX_PAGE + 1
        plan = self._plan(_seek_repo(), query=_query(sort_by="year"), page=page, total_pages=100)
        assert plan.strategy == "offset_fallback"
        assert plan.fallback_reason == "deep_page_without_anchor"

    def test_anchor_hit_returns_seek_forward_with_anchor(self):
        q = _query(sort_by="year")
        repo = _seek_repo(pagination_backend_kind="test")
        anchor = SeekAnchor(year=2022, case_id="abc123def456")
        target_page = 15
        _ANCHOR_CACHE.store_anchor(
            backend_kind="test",
            query=q,
            page=ANCHOR_INTERVAL_PAGES,
            anchor=anchor,
        )
        plan = choose_pagination_plan(
            repo=repo, query=q, page=target_page, total_pages=100
        )
        assert plan.strategy == "seek_forward"
        assert plan.anchor == anchor
        assert plan.anchor_page == ANCHOR_INTERVAL_PAGES


# ── remember_page_anchor ──────────────────────────────────────────────────────

class TestRememberPageAnchor:
    def test_stores_anchor_at_interval_multiple(self):
        repo = _seek_repo(pagination_backend_kind="test")
        q = _query(sort_by="year")
        case = SimpleNamespace(year=2023, case_id="abc123def456")
        remember_page_anchor(
            repo=repo, query=q, page=ANCHOR_INTERVAL_PAGES, page_cases=[case]
        )
        hit = _ANCHOR_CACHE.get_nearest_anchor(
            backend_kind="test", query=q, target_page=ANCHOR_INTERVAL_PAGES
        )
        assert hit is not None
        _, anchor = hit
        assert anchor.year == 2023
        assert anchor.case_id == "abc123def456"

    def test_no_op_on_empty_page_cases(self):
        repo = _seek_repo(pagination_backend_kind="test")
        q = _query(sort_by="year")
        remember_page_anchor(
            repo=repo, query=q, page=ANCHOR_INTERVAL_PAGES, page_cases=[]
        )
        assert (
            _ANCHOR_CACHE.get_nearest_anchor(
                backend_kind="test", query=q, target_page=ANCHOR_INTERVAL_PAGES
            )
            is None
        )

    def test_no_op_for_non_interval_page(self):
        repo = _seek_repo(pagination_backend_kind="test")
        q = _query(sort_by="year")
        case = SimpleNamespace(year=2023, case_id="abc123def456")
        non_interval = ANCHOR_INTERVAL_PAGES + 1
        remember_page_anchor(
            repo=repo, query=q, page=non_interval, page_cases=[case]
        )
        assert (
            _ANCHOR_CACHE.get_nearest_anchor(
                backend_kind="test", query=q, target_page=non_interval
            )
            is None
        )

    def test_uses_last_case_as_anchor(self):
        repo = _seek_repo(pagination_backend_kind="test")
        q = _query(sort_by="year")
        cases = [
            SimpleNamespace(year=2022, case_id="first234567"),
            SimpleNamespace(year=2021, case_id="last5678901"),
        ]
        remember_page_anchor(
            repo=repo, query=q, page=ANCHOR_INTERVAL_PAGES, page_cases=cases
        )
        hit = _ANCHOR_CACHE.get_nearest_anchor(
            backend_kind="test", query=q, target_page=ANCHOR_INTERVAL_PAGES
        )
        assert hit is not None
        _, anchor = hit
        assert anchor.case_id == "last5678901"
        assert anchor.year == 2021
