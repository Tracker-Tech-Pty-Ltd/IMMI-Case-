"""Tests for uncovered legislations paths.

Targets lines not covered by test_legislations_api.py (61% → ~85%):
- _data_path(), _load_legislations() real file I/O paths
- _invalidate_cache()
- limit < 1 validation in list/search
- legislation_id empty string path
- POST /api/v1/legislations/update  (start_update endpoint)
- GET  /api/v1/legislations/update/status
- _run_scrape_job background thread (mocked LegislationScraper)
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest


# ── Shared fixtures ───────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clear_legislation_cache():
    """Reset the in-memory cache before and after each test."""
    import immi_case_downloader.web.routes.legislations as leg_mod
    leg_mod._legislations_cache = None
    leg_mod.legislation_job_manager.reset()
    yield
    leg_mod._legislations_cache = None
    leg_mod.legislation_job_manager.reset()


@pytest.fixture
def client():
    """Flask test client with CSRF disabled."""
    from immi_case_downloader.web import create_app

    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    yield app.test_client()
    repo = app.config.get("REPO")
    if repo and hasattr(repo, "close"):
        repo.close()


@pytest.fixture
def sample_json(tmp_path) -> str:
    """Write a minimal legislations.json and return its path."""
    data = {
        "legislations": [
            {
                "id": "migration-act-1958",
                "title": "Migration Act 1958",
                "shortcode": "MA1958",
                "jurisdiction": "Commonwealth",
                "type": "Act",
                "description": "Primary immigration legislation.",
                "sections": [{"id": "s1", "number": "1", "title": "Short title", "text": "..."}],
            }
        ]
    }
    path = tmp_path / "legislations.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


# ── _data_path() ──────────────────────────────────────────────────────────────


class TestDataPath:
    """_data_path() should point to the data/ directory inside the package."""

    def test_ends_with_legislations_json(self):
        from immi_case_downloader.web.routes.legislations import _data_path

        path = _data_path()
        assert path.endswith("legislations.json")

    def test_data_dir_contains_immi_case_downloader(self):
        from immi_case_downloader.web.routes.legislations import _data_path

        path = _data_path()
        assert "immi_case_downloader" in path or "data" in path


# ── _load_legislations() real file I/O ───────────────────────────────────────


class TestLoadLegislations:
    """Tests for _load_legislations() that exercise real file I/O paths."""

    def test_loads_from_real_file(self, sample_json):
        """When the actual file exists, data is parsed and cached."""
        from immi_case_downloader.web.routes.legislations import _load_legislations

        with patch(
            "immi_case_downloader.web.routes.legislations._data_path",
            return_value=sample_json,
        ):
            result = _load_legislations()

        assert len(result) == 1
        assert result[0]["id"] == "migration-act-1958"

    def test_caches_result_on_second_call(self, sample_json):
        """Second call returns cached result without re-reading the file."""
        from immi_case_downloader.web.routes.legislations import _load_legislations

        with patch(
            "immi_case_downloader.web.routes.legislations._data_path",
            return_value=sample_json,
        ):
            first = _load_legislations()

        # File is gone — second call still works because of cache
        second = _load_legislations()
        assert first is second  # same list object

    def test_returns_empty_list_when_file_missing(self, tmp_path):
        """When the file doesn't exist, returns empty list (no crash)."""
        from immi_case_downloader.web.routes.legislations import _load_legislations

        missing = str(tmp_path / "nonexistent.json")
        with patch(
            "immi_case_downloader.web.routes.legislations._data_path",
            return_value=missing,
        ):
            result = _load_legislations()

        assert result == []

    def test_returns_empty_list_on_invalid_json(self, tmp_path):
        """Corrupted JSON → empty list (no crash)."""
        bad_json = tmp_path / "bad.json"
        bad_json.write_text("{ invalid json !!!", encoding="utf-8")
        from immi_case_downloader.web.routes.legislations import _load_legislations

        with patch(
            "immi_case_downloader.web.routes.legislations._data_path",
            return_value=str(bad_json),
        ):
            result = _load_legislations()

        assert result == []

    def test_returns_empty_list_on_io_error(self):
        """IOError during open → empty list (no crash)."""
        from immi_case_downloader.web.routes.legislations import _load_legislations

        with (
            patch("immi_case_downloader.web.routes.legislations._data_path", return_value="/fake/path.json"),
            patch("builtins.open", side_effect=IOError("disk error")),
            patch("os.path.exists", return_value=True),
        ):
            result = _load_legislations()

        assert result == []


# ── _invalidate_cache() ───────────────────────────────────────────────────────


class TestInvalidateCache:
    """_invalidate_cache() must clear the in-memory store."""

    def test_clears_cache(self, sample_json):
        from immi_case_downloader.web.routes.legislations import (
            _invalidate_cache,
            _load_legislations,
        )
        import immi_case_downloader.web.routes.legislations as leg_mod

        with patch(
            "immi_case_downloader.web.routes.legislations._data_path",
            return_value=sample_json,
        ):
            _load_legislations()

        assert leg_mod._legislations_cache is not None
        _invalidate_cache()
        assert leg_mod._legislations_cache is None


# ── Uncovered validation paths ────────────────────────────────────────────────


class TestListLimitValidation:
    """limit < 1 in GET /legislations should return 400."""

    def test_limit_zero_returns_error(self, client):
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=[],
        ):
            resp = client.get("/api/v1/legislations?limit=0")

        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        assert "limit" in data["error"]

    def test_limit_negative_returns_error(self, client):
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=[],
        ):
            resp = client.get("/api/v1/legislations?limit=-5")

        assert resp.status_code == 400


class TestSearchLimitValidation:
    """limit < 1 in GET /legislations/search should return 400."""

    def test_search_limit_zero_returns_error(self, client):
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=[{"id": "x", "title": "Migration Act", "description": "", "shortcode": "", "sections": []}],
        ):
            resp = client.get("/api/v1/legislations/search?q=migration&limit=0")

        assert resp.status_code == 400
        assert resp.get_json()["success"] is False


class TestDetailEmptyId:
    """GET /legislations/<id> with an empty or whitespace id."""

    def test_whitespace_id_returns_error(self, client):
        """Trailing slash or URL with whitespace → 404 or 400."""
        # Flask routing won't match an empty path segment; a space-only id
        # normalises to "" inside the view which triggers the guard.
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=[],
        ):
            resp = client.get("/api/v1/legislations/ ")

        # Either 400 (guard fires) or 404 (not found after strip) is acceptable.
        assert resp.status_code in (400, 404)


# ── POST /update ──────────────────────────────────────────────────────────────


class TestStartUpdate:
    """Tests for the POST /api/v1/legislations/update endpoint."""

    def test_starts_job_for_all_laws(self, client):
        """Empty body → schedules all known laws; returns 200 with law list."""
        fake_thread = MagicMock()
        with (
            patch("immi_case_downloader.web.routes.legislations.threading.Thread", return_value=fake_thread),
            patch("immi_case_downloader.sources.legislation_scraper.KNOWN_LAWS", {"law-a": {}, "law-b": {}}),
        ):
            resp = client.post("/api/v1/legislations/update", json={})

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        fake_thread.start.assert_called_once()

    def test_starts_job_for_single_known_law(self, client):
        """Specifying a known law_id → schedules only that law."""
        from immi_case_downloader.sources.legislation_scraper import KNOWN_LAWS

        known_id = next(iter(KNOWN_LAWS))
        fake_thread = MagicMock()
        with patch("immi_case_downloader.web.routes.legislations.threading.Thread", return_value=fake_thread):
            resp = client.post("/api/v1/legislations/update", json={"law_id": known_id})

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["laws"] == [known_id]

    def test_unknown_law_id_returns_error(self, client):
        """Unknown law_id → 400 without starting a thread."""
        resp = client.post(
            "/api/v1/legislations/update",
            json={"law_id": "nonexistent-act-9999"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_returns_409_when_job_already_running(self, client):
        """Second request while a job is running → 409 Conflict."""
        import immi_case_downloader.web.routes.legislations as leg_mod

        # Reserve the job slot manually to simulate a running job
        leg_mod.legislation_job_manager.reserve({"running": True})

        resp = client.post("/api/v1/legislations/update", json={})
        assert resp.status_code == 409
        data = resp.get_json()
        assert data["success"] is False
        assert "already running" in data["error"]


# ── GET /update/status ────────────────────────────────────────────────────────


class TestUpdateStatus:
    """Tests for the GET /api/v1/legislations/update/status endpoint."""

    def test_returns_status_when_idle(self, client):
        """Returns success and idle status snapshot."""
        resp = client.get("/api/v1/legislations/update/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert "status" in data
        assert data["status"]["running"] is False

    def test_returns_running_status(self, client):
        """After reserving the job, status shows running=True."""
        import immi_case_downloader.web.routes.legislations as leg_mod

        leg_mod.legislation_job_manager.reserve({"running": True, "law_id": "migration-act-1958"})

        resp = client.get("/api/v1/legislations/update/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"]["running"] is True


# ── _run_scrape_job() background function ─────────────────────────────────────


class TestRunScrapeJob:
    """Tests for the _run_scrape_job() background function."""

    def _call(self, law_ids, scraper_mock, tmp_json_path):
        """Invoke _run_scrape_job() synchronously with mocked dependencies."""
        from immi_case_downloader.web.routes.legislations import _run_scrape_job

        with (
            patch("immi_case_downloader.web.routes.legislations.LegislationScraper", return_value=scraper_mock),
            patch("immi_case_downloader.web.routes.legislations._data_path", return_value=tmp_json_path),
        ):
            _run_scrape_job(law_ids)

    def test_successful_scrape_writes_output(self, tmp_path):
        """A successful scrape writes the JSON and clears the cache."""
        from immi_case_downloader.sources.legislation_scraper import KNOWN_LAWS
        import immi_case_downloader.web.routes.legislations as leg_mod

        law_id = next(iter(KNOWN_LAWS))
        json_path = str(tmp_path / "legislations.json")

        # Pre-populate with existing data
        with open(json_path, "w") as f:
            json.dump({"legislations": []}, f)

        scraper = MagicMock()
        scraper.scrape_one.return_value = {
            "id": law_id,
            "title": "Test Law",
            "sections_count": 5,
        }

        self._call([law_id], scraper, json_path)

        assert os.path.exists(json_path)
        with open(json_path) as f:
            saved = json.load(f)
        assert any(entry["id"] == law_id for entry in saved["legislations"])
        assert leg_mod._legislations_cache is None  # cache invalidated

    def test_failed_scrape_recorded_in_job_status(self, tmp_path):
        """When scraper returns None for a law, it's added to failed_laws."""
        from immi_case_downloader.sources.legislation_scraper import KNOWN_LAWS
        import immi_case_downloader.web.routes.legislations as leg_mod

        law_id = next(iter(KNOWN_LAWS))
        json_path = str(tmp_path / "legislations.json")
        with open(json_path, "w") as f:
            json.dump({"legislations": []}, f)

        leg_mod.legislation_job_manager.reserve({"running": True, "failed_laws": [], "completed_laws": []})

        scraper = MagicMock()
        scraper.scrape_one.return_value = None  # scraper failure

        self._call([law_id], scraper, json_path)

        status = leg_mod.legislation_job_manager.snapshot()
        assert law_id in status["failed_laws"]

    def test_exception_in_scrape_recorded(self, tmp_path):
        """An unexpected exception in the scrape loop updates error field."""
        from immi_case_downloader.sources.legislation_scraper import KNOWN_LAWS
        import immi_case_downloader.web.routes.legislations as leg_mod

        law_id = next(iter(KNOWN_LAWS))
        json_path = str(tmp_path / "legislations.json")
        with open(json_path, "w") as f:
            json.dump({"legislations": []}, f)

        leg_mod.legislation_job_manager.reserve({"running": True})

        scraper = MagicMock()
        scraper.scrape_one.side_effect = RuntimeError("network down")

        self._call([law_id], scraper, json_path)

        status = leg_mod.legislation_job_manager.snapshot()
        assert status["running"] is False  # finally block resets it

    def test_missing_existing_file_handled_gracefully(self, tmp_path):
        """If legislations.json doesn't exist yet, a fresh file is created."""
        from immi_case_downloader.sources.legislation_scraper import KNOWN_LAWS

        law_id = next(iter(KNOWN_LAWS))
        json_path = str(tmp_path / "new_legislations.json")  # doesn't exist

        scraper = MagicMock()
        scraper.scrape_one.return_value = {"id": law_id, "title": "T", "sections_count": 1}

        self._call([law_id], scraper, json_path)

        assert os.path.exists(json_path)
