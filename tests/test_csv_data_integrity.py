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
from pathlib import Path
from unittest.mock import patch

import pytest

import immi_case_downloader.sqlite_repository as sr
from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.pipeline import PipelineConfig, SmartPipeline, start_pipeline
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import (
    CASE_FIELDS,
    ensure_output_dirs,
    invalidate_cases_cache,
    load_all_cases,
    save_cases_csv,
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
