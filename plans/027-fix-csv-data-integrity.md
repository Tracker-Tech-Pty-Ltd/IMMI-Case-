# Plan 027: Stop silently destroying rows and columns in the master CSV

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index. Do **not** create `plans/README.md`
> if it is absent.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   immi_case_downloader/csv_repository.py \
>   immi_case_downloader/sqlite_repository.py \
>   immi_case_downloader/pipeline.py \
>   immi_case_downloader/web/jobs.py \
>   download_fulltext.py \
>   normalize_metadata.py \
>   merge_llm_extraction.py
> ```
> Empty output means no drift — proceed. If any in-scope file changed since
> this plan was written, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.
>
> **Every edit in this plan is anchored on unique text, never on a line
> number.** Re-read the file with `Read` immediately before each edit. The
> line numbers in "Current state" are the ones observed at `42826a3`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

The local-dev data layer loses data in four independent ways, and one of the
losses has already happened to the real 149,016-row master CSV.

1. **Every populated `visa_subclass` value on disk is already corrupted.** Three
   root-level pandas scripts read `downloaded_cases/immigration_cases.csv`
   without a string dtype, so pandas infers `float64` for the numeric-looking
   `visa_subclass` / `visa_subclass_number` columns and writes them back as
   `866.0` instead of `866`. Measured on the live file today: **136,502 of
   136,502** non-empty `visa_subclass` values end in `.0`, and so do all 136,502
   `visa_subclass_number` values. `visa_registry.clean_subclass()` was written to
   paper over this at read time, but `storage.get_statistics()` groups on the
   raw value, so the CSV-backend dashboard reports subclass buckets named
   `"866.0"`.
2. **The download jobs' work is thrown away.** `CsvRepository.save_many()` is a
   URL-dedup *insert*, not an upsert: an incoming case whose URL already exists
   is skipped entirely, so the `full_text_path` the download job just wrote is
   never persisted. It only appears to work because the 60-second cache in
   `storage.load_all_cases()` hands back the very same mutated Python objects.
   Any download run longer than 60 seconds (the scraper sleeps 1 s per case, so
   anything past ~60 cases) outlives the TTL and silently discards the paths —
   turning every downloaded `.txt` file into an orphan that the next run
   re-downloads, re-triggering AustLII rate limiting.
3. **URL-keyed dedup deletes rows.** Both the pipeline clean phase and
   `download_fulltext.py` collapse every case with an empty URL into a single
   surviving row. Blank URLs are an expected state — `storage.add_case_manual()`
   sets no URL and `POST /api/v1/cases` requires only a title *or* a citation —
   so one clean-phase run permanently deletes all but one manually-added case,
   with no warning and no backup on the pipeline path.
4. **The SQLite backend crashes half-way through a batch.** `cases.url` carries
   an inline `UNIQUE`, so a second blank-URL case raises `IntegrityError`;
   `save_many()` has no `try/except`, so the exception skips `conn.commit()` and
   leaves the thread-local connection with an open implicit transaction holding
   a partial write, which the next unrelated commit on that thread then flushes.

When this lands: the CSV round-trips its numeric columns as text, downloaded
full-text paths survive, blank-URL cases stop being deleted, batch saves are
atomic, and the long-running bulk downloader can actually be interrupted the way
its own docstring promises.

## Current state

### Files and their role

| File | Role here |
|---|---|
| `immi_case_downloader/csv_repository.py` | `CsvRepository.save_many()` — the broken insert-not-upsert (lines 39–55) |
| `immi_case_downloader/sqlite_repository.py` | schema (lines 24–68) and `save_many()` (lines 240–265) — the `UNIQUE` crash and missing rollback |
| `immi_case_downloader/pipeline.py` | clean-phase dedup (512–525), download-phase stop/retry accounting (582–652), `start_pipeline()` race (724–737) |
| `download_fulltext.py` | unguarded read (186), URL-only dedup (75), three non-atomic writes (76, 168, 172) |
| `normalize_metadata.py` | unguarded read (288) |
| `merge_llm_extraction.py` | unguarded read (54) |
| `immi_case_downloader/web/jobs.py` | **caller only** — `_run_download_job` at 182 calls `repo.save_many(updated)` at 238. Fixing `CsvRepository.save_many` fixes it; **no edit to this file is expected**. |

### The broken CSV upsert

`immi_case_downloader/csv_repository.py:39-55` — verbatim:

```python
    def save_many(self, cases: list[ImmigrationCase]) -> int:
        """Merge new cases with existing by URL dedup, then save."""
        existing = load_all_cases(self.base_dir)
        existing_urls = {c.url for c in existing}
        added = 0
        for case in cases:
            case.ensure_id()
            if case.url and case.url not in existing_urls:
                existing.append(case)
                existing_urls.add(case.url)
                added += 1
            elif not case.url:
                existing.append(case)
                added += 1
        save_cases_csv(existing, self.base_dir)
        save_cases_json(existing, self.base_dir)
        return added
```

Two defects in those 17 lines, both reproduced against the real code:

- A case whose URL already exists hits neither branch, so **no field of an
  existing case is ever written**. Reproduced: after `storage.invalidate_cases_cache()`,
  `repo.save_many([case_with_full_text_path])` returned `added=0` and the reloaded
  case had `full_text_path=''`.
- The `elif not case.url` branch appends unconditionally, with no membership
  check. Reproduced: calling `save_many([same_blank_url_case])` three times
  produced **3 duplicate rows**.

The caller that this hurts, `immi_case_downloader/web/jobs.py:236-239` — verbatim
(note the comment already claims a behaviour the code does not have):

```python
        # Persist updated full_text_path via upsert
        if updated:
            repo.save_many(updated)
            _notify_cache_invalidation()
```

Why it usually appears to work — `immi_case_downloader/storage.py:193` and
`:216`, verbatim:

```python
_CACHE_TTL = 60.0  # seconds — matched to API-level cache
```

```python
            return list(_cases_cache["cases"])  # return a copy
```

`list(...)` copies the *list*, not the `ImmigrationCase` objects. While the TTL
holds, `load_all_cases()` inside `save_many` returns the identical objects the
caller just mutated, so the mutation reaches disk by accident. Once the TTL
lapses, fresh objects are read from the CSV and the mutation is lost.

### The reference upsert to match — SQLite already does this

`immi_case_downloader/sqlite_repository.py:240-249` — verbatim:

```python
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
```

The SQLite backend keys on `case_id` and overwrites **every** column on
conflict — including with empty incoming values. The CSV fix below keys on
`case_id` too but only copies **non-empty** incoming values, which is strictly
safer than what SQLite does today.

### The SQLite `UNIQUE` crash

`immi_case_downloader/sqlite_repository.py:33` — verbatim (inside `_SCHEMA_SQL`,
which starts at line 24):

```
    url TEXT NOT NULL DEFAULT '' UNIQUE,
```

`immi_case_downloader/sqlite_repository.py:255-265` — verbatim:

```python
        batch = []
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
```

Reproduced verbatim against a fresh temp DB:

```
RAISED: IntegrityError UNIQUE constraint failed: cases.url
rows after: 1              <- partial apply
in_transaction: True       <- implicit transaction left open, commit() skipped
```

Reachable from the live API: `immi_case_downloader/web/routes/api_cases.py:968-969`
— verbatim:

```python
    if not data.get("title") and not data.get("citation"):
        return _error("Title or citation is required")
```

No URL is required, and `SqliteRepository.add()` routes straight into
`save_many([case])`.

### The pipeline clean-phase row deletion

`immi_case_downloader/pipeline.py:512-522` — verbatim (`cases` comes from
`load_all_cases(self.output_dir)` at line 491, and the result is written over
the whole file by `save_cases_csv(cases, self.output_dir)` at line 534):

```python
        # Deduplicate by URL
        if self.config.deduplicate:
            before_count = len(cases)
            seen_urls = set()
            unique = []
            for case in cases:
                if case.url not in seen_urls:
                    seen_urls.add(case.url)
                    unique.append(case)
            dupes_removed = before_count - len(unique)
            cases = unique
```

`PipelineConfig.deduplicate` defaults to `True` (`pipeline.py:59`). Reproduced:
two blank-URL cases in the CSV → 1 row after this loop.

### The pipeline download-phase accounting and stop bugs

`immi_case_downloader/pipeline.py:582-584` — verbatim:

```python
        for i, case in enumerate(targets):
            if self._is_stopped():
                return
```

That `return` exits `_run_download_phase` from inside the loop, skipping the
final `self._save_download_progress(targets)` at line 652. Checkpoints only fire
every 200 downloads (`pipeline.py:624-626`), so pressing Stop orphans up to 199
already-written `.txt` files.

`immi_case_downloader/pipeline.py:597-609` — verbatim:

```python
                else:
                    # Check if the error is retryable (transient network/server issue)
                    error_info = getattr(scraper, "last_error", None)
                    category = error_info.get("category", "") if error_info else ""
                    if category in RETRYABLE_ERRORS:
                        retry_queue.append(case.case_id)
                        self.log.add(
                            "download", "warn", category,
                            f"Will retry: {case.citation or case.case_id}",
                            case_id=case.case_id,
                        )
                    else:
                        failed += 1
```

`immi_case_downloader/pipeline.py:644-647` — verbatim:

```python
                    if text:
                        save_case_text(case, text, self.output_dir)
                        retried += 1
                        failed -= 1
```

The retryable-empty branch queues without incrementing `failed`, but the retry
loop decrements unconditionally. One target recovered from that branch yields
`failed == -1` in the status payload built at lines 654-660.

### The `start_pipeline` check-then-act race

`immi_case_downloader/pipeline.py:724-736` — verbatim:

```python
def start_pipeline(config: PipelineConfig, output_dir: str = OUTPUT_DIR) -> bool:
    """Start the pipeline in a background thread. Returns False if already running."""
    global _active_pipeline

    with _active_pipeline_lock:
        if _active_pipeline is not None and _active_pipeline.get_status()["running"]:
            return False
        pipeline = SmartPipeline(config, output_dir)
        _active_pipeline = pipeline

    thread = threading.Thread(target=pipeline.run, daemon=True)
    try:
        thread.start()
```

`running` is only set `True` once `SmartPipeline.run()` executes on the new
thread (`pipeline.py:261-265`), so a second caller that enters the lock before
the thread is scheduled sees the freshly-assigned instance with
`running == False` and passes. Both crawl phases then rewrite the whole CSV
(`pipeline.py:373`, `pipeline.py:534`), so the second writer erases the first
writer's new cases. `job_manager.reserve()` in
`immi_case_downloader/web/job_manager.py:47-53` is the correct in-repo pattern —
verbatim:

```python
    def reserve(self, new_state: dict[str, Any]) -> bool:
        """Atomically claim the job slot if nothing is currently running."""
        with self._lock:
            if self._state.get("running"):
                return False
            self._state.clear()
            self._state.update(deepcopy(new_state))
            return True
```

### The unguarded pandas readers

Three unguarded readers live in this plan's territory (verbatim):

- `download_fulltext.py:186` — `    df = pd.read_csv(CSV_PATH)`
- `normalize_metadata.py:288` — `    df = pd.read_csv(CSV_PATH, low_memory=False)`
- `merge_llm_extraction.py:54` — `    df = pd.read_csv(CSV_PATH, low_memory=False)`

The canonical guarded reader, `immi_case_downloader/storage.py:137` — verbatim:

```python
    df = pd.read_csv(filepath, encoding="utf-8-sig", dtype={"visa_subclass": str})
```

`scripts/` already follows the guarded form everywhere, e.g.
`scripts/extract_gemini.py:205` — verbatim:

```python
    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
```

Confirmed on pandas 3.0.3 (the version in `.venv`): a CSV column of digits that
contains any blank is inferred as `float64` and written back as `866.0`; with
`dtype={"visa_subclass": str}` it round-trips as `866`.

### `download_fulltext.py` writes non-atomically and takes no backup

`download_fulltext.py:6` — verbatim: `Progress saved every 200 cases. Safe to interrupt and resume.`

`download_fulltext.py:75-76`, `:168`, `:172` — verbatim:

```python
        df_merged = df_merged.drop_duplicates(subset="url", keep="first")
        df_merged.to_csv(CSV_PATH, index=False)
```

```python
            df.to_csv(CSV_PATH, index=False)
```

```python
    df.to_csv(CSV_PATH, index=False)
```

Each writes straight over the 149k-row master file; an interrupt inside the
write window truncates it. `normalize_metadata.py:292-293` and
`merge_llm_extraction.py:87-88` both take a timestamped `.bak` first;
`download_fulltext.py` takes none. The in-repo atomic-write exemplars are
`immi_case_downloader/storage.py:59-67` and `scripts/extract_gemini.py:229-234`
— verbatim from the latter:

```python
    # Atomic save
    tmp = str(CSV_PATH) + ".tmp"
    backup = str(CSV_PATH) + ".bak_gemini"
    df.to_csv(tmp, index=False)
    if os.path.exists(backup):
        os.remove(backup)
    os.replace(str(CSV_PATH), backup)
    os.replace(tmp, str(CSV_PATH))
```

### Conventions this plan must honour

- **Always construct cases via `ImmigrationCase.from_dict()`** — pandas turns
  empty CSV fields into `float('nan')`, and `from_dict`
  (`immi_case_downloader/models.py:52-66`) coerces `nan` to `""` and `year` to
  `int`. Never build an `ImmigrationCase(**row)` directly.
- `ImmigrationCase` is a plain `@dataclass` (`models.py:7-41`) with 31 fields;
  `CASE_FIELDS` in `immi_case_downloader/storage.py:20-49` is the authoritative
  column order and is already imported by `sqlite_repository.py:9`.
- `ensure_id()` (`models.py:46-50`) sets
  `case_id = sha256(citation or url or title)[:12]` — stable, and distinct for
  two different blank-URL cases.
- `CaseRepository` is a `runtime_checkable` Protocol in
  `immi_case_downloader/repository.py`; `CsvRepository`, `SqliteRepository` and
  `SupabaseRepository` all implement it. `save_many` must keep returning
  `int` = number of **newly added** cases.
- Commit convention: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- The master CSV on disk **has no UTF-8 BOM** (byte 0 is `c` of `case_id`).
  Reading with `encoding="utf-8-sig"` is safe either way; **do not** add
  `encoding="utf-8-sig"` to any `to_csv` call in the root scripts — that would
  introduce a BOM and break `download_missing_22.py:31` and
  `extract_with_llm.py:118`, which read with no encoding argument.

## Commands you will need

Run all of these from `/Users/d/Developer/Active Projects/IMMI-Case-`. Always
use the venv interpreter — never global `pip`/`python3`.

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `.venv/bin/python -m pytest tests/test_csv_repository.py tests/test_sqlite_repository.py tests/test_pipeline.py tests/test_storage.py -q` | exit 0, all pass |
| Full Python suite | `make test-py` | `1141 passed, 3 failed, 7 skipped` **plus your new tests** (see note below) |
| Lint | `make lint` | `All checks passed!` |
| Ruff on changed files | `.venv/bin/ruff check immi_case_downloader/ download_fulltext.py normalize_metadata.py merge_llm_extraction.py` | `All checks passed!` |
| Ruff on new tests | `.venv/bin/ruff check tests/test_csv_repository.py` | `All checks passed!` |

**Baseline note — 3 pre-existing failures are environmental, not yours.** At
commit `42826a3`, `make test-py` reports `1141 passed, 3 failed, 7 skipped`. All
3 failures are in `tests/test_backfill_judge_overrides_from_pdf.py` and are
caused by a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks
the `pypdf` import. They are not caused by repo code and are **out of scope**.
Your success condition is: passed count rises by exactly the number of tests you
add, failed count stays at 3, and those 3 are still the same pyexpat ones.

`make test-py` takes over two minutes. Use the targeted command while iterating
and run the full suite once at the end.

## Scope

**In scope** (the only files you may modify or create):

- `immi_case_downloader/csv_repository.py` — rewrite `save_many`
- `immi_case_downloader/sqlite_repository.py` — split the schema constant, drop
  the inline `UNIQUE`, add a partial unique index + one-time migration, make
  `save_many` transactional
- `immi_case_downloader/pipeline.py` — clean-phase dedup key, download-phase
  stop persistence and `failed` accounting, `start_pipeline` atomic claim
- `download_fulltext.py` — dtype guard, composite dedup key, atomic writes +
  one-time backup
- `normalize_metadata.py` — dtype guard on the read
- `merge_llm_extraction.py` — dtype guard on the read
- `tests/test_csv_repository.py` — **create**
- `tests/test_csv_data_integrity.py` — **create**

`immi_case_downloader/web/jobs.py` is inside this plan's territory but **needs no
edit**: fixing `CsvRepository.save_many` fixes both of its call sites. Only touch
it if a verification step proves otherwise, and say so in your report.

**Out of scope** (do NOT touch, even though they look related):

- `download_missing_22.py:31` and `extract_with_llm.py:118` — two more unguarded
  `read_csv` calls on the same master file. Real, but owned by a different plan's
  file territory; editing them here would collide with a plan running in
  parallel. Record them in your report instead.
- `immi_case_downloader/cli.py:84` — the same blank-URL skip pattern in
  `cmd_search`. It only *refuses to add* a second blank-URL case; it never
  deletes an existing row, so it is materially less severe, and the file is not
  in this plan's territory.
- `immi_case_downloader/storage.py` — including `get_statistics()` at lines
  345-346, which groups on the raw (`866.0`) `visa_subclass`. Fixing the writers
  is this plan's job; fixing the reader is not, and `storage.py` is shared by
  several plans.
- `immi_case_downloader/visa_registry.py` — `clean_subclass()`'s `.0`-stripping
  workaround stays. It is now belt-and-braces rather than the only defence;
  removing it would break on the 136,502 already-corrupted rows on disk.
- **The data in `downloaded_cases/`** — do not run any repair over
  `immigration_cases.csv` or `cases.db`. Both are gitignored, local-only, and
  large (149,016 rows / 340 MB). Repair is an operator decision; see
  "Maintenance notes".
- Any existing file under `tests/` — create new test files only. Another plan is
  concurrently linting and editing the existing test files.
- `workers/` and `frontend/` — untouched by this plan.

## Git workflow

- Branch: `advisor/027-fix-csv-data-integrity` (create from `main`).
- Commit per step, conventional-commit style, e.g.
  `fix: make CsvRepository.save_many a real upsert keyed on case_id`.
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Add the failing regression tests first

Create `tests/test_csv_data_integrity.py`. These tests must **fail** against the
current code — that is how you prove the bugs are real before fixing them.

Model the structure on `tests/test_sqlite_repository.py` (module docstring,
`pytest` fixtures, `class TestXxx:` groupings). Import
`storage.invalidate_cases_cache` and call it wherever a test must force a real
re-read from disk — without it, the 60-second object cache masks the CSV bug.

Write exactly these seven tests:

1. `test_save_many_persists_full_text_path_after_cache_expiry` — save a case with
   a URL; `invalidate_cases_cache()`; load it, set `full_text_path`;
   `invalidate_cases_cache()` **again** (this simulates the TTL lapsing mid-job);
   `repo.save_many([case])`; `invalidate_cases_cache()`; assert the reloaded case
   has the new `full_text_path`.
2. `test_save_many_does_not_duplicate_blank_url_case` — call
   `repo.save_many([blank_url_case])` three times with
   `invalidate_cases_cache()` between calls; assert `len(repo.load_all()) == 1`.
3. `test_save_many_keeps_two_distinct_blank_url_cases` — two blank-URL cases with
   different citations; assert both survive and `save_many` returned `2`.
4. `test_save_many_does_not_clobber_existing_values_with_blanks` — store a case
   with `user_notes="keep me"`, then `save_many` a case with the same `case_id`
   and `user_notes=""`; assert `user_notes == "keep me"` after reload.
5. `test_clean_phase_keeps_distinct_blank_url_cases` — write two blank-URL cases
   with `save_cases_csv`, run `SmartPipeline(config, tmp)._run_clean_phase()`
   with `deduplicate=True`, assert `len(load_all_cases(tmp)) == 2`. Copy the
   `_make_config` helper and the `@patch("immi_case_downloader.sources.austlii.AustLIIScraper")`
   decorator style from `tests/test_pipeline.py:174-186` and `:232`.
6. `test_sqlite_save_many_accepts_two_blank_url_cases` — a fresh
   `SqliteRepository(tmp_path/"t.db")`; `save_many([blank_a, blank_b])` must not
   raise and `load_all()` must return 2.
7. `test_sqlite_save_many_rolls_back_on_error` — force a failure inside the batch
   (e.g. `monkeypatch` the connection's `executemany` to raise `sqlite3.IntegrityError`
   on the call), assert the exception propagates, assert `load_all()` is unchanged,
   and assert `repo._conn().in_transaction is False`.

Also create `tests/test_csv_repository.py` with a minimal happy-path suite for
`CsvRepository` (it currently has no dedicated test file): `save_many` on an
empty store returns the number of cases; `load_all` round-trips; `get_by_id`
finds a saved case; `get_existing_urls` excludes blanks.

**Verify**: `.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q`
→ tests 1, 2, 3, 5, 6, 7 **FAIL** and test 4 passes. If any of 1, 2, 3, 5, 6, 7
passes at this point, the codebase has drifted — treat it as a STOP condition.

### Step 2: Make `CsvRepository.save_many` a real upsert keyed on `case_id`

Edit `immi_case_downloader/csv_repository.py`.

First extend the existing import block at the top of the file to also pull in
`CASE_FIELDS`:

```python
from .storage import (
    CASE_FIELDS,
    load_all_cases,
    ...
)
```

Then replace the whole `save_many` method (the verbatim 17 lines quoted in
"Current state") with:

```python
    def save_many(self, cases: list[ImmigrationCase]) -> int:
        """Upsert cases into the CSV store, keyed on ``case_id``.

        An incoming case whose ``case_id`` already exists updates the stored
        record in place — every non-empty incoming field wins, empty incoming
        fields leave the stored value alone. An unseen case is appended.
        Returns the number of *newly added* cases.

        Keyed on ``case_id`` rather than ``url`` on purpose: blank URLs are an
        expected state (manual adds set none), and URL-keying both discarded
        every update to an existing case and duplicated blank-URL cases on
        every call. This matches ``SqliteRepository.save_many``, which upserts
        on ``ON CONFLICT(case_id)``.
        """
        existing = load_all_cases(self.base_dir)
        by_id: dict[str, ImmigrationCase] = {}
        for stored in existing:
            stored.ensure_id()
            by_id.setdefault(stored.case_id, stored)

        added = 0
        for case in cases:
            case.ensure_id()
            stored = by_id.get(case.case_id)
            if stored is None:
                existing.append(case)
                by_id[case.case_id] = case
                added += 1
                continue
            if stored is case:
                continue
            for field in CASE_FIELDS:
                if field == "case_id":
                    continue
                value = getattr(case, field, None)
                # "" and 0 are this dataclass's "unset" markers — never let an
                # unset incoming field erase a stored one.
                if value is None or value == "" or value == 0:
                    continue
                setattr(stored, field, value)

        save_cases_csv(existing, self.base_dir)
        save_cases_json(existing, self.base_dir)
        return added
```

Notes for the executor:

- `by_id.setdefault` keeps the *first* row when the CSV already contains
  duplicate `case_id`s, and leaves the later duplicates in `existing` untouched.
  This must not silently drop rows — row count only ever grows here.
- The `stored is case` guard covers the cache-aliasing path where
  `load_all_cases()` returned the very object the caller mutated.
- `value == 0` is safe for the string fields: `"0" == 0` is `False` in Python,
  so a legitimate `"0"` string is preserved. It only skips `year == 0`, which is
  this dataclass's "unknown year" marker.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_csv_data_integrity.py tests/test_csv_repository.py -q
```
→ tests 1, 2, 3, 4 pass; tests 5, 6, 7 still fail (fixed in later steps).

Then confirm nothing else regressed:
```bash
.venv/bin/python -m pytest tests/test_storage.py tests/test_webapp.py tests/test_cases_api.py tests/test_app_factory.py -q
```
→ exit 0, all pass.

### Step 3: Fix the pipeline clean-phase dedup key

Edit `immi_case_downloader/pipeline.py`. Replace the verbatim block quoted in
"Current state" (`# Deduplicate by URL` through `cases = unique`) with:

```python
        # Deduplicate by URL, falling back to case_id for URL-less cases
        if self.config.deduplicate:
            before_count = len(cases)
            seen_keys = set()
            unique = []
            for case in cases:
                case.ensure_id()
                # Blank URLs are an expected state (manual adds, href parse
                # failures). Keying on url alone collapsed every one of them
                # into a single surviving row.
                key = case.url or f"__noid__{case.case_id}"
                if key not in seen_keys:
                    seen_keys.add(key)
                    unique.append(case)
            dupes_removed = before_count - len(unique)
            cases = unique
```

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_pipeline.py tests/test_csv_data_integrity.py -q
```
→ exit 0 except tests 6 and 7, which still fail. `test_clean_phase_dedup` in
`tests/test_pipeline.py` (two cases sharing one URL → 1 row) must still pass —
it proves genuine URL duplicates are still removed.

### Step 4: Persist download progress on stop, and fix the `failed` counter

Edit `immi_case_downloader/pipeline.py`, inside `_run_download_phase`.

**4a.** Replace the verbatim loop head:

```python
        for i, case in enumerate(targets):
            if self._is_stopped():
                return
```

with:

```python
        for i, case in enumerate(targets):
            if self._is_stopped():
                # Persist everything downloaded so far before bailing out;
                # checkpoints only fire every 200, so up to 199 already-written
                # .txt files would otherwise become orphans that the next run
                # re-downloads.
                self._save_download_progress(targets[:i])
                return
```

**4b.** In the retryable branch, add the missing increment. Replace:

```python
                    if category in RETRYABLE_ERRORS:
                        retry_queue.append(case.case_id)
```

with:

```python
                    if category in RETRYABLE_ERRORS:
                        # Count it as failed now; the retry loop decrements on
                        # success. Without this the decrement is unbalanced and
                        # `failed` can go negative in the status payload.
                        failed += 1
                        retry_queue.append(case.case_id)
```

**4c.** Add a floor before the stats payload. Replace the verbatim:

```python
        # Final save
        self._save_download_progress(targets)

        with self._lock:
```

with:

```python
        # Final save
        self._save_download_progress(targets)

        failed = max(0, failed)

        with self._lock:
```

Add two tests to `tests/test_csv_data_integrity.py`:

- `test_download_phase_persists_progress_on_stop` — build a `SmartPipeline` over
  a tmp dir with two target cases, patch `AustLIIScraper` so
  `download_case_detail` returns text, call `pipeline.request_stop()` before
  running `_run_download_phase()`, and assert `_save_download_progress` was
  called (patch it with a `MagicMock` and assert `.called`).
- `test_download_phase_failed_count_never_negative` — drive one target through
  the retryable-empty branch (scraper returns `""` and
  `scraper.last_error = {"category": "http_500"}`), then have the retry succeed,
  and assert `pipeline.get_status()["stats"]["download"]["failed"] >= 0`.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_pipeline.py tests/test_csv_data_integrity.py -q
```
→ exit 0 except tests 6 and 7.

### Step 5: Make `start_pipeline` claim the slot atomically

Edit `immi_case_downloader/pipeline.py`. Replace the verbatim `start_pipeline`
body down to and including the `thread.start()` `try` block:

```python
def start_pipeline(config: PipelineConfig, output_dir: str = OUTPUT_DIR) -> bool:
    """Start the pipeline in a background thread. Returns False if already running."""
    global _active_pipeline

    with _active_pipeline_lock:
        if _active_pipeline is not None and _active_pipeline.get_status()["running"]:
            return False
        pipeline = SmartPipeline(config, output_dir)
        # Claim the slot inside the same lock. `run()` does not set running=True
        # until it is scheduled on the new thread, so a second caller entering
        # this lock first would otherwise see running=False and start a rival
        # pipeline that rewrites the same CSV from its own snapshot.
        with pipeline._lock:
            pipeline._status["running"] = True
        _active_pipeline = pipeline

    thread = threading.Thread(target=pipeline.run, daemon=True)
    try:
        thread.start()
```

Leave the existing `except Exception:` block exactly as it is — it already
resets `running` to `False` when `thread.start()` raises.

Add one test to `tests/test_csv_data_integrity.py`:

- `test_start_pipeline_claims_slot_before_thread_starts` — patch
  `immi_case_downloader.pipeline.threading.Thread` (so `run()` never executes),
  save and restore `pipeline._active_pipeline` around the test exactly the way
  `tests/test_pipeline.py:289-300` does, call `start_pipeline(config)` once
  (expect `True`), then call it again (expect `False`).

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_pipeline.py tests/test_csv_data_integrity.py -q
```
→ exit 0 except tests 6 and 7. The three existing `start_pipeline` tests in
`tests/test_pipeline.py` must all still pass.

### Step 6: Make `SqliteRepository.save_many` transactional

Edit `immi_case_downloader/sqlite_repository.py`. Wrap the batching body
(everything from `count = 0` through `conn.commit()`) so a failure rolls back
instead of leaving a partial write in an open transaction:

```python
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
```

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_sqlite_repository.py tests/test_csv_data_integrity.py -q
```
→ test 7 now passes; test 6 still fails.

### Step 7: Exempt blank URLs from the SQLite `UNIQUE` constraint

This is the highest-risk step. Read it fully before editing.

**7a. Split the schema constant.** In `immi_case_downloader/sqlite_repository.py`,
replace the single `_SCHEMA_SQL` string with three constants. `_CASES_TABLE_SQL`
is the current table DDL with two changes — a `{table}` placeholder for the table
name, and the inline `UNIQUE` removed from `url`:

```python
_CASES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS {table} (
    case_id TEXT PRIMARY KEY,
    ...
    url TEXT NOT NULL DEFAULT '',
    ...
);
"""
```

Keep every other column line byte-identical to what is there today. Then:

```python
_INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_court_code ON cases(court_code);
CREATE INDEX IF NOT EXISTS idx_year ON cases(year);
CREATE INDEX IF NOT EXISTS idx_court_year ON cases(court_code, year);
CREATE INDEX IF NOT EXISTS idx_source ON cases(source);
CREATE INDEX IF NOT EXISTS idx_outcome ON cases(outcome);
CREATE INDEX IF NOT EXISTS idx_case_nature ON cases(case_nature);
CREATE INDEX IF NOT EXISTS idx_visa_type ON cases(visa_type);
CREATE INDEX IF NOT EXISTS idx_visa_subclass_number ON cases(visa_subclass_number);
CREATE INDEX IF NOT EXISTS idx_court_outcome ON cases(court_code, outcome);
-- Partial unique index: real URLs stay unique, blank URLs are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_url_unique ON cases(url) WHERE url != '';
"""

_SCHEMA_SQL = _CASES_TABLE_SQL.format(table="cases") + _INDEXES_SQL
```

Nothing outside this module references `_SCHEMA_SQL` (verified by grep across
`tests/`, `immi_case_downloader/`, `scripts/` and the root `*.py`), so the split
is internal.

**7b. Add the legacy detection helper** as a `@staticmethod` on
`SqliteRepository`:

```python
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
```

`_conn()` already sets `conn.row_factory = sqlite3.Row`
(`sqlite_repository.py:127`), so keyed access works.

**7c. Add the one-time rebuild** as a method on `SqliteRepository`. SQLite cannot
drop a table constraint in place, so the table must be rebuilt. This exact
sequence was proven end-to-end against the real module before this plan was
written — it preserves rows, rebuilds FTS5, keeps real URLs unique, and lets two
blank-URL cases save:

```python
    def _rebuild_cases_without_url_unique(self, conn: sqlite3.Connection) -> None:
        """One-time migration: drop the table-level UNIQUE on `cases.url`.

        Blank URLs are an expected state, and the inline UNIQUE made a second
        URL-less case raise IntegrityError. Runs once per database; the
        detection in _has_legacy_url_unique() makes it a no-op afterwards.
        """
        cols = ", ".join(CASE_FIELDS)
        before = conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0]
        logger.warning(
            "Migrating SQLite schema at %s: dropping the legacy UNIQUE on "
            "cases.url (%d rows). This runs once.", self.db_path, before,
        )
        conn.execute("BEGIN IMMEDIATE")
        try:
            for trigger in ("cases_ai", "cases_ad", "cases_au"):
                conn.execute(f"DROP TRIGGER IF EXISTS {trigger}")
            conn.execute("DROP TABLE IF EXISTS cases_migrated")
            conn.executescript(_CASES_TABLE_SQL.format(table="cases_migrated"))
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
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            logger.error("SQLite url-UNIQUE migration rolled back; schema unchanged.")
            raise
        # Indexes, FTS and triggers went with the dropped table — recreate them.
        conn.executescript(_INDEXES_SQL)
        conn.executescript(_FTS_SQL)
        conn.executescript(_TRIGGERS_SQL)
        conn.execute("INSERT INTO cases_fts(cases_fts) VALUES('rebuild')")
        conn.commit()
```

Note `conn.executescript` implicitly commits any open transaction, which is why
the `BEGIN IMMEDIATE` block uses `conn.execute("COMMIT")` and the script calls
sit outside it.

**7d. Call it from `initialize()`.** Replace the verbatim method:

```python
    def initialize(self):
        """Create tables, indexes, FTS, and triggers if they don't exist."""
        conn = self._conn()
        conn.executescript(_SCHEMA_SQL)
        conn.executescript(_FTS_SQL)
        conn.executescript(_TRIGGERS_SQL)
        conn.commit()
```

with:

```python
    def initialize(self):
        """Create tables, indexes, FTS, and triggers if they don't exist."""
        conn = self._conn()
        conn.executescript(_SCHEMA_SQL)
        conn.executescript(_FTS_SQL)
        conn.executescript(_TRIGGERS_SQL)
        conn.commit()
        if self._has_legacy_url_unique(conn):
            self._rebuild_cases_without_url_unique(conn)
```

Add two more tests to `tests/test_csv_data_integrity.py`:

- `test_sqlite_migration_removes_legacy_url_unique` — build a legacy-schema DB by
  hand (`sqlite3.connect(tmp)` + the old DDL string with
  `url TEXT NOT NULL DEFAULT '' UNIQUE`, plus `_FTS_SQL` and `_TRIGGERS_SQL`),
  insert one row with a real URL, close it, then open it with
  `SqliteRepository(path)` and assert
  `SqliteRepository._has_legacy_url_unique(repo._conn()) is False`, the row is
  still there, and FTS still matches a word from its `catchwords`.
- `test_sqlite_still_rejects_duplicate_real_urls` — after the migration, saving a
  second case with an already-used non-blank URL still raises
  `sqlite3.IntegrityError`.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_sqlite_repository.py tests/test_csv_data_integrity.py -q
```
→ exit 0, all pass including tests 6 and 7. Every pre-existing test in
`tests/test_sqlite_repository.py` must still pass.

### Step 8: Guard the three pandas readers

**8a.** `download_fulltext.py` — replace the verbatim line:

```python
    df = pd.read_csv(CSV_PATH)
```

with:

```python
    df = pd.read_csv(
        CSV_PATH,
        encoding="utf-8-sig",
        dtype={"visa_subclass": str, "visa_subclass_number": str},
        low_memory=False,
    )
```

**8b.** `normalize_metadata.py` — replace the verbatim line:

```python
    df = pd.read_csv(CSV_PATH, low_memory=False)
```

with:

```python
    df = pd.read_csv(
        CSV_PATH,
        encoding="utf-8-sig",
        dtype={"visa_subclass": str, "visa_subclass_number": str},
        low_memory=False,
    )
```

**8c.** `merge_llm_extraction.py` — the same replacement, on its own single
occurrence of that line.

Do **not** touch any `to_csv` call's encoding in this step (see the BOM note in
"Current state").

Add one test to `tests/test_csv_data_integrity.py`:

- `test_root_scripts_guard_visa_subclass_dtype` — a source-level guard so the next
  unguarded reader is caught by CI. Read each of `download_fulltext.py`,
  `normalize_metadata.py`, `merge_llm_extraction.py` with `pathlib.Path(...).read_text()`,
  find every `pd.read_csv(` occurrence, and assert each is followed (within the
  next 300 characters, before the matching close) by `dtype=` containing
  `"visa_subclass"`. Keep it simple and string-based — no AST parsing. Resolve
  paths relative to the repo root via
  `pathlib.Path(__file__).resolve().parents[1]`.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q
```
→ exit 0.

Then prove the round-trip is actually clean:
```bash
.venv/bin/python -c "
import pandas as pd, io, tempfile, os
p = tempfile.mktemp(suffix='.csv')
open(p,'w').write('case_id,visa_subclass,year\na,866,2020\nb,,2021\n')
df = pd.read_csv(p, encoding='utf-8-sig', dtype={'visa_subclass': str, 'visa_subclass_number': str}, low_memory=False)
out = io.StringIO(); df.to_csv(out, index=False)
assert '866.0' not in out.getvalue(), out.getvalue()
print('OK: visa_subclass round-trips as 866')
os.unlink(p)
"
```
→ prints `OK: visa_subclass round-trips as 866`.

### Step 9: Make `download_fulltext.py` write atomically with a run backup

Edit `download_fulltext.py`.

Add `import shutil` to the existing import block (`os`, `sys`, `time`, `pandas`,
`datetime` are already imported at lines 9-13; `os` is at line 10).

Add this helper immediately after the `log()` function (which ends at line 33):

```python
_backup_taken = False


def _write_csv_atomic(df):
    """Write *df* over the master CSV atomically, after a one-time run backup.

    The module docstring promises this script is safe to interrupt, but the
    three writes it performs used to land straight on the 149k-row master file.
    Matches the tmp-then-os.replace pattern in
    immi_case_downloader/storage.save_cases_csv.
    """
    global _backup_taken
    if not _backup_taken and os.path.exists(CSV_PATH):
        backup = f"{CSV_PATH}.bak-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(CSV_PATH, backup)
        log(f"  Backup: {backup}")
        _backup_taken = True
    tmp = CSV_PATH + ".tmp"
    df.to_csv(tmp, index=False)
    os.replace(tmp, CSV_PATH)
```

Then replace **all three** write sites with `_write_csv_atomic(...)`:

- `        df_merged.to_csv(CSV_PATH, index=False)` → `        _write_csv_atomic(df_merged)`
- the checkpoint `            df.to_csv(CSV_PATH, index=False)` → `            _write_csv_atomic(df)`
- the final `    df.to_csv(CSV_PATH, index=False)` → `    _write_csv_atomic(df)`

Finally, fix the URL-only dedup. Replace the verbatim line:

```python
        df_merged = df_merged.drop_duplicates(subset="url", keep="first")
```

with:

```python
        # Blank/NaN urls all compare equal to each other, so a plain
        # drop_duplicates(subset="url") collapses every URL-less case into one
        # surviving row. Fall back to case_id for those.
        df_merged["_dedup_key"] = df_merged["url"].where(
            df_merged["url"].notna() & (df_merged["url"].astype(str).str.strip() != ""),
            "__noid__" + df_merged["case_id"].astype(str),
        )
        df_merged = df_merged.drop_duplicates(subset="_dedup_key", keep="first")
        df_merged = df_merged.drop(columns=["_dedup_key"])
```

**Verify**: the dedup key behaves as intended and no `to_csv(CSV_PATH` remains:

```bash
grep -n "to_csv(CSV_PATH" download_fulltext.py
```
→ no output (exit 1 from grep is expected).

```bash
.venv/bin/python -c "
import pandas as pd
df = pd.DataFrame([
    {'case_id':'a','url':'https://x/1'},
    {'case_id':'b','url':'https://x/1'},
    {'case_id':'c','url':''},
    {'case_id':'d','url':None},
])
df['_dedup_key'] = df['url'].where(
    df['url'].notna() & (df['url'].astype(str).str.strip() != ''),
    '__noid__' + df['case_id'].astype(str))
out = df.drop_duplicates(subset='_dedup_key', keep='first').drop(columns=['_dedup_key'])
assert sorted(out['case_id']) == ['a','c','d'], sorted(out['case_id'])
print('OK: real dup removed, both blank-url rows kept')
"
```
→ prints `OK: real dup removed, both blank-url rows kept`.

```bash
.venv/bin/python -c "import ast,pathlib; ast.parse(pathlib.Path('download_fulltext.py').read_text()); print('OK: parses')"
```
→ prints `OK: parses`.

### Step 10: Full verification

```bash
make lint
.venv/bin/ruff check tests/test_csv_repository.py tests/test_csv_data_integrity.py
make test-py
```

**Verify**: `make lint` prints `All checks passed!`; the ruff call on the two new
test files prints `All checks passed!`; `make test-py` reports **3 failed** (the
pre-existing pyexpat ones in `tests/test_backfill_judge_overrides_from_pdf.py`),
**7 skipped**, and a passed count of `1141 + <number of tests you added>`.

## Test plan

All new tests go in two new files. Do not edit any existing test file.

**`tests/test_csv_data_integrity.py`** — the regression suite, written in step 1
and extended in steps 4, 5, 7, 8:

| Test | Covers |
|---|---|
| `test_save_many_persists_full_text_path_after_cache_expiry` | the download job's paths surviving the 60 s TTL lapse |
| `test_save_many_does_not_duplicate_blank_url_case` | the unconditional `elif not case.url: append` |
| `test_save_many_keeps_two_distinct_blank_url_cases` | two manual adds both survive |
| `test_save_many_does_not_clobber_existing_values_with_blanks` | empty incoming fields never erase stored ones |
| `test_clean_phase_keeps_distinct_blank_url_cases` | pipeline clean phase stops deleting rows |
| `test_download_phase_persists_progress_on_stop` | Stop no longer orphans `.txt` files |
| `test_download_phase_failed_count_never_negative` | the unbalanced `failed -= 1` |
| `test_start_pipeline_claims_slot_before_thread_starts` | the check-then-act race |
| `test_sqlite_save_many_accepts_two_blank_url_cases` | partial unique index |
| `test_sqlite_save_many_rolls_back_on_error` | no partial write, no open transaction |
| `test_sqlite_migration_removes_legacy_url_unique` | one-time rebuild, rows + FTS preserved |
| `test_sqlite_still_rejects_duplicate_real_urls` | uniqueness not weakened for real URLs |
| `test_root_scripts_guard_visa_subclass_dtype` | source guard against the next unguarded `read_csv` |

**`tests/test_csv_repository.py`** — a basic suite for `CsvRepository`, which has
none today: `save_many` return value, `load_all` round-trip, `get_by_id`,
`get_existing_urls` excluding blanks.

Structural patterns to copy:

- `tests/test_sqlite_repository.py:1-45` — module docstring, `repo(tmp_path)`
  fixture that yields then `close()`s, `sample_case` fixture built with explicit
  keyword args then `.ensure_id()`.
- `tests/test_pipeline.py:174-186` and `:232-247` — the `_make_config` helper and
  the `@patch("immi_case_downloader.sources.austlii.AustLIIScraper")` decorator.
- `tests/test_pipeline.py:289-300` — the save-and-restore-`_active_pipeline`
  pattern for anything that touches module-level pipeline state. Always restore
  in a `finally`.

Always call `immi_case_downloader.storage.invalidate_cases_cache()` between a
write and a read that must come from disk; the 60-second object cache otherwise
hides exactly the bug under test.

Every test must use `tmp_path`. **No test may read or write anything under
`downloaded_cases/`.**

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `make lint` prints `All checks passed!`
- [ ] `.venv/bin/ruff check tests/test_csv_repository.py tests/test_csv_data_integrity.py` prints `All checks passed!`
- [ ] `make test-py` reports exactly `3 failed` and `7 skipped`, and all 3 failures are in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `make test-py` passed count equals `1141 + <number of tests added>`
- [ ] `.venv/bin/python -m pytest tests/test_csv_data_integrity.py tests/test_csv_repository.py -q` exits 0
- [ ] `grep -n "to_csv(CSV_PATH" download_fulltext.py` returns no matches
- [ ] `grep -n 'drop_duplicates(subset="url"' download_fulltext.py` returns no matches
- [ ] `grep -c 'dtype={"visa_subclass": str, "visa_subclass_number": str}' download_fulltext.py normalize_metadata.py merge_llm_extraction.py` returns `1` for each file
- [ ] `grep -n "UNIQUE," immi_case_downloader/sqlite_repository.py` returns no matches
- [ ] `grep -n "idx_url_unique" immi_case_downloader/sqlite_repository.py` returns a match
- [ ] `grep -n "existing_urls" immi_case_downloader/csv_repository.py` returns matches only inside `get_existing_urls`, not inside `save_many`
- [ ] `git status --short` shows changes only to the 6 in-scope source files plus the 2 new test files (and nothing under `downloaded_cases/`)
- [ ] `plans/README.md` status row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows any in-scope file changed since `42826a3`, or a verbatim
  excerpt in "Current state" does not match the live file.
- In step 1, any of the six tests that are supposed to fail actually passes. That
  means someone already fixed part of this and the plan's premises no longer
  hold.
- The step 7 migration raises. It rolls back and leaves the schema untouched by
  design — report the exception rather than retrying or hand-editing the DB.
- Any command in this plan would touch `downloaded_cases/immigration_cases.csv`
  or `downloaded_cases/cases.db`. Nothing in this plan repairs live data; if a
  test run mutates either file, stop immediately and report — a test is escaping
  its `tmp_path`.
- `make test-py` shows more than 3 failures, or the 3 failures are no longer the
  `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat ones.
- Any existing test in `tests/test_sqlite_repository.py`, `tests/test_pipeline.py`
  or `tests/test_storage.py` starts failing and you cannot make it pass without
  changing that test file — that file is out of scope and another plan may be
  editing it concurrently.
- The fix appears to require editing `immi_case_downloader/storage.py`,
  `immi_case_downloader/cli.py`, `download_missing_22.py` or
  `extract_with_llm.py`. All four are deliberately out of scope.
- You discover that `CASE_FIELDS` and the SQLite `cases` table columns have
  diverged — step 7's `INSERT INTO cases_migrated ({cols}) SELECT {cols} FROM cases`
  assumes they match exactly (31 columns, verified at `42826a3`).

## Maintenance notes

For whoever owns this code next:

- **The 136,502 already-corrupted rows are NOT repaired by this plan.** Every
  populated `visa_subclass` and `visa_subclass_number` value in
  `downloaded_cases/immigration_cases.csv` currently ends in `.0`. This plan
  stops new corruption; it does not clean the existing file. A repair is an
  operator action and must follow the project's own bulk-cleanup rule in
  `CLAUDE.md` (back up first, dry-run on `LIMIT 100`, eyeball the diff). The
  read-side workaround in `visa_registry.clean_subclass()` keeps the API correct
  in the meantime, but `storage.get_statistics()` (lines 345-346) groups on the
  raw value and will keep showing `"866.0"` buckets on the CSV backend until the
  data is repaired.
- **Two unguarded `read_csv` calls remain out of this plan's territory**:
  `download_missing_22.py:31` and `extract_with_llm.py:118`. The first also
  writes back (line 95), so it can still re-introduce the `.0` corruption. Route
  them through the same dtype guard in a follow-up.
- **`immi_case_downloader/cli.py:84`** repeats the blank-URL skip pattern in
  `cmd_search`. It only refuses to *add* a URL-less case rather than deleting an
  existing one, so it was left alone here; fix it with the same
  `url or f"__noid__{case_id}"` key.
- **The first run against the real 340 MB `downloaded_cases/cases.db` performs a
  one-time table rebuild.** It is transactional and count-checked, and it rolls
  back on any error, but back the file up (`cp downloaded_cases/cases.db{,.bak}`)
  before the first `make api` after this lands. The migration logs a
  `logger.warning` when it starts.
- **Reviewer, scrutinise this trade-off**: the new `CsvRepository.save_many` lets
  a non-empty incoming field overwrite a stored one. A re-crawl of an
  already-stored case therefore refreshes crawl-sourced fields such as `title`,
  which a user may have edited via `PUT /api/v1/cases/<id>` (`title` is in
  `ALLOWED_UPDATE_FIELDS`). This was chosen deliberately to match
  `SqliteRepository.save_many`, which already overwrites every column via
  `ON CONFLICT(case_id) DO UPDATE` — and unlike SQLite, the CSV version at least
  refuses to overwrite with empty values. If user edits must be protected, the
  right follow-up is a shared "user-owned fields" set honoured by both backends,
  not a divergence between them.
- **`workers/` is unaffected.** Production runs on D1 via
  `workers/cloudflare-native.js`; the Flask/CSV/SQLite path fixed here is
  local-dev only. Nothing in this plan changes a production code path.
- If seek pagination is ever added to `CsvRepository` (SQLite already sets
  `supports_seek_pagination = True`), revisit `save_many`'s `by_id.setdefault`
  duplicate handling — it currently tolerates pre-existing duplicate `case_id`
  rows rather than collapsing them.

## Findings reconsidered

Nothing was rejected outright, but four pieces of the audit evidence were wrong
and are corrected here:

- **"Four root-level pandas scripts" — it is five, and only three are in scope.**
  A full grep of root-level `read_csv` finds `download_fulltext.py:186`,
  `normalize_metadata.py:288`, `merge_llm_extraction.py:54`,
  `download_missing_22.py:31` and `extract_with_llm.py:118`. The last two are
  outside this plan's file territory and are listed under "Out of scope" and in
  "Maintenance notes" instead of being fixed here.
- **The `year` half of the dtype claim does not hold.** `year` round-trips as
  `int64` unless the column already contains a blank, and
  `ImmigrationCase.to_dict()` always emits an `int` (default `0`), so
  storage-written CSVs never produce `2020.0`. Verified on the live 149,016-row
  file: `year` reads as `int64`. Only `visa_subclass` and
  `visa_subclass_number` are guarded.
- **`immi_case_downloader/web/jobs.py:384` is dead code.** `_run_bulk_download_job`
  (defined at `jobs.py:327`) has no caller anywhere in the repo — a grep across
  every `*.py` outside `.venv` finds only its own `def` line. The live path is
  `jobs.py:238` inside `_run_download_job`, reached from
  `immi_case_downloader/web/routes/api_pipeline.py:197`. Both are fixed anyway,
  because the defect is in `CsvRepository.save_many` and neither call site needs
  editing.
- **Two line numbers drifted by one.** The audit cited
  `immi_case_downloader/csv_repository.py:46` (correct),
  `immi_case_downloader/pipeline.py:517` (actually 518, `if case.url not in seen_urls:`)
  and `pipeline.py:647` for the final save (actually 652 —
  `failed -= 1` really is at 647). All excerpts in "Current state" above were
  re-read at `42826a3` and are verbatim.
