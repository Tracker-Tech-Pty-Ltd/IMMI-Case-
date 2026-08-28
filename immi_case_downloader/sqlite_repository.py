"""SQLite-backed CaseRepository with FTS5 full-text search."""

import os
import sqlite3
import threading
import logging
from datetime import datetime

from .models import ImmigrationCase
from .storage import CASE_FIELDS, TOP_VISA_SUBCLASS_LIMIT

logger = logging.getLogger(__name__)

# Fields that can be updated via the web interface (CWE-915 prevention).
ALLOWED_UPDATE_FIELDS = frozenset({
    "citation", "title", "court", "court_code", "date", "year", "url",
    "judges", "catchwords", "outcome", "visa_type", "legislation",
    "text_snippet", "user_notes", "tags", "case_nature", "legal_concepts",
})
ALLOWED_SORT_COLUMNS = frozenset({
    "year", "date", "title", "court", "citation", "outcome",
    "visa_subclass_number", "applicant_name", "hearing_date", "case_id",
})

# _CASES_TABLE_SQL, _INDEX_STATEMENTS, _FTS_STATEMENTS and _TRIGGER_STATEMENTS
# are the single source of truth. _SCHEMA_SQL / _FTS_SQL / _TRIGGERS_SQL below
# are built from them so initialize() keeps working unchanged. The migration
# in _rebuild_cases_without_url_unique() runs each statement individually via
# conn.execute() — executescript() issues an implicit COMMIT before it runs,
# which would end the migration's transaction early — so the statements must
# also exist as a list, not just as one script string.
_CASES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS {table} (
    case_id TEXT PRIMARY KEY,
    citation TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    court TEXT NOT NULL DEFAULT '',
    court_code TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '',
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
"""

_INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_court_code ON cases(court_code)",
    "CREATE INDEX IF NOT EXISTS idx_year ON cases(year)",
    "CREATE INDEX IF NOT EXISTS idx_court_year ON cases(court_code, year)",
    "CREATE INDEX IF NOT EXISTS idx_source ON cases(source)",
    "CREATE INDEX IF NOT EXISTS idx_outcome ON cases(outcome)",
    "CREATE INDEX IF NOT EXISTS idx_case_nature ON cases(case_nature)",
    "CREATE INDEX IF NOT EXISTS idx_visa_type ON cases(visa_type)",
    "CREATE INDEX IF NOT EXISTS idx_visa_subclass_number ON cases(visa_subclass_number)",
    "CREATE INDEX IF NOT EXISTS idx_court_outcome ON cases(court_code, outcome)",
    # Partial unique index: real URLs stay unique, blank URLs are exempt.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_url_unique ON cases(url) WHERE url != ''",
]
_INDEXES_SQL = ";\n".join(_INDEX_STATEMENTS) + ";\n"

_SCHEMA_SQL = _CASES_TABLE_SQL.format(table="cases") + _INDEXES_SQL

_FTS_STATEMENTS = [
    """CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(
    citation, title, catchwords, judges, outcome,
    user_notes, case_nature, legal_concepts,
    content='cases', content_rowid='rowid'
)""",
]
_FTS_SQL = ";\n".join(_FTS_STATEMENTS) + ";\n"

_TRIGGER_STATEMENTS = [
    """CREATE TRIGGER IF NOT EXISTS cases_ai AFTER INSERT ON cases BEGIN
    INSERT INTO cases_fts(rowid, citation, title, catchwords, judges, outcome, user_notes, case_nature, legal_concepts)
    VALUES (new.rowid, new.citation, new.title, new.catchwords, new.judges, new.outcome, new.user_notes, new.case_nature, new.legal_concepts);
END""",
    """CREATE TRIGGER IF NOT EXISTS cases_ad AFTER DELETE ON cases BEGIN
    INSERT INTO cases_fts(cases_fts, rowid, citation, title, catchwords, judges, outcome, user_notes, case_nature, legal_concepts)
    VALUES ('delete', old.rowid, old.citation, old.title, old.catchwords, old.judges, old.outcome, old.user_notes, old.case_nature, old.legal_concepts);
END""",
    """CREATE TRIGGER IF NOT EXISTS cases_au AFTER UPDATE ON cases BEGIN
    INSERT INTO cases_fts(cases_fts, rowid, citation, title, catchwords, judges, outcome, user_notes, case_nature, legal_concepts)
    VALUES ('delete', old.rowid, old.citation, old.title, old.catchwords, old.judges, old.outcome, old.user_notes, old.case_nature, old.legal_concepts);
    INSERT INTO cases_fts(rowid, citation, title, catchwords, judges, outcome, user_notes, case_nature, legal_concepts)
    VALUES (new.rowid, new.citation, new.title, new.catchwords, new.judges, new.outcome, new.user_notes, new.case_nature, new.legal_concepts);
END""",
]
_TRIGGERS_SQL = ";\n".join(_TRIGGER_STATEMENTS) + ";\n"


class SqliteRepository:
    """SQLite-backed case repository with FTS5 full-text search.

    Uses thread-local connections (one connection per thread) with WAL mode
    for safe concurrent reads from background job threads.
    """

    supports_seek_pagination = True
    pagination_backend_kind = "sqlite"
    # COUNT(*) here is always exact (see count_cases), so total_pages and the
    # final page's size can be derived from it. Backends whose totals are
    # planner estimates (Supabase) must leave this False.
    counts_are_exact = True

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
        self._all_conns: list[sqlite3.Connection] = []
        self._all_conns_lock = threading.Lock()
        self.initialize()

    def _conn(self) -> sqlite3.Connection:
        """Get or create a thread-local connection."""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, timeout=10)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
            with self._all_conns_lock:
                self._all_conns.append(conn)
        return conn

    def close(self):
        """Close every connection this repository can close from this thread.

        A connection opened on another thread cannot be closed from here —
        sqlite3's check_same_thread guard raises — so it stays in the tracking
        list to be closed by its own thread (or at interpreter exit) instead of
        being silently forgotten while still open. This matters because a Flask
        `teardown_appcontext` pop can run this from a worker thread; clearing
        the list unconditionally leaked the request thread's connection.
        """
        with self._all_conns_lock:
            still_open = []
            for conn in self._all_conns:
                try:
                    conn.close()
                except Exception:
                    still_open.append(conn)
            self._all_conns[:] = still_open
        own = getattr(self._local, "conn", None)
        if own is None or own not in still_open:
            self._local.conn = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            # Destructors must not raise during interpreter shutdown.
            pass

    def initialize(self):
        """Create tables, indexes, FTS, and triggers if they don't exist."""
        conn = self._conn()
        conn.executescript(_SCHEMA_SQL)
        conn.executescript(_FTS_SQL)
        conn.executescript(_TRIGGERS_SQL)
        conn.commit()
        if self._has_legacy_url_unique(conn):
            self._rebuild_cases_without_url_unique(conn)

    @staticmethod
    def _has_legacy_url_unique(conn: sqlite3.Connection) -> bool:
        """True when `cases.url` still carries the old table-level UNIQUE.

        SQLite implements an inline UNIQUE as an auto-index with origin 'u';
        the replacement partial index has origin 'c'. That is the discriminator.
        """
        for row in conn.execute("PRAGMA index_list('cases')").fetchall():
            if row["origin"] != "u":
                continue
            cols = [
                r["name"]
                for r in conn.execute(f'PRAGMA index_info("{row["name"]}")').fetchall()
            ]
            if cols == ["url"]:
                return True
        return False

    def _rebuild_cases_without_url_unique(self, conn: sqlite3.Connection) -> None:
        """One-time migration: drop the table-level UNIQUE on `cases.url`.

        Blank URLs are an expected state, and the inline UNIQUE made a second
        URL-less case raise IntegrityError. Runs once per database; the
        detection in _has_legacy_url_unique() makes it a no-op afterwards.

        Everything happens inside one explicit transaction that is committed
        only after the new table, indexes, triggers and FTS content have been
        verified. Any failure rolls the whole thing back and re-raises, leaving
        the database exactly as it was.
        """
        cols = ", ".join(CASE_FIELDS)
        before = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        want_indexes = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND tbl_name='cases' AND name IS NOT NULL AND sql IS NOT NULL"
            )
        }
        backup_path = self._backup_before_migration(before)
        logger.warning(
            "Migrating SQLite schema at %s: dropping the legacy UNIQUE on "
            "cases.url (%d rows). Backup: %s. This runs once.",
            self.db_path, before, backup_path,
        )

        conn.execute("BEGIN IMMEDIATE")
        try:
            for trigger in ("cases_ai", "cases_ad", "cases_au"):
                conn.execute(f"DROP TRIGGER IF EXISTS {trigger}")
            conn.execute("DROP TABLE IF EXISTS cases_migrated")
            # One statement, via execute() — executescript() would commit here.
            conn.execute(_CASES_TABLE_SQL.format(table="cases_migrated").strip().rstrip(";"))
            conn.execute(
                f"INSERT INTO cases_migrated ({cols}) SELECT {cols} FROM cases"
            )
            after = conn.execute("SELECT COUNT(*) FROM cases_migrated").fetchone()[0]
            if after != before:
                raise RuntimeError(
                    f"row count mismatch during migration: {before} -> {after}"
                )
            conn.execute("DROP TABLE cases")
            conn.execute("ALTER TABLE cases_migrated RENAME TO cases")

            # Indexes, FTS and triggers went with the dropped table. Recreate
            # them INSIDE the transaction so a failure here rolls back too.
            for statement in _INDEX_STATEMENTS:
                conn.execute(statement)
            for statement in _FTS_STATEMENTS:
                conn.execute(statement)
            for statement in _TRIGGER_STATEMENTS:
                conn.execute(statement)
            conn.execute("INSERT INTO cases_fts(cases_fts) VALUES('rebuild')")

            # Verify before committing, not after.
            got_indexes = {
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    "AND tbl_name='cases' AND name IS NOT NULL AND sql IS NOT NULL"
                )
            }
            missing = want_indexes - got_indexes - {"sqlite_autoindex_cases_1"}
            if missing:
                raise RuntimeError(f"indexes lost during migration: {sorted(missing)}")
            triggers = {
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='trigger'"
                )
            }
            if not {"cases_ai", "cases_ad", "cases_au"} <= triggers:
                raise RuntimeError(f"triggers lost during migration: {sorted(triggers)}")
            final = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
            if final != before:
                raise RuntimeError(f"row count mismatch after swap: {before} -> {final}")
            if self._has_legacy_url_unique(conn):
                raise RuntimeError("legacy UNIQUE on cases.url survived the rebuild")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            logger.error(
                "SQLite url-UNIQUE migration rolled back; schema unchanged. "
                "Pre-migration backup is at %s", backup_path,
            )
            raise

        problem = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if problem != "ok":
            logger.error(
                "PRAGMA integrity_check after migration returned %r. The "
                "pre-migration backup is at %s", problem, backup_path,
            )
            raise RuntimeError(f"integrity_check failed after migration: {problem}")
        logger.warning(
            "SQLite url-UNIQUE migration complete: %d rows, integrity_check ok. "
            "Backup kept at %s — delete it once you are satisfied.",
            before, backup_path,
        )

    def _backup_before_migration(self, row_count: int) -> str:
        """Copy the database file aside before the rebuild. Returns the path.

        Fails closed: no free space, or no backup, means no migration. The real
        corpus is ~340 MB, gitignored, and exists only on this machine.
        """
        import shutil

        size = os.path.getsize(self.db_path)
        free = shutil.disk_usage(os.path.dirname(os.path.abspath(self.db_path))).free
        # One file copy plus, briefly, a second copy of the table inside the
        # database itself. 2.5x is the copy + the in-file duplicate + slack.
        needed = int(size * 2.5)
        if free < needed:
            raise RuntimeError(
                f"refusing to migrate {self.db_path}: need ~{needed} bytes free "
                f"for a backup and the table rebuild, have {free}"
            )
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup_path = f"{self.db_path}.pre-url-unique-{stamp}.bak"
        # WAL mode: copy the sidecar files too, or the copy can be stale.
        shutil.copy2(self.db_path, backup_path)
        for suffix in ("-wal", "-shm"):
            sidecar = self.db_path + suffix
            if os.path.exists(sidecar):
                shutil.copy2(sidecar, backup_path + suffix)
        logger.warning(
            "Pre-migration backup of %d rows written to %s", row_count, backup_path
        )
        return backup_path

    @staticmethod
    def _build_case_filters(
        court: str = "",
        year: int | None = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
    ) -> tuple[str, list]:
        where_parts: list[str] = []
        params: list = []

        if court:
            where_parts.append("court_code = ?")
            params.append(court)
        if year is not None:
            where_parts.append("year = ?")
            params.append(year)
        if visa_type:
            where_parts.append("visa_type LIKE ?")
            params.append(f"%{visa_type}%")
        if source:
            where_parts.append("source = ?")
            params.append(source)
        if tag:
            where_parts.append("tags LIKE ?")
            params.append(f"%{tag}%")
        if nature:
            where_parts.append("case_nature = ?")
            params.append(nature)
        if keyword:
            kw_like = f"%{keyword}%"
            where_parts.append(
                "(title LIKE ? OR citation LIKE ? OR catchwords LIKE ? "
                "OR judges LIKE ? OR outcome LIKE ? OR user_notes LIKE ? "
                "OR case_nature LIKE ? OR legal_concepts LIKE ?)"
            )
            params.extend([kw_like] * 8)

        return (" AND ".join(where_parts) if where_parts else "1=1"), params

    @staticmethod
    def _build_sql_order_clause(sort_by: str, sort_dir: str) -> str:
        direction = "DESC" if sort_dir == "desc" else "ASC"
        if sort_by == "date":
            month_num = (
                "CASE "
                "WHEN date LIKE '%January%' THEN 1 "
                "WHEN date LIKE '%February%' THEN 2 "
                "WHEN date LIKE '%March%' THEN 3 "
                "WHEN date LIKE '%April%' THEN 4 "
                "WHEN date LIKE '%May%' THEN 5 "
                "WHEN date LIKE '%June%' THEN 6 "
                "WHEN date LIKE '%July%' THEN 7 "
                "WHEN date LIKE '%August%' THEN 8 "
                "WHEN date LIKE '%September%' THEN 9 "
                "WHEN date LIKE '%October%' THEN 10 "
                "WHEN date LIKE '%November%' THEN 11 "
                "WHEN date LIKE '%December%' THEN 12 "
                "ELSE 0 END"
            )
            return (
                f"ORDER BY CAST(SUBSTR(date, -4) AS INTEGER) {direction}, "
                f"({month_num}) {direction}, "
                f"CAST(date AS INTEGER) {direction}, "
                f"case_id {direction}"
            )
        if sort_by == "case_id":
            return f"ORDER BY case_id {direction}"
        return f"ORDER BY {sort_by} {direction}, case_id {direction}"

    # ── Core CRUD ────────────────────────────────────────────────────

    def load_all(self) -> list[ImmigrationCase]:
        conn = self._conn()
        rows = conn.execute("SELECT * FROM cases").fetchall()
        return [self._row_to_case(r) for r in rows]

    def get_by_id(self, case_id: str) -> ImmigrationCase | None:
        conn = self._conn()
        row = conn.execute("SELECT * FROM cases WHERE case_id = ?", (case_id,)).fetchone()
        return self._row_to_case(row) if row else None

    def save_many(self, cases: list[ImmigrationCase]) -> int:
        """Upsert multiple cases. Returns count of affected rows."""
        conn = self._conn()
        cols = CASE_FIELDS
        placeholders = ", ".join("?" for _ in cols)
        updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "case_id")
        sql = (
            f"INSERT INTO cases ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT(case_id) DO UPDATE SET {updates}"
        )
        count = 0
        # Batch in chunks of 500 for memory efficiency
        batch = []
        try:
            for case in cases:
                case.ensure_id()
                d = case.to_dict()
                batch.append(tuple(d.get(c, "") for c in cols))
                if len(batch) >= 500:
                    conn.executemany(sql, batch)
                    count += len(batch)
                    batch.clear()
            if batch:
                conn.executemany(sql, batch)
                count += len(batch)
            conn.commit()
        except Exception:
            # Without this the implicit transaction stays open holding a partial
            # write, which the next unrelated commit on this thread flushes.
            conn.rollback()
            raise
        return count

    def update(self, case_id: str, updates: dict) -> bool:
        """Update fields of an existing case. Only ALLOWED_UPDATE_FIELDS accepted."""
        safe_updates = {k: v for k, v in updates.items() if k in ALLOWED_UPDATE_FIELDS}
        if not safe_updates:
            return False
        conn = self._conn()
        sets = ", ".join(f"{k} = ?" for k in safe_updates)
        vals = list(safe_updates.values()) + [case_id]
        cur = conn.execute(f"UPDATE cases SET {sets} WHERE case_id = ?", vals)
        conn.commit()
        return cur.rowcount > 0

    def delete(self, case_id: str) -> bool:
        conn = self._conn()
        cur = conn.execute("DELETE FROM cases WHERE case_id = ?", (case_id,))
        conn.commit()
        return cur.rowcount > 0

    def add(self, case: ImmigrationCase) -> ImmigrationCase:
        case.source = case.source or "Manual Entry"
        case.ensure_id()
        self.save_many([case])
        return case

    # ── Query helpers ────────────────────────────────────────────────

    def get_statistics(self) -> dict:
        conn = self._conn()
        total = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]

        # Group on court_code, not court: every other backend and every frontend
        # colour map is keyed on the short code (AATA, FCA, ...).
        by_court = {}
        for row in conn.execute(
            "SELECT court_code, COUNT(*) as cnt FROM cases GROUP BY court_code ORDER BY court_code"
        ):
            by_court[row["court_code"] or "Unknown"] = row["cnt"]

        by_year = {}
        for row in conn.execute("SELECT year, COUNT(*) as cnt FROM cases WHERE year > 0 GROUP BY year ORDER BY year"):
            by_year[row["year"]] = row["cnt"]

        by_nature = {}
        for row in conn.execute(
            "SELECT case_nature, COUNT(*) as cnt FROM cases WHERE case_nature != '' "
            "GROUP BY case_nature ORDER BY cnt DESC"
        ):
            by_nature[row["case_nature"]] = row["cnt"]

        # Counts every row, blank source bucketed as "Unknown" — matches storage.get_statistics().
        by_source = {}
        for row in conn.execute(
            "SELECT source, COUNT(*) as cnt FROM cases GROUP BY source ORDER BY cnt DESC"
        ):
            by_source[row["source"] or "Unknown"] = row["cnt"]

        # The secondary sort is load-bearing, not decoration: `ORDER BY cnt DESC`
        # alone leaves ties in an order SQLite may choose freely, so with more
        # tied subclasses than the limit, "the top 20" would be a different 20
        # here than in storage.get_statistics(). Both sides now order by
        # (count descending, subclass ascending).
        by_visa_subclass = {}
        for row in conn.execute(
            "SELECT visa_subclass, COUNT(*) as cnt FROM cases WHERE visa_subclass != '' "
            "GROUP BY visa_subclass ORDER BY cnt DESC, visa_subclass ASC LIMIT ?",
            (TOP_VISA_SUBCLASS_LIMIT,),
        ):
            by_visa_subclass[row["visa_subclass"]] = row["cnt"]

        visa_types = sorted(
            r["visa_type"]
            for r in conn.execute("SELECT DISTINCT visa_type FROM cases WHERE visa_type != ''")
        )

        with_text = conn.execute(
            "SELECT COUNT(*) FROM cases WHERE full_text_path != ''"
        ).fetchone()[0]

        sources = sorted(
            r["source"]
            for r in conn.execute("SELECT DISTINCT source FROM cases WHERE source != ''")
        )

        return {
            "total": total,
            "by_court": dict(sorted(by_court.items())),
            "by_year": dict(sorted(by_year.items())),
            "by_nature": by_nature,
            "by_visa_subclass": by_visa_subclass,
            "by_source": by_source,
            "visa_types": visa_types,
            "with_full_text": with_text,
            "sources": sources,
        }

    def get_existing_urls(self) -> set[str]:
        conn = self._conn()
        return {
            r["url"]
            for r in conn.execute("SELECT url FROM cases WHERE url != ''")
        }

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
        """SQL-level filtering, sorting, and pagination."""
        conn = self._conn()
        where_clause, params = self._build_case_filters(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
        )

        if sort_by not in ALLOWED_SORT_COLUMNS:
            sort_by = "year"
        order_clause = self._build_sql_order_clause(sort_by, sort_dir)

        # Count total matching
        count_sql = f"SELECT COUNT(*) FROM cases WHERE {where_clause}"
        total = conn.execute(count_sql, params).fetchone()[0]

        # Fetch page
        offset = (max(1, page) - 1) * page_size
        data_sql = (
            f"SELECT * FROM cases WHERE {where_clause} "
            f"{order_clause} "
            f"LIMIT ? OFFSET ?"
        )
        rows = conn.execute(data_sql, params + [page_size, offset]).fetchall()
        cases = [self._row_to_case(r) for r in rows]

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
        """Fetch a page without recomputing the total count."""
        conn = self._conn()
        where_clause, params = self._build_case_filters(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
        )
        if sort_by not in ALLOWED_SORT_COLUMNS:
            sort_by = "year"
        order_clause = self._build_sql_order_clause(sort_by, sort_dir)
        valid_columns = [c for c in (columns or []) if c in CASE_FIELDS] or CASE_FIELDS
        cols_sql = ", ".join(valid_columns)
        offset = (max(1, page) - 1) * page_size
        rows = conn.execute(
            f"SELECT {cols_sql} FROM cases WHERE {where_clause} "
            f"{order_clause} LIMIT ? OFFSET ?",
            params + [page_size, offset],
        ).fetchall()
        return [self._row_to_case(r) for r in rows]

    def count_cases(
        self,
        court: str = "",
        year: int | None = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        count_mode: str = "planned",  # accepted for interface compatibility; SQLite COUNT(*) is always exact
    ) -> int:
        """Return the exact count for the matching SQLite rows.

        ``count_mode`` is ignored: SQLite COUNT(*) is always exact regardless of mode.
        """
        _ = count_mode
        conn = self._conn()
        where_clause, params = self._build_case_filters(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
        )
        row = conn.execute(
            f"SELECT COUNT(*) FROM cases WHERE {where_clause}",
            params,
        ).fetchone()
        return int(row[0]) if row else 0

    def list_cases_seek(
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
        page_size: int = 50,
        anchor: dict[str, str | int] | None = None,
        reverse: bool = False,
        columns: list[str] | None = None,
    ) -> list[ImmigrationCase]:
        """Fetch a page using seek pagination on `(year, case_id)`."""
        if keyword and keyword.strip():
            raise ValueError("Seek pagination does not support keyword queries")
        if sort_by not in {"year", "date"}:
            raise ValueError(f"Seek pagination does not support sort_by='{sort_by}'")

        conn = self._conn()
        where_clause, params = self._build_case_filters(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
        )
        valid_columns = [c for c in (columns or []) if c in CASE_FIELDS] or CASE_FIELDS
        for required in ("case_id", "year"):
            if required not in valid_columns:
                valid_columns.append(required)
        cols_sql = ", ".join(valid_columns)

        descending = sort_dir == "desc"
        effective_desc = not descending if reverse else descending
        comparator = "<" if effective_desc else ">"
        direction = "DESC" if effective_desc else "ASC"

        if anchor and anchor.get("case_id"):
            where_clause = (
                f"{where_clause} AND ((year {comparator} ?) "
                f"OR (year = ? AND case_id {comparator} ?))"
            )
            anchor_year = int(anchor.get("year") or 0)
            anchor_case_id = str(anchor.get("case_id") or "")
            params.extend([anchor_year, anchor_year, anchor_case_id])

        rows = conn.execute(
            f"SELECT {cols_sql} FROM cases WHERE {where_clause} "
            f"ORDER BY year {direction}, case_id {direction} LIMIT ?",
            params + [page_size],
        ).fetchall()
        return [self._row_to_case(r) for r in rows]

    def search_text(self, query: str, limit: int = 50) -> list[ImmigrationCase]:
        """FTS5 full-text search."""
        import sqlite3 as _sqlite3
        conn = self._conn()
        # Sanitize FTS query — escape special characters
        safe_query = query.replace('"', '""')
        limit = max(1, min(limit, 200))
        try:
            rows = conn.execute(
                "SELECT c.* FROM cases c "
                "JOIN cases_fts f ON c.rowid = f.rowid "
                'WHERE cases_fts MATCH ? ORDER BY rank LIMIT ?',
                (f'"{safe_query}"', limit),
            ).fetchall()
        except _sqlite3.OperationalError:
            logger.warning("FTS5 query failed for: %r", query[:100])
            return []
        return [self._row_to_case(r) for r in rows]

    def find_related(self, case_id: str, limit: int = 5) -> list[ImmigrationCase]:
        """Find related cases by case_nature + visa_type + court_code."""
        limit = max(1, min(limit, 20))
        case = self.get_by_id(case_id)
        if not case:
            return []

        conn = self._conn()
        # Score: 3 points for same nature, 2 for same visa_type, 1 for same court
        conditions = []
        params: list = []
        if case.case_nature:
            conditions.append("(CASE WHEN case_nature = ? THEN 3 ELSE 0 END)")
            params.append(case.case_nature)
        if case.visa_type:
            conditions.append("(CASE WHEN visa_type = ? THEN 2 ELSE 0 END)")
            params.append(case.visa_type)
        if case.court_code:
            conditions.append("(CASE WHEN court_code = ? THEN 1 ELSE 0 END)")
            params.append(case.court_code)

        if not conditions:
            return []

        score_expr = " + ".join(conditions)
        # score_expr appears twice in SQL (SELECT + WHERE), so duplicate params
        score_params = list(params)
        all_params = score_params + [case_id] + score_params + [limit]

        rows = conn.execute(
            f"SELECT *, ({score_expr}) as relevance FROM cases "
            f"WHERE case_id != ? AND ({score_expr}) > 0 "
            f"ORDER BY relevance DESC, year DESC LIMIT ?",
            all_params,
        ).fetchall()
        return [self._row_to_case(r) for r in rows]

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
        """Efficient SQL-based filter option retrieval."""
        conn = self._conn()
        courts = sorted(
            r["court_code"] for r in conn.execute(
                "SELECT DISTINCT court_code FROM cases WHERE court_code != ''"
            )
        )
        years = sorted(
            (r["year"] for r in conn.execute(
                "SELECT DISTINCT year FROM cases WHERE year > 0"
            )),
            reverse=True,
        )
        sources = sorted(
            r["source"] for r in conn.execute(
                "SELECT DISTINCT source FROM cases WHERE source != ''"
            )
        )
        natures = sorted(
            r["case_nature"] for r in conn.execute(
                "SELECT DISTINCT case_nature FROM cases WHERE case_nature != ''"
            )
        )
        tags_raw = conn.execute(
            "SELECT DISTINCT tags FROM cases WHERE tags != ''"
        ).fetchall()
        all_tags = set()
        for r in tags_raw:
            for t in r["tags"].split(","):
                t = t.strip()
                if t:
                    all_tags.add(t)

        visa_types = sorted(
            r["visa_type"] for r in conn.execute(
                "SELECT DISTINCT visa_type FROM cases WHERE visa_type != ''"
            )
        )

        return {
            "courts": courts,
            "years": years,
            "sources": sources,
            "natures": natures,
            "visa_types": visa_types,
            "tags": sorted(all_tags),
        }

    def get_case_full_text(self, case: ImmigrationCase) -> str | None:
        """Read the full text file for a case."""
        from .storage import get_case_full_text
        base_dir = os.path.dirname(self.db_path)
        return get_case_full_text(case, base_dir=base_dir)

    # ── Internal helpers ─────────────────────────────────────────────

    @staticmethod
    def _row_to_case(row: sqlite3.Row) -> ImmigrationCase:
        """Convert a sqlite3.Row to ImmigrationCase, handling type coercion."""
        d = dict(row)
        # Remove any extra columns (like 'relevance' from find_related)
        valid_fields = {f.name for f in ImmigrationCase.__dataclass_fields__.values()}
        filtered = {k: v for k, v in d.items() if k in valid_fields}
        return ImmigrationCase.from_dict(filtered)
