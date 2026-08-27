# Plan 028: Stop returning empty analytics and calling it a timeout

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE="immi_case_downloader/web/routes/api.py \
>   immi_case_downloader/web/cache.py \
>   immi_case_downloader/sqlite_repository.py \
>   immi_case_downloader/storage.py \
>   tests/test_sqlite_repository.py tests/test_cache.py"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $IN_SCOPE   # committed drift
> git diff --stat -- $IN_SCOPE                 # unstaged drift
> git diff --cached --stat -- $IN_SCOPE        # staged drift
> ```
> All three `git diff` invocations must print nothing. A committed diff means a
> sibling plan landed — compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.
> **An in-scope path appearing as modified, staged or untracked in
> `git status --short --branch` is also a STOP condition**: a range diff cannot
> see uncommitted, staged or untracked work, so a dirty tree gives a false
> all-clear and this plan would edit on top of somebody else's changes. Never
> run `git checkout --` or `git clean -f` to "clean up" — that destroys the
> operator's work. Report and stop.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/027-fix-csv-data-integrity.md`, on two shared files:
  - `immi_case_downloader/sqlite_repository.py` is edited by three plans in this
    batch (027 Steps 6–7 rewrite `save_many` and the schema, this plan's Step 7
    rewrites `get_statistics`, 026 Step 4 adds a class attribute). The agreed
    order is **027 → 028 → 026**, with a single integrator owning the file and
    running its whole test set once at the end. Run this plan second.
  - `immi_case_downloader/storage.py`: 027 Step 8e changes the `dtype=` argument
    of `load_cases_csv` (line 137); this plan's Step 7a adds a constant next to
    `CASE_FIELDS` (line ~49) and uses it at line 353. Disjoint regions — hand
    both to the integrator rather than resolving a conflict yourself.
  - `plans/026-fix-seek-pagination.md` also edits
    `immi_case_downloader/web/routes/api.py`, but only inside
    `_invalidate_cases_cache()` (line 1059), which is in none of the regions
    this plan touches. Textually disjoint; flag it to the integrator anyway.
  - **Work in your own git worktree**
    (`git worktree add ../immi-028 -b advisor/028-fix-flask-analytics-fallback`).
    Plans 026–029 all create branches; run in parallel in one checkout they
    switch each other's branch out mid-edit.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Four analytics endpoints in the local-dev Flask app — `/api/v1/analytics/outcomes`,
`/judges`, `/legal-concepts`, `/nature-outcome` — currently return `200 OK` with a
structurally-valid but **completely empty** payload on both local backends, and the
log line blames a timeout that never happened.

On the CSV backend the Python fallback hands `_get_analytics_cases` to a
`ThreadPoolExecutor`; that worker thread has no Flask application context, so the
`get_repo()` call inside it raises `RuntimeError: Working outside of application
context`. A catch-all `except (FuturesTimeoutError, Exception)` swallows it and logs
`"analytics_outcomes fallback also timed out"`. On the SQLite backend the fallback is
skipped entirely because the guard that is meant to mean "this is a remote Postgres,
don't retry" is actually testing for `count_cases`, a method SQLite also has — so the
endpoints return empty with **no log line at all**.

The net effect: anyone developing or debugging the analytics page locally sees four
blank charts, and every diagnostic signal points at the wrong cause. The same
`except (…, Exception)` shape hides every future failure in this region behind the
word "timeout". Separately, `SqliteRepository.get_statistics()` returns a different
key set from `CsvRepository`, so switching `BACKEND=sqlite` silently blanks the
dashboard's visa-subclass and visa-family charts and renders every source count as
zero — which looks like real data rather than missing data.

Two more defects in the same region were found during review and are fixed here
too. `SqliteRepository.close()` clears its connection-tracking list even for
connections it failed to close, so the application context this plan pushes in a
worker thread would leak the request thread's connection out of all tracking
(Step 1b). And the two process-global case caches — `_all_cases_cache` and
`_analytics_cases_cache` — are keyed on nothing at all, so two apps in one
process can serve each other's whole case corpus (Step 6b); that is the same
defect as the judge-bio loaders, with a much larger blast radius.

After this plan: the fallback actually runs on both local backends and returns real
aggregates; a filtered request that never attempted an RPC gets the fallback
instead of an empty payload; a genuine timeout is logged as a timeout and
anything else is logged with a traceback; the analytics result cache is bounded
and prunes expired entries; the case caches and the judge-bio loaders are keyed
on the repository and output directory they actually read; connections are no
longer leaked by a cross-thread `close()`; and both local repository backends
return the same `get_statistics()` payload — the whole nine-key dict, ties
included — enforced by a contract test.

## Current state

### Files

- `immi_case_downloader/web/routes/api.py` — the Flask JSON API (2657 lines). This
  plan edits exactly two regions of it: the **judge-name loader region** (lines
  268–302) and the **analytics region** (lines 90, 1074–1127, 1282–1290, 1177–1186,
  1670–1911).
- `immi_case_downloader/web/cache.py` — 39 lines, the whole `AnalyticsCache` class.
- `immi_case_downloader/sqlite_repository.py` — SQLite+FTS5 backend;
  `get_statistics()` at lines 293–334.
- `immi_case_downloader/storage.py` — the CSV backend's module-level
  `get_statistics()` at lines 326–365. This is the **canonical payload shape**; its
  return value must not change, only gain a named constant.

### The app-context bug (PYCORR-03)

`immi_case_downloader/web/helpers.py:66-73` — both accessors read `current_app`, so
both need a Flask application context:

```python
def get_output_dir() -> str:
    """Return the configured output directory from the current app."""
    return current_app.config.get("OUTPUT_DIR", OUTPUT_DIR)


def get_repo():
    """Return the active CaseRepository from the current app."""
    return current_app.config["REPO"]
```

`immi_case_downloader/web/routes/api.py:1107-1127` — the analytics case loader calls
`get_repo()` at line 1121:

```python
def _get_analytics_cases() -> list[ImmigrationCase]:
    """Return analytics-optimised cases (7 cols, ~13s load) with 5-min cache.

    Uses load_analytics_cases() when available (Supabase backend) to fetch
    only the 7 columns needed for analytics aggregation, making the load
    ~4x faster than the full load_all() (13s vs 57s on free tier).
    """
    global _analytics_cases_cache, _analytics_cases_ts
    now = time.time()
    if _analytics_cases_cache and (now - _analytics_cases_ts) < _ANALYTICS_CASES_TTL:
        return _analytics_cases_cache
    with _analytics_cases_lock:
        if _analytics_cases_cache and (time.time() - _analytics_cases_ts) < _ANALYTICS_CASES_TTL:
            return _analytics_cases_cache
        repo = get_repo()
        if hasattr(repo, "load_analytics_cases"):
            _analytics_cases_cache = repo.load_analytics_cases()
        else:
            _analytics_cases_cache = repo.load_all()
        _analytics_cases_ts = time.time()
        return _analytics_cases_cache
```

`immi_case_downloader/web/routes/api.py:1282-1290` — the executor wrapper. A worker
thread does **not** inherit the request's application context:

```python
def _call_with_timeout(
    func,
    timeout_seconds: float = SUPABASE_RPC_TIMEOUT_SECONDS,
    executor: ThreadPoolExecutor | None = None,
):
    """Execute a callable with timeout protection."""
    worker = executor or _rpc_executor
    future = worker.submit(func)
    return future.result(timeout=timeout_seconds)
```

`immi_case_downloader/web/routes/api.py:90` — the shared pool:

```python
_rpc_executor = ThreadPoolExecutor(max_workers=4)
```

`immi_case_downloader/web/routes/api.py:1704-1726` — the outcomes endpoint's two
`except` clauses and the backend gate. `(FuturesTimeoutError, Exception)` is
equivalent to bare `except Exception`, because `concurrent.futures.TimeoutError` is a
subclass of `Exception`:

```python
            _rpc_ok = True
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_outcomes RPC failed/timed out, falling back to Python")
    # Skip Python fallback for Supabase repos — if the RPC timed out, the
    # fallback (which also queries Supabase) will also timeout, wasting another
    # 20 seconds and blowing the Cloudflare Worker 30 s wall-clock limit.
    _supabase_backend = hasattr(repo, "count_cases")
    if not _rpc_ok and not _supabase_backend:
        # Fallback: load cases into Python (only for CSV/SQLite backends).
        try:
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=15.0)
            for c in _apply_filters(cases):
                norm = _normalise_outcome(c.outcome)
                if c.court_code:
                    by_court[c.court_code][norm] += 1
                if c.year:
                    by_year[str(c.year)][norm] += 1
                if c.visa_subclass:
                    cleaned = _clean_visa(c.visa_subclass)
                    if cleaned:
                        by_subclass[cleaned][norm] += 1
                        by_family[get_family(cleaned)][norm] += 1
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_outcomes fallback also timed out, returning empty result")
```

The identical shape repeats at lines **1773/1775/1776/1790** (`analytics_judges`),
**1832/1834/1835/1841** (`analytics_legal_concepts`) and
**1876/1878/1879/1887** (`analytics_nature_outcome`). There are exactly **8**
occurrences of `except (FuturesTimeoutError, Exception):` and **8** occurrences of
`_supabase_backend` in this file.

**Reproduced at `42826a3`** (CSV backend, analytics case cache cleared to simulate the
5-minute TTL lapsing): `GET /api/v1/analytics/outcomes` → `200` with
`{'by_court': {}, 'by_family': {}, 'by_subclass': {}, 'by_year': {}}`, log line
`analytics_outcomes fallback also timed out, returning empty result`. Calling
`_get_analytics_cases()` inside `app.app_context()` on the same app returns 3 cases;
calling it through `_call_with_timeout` raises
`RuntimeError: Working outside of application context.`

**Also reproduced**: on the SQLite backend, `hasattr(repo, "count_cases")` is `True`
and `hasattr(repo, "get_analytics_outcomes")` is `False`, so the fallback is skipped
and the endpoint returns the same empty payload with no log line at all.
`SqliteRepository.count_cases` is defined at `immi_case_downloader/sqlite_repository.py:428`;
`SupabaseRepository` defines both `count_cases` (line 611) and the four
`get_analytics_*` RPCs (lines 273, 300, 308, 316), and `HyperdriveRepository` defines
both as well (lines 371, 410, 424, 427, 430). So switching the guard from
`count_cases` to the endpoint's own RPC method is a **no-op** on Supabase and
Hyperdrive and unblocks SQLite.

### The cache key and the cache itself (PYCORR-13)

`immi_case_downloader/web/routes/api.py:1074-1076`:

```python
def _analytics_cache_key() -> str:
    """Build a stable cache key from the current request's sorted query args."""
    return str(sorted(request.args.items()))
```

`immi_case_downloader/web/routes/api.py:1177-1186` — the authoritative filter list:

```python
def _has_analytics_filters() -> bool:
    """Return True if any analytics filter query param is present.

    Used to decide whether to take the fast Supabase RPC path (no filters)
    or the Python aggregation path (filters require loading cases locally).
    """
    return any(request.args.get(p) for p in (
        "court", "year_from", "year_to",
        "case_natures", "visa_subclasses", "visa_families", "outcome_types",
    ))
```

`analytics_judges` (line 1747) and `analytics_legal_concepts` (line 1817) additionally
read a `limit` param:

```python
    limit = safe_int(request.args.get("limit"), default=20, min_val=1, max_val=100)
```

so `limit` **must** stay in the cache key or those two endpoints will serve a
20-item list to a `?limit=5` request.

`immi_case_downloader/web/cache.py:19-39` — the whole storage layer, with no capacity
bound and no eviction of stale entries:

```python
    def __init__(self, ttl: float = 300.0) -> None:
        self._ttl = ttl
        self._store: dict[str, tuple[dict, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> dict | None:
        """Return cached payload if still fresh, else ``None``."""
        entry = self._store.get(key)
        if entry and (time.time() - entry[1]) < self._ttl:
            return entry[0]
        return None

    def set(self, key: str, payload: dict) -> None:
        """Store *payload* under *key* with the current timestamp."""
        with self._lock:
            self._store[key] = (payload, time.time())

    def invalidate(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()
```

Two module-level aliases in `api.py:97-98` point *into* the instance and must keep
working (`_invalidate_cases_cache()` calls `_analytics_cache.clear()` at line 1071):

```python
_analytics_cache: dict[str, tuple[dict, float]] = _analytics_cache_obj._store
_analytics_cache_lock = _analytics_cache_obj._lock
```

The exemplar for bounded+pruned caching already in this repo is
`immi_case_downloader/cases_pagination.py:114-124`:

```python
    def _prune_locked(self, now: float) -> None:
        expired = [
            key
            for key, bucket in self._entries.items()
            if now - bucket.last_seen_at > ANCHOR_TTL_SECONDS
        ]
        for key in expired:
            self._entries.pop(key, None)

        while len(self._entries) > MAX_ANCHOR_SIGNATURES:
            self._entries.popitem(last=False)
```

Match that structure.

### The judge loaders (PYCORR-20)

`immi_case_downloader/web/routes/api.py:268-272` and `293-302` — both are cached on
*nothing* while reading `get_output_dir()`, which varies per app instance:

```python
@lru_cache(maxsize=1)
def _load_judge_bios() -> dict[str, dict]:
    """Load judge biography map from disk once per process."""
    bio_path = os.path.join(get_output_dir(), "judge_bios.json")
    if not os.path.exists(bio_path):
        return {}
```

```python
@lru_cache(maxsize=1)
def _load_judge_name_overrides() -> dict[str, str]:
    """Load alias -> full-name overrides from output dir, fallback to packaged defaults."""
    package_default = (
        Path(__file__).resolve().parents[2] / "data" / "judge_name_overrides.json"
    )
    candidate_paths = [
        Path(get_output_dir()) / "judge_name_overrides.json",
        package_default,
    ]
```

**Reproduced at `42826a3`**: two apps created in one process over two different output
dirs, with `judge_bios.json` present only in dir A. Inside `app_b.app_context()`,
`_load_judge_bios()` returns dir A's map
(`{'alpha': {'full_name': 'Member Alpha From A'}}`) instead of `{}`.

**Both functions are patched by name in 24 places across two test files**
(10 in `tests/test_analytics_api.py`, 14 in
`tests/test_taxonomy_countries_and_judges_api.py`; the call chain that makes them
necessary is documented at `tests/test_api_helpers.py:293-294`). The zero-argument public name
`_load_judge_bios` / `_load_judge_name_overrides` **must survive** — do not change
their signatures. Add a keyed inner function and keep the public wrapper.

The measured cost of moving `get_output_dir()` to the caller is ~0.36 µs per call
(300 000 calls in 0.107 s on this machine), so the two extra calls per
`_split_judges()` invocation are not a performance concern.

### The statistics contract (PYCORR-24)

`immi_case_downloader/sqlite_repository.py:293-334` — groups on the **full court
name**, and returns neither `by_source` nor `by_visa_subclass`:

```python
    def get_statistics(self) -> dict:
        conn = self._conn()
        total = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]

        by_court = {}
        for row in conn.execute("SELECT court, COUNT(*) as cnt FROM cases GROUP BY court ORDER BY court"):
            by_court[row["court"] or "Unknown"] = row["cnt"]

        by_year = {}
        for row in conn.execute("SELECT year, COUNT(*) as cnt FROM cases WHERE year > 0 GROUP BY year ORDER BY year"):
            by_year[row["year"]] = row["cnt"]

        by_nature = {}
        for row in conn.execute(
            "SELECT case_nature, COUNT(*) as cnt FROM cases WHERE case_nature != '' "
            "GROUP BY case_nature ORDER BY cnt DESC"
        ):
            by_nature[row["case_nature"]] = row["cnt"]

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
            "visa_types": visa_types,
            "with_full_text": with_text,
            "sources": sources,
        }
```

`immi_case_downloader/storage.py:352-365` — the canonical shape (used by
`CsvRepository.get_statistics`, `immi_case_downloader/csv_repository.py:66-67`):

```python
    # Sort visa subclasses by count descending, top 20
    sorted_subclasses = dict(sorted(by_visa_subclass.items(), key=lambda x: x[1], reverse=True)[:20])

    return {
        "total": len(cases),
        "by_court": dict(sorted(by_court.items())),
        "by_year": dict(sorted(by_year.items())),
        "by_nature": dict(sorted(by_nature.items(), key=lambda x: x[1], reverse=True)),
        "by_visa_subclass": sorted_subclasses,
        "by_source": dict(sorted(by_source.items(), key=lambda x: x[1], reverse=True)),
        "visa_types": sorted(visa_types),
        "with_full_text": with_text,
        "sources": sorted({c.source for c in cases if c.source}),
    }
```

and `immi_case_downloader/storage.py:337-350` shows the exact bucketing rules the
SQL must reproduce:

```python
    for c in cases:
        by_court[c.court_code or "Unknown"] = by_court.get(c.court_code or "Unknown", 0) + 1
        if c.year:
            by_year[c.year] = by_year.get(c.year, 0) + 1
        if c.visa_type:
            visa_types.add(c.visa_type)
        if c.case_nature:
            by_nature[c.case_nature] = by_nature.get(c.case_nature, 0) + 1
        if c.visa_subclass:
            by_visa_subclass[c.visa_subclass] = by_visa_subclass.get(c.visa_subclass, 0) + 1
        src = c.source or "Unknown"
        by_source[src] = by_source.get(src, 0) + 1
        if c.full_text_path:
            with_text += 1
```

`immi_case_downloader/web/routes/api.py:1444-1446` and `1475-1486` — the only consumer
of `get_statistics()` that reads more than `total`:

```python
    sources_dict = s.get("by_source", {})
    if not sources_dict:
        sources_dict = {src: 0 for src in s.get("sources", [])}
```

```python
    raw_visa = s.get("by_visa_subclass", {})
    cleaned_visa = {_clean_visa(k): v for k, v in raw_visa.items() if _clean_visa(k)}

    payload = {
        "total_cases": s.get("total", 0),
        "with_full_text": s.get("with_full_text", 0),
        "courts": s.get("by_court", {}),
        "years": s.get("by_year", {}),
        "natures": s.get("by_nature", {}),
        "visa_subclasses": cleaned_visa,
        "visa_families": group_by_family(raw_visa),
        "sources": sources_dict,
        "recent_cases": recent,
    }
```

**Reproduced at `42826a3`** on the same three cases loaded into both backends:

| | CsvRepository | SqliteRepository |
|---|---|---|
| key set | `by_court by_nature by_source by_visa_subclass by_year sources total visa_types with_full_text` | `by_court by_nature by_year sources total visa_types with_full_text` |
| `by_court` | `{'AATA': 3}` | `{'Administrative Appeals Tribunal': 3}` |
| `by_source` | `{'AustLII': 3}` | missing → endpoint renders `{'AustLII': 0}` |
| `by_visa_subclass` | `{'866': 3}` | missing → `visa_subclasses` and `visa_families` both render `{}` |

The SQLite schema already has every column needed
(`immi_case_downloader/sqlite_repository.py:25-56`: `court_code`, `source`,
`visa_subclass` are all `TEXT NOT NULL DEFAULT ''`).

`SupabaseRepository.get_statistics` (line 439) and `HyperdriveRepository.get_statistics`
(line 229) both delegate to the server-side `get_case_statistics()` SQL function, so
their shape is defined by the database, not by Python — they are **not** contract-testable
from this working copy and are out of scope.

### Repo conventions that apply here

- **Python constructs cases via `ImmigrationCase.from_dict()`** because pandas turns
  empty CSV fields into `float('nan')`. New tests that build cases directly with the
  `ImmigrationCase(...)` constructor and call `.ensure_id()` are fine — that is what
  every existing test fixture does (see `tests/conftest.py:96-120`).
- **`CaseRepository` is a `Protocol`** (`immi_case_downloader/repository.py:41-43`);
  `get_statistics()` is declared there with no shape. Backends are duck-typed.
- **Commit format**: `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real example
  from `git log`: `fix: install root node_modules in make install`.
- **Named constants, not magic numbers.** The top-20 visa-subclass cap must become a
  shared named constant rather than a second literal `20`.
- **Never interpolate values into SQL strings.** Use bound parameters (`?`).
- The Flask app is **local-dev only**; production is the Cloudflare Worker
  (`workers/cloudflare-native.js`). Nothing in this plan touches production.

## Commands you will need

Run every command from the repository root
`/Users/d/Developer/Active Projects/IMMI-Case-` unless the command itself changes
directory. Always use the venv interpreter — never global `pip`/`python3`.

| Purpose | Command | Expected on success |
|---|---|---|
| Full Python suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | judged as a **delta** against the `SUITE_BEFORE` you record before Step 1 (`make test-py 2>&1 \| grep -E '[0-9]+ passed'`), plus an unchanged failure list. The **3 failures are environmental and pre-existing** — a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`. They are not caused by repo code and are not this plan's problem. Record their names too: `make test-py 2>&1 \| grep -E "FAILED\|ERROR" \| sed -E 's/.*(tests\/[^:]+).*/\1/' \| sort -u`. |
| One test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/<file>.py -q --no-cov` | exit 0 |
| Analytics + repo files | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_analytics_api.py tests/test_analytics_judge_api.py tests/test_analytics_concepts_api.py tests/test_taxonomy_countries_and_judges_api.py tests/test_sqlite_repository.py tests/test_storage.py tests/test_cache.py tests/test_api_helpers.py -q --no-cov` | exit 0 |
| Lint (source) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` | `All checks passed!` |
| Lint (new tests) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check tests/test_analytics_fallback.py tests/test_repository_statistics_contract.py tests/test_judge_bios_cache.py tests/test_cache.py tests/test_sqlite_repository.py` | `All checks passed!` |
| Changed-file check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the in-scope files |

`make typecheck` and the frontend/Worker Vitest suites are **not** needed — this plan
touches no TypeScript and no Worker code.

**Record the suite baseline before you change anything** — every suite-level
check in this plan is a delta against it, and there is no correct absolute
value (sibling plans in this batch add tests to the same suite):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | grep -E '[0-9]+ passed'                    # SUITE_BEFORE
make test-py 2>&1 | grep -E "FAILED|ERROR" \
  | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u                 # the failing files
```

The second command must print exactly
`tests/test_backfill_judge_overrides_from_pdf.py`. If it prints anything else,
record it — Step 9's "no new failures" check is then measured against a dirtier
baseline than this plan assumed.

Baseline per-file counts at `42826a3` (for the "+N tests" checks below):
`tests/test_sqlite_repository.py` 45, `tests/test_cache.py` 6,
`tests/test_analytics_api.py` 50. Per-file counts are stable across sibling
plans; suite totals are not.

## Scope

**In scope** (the only files you may modify or create):

- `immi_case_downloader/web/routes/api.py` — **only** these regions:
  - lines **268–302**: `_load_judge_bios`, `_load_judge_name_overrides` (Step 6)
  - lines **1028–1056** and **1089–1127**: the module-level case caches,
    `_get_all_cases`, `_get_analytics_cases` and the two warmup fillers
    (Step 6b). **Excluding `_invalidate_cases_cache` at lines 1059–1071**,
    which is `plans/026-fix-seek-pagination.md`'s edit region.
  - line **1074–1076**: `_analytics_cache_key` (Step 5)
  - lines **1177–1186**: `_has_analytics_filters` (Step 5, constant extraction only)
  - lines **1282–1290**: `_call_with_timeout` (+ new `_call_in_app_context`) (Steps 1, 4)
  - lines **1670–1911**: the four analytics endpoints (Steps 1, 2, 3)
- `immi_case_downloader/web/cache.py` (Step 5)
- `immi_case_downloader/sqlite_repository.py` — **only** `get_statistics()`
  (Step 7) and `close()` (Step 1b)
- `immi_case_downloader/storage.py` — **only** adding the `TOP_VISA_SUBCLASS_LIMIT`
  constant and rewriting the `sorted_subclasses` sort key at line 353 (Step 7).
  Same keys, same value types, same counts; tie ordering becomes deterministic.
- `tests/test_sqlite_repository.py` — **only** `TestStatistics` (lines 391–407)
- `tests/test_cache.py` — append one new test class
- `tests/test_analytics_fallback.py` — **create**
- `tests/test_repository_statistics_contract.py` — **create**
- `tests/test_judge_bios_cache.py` — **create**

**Out of scope** (do NOT touch, even though they look related):

- `immi_case_downloader/supabase_repository.py` and
  `immi_case_downloader/hyperdrive_repository.py` — their `get_statistics()` returns
  whatever the server-side `get_case_statistics()` SQL function returns. Changing the
  Python side cannot fix a shape defined in the database, and there is no live
  Postgres in this working copy to verify against. Recorded in "Maintenance notes".
- `immi_case_downloader/web/routes/api_cases.py`, `api_taxonomy.py`,
  `api_export.py`, `api_pipeline.py` — `api_cases.py:75` has its own
  `ThreadPoolExecutor(max_workers=2)` with a 0.8 s timeout and the same
  no-cancel shape, but it is a different file territory. Its `_sample_filter_options_fallback`
  (lines 419–441) is quoted in Step 1 only as the **exemplar** for closing over an
  already-resolved `repo`; do not edit it.
- Any of the other ~24 `_apply_filters(_get_analytics_cases())` call sites in
  `api.py` (lines 1585, 1917, 2065, 2137, 2174, 2218, 2269, 2332, 2423, 2505, 2602).
  Those run **in the request thread** and already have an application context.
  Only the four `_call_with_timeout(_get_analytics_cases, …)` sites are broken.
- The `except Exception` handlers outside lines 1670–1911.
- `workers/**`, `frontend/**`, `wrangler.toml`, `migrations/**` — production is the
  Cloudflare Worker and is untouched by this plan.
- The four test files that monkeypatch `_get_analytics_cases` (18 zero-argument
  lambdas + 1 `return_value=`) or `_load_judge_bios` / `_load_judge_name_overrides`
  (24 sites). This plan deliberately preserves those functions'
  zero-argument signatures so none of them need editing. If you find yourself
  wanting to edit them, you have chosen the wrong implementation — see STOP conditions.
- Adding admission control (semaphore / 503) to the analytics executors. Explicitly
  deferred; see "Maintenance notes".

**Parallel-work note**: another plan runs `ruff check --fix tests/` across the test
tree. `tests/test_sqlite_repository.py` has one auto-fixable `F401`
(`ALLOWED_UPDATE_FIELDS`, line 7). Your edit to that file is confined to lines
391–407, a different region. `tests/test_cache.py` and `tests/test_analytics_api.py`
are already ruff-clean. If you find the import at line 7 already removed, that is
expected — not a drift STOP.

## Git workflow

- **Use your own worktree**, not a branch in the shared checkout:
  `git worktree add ../immi-028 -b advisor/028-fix-flask-analytics-fallback`,
  then work from `../immi-028`. Plans 026–029 all create branches and three of
  them edit `immi_case_downloader/sqlite_repository.py`; run in parallel in one
  checkout they switch each other's branch out mid-edit.
- Branch: `advisor/028-fix-flask-analytics-fallback`.
- Commit per step, conventional-commit style. Suggested messages:
  - Step 1: `fix: give the analytics fallback worker an application context`
  - Step 1b: `fix: stop close() untracking connections it could not close`
  - Step 6b: `fix: key the case caches on the repository they came from`
  - Step 2: `fix: stop logging every analytics failure as a timeout`
  - Step 3: `fix: run the analytics fallback on the sqlite backend`
  - Step 4: `fix: cancel analytics work that has already timed out`
  - Step 5: `fix: bound the analytics cache and key it on real filters`
  - Step 6: `fix: key the judge-bio caches on the output dir they read`
  - Step 7: `fix: match the sqlite statistics payload to the csv contract`
  - Step 8: `test: cover the analytics fallback and statistics contract`
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Give the analytics fallback worker its own application context

In `immi_case_downloader/web/routes/api.py`, immediately **after** `_call_with_timeout`
(which ends at line 1290), add a new helper:

```python
def _call_in_app_context(
    func,
    timeout_seconds: float = SUPABASE_RPC_TIMEOUT_SECONDS,
    executor: ThreadPoolExecutor | None = None,
):
    """Run *func* in a worker thread that has its own Flask application context.

    ``_call_with_timeout`` hands the callable to a ``ThreadPoolExecutor``, and
    worker threads do not inherit the request's application context.  Any helper
    that reads ``current_app`` — ``get_repo()``, ``get_output_dir()`` — therefore
    raises ``RuntimeError: Working outside of application context`` inside the
    worker, which the caller then misreports as a timeout.  Bind the app object
    here, in the request thread, and push a fresh context inside the worker.
    """
    app = current_app._get_current_object()  # type: ignore[attr-defined]

    def _run():
        with app.app_context():
            return func()

    return _call_with_timeout(_run, timeout_seconds=timeout_seconds, executor=executor)
```

`current_app` is already imported at `api.py:19`. Do not add imports.

Then change the **four** fallback call sites — lines 1713, 1778, 1837, 1881 — from

```python
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=15.0)
```

to

```python
            cases = _call_in_app_context(_get_analytics_cases, timeout_seconds=15.0)
```

Do **not** change the four RPC call sites (lines 1689, 1759, 1826, 1870): those call
bound methods on a `repo` object already resolved in the request thread and need no
context.

Do **not** change `_get_analytics_cases`'s signature. Passing the module global
`_get_analytics_cases` by name keeps every existing `monkeypatch.setattr(...,
lambda: cases)` in the test suite working, because the name is resolved at call time
in the request thread.

*(Why not resolve `repo` in the request thread and pass it in, as `api_cases.py:419-441`
does for its sampler? Because 18 call sites across 3 test files patch
`_get_analytics_cases` with a zero-argument lambda. Adding a parameter would break all of them. The
application-context wrapper achieves the same result with no test churn, and
`with app.app_context()` in a non-request thread is already the established pattern in
this repo — see `immi_case_downloader/web/__init__.py:210`.)*

**Step 1b — make the context pop harmless.** Pushing an application context in a
worker thread means *popping* one there too, and the pop runs
`teardown_appcontext`. The factory registers exactly one handler
(`immi_case_downloader/web/__init__.py:104-109`):

```python
    @app.teardown_appcontext
    def close_repository(_exc):
        repo = app.config.get("REPO")
        close = getattr(repo, "close", None)
        if callable(close):
            close()
```

and `SqliteRepository.close()` (`sqlite_repository.py:130-139`) is verbatim:

```python
    def close(self):
        """Close all connections across all threads."""
        with self._all_conns_lock:
            for conn in self._all_conns:
                try:
                    conn.close()
                except Exception:
                    pass
            self._all_conns.clear()
        self._local.conn = None
```

The `except Exception: pass` is what makes the cross-thread call *appear*
harmless — sqlite3's `check_same_thread` guard raises and the request thread's
connection survives. But `self._all_conns.clear()` runs **unconditionally**, so
the connection it just failed to close is dropped from the tracking list. It is
still open, still cached in the request thread's `threading.local`, and now
unreachable: no later `close()` and no `__del__` will ever close it. That is a
leaked connection (and, in WAL mode, a held `-wal`/`-shm` handle) per request
thread per worker teardown. Do not ship a plan that knowingly leaks because the
leak is small.

Fix `close()` so it only forgets what it actually closed:

```python
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
```

This is a change to `immi_case_downloader/sqlite_repository.py` outside
`get_statistics()`, so add `close()` to the in-scope region list for that file
(Scope section) when you make it.

Add a test to `tests/test_analytics_fallback.py`:

- `test_close_from_another_thread_does_not_untrack_a_live_connection` — open a
  `SqliteRepository` on a tmp DB, force a connection on the main thread with
  `repo._conn()`, then call `repo.close()` from a `threading.Thread` and join
  it. Assert the main thread's connection is **still in** `repo._all_conns`,
  that `repo._conn().execute("SELECT COUNT(*) FROM cases").fetchone()` still
  works from the main thread, and that a subsequent `repo.close()` on the main
  thread does empty the list. *Fails before this sub-step: the list is empty
  after the cross-thread call.*

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "_call_in_app_context(_get_analytics_cases, timeout_seconds=15.0)" immi_case_downloader/web/routes/api.py && \
  grep -c "_call_with_timeout(_get_analytics_cases" immi_case_downloader/web/routes/api.py
```
→ first number `4`, second number `0`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint
```
→ `All checks passed!`

### Step 2: Log a timeout as a timeout and anything else with a traceback

In `immi_case_downloader/web/routes/api.py`, replace **all 8** occurrences of
`except (FuturesTimeoutError, Exception):` in the region 1670–1911 with a pair of
handlers. `concurrent.futures.TimeoutError` subclasses `Exception`, so the current
tuple form is just a bare `except Exception` that mislabels every failure.

The four **RPC-path** handlers (currently at lines 1704, 1773, 1832, 1876) become —
substituting the endpoint name in each message:

```python
        except FuturesTimeoutError:
            logger.warning("analytics_outcomes RPC timed out, falling back to Python")
        except Exception:
            logger.warning("analytics_outcomes RPC failed, falling back to Python", exc_info=True)
```

The four **fallback-path** handlers (currently at lines 1725, 1790, 1841, 1887) become:

```python
        except FuturesTimeoutError:
            logger.warning("analytics_outcomes fallback timed out, returning empty result")
        except Exception:
            logger.warning("analytics_outcomes fallback failed, returning empty result", exc_info=True)
```

Use the endpoint's own name in each message: `analytics_outcomes`, `analytics_judges`,
`analytics_legal_concepts`, `analytics_nature_outcome` — matching the strings already
present on those lines. Keep the surrounding `try:` bodies and the `_rpc_ok = True`
assignment exactly as they are.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "except (FuturesTimeoutError, Exception):" immi_case_downloader/web/routes/api.py || echo "0 (grep found none)"
```
→ `0 (grep found none)`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "exc_info=True" immi_case_downloader/web/routes/api.py
```
→ `15` (7 lines already had it at `42826a3`, plus the 8 new non-timeout handlers).

A count alone cannot tell you the handlers landed on the right eight `try`
blocks, so also check the identity of the messages — each of the four endpoint
names must appear once in a `timed out` line and once in a `failed` line, on
both the RPC and the fallback path:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  for name in analytics_outcomes analytics_judges analytics_legal_concepts analytics_nature_outcome; do
    printf '%s: ' "$name"
    grep -c "\"$name \(RPC\|fallback\) \(timed out\|failed\)" immi_case_downloader/web/routes/api.py
  done
```
→ `4` for each of the four names (RPC timed-out, RPC failed, fallback timed-out,
fallback failed). Anything less means an endpoint kept a merged handler.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint
```
→ `All checks passed!`

### Step 3: Run the Python fallback on backends that have no analytics RPCs

The guard `_supabase_backend = hasattr(repo, "count_cases")` is testing the wrong
capability. `SqliteRepository` has `count_cases` (line 428) but **no** `get_analytics_*`
RPCs, so it is wrongly classified as "remote database, don't retry" and gets an empty
payload with no log line. The comment above the guard states the real intent: skip the
fallback only when the RPC path *existed* and failed, because retrying would hit the
same remote database.

In each of the four endpoints, hoist the existing `hasattr` check into a local
and record **whether an RPC was actually attempted** — not merely whether one
could have been. For `analytics_outcomes` (lines 1684–1710), the result is:

```python
    _rpc_ok = False
    _rpc_attempted = False
    if hasattr(repo, "get_analytics_outcomes") and not _has_analytics_filters():
        _rpc_attempted = True
        try:
            ...unchanged body...
            _rpc_ok = True
        except FuturesTimeoutError:
            logger.warning("analytics_outcomes RPC timed out, falling back to Python")
        except Exception:
            logger.warning("analytics_outcomes RPC failed, falling back to Python", exc_info=True)
    # Skip the Python fallback only when an RPC was actually tried and failed:
    # retrying would query the same remote database that just timed out, wasting
    # another 15 s and blowing the Cloudflare Worker 30 s wall-clock limit.  If no
    # RPC was attempted — CSV and SQLite have none, and even Supabase skips it when
    # filters are present — then the fallback is the only path there is, and
    # skipping it is how these endpoints came to return an empty 200.
    if not _rpc_ok and not _rpc_attempted:
```

**Why `_rpc_attempted` and not `_rpc_capable`.** The obvious rewrite —
`if not _rpc_ok and not _rpc_capable:` — reads as if it means "only skip after a
failed RPC", but it does not: a Supabase request *with filters* never enters the
RPC branch at all (`_has_analytics_filters()` is `True`), so `_rpc_ok` stays
`False` while `_rpc_capable` is `True`, and the fallback is skipped for a query
no RPC was ever tried on. That is exactly today's behaviour and exactly the bug
class this plan exists to remove — an empty 200 with a comment claiming a reason
that did not happen. `_rpc_attempted` makes the code do what the comment says.

**This is a real behaviour change on Supabase/Hyperdrive, and it is intended.**
Before: a filtered analytics request on those backends returned an empty payload
immediately. After: it runs the Python fallback, bounded by the same 15-second
`_call_in_app_context` timeout, and returns real aggregates when the load fits —
or logs an honest `fallback timed out` and returns empty when it does not. The
unfiltered path (the one the "don't retry a remote query that just timed out"
protection was written for) is **unchanged**: there, an RPC is always attempted,
so `_rpc_attempted` is `True` whenever `_rpc_capable` would have been.

Apply the same transformation to the other three, using each endpoint's own RPC name:

| Endpoint | line of the `hasattr` today | RPC method |
|---|---|---|
| `analytics_outcomes` | 1685 | `get_analytics_outcomes` |
| `analytics_judges` | 1755 | `get_analytics_judges_raw` |
| `analytics_legal_concepts` | 1822 | `get_analytics_concepts_raw` |
| `analytics_nature_outcome` | 1867 | `get_analytics_nature_outcome` |

Delete the four `_supabase_backend = hasattr(repo, "count_cases")` lines.

On the **unfiltered** path this is a no-op for Supabase and Hyperdrive — both
define `count_cases` *and* all four RPCs, so an RPC is always attempted and the
guard's value is unchanged. It unblocks SQLite (which has `count_cases` but no
RPCs), leaves CSV (which has neither) unchanged, and deliberately changes the
**filtered** Supabase/Hyperdrive path as described above.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "_supabase_backend = hasattr" immi_case_downloader/web/routes/api.py || echo "0 (grep found none)"
```
→ `0 (grep found none)`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "if not _rpc_ok and not _rpc_attempted:" immi_case_downloader/web/routes/api.py && \
  grep -c "_rpc_attempted = True" immi_case_downloader/web/routes/api.py
```
→ `4` then `4`. Both numbers matter: four guards and four assignments means no
endpoint got the guard without the flag being set, which would silently disable
its RPC path.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_analytics_api.py tests/test_analytics_judge_api.py tests/test_analytics_concepts_api.py tests/test_taxonomy_countries_and_judges_api.py -q --no-cov 2>&1 | tail -2
```
→ exit 0, all passed (no count change yet — new tests arrive in Step 8).

The grep counts above cannot tell you the flag is set on the *right* line, so
Step 8 adds `test_filtered_request_still_runs_the_fallback_when_no_rpc_was_tried`:
a fake repo exposing all four `get_analytics_*` methods (each raising
`AssertionError` if called) plus `count_cases`, driven through
`/api/v1/analytics/outcomes?court=AATA`. It must return real aggregates without
any RPC method being invoked. *Fails at `42826a3` and against the
`_rpc_capable` version — both return an empty payload.*

### Step 4: Cancel analytics work that has already timed out

`_call_with_timeout` (line 1282) raises on timeout and leaves the future alone. When
the shared 4-worker pool is saturated, the submitted task has not started yet and will
run *later*, occupying a worker for up to 15 s to compute a result nobody will read —
which in turn pushes the next caller's queue wait past *its* timeout.

`Future.cancel()` returns `True` and prevents execution when the task has not started,
and `False` (a harmless no-op) once it has. Rewrite the function:

```python
def _call_with_timeout(
    func,
    timeout_seconds: float = SUPABASE_RPC_TIMEOUT_SECONDS,
    executor: ThreadPoolExecutor | None = None,
):
    """Execute a callable with timeout protection.

    On timeout, cancel the future.  A task still queued behind a saturated pool
    is cancelled before it ever runs, which stops doomed work from occupying a
    worker and pushing the *next* caller's queue wait past its own timeout.  A
    task that has already started cannot be cancelled — ``cancel()`` returns
    ``False`` and the thread runs to completion.
    """
    worker = executor or _rpc_executor
    future = worker.submit(func)
    try:
        return future.result(timeout=timeout_seconds)
    except FuturesTimeoutError:
        future.cancel()
        raise
```

Do not change `_rpc_executor`'s `max_workers`, and do not add admission control —
both are deferred (see "Maintenance notes").

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -n "future.cancel()" immi_case_downloader/web/routes/api.py
```
→ exactly one line, inside `_call_with_timeout`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint
```
→ `All checks passed!`

### Step 5: Bound the analytics cache and key it on real parameters

**5a — `immi_case_downloader/web/cache.py`.** Replace the class body so entries are
LRU-ordered, expired entries are removed on read, and capacity is capped. Keep the
attribute names `_ttl`, `_store`, `_lock` — `api.py:97-98` aliases `_store` and
`_lock`, and `api.py:1071` calls `.clear()` on that alias.

```python
"""In-memory cache with TTL for analytics and stats payloads.

Thread-safe OrderedDict+lock pattern extracted into a reusable class so
analytics endpoints share a single consistent caching strategy.
"""

import threading
import time
from collections import OrderedDict

# Cap on distinct cached analytics payloads.  Each entry is a full aggregate
# response, so an unbounded map is a slow memory leak under varied query
# strings.  Mirrors the MAX_ANCHOR_SIGNATURES policy in cases_pagination.py.
DEFAULT_MAX_ENTRIES = 256


class AnalyticsCache:
    """TTL- and size-bounded in-memory cache for pre-computed analytics payloads.

    Each entry is a ``(payload, timestamp)`` tuple.  Both reads and writes take
    the lock: a read evicts the entry when it has expired, and refreshes its
    LRU position when it has not.
    """

    def __init__(self, ttl: float = 300.0, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        self._ttl = ttl
        self._max_entries = max_entries
        self._store: OrderedDict[str, tuple[dict, float]] = OrderedDict()
        self._lock = threading.Lock()

    def _prune_locked(self, now: float) -> None:
        """Drop expired entries, then evict least-recently-used down to capacity."""
        expired = [key for key, (_, ts) in self._store.items() if (now - ts) >= self._ttl]
        for key in expired:
            self._store.pop(key, None)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)

    def get(self, key: str) -> dict | None:
        """Return cached payload if still fresh, else ``None`` (evicting if stale)."""
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            payload, ts = entry
            if (now - ts) >= self._ttl:
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return payload

    def set(self, key: str, payload: dict) -> None:
        """Store *payload* under *key* with the current timestamp."""
        now = time.time()
        with self._lock:
            self._store[key] = (payload, now)
            self._store.move_to_end(key)
            self._prune_locked(now)

    def invalidate(self) -> None:
        """Remove all entries from the cache."""
        with self._lock:
            self._store.clear()
```

**5b — `immi_case_downloader/web/routes/api.py`.** Replace `_analytics_cache_key`
(lines 1074–1076) with a whitelist-driven key, and derive `_has_analytics_filters`
from the same constant so the two can never drift:

```python
# The only query params any cached analytics endpoint reads.  Building the cache
# key from the whole query string let an unbounded set of ignored params (utm_*,
# cache-busters) each mint a distinct entry.
_ANALYTICS_FILTER_PARAMS = (
    "court", "year_from", "year_to",
    "case_natures", "visa_subclasses", "visa_families", "outcome_types",
)
# `limit` is not a filter (it does not gate the RPC fast path) but analytics_judges
# and analytics_legal_concepts truncate their result with it, so it must be part of
# the key or a ?limit=5 request would be served a 20-item cached list.
_ANALYTICS_CACHE_KEY_PARAMS = _ANALYTICS_FILTER_PARAMS + ("limit",)


def _analytics_cache_key() -> str:
    """Build a stable cache key from the params the analytics endpoints actually read."""
    return str([(p, request.args.get(p, "")) for p in _ANALYTICS_CACHE_KEY_PARAMS])
```

Then change `_has_analytics_filters` (lines 1177–1186) to use the shared tuple,
leaving its docstring intact:

```python
def _has_analytics_filters() -> bool:
    """Return True if any analytics filter query param is present.

    Used to decide whether to take the fast Supabase RPC path (no filters)
    or the Python aggregation path (filters require loading cases locally).
    """
    return any(request.args.get(p) for p in _ANALYTICS_FILTER_PARAMS)
```

Leave `_analytics_get`, `_analytics_set`, and the `_analytics_cache` /
`_analytics_cache_lock` aliases untouched.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "sorted(request.args.items())" immi_case_downloader/web/routes/api.py || echo "0 (grep found none)"
```
→ `0 (grep found none)`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -c "
import sys; sys.path.insert(0, '.')
from immi_case_downloader.web.cache import AnalyticsCache
c = AnalyticsCache(ttl=300.0, max_entries=3)
for i in range(50):
    c.set('k%d' % i, {'v': i})
print('entries:', len(c._store))
assert len(c._store) == 3
import time
d = AnalyticsCache(ttl=0.01)
d.set('x', {'v': 1}); time.sleep(0.03)
assert d.get('x') is None and 'x' not in d._store
print('stale eviction: OK')
"
```
→ `entries: 3` then `stale eviction: OK`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_analytics_api.py tests/test_cache.py -q --no-cov 2>&1 | tail -2
```
→ exit 0, `56 passed` (50 + 6 — the two files' per-file counts at the baseline
recorded under "Commands you will need"; Step 8d adds 5 to `tests/test_cache.py`
later, so this number is only correct *before* Step 8).

### Step 6: Key the judge-bio loaders on the output directory they read

Both loaders are `@lru_cache(maxsize=1)` on a zero-argument function that reads
`get_output_dir()`, so the varying input never enters the cache key and the first app
in the process pins the map for every later app.

In `immi_case_downloader/web/routes/api.py`, split each into a keyed inner function
plus a thin public wrapper. **Keep the public zero-argument names** — 20 test call
sites patch them by name.

Replace lines 268–290 with:

```python
@lru_cache(maxsize=8)
def _load_judge_bios_for(output_dir: str) -> dict[str, dict]:
    """Load the judge biography map for *output_dir*, once per directory.

    Keyed on the directory so two apps in one process (tests, multi-tenant dev)
    never serve each other's bios.
    """
    bio_path = os.path.join(output_dir, "judge_bios.json")
    if not os.path.exists(bio_path):
        return {}
    try:
        with open(bio_path, encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        logger.warning("Failed to load judge_bios.json", exc_info=True)
        return {}

    if not isinstance(payload, dict):
        return {}

    bios: dict[str, dict] = {}
    for key, value in payload.items():
        if isinstance(key, str) and isinstance(value, dict):
            cleaned = key.strip().lower()
            if cleaned:
                bios[cleaned] = value
    return bios


def _load_judge_bios() -> dict[str, dict]:
    """Judge biography map for the current app's output dir."""
    return _load_judge_bios_for(get_output_dir())
```

Do the same for `_load_judge_name_overrides` (lines 293–332): rename the decorated
function to `_load_judge_name_overrides_for(output_dir: str)`, replace
`Path(get_output_dir())` with `Path(output_dir)` in the `candidate_paths` list, change
the decorator to `@lru_cache(maxsize=8)`, keep the rest of the body byte-identical,
and add the wrapper:

```python
def _load_judge_name_overrides() -> dict[str, str]:
    """Alias -> full-name overrides for the current app's output dir."""
    return _load_judge_name_overrides_for(get_output_dir())
```

Do not touch `_known_singleton_judge_names` (line 475) or `_resolve_judge_display_name`
(line 435) — they keep calling the patchable zero-argument wrappers, which is what
keeps the existing tests green.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -n "lru_cache(maxsize=1)" immi_case_downloader/web/routes/api.py || echo "0 (grep found none)"
```
→ `0 (grep found none)`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_api_helpers.py tests/test_analytics_api.py tests/test_taxonomy_countries_and_judges_api.py tests/test_analytics_judge_api.py -q --no-cov 2>&1 | tail -2
```
→ exit 0, all passed

### Step 6b: Key the case caches on the repository they were loaded from

Step 6 fixes the judge-bio `lru_cache`, but the two caches that hold the actual
**case data** have the identical defect and a worse blast radius.
`immi_case_downloader/web/routes/api.py:1028-1038` (verbatim):

```python
_all_cases_cache: list[ImmigrationCase] = []
_all_cases_ts: float = 0.0
_all_cases_lock = threading.Lock()
_CACHE_TTL = 300.0  # 5 min — same as stats; analytics warmup keeps this fresh

# Separate lightweight cache for analytics endpoints (minimal 7 columns).
# ~4x faster to load than the full all-cases cache (13s vs 57s on free tier).
_analytics_cases_cache: list[ImmigrationCase] = []
_analytics_cases_ts: float = 0.0
_analytics_cases_lock = threading.Lock()
_ANALYTICS_CASES_TTL = 300.0
```

Module-level, process-global, keyed on nothing. Two apps in one process — the
shape `tests/conftest.py` produces constantly, and a dev loop that recreates the
app — share them, so app B's analytics can be computed from app A's cases for up
to 5 minutes. Judge *bios* leaking between output dirs is a cosmetic bug; whole
**case corpora** leaking between repositories is a data-tenancy bug in a tool
whose whole job is showing you what is in a particular dataset.

Add a repository identity helper next to those globals:

```python
def _repo_identity(repo) -> str:
    """A stable per-dataset key for the process-global case caches.

    Two apps in one process get two repositories; without this they share one
    cache and can serve each other's cases. `id()` is the last resort: it is
    per-process, so it can only cause a miss, never a cross-dataset hit.
    """
    for attr in ("db_path", "base_dir"):
        value = getattr(repo, attr, None)
        if isinstance(value, str) and value:
            return f"{type(repo).__name__}:{os.path.abspath(value)}"
    return f"{type(repo).__name__}:{id(repo):x}"
```

`os` is already imported in this module (used at line 271). Then add
`_all_cases_key: str = ""` and `_analytics_cases_key: str = ""` beside the two
timestamps, and in **both** `_get_all_cases()` (line 1041) and
`_get_analytics_cases()` (line 1107):

- resolve `repo = get_repo()` and `key = _repo_identity(repo)` **before** the
  fast path (both are called with an application context — Step 1 guarantees it
  for the worker case),
- add `and _analytics_cases_key == key` / `and _all_cases_key == key` to the
  fast-path condition *and* to the double-check inside the lock,
- set the key alongside the timestamp when the cache is filled.

Do the same in the two warmup fillers, `_fill_all_cases_cache()` (line 1089) and
`_fill_analytics_cases_cache()` — they set the cache and timestamp directly, and
a filler that does not set the key turns every warmed cache into a guaranteed
miss.

Neither function's **signature** changes, so all 18 zero-argument
`monkeypatch.setattr(..., "_get_analytics_cases", lambda: cases)` sites keep
working.

Do **not** touch `_invalidate_cases_cache()` (line 1059) — it is
`plans/026-fix-seek-pagination.md` Step 5b's edit region, and zeroing the
timestamps is already sufficient invalidation for the keyed caches.

Add two tests to `tests/test_analytics_fallback.py`:

- `test_analytics_cases_cache_is_scoped_per_repository` — build app A over a
  dir with 3 cases and app B over a dir with 1 different case; inside
  `app_a.app_context()` call `_get_analytics_cases()` (3 cases), then inside
  `app_b.app_context()` call it again and assert you get B's single case, not
  A's three. *Fails at `42826a3`: B receives A's list.*
- `test_all_cases_cache_is_scoped_per_repository` — the same for
  `_get_all_cases()`.

Both must call the functions inside a real application context; the autouse
`reset_analytics_caches` fixture clears the caches between tests, so the leak
has to be exercised within a single test.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_analytics_fallback.py -q --no-cov -k "scoped_per_repository" 2>&1 | tail -2
```
→ `2 passed`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_analytics_api.py tests/test_analytics_judge_api.py tests/test_analytics_concepts_api.py -q --no-cov 2>&1 | tail -2
```
→ exit 0 — this is the check that the zero-argument seams survived.

### Step 7: Make the SQLite statistics payload match the CSV contract

**7a — `immi_case_downloader/storage.py`.** Add a named constant directly after the
`CASE_FIELDS = [...]` list (which ends at line 49) and use it instead of the literal:

```python
# Dashboard shows the top N visa subclasses by case count.  Shared with
# SqliteRepository.get_statistics() so the two backends cannot drift apart.
TOP_VISA_SUBCLASS_LIMIT = 20
```

Then at line 353, change

```python
    sorted_subclasses = dict(sorted(by_visa_subclass.items(), key=lambda x: x[1], reverse=True)[:20])
```

to

```python
    # (-count, subclass) rather than count-descending alone: Python's sort is
    # stable, so ties used to be broken by first-seen order — an ordering SQL
    # cannot reproduce. With 25 subclasses on the same count, "the top 20" was a
    # different set of 20 on each backend, and a cross-backend contract test
    # would pass or fail by luck. SqliteRepository.get_statistics() now orders
    # identically.
    sorted_subclasses = dict(
        sorted(by_visa_subclass.items(), key=lambda x: (-x[1], x[0]))[:TOP_VISA_SUBCLASS_LIMIT]
    )
```

No other change to `storage.py`.

**On "byte-identical":** the payload keeps the same keys, the same value types
and the same counts. What changes is the *order* of tied `by_visa_subclass`
entries and — when a tie straddles position 20 — which of them survive the cut.
That is the point of the change: it is what makes the cross-backend contract
expressible at all, instead of both backends returning "some 20 of these 25".
The only consumer is `api.py:1475-1486` (`_clean_visa` and `group_by_family`),
neither of which depends on ordering.

**7b — `immi_case_downloader/sqlite_repository.py`.** Extend the existing import at
line 9:

```python
from .storage import CASE_FIELDS, TOP_VISA_SUBCLASS_LIMIT
```

Then rewrite `get_statistics()` (lines 293–334) so it (i) groups `by_court` on
`court_code`, (ii) adds `by_source` over **all** rows with `''` bucketed as
`"Unknown"`, and (iii) adds `by_visa_subclass` over rows with a non-empty subclass,
top-N by count. Use a bound parameter for the limit — never interpolate into SQL.

```python
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
```

**7c — `tests/test_sqlite_repository.py`.** Two existing assertions encode the old
shape and will fail. Update `TestStatistics` (lines 391–407):

- `test_statistics_keys` — the expected set becomes
  `{"total", "by_court", "by_year", "by_nature", "by_visa_subclass", "by_source", "visa_types", "with_full_text", "sources"}`.
- `test_statistics_by_court` — the fixture's two cases are `court_code="AATA"`
  (`tests/test_sqlite_repository.py:31`) and `court_code="FCA"` (line 56), so assert
  `"AATA" in stats["by_court"]` and `"FCA" in stats["by_court"]`, and add
  `assert "Administrative Appeals Tribunal" not in stats["by_court"]`.

Do not add new tests here — the cross-backend contract test is created in Step 8.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_sqlite_repository.py tests/test_storage.py -q --no-cov 2>&1 | tail -2
```
→ exit 0, `45 passed` for the sqlite file (count unchanged) and the storage file green.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint
```
→ `All checks passed!`

### Step 8: Add the regression tests

Create three new files. Model their structure on `tests/test_sqlite_repository.py`
(module docstring, `pytest` fixtures, section comments, classes grouping related
assertions).

**8a — `tests/test_analytics_fallback.py`** (new). Self-contained fixtures; do **not**
reuse the shared `app`/`client` fixtures, whose `populated_dir` cases have no judges,
no visa subclass and a `legal_concepts` value that does not map to a canonical
concept. `conftest.py`'s autouse `reset_analytics_caches` fixture already clears every
analytics cache before and after each test, which is what forces the fallback path to
run.

Build a fixture that writes N cases with `court_code="AATA"`, `year=2024`,
`outcome="Remitted"`, `judges="Member Alpha"`, `case_nature="Protection"`,
`legal_concepts="Character Test"` (this string **is** in `_CONCEPT_CANONICAL` and maps
to `"Character Test"`), `visa_subclass="866"`, `source="AustLII"`, each with a unique
`url`, then `case.ensure_id()`. Provide the data to two apps:

- a CSV app: `ensure_output_dirs(tmp)`, `save_cases_csv(cases, tmp)`,
  `save_cases_json(cases, tmp)`, then `create_app(str(tmp))`
- a SQLite app: `SqliteRepository(os.path.join(tmp, "cases.db"))`, `save_many(cases)`,
  `close()`, then `create_app(str(tmp), backend="sqlite")`

Set `TESTING = True` and `WTF_CSRF_ENABLED = False` on both, exactly as
`tests/conftest.py:162-170` does.

Tests to write — **13 test functions, 17 collected** (item 5 is parametrised over
the four endpoint paths):

1. `test_outcomes_fallback_returns_data_on_csv_backend` — `GET /api/v1/analytics/outcomes`
   → 200 and `data["by_court"]["AATA"]["Remitted"] == 3`.
   *Fails at `42826a3` with `by_court == {}`.*
2. `test_judges_fallback_returns_data_on_csv_backend` — `/analytics/judges` → the
   `judges` list is non-empty and its first entry's `count` is 3.
3. `test_legal_concepts_fallback_returns_data_on_csv_backend` — `/analytics/legal-concepts`
   → `concepts` contains `{"name": "Character Test", "count": 3}`.
4. `test_nature_outcome_fallback_returns_data_on_csv_backend` — `/analytics/nature-outcome`
   → `matrix["Protection"]["Remitted"] == 3`.
5. `test_analytics_returns_data_on_sqlite_backend` — parametrised over the four
   endpoint paths against the SQLite app; assert each response body is non-empty in
   the endpoint's primary key (`by_court`, `judges`, `concepts`, `matrix`).
   *Fails at `42826a3` — all four are empty.*
6. `test_call_with_timeout_cancels_queued_work_on_timeout` — occupy a
   `ThreadPoolExecutor(max_workers=1)` with a blocking task guarded by a
   `threading.Event`, then `_call_with_timeout(recorder, timeout_seconds=0.1,
   executor=that_pool)` inside `pytest.raises(FuturesTimeoutError)`; release the
   event, `shutdown(wait=True)`, and assert the recorder list is still empty.
   *Fails at `42826a3` — the queued task runs after the timeout.*
7. `test_analytics_cache_key_ignores_unlisted_params` — inside
   `app.test_request_context("/api/v1/analytics/outcomes?utm_source=news")` and
   `...("/api/v1/analytics/outcomes")`, `_analytics_cache_key()` returns the same string.
   *Fails at `42826a3`.*
8. `test_analytics_cache_key_distinguishes_limit` — `?limit=5` and `?limit=50`
   produce different keys.
9. `test_analytics_cache_key_distinguishes_court` — `?court=AATA` and `?court=FCA`
   produce different keys.
10. `test_filtered_request_still_runs_the_fallback_when_no_rpc_was_tried` (Step 3)
    — a fake repo that defines `count_cases` **and** all four `get_analytics_*`
    methods, each of which raises `AssertionError("RPC must not be called")`,
    plus `load_all()` returning the fixture cases. Drive
    `GET /api/v1/analytics/outcomes?court=AATA`; assert `by_court["AATA"]["Remitted"]`
    is the real count and that no RPC was invoked. *Fails at `42826a3` and
    against a `_rpc_capable`-based guard — both return an empty payload without
    ever attempting an RPC.*
11. `test_close_from_another_thread_does_not_untrack_a_live_connection` (Step 1b)
    — described in Step 1b. *Fails before Step 1b: `_all_conns` is emptied even
    though the connection was not closed.*
12. `test_analytics_cases_cache_is_scoped_per_repository` (Step 6b).
    *Fails at `42826a3`.*
13. `test_all_cases_cache_is_scoped_per_repository` (Step 6b).
    *Fails at `42826a3`.*

**8b — `tests/test_repository_statistics_contract.py`** (new). Load the same case list
into a `CsvRepository` and a `SqliteRepository` and compare. Tests to write (8):

1. `test_key_sets_are_identical` — `set(csv_stats) == set(sqlite_stats) == EXPECTED_KEYS`
   where `EXPECTED_KEYS = {"total", "by_court", "by_year", "by_nature",
   "by_visa_subclass", "by_source", "visa_types", "with_full_text", "sources"}`.
   *Fails at `42826a3`.*
2. `test_totals_match`
3. `test_by_court_is_keyed_on_court_code` — both have `"AATA"`, neither has
   `"Administrative Appeals Tribunal"`. *Fails at `42826a3`.*
4. `test_by_source_counts_match` — `csv_stats["by_source"] == sqlite_stats["by_source"]`
   and every count is non-zero. *Fails at `42826a3` (KeyError).*
5. `test_by_visa_subclass_counts_match` — equal dicts, and both capped at
   `TOP_VISA_SUBCLASS_LIMIT` when fed 25 distinct subclasses.
   *Fails at `42826a3` (KeyError).*
6. `test_stats_endpoint_populates_visa_charts_on_sqlite` — `create_app(tmp,
   backend="sqlite")`, `GET /api/v1/stats` → `visa_subclasses` non-empty,
   `visa_families` non-empty, and every value in `sources` is `> 0`.
   *Fails at `42826a3` — `sources` is `{"AustLII": 0}` and the two visa maps are `{}`.*
7. `test_full_statistics_payloads_are_equal` — `csv_stats == sqlite_stats` for
   the **whole nine-key dict**, not a chosen subset. Comparing only
   `by_court`/`by_source`/`by_visa_subclass` would let `by_year`, `by_nature`,
   `visa_types`, `sources`, `total` or `with_full_text` diverge unnoticed; two
   dicts compare equal regardless of key order, so this is safe to assert
   directly. Feed the fixture cases enough variety to make every field non-empty
   (at least two courts, two years, two natures, two sources, two visa types,
   and one case with a `full_text_path`), and assert each of the nine values is
   itself non-empty first — otherwise `{} == {}` would pass while proving
   nothing.
8. `test_visa_subclass_tie_break_is_deterministic` — the boundary case the
   top-N cut turns into a real defect. Build **25 distinct subclasses each with
   exactly the same count**, load them into both backends, and assert
   `csv_stats["by_visa_subclass"] == sqlite_stats["by_visa_subclass"]`, that
   both hold exactly `TOP_VISA_SUBCLASS_LIMIT` entries, and that their keys are
   the 20 lexicographically smallest of the 25. Insert the cases in an order
   that is **not** subclass-ascending (e.g. reversed), so a backend that fell
   back to first-seen order would produce a different 20 and fail.
   *Fails against a `cnt DESC`-only SQL ordering or a stable-sort-only Python
   ordering; this is the test the tie-break exists for.*

**8c — `tests/test_judge_bios_cache.py`** (new). Two tests:

1. `test_bios_are_scoped_per_output_dir` — write `judge_bios.json` containing one
   entry into dir A only; create an app for A and an app for B; assert
   `_load_judge_bios()` returns the entry under `app_a.app_context()` and `{}` under
   `app_b.app_context()`. *Fails at `42826a3` — B gets A's map.*
2. `test_name_overrides_are_scoped_per_output_dir` — write
   `judge_name_overrides.json` with `{"alpha": "Member Alpha Full"}` into dir A only;
   assert the alias resolves under A and does **not** appear under B (B still gets the
   packaged defaults from `immi_case_downloader/data/judge_name_overrides.json`, so
   assert on the absence of the A-specific alias, not on `== {}`).

**8d — `tests/test_cache.py`**. Append one class, `TestAnalyticsCacheBounds`, with 5
tests. Import `AnalyticsCache` and `DEFAULT_MAX_ENTRIES` from
`immi_case_downloader.web.cache`; leave the existing `TestCasesCacheTTL` class alone.

1. `test_fresh_entry_is_returned`
2. `test_expired_entry_is_evicted_on_read` — `AnalyticsCache(ttl=0.01)`, set, sleep
   0.03, `get()` is `None` **and** the key is gone from `_store`.
   *Fails at `42826a3` — the key survives.*
3. `test_capacity_is_bounded` — `max_entries=3`, set 50 keys, `len(_store) == 3`.
   *Fails at `42826a3`.*
4. `test_least_recently_used_is_evicted_first` — `max_entries=2`; set `a`, set `b`,
   `get("a")`, set `c`; then `get("b")` is `None` and `get("a")` still returns its payload.
5. `test_default_max_entries_is_positive` — `DEFAULT_MAX_ENTRIES > 0`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_analytics_fallback.py tests/test_repository_statistics_contract.py tests/test_judge_bios_cache.py tests/test_cache.py -q --no-cov 2>&1 | tail -2
```
→ exit 0, `38 passed` (17 + 8 + 2 + 11). These are per-file counts for files
only this plan writes (plus the 6 pre-existing tests in `tests/test_cache.py`),
so they are stable no matter which sibling plans land. If your number differs,
count the tests you actually wrote and reconcile before moving on.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/ruff check tests/test_analytics_fallback.py tests/test_repository_statistics_contract.py tests/test_judge_bios_cache.py tests/test_cache.py tests/test_sqlite_repository.py
```
→ `All checks passed!`

### Step 9: Full-suite verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | grep -E '[0-9]+ passed'
```
→ the passed count must equal `SUITE_BEFORE + 32` (17 + 8 + 2 + 5 new tests),
where `SUITE_BEFORE` is the number you recorded before Step 1. **Do not assert
an absolute total**: sibling plans in this batch add tests to the same suite, so
any hard-coded figure is wrong the moment one of them lands and it trains you to
edit the yardstick instead of the code.

The failures must still be the same three, **by name**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u
```
→ prints exactly `tests/test_backfill_judge_overrides_from_pdf.py` and nothing
else — the pre-existing `pypdf` / `pyexpat` ImportErrors. (Do not anchor the
pattern with `^`: pytest emits ANSI colour codes before the word `FAILED` even
when piped.)

If the passed count is off by a few because you wrote a slightly different
number of assertions, that is fine — what must hold is the delta being explained
by tests you wrote, and the failure set being **exactly** those three names.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint && git status --short
```
→ `All checks passed!`, and `git status --short` lists only the in-scope files.

## Test plan

New tests, by file:

| File | Tests | Covers |
|---|---|---|
| `tests/test_analytics_fallback.py` (create) | 13 functions / 17 collected | PYCORR-03 (app context, CSV — 4 endpoints), the SQLite fallback gate and the filtered-RPC gate (Step 3), the cross-thread `close()` leak (Step 1b), the per-repository case caches (Step 6b), PYCORR-14 (cancel-on-timeout), PYCORR-13 (cache key whitelist) |
| `tests/test_repository_statistics_contract.py` (create) | 8 | PYCORR-24 (key-set parity, full nine-key payload equality, `by_court` domain, `by_source`, `by_visa_subclass`, the 25-way tie boundary, `/api/v1/stats` on SQLite) |
| `tests/test_judge_bios_cache.py` (create) | 2 | PYCORR-20 (per-output-dir cache keys) |
| `tests/test_cache.py` (append) | 5 | PYCORR-13 (TTL eviction, capacity bound, LRU order) |

Structural pattern to follow: `tests/test_sqlite_repository.py` — module docstring,
`@pytest.fixture` factories at the top, `# ── Section ──` comment banners, one class
per behaviour group.

Tests that must be **updated** (they encode the old contract and will fail otherwise):
`tests/test_sqlite_repository.py::TestStatistics::test_statistics_keys` and
`::test_statistics_by_court`.

Tests that must **not** be touched: the 18 `monkeypatch.setattr(...,
"_get_analytics_cases", lambda: cases)` sites (plus 1 `return_value=` site) and the
24 `_load_judge_bios` / `_load_judge_name_overrides` patch sites across `tests/test_analytics_api.py`,
`tests/test_analytics_judge_api.py`, `tests/test_analytics_concepts_api.py` and
`tests/test_taxonomy_countries_and_judges_api.py`. This plan's implementation choices
exist specifically so those keep working unchanged. If any of them fails, your
implementation diverged from the plan.

Verification: `make test-py` → the only failures are the 3 pre-existing
`tests/test_backfill_judge_overrides_from_pdf.py` environmental failures.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` prints `All checks passed!`
- [ ] `.venv/bin/ruff check tests/test_analytics_fallback.py tests/test_repository_statistics_contract.py tests/test_judge_bios_cache.py tests/test_cache.py tests/test_sqlite_repository.py` prints `All checks passed!`
- [ ] `make test-py` passed count equals `SUITE_BEFORE + 32`, and
      `make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u`
      prints exactly `tests/test_backfill_judge_overrides_from_pdf.py` — the same
      three environmental `pyexpat` ImportErrors, by name, as the pre-plan baseline
- [ ] `grep -c "except (FuturesTimeoutError, Exception):" immi_case_downloader/web/routes/api.py` returns no match (0)
- [ ] `grep -c "_supabase_backend = hasattr" immi_case_downloader/web/routes/api.py` returns no match (0)
- [ ] `grep -c "if not _rpc_ok and not _rpc_attempted:" immi_case_downloader/web/routes/api.py` returns `4` **and** `grep -c "_rpc_attempted = True" …` returns `4`
- [ ] `.venv/bin/python -m pytest tests/test_analytics_fallback.py -q --no-cov -k "filtered_request_still_runs_the_fallback"` → `1 passed` (the count greps above cannot tell you the flag was set on the right line; this can)
- [ ] `grep -c "_call_in_app_context(_get_analytics_cases, timeout_seconds=15.0)" immi_case_downloader/web/routes/api.py` returns `4`
- [ ] `grep -c "_call_with_timeout(_get_analytics_cases" immi_case_downloader/web/routes/api.py` returns no match (0)
- [ ] `grep -n "future.cancel()" immi_case_downloader/web/routes/api.py` returns exactly one line
- [ ] `grep -c "sorted(request.args.items())" immi_case_downloader/web/routes/api.py` returns no match (0)
- [ ] `grep -c "lru_cache(maxsize=1)" immi_case_downloader/web/routes/api.py` returns no match (0)
- [ ] The Step 5 `python -c` cache probe prints `entries: 3` then `stale eviction: OK` (a behavioural check; `grep -c OrderedDict` would also match an unused import, so it is not used here)
- [ ] `.venv/bin/python -m pytest tests/test_repository_statistics_contract.py -q --no-cov -k "full_statistics_payloads_are_equal or tie_break_is_deterministic"` → `2 passed` (this replaces `grep -c TOP_VISA_SUBCLASS_LIMIT`, which counts a name rather than checking the two backends agree)
- [ ] `.venv/bin/python -m pytest tests/test_analytics_fallback.py -q --no-cov -k "scoped_per_repository or untrack_a_live_connection"` → `3 passed`
- [ ] `.venv/bin/python -m pytest tests/test_analytics_fallback.py tests/test_repository_statistics_contract.py tests/test_judge_bios_cache.py -q --no-cov` exits 0 with 27 tests passed (17 + 8 + 2)
- [ ] `.venv/bin/python -m pytest tests/test_cache.py -q --no-cov` exits 0 with 11 tests passed
- [ ] `.venv/bin/python -m pytest tests/test_sqlite_repository.py -q --no-cov` exits 0 with 45 tests passed (unchanged: this plan edits two assertions there and adds no test)
- [ ] `git status --short` lists only: `immi_case_downloader/web/routes/api.py`, `immi_case_downloader/web/cache.py`, `immi_case_downloader/sqlite_repository.py`, `immi_case_downloader/storage.py`, `tests/test_sqlite_repository.py`, `tests/test_cache.py`, `tests/test_analytics_fallback.py`, `tests/test_repository_statistics_contract.py`, `tests/test_judge_bios_cache.py`
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints anything, or any excerpt in "Current state" does not match
  the live file at the stated lines.
- **You find yourself editing a `monkeypatch.setattr(..., "_get_analytics_cases", ...)`
  or a `patch(..., "_load_judge_bios", ...)` line.** Both of those functions must keep
  their zero-argument signatures. Needing to edit those 43 call sites means you changed
  a signature the plan told you not to change — revert and re-read Steps 1 and 6.
- After Step 3, a test that previously passed against the **unfiltered**
  Supabase or Hyperdrive code path starts failing. The `_rpc_attempted` swap is
  a no-op there (both backends define all four `get_analytics_*` RPCs, so an RPC
  is always attempted when there are no filters). A behaviour change on the
  unfiltered path means the capability sets are not what this plan measured.
  The **filtered** Supabase/Hyperdrive path *does* change on purpose — it now
  runs the Python fallback instead of returning an empty payload — so a test
  that asserted "filtered Supabase analytics return empty" is expected to fail
  and should be updated with that reasoning recorded. Report it either way; do
  not quietly relax an assertion.
- `tests/test_sqlite_repository.py` fails in a class **other than** `TestStatistics`
  after Step 7. That would mean the `get_statistics()` rewrite broke a shared
  connection or schema assumption, not just the payload shape.
- Any test outside `tests/test_backfill_judge_overrides_from_pdf.py` fails after
  Step 9, or the pre-existing failure count moves off 3.
- After Step 1, you observe a `sqlite3.ProgrammingError: Cannot operate on a closed
  database` anywhere. `create_app` registers a `teardown_appcontext` handler
  (`immi_case_downloader/web/__init__.py:104-109`) that calls `repo.close()`, so the
  worker's application context pop *does* invoke `SqliteRepository.close()`.
  sqlite3's `check_same_thread` guard makes the cross-thread `conn.close()` raise
  and `close()` swallows it, so the request thread's connection keeps working —
  but the pre-review version of `close()` also cleared `_all_conns`
  unconditionally, leaking that connection out of all tracking. **Step 1b fixes
  that**; if you skipped it, go back. If a closed-database error appears even
  with Step 1b in place, do not paper over it: stop and report, because the
  alternative implementation (pass `repo` into the worker, edit 18 test lambdas)
  is a different plan.
- A step's verification fails twice after a reasonable fix attempt.
- Any change appears to require touching a file outside the "In scope" list.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **What a reviewer should scrutinise.** (1) That Step 3's `_rpc_attempted` swap
  is inert on the **unfiltered** Supabase/Hyperdrive path — the whole "don't
  retry a remote query that just timed out" protection depends on it — and that
  the filtered path's new Python fallback is bounded by the 15 s timeout rather
  than loading 149k rows unboundedly. (2) That the `with app.app_context()` in
  `_call_in_app_context` does not surprise anyone via `teardown_appcontext`; today the
  only registered handler is `close_repository`, and it is a no-op on `CsvRepository`
  (no `close` method) and, after Step 1b, a genuine no-op cross-thread on
  `SqliteRepository` rather than a silent connection leak. If a
  new `teardown_appcontext` handler with real side effects is ever added, revisit this.
  (3) That `AnalyticsCache.get()` now takes the lock on every read — fine for a
  local-dev Flask process, worth re-measuring if this class is ever reused somewhere hot.

- **Deferred out of this plan — admission control for the analytics executors.**
  `_rpc_executor` is a shared `ThreadPoolExecutor(max_workers=4)` (`api.py:90`) and
  `api_cases.py:75` has its own 2-worker pool. Once a pool is full, `submit()` only
  queues, and the queue wait counts against the caller's own timeout, so fast queries
  can time out purely from contention. Step 4 fixes the provable half (a timed-out task
  that has not started is now cancelled instead of running later). The rest — sizing
  the pools to expected concurrency and returning `503` immediately instead of enqueuing
  work already doomed to time out — is a design change requiring a load measurement
  nobody has taken; the original audit's "persistent analytics outage" narrative was an
  extrapolation, not a reproduction. Do not add a semaphore without first reproducing
  the saturation.

- **Deferred — the Supabase/Hyperdrive statistics shape.** Both delegate to the
  server-side `get_case_statistics()` SQL function, so the contract test in Step 8b
  covers only CSV and SQLite. If the dashboard ever blanks on Supabase the same way it
  did on SQLite, the fix is in a Postgres migration, not in Python. Extending the
  contract test to those backends needs a live database or a recorded RPC fixture.

- **Deferred — `_known_singleton_judge_names()` is uncached and runs per case.**
  `_split_judges` (`api.py:711-721`) calls it for every case in the Python fallback,
  and it rebuilds a set from the bios + overrides maps each time. After Step 6 it also
  costs two `current_app.config.get()` lookups per case (~0.7 µs per case measured,
  ~0.1 s over a 149 k corpus — not worth fixing now). If the analytics fallback ever
  becomes a hot path, memoise it per output dir the same way Step 6 memoises the loaders.

- **What future changes interact with this.** (1) Any new analytics endpoint that
  reads a query param the four cached endpoints do not must add that param to
  `_ANALYTICS_CACHE_KEY_PARAMS` before it calls `_analytics_set`, or two different
  requests will collide in the cache. (2) Any new repository backend must return the
  nine-key `get_statistics()` payload — `tests/test_repository_statistics_contract.py`
  is where you add it. (3) Any new helper called from inside a `_call_with_timeout`
  worker must either avoid `current_app` or be routed through `_call_in_app_context`.

- **Known test-suite wart, not fixed here.** `tests/test_analytics_api.py` lines 468,
  497, 522, 548 and 712 do `monkeypatch.setattr(..., "_analytics_cache", {})`. That
  rebinds a module alias, not the `AnalyticsCache` instance, so it has no effect on
  `_analytics_get`/`_analytics_set` — the real isolation comes from
  `conftest.py:82`'s `_analytics_cache_obj.invalidate()`. Harmless today, but it will
  mislead the next person who reads it. Out of this plan's scope because those files
  are also in another plan's blast radius.

## Findings reconsidered

- **PYCORR-13, the stated impact.** The claim that the unbounded cache is a
  memory-growth risk in practice is weaker than the audit implied, and I confirmed why:
  all four `_analytics_set(...)` calls (`api.py:1735`, `1805`, `1851`, `1910`) are
  guarded by `if _rpc_ok:`, and `_rpc_ok` can only become `True` on a backend that
  exposes the `get_analytics_*` RPCs — i.e. Supabase or Hyperdrive, never CSV or SQLite.
  On the two local backends **no entry is ever stored**, so nothing grows. The
  *defects* are still real and still worth fixing (the key was built from the entire
  query string including params the endpoints never read, expired entries were never
  removed, and there was no capacity policy), so Step 5 stands — but it is hygiene on
  a bounded-blast-radius path, not a memory-exhaustion fix.

- **PYCORR-13, the proposed key whitelist.** The audit's fix sketch said to key on
  "only the whitelist `_has_analytics_filters()` already enumerates". Implementing that
  literally would be a **correctness regression**: `analytics_judges` (`api.py:1747`)
  and `analytics_legal_concepts` (`api.py:1817`) both read a `limit` param that is not
  in that list, and because caching only happens when no filter is present, the
  whitelisted key would be a single constant per endpoint — so `?limit=5` and
  `?limit=100` would collide and serve each other's payloads. Step 5 therefore uses the
  7 filter params **plus `limit`**.

- **PYCORR-03, the proposed fix shape.** The audit's sketch — "capture `repo =
  get_repo()` in the request thread and submit a closure that takes repo as an
  argument (the same pattern `api_cases.py:425` already uses)" — is sound in isolation
  but breaks the 18 call sites across 3 files that patch `_get_analytics_cases` with a
  zero-argument lambda (`tests/test_analytics_api.py:196,292,298,439,469,498,523,549,713`,
  `tests/test_analytics_judge_api.py:93,141,209`,
  `tests/test_analytics_concepts_api.py:207,272,315,378,425,473`). Step 1 achieves the
  same result by pushing an application context inside the worker, which keeps every
  test seam intact. The cited exemplar line is `api_cases.py:425` (the `def sampler():`
  line) — accurate.

- **PYCORR-03, the SQLite claim.** The audit's impact text implied the Python fallback
  matters on SQLite too. It does not, for the reason the verifier gave: `SqliteRepository`
  defines `count_cases` (`sqlite_repository.py:428`), so the
  `_supabase_backend = hasattr(repo, "count_cases")` guard skips the fallback entirely
  and the application-context bug is never reached. I confirmed this end-to-end — on a
  SQLite-backed app, `/api/v1/analytics/outcomes` returns the same empty payload with
  **no log line at all**. That is a *separate* defect in the same four functions, not
  the one the finding describes, so it is called out as its own step (Step 3) rather
  than folded into PYCORR-03.

- **PYCORR-14, the proposed fix.** Only the `future.cancel()` half is implemented.
  Executor sizing and a semaphore/503 admission gate are deferred with reasoning in
  "Maintenance notes": the verifier explicitly did not reproduce saturation under load,
  and picking pool sizes or a queue-depth threshold without a measurement would be
  guesswork in a local-dev-only Flask process. The cited line for the submit is
  `api.py:1289`; `future.result(timeout=...)` is on line **1290**, as the verifier noted.

- **PYCORR-20, the stated impact.** "Editing `downloaded_cases/judge_bios.json`
  requires a full process restart" is true of any `lru_cache` and is not the defect.
  The real defect is that the cache key omits the varying input, so the *first* app in
  a process pins the map for every later app — which I reproduced concretely (app B,
  whose output dir has no `judge_bios.json`, receives app A's map). The audit's cited
  lines were off by one: `_load_judge_bios` is decorated at **268** and defined at
  **269**; `_load_judge_name_overrides` is decorated at **293** and defined at **294**;
  the `candidate_paths` list containing `get_output_dir()` is at **299-302**, not 293.

- **PYCORR-24, the source-breakdown impact.** "Renders every source count as 0" is
  imprecise about the mechanism but right about the outcome, and the verifier's
  correction is the important one: `api.py:1444-1446` falls back to
  `{src: 0 for src in s.get("sources", [])}`, so the chart renders **with real source
  names and all-zero counts** rather than rendering empty. I reproduced exactly that —
  `{'AustLII': 0}`. That is worse than an empty chart, because it looks like a genuine
  finding ("no cases from AustLII") rather than missing data. The cited line for the
  consumer is `api.py:1444` (the `by_source` read); the zero-fill is on **1445-1446**.
