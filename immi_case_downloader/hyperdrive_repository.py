"""PostgreSQL repository via Cloudflare Hyperdrive (psycopg2).

Used inside Cloudflare Containers where the Supabase REST API is unreachable
due to DNS resolution failures in the container's network environment.
Hyperdrive provides an internal Cloudflare connection string that routes
through Cloudflare's edge without requiring external DNS resolution.

Usage: automatically selected by create_app() when HYPERDRIVE_DATABASE_URL is set.
"""

import json
import logging
import threading
from typing import Optional

import psycopg2
import psycopg2.extras

from .models import ImmigrationCase
from .storage import CASE_FIELDS

logger = logging.getLogger(__name__)

TABLE = "immigration_cases"
ALLOWED_SORT_COLUMNS = frozenset({
    "year", "date", "title", "court", "citation", "outcome",
    "visa_subclass_number", "applicant_name", "hearing_date", "case_id",
})
ALLOWED_UPDATE_FIELDS = frozenset({
    "citation", "title", "court", "court_code", "date", "year", "url",
    "judges", "catchwords", "outcome", "visa_type", "legislation",
    "text_snippet", "user_notes", "tags", "case_nature", "legal_concepts",
})
ANALYTICS_COLS = [
    "court_code", "year", "outcome", "judges",
    "case_nature", "legal_concepts", "visa_subclass",
]

# All columns as a safe SQL fragment (derived from the CASE_FIELDS allowlist).
_ALL_COLS = ", ".join(CASE_FIELDS)
_ANALYTICS_COLS_SQL = ", ".join(ANALYTICS_COLS)


class HyperdriveRepository:
    """Direct PostgreSQL repository via Cloudflare Hyperdrive.

    Uses psycopg2 with thread-local connections so each Flask worker thread
    has its own dedicated connection to the Hyperdrive proxy.  All SQL is
    parametrised — no string interpolation of user-supplied values.

    Replicates the same public API as SupabaseRepository so the rest of
    the application needs zero changes when this backend is selected.
    """

    supports_seek_pagination = True
    pagination_backend_kind = "hyperdrive"

    def __init__(self, connection_string: str, output_dir: str = "downloaded_cases"):
        self._conn_str = connection_string
        self._output_dir = output_dir
        self._local = threading.local()

    # ── Connection management ─────────────────────────────────────────

    def _conn(self) -> psycopg2.extensions.connection:
        """Return a healthy thread-local psycopg2 connection."""
        conn = getattr(self._local, "conn", None)
        if conn is None or conn.closed:
            conn = self._new_conn()
        else:
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
                conn = self._new_conn()
        return conn

    def _new_conn(self) -> psycopg2.extensions.connection:
        conn = psycopg2.connect(self._conn_str)
        conn.autocommit = True
        self._local.conn = conn
        logger.debug("Hyperdrive: opened new psycopg2 connection on thread %s", threading.get_ident())
        return conn

    # ── Query helpers ─────────────────────────────────────────────────

    def _exec(self, sql: str, params=None) -> list[dict]:
        """Execute SQL and return rows as a list of dicts."""
        with self._conn().cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def _exec_json_fn(self, fn_call: str, params=None):
        """Call a scalar JSON-returning PostgreSQL function and return parsed value."""
        with self._conn().cursor() as cur:
            cur.execute(f"SELECT {fn_call} AS result", params)
            row = cur.fetchone()
            if not row:
                return None
            value = row[0]
            if isinstance(value, str):
                return json.loads(value)
            return value  # psycopg2 may already deserialise JSON to dict/list

    def _exec_count(self, sql: str, params=None) -> int:
        with self._conn().cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def _exec_write(self, sql: str, params=None) -> int:
        """Execute a write statement and return affected rowcount."""
        with self._conn().cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount

    @staticmethod
    def _row_to_case(row: dict) -> ImmigrationCase:
        return ImmigrationCase.from_dict(row)

    @staticmethod
    def _build_where(
        court: str,
        year: Optional[int],
        visa_type: str,
        source: str,
        tag: str,
        nature: str,
        keyword: str,
    ) -> tuple[str, list]:
        """Build a parametrised WHERE clause from filter arguments."""
        conditions: list[str] = []
        params: list = []

        if court:
            conditions.append("court_code = %s")
            params.append(court)
        if year is not None:
            conditions.append("year = %s")
            params.append(year)
        if visa_type:
            conditions.append("visa_type ILIKE %s")
            params.append(f"%{visa_type}%")
        if source:
            conditions.append("source = %s")
            params.append(source)
        if tag:
            conditions.append("tags ILIKE %s")
            params.append(f"%{tag}%")
        if nature:
            conditions.append("case_nature = %s")
            params.append(nature)
        if keyword and keyword.strip():
            conditions.append("fts @@ plainto_tsquery('english', %s)")
            params.append(keyword.strip())

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        return where, params

    # ── Core CRUD ────────────────────────────────────────────────────

    def load_all(self) -> list[ImmigrationCase]:
        rows = self._exec(f"SELECT {_ALL_COLS} FROM {TABLE}")
        return [self._row_to_case(r) for r in rows]

    def load_analytics_cases(self) -> list[ImmigrationCase]:
        rows = self._exec(f"SELECT {_ANALYTICS_COLS_SQL} FROM {TABLE}")
        logger.info("Hyperdrive analytics load: %d rows via direct SQL", len(rows))
        return [self._row_to_case(r) for r in rows]

    def get_by_id(self, case_id: str) -> Optional[ImmigrationCase]:
        rows = self._exec(
            f"SELECT {_ALL_COLS} FROM {TABLE} WHERE case_id = %s LIMIT 1",
            (case_id,),
        )
        return self._row_to_case(rows[0]) if rows else None

    def save_many(self, cases: list[ImmigrationCase]) -> int:
        if not cases:
            return 0

        cols = CASE_FIELDS
        col_list = ", ".join(cols)
        placeholders = ", ".join(["%s"] * len(cols))
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "case_id")
        sql = (
            f"INSERT INTO {TABLE} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT (case_id) DO UPDATE SET {updates}"
        )

        count = 0
        with self._conn().cursor() as cur:
            for case in cases:
                case.ensure_id()
                d = case.to_dict()
                cur.execute(sql, tuple(d.get(c, "") or None for c in cols))
                count += 1
        return count

    def update(self, case_id: str, updates: dict) -> bool:
        safe = {k: v for k, v in updates.items() if k in ALLOWED_UPDATE_FIELDS}
        if not safe:
            return False
        set_clause = ", ".join(f"{k} = %s" for k in safe)
        params = list(safe.values()) + [case_id]
        affected = self._exec_write(
            f"UPDATE {TABLE} SET {set_clause} WHERE case_id = %s",
            params,
        )
        return affected > 0

    def delete(self, case_id: str) -> bool:
        return self._exec_write(
            f"DELETE FROM {TABLE} WHERE case_id = %s", (case_id,)
        ) > 0

    def add(self, case: ImmigrationCase) -> ImmigrationCase:
        case.source = case.source or "Manual Entry"
        case.ensure_id()
        self.save_many([case])
        return case

    # ── Statistics & filter options ──────────────────────────────────

    def get_statistics(self) -> dict:
        """Invoke the existing get_case_statistics() PostgreSQL function."""
        stats = self._exec_json_fn("get_case_statistics()") or {}
        if isinstance(stats, dict) and "by_year" in stats:
            stats["by_year"] = {int(k): v for k, v in stats["by_year"].items()}
        return stats

    def get_filter_options(self) -> dict:
        """Invoke the existing get_case_filter_options() PostgreSQL function."""
        opts = self._exec_json_fn("get_case_filter_options()") or {}

        all_tags: set[str] = set()
        for raw in opts.get("tags_raw") or []:
            if raw:
                for t in str(raw).split(","):
                    t = t.strip()
                    if t:
                        all_tags.add(t)

        return {
            "courts": opts.get("courts") or [],
            "years": opts.get("years") or [],
            "sources": opts.get("sources") or [],
            "natures": opts.get("natures") or [],
            "visa_types": opts.get("visa_types") or [],
            "tags": sorted(all_tags),
        }

    def get_existing_urls(self) -> set[str]:
        """Invoke the existing get_existing_urls() PostgreSQL function."""
        result = self._exec_json_fn("get_existing_urls()") or []
        if isinstance(result, list):
            return {u for u in result if isinstance(u, str)}
        return set()

    # ── Listing / search ─────────────────────────────────────────────

    def filter_cases(
        self,
        court: str = "",
        year: Optional[int] = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        sort_by: str = "year",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[ImmigrationCase], int]:
        where, params = self._build_where(court, year, visa_type, source, tag, nature, keyword)
        col = sort_by if sort_by in ALLOWED_SORT_COLUMNS else "year"
        direction = "DESC" if sort_dir == "desc" else "ASC"
        offset = (max(1, page) - 1) * page_size

        total = self._exec_count(f"SELECT COUNT(*) FROM {TABLE} {where}", params)
        rows = self._exec(
            f"SELECT {_ALL_COLS} FROM {TABLE} {where} "
            f"ORDER BY {col} {direction} LIMIT %s OFFSET %s",
            params + [page_size, offset],
        )
        return [self._row_to_case(r) for r in rows], total

    def list_cases_fast(
        self,
        court: str = "",
        year: Optional[int] = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        sort_by: str = "year",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
        columns: Optional[list[str]] = None,
    ) -> list[ImmigrationCase]:
        valid = [c for c in (columns or []) if c in CASE_FIELDS] or CASE_FIELDS
        cols_sql = ", ".join(valid)
        where, params = self._build_where(court, year, visa_type, source, tag, nature, keyword)
        col = sort_by if sort_by in ALLOWED_SORT_COLUMNS else "year"
        direction = "DESC" if sort_dir == "desc" else "ASC"
        offset = (max(1, page) - 1) * page_size
        rows = self._exec(
            f"SELECT {cols_sql} FROM {TABLE} {where} "
            f"ORDER BY {col} {direction} LIMIT %s OFFSET %s",
            params + [page_size, offset],
        )
        return [self._row_to_case(r) for r in rows]

    def list_cases_seek(
        self,
        court: str = "",
        year: Optional[int] = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        sort_by: str = "year",
        sort_dir: str = "desc",
        page_size: int = 50,
        anchor: dict[str, str | int] | None = None,
        reverse: bool = False,
        columns: Optional[list[str]] = None,
    ) -> list[ImmigrationCase]:
        """Fetch a page using seek pagination on `(year, case_id)`."""
        if keyword and keyword.strip():
            raise ValueError("Seek pagination does not support keyword queries")
        if sort_by not in {"year", "date"}:
            raise ValueError(f"Seek pagination does not support sort_by='{sort_by}'")

        valid = [c for c in (columns or []) if c in CASE_FIELDS] or CASE_FIELDS
        for required in ("case_id", "year"):
            if required not in valid:
                valid.append(required)
        cols_sql = ", ".join(valid)
        where, params = self._build_where(court, year, visa_type, source, tag, nature, keyword)

        descending = sort_dir == "desc"
        effective_desc = not descending if reverse else descending
        comparator = "<" if effective_desc else ">"
        direction = "DESC" if effective_desc else "ASC"

        if anchor and anchor.get("case_id"):
            where = (
                f"{where} AND ((year {comparator} %s) "
                f"OR (year = %s AND case_id {comparator} %s))"
            )
            anchor_year = int(anchor.get("year") or 0)
            anchor_case_id = str(anchor.get("case_id") or "")
            params = params + [anchor_year, anchor_year, anchor_case_id]

        rows = self._exec(
            f"SELECT {cols_sql} FROM {TABLE} {where} "
            f"ORDER BY year {direction}, case_id {direction} LIMIT %s",
            params + [page_size],
        )
        return [self._row_to_case(r) for r in rows]

    def count_cases(
        self,
        court: str = "",
        year: Optional[int] = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        count_mode: str = "planned",  # ignored — always exact in SQL
    ) -> int:
        where, params = self._build_where(court, year, visa_type, source, tag, nature, keyword)
        return self._exec_count(f"SELECT COUNT(*) FROM {TABLE} {where}", params)

    def search_text(self, query: str, limit: int = 50) -> list[ImmigrationCase]:
        if not query or not query.strip():
            return []
        limit = max(1, min(limit, 200))
        rows = self._exec(
            f"SELECT {_ALL_COLS} FROM {TABLE} "
            f"WHERE fts @@ plainto_tsquery('english', %s) LIMIT %s",
            (query.strip(), limit),
        )
        return [self._row_to_case(r) for r in rows]

    def find_related(self, case_id: str, limit: int = 5) -> list[ImmigrationCase]:
        limit = max(1, min(limit, 20))
        case = self.get_by_id(case_id)
        if not case:
            return []
        rows = self._exec(
            "SELECT * FROM find_related_cases(%s, %s, %s, %s, %s)",
            (case_id, case.case_nature or "", case.visa_type or "",
             case.court_code or "", limit),
        )
        return [self._row_to_case(r) for r in rows]

    # ── Analytics ─────────────────────────────────────────────────────

    def get_analytics_outcomes(self) -> list[dict]:
        """Call the split analytics outcome stored procedures."""
        rows: list[dict] = []
        for r in self._exec("SELECT * FROM get_analytics_outcomes_court()"):
            rows.append({"group_type": "court", "group_key": r["court_code"],
                         "outcome": r["outcome"], "cnt": r["cnt"]})
        for r in self._exec("SELECT * FROM get_analytics_outcomes_year()"):
            rows.append({"group_type": "year", "group_key": r["year_key"],
                         "outcome": r["outcome"], "cnt": r["cnt"]})
        for r in self._exec("SELECT * FROM get_analytics_outcomes_visa() LIMIT 5000"):
            rows.append({"group_type": "visa_subclass", "group_key": r["visa_subclass"],
                         "outcome": r["outcome"], "cnt": r["cnt"]})
        return rows

    def get_analytics_judges_raw(self) -> list[dict]:
        return self._exec("SELECT * FROM get_analytics_judges_raw() LIMIT 3000")

    def get_analytics_concepts_raw(self) -> list[dict]:
        return self._exec("SELECT * FROM get_analytics_concepts_raw() LIMIT 2000")

    def get_analytics_nature_outcome(self) -> list[dict]:
        return self._exec("SELECT * FROM get_analytics_nature_outcome()")

    # ── Export helpers ────────────────────────────────────────────────

    def get_case_full_text(self, case: ImmigrationCase) -> Optional[str]:
        from .storage import get_case_full_text
        return get_case_full_text(case, base_dir=self._output_dir)

    def export_csv_rows(self) -> list[dict]:
        return [c.to_dict() for c in self.load_all()]

    def export_json(self) -> dict:
        cases = self.load_all()
        return {
            "total_cases": len(cases),
            "courts": sorted({c.court for c in cases if c.court}),
            "year_range": {
                "min": min((c.year for c in cases if c.year), default=0),
                "max": max((c.year for c in cases if c.year), default=0),
            },
            "cases": [c.to_dict() for c in cases],
        }

    def close(self) -> None:
        """Close the thread-local connection if open."""
        conn = getattr(self._local, "conn", None)
        if conn and not conn.closed:
            try:
                conn.close()
            except Exception:
                pass
