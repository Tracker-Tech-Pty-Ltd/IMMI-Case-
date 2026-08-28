"""Tests for TTL cache in storage.load_all_cases."""

import time

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import (
    ensure_output_dirs,
    save_cases_csv,
    load_all_cases,
    invalidate_cases_cache,
    _cases_cache,
    _cases_cache_lock,
    _CACHE_TTL,
)
from immi_case_downloader.web.cache import AnalyticsCache, DEFAULT_MAX_ENTRIES


class TestCasesCacheTTL:
    def test_cache_returns_same_data(self, tmp_path):
        """Second call returns cached data without re-reading CSV."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="[2024] TEST 1", url="https://example.com/1", court_code="AATA")
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        result1 = load_all_cases(str(tmp_path))
        result2 = load_all_cases(str(tmp_path))
        assert len(result1) == len(result2) == 1
        assert result1[0].citation == result2[0].citation

    def test_cache_returns_copy(self, tmp_path):
        """Modifying returned list does not affect cache."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="[2024] TEST 2", url="https://example.com/2", court_code="AATA")
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        result1 = load_all_cases(str(tmp_path))
        result1.clear()  # mutate
        result2 = load_all_cases(str(tmp_path))
        assert len(result2) == 1  # cache unaffected

    def test_invalidate_clears_cache(self, tmp_path):
        """invalidate_cases_cache() forces re-read on next call."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="[2024] TEST 3", url="https://example.com/3", court_code="AATA")
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        load_all_cases(str(tmp_path))  # populate cache
        with _cases_cache_lock:
            assert _cases_cache["cases"] is not None

        invalidate_cases_cache()
        with _cases_cache_lock:
            assert _cases_cache["cases"] is None

    def test_save_invalidates_cache(self, tmp_path):
        """save_cases_csv() automatically invalidates cache."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="[2024] TEST 4", url="https://example.com/4", court_code="AATA")
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))

        load_all_cases(str(tmp_path))  # populate cache
        with _cases_cache_lock:
            assert _cases_cache["cases"] is not None

        # Add another case
        case2 = ImmigrationCase(citation="[2024] TEST 5", url="https://example.com/5", court_code="FCA")
        case2.ensure_id()
        save_cases_csv([case, case2], str(tmp_path))

        # Cache should have been invalidated by save
        result = load_all_cases(str(tmp_path))
        assert len(result) == 2

    def test_different_base_dir_not_cached(self, tmp_path):
        """Different base_dir triggers fresh load."""
        dir1 = tmp_path / "dir1"
        dir2 = tmp_path / "dir2"
        ensure_output_dirs(str(dir1))
        ensure_output_dirs(str(dir2))

        case1 = ImmigrationCase(citation="[2024] A 1", url="https://a.com/1", court_code="AATA")
        case1.ensure_id()
        save_cases_csv([case1], str(dir1))

        case2 = ImmigrationCase(citation="[2024] B 1", url="https://b.com/1", court_code="FCA")
        case2.ensure_id()
        save_cases_csv([case2], str(dir2))

        result1 = load_all_cases(str(dir1))
        result2 = load_all_cases(str(dir2))
        assert result1[0].court_code == "AATA"
        assert result2[0].court_code == "FCA"

    def test_cache_ttl_is_positive(self):
        """Cache TTL should be a positive number."""
        assert _CACHE_TTL > 0


class TestAnalyticsCacheBounds:
    """AnalyticsCache (immi_case_downloader/web/cache.py) — TTL eviction,
    capacity bound, and LRU order (PYCORR-13)."""

    def test_fresh_entry_is_returned(self):
        cache = AnalyticsCache(ttl=300.0)
        cache.set("k", {"v": 1})
        assert cache.get("k") == {"v": 1}

    def test_expired_entry_is_evicted_on_read(self):
        cache = AnalyticsCache(ttl=0.01)
        cache.set("k", {"v": 1})
        time.sleep(0.03)
        assert cache.get("k") is None
        assert "k" not in cache._store

    def test_capacity_is_bounded(self):
        cache = AnalyticsCache(ttl=300.0, max_entries=3)
        for i in range(50):
            cache.set(f"k{i}", {"v": i})
        assert len(cache._store) == 3

    def test_least_recently_used_is_evicted_first(self):
        cache = AnalyticsCache(ttl=300.0, max_entries=2)
        cache.set("a", {"v": "a"})
        cache.set("b", {"v": "b"})
        cache.get("a")  # touch "a" so "b" becomes the LRU entry
        cache.set("c", {"v": "c"})
        assert cache.get("b") is None
        assert cache.get("a") == {"v": "a"}

    def test_default_max_entries_is_positive(self):
        assert DEFAULT_MAX_ENTRIES > 0
