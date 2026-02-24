"""Supabase (PostgreSQL) backed CaseRepository with native FTS."""

import logging
import os

from dotenv import load_dotenv
from supabase import create_client, Client

from .models import ImmigrationCase
from .storage import CASE_FIELDS

logger = logging.getLogger(__name__)

# Fields that can be updated via the web interface (CWE-915 prevention).
ALLOWED_UPDATE_FIELDS = frozenset({
    "citation", "title", "court", "court_code", "date", "year", "url",
    "judges", "catchwords", "outcome", "visa_type", "legislation",
    "text_snippet", "user_notes", "tags", "case_nature", "legal_concepts",
})

# Columns safe for ORDER BY (prevent SQL injection via sort parameter).
ALLOWED_SORT_COLUMNS = frozenset({"year", "date", "title", "court", "citation"})
ALLOWED_COUNT_MODES = frozenset({"exact", "planned", "estimated"})

TABLE = "immigration_cases"
BATCH_SIZE = 500
PAGE_MAX = 1000


class SupabaseRepository:
    """Supabase-backed case repository with PostgreSQL native FTS.

    Uses the Supabase Python SDK (postgrest) for CRUD and .rpc() for
    aggregation queries that require GROUP BY / DISTINCT / scoring.
    """

    def __init__(self, url: str | None = None, key: str | None = None,
                 output_dir: str | None = None):
        load_dotenv()
        url = url or os.environ.get("SUPABASE_URL", "")
        key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
                "(via env vars or constructor args)."
            )
        self._client: Client = create_client(url, key)
        self._output_dir = output_dir or os.environ.get(
            "OUTPUT_DIR", "downloaded_cases"
        )

    # ── Core CRUD ────────────────────────────────────────────────────

    def load_all(self) -> list[ImmigrationCase]:
        """Load all cases via paginated requests (PAGE_MAX per call)."""
        cols = ",".join(self._get_table_columns())
        cases: list[ImmigrationCase] = []
        offset = 0
        while True:
            resp = (
                self._client.table(TABLE)
                .select(cols)
                .range(offset, offset + PAGE_MAX - 1)
                .execute()
            )
            if not resp.data:
                break
            cases.extend(self._row_to_case(r) for r in resp.data)
            if len(resp.data) < PAGE_MAX:
                break
            offset += PAGE_MAX
        return cases

    def get_by_id(self, case_id: str) -> ImmigrationCase | None:
        cols = ",".join(self._get_table_columns())
        resp = (
            self._client.table(TABLE)
            .select(cols)
            .eq("case_id", case_id)
            .maybe_single()
            .execute()
        )
        return self._row_to_case(resp.data) if resp.data else None

    def save_many(self, cases: list[ImmigrationCase]) -> int:
        """Upsert cases in batches. Returns count of rows processed.

        Automatically detects which CASE_FIELDS columns exist in the
        remote table and only sends those, avoiding PGRST204 errors
        when the schema is missing newly-added columns.
        """
        cols = self._get_table_columns()
        count = 0
        batch: list[dict] = []
        for case in cases:
            case.ensure_id()
            d = case.to_dict()
            row = {col: d.get(col, "") for col in cols}
            batch.append(row)
            if len(batch) >= BATCH_SIZE:
                self._upsert_batch(batch)
                count += len(batch)
                batch.clear()
        if batch:
            self._upsert_batch(batch)
            count += len(batch)
        return count

    def _get_table_columns(self) -> list[str]:
        """Return the subset of CASE_FIELDS that exist in the remote table.

        Probes the table with a LIMIT 0 select to discover the schema,
        then caches the result for the lifetime of this instance.
        """
        if hasattr(self, "_cached_columns"):
            return self._cached_columns

        resp = (
            self._client.table(TABLE)
            .select("*")
            .limit(1)
            .execute()
        )
        if resp.data:
            remote_cols = set(resp.data[0].keys())
        else:
            # Empty table — assume all CASE_FIELDS are present
            remote_cols = set(CASE_FIELDS)

        cols = [c for c in CASE_FIELDS if c in remote_cols]
        missing = set(CASE_FIELDS) - remote_cols
        if missing:
            logger.warning(
                "Supabase table missing columns (skipped): %s. "
                "Add them via Dashboard SQL Editor: %s",
                missing,
                "; ".join(
                    f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS {c} TEXT"
                    for c in sorted(missing)
                ),
            )
        self._cached_columns = cols
        return cols

    def _upsert_batch(self, batch: list[dict]) -> None:
        """Upsert a single batch to Supabase."""
        self._client.table(TABLE).upsert(
            batch, on_conflict="case_id"
        ).execute()

    def update(self, case_id: str, updates: dict) -> bool:
        """Update fields of an existing case. Only ALLOWED_UPDATE_FIELDS accepted."""
        safe = {k: v for k, v in updates.items() if k in ALLOWED_UPDATE_FIELDS}
        if not safe:
            return False
        resp = (
            self._client.table(TABLE)
            .update(safe)
            .eq("case_id", case_id)
            .execute()
        )
        return bool(resp.data)

    def delete(self, case_id: str) -> bool:
        resp = (
            self._client.table(TABLE)
            .delete()
            .eq("case_id", case_id)
            .execute()
        )
        return bool(resp.data)

    def add(self, case: ImmigrationCase) -> ImmigrationCase:
        case.source = case.source or "Manual Entry"
        case.ensure_id()
        self.save_many([case])
        return case

    # ── Query helpers ────────────────────────────────────────────────

    def get_statistics(self) -> dict:
        """Compute dashboard statistics via server-side RPC."""
        resp = self._client.rpc("get_case_statistics").execute()
        stats = resp.data
        # Normalise by_year keys to int (PostgreSQL returns text keys)
        if "by_year" in stats and isinstance(stats["by_year"], dict):
            stats["by_year"] = {
                int(k): v for k, v in stats["by_year"].items()
            }
        return stats

    def get_existing_urls(self) -> set[str]:
        resp = self._client.rpc("get_existing_urls").execute()
        urls = resp.data if isinstance(resp.data, list) else []
        return set(urls)

    def filter_cases(
        self,
        court: str = "",
        year: int | None = None,
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
        """Filter, sort, and paginate via a single Supabase API call.

        Uses count="exact" so the response header includes the total
        matching row count without needing a separate COUNT query.

        Note: postgrest-py v2.x returns SyncQueryRequestBuilder from
        .text_search() which only has .execute(), so .order()/.range()
        must precede .text_search() in the chain.
        """
        cols = ",".join(self._get_table_columns())
        query = self._client.table(TABLE).select(cols, count="exact")
        # Apply non-text filters first (eq, ilike stay on SyncSelectRequestBuilder)
        query = self._apply_filters(
            query, court, year, visa_type, source, tag, nature
        )

        # Sort — for "date" use the computed date_sort INTEGER column
        # (YYYYMMDD) so ordering is chronological rather than alphabetical.
        # date_sort is NULL for ~500 rows with empty/unparseable dates;
        # nulls_first=False pushes them to the end regardless of direction.
        if sort_by == "date":
            col = "date_sort"
        else:
            col = sort_by if sort_by in ALLOWED_SORT_COLUMNS else "year"
        desc = sort_dir == "desc"
        query = query.order(col, desc=desc, nullsfirst=False)

        # Paginate
        offset = (max(1, page) - 1) * page_size
        query = query.range(offset, offset + page_size - 1)

        # Apply text_search LAST (returns SyncQueryRequestBuilder)
        if keyword and keyword.strip():
            query = query.text_search(
                "fts", keyword,
                options={"type": "plain", "config": "english"},
            )

        resp = query.execute()
        cases = [self._row_to_case(r) for r in (resp.data or [])]
        total = resp.count if resp.count is not None else len(cases)
        return cases, total

    def list_cases_fast(
        self,
        court: str = "",
        year: int | None = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        sort_by: str = "year",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
        columns: list[str] | None = None,
    ) -> list[ImmigrationCase]:
        """Fetch a page of cases without requesting total count.

        This is intentionally lighter than filter_cases() because it avoids
        COUNT(*) header computation, which can be expensive on large datasets.
        """
        table_columns = self._get_table_columns()
        if columns:
            valid_columns = [c for c in columns if c in table_columns]
            selected_columns = valid_columns or ["case_id"]
        else:
            selected_columns = table_columns

        cols = ",".join(selected_columns)
        query = self._client.table(TABLE).select(cols)
        query = self._apply_filters(
            query, court, year, visa_type, source, tag, nature
        )

        if sort_by == "date":
            col = "date_sort"
        else:
            col = sort_by if sort_by in ALLOWED_SORT_COLUMNS else "year"
        desc = sort_dir == "desc"
        query = query.order(col, desc=desc, nullsfirst=False)

        offset = (max(1, page) - 1) * page_size
        query = query.range(offset, offset + page_size - 1)

        if keyword and keyword.strip():
            query = query.text_search(
                "fts", keyword,
                options={"type": "plain", "config": "english"},
            )

        resp = query.execute()
        return [self._row_to_case(r) for r in (resp.data or [])]

    def count_cases(
        self,
        court: str = "",
        year: int | None = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        count_mode: str = "planned",
    ) -> int:
        """Return count of matching cases with configurable count strategy."""
        mode = (count_mode or "planned").strip().lower()
        if mode not in ALLOWED_COUNT_MODES:
            mode = "planned"

        query = self._client.table(TABLE).select("case_id", count=mode).limit(1)
        query = self._apply_filters(
            query, court, year, visa_type, source, tag, nature
        )
        if keyword and keyword.strip():
            query = query.text_search(
                "fts", keyword,
                options={"type": "plain", "config": "english"},
            )
        resp = query.execute()
        return int(resp.count) if resp.count is not None else len(resp.data or [])

    def search_text(self, query: str, limit: int = 50) -> list[ImmigrationCase]:
        """PostgreSQL native full-text search via tsvector column."""
        limit = max(1, min(limit, 200))
        if not query or not query.strip():
            return []
        # .limit() must come BEFORE .text_search() — postgrest-py v2.x
        # returns SyncQueryRequestBuilder from .text_search() which only has .execute().
        cols = ",".join(self._get_table_columns())
        resp = (
            self._client.table(TABLE)
            .select(cols)
            .limit(limit)
            .text_search("fts", query, options={"type": "plain", "config": "english"})
            .execute()
        )
        return [self._row_to_case(r) for r in (resp.data or [])]

    def find_related(self, case_id: str, limit: int = 5) -> list[ImmigrationCase]:
        """Find related cases via server-side RPC with scoring."""
        limit = max(1, min(limit, 20))
        case = self.get_by_id(case_id)
        if not case:
            return []

        resp = self._client.rpc("find_related_cases", {
            "p_case_id": case_id,
            "p_case_nature": case.case_nature or "",
            "p_visa_type": case.visa_type or "",
            "p_court_code": case.court_code or "",
            "p_limit": limit,
        }).execute()
        return [self._row_to_case(r) for r in (resp.data or [])]

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

    def get_filter_options(self) -> dict:
        """Retrieve dropdown options via server-side RPC."""
        resp = self._client.rpc("get_case_filter_options").execute()
        opts = resp.data

        # Split comma-separated tags into a deduplicated sorted list
        all_tags: set[str] = set()
        for raw in (opts.get("tags_raw") or []):
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

    def get_case_full_text(self, case: ImmigrationCase) -> str | None:
        """Read the full text file locally (not stored in Supabase)."""
        from .storage import get_case_full_text
        return get_case_full_text(case, base_dir=self._output_dir)

    # ── Internal helpers ─────────────────────────────────────────────

    @staticmethod
    def _apply_filters(query, court, year, visa_type, source, tag, nature):
        """Apply non-text-search filter chain to a Supabase query builder.

        text_search is handled separately in filter_cases() because
        postgrest-py v2.x .text_search() returns SyncQueryRequestBuilder
        which only supports .execute() — no .order()/.range()/.limit().
        """
        if court:
            query = query.eq("court_code", court)
        if year is not None:
            query = query.eq("year", year)
        if visa_type:
            query = query.ilike("visa_type", f"%{visa_type}%")
        if source:
            query = query.eq("source", source)
        if tag:
            query = query.ilike("tags", f"%{tag}%")
        if nature:
            query = query.eq("case_nature", nature)
        return query

    @staticmethod
    def _row_to_case(row: dict) -> ImmigrationCase:
        """Convert a Supabase row dict to ImmigrationCase."""
        return ImmigrationCase.from_dict(row)
