"""Tests for SupabaseRepository — fully mocked, no real Supabase connection."""

import os
from unittest.mock import MagicMock, patch, call

import pytest

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.supabase_repository import (
    SupabaseRepository, ALLOWED_UPDATE_FIELDS, BATCH_SIZE, PAGE_MAX,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_case(**overrides) -> ImmigrationCase:
    defaults = dict(
        case_id="abc123",
        citation="[2024] AATA 100",
        title="Smith v Minister",
        court="Administrative Appeals Tribunal",
        court_code="AATA",
        date="2024-03-15",
        year=2024,
        url="https://austlii.edu.au/au/cases/cth/AATA/2024/100.html",
        judges="Member Jones",
        catchwords="visa refusal",
        outcome="Affirmed",
        visa_type="Subclass 866",
        legislation="Migration Act 1958",
        text_snippet="Tribunal affirms.",
        full_text_path="",
        source="AustLII",
        user_notes="",
        tags="",
        case_nature="Visa Refusal",
        legal_concepts="Character Test",
    )
    defaults.update(overrides)
    return ImmigrationCase(**defaults)


def _case_row(**overrides) -> dict:
    """Return a dict mimicking a Supabase row."""
    return _make_case(**overrides).to_dict()


def _mock_response(data=None, count=None):
    """Create a mock Supabase response object."""
    resp = MagicMock()
    resp.data = data if data is not None else []
    resp.count = count
    return resp


# ---------------------------------------------------------------------------
# Fixture: mock the supabase create_client so no real connection is made
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client():
    """Patch create_client and return the mock Supabase client."""
    with patch.dict(os.environ, {
        "SUPABASE_URL": "https://test.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "test-key-12345",
    }):
        with patch("immi_case_downloader.supabase_repository.create_client") as mock_create:
            client = MagicMock()
            mock_create.return_value = client
            yield client


@pytest.fixture
def repo(mock_client):
    """SupabaseRepository with a mocked client."""
    return SupabaseRepository(output_dir="/tmp/test_cases")


# ---------------------------------------------------------------------------
# Tests: __init__
# ---------------------------------------------------------------------------

class TestInit:
    def test_missing_env_vars_raises(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch("immi_case_downloader.supabase_repository.load_dotenv"):
                with pytest.raises(ValueError, match="SUPABASE_URL"):
                    SupabaseRepository()

    def test_explicit_args(self, mock_client):
        r = SupabaseRepository(
            url="https://explicit.supabase.co",
            key="explicit-key",
            output_dir="/tmp/explicit",
        )
        assert r._output_dir == "/tmp/explicit"


# ---------------------------------------------------------------------------
# Tests: load_all
# ---------------------------------------------------------------------------

class TestLoadAll:
    def test_single_page(self, repo, mock_client):
        rows = [_case_row(case_id=f"id{i}") for i in range(3)]
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=rows)

        cases = repo.load_all()
        assert len(cases) == 3
        assert cases[0].case_id == "id0"

    def test_pagination(self, repo, mock_client):
        """When first page is full (PAGE_MAX rows), should fetch next page."""
        full_page = [_case_row(case_id=f"id{i}") for i in range(PAGE_MAX)]
        partial = [_case_row(case_id="last")]

        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.range.return_value = table
        table.execute.side_effect = [
            _mock_response(data=full_page),
            _mock_response(data=partial),
        ]

        cases = repo.load_all()
        assert len(cases) == PAGE_MAX + 1

    def test_empty_db(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[])

        assert repo.load_all() == []


# ---------------------------------------------------------------------------
# Tests: get_by_id
# ---------------------------------------------------------------------------

class TestGetById:
    def test_found(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.maybe_single.return_value = table
        table.execute.return_value = _mock_response(data=_case_row())

        case = repo.get_by_id("abc123")
        assert case is not None
        assert case.case_id == "abc123"

    def test_not_found(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.maybe_single.return_value = table
        table.execute.return_value = _mock_response(data=None)

        assert repo.get_by_id("missing") is None


# ---------------------------------------------------------------------------
# Tests: save_many
# ---------------------------------------------------------------------------

class TestSaveMany:
    def test_single_batch(self, repo, mock_client):
        cases = [_make_case(case_id=f"id{i}") for i in range(3)]
        table = MagicMock()
        mock_client.table.return_value = table
        table.upsert.return_value = table
        table.execute.return_value = _mock_response()

        count = repo.save_many(cases)
        assert count == 3
        table.upsert.assert_called_once()

    def test_multiple_batches(self, repo, mock_client):
        """Cases exceeding BATCH_SIZE should be split into multiple upserts."""
        cases = [_make_case(case_id=f"id{i}") for i in range(BATCH_SIZE + 10)]
        table = MagicMock()
        mock_client.table.return_value = table
        table.upsert.return_value = table
        table.execute.return_value = _mock_response()

        count = repo.save_many(cases)
        assert count == BATCH_SIZE + 10
        assert table.upsert.call_count == 2

    def test_empty_list(self, repo, mock_client):
        assert repo.save_many([]) == 0


# ---------------------------------------------------------------------------
# Tests: update
# ---------------------------------------------------------------------------

class TestUpdate:
    def test_allowed_fields(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.update.return_value = table
        table.eq.return_value = table
        table.execute.return_value = _mock_response(data=[{"case_id": "abc123"}])

        result = repo.update("abc123", {"title": "New Title", "user_notes": "note"})
        assert result is True
        table.update.assert_called_once_with({"title": "New Title", "user_notes": "note"})

    def test_blocked_fields(self, repo, mock_client):
        result = repo.update("abc123", {"case_id": "hacked", "unknown_field": "x"})
        assert result is False

    def test_mixed_fields(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.update.return_value = table
        table.eq.return_value = table
        table.execute.return_value = _mock_response(data=[{"case_id": "abc123"}])

        result = repo.update("abc123", {"title": "OK", "case_id": "bad"})
        assert result is True
        table.update.assert_called_once_with({"title": "OK"})


# ---------------------------------------------------------------------------
# Tests: delete
# ---------------------------------------------------------------------------

class TestDelete:
    def test_success(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.delete.return_value = table
        table.eq.return_value = table
        table.execute.return_value = _mock_response(data=[{"case_id": "abc123"}])

        assert repo.delete("abc123") is True

    def test_not_found(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.delete.return_value = table
        table.eq.return_value = table
        table.execute.return_value = _mock_response(data=[])

        assert repo.delete("missing") is False


# ---------------------------------------------------------------------------
# Tests: add
# ---------------------------------------------------------------------------

class TestAdd:
    def test_sets_source(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.upsert.return_value = table
        table.execute.return_value = _mock_response()

        case = _make_case(source="")
        result = repo.add(case)
        assert result.source == "Manual Entry"
        assert result.case_id  # ensure_id() was called


# ---------------------------------------------------------------------------
# Tests: get_statistics
# ---------------------------------------------------------------------------

class TestStatistics:
    def test_normalises_by_year(self, repo, mock_client):
        stats_data = {
            "total": 100,
            "by_court": {"AATA": 50, "FCA": 50},
            "by_year": {"2024": 60, "2023": 40},
            "by_nature": {"Visa Refusal": 80},
            "visa_types": ["Subclass 866"],
            "with_full_text": 10,
            "sources": ["AustLII"],
        }
        mock_client.rpc.return_value = MagicMock(
            execute=MagicMock(return_value=_mock_response(data=stats_data))
        )

        result = repo.get_statistics()
        assert result["total"] == 100
        # by_year keys should be int, not str
        assert 2024 in result["by_year"]
        assert 2023 in result["by_year"]


# ---------------------------------------------------------------------------
# Tests: get_existing_urls
# ---------------------------------------------------------------------------

class TestGetExistingUrls:
    def test_returns_set(self, repo, mock_client):
        urls = ["https://a.com", "https://b.com"]
        mock_client.rpc.return_value = MagicMock(
            execute=MagicMock(return_value=_mock_response(data=urls))
        )

        result = repo.get_existing_urls()
        assert isinstance(result, set)
        assert result == {"https://a.com", "https://b.com"}


# ---------------------------------------------------------------------------
# Tests: filter_cases
# ---------------------------------------------------------------------------

class TestFilterCases:
    def test_basic_filter(self, repo, mock_client):
        rows = [_case_row(case_id="f1")]
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=rows, count=1)

        cases, total = repo.filter_cases(court="AATA", page=1, page_size=50)
        assert len(cases) == 1
        assert total == 1
        table.eq.assert_called_with("court_code", "AATA")

    def test_text_search_filter(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.text_search.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[], count=0)

        repo.filter_cases(keyword="visa refusal")
        table.text_search.assert_called_once()

    def test_invalid_sort_defaults_to_year(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[], count=0)

        repo.filter_cases(sort_by="DROP TABLE", sort_dir="asc")
        table.order.assert_called_with("year", desc=False)

    def test_pagination_offset(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[], count=0)

        repo.filter_cases(page=3, page_size=20)
        table.range.assert_called_with(40, 59)

    def test_date_sort_degrades_to_year_for_stability(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[], count=0)

        repo.filter_cases(sort_by="date", sort_dir="desc")
        table.order.assert_called_with("year", desc=True)

    def test_list_cases_fast_skips_count_header(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.order.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=[])

        repo.list_cases_fast(sort_by="date", page=1, page_size=5)

        # list_cases_fast should not request count=exact
        select_call = table.select.call_args
        assert "count" not in select_call.kwargs

    def test_count_cases_uses_planned_mode(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.execute.return_value = _mock_response(data=[{"case_id": "x"}], count=42)

        total = repo.count_cases(court="AATA", count_mode="planned")
        assert total == 42
        table.select.assert_called_with("case_id", count="planned")

    def test_count_cases_invalid_mode_falls_back_to_planned(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.limit.return_value = table
        table.execute.return_value = _mock_response(data=[], count=0)

        repo.count_cases(count_mode="invalid-mode")
        table.select.assert_called_with("case_id", count="planned")


# ---------------------------------------------------------------------------
# Tests: search_text
# ---------------------------------------------------------------------------

class TestSearchText:
    def test_basic(self, repo, mock_client):
        rows = [_case_row()]
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.text_search.return_value = table
        table.limit.return_value = table
        table.execute.return_value = _mock_response(data=rows)

        results = repo.search_text("visa refusal")
        assert len(results) == 1
        table.text_search.assert_called_once_with(
            "fts", "visa refusal",
            options={"type": "plain", "config": "english"},
        )

    def test_empty_query(self, repo, mock_client):
        assert repo.search_text("") == []
        assert repo.search_text("  ") == []

    def test_limit_clamped(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.text_search.return_value = table
        table.limit.return_value = table
        table.execute.return_value = _mock_response(data=[])

        repo.search_text("test", limit=999)
        table.limit.assert_called_with(200)


# ---------------------------------------------------------------------------
# Tests: find_related
# ---------------------------------------------------------------------------

class TestFindRelated:
    def test_calls_rpc(self, repo, mock_client):
        # First, get_by_id must return a case
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.maybe_single.return_value = table
        table.execute.return_value = _mock_response(data=_case_row())

        # Then RPC returns related cases
        related = [_case_row(case_id="rel1"), _case_row(case_id="rel2")]
        mock_client.rpc.return_value = MagicMock(
            execute=MagicMock(return_value=_mock_response(data=related))
        )

        results = repo.find_related("abc123", limit=5)
        assert len(results) == 2
        mock_client.rpc.assert_called_once_with("find_related_cases", {
            "p_case_id": "abc123",
            "p_case_nature": "Visa Refusal",
            "p_visa_type": "Subclass 866",
            "p_court_code": "AATA",
            "p_limit": 5,
        })

    def test_case_not_found(self, repo, mock_client):
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.eq.return_value = table
        table.maybe_single.return_value = table
        table.execute.return_value = _mock_response(data=None)

        assert repo.find_related("missing") == []


# ---------------------------------------------------------------------------
# Tests: export methods
# ---------------------------------------------------------------------------

class TestExport:
    def test_export_csv_rows(self, repo, mock_client):
        rows = [_case_row(case_id="e1")]
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=rows)

        result = repo.export_csv_rows()
        assert len(result) == 1
        assert result[0]["case_id"] == "e1"

    def test_export_json(self, repo, mock_client):
        rows = [_case_row(case_id="j1", year=2024)]
        table = MagicMock()
        mock_client.table.return_value = table
        table.select.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=rows)

        result = repo.export_json()
        assert result["total_cases"] == 1
        assert result["year_range"]["min"] == 2024


# ---------------------------------------------------------------------------
# Tests: get_filter_options
# ---------------------------------------------------------------------------

class TestFilterOptions:
    def test_splits_tags(self, repo, mock_client):
        opts = {
            "courts": ["AATA", "FCA"],
            "years": [2024, 2023],
            "sources": ["AustLII"],
            "natures": ["Visa Refusal"],
            "tags_raw": ["important, urgent", "flagged"],
        }
        mock_client.rpc.return_value = MagicMock(
            execute=MagicMock(return_value=_mock_response(data=opts))
        )

        result = repo.get_filter_options()
        assert "important" in result["tags"]
        assert "urgent" in result["tags"]
        assert "flagged" in result["tags"]
        assert result["courts"] == ["AATA", "FCA"]


# ---------------------------------------------------------------------------
# Tests: get_case_full_text
# ---------------------------------------------------------------------------

class TestFullText:
    def test_reads_local_file(self, repo, tmp_path):
        text_path = tmp_path / "case_texts" / "test.txt"
        text_path.parent.mkdir(parents=True)
        text_path.write_text("Full case text here.")

        repo._output_dir = str(tmp_path)
        case = _make_case(full_text_path=str(text_path))
        result = repo.get_case_full_text(case)
        assert result == "Full case text here."

    def test_no_path(self, repo):
        case = _make_case(full_text_path="")
        assert repo.get_case_full_text(case) is None


# ---------------------------------------------------------------------------
# Tests: Cloudflare Hyperdrive integration
# ---------------------------------------------------------------------------


class TestGetHyperdriveConn:
    """Tests for _get_hyperdrive_conn() — module-level helper."""

    def test_returns_none_when_no_url_available(self):
        """Neither Flask g nor env var present → returns None."""
        from immi_case_downloader.supabase_repository import _get_hyperdrive_conn

        with patch.dict(os.environ, {}, clear=True):
            # Reset module-level _HYPERDRIVE_URL
            with patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL", None):
                conn = _get_hyperdrive_conn()
        assert conn is None

    def test_returns_conn_via_env_var(self):
        """HYPERDRIVE_DATABASE_URL env var → psycopg2 connection returned."""
        from immi_case_downloader.supabase_repository import _get_hyperdrive_conn

        mock_conn = MagicMock()
        with (
            patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL",
                  "postgresql://user:pass@host/db"),
            patch("psycopg2.connect", return_value=mock_conn) as mock_connect,
        ):
            conn = _get_hyperdrive_conn()

        assert conn is mock_conn
        mock_connect.assert_called_once_with("postgresql://user:pass@host/db")

    def test_returns_conn_via_flask_g(self):
        """Flask request-scoped g.hyperdrive_url takes priority over env var."""
        from immi_case_downloader.supabase_repository import _get_hyperdrive_conn
        from unittest.mock import MagicMock

        mock_g = MagicMock()
        mock_g.hyperdrive_url = "postgresql://via-flask/db"
        mock_conn = MagicMock()

        with (
            patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL", None),
            patch("flask.g", mock_g),
            patch("psycopg2.connect", return_value=mock_conn),
        ):
            conn = _get_hyperdrive_conn()

        assert conn is mock_conn

    def test_returns_none_on_psycopg2_error(self):
        """If psycopg2.connect raises, returns None instead of propagating."""
        from immi_case_downloader.supabase_repository import _get_hyperdrive_conn

        with (
            patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL",
                  "postgresql://bad/db"),
            patch("psycopg2.connect", side_effect=Exception("connection refused")),
        ):
            conn = _get_hyperdrive_conn()

        assert conn is None

    def test_outside_flask_context_falls_back_to_env(self):
        """Outside a Flask app context, g.hyperdrive_url throws RuntimeError.
        The function silences it and falls back to _HYPERDRIVE_URL env var."""
        from immi_case_downloader.supabase_repository import _get_hyperdrive_conn

        mock_conn = MagicMock()
        # We are already outside a Flask app context here (no app fixture),
        # so accessing flask.g raises RuntimeError naturally.
        # Just verify the env-var fallback path produces a connection.
        with (
            patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL",
                  "postgresql://env/db"),
            patch("psycopg2.connect", return_value=mock_conn),
        ):
            conn = _get_hyperdrive_conn()

        assert conn is mock_conn


class TestInitWithHyperdriveUrl:
    """__init__ logs when HYPERDRIVE_DATABASE_URL is set (line 93)."""

    def test_logs_hyperdrive_active(self, mock_client, caplog):
        """When _HYPERDRIVE_URL is truthy, a log message is emitted."""
        import logging

        with (
            patch("immi_case_downloader.supabase_repository._HYPERDRIVE_URL",
                  "postgresql://edge/db"),
            caplog.at_level(logging.INFO, logger="immi_case_downloader.supabase_repository"),
        ):
            SupabaseRepository(output_dir="/tmp/hd_test")

        assert any("Hyperdrive" in r.message for r in caplog.records)


class TestLoadAnalyticsCasesHyperdrive:
    """load_analytics_cases() routes to Hyperdrive fast path when available."""

    def test_uses_hyperdrive_when_conn_available(self, repo):
        """When _get_hyperdrive_conn() returns a connection, _load_analytics_via_pg() is called."""
        mock_conn = MagicMock()
        mock_cases = [_make_case(case_id="hd1"), _make_case(case_id="hd2")]

        with (
            patch("immi_case_downloader.supabase_repository._get_hyperdrive_conn",
                  return_value=mock_conn),
            patch.object(repo, "_load_analytics_via_pg", return_value=mock_cases) as mock_pg,
        ):
            result = repo.load_analytics_cases()

        mock_pg.assert_called_once_with(mock_conn)
        assert result is mock_cases

    def test_falls_back_to_rest_when_no_conn(self, repo, mock_client):
        """When _get_hyperdrive_conn() returns None, uses Supabase REST pagination."""
        rows = [_case_row(case_id="rest1")]
        table = MagicMock()
        table.select.return_value = table
        table.range.return_value = table
        table.execute.return_value = _mock_response(data=rows)
        mock_client.table.return_value = table

        with patch("immi_case_downloader.supabase_repository._get_hyperdrive_conn",
                   return_value=None):
            result = repo.load_analytics_cases()

        assert len(result) == 1
        assert result[0].case_id == "rest1"


class TestLoadAnalyticsViaPg:
    """_load_analytics_via_pg() — direct psycopg2 fast path."""

    def _make_mock_conn(self, rows):
        """Build a minimal psycopg2 connection mock returning given rows."""
        cur = MagicMock()
        cur.__enter__ = lambda s: s
        cur.__exit__ = MagicMock(return_value=False)
        cur.fetchall.return_value = rows

        conn = MagicMock()
        conn.cursor.return_value = cur
        return conn, cur

    def test_returns_immigration_cases(self, repo):
        """Rows from SQL are mapped to ImmigrationCase objects."""
        from immi_case_downloader.supabase_repository import ANALYTICS_COLS

        # One row per analytics column — all empty strings
        row = tuple("" for _ in ANALYTICS_COLS)
        conn, _ = self._make_mock_conn([row])

        result = repo._load_analytics_via_pg(conn)

        assert len(result) == 1
        assert isinstance(result[0], ImmigrationCase)

    def test_closes_conn_on_success(self, repo):
        """conn.close() is called even on success path."""
        from immi_case_downloader.supabase_repository import ANALYTICS_COLS

        row = tuple("" for _ in ANALYTICS_COLS)
        conn, _ = self._make_mock_conn([row])

        repo._load_analytics_via_pg(conn)
        conn.close.assert_called_once()

    def test_closes_conn_on_exception(self, repo):
        """conn.close() is still called if fetchall raises."""
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__ = lambda s: s
        cur.__exit__ = MagicMock(return_value=False)
        cur.fetchall.side_effect = Exception("DB error")
        conn.cursor.return_value = cur

        with pytest.raises(Exception, match="DB error"):
            repo._load_analytics_via_pg(conn)

        conn.close.assert_called_once()

    def test_returns_correct_row_count(self, repo):
        """150 rows → 150 ImmigrationCase objects."""
        from immi_case_downloader.supabase_repository import ANALYTICS_COLS

        rows = [tuple("" for _ in ANALYTICS_COLS) for _ in range(150)]
        conn, _ = self._make_mock_conn(rows)

        result = repo._load_analytics_via_pg(conn)
        assert len(result) == 150
