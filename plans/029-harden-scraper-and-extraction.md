# Plan 029: Checkpointing, honest failure reporting and safe result truncation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists; if it does not exist, do **not** create
> it (a reviewer maintains the index).
>
> **Drift check (run first)**:
> ```
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- immi_case_downloader/sources/austlii.py immi_case_downloader/sources/metadata_extractor.py immi_case_downloader/models.py immi_case_downloader/web/auth.py immi_case_downloader/extraction/llm.py immi_case_downloader/pipeline.py extract_structured_fields.py validate_extraction.py tests/test_austlii.py
> ```
> Expected at the time of writing: **no output** (nothing changed since
> `42826a3`). If any of those files changed, compare the "Current state"
> excerpts below against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none. Every command in this plan is verified against commit
  `42826a3` and its expected output is stated below. This plan touches no
  TypeScript, no frontend and no Worker code, so the frontend compile-gate and
  CI plans are irrelevant to it. It also edits no file that the test-lint plan
  edits — see "Scope" for how the two stay apart.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Three separate Python paths in this repository currently **lie about failure**,
and one of them can destroy a day's work.

1. `AustLIIScraper._browse_year` returns `[]` both when a year genuinely has no
   immigration cases and when AustLII refused to serve the listing at all. The
   pipeline's whole strategy-rotation mechanism (`crawl_strategies`,
   `auto_rotate`, `max_consecutive_failures`) is gated on telling those two
   apart, so when AustLII rate-limits the crawler — a documented, routine event
   for this project — the run reports "0 found, 0 new" as a clean green result
   and never rotates to the fallback strategy that exists precisely for that
   case.
2. `AustLIIScraper._search_database` browses years **ascending** and then applies
   `cases[:max_results]` at the very end. With the CLI's default of 500 per
   database, `python run.py search --databases AATA --start-year 2020` silently
   returns the 500 **oldest** matches in the range and prints that as a complete
   result. For a case-law tool whose users care most about recent decisions,
   that is the worst possible half of the data to keep.
3. `extract_structured_fields.py` runs a ~12-minute, 149,000-row parallel
   extraction with **no checkpoint of any kind** — the only `save_csv()` happens
   after the entire loop finishes — and `ProcessPoolExecutor.map` re-raises a
   worker exception and cancels every remaining future, so one unparseable row
   at minute eleven throws the whole run away. Worse, the backup filename is the
   fixed `.csv.bak_extract`, so the rerun's `shutil.copy2` overwrites the last
   known-good copy of a corpus that lives only on this machine
   (`downloaded_cases/` is gitignored).

Alongside those, this plan closes four cheap latent traps in the same territory:
a non-UTF-8 gateway response that escapes the LLM client's exception handler; an
`IndexError` when `validate_extraction.py --court NOSUCH` matches nothing; an
unfiltered `setattr` loop that would make a future scraper field vanish
silently; and a dead Flask auth module whose decorators no route uses and whose
membership check no repository implements — a trap for the next developer who
believes it enforces tenancy.

After this plan: a failed listing fetch is loud and triggers rotation, a
truncated search keeps the newest cases and says so, an extraction run
checkpoints every 5,000 rows and keeps timestamped backups, and the dead auth
surface is gone.

## Current state

### Files in play

- `immi_case_downloader/sources/austlii.py` — the AustLII scraper. Owns
  `search_cases`, `_search_database` (truncation), `_browse_year` (the
  ambiguous `[]`), `_keyword_search`, and `_extract_metadata` (the unfiltered
  `setattr`).
- `immi_case_downloader/pipeline.py` — `SmartPipeline`. **Read-only for this
  plan**; it is the consumer whose `cases is not None` check the step 1 change
  makes meaningful.
- `immi_case_downloader/sources/metadata_extractor.py` — `MetadataExtractor`.
  **Read-only for this plan**; its output key set is what step 3 filters
  against.
- `immi_case_downloader/models.py` — the `ImmigrationCase` dataclass,
  `ensure_id()` and `from_dict()`.
- `immi_case_downloader/extraction/llm.py` — small AI Gateway client used by the
  local-dev extraction endpoint.
- `immi_case_downloader/web/auth.py` — Flask JWT helpers. Local-dev only.
- `extract_structured_fields.py` — root-level bulk field extractor (149k rows,
  `ProcessPoolExecutor`).
- `validate_extraction.py` — root-level fill-rate / garbage-value reporter.

### PYCORR-17 — a failed fetch is indistinguishable from an empty year

`immi_case_downloader/sources/austlii.py:131-139`, verbatim:

```python
        # Try the year listing page directly
        url = f"{AUSTLII_BASE}/au/cases/cth/{db_code}/{year}/"
        response = self.fetch(url)
        if not response:
            # Fallback to viewdb
            url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/{db_code}/"
            response = self.fetch(url, params={"year": str(year)})
            if not response:
                return []
```

Line 139 returns `[]` after **both** fetches failed. A year with a valid listing
and no immigration matches returns `[]` from line 184 of the same method. The
two are identical to every caller.

`immi_case_downloader/pipeline.py:429-432`, verbatim:

```python
    def _execute_strategy(self, scraper, strategy, db_code, db_info, year):
        """Execute a specific crawl strategy. Returns list of cases or None on failure."""
        if strategy == "direct":
            return scraper._browse_year(db_code, db_info, year, IMMIGRATION_KEYWORDS)
```

(The original report cited `pipeline.py:431`; the `def` is on **429** and the
`direct` return on **432** — corrected here from a direct read.)

`immi_case_downloader/pipeline.py:394-427`, the consumer, verbatim:

```python
        for attempt in range(len(strategies)):
            idx = (start_idx + attempt) % len(strategies)
            strategy = strategies[idx]

            try:
                cases = self._execute_strategy(scraper, strategy, db_code, db_info, year)
                if cases is not None:
                    # Success — reset failure counter
                    self._consecutive_failures[db_code] = 0
                    with self._lock:
                        self._status["current_strategy"] = strategy
                    return cases if cases else []
            except Exception as e:
                self.log.add(
                    "crawl", "warn", "strategy_error",
                    f"{strategy} failed for {db_code}/{year}: {e}",
                    strategy=strategy, db_code=db_code, year=year, error=str(e),
                )

            # Strategy failed — increment and maybe rotate
            self._consecutive_failures[db_code] = self._consecutive_failures.get(db_code, 0) + 1

            if (self.config.auto_rotate
                    and self._consecutive_failures[db_code] >= self.config.max_consecutive_failures):
                new_idx = (idx + 1) % len(strategies)
                self._strategy_state[db_code] = new_idx
                self._consecutive_failures[db_code] = 0
                self.log.add(
                    "crawl", "warn", "strategy_switch",
                    f"Switching {db_code} from '{strategy}' to '{strategies[new_idx]}' after {self.config.max_consecutive_failures} failures",
                    db_code=db_code, old_strategy=strategy, new_strategy=strategies[new_idx],
                )

        return []
```

Line 400 (`if cases is not None`) never sees `None` from the `direct` strategy,
so line 405 returns and the rotation block at 413–425 is unreachable.

**This is why step 1 makes `_browse_year` raise rather than return `None`.** The
`except Exception` at line 406 already catches, logs a useful message, and falls
through to the rotation block — so `immi_case_downloader/pipeline.py` needs **no
edit at all**, which keeps this plan inside its file territory. The scraper's
`BaseScraper.fetch` already records a structured reason for the message
(`immi_case_downloader/sources/base.py:47-74`, `self.last_error` is set to e.g.
`{"category": "http_500", "url": ..., "status": 500}` before returning `None`).

The other three callers of `_browse_year` all already wrap the call in
`try/except Exception` and log, so a raise degrades them from a silent zero to a
readable error rather than crashing them:

- `download_fulltext.py:57-69` — `except Exception as e: log(f"  {db_code} {year}: ERROR - {e}")`
- `immi_case_downloader/web/jobs.py:296-309` — `except Exception as e: _append_error(f"{db_code} {year}: {e}")`
- `immi_case_downloader/sources/austlii.py:96` — **not** wrapped; step 1 fixes that.

### PYCORR-15 — truncation drops the newest cases

`immi_case_downloader/sources/austlii.py:78-112`, verbatim:

```python
    def _search_database(
        self,
        db_code: str,
        db_info: dict,
        keywords: list[str],
        start_year: int,
        end_year: int,
        max_results: int,
    ) -> list[ImmigrationCase]:
        """Search a specific AustLII database for immigration cases.

        Browses every year without per-year caps. The max_results limit
        is only applied at the very end as a total cap.
        """
        cases = []

        # Browse every year — no early exit so all years get coverage
        for year in range(start_year, end_year + 1):
            year_cases = self._browse_year(db_code, db_info, year, keywords)
            cases.extend(year_cases)
            logger.debug(f"  {db_code}/{year}: {len(year_cases)} cases found")

        # Strategy 2: If browsing found few results, try keyword search
        if len(cases) < 10:
            search_cases = self._keyword_search(
                db_code, db_info, keywords, start_year, end_year
            )
            # Deduplicate by URL
            existing_urls = {c.url for c in cases}
            for case in search_cases:
                if case.url not in existing_urls:
                    cases.append(case)
                    existing_urls.add(case.url)

        return cases[:max_results]
```

Line 95 iterates ascending; line 112 truncates. The default cap is
`max_results_per_db: int = 500` at `immi_case_downloader/sources/austlii.py:42`.

The **live** caller is the CLI, not the web app.
`immi_case_downloader/cli.py:49-53`, verbatim:

```python
        cases = austlii.search_cases(
            databases=databases,
            start_year=args.start_year,
            end_year=args.end_year,
            max_results_per_db=args.max_results,
        )
```

with the argparse default at `immi_case_downloader/cli.py:273-277`, verbatim:

```python
    search_parser.add_argument(
        "--max-results",
        type=int,
        default=500,
        help="Max results per database (default: 500)",
    )
```

Correction to the original report: it named the web search job as the affected
surface. `_run_search_job` in `immi_case_downloader/web/jobs.py` has **no caller
anywhere in the repository** — a grep across every `*.py` finds no route, no
other module and no test that reaches it. Do not cite it and do not "fix" it
here; the CLI is the only live path.

Every `ImmigrationCase.year` produced by this scraper is an `int` (set at
`austlii.py:171`, `:260`, `:288` — `year=year` from the loop parameter or
`int(year_match.group(1)) if year_match else 0`), so sorting on it is safe.

### PYCORR-18 — no checkpoint, and the only backup is overwritten

`extract_structured_fields.py:986-1005`, verbatim:

```python
def save_csv(rows: list[dict]):
    """Save updated rows back to CSV with atomic write."""
    if not rows:
        return

    # Backup first
    backup_path = CSV_PATH.with_suffix(".csv.bak_extract")
    shutil.copy2(CSV_PATH, backup_path)
    print(f"Backup saved to {backup_path}")

    fieldnames = list(rows[0].keys())

    tmp_path = CSV_PATH.with_suffix(".csv.tmp")
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    os.replace(str(tmp_path), str(CSV_PATH))
    print(f"Saved {len(rows)} rows to {CSV_PATH}")
```

Line 992 is a **fixed** filename, so a second run's `shutil.copy2` on line 993
destroys the first run's backup. Line 996 takes the header from `rows[0]` alone.

`extract_structured_fields.py:1062-1075`, verbatim:

```python
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        for completed, (row, extracted) in enumerate(
            zip(rows, executor.map(process_case, rows, chunksize=500))
        ):
            for field, value in extracted.items():
                if value:
                    if args.overwrite or not row.get(field):
                        row[field] = value
                        stats[f"{field}_extracted"] += 1
                    else:
                        stats["skipped_existing"] += 1

            if (completed + 1) % 5000 == 0:
                print(f"  Processed {completed + 1}/{total}...")
```

Nothing is persisted inside this loop. `save_csv` is reached only afterwards, at
line **1130** (filtered/sampled path) or line **1132** (whole-corpus path).
`ProcessPoolExecutor.map` re-raises a worker exception at consumption time and
then cancels the remaining futures, so the loop cannot resume: the fix must be
to stop `process_case` from raising at all, not to wrap the consumer.

`extract_structured_fields.py:975-983`, verbatim:

```python
def load_csv() -> list[dict]:
    """Load the immigration cases CSV."""
    if not CSV_PATH.exists():
        print(f"Error: {CSV_PATH} not found")
        sys.exit(1)

    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)
```

`csv.DictReader` with the default `restval=None` gives `None` for a short row's
missing cells and puts a long row's overflow under the `None` **restkey** — so
`r.get(field, "").strip()` at `extract_structured_fields.py:1095` raises
`AttributeError`, and `list(rows[0].keys())` may or may not contain `None`.

Honest scoping note: reaching those two needs an already-malformed CSV. The
`csv` module and pandas both quote embedded commas and newlines correctly, so
normal scraped case text does **not** produce short rows. Treat the coercions in
step 7 as cheap hardening, and the checkpointing/backup work as the real fix.

The repository already has a timestamped-backup convention —
`merge_llm_extraction.py:88`, verbatim:

```python
        backup = f"{CSV_PATH}.bak-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
```

Match that shape.

### PYCORR-23 — an unmatched `--court` filter crashes the validator

`validate_extraction.py:61-81`, verbatim:

```python
def print_fill_rates(rows: list[dict], court_filter: str = "", label: str = ""):
    total = len(rows)
    if court_filter:
        rows = [r for r in rows if r.get("court_code", "") == court_filter]
        total = len(rows)

    title = f"Fill Rates{' — ' + label if label else ''}{' (' + court_filter + ')' if court_filter else ''}"
    print(f"\n{'='*70}")
    print(title)
    print(f"{'='*70}")
    print(f"Total cases: {total:,}")
    print()

    for field in STRUCTURED_FIELDS:
        if field not in rows[0]:
            print(f"  {field:30s}: (field not in CSV)")
            continue
        filled = sum(1 for r in rows if r.get(field, "").strip())
        pct = filled / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        print(f"  {field:30s}: {filled:>8,} / {total:,} = {pct:5.1f}% {bar}")
```

When the filter on line 64 matches nothing, `rows[0]` on line 75 raises
`IndexError`. It is reachable straight from the CLI —
`validate_extraction.py:207-210`, verbatim:

```python
    rows = load_csv(CSV_PATH)
    print(f"Loaded {len(rows):,} cases from {CSV_PATH}")

    print_fill_rates(rows, court_filter=args.court)
```

so `python validate_extraction.py --court NOSUCH` is an unhandled traceback.
The same `rows[0]` / `current[0]` shape appears at `validate_extraction.py:169`
(inside `compare_to_baseline`) and `validate_extraction.py:221` (inside `main`).

### PYCORR-19 — a non-UTF-8 gateway body escapes the handler

`immi_case_downloader/extraction/llm.py:65-82`, verbatim:

```python
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except TimeoutError as exc:
        raise ExtractionTimeoutError(unfilled) from exc
    except socket.timeout as exc:
        raise ExtractionTimeoutError(unfilled) from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            raise ExtractionTimeoutError(unfilled) from exc
        return {}, 0.0
    except (OSError, json.JSONDecodeError):
        return {}, 0.0

    values = _parse_values(payload, unfilled)
    if not values:
        return {}, 0.0
    return values, _estimate_cost(payload)
```

`.decode("utf-8")` on line 67 raises `UnicodeDecodeError`. That is a subclass of
`ValueError`, **not** of `json.JSONDecodeError` and not of `OSError`, so the
handler on line 76 does not match it and it escapes the function.

Correction to the original report, which also claimed the cost accounting
under-counts: that is documented as intentional. `immi_case_downloader/extraction/llm.py:35-40`,
verbatim:

```python
    """Extract unfilled fields via Cloudflare AI Gateway.

    JSON parse failures are treated as no extraction and cost ``0``. This keeps
    the caller from retrying malformed model output and accidentally amplifying
    spend.
    """
```

Do **not** change the `return {}, 0.0` on line 81. Only the decode handler is in
scope.

### PYCORR-22 — three auth decorators nothing uses, checking a repo nothing registers

`immi_case_downloader/web/auth.py:166-184`, verbatim:

```python
def require_tenant_membership(f):
    """
    Decorator (must be used after @require_auth): re-check tenant_members in DB
    on every write request. Provides instant revocation for writes.
    Only needed on POST/PUT/DELETE endpoints.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'tenant_id') or not g.tenant_id:
            return jsonify({'error': 'Tenant context required', 'code': 'no_tenant'}), 403

        # Re-check membership in DB (instant revocation for writes)
        repo = current_app.extensions.get('immi_repo')
        if repo and hasattr(repo, 'check_tenant_membership'):
            if not repo.check_tenant_membership(g.user_id, g.tenant_id):
                return jsonify({'error': 'Not a member of this tenant', 'code': 'revoked'}), 403

        return f(*args, **kwargs)
    return decorated
```

Three independent greps establish this is dead code, not a live fail-open:

1. `require_auth` (defined at `auth.py:110`), `optional_auth` (`auth.py:138`)
   and `require_tenant_membership` (`auth.py:166`) are applied to **zero**
   routes — the only hits anywhere in the repo are their own definitions and one
   docstring mention on `auth.py:168`.
2. **No class in the repository defines `check_tenant_membership`.** The only
   two occurrences are `auth.py:179` and `auth.py:180` — the call site itself.
   So the `if repo and hasattr(...)` guard on line 179 would be skipped even if
   the lookup were correct.
3. `current_app.extensions.get('immi_repo')` on line 178 is the only occurrence
   of the string `immi_repo` in the repository. The factory stores the
   repository under `app.config["REPO"]` instead —
   `immi_case_downloader/web/__init__.py:85`, `:92`, `:97` and `:101` all assign
   `app.config["REPO"] = ...`; line 97 verbatim:

```python
        app.config["REPO"] = SqliteRepository(db_path)
```

`CLAUDE.md` documents this module as local-dev only, outside the production
request path, where `CloudflareIdentityStore.assertMembership()` in
`workers/storage/cloudflare.js` is the real tenant boundary. So the correct fix
is deletion, not repair.

`verify_jwt` **is** used and must survive: `tests/test_web_auth.py:9` imports it
and exercises it in two tests. `_is_internal_request` (`auth.py:97`) is used only
by the two decorators being deleted, so it goes with them.

`immi_case_downloader/web/auth.py:56-89`, verbatim (note the claim checks on
lines 66 and 72 precede the signature verification on line 81):

```python
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        payload_bytes = _b64url_decode(payload_b64)
        payload = json.loads(payload_bytes)

        # Check expiry
        if payload.get('exp', 0) < time.time():
            current_app.logger.warning('jwt.expired', extra={'kid': payload.get('kid')})
            return None

        # Flask routes expect access tokens. Refresh tokens are validated and
        # rotated only by the Worker auth handlers against immi_refresh_sessions.
        if payload.get('type') == 'refresh' and not allow_refresh:
            current_app.logger.warning('jwt.refresh_token_rejected', extra={'kid': payload.get('kid')})
            return None

        # Try current secret first, then previous (rotation window)
        for secret_env in ('JWT_SECRET_CURRENT', 'JWT_SECRET_PREVIOUS'):
            secret = os.environ.get(secret_env, '')
            if not secret:
                continue
            if _verify_hs256(header_b64, payload_b64, sig_b64, secret):
                return payload

        current_app.logger.warning('jwt.invalid_signature')
        return None

    except Exception as e:
        current_app.logger.warning(f'jwt.parse_error: {e}')
        return None
```

This ordering **fails closed** (an early check can only reject) so it is not a
vulnerability; step 6 reorders it anyway because acting on unverified
attacker-controlled claims is a habit worth not having in a JWT verifier.

### PYCORR-26 — unfiltered `setattr` from the metadata extractor

`immi_case_downloader/sources/austlii.py:347-358`, verbatim:

```python
    def _extract_metadata(self, soup: BeautifulSoup, case: ImmigrationCase):
        """Extract metadata fields from a case page.

        Delegates to the shared MetadataExtractor, which consolidates all
        regex patterns previously duplicated across scrapers.
        """
        text = soup.get_text()
        extracted = self._metadata_extractor.extract(
            text, citation=case.citation or ""
        )
        for key, value in extracted.items():
            setattr(case, key, value)
```

`ImmigrationCase.to_dict` serialises only declared dataclass fields —
`immi_case_downloader/models.py:43-44`, verbatim:

```python
    def to_dict(self) -> dict:
        return asdict(self)
```

so an undeclared key set by line 358 would be written onto the instance and then
silently dropped at persistence time.

**There is no mismatch today.** `MetadataExtractor.extract` emits exactly seven
keys, all declared on `ImmigrationCase` — `judges` (line 115), `date` (122),
`catchwords` (128), `citation` (134), `outcome` (140), `visa_type` (146),
`legislation` (153) of `immi_case_downloader/sources/metadata_extractor.py`,
matching its own contract at `metadata_extractor.py:96-98`, verbatim:

```python
        Returns:
            Dict with any of: judges, date, catchwords, citation, outcome,
            visa_type, legislation.  Only keys with extracted values are present.
```

So step 3 is insurance against a future extractor field vanishing, not a bug fix.
Treat it as such — it must not change any current output.

### PYCORR-25 — falsy coercion and the shared empty-key hash

`immi_case_downloader/models.py:46-66`, verbatim:

```python
    def ensure_id(self):
        """Generate a stable case_id if not already set."""
        if not self.case_id:
            key = self.citation or self.url or self.title
            self.case_id = hashlib.sha256(key.encode()).hexdigest()[:12]

    @classmethod
    def from_dict(cls, data: dict) -> "ImmigrationCase":
        """Create an ImmigrationCase from a dictionary, ignoring unknown keys."""
        valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {}
        for k, v in data.items():
            if k in valid_fields:
                if k == "year":
                    try:
                        filtered[k] = int(v) if v and str(v) != "nan" else 0
                    except (ValueError, TypeError):
                        filtered[k] = 0
                else:
                    filtered[k] = str(v) if v and str(v) != "nan" else ""
        return cls(**filtered)
```

Line 49: when `citation`, `url` and `title` are all empty, `key` is `""` and
every such case gets the SHA-256 of the empty string — one shared id. Lines 61
and 65 test truthiness, so a real `0` or `False` would be coerced away.

Both are **latent**, not live: every field except `year` is declared `str` on the
dataclass (`models.py:11-41`), so a genuine `0`/`False` never legitimately
arrives; and `immi_case_downloader/web/routes/api_cases.py:968-969` rejects a
case with neither title nor citation, leaving the empty-key branch reachable only
from direct library use or a hand-authored blank CSV row. Step 4 closes both
cheaply and must not change behaviour for any populated case.

### Repo conventions this plan must match

Quoted from `~/.claude/rules/` and this repository's own code — the executor has
not read those:

- **Immutability**: create new objects, do not mutate inputs. Accumulator locals
  inside one function are fine — the existing `cases` list in `_search_database`
  is the pattern.
- **Error handling**: handle errors explicitly at every level; never silently
  swallow. Where this plan does swallow (the per-row extraction guard in step 7),
  it must print a warning naming the row.
- **File size**: functions under 50 lines, files under 800. `austlii.py` is 419
  lines and `extract_structured_fields.py` is 1136 — the latter is already over,
  so add helpers rather than growing existing functions, and do not attempt a
  split in this plan.
- **Type annotations on all function signatures** (PEP 8 + the project's
  existing style). Every new function in this plan gets them.
- **`ImmigrationCase.from_dict()` is the only sanctioned constructor from
  dict-shaped data** — pandas turns empty CSV fields into `float('nan')`.
- **Logging**: `immi_case_downloader/` modules use the stdlib `logger` created at
  module top (`austlii.py:30`: `logger = logging.getLogger(__name__)`). The two
  root-level scripts (`extract_structured_fields.py`, `validate_extraction.py`)
  use `print()` — keep each file's existing idiom, do not introduce `logging`
  into the scripts.
- **Commit format**: `<type>: <description>` where `<type>` is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`. **No AI attribution or
  co-author trailers** — they are disabled globally.
- **Tests**: pytest, AAA structure, descriptive names that state the behaviour
  (`tests/test_austlii.py` is the exemplar for this territory).

### Things that are deliberate — do NOT "fix" them

- Placeholder resource IDs in the checked-in `wrangler.toml`, and the
  `IMMI_CASE_MUTATIONS_ENABLED` / pipeline flags defaulting to `"false"`.
- `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase.
- The `Performance Baseline (2026-05-05)` section of `CLAUDE.md` being historical.
- The `return {}, 0.0` for a JSON parse failure in `extraction/llm.py:80-81` —
  documented anti-spend-amplification behaviour, quoted above.
- `ruff==0.15.18` pinned in `requirements-test.txt`.

## Commands you will need

Run everything from the repository root
`/Users/d/Developer/Active Projects/IMMI-Case-` unless the command `cd`s itself.
Never use a global `python`/`pip`; the venv is at `.venv/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Focused suite (primary gate) | `.venv/bin/python -m pytest tests/test_austlii.py tests/test_models.py tests/test_pipeline.py tests/test_web_auth.py tests/test_storage.py -q --no-cov` | Baseline at `42826a3`: `110 passed`. After this plan: **114 passed** |
| New-file suite | `.venv/bin/python -m pytest tests/test_case_identity.py tests/test_extraction_llm_client.py tests/test_extraction_scripts.py -q --no-cov` | after step 8: `14 passed` |
| Full Python suite (final gate) | `make test-py` | `1141 passed, 3 failed, 7 skipped` at `42826a3`; **`1159 passed, 3 failed, 7 skipped`** after this plan. The 3 failures are **environmental** — Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`. They exist at `42826a3` and are **not yours to fix** |
| Lint (covers every file this plan edits) | `make lint` | `All checks passed!` |
| Lint the new test files | `.venv/bin/ruff check tests/test_case_identity.py tests/test_extraction_llm_client.py tests/test_extraction_scripts.py tests/test_austlii.py` | `All checks passed!` |
| Import smoke for the root scripts | `.venv/bin/python -c "import extract_structured_fields, validate_extraction; print('ok')"` | prints `ok` |
| Diff review | `git status --short` then `git diff` | only in-scope files listed |

Note on `make test-py`: it runs `"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e -q`
and `pytest.ini` adds `--cov=immi_case_downloader --cov-report=term-missing`, so a
coverage table is printed. That is normal.

## Scope

**In scope** (the only files you may modify or create):

- `immi_case_downloader/sources/austlii.py`
- `immi_case_downloader/models.py`
- `immi_case_downloader/extraction/llm.py`
- `immi_case_downloader/web/auth.py`
- `extract_structured_fields.py`
- `validate_extraction.py`
- `tests/test_austlii.py` (modify — one existing test changes, three are added)
- `tests/test_case_identity.py` (**create**)
- `tests/test_extraction_llm_client.py` (**create**)
- `tests/test_extraction_scripts.py` (**create**)

**Out of scope** (do NOT touch, even though they look related):

- `immi_case_downloader/pipeline.py` — it is the *consumer* whose
  `if cases is not None` check step 1 makes meaningful, and step 1 is designed
  so that it needs no edit. Editing it would double-apply the fix.
- `immi_case_downloader/sources/metadata_extractor.py` — read-only here. Its
  output contract is what step 3 filters against; changing the contract and the
  filter in one plan removes the safety the filter provides.
- `immi_case_downloader/web/jobs.py` and `download_fulltext.py` — the two other
  `_browse_year` callers. Both already wrap the call in `try/except Exception`
  and log (`jobs.py:308-309`, `download_fulltext.py:68-69`), so step 1 improves
  their message without needing an edit. `_run_search_job` in `jobs.py` is
  additionally unreachable dead code; deleting it is a different plan's call.
- `immi_case_downloader/storage.py` — including the `hash(case.url)` filename
  fallback on line 113. See "Findings reconsidered".
- `immi_case_downloader/web/internal_extract.py` — the caller of `extract_llm`.
  See "Findings reconsidered" for why its per-item guard is deferred.
- `tests/test_models.py`, `tests/test_pipeline.py`, `tests/test_storage.py` and
  every other existing file under `tests/` **except** `tests/test_austlii.py`.
  A separate plan runs `ruff check --fix tests/` over the ~23 files that
  currently have findings; `tests/test_austlii.py` has **zero** ruff findings and
  is therefore the one existing test file safe to edit here. Your three new test
  files must also be ruff-clean so that plan is a no-op on them.
- `Makefile`, `pytest.ini`, `.github/workflows/ci.yml`, `requirements*.txt` —
  owned by the verification-gate plans.
- `CLAUDE.md`, `.claude/STATE.md`, `README.md`, anything under `docs/`.
- `frontend/**`, `workers/**`, `scripts/**`, `migrations/**`.

## Git workflow

- Branch: `git checkout -b advisor/029-harden-scraper-and-extraction`
- One commit per step, message style `<type>: <description>` with `<type>` in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`. A suggested message is given
  at the end of each step.
- **No AI attribution / co-author trailers.**
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Make a failed year listing raise instead of returning an empty list

Addresses PYCORR-17. All edits in `immi_case_downloader/sources/austlii.py` and
`tests/test_austlii.py`.

1. Add an exception class just below the `logger = logging.getLogger(__name__)`
   line at `austlii.py:30` (leave two blank lines above and below, matching the
   file's spacing):

   ```python
   class YearListingUnavailable(RuntimeError):
       """AustLII would not serve a year listing at all.

       Distinct from a listing that loaded fine and contained no immigration
       cases, which is an empty list. SmartPipeline._crawl_with_fallback relies
       on that distinction to rotate crawl strategies when AustLII rate-limits
       us; returning [] for both made the rotation unreachable.
       """
   ```

2. Change the failure branch of `_browse_year`. Replace
   `austlii.py:138-139`:

   ```python
            if not response:
                return []
   ```

   with:

   ```python
            if not response:
                raise YearListingUnavailable(
                    f"{db_code}/{year}: listing unavailable "
                    f"({self.last_error or 'no response'})"
                )
   ```

   `self.last_error` is set by `BaseScraper.fetch` on every failure
   (`immi_case_downloader/sources/base.py:54-73`) and is a dict such as
   `{"category": "http_500", "url": ..., "status": 500}`.

   Also update the method's return annotation and docstring so the contract is
   explicit. The signature at `austlii.py:117-123` keeps
   `-> list[ImmigrationCase]`; append this paragraph to the end of its docstring
   (before the closing `"""` on line 130):

   ```python
           Returns an empty list when the listing loaded but held no immigration
           cases. Raises YearListingUnavailable when neither the direct listing
           nor the viewdb fallback could be fetched.
   ```

3. Make `_search_database` survive a failed year instead of aborting the whole
   database. Replace `austlii.py:92-98`:

   ```python
           cases = []

           # Browse every year — no early exit so all years get coverage
           for year in range(start_year, end_year + 1):
               year_cases = self._browse_year(db_code, db_info, year, keywords)
               cases.extend(year_cases)
               logger.debug(f"  {db_code}/{year}: {len(year_cases)} cases found")
   ```

   with:

   ```python
           cases = []
           failed_years = []

           # Browse every year — no early exit so all years get coverage
           for year in range(start_year, end_year + 1):
               try:
                   year_cases = self._browse_year(db_code, db_info, year, keywords)
               except YearListingUnavailable as exc:
                   failed_years.append(year)
                   logger.warning(f"  {exc}")
                   continue
               cases.extend(year_cases)
               logger.debug(f"  {db_code}/{year}: {len(year_cases)} cases found")

           if failed_years:
               logger.warning(
                   f"  {db_code}: {len(failed_years)} of "
                   f"{end_year - start_year + 1} years could not be fetched "
                   f"({failed_years}); results are incomplete"
               )
   ```

4. In `tests/test_austlii.py`, replace the existing
   `test_both_fail_returns_empty` (lines 88-101) with a raise assertion. `pytest`
   is already imported at `tests/test_austlii.py:6`; add
   `YearListingUnavailable` to the existing import on line 8 so it reads
   `from immi_case_downloader.sources.austlii import AustLIIScraper, YearListingUnavailable`:

   ```python
       @responses.activate
       def test_both_fail_raises_year_listing_unavailable(self):
           """Both direct and viewdb failing is a signalled failure, not an empty year."""
           direct_url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
           viewdb_url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/AATA/"

           responses.add(responses.GET, direct_url, status=500)
           responses.add(responses.GET, viewdb_url, status=500)

           scraper = AustLIIScraper(delay=0)
           db_info = AUSTLII_DATABASES["AATA"]
           with pytest.raises(YearListingUnavailable) as excinfo:
               scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS)
           assert "AATA/2024" in str(excinfo.value)
   ```

5. Add one more test to the same `TestBrowseYear` class, proving the other half
   of the contract:

   ```python
       @responses.activate
       def test_listing_without_matches_returns_empty_list(self):
           """A listing that loads but holds no immigration cases is [] — not a failure."""
           url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
           responses.add(
               responses.GET,
               url,
               body="<html><body><a href='/au/cases/cth/AATA/2024/1.html'>"
                    "Jones v Commissioner of Taxation</a></body></html>",
               status=200,
           )

           scraper = AustLIIScraper(delay=0)
           db_info = AUSTLII_DATABASES["AATA"]
           assert scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS) == []
   ```

6. Add a new test class at the end of `tests/test_austlii.py` covering
   `_search_database`. It monkeypatches the two network methods on the instance,
   so no `responses` registration is needed:

   ```python
   class TestSearchDatabase:
       """Test _search_database's per-year failure handling and result cap."""

       def _scraper(self):
           scraper = AustLIIScraper(delay=0)
           scraper._keyword_search = lambda *a, **k: []
           return scraper

       def test_failed_year_is_skipped_not_fatal(self):
           """One unavailable year must not lose the years that did load."""
           from immi_case_downloader.models import ImmigrationCase
           from immi_case_downloader.sources.austlii import YearListingUnavailable

           scraper = self._scraper()

           def browse(db_code, db_info, year, keywords):
               if year == 2023:
                   raise YearListingUnavailable("AATA/2023: listing unavailable (http_500)")
               return [ImmigrationCase(title=f"case {year}", year=year,
                                       url=f"https://example.test/{year}")]

           scraper._browse_year = browse
           cases = scraper._search_database(
               "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2023, 2024, 500
           )
           assert [c.year for c in cases] == [2024]
   ```

   (The truncation test goes in this same class in step 2.)

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_austlii.py tests/test_pipeline.py -q --no-cov 2>&1 | tail -3 && make lint
```
→ `61 passed` (34 existing in `test_austlii.py` + 2 added here + 25 in
`test_pipeline.py`), then `All checks passed!`.

Commit: `fix: signal AustLII listing failures instead of returning an empty year`

### Step 2: Keep the newest cases when a search result set is truncated

Addresses PYCORR-15. All edits in `immi_case_downloader/sources/austlii.py` and
`tests/test_austlii.py`.

1. Replace the final line of `_search_database` (`austlii.py:112`,
   `        return cases[:max_results]`) with:

   ```python
           if len(cases) > max_results:
               # The browse loop runs oldest year first, so a plain slice kept
               # the OLDEST max_results cases and silently dropped the newest —
               # the opposite of what a case-law user wants. Sort newest-first
               # before capping, and say out loud that rows were dropped.
               cases.sort(key=lambda c: (c.year, c.citation or c.title), reverse=True)
               logger.warning(
                   f"  {db_code}: {len(cases)} cases found but max_results="
                   f"{max_results}; dropping the {len(cases) - max_results} "
                   f"oldest. Raise --max-results to keep them."
               )
               return cases[:max_results]

           return cases
   ```

   Note the sort runs **only** when truncating, so an untruncated result keeps
   its current oldest-first order and no existing caller changes behaviour.

2. Add the truncation test to the `TestSearchDatabase` class created in step 1:

   ```python
       def test_truncation_keeps_the_newest_years(self):
           """max_results must drop the oldest cases, not the newest."""
           from immi_case_downloader.models import ImmigrationCase

           scraper = self._scraper()
           scraper._browse_year = lambda db_code, db_info, year, keywords: [
               ImmigrationCase(title=f"case {year}-{n}", year=year,
                               citation=f"[{year}] AATA {n}",
                               url=f"https://example.test/{year}/{n}")
               for n in range(6)
           ]

           cases = scraper._search_database(
               "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2020, 2024, 6
           )

           assert len(cases) == 6
           assert {c.year for c in cases} == {2024}
   ```

   (Six cases per year over five years is 30, comfortably above the `< 10`
   keyword-search fallback threshold on `austlii.py:101`, so `_keyword_search`
   is not consulted.)

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_austlii.py -q --no-cov 2>&1 | tail -3 && make lint
```
→ `37 passed`, then `All checks passed!`.

Commit: `fix: keep the newest cases when an AustLII search hits max_results`

### Step 3: Filter metadata keys against the dataclass before setattr

Addresses PYCORR-26. This must change **no** current output — every key the
extractor emits today is a declared field. All edits in
`immi_case_downloader/sources/austlii.py` and `tests/test_austlii.py`.

1. Replace `austlii.py:357-358`:

   ```python
           for key, value in extracted.items():
               setattr(case, key, value)
   ```

   with:

   ```python
           valid_fields = ImmigrationCase.__dataclass_fields__
           for key, value in extracted.items():
               if key not in valid_fields:
                   # asdict() only serialises declared fields, so an undeclared
                   # key would be set on the instance and then vanish silently at
                   # persistence time. Same guard from_dict() already applies.
                   logger.warning(
                       f"MetadataExtractor emitted unknown field '{key}' for "
                       f"{case.url or case.citation or case.title}; dropping it"
                   )
                   continue
               setattr(case, key, value)
   ```

   `ImmigrationCase` is already imported at `austlii.py:28`.

2. Add a test to `tests/test_austlii.py`, at the end of the file:

   ```python
   class TestExtractMetadataGuard:
       """Unknown extractor keys must be dropped loudly, not set silently."""

       def test_unknown_metadata_key_is_dropped(self, monkeypatch):
           from bs4 import BeautifulSoup
           from immi_case_downloader.models import ImmigrationCase

           scraper = AustLIIScraper(delay=0)
           monkeypatch.setattr(
               scraper._metadata_extractor,
               "extract",
               lambda *a, **k: {"judges": "Smith J", "not_a_field": "x"},
           )

           case = ImmigrationCase(url="https://example.test/1")
           scraper._extract_metadata(BeautifulSoup("<html></html>", "lxml"), case)

           assert case.judges == "Smith J"
           assert not hasattr(case, "not_a_field")
   ```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_austlii.py -q --no-cov 2>&1 | tail -3 && make lint
```
→ `38 passed`, then `All checks passed!`.

Commit: `fix: drop unknown metadata keys instead of setting them silently`

### Step 4: Make missing-value detection explicit and stop blank cases sharing one id

Addresses PYCORR-25. All edits in `immi_case_downloader/models.py` plus the new
test file.

1. Add `import math` to the imports at `models.py:3-4` so they read:

   ```python
   import hashlib
   import math
   from dataclasses import dataclass, asdict
   ```

2. Add a module-level helper below the imports, above the `@dataclass` line:

   ```python
   def _is_missing(value) -> bool:
       """True for the three shapes an absent CSV/DB cell arrives in.

       pandas turns an empty CSV field into float('nan'); a CSV round-trip turns
       that into the string "nan"; a SQL NULL arrives as None. Testing those
       explicitly instead of plain falsiness means a legitimate 0 or False is
       preserved rather than blanked.
       """
       if value is None:
           return True
       if isinstance(value, float) and math.isnan(value):
           return True
       return str(value) == "nan"
   ```

3. Replace the body of `from_dict` (`models.py:55-66`) with:

   ```python
           valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
           filtered = {}
           for k, v in data.items():
               if k in valid_fields:
                   if k == "year":
                       try:
                           filtered[k] = 0 if _is_missing(v) else int(v)
                       except (ValueError, TypeError):
                           filtered[k] = 0
                   else:
                       filtered[k] = "" if _is_missing(v) else str(v)
           return cls(**filtered)
   ```

   Behaviour is unchanged for every input the existing tests exercise —
   `""` still yields `""`, `float('nan')` and `"nan"` still yield `""`/`0`, and
   `{"year": 0}` still yields `0` (`int(0)`). The only difference is that a
   literal `0` or `False` in a string field now survives as `"0"` / `"False"`.

4. Replace `ensure_id` (`models.py:46-50`) with:

   ```python
       def ensure_id(self):
           """Generate a stable case_id if not already set."""
           if self.case_id:
               return
           key = self.citation or self.url or self.title
           if not key:
               # Nothing identifying: hashing "" gave every blank-key case the
               # same id (e3b0c442…). Fall back to the whole record so two
               # different blank-key rows stay distinguishable, and stay
               # deterministic so reloading the CSV does not mint a new id.
               key = repr(sorted(
                   (name, value)
                   for name, value in self.to_dict().items()
                   if name != "case_id"
               ))
           self.case_id = hashlib.sha256(key.encode()).hexdigest()[:12]
   ```

5. Create `tests/test_case_identity.py`:

   ```python
   """Regression tests for ImmigrationCase id generation and dict coercion."""

   from immi_case_downloader.models import ImmigrationCase


   def test_blank_key_cases_do_not_share_one_id():
       """Two records with no citation/url/title must not collapse onto one id."""
       a = ImmigrationCase(court_code="AATA", year=2024)
       b = ImmigrationCase(court_code="FCA", year=2024)
       a.ensure_id()
       b.ensure_id()

       assert len(a.case_id) == 12
       assert a.case_id != b.case_id


   def test_blank_key_id_is_stable_across_calls():
       """The fallback must be deterministic so a CSV reload keeps the same id."""
       first = ImmigrationCase(court_code="AATA", year=2024)
       second = ImmigrationCase(court_code="AATA", year=2024)
       first.ensure_id()
       second.ensure_id()

       assert first.case_id == second.case_id


   def test_from_dict_preserves_zero_like_values():
       """A real 0 is data, not a missing value."""
       case = ImmigrationCase.from_dict({"visa_subclass": 0, "year": 0})

       assert case.visa_subclass == "0"
       assert case.year == 0


   def test_from_dict_still_cleans_nan_and_none():
       """pandas NaN, the string 'nan', and SQL NULL all mean absent."""
       case = ImmigrationCase.from_dict(
           {"citation": float("nan"), "title": "nan", "court": None, "year": float("nan")}
       )

       assert case.citation == ""
       assert case.title == ""
       assert case.court == ""
       assert case.year == 0
   ```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_case_identity.py tests/test_models.py tests/test_storage.py -q --no-cov 2>&1 | tail -3 && make lint
```
→ `53 passed` (4 new + 21 in `test_models.py` + 28 in `test_storage.py`), then
`All checks passed!`.

Commit: `fix: test for missing values explicitly and give blank cases distinct ids`

### Step 5: Stop a non-UTF-8 gateway body escaping the LLM client

Addresses PYCORR-19 (the surviving half). All edits in
`immi_case_downloader/extraction/llm.py` plus a new test file.

1. Replace `llm.py:76-77`:

   ```python
       except (OSError, json.JSONDecodeError):
           return {}, 0.0
   ```

   with:

   ```python
       except (OSError, UnicodeDecodeError, json.JSONDecodeError):
           # UnicodeDecodeError is a ValueError, not a JSONDecodeError and not an
           # OSError, so a non-UTF-8 body used to escape this function entirely
           # and abort the caller's whole batch. An undecodable body is just
           # unusable model output: no extraction, no cost.
           return {}, 0.0
   ```

   Do **not** touch the `return {}, 0.0` on line 81 — see "Current state".

2. Create `tests/test_extraction_llm_client.py`:

   ```python
   """Regression tests for the AI Gateway extraction client's failure handling."""

   import io
   import json
   from unittest.mock import patch

   from immi_case_downloader.extraction.llm import extract_llm


   def _call(body: bytes):
       # io.BytesIO is already a context manager whose __enter__ returns self and
       # whose read() returns bytes, which is all `with urlopen(...) as response`
       # needs from the stand-in.
       with patch("urllib.request.urlopen", return_value=io.BytesIO(body)):
           return extract_llm(
               "The applicant is a citizen of India.",
               ["country_of_origin"],
               gateway_url="https://gateway.test/compat/chat/completions",
               token="test-token",
           )


   def test_non_utf8_body_returns_no_extraction_instead_of_raising():
       values, cost = _call(b"\xff\xfe\x00garbage")

       assert values == {}
       assert cost == 0.0


   def test_malformed_json_body_returns_no_extraction():
       values, cost = _call(b"not json at all")

       assert values == {}
       assert cost == 0.0


   def test_valid_body_returns_values_and_estimated_cost():
       body = json.dumps(
           {
               "choices": [
                   {"message": {"content": '{"country_of_origin": "India"}'}}
               ],
               "usage": {"prompt_tokens": 1000, "completion_tokens": 1000},
           }
       ).encode("utf-8")

       values, cost = _call(body)

       assert values == {"country_of_origin": "India"}
       assert cost == 0.0004
   ```

   The expected cost comes from `_estimate_cost` at `llm.py:132-139`:
   `round((1000 * 0.10 + 1000 * 0.30) / 1_000_000, 6)` = `0.0004`.

   These three assertions were checked against the code at `42826a3`: the
   malformed-JSON and valid-body cases already return `({}, 0.0)` and
   `({'country_of_origin': 'India'}, 0.0004)`, and the non-UTF-8 case currently
   raises `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 0`.
   So the first test **must fail before your edit in item 1 and pass after it** —
   if it passes before the edit, you are not testing what you think.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_extraction_llm_client.py tests/test_internal_extract.py tests/test_extraction_regex.py -q --no-cov 2>&1 | tail -3 && make lint
```
→ `6 passed` (3 new + 3 existing), then `All checks passed!`.

Commit: `fix: handle an undecodable AI Gateway body in the extraction client`

### Step 6: Delete the dead Flask auth decorators and verify signatures first

Addresses PYCORR-22. All edits in `immi_case_downloader/web/auth.py`. **Do not
delete the file** — `tests/test_web_auth.py:9` imports `verify_jwt` from it and
that test must keep passing untouched.

1. Delete these four blocks in full, including their comment banners:
   - the `# Internal route guard` banner and `_is_internal_request`
     (`auth.py:92-102`)
   - the `# Decorators` banner (`auth.py:105-107`)
   - `require_auth` (`auth.py:110-135`)
   - `optional_auth` (`auth.py:138-163`)
   - `require_tenant_membership` (`auth.py:166-184`)

   After this the file ends with `verify_jwt`.

2. Trim the now-unused imports. Replace `auth.py:20-21`:

   ```python
   from functools import wraps
   from flask import request, g, jsonify, current_app
   ```

   with:

   ```python
   from flask import current_app
   ```

   `current_app` is still used at lines 67, 73, 84 and 88; `hmac`, `hashlib`,
   `base64`, `json`, `time` and `os` all remain in use.

3. Replace the module docstring (`auth.py:1-12`) — it currently describes the
   deleted guard — with:

   ```python
   """Flask JWT verification helper — local development only.

   The Worker issues HS256 JWTs signed with JWT_SECRET_CURRENT and is the only
   component that enforces authentication and tenancy in production; see
   workers/auth/cloudflare_handlers.js and CloudflareIdentityStore.assertMembership()
   in workers/storage/cloudflare.js. This module exists so a locally run Flask
   process can decode the same token.

   It deliberately exposes no route decorators. The three that used to live here
   (require_auth / optional_auth / require_tenant_membership) were applied to zero
   routes, read the app extension 'immi_repo' that nothing registers, and called
   a check_tenant_membership() method that no repository implements — so anyone
   adopting them would have believed they enforced tenancy while they enforced
   nothing. Do not re-add them: the Worker owns this boundary.
   """
   ```

4. Reorder `verify_jwt` so no claim is read before the signature is verified.
   Replace the whole `try:` body (`auth.py:56-85` in the original numbering,
   i.e. everything from `parts = token.split('.')` down to and including the
   `return None` that follows `current_app.logger.warning('jwt.invalid_signature')`)
   with:

   ```python
           parts = token.split('.')
           if len(parts) != 3:
               return None
           header_b64, payload_b64, sig_b64 = parts

           # Verify the signature BEFORE reading any claim. An unverified payload
           # is attacker-supplied text; no decision should depend on it first.
           # Try current secret first, then previous (rotation window).
           verified = False
           for secret_env in ('JWT_SECRET_CURRENT', 'JWT_SECRET_PREVIOUS'):
               secret = os.environ.get(secret_env, '')
               if not secret:
                   continue
               if _verify_hs256(header_b64, payload_b64, sig_b64, secret):
                   verified = True
                   break

           if not verified:
               current_app.logger.warning('jwt.invalid_signature')
               return None

           payload = json.loads(_b64url_decode(payload_b64))

           # Check expiry
           if payload.get('exp', 0) < time.time():
               current_app.logger.warning('jwt.expired', extra={'kid': payload.get('kid')})
               return None

           # Flask routes expect access tokens. Refresh tokens are validated and
           # rotated only by the Worker auth handlers against immi_refresh_sessions.
           if payload.get('type') == 'refresh' and not allow_refresh:
               current_app.logger.warning('jwt.refresh_token_rejected', extra={'kid': payload.get('kid')})
               return None

           return payload
   ```

   Leave the trailing `except Exception as e:` block (`auth.py:87-89`) exactly as
   it is.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_web_auth.py tests/test_webapp.py -q --no-cov 2>&1 | grep -E "passed|failed" | tail -2 && grep -rn "require_auth\|optional_auth\|require_tenant_membership\|immi_repo\|check_tenant_membership" --include="*.py" immi_case_downloader/ tests/ scripts/ ; make lint
```
→ `34 passed` (2 in `test_web_auth.py` + 32 in `test_webapp.py`); the `grep`
prints **nothing** and exits 1; then `All checks passed!`.
(`test_webapp.py` prints `analytics_nature_outcome fallback also timed out` lines
during the run — that is pre-existing noise at `42826a3`, not a failure.)

Commit: `refactor: delete the unused Flask auth decorators and verify JWTs signature-first`

### Step 7: Checkpoint the extraction run, timestamp its backups, and stop one bad row killing it

Addresses PYCORR-18 and the coercion half of PYCORR-23. All edits in
`extract_structured_fields.py` plus the new test file (created in step 8).

1. Add the datetime import. The import block at `extract_structured_fields.py:17-25`
   becomes:

   ```python
   import argparse
   import csv
   import os
   import re
   import shutil
   import sys
   from collections import Counter
   from concurrent.futures import ProcessPoolExecutor
   from datetime import datetime
   from pathlib import Path
   ```

2. Add a checkpoint interval directly below `CSV_PATH` at
   `extract_structured_fields.py:29-30`:

   ```python
   # Rows between on-disk checkpoints during a long extraction run.
   CHECKPOINT_EVERY = 5000
   ```

3. Make the worker function unable to raise. Rename the existing
   `def process_case(case_row: dict) -> dict:` at line 876 to
   `def _extract_case_fields(case_row: dict) -> dict:` (change **only** that
   `def` line; leave its body untouched apart from item 4 below), then add a new
   wrapper directly above it:

   ```python
   def process_case(case_row: dict) -> dict:
       """Worker entry point. Never raises.

       ProcessPoolExecutor.map re-raises a worker exception when the result is
       consumed and then cancels every remaining future, so one unparseable row
       would throw away a 149k-row run that is 11 minutes in. Swallow per row,
       loudly, and keep going.
       """
       try:
           return _extract_case_fields(case_row)
       except Exception as exc:  # noqa: BLE001 - one bad row must not abort the run
           print(
               f"  warn: extraction failed for "
               f"{case_row.get('case_id') or case_row.get('citation') or '?'}: {exc}",
               file=sys.stderr,
           )
           return {}
   ```

4. Make the field reads inside `_extract_case_fields` None-safe. Replace lines
   878-881:

   ```python
       title = case_row.get("title", "")
       citation = case_row.get("citation", "")
       visa_subclass = case_row.get("visa_subclass", "")
       visa_type = case_row.get("visa_type", "")
   ```

   with:

   ```python
       # csv.DictReader fills a short row's missing cells with None, so `or ""`
       # rather than a get() default is what actually guarantees a str here.
       title = case_row.get("title") or ""
       citation = case_row.get("citation") or ""
       visa_subclass = case_row.get("visa_subclass") or ""
       visa_type = case_row.get("visa_type") or ""
   ```

   and line 888, `    text_path = case_row.get("full_text_path", "")`, with:

   ```python
       text_path = case_row.get("full_text_path") or ""
   ```

5. Split backup from save. Replace the whole `save_csv` function
   (`extract_structured_fields.py:986-1005`) with these three:

   ```python
   def backup_csv() -> Path | None:
       """Take one timestamped snapshot before a run's first write.

       The old fixed ".csv.bak_extract" name meant a second run's copy destroyed
       the first run's backup — the only surviving copy of a corpus that is
       gitignored and lives on one machine. Matches the convention already used
       in merge_llm_extraction.py.
       """
       if not CSV_PATH.exists():
           return None

       stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
       backup_path = CSV_PATH.with_name(f"{CSV_PATH.name}.bak-{stamp}")
       shutil.copy2(CSV_PATH, backup_path)
       print(f"Backup saved to {backup_path}")
       return backup_path


   def _union_fieldnames(rows: list[dict]) -> list[str]:
       """Header covering every key any row carries, in first-seen order.

       csv.DictReader parks a long row's overflow cells under the None restkey.
       That is not a column name, so drop it rather than writing a literal
       "None" header.
       """
       names: list[str] = []
       seen: set = set()
       for row in rows:
           for key in row:
               if key is None or key in seen:
                   continue
               seen.add(key)
               names.append(key)
       return names


   def save_csv(rows: list[dict]):
       """Save rows back to CSV with an atomic replace.

       Deliberately does not back up: call backup_csv() once before the first
       save of a run, so periodic checkpoints do not litter the directory with
       one snapshot each.
       """
       if not rows:
           return

       fieldnames = _union_fieldnames(rows)

       tmp_path = CSV_PATH.with_suffix(".csv.tmp")
       with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
           writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
           writer.writeheader()
           writer.writerows(rows)

       os.replace(str(tmp_path), str(CSV_PATH))
       print(f"Saved {len(rows)} rows to {CSV_PATH}")
   ```

   `extrasaction="ignore"` is required: without it, a row carrying the `None`
   restkey would make `DictWriter.writerow` raise `ValueError` because `None` is
   not in `fieldnames`.

6. Take the backup once, before the loop. In `main`, immediately after the
   `if args.overwrite:` block that ends at line 1060 and before the
   `with ProcessPoolExecutor(...)` on line 1062, insert:

   ```python
       if not args.dry_run:
           backup_csv()
   ```

7. Checkpoint inside the loop. Replace lines 1074-1075:

   ```python
               if (completed + 1) % 5000 == 0:
                   print(f"  Processed {completed + 1}/{total}...")
   ```

   with:

   ```python
               if (completed + 1) % CHECKPOINT_EVERY == 0:
                   print(f"  Processed {completed + 1}/{total}...")
                   if not args.dry_run:
                       # `rows` holds the same dict objects as `all_rows` (the
                       # filter and random.sample both keep references, they do
                       # not copy), so writing all_rows persists everything the
                       # loop has mutated so far.
                       save_csv(all_rows)
                       print(f"  Checkpoint written at {completed + 1}/{total}")
   ```

8. Make the fill-rate summary and the dry-run sample None-safe. Replace line
   1095:

   ```python
           filled = sum(1 for r in rows if r.get(field, "").strip())
   ```

   with:

   ```python
           filled = sum(1 for r in rows if (r.get(field) or "").strip())
   ```

   and the sample block at lines 1105-1111 with:

   ```python
               print(
                   f"  {s.get('citation') or '?':30s} | "
                   f"{s.get('applicant_name') or '':20s} | "
                   f"{s.get('country_of_origin') or '':20s} | "
                   f"SC{s.get('visa_subclass_number') or '':>3s} | "
                   f"{s.get('is_represented') or ''}"
               )
   ```

   Finally make the two remaining `.get(..., "")` reads on lines 1029 and 1124
   None-safe:

   ```python
           rows = [r for r in rows if (r.get("court_code") or "") == args.court]
   ```

   ```python
                   cid = row.get("case_id") or ""
   ```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "import extract_structured_fields as e; print(e.CHECKPOINT_EVERY, callable(e.backup_csv), callable(e.process_case), e._union_fieldnames([{'a':1},{'b':2,None:['x']}]))" && grep -n "bak_extract" extract_structured_fields.py ; make lint
```
→ prints `5000 True True ['a', 'b']`; the `grep` prints **nothing** and exits 1;
then `All checks passed!`.

Commit: `fix: checkpoint the extraction run and stop overwriting its only backup`

### Step 8: Make the validator survive an empty result set, and add the script tests

Addresses PYCORR-23. All edits in `validate_extraction.py` plus the new test
file that covers both root scripts.

1. Guard `print_fill_rates`. Insert after the court filter (i.e. after line 65,
   `        total = len(rows)`, and before the `title = ...` line):

   ```python
       if not rows:
           print(f"\n{'='*70}")
           print(f"No rows match{' court ' + court_filter if court_filter else ''}")
           print(f"{'='*70}")
           return
   ```

   This removes the `rows[0]` IndexError on line 75 — the crash reachable from
   `python validate_extraction.py --court NOSUCH`.

2. Guard `compare_to_baseline`. Insert at the top of the function, immediately
   after `    baseline = load_csv(baseline_path)` and
   `    baseline_map = {...}` (i.e. before the `print(f"\n{'='*70}")` block):

   ```python
       if not current:
           print("No current rows to compare.")
           return
   ```

3. Guard the sample loop in `main`. Replace line 221,
   `            if field in rows[0]:` with:

   ```python
               if rows and field in rows[0]:
   ```

4. Make every value read None-safe. Replace these exact lines:

   - line 78: `        filled = sum(1 for r in rows if r.get(field, "").strip())`
     → `        filled = sum(1 for r in rows if (r.get(field) or "").strip())`
   - line 100: `            n = sum(1 for r in court_rows if r.get(field, "").strip())`
     → `            n = sum(1 for r in court_rows if (r.get(field) or "").strip())`
   - line 116: `    garbage_country = [r for r in rows if is_garbage_country(r.get("country_of_origin", ""))]`
     → `    garbage_country = [r for r in rows if is_garbage_country(r.get("country_of_origin") or "")]`
   - line 132: `    long_countries = [r for r in rows if len(r.get("country_of_origin", "")) > 50]`
     → `    long_countries = [r for r in rows if len(r.get("country_of_origin") or "") > 50]`
   - line 144: `    filled = [r for r in rows if r.get(field, "").strip()]`
     → `    filled = [r for r in rows if (r.get(field) or "").strip()]`
   - line 174: `            if baseline_map.get(r.get("case_id", ""), {}).get(field, "").strip()`
     → `            if (baseline_map.get(r.get("case_id") or "", {}).get(field) or "").strip()`
   - line 176: `        curr_filled = sum(1 for r in current if r.get(field, "").strip())`
     → `        curr_filled = sum(1 for r in current if (r.get(field) or "").strip())`
   - lines 182-184:
     ```python
               cid = r.get("case_id", "")
               baseline_val = baseline_map.get(cid, {}).get(field, "")
               curr_val = r.get(field, "")
     ```
     →
     ```python
               cid = r.get("case_id") or ""
               baseline_val = baseline_map.get(cid, {}).get(field) or ""
               curr_val = r.get(field) or ""
     ```
   - lines 94 and 85, the two `court_code` reads:
     `        court_rows = [r for r in rows if r.get("court_code", "") == court]`
     → `        court_rows = [r for r in rows if (r.get("court_code") or "") == court]`
     and `    courts = sorted(set(r.get("court_code", "?") for r in rows))`
     → `    courts = sorted(set(r.get("court_code") or "?" for r in rows))`

   Leave lines 120, 123, 136 and 154 alone — they feed `repr()` / `Counter`,
   which accept `None` without raising.

5. Create `tests/test_extraction_scripts.py`:

   ```python
   """Regression tests for the two root-level extraction/validation scripts."""

   import csv

   import extract_structured_fields as extract_script
   import validate_extraction as validate_script


   def _write_csv(path, rows, fieldnames):
       with open(path, "w", encoding="utf-8-sig", newline="") as f:
           writer = csv.DictWriter(f, fieldnames=fieldnames)
           writer.writeheader()
           writer.writerows(rows)


   def test_process_case_swallows_a_worker_exception(monkeypatch, capsys):
       """One unparseable row must not abort a 149k-row ProcessPoolExecutor run.

       executor.map re-raises a worker exception at consumption time and then
       cancels every remaining future, so the wrapper — not the consumer loop —
       is what has to hold.
       """
       def boom(_row):
           raise ValueError("synthetic parser explosion")

       monkeypatch.setattr(extract_script, "_extract_case_fields", boom)

       assert extract_script.process_case({"case_id": "abc123"}) == {}
       assert "abc123" in capsys.readouterr().err


   def test_process_case_tolerates_a_row_of_none_values():
       """csv.DictReader gives None for a short row's cells; no field may be None."""
       result = extract_script.process_case(
           {"title": None, "citation": None, "visa_subclass": None,
            "visa_type": None, "full_text_path": None}
       )

       assert result["applicant_name"] == ""
       assert all(isinstance(value, str) for value in result.values())


   def test_union_fieldnames_covers_every_row_and_drops_the_restkey():
       """A late row's extra column must reach the header; the None restkey must not."""
       names = extract_script._union_fieldnames(
           [{"a": "1"}, {"a": "2", "b": "3"}, {"c": "4", None: ["overflow"]}]
       )

       assert names == ["a", "b", "c"]


   def test_backup_csv_is_timestamped_and_keeps_the_previous_snapshot(tmp_path, monkeypatch):
       """A rerun must not destroy the last known-good backup."""
       csv_path = tmp_path / "immigration_cases.csv"
       _write_csv(csv_path, [{"case_id": "a1", "title": "One"}], ["case_id", "title"])
       monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)

       first = extract_script.backup_csv()
       second = extract_script.backup_csv()

       assert first is not None and first.exists()
       assert second is not None and second.exists()
       assert first.name.startswith("immigration_cases.csv.bak-")
       assert len(list(tmp_path.glob("immigration_cases.csv.bak-*"))) >= 1


   def test_save_csv_writes_columns_that_only_later_rows_have(tmp_path, monkeypatch):
       """The header used to come from rows[0] alone, silently dropping new columns."""
       csv_path = tmp_path / "immigration_cases.csv"
       _write_csv(csv_path, [{"case_id": "a1"}], ["case_id"])
       monkeypatch.setattr(extract_script, "CSV_PATH", csv_path)

       extract_script.save_csv([{"case_id": "a1"}, {"case_id": "a2", "country_of_origin": "India"}])

       with open(csv_path, encoding="utf-8-sig") as f:
           written = list(csv.DictReader(f))

       assert written[1]["country_of_origin"] == "India"


   def test_print_fill_rates_survives_a_court_filter_that_matches_nothing(capsys):
       """`validate_extraction.py --court NOSUCH` used to raise IndexError."""
       rows = [{"court_code": "AATA", "applicant_name": "Jane"}]

       validate_script.print_fill_rates(rows, court_filter="NOSUCH")

       assert "No rows match" in capsys.readouterr().out


   def test_print_fill_rates_tolerates_none_values(capsys):
       """A short CSV row gives None, which .strip() cannot take."""
       rows = [{"court_code": "AATA", "applicant_name": None}]

       validate_script.print_fill_rates(rows)

       assert "applicant_name" in capsys.readouterr().out
   ```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_extraction_scripts.py -q --no-cov 2>&1 | tail -3 && .venv/bin/ruff check tests/test_case_identity.py tests/test_extraction_llm_client.py tests/test_extraction_scripts.py tests/test_austlii.py && make lint
```
→ `7 passed`, then `All checks passed!` twice.

Commit: `fix: stop validate_extraction crashing on an empty filtered result set`

### Step 9: Run the full gates

No code changes. Confirm nothing outside this plan regressed.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | tail -6
```
→ `1159 passed, 3 failed, 7 skipped`. The 3 failures must be **exactly** the
three `ImportError` failures in `tests/test_backfill_judge_overrides_from_pdf.py`
that exist at `42826a3` (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI
mismatch: `Symbol not found: _XML_SetAllocTrackerActivationThreshold`, which
breaks the `pypdf` import chain). Confirm with:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | grep -cE "FAILED|ERROR"
```
→ `3`. Then check they are the expected three:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | grep -E "FAILED|ERROR" | grep -cv "test_backfill_judge_overrides_from_pdf.py"
```
→ `0`. (Do not anchor the pattern with `^` — pytest emits ANSI colour codes
before the word `FAILED` even when its output is piped.)

Then:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint && git status --short
```
→ `All checks passed!`. `git status --short` must list **only** the ten files in
the "In scope" list, plus two entries that were already there before you started
and are not yours: ` M .claude/STATE.md` and the untracked `plans/` directory
(or `?? plans/029-harden-scraper-and-extraction.md` once `plans/` is tracked).
Do not stage, revert, or edit either of those.

Commit: nothing to commit — this step is verification only.

## Test plan

New and changed tests, by file:

**`tests/test_austlii.py`** (modify; 34 → 38)
- `TestBrowseYear::test_both_fail_raises_year_listing_unavailable` — replaces
  `test_both_fail_returns_empty`; both fetches 500 → `YearListingUnavailable`.
- `TestBrowseYear::test_listing_without_matches_returns_empty_list` — a 200 with
  one non-immigration link → `[]`, proving the two outcomes stay distinct.
- `TestSearchDatabase::test_failed_year_is_skipped_not_fatal` — 2023 raises,
  2024 succeeds → only 2024's case is returned.
- `TestSearchDatabase::test_truncation_keeps_the_newest_years` — 30 cases over
  2020–2024 with `max_results=6` → all six returned are from 2024.
- `TestExtractMetadataGuard::test_unknown_metadata_key_is_dropped` — a stubbed
  extractor emitting `not_a_field` → the declared key lands, the unknown one
  does not.

**`tests/test_case_identity.py`** (create; 4 tests)
- Blank-key cases get distinct ids; the fallback id is stable across calls; a
  literal `0` survives `from_dict`; NaN/`"nan"`/`None` are still cleaned.

**`tests/test_extraction_llm_client.py`** (create; 3 tests)
- Non-UTF-8 body → `({}, 0.0)` and no raise; malformed JSON → `({}, 0.0)`;
  valid body → parsed values plus the `0.0004` cost from `_estimate_cost`.

**`tests/test_extraction_scripts.py`** (create; 7 tests)
- `process_case` returns `{}` and names the row on stderr when the inner
  extractor raises; `process_case` yields only `str` values for an all-`None`
  row; `_union_fieldnames` covers late columns and drops the `None` restkey;
  `backup_csv` produces a timestamped name and a second call does not clobber
  the first; `save_csv` writes a column only a later row has;
  `print_fill_rates` prints "No rows match" instead of raising `IndexError`;
  `print_fill_rates` tolerates a `None` cell.

Structural pattern to follow: `tests/test_austlii.py` (class-per-behaviour,
`responses.activate` for HTTP, descriptive test names with a one-line docstring
stating the behaviour) and `tests/test_extraction_regex.py` (flat functions for
pure helpers).

Which of these fail before their fix (checked against `42826a3`):
`test_both_fail_raises_year_listing_unavailable`,
`test_truncation_keeps_the_newest_years`,
`test_blank_key_cases_do_not_share_one_id`,
`test_from_dict_preserves_zero_like_values`,
`test_non_utf8_body_returns_no_extraction_instead_of_raising`,
`test_process_case_swallows_a_worker_exception`,
`test_save_csv_writes_columns_that_only_later_rows_have`,
`test_print_fill_rates_survives_a_court_filter_that_matches_nothing`. The rest
are regression guards that already pass today and must keep passing — in
particular `test_process_case_tolerates_a_row_of_none_values` passes at
`42826a3` (verified: an all-`None` row already returns a dict of empty strings),
so do not expect it to go red first.

Suite arithmetic: `42826a3` baseline is `1141 passed, 3 failed, 7 skipped`.
This plan nets +4 in `tests/test_austlii.py` (5 tests added, 1 replaced in
place: 34 → 38) plus 4 + 3 + 7 = 14 in the three new files, so **+18** →
`1159 passed, 3 failed, 7 skipped`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `make test-py` reports `1159 passed, 3 failed, 7 skipped`
- [ ] `make test-py 2>&1 | grep -E "FAILED|ERROR" | grep -cv "test_backfill_judge_overrides_from_pdf.py"` prints `0`
- [ ] `make lint` exits 0 with `All checks passed!`
- [ ] `.venv/bin/ruff check tests/test_case_identity.py tests/test_extraction_llm_client.py tests/test_extraction_scripts.py tests/test_austlii.py` exits 0
- [ ] `grep -rn "require_auth\|optional_auth\|require_tenant_membership\|immi_repo\|check_tenant_membership" --include="*.py" immi_case_downloader/ tests/ scripts/` returns no matches (exit 1)
- [ ] `grep -n "bak_extract" extract_structured_fields.py` returns no matches (exit 1)
- [ ] `grep -n "return cases\[:max_results\]" immi_case_downloader/sources/austlii.py` returns exactly one line, and it sits inside the `if len(cases) > max_results:` block
- [ ] `grep -c "YearListingUnavailable" immi_case_downloader/sources/austlii.py` returns `4` (class definition, the `raise`, the docstring mention, the `except`)
- [ ] `.venv/bin/python -c "import extract_structured_fields, validate_extraction; print('ok')"` prints `ok`
- [ ] `git status --short` lists only the ten files named in "In scope", plus the
      pre-existing ` M .claude/STATE.md` and the untracked `plans/` entry
- [ ] `git diff 42826a3..HEAD --stat -- immi_case_downloader/pipeline.py immi_case_downloader/sources/metadata_extractor.py immi_case_downloader/storage.py immi_case_downloader/web/internal_extract.py immi_case_downloader/web/jobs.py download_fulltext.py` produces no output

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file produces output, or any "Current
  state" excerpt does not match the live code byte for byte. The line numbers in
  `extract_structured_fields.py` in particular are load-bearing for step 7 —
  if `save_csv` is no longer at 986-1005, re-locate every anchor before editing.
- **`make test-py` shows a different failure count than `3`, or a failure in any
  file other than `tests/test_backfill_judge_overrides_from_pdf.py`.** Those
  three are a known Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI problem, not
  a code problem; anything else is yours and means a step regressed something.
- Step 1's raise breaks a test in `tests/test_pipeline.py`. That file mocks
  `_browse_year` at `tests/test_pipeline.py:200`
  (`mock_scraper._browse_year.return_value = [case]`) and should be unaffected
  because a list is not an exception — if it is affected, the mock has changed
  and you must not edit that file (a separate plan owns it).
- Step 4's `_is_missing` change makes any test in `tests/test_models.py`,
  `tests/test_storage.py`, `tests/test_sqlite_repository.py` or
  `tests/test_supabase_repository.py` fail. That would mean some repository is
  feeding a real `0`/`False` through `from_dict` and relying on it being blanked
  — a behaviour question for the operator, not something to paper over. Report
  the failing assertion and stop.
- Step 6's grep still finds `check_tenant_membership` or `immi_repo` after the
  deletion, i.e. something outside `immi_case_downloader/web/auth.py` depends on
  the decorators after all. Do not delete anything further; report.
- Step 7's checkpoint would write to a real corpus. **Never run
  `python extract_structured_fields.py` against `downloaded_cases/` while
  testing** — the tests monkeypatch `CSV_PATH` to a `tmp_path` for exactly this
  reason. If you find yourself wanting to run the real script to verify, stop
  and report instead.
- A fix appears to require editing `immi_case_downloader/pipeline.py`,
  `immi_case_downloader/web/jobs.py`, `immi_case_downloader/storage.py`,
  `immi_case_downloader/web/internal_extract.py`, `download_fulltext.py`, or any
  test file other than `tests/test_austlii.py`. Every step here is designed to
  avoid that; needing it means the design assumption broke.

## Maintenance notes

For whoever owns this code next:

- **The `_browse_year` contract is now load-bearing.** `[]` means "loaded, no
  matches"; `YearListingUnavailable` means "could not load". `SmartPipeline`'s
  strategy rotation depends on that distinction and on
  `_crawl_with_fallback`'s broad `except Exception` at
  `immi_case_downloader/pipeline.py:406`. If anyone narrows that `except`,
  rotation silently breaks again — add `YearListingUnavailable` to the caught
  tuple at that point.
- **What a reviewer should scrutinise**: the checkpoint write in step 7. It
  relies on `rows` and `all_rows` sharing dict objects (the `--court` filter and
  `random.sample` both keep references rather than copying), which is why
  `save_csv(all_rows)` mid-loop captures the subset's mutations. If anyone ever
  makes that filter copy its rows, the checkpoint quietly writes stale data —
  make it copy from `rows` explicitly at that point.
- **Checkpoint cost**: every 5,000 rows the script now rewrites the whole
  ~149,000-row CSV — roughly 30 full rewrites per run. That is the price of not
  losing 11 minutes of work. If the corpus grows past a few hundred thousand
  rows, switch to an append-only sidecar plus a single merge at the end rather
  than raising `CHECKPOINT_EVERY`.
- **Backups now accumulate.** `backup_csv()` writes one timestamped file per
  run and nothing prunes them. Add a retention sweep (or a `--no-backup` flag)
  if `downloaded_cases/` starts filling up.
- **Deliberately deferred out of this plan**, all outside its file territory:
  1. `immi_case_downloader/web/internal_extract.py:40` — the per-item loop body
     still has no `try/except`, so any exception escaping `extract_regex` or
     `extract_llm` discards the whole batch. Step 5 closed the only escape path
     that was actually identified (`UnicodeDecodeError` from `llm.py:67`), so
     what remains is defence-in-depth. Fix it when that file is next opened.
  2. `immi_case_downloader/storage.py:113` — `f"case_{hash(case.url) % 100000}"`
     uses the `PYTHONHASHSEED`-randomised builtin `hash()`, so the same case
     could get different filenames across processes. It is unreachable today
     (`save_case_text`'s fallback chain is `citation or case_id or title`, and
     `ensure_id()` populates `case_id` on every `load_all()` path at
     `storage.py:222`), but it should become a `hashlib` digest whenever that
     file is touched.
  3. `immi_case_downloader/web/jobs.py` — `_run_search_job` (around line 94) has
     no caller anywhere in the repository. Deleting it is a dead-code plan's
     call, not this one's.
- **Do not re-add route decorators to `immi_case_downloader/web/auth.py`.** The
  module docstring written in step 6 explains why; production tenancy is
  enforced by `CloudflareIdentityStore.assertMembership()` in
  `workers/storage/cloudflare.js`, which is app-layer (there is no Postgres and
  no RLS in this stack).

## Findings reconsidered

- **PYCORR-15, the affected surface**: the original report blamed the web search
  job. `_run_search_job` (`immi_case_downloader/web/jobs.py`) has **no caller
  anywhere in the repository** — no route, no module, no test — so it is dead
  code and cannot be an affected surface. The live path is the CLI
  (`immi_case_downloader/cli.py:49-53`, argparse default 500 at `cli.py:273-277`).
  The truncation defect itself is real and is fixed in step 2.
- **PYCORR-17, the cited line**: the report cited `immi_case_downloader/pipeline.py:431`
  as the `direct` strategy's return. Line 429 is the `def`, line 431 is
  `if strategy == "direct":` and line 432 is the return. Corrected from a direct
  read; the defect is real and is fixed in step 1.
- **PYCORR-18, the "only save_csv"**: the report said `save_csv` is reached once,
  at line 1130. It is reached at **1130 or 1132** — two call sites, one per
  branch of the filtered/unfiltered split. Immaterial to the fix; corrected for
  accuracy. The report's "malformed CSV" premise for the `None`-value crash is
  also weaker than stated: the `csv` module and pandas both quote embedded commas
  and newlines correctly, so ordinary scraped case text does not produce short
  rows. Step 7 still applies the coercions as cheap hardening, but the
  checkpointing and timestamped backup are the real fix.
- **PYCORR-19, the cost-accounting half — dropped.** The report claimed
  `_estimate_cost` under-counts spend because a JSON parse failure returns cost
  `0`. That is documented, intentional anti-spend-amplification behaviour in the
  function's own docstring (`immi_case_downloader/extraction/llm.py:35-40`,
  quoted in "Current state"), and `cost_usd` in
  `immi_case_downloader/web/internal_extract.py:32` is a per-request local reset
  on every batch, so `PIPELINE_RUN_COST_CAP_USD * 0.8` was never a per-run cap
  to begin with. No change made. The decode half is real and is fixed in step 5.
- **PYCORR-22, "fails open" — downgraded to dead-code hygiene.** The report
  framed `require_tenant_membership` as an authorization defect. It is not
  reachable from anywhere: the three decorators have zero call sites, and **no
  class in the repository defines `check_tenant_membership`**, so the
  `if repo and hasattr(...)` guard at `auth.py:179` would be skipped even with a
  corrected container lookup. `CLAUDE.md` also documents this module as
  local-dev only, outside the production request path. Step 6 therefore deletes
  rather than repairs. The report's separate claim that the exp/type checks
  preceding signature verification is a vulnerability is also wrong — an early
  check can only *reject*, so it fails closed; step 6 reorders anyway as
  hygiene, not as a security fix.
- **PYCORR-25 and PYCORR-26 — reclassified as latent hardening, not live bugs.**
  Every `ImmigrationCase` field except `year` is declared `str`
  (`immi_case_downloader/models.py:11-41`), so a genuine `0`/`False` never
  legitimately reaches the falsy coercion; the empty-key `ensure_id` branch is
  unreachable through the API because
  `immi_case_downloader/web/routes/api_cases.py:968-969` rejects a case with
  neither title nor citation; and `MetadataExtractor.extract` emits only the
  seven keys listed in its own contract at
  `immi_case_downloader/sources/metadata_extractor.py:96-98`, every one of which
  is a declared field. Steps 3 and 4 still land the guards — they are a few lines
  each and change no current output — but they are insurance against a future
  schema change, and no reviewer should expect a behaviour difference from them
  today. The one sub-item **not** actioned is `immi_case_downloader/storage.py:113`
  (`hash(case.url)`): the file is outside this plan's territory and the line is
  unreachable because `ensure_id()` always populates `case_id` before any
  download job calls `save_case_text`. Recorded under "Maintenance notes".
