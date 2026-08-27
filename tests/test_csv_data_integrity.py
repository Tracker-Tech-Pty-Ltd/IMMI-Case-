"""Regression tests for plan 027: CSV/SQLite data-integrity bugs.

Each test proves a specific bug identified in
plans/027-fix-csv-data-integrity.md is real, then (once the corresponding
fix lands) proves it stays fixed. The tests added in Step 1 must fail
against the pre-fix code — that is how the plan proves the bugs exist
before "fixing" them.

Every test uses tmp_path. No test may read or write anything under
downloaded_cases/.
"""

import sqlite3
from unittest.mock import patch

import pytest

from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.pipeline import PipelineConfig, SmartPipeline
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import (
    ensure_output_dirs,
    invalidate_cases_cache,
    load_all_cases,
    save_cases_csv,
)


# ── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def repo(tmp_path):
    """A CsvRepository rooted at a fresh temp directory."""
    return CsvRepository(str(tmp_path))


@pytest.fixture
def sqlite_repo(tmp_path):
    """A fresh SqliteRepository in a temp directory."""
    r = SqliteRepository(str(tmp_path / "t.db"))
    yield r
    r.close()


def _case(**overrides) -> ImmigrationCase:
    defaults = dict(
        citation="[2024] AATA 1",
        title="Test Case",
        court_code="AATA",
        year=2024,
        url="",
    )
    defaults.update(overrides)
    case = ImmigrationCase(**defaults)
    case.ensure_id()
    return case


# ── CsvRepository.save_many upsert semantics ────────────────────────────


class TestCsvSaveManyUpsert:
    def test_save_many_persists_full_text_path_after_cache_expiry(self, repo, tmp_path):
        """The download job's paths must survive the 60s cache TTL lapsing."""
        case = _case(citation="[2024] AATA 10", url="https://example.com/10")
        repo.save_many([case])
        invalidate_cases_cache()

        loaded = load_all_cases(str(tmp_path))
        assert len(loaded) == 1
        loaded[0].full_text_path = "downloaded_cases/case_texts/foo.txt"

        # Simulate the 60s TTL lapsing mid-job: force a fresh disk re-read
        # before the mutated object is saved back.
        invalidate_cases_cache()

        repo.save_many([loaded[0]])
        invalidate_cases_cache()

        reloaded = load_all_cases(str(tmp_path))
        assert len(reloaded) == 1
        assert reloaded[0].full_text_path == "downloaded_cases/case_texts/foo.txt"

    def test_save_many_does_not_duplicate_blank_url_case(self, repo):
        """The old unconditional `elif not case.url: append` duplicated rows."""
        case = _case(citation="[2024] AATA 11", url="")
        for _ in range(3):
            repo.save_many([case])
            invalidate_cases_cache()

        assert len(repo.load_all()) == 1

    def test_save_many_keeps_two_distinct_blank_url_cases(self, repo):
        """Two manual adds (both blank-URL) must both survive."""
        a = _case(citation="[2024] AATA 12", url="")
        b = _case(citation="[2024] AATA 13", url="")

        added = repo.save_many([a, b])
        invalidate_cases_cache()

        assert added == 2
        assert len(repo.load_all()) == 2

    def test_save_many_does_not_clobber_existing_values_with_blanks(self, repo):
        """Empty incoming fields must never erase a stored non-empty value."""
        stored = _case(
            citation="[2024] AATA 14",
            url="https://example.com/14",
            user_notes="keep me",
        )
        repo.save_many([stored])
        invalidate_cases_cache()

        incoming = ImmigrationCase(case_id=stored.case_id, user_notes="")
        repo.save_many([incoming])
        invalidate_cases_cache()

        reloaded = repo.get_by_id(stored.case_id)
        assert reloaded is not None
        assert reloaded.user_notes == "keep me"

    def test_save_many_merges_a_new_case_id_onto_an_existing_url(self, repo):
        """URL uniqueness must survive the switch to case_id keying."""
        first = _case(citation="", title="First pass", url="https://example.com/21")
        repo.save_many([first])
        invalidate_cases_cache()

        # Same URL, but a citation now exists, so ensure_id() produces a
        # different case_id than `first` got.
        second = ImmigrationCase(
            citation="[2024] AATA 21",
            title="Second pass",
            url="https://example.com/21",
        )
        second.ensure_id()
        assert second.case_id != first.case_id

        added = repo.save_many([second])
        invalidate_cases_cache()

        loaded = repo.load_all()
        assert len(loaded) == 1
        assert loaded[0].citation == "[2024] AATA 21"
        assert added == 0

    def test_save_many_keeps_two_cases_with_different_urls(self, repo):
        """The URL merge pass must not over-merge distinct URLs."""
        a = _case(citation="[2024] AATA 22", url="https://example.com/22")
        b = _case(citation="[2024] AATA 23", url="https://example.com/23")

        repo.save_many([a])
        invalidate_cases_cache()
        repo.save_many([b])
        invalidate_cases_cache()

        assert len(repo.load_all()) == 2

    def test_save_many_raises_when_one_case_id_has_two_urls(self, repo):
        """An unresolvable id/url conflict must fail loudly and write nothing."""
        stored = _case(citation="[2024] AATA 24", url="https://example.com/24")
        repo.save_many([stored])
        invalidate_cases_cache()

        conflicting = ImmigrationCase(
            case_id=stored.case_id,
            citation="[2024] AATA 24",
            url="https://example.com/DIFFERENT",
        )

        with pytest.raises(ValueError):
            repo.save_many([conflicting])
        invalidate_cases_cache()

        loaded = repo.load_all()
        assert len(loaded) == 1
        assert loaded[0].url == "https://example.com/24"


# ── SQLite save_many: blank-URL UNIQUE crash + rollback ─────────────────


class TestSqliteSaveManyBugs:
    def test_sqlite_save_many_accepts_two_blank_url_cases(self, sqlite_repo):
        a = _case(citation="[2024] AATA 15", url="")
        b = _case(citation="[2024] AATA 16", url="")

        sqlite_repo.save_many([a, b])

        assert len(sqlite_repo.load_all()) == 2

    def test_sqlite_save_many_rolls_back_on_error(self, sqlite_repo):
        """A constraint violation inside a batch must not leave a partial
        write in an open, uncommitted transaction."""
        a = _case(citation="[2024] AATA 17", url="https://example.com/dup")
        b = _case(citation="[2024] AATA 18", url="https://example.com/dup")

        with pytest.raises(sqlite3.IntegrityError):
            sqlite_repo.save_many([a, b])

        assert sqlite_repo.load_all() == []
        assert sqlite_repo._conn().in_transaction is False


# ── Pipeline clean-phase dedup key ───────────────────────────────────────


def _make_pipeline_config(**overrides):
    defaults = {
        "databases": [],
        "start_year": 2024,
        "end_year": 2024,
        "delay": 0,
        "download_enabled": False,
    }
    defaults.update(overrides)
    return PipelineConfig(**defaults)


class TestPipelineCleanPhase:
    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_clean_phase_keeps_distinct_blank_url_cases(self, mock_scraper_cls, tmp_path):
        """Blank URLs are an expected state; the clean phase must not
        collapse every URL-less case into a single surviving row."""
        ensure_output_dirs(str(tmp_path))
        a = _case(citation="[2024] AATA 19", url="")
        b = _case(citation="[2024] AATA 20", url="")
        save_cases_csv([a, b], str(tmp_path))

        config = _make_pipeline_config(deduplicate=True)
        pipeline = SmartPipeline(config, str(tmp_path))
        pipeline._run_clean_phase()

        assert len(load_all_cases(str(tmp_path))) == 2


# ── Pipeline download-phase stop persistence and failed accounting ──────


class TestPipelineDownloadPhase:
    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_download_phase_persists_progress_on_stop(self, mock_scraper_cls, tmp_path):
        """Stop must not orphan already-downloaded .txt files.

        The stop happens after the first download has succeeded, and the
        assertion reads the CSV back — a mocked `_save_download_progress`
        would let this pass even against the unfixed `return`, since the
        bug is lost work, not a missing call.
        """
        ensure_output_dirs(str(tmp_path))
        a = _case(citation="[2024] AATA 25", url="https://example.com/25")
        b = _case(citation="[2024] AATA 26", url="https://example.com/26")
        save_cases_csv([a, b], str(tmp_path))

        config = _make_pipeline_config(download_enabled=True)
        pipeline = SmartPipeline(config, str(tmp_path))

        mock_scraper = mock_scraper_cls.return_value
        call_count = {"n": 0}

        def fake_download(case):
            call_count["n"] += 1
            pipeline.request_stop()
            return "case text"

        mock_scraper.download_case_detail.side_effect = fake_download

        pipeline._run_download_phase()

        invalidate_cases_cache()
        by_id = {c.case_id: c for c in load_all_cases(str(tmp_path))}
        assert by_id[a.case_id].full_text_path != ""
        assert by_id[b.case_id].full_text_path == ""
        assert call_count["n"] == 1

    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_download_phase_failed_count_never_negative(self, mock_scraper_cls, tmp_path):
        """The retryable-empty branch must balance the retry loop's decrement."""
        ensure_output_dirs(str(tmp_path))
        case = _case(citation="[2024] AATA 27", url="https://example.com/27")
        save_cases_csv([case], str(tmp_path))

        config = _make_pipeline_config(download_enabled=True)
        pipeline = SmartPipeline(config, str(tmp_path))

        mock_scraper = mock_scraper_cls.return_value
        mock_scraper.last_error = {"category": "http_500"}
        calls = {"n": 0}

        def fake_download(c):
            calls["n"] += 1
            if calls["n"] == 1:
                return ""
            return "recovered text"

        mock_scraper.download_case_detail.side_effect = fake_download

        pipeline._run_download_phase()

        failed = pipeline.get_status()["stats"]["download"]["failed"]
        assert failed >= 0
