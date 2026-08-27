# Plan 036: Pin, lock and declare what the code actually imports

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or `plans/README.md` does not exist (it did not exist
> when this plan was written; if it is still absent, skip that update
> silently).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   requirements.txt requirements-app.txt requirements-test.txt \
>   requirements-extractor.txt \
>   Makefile .github/workflows/ci.yml Dockerfile Dockerfile.extractor
> ```
>
> **Expected**: `Makefile` and `.github/workflows/ci.yml` **will** appear in
> that diff, because this plan's two dependencies
> (`plans/002-fix-test-collection-and-install.md` and
> `plans/003-lint-the-test-suite.md`) both edit them. That is normal. The
> section "What plans 002 and 003 change before you start" below lists exactly
> what they change so you can tell an expected difference from real drift.
>
> `requirements.txt`, `requirements-app.txt`, `requirements-test.txt`,
> `requirements-extractor.txt`, `Dockerfile` and `Dockerfile.extractor` must be
> **unchanged** since `42826a3`. If any of those six shows a diff, compare the
> "Current state" excerpts against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Every edit in this plan is anchored on unique text, never on a line
> number.** Re-read each file with `Read` immediately before editing it. Line
> numbers in "Current state" are the ones observed at `42826a3` and will have
> shifted if plans 002/003 landed.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-fix-test-collection-and-install.md`,
  `plans/003-lint-the-test-suite.md`
- **Category**: migration
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Every Python dependency in this repository is declared with a floor and no
ceiling, and there is no lockfile anywhere. Two of those floors have already
been crossed silently at the major-version boundary: `requirements-app.txt:8`
asks for `pandas>=2.0.0` and the installed interpreter has **pandas 3.0.3**;
line 17 asks for `numpy>=1.24.0` and has **numpy 2.4.5**. This is not
hypothetical drift — measured on 2026-08-27, a fresh resolve of the *same two
manifests* on Python 3.12 today produces different versions of eight packages
(`beautifulsoup4` 4.14.3→4.15.0, `lxml` 6.1.0→6.1.2, `numpy` 2.4.5→2.5.2,
`pandas` 3.0.3→3.0.5, `pillow` 12.2.0→12.3.0, `pypdf` 6.11.0→6.16.2, `pytest`
9.0.3→9.1.1, `supabase` 2.30.0→2.31.0) than the environment that produced this
project's trusted "1141 passed" baseline. So the baseline is measured against
an environment nobody can recreate, and the next upstream break will land as an
unbisectable red build on an unrelated pull request.

Two smaller declarations are wrong in the same file: `tqdm` and (as a *direct*
dependency) `python-dateutil` are declared but imported nowhere, while four
packages the code genuinely imports — `anthropic`, `google-generativeai`,
`google-genai` and `PyJWT` — are declared nowhere at all. And `ruff==0.15.18`
is pinned with no ruff config in the repository, which makes the version pin
itself the rule selection: the gate passes only because ruff's *unconfigured
default* is `E4`/`E7`/`E9`/`F`.

After this plan lands, `constraints.txt` is the single reproducible record of
the environment that passes the suite, every manifest carries an upper bound,
`pyproject.toml` declares the lint rule set independently of the ruff version,
and the four undeclared imports have a home.

## Current state

### The files this plan touches, and what each is

| File | Role today |
|---|---|
| `requirements.txt` | 3-line compatibility shim. Two comment lines + `-r requirements-extractor.txt`. Nothing in the build path reads it (verified below). |
| `requirements-app.txt` | 19 lines. The real runtime/dev dependency set: 16 packages, all floor-only except `flask`. |
| `requirements-test.txt` | 7 lines. Test dependencies; `ruff` exact-pinned, everything else floor-only. |
| `requirements-extractor.txt` | 1 line: `flask>=3.0.0,<4`. The Cloudflare extraction Container's whole dependency set. |
| `Makefile` | Developer entry points. `install:` pip-installs the app + test manifests; `lint:` runs ruff. |
| `.github/workflows/ci.yml` | Three jobs. `test-python` creates a venv, pip-installs the two manifests, runs ruff, runs pytest. |
| `Dockerfile` | Active Cloudflare Container image (extraction only). Installs `requirements-extractor.txt`. |
| `Dockerfile.extractor` | Byte-identical to `Dockerfile` apart from `Dockerfile`'s 3-line header comment. |
| `constraints.txt` | **Does not exist yet.** You create it in Step 3. |
| `constraints-extractor.txt` | **Does not exist yet.** You create it in Step 5. |
| `pyproject.toml` | **Does not exist yet.** You create it in Step 6. |
| `requirements-llm.txt` | **Does not exist yet.** You create it in Step 7. |

A `find` over the repository (excluding `.venv/` and `node_modules/`) at
`42826a3` returns **no** `pyproject.toml`, `ruff.toml`, `.ruff.toml`,
`constraints*.txt`, `setup.cfg`, `tox.ini` or `.python-version`. There is no
`.github/dependabot.yml`; `.github/` contains only `workflows/` with `ci.yml`
and `deploy-worker.yml`.

### `requirements-app.txt` (verbatim, all 19 lines at `42826a3`)

```
# Application/runtime dependencies for the Flask app, CLI, and local development.
# Test-only dependencies live in requirements-test.txt.
# The Cloudflare extraction Container uses requirements-extractor.txt.
flask>=3.0.0,<4
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0
pandas>=2.0.0
tqdm>=4.65.0
python-dateutil>=2.8.0
flask-wtf>=1.2.0
Flask-Limiter>=3.5
supabase>=2.0.0
psycopg2-binary>=2.9.0
python-dotenv>=1.0.0
fuzzywuzzy>=0.18.0
numpy>=1.24.0
Pillow>=10.0.0
pypdf>=4.0.0
```

`tqdm` is line 9, `python-dateutil` line 10, `fuzzywuzzy` line 16, `numpy`
line 17.

### `requirements-test.txt` (verbatim, all 7 lines at `42826a3`)

```
pytest>=7.4.0
pytest-asyncio>=0.24.0
pytest-cov>=4.1.0
pytest-timeout>=2.3.1
responses>=0.25.0
freezegun>=1.4.0
ruff==0.15.18  # pinned: 0.16 expanded default rules (394 new findings); bump deliberately with a cleanup pass
```

### `requirements.txt` (verbatim, all 3 lines at `42826a3`)

```
# Compatibility shim for external tooling that still expects requirements.txt.
# New consumers must use requirements-app.txt or requirements-extractor.txt explicitly.
-r requirements-extractor.txt
```

`requirements-extractor.txt` is exactly one line: `flask>=3.0.0,<4`. So
`pip install -r requirements.txt` installs **one** package while the 16 real
app dependencies sit in `requirements-app.txt`, unseen by any tool that
defaults to the root manifest name.

Verified: the only in-repo consumers of any requirements file are
`Dockerfile:7-8`, `Dockerfile.extractor:4-5` (both
`requirements-extractor.txt`), `Makefile:101`, `README.md:118` and
`.github/workflows/ci.yml:29` (all `requirements-app.txt` +
`requirements-test.txt`). One documentation file, `frontend/e2e/README.md:138`,
still tells readers to `pip install -r requirements.txt` — which today installs
Flask and nothing else. **Nothing builds from `requirements.txt`**, so
repointing it is safe.

### `Makefile:100-105` (verbatim; recipe lines are TAB-indented)

```make
install:
	"$(PYTHON)" -m pip install -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install
```

### `Makefile:92-96` (verbatim)

```make
lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit
```

### `.github/workflows/ci.yml:22-32` (verbatim)

```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Python dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt

      - name: Lint with ruff
        run: .venv/bin/ruff check immi_case_downloader/ scripts/ *.py
```

### `Dockerfile` (verbatim, all 17 lines at `42826a3`)

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

`Dockerfile.extractor` is the same file without the first three comment lines,
so its `COPY requirements-extractor.txt .` is line 4 and its
`RUN pip install --no-cache-dir -r requirements-extractor.txt` is line 5.

### The guard rail on the two Dockerfiles — read this before Step 5

`tests/test_extraction_container_boundary.py:9-15` (verbatim):

```python
def test_extraction_image_and_source_have_no_database_runtime_markers() -> None:
    source = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in ("Dockerfile", "Dockerfile.extractor", "extract_container.py", "requirements-extractor.txt")
    ).lower()
    for marker in ("supabase", "postgres", "hyperdrive", "database_url", "service_role"):
        assert marker not in source, marker
```

Any text you add to either Dockerfile or to `requirements-extractor.txt` is
concatenated and lowercased by this test. It must not contain the substrings
`supabase`, `postgres`, `hyperdrive`, `database_url` or `service_role`. This is
**the** reason Step 5 gives the extraction image its own
`constraints-extractor.txt` (7 Flask-closure pins) instead of copying the root
`constraints.txt`, which pins `supabase`, `supabase-auth`,
`supabase-functions`, `postgrest` and `psycopg2-binary`.

`.dockerignore` was checked: it excludes `downloaded_cases/`, images,
`node_modules/`, `frontend/`, dotfile directories, `scripts/`, `tests/`,
`workers/`, `docs/`, `*.log`, `*.pid` and `=*`. It does **not** exclude
`*.txt`, so a new root-level `constraints-extractor.txt` is inside the build
context and `COPY` will find it.

### KNOWN LOCAL DEFECT — `pip install` cannot run inside this repo's `.venv`

Verified 2026-08-27, and it shapes every verification in this plan. The
Homebrew `python@3.14` 3.14.7 build that `.venv` was created from has a
`pyexpat` extension linked against a newer libexpat than
`/usr/lib/libexpat.1.dylib`. `pip` imports `xml.parsers.expat` transitively via
`xmlrpc.client`, so `pip install` and `pip freeze` both die:

```
$ .venv/bin/python -m pip install --dry-run --no-deps tqdm
ImportError: dlopen(.../lib-dynload/pyexpat.cpython-314-darwin.so, 0x0002):
  Symbol not found: _XML_SetAllocTrackerActivationThreshold
  Expected in: /usr/lib/libexpat.1.dylib
```

The same defect is why `make test-py` reports **3 failed** (all in
`tests/test_backfill_judge_overrides_from_pdf.py`, all the `pypdf` import).
It is a Homebrew build defect, not a repo defect and not venv staleness — the
identical error reproduces from the base interpreter outside any venv
(`/opt/homebrew/opt/python@3.14/bin/python3.14 -c 'import pyexpat'`).

Consequences you must respect:

1. **Do not run a live `pip install` against `.venv`.** Do not try to repair
   the interpreter. Do not delete or recreate `.venv`.
2. `constraints.txt` is generated from `importlib.metadata`, which works fine
   (verified: enumerates 85 distributions), not from `pip freeze`.
3. Resolvability is verified in a **scratch venv outside the repository**.
   `python3` on this machine resolves to
   `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3` (python.org
   3.14.0), whose `pyexpat` works — verified:
   `python3 -m venv /tmp/x && /tmp/x/bin/python -c "import xml.parsers.expat"`
   prints nothing and exits 0.

### What plans 002 and 003 change before you start

Both are hard dependencies and run first. Expect to find these already applied;
do **not** re-apply or revert them.

- `plans/003-lint-the-test-suite.md` — widens the ruff path list in
  `Makefile`'s `lint:` recipe and in ci.yml's `Lint with ruff` step to include
  `tests/`, and fixes the 43 findings that widening surfaces (32 `F401`,
  6 `E712`, 4 `F841`, 1 `E741`).
- `plans/002-fix-test-collection-and-install.md` — replaces the `Makefile`
  `install:` recipe with a version that creates `.venv` first and uses
  `$(VENV_PYTHON)` instead of `$(PYTHON)`; adds an `install-e2e:` target and a
  `requirements-e2e.txt` (holding `pytest-playwright`); and rewrites ci.yml's
  `test-python` job into a `python-version: ["3.12", "3.14"]` matrix with
  `cache: pip` and a `cache-dependency-path` listing `requirements-app.txt` and
  `requirements-test.txt`. Plan 002 deliberately leaves `requirements-test.txt`
  itself untouched.

Because plan 002 may or may not have restructured those two recipes by the time
you run, **every edit below is anchored on a substring that is identical in
both the pre-002 and post-002 forms**, and the two places where plan 002 adds
something new are handled by an explicit `grep` guard.

### Repo conventions this plan must honour

- **Commit messages**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.
- **Venv is mandatory**: use `.venv/bin/python`, `.venv/bin/pytest`,
  `.venv/bin/ruff`. Never global `pip`. (In this plan you never *install*
  anything into `.venv` — see the KNOWN LOCAL DEFECT above.)
- **Do NOT "fix" these — they are deliberate**: the placeholder resource IDs in
  the checked-in `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the
  pipeline flags defaulting to `"false"`;
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase;
  the `CLAUDE.md` "Performance Baseline (2026-05-05)" section being historical.
- Production is a standalone Cloudflare Worker (`workers/cloudflare-native.js`)
  with **no Python at all**. The Flask app, the CLI and every script named in
  this plan are local-dev / batch-job tooling. Nothing in this plan can change
  production behaviour; the only shipped artifact it touches is the extraction
  Container image.

## Commands you will need

All commands run from `/Users/d/Developer/Active Projects/IMMI-Case-`.

| Purpose | Command | Expected on success |
|---|---|---|
| Python unit tests | `make test-py` | `1141 passed, 3 failed, 7 skipped` (unchanged by this plan — you install nothing). The 3 failures are the environmental `pyexpat` ones described above. |
| One test file | `.venv/bin/pytest tests/test_extraction_container_boundary.py -q` | `2 passed` |
| Python lint | `make lint` | `All checks passed!` |
| Ruff with an explicit config | `.venv/bin/ruff check --no-cache immi_case_downloader/ scripts/ *.py` | `All checks passed!`, exit 0 |
| Whole-repo ruff statistics | `.venv/bin/ruff check --no-cache --statistics .` | after plan 003: `All checks passed!`. Before plan 003: `Found 43 errors.` |
| Frontend tests | `cd frontend && npx vitest run` | `490 passed`, 55 files (untouched by this plan) |
| Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files (untouched by this plan) |
| Create the scratch venv | `rm -rf /tmp/immi-dep-check && python3 -m venv /tmp/immi-dep-check` | exit 0 |
| Prove the scratch venv is healthy | `/tmp/immi-dep-check/bin/python -c "import xml.parsers.expat; print('expat OK')"` | `expat OK` |
| Resolve under constraints (pip) | see Step 3 | exit 0, no output |
| Resolve under constraints (uv, Python 3.12) | see Step 3 | exit 0 |

**Never** run `pip install` against `.venv`. **Never** run `.venv/bin/pip
freeze`.

## Scope

**In scope** (the only files you may modify or create):

- `requirements-app.txt`
- `requirements-test.txt`
- `requirements.txt`
- `constraints.txt` — **create**
- `constraints-extractor.txt` — **create**
- `pyproject.toml` — **create**
- `requirements-llm.txt` — **create**
- `Makefile` — the `install:` recipe's pip line only (and `install-e2e:`'s pip
  line if plan 002 created it)
- `.github/workflows/ci.yml` — the `test-python` job's "Install Python
  dependencies" step only (and its `cache-dependency-path` list if plan 002
  created one)
- `Dockerfile` — the `COPY` and `RUN pip install` lines only
- `Dockerfile.extractor` — the `COPY` and `RUN pip install` lines only
- `plans/README.md` — status row for this plan only, and only if that file
  exists

**Out of scope** (do NOT touch, even though they look related):

- **`requirements-extractor.txt`.** Its single `flask>=3.0.0,<4` line already
  carries an upper bound, and its text is concatenated into the boundary test
  above. Pin the closure in `constraints-extractor.txt` instead.
- **Any `.py` file.** In particular
  `immi_case_downloader/normalize_judge_names.py` (the `fuzzywuzzy` import),
  `validate_extraction.py`, `scripts/refine_data.py`,
  `scripts/build_judge_name_overrides.py`,
  `scripts/check_immi_activation_evidence.py`, `scripts/extract_gemini.py` and
  `immi_case_downloader/sources/base.py` (the seven `B023`/`B904`/`B030`/
  `RUF013` findings). This plan changes *declarations*, never code. See
  "Findings reconsidered".
- **Unpinning `ruff`.** Keep `ruff==0.15.18`. You cannot install a different
  ruff on this machine (pip is broken in `.venv`), so an unpin would be
  unverifiable, and the project has an explicit deferred decision to revisit
  ruff 0.16 after **2026-09-23** — later than today.
- **Widening `[tool.ruff.lint] select`** beyond today's effective defaults.
  Step 6's whole point is a provable no-op. Adopting `I`/`UP`/`B`/`SIM`/`PTH`
  is a separate, code-editing plan.
- **`requirements-e2e.txt`, `pytest-playwright` and `playwright`.** Plan 002
  owns them. Do not add playwright to `requirements-test.txt` — that would make
  CI's `test-python` job download a browser driver for a suite it never runs.
- **`.python-version`, `.github/dependabot.yml`, recreating `.venv`, changing
  `python-version` in ci.yml, changing `FROM python:3.12-slim`.** See "Findings
  reconsidered" for why each is deliberately excluded.
- **`README.md`, `CLAUDE.md`, `frontend/e2e/README.md`.** `README.md:118` and
  `frontend/e2e/README.md:138` will both be stale after this plan (neither
  mentions `constraints.txt`). Documentation is another plan's territory —
  report the staleness in your handoff instead of editing.

## Git workflow

- Branch: `advisor/036-bound-the-python-dependencies`
- One commit per step, or per logical unit. Message style — conventional
  commits, matching `git log`:
  - Step 1–2: `chore: bound the python dependency ranges and drop unused tqdm`
  - Step 3–4: `chore: lock the python dependency closure with constraints.txt`
  - Step 5: `chore: pin the extraction container dependency closure`
  - Step 6: `chore: declare the ruff rule set in pyproject.toml`
  - Step 7–8: `chore: declare the undeclared llm dependencies`
- Do **not** push, do **not** open a pull request, do **not** merge. The
  operator commits and ships.

## Steps

### Step 1: Bound `requirements-app.txt`, delete `tqdm`, record intent for `python-dateutil` and `fuzzywuzzy`

Replace the whole file with the content below. Three substantive changes: every
entry gains an upper bound at the next major; the `tqdm>=4.65.0` line is
**deleted**; and two comments record why `python-dateutil` and `fuzzywuzzy`
stay.

Every ceiling was checked against the version actually installed today, so none
of them excludes the working set: flask 3.1.3, requests 2.34.2, beautifulsoup4
4.14.3, lxml 6.1.0, pandas 3.0.3, python-dateutil 2.9.0.post0, Flask-WTF 1.3.0,
Flask-Limiter 4.1.1, supabase 2.30.0, psycopg2-binary 2.9.12, python-dotenv
1.2.2, fuzzywuzzy 0.18.0, numpy 2.4.5, pillow 12.2.0, pypdf 6.11.0.

```
# Application/runtime dependencies for the Flask app, CLI, and local development.
# Test-only dependencies live in requirements-test.txt.
# The Cloudflare extraction Container uses requirements-extractor.txt.
# LLM batch-job dependencies live in requirements-llm.txt (not installed by
# `make install`).
#
# Every entry carries an upper bound at the next major version. Exact versions
# for the whole transitive closure live in constraints.txt; install with
#   pip install -c constraints.txt -r requirements-app.txt -r requirements-test.txt
flask>=3.0.0,<4
requests>=2.31.0,<3
beautifulsoup4>=4.12.0,<5
lxml>=4.9.0,<7
pandas>=2.0.0,<4
# Transitive dependency of pandas and freezegun. Declared directly on purpose so
# the date-parsing floor is explicit and does not silently move when pandas
# changes its own requirement. Not imported anywhere in this repository.
python-dateutil>=2.8.0,<3
flask-wtf>=1.2.0,<2
Flask-Limiter>=3.5,<5
supabase>=2.0.0,<3
psycopg2-binary>=2.9.0,<3
python-dotenv>=1.0.0,<2
# Unmaintained: 0.18.0 (2020) is the final upstream release, and importing it
# emits "Using slow pure-python SequenceMatcher". Sole consumer in this repo is
# immi_case_downloader/normalize_judge_names.py, whose own sole consumer is
# tests/test_judge_normalization.py. Migration target if it ever breaks:
# rapidfuzz (drop-in fuzz.ratio, C++ backed, no separate Levenshtein extra).
fuzzywuzzy>=0.18.0,<1
numpy>=1.24.0,<3
Pillow>=10.0.0,<13
pypdf>=4.0.0,<7
```

`tqdm` and `python-dateutil` were both confirmed unimported: a recursive grep
for each over every `*.py` in the repository, excluding `.venv/`,
`node_modules/` and `__pycache__/`, returns zero matches. Do **not** extend that
grep heuristic to the rest of the file — `lxml` is used by passing the string
`"lxml"` as a BeautifulSoup parser name rather than importing it, and `pypdf`
is imported dynamically.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c '^tqdm' requirements-app.txt; \
  grep -cE '^[A-Za-z][A-Za-z0-9_.-]*>=' requirements-app.txt; \
  grep -cE '^[A-Za-z][A-Za-z0-9_.-]*>=[^,]+$' requirements-app.txt
```

→ `0` (tqdm gone), then `15` (fifteen requirement lines), then `0` (no
requirement line lacks a ceiling).

### Step 2: Bound `requirements-test.txt`, declare `PyJWT`, and note that the ruff pin no longer selects rules

Replace the whole file with:

```
# Test-only dependencies. Runtime dependencies live in requirements-app.txt.
# Exact versions for the whole transitive closure live in constraints.txt.
pytest>=7.4.0,<10
pytest-asyncio>=0.24.0,<2
pytest-cov>=4.1.0,<8
pytest-timeout>=2.3.1,<3
responses>=0.25.0,<1
freezegun>=1.4.0,<2
# Used by tests/integration/test_revoke_member.py. It also arrives transitively
# via supabase-auth; declared here so the test suite does not depend on that
# accident.
PyJWT>=2.8.0,<3
# Pinned: 0.16 expanded default rules (394 new findings); bump deliberately with
# a cleanup pass. The rule set is now declared explicitly in pyproject.toml
# [tool.ruff.lint], so this pin no longer *selects* rules — it only freezes rule
# implementations and available fixes. Revisit after 2026-09-23.
ruff==0.15.18
```

Ceilings checked against installed versions: pytest 9.0.3, pytest-asyncio
1.4.0, pytest-cov 7.1.0, pytest-timeout 2.4.0, responses 0.26.0, freezegun
1.5.5, PyJWT 2.12.1. Adding `PyJWT` installs nothing new — it is already in the
environment as a `supabase-auth` transitive dependency.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'ruff==0.15.18' requirements-test.txt; \
  grep -c '^PyJWT' requirements-test.txt; \
  grep -cE '^[A-Za-z][A-Za-z0-9_.-]*>=[^,]+$' requirements-test.txt
```

→ `1`, `1`, `0`.

Then confirm the pinned ruff is still the one on PATH and the gate is still
green (nothing was installed, so this must be unchanged):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff --version && make lint
```

→ `ruff 0.15.18`, then `All checks passed!`.

### Step 3: Create `constraints.txt` from the environment that passes the suite

`pip freeze` cannot run here (see KNOWN LOCAL DEFECT). Generate the file from
`importlib.metadata` instead. Run **exactly** this, from the repo root:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && cat > constraints.txt <<'HEADER'
# Exact versions for the full transitive closure of
# requirements-app.txt + requirements-test.txt.
#
# Snapshot of the environment that produced this project's known-good test
# baseline (1141 passed / 3 failed / 7 skipped) at commit 42826a3, 2026-08-27.
# The 3 failures are environmental — a Homebrew python@3.14 pyexpat/libexpat
# ABI mismatch breaks the pypdf import in
# tests/test_backfill_judge_overrides_from_pdf.py — not repo defects.
#
# Install with:
#   pip install -c constraints.txt -r requirements-app.txt -r requirements-test.txt
#
# To bump: upgrade in a venv whose `make test-py` run is green, regenerate this
# whole file, and commit the new snapshot as one reviewable diff. Never
# hand-edit a single pin — an unverified line here is worse than no lockfile,
# because it looks verified.
HEADER
.venv/bin/python - >> constraints.txt <<'PY'
from importlib.metadata import distributions

SKIP = {"pip", "setuptools", "wheel", "tqdm"}
rows = sorted(
    {(d.metadata["Name"], d.version) for d in distributions()},
    key=lambda r: r[0].lower(),
)
print("\n".join(f"{n}=={v}" for n, v in rows if n.lower() not in SKIP))
PY
```

`tqdm` is excluded because Step 1 removed it as a declared dependency and
nothing else requires it (confirmed: resolving the edited manifests without it
produces a closure that does not contain `tqdm`).

The resulting pin block must be these **84 lines**, in this order (generated and
verified on 2026-08-27):

```
annotated-types==0.7.0
anyio==4.13.0
beautifulsoup4==4.14.3
blinker==1.9.0
cachetools==6.2.6
certifi==2026.4.22
cffi==2.0.0
charset-normalizer==3.4.7
click==8.3.3
coverage==7.14.0
cryptography==48.0.0
Deprecated==1.3.1
deprecation==2.1.0
Flask==3.1.3
Flask-Limiter==4.1.1
Flask-WTF==1.3.0
freezegun==1.5.5
fsspec==2026.4.0
fuzzywuzzy==0.18.0
h11==0.16.0
h2==4.3.0
hpack==4.1.0
httpcore==1.0.9
httpx==0.28.1
hyperframe==6.1.0
idna==3.15
iniconfig==2.3.0
itsdangerous==2.2.0
Jinja2==3.1.6
limits==5.8.0
lxml==6.1.0
markdown-it-py==4.2.0
MarkupSafe==3.0.3
mdurl==0.1.2
mmh3==5.2.1
multidict==6.7.1
numpy==2.4.5
ordered-set==4.1.0
packaging==26.2
pandas==3.0.3
pillow==12.2.0
pluggy==1.6.0
postgrest==2.30.0
propcache==0.5.2
psycopg2-binary==2.9.12
pycparser==3.0
pydantic==2.13.4
pydantic_core==2.46.4
Pygments==2.20.0
pyiceberg==0.11.1
PyJWT==2.12.1
pyparsing==3.3.2
pypdf==6.11.0
pyroaring==1.1.0
pytest==9.0.3
pytest-asyncio==1.4.0
pytest-cov==7.1.0
pytest-timeout==2.4.0
python-dateutil==2.9.0.post0
python-dotenv==1.2.2
PyYAML==6.0.3
realtime==2.30.0
requests==2.34.2
responses==0.26.0
rich==14.3.4
ruff==0.15.18
six==1.17.0
soupsieve==2.8.3
storage3==2.30.0
StrEnum==0.4.15
strictyaml==1.7.3
supabase==2.30.0
supabase-auth==2.30.0
supabase-functions==2.30.0
tenacity==9.1.4
typing-inspection==0.4.2
typing_extensions==4.15.0
urllib3==2.7.0
websockets==15.0.1
Werkzeug==3.1.8
wrapt==2.1.2
WTForms==3.2.2
yarl==1.23.0
zstandard==0.25.0
```

If your generated block differs from this list, the environment has changed
since this plan was written — that is a **STOP condition**, not something to
paper over by pasting the list above. Report the diff.

Now prove the pinned set actually resolves, on both interpreters CI cares
about. First with pip, on a healthy scratch interpreter outside the repo:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  rm -rf /tmp/immi-dep-check && python3 -m venv /tmp/immi-dep-check && \
  /tmp/immi-dep-check/bin/python -c "import xml.parsers.expat; print('expat OK')" && \
  /tmp/immi-dep-check/bin/python -m pip install --dry-run --quiet \
    --disable-pip-version-check \
    -c constraints.txt -r requirements-app.txt -r requirements-test.txt
echo "pip dry-run exit=$?"
```

Then, if `uv` is on PATH, the Python 3.12 leg that CI and the container image
both run (this is the stronger check — pip's dry-run uses the *local*
interpreter's version, uv can target 3.12 directly):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  uv pip compile --quiet --python-version 3.12 --constraints constraints.txt \
    requirements-app.txt requirements-test.txt -o /tmp/immi-resolved-312.txt && \
  grep -cE '^[A-Za-z0-9_.-]+==' /tmp/immi-resolved-312.txt
```

If `uv` is not installed, skip this second command and say so in your handoff —
do not install uv.

**Verify**: three results, all required.

1. `grep -c '==' constraints.txt` → `84`
2. `pip dry-run exit=0` and no error output from the pip command
3. `uv pip compile` (when available) exits 0 and prints `84`

Result 3 printing `84` means the resolver needed *exactly* the pinned set on
Python 3.12 — no package fell outside a pin, and no pin was left unused.
(Verified on 2026-08-27: both commands succeed and the 3.12 resolution is
set-identical to `constraints.txt`.)

### Step 4: Make `make install` and CI install through the constraints file

Two anchored edits.

**`Makefile`** — find the line containing
`-m pip install -r requirements-app.txt -r requirements-test.txt` inside the
`install:` recipe. Its leading variable is `$(PYTHON)` before plan 002 and
`$(VENV_PYTHON)` after; leave whichever you find alone. Change only the pip
arguments:

- from: `-m pip install -r requirements-app.txt -r requirements-test.txt`
- to:   `-m pip install -c constraints.txt -r requirements-app.txt -r requirements-test.txt`

Then, **only if plan 002 has landed**, do the same for its E2E target:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n 'install-e2e' Makefile
```

If that prints nothing, skip this paragraph. If it prints a match, find the
line containing `-m pip install -r requirements-e2e.txt` and change it to
`-m pip install -c constraints.txt -r requirements-e2e.txt`. This is valid even
though `pytest-playwright` and `playwright` are absent from `constraints.txt` —
a constraints file caps the packages it names and leaves the rest free.

**`.github/workflows/ci.yml`** — find the line
`.venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt`
in the `test-python` job's "Install Python dependencies" step and change it to:

```
          .venv/bin/pip install --quiet -c constraints.txt -r requirements-app.txt -r requirements-test.txt
```

Then, **only if plan 002 has landed**, keep the pip cache key honest:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n 'cache-dependency-path' .github/workflows/ci.yml
```

If that prints nothing, skip. If it prints a match inside the `test-python`
job, add `constraints.txt` as an entry in that list, alongside
`requirements-app.txt` and `requirements-test.txt`, at the same indentation.
Without it, a constraints-only change would reuse a stale pip cache.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'pip install -c constraints.txt -r requirements-app.txt' Makefile; \
  grep -c 'pip install --quiet -c constraints.txt -r requirements-app.txt' .github/workflows/ci.yml; \
  python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml parses')"; \
  make -n install | grep -c 'constraints.txt'
```

→ `1`, `1`, `ci.yml parses`, and `1` or more.

`make -n` prints the recipe without executing it — it must **not** actually run
pip. If `make -n install` errors or attempts a real install, STOP.

If `python3 -c "import yaml"` fails because PyYAML is absent from the python.org
interpreter, use `/tmp/immi-dep-check/bin/python` after installing nothing —
or fall back to
`.venv/bin/python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml parses')"`,
which works (PyYAML 6.0.3 is in `.venv`, and this reads rather than installs).

### Step 5: Pin the extraction container's dependency closure

The extraction image installs `flask>=3.0.0,<4`, so every container build can
pull a different Flask 3.x and a different Werkzeug/Jinja2/click alongside it.
Give it its own constraints file — deliberately **not** the root
`constraints.txt`, which names `supabase`/`postgrest`/`psycopg2-binary` and has
no business inside an image whose entire premise is "no database runtime".

Create `constraints-extractor.txt` at the repo root with exactly this content
(the resolved Flask 3.1.3 closure; verified 2026-08-27 to resolve on Python
3.12 and to be version-consistent with `constraints.txt`):

```
# Exact versions for the transitive closure of requirements-extractor.txt
# (flask alone) as installed into the Cloudflare extraction Container image.
# Kept separate from constraints.txt on purpose: the root file pins database
# clients, and tests/test_extraction_container_boundary.py exists to keep any
# database runtime marker out of this image.
blinker==1.9.0
click==8.3.3
Flask==3.1.3
itsdangerous==2.2.0
Jinja2==3.1.6
MarkupSafe==3.0.3
Werkzeug==3.1.8
```

Then edit **both** `Dockerfile` and `Dockerfile.extractor`. In each, replace the
two-line block:

```dockerfile
COPY requirements-extractor.txt .
RUN pip install --no-cache-dir -r requirements-extractor.txt
```

with:

```dockerfile
COPY requirements-extractor.txt constraints-extractor.txt ./
RUN pip install --no-cache-dir -c constraints-extractor.txt -r requirements-extractor.txt
```

If that exact two-line block is not present verbatim in either file, STOP —
`plans/032-consolidate-the-extraction-scripts.md` also edits these files and
may have restructured them.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c '^[A-Za-z]' constraints-extractor.txt; \
  grep -c 'constraints-extractor.txt' Dockerfile; \
  grep -c 'constraints-extractor.txt' Dockerfile.extractor; \
  grep -ciE 'supabase|postgres|hyperdrive|database_url|service_role' constraints-extractor.txt; \
  .venv/bin/pytest tests/test_extraction_container_boundary.py -q 2>&1 | tail -2
```

→ `7`, `2`, `2`, `0`, and `2 passed`.

Then prove the extractor pin set resolves:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  /tmp/immi-dep-check/bin/python -m pip install --dry-run --quiet \
    --disable-pip-version-check \
    -c constraints-extractor.txt -r requirements-extractor.txt
echo "extractor dry-run exit=$?"
```

→ `extractor dry-run exit=0`, no error output.

Note: nothing in CI builds this image (`.github/workflows/deploy-worker.yml`
contains no `docker build`), so the boundary test above and the dry-run are the
only gates. Do not add a Docker build step.

### Step 6: Create `pyproject.toml` and declare the ruff rule set explicitly

Today `make lint` passes because ruff's **unconfigured default** `select` is
`E4`, `E7`, `E9`, `F` and nothing more. That makes `ruff==0.15.18` the de facto
rule selection: any ruff release that widens defaults re-runs the same crisis.
Declaring the same four prefixes explicitly decouples the gate from the version
while changing nothing about which findings are reported.

Create `pyproject.toml` at the repo root with exactly this content:

```toml
# Ruff configuration only. Deliberately no [project] or [build-system] table:
# this repository is run in place (web.py, run.py, `make api`), it is not
# pip-installed, and adding packaging metadata would change how setuptools and
# pytest discover the tree for no benefit.

[tool.ruff]
# Lowest interpreter the project supports, per README.md's prerequisites table
# ("Python | 3.11+ | 3.14 已驗證可用"). CI exercises 3.12; the extraction
# container image is python:3.12-slim; the local .venv is 3.14. target-version
# is the floor, so it must stay at the lowest of those.
target-version = "py311"
# E501 (line-too-long) is NOT selected below, so this value is not yet enforced.
# It records the agreed target for when E501 is adopted: 166 lines under
# immi_case_downloader/ + scripts/ + *.py exceed 120 today, versus 1109 at
# ruff's default 88.
line-length = 120

[tool.ruff.lint]
# These four prefixes are exactly ruff 0.15.18's unconfigured default select.
# Stating them here is a deliberate no-op that stops the ruff version pin in
# requirements-test.txt from being the rule selection. Widening this list is a
# separate, code-editing change: measured 2026-08-27, `--select
# E,W,F,I,UP,B,SIM,C4,ARG,PTH,RUF` over the same paths reports 1683 findings
# (162 auto-fixable). Adopt one family per commit; do not bulk-enable.
select = ["E4", "E7", "E9", "F"]
```

**Verify**: the config must be a provable no-op. Both of these must match what
they printed before the file existed.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/ruff check --no-cache immi_case_downloader/ scripts/ *.py; echo "scoped exit=$?"; \
  .venv/bin/ruff check --no-cache --statistics . 2>&1 | tail -3; \
  make lint
```

→ `All checks passed!` then `scoped exit=0`; the whole-repo statistics must be
`All checks passed!` if plan 003 has landed, or exactly
`Found 43 errors.` (32 `F401`, 6 `E712`, 4 `F841`, 1 `E741`) if it has not; and
`make lint` → `All checks passed!`.

If the whole-repo count is any number other than 0 or 43, the config is not a
no-op — STOP and report.

Then confirm the new file did not disturb pytest's configuration discovery
(`pytest.ini` must still win, and `pyproject.toml` carries no
`[tool.pytest.ini_options]`):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'tool.pytest' pyproject.toml; \
  .venv/bin/pytest tests/test_models.py -q 2>&1 | tail -3
```

→ `0`, and the same pass count that file produced before this step.

### Step 7: Declare the LLM batch-job dependencies

Four packages are imported by repo code and declared in no manifest. Verified
import sites at `42826a3`:

| Package | Imported at |
|---|---|
| `anthropic` | `extract_llm_fields.py:16`, `extract_with_llm.py:19`, `extract_llm_structured.py:28`, `extract_structured_fields_llm.py:33` |
| `google-generativeai` (deprecated 0.8.x line) | `scripts/run_gemini_audit.py:20`, `fill_country_gemini.py:144`, `fill_outcomes_gemini.py:172` |
| `google-genai` (the current SDK — a **different** package) | `scripts/fetch_judge_bios.py:346` (`from google.genai import types`) and `:571` (`from google import genai`) |
| `PyJWT` | `tests/integration/test_revoke_member.py:20` — already handled in Step 2 |

Create `requirements-llm.txt` at the repo root:

```
# Optional dependencies for the ad-hoc LLM extraction / audit batch jobs.
#
# NOT installed by `make install`, NOT installed in CI, and NOT covered by any
# test — these scripts run by hand against the local downloaded_cases/ catalog.
# Install on demand:
#   pip install -r requirements-llm.txt
#
# The versions below are UNVALIDATED in this repository: `pip install` cannot
# run inside this project's .venv (Homebrew python@3.14 pyexpat/libexpat ABI
# defect), so none of these has been resolved into the working environment.
# Treat a first install as an experiment, not a reproduction.

# extract_llm_fields.py, extract_with_llm.py, extract_llm_structured.py,
# extract_structured_fields_llm.py — direct Anthropic API calls.
# Note: the LLM Council feature does NOT use this package; it routes through
# the Cloudflare AI Gateway with CF_AIG_TOKEN and needs no per-provider SDK.
anthropic>=0.40,<2

# scripts/run_gemini_audit.py, fill_country_gemini.py, fill_outcomes_gemini.py.
# Deprecated SDK line, deliberately capped: fill_outcomes_gemini.py:168 documents
# behaviour specific to 0.8.6 ("does not support ThinkingConfig"), and 0.8.6 is
# the final release of that line.
google-generativeai>=0.8.6,<0.9

# scripts/fetch_judge_bios.py — the current SDK (`from google import genai`).
# A different distribution from google-generativeai above; both are needed
# until fetch_judge_bios.py's siblings are migrated.
google-genai>=1.47,<3
```

Do **not** add these three to `constraints.txt`. That file is the snapshot of
the environment that passes the test suite, and none of them is installed in
it; adding unverified pins there would make the lockfile lie.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -cE '^[A-Za-z]' requirements-llm.txt; \
  grep -cE 'anthropic|google-generativeai|google-genai' constraints.txt; \
  grep -c 'requirements-llm.txt' requirements-app.txt
```

→ `3`, `0`, `1` (the last one is the pointer comment added in Step 1).

### Step 8: Repoint the `requirements.txt` shim at the real dependency set

`requirements.txt` exists for "external tooling that still expects
requirements.txt" — which in practice means dependency scanners. It currently
resolves to a single Flask line, so the first Dependabot / pip-audit / Snyk
setup pointed at the repository default would report a clean one-package
project and give a false all-clear over 16 unpinned app dependencies.

Nothing builds from it: both Dockerfiles read `requirements-extractor.txt`
directly, `Makefile` and CI read `requirements-app.txt` +
`requirements-test.txt`. Verify that yourself before editing:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -rn 'requirements\.txt' --include='Makefile' --include='Dockerfile*' \
    --include='*.yml' --include='*.sh' . 2>/dev/null \
  | grep -v '/\.venv/' | grep -v node_modules | grep -v '^\./plans/' | grep -v '^\./\.omc'
```

→ no output (only `requirements-app.txt` / `-test` / `-extractor` are
referenced, and `grep 'requirements\.txt'` does not match those because of the
leading hyphen segment). If this prints a build file that reads bare
`requirements.txt`, **STOP** — repointing it would change that build.

Replace the whole file with:

```
# Compatibility shim for external tooling that expects a root requirements.txt
# — dependency scanners above all. It resolves to the project's real Python
# dependency set so a scanner pointed at the repository default sees all of it.
#
# Humans and build files must name a manifest explicitly instead:
#   application / CLI / local dev  → requirements-app.txt
#   tests                          → requirements-test.txt
#   extraction Container image     → requirements-extractor.txt (Dockerfile)
#   ad-hoc LLM batch jobs          → requirements-llm.txt
#
# When configuring a scanner (Dependabot, pip-audit, Snyk), point it at
# constraints.txt as well — that is the pinned closure and the only file that
# says which versions are actually installed.
-c constraints.txt
-r requirements-app.txt
-r requirements-test.txt
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -cE '^-' requirements.txt; \
  /tmp/immi-dep-check/bin/python -m pip install --dry-run --quiet \
    --disable-pip-version-check -r requirements.txt
echo "shim dry-run exit=$?"
```

→ `3`, then `shim dry-run exit=0` with no error output. That proves the shim now
resolves to the full constrained set rather than to Flask alone.

## Test plan

This plan adds **no** new test file. It changes dependency *declarations* only,
installs nothing into `.venv`, and touches no `.py` file — so every existing
suite must come out numerically identical to the baseline.

- **Existing coverage that already guards this work**:
  `tests/test_extraction_container_boundary.py` (2 tests) reads `Dockerfile`,
  `Dockerfile.extractor`, `extract_container.py` and
  `requirements-extractor.txt` and asserts that no database-runtime marker
  appears in any of them. Step 5 edits two of those four files, so this file is
  the regression gate for the container change and must be run explicitly.
- **The real integration test is CI itself.** Step 4 changes how CI installs
  Python dependencies. The first CI run after this branch is what proves the
  pinned closure installs on ubuntu-latest / Python 3.12. Steps 3 and 5
  pre-verify that by resolving the same manifests with `pip --dry-run` in a
  healthy scratch venv and (when `uv` is present) with
  `uv pip compile --python-version 3.12`, both of which were confirmed to
  succeed on 2026-08-27.
- **Verification commands, in order**:

  ```bash
  cd "/Users/d/Developer/Active Projects/IMMI-Case-"
  .venv/bin/pytest tests/test_extraction_container_boundary.py -q   # 2 passed
  make lint                                                        # All checks passed!
  make test-py                                                     # 1141 passed, 3 failed, 7 skipped
  cd frontend && npx vitest run                                    # 490 passed, 55 files
  cd ../workers && npx vitest run                                  # 345 passed, 25 files
  ```

  The **3 failures** in `make test-py` are the pre-existing environmental
  `pyexpat` ones in `tests/test_backfill_judge_overrides_from_pdf.py`. If the
  failure count is anything other than 3, or the pass count is anything other
  than 1141, STOP — this plan cannot change either number.

  If plan 002 has landed, its own changes shift the frontend Vitest count from
  490 to 518 and add worker/E2E targets. Use the counts plan 002 documents in
  that case; the requirement is that **this** plan changes none of them.

## Done criteria

Machine-checkable. ALL must hold. Run from
`/Users/d/Developer/Active Projects/IMMI-Case-`.

- [ ] `grep -c '^tqdm' requirements-app.txt` → `0`
- [ ] `grep -cE '^[A-Za-z][A-Za-z0-9_.-]*>=[^,]+$' requirements-app.txt` → `0`
      (every requirement line has an upper bound)
- [ ] `grep -cE '^[A-Za-z][A-Za-z0-9_.-]*>=[^,]+$' requirements-test.txt` → `0`
- [ ] `grep -c 'ruff==0.15.18' requirements-test.txt` → `1` (pin retained)
- [ ] `grep -c '^PyJWT' requirements-test.txt` → `1`
- [ ] `grep -c '==' constraints.txt` → `84`
- [ ] `grep -c '^[A-Za-z]' constraints-extractor.txt` → `7`
- [ ] `grep -ciE 'supabase|postgres|hyperdrive|database_url|service_role' constraints-extractor.txt` → `0`
- [ ] `grep -c 'pip install -c constraints.txt -r requirements-app.txt' Makefile` → `1`
- [ ] `grep -c 'pip install --quiet -c constraints.txt -r requirements-app.txt' .github/workflows/ci.yml` → `1`
- [ ] `grep -c 'constraints-extractor.txt' Dockerfile` → `2`
- [ ] `grep -c 'constraints-extractor.txt' Dockerfile.extractor` → `2`
- [ ] `grep -c 'select = \["E4", "E7", "E9", "F"\]' pyproject.toml` → `1`
- [ ] `grep -c 'tool.pytest' pyproject.toml` → `0`
- [ ] `grep -cE '^[A-Za-z]' requirements-llm.txt` → `3`
- [ ] `grep -cE 'anthropic|google-generativeai|google-genai' constraints.txt` → `0`
- [ ] `grep -cE '^-' requirements.txt` → `3`
- [ ] `.venv/bin/ruff check --no-cache immi_case_downloader/ scripts/ *.py` exits 0 and prints `All checks passed!`
- [ ] `make lint` prints `All checks passed!`
- [ ] `.venv/bin/pytest tests/test_extraction_container_boundary.py -q` → `2 passed`
- [ ] `make test-py` → `1141 passed, 3 failed, 7 skipped` (unchanged)
- [ ] `/tmp/immi-dep-check/bin/python -m pip install --dry-run --quiet --disable-pip-version-check -c constraints.txt -r requirements-app.txt -r requirements-test.txt` exits 0
- [ ] `/tmp/immi-dep-check/bin/python -m pip install --dry-run --quiet --disable-pip-version-check -c constraints-extractor.txt -r requirements-extractor.txt` exits 0
- [ ] `make -n install | grep -c constraints.txt` → ≥ `1`, and `make -n` performed no install
- [ ] `.venv/bin/python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"` → `ok`
- [ ] `git status --short` lists only files from the "In scope" list (plus
      `plans/036-bound-the-python-dependencies.md` itself and any pre-existing
      dirty file such as `.claude/STATE.md`)
- [ ] `plans/README.md` status row updated — **only if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- **The generated pin block in Step 3 does not match the 84 lines listed.** The
  environment has moved since this plan was written, so the "known-good
  snapshot" premise is void. Do not paste the listed block over your generated
  one — report the diff instead. A pin nobody ran the suite against is worse
  than no pin.
- **`make test-py` reports anything other than `1141 passed, 3 failed, 7
  skipped`** at any point (or, if plan 002 landed, anything other than the
  counts plan 002 documents). This plan installs nothing; a changed count means
  something else moved.
- **`make test-py` reports a *different* set of 3 failures** — i.e. failures
  outside `tests/test_backfill_judge_overrides_from_pdf.py`.
- **`.venv/bin/ruff check --no-cache --statistics .` reports a count other than
  0 or 43 after Step 6.** The pyproject config is supposed to be a provable
  no-op; any other number means `select` was widened or ruff is not 0.15.18.
- **The two-line `COPY`/`RUN pip install` block in Step 5 is not present
  verbatim in `Dockerfile` or `Dockerfile.extractor`.**
  `plans/032-consolidate-the-extraction-scripts.md` also owns those files.
- **`tests/test_extraction_container_boundary.py` fails after Step 5.** You have
  introduced a forbidden marker into the extraction image's source set.
- **The Step 8 grep finds a build file that reads bare `requirements.txt`.**
  Repointing the shim would then change a build, which this plan is not
  authorised to do.
- **You are tempted to run `pip install` (or `pip freeze`) against `.venv`.** It
  will fail with the `pyexpat` ImportError, and if it somehow succeeds it means
  the interpreter changed underneath you — either way, stop.
- **You are tempted to delete or recreate `.venv`.** Out of scope; it would
  destroy the environment that `constraints.txt` is a snapshot of, and it would
  not fix the `pyexpat` defect (that defect lives in the Homebrew python@3.14
  build, not in the venv — verified against the base interpreter).
- **A step's verification fails twice after a reasonable fix attempt.**
- **The fix appears to require touching a file outside the "In scope" list** —
  in particular any `.py` file, `requirements-extractor.txt`, `README.md`, or
  `.github/dependabot.yml`.

## Maintenance notes

For whoever owns this after the change lands.

**What a reviewer should scrutinise**

1. That `constraints.txt` was *generated*, not typed. The commit diff should
   show the header comment plus 84 machine-sorted pins and nothing hand-tuned.
2. That `pyproject.toml`'s `select` list is exactly `["E4", "E7", "E9", "F"]`.
   Anything wider is a different change wearing this plan's clothes.
3. That the first CI run on this branch actually installed under
   `-c constraints.txt` and stayed green on Python 3.12.

**How to bump dependencies from now on**

Upgrade inside a venv whose `make test-py` is green, regenerate the whole of
`constraints.txt` with the Step 3 command, and commit the resulting diff on its
own. A dependency bump is now one reviewable, bisectable commit instead of an
invisible side effect of whatever day CI happened to run.

**The first thing a bump should reclaim**

The pinned set carries 13 packages that a fresh resolve today does not need:
`cachetools`, `fsspec`, `markdown-it-py`, `mdurl`, `mmh3`, `pyiceberg`,
`pyparsing`, `pyroaring`, `rich`, `strictyaml`, `tenacity`, `zstandard` (plus
`tqdm`, already removed here). They all arrive through
`supabase 2.30.0 → storage3 → pyiceberg`; `supabase 2.31.0` drops that subtree.
The snapshot keeps 2.30.0 on purpose — it is the version the passing baseline
was measured on — but bumping supabase is the highest-value first move, worth
84 → 71 packages per install.

Separately: `supabase` and `psycopg2-binary` are in `requirements-app.txt` at
all only for the local-dev Supabase backend. Production is a Cloudflare Worker
with no Python and no Postgres. Moving them into an optional
`requirements-supabase.txt` would shrink `make install` substantially — a
behaviour change, so it needs its own plan.

**Explicitly deferred out of this plan**

- **Widening the ruff rule set.** Measured 2026-08-27 over
  `immi_case_downloader/ scripts/ *.py` with
  `--select E,W,F,I,UP,B,SIM,C4,ARG,PTH,RUF`: **1683 findings, 162
  auto-fixable**. The cheap wins are `I001` unsorted-imports (72, all
  auto-fixable) and the `UP` family (~60, mostly auto-fixable). `E501` is the
  bulk — 1109 at ruff's default 88 columns, 166 at the `line-length = 120`
  already recorded in `pyproject.toml`. Adopt one family per commit.
- **The seven correctness-shaped findings**, which should be fixed by hand
  rather than ignored. Exact locations, measured with ruff 0.15.18:
  - `B023` function-uses-loop-variable — `validate_extraction.py:100`
    (`court_rows`), `validate_extraction.py:101` (`total`),
    `scripts/refine_data.py:307` (`filepath`)
  - `RUF013` implicit-optional — `immi_case_downloader/sources/base.py:47`,
    `scripts/extract_gemini.py:77`
  - `B904` raise-without-from-inside-except —
    `scripts/build_judge_name_overrides.py:110`
  - `B030` except-with-non-exception-classes —
    `scripts/check_immi_activation_evidence.py:627`
- **Unpinning `ruff`.** The project's own deferred-decision note says revisit
  after **2026-09-23**. `pyproject.toml` now makes that bump a rule-implementation
  question rather than a rule-selection one, so it should be much cheaper.
- **`README.md:118` and `frontend/e2e/README.md:138`** are now stale — neither
  mentions `constraints.txt`, and the latter still says
  `pip install -r requirements.txt`, which after Step 8 installs the full set
  rather than Flask alone (so it is no longer wrong, merely unexplained).
- **`.github/dependabot.yml`.** Deliberately not added: enabling a bot that
  opens pull requests is an operator decision, not a plan's. When someone does
  enable it, `constraints.txt` is now the unambiguous scan target and
  `requirements.txt` resolves to the real set, so the default configuration
  will finally see all 84 packages instead of one.

**What will interact with this**

- `plans/032-consolidate-the-extraction-scripts.md` rewrites `Dockerfile`,
  `Dockerfile.extractor` and several `extract_*.py` / `fill_*_gemini.py`
  scripts. If it lands after this plan, it must preserve the
  `-c constraints-extractor.txt` argument, and it should prune
  `requirements-llm.txt` for any script it deletes.
- If `requirements-e2e.txt` (plan 002) ever grows a package that also appears
  in `constraints.txt`, the pin wins — which is the intent, but it means a
  playwright-driven dependency bump has to go through the constraints
  regeneration flow like everything else.

## Findings reconsidered

Each item below was in the audit that produced this plan. It is recorded here
rather than silently dropped, so nobody re-audits it.

- **Replace `fuzzywuzzy` with `rapidfuzz`** (`requirements-app.txt:16`,
  `immi_case_downloader/normalize_judge_names.py:5`). The *code* swap is
  dropped; only the declaration is bounded and annotated (Step 1). Three
  reasons: the module is outside this plan's file territory; `pip install`
  cannot run in this repo's `.venv`, so `rapidfuzz` could not be installed and
  the swap could not be tested here; and the module is not on any hot path —
  a repo-wide grep for `normalize_judge` across `.py`/`.js`/`.ts` (excluding
  `.venv/` and `node_modules/`) returns exactly one consumer,
  `tests/test_judge_normalization.py`, so the single `fuzz.ratio` call at
  `normalize_judge_names.py:141` never runs against the 15,465 judge records
  the original finding invoked. Note for whoever does the swap:
  `fuzzywuzzy.fuzz.ratio` returns an `int`, `rapidfuzz.fuzz.ratio` returns a
  `float`, and `normalize_judge_names.py:141` divides by `100.0` and compares
  against a threshold — so near-threshold groupings can shift.

- **Unpin `ruff` and adopt new rule families** (`requirements-test.txt:7`).
  Half addressed, half dropped. The decoupling half is done: `pyproject.toml`
  now declares the rule set, so the version pin no longer *selects* rules. The
  unpin and the rule adoption are dropped from this plan because the adoption
  requires editing files under `immi_case_downloader/` and `scripts/` (outside
  territory), because a different ruff cannot be installed on this machine, and
  because the project holds an explicit deferred decision to revisit ruff 0.16
  after 2026-09-23 — later than the date this plan was written. All the
  measurements and the seven exact defect locations are preserved in
  "Maintenance notes" so the follow-up starts from data, not a re-audit.

- **Recreate `.venv` from CI's interpreter / add `.python-version` / make dev,
  CI and the container agree on one Python.** Dropped as written; only the
  in-repo declaration survives, as `[tool.ruff] target-version = "py311"` plus
  the comment block naming all three consumers (Step 6). The finding's stated
  mechanism is wrong, and the correction invalidates its fix: the `pyexpat`
  failure is **not** venv/`pyvenv.cfg` point-release skew. Verified — the
  identical `Symbol not found: _XML_SetAllocTrackerActivationThreshold ...
  Expected in: /usr/lib/libexpat.1.dylib` reproduces from the base interpreter
  outside any venv (`/opt/homebrew/opt/python@3.14/bin/python3.14 -c 'import
  pyexpat'`), so it is a defect in the Homebrew `python@3.14` 3.14.7 build and
  recreating `.venv` from that same interpreter cannot fix it. A further
  correction to a previous review of this finding: `python3.12` **does** exist
  on this machine — `/Users/d/.local/bin/python3.12` →
  `~/.local/share/uv/python/cpython-3.12.11-macos-aarch64-none`, whose
  `pyexpat` works — it simply is not a Homebrew formula (`/opt/homebrew/opt`
  holds only `python@3`, `python@3.10`, `python@3.14`). Even so, recreating the
  venv is out of scope: it would destroy the very environment `constraints.txt`
  snapshots, and `plans/002-fix-test-collection-and-install.md` already owns the
  CI Python question, resolving it as a `["3.12", "3.14"]` matrix rather than as
  a single number — which a `.python-version` file would contradict.

- **`requirements.txt` resolving to Flask alone is a bug.** Corrected: the shim
  is documented and intentional (`requirements.txt:1-2` say so, and it points
  at `requirements-extractor.txt` because that file historically *was* the
  Container's dependency set — `Dockerfile:7-8` and `Dockerfile.extractor:4-5`
  still install it). `Makefile:101` not reading `requirements.txt` is the
  design, not a defect. What survives is the *scanner* consequence, and Step 8
  addresses that by repointing the shim at the real set after proving no build
  file reads it.

- **Add `playwright` / `pytest-playwright` so `make test-e2e` runs.** Real, but
  owned by `plans/002-fix-test-collection-and-install.md`, which creates
  `requirements-e2e.txt` and an `install-e2e` target precisely so CI's
  `test-python` job does not download a browser driver for a suite it never
  runs. Deliberately not duplicated here.

### Evidence corrections made while writing this plan

Every line reference below was re-opened and read at `42826a3`; where the
original audit was wrong, the corrected reference is what appears in the steps.

- `import anthropic` is at **`extract_llm_fields.py:16`**, not `:15`.
- `import google.generativeai as genai` in `fill_country_gemini.py` is at
  **`:144`** (inside a function), not `:31`; line 17 is a docstring install
  hint.
- The `pip install` line in the `Makefile` `install:` recipe is
  **`Makefile:101`**, not `:103`.
- **`scripts/fetch_judge_bios.py` does not import `google-generativeai`.** It
  imports the *different*, also-undeclared **`google-genai`** package
  (`from google.genai import types` at `:346`, `from google import genai` at
  `:571`). Both packages are therefore undeclared, not one — `requirements-llm.txt`
  declares both.
- `requirements-extractor.txt:1` also carries an upper bound
  (`flask>=3.0.0,<4`), so `requirements-app.txt:4` was not the only bounded
  entry before this plan.
- The `pyexpat` defect breaks **`pip` itself**, not only the three `pypdf`
  tests: `.venv/bin/pip install` and `.venv/bin/pip freeze` both raise the
  ImportError because `pip` imports `xml.parsers.expat` via `xmlrpc.client`.
  That is why `make install` cannot currently run on this machine and why
  Step 3 generates `constraints.txt` from `importlib.metadata` instead of
  `pip freeze`.
