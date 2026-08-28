"""Regression tests for plan 027: CSV/SQLite data-integrity bugs.

Each test proves a specific bug identified in
plans/027-fix-csv-data-integrity.md is real, then (once the corresponding
fix lands) proves it stays fixed. The tests added in Step 1 must fail
against the pre-fix code — that is how the plan proves the bugs exist
before "fixing" them.

Every test uses tmp_path. No test may read or write anything under
downloaded_cases/.
"""

import ast
import sqlite3
import threading
from pathlib import Path
from unittest.mock import patch

import pytest

import immi_case_downloader.sqlite_repository as sr
from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.csv_write_lock import csv_write_lock
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.pipeline import PipelineConfig, SmartPipeline, start_pipeline
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import (
    CASE_FIELDS,
    add_case_manual,
    delete_case,
    ensure_output_dirs,
    invalidate_cases_cache,
    load_all_cases,
    save_cases_csv,
    update_case,
)

# The pre-migration schema: the table DDL as it existed before Step 7, with
# the inline UNIQUE on `url` that made a second blank-URL case raise
# IntegrityError. Hardcoded (not derived from the current, already-fixed
# _CASES_TABLE_SQL) so the migration tests exercise a genuine legacy database.
_LEGACY_CASES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS cases (
    case_id TEXT PRIMARY KEY,
    citation TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    court TEXT NOT NULL DEFAULT '',
    court_code TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '' UNIQUE,
    judges TEXT NOT NULL DEFAULT '',
    catchwords TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    visa_type TEXT NOT NULL DEFAULT '',
    legislation TEXT NOT NULL DEFAULT '',
    text_snippet TEXT NOT NULL DEFAULT '',
    full_text_path TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    user_notes TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    case_nature TEXT NOT NULL DEFAULT '',
    legal_concepts TEXT NOT NULL DEFAULT '',
    visa_subclass TEXT NOT NULL DEFAULT '',
    visa_class_code TEXT NOT NULL DEFAULT '',
    applicant_name TEXT NOT NULL DEFAULT '',
    respondent TEXT NOT NULL DEFAULT '',
    country_of_origin TEXT NOT NULL DEFAULT '',
    visa_subclass_number TEXT NOT NULL DEFAULT '',
    hearing_date TEXT NOT NULL DEFAULT '',
    is_represented TEXT NOT NULL DEFAULT '',
    representative TEXT NOT NULL DEFAULT '',
    visa_outcome_reason TEXT NOT NULL DEFAULT '',
    legal_test_applied TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_court_code ON cases(court_code);
CREATE INDEX IF NOT EXISTS idx_year ON cases(year);
CREATE INDEX IF NOT EXISTS idx_court_year ON cases(court_code, year);
CREATE INDEX IF NOT EXISTS idx_source ON cases(source);
CREATE INDEX IF NOT EXISTS idx_outcome ON cases(outcome);
CREATE INDEX IF NOT EXISTS idx_case_nature ON cases(case_nature);
CREATE INDEX IF NOT EXISTS idx_visa_type ON cases(visa_type);
CREATE INDEX IF NOT EXISTS idx_visa_subclass_number ON cases(visa_subclass_number);
CREATE INDEX IF NOT EXISTS idx_court_outcome ON cases(court_code, outcome);
"""


def _legacy_db(tmp_path) -> str:
    """A pre-migration database: the old schema with the inline UNIQUE on url,
    two rows with real URLs and non-empty catchwords."""
    path = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(path)
    conn.executescript(_LEGACY_CASES_TABLE_SQL)
    conn.executescript(sr._FTS_SQL)
    conn.executescript(sr._TRIGGERS_SQL)
    conn.execute(
        "INSERT INTO cases (case_id, citation, title, url, catchwords) VALUES (?, ?, ?, ?, ?)",
        ("legacy001", "[2020] AATA 1", "Legacy Case One",
         "https://example.com/legacy-1", "protection visa refusal"),
    )
    conn.execute(
        "INSERT INTO cases (case_id, citation, title, url, catchwords) VALUES (?, ?, ?, ?, ?)",
        ("legacy002", "[2020] AATA 2", "Legacy Case Two",
         "https://example.com/legacy-2", "character test cancellation"),
    )
    conn.commit()
    conn.close()
    return path


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

    def test_failed_save_many_leaves_no_uncommitted_mutation_in_cache(self, repo):
        """A batch that raises must not publish its earlier cases to readers.

        save_many used to merge onto the very objects held by the
        load_all_cases cache, so a batch that raised on its *second* case had
        already applied its *first* one to every reader in the process — a
        state on nobody's disk, which the next successful save would then
        commit. The test above hides this by calling invalidate_cases_cache()
        before it reads; this one deliberately does not.
        """
        first = _case(citation="[2024] AATA 30", url="https://example.com/30")
        second = _case(citation="[2024] AATA 31", url="https://example.com/31")
        repo.save_many([first, second])
        invalidate_cases_cache()

        good_update = ImmigrationCase(
            case_id=first.case_id,
            citation="[2024] AATA 30",
            url="https://example.com/30",
            user_notes="NEVER COMMITTED",
        )
        conflicting = ImmigrationCase(
            case_id=second.case_id,
            citation="[2024] AATA 31",
            url="https://example.com/DIFFERENT",
        )

        with pytest.raises(ValueError):
            repo.save_many([good_update, conflicting])

        # No invalidate_cases_cache() here: seeing the in-memory state is the
        # whole point.
        cached = load_all_cases(repo.base_dir)
        assert [c.user_notes for c in cached] == ["", ""], (
            "a batch that raised leaked its earlier mutation into the cache"
        )

        on_disk = (Path(repo.base_dir) / "immigration_cases.csv").read_text(
            encoding="utf-8-sig"
        )
        assert "NEVER COMMITTED" not in on_disk

    def test_save_many_does_not_overwrite_from_a_stale_cache(self, repo):
        """The read inside the lock must come from disk, not a 60s-old cache.

        Process A warms its cache, process B appends a row, then A saves. If A
        merges onto its stale snapshot, B's row is silently dropped by A's
        write. Here the "other process" is a direct save_cases_csv() that
        bypasses A's in-process cache, which is exactly what a second process
        looks like from A's side.
        """
        first = _case(citation="[2024] AATA 40", url="https://example.com/40")
        repo.save_many([first])
        invalidate_cases_cache()

        repo.load_all()  # warm this process's cache at 1 row

        other_process_rows = load_all_cases(repo.base_dir, use_cache=False)
        other_process_rows.append(
            _case(citation="[2024] AATA 41", url="https://example.com/41")
        )
        with patch("immi_case_downloader.storage.invalidate_cases_cache"):
            # Leave the stale cache in place — a write in another process
            # cannot invalidate this process's cache either.
            save_cases_csv(other_process_rows, repo.base_dir)

        repo.save_many([_case(citation="[2024] AATA 42", url="https://example.com/42")])

        invalidate_cases_cache()
        urls = {c.url for c in repo.load_all()}
        assert urls == {
            "https://example.com/40",
            "https://example.com/41",
            "https://example.com/42",
        }


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


# ── SQLite one-time schema migration (drop legacy UNIQUE on url) ────────


class TestSqliteMigration:
    def test_sqlite_migration_removes_legacy_url_unique(self, tmp_path):
        path = _legacy_db(tmp_path)
        repo = SqliteRepository(path)
        try:
            assert SqliteRepository._has_legacy_url_unique(repo._conn()) is False
            rows = repo.load_all()
            assert len(rows) == 2
            hits = repo.search_text("protection")
            assert any(c.title == "Legacy Case One" for c in hits)
        finally:
            repo.close()

    def test_sqlite_migration_preserves_indexes_and_triggers(self, tmp_path):
        path = _legacy_db(tmp_path)
        check_conn = sqlite3.connect(path)
        check_conn.row_factory = sqlite3.Row
        before_indexes = {
            r["name"] for r in check_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='cases' AND name IS NOT NULL AND sql IS NOT NULL"
            )
        }
        before_triggers = {
            r["name"] for r in check_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            )
        }
        check_conn.close()

        repo = SqliteRepository(path)
        try:
            conn = repo._conn()
            after_indexes = {
                r["name"] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    "AND tbl_name='cases' AND name IS NOT NULL AND sql IS NOT NULL"
                )
            }
            after_triggers = {
                r["name"] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='trigger'"
                )
            }
            assert before_indexes <= after_indexes
            assert before_triggers <= after_triggers
            assert "idx_url_unique" in after_indexes
        finally:
            repo.close()

    def test_sqlite_migration_takes_a_backup(self, tmp_path):
        path = _legacy_db(tmp_path)
        repo = SqliteRepository(path)
        try:
            backups = list(tmp_path.glob("legacy.db.pre-url-unique-*.bak"))
            assert len(backups) == 1
            backup_conn = sqlite3.connect(str(backups[0]))
            backup_conn.row_factory = sqlite3.Row
            try:
                assert SqliteRepository._has_legacy_url_unique(backup_conn) is True
                count = backup_conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
                assert count == 2
            finally:
                backup_conn.close()
        finally:
            repo.close()

    def test_sqlite_still_rejects_duplicate_real_urls(self, tmp_path):
        path = _legacy_db(tmp_path)
        repo = SqliteRepository(path)
        try:
            dup = _case(citation="[2024] AATA 30", url="https://example.com/legacy-1")
            with pytest.raises(sqlite3.IntegrityError):
                repo.save_many([dup])
        finally:
            repo.close()

    @pytest.mark.parametrize(
        "failing_fragment",
        ["INSERT INTO cases_migrated", "ALTER TABLE cases_migrated", "CREATE TRIGGER"],
    )
    def test_sqlite_migration_rolls_back_on_failure(self, tmp_path, monkeypatch, failing_fragment):
        """A failure at any phase must leave the legacy database untouched."""
        path = _legacy_db(tmp_path)

        class _FailingConnProxy:
            def __init__(self, real):
                object.__setattr__(self, "_real", real)

            def execute(self, sql, *args, **kwargs):
                if failing_fragment in sql:
                    raise RuntimeError("injected")
                return self._real.execute(sql, *args, **kwargs)

            def __getattr__(self, name):
                return getattr(self._real, name)

        real_conn_method = SqliteRepository._conn

        def fake_conn(self):
            return _FailingConnProxy(real_conn_method(self))

        monkeypatch.setattr(SqliteRepository, "_conn", fake_conn)

        with pytest.raises(RuntimeError):
            SqliteRepository(path)

        # Bypass the patched _conn entirely: open the file directly to prove
        # the on-disk state, not just what our own proxy reports.
        check_conn = sqlite3.connect(path)
        check_conn.row_factory = sqlite3.Row
        try:
            assert SqliteRepository._has_legacy_url_unique(check_conn) is True
            count = check_conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            assert count == 2
            triggers = {
                r["name"] for r in check_conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='trigger'"
                )
            }
            assert {"cases_ai", "cases_ad", "cases_au"} <= triggers
        finally:
            check_conn.close()


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


# ── Pipeline crawl-phase checkpointing ──────────────────────────────────


class TestPipelineCrawlPhase:
    @patch("immi_case_downloader.pipeline.AUSTLII_DATABASES", {"AATA": {"name": "AATA"}})
    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_crawl_phase_persists_years_fetched_before_a_stop(
        self, mock_scraper_cls, tmp_path
    ):
        """Stopping must keep the years already crawled, not discard them.

        The crawl accumulated every year in memory and saved once, after both
        loops. A stop returned straight out of the year loop, so hours of
        rate-limited fetching against a host that blocks bulk scrapers were
        thrown away — and the assertion has to read the CSV back, because the
        bug is lost work, not an uncalled save.
        """
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        config = _make_pipeline_config(
            databases=["AATA"], start_year=2020, end_year=2024
        )
        pipeline = SmartPipeline(config, str(tmp_path))

        crawled_years = []

        def fake_crawl(self, scraper, db_code, db_info, year):
            crawled_years.append(year)
            if len(crawled_years) == 2:
                pipeline.request_stop()
            return [
                _case(
                    citation=f"[{year}] AATA {year}",
                    url=f"https://example.com/{year}",
                )
            ]

        with patch.object(SmartPipeline, "_crawl_with_fallback", fake_crawl):
            pipeline._run_crawl_phase()

        invalidate_cases_cache()
        urls = {c.url for c in load_all_cases(str(tmp_path))}
        assert urls == {
            "https://example.com/2020",
            "https://example.com/2021",
        }, "a stop discarded the years already crawled"
        assert crawled_years == [2020, 2021]

    @patch("immi_case_downloader.pipeline.AUSTLII_DATABASES", {"AATA": {"name": "AATA"}})
    @patch("immi_case_downloader.sources.austlii.AustLIIScraper")
    def test_crawl_phase_does_not_erase_a_concurrent_writer(
        self, mock_scraper_cls, tmp_path
    ):
        """The checkpoint merges onto disk, not onto the phase's start snapshot.

        A crawl runs for hours; anything committed in that window must survive
        the crawl's own save.
        """
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        config = _make_pipeline_config(
            databases=["AATA"], start_year=2020, end_year=2020
        )
        pipeline = SmartPipeline(config, str(tmp_path))

        def fake_crawl(self, scraper, db_code, db_info, year):
            # Another writer commits while this year is being fetched.
            other = load_all_cases(str(tmp_path), use_cache=False)
            other.append(
                _case(citation="[2024] AATA 99", url="https://example.com/other")
            )
            save_cases_csv(other, str(tmp_path))
            return [_case(citation="[2020] AATA 1", url="https://example.com/2020")]

        with patch.object(SmartPipeline, "_crawl_with_fallback", fake_crawl):
            pipeline._run_crawl_phase()

        invalidate_cases_cache()
        urls = {c.url for c in load_all_cases(str(tmp_path))}
        assert urls == {"https://example.com/2020", "https://example.com/other"}


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


# ── start_pipeline check-then-act race ───────────────────────────────────


class TestStartPipelineRace:
    @patch("immi_case_downloader.pipeline.threading.Thread")
    def test_start_pipeline_claims_slot_before_thread_starts(self, mock_thread_cls):
        """The slot must be claimed inside the lock, before the thread ever
        runs — otherwise a second caller entering the lock first sees a
        freshly-assigned instance with running=False and starts a rival
        pipeline that rewrites the same CSV."""
        import immi_case_downloader.pipeline as pl

        old = pl._active_pipeline
        pl._active_pipeline = None
        try:
            config = _make_pipeline_config()
            first = start_pipeline(config)
            second = start_pipeline(config)
            assert first is True
            assert second is False
        finally:
            pl._active_pipeline = old


# ── visa_subclass / visa_subclass_number dtype guard ─────────────────────


class TestVisaSubclassDtypeGuard:
    def test_root_scripts_guard_visa_subclass_dtype(self):
        """Every pd.read_csv of the master CSV must guard both visa columns
        as str, or the next read-modify-write cycle re-writes '866.0'.

        Uses ast, not string slicing: a text window after `pd.read_csv(`
        can match a comment, a docstring, or the *next* call's dtype=, so it
        can pass while the call it is meant to check is unguarded.
        """
        repo_root = Path(__file__).resolve().parents[1]
        candidates = [
            "download_fulltext.py",
            "normalize_metadata.py",
            "merge_llm_extraction.py",
            "download_missing_22.py",
            "immi_case_downloader/storage.py",
        ]
        checked = 0
        offenders = []

        for rel in candidates:
            path = repo_root / rel
            if not path.exists():
                # A sibling plan (032) may have archived a script by now.
                continue
            checked += 1
            tree = ast.parse(path.read_text(), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                if isinstance(func, ast.Attribute):
                    name = func.attr
                elif isinstance(func, ast.Name):
                    name = func.id
                else:
                    name = None
                if name != "read_csv":
                    continue

                dtype_kw = next(
                    (kw for kw in node.keywords if kw.arg == "dtype"), None
                )
                guarded = False
                if dtype_kw is not None and isinstance(dtype_kw.value, ast.Dict):
                    keys = {
                        k.value
                        for k in dtype_kw.value.keys
                        if isinstance(k, ast.Constant) and isinstance(k.value, str)
                    }
                    guarded = {"visa_subclass", "visa_subclass_number"} <= keys
                if not guarded:
                    offenders.append(f"{rel}:{node.lineno}")

        assert checked >= 4, (
            f"only found {checked} of {len(candidates)} candidate files — "
            "the guard is checking nothing"
        )
        assert not offenders, f"unguarded pd.read_csv call(s): {offenders}"


# ── End-to-end: the repository's own round trip stops writing '866.0' ───


class TestCsvRoundTripVisaColumns:
    def test_csv_round_trip_preserves_both_visa_columns(self, tmp_path):
        """load_all() -> save_many() must not re-corrupt visa_subclass or
        visa_subclass_number back into '866.0' — this is the test that
        catches Step 8e (the canonical reader) being skipped."""

        def _row(case_id: str, visa_subclass: str, visa_subclass_number: str) -> str:
            values = []
            for field in CASE_FIELDS:
                if field == "case_id":
                    values.append(case_id)
                elif field == "visa_subclass":
                    values.append(visa_subclass)
                elif field == "visa_subclass_number":
                    values.append(visa_subclass_number)
                elif field == "year":
                    values.append("2024")
                else:
                    values.append("")
            return ",".join(values)

        csv_path = tmp_path / "immigration_cases.csv"
        # One populated row and one blank row per column — the blank is what
        # makes pandas infer float64 in the first place.
        csv_path.write_text(
            ",".join(CASE_FIELDS) + "\n"
            + _row("aaa111111111", "866", "866") + "\n"
            + _row("bbb222222222", "", "") + "\n"
        )

        repo = CsvRepository(str(tmp_path))
        loaded = {c.case_id: c for c in repo.load_all()}
        assert loaded["aaa111111111"].visa_subclass == "866"
        assert loaded["aaa111111111"].visa_subclass_number == "866"

        # An empty batch still reloads and rewrites the whole file — precisely
        # the read-modify-write round trip under test.
        repo.save_many([])

        raw = csv_path.read_text()
        assert "866.0" not in raw


# ── Every master-CSV writer takes the one lock ───────────────────────────


class TestWebCrudWritersTakeTheLock:
    """update/delete/add are read-modify-write over the whole catalog too.

    They ran outside the lock and off a cached snapshot, so a web edit
    overlapping any batch job silently reverted whichever finished first.
    Each test holds the lock from another thread and asserts the writer
    blocks on it; a writer that ignores the lock returns instead of timing
    out.
    """

    @staticmethod
    def _assert_blocks_on_lock(tmp_path, call):
        target = str(Path(tmp_path) / "immigration_cases.csv")
        holder_ready = threading.Event()
        release_holder = threading.Event()

        def hold_lock():
            with csv_write_lock(target):
                holder_ready.set()
                release_holder.wait(timeout=5)

        holder = threading.Thread(target=hold_lock)
        holder.start()
        try:
            assert holder_ready.wait(timeout=5)

            def impatient(path, timeout=0.2, **kwargs):
                # The real lock, only less patient — so an unlocked writer
                # returns normally and a locked one raises.
                return csv_write_lock(path, timeout=0.2, **kwargs)

            with patch(
                "immi_case_downloader.storage.csv_write_lock", impatient
            ), pytest.raises(TimeoutError):
                call()
        finally:
            release_holder.set()
            holder.join(timeout=5)

    def test_update_case_takes_the_lock(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        case = _case(citation="[2024] AATA 50", url="https://example.com/50")
        save_cases_csv([case], str(tmp_path))
        invalidate_cases_cache()

        self._assert_blocks_on_lock(
            tmp_path,
            lambda: update_case(case.case_id, {"user_notes": "x"}, str(tmp_path)),
        )

    def test_delete_case_takes_the_lock(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        case = _case(citation="[2024] AATA 51", url="https://example.com/51")
        save_cases_csv([case], str(tmp_path))
        invalidate_cases_cache()

        self._assert_blocks_on_lock(
            tmp_path, lambda: delete_case(case.case_id, str(tmp_path))
        )

    def test_add_case_manual_takes_the_lock(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))
        invalidate_cases_cache()

        self._assert_blocks_on_lock(
            tmp_path,
            lambda: add_case_manual(
                {"citation": "[2024] AATA 52", "url": "https://example.com/52"},
                str(tmp_path),
            ),
        )


# ── Cross-process advisory write lock ────────────────────────────────────


class TestCsvWriteLock:
    def test_csv_write_lock_is_exclusive(self, tmp_path):
        """flock is per open file description, so two separate open() calls
        in one process genuinely contend — this is a real test, not a no-op."""
        target = str(tmp_path / "immigration_cases.csv")
        holder_ready = threading.Event()
        release_holder = threading.Event()

        def hold_lock():
            with csv_write_lock(target):
                holder_ready.set()
                release_holder.wait(timeout=5)

        holder = threading.Thread(target=hold_lock)
        holder.start()
        assert holder_ready.wait(timeout=5), "lock holder never signalled ready"

        with pytest.raises(TimeoutError):
            with csv_write_lock(target, timeout=0.2):
                pass

        release_holder.set()
        holder.join(timeout=5)
        assert not holder.is_alive()

        # Now that the holder released, acquiring must succeed.
        with csv_write_lock(target, timeout=2):
            pass

    def test_concurrent_save_many_does_not_lose_rows(self, tmp_path):
        """Two threads each save_many-ing 50 distinct cases, started together.
        Looped 5 rounds so a missing lock fails reliably, not just luckily."""

        def make_batch(prefix):
            return [
                _case(
                    citation=f"[2024] AATA {prefix}{i}",
                    url=f"https://example.com/{prefix}-{i}",
                )
                for i in range(50)
            ]

        for round_num in range(5):
            base_dir = tmp_path / f"round{round_num}"
            base_dir.mkdir()
            repo = CsvRepository(str(base_dir))

            batch_a = make_batch(f"a{round_num}")
            batch_b = make_batch(f"b{round_num}")
            errors = []

            def worker(batch):
                try:
                    repo.save_many(batch)
                except Exception as exc:  # noqa: BLE001 — surfaced via `errors`
                    errors.append(exc)

            t1 = threading.Thread(target=worker, args=(batch_a,))
            t2 = threading.Thread(target=worker, args=(batch_b,))
            t1.start()
            t2.start()
            t1.join(timeout=10)
            t2.join(timeout=10)

            assert not errors, errors
            invalidate_cases_cache()
            assert len(repo.load_all()) == 100, f"round {round_num} lost rows"
