---
name: build-and-test
description: Build React frontend and run Playwright E2E tests in one step
---

# Build & Test

One-command workflow to build the React frontend and run the full E2E test suite.

## Steps

1. **Build frontend**:
   ```bash
   cd '/Users/d/Developer/Active Projects/IMMI-Case-/frontend' && npm run build
   ```
   This runs: tokens generation → TypeScript compilation → Vite production build.
   Output goes to `immi_case_downloader/static/react/`.

2. **Run E2E tests**:
   ```bash
   python3 -m pytest tests/e2e/react/ --timeout=60 -q
   ```
   This auto-launches a Flask fixture server with 10 seed cases and runs all 231 Playwright tests.

3. **Report results**:
   - Build: success or failure (with error output)
   - Tests: total passed / failed / skipped
   - If any failures: show the first failure's test name and assertion error

## When to Use

- After modifying any frontend component, page, hook, or CSS
- After changing API endpoints in `web/routes/api.py`
- Before committing frontend changes
- After theme or design token changes
