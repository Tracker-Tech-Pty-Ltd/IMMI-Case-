# Plan 026: Make the seek pagination return the right rows on every page

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE=(immi_case_downloader/cases_pagination.py immi_case_downloader/sqlite_repository.py immi_case_downloader/supabase_repository.py immi_case_downloader/web/routes/api_cases.py immi_case_downloader/web/routes/api.py tests/test_cases_pagination.py tests/test_supabase_repository.py)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $IN_SCOPE   # committed drift
> git diff --stat -- $IN_SCOPE                 # unstaged drift
> git diff --cached --stat -- $IN_SCOPE        # staged drift
> ```
>
> Expected: all three `git diff` invocations print nothing, and
> `git status --short --branch` lists no in-scope path. A committed diff means
> a sibling plan landed — compare the "Current state" excerpts against the live
> code before proceeding. **An in-scope file appearing as modified, staged or
> untracked in `git status` is a STOP condition**: it is somebody's
> work-in-progress and this plan's edits would collide with it. Never run
> `git checkout --` or `git clean -f` to "clean up" — that destroys the
> operator's work. Report and stop.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/027-fix-csv-data-integrity.md` and
  `plans/028-fix-flask-analytics-fallback.md` **on the shared file
  `immi_case_downloader/sqlite_repository.py` only**. All three plans edit that
  file (026 Step 4 adds one class attribute, 027 Steps 6–7 rewrite `save_many`
  and the schema, 028 Step 7 rewrites `get_statistics`). The agreed order is
  **027 → 028 → 026**, with a single integrator owning the file and running its
  whole test set once at the end. 026's edit to it is three lines in the class
  attribute block, so it rebases cleanly onto either of the other two — but do
  **not** run all three in the same checkout. Every one of these plans creates a
  branch, so a shared checkout means they switch each other's branch out from
  under them. **Work in your own git worktree**
  (`git worktree add ../immi-026 -b advisor/026-fix-seek-pagination`).
  Other plans that interact if they land first:
  - `plans/002-fix-test-collection-and-install.md` changes `pytest.ini`, which changes how many tests `make test-py` collects. Never judge this plan by an absolute suite total: record your own baseline in Step 1 and judge by the **delta** (see "Commands you will need").
  - `plans/003-lint-the-test-suite.md` widens `make lint` to cover `tests/`. If 003 has landed, `make lint` alone also lints the new test file and the separate `ruff check tests/test_cases_pagination_correctness.py` step is redundant (harmless — run it anyway).
  - `plans/028-fix-flask-analytics-fallback.md` also edits
    `immi_case_downloader/web/routes/api.py`, but only inside the regions it
    lists (268–302, 1074–1076, 1177–1186, 1282–1290, 1670–1911). This plan's
    single edit to that file is inside `_invalidate_cases_cache()` (line 1059),
    which is in none of them, so the two are textually disjoint. Flag it to the
    integrator anyway.
  - This plan touches no frontend or Worker code, so `plans/001-restore-the-frontend-compile-gate.md` is irrelevant to it. `make typecheck` is not used by this plan.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`/api/v1/cases` has a "seek pagination" planner that is supposed to serve deep
pages without a large SQL `OFFSET`. Six independent defects make it return
**wrong rows with a 200 status**: the reverse tail walk hands back a shifted,
full-size window for the last pages of any listing whose row count is not an
exact multiple of the page size (so the genuinely final records are
unreachable through the UI); the anchor cache key ignores `page_size`, so a
client that changes page size gets a page of unrelated cases; `sort_by="date"`
is admitted to a seek path that actually orders by `(year, case_id)`, so a
date-sorted browse silently duplicates some cases and drops others;
forward paging never records an anchor at all, so the optimisation the whole
mechanism exists for never fires; the cache key partitions only on the
*backend kind* (the literal string `"sqlite"`), so two apps over two different
databases in one process read each other's anchors; and no mutation path clears
the anchor cache, so for up to 300 seconds after an insert or delete the seek
path pages from a cursor that no longer describes the data.

All of this is confined to the Flask/local-dev request path — production
`/api/v1/cases` is served by the Cloudflare Worker (`workers/case-api/cloudflare.js`),
which has its own plain `LIMIT ? OFFSET ?` and never imports this planner. So
the blast radius is a developer or reviewer browsing local data and being shown
a case list that is quietly wrong. That is still worth fixing: this is the code
path people use to eyeball data quality, and a listing that lies about which
records exist is the worst possible tool for that job.

After this plan, every page of a `/api/v1/cases` listing returns exactly the
window the offset path would return, a full walk of a listing yields every row
exactly once, and the anchor cache actually gets populated by ordinary forward
paging so deep pages get the intended speed-up.

## Current state

### Files and their roles

- `immi_case_downloader/cases_pagination.py` (264 lines) — the pagination
  planner: `CaseListQuery`, the in-memory `_AnchorCache`, and
  `choose_pagination_plan()`, which picks `seek_forward` / `seek_reverse` /
  `offset_fallback`. Its only non-test importer is
  `immi_case_downloader/web/routes/api_cases.py` (verified by grep).
- `immi_case_downloader/web/routes/api_cases.py` (1366 lines) — the Flask
  `/api/v1/cases` view (`list_cases()`, line 731) plus the two loaders
  `_list_cases_offset_path()` (line 195) and `_load_cases_via_seek()` (line 269).
- `immi_case_downloader/sqlite_repository.py` (654 lines) — `SqliteRepository`
  (class at line 99); `_build_sql_order_clause()` (offset ordering) and
  `list_cases_seek()` (seek ordering).
- `immi_case_downloader/supabase_repository.py` (742 lines) —
  `SupabaseRepository` (class at line 75); `filter_cases()` and
  `list_cases_fast()` order by a single low-cardinality column.

### The planner's constants — `cases_pagination.py:18-23` (verbatim)

```python
SEEK_SORT_FIELDS = frozenset({"date", "year"})
ANCHOR_INTERVAL_PAGES = 10
ANCHOR_TTL_SECONDS = 300
MAX_ANCHOR_SIGNATURES = 128
HEAD_SEEK_MAX_PAGE = 3
TAIL_SEEK_WINDOW_PAGES = 2
```

### The query signature — `cases_pagination.py:34-64` (verbatim)

```python
@dataclass(frozen=True)
class CaseListQuery:
    """Normalized query fields relevant to pagination strategy."""

    court: str = ""
    year: int | None = None
    visa_type: str = ""
    source: str = ""
    tag: str = ""
    nature: str = ""
    keyword: str = ""
    sort_by: str = "date"
    sort_dir: str = "desc"

    def canonical_payload(self) -> dict[str, Any]:
        """Return a stable JSON payload for cache key generation."""
        return {
            "court": self.court or "",
            "year": self.year,
            "visa_type": self.visa_type or "",
            "source": self.source or "",
            "tag": self.tag or "",
            "nature": self.nature or "",
            "keyword": self.keyword or "",
            "sort_by": self.sort_by or "date",
            "sort_dir": self.sort_dir or "desc",
        }

    def signature_hash(self) -> str:
        payload = json.dumps(self.canonical_payload(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
```

Note there is **no `page_size` anywhere in the signature**. The cache key built
from it is `cases_pagination.py:111-112` (verbatim):

```python
    def _cache_key(self, backend_kind: str, query: CaseListQuery) -> str:
        return f"{backend_kind}:{query.signature_hash()}:{query.sort_dir}"
```

### The cache key has no dataset identity either

`backend_kind` comes from `cases_pagination.py:82-87` (verbatim):

```python
def backend_kind_for_repo(repo: Any) -> str:
    """Return a stable backend kind for cache partitioning."""
    explicit = getattr(repo, "pagination_backend_kind", None)
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    return type(repo).__name__.strip().lower()
```

For **every** `SqliteRepository` that returns the literal `"sqlite"`, whatever
`db_path` it points at. The module-level `_ANCHOR_CACHE` is process-global
(`cases_pagination.py`, instantiated once at import), so two apps created over
two different databases in one process — the exact shape
`tests/conftest.py` and `make api` in a dev loop produce — share one anchor
namespace and can serve each other's cursors. This is the same class of defect
as the judge-bio `lru_cache` in `plans/028-fix-flask-analytics-fallback.md`
Step 6, in a different module.

### No mutation clears the anchor cache

`immi_case_downloader/web/routes/api.py:1059-1071` is the single invalidation
hook every mutation funnels through (`api_cases.py:973`, `:1000`, `:1013`,
`:1063` and `web/jobs.py:68-78` all call it) — verbatim:

```python
def _invalidate_cases_cache() -> None:
    """Reset all in-memory caches so the next read fetches fresh data.

    Clears the full-cases cache, the lightweight analytics-cases cache, and
    the pre-computed analytics results cache so CRUD mutations are immediately
    reflected across all endpoints (instead of serving stale data for up to
    10 minutes).
    """
    global _all_cases_ts, _analytics_cases_ts
    _all_cases_ts = 0.0
    _analytics_cases_ts = 0.0
    with _analytics_cache_lock:
        _analytics_cache.clear()
```

It does not touch the anchor cache. The only caller of
`clear_cases_anchor_cache()` in the whole repository is the autouse fixture at
`tests/conftest.py:86` (verified by grep across `*.py` outside `.venv`). An
anchor is a `(year, case_id)` cursor for "the end of page N"; inserting or
deleting a row above that position moves every later row by one, so until the
300-second TTL expires the seek path serves a window shifted against the offset
path's answer. Step 5b closes it.

### The strategy choice — `cases_pagination.py:216-245` (verbatim)

```python
    if page <= 1:
        return PaginationPlan("seek_forward")

    if total_pages > 0 and page > total_pages:
        return PaginationPlan("offset_fallback", fallback_reason="page_out_of_range")

    if total_pages > 0 and page >= max(1, total_pages - TAIL_SEEK_WINDOW_PAGES):
        return PaginationPlan("seek_reverse")

    backend_kind = backend_kind_for_repo(repo)
    anchor_hit = _ANCHOR_CACHE.get_nearest_anchor(
        backend_kind=backend_kind,
        query=query,
        target_page=page - 1,
    )
    if anchor_hit is not None:
        anchor_page, anchor = anchor_hit
        return PaginationPlan(
            "seek_forward",
            anchor=anchor,
            anchor_page=anchor_page,
        )

    if page <= HEAD_SEEK_MAX_PAGE:
        return PaginationPlan("seek_forward")

    return PaginationPlan(
        "offset_fallback",
        fallback_reason="deep_page_without_anchor",
    )
```

`store_anchor` refuses every page that is not a multiple of
`ANCHOR_INTERVAL_PAGES` — `cases_pagination.py:165` (verbatim):

```python
        if page < 1 or page % ANCHOR_INTERVAL_PAGES != 0 or not anchor.case_id:
```

Since a cold forward walk is capped at `HEAD_SEEK_MAX_PAGE = 3` and the
`offset_fallback` branch never calls `remember_page_anchor`, no forward walk
can ever reach page 10 through the seek path, so no anchor is ever written by
forward paging.

### The reverse tail walk — `api_cases.py:288-328` (verbatim)

```python
    if strategy == "seek_reverse":
        reverse_steps = max(0, total_pages - page)
        reverse_anchor = None
        final_page: list[ImmigrationCase] = []

        for current_page in range(total_pages, page - 1, -1):
            raw_rows = repo.list_cases_seek(
                court=query.court,
                year=query.year,
                visa_type=query.visa_type,
                source=query.source,
                tag=query.tag,
                nature=query.nature,
                keyword=query.keyword,
                sort_by=query.sort_by,
                sort_dir=query.sort_dir,
                page_size=page_size,
                anchor=reverse_anchor,
                reverse=True,
                columns=CASE_LIST_COLUMNS,
            )
            if not raw_rows:
                final_page = []
                break

            reverse_anchor = {
                "year": int(getattr(raw_rows[-1], "year", 0) or 0),
                "case_id": str(getattr(raw_rows[-1], "case_id", "") or ""),
            }
            final_page = list(reversed(raw_rows))
            remember_page_anchor(
                repo=repo,
                query=query,
                page=current_page,
                page_cases=final_page,
            )
            if reverse_steps <= 0:
                break
            reverse_steps -= 1

        return final_page, strategy, fallback_reason
```

The first iteration fetches `page_size` rows counting back from the end of the
dataset. When `total` is not an exact multiple of `page_size` the true final
page is *shorter* than `page_size`, so this first window is offset by
`page_size - (total % page_size)` rows and every page produced by the walk is
shifted by that amount.

### The seek ordering vs the offset ordering (SQLite)

`sqlite_repository.py:479-480` admits `date`:

```python
        if sort_by not in {"year", "date"}:
            raise ValueError(f"Seek pagination does not support sort_by='{sort_by}'")
```

…but `sqlite_repository.py:512-516` never reads `sort_by` again:

```python
        rows = conn.execute(
            f"SELECT {cols_sql} FROM cases WHERE {where_clause} "
            f"ORDER BY year {direction}, case_id {direction} LIMIT ?",
            params + [page_size],
        ).fetchall()
```

while the offset path orders date-sorted queries by a composite key —
`sqlite_repository.py:198-226` (verbatim, month CASE elided for brevity but
present in the file):

```python
    @staticmethod
    def _build_sql_order_clause(sort_by: str, sort_dir: str) -> str:
        direction = "DESC" if sort_dir == "desc" else "ASC"
        if sort_by == "date":
            month_num = (
                "CASE "
                "WHEN date LIKE '%January%' THEN 1 "
                ...
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
```

`sort_by="date"` is the endpoint default (`api_cases.py:736`:
`sort_by = request.args.get("sort_by", "date")`), so **every default browse
crosses this boundary** as soon as it leaves the head window.

### The Supabase ordering has no unique tiebreaker

`supabase_repository.py:487-492` (`filter_cases`) and
`supabase_repository.py:543-548` (`list_cases_fast`) are byte-identical
fragments:

```python
        if sort_by == "date":
            col = "year"
        else:
            col = sort_by if sort_by in ALLOWED_SORT_COLUMNS else "year"
        desc = sort_dir == "desc"
        query = query.order(col, desc=desc)
```

PostgreSQL gives no ordering guarantee among rows tied on the sort key across
separate `LIMIT`/`OFFSET` statements, and ~149k rows across ~26 distinct years
means enormous tie groups. `sqlite_repository.py:226` already appends
`, case_id {direction}` for exactly this reason, and
`supabase_repository.py:598` already chains two `.order()` calls
(`query.order("year", desc=...).order("case_id", desc=...)`), so the client
supports it.

### Which backends report an exact `total`

`api_cases.py:517-525` (verbatim) forces any repo that has `list_cases_fast`
onto the cheap count modes:

```python
    fast_supabase_path = hasattr(repo, "list_cases_fast")
    if fast_supabase_path and count_mode == "exact":
        preferred_modes = ("planned", "estimated", "exact")
    elif fast_supabase_path and count_mode == "estimated":
        preferred_modes = ("estimated", "planned")
    elif fast_supabase_path:
        preferred_modes = ("planned", "estimated")
    else:
        preferred_modes = (count_mode, "planned", "estimated")
```

For `SupabaseRepository` that means `total` is a **planner estimate**, so
`total_pages` is an estimate too, and any arithmetic that derives the final
page's size from it is unsound. `SqliteRepository.count_cases` is exact
regardless of the mode string — `sqlite_repository.py:439-443` (verbatim):

```python
        """Return the exact count for the matching SQLite rows.

        ``count_mode`` is ignored: SQLite COUNT(*) is always exact regardless of mode.
        """
        _ = count_mode
```

The two repositories already advertise pagination capabilities as plain class
attributes — `sqlite_repository.py:106-107` and `supabase_repository.py:82-83`
(verbatim):

```python
    supports_seek_pagination = True
    pagination_backend_kind = "sqlite"
```

```python
    supports_seek_pagination = True
    pagination_backend_kind = "supabase"
```

Follow that convention for the new capability flag this plan adds.

### Measured behaviour at HEAD (reproduced on this machine, 2026-08-27)

- 105 rows, `page_size=50`, `sort_by=year`: page 2 returns `c00076..c00038`
  where the offset path returns `c00039..c00001`; page 3 returns **50** rows
  (`c00012..c00000`) where the offset path returns the correct **5**
  (`c00104..c00000`).
- 120 rows: request page 10 at `page_size=10` (a tail page → `seek_reverse`,
  which stores an anchor at page 10 under key `sqlite:<sig>:desc`), then
  request page 11 at `page_size=5`; the stale anchor is reused and 5 wrong
  rows come back with HTTP 200.
- 250 rows, `page_size=10`: walking pages 1→11 gives `seek_forward` for pages
  1–3 and `offset_fallback` for pages 4–11, and the anchor cache is still `{}`
  at the end.
- 250 dated rows, `page_size=10`, `sort_by=date`: a full 25-page walk collects
  250 ids of which only **248** are unique — 2 duplicated, 2 unreachable.
- Benchmark, 150,000 synthetic rows, `page_size=50` (3,000 pages), SQLite:
  offset page 3000 ≈ **315 ms**, `seek_reverse` walk to page 3000 ≈ **9.6 ms**
  (30× better), walk to page 2999 ≈ **214 ms** vs offset **285 ms** (a wash),
  walk to page 2998 ≈ **568 ms** vs offset **447 ms** (**worse**). The reverse
  walk only pays for the single last page, which is why this plan narrows
  `TAIL_SEEK_WINDOW_PAGES` to `0`.

### Repo conventions that apply here

- Python: `from __future__ import annotations` at the top of
  `cases_pagination.py`; modern built-in generics (`dict[int, SeekAnchor]`,
  `int | None`); frozen dataclasses for value objects; double-quoted strings;
  4-space indent. There is no `pyproject.toml` / `ruff.toml`, so `ruff` runs on
  its defaults (E4/E7/E9 + F only — line length is **not** enforced).
- Always construct cases via `ImmigrationCase.from_dict()` when reading CSV,
  because pandas turns empty fields into `float('nan')`. The tests in this plan
  construct `ImmigrationCase(...)` directly with explicit values, which is fine
  — there is no CSV involved.
- The `CaseRepository` Protocol lives in `immi_case_downloader/repository.py`;
  backends advertise optional capabilities as class attributes rather than by
  extending the Protocol (see `supports_seek_pagination` above).
- Commit message format: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.
- `tests/conftest.py` already has an autouse fixture that calls
  `clear_cases_anchor_cache()` before and after every test, so the module-level
  anchor cache does not leak between tests. You do not need to add your own.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests (all unit) | `make test-py 2>&1 \| grep -E '[0-9]+ passed'` | judged as a **delta** against the baseline you record in Step 1 — takes >10 min; see notes below |
| Touched-test subset | `.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_supabase_repository.py tests/test_cases_api.py tests/test_cursor_pagination.py tests/test_sqlite_repository.py -q` | same passed count as the `SUBSET_BEFORE` you record in Step 1 (this plan edits four assertions in that set and adds no test to those files) |
| One test file | `.venv/bin/python -m pytest tests/test_cases_pagination_correctness.py -q` | see each step |
| Lint (source) | `make lint` | `All checks passed!` |
| Lint (new test file) | `.venv/bin/ruff check tests/test_cases_pagination_correctness.py` | `All checks passed!` |
| Defect probe | `.venv/bin/python /tmp/immi-seek-probe.py` | see steps 1 and 8 |

**Never assert an absolute suite total.** Sibling plans in this batch add tests
to the same suite, so a hard-coded `1141`/`1158` is wrong the moment any of them
lands and it trains you to edit the yardstick instead of the code. Step 1 has
you record `SUITE_BEFORE` and `SUBSET_BEFORE`; every later check is stated
against those.

**About the 3 pre-existing failures**: `make test-py` reports **3 failed** on
this machine before you change anything. All 3 are in
`tests/test_backfill_judge_overrides_from_pdf.py` and are **environmental** — a
Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf`
import. They are not caused by repo code and are not this plan's problem. Do
not try to fix them. The success condition is that after this plan the failing
set is *still exactly those three, by name* — not merely "still 3".

Always use the repo virtualenv: `.venv/bin/python`, `.venv/bin/pytest`,
`.venv/bin/ruff`. Never global `pip`/`python3`.

## Scope

**In scope** (the only files you may modify):

- `immi_case_downloader/cases_pagination.py`
- `immi_case_downloader/sqlite_repository.py`
- `immi_case_downloader/supabase_repository.py`
- `immi_case_downloader/web/routes/api_cases.py`
- `immi_case_downloader/web/routes/api.py` — **only** the body of
  `_invalidate_cases_cache()` (line 1059) and the import it needs (Step 5b).
  This region is outside every region
  `plans/028-fix-flask-analytics-fallback.md` edits; do not touch anything else
  in this file.
- `tests/test_cases_pagination.py` (edit two existing assertions)
- `tests/test_supabase_repository.py` (edit two existing assertions)
- `tests/test_cases_pagination_correctness.py` (create)
- `plans/README.md` (status row only, if the file exists)

**Out of scope** (do NOT touch, even though they look related):

- `workers/**` — production `/api/v1/cases` is served by
  `workers/case-api/cloudflare.js:1093` → `listPage()` in
  `workers/storage/cloudflare.js`, whose query (lines 497-502) is
  `ORDER BY ${column} ${direction}, c.case_id ASC` + `LIMIT ? OFFSET ?`. Note
  it **already has** the unique tiebreaker that Step 6 adds to the Supabase
  repository, and it has no seek path at all. Porting seek pagination to the
  Worker is a separate decision that depends on whether a D1 index makes
  `OFFSET` fast enough; do not start it here.
- `immi_case_downloader/hyperdrive_repository.py` — it also declares
  `supports_seek_pagination = True`, but it belongs to the retired
  Hyperdrive/Supabase-Postgres stack. Leaving it without the new
  `counts_are_exact` flag is the *correct* outcome: it makes its tail pages
  fall back to the offset path, which is always right, just not optimised.
- `frontend/**` — no API response shape changes in this plan. `total`,
  `count_mode`, `page`, `page_size`, `total_pages` and `next_cursor` all keep
  their current meaning.
- The `sort_by not in {"year", "date"}` guards inside
  `SqliteRepository.list_cases_seek` (line 479) and
  `SupabaseRepository.list_cases_seek` (line 581). This plan stops the
  *planner* from routing date-sorted queries there; the repository-level guard
  stays as defence in depth. Changing it would break
  `tests/test_supabase_repository.py::TestFilterCases::test_list_cases_seek_uses_stable_year_case_id_order`
  for no benefit.
- The API response `count_mode` string. Do not make
  `_count_cases_with_fallback` report `"exact"` for SQLite; the frontend reads
  this field.

## Git workflow

- **Use your own worktree**, not a branch in the shared checkout:
  `git worktree add ../immi-026 -b advisor/026-fix-seek-pagination`, then work
  from `../immi-026`. Plans 026–029 all create branches and three of them edit
  `immi_case_downloader/sqlite_repository.py`; run in parallel in one checkout
  they switch each other's branch out mid-edit.
- Branch: `advisor/026-fix-seek-pagination`
- One commit per step (steps 2, 3, 4, 5, 5b, 6, 7), conventional-commit style,
  e.g. `fix: stop routing date-sorted case lists through the year-ordered seek path`
  and `fix: drop seek anchors when the case data changes`.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Reproduce all four defects before changing anything

Create the probe script at `/tmp/immi-seek-probe.py` — **outside the repo, on
purpose**. It is scratch; never `git add` it.

```python
"""Throwaway probe for plan 026 — reproduces the four seek-pagination defects.

Run from the repository root:  .venv/bin/python /tmp/immi-seek-probe.py
This file lives in /tmp on purpose. Do NOT commit it.
"""
import inspect
import os
import sys
import tempfile

sys.path.insert(0, os.getcwd())

from immi_case_downloader.cases_pagination import (  # noqa: E402
    CaseListQuery,
    choose_pagination_plan,
    clear_cases_anchor_cache,
)
from immi_case_downloader.models import ImmigrationCase  # noqa: E402
from immi_case_downloader.sqlite_repository import SqliteRepository  # noqa: E402
from immi_case_downloader.web.routes import api_cases as ac  # noqa: E402

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]
SEEK_TAKES_TOTAL = "total" in inspect.signature(ac._load_cases_via_seek).parameters


def build(n, dated=False):
    repo = SqliteRepository(os.path.join(tempfile.mkdtemp(), "cases.db"))
    repo.save_many([
        ImmigrationCase(
            case_id=f"c{i:05d}", citation=f"[{2000 + i % 26}] AATA {i}",
            title=f"Case {i}", court="AATA", court_code="AATA",
            date=(f"{(i % 28) + 1} {MONTHS[i % 12]} {2000 + i % 26}"
                  if dated else str(2000 + i % 26)),
            year=2000 + i % 26, url=f"http://example.test/{i}")
        for i in range(n)])
    return repo


def q_for(sort_by, page_size):
    try:
        return CaseListQuery(sort_by=sort_by, sort_dir="desc", page_size=page_size)
    except TypeError:
        return CaseListQuery(sort_by=sort_by, sort_dir="desc")


def offset_ids(repo, q, page, ps):
    rows = repo.list_cases_fast(
        court=q.court, year=q.year, visa_type=q.visa_type, source=q.source,
        tag=q.tag, nature=q.nature, keyword=q.keyword, sort_by=q.sort_by,
        sort_dir=q.sort_dir, page=page, page_size=ps)
    return [c.case_id for c in rows]


def list_page(repo, q, page, ps, total):
    tp = max(1, (total + ps - 1) // ps)
    plan = choose_pagination_plan(repo=repo, query=q, page=page, total_pages=tp)
    kw = {"query": q, "plan": plan, "page": page, "page_size": ps, "total_pages": tp}
    if SEEK_TAKES_TOTAL:
        kw["total"] = total
    rows, strategy, _reason = ac._load_cases_via_seek(repo, **kw)
    if strategy == "offset_fallback":
        rows = repo.list_cases_fast(
            court=q.court, year=q.year, visa_type=q.visa_type, source=q.source,
            tag=q.tag, nature=q.nature, keyword=q.keyword, sort_by=q.sort_by,
            sort_dir=q.sort_dir, page=page, page_size=ps)
        helper = getattr(ac, "_maybe_remember_offset_anchor", None)
        if helper is not None:
            helper(repo, query=q, page=page, page_size=ps, page_cases=rows)
    return [c.case_id for c in rows], strategy


defects = []

# D1 — tail window returns a shifted, full-size page when total % page_size != 0
clear_cases_anchor_cache()
repo = build(105)
total = repo.count_cases()
q = q_for("year", 50)
bad = []
for page in (1, 2, 3):
    clear_cases_anchor_cache()
    got, strategy = list_page(repo, q, page, 50, total)
    want = offset_ids(repo, q, page, 50)
    if got != want:
        bad.append((page, strategy, len(got), len(want)))
print(f"D1 tail-window pages wrong: {bad}")
if bad:
    defects.append("D1")

# D2 — anchors recorded at one page_size are reused at another
clear_cases_anchor_cache()
repo = build(120)
total = repo.count_cases()
list_page(repo, q_for("year", 10), 10, 10, total)          # warm at page_size=10
got, strategy = list_page(repo, q_for("year", 5), 11, 5, total)
want = offset_ids(repo, q_for("year", 5), 11, 5)
print(f"D2 page 11 @ page_size=5 after warming @10: strategy={strategy} match={got == want}")
if got != want:
    defects.append("D2")

# D3 — forward paging never records an anchor
clear_cases_anchor_cache()
repo = build(250)
total = repo.count_cases()
q = q_for("year", 10)
strategy = None
for page in range(1, 12):
    _, strategy = list_page(repo, q, page, 10, total)
print(f"D3 page 11 strategy after walking 1..11: {strategy}")
if strategy != "seek_forward":
    defects.append("D3")

# D4 — sort_by="date" crosses the seek/offset boundary and loses rows
clear_cases_anchor_cache()
repo = build(250, dated=True)
total = repo.count_cases()
q = q_for("date", 10)
seen = []
for page in range(1, (total + 9) // 10 + 1):
    ids, _ = list_page(repo, q, page, 10, total)
    seen.extend(ids)
print(f"D4 date walk: collected={len(seen)} unique={len(set(seen))} total={total}")
if len(set(seen)) != total or len(seen) != total:
    defects.append("D4")

print(f"DEFECTS PRESENT: {len(defects)}/4 {defects}")
```

**Verify**: `.venv/bin/python /tmp/immi-seek-probe.py` (run from the repository
root) → exactly:

```
D1 tail-window pages wrong: [(2, 'seek_reverse', 50, 50), (3, 'seek_reverse', 50, 5)]
D2 page 11 @ page_size=5 after warming @10: strategy=seek_forward match=False
D3 page 11 strategy after walking 1..11: offset_fallback
D4 date walk: collected=250 unique=248 total=250
DEFECTS PRESENT: 4/4 ['D1', 'D2', 'D3', 'D4']
```

If the last line does not read `DEFECTS PRESENT: 4/4`, STOP — the code has
drifted from what this plan describes.

Also record the test baselines before you change anything, so Step 8 can be
judged as a delta. **Write both numbers into your working notes** — every later
check in this plan is stated against them, and there is no correct absolute
value:

```bash
# SUBSET_BEFORE — the touched-test subset
.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_supabase_repository.py \
  tests/test_cases_api.py tests/test_cursor_pagination.py tests/test_sqlite_repository.py -q \
  2>&1 | grep -E '[0-9]+ passed'

# SUITE_BEFORE — the whole unit suite (>10 min)
make test-py 2>&1 | grep -E '[0-9]+ passed'

# The names of the pre-existing failures, so Step 8 can prove the set is unchanged
make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u
```

The third command must print exactly
`tests/test_backfill_judge_overrides_from_pdf.py` and nothing else. If it prints
anything else, that failure is pre-existing but *not* the known environmental
one — record it and say so in your report, because Step 8's "no new failures"
check is then measured against a dirtier baseline than this plan assumed.

Do **not** pipe `make test-py` to `tail -1`: `make` appends
`make: *** [test-py] Error 1` after pytest's summary whenever those 3 failures
are present. Grep for the summary line, as above. The suite takes **well over
10 minutes** — run it in the background or raise your tool timeout.

### Step 2: Stop routing date-sorted queries into the year-ordered seek path

In `immi_case_downloader/cases_pagination.py`, change line 18 from

```python
SEEK_SORT_FIELDS = frozenset({"date", "year"})
```

to

```python
# "date" is deliberately absent: the seek path orders by (year, case_id) while
# the offset path orders date-sorted queries by (year, month, day, case_id).
# Admitting "date" here makes a listing duplicate some rows and hide others as
# soon as paging crosses the seek/offset boundary. Re-adding it requires
# teaching SeekAnchor and list_cases_seek() the full composite date key.
SEEK_SORT_FIELDS = frozenset({"year"})
```

Then update the two existing tests that assert the old behaviour:

- `tests/test_cases_pagination.py:95-96` — replace

  ```python
      def test_date_sort_no_keyword_returns_true(self):
          assert can_seek_cases_query(_query(sort_by="date")) is True
  ```

  with

  ```python
      def test_date_sort_returns_false(self):
          """date sorting must use the offset path — the seek path orders by year."""
          assert can_seek_cases_query(_query(sort_by="date")) is False
  ```

- `tests/test_cases_pagination.py:300-305` — in
  `TestChoosePaginationPlan.test_head_seek_for_pages_up_to_max`, change
  `query=_query(sort_by="date")` to `query=_query(sort_by="year")` on line 303:

  ```python
              plan = self._plan(repo, query=_query(sort_by="date"), page=p, total_pages=100)
  ```

Leave `tests/test_cases_pagination.py:105`
(`test_keyword_present_returns_false`) and line 274
(`test_keyword_query_returns_offset`) alone — both still pass, because
`choose_pagination_plan` checks `query.keyword` before reporting
`sort_not_seek_supported`.

**Verify**: `.venv/bin/python -m pytest tests/test_cases_pagination.py -q`
→ all pass (no failures, no errors).

### Step 3: Give the anchor cache a complete identity (`page_size` + dataset)

In `immi_case_downloader/cases_pagination.py`:

1. Add a `page_size` field to `CaseListQuery` (append it after `sort_dir`, so
   every existing positional/keyword construction keeps working):

   ```python
       sort_by: str = "date"
       sort_dir: str = "desc"
       page_size: int = 0
   ```

2. Add it to `canonical_payload()` so it feeds `signature_hash()`:

   ```python
               "sort_dir": self.sort_dir or "desc",
               "page_size": int(self.page_size or 0),
           }
   ```

In `immi_case_downloader/web/routes/api_cases.py`, thread the value through
`_build_case_list_query()` (lines 169-192): add a `page_size: int` keyword
parameter and pass `page_size=page_size` into the `CaseListQuery(...)` call.
Then at the call site in `list_cases()` (line 748) add `page_size=page_size,`
to the argument list. `page_size` is already computed on line 743, one line
above, so no reordering is needed.

Why a field rather than an extra argument on `_cache_key`: the anchor is only
meaningful for one page size, and carrying it on the query object means no call
site can forget to pass it. The side effect is that the `query_signature_hash`
value in the `cases_pagination` log line now also varies with page size — that
is intended and harmless; nothing asserts on that value.

**(3) Partition the cache on the dataset, not just the backend kind.**
`backend_kind_for_repo()` returns the literal `"sqlite"` for every
`SqliteRepository` regardless of `db_path` (see "Current state"), so the
process-global `_ANCHOR_CACHE` currently lets two databases share cursors. Add,
directly below `backend_kind_for_repo` in `cases_pagination.py`:

```python
def dataset_id_for_repo(repo: Any) -> str:
    """Return a stable per-dataset identity for cache partitioning.

    `backend_kind_for_repo` only says *what kind* of store this is; two
    SqliteRepository instances over two different files both answer "sqlite".
    The anchor cache is process-global, so without this two apps in one process
    (tests, a dev loop that recreates the app) can serve each other's cursors.
    Falls back to the object's identity, which is per-process and therefore
    conservative: it never shares, it can only miss.
    """
    explicit = getattr(repo, "pagination_dataset_id", None)
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    for attr in ("db_path", "base_dir"):
        value = getattr(repo, attr, None)
        if isinstance(value, str) and value.strip():
            return os.path.abspath(value.strip())
    return f"obj:{id(repo):x}"
```

`import os` at the top of the module if it is not already imported.

Then thread it through `_AnchorCache`, **as a keyword argument with an empty
default** so the direct `_ANCHOR_CACHE.store_anchor(backend_kind="t", ...)`
calls in `tests/test_cases_pagination.py` (lines 156, 184, 190, 204, 221, 241
and their `get_nearest_anchor` partners) keep working untouched:

```python
    def _cache_key(self, backend_kind: str, dataset_id: str, query: CaseListQuery) -> str:
        return f"{backend_kind}:{dataset_id}:{query.signature_hash()}:{query.sort_dir}"
```

- `get_nearest_anchor(self, *, backend_kind, query, target_page, dataset_id="")`
- `store_anchor(self, *, backend_kind, query, page, anchor, dataset_id="")`

and pass `dataset_id=dataset_id_for_repo(repo)` from **both** call sites that
have a repo: `choose_pagination_plan` (the `get_nearest_anchor` call at line
226) and `remember_page_anchor` (the `store_anchor` call at line 260).

**Verify**:

```bash
.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_cases_api.py -q
```

→ all pass (this is the check that the defaulted keyword really did keep the
six direct-cache tests working). Then:

```bash
.venv/bin/python -c "
import os, tempfile
from immi_case_downloader.cases_pagination import (
    CaseListQuery, dataset_id_for_repo, _ANCHOR_CACHE, SeekAnchor)
a = CaseListQuery(sort_by='year', page_size=10)
b = CaseListQuery(sort_by='year', page_size=5)
assert a.signature_hash() != b.signature_hash(), 'page_size not in the signature'
assert CaseListQuery().page_size == 0

class Repo:
    def __init__(self, p): self.db_path = p
r1, r2 = Repo('/tmp/one/cases.db'), Repo('/tmp/two/cases.db')
assert dataset_id_for_repo(r1) != dataset_id_for_repo(r2), 'dataset ids collide'

# An anchor stored for dataset one must be invisible to dataset two.
anchor = SeekAnchor(year=2024, case_id='c1')
_ANCHOR_CACHE.clear()
_ANCHOR_CACHE.store_anchor(backend_kind='sqlite', dataset_id=dataset_id_for_repo(r1),
                           query=a, page=10, anchor=anchor)
assert _ANCHOR_CACHE.get_nearest_anchor(backend_kind='sqlite',
    dataset_id=dataset_id_for_repo(r1), query=a, target_page=10) is not None
assert _ANCHOR_CACHE.get_nearest_anchor(backend_kind='sqlite',
    dataset_id=dataset_id_for_repo(r2), query=a, target_page=10) is None
print('cache identity covers page_size and dataset')
"
```

→ prints `cache identity covers page_size and dataset`. Each `assert` above
fails loudly and specifically if the corresponding half of the change is
missing, which is the point — a `grep` for the word `page_size` would pass on a
comment.

### Step 4: Make the reverse tail walk return the true final page

Two changes, both required — the second is only correct if the first is in
place.

**(a) Only walk backwards when the total is exact.** Add a class attribute to
`SqliteRepository` in `immi_case_downloader/sqlite_repository.py`, right beside
the two existing ones at lines 106-107:

```python
    supports_seek_pagination = True
    pagination_backend_kind = "sqlite"
    # COUNT(*) here is always exact (see count_cases), so total_pages and the
    # final page's size can be derived from it. Backends whose totals are
    # planner estimates (Supabase) must leave this False.
    counts_are_exact = True
```

Do **not** add it to `SupabaseRepository` — its counts come back as `planned`
or `estimated` (see "Current state"), so it must keep falling back to offset
for tail pages.

In `immi_case_downloader/cases_pagination.py`, change the tail branch
(currently line 222) to require the flag, and narrow the window:

```python
TAIL_SEEK_WINDOW_PAGES = 0
```

```python
    if (
        total_pages > 0
        and page >= max(1, total_pages - TAIL_SEEK_WINDOW_PAGES)
        and getattr(repo, "counts_are_exact", False)
    ):
        return PaginationPlan("seek_reverse")
```

`TAIL_SEEK_WINDOW_PAGES = 0` means only the genuinely last page walks
backwards. This is measured, not arbitrary: on 150,000 rows at `page_size=50`,
the reverse walk beats offset 30× for the last page (9.6 ms vs 315 ms), is a
wash one page earlier (214 ms vs 285 ms), and is *slower* two pages earlier
(568 ms vs 447 ms).

**(b) Size the first reverse fetch correctly.** In
`immi_case_downloader/web/routes/api_cases.py`:

- Add a `total: int` keyword parameter to `_load_cases_via_seek` (line 269),
  placed next to `total_pages`.
- Inside the `if strategy == "seek_reverse":` block, before the loop, compute
  the true final-page size and bail out safely if it is nonsense:

  ```python
        last_page_size = total - (total_pages - 1) * page_size
        if last_page_size <= 0 or last_page_size > page_size:
            return [], "offset_fallback", "tail_size_unreliable"
  ```

- Inside the loop, pass the per-step limit instead of always `page_size`:

  ```python
        for current_page in range(total_pages, page - 1, -1):
            step_size = last_page_size if current_page == total_pages else page_size
            raw_rows = repo.list_cases_seek(
                ...
                page_size=step_size,
                ...
            )
  ```

  Keep every other argument to `list_cases_seek` exactly as it is.

- At the call site (line 816-823), add `total=total,` to the keyword arguments.

Leave the `reverse_steps` bookkeeping alone; it is redundant with the `range()`
bounds but harmless, and touching it adds risk for no gain.

**Verify**:

```bash
.venv/bin/python /tmp/immi-seek-probe.py
```

→ exactly:

```
D1 tail-window pages wrong: []
D2 page 11 @ page_size=5 after warming @10: strategy=offset_fallback match=True
D3 page 11 strategy after walking 1..11: offset_fallback
D4 date walk: collected=250 unique=250 total=250
DEFECTS PRESENT: 1/4 ['D3']
```

`D1` and `D4` are fixed by Steps 4 and 2. `D2` no longer reproduces here for
two reasons at once: Step 3 put `page_size` in the cache key, and Step 4's
`TAIL_SEEK_WINDOW_PAGES = 0` means page 10 of 12 no longer walks backwards, so
nothing writes an anchor at all yet. `D3` is the remaining defect and Step 5
fixes it. Then:

```bash
.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_cases_api.py tests/test_sqlite_repository.py -q
```

→ all pass.

### Step 5: Record an anchor from the offset path so forward paging warms the cache

Right now the only code that stores an anchor is inside `_load_cases_via_seek`,
and a cold forward walk can never reach page 10 through the seek path — so the
cache stays empty forever and every page past 3 pays for a deep `OFFSET`.

In `immi_case_downloader/web/routes/api_cases.py`, add a small helper next to
`_load_cases_via_seek` (after it, before the `# ── Filter-options helpers ──`
banner at line 374):

```python
def _maybe_remember_offset_anchor(
    repo,
    *,
    query: CaseListQuery,
    page: int,
    page_size: int,
    page_cases: list[ImmigrationCase],
) -> None:
    """Record a seek anchor from a page the offset path just served.

    The offset and seek paths order seek-eligible queries identically
    (`ORDER BY year <dir>, case_id <dir>`), so the last row of an offset page is
    a valid forward cursor. Without this, a cold forward walk never reaches the
    anchor interval and the cache is never populated.
    """
    if not can_seek_cases_query(query):
        return
    if not getattr(repo, "supports_seek_pagination", False):
        return
    if len(page_cases) != page_size:
        return
    remember_page_anchor(
        repo=repo,
        query=query,
        page=page,
        page_cases=page_cases,
    )
```

Add `can_seek_cases_query` to the existing import block at lines 30-35:

```python
from ...cases_pagination import (
    CaseListQuery,
    backend_kind_for_repo,
    can_seek_cases_query,
    choose_pagination_plan,
    remember_page_anchor,
)
```

Call it in `list_cases()` in the planned-offset branch only — immediately after
the `_list_cases_offset_path(...)` call that currently ends at line 859 and
before the `total_pages = ...` line at 860:

```python
                    _maybe_remember_offset_anchor(
                        repo,
                        query=query,
                        page=page,
                        page_size=page_size,
                        page_cases=page_cases,
                    )
```

Do **not** add the call to the other two `_list_cases_offset_path` call sites
(line 764 — repos with no `count_cases`, which are not seek-capable anyway; and
line 828 — the post-seek-error rescue path, where recording an anchor derived
from a path that just failed adds risk for no benefit).

The `len(page_cases) != page_size` guard matters: a short page is the last page,
and an anchor there would imply rows exist beyond the end of the dataset.

**Verify**:

```bash
.venv/bin/python /tmp/immi-seek-probe.py
```

→ exactly:

```
D1 tail-window pages wrong: []
D2 page 11 @ page_size=5 after warming @10: strategy=offset_fallback match=True
D3 page 11 strategy after walking 1..11: seek_forward
D4 date walk: collected=250 unique=250 total=250
DEFECTS PRESENT: 0/4 []
```

Note `D2`'s strategy is now `offset_fallback` **and** it matches: this step
starts writing anchors from offset pages, and `D2` proves those anchors stay
partitioned by page size — the anchor written for page 10 at `page_size=10` is
correctly invisible to a request at `page_size=5`. If `D2` reports
`match=False`, Step 3's `page_size` never reached the cache key; re-check that
`_build_case_list_query` passes `page_size` into `CaseListQuery(...)`.

Then:

```bash
.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_cases_api.py -q
```

→ all pass.

### Step 5b: Drop the anchors when the data underneath them changes

Step 5 starts writing anchors from ordinary browsing, which makes a *stale*
anchor reachable for the first time. An anchor is a `(year, case_id)` cursor
meaning "the last row of page N"; insert or delete a row above that position and
every later row shifts, so the seek path serves a window the offset path would
not. Nothing currently clears the cache on a mutation — the only caller of
`clear_cases_anchor_cache()` in the repository is the autouse test fixture
(`tests/conftest.py:86`).

Every mutation path already funnels through one hook. In
`immi_case_downloader/web/routes/api.py`, extend `_invalidate_cases_cache()`
(line 1059) — add the import at the top of the function body rather than at
module level, because `api.py` importing `cases_pagination` at module scope
would be a new import edge in a file another plan is editing:

```python
def _invalidate_cases_cache() -> None:
    """Reset all in-memory caches so the next read fetches fresh data.

    Clears the full-cases cache, the lightweight analytics-cases cache, the
    pre-computed analytics results cache, and the /api/v1/cases seek-pagination
    anchor cache, so CRUD mutations are immediately reflected across all
    endpoints (instead of serving stale data for up to 10 minutes).
    """
    from ...cases_pagination import clear_cases_anchor_cache

    global _all_cases_ts, _analytics_cases_ts
    _all_cases_ts = 0.0
    _analytics_cases_ts = 0.0
    with _analytics_cache_lock:
        _analytics_cache.clear()
    # A seek anchor is a cursor into a specific row ordering. Any insert or
    # delete above that cursor shifts every later row, so an anchor that
    # outlives a mutation makes the seek path serve a window the offset path
    # would not. Dropping the whole cache is the cheap, always-correct answer:
    # it costs one uncached deep page.
    clear_cases_anchor_cache()
```

Check the relative-import depth against the file's existing imports
(`api.py:30-35` in `api_cases.py` uses `from ...cases_pagination import ...`;
`api.py` lives at the same depth, so `...` is right — confirm by reading the
file's existing relative imports before you write it).

This is deliberately a whole-cache flush rather than a per-dataset one. The hook
has no repo argument, per-dataset invalidation would need one, and the cache is
a latency optimisation whose entire content can be rebuilt by browsing.

**Verify**:

```bash
.venv/bin/python -c "
import tempfile, os
from immi_case_downloader.cases_pagination import (
    CaseListQuery, SeekAnchor, _ANCHOR_CACHE)
from immi_case_downloader.web.routes.api import _invalidate_cases_cache
q = CaseListQuery(sort_by='year', page_size=10)
_ANCHOR_CACHE.clear()
_ANCHOR_CACHE.store_anchor(backend_kind='sqlite', dataset_id='d1', query=q,
                           page=10, anchor=SeekAnchor(year=2024, case_id='c1'))
assert _ANCHOR_CACHE.get_nearest_anchor(backend_kind='sqlite', dataset_id='d1',
                                        query=q, target_page=10) is not None
_invalidate_cases_cache()
assert _ANCHOR_CACHE.get_nearest_anchor(backend_kind='sqlite', dataset_id='d1',
                                        query=q, target_page=10) is None
print('mutation invalidation clears the anchor cache')
"
```

→ prints `mutation invalidation clears the anchor cache`. It raises
`AssertionError` if the call is missing, so it cannot pass by accident.

```bash
.venv/bin/python -m pytest tests/test_cases_api.py tests/test_cases_pagination.py -q
```

→ all pass.

### Step 6: Give the Supabase list queries a unique tiebreaker

`filter_cases` and `list_cases_fast` order by a single low-cardinality column,
which lets Postgres return rows in a different order for each `LIMIT`/`OFFSET`
statement — so paging duplicates and skips rows non-deterministically.

In `immi_case_downloader/supabase_repository.py`, in **both** `filter_cases`
(line 492) and `list_cases_fast` (line 548), replace

```python
        query = query.order(col, desc=desc)
```

with

```python
        query = query.order(col, desc=desc)
        if col != "case_id":
            # Unique tiebreaker: without it Postgres may order tied rows
            # differently between LIMIT/OFFSET statements, duplicating some
            # cases across pages and hiding others.
            query = query.order("case_id", desc=desc)
```

Both extra `.order()` calls stay before `.range()` and `.text_search()`, which
the docstring at lines 472-475 requires. `list_cases_seek` (line 598) already
chains two `.order()` calls, so the client supports this.

Two existing tests assert on the *last* `.order()` call and will now break.
Update them in `tests/test_supabase_repository.py` to the `assert_has_calls`
style already used in the same file at lines 425-428 (`call` is already
imported at line 4):

- `test_invalid_sort_defaults_to_year` (line 377): replace
  `table.order.assert_called_with("year", desc=False)` with

  ```python
          table.order.assert_has_calls([
              call("year", desc=False),
              call("case_id", desc=False),
          ])
  ```

- `test_date_sort_degrades_to_year_for_stability` (line 399): replace
  `table.order.assert_called_with("year", desc=True)` with

  ```python
          table.order.assert_has_calls([
              call("year", desc=True),
              call("case_id", desc=True),
          ])
  ```

This change is code-level only — it has not been exercised against a live
Supabase instance, and the mocked tests verify the emitted query shape, not
Postgres behaviour.

**Verify**: `.venv/bin/python -m pytest tests/test_supabase_repository.py -q`
→ all pass.

### Step 7: Add the permanent regression tests

Create `tests/test_cases_pagination_correctness.py` with exactly this content:

```python
"""End-to-end correctness of the /api/v1/cases pagination planner.

Every page a listing serves must be the same window the offset path would
serve, and a full walk must yield every row exactly once. These tests drive the
same planner + loader pair that `list_cases()` uses, against a real temporary
SQLite database.

Regression coverage:
  * the reverse tail walk used to return a shifted, full-size window whenever
    total % page_size != 0
  * the anchor cache key used to ignore page_size
  * sort_by="date" used to be routed to a seek path ordered by (year, case_id)
  * forward paging used to never record an anchor
"""

import os
import tempfile

import pytest

from immi_case_downloader.cases_pagination import CaseListQuery, choose_pagination_plan
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.web.routes.api import CASE_LIST_COLUMNS
from immi_case_downloader.web.routes.api_cases import (
    _load_cases_via_seek,
    _maybe_remember_offset_anchor,
)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _build_repo(tmp_path, count, dated=False):
    """Create a temporary SQLite repo with `count` deterministic cases."""
    repo = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))
    repo.save_many([
        ImmigrationCase(
            case_id=f"c{i:05d}",
            citation=f"[{2000 + i % 26}] AATA {i}",
            title=f"Case {i}",
            court="AATA",
            court_code="AATA",
            date=(
                f"{(i % 28) + 1} {MONTHS[i % 12]} {2000 + i % 26}"
                if dated
                else str(2000 + i % 26)
            ),
            year=2000 + i % 26,
            url=f"http://example.test/{i}",
        )
        for i in range(count)
    ])
    return repo


def _offset_ids(repo, query, page, page_size):
    """The window the legacy offset path returns — the reference answer."""
    rows = repo.list_cases_fast(
        court=query.court,
        year=query.year,
        visa_type=query.visa_type,
        source=query.source,
        tag=query.tag,
        nature=query.nature,
        keyword=query.keyword,
        sort_by=query.sort_by,
        sort_dir=query.sort_dir,
        page=page,
        page_size=page_size,
        columns=CASE_LIST_COLUMNS,
    )
    return [c.case_id for c in rows]


def _serve_page(repo, query, page, page_size, total):
    """Mirror of `list_cases()`: plan, run the seek path, fall back to offset."""
    total_pages = max(1, (total + page_size - 1) // page_size)
    plan = choose_pagination_plan(
        repo=repo, query=query, page=page, total_pages=total_pages
    )
    rows, strategy, _reason = _load_cases_via_seek(
        repo,
        query=query,
        plan=plan,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
    )
    if strategy == "offset_fallback":
        rows = repo.list_cases_fast(
            court=query.court,
            year=query.year,
            visa_type=query.visa_type,
            source=query.source,
            tag=query.tag,
            nature=query.nature,
            keyword=query.keyword,
            sort_by=query.sort_by,
            sort_dir=query.sort_dir,
            page=page,
            page_size=page_size,
            columns=CASE_LIST_COLUMNS,
        )
        _maybe_remember_offset_anchor(
            repo,
            query=query,
            page=page,
            page_size=page_size,
            page_cases=rows,
        )
    return [c.case_id for c in rows], strategy


def _query(sort_by="year", sort_dir="desc", page_size=50):
    return CaseListQuery(sort_by=sort_by, sort_dir=sort_dir, page_size=page_size)


@pytest.mark.parametrize(
    ("count", "page_size"),
    [(105, 50), (250, 100), (997, 100), (120, 10), (50, 50), (49, 50)],
)
@pytest.mark.parametrize("sort_dir", ["desc", "asc"])
def test_every_page_matches_the_offset_path(tmp_path, count, page_size, sort_dir):
    """A page served by any strategy equals the page the offset path serves."""
    repo = _build_repo(tmp_path, count)
    total = repo.count_cases()
    query = _query(sort_dir=sort_dir, page_size=page_size)
    total_pages = max(1, (total + page_size - 1) // page_size)

    for page in range(1, total_pages + 1):
        got, strategy = _serve_page(repo, query, page, page_size, total)
        assert got == _offset_ids(repo, query, page, page_size), (
            f"page {page}/{total_pages} served by {strategy} does not match offset"
        )


def test_last_page_is_partial_not_a_full_shifted_window(tmp_path):
    """105 rows at page_size=50: the last page has 5 rows, not 50."""
    repo = _build_repo(tmp_path, 105)
    total = repo.count_cases()
    query = _query(page_size=50)

    got, _strategy = _serve_page(repo, query, 3, 50, total)

    assert len(got) == 5
    assert got == _offset_ids(repo, query, 3, 50)


def test_full_walk_is_complete_and_duplicate_free(tmp_path):
    """Concatenating every page yields each case exactly once."""
    repo = _build_repo(tmp_path, 997)
    total = repo.count_cases()
    page_size = 100
    query = _query(page_size=page_size)

    seen = []
    for page in range(1, (total + page_size - 1) // page_size + 1):
        ids, _strategy = _serve_page(repo, query, page, page_size, total)
        seen.extend(ids)

    assert len(seen) == total
    assert len(set(seen)) == total


def test_date_sorted_walk_is_complete_and_duplicate_free(tmp_path):
    """sort_by='date' must not cross an ordering boundary mid-walk."""
    repo = _build_repo(tmp_path, 250, dated=True)
    total = repo.count_cases()
    page_size = 10
    query = _query(sort_by="date", page_size=page_size)

    seen = []
    strategies = set()
    for page in range(1, (total + page_size - 1) // page_size + 1):
        ids, strategy = _serve_page(repo, query, page, page_size, total)
        strategies.add(strategy)
        seen.extend(ids)

    assert len(seen) == total
    assert len(set(seen)) == total
    assert strategies == {"offset_fallback"}


def test_forward_paging_populates_the_anchor_cache(tmp_path):
    """Walking past the anchor interval must let a later page seek again."""
    repo = _build_repo(tmp_path, 250)
    total = repo.count_cases()
    page_size = 10
    query = _query(page_size=page_size)

    strategy = None
    ids = []
    for page in range(1, 12):
        ids, strategy = _serve_page(repo, query, page, page_size, total)

    assert strategy == "seek_forward"
    assert ids == _offset_ids(repo, query, 11, page_size)


def test_anchors_are_not_shared_across_page_sizes(tmp_path):
    """An anchor recorded at one page_size must not be reused at another."""
    repo = _build_repo(tmp_path, 120)
    total = repo.count_cases()

    # Warm the cache at page_size=10 (page 10 of 12 records an anchor).
    _serve_page(repo, _query(page_size=10), 10, 10, total)

    small = _query(page_size=5)
    got, _strategy = _serve_page(repo, small, 11, 5, total)

    assert got == _offset_ids(repo, small, 11, 5)


def test_anchors_are_not_shared_across_databases(tmp_path):
    """Two SQLite databases in one process must not read each other's anchors.

    backend_kind_for_repo() answers "sqlite" for both, so before the dataset id
    was part of the cache key this served database B a cursor into database A.
    """
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    repo_a = _build_repo(dir_a, 250)
    repo_b = _build_repo(dir_b, 250)
    page_size = 10
    query = _query(page_size=page_size)
    total = repo_a.count_cases()

    # Warm A up to and past the anchor interval.
    for page in range(1, 12):
        _serve_page(repo_a, query, page, page_size, total)

    # B has never been walked: page 11 must still be right.
    got, _strategy = _serve_page(repo_b, query, 11, page_size, total)

    assert got == _offset_ids(repo_b, query, 11, page_size)


# ── The real endpoint ─────────────────────────────────────────────────────
# Everything above drives the planner and loader directly. These drive
# GET /api/v1/cases, which is the only way to catch list_cases() forgetting to
# pass page_size or total, or its outer `except Exception` swallowing a failure
# into an empty 200.


def _sqlite_app(tmp_path, count):
    """A Flask app whose SQLite repo holds `count` deterministic cases."""
    from immi_case_downloader.web import create_app

    repo = _build_repo(tmp_path, count)   # writes tmp_path/cases.db
    repo.close()
    app = create_app(str(tmp_path), backend="sqlite")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


def _http_ids(client, page, page_size, sort_by="year", sort_dir="desc"):
    resp = client.get(
        f"/api/v1/cases?sort_by={sort_by}&sort_dir={sort_dir}"
        f"&page={page}&page_size={page_size}"
    )
    assert resp.status_code == 200, resp.status_code
    body = resp.get_json()
    return [c["case_id"] for c in body["cases"]], body


@pytest.mark.parametrize("page_size", [10, 50])
def test_http_full_walk_matches_the_offset_path(tmp_path, page_size):
    """Every page of a real HTTP walk equals the offset path's window."""
    app = _sqlite_app(tmp_path, 250)
    reference = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))
    query = _query(page_size=page_size)
    total = reference.count_cases()
    total_pages = max(1, (total + page_size - 1) // page_size)

    seen = []
    with app.test_client() as client:
        for page in range(1, total_pages + 1):
            got, body = _http_ids(client, page, page_size)
            assert got == _offset_ids(reference, query, page, page_size), (
                f"HTTP page {page}/{total_pages} does not match the offset path"
            )
            assert body["page_size"] == page_size
            seen.extend(got)

    assert len(seen) == total
    assert len(set(seen)) == total


def test_http_page_size_switch_returns_the_right_window(tmp_path):
    """Walking at one page size then switching must not reuse those anchors."""
    app = _sqlite_app(tmp_path, 250)
    reference = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))

    with app.test_client() as client:
        for page in range(1, 12):
            _http_ids(client, page, 10)
        got, _body = _http_ids(client, 11, 5)

    assert got == _offset_ids(reference, _query(page_size=5), 11, 5)


def test_http_pages_are_correct_after_an_insert(tmp_path):
    """A row added mid-browse must not leave a stale anchor behind."""
    from immi_case_downloader.web.routes.api import _invalidate_cases_cache

    app = _sqlite_app(tmp_path, 250)
    db_path = os.path.join(str(tmp_path), "cases.db")
    reference = SqliteRepository(db_path)
    page_size = 10
    query = _query(page_size=page_size)

    with app.test_client() as client:
        for page in range(1, 12):
            _http_ids(client, page, page_size)

        writer = SqliteRepository(db_path)
        writer.save_many([
            ImmigrationCase(
                case_id="c99999", citation="[2025] AATA 9999", title="Inserted",
                court="AATA", court_code="AATA", date="2025", year=2025,
                url="http://example.test/inserted",
            )
        ])
        writer.close()
        _invalidate_cases_cache()

        total = reference.count_cases()
        got, _body = _http_ids(client, 11, page_size)

    assert total == 251
    assert got == _offset_ids(reference, query, 11, page_size)


def test_http_pages_are_correct_after_a_delete(tmp_path):
    """Deleting a row above the cursor shifts every later row."""
    from immi_case_downloader.web.routes.api import _invalidate_cases_cache

    app = _sqlite_app(tmp_path, 250)
    db_path = os.path.join(str(tmp_path), "cases.db")
    reference = SqliteRepository(db_path)
    page_size = 10
    query = _query(page_size=page_size)

    with app.test_client() as client:
        first_page, _body = _http_ids(client, 1, page_size)
        for page in range(2, 12):
            _http_ids(client, page, page_size)

        writer = SqliteRepository(db_path)
        writer.delete(first_page[0])
        writer.close()
        _invalidate_cases_cache()

        got, _body = _http_ids(client, 11, page_size)

    assert reference.count_cases() == 249
    assert got == _offset_ids(reference, query, 11, page_size)
```

**Verify**:

```bash
.venv/bin/python -m pytest tests/test_cases_pagination_correctness.py -q
```

→ `23 passed` (12 parametrised cases of `test_every_page_matches_the_offset_path`,
2 of `test_http_full_walk_matches_the_offset_path`, plus 9 named tests), 0
failed. This is a per-file count, so it is stable no matter what sibling plans
land; if it differs, count the tests you actually wrote and reconcile before
moving on. Then:

```bash
.venv/bin/ruff check tests/test_cases_pagination_correctness.py
```

→ `All checks passed!`

If any test in this file fails, the fix from Steps 2–6 is wrong or incomplete —
do not weaken the test. See STOP conditions.

### Step 8: Re-run the probe and the full suite

**Verify**, in order:

```bash
.venv/bin/python /tmp/immi-seek-probe.py
```

→ last line reads exactly `DEFECTS PRESENT: 0/4 []`.

```bash
.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_supabase_repository.py tests/test_cases_api.py tests/test_cursor_pagination.py tests/test_sqlite_repository.py -q
```

→ the same passed count as `SUBSET_BEFORE` from Step 1 — this plan edits four
assertions in that set and adds no test to those files, so the number must not
move at all.

```bash
make lint
```

→ `All checks passed!`

```bash
make test-py 2>&1 | grep -E '[0-9]+ passed'
make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u
```

→ the passed count must equal `SUITE_BEFORE + 23` (the 23 tests in the new
file), and the second command must print exactly the same list it printed in
Step 1 — i.e. `tests/test_backfill_judge_overrides_from_pdf.py` alone, the
pre-existing `pypdf`/`pyexpat` environment failures described under "Commands
you will need". A count that matches but a failure list that grew is a
regression, which is why both commands are run. This takes over 10 minutes;
give it a long timeout or run it in the background. If any *other* test fails,
STOP.

Finally, confirm you touched nothing outside the scope list:

```bash
git status --short
```

→ shows only the in-scope paths (plus `plans/README.md` if it exists).
`/tmp/immi-seek-probe.py` must not appear.

## Test plan

New file: `tests/test_cases_pagination_correctness.py` (full content in Step 7),
23 tests total:

| Test | Covers |
|---|---|
| `test_every_page_matches_the_offset_path` (12 params) | Happy path + the tail-window shift, at six `(count, page_size)` shapes × both sort directions, including exact multiples (250/100, 50/50), non-multiples (105/50, 997/100, 120/10), and a single short page (49/50). |
| `test_last_page_is_partial_not_a_full_shifted_window` | The specific regression: 105 rows at `page_size=50` returned 50 rows on page 3 instead of 5. |
| `test_full_walk_is_complete_and_duplicate_free` | No row is duplicated or unreachable across a whole listing. |
| `test_date_sorted_walk_is_complete_and_duplicate_free` | `sort_by="date"` stays on one ordering for the whole walk (pre-fix: 248 unique of 250). |
| `test_forward_paging_populates_the_anchor_cache` | The deep-page optimisation actually fires after an ordinary forward walk. |
| `test_anchors_are_not_shared_across_page_sizes` | An anchor recorded at `page_size=10` is not reused at `page_size=5`. |
| `test_anchors_are_not_shared_across_databases` | Two SQLite files in one process do not share cursors (Step 3's dataset id). |
| `test_http_full_walk_matches_the_offset_path` (2 params) | The same guarantee **through `GET /api/v1/cases`**, at two page sizes — the only check that catches `list_cases()` forgetting to pass `page_size`/`total`, or its outer `except Exception` turning a failure into an empty 200. |
| `test_http_page_size_switch_returns_the_right_window` | Page-size switching over the real endpoint. |
| `test_http_pages_are_correct_after_an_insert` | A mid-browse insert invalidates the anchors (Step 5b). |
| `test_http_pages_are_correct_after_a_delete` | A mid-browse delete invalidates the anchors (Step 5b). |

Structural pattern to follow: `tests/test_cases_pagination.py` (same imports
style, same `_query()` helper idiom, plain `assert`). Anchor-cache isolation is
already handled by the autouse `reset_analytics_caches` fixture in
`tests/conftest.py`, which calls `clear_cases_anchor_cache()` around every test.

Edited existing tests (4 assertions, no new tests in these files):

- `tests/test_cases_pagination.py` — `test_date_sort_no_keyword_returns_true`
  becomes `test_date_sort_returns_false`; `test_head_seek_for_pages_up_to_max`
  switches its query to `sort_by="year"`.
- `tests/test_supabase_repository.py` — `test_invalid_sort_defaults_to_year`
  and `test_date_sort_degrades_to_year_for_stability` move from
  `assert_called_with` to `assert_has_calls` including the new `case_id` order.

Not covered by automated tests: the Supabase tiebreaker's effect against a live
Postgres instance (Step 6 is verified only at the emitted-query level, by
mocks). Noted deliberately.

## Done criteria

ALL must hold:

- [ ] `.venv/bin/python /tmp/immi-seek-probe.py` prints `DEFECTS PRESENT: 0/4 []`
- [ ] `.venv/bin/python -m pytest tests/test_cases_pagination_correctness.py -q` → `23 passed` (a per-file count; stable regardless of sibling plans)
- [ ] `.venv/bin/python -m pytest tests/test_cases_pagination_correctness.py -q -k "across_databases or after_an_insert or after_a_delete"` → `3 passed` (the three tests that only Steps 3 and 5b can make pass)
- [ ] `.venv/bin/python -m pytest tests/test_cases_pagination.py tests/test_supabase_repository.py tests/test_cases_api.py tests/test_cursor_pagination.py tests/test_sqlite_repository.py -q` → the passed count equals `SUBSET_BEFORE` from Step 1, unchanged
- [ ] `make test-py` passed count equals `SUITE_BEFORE + 23`, and `make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u` prints exactly `tests/test_backfill_judge_overrides_from_pdf.py` — the same three environmental `pypdf`/`pyexpat` ImportErrors, by name, that Step 1 recorded
- [ ] `make lint` → `All checks passed!`
- [ ] `.venv/bin/ruff check tests/test_cases_pagination_correctness.py` → `All checks passed!`
- [ ] `grep -n 'SEEK_SORT_FIELDS = ' immi_case_downloader/cases_pagination.py` → `SEEK_SORT_FIELDS = frozenset({"year"})`
- [ ] `grep -n 'TAIL_SEEK_WINDOW_PAGES = ' immi_case_downloader/cases_pagination.py` → `TAIL_SEEK_WINDOW_PAGES = 0`
- [ ] The Step 3 `python -c` identity probe prints `cache identity covers page_size and dataset` (it asserts on behaviour; a `grep -c page_size` would also match a comment, which is why it is not used here)
- [ ] The Step 5b `python -c` probe prints `mutation invalidation clears the anchor cache`
- [ ] `grep -n 'counts_are_exact' immi_case_downloader/sqlite_repository.py` → at least one match, **and** `grep -c 'counts_are_exact' immi_case_downloader/supabase_repository.py` → `0`
- [ ] `grep -c 'order("case_id"' immi_case_downloader/supabase_repository.py` → `4` (it is `2` at HEAD — line 202 and line 598 — and Step 6 adds one to each of `filter_cases` and `list_cases_fast`), **and** `.venv/bin/python -m pytest tests/test_supabase_repository.py -q -k "invalid_sort_defaults_to_year or date_sort_degrades_to_year_for_stability"` → `2 passed` (the count alone cannot tell you the two new calls landed in the right two methods; these tests can)
- [ ] `git status --short` lists only files from the "In scope" list
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's probe does not print `DEFECTS PRESENT: 4/4 ['D1', 'D2', 'D3', 'D4']`.
  The code has drifted from what this plan describes and the rest of the steps
  may not apply.
- Any excerpt quoted in "Current state" does not match the live file at the
  cited line.
- A test in `tests/test_cases_pagination_correctness.py` fails after Step 7.
  These tests encode the contract this plan exists to establish — the correct
  response is to fix the implementation, never to relax an assertion, delete a
  parametrised case, or add `pytest.mark.skip`.
- After Step 4, `test_every_page_matches_the_offset_path` fails for an *exact
  multiple* shape (250/100 or 50/50). That would mean `last_page_size` is being
  computed wrongly even in the easy case, and the tail arithmetic needs
  rethinking rather than patching.
- You find yourself needing to change `SeekAnchor`, `_encode_cursor` /
  `_decode_cursor` (`api_cases.py:109-123`), or the `next_cursor` field of the
  `/api/v1/cases` response. That is the "teach the seek path the full composite
  date key" project, which this plan deliberately does not attempt — the plan's
  answer to date sorting is to route it to the offset path.
- `make test-py` shows failures outside
  `tests/test_backfill_judge_overrides_from_pdf.py`, or the failure list from
  Step 1 gains a name.
- The drift check shows any in-scope file as modified, staged or untracked in
  `git status --short --branch`. That is somebody's uncommitted work, and this
  plan would collide with it. Do **not** `git checkout --` or `git clean` it.
- Adding the `clear_cases_anchor_cache` import to `_invalidate_cases_cache()`
  (Step 5b) produces an `ImportError` or a circular import. It is a
  function-local import specifically to avoid that; if it still happens,
  something else changed the module graph and the invalidation needs a different
  home (the four `_api._invalidate_cases_cache()` call sites in `api_cases.py`
  are the fallback) — report before improvising.
- You conclude the right fix is to delete `cases_pagination.py` outright. That
  may well be the right long-term call, but it is a direction decision for the
  operator, not a step in a bug-fix plan. Report the reasoning and stop.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise**: the `last_page_size` arithmetic in
  `_load_cases_via_seek` and the `counts_are_exact` gate that protects it.
  Together they are the only reason the reverse walk is sound. If a future
  backend sets `counts_are_exact = True` while returning an estimated count,
  the last page silently goes wrong again with no test to catch it — the flag
  is a promise about `count_cases`, not about the class.
- **`TAIL_SEEK_WINDOW_PAGES = 0`** was chosen from a measurement (150k rows,
  `page_size=50`: reverse walk wins 30× at the last page, loses at two pages
  back). If the ordering ever gains a covering index, re-measure before raising
  it — the loop is already written to be correct for any window size, so only
  the constant needs to change.
- **Date sorting deliberately lost its seek path.** The proper fix, if deep
  date-sorted pages ever matter, is to teach `SeekAnchor` the full
  `(year, month, day, case_id)` key and give `list_cases_seek` a matching
  4-tuple comparison — which also means changing `_encode_cursor` /
  `_decode_cursor` and the `next_cursor` contract. Note the asymmetry that
  makes this cheaper on one backend than the other: Supabase already degrades
  date sorting to `year` on the offset path, so after Step 6 its offset and
  seek orderings are identical and `"date"` could be re-admitted for Supabase
  alone; SQLite is the backend that genuinely diverges.
- **The anchor cache is process-local and unbounded in time only by TTL.**
  Adding `page_size` **and** the dataset id to the key multiplies the number of
  distinct cache keys by (page sizes × datasets) in use. `MAX_ANCHOR_SIGNATURES`
  is 128 with LRU eviction, so this is bounded, but if the SPA ever exposes many
  page sizes the hit rate will drop and 128 may want raising.
- **`dataset_id_for_repo()` falls back to `id(repo)`.** That is deliberately
  conservative — a backend with neither `db_path` nor `base_dir` nor an explicit
  `pagination_dataset_id` gets a per-instance namespace, so it can only *miss*
  the cache, never read another dataset's cursor. If you add a backend where
  cache hits matter, give it a `pagination_dataset_id` property (e.g. the
  Supabase project ref plus schema) rather than widening the fallback.
- **Step 5b flushes the whole anchor cache on every mutation.** That is one
  uncached deep page per write, which is right for a local-dev tool. If writes
  ever become frequent enough for that to matter, the fix is to give
  `_invalidate_cases_cache()` the repo it is invalidating for and drop only that
  dataset's bucket — not to remove the flush.
- **`immi_case_downloader/hyperdrive_repository.py`** also declares
  `supports_seek_pagination = True` and is intentionally left without
  `counts_are_exact`, so its tail pages fall back to offset. If that module is
  deleted as part of the dead-Supabase-era cleanup, nothing here needs to
  change.
- **Explicitly deferred out of this plan**: porting seek pagination to the
  production Cloudflare Worker, and the question of whether
  `cases_pagination.py` should exist at all. See "Findings reconsidered".

## Findings reconsidered

- **"The seek-pagination planner is dead weight — it optimises the local-dev
  Flask path, not production."** The factual claims check out — I verified that
  `immi_case_downloader/cases_pagination.py`'s only non-test importer is
  `immi_case_downloader/web/routes/api_cases.py` (used at lines 798 and 805),
  that `workers/storage/cloudflare.js:497-502` issues an
  `ORDER BY … , c.case_id ASC LIMIT ? OFFSET ?` with no seek path, and that
  `workers/case-api/cloudflare.js:1093` routes `/api/v1/cases` straight to
  `listPage()`. But this is a maintainability
  observation, not a defect: the planner imposes zero production runtime cost,
  so there is nothing to fix in production. The only production-relevant half —
  whether deep `OFFSET` on `listPage()` needs a D1 index — is a separate,
  Worker-scoped concern and is out of this plan's file territory. Deleting
  `cases_pagination.py` versus keeping it as documented local-dev tooling is a
  direction call for the operator that should be made *after* the D1 index
  question is settled, since that determines whether porting the strategy is
  ever warranted. Dropped from the steps; recorded here so nobody re-audits it.

## Evidence corrections

Every file:line cited in the findings this plan addresses was opened and
confirmed at commit `42826a3`. Two attributions needed adjustment:

- The claim "sqlite_repository.py:201 gives the offset path a year/month/day
  ordering" is right about the behaviour but the line is the `if sort_by ==
  "date":` test; the ordering itself is built across lines 202-223, and the
  generic `ORDER BY <col>, case_id` fallback used by `sort_by="year"` is line
  226. Both are quoted above.
- The finding for the tail-window bug pointed at
  `immi_case_downloader/web/routes/api_cases.py:294` and `:317`; those are
  correct, but the actual defect is the `page_size=page_size` argument on line
  304 inside that call. The fix in Step 4 targets line 304, not 294.

Reproduction figures differ from the original report in magnitude because they
depend on the synthetic data shape. Measured here at `42826a3`: the date-sort
walk over 1,000 dated rows at `page_size=50` collected 1,000 ids with 993
unique (7 duplicated, 7 unreachable) rather than the 75/75 originally reported;
over 250 rows at `page_size=10` it is 248 unique of 250. The mechanism — the
`seek_forward` → `offset_fallback` boundary at page 4 — is exactly as described.

## Review points not applied

One sub-claim from the cross-plan review was checked against the live code and
does not hold as stated. Everything else it raised has been applied above.

- **"026 Step 5 must hook into `api.py`'s cache invalidation, which *conflicts
  with* plan 028 Steps 1–5; hand `api.py` to a single integrator rather than
  letting either agent patch it."** The first half is right and is now Step 5b.
  The "conflicts with 028 Steps 1–5" half is not: the two plans edit disjoint
  regions of the same file. `_invalidate_cases_cache()` is
  `immi_case_downloader/web/routes/api.py:1059-1071`, and every region
  `plans/028-fix-flask-analytics-fallback.md` lists as in scope for that file is
  outside it — lines 268–302 (`_load_judge_bios`,
  `_load_judge_name_overrides`), 1028–1056 and 1089–1127 (the case caches and
  warmup fillers, explicitly excluding 1059–1071), 1074–1076
  (`_analytics_cache_key`), 1177–1186 (`_has_analytics_filters`), 1282–1290
  (`_call_with_timeout`) and 1670–1911 (the four analytics endpoints). A
  three-line edit inside 1059–1071 therefore produces no overlapping hunk with
  028, and deferring it to an integrator would mean shipping this plan with the
  stale-anchor defect it exists to close still open. The edit stays here; the
  Depends-on section flags the shared file to the integrator, which is the part
  of the recommendation that is genuinely needed.
