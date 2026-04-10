# IMMI-Case Improvement Plan

> **Status Update (2026-04-10):**
> - **Webapp Split (Phase 3):** ✅ COMPLETE. Logic moved to `immi_case_downloader/web/` with Blueprints.
> - **CaseRepository (Phase 4):** ✅ COMPLETE. Repository pattern implemented and in use.
> - **Scraper Unification (Phase 5):** ✅ COMPLETE. `CaseScraper` Protocol + `MetadataExtractor` centralised.
> - **Pipeline Improvement (Phase 6):** ✅ COMPLETE. `SmartPipeline` fully encapsulated; module-level globals removed.
> - **Performance Optimization (Phase 7):** ✅ COMPLETE. TTL cache + Flask-Limiter rate limiting added.
> - **Full Test Coverage (Phase 8):** ✅ COMPLETE. 37 new tests; all phases covered.
> - **Frontend:** React SPA is the primary UI. Legacy Jinja2 routes redirect to React.
> - **E2E Tests:** Ambiguous selectors fixed (17 files updated, 0 StrictModeViolation errors).

---

## Roadmap Overview

- [x] **Phase 3: Webapp Split** (Completed)
- [x] **Phase 4: Data Layer Refactor** (Completed)
- [ ] **Phase 0: Security Hardening** (In Progress - warnings remain)
- [ ] **Phase 1: Stability & Thread Safety** (In Progress - JobManager pending)
- [ ] **Phase 2: Test Infrastructure** (High Priority - E2E fixes)
- [x] **Phase 5: Scraper Unification** (Completed 2026-04-10)
- [x] **Phase 6: Pipeline Improvement** (Completed 2026-04-10)
- [x] **Phase 7: Performance Optimization** (Completed 2026-04-10)
- [x] **Phase 8: Full Test Coverage** (Completed 2026-04-10)

---

## Phase 0: Security Hardening

**Status:** Partial. `RuntimeWarning: SECRET_KEY not set!` visible in logs.

### Remaining Tasks
1.  **Enforce Secret Key:** Ensure `SECRET_KEY` is loaded from `.env` in production and tests. Update `tests/conftest.py` to suppress warnings or provide a key.
2.  **CSRF Verification:** Double-check CSRF protection on the React API endpoints (`/api/v1/*`).
3.  **Secure Headers:** Verify `Secure`, `HttpOnly`, `SameSite` flags on cookies.

---

## Phase 1: Stability & Thread Safety

**Status:** Partial. `_job_status` in `web/jobs.py` uses a lock, but global state is still mutable.

### Remaining Tasks
1.  **JobManager Class:** Refactor `_job_status` dictionary into a proper `JobManager` class (Singleton) to encapsulate state and locking logic.
2.  **Input Validation:** Ensure all API inputs (pagination, search queries) are strictly validated using `safe_int` / `safe_float`.

---

## Phase 2: Test Infrastructure (URGENT)

**Status:** Critical Failures. 33 E2E tests failing due to Playwright Strict Mode violations.

### Immediate Action Items
1.  **Fix Ambiguous Selectors:** Update `tests/e2e/react/react_helpers.py` and test files to use specific locators (e.g., `get_by_role('button', name='Save')` instead of `get_by_text('Save')`).
2.  **Stabilize Navigation:** Fix timeout issues in sidebar navigation tests.
3.  **Theme Toggle Test:** Fix visibility assertion for the theme toggle button.

---

## Phase 5: Scraper Unification ✅

**Status:** COMPLETE (2026-04-10).

### Completed
1.  **CaseScraper Protocol:** `immi_case_downloader/sources/protocol.py` — `@runtime_checkable` Protocol with `search_cases()` + `download_case_text()`. Both scrapers now comply.
2.  **Unified Metadata Extraction:** `immi_case_downloader/sources/metadata_extractor.py` — `MetadataExtractor` class centralises all regex patterns previously duplicated across scrapers.
3.  **Tests:** `tests/test_scraper_protocol.py` — 17 tests covering Protocol compliance and MetadataExtractor extraction.

---

## Phase 6: Pipeline Improvement ✅

**Status:** COMPLETE (2026-04-10).

### Completed
1.  **State Encapsulation:** `SmartPipeline` instance now holds `self._status` + `self._lock`; all module-level globals removed.
2.  **Instance API:** `get_status()`, `request_stop()`, `_is_stopped()` added as instance methods.
3.  **Module-level shims:** `get_pipeline_status()`, `request_pipeline_stop()`, `start_pipeline()` delegate to `_active_pipeline` for backward compatibility.
4.  **Tests:** `tests/test_pipeline_encapsulation.py` — 9 tests; `tests/test_pipeline.py` updated for new API.

---

## Phase 7: Performance Optimization ✅

**Status:** COMPLETE (2026-04-10).

### Completed
1.  **TTL Caching:** Analytics endpoints use thread-safe TTL cache (`_analytics_cache` dict + `_analytics_cache_ts` timestamp + `threading.Lock`).
2.  **Rate Limiting:** `Flask-Limiter>=3.5` added; rate limits on API endpoints (`/api/v1/search`, `/api/v1/cases`, `/api/v1/pipeline/start`).
3.  **Tests:** `tests/test_rate_limiting.py` — 11 tests covering cache TTL expiry, cache hits, and rate limit enforcement.

---

## Phase 8: Full Test Coverage ✅

**Status:** COMPLETE (2026-04-10). 37 new tests added across phases 5–7.

### Achieved
- `tests/test_scraper_protocol.py`: 17 tests (Protocol compliance, MetadataExtractor)
- `tests/test_pipeline_encapsulation.py`: 9 tests (SmartPipeline encapsulation)
- `tests/test_rate_limiting.py`: 11 tests (TTL cache + Flask-Limiter)
- All pre-existing tests continue to pass.

---

## Ralph Loop: E2E Test Fixes (Immediate)

```markdown
# PROMPT.md — Phase 2-Fix: E2E Test Stabilization

## Context
33 E2E tests are failing due to Playwright Strict Mode violations (ambiguous selectors) and timeouts.

## Task
1.  **Analyze Failures:** Review `pytest` output for specific selector ambiguities.
    *   `get_by_text("Save Search")` -> matches button AND helper text.
    *   `get_by_text("Dashboard")` -> matches link AND heading.
    *   `get_by_text("Scrape AustLII")` -> timeout.
2.  **Refactor Selectors:** Update `tests/e2e/react/` files to use robust locators:
    *   `get_by_role("button", name="...")`
    *   `get_by_role("link", name="...", exact=True)`
    *   `get_by_role("heading", name="...")`
3.  **Fix Navigation:** Ensure sidebar navigation tests wait for stability before clicking.
4.  **Verify:** Run `python3 -m pytest tests/e2e/react/` until all pass.

## Completion
Output <promise>E2E TESTS FIXED</promise> when `pytest` reports 0 failures for the E2E suite.
```