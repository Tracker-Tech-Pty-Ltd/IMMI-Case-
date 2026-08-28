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
> IN_SCOPE=(immi_case_downloader/csv_repository.py immi_case_downloader/sqlite_repository.py immi_case_downloader/pipeline.py immi_case_downloader/storage.py immi_case_downloader/web/jobs.py download_fulltext.py normalize_metadata.py merge_llm_extraction.py download_missing_22.py)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $IN_SCOPE   # committed drift
> git diff --stat -- $IN_SCOPE                 # unstaged drift
> git diff --cached --stat -- $IN_SCOPE        # staged drift
> ```
> All three `git diff` invocations must print nothing. A committed diff means a
> sibling plan landed — compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.
> **An in-scope path appearing as modified, staged or untracked in
> `git status --short --branch` is also a STOP condition** — a bare
> `git diff <range>` cannot see uncommitted work, so a dirty tree would
> otherwise give you a false all-clear and this plan would edit on top of
> somebody else's changes. Never "clean up" with `git checkout --` or
> `git clean -f`; that destroys the operator's work. Report and stop.
>
> **Every edit in this plan is anchored on unique text, never on a line
> number.** Re-read the file with `Read` immediately before each edit. The
> line numbers in "Current state" are the ones observed at `42826a3`.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: nothing, but it **must run before** two other plans, and it
  shares two files with two more:
  - **Run this plan first of the 026/027/028 group.**
    `immi_case_downloader/sqlite_repository.py` is edited by all three (027
    Steps 6–7 rewrite `save_many` and the schema, 028 Step 7 rewrites
    `get_statistics`, 026 Step 4 adds one class attribute). The agreed order is
    **027 → 028 → 026**, with a single integrator owning the file and running
    its whole test set once at the end. This plan makes the deepest change to
    it, so it goes first.
  - **`immi_case_downloader/storage.py` is shared with
    `plans/028-fix-flask-analytics-fallback.md`.** Step 8d here changes exactly
    one line (`load_cases_csv`'s `dtype=`, line 137); 028 Step 7a adds a
    constant next to `CASE_FIELDS` (line ~49) and uses it at line 353. The two
    regions are disjoint. Hand both to the integrator rather than resolving a
    conflict yourself.
  - **This plan must land before `plans/032-consolidate-the-extraction-scripts.md`.**
    032 archives `merge_llm_extraction.py` (and `extract_with_llm.py`) into
    `archive/extraction/`. If 032 landed first, `merge_llm_extraction.py` no
    longer exists at the repository root: apply Step 8c to
    `archive/extraction/merge_llm_extraction.py` **or** skip it and say so in
    your report — do not recreate the file.
  - **Work in your own git worktree**
    (`git worktree add ../immi-027 -b advisor/027-fix-csv-data-integrity`).
    Plans 026–029 all create branches; run in parallel in one checkout they
    switch each other's branch out mid-edit.
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

Review added two more, both in the same territory:

5. **Nothing coordinates the four writers of the master CSV.**
   `storage.save_cases_csv` (via `CsvRepository`, the pipeline and the download
   job), `download_fulltext.py`, `extract_structured_fields.py` and
   `download_missing_22.py` each load the whole file, mutate their copy and
   write it back — and until Step 9 they all wrote through the same
   `<CSV_PATH>.tmp` name, so two of them could interleave into one temp file and
   `os.replace()` the mixture over the master.
6. **The canonical reader is only half-guarded.** `storage.load_cases_csv`
   (line 137) specifies `dtype={"visa_subclass": str}` but not
   `visa_subclass_number`, so the repository's own read-modify-write re-writes
   `866.0` even once every root script is fixed.

When this lands: the CSV round-trips **both** numeric columns as text, downloaded
full-text paths survive, blank-URL cases stop being deleted while real URLs stay
unique, batch saves are atomic, one writer holds the file at a time, the SQLite
schema migration is a single verified transaction with a restorable backup, and
the long-running bulk downloader can actually be interrupted the way its own
docstring promises.

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

Four unguarded readers live in this plan's territory (verbatim):

- `download_fulltext.py:186` — `    df = pd.read_csv(CSV_PATH)`
- `normalize_metadata.py:288` — `    df = pd.read_csv(CSV_PATH, low_memory=False)`
- `merge_llm_extraction.py:54` — `    df = pd.read_csv(CSV_PATH, low_memory=False)`
- `download_missing_22.py:31` — `    df = pd.read_csv(CSV_PATH, low_memory=False)`
  (this one also writes back at line 95)

And the "canonical guarded reader" is only half-guarded —
`immi_case_downloader/storage.py:137`, verbatim:

```python
    df = pd.read_csv(filepath, encoding="utf-8-sig", dtype={"visa_subclass": str})
```

`visa_subclass_number` is missing from that `dtype`, so pandas infers `float64`
for it, `ImmigrationCase.from_dict` turns `866.0` into the **string** `"866.0"`
via `str(v)`, and the next `save_cases_csv` writes it back. That is the
repository's own read-modify-write path — the one Step 2 is about — so guarding
only the root scripts would leave the corruption cycle intact. Step 8e fixes it.

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
| Full Python suite | `make test-py` | judged as a **delta** against the baseline you record before Step 1 (see note below) |
| Lint | `make lint` | `All checks passed!` |
| Ruff on changed files | `.venv/bin/ruff check immi_case_downloader/ download_fulltext.py normalize_metadata.py merge_llm_extraction.py download_missing_22.py` | `All checks passed!` |
| Ruff on new tests | `.venv/bin/ruff check tests/test_csv_repository.py tests/test_csv_data_integrity.py` | `All checks passed!` |

**Record the baseline before you touch anything.** Never assert an absolute
suite total — sibling plans in this batch add tests to the same suite, so a
hard-coded `1141` is wrong the moment any of them lands and it trains you to
edit the yardstick instead of the code:

```bash
make test-py 2>&1 | grep -E '[0-9]+ passed'                       # SUITE_BEFORE
make test-py 2>&1 | grep -E "FAILED|ERROR" \
  | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u                    # the failing files
```

**The 3 pre-existing failures are environmental, not yours.** They are in
`tests/test_backfill_judge_overrides_from_pdf.py`, caused by a Homebrew Python
3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf` import. They
are not caused by repo code and are **out of scope**. Your success condition is:
the passed count rises by exactly the number of tests you added, and the second
command above still prints exactly
`tests/test_backfill_judge_overrides_from_pdf.py` and nothing else — the same
three failures **by name**, not merely the same count of them.

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
  collision-proof backup + the write lock
- `normalize_metadata.py` — dtype guard on the read
- `merge_llm_extraction.py` — dtype guard on the read
- `download_missing_22.py` — dtype guard on the read (Step 8d). The only other
  root script that reads the master CSV unguarded **and writes it back**.
- `immi_case_downloader/storage.py` — **one line only**: the `dtype=` argument
  of `load_cases_csv` at line 137 (Step 8e). Nothing else in this file, and
  explicitly not `get_statistics()`.
- `immi_case_downloader/csv_write_lock.py` — **create** (Step 9b)
- `tests/test_csv_repository.py` — **create**
- `tests/test_csv_data_integrity.py` — **create**

`immi_case_downloader/web/jobs.py` is inside this plan's territory but **needs no
edit**: fixing `CsvRepository.save_many` fixes both of its call sites. Only touch
it if a verification step proves otherwise, and say so in your report.

**Out of scope** (do NOT touch, even though they look related):

- `extract_with_llm.py:118` — another unguarded `read_csv` on the same master
  file. It **never writes the CSV back** (`grep -n "to_csv" extract_with_llm.py`
  finds nothing), so it cannot re-introduce the corruption, and
  `plans/032-consolidate-the-extraction-scripts.md` archives the file. Record it
  in your report; do not edit it.
  (`download_missing_22.py` was previously listed here as "owned by a different
  plan's file territory". That was wrong — `grep -ln download_missing_22 plans/*.md`
  matches only this plan — and it *does* write the CSV back, so it is now in
  scope as Step 8d.)
- `immi_case_downloader/cli.py:84` — the same blank-URL skip pattern in
  `cmd_search`. It only *refuses to add* a second blank-URL case; it never
  deletes an existing row, so it is materially less severe, and the file is not
  in this plan's territory.
- `immi_case_downloader/storage.py` **beyond the single `dtype=` line in
  `load_cases_csv`** (Step 8e) — including `get_statistics()` at lines 345-346,
  which groups on the raw (`866.0`) `visa_subclass`. Fixing the writers and the
  canonical reader is this plan's job; fixing the statistics grouping is not,
  and `storage.py` is shared with plan 028.
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

- **Use your own worktree**, not a branch in the shared checkout:
  `git worktree add ../immi-027 -b advisor/027-fix-csv-data-integrity`, then
  work from `../immi-027`. Plans 026–029 all create branches and three of them
  edit `immi_case_downloader/sqlite_repository.py`; run in parallel in one
  checkout they switch each other's branch out mid-edit.
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
        """Upsert cases into the CSV store, keyed on ``case_id`` then ``url``.

        An incoming case that matches a stored record — by ``case_id`` first,
        by non-empty ``url`` second — updates it in place: every non-empty
        incoming field wins, empty incoming fields leave the stored value
        alone. An unseen case is appended. Returns the number of *newly added*
        cases.

        Keyed on ``case_id`` rather than ``url`` alone on purpose: blank URLs
        are an expected state (manual adds set none), and URL-keying both
        discarded every update to an existing case and duplicated blank-URL
        cases on every call. This matches ``SqliteRepository.save_many``, which
        upserts on ``ON CONFLICT(case_id)``. The ``url`` pass is kept as a
        second key because a non-empty URL is still unique in this store (the
        SQLite backend enforces it with a partial unique index) — dropping it
        would let a re-crawl whose citation changed insert a second row for a
        page that is already stored.
        """
        existing = load_all_cases(self.base_dir)
        by_id: dict[str, ImmigrationCase] = {}
        by_url: dict[str, ImmigrationCase] = {}
        for stored in existing:
            stored.ensure_id()
            by_id.setdefault(stored.case_id, stored)
            if stored.url:
                by_url.setdefault(stored.url, stored)

        added = 0
        for case in cases:
            case.ensure_id()
            stored = by_id.get(case.case_id)
            if stored is None and case.url:
                stored = by_url.get(case.url)
                if stored is not None and stored.case_id != case.case_id:
                    # The incoming case_id is new but its URL is already stored
                    # under a different id. Merging onto the URL row is the
                    # right call (one URL is one case), but the id change is
                    # worth a line in the log: it means citation/title drifted.
                    logger.warning(
                        "save_many: url %s already stored as case_id %s; "
                        "merging incoming case_id %s into it",
                        case.url, stored.case_id, case.case_id,
                    )
            if stored is None:
                existing.append(case)
                by_id[case.case_id] = case
                if case.url:
                    by_url.setdefault(case.url, case)
                added += 1
                continue
            if stored is case:
                continue
            if stored.url and case.url and stored.url != case.url:
                # Two different pages claiming one case_id is a data problem we
                # must not paper over by silently overwriting one with the
                # other. ensure_id() hashes citation-or-url-or-title, so this
                # means two different URLs produced the same citation.
                raise ValueError(
                    f"case_id {case.case_id} maps to two different urls: "
                    f"stored={stored.url!r} incoming={case.url!r}"
                )
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
- **The `by_url` pass is what preserves URL uniqueness.** Keying on `case_id`
  alone would be a *regression* against the code being replaced: today a case
  whose URL is already stored is skipped, so the store cannot hold two rows for
  one URL. `case_id` is `sha256(citation or url or title)[:12]`, so a re-crawl
  that picks up a citation the first crawl missed produces a **new** `case_id`
  for the **same** URL — id-only keying would append a duplicate row, and the
  pipeline clean phase (Step 3) would then delete one of the two arbitrarily,
  keeping whichever happened to be first rather than whichever is more
  complete. Only non-empty URLs go into `by_url`; blank URLs stay id-keyed,
  which is the whole point of this change.
- The `stored is case` guard covers the cache-aliasing path where
  `load_all_cases()` returned the very object the caller mutated.
- The `ValueError` is deliberate: one `case_id` pointing at two different URLs
  cannot be resolved correctly here, and picking one silently is how data
  disappears. It fails the whole `save_many` call before anything is written.
- `value == 0` is safe for the string fields: `"0" == 0` is `False` in Python,
  so a legitimate `"0"` string is preserved. It only skips `year == 0`, which is
  this dataclass's "unknown year" marker.

Add three tests to `tests/test_csv_data_integrity.py` for the URL half:

- `test_save_many_merges_a_new_case_id_onto_an_existing_url` — store a case
  with `url="https://x/1"` and no citation; save a second case with the **same
  URL** and a citation (so `ensure_id()` yields a different `case_id`); assert
  `len(repo.load_all()) == 1`, that the surviving row has the citation, and
  that `save_many` returned `0`.
- `test_save_many_keeps_two_cases_with_different_urls` — two different URLs
  stay two rows (the URL pass must not over-merge).
- `test_save_many_raises_when_one_case_id_has_two_urls` — construct two cases
  with the same explicit `case_id` and different non-empty URLs;
  `pytest.raises(ValueError)`; then assert the stored file is **unchanged**
  (same row count and same URL as before the call).

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_csv_data_integrity.py tests/test_csv_repository.py -q
```
→ tests 1, 2, 3, 4 and the three URL tests pass; tests 5, 6, 7 still fail
(fixed in later steps).

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

- `test_download_phase_persists_progress_on_stop` — **the stop must happen
  after at least one download has succeeded, and the assertion must read the
  CSV back.** Write two cases to a tmp dir with `save_cases_csv`, build a
  `SmartPipeline` over that dir, and patch `AustLIIScraper` so
  `download_case_detail` returns text for the first case and calls
  `pipeline.request_stop()` on its way out (a side-effect function that
  increments a counter, requests the stop after the first call, and returns
  `"case text"`). Run `_run_download_phase()`, then
  `storage.invalidate_cases_cache()` and `load_all_cases(tmp)`, and assert:
  the first case's `full_text_path` is non-empty on disk, the second case's is
  still empty, and the scraper was called exactly once.

  Do **not** write this as "request_stop() before the loop, then assert a
  mocked `_save_download_progress` was called". With the stop already set, the
  guard fires at `i == 0` and saves `targets[:0]` — an empty list — so the
  mock records a call while nothing whatsoever was persisted, and the test
  passes just as happily against the unfixed code with `return` in place of the
  save. The bug is *lost work*, so the test has to look at the work.
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

The migration in 7c has to run every DDL statement **individually**, because
`sqlite3.Connection.executescript()` issues an implicit `COMMIT` before it runs
(Python docs, and true on the 3.14.7 interpreter in `.venv`) — so a script call
inside a transaction ends that transaction and makes everything before it
unrollbackable. Therefore define the indexes, the FTS table and the triggers as
**lists of single statements**, and build the legacy script strings from them so
`initialize()` keeps working unchanged. Splitting `_TRIGGERS_SQL` on `;` is not
an option: each trigger body contains semicolons inside `BEGIN … END`, which is
exactly why these are written out as list elements.

```python
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
```

Do the same for the FTS table and the triggers: keep the existing `_FTS_SQL`
and `_TRIGGERS_SQL` strings exactly as they are for `initialize()`, and add
alongside them

```python
_FTS_STATEMENTS = [<the single CREATE VIRTUAL TABLE statement, without its trailing ";">]
_TRIGGER_STATEMENTS = [<the three CREATE TRIGGER … END statements, each without its trailing ";">]
```

built by copying the text out of the existing constants — then redefine
`_FTS_SQL` and `_TRIGGERS_SQL` from the lists (`";\n".join(...) + ";\n"`) so
there is exactly one source of truth. Verify the round-trip before going on:

```bash
.venv/bin/python -c "
import sqlite3, tempfile, os
from immi_case_downloader import sqlite_repository as sr
p = os.path.join(tempfile.mkdtemp(), 't.db')
c = sqlite3.connect(p)
c.executescript(sr._SCHEMA_SQL); c.executescript(sr._FTS_SQL); c.executescript(sr._TRIGGERS_SQL)
names = sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger')\"))
assert 'cases' in names and 'cases_fts' in names
assert {'cases_ai','cases_ad','cases_au'} <= set(names), names
assert len(sr._INDEX_STATEMENTS) == 10 and len(sr._TRIGGER_STATEMENTS) == 3
print('schema constants round-trip:', len(names), 'objects')
"
```

→ prints a count and does not raise. If a trigger body was truncated when you
split it, `cases_ai`/`cases_ad`/`cases_au` will be missing and the assert fires.

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
drop a table constraint in place, so the table must be rebuilt.

Three properties this must have, none of which are optional on a 340 MB
single-copy database:

1. **One transaction, no `executescript`.** `executescript()` commits any open
   transaction before it runs, so the earlier version of this step — which
   dropped the triggers, then called `executescript` inside the same
   `BEGIN IMMEDIATE` — committed the trigger drops immediately and could not
   roll them back afterwards. It also committed the table swap *before*
   recreating indexes, FTS and triggers, so a failure in that tail left a
   half-migrated schema. Every DDL statement below goes through
   `conn.execute()`, one statement per call, and **nothing** is committed until
   the new table, its indexes, its triggers and the FTS rebuild have all been
   verified. SQLite DDL is transactional, so this works.
2. **A file backup taken first, with a free-space gate.** The rebuild
   temporarily holds two copies of the table inside the database file.
3. **Post-commit verification** — `PRAGMA integrity_check` plus an object
   inventory — so a corrupt result is discovered here rather than three weeks
   later.

```python
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
```

`os` is already imported at `sqlite_repository.py:3`; add
`from datetime import datetime` to the import block. `shutil` is imported inside
the method on purpose — it is only needed on the one-in-a-database's-lifetime
path.

The `%f` in the timestamp is not decoration: two runs in the same second would
otherwise write the same backup filename and the second would silently
overwrite the first. Same rule as Step 9.

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

Add these tests to `tests/test_csv_data_integrity.py`. Write a
`_legacy_db(tmp_path)` helper first — `sqlite3.connect(path)` plus the old DDL
string with `url TEXT NOT NULL DEFAULT '' UNIQUE`, then `_FTS_SQL` and
`_TRIGGERS_SQL`, then two rows with real URLs and non-empty `catchwords` — and
reuse it everywhere below.

- `test_sqlite_migration_removes_legacy_url_unique` — open the legacy DB with
  `SqliteRepository(path)` and assert
  `SqliteRepository._has_legacy_url_unique(repo._conn()) is False`, both rows
  are still there, and FTS still matches a word from a row's `catchwords`.
- `test_sqlite_migration_preserves_indexes_and_triggers` — capture the
  `sqlite_master` names of type `index` (with `sql IS NOT NULL`) and `trigger`
  before opening the repo, and assert every one of them is still present
  afterwards, plus the new `idx_url_unique`.
- `test_sqlite_migration_takes_a_backup` — after the migration, exactly one
  `*.pre-url-unique-*.bak` file sits next to the database, and opening it with
  `sqlite3` shows the **legacy** schema (`_has_legacy_url_unique` is `True` on
  it) and the original row count.
- `test_sqlite_still_rejects_duplicate_real_urls` — after the migration, saving a
  second case with an already-used non-blank URL still raises
  `sqlite3.IntegrityError`.
- `test_sqlite_migration_rolls_back_on_failure` — **parametrised over the three
  phases**, because each one used to fail differently:

  ```python
  @pytest.mark.parametrize(
      "failing_fragment",
      ["INSERT INTO cases_migrated", "ALTER TABLE cases_migrated", "CREATE TRIGGER"],
  )
  def test_sqlite_migration_rolls_back_on_failure(tmp_path, monkeypatch, failing_fragment):
      """A failure at any phase must leave the legacy database untouched."""
  ```

  Implement the injection by monkeypatching
  `immi_case_downloader.sqlite_repository.SqliteRepository._conn`
  to return a small proxy object that forwards every attribute to the real
  connection but whose `execute()` raises `RuntimeError("injected")` when the
  SQL contains `failing_fragment`. Then assert: `SqliteRepository(path)` raises,
  the on-disk database still has the legacy `UNIQUE` (`_has_legacy_url_unique`
  is `True` when reopened with a plain `sqlite3.connect`), both original rows
  are present, and all three triggers still exist. The third parameter
  (`CREATE TRIGGER`) is the one that fails against the pre-review version of
  this step, because that version had already committed the table swap by then.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_sqlite_repository.py tests/test_csv_data_integrity.py -q
```
→ exit 0, all pass including tests 6 and 7. Every pre-existing test in
`tests/test_sqlite_repository.py` must still pass.

Then prove the constraint change is real at runtime rather than by grepping for
the word `UNIQUE`:

```bash
.venv/bin/python -c "
import os, tempfile
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository
p = os.path.join(tempfile.mkdtemp(), 't.db')
r = SqliteRepository(p)
a = ImmigrationCase(citation='[2024] AATA 1', title='A'); a.ensure_id()
b = ImmigrationCase(citation='[2024] AATA 2', title='B'); b.ensure_id()
r.save_many([a, b])                      # two blank-url cases
assert len(r.load_all()) == 2, 'blank urls still collide'
c = ImmigrationCase(citation='[2024] AATA 3', title='C', url='https://x/1'); c.ensure_id()
d = ImmigrationCase(citation='[2024] AATA 4', title='D', url='https://x/1'); d.ensure_id()
r.save_many([c])
try:
    r.save_many([d]); raise SystemExit('FAIL: duplicate real url accepted')
except Exception as exc:
    assert 'UNIQUE' in str(exc), exc
print('blank urls allowed, real urls still unique')
"
```

→ prints `blank urls allowed, real urls still unique`. Both halves can fail, and
they fail for different reasons — which a `grep -n "UNIQUE," ` cannot.

### Step 8: Guard every reader of the master CSV

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
occurrence of that line. (If `plans/032-consolidate-the-extraction-scripts.md`
landed first this file lives at `archive/extraction/merge_llm_extraction.py` —
see "Depends on".)

**8d.** `download_missing_22.py:31` — the same replacement on
`    df = pd.read_csv(CSV_PATH, low_memory=False)`. **This file is in scope and
this sub-step is not optional.** It is the only remaining root-level script that
both reads the master CSV unguarded *and writes it back* (`to_csv` at line 95),
so leaving it out would mean this plan stops the corruption in three places and
leaves the fourth free to re-introduce it on the next run — verified by
`grep -n "to_csv" download_missing_22.py extract_with_llm.py`, which reports the
one write in `download_missing_22.py` and none in `extract_with_llm.py`.

**8e.** `immi_case_downloader/storage.py:137` — the canonical reader. Replace

```python
    df = pd.read_csv(filepath, encoding="utf-8-sig", dtype={"visa_subclass": str})
```

with

```python
    df = pd.read_csv(
        filepath,
        encoding="utf-8-sig",
        dtype={"visa_subclass": str, "visa_subclass_number": str},
    )
```

Without this the plan does not actually close the round trip. `load_cases_csv`
feeds `ImmigrationCase.from_dict`, which does `str(v)`; a `visa_subclass_number`
column that pandas inferred as `float64` therefore arrives as the **string**
`"866.0"`, and the very next `save_cases_csv` writes that back. So the ordinary
`CsvRepository.load_all()` → `save_many()` path — the one this plan's Step 2 is
about — re-introduces the corruption in the column the root scripts are being
fixed for. This is one line, in the region 028 does not touch (it edits line
~49 and line 353); flag it to the integrator.

`immi_case_downloader/storage.py` is otherwise still out of scope — in
particular `get_statistics()` at lines 345-346 stays as it is.

Do **not** touch any `to_csv` call's encoding in this step (see the BOM note in
"Current state").

Add two tests to `tests/test_csv_data_integrity.py`:

- `test_root_scripts_guard_visa_subclass_dtype` — a source-level guard so the
  next unguarded reader is caught by CI. **Use `ast`, not string slicing**: a
  300-character window after `pd.read_csv(` matches a comment, a docstring, or
  the *next* call's `dtype=`, so it can pass while the call it is meant to check
  is unguarded. Parse each of `download_fulltext.py`, `normalize_metadata.py`,
  `merge_llm_extraction.py`, `download_missing_22.py` and
  `immi_case_downloader/storage.py` with `ast.parse(path.read_text())`, walk for
  `ast.Call` nodes whose func renders as `pd.read_csv` or `read_csv`, and assert
  each one has a `dtype` keyword whose value is an `ast.Dict` containing both
  the string keys `"visa_subclass"` and `"visa_subclass_number"`. Report the
  offending `file:lineno` in the assertion message. Resolve paths relative to
  the repo root via `pathlib.Path(__file__).resolve().parents[1]`, and skip a
  path that does not exist (so plan 032 archiving a script does not break this
  test) — but assert at least four of the five were actually checked, or the
  test could pass by checking nothing.
- `test_csv_round_trip_preserves_both_visa_columns` — the end-to-end claim, at
  the repository level rather than the pandas level. Write a raw CSV by hand
  into `tmp_path` containing a `visa_subclass` and a `visa_subclass_number`
  column with **one populated and one blank row each** (the blank is what makes
  pandas infer `float64`), plus the other `CASE_FIELDS` columns as empty
  strings. Then `repo = CsvRepository(str(tmp_path))`, `repo.load_all()`, and
  assert the loaded case has `visa_subclass == "866"` and
  `visa_subclass_number == "866"` — not `"866.0"`. Then call
  `repo.save_many([])`: an empty batch still reloads and rewrites the whole
  file, which is precisely the read-modify-write round trip under test. Finally
  read the file's raw text back and assert `"866.0"` does not appear anywhere in
  it. This is the test that catches 8e being skipped.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q
```
→ exit 0.

Then prove the round-trip is clean for **both** columns — the earlier version of
this probe never created a `visa_subclass_number` column at all, so it could not
have detected the bug 8e fixes:
```bash
.venv/bin/python -c "
import pandas as pd, io, tempfile, os
p = tempfile.mktemp(suffix='.csv')
open(p,'w').write('case_id,visa_subclass,visa_subclass_number,year\na,866,866,2020\nb,,,2021\n')
raw = pd.read_csv(p)
assert str(raw['visa_subclass_number'].dtype) == 'float64', 'probe is not reproducing the bug'
df = pd.read_csv(p, encoding='utf-8-sig', dtype={'visa_subclass': str, 'visa_subclass_number': str}, low_memory=False)
out = io.StringIO(); df.to_csv(out, index=False)
assert '866.0' not in out.getvalue(), out.getvalue()
print('OK: both visa columns round-trip as 866')
os.unlink(p)
"
```
→ prints `OK: both visa columns round-trip as 866`. The first assert is there so
the probe fails loudly if a future pandas stops inferring `float64` and the
probe silently stops testing anything.

### Step 9: Make `download_fulltext.py` write atomically with a run backup

Edit `download_fulltext.py`.

Add `import shutil` to the existing import block (`os`, `sys`, `time`, `pandas`,
`datetime` are already imported at lines 9-13; `os` is at line 10).

Add this helper immediately after the `log()` function (which ends at line 33):

```python
_backup_taken = False


def _new_backup_path() -> str:
    """A backup path nothing else can be holding.

    A plain seconds-resolution stamp is not enough: two runs started in the
    same second write the same name and the second silently destroys the
    first's copy of a 149k-row corpus that exists only on this machine. Create
    the file exclusively (O_EXCL) and bump a suffix on collision, so the name
    is proven free rather than assumed free.
    """
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    for attempt in range(100):
        candidate = f"{CSV_PATH}.bak-{stamp}" + (f".{attempt}" if attempt else "")
        try:
            fd = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        os.close(fd)
        return candidate
    raise RuntimeError(f"could not find a free backup name for {CSV_PATH}")


def _write_csv_atomic(df):
    """Write *df* over the master CSV atomically, after a one-time run backup.

    The module docstring promises this script is safe to interrupt, but the
    three writes it performs used to land straight on the 149k-row master file.
    Matches the tmp-then-os.replace pattern in
    immi_case_downloader/storage.save_cases_csv.
    """
    global _backup_taken
    if not _backup_taken and os.path.exists(CSV_PATH):
        backup = _new_backup_path()
        shutil.copy2(CSV_PATH, backup)
        log(f"  Backup: {backup}")
        _backup_taken = True
    # Per-process temp name: storage.save_cases_csv writes
    # "<CSV_PATH>.tmp" too, and two writers sharing one temp path interleave
    # into the same file and then os.replace() the mixture over the master.
    tmp = f"{CSV_PATH}.tmp.{os.getpid()}"
    with csv_write_lock(CSV_PATH):
        df.to_csv(tmp, index=False)
        os.replace(tmp, CSV_PATH)
```

`csv_write_lock` comes from the new module in Step 9b; import it at the top of
`download_fulltext.py` as
`from immi_case_downloader.csv_write_lock import csv_write_lock`.

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

Note what that last check is and is not: `ast.parse` proves the file is
syntactically valid Python, **not** that it runs. Import it instead, which
executes the module body:

```bash
.venv/bin/python -c "import download_fulltext; print('OK: imports')"
```
→ prints `OK: imports`. (`download_fulltext.py` guards its work behind
`if __name__ == "__main__"`, so importing it is safe and touches no data. If
that stops being true, stop — a module that scrapes on import is a separate
bug.)

Finally, prove the backup name is collision-proof:

```bash
.venv/bin/python -c "
import os, tempfile, download_fulltext as d
tmp = tempfile.mkdtemp()
d.CSV_PATH = os.path.join(tmp, 'immigration_cases.csv')
open(d.CSV_PATH, 'w').write('case_id\na\n')
a, b = d._new_backup_path(), d._new_backup_path()
assert a != b, (a, b)
print('backup names are unique within one second')
"
```
→ prints `backup names are unique within one second`.

### Step 9b: One writer at a time

Four independent writers rewrite the same 149k-row master CSV with a
read-modify-write: `storage.save_cases_csv` (used by `CsvRepository.save_many`,
the pipeline clean phase and `_save_download_progress`), `download_fulltext.py`,
`extract_structured_fields.py`, and `download_missing_22.py`. Nothing
coordinates them. Two overlapping runs each load the file, mutate their own
copy, and write it back — last writer wins and the other's work is gone. The
pipeline's `_active_pipeline` lock (Step 5) only stops a second *pipeline*; it
does nothing about an API mutation, a background job, or a script run from
another terminal. And until Step 9 they all wrote through the same
`<CSV_PATH>.tmp` name, so two writers could interleave bytes into one temp file
and then `os.replace()` the mixture over the master.

Create `immi_case_downloader/csv_write_lock.py` (new file, no other plan owns
it):

```python
"""Cross-process advisory lock for the master CSV read-modify-write.

Every writer of downloaded_cases/immigration_cases.csv loads the whole file,
mutates rows, and writes it back. Two overlapping writers therefore silently
discard each other's work. This is the one lock they all take.

Advisory, not mandatory: a writer that does not take it is not blocked. Adding
a new writer means adding the lock to it — see the module list in
plans/027-fix-csv-data-integrity.md Step 9b.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import os
import time
from collections.abc import Iterator

LOCK_TIMEOUT_SECONDS = 120.0


@contextlib.contextmanager
def csv_write_lock(csv_path: str, timeout: float = LOCK_TIMEOUT_SECONDS) -> Iterator[None]:
    """Hold an exclusive advisory lock on ``<csv_path>.lock`` for the block.

    Raises TimeoutError rather than blocking forever, so a stale holder shows
    up as a loud failure instead of a hung job.
    """
    lock_path = f"{csv_path}.lock"
    os.makedirs(os.path.dirname(os.path.abspath(lock_path)), exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"another process has held {lock_path} for over "
                        f"{timeout:.0f}s"
                    ) from exc
                time.sleep(0.05)
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
```

`fcntl` is POSIX-only. That is acceptable here: this repository's local-dev
path is macOS/Linux (`Makefile`, the `.venv` layout, and the CI runner are all
POSIX), and production is the Cloudflare Worker, which never runs this code. Do
**not** add a Windows branch you cannot test.

Take the lock at the two read-modify-write sites that are in this plan's
territory:

- `CsvRepository.save_many` (Step 2) — wrap the whole body from
  `existing = load_all_cases(...)` through the two save calls in
  `with csv_write_lock(os.path.join(self.base_dir, CASES_CSV)):`. Import
  `CASES_CSV` from `.storage` alongside `CASE_FIELDS`, and `os` at the top of
  the module.
- `SmartPipeline._run_clean_phase` (Step 3) and
  `SmartPipeline._save_download_progress` — same wrapper around the
  load…`save_cases_csv` pair in each.

`storage.save_cases_csv` itself is **not** wrapped: it is called from inside
the blocks above (taking the lock twice from one thread would deadlock —
`flock` on a second fd from the same process does not recurse), and `storage.py`
is shared with plan 028. Record for the integrator: the remaining unlocked
writers after this plan are `extract_structured_fields.save_csv` (plan 029's
territory), `download_missing_22.py`, and `storage.add_case_manual` /
`update_case` / `delete_case` (reached from `CsvRepository.add/update/delete`,
each of which does its own load-modify-save inside `storage.py`). All should
adopt `csv_write_lock` in a follow-up; until they do, this closes the
collisions between `save_many`, the pipeline and the bulk downloader, which are
the three that most often run concurrently on one machine today. Do not
"fix" the storage.py ones by wrapping `save_cases_csv` itself — that would
deadlock against the blocks above.

Add two tests to `tests/test_csv_data_integrity.py`:

- `test_csv_write_lock_is_exclusive` — open the lock in a background thread that
  holds it behind a `threading.Event`, then assert `csv_write_lock(path,
  timeout=0.2)` raises `TimeoutError` from the main thread; release the event
  and assert it then acquires. (`flock` is per open file description, so two
  `open()` calls in one process do contend — this is a real test, not a
  no-op.)
- `test_concurrent_save_many_does_not_lose_rows` — two threads, each calling
  `repo.save_many([...])` with 50 distinct cases of its own, started together.
  Afterwards assert `len(repo.load_all()) == 100`. Call
  `storage.invalidate_cases_cache()` before the final read. Without the lock
  this test fails intermittently, so give it a loop of 5 rounds to make the
  failure reliable rather than lucky.

**Verify**:
```bash
.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q
.venv/bin/ruff check immi_case_downloader/csv_write_lock.py
```
→ exit 0, then `All checks passed!`.

### Step 10: Full verification

```bash
make lint
.venv/bin/ruff check tests/test_csv_repository.py tests/test_csv_data_integrity.py \
  immi_case_downloader/csv_write_lock.py
make test-py 2>&1 | grep -E '[0-9]+ passed'
make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u
```

**Verify**: `make lint` prints `All checks passed!`; the ruff call prints
`All checks passed!`; the passed count equals `SUITE_BEFORE + <number of tests
you added>`; and the last command prints exactly
`tests/test_backfill_judge_overrides_from_pdf.py` — the same three environmental
`pyexpat` ImportErrors, by name, that you recorded before Step 1.

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
| `test_save_many_merges_a_new_case_id_onto_an_existing_url` | URL uniqueness survives the switch to `case_id` keying |
| `test_save_many_keeps_two_cases_with_different_urls` | the URL pass does not over-merge |
| `test_save_many_raises_when_one_case_id_has_two_urls` | an unresolvable id/url conflict fails loudly and writes nothing |
| `test_csv_write_lock_is_exclusive` | the new advisory lock actually excludes |
| `test_concurrent_save_many_does_not_lose_rows` | two concurrent writers keep all 100 rows |
| `test_sqlite_migration_preserves_indexes_and_triggers` | the rebuild does not silently drop schema objects |
| `test_sqlite_migration_takes_a_backup` | a restorable pre-migration copy exists |
| `test_sqlite_migration_rolls_back_on_failure` (3 params) | a failure at insert / rename / trigger-create phase leaves the legacy DB untouched |
| `test_csv_round_trip_preserves_both_visa_columns` | `load_all()` → `save_many()` no longer writes `866.0` |
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
- [ ] `.venv/bin/ruff check tests/test_csv_repository.py tests/test_csv_data_integrity.py immi_case_downloader/csv_write_lock.py` prints `All checks passed!`
- [ ] `make test-py 2>&1 | grep -E "FAILED|ERROR" | sed -E 's/.*(tests\/[^:]+).*/\1/' | sort -u` prints exactly `tests/test_backfill_judge_overrides_from_pdf.py` — the same three environmental `pyexpat` ImportErrors, by name, as the pre-plan baseline
- [ ] `make test-py` passed count equals `SUITE_BEFORE + <number of tests added>`
- [ ] `.venv/bin/python -m pytest tests/test_csv_data_integrity.py tests/test_csv_repository.py -q` exits 0
- [ ] `grep -n "to_csv(CSV_PATH" download_fulltext.py` returns no matches
- [ ] `grep -n 'drop_duplicates(subset="url"' download_fulltext.py` returns no matches
- [ ] `.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q -k "guard_visa_subclass_dtype or round_trip_preserves_both_visa_columns"` → `2 passed`. (This replaces a `grep -c` for the literal `dtype={...}` string: the grep counts occurrences, which cannot tell you whether the argument landed on the `read_csv` call that matters. The AST-based test can.)
- [ ] The Step 7 runtime probe prints `blank urls allowed, real urls still unique` — a behavioural check, not `grep -n "UNIQUE,"`, which a comment could satisfy
- [ ] `.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q -k "migration"` → all pass, including the three parametrised `rolls_back_on_failure` cases
- [ ] `grep -n "idx_url_unique" immi_case_downloader/sqlite_repository.py` returns a match
- [ ] `grep -n "existing_urls" immi_case_downloader/csv_repository.py` returns matches only inside `get_existing_urls`, not inside `save_many` (`by_url` inside `save_many` is the new, different thing and is expected)
- [ ] The Step 9 probe prints `backup names are unique within one second`
- [ ] `.venv/bin/python -m pytest tests/test_csv_data_integrity.py -q -k "write_lock or concurrent_save_many"` → `2 passed`
- [ ] `git status --short` shows changes only to the in-scope files (and nothing under `downloaded_cases/`)
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
- `make test-py`'s failing-file list gains any name beyond
  `tests/test_backfill_judge_overrides_from_pdf.py`, or those three pyexpat
  ImportErrors are no longer the ones failing.
- The drift check shows an in-scope file as modified, staged or untracked in
  `git status --short --branch`. That is uncommitted work a range diff cannot
  see; this plan would edit on top of it. Do **not** `git checkout --` or
  `git clean` it — report and stop.
- Step 7's migration cannot take its backup (no free space, unwritable
  directory). It raises by design rather than migrating without a restore path.
  Report the free-space number; do not lower the threshold to get past it.
- You are tempted to run the "Operator runbook" section as part of executing
  this plan. It is not a step. Nothing in this plan touches
  `downloaded_cases/`.
- Any existing test in `tests/test_sqlite_repository.py`, `tests/test_pipeline.py`
  or `tests/test_storage.py` starts failing and you cannot make it pass without
  changing that test file — that file is out of scope and another plan may be
  editing it concurrently.
- The fix appears to require editing `immi_case_downloader/cli.py` or
  `extract_with_llm.py`, or any part of `immi_case_downloader/storage.py`
  other than the single `dtype=` argument on line 137. Those are deliberately
  out of scope.
- You discover that `CASE_FIELDS` and the SQLite `cases` table columns have
  diverged — step 7's `INSERT INTO cases_migrated ({cols}) SELECT {cols} FROM cases`
  assumes they match exactly (31 columns, verified at `42826a3`).

## Maintenance notes

For whoever owns this code next:

- **The 136,502 already-corrupted rows are NOT repaired by this plan** — see the
  operator runbook below, which is the sanctioned way to do it. This plan stops
  new corruption; it does not clean the existing file. The read-side workaround
  in `visa_registry.clean_subclass()` keeps the API correct in the meantime, but
  `storage.get_statistics()` (lines 345-346) groups on the raw value and will
  keep showing `"866.0"` buckets on the CSV backend until the data is repaired.
- **One unguarded `read_csv` remains out of this plan's territory**:
  `extract_with_llm.py:118`. It never writes the CSV back, so it cannot
  re-introduce the `.0` corruption, and plan 032 archives the file.
  `download_missing_22.py` — which *does* write back — is fixed here (Step 8d).
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

## Operator runbook — repairing the 136,502 `.0` values

**This is not a step of this plan. Do not run it as part of executing the
plan.** It is written here so the operator has a checked procedure instead of
improvising one, and so nobody mistakes "the writers are fixed" for "the data is
fixed". It repairs `downloaded_cases/immigration_cases.csv`, which is
gitignored, 149,016 rows, and exists only on this machine.

Run it **after** this plan has landed — repairing before the writers are fixed
just re-corrupts on the next write.

1. **Checksummed backup, verified.**
   ```bash
   cd "/Users/d/Developer/Active Projects/IMMI-Case-/downloaded_cases"
   STAMP=$(date +%Y%m%d_%H%M%S)
   cp -p immigration_cases.csv "immigration_cases.csv.pre-visa-repair-$STAMP"
   shasum -a 256 immigration_cases.csv "immigration_cases.csv.pre-visa-repair-$STAMP"
   ```
   The two digests must match. If they do not, stop — the file changed while you
   were copying it, which means a writer is running.

2. **Confirm nothing is writing.** `make api`, any pipeline run,
   `download_fulltext.py` and `extract_structured_fields.py` must all be
   stopped. `lsof immigration_cases.csv` should print nothing.

3. **Dry run, and eyeball it.** Count the affected cells and print 20 real
   before/after pairs — do not skip the eyeballing, this is the step the
   `docs/JUDGE_DATA_QUALITY.md` post-mortem exists to teach:
   ```bash
   cd "/Users/d/Developer/Active Projects/IMMI-Case-"
   .venv/bin/python - <<'PY'
   import pandas as pd
   p = "downloaded_cases/immigration_cases.csv"
   df = pd.read_csv(p, encoding="utf-8-sig", dtype=str, keep_default_na=False)
   for col in ("visa_subclass", "visa_subclass_number"):
       hits = df[col].str.match(r"^\d+\.0$", na=False)
       print(col, "cells ending .0:", int(hits.sum()), "of", int((df[col] != "").sum()), "populated")
       print(df.loc[hits, ["case_id", col]].head(20).to_string())
       odd = df[col][df[col].str.contains(r"\.", na=False) & ~hits]
       print(col, "dotted values that are NOT <digits>.0 — these must NOT be touched:",
             sorted(set(odd))[:20])
   PY
   ```
   The `.0`-count must match what you expect (136,502 at the time of writing for
   each column) and the "dotted values that are NOT `<digits>.0`" list must be
   empty or must contain only values you have decided to leave alone. The regex
   is anchored on purpose: `^\d+\.0$` and nothing else.

4. **Repair, atomically, into a new file.** `dtype=str` +
   `keep_default_na=False` is what stops pandas re-inferring floats and turning
   empty cells into the string `nan`:
   ```bash
   .venv/bin/python - <<'PY'
   import os, pandas as pd
   p = "downloaded_cases/immigration_cases.csv"
   df = pd.read_csv(p, encoding="utf-8-sig", dtype=str, keep_default_na=False)
   rows_before, cols_before = df.shape
   for col in ("visa_subclass", "visa_subclass_number"):
       df[col] = df[col].str.replace(r"^(\d+)\.0$", r"\1", regex=True)
   assert df.shape == (rows_before, cols_before), df.shape
   tmp = p + ".repair.tmp"
   df.to_csv(tmp, index=False)
   os.replace(tmp, p)
   print("repaired", rows_before, "rows x", cols_before, "columns")
   PY
   ```

5. **Re-verify.** Row and column counts unchanged against the backup; no `.0`
   values left; statistics recomputed:
   ```bash
   wc -l downloaded_cases/immigration_cases.csv downloaded_cases/immigration_cases.csv.pre-visa-repair-*
   .venv/bin/python -c "
   import pandas as pd
   a = pd.read_csv('downloaded_cases/immigration_cases.csv', dtype=str, keep_default_na=False)
   print('shape', a.shape)
   print('remaining .0 cells:', int(a['visa_subclass'].str.match(r'^\d+\\.0$').sum()),
         int(a['visa_subclass_number'].str.match(r'^\d+\\.0$').sum()))
   print(a['visa_subclass'].value_counts().head(10))
   "
   ```
   The two `wc -l` numbers must be identical, both remaining-`.0` counts must be
   `0`, and the top subclass buckets must read `866`, not `866.0`.

6. **Restore command, if anything looks wrong.** One command, no cleverness:
   ```bash
   cp -p "downloaded_cases/immigration_cases.csv.pre-visa-repair-$STAMP" \
         downloaded_cases/immigration_cases.csv
   ```

7. **The SQLite copy is a separate corpus.** `downloaded_cases/cases.db` has its
   own `visa_subclass` values. Repair it with the equivalent
   `UPDATE cases SET visa_subclass = ... WHERE visa_subclass GLOB '*.0'` only
   after taking `cp downloaded_cases/cases.db{,.bak}`, and re-run
   `PRAGMA integrity_check` afterwards.

## Findings reconsidered

Nothing was rejected outright, but four pieces of the audit evidence were wrong
and are corrected here:

- **"Four root-level pandas scripts" — it is five, plus the canonical reader.**
  A full grep of root-level `read_csv` finds `download_fulltext.py:186`,
  `normalize_metadata.py:288`, `merge_llm_extraction.py:54`,
  `download_missing_22.py:31` and `extract_with_llm.py:118`. Four of those five
  are fixed here (Steps 8a–8d). `extract_with_llm.py` is left alone because it
  never writes the CSV back and plan 032 archives it. A sixth reader matters
  more than any of them and was missed by the original audit *and* by the first
  draft of this plan: `immi_case_downloader/storage.py:137`, the canonical
  `load_cases_csv`, which specifies `dtype={"visa_subclass": str}` but **not**
  `visa_subclass_number` — so the ordinary `CsvRepository.load_all()` →
  `save_many()` path re-writes `866.0` even after every root script is guarded.
  Step 8e fixes it. An earlier draft of this plan listed
  `download_missing_22.py` as "owned by a different plan's file territory";
  `grep -ln download_missing_22 plans/*.md` matches only this plan, so that was
  simply wrong.
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

## Review points not applied

One sub-claim from the cross-plan review was checked against the live code and
does not hold as stated. Everything else it raised has been applied above.

- **"027 Step 8 must modify `storage.py`, which *conflicts with* plan 028
  Step 7; hand that file to a single integrator rather than letting either agent
  patch it."** The first half is right and is now Step 8e — without it the
  repository's own `load_all()` → `save_many()` round trip keeps writing
  `866.0`, so the plan would not actually close the corruption cycle. The
  "conflicts with 028 Step 7" half is not: the two edits are in disjoint regions
  of the file. This plan changes the `dtype=` argument of `load_cases_csv` at
  `immi_case_downloader/storage.py:137`; plan 028 Step 7a adds
  `TOP_VISA_SUBCLASS_LIMIT` immediately after the `CASE_FIELDS` list (which ends
  at line 49) and rewrites the `sorted_subclasses` sort key at line 353. Neither
  hunk touches the other's lines, and `get_statistics()` (lines 326–365) remains
  out of scope here. Deferring the one-line reader fix to an integrator would
  mean shipping a data-integrity plan that leaves the canonical reader
  corrupting the column it is about. The edit stays here; the Depends-on section
  flags the shared file to the integrator, which is the part of the
  recommendation that is genuinely needed.
