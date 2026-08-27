# Plan 032: Collapse ten divergent copies of one LLM extraction job

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or `plans/README.md` does not exist (it does not exist
> at the time of writing; if it is still absent, skip that update silently).
>
> **Drift check (run first)**. A `42826a3..HEAD` diff is blind to uncommitted,
> staged and untracked work, so run **all four** commands below over the same
> path list; a dirty tree would otherwise hand you a false all-clear. Any
> in-scope path appearing in any of them is a STOP condition. **Never** run an
> unconditional `git checkout -- …`, `git restore …` or `git clean -f` to tidy
> the tree — those changes may be the operator's.
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS='Dockerfile Dockerfile.extractor entrypoint.sh
> extract_llm_fields.py extract_llm_structured.py extract_with_llm.py
> extract_structured_fields.py extract_structured_fields_llm.py extract_container.py
> merge_llm_results.py merge_llm_structured.py merge_llm_extraction.py
> fill_country_gemini.py fill_outcomes_gemini.py
> immi_case_downloader/extraction immi_case_downloader/web/internal_extract.py
> immi_case_downloader/cli.py scripts/fetch_judge_photos.py scripts/README.md archive
> tests/test_extraction_container_boundary.py tests/test_internal_extract.py
> tests/test_cli_extended.py'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS
> git diff --stat               -- $PATHS   # unstaged
> git diff --cached --stat      -- $PATHS   # staged
> git status --short --untracked-files=all -- $PATHS
> ```
>
> **Expected drift you should NOT stop for**: `extract_structured_fields.py`,
> `immi_case_downloader/extraction/regex.py` and `tests/` changes are expected
> if `plans/041-cover-the-extraction-scripts.md` has landed — it is a hard
> prerequisite of this plan (see Status). Anything else is a STOP.
>
> <details><summary>Original (insufficient) form, kept for reference</summary>
>
> ```bash
> git diff --stat 42826a3..HEAD -- \
>   Dockerfile Dockerfile.extractor entrypoint.sh \
>   extract_llm_fields.py extract_llm_structured.py extract_with_llm.py \
>   extract_structured_fields.py extract_structured_fields_llm.py \
>   extract_container.py \
>   merge_llm_results.py merge_llm_structured.py merge_llm_extraction.py \
>   fill_country_gemini.py fill_outcomes_gemini.py \
>   immi_case_downloader/extraction immi_case_downloader/web/internal_extract.py \
>   immi_case_downloader/cli.py scripts/fetch_judge_photos.py \
>   tests/test_extraction_container_boundary.py tests/test_internal_extract.py \
>   tests/test_cli_extended.py
> ```
> </details>

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/041-cover-the-extraction-scripts.md` (**hard**),
  `plans/003-lint-the-test-suite.md`
- **Must run BEFORE**: `plans/036-bound-the-python-dependencies.md`
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

**Why 041 is a hard prerequisite.** Step 5 of this plan moves lines 32–874 of
`extract_structured_fields.py` — 843 lines of hand-tuned regex that decide eight
fields across 149,016 catalog rows — into a new package module. At `42826a3`
exactly one test asserts anything about any of it. A "verbatim move" that
silently drops or reorders one pattern would not be caught by any gate this plan
can run. `plans/041-cover-the-extraction-scripts.md` adds the characterization
tests that make the move detectable; run it first, on the same branch. If 041
has not landed, do **not** start Step 5.

**Why this plan must precede 036.** Step 1 deletes `Dockerfile.extractor`.
`plans/036-bound-the-python-dependencies.md` edits that file and lists it in its
own Done criteria. Running 036 first, or in parallel, guarantees one of the two
fails. Order is 032 → 036; 036's own text has been corrected to expect only the
surviving `Dockerfile`.

## Why this matters

Six different repo-root scripts each build the byte-identical temp path
`downloaded_cases/immigration_cases.csv.tmp`, fill it, and `os.replace` it onto
the live 149,016-row catalog. There is no lockfile anywhere. Two of these jobs
running at once — which is exactly what a long batch job invites, since each one
takes 12+ minutes and none of them says "don't start me twice" — silently
destroys a dataset that is `.gitignore`d and cannot be regenerated from the
repository. On top of that the installable package imports *upward* into a
1,136-line repo-root script, so `immi_case_downloader.extraction` cannot be
imported from any directory that lacks the repo root on `sys.path`; the
extraction container only works today because its Dockerfile happens to copy the
root script in beside it. This plan makes concurrent catalog corruption
impossible, inverts the package import back to the correct direction, unifies the
two drifted copies of the `/internal/extract` handler onto the hardened one, and
deletes four files that are provably dead.

## Current state

### The files this plan touches, and what each is

| File | Role |
|---|---|
| `extract_llm_fields.py` | Claude Sonnet batch extraction of `case_nature` / `legal_concepts`. Documented in `CLAUDE.md:43`. **Keep.** |
| `merge_llm_results.py` | Merges `downloaded_cases/llm_batches/result_*.json` into the CSV. Documented in `CLAUDE.md:44`. **Keep.** |
| `extract_structured_fields.py` | 1,136-line regex extractor + CLI. Documented in `README.md:285`; copied into the container image. **Keep, split.** |
| `extract_structured_fields_llm.py` | Anthropic-direct LLM fallback extractor. Documented in `README.md:288` and `CLAUDE.md:70`. **Keep.** |
| `extract_llm_structured.py` | Another Sonnet structured extractor. Referenced nowhere but its own docstring. **Archive.** |
| `merge_llm_structured.py` | Merger for the above. Referenced nowhere but its own docstring. **Archive.** |
| `extract_with_llm.py` | Yet another Sonnet extractor (outcome + legal_concepts). Referenced nowhere but its own docstring. **Archive.** |
| `merge_llm_extraction.py` | Merger for the above; writes the CSV non-atomically with `df.to_csv`. Referenced nowhere but its own docstring. **Archive.** |
| `fill_country_gemini.py`, `fill_outcomes_gemini.py` | Gemini backfills that write `downloaded_cases/cases.db` (SQLite), not the CSV. **Keep; only the duplicated env loader changes.** |
| `extract_container.py` | Flask app run by the container image (`Dockerfile:17`). The *hardened* copy of `/internal/extract`. |
| `immi_case_downloader/web/internal_extract.py` | Flask blueprint registered on every app (`web/__init__.py:155-156`). The *weakened* copy of the same handler. |
| `immi_case_downloader/extraction/regex.py` | Package module that imports nine symbols upward from the repo-root script. |
| `immi_case_downloader/cli.py` | `run.py` CLI. `cmd_search` runs the dead Federal Court scraper under `--sources all`, which is the default. |
| `Dockerfile`, `Dockerfile.extractor` | Byte-identical apart from a 3-line comment header. |
| `entrypoint.sh` | Orphan: launches a Flask+Supabase container that no longer exists. |
| `scripts/fetch_judge_photos.py` | Judge-photo scraper hardcoded to a path that does not exist on this machine. |

### DEBT-09 — six scripts, one temp path, no lock

`downloaded_cases/immigration_cases.csv` is `.gitignore`d and is **not present in
CI**. Every one of these six writes the same temp file. Verified with
`.venv/bin/python`: `Path('downloaded_cases/immigration_cases.csv').with_suffix('.csv.tmp')`
and `'downloaded_cases/immigration_cases.csv' + '.tmp'` both produce
`downloaded_cases/immigration_cases.csv.tmp`.

`extract_llm_fields.py:49-59`:

```python
def save_csv(rows):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    # Write to temp file first, then rename (atomic save)
    tmp_path = CSV_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp_path, CSV_PATH)
```

`merge_llm_results.py:22-31`:

```python
def save_csv(rows):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    tmp_path = CSV_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp_path, CSV_PATH)
```

`extract_structured_fields.py:986-1005`:

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

`extract_structured_fields_llm.py:122-134`:

```python
def save_csv(rows: list[dict]):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    backup_path = CSV_PATH.with_suffix(".csv.bak_llm_structured")
    if not backup_path.exists():
        shutil.copy2(CSV_PATH, backup_path)
    tmp_path = CSV_PATH.with_suffix(".csv.tmp")
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(str(tmp_path), str(CSV_PATH))
```

`extract_llm_structured.py:533-542` and `merge_llm_structured.py:38-47` contain
the same `tmp_path = CSV_PATH.with_suffix(".csv.tmp")` /
`os.replace(str(tmp_path), str(CSV_PATH))` pair. Both of those two are archived
by this plan rather than fixed.

`_find_and_load_env` is defined five times. Three are in this plan's territory
and are *not* identical — `extract_structured_fields_llm.py:37-50` has an extra
`.auto-claude` skip that the other two lack:

`fill_country_gemini.py:36-45`:

```python
def _find_and_load_env():
    p = Path(__file__).parent
    for _ in range(8):
        candidate = p / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=True)
            return
        p = p.parent

_find_and_load_env()
```

`extract_structured_fields_llm.py:36-51`:

```python
# Load .env — search from script dir upward for the project .env
def _find_and_load_env():
    p = Path(__file__).parent
    for _ in range(8):  # search up to 8 levels up
        # Skip .auto-claude dirs (Claude Code infrastructure, not project)
        if p.name == ".auto-claude" or p.name.startswith(".auto-claude"):
            p = p.parent
            continue
        candidate = p / ".env"
        if candidate.exists():
            # override=True so .env key takes precedence over env
            load_dotenv(candidate, override=True)
            return
        p = p.parent

_find_and_load_env()
```

The other two copies (`sync_judge_bios_supabase.py:22`, `sync_outcomes_supabase.py:24`)
are **out of scope** — see Scope.

`Makefile:92-93` shows why an `archive/` directory needs no Makefile change —
the `*.py` glob is repo-root only and `archive/` is not passed to ruff:

```make
lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py
```

### DEBT-11 — the package imports a repo-root script

`immi_case_downloader/extraction/regex.py:1-24` (verbatim):

```python
"""Regex extraction helpers for text already loaded in memory.

The legacy ``extract_structured_fields.py`` script is CLI-shaped and reads text
from case_text files. This module reuses its helper functions without changing
that script's behaviour, so the Cloudflare container endpoint can extract from
R2-provided text directly.
"""

from __future__ import annotations

import re
from typing import Any

from extract_structured_fields import (
    RE_AATA_APPLICANT,
    RE_AATA_REPRESENTATIVE,
    extract_country,
    extract_from_title,
    extract_hearing_date,
    extract_legal_test,
    extract_representation,
    extract_visa_outcome_reason,
    extract_visa_subclass_number,
)
```

`ls pyproject.toml setup.py setup.cfg` returns three "No such file or directory"
errors — nothing declares or enforces the `sys.path` assumption.

`extract_structured_fields.py` splits cleanly. Verified with a top-level symbol
map: lines 29–30 are CLI path constants, **lines 32–874 are pure regex constants
and pure extraction functions**, and lines 876–1136 are the CLI runner
(`process_case`, `load_csv`, `save_csv`, `main`). Nothing in 32–874 references
`CASES_DIR`, `CSV_PATH`, `os`, `sys`, `shutil`, `csv`, `argparse` or
`ProcessPoolExecutor`; the only non-`re` name it needs is `Counter`
(used at line 870 inside `extract_legal_test`). `process_case` uses exactly the
same nine names `regex.py` imports, and `main()` uses none of them.

Both `Dockerfile:10` and `Dockerfile.extractor:7` read:

```
COPY extract_container.py extract_structured_fields.py ./
```

so the container works today by co-location, not by design.

### DEBT-06 — `/internal/extract` exists twice and has drifted

`extract_container.py:26-38` — the hardened copy (shared secret + batch cap):

```python
@app.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker" or request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    shared_secret = os.environ.get("EXTRACTION_SHARED_SECRET", "")
    if not shared_secret or request.headers.get("X-Extraction-Token") != shared_secret:
        return jsonify({"error": "Forbidden", "code": "invalid_extraction_token"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list) or len(batch) > 20:
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400
```

`immi_case_downloader/web/internal_extract.py:15-26` — the weakened copy
(no secret, no cap):

```python
@internal_extract_bp.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    if request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_cron_extract"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = _text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list):
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400
```

The two bodies below those guards are otherwise the same logic, the same env
constants, the same cost cap and the same field-envelope response shape.
`immi_case_downloader/web/__init__.py:152-156`:

```python
    # Register internal Cloudflare pipeline endpoint. It has its own Worker
    # service-binding guard and is CSRF-exempt because it is not browser-facing.
    from .internal_extract import internal_extract_bp
    app.register_blueprint(internal_extract_bp)
```

`tests/test_internal_extract.py:15-32` currently asserts that the *unauthenticated*
request succeeds, and must change with the handler:

```python
def test_internal_extract_requires_worker_and_subtype_headers():
    client = _app().test_client()
    payload = {"run_id": "run-1", "batch": []}

    assert client.post("/internal/extract", json=payload).status_code == 403
    assert client.post(
        "/internal/extract",
        json=payload,
        headers={"X-Internal-Route": "worker"},
    ).status_code == 403
    assert client.post(
        "/internal/extract",
        json=payload,
        headers={
            "X-Internal-Route": "worker",
            "X-Internal-Route-Subtype": "cron-extract",
        },
    ).status_code == 200
```

### DEBT-18 — a judge-photo script hardcoded to a nonexistent path

`scripts/fetch_judge_photos.py:1-22` (verbatim; note the ROOT is **line 18**, not
line 19 — the audit cited the wrong line):

```python
#!/usr/bin/env python3
"""Brave Image Search → judge photo discovery pipeline.

For each judge in judge_bios.json:
  1. Run brave_image_search via docker mcp gateway
  2. Filter results: drop stock-photo/profile-farm domains, require min 200x200
  3. Score by source-domain authority (.gov.au > .edu.au > conference > news)
  4. Output top-3 candidates per judge to JSON manifest for review

After review, human marks approved=true on rows, then `--download` will fetch them.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/Users/d/Developer/IMMI-Case-')
BIOS = ROOT / 'downloaded_cases' / 'judge_bios.json'
PHOTOS = ROOT / 'downloaded_cases' / 'judge_photos'
MANIFEST = ROOT / 'downloaded_cases' / 'judge_photo_manifest.json'
```

`ls -d /Users/d/Developer/IMMI-Case-` → `No such file or directory`. The repo is
at `/Users/d/Developer/Active Projects/IMMI-Case-`. The competing script
`scripts/fetch_judge_profile_images.py` (716 lines) solves the same problem and
resolves its root correctly at line 38:
`ROOT = Path(__file__).resolve().parents[1]`. A repo-wide grep finds **zero**
references to `fetch_judge_photos` outside the file itself. `scripts/README.md`
does not exist.

### DEBT-19 — the dead Federal Court scraper runs by default

`immi_case_downloader/cli.py:58-72`:

```python
    # Search Federal Court
    if "fedcourt" in args.sources or "all" in args.sources:
        fedcourt = FederalCourtScraper(delay=args.delay)

        print("Searching Federal Court of Australia...")
        cases = fedcourt.search_cases(
            start_year=args.start_year,
            end_year=args.end_year,
            max_results=args.max_results,
        )
        # Deduplicate against existing
        existing_urls = {c.url for c in all_cases}
        new_cases = [c for c in cases if c.url not in existing_urls]
        all_cases.extend(new_cases)
        print(f"Found {len(new_cases)} additional cases on Federal Court")
```

`immi_case_downloader/cli.py:247-252`:

```python
    search_parser.add_argument(
        "--sources",
        nargs="+",
        default=["all"],
        choices=["all", "austlii", "fedcourt"],
        help="Sources to search (default: all)",
    )
```

`immi_case_downloader/cli.py:193-196`:

```python
    print("Other Sources:")
    print("=" * 60)
    print("  fedcourt       Federal Court of Australia Judgment Search")
    print("                 search2.fedcourt.gov.au")
```

`immi_case_downloader/config.py:83-84`:

```python
# Federal Court judgments search
FEDERAL_COURT_SEARCH = "https://search2.fedcourt.gov.au/s/search.html"
```

`CLAUDE.md` records this host as non-resolving in two places ("**Federal Court
DNS** — `search2.fedcourt.gov.au` doesn't resolve; all FCA data via AustLII", and
the data-sources table row "`fedcourt` | Federal Court | … | (DNS broken)").
So `python run.py search` — the first command a user runs — retries an
unresolvable host on every invocation.

The test that encodes the current behaviour, `tests/test_cli_extended.py:121-140`:

```python
    @patch("immi_case_downloader.cli.FederalCourtScraper")
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_all_sources(self, mock_austlii_cls, mock_fc_cls, tmp_path):
        """cmd_search with sources=['all'] searches both AustLII and Federal Court."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        mock_austlii_cls.return_value.search_cases.return_value = [
            ImmigrationCase(citation="A", url="https://a.com/1", court_code="AATA", source="AustLII")
        ]
        mock_fc_cls.return_value.search_cases.return_value = [
            ImmigrationCase(citation="B", url="https://b.com/1", court_code="FCA", source="Federal Court")
        ]

        args = self._make_args(tmp_path, sources=["all"], databases=["AATA"])
        cmd_search(args)

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 2
```

`cmd_download` at `cli.py:139-152` also constructs a `FederalCourtScraper`, but
only *uses* it for rows where `case.source == "Federal Court"`. It is unaffected
by this plan and must not be changed.

### DX-19 / DEPS-15 — two identical Dockerfiles, one orphan entrypoint

`diff Dockerfile Dockerfile.extractor` reports exactly `1,3d0` — the only
difference is `Dockerfile`'s three-line comment header.

`Dockerfile` (verbatim, 17 lines):

```dockerfile
# Active Cloudflare Container image: extraction only.
# It has no database client, object-store binding or catalog writer. The
# pipeline Worker remains the sole owner of durable D1/R2/Vectorize writes.
FROM python:3.12-slim
WORKDIR /app

COPY requirements-extractor.txt .
RUN pip install --no-cache-dir -r requirements-extractor.txt

COPY extract_container.py extract_structured_fields.py ./
COPY immi_case_downloader/__init__.py ./immi_case_downloader/__init__.py
COPY immi_case_downloader/extraction ./immi_case_downloader/extraction

ENV APP_ENV=production
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "extract_container.py"]
```

`entrypoint.sh` is **8 lines** (the audit cited line 9; the file ends at 8):

```sh
#!/bin/sh
# Cloudflare Containers start with no working DNS resolver configured.
# Inject Cloudflare's public DNS (1.1.1.1) so outbound HTTPS works.
# *.hyperdrive.local still cannot be resolved via public DNS — that's OK
# because SupabaseRepository falls back gracefully when psycopg2 fails.
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf 2>/dev/null || true

exec python web.py --host 0.0.0.0 --port 8080 --backend supabase
```

A repo-wide grep for `entrypoint.sh` returns **no** reference from any
Dockerfile, wrangler config, workflow or doc.

Which Dockerfile survives is settled by three call sites that already name
`Dockerfile`:

- `config/wrangler-extraction-container.toml.example:19` → `image = "./Dockerfile"`
- `config/wrangler-legacy-rollback.toml.example:27` → `image = "./Dockerfile"`
- `scripts/verify_immi_separation.py:221` → `immi_root / "Dockerfile",`

Only one file names `Dockerfile.extractor` —
`tests/test_extraction_container_boundary.py:9-15`:

```python
def test_extraction_image_and_source_have_no_database_runtime_markers() -> None:
    source = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in ("Dockerfile", "Dockerfile.extractor", "extract_container.py", "requirements-extractor.txt")
    ).lower()
    for marker in ("supabase", "postgres", "hyperdrive", "database_url", "service_role"):
        assert marker not in source, marker
```

`requirements-extractor.txt` is one line: `flask>=3.0.0,<4`.

### Repo conventions this plan must honour

- **Commit messages**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.
- **Python style**: PEP 8, type annotations on function signatures, `ruff` is the
  linter. Prefer immutable operations; never mutate a caller's list in place.
- **Cases are constructed via `ImmigrationCase.from_dict()`** (the dataclass lives
  in `immi_case_downloader/models.py`) because pandas turns empty CSV fields into
  `float('nan')`. This plan does not construct cases, but do not introduce a code
  path that bypasses it.
- **Venv is mandatory**: use `.venv/bin/python`, `.venv/bin/pytest`,
  `.venv/bin/ruff`. Never global `pip`.
- The extraction package is copied into the container image, which installs only
  `requirements-extractor.txt` (`flask` alone). Any new module in
  `immi_case_downloader/extraction/` that needs a third-party dependency must
  import it **inside the function**, not at module scope, and must not be
  re-exported from `immi_case_downloader/extraction/__init__.py`.

## Commands you will need

All commands run from `/Users/d/Developer/Active Projects/IMMI-Case-`.

| Purpose | Command | Expected on success |
|---|---|---|
| Python unit tests | `make test-py` | see the **delta rule** below. Whatever the pass count, the failures must remain **exactly the 3 named `pypdf`/`pyexpat` ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`** (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch — environmental, not repo code). On an interpreter with a working `pypdf` there are 0; that is also fine. |
| One test file | `.venv/bin/pytest tests/test_internal_extract.py -q` | `N passed` — a per-file count, stable across sibling plans |
| Python lint | `make lint` | `All checks passed!` |
| Lint one file | `.venv/bin/ruff check --no-fix <path>` | `All checks passed!` |
| Frontend tests | `cd frontend && npx vitest run` | untouched by this plan — identical to your Step 0 record |
| Worker tests | `cd workers && npx vitest run` | untouched by this plan — identical to your Step 0 record |
| Container-shaped import probe | see Step 5 | `import-ok` |
| Container build + live request | see Step 10 | `health-ok` then `extract-ok` |
| What changed | `git status --short` | only in-scope paths |

**Delta rule (read before quoting any number).** Sibling plans in this batch add
and remove tests in the same suites, so absolute totals like "1141 passed" are
not usable gates — they break the moment another plan merges, and an executor
who edits the expected number has destroyed the gate.

**Step 0 (do this before anything else)** — record your own baseline:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u   # → PY_FAIL_NAMES
make test-py 2>&1 | tail -3                                # → PY_PASS_BEFORE, PY_SKIP_BEFORE
.venv/bin/pytest tests/test_internal_extract.py tests/test_cli_extended.py \
                 tests/test_extraction_container_boundary.py -q | tail -2
(cd frontend && npx vitest run 2>&1 | tail -3)             # → FE_BEFORE
(cd workers  && npx vitest run 2>&1 | tail -3)             # → WORKER_BEFORE
```

`PY_FAIL_NAMES` must be exactly the three
`tests/test_backfill_judge_overrides_from_pdf.py` entries (or empty). Anything
else and this plan cannot start.

| Suite | Required movement |
|---|---|
| Python | passed `PY_PASS_BEFORE + N_NEW`, skipped unchanged, failing **names** unchanged |
| Frontend / Worker | unchanged from `FE_BEFORE` / `WORKER_BEFORE` |

`N_NEW` is the net number of Python tests this plan adds. Do not copy a number
from this document — **count the tests you actually write** and state both the
baseline and the final figure in your completion report. The contributions are:
Step 5 `tests/test_package_import_boundary.py` (+1), Step 6
`tests/test_batch_runner.py` (at least 8), Step 8's new cases in
`tests/test_internal_extract.py` and the whole of
`tests/test_extract_container_app.py`, and Step 9's replacement of
`test_search_all_sources` with two tests plus a `--sources` default assertion
(net +2). The per-file counts are the sharper gate, because they do not move
when a sibling plan lands:

```bash
.venv/bin/pytest tests/test_batch_runner.py -q
.venv/bin/pytest tests/test_package_import_boundary.py -q     # → 1 passed
.venv/bin/pytest tests/test_internal_extract.py -q
.venv/bin/pytest tests/test_extract_container_app.py -q
.venv/bin/pytest tests/test_extraction_container_boundary.py -q   # → 3 passed
```

Do **not** run `make typecheck` as a gate for this plan: the target runs
`npx tsc --noEmit`, which in this repo loads zero files because
`frontend/tsconfig.json` is a project-references stub. That defect belongs to
`plans/001-restore-the-frontend-compile-gate.md`. This plan touches no
TypeScript.

## Scope

**In scope** (the only files you may create, modify, delete or move):

- `Dockerfile` (edit)
- `Dockerfile.extractor` (delete)
- `entrypoint.sh` (delete)
- `scripts/fetch_judge_photos.py` (delete)
- `scripts/README.md` (create)
- `archive/README.md` (create)
- `archive/extraction/` (create, receives four `git mv`d scripts)
- `extract_llm_structured.py`, `merge_llm_structured.py`, `extract_with_llm.py`,
  `merge_llm_extraction.py` (move to `archive/extraction/`, content unchanged)
- `extract_llm_fields.py`, `merge_llm_results.py`,
  `extract_structured_fields.py`, `extract_structured_fields_llm.py` (edit)
- `fill_country_gemini.py`, `fill_outcomes_gemini.py` (edit — env loader only)
- `extract_container.py` (edit)
- `immi_case_downloader/extraction/patterns.py` (create)
- `immi_case_downloader/extraction/batch_runner.py` (create)
- `immi_case_downloader/extraction/service.py` (create)
- `immi_case_downloader/extraction/regex.py` (edit — one import statement)
- `immi_case_downloader/web/internal_extract.py` (edit)
- `immi_case_downloader/cli.py` (edit)
- `tests/test_extraction_container_boundary.py` (edit — line 12 only)
- `tests/test_internal_extract.py` (edit)
- `tests/test_cli_extended.py` (edit — only the `test_search_all_sources` method)
- `tests/test_batch_runner.py` (create)
- `tests/test_package_import_boundary.py` (create)
- `tests/test_extract_container_app.py` (create — the container adapter's own
  HTTP-level tests; see Step 8 sub-step 5)

**Out of scope** (do NOT touch, even though they look related):

- `immi_case_downloader/extraction/__init__.py` — it is the container's import
  surface. Adding `batch_runner`/`patterns` exports there would drag
  `python-dotenv` into an image whose `requirements-extractor.txt` is only
  `flask>=3.0.0,<4`. The new modules are imported by full dotted path instead.
- `Makefile` and `.github/workflows/ci.yml` — owned by
  `plans/003-lint-the-test-suite.md`, which edits the exact `ruff check` lines.
  The `archive/` directory is chosen precisely so no Makefile change is needed.
- `pyproject.toml` / `ruff.toml` — do not create one. Ruff discovers
  `pyproject.toml` for configuration; introducing it would perturb the 43-error
  `tests/` baseline that plan 003 depends on. The import inversion is locked
  shut with a test instead (Step 5).
- `sync_judge_bios_supabase.py`, `sync_outcomes_supabase.py` — they hold the
  other two `_find_and_load_env` copies but are Supabase sync jobs outside this
  plan's territory. Leave them; they are listed in Maintenance notes.
- `immi_case_downloader/sources/federal_court.py`, `tests/test_federal_court.py`,
  `tests/test_scraper_protocol.py` — the scraper module stays. Deleting it would
  force edits into two test files that plan 003 also rewrites.
- `immi_case_downloader/web/__init__.py` — the blueprint stays registered; only
  its handler body moves.
- `scripts/fetch_judge_profile_images.py` and the other four judge-data scripts —
  documented in Step 3's README, not modified.
- `config/wrangler-*.toml.example` — they already name `Dockerfile`, which is the
  file this plan keeps.
- `CLAUDE.md`, `AGENTS.md`, `README.md` — every script they name survives this
  plan, and no documented command changes. Do not edit them.
- `downloaded_cases/**` — real, gitignored, irreplaceable data. Never run any of
  these scripts against it.

## Git workflow

- Branch: `advisor/032-consolidate-the-extraction-scripts`
- One commit per step, message style `<type>: <description>`, e.g.
  `chore: delete the duplicate extraction Dockerfile and orphan entrypoint`,
  `refactor: move regex patterns into the extraction package`.
- No AI attribution lines, no `Co-Authored-By`.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits.

## Steps

### Step 1: Delete the duplicate Dockerfile

`Dockerfile.extractor` is byte-identical to `Dockerfile` apart from a comment
header, and only one file in the repo names it.

1. `git rm Dockerfile.extractor`
2. In `tests/test_extraction_container_boundary.py`, change line 12 from:

   ```python
        for name in ("Dockerfile", "Dockerfile.extractor", "extract_container.py", "requirements-extractor.txt")
   ```

   to:

   ```python
        for name in ("Dockerfile", "extract_container.py", "requirements-extractor.txt")
   ```

   Change nothing else in that file.

**Verify**:

```bash
ls Dockerfile.extractor; \
.venv/bin/pytest tests/test_extraction_container_boundary.py -q; \
grep -rn "Dockerfile.extractor" . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=plans
```

→ `ls` prints `No such file or directory`; pytest prints `3 passed`; the grep
prints nothing and exits 1.

### Step 2: Delete the orphaned entrypoint.sh

It launches `python web.py --backend supabase`, an architecture that no longer
exists in production, and nothing references it.

1. `git rm entrypoint.sh`

**Verify**:

```bash
ls entrypoint.sh; \
grep -rn "entrypoint\.sh" . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=plans
```

→ `ls` prints `No such file or directory`; the grep prints nothing and exits 1.

### Step 3: Delete the unrunnable judge-photo script and document the cluster

1. `git rm scripts/fetch_judge_photos.py`
2. Create `scripts/README.md` with exactly this content:

```markdown
# scripts/

Operational scripts. None of these run in CI or in production; they are
operator-invoked, and most of them read or write `downloaded_cases/`, which is
gitignored and not reproducible from this repository. Read the script's module
docstring before running it.

## Judge data

Run in this order when rebuilding judge data from scratch. Each step consumes the
previous step's output.

| Order | Script | Consumes | Produces |
|---|---|---|---|
| 1 | `fetch_judge_bios.py` | judge names from the case catalog | `downloaded_cases/judge_bios.json` (Gemini deep-research or grounding mode) |
| 2 | `fetch_judge_profile_images.py` | `downloaded_cases/judge_bios.json` | `downloaded_cases/judge_photos/<key>.jpg` + `photo_*` fields written back into `judge_bios.json` |
| 3 | `build_judge_name_overrides.py` | bios + official public listings | `immi_case_downloader/data/judge_name_overrides.json` |
| 4 | `backfill_judge_overrides_from_pdf.py` | an operator-supplied PDF (`--pdf`) | additional entries in `immi_case_downloader/data/judge_name_overrides.json` |

`fetch_judge_profile_images.py` is the **only** supported judge-photo pipeline.
A second, Brave-Image-Search-via-docker-mcp-gateway implementation
(`fetch_judge_photos.py`) was deleted: it hardcoded an absolute path that does
not exist and it depended on an MCP gateway that this repository does not
declare.

`reextract_judges.py` is a separate repair tool, not part of the pipeline above.
Do not pass it `--apply` without first reading the post-mortem in
`docs/JUDGE_DATA_QUALITY.md`.

## Deployment gates

`check_cloudflare_native_target.py` and `check_immi_activation_evidence.py` are
the authoritative, fail-closed specification of what a deployable Cloudflare
configuration looks like. When prose docs and these scripts disagree, the
scripts win.
```

**Verify**:

```bash
ls scripts/fetch_judge_photos.py; \
test -f scripts/README.md && echo readme-ok; \
grep -rn "fetch_judge_photos" . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=plans --exclude=README.md
```

→ `ls` prints `No such file or directory`; then `readme-ok`; the grep prints
nothing and exits 1.

### Step 4: Archive the four unreferenced catalog writers

These four are referenced nowhere in the repository except inside their own
docstrings (verified by grep across `*.py`, `*.md`, `*.toml`, `*.yml`, `*.json`,
`*.ts`, `*.js`, `Makefile`, `Dockerfile*`, `*.sh`). Two of them are duplicate
writers of the shared temp path; one writes the catalog non-atomically with
`df.to_csv`. Moving them out of the repo root removes them from `make lint`'s
`*.py` glob without touching the Makefile.

```bash
mkdir -p archive/extraction
git mv extract_llm_structured.py archive/extraction/
git mv merge_llm_structured.py   archive/extraction/
git mv extract_with_llm.py       archive/extraction/
git mv merge_llm_extraction.py   archive/extraction/
```

Do not edit the moved files' contents.

Create `archive/README.md`:

```markdown
# archive/

Superseded one-off scripts, kept for reference and excluded from linting and
tests. Nothing here is maintained, and nothing in the live tree imports it.

## extraction/

Four LLM extraction/merge scripts, each a divergent copy of the same job. They
were archived because no Makefile target, CI workflow, doc or other script
referenced them, and because three of the four wrote
`downloaded_cases/immigration_cases.csv` through the same shared temp path with
no lock — the concurrency hazard that
`immi_case_downloader/extraction/batch_runner.py` now prevents for the surviving
scripts.

The maintained equivalents are, in the repo root:

- `extract_llm_fields.py` + `merge_llm_results.py` — case_nature / legal_concepts
- `extract_structured_fields.py` — regex structured-field extraction
- `extract_structured_fields_llm.py` — LLM fallback for the same fields

If you revive anything here, port it onto `batch_runner.atomic_write_rows` and
`batch_runner.catalog_lock` first — do not restore its own `save_csv`.
```

**Verify**:

```bash
ls extract_llm_structured.py merge_llm_structured.py extract_with_llm.py merge_llm_extraction.py 2>&1 | grep -c "No such file"; \
ls archive/extraction/ | sort; \
make lint
```

→ `4`; then the four filenames
(`extract_llm_structured.py`, `extract_with_llm.py`, `merge_llm_extraction.py`,
`merge_llm_structured.py`); then `All checks passed!`.

### Step 5: Invert the package import — move the patterns into the package

This must happen **before** Step 7. Once a repo-root script imports anything
under `immi_case_downloader.extraction`, Python executes that package's
`__init__.py`, which imports `.regex`, which today imports back into
`extract_structured_fields` — a circular import that fails at runtime. Moving the
patterns first breaks the cycle permanently.

1. **Create `immi_case_downloader/extraction/patterns.py`.** Its header is:

   ```python
   """Regex constants and pure extraction functions for Australian immigration case text.

   Moved here verbatim from the repo-root ``extract_structured_fields.py`` so the
   package no longer imports upward out of itself. The root script and
   ``immi_case_downloader.extraction.regex`` are both consumers of this module.

   Import only stdlib here: this file ships inside the extraction container
   image, whose requirements are ``flask`` alone.
   """

   from __future__ import annotations

   import re
   from collections import Counter
   ```

   Then append **lines 32 through 874 of `extract_structured_fields.py`
   verbatim** — that is from `COUNTRIES = [` down to and including the final
   `return ""` that closes `extract_legal_test`, i.e. everything up to but not
   including the blank lines before `def process_case(`. Do not reformat, do not
   reorder, do not rename anything.

2. **Edit `extract_structured_fields.py`**: delete those same lines 32–874 and,
   immediately after the `from pathlib import Path` import, insert:

   ```python
   from immi_case_downloader.extraction.patterns import (
       RE_AATA_APPLICANT,
       RE_AATA_REPRESENTATIVE,
       extract_country,
       extract_from_title,
       extract_hearing_date,
       extract_legal_test,
       extract_representation,
       extract_visa_outcome_reason,
       extract_visa_subclass_number,
   )
   ```

   Keep `CASES_DIR` and `CSV_PATH` (lines 29–30) in the root script. Keep every
   existing import: `argparse`, `csv`, `os`, `re`, `shutil`, `sys`, `Counter`,
   `ProcessPoolExecutor`, `Path` are all still used by `process_case`,
   `load_csv`, `save_csv` and `main`.

3. **Edit `immi_case_downloader/extraction/regex.py`**: replace the
   `from extract_structured_fields import (...)` block at lines 14–24 with
   `from .patterns import (...)`, keeping the same nine names in the same order.
   Also update the module docstring's second paragraph (lines 3–7) so it no
   longer describes the legacy arrangement — replace it with:

   ```
   Pattern definitions live in ``patterns.py`` inside this package. The
   repo-root ``extract_structured_fields.py`` CLI imports the same module, so
   the two extraction paths cannot drift.
   ```

4. **Edit `Dockerfile` line 10**: drop the now-unnecessary root script from the
   image.

   ```dockerfile
   COPY extract_container.py ./
   ```

5. **Create `tests/test_package_import_boundary.py`** so the inversion cannot
   return:

   ```python
   """The installable package must never import upward into a repo-root script."""

   from __future__ import annotations

   import ast
   from pathlib import Path


   ROOT = Path(__file__).resolve().parents[1]
   PACKAGE = ROOT / "immi_case_downloader"

   # Modules that live at the repo root, not inside any package. Importing one of
   # these from inside immi_case_downloader/ makes the package un-installable and
   # only works by accident when the repo root happens to be on sys.path.
   ROOT_MODULES = {path.stem for path in ROOT.glob("*.py")}


   def _absolute_imports(source: str) -> set[str]:
       names: set[str] = set()
       for node in ast.walk(ast.parse(source)):
           if isinstance(node, ast.Import):
               names.update(alias.name.split(".")[0] for alias in node.names)
           elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
               names.add(node.module.split(".")[0])
       return names


   def test_package_never_imports_a_repo_root_module() -> None:
       offenders = []
       for path in sorted(PACKAGE.rglob("*.py")):
           imported = _absolute_imports(path.read_text(encoding="utf-8"))
           for name in sorted(imported & ROOT_MODULES):
               offenders.append(f"{path.relative_to(ROOT)} imports root module {name!r}")
       assert not offenders, offenders
   ```

**Verify** (the probe reproduces the container's import environment — the repo
root is *not* on `sys.path`):

```bash
rm -rf /tmp/immi-pkg-check && mkdir -p /tmp/immi-pkg-check/immi_case_downloader
cp immi_case_downloader/__init__.py /tmp/immi-pkg-check/immi_case_downloader/
cp -R immi_case_downloader/extraction /tmp/immi-pkg-check/immi_case_downloader/
rm -rf /tmp/immi-pkg-check/immi_case_downloader/extraction/__pycache__
( cd /tmp/immi-pkg-check && "/Users/d/Developer/Active Projects/IMMI-Case-/.venv/bin/python" \
    -c "import immi_case_downloader.extraction as e; e.extract_regex('x'); print('import-ok')" )
```

→ prints `import-ok`.

At commit `42826a3` this same probe fails with
`ModuleNotFoundError: No module named 'extract_structured_fields'` raised from
`immi_case_downloader/extraction/regex.py, line 14` — run it **before** editing
to confirm you are fixing a real defect, and again after.

Then:

```bash
.venv/bin/pytest tests/test_extraction_regex.py tests/test_internal_extract.py tests/test_package_import_boundary.py -q
make lint
```

→ all pass; `All checks passed!`.

### Step 6: Add the shared batch-job support module

Create `immi_case_downloader/extraction/batch_runner.py`. It must contain
exactly these four public names and nothing that imports a third party at module
scope:

```python
"""Shared plumbing for the repo-root catalog batch jobs.

These jobs mutate ``downloaded_cases/immigration_cases.csv``, a ~149k-row file
that is gitignored and cannot be regenerated from this repository. Historically
each script built its own ``<catalog>.csv.tmp`` — the *same* path in every
script — and ``os.replace``d it onto the live catalog with no lock, so two
concurrent jobs silently destroyed each other's work.

This module gives every job a distinct temp path and a mutual-exclusion lock.

It is deliberately NOT re-exported from ``immi_case_downloader.extraction``:
the extraction container imports that package and installs ``flask`` only, so
``load_project_env`` imports ``python-dotenv`` lazily, inside the function.
"""
```

Public API:

- `temp_path_for(csv_path: Path, job_name: str) -> Path` — returns
  `csv_path.with_name(csv_path.name + "." + job_name + ".tmp")`. `job_name` must
  match `^[a-z0-9_]+$`; raise `ValueError` otherwise. Because the temp file sits
  beside the catalog it is on the same filesystem, so `os.replace` stays atomic.
- `atomic_write_rows(csv_path, rows, *, job_name, backup_suffix=None, backup_once=False) -> None`
  — no-ops when `rows` is empty; derives `fieldnames = list(rows[0].keys())`;
  when `backup_suffix` is given, copies `csv_path` to
  `csv_path.with_suffix(backup_suffix)` first (skipping the copy if
  `backup_once` is true and the backup already exists); writes with
  `open(tmp, "w", encoding="utf-8-sig", newline="")` and `csv.DictWriter`
  (`writeheader()` then `writerows(rows)`); then
  `os.replace(str(tmp), str(csv_path))`. On any exception, unlink the temp file
  before re-raising.
- `catalog_lock(csv_path, job_name)` — a `@contextmanager` that creates
  `csv_path.with_name(csv_path.name + ".lock")` with
  `os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)` and writes
  `f"{job_name} pid={os.getpid()} started={datetime.now().isoformat()}\n"`.
  On `FileExistsError`, read the existing file and raise `CatalogLockedError`
  whose message contains the lock file's path, its contents, and the sentence
  `Delete the lock file if you are certain no other job is running.` Release in
  a `finally` with `os.unlink`, tolerating `FileNotFoundError`. **Never steal a
  lock automatically.**
- `load_project_env() -> None` — walks up at most 8 directories from
  `Path(__file__).parent.parent.parent` (the repo root when running from a
  checkout) *and also* from `Path.cwd()`, skipping any directory whose name
  starts with `.auto-claude`, and calls `load_dotenv(candidate, override=True)`
  on the first `.env` it finds. `from dotenv import load_dotenv` goes **inside**
  the function body.

Also define `class CatalogLockedError(RuntimeError)`.

Create `tests/test_batch_runner.py` covering:

1. `temp_path_for` returns different paths for different `job_name`s, and both
   are siblings of the catalog.
2. `temp_path_for` raises `ValueError` for `"Bad Name"`.
3. `atomic_write_rows` round-trips rows (write, then read back with
   `csv.DictReader` on a `utf-8-sig` handle) and leaves **no** `*.tmp` file in
   the directory afterwards.
4. `atomic_write_rows` with `rows=[]` leaves an existing catalog untouched.
5. `atomic_write_rows` with `backup_suffix=".csv.bak_test"` creates the backup;
   with `backup_once=True` and the backup already present, it does not overwrite
   it (assert the backup's contents are the older ones).
6. `catalog_lock` raises `CatalogLockedError` when entered twice, and the message
   contains the name of the job that already holds it (the first one).
7. `catalog_lock` removes the lock file when the body raises, i.e.
   `with pytest.raises(ValueError): with catalog_lock(p, "a"): raise ValueError`
   then `assert not lock_path.exists()`.
8. `load_project_env` picks up a `.env` written into `tmp_path` when `cwd` is
   `tmp_path` (use `monkeypatch.chdir`), and does not pick one up from a
   `.auto-claude` directory.

Model the file's structure on `tests/test_extraction_regex.py` (plain module-level
`def test_*` functions, no class wrapper, `assert` statements only).

**Verify**:

```bash
.venv/bin/pytest tests/test_batch_runner.py -q
make lint
```

→ `8 passed` (or however many you wrote — at least 8); `All checks passed!`.

### Step 7: Point the four surviving catalog writers at the shared module

For each of `extract_llm_fields.py`, `merge_llm_results.py`,
`extract_structured_fields.py`, `extract_structured_fields_llm.py`:

1. Add near the other imports:

   ```python
   from immi_case_downloader.extraction.batch_runner import (
       atomic_write_rows,
       catalog_lock,
   )
   ```

2. Replace each `save_csv` with **exactly** the body below. Do not paraphrase:
   an earlier draft said "replace the body with a single helper call" while also
   saying "keep the existing `print(f"Backup saved to {backup_path}")` line",
   which is self-contradictory — `backup_path` would be undefined. These four
   replacements are the resolution. Each preserves that script's original backup
   behaviour and its original prints.

   `extract_llm_fields.py` — replaces lines 49-59:

   ```python
   def save_csv(rows):
       atomic_write_rows(Path(CSV_PATH), rows, job_name="llm_fields")
   ```

   `merge_llm_results.py` — replaces lines 22-31:

   ```python
   def save_csv(rows):
       atomic_write_rows(Path(CSV_PATH), rows, job_name="merge_llm_results")
   ```

   `extract_structured_fields.py` — replaces lines 986-1005. The backup path is
   recomputed locally so the print stays truthful, and the empty-rows guard
   stays *before* the print so an empty run does not claim a backup it never
   made:

   ```python
   def save_csv(rows: list[dict]):
       """Save updated rows back to CSV with atomic write."""
       if not rows:
           return

       backup_path = CSV_PATH.with_suffix(".csv.bak_extract")
       atomic_write_rows(
           CSV_PATH,
           rows,
           job_name="structured_fields",
           backup_suffix=".csv.bak_extract",
       )
       print(f"Backup saved to {backup_path}")
       print(f"Saved {len(rows)} rows to {CSV_PATH}")
   ```

   `extract_structured_fields_llm.py` — replaces lines 122-134:

   ```python
   def save_csv(rows: list[dict]):
       atomic_write_rows(
           CSV_PATH,
           rows,
           job_name="structured_fields_llm",
           backup_suffix=".csv.bak_llm_structured",
           backup_once=True,
       )
   ```

   `extract_llm_fields.py` and `merge_llm_results.py` hold `CSV_PATH` as a
   `str`, so those two wrap it — `Path(CSV_PATH)` — at the call site rather than
   changing the module constant, and both need `from pathlib import Path` if
   they do not already import it (check before adding: an unused import is an
   F401 and `make lint` will fail).

2b. **Delete the imports these replacements orphan.** Ruff's default rule set
   includes `F401`, so a leftover unused import fails `make lint`. Verified at
   `42826a3`, per file:

   | File | Delete | Keep, still used |
   |---|---|---|
   | `extract_llm_fields.py` | `import os` (line 10 — its only use was `os.replace` at line 59) | `csv` (line 46), `json`, `time`, `threading`, `datetime`, `anthropic` |
   | `merge_llm_results.py` | *nothing* — `os` survives via `os.path.join` at line 40 | `csv` (line 19), `os`, `json`, `glob` |
   | `extract_structured_fields.py` | `import shutil` (line 21 — its only use was `shutil.copy2` at line 993) | `os` (line 889), `csv` (line 982), `argparse`, `re`, `sys`, `Counter`, `ProcessPoolExecutor`, `Path` |
   | `extract_structured_fields_llm.py` | `import shutil` (line 25 — only use was line 128) **and** `from dotenv import load_dotenv` (line 34, orphaned by sub-step 4) | `os` (lines 139, 200), `csv` (line 119), the rest |
   | `fill_country_gemini.py` | `from dotenv import load_dotenv` (line 33) | `os` (line 149), the rest |
   | `fill_outcomes_gemini.py` | `from dotenv import load_dotenv` (line 35) | `os` (line 177), the rest |

   Re-derive this table on your tree rather than trusting the line numbers —
   `plans/041-cover-the-extraction-scripts.md` lands first and may shift them.
   The reliable check is per file: after editing, run
   `.venv/bin/ruff check --no-fix <file>` and delete exactly what F401 names.

3. Wrap each script's `main()` body in the lock, so a second copy of any of them
   refuses to start instead of racing:

   ```python
   def main():
       with catalog_lock(Path(CSV_PATH), "<job_name>"):
           ...existing body...
   ```

   Where an early `return` exists inside the body, leave it — returning out of a
   `with` releases the lock normally.

4. Replace the three in-scope `_find_and_load_env` definitions and their
   module-level call sites with the shared loader. In
   `extract_structured_fields_llm.py`, `fill_country_gemini.py` and
   `fill_outcomes_gemini.py`, delete the `def _find_and_load_env(): ...` block
   and the bare `_find_and_load_env()` line, delete the now-unused
   `from dotenv import load_dotenv` import, and put in their place:

   ```python
   from immi_case_downloader.extraction.batch_runner import load_project_env

   load_project_env()
   ```

   `fill_country_gemini.py` and `fill_outcomes_gemini.py` write
   `downloaded_cases/cases.db` (SQLite), not the catalog CSV — do **not** add
   `catalog_lock` or `atomic_write_rows` to them.

**Verify**:

```bash
grep -n 'CSV_PATH + "\.tmp"\|with_suffix(".csv.tmp")' extract_llm_fields.py merge_llm_results.py extract_structured_fields.py extract_structured_fields_llm.py; \
grep -rn "_find_and_load_env" extract_structured_fields_llm.py fill_country_gemini.py fill_outcomes_gemini.py; \
for f in extract_llm_fields.py merge_llm_results.py extract_structured_fields.py extract_structured_fields_llm.py fill_country_gemini.py fill_outcomes_gemini.py; do \
  .venv/bin/ruff check --no-fix "$f" || echo "LINT FAILED $f"; done; \
make lint
```

→ both greps print nothing and exit 1; every per-file ruff run prints
`All checks passed!` and no `LINT FAILED` line appears; `make lint` prints
`All checks passed!`.

The per-file `ruff check` replaces the earlier `ast.parse(...)` "parse-ok" loop.
`ast.parse` only proves the file is syntactically valid Python — it cannot see
an undefined `backup_path`, an orphaned `import shutil`, or any of the failure
modes this step actually risks. Ruff's default `F` rules catch all three.

Then prove the atomic writer is really the only writer left, and that the four
`save_csv` functions still behave. Run this against a **throwaway** CSV — never
against `downloaded_cases/`:

```bash
.venv/bin/python - <<'PY'
import csv, sys, tempfile, pathlib
sys.path.insert(0, ".")
from immi_case_downloader.extraction.batch_runner import atomic_write_rows
tmp = pathlib.Path(tempfile.mkdtemp()) / "cat.csv"
tmp.write_text("a,b\n1,2\n", encoding="utf-8-sig")
atomic_write_rows(tmp, [{"a": "9", "b": "8"}], job_name="probe",
                  backup_suffix=".csv.bak_probe")
with open(tmp, encoding="utf-8-sig", newline="") as fh:
    print("rows:", list(csv.DictReader(fh)))
print("backup exists:", tmp.with_suffix(".csv.bak_probe").exists())
print("leftover tmp files:", sorted(p.name for p in tmp.parent.glob("*.tmp")))
PY
```

→ `rows: [{'a': '9', 'b': '8'}]`, `backup exists: True`,
`leftover tmp files: []`.

Then confirm the scripts still import cleanly without executing (they call
`load_project_env()` at module scope, which is safe, but `anthropic` /
`google-genai` may not be installed — if an import fails **only** with
`ModuleNotFoundError` naming a third-party SDK, that is pre-existing and
acceptable; any other error is a STOP condition):

```bash
.venv/bin/python -c "
import importlib, traceback
for m in ('extract_llm_fields','merge_llm_results','extract_structured_fields','extract_structured_fields_llm'):
    try:
        importlib.import_module(m); print('import-ok', m)
    except ModuleNotFoundError as exc:
        print('missing-sdk', m, exc.name)
    except Exception:
        traceback.print_exc(); raise SystemExit(1)
"
```

→ every line starts with `import-ok` or `missing-sdk`; exit code 0.

**Do not execute any of these scripts.** They mutate the real 149k-row catalog.

### Step 8: Unify the two `/internal/extract` handlers on the hardened one

1. Create `immi_case_downloader/extraction/service.py` holding the single copy of
   the logic. Only stdlib + the local package at module scope (this file ships
   in the container image).

   ```python
   """The one implementation of the internal extraction endpoint.

   Two Flask entry points bind to it: ``extract_container.py`` (the Cloudflare
   Container image) and ``immi_case_downloader/web/internal_extract.py`` (the
   local-dev Flask app). They previously held two copies of this body that had
   drifted apart on authentication and payload limits.
   """
   ```

   Public API:

   - `MAX_BATCH_SIZE = 20`
   - `def authorize(header: Callable[[str], str | None], env: Mapping[str, str]) -> tuple[dict, int] | None`
     — returns `None` when the request is allowed, otherwise the
     `(body, status)` pair to return. In order:
     `X-Internal-Route != "worker"` → `({"error": "Forbidden", "code": "not_internal"}, 403)`;
     `X-Internal-Route-Subtype != "cron-extract"` → `({"error": "Forbidden", "code": "not_cron_extract"}, 403)`;
     then read `EXTRACTION_SHARED_SECRET` from `env` and compare it to the
     `X-Extraction-Token` header with `secrets.compare_digest` — missing secret
     **or** mismatch → `({"error": "Forbidden", "code": "invalid_extraction_token"}, 403)`.
     Guard `compare_digest` against a `None` header by coercing to `""` first.
   - `def parse_payload(raw: object) -> tuple[str, list] | None` — the **whole**
     payload validation, and it must not assume anything about the JSON it is
     handed. `request.get_json(silent=True)` returns whatever the client sent:
     a list, a string, a number, or `None`. The old
     `payload = request.get_json(silent=True) or {}` followed by `payload.get(...)`
     raises `AttributeError` → **500** for a JSON array or string body, which is
     an unauthenticated crash surface. Validate in this order, returning `None`
     (meaning "reject with `400 bad_payload`") at the first failure:

     1. `isinstance(raw, dict)` — a top-level list/str/int/None is rejected here
     2. `run_id = text(raw.get("run_id"))` is non-empty
     3. `batch = raw.get("batch")` and `isinstance(batch, list)`
     4. `len(batch) <= MAX_BATCH_SIZE`
     5. every element satisfies `isinstance(item, dict)`
     6. for every element, `item.get("base")` is either absent/`None` or a
        `dict` — never a list or string, because `run_batch` does
        `dict(item.get("base") or {})` and `dict("abc")` raises

     Return `(run_id, batch)` on success. Keep the error body exactly
     `{"error": "Invalid payload", "code": "bad_payload"}` with status `400` at
     both call sites, so the Worker's existing expectations do not move.

   - `def bad_payload(...)` is **not** sufficient on its own and must not be the
     only guard: it was specified against already-extracted `run_id` / `batch`
     values, i.e. after the crash has already happened.
   - `def run_batch(run_id: str, batch: list, env: Mapping[str, str]) -> dict`
     — the loop currently duplicated at `extract_container.py:40-80` and
     `immi_case_downloader/web/internal_extract.py:30-106`, verbatim in
     behaviour: same env var names, same `cap = number("PIPELINE_RUN_COST_CAP_USD", 5.0) * 0.8`,
     same default model `"workers-ai/@cf/google/gemma-4-26b-a4b-it"`, same
     `confidence: 0.7 / source: "llm"` envelopes, same `source: "timeout"`
     envelopes, same `base.pop("full_text", None)`, same response keys
     `{"run_id", "extracted", "llm_calls", "cost_usd"}` with
     `round(cost_usd, 6)`. Import `ExtractionTimeoutError`, `extract_llm` and
     `extract_regex` from `.llm` and `.regex` directly (not from the package
     `__init__`) to keep the import graph explicit.

2. Reduce `extract_container.py`'s `internal_extract()` to: call
   `service.authorize(request.headers.get, os.environ)`; if it returns a pair,
   `return jsonify(body), status`. Then
   `parsed = service.parse_payload(request.get_json(silent=True))`; if it is
   `None`, return `jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400`.
   Otherwise `run_id, batch = parsed` and return
   `jsonify(service.run_batch(run_id, batch, os.environ))`. Keep `/health`,
   `app`, and the `__main__` block. The local `text()` / `number()` helpers move
   into `service.py`; delete whichever become unused so ruff stays clean.

3. Reduce `immi_case_downloader/web/internal_extract.py` to the same shape,
   keeping the blueprint object, the route decorator and the
   `csrf.exempt(internal_extract_bp)` call at line 109. It now enforces the
   shared secret, the batch cap **and** the payload-shape checks.

4. Update `tests/test_internal_extract.py`:
   - `_app()` gains an `EXTRACTION_SHARED_SECRET` value in its
     `patch.dict(os.environ, ...)` — but note the handler reads `os.environ` at
     request time, so set it with `monkeypatch.setenv` in each test (or extend
     the existing `patch.dict` context to wrap the request too). Use a literal
     test value such as `"test-extraction-token"`; this is a test fixture, not a
     credential.
   - `test_internal_extract_requires_worker_and_subtype_headers`: the third
     assertion (both routing headers, no token) becomes `== 403`; add a fourth
     assertion with both routing headers **plus**
     `X-Extraction-Token: test-extraction-token` expecting `200`.
   - `test_internal_extract_returns_field_envelopes_without_echoing_full_text`:
     add the `X-Extraction-Token` header. Its four assertions must still pass
     unchanged.
   - Add `test_internal_extract_rejects_oversized_batch`: 21 well-formed items,
     all headers correct → `400` with `body["code"] == "bad_payload"`.
   - Add `test_internal_extract_rejects_non_object_payloads`, parametrised over
     `[1, 2]`, `"hello"`, `7` and `None` sent with `json=` and all headers
     correct → every one is `400` / `bad_payload`, and **none is a 5xx**. This
     is the crash case: before the fix these raised `AttributeError` inside the
     handler.
   - Add `test_internal_extract_rejects_bad_item_shapes`, covering
     `{"run_id": "r", "batch": ["not-a-dict"]}` and
     `{"run_id": "r", "batch": [{"base": "not-a-mapping"}]}` → both `400` /
     `bad_payload`, neither a 5xx.
   - Add `test_internal_extract_rejects_mixed_valid_and_invalid_items`: a batch
     whose first item is well-formed and whose second is `[]` → `400`, and
     assert **nothing was extracted** (the whole request is rejected, not
     partially processed).

5. **Test both adapters, not just the shared service.** The whole point of this
   step is that two Flask entry points now bind to one implementation, so a test
   that only exercises `service.py` would not notice one adapter forgetting to
   call `parse_payload`. Add a second test module,
   `tests/test_extract_container_app.py`, that imports the container app
   directly (`from extract_container import app`) and re-runs the same four
   rejection cases plus the authenticated `200` case against
   `app.test_client()`. `tests/test_internal_extract.py` keeps covering the
   blueprint adapter through `create_app()`.

   If importing `extract_container` at collection time is awkward (it defines a
   module-level `app`), import it inside the test function rather than moving
   code around in `extract_container.py`.

**Verify**:

```bash
.venv/bin/pytest tests/test_internal_extract.py tests/test_extract_container_app.py \
                 tests/test_extraction_container_boundary.py tests/test_extraction_regex.py -q; \
grep -c "extract_llm(" extract_container.py immi_case_downloader/web/internal_extract.py; \
grep -c "parse_payload" extract_container.py immi_case_downloader/web/internal_extract.py; \
make lint
```

→ pytest passes; the first grep prints `0` for both files (the LLM loop now
lives only in `service.py`); the second prints `1` for both (**both** adapters
validate); `All checks passed!`.

Then prove the new tests can fail: temporarily make `parse_payload` return
`("x", [])` unconditionally, re-run
`.venv/bin/pytest tests/test_internal_extract.py tests/test_extract_container_app.py -q`,
confirm red, and restore.

Then re-run the container-shaped import probe from Step 5 — it must still print
`import-ok`, proving `service.py` did not drag a non-`flask` dependency into the
image:

```bash
rm -rf /tmp/immi-pkg-check && mkdir -p /tmp/immi-pkg-check/immi_case_downloader
cp immi_case_downloader/__init__.py /tmp/immi-pkg-check/immi_case_downloader/
cp -R immi_case_downloader/extraction /tmp/immi-pkg-check/immi_case_downloader/
rm -rf /tmp/immi-pkg-check/immi_case_downloader/extraction/__pycache__
( cd /tmp/immi-pkg-check && "/Users/d/Developer/Active Projects/IMMI-Case-/.venv/bin/python" \
    -c "import immi_case_downloader.extraction.service as s; print('import-ok', s.MAX_BATCH_SIZE)" )
```

→ `import-ok 20`.

### Step 9: Stop running the dead Federal Court scraper by default

**The failure mode this step must avoid.** An earlier draft made an explicit
`--sources fedcourt` print a message and then fall through to a normal, empty,
**exit-0** run. That is worse than the defect it replaces: a cron job or CI step
that asks for `fedcourt` would record "search succeeded, 0 cases" forever. A
requested source that cannot be served must fail loudly. `main()` ignores the
return value of `args.func(args)` (`cli.py:311`), so the only way to signal
failure is to raise `SystemExit`.

1. In `immi_case_downloader/cli.py`, replace lines 58–72 (the
   `# Search Federal Court` block shown in "Current state") with:

   ```python
    # Federal Court direct search is unavailable: search2.fedcourt.gov.au does
    # not resolve (see CLAUDE.md, "Federal Court DNS"). FCA judgments are
    # collected through AustLII instead. An explicit --sources fedcourt is a
    # hard error rather than a silent empty success, so automation notices.
    if "fedcourt" in args.sources:
        raise SystemExit(
            "Source 'fedcourt' is unavailable: search2.fedcourt.gov.au does not "
            "resolve. Federal Court judgments are available via AustLII — use "
            "--sources austlii --databases FCA."
        )
   ```

   Note the ordering consequence: this check must sit **after** the AustLII
   block, so `--sources austlii fedcourt` still collects the AustLII results
   before exiting non-zero. Place it exactly where the old block was.

   Leave the `from .sources.federal_court import FederalCourtScraper` import at
   line 9 in place: `cmd_download` still uses it at line 140.

2. Change the `--sources` **default** so the documented default no longer
   promises a source that cannot be served. At `cli.py:247-252`:

   ```python
       search_parser.add_argument(
           "--sources",
           nargs="+",
           default=["austlii"],
           choices=["all", "austlii", "fedcourt"],
           help="Sources to search (default: austlii). 'all' means AustLII only — "
                "'fedcourt' is unavailable (search2.fedcourt.gov.au does not resolve).",
       )
   ```

   Two deliberate decisions here, both of which you must state in your handoff
   because they are **user-visible behaviour changes**:

   - The default moves `["all"]` → `["austlii"]`. Behaviourally identical after
     step 1 (both search AustLII only), but it stops the help text and the
     `--sources all` semantics from silently disagreeing with each other.
   - `"all"` is kept as a valid choice and now means "every source that works",
     i.e. AustLII. It does **not** trigger the `fedcourt` error, because
     `"fedcourt" in args.sources` is a membership test on the literal string.

3. Update `cmd_list_databases` lines 193–196:

   ```python
    print("Other Sources:")
    print("=" * 60)
    print("  fedcourt       Federal Court of Australia Judgment Search")
    print("                 search2.fedcourt.gov.au — UNAVAILABLE (host does not")
    print("                 resolve); use AustLII database FCA instead")
   ```

4. Update `tests/test_cli_extended.py`. **Change only the
   `test_search_all_sources` method** (currently lines 121–140) — touch nothing
   else in the file, because `plans/003-lint-the-test-suite.md` also edits this
   file's import block. Rename it and invert its expectation:

   ```python
    @patch("immi_case_downloader.cli.FederalCourtScraper")
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_all_sources_skips_the_dead_federal_court(
        self, mock_austlii_cls, mock_fc_cls, tmp_path, capsys
    ):
        """sources=['all'] searches AustLII only; fedcourt is never constructed."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        mock_austlii_cls.return_value.search_cases.return_value = [
            ImmigrationCase(citation="A", url="https://a.com/1", court_code="AATA", source="AustLII")
        ]

        args = self._make_args(tmp_path, sources=["all"], databases=["AATA"])
        cmd_search(args)

        mock_fc_cls.assert_not_called()

        from immi_case_downloader.storage import load_all_cases
        cases = load_all_cases(str(tmp_path))
        assert len(cases) == 1

    @patch("immi_case_downloader.cli.FederalCourtScraper")
    @patch("immi_case_downloader.cli.AustLIIScraper")
    def test_search_explicit_fedcourt_exits_non_zero(
        self, mock_austlii_cls, mock_fc_cls, tmp_path
    ):
        """--sources fedcourt fails loudly instead of succeeding with 0 cases."""
        ensure_output_dirs(str(tmp_path))
        save_cases_csv([], str(tmp_path))

        args = self._make_args(tmp_path, sources=["fedcourt"], databases=["AATA"])
        with pytest.raises(SystemExit) as excinfo:
            cmd_search(args)

        mock_fc_cls.assert_not_called()
        assert "unavailable" in str(excinfo.value)
        # A bare `raise SystemExit("msg")` exits 1, not 0 — that is the point.
        assert excinfo.value.code != 0

    def test_search_default_sources_is_austlii(self):
        """The declared default no longer promises a source that cannot be served."""
        from immi_case_downloader.cli import main  # noqa: F401  (parser lives in main)
        import argparse
        import immi_case_downloader.cli as cli_mod

        parser = argparse.ArgumentParser()
        # Re-parse through the real CLI rather than asserting on a literal:
        with patch.object(cli_mod.sys, "argv", ["run.py", "search"]):
            ...
   ```

   For that last test, prefer whatever idiom `tests/test_cli.py` already uses to
   reach the parser (read it first). If the file has no parser-level test,
   assert on the declared default instead — `--sources` must default to
   `["austlii"]` — using the same `_make_args` helper style as its neighbours.
   Do **not** invent a new harness for it; a one-line assertion in an existing
   style is worth more than a clever one.

**Verify**:

```bash
.venv/bin/pytest tests/test_cli.py tests/test_cli_extended.py -q; \
grep -n 'or "all" in args.sources' immi_case_downloader/cli.py; \
grep -n 'default=\["austlii"\]' immi_case_downloader/cli.py; \
.venv/bin/python run.py search --sources fedcourt --databases AATA >/tmp/immi-fedcourt.txt 2>&1; \
  echo "fedcourt exit=$?"; \
make lint
```

→ pytest passes; the first grep prints exactly **one** line (`cli.py:37`, the
AustLII branch) and nothing for a fedcourt branch; the second prints one line;
`fedcourt exit=1` with `unavailable` in `/tmp/immi-fedcourt.txt`; `All checks
passed!`.

That real CLI invocation is safe: with `sources=["fedcourt"]` the AustLII branch
never runs, so `cmd_search` raises before any HTTP request and before
`save_cases_csv` is reached. (`ensure_output_dirs` runs first and only mkdirs
paths that already exist.) Confirm the catalog is untouched by comparing its
mtime around the run — `downloaded_cases/` is gitignored, so `git status` can
never tell you anything about it:

```bash
stat -f %m downloaded_cases/immigration_cases.csv   # before and after; must match
```

Do **not** run `run.py search` without `--sources fedcourt` — that one really
would scrape AustLII and rewrite the catalog.

### Step 10: Build and run the container image once, end to end

This plan changes the `Dockerfile` `COPY` graph (Step 5), the package import
boundary (Step 5), and the container's request handler (Step 8) — and until now
nothing in it ever built or ran the image. The `/tmp/immi-pkg-check` probe
proves the *import* closure; it does not prove the image builds, that `CMD
["python", "extract_container.py"]` still starts, or that the two adapters agree
at the HTTP layer. Do that once, here.

Pick whichever container runtime is on this machine (`docker`, `podman` and
`nerdctl` all accept these arguments — substitute the binary name):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
docker build -f Dockerfile -t immi-extract-probe .
docker run --rm -d --name immi-extract-probe -p 18080:8080 \
  -e EXTRACTION_SHARED_SECRET=test-extraction-token immi-extract-probe
sleep 3

curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/health   # → 200
echo health-ok

curl -sS -X POST http://127.0.0.1:18080/internal/extract \
  -H 'X-Internal-Route: worker' \
  -H 'X-Internal-Route-Subtype: cron-extract' \
  -H 'X-Extraction-Token: test-extraction-token' \
  -H 'Content-Type: application/json' \
  -d '{"run_id":"probe-1","batch":[{"case_id":"abc123","text":"TRIBUNAL MEMBER: A Smith"}]}'
echo extract-ok

# the crash case Step 8 fixed — a JSON array body must be 400, never 5xx
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:18080/internal/extract \
  -H 'X-Internal-Route: worker' -H 'X-Internal-Route-Subtype: cron-extract' \
  -H 'X-Extraction-Token: test-extraction-token' \
  -H 'Content-Type: application/json' -d '[1,2]'                          # → 400

# and the unauthenticated case
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:18080/internal/extract \
  -H 'Content-Type: application/json' -d '{"run_id":"x","batch":[]}'      # → 403

docker stop immi-extract-probe
docker rmi immi-extract-probe
```

`test-extraction-token` is a throwaway literal for this probe, not a credential;
never put a real `EXTRACTION_SHARED_SECRET` on a command line.

**Verify**: `200`, `health-ok`, a JSON body with the keys `run_id`, `extracted`,
`llm_calls` and `cost_usd` (the LLM call itself may fail without a gateway
binding — a `source: "timeout"` or error envelope is acceptable; a **5xx or a
traceback is not**), `extract-ok`, then `400` and `403`.

**If no container runtime is available on this machine**: do not skip this step
silently and do not claim the container is verified. Run the same four requests
against the container entry point *locally* —
`EXTRACTION_SHARED_SECRET=test-extraction-token .venv/bin/python extract_container.py`
in one shell, the four `curl`s against `http://127.0.0.1:8080` in another — which
still exercises `extract_container.py`'s real Flask app and both guards, then
**state explicitly in your handoff that the image build itself was not
verified**. That gap is a real one: the `COPY` line changed in Step 5.

## Test plan

New tests, all in new or already-in-scope files:

- `tests/test_batch_runner.py` (new, ~8 tests) — distinct temp paths per job,
  `job_name` validation, atomic round-trip with no leftover `*.tmp`, empty-rows
  no-op, backup and `backup_once` semantics, `CatalogLockedError` on double
  entry, lock release on exception, `load_project_env` discovery including the
  `.auto-claude` skip. Structure it like `tests/test_extraction_regex.py`:
  module-level `def test_*` functions, plain `assert`s, `tmp_path` /
  `monkeypatch` fixtures.
- `tests/test_package_import_boundary.py` (new, 1 test) — AST-walks every
  `immi_case_downloader/**/*.py` and fails if any of them imports a repo-root
  module name. This is the regression guard for DEBT-11; it replaces the
  `pyproject.toml` the audit suggested (see "Findings reconsidered").
- `tests/test_internal_extract.py` (edited) — third assertion flips to 403; new
  authenticated 200 case; `test_internal_extract_rejects_oversized_batch`
  (21 items → 400 `bad_payload`); `test_internal_extract_rejects_non_object_payloads`
  (list / string / number / null bodies → 400, never 5xx);
  `test_internal_extract_rejects_bad_item_shapes`;
  `test_internal_extract_rejects_mixed_valid_and_invalid_items`.
- `tests/test_extract_container_app.py` (new) — the **container** adapter,
  `extract_container.app`, gets the same rejection cases plus the authenticated
  200. Without this file the suite would only prove `service.py` is correct, not
  that both Flask entry points call into it.
- `tests/test_cli_extended.py` (edited) —
  `test_search_all_sources_skips_the_dead_federal_court`,
  `test_search_explicit_fedcourt_exits_non_zero` (asserts `SystemExit` with a
  non-zero code — the silent-success failure mode), and a default-value
  assertion for `--sources`.
- `tests/test_extraction_container_boundary.py` (edited) — line 12 tuple loses
  `"Dockerfile.extractor"`; its **three** tests keep passing (`3 passed`, not 2:
  the file defines `test_extraction_image_and_source_have_no_database_runtime_markers`,
  `test_extraction_service_has_no_durable_storage_binding` and
  `test_container_bridge_has_no_legacy_storage_terms`).
- Step 10 (not a pytest file) — one real container build plus four live HTTP
  requests against the built image.

Regression coverage that must keep passing untouched:
`tests/test_extraction_regex.py` (the nine moved symbols still behave the same
through the package), `tests/test_cli.py`, `tests/test_webapp.py`,
`tests/test_app_factory.py`.

Full-suite verification:

```bash
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u
make test-py 2>&1 | tail -3
```

→ the failing test **names** are identical to the `PY_FAIL_NAMES` you recorded
in Step 0 — exactly the `pypdf`-import failures in
`tests/test_backfill_judge_overrides_from_pdf.py` (Homebrew Python 3.14.7
`pyexpat`/`libexpat` ABI mismatch — an environment defect, not repo code), or
none at all on an interpreter with a working `pypdf`. Passed must equal
`PY_PASS_BEFORE + N_NEW`; skipped must equal `PY_SKIP_BEFORE`. Do not quote an
absolute total — another plan may have moved it.

Frontend and Worker suites are untouched by this plan; run them once at the end
to prove it:

```bash
cd frontend && npx vitest run    # identical to FE_BEFORE
cd ../workers && npx vitest run  # identical to WORKER_BEFORE
```

## Done criteria

Machine-checkable. ALL must hold, run from the repo root:

- [ ] `test ! -e Dockerfile.extractor && test ! -e entrypoint.sh && test ! -e scripts/fetch_judge_photos.py`
- [ ] `test -f scripts/README.md && test -f archive/README.md`
- [ ] `ls archive/extraction/ | sort | tr '\n' ' '` → `extract_llm_structured.py extract_with_llm.py merge_llm_extraction.py merge_llm_structured.py `
- [ ] `grep -rn 'CSV_PATH + "\.tmp"' *.py` → no matches (exit 1)
- [ ] `grep -rn 'with_suffix(".csv.tmp")' *.py` → no matches (exit 1)
- [ ] `grep -rn "_find_and_load_env" extract_structured_fields_llm.py fill_country_gemini.py fill_outcomes_gemini.py` → no matches (exit 1)
- [ ] `grep -rn "from extract_structured_fields import" immi_case_downloader/` → no matches (exit 1)
- [ ] `grep -n "extract_structured_fields.py" Dockerfile` → no matches (exit 1)
- [ ] `grep -n 'or "all" in args.sources' immi_case_downloader/cli.py` → exactly one line, and it is the AustLII branch
- [ ] `grep -c 'default=\["austlii"\]' immi_case_downloader/cli.py` → `1`
- [ ] `.venv/bin/python run.py search --sources fedcourt --databases AATA; echo $?` → non-zero, with `unavailable` on stderr
- [ ] `grep -c "parse_payload" extract_container.py immi_case_downloader/web/internal_extract.py` → `1` for **both**
- [ ] The Step 5 container-shaped import probe prints `import-ok`
- [ ] The Step 8 service probe prints `import-ok 20`
- [ ] Step 10 ran: the image built, `/health` returned `200`, an authenticated
      `/internal/extract` returned a `run_id`/`extracted`/`llm_calls`/`cost_usd`
      envelope, a JSON-array body returned `400`, and an unauthenticated request
      returned `403`. If no container runtime was available, the local-app
      fallback ran **and** the handoff says the image build was not verified.
- [ ] `make lint` → `All checks passed!`
- [ ] `.venv/bin/ruff check --no-fix extract_llm_fields.py merge_llm_results.py extract_structured_fields.py extract_structured_fields_llm.py fill_country_gemini.py fill_outcomes_gemini.py` → `All checks passed!` (no orphaned `os` / `shutil` / `load_dotenv` import survives)
- [ ] `.venv/bin/pytest tests/test_batch_runner.py tests/test_package_import_boundary.py tests/test_internal_extract.py tests/test_extract_container_app.py tests/test_cli_extended.py tests/test_extraction_container_boundary.py tests/test_extraction_regex.py -q` → all pass
- [ ] `.venv/bin/pytest tests/test_extraction_container_boundary.py -q` → `3 passed`
- [ ] `make test-py` → skipped `= PY_SKIP_BEFORE`; failing test **names** identical to `PY_FAIL_NAMES`; passed `= PY_PASS_BEFORE + N_NEW`
- [ ] `cd frontend && npx vitest run` → identical to `FE_BEFORE`
- [ ] `cd workers && npx vitest run` → identical to `WORKER_BEFORE`
- [ ] `git status --short` lists only paths from the "In scope" list
- [ ] `plans/README.md` status row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- **Any script would actually run.** Nothing in this plan executes
  `extract_*.py`, `merge_*.py`, `fill_*_gemini.py` or `postprocess.py`. They
  mutate `downloaded_cases/immigration_cases.csv` (149,016 rows, gitignored,
  not reproducible from this repo) and `downloaded_cases/cases.db` (356 MB). If
  a verification step seems to need a real run, stop.
- **The Step 5 import probe fails after the move** with anything other than the
  baseline `ModuleNotFoundError: No module named 'extract_structured_fields'`.
  A different traceback means the 32–874 line split was wrong — a name landed on
  the wrong side.
- **`tests/test_extraction_regex.py` fails after Step 5.** The nine moved symbols
  are load-bearing for the production extraction container. A failure there means
  the verbatim move was not verbatim. Do not "fix" the test; revert the step.
- **`config/wrangler-extraction-container.toml.example` or
  `scripts/verify_immi_separation.py` turns out to name `Dockerfile.extractor`**
  rather than `Dockerfile`. At commit `42826a3` both name `./Dockerfile` and
  `immi_root / "Dockerfile"`, which is why `Dockerfile` is the survivor. If that
  has changed, the deletion direction in Step 1 is wrong.
- **Any of the four scripts you are archiving in Step 4 turns out to be
  referenced.** Re-run the grep before moving:
  `grep -rn "extract_llm_structured\|merge_llm_structured\|extract_with_llm\|merge_llm_extraction" . --exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=.git --exclude-dir=plans --exclude-dir=archive`
  must return only self-references from inside those four files' own docstrings.
- **`make test-py` reports a failing test whose name was not in `PY_FAIL_NAMES`**,
  or the skipped count moves off `PY_SKIP_BEFORE`.
- **`plans/041-cover-the-extraction-scripts.md` has not landed and you are about
  to start Step 5.** The 843-line verbatim move has no characterization coverage
  behind it without 041. Stop and run 041 first.
- **Step 10 cannot be run in either form** (no container runtime *and* the local
  app will not start). Report it as an unverified change rather than declaring
  the plan done — Steps 5 and 8 both altered what the container serves.
- **`tests/test_cli_extended.py` no longer contains a method named
  `test_search_all_sources`** — plan 003 may have landed and reflowed the file.
  Re-locate by method name, never by the line numbers in this plan, and if the
  method is gone entirely, stop and report.
- **You find yourself needing to edit `Makefile`, `.github/workflows/ci.yml`, or
  to create `pyproject.toml`.** All three are deliberately excluded; see Scope.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **The lock is advisory and never self-heals.** `catalog_lock` refuses to steal
  a stale lock on purpose, because the failure it guards against is
  unrecoverable data loss and a wrong steal is worse than a manual delete. If an
  operator reports "job won't start", the fix is to read
  `downloaded_cases/immigration_cases.csv.lock` (it names the job, PID and start
  time) and delete it after confirming the PID is dead. Consider a
  `--force-unlock` flag only if this becomes routine.
- **Two `_find_and_load_env` copies remain**, in `sync_judge_bios_supabase.py:22`
  and `sync_outcomes_supabase.py:24`. They were left alone because those are
  Supabase sync jobs, outside this plan's file territory. They can now be
  collapsed onto `batch_runner.load_project_env` in a one-line follow-up.
- **`immi_case_downloader/extraction/` is container payload.** Anything added
  there is copied into the extraction image, which installs `flask` and nothing
  else. Keep third-party imports function-local, and keep `__init__.py` exporting
  only `extract_regex`, `extract_llm`, `ExtractionTimeoutError`.
  `tests/test_package_import_boundary.py` guards the direction of imports;
  the Step 5 probe (run from a directory that lacks the repo root on
  `sys.path`) guards the dependency closure. Neither is wired into CI — consider
  adding the probe as a CI step when `.github/workflows/ci.yml` next opens up.
- **The Federal Court scraper is now unreachable from `cmd_search`** but
  `immi_case_downloader/sources/federal_court.py` (256 lines),
  `tests/test_federal_court.py` (152 lines) and the protocol-conformance
  assertions in `tests/test_scraper_protocol.py` all still exist. If Federal
  Court direct search is formally abandoned, deleting those three together is a
  clean follow-up; it was left out here only because two of those test files are
  also edited by `plans/003-lint-the-test-suite.md`.
- **No CI job builds the container image.** `wrangler.toml` at `42826a3` has no
  `[[containers]]` block at all — only D1 ×3, R2, Vectorize, KV, two Durable
  Objects, migrations, two queue producers, two consumers and routes — and
  `deploy-worker.yml` never runs `docker build`. So `Dockerfile` is currently
  unproven by any automation. Adding a `docker build -f Dockerfile .` step is
  worth doing the next time `.github/workflows/**` is in someone's scope; it was
  deliberately deferred here (see "Findings reconsidered").
- **What a reviewer should scrutinise**: (a) that
  `immi_case_downloader/extraction/patterns.py` is a *verbatim* copy of the moved
  block — diff it against `git show 42826a3:extract_structured_fields.py | sed -n '32,874p'`;
  (b) that `service.py` preserves every env-var name and numeric default from the
  old `extract_container.py`, since a typo there silently changes the production
  extraction cost cap; (c) that the four `atomic_write_rows` call sites kept each
  script's original backup behaviour, which differs per script.

## Findings reconsidered

Nothing was dropped. The following pieces of the audit's evidence, and of this
plan's own earlier drafts, were corrected — with reasons:

- **Step 7's instructions were self-contradictory — resolved with four verbatim
  replacements.** The draft said "replace the body of `save_csv` with a single
  `atomic_write_rows(...)` call" *and* "keep the existing
  `print(f"Backup saved to {backup_path}")` line". Following both produces a
  `NameError` on `backup_path`, or — worse — an executor who keeps the print
  above an empty-rows early return and reports a backup that was never taken.
  Step 7 now spells out all four function bodies.
- **Step 7 orphaned imports that `make lint` would then reject.** `F401` is in
  ruff's default `F` set, and after the rewrite `os` in `extract_llm_fields.py`
  (its only use was `os.replace`), `shutil` in `extract_structured_fields.py`
  and in `extract_structured_fields_llm.py` (only `shutil.copy2`), and
  `load_dotenv` in three files all become unused. `merge_llm_results.py` keeps
  `os` because `os.path.join` survives at line 40. Step 7 now lists them.
- **Step 7's `ast.parse` "parse-ok" loop could not fail for any reason this step
  risks.** It proves syntax, not names or imports. Replaced with per-file
  `ruff check --no-fix`.
- **Step 8's payload hardening only covered `len(batch)`.** A JSON array, string
  or number body still reached `payload.get(...)` and raised `AttributeError`
  → 500, and a non-mapping `item["base"]` still blew up in
  `dict(item.get("base") or {})`. Both are unauthenticated-reachable crash
  surfaces once the token is known. `parse_payload` now validates the top-level
  type, the batch type, the cap, every item's type and every `base`'s type, and
  both adapters get their own tests.
- **Step 9 traded a bad default for a worse explicit path.** Printing "Skipping."
  and returning normally means `--sources fedcourt` exits **0** with zero cases
  — automation would read that as success forever. `cmd_search`'s return value
  is discarded (`cli.py:311` is a bare `args.func(args)`), so the only way to
  signal failure is `raise SystemExit`. The default also moves to
  `["austlii"]` so the declared default no longer names a source that cannot be
  served.
- **The plan changed the Dockerfile `COPY` graph, the package import boundary,
  the container `CMD` payload and two Flask adapters without ever building or
  running the image.** The `/tmp/immi-pkg-check` probe proves the import
  closure only. Step 10 now builds the image and issues four live requests, with
  an explicit, *declared* fallback when no container runtime exists — not a
  silent skip.

Five pieces of the original audit's evidence were also corrected:

- **DEBT-09 said "five scripts" share the temp path — it is six.**
  `extract_structured_fields.py:998` also builds
  `CSV_PATH.with_suffix(".csv.tmp")` and `os.replace`s it onto the catalog at
  line 1004. The plan fixes four and archives two.
- **DEBT-09's fix sketch asked for a full "batch/worker/checkpoint runner,
  result-merge" skeleton — this plan builds only the env loader, the atomic
  writer and the lock.** The catalog these scripts operate on is gitignored and
  absent from CI, so a rewrite of the threading/checkpoint/merge logic could not
  be verified by any command an executor is allowed to run. The parts that *can*
  be unit-tested against a throwaway CSV are the parts that were shared.
- **DEBT-11's fix sketch asked for a `pyproject.toml` "so the inversion cannot
  silently return" — rejected, replaced with
  `tests/test_package_import_boundary.py`.** Ruff discovers `pyproject.toml` for
  configuration, and `plans/003-lint-the-test-suite.md` depends on the exact
  43-error `tests/` baseline measured at `42826a3`; introducing a project file
  risks moving that baseline for no gain. A test that AST-walks the package and
  fails on any repo-root import enforces the same invariant, is cheaper, and runs
  in the existing suite.
- **DEBT-18 cited `scripts/fetch_judge_photos.py:19` for the hardcoded path — it
  is line 18.** Line 19 is `BIOS = ROOT / 'downloaded_cases' / 'judge_bios.json'`.
  The finding otherwise holds exactly: `/Users/d/Developer/IMMI-Case-` does not
  exist, so lines 19–21 all resolve wrong and the script cannot run. Also, the
  two photo scripts total **827** lines (111 + 716), not "1,300+"; the 1,876 (in
  fact 2,547 including `reextract_judges.py`) figure covers the whole judge-data
  cluster.
- **DEBT-19's fix sketch offered "delete `federal_court.py` with its tests" —
  this plan takes the other branch it offered and gates the CLI instead.**
  Deleting the module forces edits into `tests/test_federal_court.py` and
  `tests/test_scraper_protocol.py`, both of which `plans/003-lint-the-test-suite.md`
  rewrites via `ruff check --fix tests/`. Gating in `cmd_search` removes the
  user-visible defect (a default `python run.py search` hammering an
  unresolvable host) with one file's worth of blast radius.
- **DEPS-15's fix sketch said keep `Dockerfile.extractor` and delete
  `Dockerfile` — this plan does the reverse.** Three live call sites already name
  `Dockerfile`: `config/wrangler-extraction-container.toml.example:19`
  (`image = "./Dockerfile"` — the name the container build actually consumes),
  `config/wrangler-legacy-rollback.toml.example:27`, and
  `scripts/verify_immi_separation.py:221` (`immi_root / "Dockerfile"`, a
  preflight gate). Exactly one file names `Dockerfile.extractor`:
  `tests/test_extraction_container_boundary.py:12`. Keeping `Dockerfile` costs
  one test edit; keeping `Dockerfile.extractor` would cost four edits including
  two operator-facing config examples and a fail-closed separation gate.
- **DX-19 cited `entrypoint.sh:9` — the file is 8 lines**, and the
  `exec python web.py --host 0.0.0.0 --port 8080 --backend supabase` line is
  line 8. Its "add a `docker build` step to CI" half is **deferred, not done**:
  `.github/workflows/**` is owned by plans 001–003 in this batch, `wrangler.toml`
  has no `[[containers]]` binding for the image to serve, and standing up a
  Docker job on the WSL self-hosted runner is a larger piece of work than this
  plan's remaining scope. It is recorded in Maintenance notes so it is not
  re-discovered from scratch.
