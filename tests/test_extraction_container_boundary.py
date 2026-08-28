"""Ensure the extraction Container cannot become a database runtime."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_extraction_image_and_source_have_no_database_runtime_markers() -> None:
    source = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in ("Dockerfile", "extract_container.py", "requirements-extractor.txt")
    ).lower()
    for marker in ("supabase", "postgres", "hyperdrive", "database_url", "service_role"):
        assert marker not in source, marker


def test_extraction_service_has_no_durable_storage_binding() -> None:
    source = (ROOT / "extract_container.py").read_text(encoding="utf-8")
    # The shared-secret/token check itself now lives in the single
    # implementation both Flask adapters call — see
    # immi_case_downloader/extraction/service.py — but this container entry
    # point must still visibly delegate to it.
    service_source = (ROOT / "immi_case_downloader/extraction/service.py").read_text(
        encoding="utf-8"
    )
    assert "service.authorize" in source
    assert "X-Extraction-Token" in service_source
    assert "EXTRACTION_SHARED_SECRET" in service_source
    assert "R2Bucket" not in source
    assert "D1Database" not in source


def test_container_bridge_has_no_legacy_storage_terms() -> None:
    source = (ROOT / "workers/extraction-container.js").read_text(encoding="utf-8").lower()
    for marker in ("supabase", "postgres", "hyperdrive", "d1", "r2"):
        assert marker not in source, marker
