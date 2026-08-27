# Plan 003: Lint `tests/` and fix the 43 violations hiding behind the narrowed path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**: four commands, not one. A committed-history diff
> cannot see uncommitted, staged or untracked work, so an executor starting from
> a dirty tree would otherwise get a false all-clear — and an untracked file in
> `tests/` is exactly what Step 9 needs to know about before it writes a probe
> there.
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- tests/ Makefile .github/workflows/ci.yml pytest.ini
> git diff --stat -- tests/ Makefile .github/workflows/ci.yml pytest.ini          # unstaged
> git diff --cached --stat -- tests/ Makefile .github/workflows/ci.yml pytest.ini # staged
> git status --porcelain --untracked-files=all -- tests/                          # untracked
> ```
>
> **`Makefile`, `.github/workflows/ci.yml` and `pytest.ini` WILL appear in the
> committed-history diff** if plans 001 and 002 have landed. That is expected —
> both are hard dependencies of this plan (see "Depends on") and the section
> "What plans 001 and 002 change before you start" lists exactly what they
> change so you can tell an expected difference from real drift.
>
> **`tests/` must be clean in all four**: no committed change since `42826a3`,
> nothing unstaged, nothing staged, nothing untracked. Any of those is a STOP
> condition — the 43-finding inventory below is only valid against an unmodified
> `tests/` tree. Never `git checkout --`, `git restore`, `git stash` or
> `git clean` a path you did not create; report instead.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/002-fix-test-collection-and-install.md`, and
  transitively `plans/001-restore-the-frontend-compile-gate.md`. Both are
  **hard, integrated** dependencies. Cut this plan's branch from the tip that
  already has 001 **and** 002 merged, not from `main`.

  This is not a soft ordering preference. Three concrete collisions make
  `Depends on: none` unworkable:
  1. Plan 001 Step 3 replaces the single `lint:` recipe with
     `lint: lint-py lint-fe` plus new `lint-py:` and `lint-fe:` targets. If this
     plan runs first, 001 later rewrites the recipe this plan edited and
     silently drops `tests/` from the ruff path list. If it runs after — as it
     must — the target to edit is **`lint-py:`**, not `lint:` (Step 8).
  2. Plan 002 Step 6 adds `--ignore=tests/integration` to `test-py`, which drops
     the Python skip count by exactly one. This plan's baseline is therefore the
     **post-002** skip count, not the `42826a3` one.
  3. Plan 002 Step 5 deletes `pytest.ini`'s `addopts` line, so coverage is no
     longer forced onto every run. This plan's "Current state" quote of
     `pytest.ini` and its "~6 min because coverage is on" timing note are both
     pre-002 and are corrected below.
- **Blocks**: nothing. This is the last of the 001 → 002 → 003 chain.
- **Category**: dx
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`make lint` and the CI lint step both run ruff against
`immi_case_downloader/ scripts/ *.py` — the 104 Python files under `tests/`
are in neither path list. The test suite is this repo's primary verification
asset (over a thousand passing Python unit tests), and it has been getting zero
static analysis. Running ruff against it today surfaces **43 real findings**,
and the unused-variable ones point straight at broken tests:

- `test_update_case_blocked_fields` (CWE-915 mass-assignment whitelist) computes
  `result` and never asserts on it, so it passes whether or not the whitelist
  path ran at all. That is a genuinely missing assertion and Step 2 restores it.
- `test_panel_empty_state` ends in `assert True` — the only one anywhere under
  `tests/` — so it cannot fail. Step 5 replaces it with a real assertion.
- `test_json_write_atomic` computes `tmp_path` and never uses it. This one is
  **not** a missing assertion: adding the obvious `assert not os.path.exists(tmp_path)`
  would be vacuous, because the mocked `open()` raises before the `.tmp` file is
  ever created. Step 2 deletes the dead variable instead, and the real gap — that
  neither atomic-write test exercises a post-create failure, and that neither
  save function cleans up after one — is handed on with the fix shape spelled
  out. Trading a dead variable for a green assertion that cannot fail would make
  the suite *look* better while proving no more than it does now.

Fixing the findings and widening the ruff path list closes both the specific
holes and the class of hole — the next dead assertion gets caught by CI instead
of accumulating.

## Current state

### What plans 001 and 002 change before you start

You are the third plan in a serial chain. Expect to find these already applied.
Do **not** re-apply or revert them; do read the live files rather than the
`42826a3` excerpts quoted below where the two disagree.

From **plan 001**:

- `Makefile` — `lint:` becomes `lint: lint-py lint-fe`, with new `lint-py:` and
  `lint-fe:` recipes. **`lint-py:` is the recipe this plan edits in Step 8.**
  `typecheck:` becomes `npx tsc -b --noEmit`; a `coverage-fe:` target appears;
  `.PHONY` and three `@echo` help lines change.
- `.github/workflows/ci.yml` — the `test-frontend` job gains ESLint, build,
  token-staleness and tsconfig-reference steps. The `Lint with ruff` step in
  `test-python`, which this plan edits, is untouched by 001.

From **plan 002**:

- `Makefile` — `test-py:` and `coverage:` gain `--ignore=tests/integration`;
  new targets `test-pipeline`, `test-integration`, `test-preflight`,
  `check-vitest-collection`, `check-native`, `typecheck-pipeline`, `build-fe`,
  `check`, `install-e2e`; `install:` creates the venv; help and `.PHONY` grow.
- `pytest.ini` — **the `addopts` line is deleted.** Coverage is no longer forced
  onto every pytest run.
- `.github/workflows/ci.yml` — the `test-python` job gains a
  `["3.12", "3.14"]` matrix, `cache: pip`, and a `continue-on-error` guard on
  the 3.14 leg. The `Lint with ruff` step's `run:` line is still the single line
  this plan edits.

**Consequences for this plan, all of which are already folded into the steps
below**: Step 8 targets `lint-py:`; Step 7's expected skip count is the post-002
one; and Step 7 no longer pays for coverage instrumentation, so it runs faster
than the "~6 minutes" an earlier draft quoted.

### The two gates that exclude `tests/`

`Makefile:90-96` at `42826a3` — verbatim (recipe lines are TAB-indented). After
plan 001 the `lint:` half of this reads
`lint: lint-py lint-fe` / `lint-py:` / `	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py`,
and `typecheck:` runs `npx tsc -b --noEmit`. The **ruff path list is what
matters here, and 001 does not change it** — it only moves it into `lint-py:`.

```make
# ── Code Quality ──────────────────────────────────────────────────────────────

lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit
```

`.github/workflows/ci.yml:26-32` — verbatim:

```yaml
      - name: Install Python dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt

      - name: Lint with ruff
        run: .venv/bin/ruff check immi_case_downloader/ scripts/ *.py
```

`requirements-test.txt:7` — verbatim. The ruff version is **deliberately
pinned**; do not bump it as part of this plan:

```
ruff==0.15.18  # pinned: 0.16 expanded default rules (394 new findings); bump deliberately with a cleanup pass
```

There is **no** `pyproject.toml`, `ruff.toml`, `.ruff.toml`, or `setup.cfg` at
the repo root (verified 2026-08-27). Ruff therefore runs on its default rule
set (`E4`, `E7`, `E9`, `F`). This plan does **not** add a config file — see
"Out of scope".

`pytest.ini` at `42826a3` forced coverage reporting on every run:

```ini
[pytest]
testpaths = tests
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
```

**By the time you run this plan that `addopts` line is gone** — plan 002 Step 5
removes it, deliberately, and replaces it with a comment. Read the live file.
Two consequences: `make test-py` no longer prints a coverage table, and it runs
noticeably faster than the "~6 minutes" figure an earlier draft of this plan
quoted. Do not treat a missing coverage table as drift.

`testpaths = tests` is what makes the Python side immune to the include-glob
class of bug that `make check-vitest-collection` guards on the JavaScript side:
pytest walks the tree rather than matching a configured glob.

### The 43 findings (verified with `ruff 0.15.18` at commit `42826a3`)

| Rule | Count | Safe-autofixable | What it is |
|------|-------|------------------|------------|
| F401 | 32 | 32 | unused import |
| F841 | 4 | 1 | local assigned but never used |
| E712 | 6 | 0 | `== True` / `== False` comparison |
| E741 | 1 | 0 | ambiguous variable name `l` |
| **Total** | **43** | **33** | |

The 10 non-safe-autofixable findings are the ones needing judgment. Ruff offers
`--unsafe-fixes` for 9 of them (the 6 E712 and 3 F841); **those unsafe fixes are
wrong for this repo** — see Step 6.

Full list of the 10, verified by opening each file:

| File:line | Rule | Verdict after hand-review |
|---|---|---|
| `tests/test_stability.py:242` | F841 `result` | **Missing assertion.** Fix in Step 2 (Edit A). |
| `tests/test_stability.py:296` | F841 `tmp_path` | **Genuinely dead — delete it.** The obvious fix (`assert not os.path.exists(tmp_path)`, mirroring the CSV twin) would be a *vacuous* assertion; see below. Step 2 (Edit B). |
| `tests/test_pipeline_encapsulation.py:10,17,25,41,51,58` | E712 ×6 | Real bools; convert to `is True` / `is False`. Step 3. |
| `tests/test_legislations_helpers.py:371` | E741 `l` | Cosmetic; rename to `entry`. Step 4. |
| `tests/e2e/react/test_react_saved_searches.py:514` | F841 `has_empty_state` | **Vacuous test** (`assert True`). Rewrite into a real empty-state assertion. Step 5. |

The 43 is a **starting inventory measured at `42826a3`**, not a done criterion.
The done criterion is `ruff check --no-fix tests/` printing `All checks passed!`.
Step 1 records the live number as `RUFF_BEFORE` and checks the *identity* of the
10 non-autofixable findings, which is what actually has to match — a plan whose
gate is the number `43` breaks the moment a sibling plan adds a test file.

### `tests/test_stability.py` — one dead security assertion and one dead variable

File docstring, `tests/test_stability.py:1-9` — verbatim:

```python
"""Tests for Phase 1: Stability & Thread Safety.

Covers:
- Issue 1.1: Thread safety for _job_status (CWE-362)
- Issue 1.2: Input validation — safe_int / safe_float (CWE-20)
- Issue 1.3: Path traversal prevention (CWE-22)
- Issue 1.4: Mass assignment prevention in update_case (CWE-915)
- Issue 1.5: Atomic CSV/JSON writes
"""
```

`tests/test_stability.py:224-255` — verbatim. Note the **sibling** test asserts
`result is True` at line 232; the blocked-fields test drops it:

```python
    def test_update_case_allowed_fields(self, populated_dir, sample_cases):
        """Allowed fields (title, user_notes, tags) should be updatable."""
        case_id = sample_cases[0].case_id
        result = update_case(
            case_id,
            {"title": "Updated Title", "user_notes": "My note", "tags": "important"},
            str(populated_dir),
        )
        assert result is True
        cases = load_all_cases(str(populated_dir))
        updated = next(c for c in cases if c.case_id == case_id)
        assert updated.title == "Updated Title"
        assert updated.user_notes == "My note"

    def test_update_case_blocked_fields(self, populated_dir, sample_cases):
        """Sensitive fields (case_id, full_text_path, source) should be ignored."""
        case_id = sample_cases[0].case_id
        original_source = sample_cases[0].source
        result = update_case(
            case_id,
            {
                "full_text_path": "/etc/passwd",
                "source": "HACKED",
                "case_id": "evil_id",
            },
            str(populated_dir),
        )
        # Should succeed but sensitive fields should not change
        cases = load_all_cases(str(populated_dir))
        updated = next(c for c in cases if c.case_id == case_id)
        assert updated.full_text_path != "/etc/passwd"
        assert updated.source == original_source
```

Why the dropped assertion matters: `update_case` in
`immi_case_downloader/storage.py:250-264` returns `False` when the `case_id` is
not found and never touches any case. If the fixture's `case_id` ever stopped
matching, the two `assert updated.… != …` lines would still pass trivially —
nothing changed because nothing ran. `assert result is True` is what proves the
whitelist actually executed.

`tests/test_stability.py:264-319` — verbatim. The CSV test appears to assert the
tmp file was cleaned up (line 291); its JSON twin computes `tmp_path` at line
296 and never uses it. **Read the next subsection before concluding that the
JSON test is simply missing line 291's assertion — it is not.**

```python
    def test_csv_write_atomic(self, populated_dir, sample_cases):
        """If write fails mid-way, original CSV should remain intact."""
        csv_path = os.path.join(str(populated_dir), "immigration_cases.csv")
        tmp_path = csv_path + ".tmp"

        # Save initial data
        save_cases_csv(sample_cases, str(populated_dir))
        original_size = os.path.getsize(csv_path)

        # Simulate a write failure on the .tmp file
        original_to_csv = __import__("pandas").DataFrame.to_csv

        def failing_to_csv(self, path, **kwargs):
            if str(path).endswith(".tmp"):
                raise IOError("disk full")
            return original_to_csv(self, path, **kwargs)

        with patch("pandas.DataFrame.to_csv", failing_to_csv):
            try:
                save_cases_csv(sample_cases[:1], str(populated_dir))
            except IOError:
                pass

        # Original CSV should still be intact (atomic: .tmp failed, original untouched)
        assert os.path.exists(csv_path)
        assert os.path.getsize(csv_path) == original_size
        # No leftover .tmp file
        assert not os.path.exists(tmp_path)

    def test_json_write_atomic(self, populated_dir, sample_cases):
        """If JSON write fails, original file should remain."""
        json_path = os.path.join(str(populated_dir), "immigration_cases.json")
        tmp_path = json_path + ".tmp"

        save_cases_json(sample_cases, str(populated_dir))
        with open(json_path) as f:
            original_content = f.read()

        # Mock open to fail only for .tmp files
        real_open = open

        def failing_open(path, *args, **kwargs):
            if str(path).endswith(".tmp"):
                raise IOError("disk full")
            return real_open(path, *args, **kwargs)

        with patch("builtins.open", failing_open):
            try:
                save_cases_json(sample_cases[:1], str(populated_dir))
            except IOError:
                pass

        # Original JSON should still be intact
        assert os.path.exists(json_path)
        with open(json_path) as f:
            assert f.read() == original_content
```

### Why the `.tmp` assertion is NOT the right fix for the JSON twin

`assert result is True` in `test_update_case_blocked_fields` is a real missing
assertion and Step 2 Edit A adds it. The `.tmp` case is different, and copying
line 291 into the JSON test would add an assertion that **cannot fail** — the
same defect class this plan exists to remove, reintroduced by the fix.

Read the code under test. `immi_case_downloader/storage.py:74-93`:

```python
def save_cases_json(cases, base_dir=OUTPUT_DIR):
    filepath = os.path.join(base_dir, CASES_JSON)
    tmp_path = filepath + ".tmp"
    data = {...}

    with open(tmp_path, "w", encoding="utf-8") as f:   # <- line 88
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, filepath)
```

The test patches `builtins.open` so that any path ending in `.tmp` raises
`IOError`. That raise happens **at line 88, before the file is created**. So
`tmp_path` never exists, and `assert not os.path.exists(tmp_path)` is true for a
reason that has nothing to do with cleanup. It would pass identically against an
implementation with no cleanup at all — which is exactly what
`save_cases_json` is: there is no `try`/`finally`, no `except`, nothing that
removes a partially written `.tmp`.

The CSV twin at line 291 is vacuous for the same reason:
`save_cases_csv` (`storage.py:59-71`) calls `df.to_csv(tmp_path, ...)`, and the
patched `failing_to_csv` raises before pandas opens the file.

So both atomic-write tests only exercise the *pre-create* failure path. Neither
proves the property its comment claims ("No leftover .tmp file"), and neither
would notice if `json.dump` failed halfway and left a truncated `.tmp` on disk.

**What this plan does about it**: Step 2 Edit B **deletes the dead `tmp_path`
assignment**, which resolves the F841 honestly and leaves the test asserting
exactly what it actually verifies (the original file survives). It does not add
a green-looking assertion that proves nothing.

**What this plan deliberately does not do**: writing a test that really exercises
cleanup requires injecting the failure *after* the temp file exists — e.g.
patching `os.replace` to raise — and such a test would **fail today**, because
neither save function cleans up. Making it pass needs a change to
`immi_case_downloader/storage.py`, which is outside this plan's file territory
(`tests/**`, `Makefile`, `.github/workflows/ci.yml`). It is recorded as a
follow-up in "Maintenance notes" with the exact shape the fix and the test need
to take. Do not attempt it here, and do not leave a passing-but-vacuous
assertion behind as a substitute.

The assertion Step 2 Edit A *does* add was **empirically confirmed to pass** at
commit `42826a3` by replaying the scenario against the real
`immi_case_downloader.storage` module: `update_case(...)` with only blocked
fields returns `True`.

### `tests/test_pipeline_encapsulation.py` — the six E712 sites

Full file is 67 lines. Verbatim `tests/test_pipeline_encapsulation.py:1-26`:

```python
"""Tests for SmartPipeline encapsulated state."""
from immi_case_downloader.pipeline import SmartPipeline, PipelineConfig


def test_pipeline_has_instance_status():
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    status = p.get_status()
    assert isinstance(status, dict)
    assert status["running"] == False


def test_pipeline_stop_flag():
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    p.request_stop()
    assert p.get_status()["stop_requested"] == True


def test_pipeline_independent_instances():
    config = PipelineConfig()
    p1 = SmartPipeline(config, output_dir="/tmp/p1")
    p2 = SmartPipeline(config, output_dir="/tmp/p2")
    p1.request_stop()
    assert p2.get_status()["stop_requested"] == False
```

And verbatim `tests/test_pipeline_encapsulation.py:39-59`:

```python
def test_pipeline_config_preset_download_only():
    config = PipelineConfig.from_form({"preset": "download_only"})
    assert config.download_enabled == True


def test_get_status_returns_copy():
    """Mutations to the returned dict must not affect internal state."""
    config = PipelineConfig()
    p = SmartPipeline(config, output_dir="/tmp/test_pipeline")
    s1 = p.get_status()
    s1["running"] = True
    s2 = p.get_status()
    assert s2["running"] == False


def test_module_get_pipeline_status_without_active():
    """get_pipeline_status() returns initial state when no pipeline has run."""
    from immi_case_downloader.pipeline import get_pipeline_status, _INITIAL_STATUS
    status = get_pipeline_status()
    assert status["running"] == False
    assert "stats" in status
```

All five distinct values were probed at runtime and are genuine `bool`
singletons (`status["running"] is False`, `stop_requested is True`,
`config.download_enabled is True` all evaluate `True`), so `is True` / `is False`
is a safe, strictness-preserving rewrite. Ruff 0.15.18 accepts `is True` /
`is False` for E712 — confirmed by feeding it a probe snippet on stdin.

### `tests/test_legislations_helpers.py` — the E741 site

Verbatim `tests/test_legislations_helpers.py:366-372`:

```python
        self._call([law_id], scraper, json_path)

        assert os.path.exists(json_path)
        with open(json_path) as f:
            saved = json.load(f)
        assert any(l["id"] == law_id for l in saved["legislations"])
        assert leg_mod._legislations_cache is None  # cache invalidated
```

### `tests/e2e/react/test_react_saved_searches.py` — the vacuous test

Verbatim `tests/e2e/react/test_react_saved_searches.py:1-9`:

```python
"""Saved Searches E2E tests: save, execute, edit, delete, share, badges."""

from playwright.sync_api import Page, expect
from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
    get_toast_text,
)
```

Verbatim `tests/e2e/react/test_react_saved_searches.py:496-517`:

```python
class TestEmptyStates:
    """Empty state handling when no saved searches exist."""

    def test_panel_empty_state(self, react_page):
        """SavedSearchPanel shows empty state when no searches saved."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)

        # If no searches exist, panel might show empty state
        # or might not be visible at all
        empty_text_options = [
            "No saved searches",
            "Create your first",
            "Apply filters and click Save Search",
        ]

        # Check if any empty state text is visible
        page_text = react_page.locator("main").inner_text()
        has_empty_state = any(text in page_text for text in empty_text_options)

        # This is acceptable - either empty state shows or panel is collapsed
        assert True  # Pass - empty state handling is implementation detail
```

This is the only `assert True` anywhere under `tests/`.

**The test CAN assert its own docstring, and this plan makes it do so.** An
earlier draft claimed the empty state was untestable because `class
TestSaveSearch` runs earlier in the same module and leaves saved searches
behind. That is false, and the fixture is the proof.
`tests/e2e/react/conftest.py:16-27` — verbatim:

```python
@pytest.fixture
def react_page(browser, base_url):
    """Desktop browser page (1280x800) pre-configured for React SPA testing."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        base_url=base_url,
        accept_downloads=True,
    )
    pg = context.new_page()
    pg._js_errors = []
    pg.on("pageerror", lambda err: pg._js_errors.append(str(err)))
    yield pg
    context.close()
```

`react_page` is **function-scoped** and creates a **new browser context per
test**, closing it at teardown. A Playwright browser context has its own
isolated storage — no `storage_state` is passed, so nothing is carried in — and
`saved-searches` lives in `localStorage`. Every test in this module therefore
starts with zero saved searches regardless of what ran before it. The empty
state is not merely assertable; it is the guaranteed state.

What the panel renders in that state, read from
`frontend/src/components/saved-searches/SavedSearchPanel.tsx`:

- line 25 — `const [isExpanded, setIsExpanded] = useState(count > 0);` so with
  `count === 0` the body starts **collapsed**;
- lines 52-58 — the header is a `<button type="button">` carrying
  `aria-expanded`, containing an `<h2>` with
  `t("saved_searches.title", { defaultValue: "Saved Searches" })`;
- lines 66-74 — always visible, even collapsed:
  `<span data-testid="saved-search-count">{count}/50</span>`;
- lines 119-146 — inside the collapsed body, when `count === 0`:
  `t("saved_searches.empty_title", { defaultValue: "No saved searches yet" })`
  and `empty_description` = "Apply filters and click Save Search to create your
  first saved search."

Both keys resolve to those exact English strings in
`frontend/src/i18n/locales/en.json` (verified 2026-08-28), so the E2E assertion
can match on the rendered text without depending on the `defaultValue`
fallback. `SavedSearchPanel` is rendered by `CasesPage.tsx:498`, so `/cases` is
the right route.

Nothing outside this file references `TestEmptyStates` or
`test_panel_empty_state` (verified by repo-wide grep), so renaming the method is
safe.

### `tests/e2e/playwright/test_council_thread_visual.py` — the unused `except` binding

Verbatim `tests/e2e/playwright/test_council_thread_visual.py:299-311`:

```python
        # Turn 1 card restored — give it generous time as TanStack refetch + render
        # may take a moment after reload (network + rerender)
        try:
            expect(
                council_page.get_by_test_id("turn-card").first
            ).to_be_visible(timeout=30_000)
        except Exception as e:
            # On failure, dump page snapshot + screenshot for diagnosis
            ss = _screenshot(council_page, "step4-failure")
            html_snippet = council_page.content()[:2000]
            print(f"\n[DIAG step4 FAIL] screenshot: {ss}", flush=True)
            print(f"[DIAG step4 FAIL] HTML snippet:\n{html_snippet}", flush=True)
            raise
```

Hand-reviewed: `e` is genuinely dead — the handler ends in a **bare** `raise`,
which re-raises the active exception without needing the name. Ruff's fix for
this one is classified **safe** and produces exactly `except Exception:`
(confirmed with `ruff check --select F841 --diff`). Step 6's autofix handles it.

### The 32 F401s are all plain leftover imports

`ruff check --diff tests/` was previewed at commit `42826a3`. The complete set of
changes the safe autofix makes is import-line removals plus the one
`except Exception as e:` → `except Exception:`. Nothing else. The removed names:
13 × `import pytest`, `import os`, `import math`, 2 × `import time`,
2 × `from immi_case_downloader.models import ImmigrationCase`, plus
`patch`/`MagicMock`, `REQUEST_TIMEOUT`, `FEDCOURT_BASE`, `SectionLink`,
`PipelineEvent`, `_INITIAL_STATUS`, `get_toast_text`, and
`ALLOWED_UPDATE_FIELDS` (from both `test_sqlite_repository.py` and
`test_supabase_repository.py`).

Two of those look alarming and are not: `ALLOWED_UPDATE_FIELDS` is the
mass-assignment whitelist, but **both** repository test files still exercise it
by behaviour — `tests/test_supabase_repository.py:237` has
`def test_blocked_fields(...)` and `tests/test_sqlite_repository.py:145` has a
test whose docstring reads `"""Fields not in ALLOWED_UPDATE_FIELDS are silently
ignored."""`. They reference the constant by name in prose, not by import. No
coverage is lost by removing the imports.

### Repo conventions this plan must honour

- **Commit format** is `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines, no
  `Co-Authored-By`. Real examples from `git log`:
  `fix: install root node_modules in make install`,
  `ci: stop ignoring the separation preflight suite`.
- **Branch naming** observed on the remote is `<type>/<slug>`, e.g.
  `chore/immi-migration-phase1-provisioning`,
  `chore/update-tokens-timestamp-and-plugin`.
- **Python venv**: always `/Users/d/Developer/Active Projects/IMMI-Case-/.venv`.
  Use `.venv/bin/python`, `.venv/bin/pytest`, `.venv/bin/ruff`. Never global
  `pip` (Homebrew Python).
- **No fake completion**: `test.skip`, `@pytest.mark.skip`, stub tests and
  TODO placeholders are blockers, not fixes. Do not resolve any finding in this
  plan by skipping or deleting a test.

## Commands you will need

Run everything from `/Users/d/Developer/Active Projects/IMMI-Case-`.

### Baseline capture (do this before Step 1)

Numbers in this plan are **deltas against a baseline you measure on the post-002
tip**, not literals copied from this document. Run this first and keep the
output:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/ruff --version
RUFF_BEFORE=$(.venv/bin/ruff check --no-fix --output-format=concise tests/ | grep -c '^tests/')
echo "RUFF_BEFORE=$RUFF_BEFORE"
make test-py 2>&1 | tail -3          # -> PY_PASSED_BEFORE / PY_SKIPPED_BEFORE
make test-py 2>&1 | grep '^FAILED' | sort > /tmp/py-failed-before.txt
```

| Baseline | Symbol | Value at `42826a3` (re-measure; do not trust this column) |
|---|---|---|
| ruff findings under `tests/` | `RUFF_BEFORE` | 43 |
| python passed | `PY_PASSED_BEFORE` | 1141 |
| python skipped, **post-002** | `PY_SKIPPED_BEFORE` | 6 (it was 7 before plan 002 added `--ignore=tests/integration`) |

### Command reference

| Purpose | Command | Expected on success |
|---|---|---|
| Lint tests only (read-only) | `.venv/bin/ruff check --no-fix --output-format=concise tests/` | at baseline: `RUFF_BEFORE` findings; at the end: `All checks passed!` |
| Lint one rule | `.venv/bin/ruff check --no-fix --select F841 tests/` | `All checks passed!` after Steps 2–6 |
| Apply safe fixes | `.venv/bin/ruff check --fix tests/` | `Found N errors (33 fixed, ...)` |
| Repo Python lint gate | `make lint-py` (post-001 name) | `All checks passed!` |
| Whole lint gate | `make lint` | ruff `All checks passed!` **and** ESLint 0 errors |
| Python unit tests | `make test-py` | `PY_PASSED_BEFORE` passed, `PY_SKIPPED_BEFORE` skipped, 3 named failures. Faster than the pre-002 run — plan 002 removed the forced `--cov`. |
| One test file | `.venv/bin/python -m pytest tests/test_stability.py -q -p no:cacheprovider` | all pass |
| One named test | `.venv/bin/python -m pytest tests/test_stability.py -q -k test_update_case_blocked_fields` | 1 passed |
| Syntax check a file | `.venv/bin/python -m py_compile <file>` | exit 0. **Proves syntax only** — never cite it as evidence that a test passes or that UI behaviour works. |
| Worktree state | `git status --short --branch` | only in-scope files modified |

**The 3 pytest failures are pre-existing and environmental, and must still be
exactly these three by name** when you finish — assert on the names, not on the
number `3`:

```
tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words
tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging
tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent
```

They are caused by a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch
that breaks the `pypdf` import:

```
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words - ImportError: dlopen(/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Pyth...
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging - ImportError: dlopen(...)
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent - ImportError: dlopen(...)
```

They are **not** caused by repo code and are **not** this plan's problem. Do not
attempt to fix them. Your job is to keep the counts identical:
`PY_PASSED_BEFORE` passed and `PY_SKIPPED_BEFORE` skipped before **and** after,
with `/tmp/py-failed-before.txt` unchanged.

## Scope

**In scope** (the only files you may modify):

- `tests/test_stability.py`
- `tests/test_pipeline_encapsulation.py`
- `tests/test_legislations_helpers.py`
- `tests/e2e/react/test_react_saved_searches.py`
- `tests/e2e/playwright/test_council_thread_visual.py`
- Any other file under `tests/**/*.py` touched **only** by
  `ruff check --fix tests/` in Step 6 (import removals — expect ~20 files)
- `Makefile` — the **`lint-py:`** recipe's ruff path list, one line. (Plan 001
  split `lint:` into `lint: lint-py lint-fe`; `lint:` itself is now a
  prerequisite list with no ruff invocation in it. Editing `lint:` would be a
  no-op or a breakage.)
- `.github/workflows/ci.yml` — the "Lint with ruff" step's `run:` line, one line
- One throwaway probe file under `tests/`, created and deleted inside Step 9
  only, under a **unique** name chosen at run time (see Step 9 — do **not** use
  a fixed name)

**Out of scope** (do NOT touch, even though they look related):

- `requirements-test.txt` — the `ruff==0.15.18` pin at line 7 is deliberate and
  documented in the comment ("0.16 expanded default rules (394 new findings)").
  Bumping it is a separate, larger cleanup and would blow this plan's scope open.
- Adding a `ruff.toml` / `.ruff.toml` / `pyproject.toml`. A config file is only
  needed to express *per-directory rule relaxations*, and this plan needs none —
  it fixes all 43 findings rather than muting any of them. Introducing root
  ruff config would also change linting for `immi_case_downloader/` and
  `scripts/`, which are outside this plan's territory.
- `tests/test_backfill_judge_overrides_from_pdf.py` — the 3 failures there are
  a local interpreter/ABI problem, not a code problem.
- `frontend/**` — including the 40 weak `toBeTruthy()` / `toBeDefined()` /
  `not.toBeNull()` assertions across 18 files, mostly in `frontend/__tests__/`.
  Different file territory and a different toolchain (ESLint/Vitest, not ruff).
  Recorded in "Maintenance notes" as a deferred follow-up.
- `workers/**` — 11 similar weak assertions; same reasoning.
- `CLAUDE.md`, `README.md`, `AGENTS.md` and any other docs. Note that the
  `Makefile` help text is **not** the same as it was when this plan was drafted:
  plan 001 replaced the single `@echo "  make lint         Ruff lint Python
  source"` line with three lines covering `lint`, `lint-py` and `lint-fe`.
  Leave them alone anyway — after this plan the `lint-py` description ("Ruff
  lint Python source only") becomes mildly incomplete because `tests/` is now in
  the path list, and reconciling help text with `CLAUDE.md` is
  `plans/042-rewrite-the-agent-facing-docs.md`'s job. Report the wording in your
  handoff; do not edit it here.
- `pytest.ini` — out of scope, but **not** because "the coverage `addopts` are
  intentional". That was true at `42826a3` and is no longer: plan 002 Step 5
  deletes the `addopts` line outright. `pytest.ini` is out of scope here simply
  because plan 002 owns it and has already finished with it. Do not re-add
  `addopts`, and do not treat its absence as drift.

## Git workflow

Cut the branch from the tip that already has **plans 001 and 002 merged**, not
from a bare `main`. If `Makefile` still has a single `lint:` recipe containing
the ruff invocation, or `pytest.ini` still has an `addopts` line, you are on the
wrong base — stop and say so.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
# sanity-check the base before branching
grep -q '^lint-py:' Makefile || { echo "STOP: plan 001 has not landed"; exit 1; }
grep -q '^addopts' pytest.ini && { echo "STOP: plan 002 has not landed"; exit 1; }
git checkout -b chore/lint-the-test-suite
```

- Commit per logical unit. Suggested messages, matching the repo's convention:
  - `test: assert update_case result and drop the dead json tmp_path`
  - `test: use identity comparisons for pipeline boolean assertions`
  - `test: assert the saved-search empty state instead of assert True`
  - `test: drop unused imports flagged by ruff`
  - `ci: lint tests/ in make lint-py and the CI ruff step`
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and pushes.
- Before committing, per this repo's `CLAUDE.md` GitNexus rules, run
  `detect_changes()` and report the affected symbol set — it should be confined
  to the test functions this plan edits. If the index is stale (it lagged `HEAD`
  on 2026-08-28), refresh it with `node .gitnexus/run.cjs analyze` or record the
  check as **unverified**; do not silently skip it.
- Whatever the drift check showed as already-dirty at the start is pre-existing:
  leave it alone, do not stage it, and never `git checkout --`, `git restore`,
  `git stash` or `git clean` a path you did not create.

## Steps

### Step 1: Confirm the baseline

Record the starting numbers so you can prove nothing regressed.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/ruff --version
.venv/bin/ruff check --no-fix --output-format=concise tests/ | tail -3
.venv/bin/ruff check --no-fix --output-format=concise --select F841,E712,E741 tests/ \
  | cut -d: -f1,2 | sort > /tmp/ruff-hand-findings.txt
cat /tmp/ruff-hand-findings.txt
make lint-py
```

**Verify**:
- `.venv/bin/ruff --version` → `ruff 0.15.18`
- ruff on `tests/` → `RUFF_BEFORE` findings (43 at `42826a3`) and
  `33 fixable with the --fix option`
- `make lint-py` → `All checks passed!` (it does not cover `tests/` yet — that
  is the whole point of Step 8)
- `/tmp/ruff-hand-findings.txt` contains **exactly these 10 file:line pairs** —
  this identity check, not the total, is what the rest of the plan depends on:

  ```
  tests/e2e/playwright/test_council_thread_visual.py:305
  tests/e2e/react/test_react_saved_searches.py:514
  tests/test_legislations_helpers.py:371
  tests/test_pipeline_encapsulation.py:10
  tests/test_pipeline_encapsulation.py:17
  tests/test_pipeline_encapsulation.py:25
  tests/test_pipeline_encapsulation.py:41
  tests/test_pipeline_encapsulation.py:51
  tests/test_pipeline_encapsulation.py:58
  tests/test_stability.py:242
  tests/test_stability.py:296
  ```

  (That is 11 lines for 10 findings — `test_stability.py` contributes two.)

If the ruff version is not `0.15.18`, or that set differs, STOP (see STOP
conditions). A different **total** with the same 10 hand-findings is not
automatically a STOP — it can mean a sibling plan added a test file with a
plain unused import, which Step 6's autofix will absorb. Report the delta and
proceed only if every extra finding is an F401.

### Step 2: Restore the missing assertion, and delete the dead variable, in `tests/test_stability.py`

Two edits: Edit A **adds** an assertion that was genuinely missing; Edit B
**deletes** a dead variable rather than inventing an assertion for it. They are
not symmetric, and the asymmetry is the point — read
"Why the `.tmp` assertion is NOT the right fix for the JSON twin" in Current
state before starting.

**Edit A** — in `test_update_case_blocked_fields`, add `assert result is True`
immediately after the closing `)` of the `update_case(...)` call and before the
`# Should succeed but sensitive fields should not change` comment. The result:

```python
        result = update_case(
            case_id,
            {
                "full_text_path": "/etc/passwd",
                "source": "HACKED",
                "case_id": "evil_id",
            },
            str(populated_dir),
        )
        assert result is True
        # Should succeed but sensitive fields should not change
        cases = load_all_cases(str(populated_dir))
```

**Edit B** — in `test_json_write_atomic`, **delete** the dead `tmp_path` line
and replace it with a comment recording why the obvious assertion is not there.
Read "Why the `.tmp` assertion is NOT the right fix for the JSON twin" in
Current state before doing this; the short version is that the mocked `open()`
raises at `storage.py:88` *before* the `.tmp` file is created, so
`assert not os.path.exists(tmp_path)` would pass against an implementation with
no cleanup at all — which is what `save_cases_json` is.

Replace:

```python
        json_path = os.path.join(str(populated_dir), "immigration_cases.json")
        tmp_path = json_path + ".tmp"
```

with:

```python
        json_path = os.path.join(str(populated_dir), "immigration_cases.json")
        # No `tmp_path` / "no leftover .tmp" assertion here on purpose: the mock
        # below makes open() raise *before* the .tmp file is created, so such an
        # assertion would pass whether or not save_cases_json cleans up — and it
        # does not clean up. Covering that needs a post-create failure (patch
        # os.replace) plus a fix in immi_case_downloader/storage.py; see
        # plans/003 "Maintenance notes". test_csv_write_atomic's line 291 has
        # the same weakness for the same reason.
```

Do **not** add `assert not os.path.exists(tmp_path)`, and do **not** delete
`test_csv_write_atomic`'s existing line 291 — removing a (weak) assertion is a
behaviour change outside this plan's remit, and it is recorded as a follow-up
instead.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/ruff check --no-fix --select F841 tests/test_stability.py
.venv/bin/python -m pytest tests/test_stability.py -q -p no:cacheprovider 2>&1 | tail -3
.venv/bin/python -m pytest tests/test_stability.py -q -p no:cacheprovider \
  -k "test_update_case_blocked_fields or test_json_write_atomic" 2>&1 | tail -2
grep -c 'assert result is True' tests/test_stability.py
grep -c 'tmp_path = json_path' tests/test_stability.py
```
→ ruff prints `All checks passed!`; the whole-file run reports `0 failed`; the
two named tests pass; `grep -c 'assert result is True'` prints `2` (the
pre-existing one in `test_update_case_allowed_fields` plus the one you added);
`grep -c 'tmp_path = json_path'` prints `0`.

Negative check on Edit A — the new assertion must actually be evaluated, not
merely present. Temporarily change it to `assert result is False`, re-run
`pytest tests/test_stability.py -k test_update_case_blocked_fields`, and confirm
it **fails** on that line. Restore `is True` immediately and confirm it passes
again.

(Why the assertion is worth having, stated precisely: `update_case`
(`immi_case_downloader/storage.py:249-264`) returns `False` without touching
anything when the `case_id` is not found. In that scenario the test's own
`updated = next(c for c in cases if c.case_id == case_id)` would raise
`StopIteration`, so the failure would surface — but as an opaque generator error
at a line that looks unrelated. `assert result is True` turns that into a
one-line diagnosis at the point of the actual defect, and it is what the sibling
`test_update_case_allowed_fields` already does at line 232.)

### Step 3: Convert the six E712 comparisons to identity comparisons

In `tests/test_pipeline_encapsulation.py`, make exactly these six replacements.
Do **not** convert them to bare truthiness (`assert not status["running"]`) —
that weakens the assertion from "is the `False` singleton" to "is falsy", which
would also accept `0`, `None`, `""` and `[]`.

| Line | From | To |
|---|---|---|
| 10 | `assert status["running"] == False` | `assert status["running"] is False` |
| 17 | `assert p.get_status()["stop_requested"] == True` | `assert p.get_status()["stop_requested"] is True` |
| 25 | `assert p2.get_status()["stop_requested"] == False` | `assert p2.get_status()["stop_requested"] is False` |
| 41 | `assert config.download_enabled == True` | `assert config.download_enabled is True` |
| 51 | `assert s2["running"] == False` | `assert s2["running"] is False` |
| 58 | `assert status["running"] == False` | `assert status["running"] is False` |

**Verify**:
```bash
.venv/bin/ruff check --no-fix --select E712 tests/
.venv/bin/python -m pytest tests/test_pipeline_encapsulation.py -q -p no:cacheprovider 2>&1 | tail -3
grep -c "== True\|== False" tests/test_pipeline_encapsulation.py
```
→ ruff prints `All checks passed!`; pytest reports 9 passed, 0 failed;
`grep -c` prints `0`.

### Step 4: Rename the ambiguous loop variable in `tests/test_legislations_helpers.py`

At line 371, rename `l` to `entry`. Only this one line changes:

```python
        assert any(entry["id"] == law_id for entry in saved["legislations"])
```

**Verify**:
```bash
.venv/bin/ruff check --no-fix --select E741 tests/
.venv/bin/python -m pytest tests/test_legislations_helpers.py -q -p no:cacheprovider 2>&1 | tail -3
```
→ ruff prints `All checks passed!`; pytest reports 0 failed.

### Step 5: Replace the vacuous saved-search "empty state" test

In `tests/e2e/react/test_react_saved_searches.py`, replace the whole method
at lines 499–517 with the version below. This removes the dead
`has_empty_state` variable, removes `assert True`, drops the now-unused
`empty_text_options` list (leaving it would create a *new* F841), and — unlike
an earlier draft of this plan — **actually asserts the empty state**, because
the empty state is guaranteed here.

It is guaranteed because `react_page` (`tests/e2e/react/conftest.py:16-27`) is
function-scoped and calls `browser.new_context(...)` per test with no
`storage_state`, so each test starts with a fresh, isolated `localStorage`.
Saved searches created by `TestSaveSearch` earlier in the module cannot leak
into this test. Substituting `assert page_text.strip()` ("`<main>` rendered
some text") for a real assertion would have been a second vacuous test dressed
up as a fix.

```python
    def test_panel_shows_empty_state_when_no_searches_saved(self, react_page):
        """SavedSearchPanel shows its empty state on a fresh browser context.

        react_page creates a new Playwright context per test with no
        storage_state, so localStorage — and therefore the saved-search list —
        starts empty regardless of what TestSaveSearch did earlier in this
        module. SavedSearchPanel renders collapsed when count == 0
        (frontend/src/components/saved-searches/SavedSearchPanel.tsx:25), so the
        header must be clicked before the empty body is visible.
        """
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)

        # The count badge is in the always-visible header, even when collapsed.
        count_badge = react_page.get_by_test_id("saved-search-count")
        expect(count_badge).to_have_text("0/50")

        # Expand the panel; it starts collapsed because count == 0.
        header = react_page.get_by_role("button", name="Saved Searches")
        expect(header).to_have_attribute("aria-expanded", "false")
        header.click()
        expect(header).to_have_attribute("aria-expanded", "true")

        expect(react_page.get_by_text("No saved searches yet")).to_be_visible()
        expect(
            react_page.get_by_text(
                "Apply filters and click Save Search to create your first saved search."
            )
        ).to_be_visible()
```

`expect` is already imported at
`tests/e2e/react/test_react_saved_searches.py:3`
(`from playwright.sync_api import Page, expect`), so no new import is needed —
adding one would create a fresh F401.

Leave `class TestEmptyStates:` and its docstring alone — the sibling method
`test_dashboard_hides_section_when_no_searches` at line 519 stays untouched.

Do **not** edit `tests/e2e/playwright/test_council_thread_visual.py` by hand;
Step 6's safe autofix converts `except Exception as e:` → `except Exception:`
there, which is the correct fix (the handler ends in a bare `raise`).

**Verify** — the static part here, the behavioural part against a real browser.

*(a) Static, always runnable:*
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/python -m py_compile tests/e2e/react/test_react_saved_searches.py
grep -rn "assert True" tests/
.venv/bin/ruff check --no-fix --select F841 tests/ --output-format=concise
```
→ `py_compile` exits 0 with no output; the `grep` prints nothing (exit 1 is
expected for "no match"); ruff reports exactly one remaining F841, at
`tests/e2e/playwright/test_council_thread_visual.py:305`.

**`py_compile` proves syntax and nothing else.** It cannot tell you whether the
selectors match, whether the panel is collapsed, or whether the strings render.
Do not report it as evidence that the rewritten test works.

*(b) Behavioural — required before this step is marked done.* The test now makes
real claims about the DOM, so it has to be run at least once:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
# One terminal: make install-e2e (see plans/002 Step 7) and a server
make api &                              # or however the operator prefers to run it
.venv/bin/python -m pytest \
  "tests/e2e/react/test_react_saved_searches.py::TestEmptyStates::test_panel_shows_empty_state_when_no_searches_saved" \
  -q --timeout=60
```

→ `1 passed`.

This needs `pytest-playwright` plus a Chromium binary plus a live server, none
of which exist in this working copy (verified 2026-08-28: `import playwright`
raises `ModuleNotFoundError`, and `importlib.metadata.version('pytest-playwright')`
raises `PackageNotFoundError`). `plans/002` Step 7 is what makes them
installable, which is one more reason this plan runs last.

**If you cannot run (b), report Step 5 as `unverified` and say exactly which
prerequisite was missing.** Do not mark it done on `py_compile` alone, and do
not weaken the assertions back toward `assert page_text.strip()` to make a
static check look sufficient. A test that is not run is a claim, not evidence.

> Note: the E2E suites are not run by `make test-py` or by CI (both pass
> `--ignore=tests/e2e`), so a red run here does not break any gate. That is a
> reason to be careful, not a licence to skip the run.

### Step 6: Apply ruff's safe autofixes for the 33 remaining findings

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/ruff check --fix tests/
```

**Never pass `--unsafe-fixes`.** Ruff offers unsafe fixes for the E712 and F841
findings; both are wrong here — the E712 unsafe fix rewrites strict boolean
comparisons into truthiness checks, and the F841 unsafe fix *deletes* the
assignment, which would have erased the very evidence that Step 2's assertions
were missing.

**Verify** — check what changed, not how many files changed. Record the
hand-edited set before running the autofix, then assert that every *additional*
file changed only in ways the autofix is allowed to make:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
# BEFORE the autofix (run this at the end of Step 5):
git diff --name-only -- tests/ | sort > /tmp/tests-touched-by-hand.txt

# ... run `.venv/bin/ruff check --fix tests/` ...

# AFTER:
.venv/bin/ruff check --no-fix tests/
git diff --name-only -- tests/ | sort > /tmp/tests-touched-after.txt
comm -13 /tmp/tests-touched-by-hand.txt /tmp/tests-touched-after.txt > /tmp/tests-autofixed.txt
echo "hand-edited: $(wc -l < /tmp/tests-touched-by-hand.txt)  autofixed: $(wc -l < /tmp/tests-autofixed.txt)"

# Every added line in an autofix-only file must be nothing but `except Exception:`;
# every removed line must be an import or that same except line.
while read -r f; do
  git diff -U0 -- "$f" | grep '^+[^+]' | grep -vE '^\+\s*except Exception:\s*$' \
    && echo "UNEXPECTED ADDITION in $f"
  git diff -U0 -- "$f" | grep '^-[^-]' \
    | grep -vE '^-\s*(import |from .+ import )|^-\s*except Exception as e:\s*$' \
    && echo "UNEXPECTED REMOVAL in $f"
done < /tmp/tests-autofixed.txt
echo "AUTOFIX_DIFF_AUDIT_DONE"

git diff -- tests/e2e/playwright/test_council_thread_visual.py
```

→ ruff prints `All checks passed!`; the audit loop prints
`AUTOFIX_DIFF_AUDIT_DONE` with **no** `UNEXPECTED` lines; the council-thread diff
shows exactly one changed line, `-        except Exception as e:` /
`+        except Exception:`.

At `42826a3` this came to 24 changed files under `tests/` in total. Do not gate
on that number — a sibling plan adding a test file with an unused import changes
it, and the property that matters is the *shape* of each diff, which the audit
loop checks directly.

If the audit reports anything unexpected — STOP. Revert with
`git checkout -- tests/` **only if the drift check confirmed `tests/` was clean
when you started**, and report what the autofix tried to change.

### Step 7: Prove the Python suite is unchanged

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | tail -6
make test-py 2>&1 | grep '^FAILED' | sort > /tmp/py-failed-after.txt
diff /tmp/py-failed-before.txt /tmp/py-failed-after.txt && echo "FAILURE_SET_UNCHANGED"
```

Faster than the pre-002 run: plan 002 Step 5 deleted `pytest.ini`'s `addopts`,
so coverage instrumentation is no longer forced onto every invocation and there
is no coverage table in the output. Do not treat either as drift.

**Verify**: the summary line reports exactly `PY_PASSED_BEFORE` passed and
`PY_SKIPPED_BEFORE` skipped (warning count may vary and is not gated), and
`FAILURE_SET_UNCHANGED` prints — i.e. the failing tests are byte-identical to
the baseline set, all three in
`tests/test_backfill_judge_overrides_from_pdf.py` with
`ImportError: dlopen(...)`.

Note the skip count: after plan 002 the baseline is **one lower** than the
`42826a3` figure, because `test-py` now passes `--ignore=tests/integration` and
that module self-skips. If you see the pre-002 number, plan 002 has not landed
and you are running out of order — STOP.

Any change to the passed count, or any `FAILED` line not in
`/tmp/py-failed-before.txt`, is a STOP condition.

### Step 8: Widen the ruff path list in both gates

**Edit A** — the `Makefile` ruff recipe. **After plan 001 the target is
`lint-py:`, not `lint:`** — `lint:` is now just the prerequisite list
`lint: lint-py lint-fe` and contains no ruff invocation at all. Read the live
file, find the recipe line that starts with `"$(PYTHON)" -m ruff check`, and
insert `tests/` after `scripts/`. Keep the leading TAB and the surrounding
quoting exactly as-is:

```make
lint-py:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ tests/ *.py
```

If you find a bare `lint:` recipe containing the ruff line, plan 001 has not
landed — STOP; you are running out of order.

**Edit B** — the `Lint with ruff` step in `.github/workflows/ci.yml` (line 32 at
`42826a3`; it may have shifted, since plan 002 adds a matrix block above it in
the same job). Anchor on the step name, not the line number. Same insertion:

```yaml
      - name: Lint with ruff
        run: .venv/bin/ruff check immi_case_downloader/ scripts/ tests/ *.py
```

Do not reorder, rename, or move either step — `tests/test_native_dependency_closure.py`
and `tests/test_effective_native_ci.py` parse `.github/workflows/ci.yml` by
regex, and the "Run Python unit tests" step's shape is load-bearing for them.
(Checked 2026-08-28: neither file asserts anything about the `test-python` job
header, so plan 002's matrix addition does not conflict with them — but the
`- name: Run Python unit tests\n  run: >-` shape still is load-bearing.)

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make lint-py
make lint
grep -n "ruff check" Makefile .github/workflows/ci.yml
.venv/bin/python -m pytest tests/test_effective_native_ci.py tests/test_native_dependency_closure.py -q -p no:cacheprovider 2>&1 | tail -3
make -n lint-py | grep -c ' tests/ '
```
→ `make lint-py` and `make lint` both print `All checks passed!` (and `make
lint` additionally runs ESLint with 0 errors); **both** grep hits contain
`immi_case_downloader/ scripts/ tests/ *.py` — one in `Makefile` under
`lint-py:`, one in `ci.yml`; the two CI-shape test files report 0 failed;
`make -n lint-py | grep -c ' tests/ '` prints `1`, proving the expanded recipe
really carries the new path (a `grep` of the source alone would also match a
comment).

### Step 9: Prove the widened gate actually fails on a violation

A gate that cannot fail is not a gate. Create a throwaway violation, confirm the
gate rejects it **by name**, then delete it.

Three safety rules, because this step writes and deletes a file inside the
operator's working tree:

1. **Unique name.** A fixed path like `tests/_ruff_gate_probe.py` can collide
   with a file someone else is working on — and an untracked file is invisible
   to a committed-history drift check, so you would clobber it without warning.
   Derive the name from `$$`.
2. **Refuse to overwrite.** Check `test ! -e` first and abort if the path
   exists. Never `>` onto an existing path here.
3. **Clean up even on failure.** Install a `trap` so an interrupted or failing
   run does not leave a probe behind. A stray probe would make the next
   `make lint-py` fail for a reason nobody can explain.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
PROBE="tests/_ruff_gate_probe_$$.py"
test ! -e "$PROBE" || { echo "STOP: $PROBE already exists — pick another name"; exit 1; }
trap 'rm -f "$PROBE"' EXIT INT TERM

printf 'import os\n' > "$PROBE"
make lint-py 2>&1 | tee /tmp/probe-lint.txt; echo "make lint-py exit=${PIPESTATUS[0]}"
grep -q "$PROBE" /tmp/probe-lint.txt && echo "GATE_NAMED_THE_PROBE"
make lint >/dev/null 2>&1; echo "make lint exit=$?"

rm -f "$PROBE"; trap - EXIT
make lint-py; echo "make lint-py exit=$?"
```

**Verify**:
- the first `make lint-py` prints an `F401` finding **whose path is the probe
  file** and exits non-zero (`2`, since make propagates ruff's exit);
- `GATE_NAMED_THE_PROBE` prints — this is the part that matters. A non-zero exit
  alone would also be produced by a broken Makefile or a missing ruff, so
  "`make lint-py` failed" is not evidence that `tests/` entered the path list;
  the finding naming the probe file is;
- the aggregate `make lint` also exits non-zero (it depends on `lint-py`);
- after `rm`, `make lint-py` prints `All checks passed!` and exits 0.

Then confirm the probe is gone and nothing unexpected is dirty:

```bash
git status --porcelain --untracked-files=all -- tests/ Makefile .github/workflows/ci.yml
```
→ every line starts with ` M` (modified). There must be **no** `??` line, and in
particular no `_ruff_gate_probe_*.py`. If one survives, delete exactly that path
— never an unscoped `git clean`.

## Test plan

This plan writes no new test *files*. It restores three assertions inside
existing tests and hardens six others:

| Test | File | What it now proves that it did not before |
|---|---|---|
| `test_update_case_blocked_fields` | `tests/test_stability.py` | that `update_case` actually found and processed the case (`result is True`), so the "sensitive fields unchanged" assertions are not passing vacuously |
| `test_json_write_atomic` | `tests/test_stability.py` | **nothing new** — the dead `tmp_path` is deleted rather than turned into a `.tmp` assertion that could not fail. The test keeps proving only what it actually proves (the original file survives), and the real gap is handed on. |
| 6 assertions in `tests/test_pipeline_encapsulation.py` | same | that the pipeline flags are the `True`/`False` singletons, not merely truthy/falsy |
| `test_panel_shows_empty_state_when_no_searches_saved` | `tests/e2e/react/test_react_saved_searches.py` | that SavedSearchPanel renders `0/50`, starts collapsed, and shows "No saved searches yet" once expanded — replacing `assert True`, which proved nothing |

Structural pattern to match for the `tests/test_stability.py` Edit A: the
sibling test in the same class, `test_update_case_allowed_fields`
(`tests/test_stability.py:224-236`), which already asserts `result is True` at
line 232.

Do **not** treat `test_csv_write_atomic` (`tests/test_stability.py:264-291`) as
the pattern to copy for Edit B. Its line-291 `.tmp` assertion is itself vacuous
for the reason set out in Current state, and duplicating it would add a second
un-failable assertion.

Regression verification:

- `.venv/bin/ruff check --no-fix tests/` → `All checks passed!` (was:
  `RUFF_BEFORE` findings)
- `make lint-py` → `All checks passed!` with `tests/` now in the path list;
  `make lint` → the same plus ESLint 0 errors
- `make test-py` → `PY_PASSED_BEFORE` passed / `PY_SKIPPED_BEFORE` skipped and
  a byte-identical `FAILED` set — see Step 7
- `make lint-py` with a deliberately broken probe file → non-zero exit **and a
  finding naming the probe path** (Step 9)
- the rewritten E2E test → `1 passed` against a live server, or an explicit
  `unverified` (Step 5b)

## Done criteria

Machine-checkable. ALL must hold. Every count is a **comparison against the
baseline you captured on the post-002 tip**, never a literal from this file.

- [ ] `.venv/bin/ruff check --no-fix tests/` prints `All checks passed!`
- [ ] `make lint-py` exits 0 and prints `All checks passed!`; `make lint` exits
      0 (ruff clean **and** ESLint 0 errors)
- [ ] `make -n lint-py | grep -c ' tests/ '` prints `1` — the **expanded**
      recipe carries the path, which a grep of the source alone (which also
      matches comments) could not establish
- [ ] `grep -c "immi_case_downloader/ scripts/ tests/ \*\.py" Makefile` prints
      `1`, and the match is inside the `lint-py:` recipe, not a bare `lint:`
- [ ] `grep -c "immi_case_downloader/ scripts/ tests/ \*\.py" .github/workflows/ci.yml` prints `1`
- [ ] `make test-py` reports exactly `PY_PASSED_BEFORE` passed and
      `PY_SKIPPED_BEFORE` skipped, and
      `diff /tmp/py-failed-before.txt /tmp/py-failed-after.txt` is empty — the
      failing set is still exactly the three named
      `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat ImportErrors
- [ ] `grep -rn "assert True" tests/` returns no matches
- [ ] `grep -rn "== True\|== False" tests/test_pipeline_encapsulation.py` returns no matches
- [ ] `.venv/bin/python -m pytest tests/test_pipeline_encapsulation.py -q` reports
      `9 passed` (a per-file count, stable regardless of what sibling plans do)
- [ ] `grep -c "assert result is True" tests/test_stability.py` prints `2`
      (the pre-existing one plus Edit A's)
- [ ] `grep -c "tmp_path = json_path" tests/test_stability.py` prints `0` — the
      dead variable is gone and was **not** replaced by an un-failable
      `assert not os.path.exists(tmp_path)`
- [ ] `.venv/bin/python -m pytest tests/test_stability.py -q` reports 0 failed
- [ ] `.venv/bin/ruff check --no-fix --select F841,E712,E741 tests/` prints `All checks passed!`
- [ ] The Step 6 autofix diff audit printed `AUTOFIX_DIFF_AUDIT_DONE` with no
      `UNEXPECTED` lines
- [ ] `.venv/bin/python -m pytest tests/test_effective_native_ci.py tests/test_native_dependency_closure.py -q` reports 0 failed
- [ ] Step 9's probe run produced a ruff finding **naming the probe file** and a
      non-zero `make lint-py`, and the probe is gone afterwards
- [ ] The rewritten E2E test passed against a live server
      (`pytest "…::TestEmptyStates::test_panel_shows_empty_state_when_no_searches_saved"`
      → `1 passed`) — **or** Step 5 is reported as `unverified` naming the
      missing prerequisite. `py_compile` alone does not satisfy this.
- [ ] `git status --porcelain --untracked-files=all -- tests/ Makefile .github/workflows/ci.yml`
      shows only ` M` lines — no `??`, and no `_ruff_gate_probe_*.py`
- [ ] `git status --porcelain` shows no modifications outside `tests/`,
      `Makefile`, `.github/workflows/ci.yml` and `plans/`, other than paths the
      drift check recorded as already dirty
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back — do not improvise — if any of these occur:

- **Ruff version mismatch.** `.venv/bin/ruff --version` is not `ruff 0.15.18`.
  The pin at `requirements-test.txt:7` documents that 0.16 adds 394 new
  findings; this plan's counts are only valid for 0.15.18. Do not bump ruff to
  make anything pass.
- **The Step 1 set of 10 hand-findings does not match.** A different *total* is
  tolerable if every extra finding is an F401 (a sibling plan added a test file
  with an unused import); a different **identity** set is not — it means the
  files this plan hand-edits have moved, and the "Current state" excerpts must
  be re-read against the live files first.
- **Any "Current state" excerpt does not match the live file** at the quoted
  line numbers — with the documented exceptions listed in "What plans 001 and
  002 change before you start". A `pytest.ini` without `addopts`, a `Makefile`
  with `lint: lint-py lint-fe`, and a matrixed `test-python` CI job are all
  **expected**, not drift.
- **`Makefile` still has a bare `lint:` recipe containing the ruff invocation**,
  or `pytest.ini` still has an `addopts` line. Either means plan 001 or plan 002
  has not landed and you are running out of order.
- **The pytest passed-count changes.** If Step 7 reports anything other than
  `PY_PASSED_BEFORE`, an import you removed was load-bearing. Identify which
  file by bisecting with `git checkout -- <file>` (scoped to a single file you
  changed — never an unscoped checkout) and report it; do not paper over it by
  re-adding a blanket `# noqa`.
- **A pytest `FAILED` line appears that is not in `/tmp/py-failed-before.txt`.**
- **The Step 6 autofix diff audit reports an `UNEXPECTED ADDITION` or
  `UNEXPECTED REMOVAL`.** Revert with `git checkout -- tests/` — but only if the
  drift check confirmed `tests/` was clean at the start — and report what it
  tried to change.
- **You are tempted to run `--unsafe-fixes`, add `# noqa`, add a `ruff.toml`
  exclusion, or `@pytest.mark.skip` a test** to get a step green. All four are
  out of bounds. Report the blocker instead.
- **`make lint-py` still exits 0 with the Step 9 probe file present, or it exits
  non-zero without a finding that names the probe path.** The first means
  `tests/` did not get added to the path list; the second means something else
  is failing and the probe proved nothing. Re-check both Step 8 edits.
- **A `_ruff_gate_probe_*.py` file exists in `tests/` at any point after Step 9,
  or the Step 9 precondition `test ! -e "$PROBE"` fails.** Delete exactly that
  path; never an unscoped `git clean`.
- **You cannot run the rewritten E2E test (Step 5b).** That is not a failure —
  report Step 5 as `unverified` with the missing prerequisite named. It becomes
  a STOP only if you are tempted to weaken the assertions to make a static check
  look sufficient.
- **The fix appears to need a file outside the In-scope list** — in particular
  `immi_case_downloader/storage.py`. Adding atomic-write cleanup there is the
  right fix for the `.tmp` gap and it is explicitly **not** this plan's job;
  see "Maintenance notes".
- **A step's verification fails twice after a reasonable fix attempt.**

## Maintenance notes

For the human or agent who owns this next:

- **What a reviewer should scrutinise**: (1) `assert result is True` in
  `test_update_case_blocked_fields` sits *before* the `load_all_cases` re-read,
  so it proves the whitelist path ran; (2) `test_json_write_atomic` gained a
  comment and **lost** a variable, and did **not** gain
  `assert not os.path.exists(tmp_path)` — if that assertion is in the diff, the
  reviewer should reject it and read "Why the `.tmp` assertion is NOT the right
  fix" in this plan; (3) the rewritten E2E test asserts real DOM state
  (`0/50`, `aria-expanded`, "No saved searches yet") rather than
  `assert page_text.strip()`, and the handoff says whether it was actually run.
- **What will interact with this**: bumping ruff past `0.15.18` (the pin at
  `requirements-test.txt:7`) expands the default rule set and, per that
  comment, surfaces ~394 new findings. `tests/` is now inside the gate, so that
  bump will need a cleanup pass covering `tests/` as well as
  `immi_case_downloader/` and `scripts/`. Budget accordingly.
- **OPEN DEFECT, needs a source change: neither atomic-write helper cleans up
  its `.tmp` file, and neither test can currently catch that.**
  `save_cases_csv` (`immi_case_downloader/storage.py:59-71`) and
  `save_cases_json` (`:74-93`) both write to `<path>.tmp` and then `os.replace`,
  with no `try`/`except`/`finally`. If the write fails *after* the temp file
  exists — a disk-full mid-`json.dump`, a serialisation error, an interrupted
  process — the `.tmp` is left on disk. Both existing tests inject the failure
  *before* the file is created (the mocked `open` raises at `storage.py:88`; the
  mocked `to_csv` raises before pandas opens the file), so
  `test_csv_write_atomic`'s line-291 assertion passes vacuously and the JSON
  twin has no such assertion at all.

  The fix has two halves and belongs to a plan that owns
  `immi_case_downloader/`:
  1. wrap the write in `try: … except BaseException: os.unlink(tmp_path) …
     raise` (or a `finally` that removes `tmp_path` if it still exists) in both
     functions;
  2. add a test that patches **`os.replace`** to raise, so the `.tmp` genuinely
     exists at failure time, then asserts `not os.path.exists(tmp_path)`. That
     test **fails against today's implementation**, which is exactly what makes
     it worth writing.

  Do not do this inside plan 003 — its file territory is `tests/**`, `Makefile`
  and `.github/workflows/ci.yml`, and half the fix is outside it.
- **Resolved, not deferred: the saved-search empty-state test.** An earlier draft
  deferred this on the belief that `TestSaveSearch` pollutes `localStorage` for
  later tests in the module. That belief was wrong — `react_page`
  (`tests/e2e/react/conftest.py:16-27`) creates a new Playwright context per
  test with no `storage_state`, so storage is isolated per test and the empty
  state is guaranteed. Step 5 now asserts it directly. No reset fixture is
  needed.
- **Deferred: weak frontend/worker assertions.** 40 occurrences of
  `toBeTruthy()` / `toBeDefined()` / `not.toBeNull()` across 18 files under
  `frontend/` (15 files in `frontend/__tests__/`, 1 in
  `frontend/src/lib/__tests__/`, 1 in `frontend/e2e/`), plus 11 more under
  `workers/`. Same category of defect as the Python F841s — an assertion that
  cannot fail — but a different toolchain and different file territory, so it
  belongs to a separate plan.
- **Deliberately not added**: a root `ruff.toml` / `pyproject.toml`. It would
  only be needed to relax rules per directory, and nothing here is relaxed.
  Revisit only if a future rule genuinely must differ between `tests/` and
  `immi_case_downloader/`.

## Findings reconsidered

- **TEST-17's frontend clause ("sweep the 35 `toBeTruthy`/`toBeDefined`
  frontend assertions")** — kept as a finding but moved out of this plan's
  scope, and the count corrected. The actual figure at commit `42826a3` is
  **40** occurrences across 18 files under `frontend/` (only 4 of which are in
  `frontend/src/`; the bulk live in `frontend/__tests__/`), plus 11 more under
  `workers/`. `frontend/**` and `workers/**` are outside this plan's file
  territory (`tests/**/*.py`, `Makefile`, `.github/workflows/ci.yml`) and are
  gated by a different toolchain, so bundling them here would create merge
  conflicts with any parallel frontend work for no verification benefit.
- **DX-08's suggestion to add a `ruff.toml`/`pyproject.toml`** — dropped. Its
  stated purpose was "so per-directory rule relaxations for tests are
  expressible", but this plan fixes all 43 findings outright rather than
  relaxing any rule, so there is nothing to express. Adding root ruff config
  would also silently change linting for `immi_case_downloader/` and
  `scripts/`, which this plan does not own.
- **`tests/e2e/playwright/test_council_thread_visual.py:305` (F841 `e`)** —
  reviewed under the "an unused variable in a test usually means a missing
  assertion" heuristic and found **not** to be a missing assertion. The handler
  ends in a bare `raise`, which re-raises the active exception without
  referencing the name, and it already dumps a screenshot and HTML snippet for
  diagnosis. Ruff's *safe* fix (`except Exception:`) is correct and is applied
  mechanically in Step 6 rather than by hand.
- **`ALLOWED_UPDATE_FIELDS` imported-but-unused in
  `tests/test_sqlite_repository.py:7` and `tests/test_supabase_repository.py:10`**
  — reviewed as a possible dropped mass-assignment test, and cleared. Both
  files still cover the whitelist behaviourally
  (`tests/test_supabase_repository.py:237` `def test_blocked_fields`,
  `tests/test_sqlite_repository.py:145` "Fields not in ALLOWED_UPDATE_FIELDS
  are silently ignored"); they just name the constant in prose instead of
  importing it. Removing the imports loses no coverage.

- **Corrected: `tests/test_stability.py:296` (F841 `tmp_path`) is NOT a missing
  assertion.** The first draft of this plan applied the same "an unused variable
  in a test usually means a missing assertion" heuristic that correctly caught
  `result` at line 242, and prescribed adding
  `assert not os.path.exists(tmp_path)` to mirror `test_csv_write_atomic:291`.
  Re-reading the code under test showed that would have been a vacuous fix: the
  patched `open()` raises inside `save_cases_json` at
  `immi_case_downloader/storage.py:88` — the `with open(tmp_path, "w") as f:`
  line — so the `.tmp` file is never created and the assertion is true no matter
  what the implementation does. Worse, neither `save_cases_json` nor
  `save_cases_csv` has any cleanup path at all, so the assertion would have
  been *stating a property the code does not have* while passing. The plan now
  deletes the dead variable (Step 2 Edit B) and hands the real defect on with
  the fix shape spelled out (see "Maintenance notes"). The same analysis shows
  `test_csv_write_atomic:291` is vacuous for the identical reason; that
  assertion is left in place because removing it is a behaviour change outside
  this plan's remit.

- **Corrected: the saved-search empty state IS testable, and the reason given
  for deferring it was false.** The first draft asserted that "`class
  TestSaveSearch` runs earlier in the same module and creates saved searches, so
  the panel is not guaranteed empty", and on that basis replaced `assert True`
  with `assert page_text.strip()` — trading one un-failable assertion for
  another. `tests/e2e/react/conftest.py:16-27` refutes it: `react_page` is
  function-scoped and calls `browser.new_context(...)` per test with no
  `storage_state`, and a Playwright context has isolated storage, so
  `localStorage` — and therefore the saved-search list — starts empty in every
  test regardless of module ordering. Step 5 now asserts the real empty state
  (`data-testid="saved-search-count"` reading `0/50`, `aria-expanded="false"` on
  the collapsed header, and "No saved searches yet" after expanding), all read
  from `frontend/src/components/saved-searches/SavedSearchPanel.tsx:25,52-74,119-146`
  and confirmed against `frontend/src/i18n/locales/en.json`.
