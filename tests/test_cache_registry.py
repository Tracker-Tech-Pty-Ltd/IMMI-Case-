"""POST /api/v1/cache/invalidate reaches every route module's cache."""
from immi_case_downloader.web.cache_registry import (
    invalidate_registered_caches,
    register_cache_invalidator,
)


def test_registered_invalidator_is_called():
    calls = []
    register_cache_invalidator(lambda: calls.append(1))
    invalidate_registered_caches()
    assert calls == [1]


def test_taxonomy_lineage_cache_is_registered():
    from immi_case_downloader.web.routes import api_taxonomy

    api_taxonomy._lineage_cache_payload = {"lineages": []}
    api_taxonomy._lineage_cache_ts = 12345.0
    invalidate_registered_caches()
    assert api_taxonomy._lineage_cache_payload is None
    assert api_taxonomy._lineage_cache_ts == 0.0
