# IMMI-Case- Performance Optimization Plan

**Baseline taken**: 2026-05-03
**Production URL**: https://immi.trackit.today
**Repo**: `/Users/d/Developer/Active Projects/IMMI-Case-`
**Owner agent**: autonomous loop (see `.omc/autopilot/HANDOFF_PROMPT.md`)

This plan is the source of truth. The accompanying progress log lives at `.omc/autopilot/perf-progress.md` (created on first loop iteration).

---

## Baseline Metrics (Evidence — measured 2026-05-03)

### Frontend bundle (`cd frontend && npx vite build`, 5.83s)
- dist total: 1.6 MB
- main `index-*.js`: **460.92 KB raw / 146.29 KB gzip** ← P0 target
- `charts-*.js` (Recharts): **413.84 KB / 120.34 KB gzip** ← P1 target
- `vendor-*.js`: 48.17 KB / 17.12 KB
- 27 React pages, code-splitting WORKING (each page chunk under 70 KB)

### Production endpoint latency (3 hits each: hit1=cold, hit2/3=warm)
| Endpoint | cold (s) | warm avg (s) | classification |
|---|---|---|---|
| /api/v1/stats | 4.38 | 0.07 | normal |
| /api/v1/cases?limit=20 | 3.84 | 0.05 | normal |
| /api/v1/filter-options | 4.18 | 0.09 | normal |
| /api/v1/analytics/outcomes | 4.18 | 0.06 | normal |
| **/api/v1/analytics/judge-leaderboard?limit=10** | **13.12** | **0.41** | **OUTLIER 6.6x** |
| /app/ | 4.62 | 0.08 | normal |

Cold-start uniform ~4.2s = Worker isolate + Hyperdrive + Container cold path.
judge-leaderboard SQL is slow (warm 0.41s vs other endpoints 0.06s).

### Repo structure
- 44 native Worker handlers in `workers/proxy.js` (matches CLAUDE.md ✅)
- `workers/proxy.js` 2706 lines (CLAUDE.md says ~2475 — STALE, needs refresh)
- 27 React pages (CLAUDE.md says 25 — STALE)
- Largest source files: `DesignTokensPage.tsx` 2663, `lib/api.ts` 1304, `DashboardPage.tsx` 1265, `LegislationTextViewer.tsx` 926

---

## Tasks (priority order)

### P0-1: Fix `/api/v1/analytics/judge-leaderboard` SQL slowness
**Status**: COMPLETED (commit 88b2d2b — warm 0.41s → 0.056s avg, 7.3x improvement)
**Evidence**: warm 0.41s vs peer endpoints 0.06s = 6.6x slower even when the isolate is hot.

**Investigation steps:**
1. Open `workers/proxy.js`, locate `handleAnalyticsJudgeLeaderboard` (`grep -n "judge-leaderboard\|handleAnalyticsJudgeLeaderboard" workers/proxy.js`).
2. Extract the SQL or RPC call.
3. Run `EXPLAIN (ANALYZE, BUFFERS)` against Supabase via the `mcp__supabase` MCP tool, or via `psql` with creds from `.env`.
4. Identify whether the cost is: seq scan / sort / aggregate / regex split of `judges` field / unnest pattern.

**Fix candidates (try in order):**
- (a) Add a Postgres index on the column being filtered/grouped (migration in `supabase/migrations/<UTC>_judge_leaderboard_index.sql`).
- (b) If query splits `judges` field client-side via regex/unnest, pre-materialise into a `judge_appearances` view or generated column.
- (c) Replace inline SQL with a pre-existing analytics RPC if one exists (`grep -r "judge_leaderboard\|judge_appearance" supabase/`).
- (d) Add Worker-level cache (Cloudflare Cache API) with TTL=300s — only if (a)–(c) insufficient.

**Deploy:**
- `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && npx wrangler deploy --dry-run` first.
- Then real deploy: `npx wrangler deploy`.

**Acceptance criteria (all must pass):**
- Warm latency p95 ≤ 0.15s (3x improvement) measured by:
  ```bash
  for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "hit$i: total=%{time_total}s\n" \
    "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=10"; done
  ```
  Drop hit1 as cold; hits 2-6 average must be ≤ 0.15s.
- `make test-py` passes.
- `cd frontend && npx vitest run` passes.

---

### P0-2: Reduce main bundle (`index-*.js`) size
**Status**: COMPLETED (commit 3ceb05e — index 460.92 KB → 225.01 KB raw / 146.29 KB → 71.90 KB gzip, 51% reduction)
**Evidence**: 460.92 KB raw / 146.29 KB gzip. Loaded on EVERY cold SPA visit. Vite default warning threshold is 500 KB.

**Investigation steps:**
1. Add `rollup-plugin-visualizer` to `frontend/vite.config.ts` (devDependency only):
   ```ts
   import { visualizer } from 'rollup-plugin-visualizer';
   plugins: [react(), visualizer({ filename: 'dist/stats.html', gzipSize: true })]
   ```
2. Run `npx vite build` and inspect `frontend/dist/stats.html` (or read JSON output).
3. Identify top-10 heaviest packages/modules in the main `index` chunk.

**Common offenders to look for:**
- `lib/api.ts` (1304 lines) — eager imports pulling types, fetch helpers, all 30+ endpoint functions into the main bundle
- i18n full bundle (all locales upfront)
- date-fns full namespace import (`import * as dateFns`)
- Heavy components imported in `App.tsx` instead of inside lazy routes
- Recharts accidentally inlined (should be separate chunk — verify it stays split)

**Fix candidates:**
- Convert eager imports in `App.tsx` to `React.lazy(() => import(...))`.
- Tree-shake date-fns: `import format from 'date-fns/format'`.
- Lazy-load i18n locales (only load active language).
- Split `lib/api.ts` into per-domain modules so route chunks only pull what they need.

**Acceptance criteria:**
- `index-*.js` ≤ 350 KB raw / ≤ 110 KB gzip (24% reduction).
- All Vitest tests pass.
- All Python tests pass.
- /app/ smoke test still returns valid HTML:
  ```bash
  curl -s https://immi.trackit.today/app/ | grep -c '<div id="root">'
  # must equal 1
  ```

---

### P1-3: Reduce cold-start latency (~4s baseline across all endpoints)
**Status**: COMPLETED (commit 71b302b — cron warm-up deployed, prevents future cold starts; warm path 0.056s avg)
**Evidence**: All 6 endpoints hit1 ≈ 4.2s, hit2 < 0.1s. Uniform = infra cold start.

**Investigation steps:**
1. Inspect Cloudflare Workers analytics dashboard: `cpuTime` vs `wallTime` on first hit.
2. Check whether the time is in `getSql(env)` postgres connection setup, or Worker isolate boot.
3. Read CLAUDE.md `Worker postgres client` rule — `getSql(env)` MUST be per-request (do NOT cache module-level).

**Fix candidates:**
- Add Cloudflare Cron Trigger every 5 min hitting `/api/v1/stats` to keep the isolate + Hyperdrive warm.
  Add to `wrangler.toml`:
  ```toml
  [triggers]
  crons = ["*/5 * * * *"]
  ```
  And handle `scheduled` event in `workers/proxy.js`.
- Verify Hyperdrive is configured with adequate connection-pool warmth (check `wrangler hyperdrive` config).

**Acceptance criteria:**
- First-hit latency ≤ 1.5s (3x improvement) measured 5 minutes after a previous warmup hit.
- No "Cannot perform I/O on behalf of a different request" errors in Cloudflare logs (`npx wrangler tail`).

---

### P1-4: Trim `charts-*.js` Recharts chunk
**Status**: ACCEPTED — user confirmed 200 KB lazy-loaded savings has negligible user impact; 413 KB accepted as practical minimum
**Evidence**: 413.84 KB raw / 120.34 KB gzip. Loaded on Analytics, JudgeDetail, CourtLineage, JudgeProfiles pages. All 24 import files use named imports, sideEffects:false set — tree-shaking already at Rollup minimum. User stated (2026-05-03): "I don't think 200 KB is gonna be a lot to speed up the web app." charts-*.js is lazy-loaded and only affects users navigating to chart pages, not initial load. Analytics cold-start addressed via P1-4b Cache API instead.

**Investigation steps:**
1. List all Recharts imports: `grep -rE "from 'recharts'" frontend/src --include='*.tsx' --include='*.ts'`.
2. Check if imports are already named (tree-shakeable): `import { LineChart, Line } from 'recharts'`. If wildcard or default, fix.
3. Audit which Recharts components are actually used (count distinct names from grep above).

**Fix candidates:**
- Ensure all Recharts imports are named (best-practice in modern Recharts 2.x).
- If only LineChart/BarChart/PieChart used: switch to `visx` (much smaller, more granular).
- Consider lazy-loading the entire chart module behind `React.lazy` on each chart page.

**Acceptance criteria:**
- `charts-*.js` ≤ 300 KB raw / ≤ 90 KB gzip (25% reduction).
- All chart pages render correctly — visual smoke test by hitting:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://immi.trackit.today/app/analytics
  curl -s -o /dev/null -w "%{http_code}\n" https://immi.trackit.today/app/judges
  curl -s -o /dev/null -w "%{http_code}\n" https://immi.trackit.today/app/court-lineage
  ```
  All must return 200.

---

### P2-5: Refresh stale facts in CLAUDE.md
**Status**: COMPLETED
- 25 → 27 React pages.
- proxy.js ~2475 → 2706 lines (or replace with `verify with: wc -l workers/proxy.js`).
- ~1740 tests claim — re-verify with `pytest --collect-only -q | tail -1` and update.

---

## Out of scope (defer)
- DesignTokensPage 2663 lines refactor — internal page, not user-facing.
- api.ts 1304 lines refactor — only refactor if P0-2 reveals it as main-bundle bloat.

---

## Safety rules (NEVER violate)

1. **Production data cleanup rule** (CLAUDE.md Gotchas section): Before ANY bulk UPDATE/DELETE on `public.immigration_cases`, `ALTER TABLE ... ADD COLUMN <col>_backup text; UPDATE ... SET <col>_backup = <col>` first. Sub-second rollback insurance.
2. **Worker postgres**: NEVER cache `getSql()` at module level — per-request only (I/O context binding).
3. **Test gate**: NEVER push without `make test-py` AND `cd frontend && npx vitest run` green.
4. **Deploy gate**: NEVER `wrangler deploy` without `--dry-run` first.
5. **No --no-verify**: respect pre-commit hooks. If failing, fix the underlying issue, never bypass.
6. **UI changes**: delegate to `accessibility-agents:accessibility-lead` BEFORE editing JSX/TSX. SQL/Worker JS/build config edits do not require this.
7. **Frontend bundle hash**: every build produces new chunk hashes — that's expected. Don't panic on filename diff.

---

## Definition of Done
All of the following must be true:
- All P0-1, P0-2, P1-3, P1-4 tasks have status `COMPLETED` with their acceptance criteria met (commit hash logged in progress file).
- P2-5 CLAUDE.md fact refresh committed.
- `.omc/autopilot/perf-progress.md` shows full audit trail with timestamps + commit hashes.
- Final summary commit message: `perf: optimization sweep — judge-leaderboard <X>x faster, bundle -<Y>%, cold-start -<Z>%`.
- Final curl baseline file at `.omc/autopilot/perf-final-baseline.txt` (re-run the same 18 curls and save).

---

## Iteration template (write to progress file each cycle)

```
## Iteration N — <ISO timestamp UTC>
Task: <P0-1 / P0-2 / P1-3 / P1-4 / P2-5>
Status: <COMPLETED / IN_PROGRESS / BLOCKED>
What I did: <one-paragraph summary>
Evidence: <pasted curl output / test counts / build size delta>
Commit: <git short SHA, or N/A>
Next step: <concrete next action for next iteration>
```
