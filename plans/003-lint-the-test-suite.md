# Plan 003: Lint `tests/` and fix the 43 violations hiding behind the narrowed path

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
> git diff --stat 42826a3..HEAD -- tests/ Makefile .github/workflows/ci.yml
> ```
> Empty output means no drift — proceed. If any in-scope file changed since
> this plan was written, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`make lint` and the CI lint step both run ruff against
`immi_case_downloader/ scripts/ *.py` — the 104 Python files under `tests/`
are in neither path list. The test suite is this repo's primary verification
asset (1,141 passing Python unit tests), and it has been getting zero static
analysis. Running ruff against it today surfaces **43 real findings**, and two
of them are silently-broken security tests: `test_update_case_blocked_fields`
(CWE-915 mass-assignment whitelist) and `test_json_write_atomic` (atomic-write
tmp cleanup) both compute a value and then never assert on it, so they pass
whether or not the behaviour they claim to cover works. Fixing the findings and
widening the ruff path list closes both the specific holes and the class of
hole — the next dead assertion gets caught by CI instead of accumulating.

## Current state

### The two gates that exclude `tests/`

`Makefile:90-96` — verbatim (recipe lines are TAB-indented):

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

`pytest.ini` exists at the repo root and forces coverage reporting on every
run, which is why `make test-py` prints a long coverage table:

```ini
[pytest]
testpaths = tests
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
```

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
| `tests/test_stability.py:242` | F841 `result` | **Missing assertion.** Fix in Step 2. |
| `tests/test_stability.py:296` | F841 `tmp_path` | **Missing assertion.** Fix in Step 2. |
| `tests/test_pipeline_encapsulation.py:10,17,25,41,51,58` | E712 ×6 | Real bools; convert to `is True` / `is False`. Step 3. |
| `tests/test_legislations_helpers.py:371` | E741 `l` | Cosmetic; rename to `entry`. Step 4. |
| `tests/e2e/react/test_react_saved_searches.py:514` | F841 `has_empty_state` | **Vacuous test** (`assert True`). Rewrite. Step 5. |

### `tests/test_stability.py` — the two dead security assertions

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

`tests/test_stability.py:264-319` — verbatim. The CSV test asserts the tmp file
was cleaned up (line 291); its JSON twin computes `tmp_path` at line 296 and
never uses it:

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

Both assertions this plan adds were **empirically confirmed to pass** at commit
`42826a3` by replaying the scenarios against the real `immi_case_downloader.storage`
module: `update_case(...)` with only blocked fields returns `True`, and the
`.tmp` file does not exist after the simulated JSON write failure.

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

This is the only `assert True` anywhere under `tests/`. The test cannot assert
its own docstring: `class TestSaveSearch` runs earlier in the same module and
creates saved searches, so the panel is not guaranteed empty by the time
`TestEmptyStates` runs. Nothing outside this file references
`TestEmptyStates` or `test_panel_empty_state` (verified by repo-wide grep),
so renaming the method is safe.

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

| Purpose | Command | Expected on success |
|---|---|---|
| Lint tests only (read-only) | `.venv/bin/ruff check --no-fix --output-format=concise tests/` | at baseline: `Found 43 errors.`; at the end: `All checks passed!` |
| Lint one rule | `.venv/bin/ruff check --no-fix --select F841 tests/` | `All checks passed!` after Steps 2–6 |
| Apply safe fixes | `.venv/bin/ruff check --fix tests/` | `Found N errors (33 fixed, ...)` |
| Repo lint gate | `make lint` | `All checks passed!` |
| Python unit tests | `make test-py` | `3 failed, 1141 passed, 7 skipped` — takes ~6 min |
| One test file | `.venv/bin/python -m pytest tests/test_stability.py -q -p no:cacheprovider` | all pass |
| Syntax check a file | `.venv/bin/python -m py_compile <file>` | exit 0, no output |
| Worktree state | `git status --short` | only in-scope files modified |

**The 3 pytest failures are pre-existing and environmental.** They are all in
`tests/test_backfill_judge_overrides_from_pdf.py` and are caused by a Homebrew
Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf` import:

```
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words - ImportError: dlopen(/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Pyth...
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging - ImportError: dlopen(...)
FAILED tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent - ImportError: dlopen(...)
```

They are **not** caused by repo code and are **not** this plan's problem. Do not
attempt to fix them. Your job is to keep the counts identical: `1141 passed`
before and `1141 passed` after.

## Scope

**In scope** (the only files you may modify):

- `tests/test_stability.py`
- `tests/test_pipeline_encapsulation.py`
- `tests/test_legislations_helpers.py`
- `tests/e2e/react/test_react_saved_searches.py`
- `tests/e2e/playwright/test_council_thread_visual.py`
- Any other file under `tests/**/*.py` touched **only** by
  `ruff check --fix tests/` in Step 6 (import removals — expect ~20 files)
- `Makefile` (the `lint:` recipe, line 93 — one line)
- `.github/workflows/ci.yml` (the "Lint with ruff" step, line 32 — one line)
- `tests/_ruff_gate_probe.py` — created and deleted inside Step 9 only

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
- `CLAUDE.md` and any other docs. The `make lint` help text at `Makefile:34`
  ("Ruff lint Python source") stays as-is: it is still accurate, and changing
  it would desynchronise it from the identical line in `CLAUDE.md`, which is
  out of territory.
- `pytest.ini` — the coverage `addopts` are intentional.

## Git workflow

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git checkout -b chore/lint-the-test-suite
```

- Commit per logical unit. Suggested messages, matching the repo's convention:
  - `test: assert on update_case result and json tmp cleanup`
  - `test: use identity comparisons for pipeline boolean assertions`
  - `test: replace vacuous saved-search empty-state assertion`
  - `test: drop unused imports flagged by ruff`
  - `ci: lint tests/ in make lint and the CI ruff step`
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and pushes.

## Steps

### Step 1: Confirm the baseline

Record the starting numbers so you can prove nothing regressed.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/ruff --version
.venv/bin/ruff check --no-fix --output-format=concise tests/ | tail -3
make lint
```

**Verify**:
- `.venv/bin/ruff --version` → `ruff 0.15.18`
- ruff on `tests/` → last lines contain `Found 43 errors.` and
  `33 fixable with the --fix option`
- `make lint` → `All checks passed!`

If the ruff version is not `0.15.18`, or the count is not 43, STOP (see STOP
conditions).

### Step 2: Restore the two missing assertions in `tests/test_stability.py`

Two edits, both adding a line — no deletions.

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

**Edit B** — in `test_json_write_atomic`, add the leftover-tmp assertion at the
very end of the method, mirroring `test_csv_write_atomic:290-291`. The last
lines of the method become:

```python
        # Original JSON should still be intact
        assert os.path.exists(json_path)
        with open(json_path) as f:
            assert f.read() == original_content
        # No leftover .tmp file
        assert not os.path.exists(tmp_path)
```

**Verify**:
```bash
.venv/bin/ruff check --no-fix --select F841 tests/test_stability.py
.venv/bin/python -m pytest tests/test_stability.py -q -p no:cacheprovider 2>&1 | tail -3
```
→ ruff prints `All checks passed!`; pytest summary line reports `passed` with
`0 failed` (the file has no pyexpat dependency).

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
`empty_text_options` list (leaving it would create a *new* F841), and states
honestly why the empty state itself cannot be asserted here.

```python
    def test_cases_page_renders_with_saved_search_panel(self, react_page):
        """/cases renders whether or not saved searches already exist.

        This cannot assert the *empty* state: TestSaveSearch runs earlier in
        this module and leaves saved searches behind, so the panel is not
        guaranteed to be empty by the time this runs. Asserting a real empty
        state needs a per-test reset fixture — deferred, see plans/003.
        """
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)

        page_text = react_page.locator("main").inner_text()
        assert page_text.strip(), "/cases rendered no main content"
```

Leave `class TestEmptyStates:` and its docstring alone — the sibling method
`test_dashboard_hides_section_when_no_searches` at line 519 stays untouched.

Do **not** edit `tests/e2e/playwright/test_council_thread_visual.py` by hand;
Step 6's safe autofix converts `except Exception as e:` → `except Exception:`
there, which is the correct fix (the handler ends in a bare `raise`).

**Verify**:
```bash
.venv/bin/python -m py_compile tests/e2e/react/test_react_saved_searches.py
grep -n "assert True" tests/ -r
.venv/bin/ruff check --no-fix --select F841 tests/ --output-format=concise
```
→ `py_compile` exits 0 with no output; the `grep` prints nothing (exit 1 is
expected for "no match"); ruff reports exactly one remaining F841, at
`tests/e2e/playwright/test_council_thread_visual.py:305`.

> The Playwright/E2E suites are **not** run by `make test-py` or by CI (both
> pass `--ignore=tests/e2e`), and they need a live server plus browsers. Syntax
> checking with `py_compile` is the correct and sufficient gate here.

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

**Verify**:
```bash
.venv/bin/ruff check --no-fix tests/
git diff --stat -- tests/
git diff -- tests/e2e/playwright/test_council_thread_visual.py
```
→ ruff prints `All checks passed!`; `git diff --stat -- tests/` shows exactly
**24** changed files (23 touched by the autofix, plus
`tests/test_legislations_helpers.py` from Step 4, whose only finding was the
non-fixable E741); the council-thread diff shows exactly one changed line,
`-        except Exception as e:` / `+        except Exception:`.

If `git diff -- tests/` shows any change that is **not** an import-line removal,
a boolean identity comparison, an added assertion from Steps 2–5, the `entry`
rename, or that single `except` line — STOP.

### Step 7: Prove the Python suite is unchanged

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | tail -6
```

This takes about 6 minutes (coverage is on by default via `pytest.ini`).

**Verify**: the final summary line reads
`3 failed, 1141 passed, 7 skipped, 15 warnings` (warning count may vary), and
the three `FAILED` lines are all in
`tests/test_backfill_judge_overrides_from_pdf.py` with `ImportError: dlopen(...)`.

Any change to the passed count, or any FAILED line in a different file, is a
STOP condition.

### Step 8: Widen the ruff path list in both gates

**Edit A** — `Makefile:93`. Insert `tests/` after `scripts/`. Keep the leading
TAB and the surrounding quoting exactly as-is:

```make
lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ tests/ *.py
```

**Edit B** — `.github/workflows/ci.yml:32`. Same insertion:

```yaml
      - name: Lint with ruff
        run: .venv/bin/ruff check immi_case_downloader/ scripts/ tests/ *.py
```

Do not reorder, rename, or move either step — `tests/test_native_dependency_closure.py`
and `tests/test_effective_native_ci.py` parse `.github/workflows/ci.yml` by
regex, and the "Run Python unit tests" step's shape is load-bearing for them.

**Verify**:
```bash
make lint
grep -n "ruff check" Makefile .github/workflows/ci.yml
.venv/bin/python -m pytest tests/test_effective_native_ci.py tests/test_native_dependency_closure.py -q -p no:cacheprovider 2>&1 | tail -3
```
→ `make lint` prints `All checks passed!`; both grep hits contain
`immi_case_downloader/ scripts/ tests/ *.py`; the two CI-shape test files
report 0 failed.

### Step 9: Prove the widened gate actually fails on a violation

A gate that cannot fail is not a gate. Create a throwaway violation, confirm
`make lint` rejects it, then delete it.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
printf 'import os\n' > tests/_ruff_gate_probe.py
make lint; echo "make lint exit=$?"
rm tests/_ruff_gate_probe.py
make lint; echo "make lint exit=$?"
```

**Verify**: the first `make lint` prints an `F401` finding for
`tests/_ruff_gate_probe.py` and `make lint exit=2` (make propagates ruff's
non-zero exit); the second prints `All checks passed!` and `make lint exit=0`.

Then confirm the probe file is gone and nothing unexpected is dirty:

```bash
git status --porcelain --untracked-files=all -- tests/ Makefile .github/workflows/ci.yml
```
→ every line starts with ` M` (modified). There must be **no** `??` line, and
in particular no `tests/_ruff_gate_probe.py`.

## Test plan

This plan writes no new test *files*. It restores three assertions inside
existing tests and hardens six others:

| Test | File | What it now proves that it did not before |
|---|---|---|
| `test_update_case_blocked_fields` | `tests/test_stability.py` | that `update_case` actually found and processed the case (`result is True`), so the "sensitive fields unchanged" assertions are not passing vacuously |
| `test_json_write_atomic` | `tests/test_stability.py` | that the failed atomic write leaves no `.tmp` file behind — matching `test_csv_write_atomic` |
| 6 assertions in `tests/test_pipeline_encapsulation.py` | same | that the pipeline flags are the `True`/`False` singletons, not merely truthy/falsy |
| `test_cases_page_renders_with_saved_search_panel` | `tests/e2e/react/test_react_saved_searches.py` | that `/cases` renders content at all — replacing `assert True`, which proved nothing |

Structural pattern to match for the two `tests/test_stability.py` edits: the
sibling tests in the same classes — `test_update_case_allowed_fields`
(`tests/test_stability.py:224-236`) and `test_csv_write_atomic`
(`tests/test_stability.py:264-291`). Both already do exactly what this plan
adds to their twins.

Regression verification:

- `.venv/bin/ruff check --no-fix tests/` → `All checks passed!` (was:
  `Found 43 errors.`)
- `make lint` → `All checks passed!` with `tests/` now in the path list
- `make test-py` → `3 failed, 1141 passed, 7 skipped` — byte-identical counts
  to the pre-change baseline
- `make lint` with a deliberately broken probe file → non-zero exit (Step 9)

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.venv/bin/ruff check --no-fix tests/` prints `All checks passed!`
- [ ] `make lint` exits 0 and prints `All checks passed!`
- [ ] `grep -c "immi_case_downloader/ scripts/ tests/ \*\.py" Makefile` prints `1`
- [ ] `grep -c "immi_case_downloader/ scripts/ tests/ \*\.py" .github/workflows/ci.yml` prints `1`
- [ ] `make test-py` summary reads `3 failed, 1141 passed, 7 skipped`, and all
      3 failures are in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `grep -rn "assert True" tests/` returns no matches
- [ ] `grep -rn "== True\|== False" tests/test_pipeline_encapsulation.py` returns no matches
- [ ] `grep -n "assert result is True" tests/test_stability.py` returns 2 matches
      (lines ~232 and ~251)
- [ ] `grep -c "assert not os.path.exists(tmp_path)" tests/test_stability.py` prints `2`
- [ ] `.venv/bin/ruff check --no-fix --select F841,E712,E741 tests/` prints `All checks passed!`
- [ ] `.venv/bin/python -m pytest tests/test_effective_native_ci.py tests/test_native_dependency_closure.py -q` reports 0 failed
- [ ] `git status --porcelain --untracked-files=all -- tests/ Makefile .github/workflows/ci.yml`
      shows only ` M` lines — no `??`, and no `tests/_ruff_gate_probe.py`
- [ ] `git status --porcelain` shows no modifications outside `tests/`,
      `Makefile`, `.github/workflows/ci.yml`, and `plans/`
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back — do not improvise — if any of these occur:

- **Ruff version mismatch.** `.venv/bin/ruff --version` is not `ruff 0.15.18`.
  The pin at `requirements-test.txt:7` documents that 0.16 adds 394 new
  findings; this plan's counts are only valid for 0.15.18. Do not bump ruff to
  make anything pass.
- **The baseline count is not 43.** `ruff check --no-fix tests/` reporting a
  different number at Step 1 means the tree drifted from commit `42826a3`.
  Re-read the "Current state" excerpts against the live files first.
- **Any "Current state" excerpt does not match the live file** at the quoted
  line numbers.
- **The pytest passed-count changes.** If Step 7 reports anything other than
  `1141 passed`, an import you removed was load-bearing. Identify which file
  by bisecting with `git checkout -- <file>` and report it; do not paper over
  it by re-adding a blanket `# noqa`.
- **A pytest failure appears outside `tests/test_backfill_judge_overrides_from_pdf.py`.**
- **`ruff check --fix tests/` changes anything other than import lines and the
  single `except Exception as e:` line.** Revert with
  `git checkout -- tests/` and report what it tried to change.
- **You are tempted to run `--unsafe-fixes`, add `# noqa`, add a `ruff.toml`
  exclusion, or `@pytest.mark.skip` a test** to get a step green. All four are
  out of bounds. Report the blocker instead.
- **`make lint` still exits 0 with the Step 9 probe file present.** That means
  `tests/` did not actually get added to the path list — re-check both edits.
- **The fix appears to need a file outside the In-scope list.**
- **A step's verification fails twice after a reasonable fix attempt.**

## Maintenance notes

For the human or agent who owns this next:

- **What a reviewer should scrutinise**: the two added assertions in
  `tests/test_stability.py`. They are the point of this plan — everything else
  is import hygiene. Confirm `assert result is True` sits *before* the
  `load_all_cases` re-read (it proves the whitelist path ran), and that the
  `.tmp` assertion in `test_json_write_atomic` mirrors its CSV twin.
- **What will interact with this**: bumping ruff past `0.15.18` (the pin at
  `requirements-test.txt:7`) expands the default rule set and, per that
  comment, surfaces ~394 new findings. `tests/` is now inside the gate, so that
  bump will need a cleanup pass covering `tests/` as well as
  `immi_case_downloader/` and `scripts/`. Budget accordingly.
- **Deferred: the saved-search empty-state test.**
  `tests/e2e/react/test_react_saved_searches.py` still has no test that proves
  the SavedSearchPanel renders its empty state, because `TestSaveSearch` runs
  first in the same module and leaves saved searches behind. Fixing this
  properly needs a fixture that resets saved searches per test. Deliberately
  not attempted here: E2E requires a live server plus Playwright browsers, so
  the change could not be verified inside this plan's loop.
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
