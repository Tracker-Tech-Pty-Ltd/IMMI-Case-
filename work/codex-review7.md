Reading additional input from stdin...
OpenAI Codex v0.153.4
--------
workdir: /Volumes/Storm Breaker/Developer/IMMI-Case-
model: gpt-5.6-terra
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: auto
session id: 01a08c48-694e-7e43-a34a-cad819687267
--------
user
Verify ONLY commit be5a17e (git show be5a17e) against these three review-6 findings. Read files at HEAD but do not modify anything, do not run builds/tests, do not touch the network, do not load skills/plugins/MCP.

Findings to verify: (5) docs/ops/aggregate-rebuild-cost-guard.md listed rebuild_dirty_since twice with a stale reset-on-every-rebuild claim, claimed 'four internal keys' while workers/storage/cloudflare.js AGGREGATE_BOOKKEEPING_KEYS lists seven, and still promised '<= 5 minutes' dashboard freshness that the quiet window plus 6h staleness bound does not guarantee; (6) workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js BOOKKEEPING_KEYS was missing rebuild_last_attempt_at so it did not prove every bookkeeping row survives the rebuild DELETE; plus .claude/STATE.md repeating the stale 'reset by every rebuild' / 'one row' claims and old counts.

Check that every one of those is now consistent with the implementation, and that the DELETE in rebuildAggregates keeps exactly the keys the test now asserts. Report residual risk with file:line evidence, then end with the verdict on your LAST line exactly as one of:
VERDICT: APPROVE
VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T17:05:51.625178Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T17:05:51.953761Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T17:05:53.443713Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T17:05:53.728226Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
codex
我會僅以唯讀方式檢查 `be5a17e` 的 diff 與 HEAD 檔案，逐項對照文件、測試及 `rebuildAggregates` 的刪除保留規則；不會載入 skill、外掛或 MCP，也不會執行測試、建置或網路操作。
exec
/bin/zsh -lc "git status --short --branch && git show --no-ext-diff --format=fuller --stat --oneline be5a17e && git show --no-ext-diff --format= --unified=100 be5a17e -- docs/ops/aggregate-rebuild-cost-guard.md workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js .claude/STATE.md workers/storage/cloudflare.js && printf '\\n--- HEAD targeted locations ---\\n' && rg -n -C 8 \"AGGREGATE_BOOKKEEPING_KEYS|rebuildAggregates|rebuild_dirty_since|rebuild_last_attempt_at|dashboard freshness|five minutes|5 minutes|one row|four internal keys|BOOKKEEPING_KEYS\" docs/ops/aggregate-rebuild-cost-guard.md workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js .claude/STATE.md workers/storage/cloudflare.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
hook: PostToolUse
 succeeded in 4909ms:
2026-09-11 03:06:05.833 xcodebuild[32952:137244404]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:06.066 xcodebuild[32952:137244403] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7ShASd12' (errno=Operation not permitted)
2026-09-11 03:06:06.506 xcodebuild[32965:137244502]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:06.634 xcodebuild[32965:137244499] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## fix/aggregate-rebuild-debounce...origin/fix/aggregate-rebuild-debounce
?? work/
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-teuJwMmV' (errno=Operation not permitted)
2026-09-11 03:06:07.568 xcodebuild[32972:137244569]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:07.691 xcodebuild[32972:137244568] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-4uoXYbfg' (errno=Operation not permitted)
2026-09-11 03:06:08.071 xcodebuild[32977:137244597]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:08.194 xcodebuild[32977:137244596] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
be5a17e docs(cloudflare): fix the bookkeeping-key contradictions flagged by review 6
 .claude/STATE.md                                             | 12 ++++++------
 docs/ops/aggregate-rebuild-cost-guard.md                     |  5 ++---
 workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js |  2 +-
 3 files changed, 9 insertions(+), 10 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-15WulypO' (errno=Operation not permitted)
2026-09-11 03:06:09.070 xcodebuild[32984:137244670]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:09.193 xcodebuild[32984:137244653] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-w5nuCytQ' (errno=Operation not permitted)
2026-09-11 03:06:09.568 xcodebuild[32987:137244688]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:09.693 xcodebuild[32987:137244687] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/.claude/STATE.md b/.claude/STATE.md
index 9d45f21..bed97ce 100644
--- a/.claude/STATE.md
+++ b/.claude/STATE.md
@@ -1,156 +1,156 @@
 # IMMI-Case Worktree Closeout State
 
 Updated: 2026-09-10 Australia/Melbourne
 
 ## 2026-09-10 Aggregate Rebuild Cost Guard — DONE ✓
 
 ### Review 5 fixes (2026-09-11)
 
 - HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
   landing mid-scan reset the clock and the staleness bound became unreachable
   under continuous writes. The disarm is now a conditional UPDATE that only
   fires when the rebuild applied the generation it observed.
 - MED: `markAggregatesDirty()` writes its three control rows in one atomic
   `db.batch()`, and the mutation timestamp is monotonic (`MAX`), so isolates
   with skewed clocks cannot rewind the quiet window.
 - MED: the staleness bound is evaluated before the interval debounce, so a
   freshly stamped failed attempt cannot postpone overdue work.
 - LOW: failures emit a structured `cloudflare.aggregate_rebuild_failed` event.
 - LOW: docs state the real control-row counts and per-import cost.
 
 ### Follow-up: quiet window (2026-09-11)
 - The interval alone still cost ~$28 per 153k-case import (one rebuild per
   5-minute interval for four hours). The rebuild now waits for a quiet window:
   `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) of no mutations, so an import
   collapses into **one rebuild (~$0.58)**; `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
   (default 21600) bounds staleness when mutations never pause.
-- New bookkeeping keys `rebuild_last_mutation_at` (refreshed by every mutation)
-  and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
+  and `rebuild_dirty_since` (armed only on the clean→dirty edge, disarmed only by a
+  rebuild that applied the generation it observed) support the window and the bound.
   rebuild) support the window and the bound.
-- Validation: Worker Vitest 27 files / **388 tests**; real-SQLite harness
-  **24/24** (including "staleness clock arms on the first mutation only" and
+- Validation: Worker Vitest 27 files / **390 tests**; real-SQLite harness **27/27** (including "a mid-scan mutation keeps the staleness clock armed" and
+  "rebuild with nothing new disarms the staleness clock"); bundle closure passes; gate unchanged.
   "rebuild disarms the staleness clock"); bundle closure passes; gate unchanged.
 
 ### Symptom
 - `immi-catalog` D1 wrote 12,084,578,591 rows (99.77% of the account's analytical
   writes) across 2026-08-23 → 2026-09-01: 12.06B billable rows ≈ **$12,060** of
   D1 rows-written charges. The budget-alert email fired once (2026-08-25 23:55
   local, quoting $5,190.94) and further spend produced no new notice.
 
 ### Root cause
 - `handleCaseMutationQueue()` rebuilt aggregates **once per queue batch**; one
   rebuild clears and rewrites 17 summary/filter tables (~584k written rows,
   ~$0.58 at $1/million). With `max_batch_size = 20`, a 153k-case import is
   ~7,700 batches ≈ 4.5B written rows, and the corpus was re-pushed several times.
 - Query insights: the top three `INSERT ... SELECT` statements alone account for
   6.68B written rows across ~24,000 executions.
 
 ### Fix
-- The queue path now records staleness (`markAggregatesDirty()`, one row); the
+- The queue path now records staleness (`markAggregatesDirty()`, three control rows in one atomic batch); the
   new `scheduled()` handler rebuilds at most once per
   `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300 s) driven by the
   `[triggers]` cron `*/5 * * * *`, under a conditional-upsert D1 lease so
   overlapping invocations cannot rewrite the 17 tables at once.
 - Bookkeeping lives in `catalog_summary` under `rebuild_generation` /
   `rebuild_applied_generation` / `rebuild_last_at` / `rebuild_last_attempt_at` /
-  `rebuild_lease_until` / `rebuild_lease_token` (no D1 migration; `getStats()`
+  `rebuild_lease_until` / `rebuild_last_mutation_at` / `rebuild_dirty_since` (no D1 migration; `getStats()`
   still reads only `total_cases`/`with_full_text`).
   "Dirty" is `generation > applied_generation`, so a mutation that lands while a
   rebuild is running stays pending instead of being wiped by the rebuild's own
   bookkeeping write (the boolean-flag race a Codex review flagged as HIGH).
 - A queue-side fallback (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600)
   keeps aggregates fresh if the cron trigger is missing or failing.
 - Lease fencing (second review pass): the winner records a random token, renewal
   and release are token-conditional, and the rebuild renews per 20-statement
   chunk and aborts (`rebuild_lease_lost`) if it lost the lease — so an expired
   holder can neither clobber the new owner nor keep writing. Failed rebuilds are
   throttled via `rebuild_last_attempt_at` (240 tests-worth of behaviour; see
   validation below).
 
 ### Validation
 - Full Worker Vitest: **27 files / 378 tests passed**, including new assertions
   that the queue path never rebuilds, that 20 mutations coalesce into one stale
   flag, that the rebuild statement set is exactly 17 tables + bookkeeping, that
   a mutation arriving after the applied generation stays pending, and that a
   second lease claim loses while the first holds.
 - Review evidence (untracked by repo policy): `work/codex-review.md`,
   `codex-rereview.md`, `codex-review3.md`, `codex-review4.md` + prompts.
 - Real-SQLite harness (`work/verify-rebuild-sql.py`): executes the captured
   rebuild/dirty/decision/lease SQL against `migrations/d1/catalog/0001_catalog.sql`
   (30 tables) — 14/14 checks, including a deterministic replay of the
   mid-rebuild mutation race (generation 6 vs applied 5 → still pending).
 - Codex second-model review, four read-only passes (final pass: **VERDICT:
   APPROVE** at `work/codex-review4.md`, which confirms all four invariants and
   closes every earlier finding). Disposition across passes:
   1. unconditional `dirty = 0` discarded a mid-rebuild mutation → monotonic
      generation; 2. no mutual exclusion → lease; 3. unsafe documented rollback →
      docs forbid it; 4. lease without fencing / torn claim → token in the lease
      row's `updated_at`, single-statement claim, token-conditional renew/release,
      abort on lost lease; 5. failed rebuilds retried unthrottled → attempt stamp.
   Reviewer-named acceptable residual risks: a first-deploy mutation may trigger
   one lease-protected fallback rebuild; a single D1 batch outliving the lease
   aborts that run and converges on the next; a missing cron in the operator
   config degrades to hourly fallback instead of the per-batch cost curve.
 - Native bundle closure passed (`scripts/check_cloudflare_native_bundle.mjs`).
 - `scripts/check_cloudflare_native_target.py` output is unchanged from
   `origin/main` (placeholder-ID gate only).
 
 ### Operator follow-up
 - Regenerate `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64` so the deployed config carries
   the new `[triggers]` block and `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` var;
   without it the cron never fires and aggregates stop updating.
 - Full notes, cost envelope and rollback: `docs/ops/aggregate-rebuild-cost-guard.md`.
 
 ## 2026-08-21 D1 Capacity Migration + Supabase Status — COMPLETE ✓
 
 ### Blocker #2 resolved (in-place external-content FTS5 migration)
 - `immi-catalog` D1: **9.18 GB → 5.53 GB** (−40%), under the 8 GiB gate.
 - Method: in-place migration (not full re-import). VACUUM and single-REBUILD are
   both unsupported in D1 (VACUUM → "cannot VACUUM from within a transaction";
   REBUILD of 150K chunks → "CPU time limit exceeded / reset"), so the migration
   used batched INSERT (5K rows/batch) + FTS5 `ALTER TABLE ... RENAME`.
 - Search verified: `MATCH 'migration'` = 146,548 (identical to pre-migration).
 - Triggers rebuilt with the FTS5 `'delete'` command.
 
 ### Supabase dependency status
 - Production route `immi.trackit.today` → `immi-case-standalone`
   (`workers/cloudflare-native.js`, D1-native; deployed 2026-08-11 v6583ae10).
 - **NOT fully decommissioned yet**: legacy `immi-case` worker (Supabase/Hyperdrive,
   deployed 2026-05-17) is still deployed; legacy code `workers/proxy.js` +
   `workers/db/getSqlAsUser.js` still import `postgres` (~344 Supabase refs) in the repo.
 
 ## 2026-08-11 Codex Review + Fixes — COMPLETE ✓
 
 ### Codex review verdict: BLOCK (not cutover-ready)
 - "現在適合建立 preview/canary，不適合 production cutover"
 - 346K tokens, deep codebase + live-runtime review
 
 ### CRITICAL findings + fixes applied
 | # | Finding | Status |
 |---|---------|--------|
 | 1 | SPA serving missing (`/`,`/app/*` → 503 after cutover; no ASSETS binding) | FIXED: `[assets]` + ASSETS fallback + SPA build step |
 | 2 | Catalog D1 at 9.17 GB (exceeds 8 GiB gate, ~8-15% headroom vs 10 GB cap) | DONE: in-place external-content FTS5 migration (9.18 GB → 5.53 GB) |
 | 3 | No working login (Telegram deferred, bootstrap not UUID, no login route) | FIXED: bootstrap login + UUID admin |
 | 4 | Unprotected paid AI endpoints (run/health?live=true fail-open) | FIXED: auth-gated + rate-limit fail-closed |
 | 5 | Non-reproducible deploy + CI fails (placeholder test) | FIXED: placeholders restored + tests updated |
 
 ### HIGH findings + fixes
 | Finding | Status |
 |---------|--------|
 | requireAuth accepts refresh tokens | FIXED (token-type check) |
 | Vectorize 149,017 (test vector) | FIXED (index recreated clean, re-embedding) |
 | No metadata indexes | FIXED (verified existing + added case_nature_idx) |
 | visa_type/case_nature not in semantic filter | NOT-A-BLOCKER: structured filters via D1 WHERE (normal filter is better); Vectorize not needed |
 | Cutover workflow circular dependency | DEFERRED (activation workflow redesign) |
 
 ### Fixes implemented
 - `workers/auth/request_auth.js`: requireAuth rejects `type:refresh` tokens (401 refresh_token_used_as_access)
 - `workers/auth/cloudflare_handlers.js`: added handleBootstrapLogin (BOOTSTRAP_ADMIN_SECRET + BOOTSTRAP_ADMIN_USER_ID env)
 - `workers/cloudflare-native.js`: wired POST /api/v1/auth/bootstrap
 - `workers/llm-council/cloudflare_handlers.js`: auth-gated handleLegacyRun + handleHealth live probe; applyRateLimit fails closed
 - Account D1: bootstrap-admin/tenant replaced with UUIDs (admin 7e6d09e9-..., tenant 4d11f240-...)
 - wrangler.toml + pipeline: real IDs reverted to placeholders (deploy uses temp configs from env)
 - tests: cloudflare-council-handlers env + RL_COUNCIL_TURN mock; test_effective_native_ci postgres assertion fixed
 - D1: added cases_case_nature_idx
 
 ### Operational config (real IDs, temp only, NOT committed)
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
index 4e8e51d..0602692 100644
--- a/docs/ops/aggregate-rebuild-cost-guard.md
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -1,194 +1,193 @@
 # Aggregate rebuild cost guard (2026-09-10)
 
 ## Why this exists
 
 Between 2026-08-23 and 2026-09-01 the `immi-catalog` D1 database wrote
 **12,084,578,591 rows**, of which 12.06B were billable: **$12,060** in D1
 rows-written charges for a single billing cycle, 99.77% of the account total.
 
 The cause was in this Worker, not in the database or the queue configuration:
 
 - `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
   for **every queue batch** that changed anything.
 - `rebuildAggregates()` clears and rewrites **17** summary/filter tables
   (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
   `cases` table — roughly **584,000 written rows** (and ~2.5M rows read) per
   call, about **$0.58** at the published $1.00/million-rows rate.
 - With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
   batches, i.e. ~7,700 full rewrites ≈ **4.5 billion written rows** per import.
   Query insights confirmed the pattern: the top three `INSERT ... SELECT`
   statements alone accounted for 6.68B written rows over ~24,000 executions.
 
 D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
 summary data is charged again on every pass, so "the data set is small" does not
 bound the bill — the number of rebuild passes does.
 
 ## What changed
 
 | File | Change |
 |---|---|
 | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
 | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
 | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
 | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
 | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
 | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
 
 ### Bookkeeping model (why generations, not a boolean)
 
-State lives in `catalog_summary` (`summary_key` is the primary key) under four
+State lives in `catalog_summary` (`summary_key` is the primary key) under seven
 internal keys, none of which reach API responses (`getStats()` reads only
 `total_cases` / `with_full_text`). No D1 migration is required.
 
 | Key | Written by | Meaning |
 |---|---|---|
 | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
 | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
 | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
 | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
 | `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
 | `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
-| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
 | `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
 
 "Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
 would be wrong: a rebuild that starts at generation 5 and takes a minute can be
 interleaved with a mutation, and a plain `dirty = 0` write at the end would
 discard that mutation's pending state and leave the dashboard permanently stale.
 The rebuild therefore snapshots the generation *before* it scans and records that
 value as applied — anything that arrived meanwhile stays pending and the next
 tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
 bookkeeping keys for the same reason.
 
 Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
 upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
 expiry **and rotates the fencing token in the same statement**, so a lease is
 never observable in a torn state (expiry already renewed, token still the
 previous owner's — the flaw a second review pass caught in the first version of
 this fix). `changes === 1` means the caller won; the winner then stamps
 `rebuild_last_attempt_at`.
 
 Fencing matters because a lease can expire while its holder is still working:
 
 - `rebuildAggregates({ lease })` renews the lease (`UPDATE ... WHERE summary_key
   = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
   **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
   its lease cannot keep interleaving its DELETEs with the new owner's.
 - `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
   expired holder can never free (or extend) the new owner's lease. Without a
   token it refuses (`false`) instead of falling back to an unconditional write.
 - The `finally` release is therefore safe even on the abort path.
 
 The attempt timestamp is the second half of the same problem: a rebuild that
 throws releases its lease but never writes `rebuild_last_at`, so throttling on
 success alone would let a retry storm rebuild on every 30-second queue retry.
 `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
 
 ## Cost envelope after the change
 
 | Scenario | Before | After (300 s interval) |
 |---|---|---|
 | One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
 | 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
 | Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
-| Dashboard freshness | per batch | ≤ 5 minutes stale |
+| Dashboard freshness | per batch | a few minutes after the last queued mutation (quiet window 300 s); a sustained multi-hour import may lag up to the staleness bound (6 h) |
 | Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
 
 ### Quiet window (why an import costs cents, not dollars)
 
 The interval alone only bounds *how often* a rebuild may run; during a four-hour
 bulk import it still fires every interval, which is how a fixed version could
 still spend ~$28 on one import. The rebuild therefore waits for a **quiet
 window**: it will not run until mutations have been silent for
 `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
 **one rebuild (~$0.58)** because the pending work accumulates while the import
 runs and is rebuilt once afterwards. A dashboard read during an import therefore
 sees figures from before the import — acceptable, since nobody is reading
 aggregates while bulk data is still landing.
 
 The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
 hours): if mutations never pause, analytics are still refreshed on that cadence
 instead of drifting indefinitely. Lower it if continuous-write periods must stay
 fresher; raise it to make very long imports even cheaper.
 
 Four operator-side knobs:
 
 - `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300) — the cron's own
   debounce. Raising it to 900 cuts a full import to about $10.
 - `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
   queue path only reaches for it when the aggregates stay dirty longer than this
   window, i.e. when the cron trigger is absent or failing. With a working cron
   the last rebuild is always younger than the cron period, so the valve never
   opens.
 - `AGGREGATE_REBUILD_LEASE_SECONDS` (default 900) — how long one invocation owns
   the rebuild before another may take over. It is renewed per chunk while the
   owner is alive, so it only matters if an invocation dies mid-rebuild: the
   longer the lease, the longer a crashed run blocks the next one.
 - `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
   above: no rebuild until mutations have been silent this long.
 - `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
   staleness while mutations never stop.
 
 Removing the cron, lowering the interval towards the cron period, or moving the
 rebuild back into the queue consumer restores the old cost curve.
 
 ## Deploy requirements (operator action)
 
 Step-by-step instructions, exact config block and post-deploy verification live in
 [operator-deploy-checklist.md](operator-deploy-checklist.md).
 
 The production deploy does **not** read this repository's `wrangler.toml`; it
 materialises the operator-supplied configs from
 `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After merging:
 
 1. Regenerate that config secret from `config/wrangler-cloudflare-native.toml.example`
    (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
    stored copy) — without the cron the aggregates fall back to hourly refreshes
    (≈$14/day) instead of every 5 minutes, and the incident's cost guarantee is
    weakened even though dashboards keep working.
 2. Confirm the deployed Worker has the cron trigger:
    `npx wrangler deployments status` / dashboard → Workers → immi-case-standalone
    → Triggers → Cron, next run within 5 minutes.
 3. Run `make test-workers` and `node scripts/check_cloudflare_native_bundle.mjs`
    before the deploy (both pass as of this change).
 
 ## Review record
 
 Four read-only Codex passes reviewed this change. The first three returned
 CHANGES-REQUIRED and produced five findings, all fixed and re-verified; the
 fourth confirmed all four invariants (coalescing, no lost staleness, mutual
 exclusion, bounded recovery) and returned **APPROVE** with no ship blocker.
 The reviewer's named acceptable residual risks:
 
 - On first deploy (no rebuild timestamp yet) the first queue mutation may perform
   one fallback rebuild — one-off and lease-protected.
 - A single D1 batch that outlives the lease makes that run abort on its next
   renewal; the following rebuild converges the data.
 - If the operator config ships without the cron, cost does not return to the
   per-batch curve, but freshness degrades to the hourly fallback.
 
 Review evidence lives in `work/` and is intentionally not committed (this repo
 keeps agent scratch dirs untracked).
 
 ## Verification checklist
 
 - [ ] Cron trigger present and firing every 5 minutes.
 - [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
       shows the rebuild statements running a handful of times per hour, not per batch.
 - [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
 - [ ] After the first mutation following deploy, `rebuild_applied_generation`
       catches up with `rebuild_generation` within one cron period (proves the
       trigger is wired, not just present).
 - [ ] D1 rows written per day returns to a low baseline (monitor with the local
       `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
 - [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
       presence means the cron trigger is not draining the dirty flag.
 - [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
       shows `rebuild_applied_generation` catching up with `rebuild_generation`
       after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
 - [ ] During a bulk import, `rebuild_dirty_since` stays armed and
       `rebuild_applied_generation` does **not** chase it until the import goes
       quiet — that is the quiet window working, not a stalled pipeline.
 - [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
       is normal; constant entries mean rebuilds take longer than the lease.
 - [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
index 6fff8f1..807e50c 100644
--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
@@ -1,112 +1,112 @@
 import { describe, expect, it, vi } from "vitest";
 import { createCloudflareStores } from "../storage/cloudflare.js";
 
 const REBUILD_TABLES = [
   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
 ];
 const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
-  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
+  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_last_mutation_at", "rebuild_dirty_since"];
 
 function d1({ responder = () => [], changes = 1, changesFor } = {}) {
   const prepared = [];
   const binding = {
     prepared,
     prepare(sql) {
       const statement = {
         sql,
         params: [],
         bind(...params) { this.params = params; return this; },
         all: async () => ({ results: responder(sql) }),
         first: async () => responder(sql)[0] ?? null,
         run: async () => ({ meta: { changes: changesFor ? changesFor(sql) : changes } }),
       };
       prepared.push(statement);
       return statement;
     },
     batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
   };
   return binding;
 }
 
 function env(options) {
   const catalog = d1(options);
   return {
     catalog,
     value: {
       IMMI_STORAGE_MODE: "cloudflare",
       IMMI_CATALOG_DB: catalog,
       IMMI_ACCOUNT_DB: d1(),
       IMMI_OPS_DB: d1(),
       IMMI_CONTENT: { put: vi.fn(), head: vi.fn(), get: vi.fn() },
       CASE_VECTORS: { queryById: vi.fn(), query: vi.fn(), upsert: vi.fn() },
       AI: { run: vi.fn() },
     },
   };
 }
 
 /** Build the bookkeeping rows the decision query reads. */
 function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
   const rows = [];
   if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
   if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
   if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
   if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
   if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
   if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
   if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
   if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
   return rows;
 }
 
 const nowSeconds = () => Math.floor(Date.now() / 1000);
 
 describe("Catalog aggregate rebuild guard", () => {
   it("records staleness as a monotonic generation, not a boolean", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.markAggregatesDirty();
 
     // Three control rows committed as one transaction: the generation counter,
     // the mutation timestamp and the staleness clock (armed only when zero).
     expect(catalog.prepared).toHaveLength(3);
     expect(catalog.batch).toHaveBeenCalledTimes(1);
     expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
     const statement = catalog.prepared[0];
     expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
     expect(statement.sql).toMatch(/rebuild_generation/);
     expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
     expect(statement.params).toHaveLength(1);
   });
 
   it("stamps the mutation time and arms the staleness clock", async () => {
     const { catalog, value } = env();
     const before = nowSeconds();
 
     await createCloudflareStores(value).caseStore.markAggregatesDirty();
 
     const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
     const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
     expect(mutation).toBeDefined();
     expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
     expect(dirtySince).toBeDefined();
     // The staleness clock only arms when it is currently zero.
     expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
   });
 
   it("never iterates the corpus when marking dirty", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.markAggregatesDirty();
 
     // The only batch is the three control rows - no aggregate DELETE/INSERT.
     const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
     expect(batched).toHaveLength(3);
     expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
     expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   });

--- HEAD targeted locations ---
docs/ops/aggregate-rebuild-cost-guard.md-3-## Why this exists
docs/ops/aggregate-rebuild-cost-guard.md-4-
docs/ops/aggregate-rebuild-cost-guard.md-5-Between 2026-08-23 and 2026-09-01 the `immi-catalog` D1 database wrote
docs/ops/aggregate-rebuild-cost-guard.md-6-**12,084,578,591 rows**, of which 12.06B were billable: **$12,060** in D1
docs/ops/aggregate-rebuild-cost-guard.md-7-rows-written charges for a single billing cycle, 99.77% of the account total.
docs/ops/aggregate-rebuild-cost-guard.md-8-
docs/ops/aggregate-rebuild-cost-guard.md-9-The cause was in this Worker, not in the database or the queue configuration:
docs/ops/aggregate-rebuild-cost-guard.md-10-
docs/ops/aggregate-rebuild-cost-guard.md:11:- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
docs/ops/aggregate-rebuild-cost-guard.md-12-  for **every queue batch** that changed anything.
docs/ops/aggregate-rebuild-cost-guard.md:13:- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
docs/ops/aggregate-rebuild-cost-guard.md-14-  (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
docs/ops/aggregate-rebuild-cost-guard.md-15-  `cases` table — roughly **584,000 written rows** (and ~2.5M rows read) per
docs/ops/aggregate-rebuild-cost-guard.md-16-  call, about **$0.58** at the published $1.00/million-rows rate.
docs/ops/aggregate-rebuild-cost-guard.md-17-- With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
docs/ops/aggregate-rebuild-cost-guard.md-18-  batches, i.e. ~7,700 full rewrites ≈ **4.5 billion written rows** per import.
docs/ops/aggregate-rebuild-cost-guard.md-19-  Query insights confirmed the pattern: the top three `INSERT ... SELECT`
docs/ops/aggregate-rebuild-cost-guard.md-20-  statements alone accounted for 6.68B written rows over ~24,000 executions.
docs/ops/aggregate-rebuild-cost-guard.md-21-
docs/ops/aggregate-rebuild-cost-guard.md-22-D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
docs/ops/aggregate-rebuild-cost-guard.md-23-summary data is charged again on every pass, so "the data set is small" does not
docs/ops/aggregate-rebuild-cost-guard.md-24-bound the bill — the number of rebuild passes does.
docs/ops/aggregate-rebuild-cost-guard.md-25-
docs/ops/aggregate-rebuild-cost-guard.md-26-## What changed
docs/ops/aggregate-rebuild-cost-guard.md-27-
docs/ops/aggregate-rebuild-cost-guard.md-28-| File | Change |
docs/ops/aggregate-rebuild-cost-guard.md-29-|---|---|
docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
docs/ops/aggregate-rebuild-cost-guard.md-32-| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
docs/ops/aggregate-rebuild-cost-guard.md-33-| `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
docs/ops/aggregate-rebuild-cost-guard.md-34-| `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
docs/ops/aggregate-rebuild-cost-guard.md-35-| `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
docs/ops/aggregate-rebuild-cost-guard.md-36-
docs/ops/aggregate-rebuild-cost-guard.md-37-### Bookkeeping model (why generations, not a boolean)
docs/ops/aggregate-rebuild-cost-guard.md-38-
docs/ops/aggregate-rebuild-cost-guard.md-39-State lives in `catalog_summary` (`summary_key` is the primary key) under seven
docs/ops/aggregate-rebuild-cost-guard.md-40-internal keys, none of which reach API responses (`getStats()` reads only
docs/ops/aggregate-rebuild-cost-guard.md-41-`total_cases` / `with_full_text`). No D1 migration is required.
docs/ops/aggregate-rebuild-cost-guard.md-42-
docs/ops/aggregate-rebuild-cost-guard.md-43-| Key | Written by | Meaning |
docs/ops/aggregate-rebuild-cost-guard.md-44-|---|---|---|
docs/ops/aggregate-rebuild-cost-guard.md-45-| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:46:| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
docs/ops/aggregate-rebuild-cost-guard.md:47:| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
docs/ops/aggregate-rebuild-cost-guard.md:48:| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
docs/ops/aggregate-rebuild-cost-guard.md-49-| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
docs/ops/aggregate-rebuild-cost-guard.md-51-| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
docs/ops/aggregate-rebuild-cost-guard.md-52-
docs/ops/aggregate-rebuild-cost-guard.md-53-"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
docs/ops/aggregate-rebuild-cost-guard.md-54-would be wrong: a rebuild that starts at generation 5 and takes a minute can be
docs/ops/aggregate-rebuild-cost-guard.md-55-interleaved with a mutation, and a plain `dirty = 0` write at the end would
docs/ops/aggregate-rebuild-cost-guard.md-56-discard that mutation's pending state and leave the dashboard permanently stale.
docs/ops/aggregate-rebuild-cost-guard.md-57-The rebuild therefore snapshots the generation *before* it scans and records that
docs/ops/aggregate-rebuild-cost-guard.md-58-value as applied — anything that arrived meanwhile stays pending and the next
--
docs/ops/aggregate-rebuild-cost-guard.md-60-bookkeeping keys for the same reason.
docs/ops/aggregate-rebuild-cost-guard.md-61-
docs/ops/aggregate-rebuild-cost-guard.md-62-Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
docs/ops/aggregate-rebuild-cost-guard.md-63-upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
docs/ops/aggregate-rebuild-cost-guard.md-64-expiry **and rotates the fencing token in the same statement**, so a lease is
docs/ops/aggregate-rebuild-cost-guard.md-65-never observable in a torn state (expiry already renewed, token still the
docs/ops/aggregate-rebuild-cost-guard.md-66-previous owner's — the flaw a second review pass caught in the first version of
docs/ops/aggregate-rebuild-cost-guard.md-67-this fix). `changes === 1` means the caller won; the winner then stamps
docs/ops/aggregate-rebuild-cost-guard.md:68:`rebuild_last_attempt_at`.
docs/ops/aggregate-rebuild-cost-guard.md-69-
docs/ops/aggregate-rebuild-cost-guard.md-70-Fencing matters because a lease can expire while its holder is still working:
docs/ops/aggregate-rebuild-cost-guard.md-71-
docs/ops/aggregate-rebuild-cost-guard.md:72:- `rebuildAggregates({ lease })` renews the lease (`UPDATE ... WHERE summary_key
docs/ops/aggregate-rebuild-cost-guard.md-73-  = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
docs/ops/aggregate-rebuild-cost-guard.md-74-  **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
docs/ops/aggregate-rebuild-cost-guard.md-75-  its lease cannot keep interleaving its DELETEs with the new owner's.
docs/ops/aggregate-rebuild-cost-guard.md-76-- `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
docs/ops/aggregate-rebuild-cost-guard.md-77-  expired holder can never free (or extend) the new owner's lease. Without a
docs/ops/aggregate-rebuild-cost-guard.md-78-  token it refuses (`false`) instead of falling back to an unconditional write.
docs/ops/aggregate-rebuild-cost-guard.md-79-- The `finally` release is therefore safe even on the abort path.
docs/ops/aggregate-rebuild-cost-guard.md-80-
docs/ops/aggregate-rebuild-cost-guard.md-81-The attempt timestamp is the second half of the same problem: a rebuild that
docs/ops/aggregate-rebuild-cost-guard.md-82-throws releases its lease but never writes `rebuild_last_at`, so throttling on
docs/ops/aggregate-rebuild-cost-guard.md-83-success alone would let a retry storm rebuild on every 30-second queue retry.
docs/ops/aggregate-rebuild-cost-guard.md:84:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
docs/ops/aggregate-rebuild-cost-guard.md-85-
docs/ops/aggregate-rebuild-cost-guard.md-86-## Cost envelope after the change
docs/ops/aggregate-rebuild-cost-guard.md-87-
docs/ops/aggregate-rebuild-cost-guard.md-88-| Scenario | Before | After (300 s interval) |
docs/ops/aggregate-rebuild-cost-guard.md-89-|---|---|---|
docs/ops/aggregate-rebuild-cost-guard.md-90-| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
docs/ops/aggregate-rebuild-cost-guard.md-91-| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
docs/ops/aggregate-rebuild-cost-guard.md-92-| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
--
docs/ops/aggregate-rebuild-cost-guard.md-138-
docs/ops/aggregate-rebuild-cost-guard.md-139-The production deploy does **not** read this repository's `wrangler.toml`; it
docs/ops/aggregate-rebuild-cost-guard.md-140-materialises the operator-supplied configs from
docs/ops/aggregate-rebuild-cost-guard.md-141-`IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After merging:
docs/ops/aggregate-rebuild-cost-guard.md-142-
docs/ops/aggregate-rebuild-cost-guard.md-143-1. Regenerate that config secret from `config/wrangler-cloudflare-native.toml.example`
docs/ops/aggregate-rebuild-cost-guard.md-144-   (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
docs/ops/aggregate-rebuild-cost-guard.md-145-   stored copy) — without the cron the aggregates fall back to hourly refreshes
docs/ops/aggregate-rebuild-cost-guard.md:146:   (≈$14/day) instead of every 5 minutes, and the incident's cost guarantee is
docs/ops/aggregate-rebuild-cost-guard.md-147-   weakened even though dashboards keep working.
docs/ops/aggregate-rebuild-cost-guard.md-148-2. Confirm the deployed Worker has the cron trigger:
docs/ops/aggregate-rebuild-cost-guard.md-149-   `npx wrangler deployments status` / dashboard → Workers → immi-case-standalone
docs/ops/aggregate-rebuild-cost-guard.md:150:   → Triggers → Cron, next run within 5 minutes.
docs/ops/aggregate-rebuild-cost-guard.md-151-3. Run `make test-workers` and `node scripts/check_cloudflare_native_bundle.mjs`
docs/ops/aggregate-rebuild-cost-guard.md-152-   before the deploy (both pass as of this change).
docs/ops/aggregate-rebuild-cost-guard.md-153-
docs/ops/aggregate-rebuild-cost-guard.md-154-## Review record
docs/ops/aggregate-rebuild-cost-guard.md-155-
docs/ops/aggregate-rebuild-cost-guard.md-156-Four read-only Codex passes reviewed this change. The first three returned
docs/ops/aggregate-rebuild-cost-guard.md-157-CHANGES-REQUIRED and produced five findings, all fixed and re-verified; the
docs/ops/aggregate-rebuild-cost-guard.md-158-fourth confirmed all four invariants (coalescing, no lost staleness, mutual
--
docs/ops/aggregate-rebuild-cost-guard.md-166-- If the operator config ships without the cron, cost does not return to the
docs/ops/aggregate-rebuild-cost-guard.md-167-  per-batch curve, but freshness degrades to the hourly fallback.
docs/ops/aggregate-rebuild-cost-guard.md-168-
docs/ops/aggregate-rebuild-cost-guard.md-169-Review evidence lives in `work/` and is intentionally not committed (this repo
docs/ops/aggregate-rebuild-cost-guard.md-170-keeps agent scratch dirs untracked).
docs/ops/aggregate-rebuild-cost-guard.md-171-
docs/ops/aggregate-rebuild-cost-guard.md-172-## Verification checklist
docs/ops/aggregate-rebuild-cost-guard.md-173-
docs/ops/aggregate-rebuild-cost-guard.md:174:- [ ] Cron trigger present and firing every 5 minutes.
docs/ops/aggregate-rebuild-cost-guard.md-175-- [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
docs/ops/aggregate-rebuild-cost-guard.md-176-      shows the rebuild statements running a handful of times per hour, not per batch.
docs/ops/aggregate-rebuild-cost-guard.md:177:- [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
docs/ops/aggregate-rebuild-cost-guard.md-178-- [ ] After the first mutation following deploy, `rebuild_applied_generation`
docs/ops/aggregate-rebuild-cost-guard.md-179-      catches up with `rebuild_generation` within one cron period (proves the
docs/ops/aggregate-rebuild-cost-guard.md-180-      trigger is wired, not just present).
docs/ops/aggregate-rebuild-cost-guard.md-181-- [ ] D1 rows written per day returns to a low baseline (monitor with the local
docs/ops/aggregate-rebuild-cost-guard.md-182-      `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
docs/ops/aggregate-rebuild-cost-guard.md-183-- [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
docs/ops/aggregate-rebuild-cost-guard.md-184-      presence means the cron trigger is not draining the dirty flag.
docs/ops/aggregate-rebuild-cost-guard.md-185-- [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
docs/ops/aggregate-rebuild-cost-guard.md-186-      shows `rebuild_applied_generation` catching up with `rebuild_generation`
docs/ops/aggregate-rebuild-cost-guard.md-187-      after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
docs/ops/aggregate-rebuild-cost-guard.md:188:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
docs/ops/aggregate-rebuild-cost-guard.md-189-      `rebuild_applied_generation` does **not** chase it until the import goes
docs/ops/aggregate-rebuild-cost-guard.md-190-      quiet — that is the quiet window working, not a stalled pipeline.
docs/ops/aggregate-rebuild-cost-guard.md-191-- [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
docs/ops/aggregate-rebuild-cost-guard.md-192-      is normal; constant entries mean rebuilds take longer than the lease.
docs/ops/aggregate-rebuild-cost-guard.md:193:- [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
docs/ops/aggregate-rebuild-cost-guard.md-194-      normal operation; a widening gap means rebuilds are failing and being
docs/ops/aggregate-rebuild-cost-guard.md-195-      retried (check Worker logs for `aggregate_rebuild_lease_release_error`
docs/ops/aggregate-rebuild-cost-guard.md-196-      and for the underlying D1 error).
docs/ops/aggregate-rebuild-cost-guard.md-197-
docs/ops/aggregate-rebuild-cost-guard.md-198-## Rollback
docs/ops/aggregate-rebuild-cost-guard.md-199-
docs/ops/aggregate-rebuild-cost-guard.md-200-**Do not restore the per-batch rebuild.** That is the incident mechanism, and
docs/ops/aggregate-rebuild-cost-guard.md-201-reverting to it re-creates the ~$12,060 cost curve within a single import.
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-3-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-4-const REBUILD_TABLES = [
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-5-  "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-6-  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-7-  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-8-  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-9-  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-10-];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:12:  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_last_mutation_at", "rebuild_dirty_since"];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-13-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-14-function d1({ responder = () => [], changes = 1, changesFor } = {}) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-15-  const prepared = [];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-16-  const binding = {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-17-    prepared,
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-18-    prepare(sql) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-19-      const statement = {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-20-        sql,
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-49-}
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-50-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-51-/** Build the bookkeeping rows the decision query reads. */
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-52-function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-53-  const rows = [];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-54-  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-55-  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-56-  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:57:  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-58-  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-59-  if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-60-  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:61:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-62-  return rows;
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-63-}
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-64-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-65-const nowSeconds = () => Math.floor(Date.now() / 1000);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-66-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-67-describe("Catalog aggregate rebuild guard", () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-68-  it("records staleness as a monotonic generation, not a boolean", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-69-    const { catalog, value } = env();
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-85-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-86-  it("stamps the mutation time and arms the staleness clock", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-87-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-88-    const before = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-89-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-90-    await createCloudflareStores(value).caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-91-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-92-    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-94-    expect(mutation).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-95-    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-96-    expect(dirtySince).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-97-    // The staleness clock only arms when it is currently zero.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-98-    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-99-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-100-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-101-  it("never iterates the corpus when marking dirty", async () => {
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-257-    expect(first.token).not.toBe(second.token);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-258-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-259-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-260-  it("stamps the attempt time when the lease is taken", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-261-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-262-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-263-    const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-264-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:265:    const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-266-    expect(attempt).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-267-    expect(Number(attempt.params[0])).toBeLessThanOrEqual(nowSeconds());
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-268-    // Two statements only: the lease itself (expiry + token) and the attempt
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-269-    // stamp. There is no third write that could leave the token out of sync.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-270-    expect(catalog.prepared).toHaveLength(2);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-271-    expect(catalog.prepared[0].params[1]).toBe(lease.token);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-272-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-273-
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-313-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-314-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-315-  it("aborts the rebuild when the lease is lost mid-run", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-316-    // The renewal update matches no row, so this invocation no longer owns the
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-317-    // lease and must stop instead of interleaving its DELETEs with the new owner.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-318-    const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-319-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-320-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:321:    await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-322-      .rejects.toThrow(/lease lost/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-323-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-324-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-325-  it("does not consult the lease when the rebuild runs without one", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-326-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-327-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-328-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:329:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-330-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-331-    // The only UPDATE is the conditional dirty_since disarm, never a lease renewal.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-332-    const updates = catalog.prepared.filter((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:333:    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-334-    expect(updates.some((s) => s.sql.includes("'rebuild_lease_until'"))).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-335-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-336-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-337-  it("throttles a retry after a failed rebuild", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-338-    // A failed rebuild releases its lease without stamping rebuild_last_at, so
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-339-    // the decision must also consider the attempt stamp.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-340-    const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-341-    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-345-    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-346-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-347-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-348-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-349-  it("clears and rewrites exactly the documented summary tables", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-350-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-351-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-352-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:353:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-354-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-355-    const deleted = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-356-      .filter((s) => /^DELETE FROM /.test(s.sql))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-357-      .map((s) => s.sql.replace("DELETE FROM ", "").split(" ")[0]);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-358-    expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-359-    // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-360-    // + 3 bookkeeping statements (applied generation, last rebuild, conditional
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-361-    // dirty_since disarm).
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-362-    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-363-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-364-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-365-  it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-366-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-367-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-368-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:369:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-370-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-371-    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-372-    expect(summaryDelete).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-373-    expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:374:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-375-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-376-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-377-  it("records the generation observed before the scan, not a bare clean flag", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-378-    const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-379-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-380-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-381-    const before = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:382:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-383-    const after = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-384-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-385-    const applied = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-386-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-387-    const stamp = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-388-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-389-    const resetDirtySince = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-390-      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-391-    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-392-    expect(Number(applied.params[0])).toBe(7);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-393-    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-394-    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-395-    // The disarm is conditional on no mutation arriving mid-scan, so continuous
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-396-    // writes can never reset the staleness clock on every rebuild.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-397-    expect(resetDirtySince).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:398:    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-399-    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-400-    expect(Number(resetDirtySince.params[1])).toBe(7);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-401-    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-402-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-403-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-404-  it("batches the rebuild statements in bounded chunks", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-405-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-406-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-407-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:408:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-409-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-410-    for (const call of catalog.batch.mock.calls) expect(call[0].length).toBeLessThanOrEqual(20);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-411-    expect(catalog.batch.mock.calls.length).toBeGreaterThan(1);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-412-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-413-});
--
.claude/STATE.md-1-# IMMI-Case Worktree Closeout State
.claude/STATE.md-2-
.claude/STATE.md-3-Updated: 2026-09-10 Australia/Melbourne
.claude/STATE.md-4-
.claude/STATE.md-5-## 2026-09-10 Aggregate Rebuild Cost Guard — DONE ✓
.claude/STATE.md-6-
.claude/STATE.md-7-### Review 5 fixes (2026-09-11)
.claude/STATE.md-8-
.claude/STATE.md:9:- HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
.claude/STATE.md-10-  landing mid-scan reset the clock and the staleness bound became unreachable
.claude/STATE.md-11-  under continuous writes. The disarm is now a conditional UPDATE that only
.claude/STATE.md-12-  fires when the rebuild applied the generation it observed.
.claude/STATE.md-13-- MED: `markAggregatesDirty()` writes its three control rows in one atomic
.claude/STATE.md-14-  `db.batch()`, and the mutation timestamp is monotonic (`MAX`), so isolates
.claude/STATE.md-15-  with skewed clocks cannot rewind the quiet window.
.claude/STATE.md-16-- MED: the staleness bound is evaluated before the interval debounce, so a
.claude/STATE.md-17-  freshly stamped failed attempt cannot postpone overdue work.
--
.claude/STATE.md-19-- LOW: docs state the real control-row counts and per-import cost.
.claude/STATE.md-20-
.claude/STATE.md-21-### Follow-up: quiet window (2026-09-11)
.claude/STATE.md-22-- The interval alone still cost ~$28 per 153k-case import (one rebuild per
.claude/STATE.md-23-  5-minute interval for four hours). The rebuild now waits for a quiet window:
.claude/STATE.md-24-  `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) of no mutations, so an import
.claude/STATE.md-25-  collapses into **one rebuild (~$0.58)**; `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
.claude/STATE.md-26-  (default 21600) bounds staleness when mutations never pause.
.claude/STATE.md:27:  and `rebuild_dirty_since` (armed only on the clean→dirty edge, disarmed only by a
.claude/STATE.md-28-  rebuild that applied the generation it observed) support the window and the bound.
.claude/STATE.md-29-  rebuild) support the window and the bound.
.claude/STATE.md-30-- Validation: Worker Vitest 27 files / **390 tests**; real-SQLite harness **27/27** (including "a mid-scan mutation keeps the staleness clock armed" and
.claude/STATE.md-31-  "rebuild with nothing new disarms the staleness clock"); bundle closure passes; gate unchanged.
.claude/STATE.md-32-  "rebuild disarms the staleness clock"); bundle closure passes; gate unchanged.
.claude/STATE.md-33-
.claude/STATE.md-34-### Symptom
.claude/STATE.md-35-- `immi-catalog` D1 wrote 12,084,578,591 rows (99.77% of the account's analytical
--
.claude/STATE.md-47-
.claude/STATE.md-48-### Fix
.claude/STATE.md-49-- The queue path now records staleness (`markAggregatesDirty()`, three control rows in one atomic batch); the
.claude/STATE.md-50-  new `scheduled()` handler rebuilds at most once per
.claude/STATE.md-51-  `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300 s) driven by the
.claude/STATE.md-52-  `[triggers]` cron `*/5 * * * *`, under a conditional-upsert D1 lease so
.claude/STATE.md-53-  overlapping invocations cannot rewrite the 17 tables at once.
.claude/STATE.md-54-- Bookkeeping lives in `catalog_summary` under `rebuild_generation` /
.claude/STATE.md:55:  `rebuild_applied_generation` / `rebuild_last_at` / `rebuild_last_attempt_at` /
.claude/STATE.md:56:  `rebuild_lease_until` / `rebuild_last_mutation_at` / `rebuild_dirty_since` (no D1 migration; `getStats()`
.claude/STATE.md-57-  still reads only `total_cases`/`with_full_text`).
.claude/STATE.md-58-  "Dirty" is `generation > applied_generation`, so a mutation that lands while a
.claude/STATE.md-59-  rebuild is running stays pending instead of being wiped by the rebuild's own
.claude/STATE.md-60-  bookkeeping write (the boolean-flag race a Codex review flagged as HIGH).
.claude/STATE.md-61-- A queue-side fallback (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600)
.claude/STATE.md-62-  keeps aggregates fresh if the cron trigger is missing or failing.
.claude/STATE.md-63-- Lease fencing (second review pass): the winner records a random token, renewal
.claude/STATE.md-64-  and release are token-conditional, and the rebuild renews per 20-statement
.claude/STATE.md-65-  chunk and aborts (`rebuild_lease_lost`) if it lost the lease — so an expired
.claude/STATE.md-66-  holder can neither clobber the new owner nor keep writing. Failed rebuilds are
.claude/STATE.md:67:  throttled via `rebuild_last_attempt_at` (240 tests-worth of behaviour; see
.claude/STATE.md-68-  validation below).
.claude/STATE.md-69-
.claude/STATE.md-70-### Validation
.claude/STATE.md-71-- Full Worker Vitest: **27 files / 378 tests passed**, including new assertions
.claude/STATE.md-72-  that the queue path never rebuilds, that 20 mutations coalesce into one stale
.claude/STATE.md-73-  flag, that the rebuild statement set is exactly 17 tables + bookkeeping, that
.claude/STATE.md-74-  a mutation arriving after the applied generation stays pending, and that a
.claude/STATE.md-75-  second lease claim loses while the first holds.
--
workers/storage/cloudflare.js-45-
workers/storage/cloudflare.js-46-function rows(result) {
workers/storage/cloudflare.js-47-  return Array.isArray(result?.results) ? result.results : [];
workers/storage/cloudflare.js-48-}
workers/storage/cloudflare.js-49-
workers/storage/cloudflare.js-50-// catalog_summary doubles as the aggregate-rebuild control table. Its
workers/storage/cloudflare.js-51-// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
workers/storage/cloudflare.js-52-// mid-rebuild still leaves a pending generation behind.
workers/storage/cloudflare.js:53:const AGGREGATE_BOOKKEEPING_KEYS = [
workers/storage/cloudflare.js-54-  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/storage/cloudflare.js:55:  "rebuild_last_attempt_at", "rebuild_lease_until",
workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
workers/storage/cloudflare.js-57-];
workers/storage/cloudflare.js-58-
workers/storage/cloudflare.js-59-// The rebuild lease keeps its fencing token in the `updated_at` column of the
workers/storage/cloudflare.js-60-// SAME row that holds the expiry, so claiming, renewing and releasing are each
workers/storage/cloudflare.js-61-// a single atomic statement: a token captured in one column and an expiry in
workers/storage/cloudflare.js-62-// another could otherwise be read in a torn state by an expiring holder.
workers/storage/cloudflare.js-63-function leaseToken() {
workers/storage/cloudflare.js-64-  const uuid = globalThis.crypto?.randomUUID?.();
--
workers/storage/cloudflare.js-1007-   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
workers/storage/cloudflare.js-1008-   * the whole `cases` table, so it must never run once per queue batch. Queue
workers/storage/cloudflare.js-1009-   * work only marks the aggregates dirty (markAggregatesDirty) and the
workers/storage/cloudflare.js-1010-   * scheduled handler coalesces those marks into at most one rebuild per
workers/storage/cloudflare.js-1011-   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
workers/storage/cloudflare.js-1012-   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
workers/storage/cloudflare.js-1013-   * $12,060 in D1 write charges.
workers/storage/cloudflare.js-1014-   */
workers/storage/cloudflare.js:1015:  async rebuildAggregates({ lease } = {}) {
workers/storage/cloudflare.js-1016-    const now = utcNow();
workers/storage/cloudflare.js-1017-    // Snapshot the pending generation before scanning: anything that arrives
workers/storage/cloudflare.js-1018-    // while this rebuild runs must stay pending, not be marked applied.
workers/storage/cloudflare.js-1019-    const state = await this.readAggregateState();
workers/storage/cloudflare.js-1020-    const appliedGeneration = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1021:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
workers/storage/cloudflare.js-1022-    const statements = [];
workers/storage/cloudflare.js-1023-    for (const table of [
workers/storage/cloudflare.js-1024-      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
workers/storage/cloudflare.js-1025-      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
workers/storage/cloudflare.js-1026-      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/storage/cloudflare.js-1027-      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
workers/storage/cloudflare.js-1028-      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
workers/storage/cloudflare.js-1029-    ]) {
--
workers/storage/cloudflare.js-1104-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js-1105-        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
workers/storage/cloudflare.js-1106-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js-1107-        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
workers/storage/cloudflare.js-1108-      // Only disarm the staleness clock when nothing arrived while this rebuild
workers/storage/cloudflare.js-1109-      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
workers/storage/cloudflare.js-1110-      // the staleness bound stays reachable under continuous writes.
workers/storage/cloudflare.js-1111-      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
workers/storage/cloudflare.js:1112:         WHERE summary_key = 'rebuild_dirty_since'
workers/storage/cloudflare.js-1113-           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
workers/storage/cloudflare.js-1114-        .bind(now, appliedGeneration),
workers/storage/cloudflare.js-1115-    );
workers/storage/cloudflare.js-1116-    for (let offset = 0; offset < statements.length; offset += 20) {
workers/storage/cloudflare.js-1117-      // While we still own the lease, extend it before each chunk; if another
workers/storage/cloudflare.js-1118-      // invocation took over (this run outlived its lease), abort instead of
workers/storage/cloudflare.js-1119-      // interleaving DELETEs with it. At most one chunk can overlap.
workers/storage/cloudflare.js-1120-      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
--
workers/storage/cloudflare.js-1123-        });
workers/storage/cloudflare.js-1124-      }
workers/storage/cloudflare.js-1125-      await this.db.batch(statements.slice(offset, offset + 20));
workers/storage/cloudflare.js-1126-    }
workers/storage/cloudflare.js-1127-    return { rebuilt_at: now, applied_generation: appliedGeneration };
workers/storage/cloudflare.js-1128-  }
workers/storage/cloudflare.js-1129-
workers/storage/cloudflare.js-1130-  /**
workers/storage/cloudflare.js:1131:   * Mark analytics as stale without paying for a rebuild: one row written per
workers/storage/cloudflare.js-1132-   * queue batch instead of clearing and rewriting 17 tables.
workers/storage/cloudflare.js-1133-   *
workers/storage/cloudflare.js-1134-   * A monotonic generation, not a boolean: a rebuild applies the generation it
workers/storage/cloudflare.js-1135-   * observed when it started, so a mutation landing mid-rebuild stays pending
workers/storage/cloudflare.js-1136-   * instead of being wiped by the rebuild's own bookkeeping write.
workers/storage/cloudflare.js-1137-   */
workers/storage/cloudflare.js-1138-  async markAggregatesDirty() {
workers/storage/cloudflare.js-1139-    const now = Math.floor(Date.now() / 1000);
--
workers/storage/cloudflare.js-1150-      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js-1151-          VALUES ('rebuild_last_mutation_at', ?, ?)
workers/storage/cloudflare.js-1152-        ON CONFLICT(summary_key) DO UPDATE SET
workers/storage/cloudflare.js-1153-          value_int = MAX(catalog_summary.value_int, excluded.value_int), updated_at = excluded.updated_at`)
workers/storage/cloudflare.js-1154-        .bind(now, stamp),
workers/storage/cloudflare.js-1155-      // When the pending work first appeared: bounds how stale analytics may get
workers/storage/cloudflare.js-1156-      // while mutations keep arriving without a quiet gap.
workers/storage/cloudflare.js-1157-      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1158:          VALUES ('rebuild_dirty_since', ?, ?)
workers/storage/cloudflare.js-1159-        ON CONFLICT(summary_key) DO UPDATE SET
workers/storage/cloudflare.js-1160-          value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
workers/storage/cloudflare.js-1161-          updated_at = excluded.updated_at`)
workers/storage/cloudflare.js-1162-        .bind(now, stamp),
workers/storage/cloudflare.js-1163-    ]);
workers/storage/cloudflare.js-1164-    return true;
workers/storage/cloudflare.js-1165-  }
workers/storage/cloudflare.js-1166-
workers/storage/cloudflare.js-1167-  async readAggregateState() {
workers/storage/cloudflare.js-1168-    const current = rows(await this.db.prepare(
workers/storage/cloudflare.js-1169-      `SELECT summary_key, value_int FROM catalog_summary
workers/storage/cloudflare.js-1170-        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
workers/storage/cloudflare.js:1171:                              'rebuild_last_attempt_at', 'rebuild_lease_until',
workers/storage/cloudflare.js:1172:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
workers/storage/cloudflare.js-1173-    ).all());
workers/storage/cloudflare.js-1174-    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
workers/storage/cloudflare.js-1175-  }
workers/storage/cloudflare.js-1176-
workers/storage/cloudflare.js-1177-  /**
workers/storage/cloudflare.js-1178-   * Rate-limit decision for the scheduled handler: rebuild only when a
workers/storage/cloudflare.js-1179-   * generation is pending and the last rebuild is older than the interval.
workers/storage/cloudflare.js-1180-   * This is the only guard preventing a bulk import from rewriting the whole
--
workers/storage/cloudflare.js-1190-    const pending = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js-1191-    const applied = state.get("rebuild_applied_generation") || 0;
workers/storage/cloudflare.js-1192-    if (pending <= applied) return { due: false, reason: "clean" };
workers/storage/cloudflare.js-1193-
workers/storage/cloudflare.js-1194-    // Throttle on the last *attempt*, not only the last success: a rebuild that
workers/storage/cloudflare.js-1195-    // throws releases its lease without stamping `rebuild_last_at`, and the
workers/storage/cloudflare.js-1196-    // 30-second queue retry must not therefore rebuild on every retry.
workers/storage/cloudflare.js-1197-    const lastSuccessAt = state.get("rebuild_last_at") || 0;
workers/storage/cloudflare.js:1198:    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
workers/storage/cloudflare.js-1199-    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
workers/storage/cloudflare.js-1200-    const nowSeconds = Math.floor(Date.now() / 1000);
workers/storage/cloudflare.js-1201-    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
workers/storage/cloudflare.js:1202:    const dirtySince = state.get("rebuild_dirty_since") || 0;
workers/storage/cloudflare.js-1203-    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
workers/storage/cloudflare.js-1204-    const base = {
workers/storage/cloudflare.js-1205-      pending_generation: pending,
workers/storage/cloudflare.js-1206-      applied_generation: applied,
workers/storage/cloudflare.js-1207-      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
workers/storage/cloudflare.js-1208-    };
workers/storage/cloudflare.js-1209-
workers/storage/cloudflare.js-1210-    // Hard bound: however busy the queue is, analytics may not stay stale longer
--
workers/storage/cloudflare.js-1254-        VALUES ('rebuild_lease_until', ?, ?)
workers/storage/cloudflare.js-1255-      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
workers/storage/cloudflare.js-1256-      WHERE catalog_summary.value_int < ?`)
workers/storage/cloudflare.js-1257-      .bind(now + lease, token, now).run();
workers/storage/cloudflare.js-1258-    if (changeCount(result) === 0) return null;
workers/storage/cloudflare.js-1259-    // Throttles retries of a rebuild that failed (a failure never stamps
workers/storage/cloudflare.js-1260-    // rebuild_last_at). Losing this write only costs one extra rebuild.
workers/storage/cloudflare.js-1261-    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1262:        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
workers/storage/cloudflare.js-1263-    return { token, leaseSeconds: lease };
workers/storage/cloudflare.js-1264-  }
workers/storage/cloudflare.js-1265-
workers/storage/cloudflare.js-1266-  /** Extend the lease, but only while this caller still owns it. */
workers/storage/cloudflare.js-1267-  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js-1268-    if (typeof token !== "string" || !token) return false;
workers/storage/cloudflare.js-1269-    const lease = Math.max(60, Math.floor(leaseSeconds));
workers/storage/cloudflare.js-1270-    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?

hook: PostToolUse Completed
**Verifying patch leftover errors**
**Planning commit ancestry verification**
exec
/bin/zsh -lc "nl -ba docs/ops/aggregate-rebuild-cost-guard.md | sed -n '35,130p'
nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '1,115p'
nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '285,355p'
nl -ba workers/storage/cloudflare.js | sed -n '48,60p;1015,1040p;1098,1120p;1138,1165p;1185,1230p'
nl -ba .claude/STATE.md | sed -n '20,76p'
git merge-base --is-ancestor be5a17e HEAD; printf 'merge_base_exit=%s\\n' "'$?' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1516ms:
2026-09-11 03:06:20.448 xcodebuild[33091:137245942]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:20.587 xcodebuild[33091:137245941] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-3Xarv7mC' (errno=Operation not permitted)
2026-09-11 03:06:20.975 xcodebuild[33094:137245968]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:21.142 xcodebuild[33094:137245967] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
merge_base_exit=0

hook: PostToolUse
hook: PostToolUse Completed
**Verifying test line consistency and claims**
**Checking exact test assertions for deletions**
exec
/bin/zsh -lc "nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '349,415p'
rg -n -i -C 2 \"reset by every rebuild|reset.*every rebuild|one row|four internal keys|<= ?5 ?minutes|less than.?5 ?minutes|dashboard freshness|390 tests|27/27|rebuild disarms\" docs/ops/aggregate-rebuild-cost-guard.md .claude/STATE.md
git show --no-ext-diff --format= --unified=20 be5a17e -- .claude/STATE.md docs/ops/aggregate-rebuild-cost-guard.md workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1727ms:
2026-09-11 03:06:31.283 xcodebuild[33188:137247175]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:31.485 xcodebuild[33188:137247174] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-gNkNUS4V' (errno=Operation not permitted)
2026-09-11 03:06:31.964 xcodebuild[33193:137247245]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:06:32.098 xcodebuild[33193:137247228] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/.claude/STATE.md b/.claude/STATE.md
index 9d45f21..bed97ce 100644
--- a/.claude/STATE.md
+++ b/.claude/STATE.md
@@ -7,70 +7,70 @@ Updated: 2026-09-10 Australia/Melbourne
 ### Review 5 fixes (2026-09-11)
 
 - HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
   landing mid-scan reset the clock and the staleness bound became unreachable
   under continuous writes. The disarm is now a conditional UPDATE that only
   fires when the rebuild applied the generation it observed.
 - MED: `markAggregatesDirty()` writes its three control rows in one atomic
   `db.batch()`, and the mutation timestamp is monotonic (`MAX`), so isolates
   with skewed clocks cannot rewind the quiet window.
 - MED: the staleness bound is evaluated before the interval debounce, so a
   freshly stamped failed attempt cannot postpone overdue work.
 - LOW: failures emit a structured `cloudflare.aggregate_rebuild_failed` event.
 - LOW: docs state the real control-row counts and per-import cost.
 
 ### Follow-up: quiet window (2026-09-11)
 - The interval alone still cost ~$28 per 153k-case import (one rebuild per
   5-minute interval for four hours). The rebuild now waits for a quiet window:
   `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) of no mutations, so an import
   collapses into **one rebuild (~$0.58)**; `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
   (default 21600) bounds staleness when mutations never pause.
-- New bookkeeping keys `rebuild_last_mutation_at` (refreshed by every mutation)
-  and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
+  and `rebuild_dirty_since` (armed only on the clean→dirty edge, disarmed only by a
+  rebuild that applied the generation it observed) support the window and the bound.
   rebuild) support the window and the bound.
-- Validation: Worker Vitest 27 files / **388 tests**; real-SQLite harness
-  **24/24** (including "staleness clock arms on the first mutation only" and
+- Validation: Worker Vitest 27 files / **390 tests**; real-SQLite harness **27/27** (including "a mid-scan mutation keeps the staleness clock armed" and
+  "rebuild with nothing new disarms the staleness clock"); bundle closure passes; gate unchanged.
   "rebuild disarms the staleness clock"); bundle closure passes; gate unchanged.
 
 ### Symptom
 - `immi-catalog` D1 wrote 12,084,578,591 rows (99.77% of the account's analytical
   writes) across 2026-08-23 → 2026-09-01: 12.06B billable rows ≈ **$12,060** of
   D1 rows-written charges. The budget-alert email fired once (2026-08-25 23:55
   local, quoting $5,190.94) and further spend produced no new notice.
 
 ### Root cause
 - `handleCaseMutationQueue()` rebuilt aggregates **once per queue batch**; one
   rebuild clears and rewrites 17 summary/filter tables (~584k written rows,
   ~$0.58 at $1/million). With `max_batch_size = 20`, a 153k-case import is
   ~7,700 batches ≈ 4.5B written rows, and the corpus was re-pushed several times.
 - Query insights: the top three `INSERT ... SELECT` statements alone account for
   6.68B written rows across ~24,000 executions.
 
 ### Fix
-- The queue path now records staleness (`markAggregatesDirty()`, one row); the
+- The queue path now records staleness (`markAggregatesDirty()`, three control rows in one atomic batch); the
   new `scheduled()` handler rebuilds at most once per
   `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300 s) driven by the
   `[triggers]` cron `*/5 * * * *`, under a conditional-upsert D1 lease so
   overlapping invocations cannot rewrite the 17 tables at once.
 - Bookkeeping lives in `catalog_summary` under `rebuild_generation` /
   `rebuild_applied_generation` / `rebuild_last_at` / `rebuild_last_attempt_at` /
-  `rebuild_lease_until` / `rebuild_lease_token` (no D1 migration; `getStats()`
+  `rebuild_lease_until` / `rebuild_last_mutation_at` / `rebuild_dirty_since` (no D1 migration; `getStats()`
   still reads only `total_cases`/`with_full_text`).
   "Dirty" is `generation > applied_generation`, so a mutation that lands while a
   rebuild is running stays pending instead of being wiped by the rebuild's own
   bookkeeping write (the boolean-flag race a Codex review flagged as HIGH).
 - A queue-side fallback (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600)
   keeps aggregates fresh if the cron trigger is missing or failing.
 - Lease fencing (second review pass): the winner records a random token, renewal
   and release are token-conditional, and the rebuild renews per 20-statement
   chunk and aborts (`rebuild_lease_lost`) if it lost the lease — so an expired
   holder can neither clobber the new owner nor keep writing. Failed rebuilds are
   throttled via `rebuild_last_attempt_at` (240 tests-worth of behaviour; see
   validation below).
 
 ### Validation
 - Full Worker Vitest: **27 files / 378 tests passed**, including new assertions
   that the queue path never rebuilds, that 20 mutations coalesce into one stale
   flag, that the rebuild statement set is exactly 17 tables + bookkeeping, that
   a mutation arriving after the applied generation stays pending, and that a
   second lease claim loses while the first holds.
 - Review evidence (untracked by repo policy): `work/codex-review.md`,
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
index 4e8e51d..0602692 100644
--- a/docs/ops/aggregate-rebuild-cost-guard.md
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -19,53 +19,52 @@ The cause was in this Worker, not in the database or the queue configuration:
   Query insights confirmed the pattern: the top three `INSERT ... SELECT`
   statements alone accounted for 6.68B written rows over ~24,000 executions.
 
 D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
 summary data is charged again on every pass, so "the data set is small" does not
 bound the bill — the number of rebuild passes does.
 
 ## What changed
 
 | File | Change |
 |---|---|
 | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
 | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
 | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
 | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
 | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
 | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
 
 ### Bookkeeping model (why generations, not a boolean)
 
-State lives in `catalog_summary` (`summary_key` is the primary key) under four
+State lives in `catalog_summary` (`summary_key` is the primary key) under seven
 internal keys, none of which reach API responses (`getStats()` reads only
 `total_cases` / `with_full_text`). No D1 migration is required.
 
 | Key | Written by | Meaning |
 |---|---|---|
 | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
 | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
 | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
 | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
 | `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
 | `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
-| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
 | `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
 
 "Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
 would be wrong: a rebuild that starts at generation 5 and takes a minute can be
 interleaved with a mutation, and a plain `dirty = 0` write at the end would
 discard that mutation's pending state and leave the dashboard permanently stale.
 The rebuild therefore snapshots the generation *before* it scans and records that
 value as applied — anything that arrived meanwhile stays pending and the next
 tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
 bookkeeping keys for the same reason.
 
 Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
 upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
 expiry **and rotates the fencing token in the same statement**, so a lease is
 never observable in a torn state (expiry already renewed, token still the
 previous owner's — the flaw a second review pass caught in the first version of
 this fix). `changes === 1` means the caller won; the winner then stamps
 `rebuild_last_attempt_at`.
 
 Fencing matters because a lease can expire while its holder is still working:
@@ -74,41 +73,41 @@ Fencing matters because a lease can expire while its holder is still working:
   = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
   **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
   its lease cannot keep interleaving its DELETEs with the new owner's.
 - `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
   expired holder can never free (or extend) the new owner's lease. Without a
   token it refuses (`false`) instead of falling back to an unconditional write.
 - The `finally` release is therefore safe even on the abort path.
 
 The attempt timestamp is the second half of the same problem: a rebuild that
 throws releases its lease but never writes `rebuild_last_at`, so throttling on
 success alone would let a retry storm rebuild on every 30-second queue retry.
 `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
 
 ## Cost envelope after the change
 
 | Scenario | Before | After (300 s interval) |
 |---|---|---|
 | One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
 | 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
 | Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
-| Dashboard freshness | per batch | ≤ 5 minutes stale |
+| Dashboard freshness | per batch | a few minutes after the last queued mutation (quiet window 300 s); a sustained multi-hour import may lag up to the staleness bound (6 h) |
 | Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
 
 ### Quiet window (why an import costs cents, not dollars)
 
 The interval alone only bounds *how often* a rebuild may run; during a four-hour
 bulk import it still fires every interval, which is how a fixed version could
 still spend ~$28 on one import. The rebuild therefore waits for a **quiet
 window**: it will not run until mutations have been silent for
 `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
 **one rebuild (~$0.58)** because the pending work accumulates while the import
 runs and is rebuilt once afterwards. A dashboard read during an import therefore
 sees figures from before the import — acceptable, since nobody is reading
 aggregates while bulk data is still landing.
 
 The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
 hours): if mutations never pause, analytics are still refreshed on that cadence
 instead of drifting indefinitely. Lower it if continuous-write periods must stay
 fresher; raise it to make very long imports even cheaper.
 
 Four operator-side knobs:
diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
index 6fff8f1..807e50c 100644
--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
@@ -1,32 +1,32 @@
 import { describe, expect, it, vi } from "vitest";
 import { createCloudflareStores } from "../storage/cloudflare.js";
 
 const REBUILD_TABLES = [
   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
 ];
 const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
-  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
+  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_last_mutation_at", "rebuild_dirty_since"];
 
 function d1({ responder = () => [], changes = 1, changesFor } = {}) {
   const prepared = [];
   const binding = {
     prepared,
     prepare(sql) {
       const statement = {
         sql,
         params: [],
         bind(...params) { this.params = params; return this; },
         all: async () => ({ results: responder(sql) }),
         first: async () => responder(sql)[0] ?? null,
         run: async () => ({ meta: { changes: changesFor ? changesFor(sql) : changes } }),
       };
       prepared.push(statement);
       return statement;
     },
     batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
   };
   return binding;

hook: PostToolUse
hook: PostToolUse Completed
**Identifying docs inconsistency and residual risk**
**Assessing state inconsistency from dangling duplicates**
**Determining changes-required due to doc and test mismatches**
**Verifying key cardinality checks in tests**
**Planning concise risk report format**
codex
完成：
- Finding 5 的 ops 文件已修正：七個 internal keys、條件式 disarm 說明、以及可達六小時的 freshness 說明皆與實作一致。見 [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:39)。
- Finding 6 已修正：測試 `BOOKKEEPING_KEYS` 已包含 `rebuild_last_attempt_at`，並逐一驗證 `DELETE` 保留它們。見 [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11) 與 [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:365)。
- 實作的 DELETE 由七項 `AGGREGATE_BOOKKEEPING_KEYS` 建構，與測試的七項完全相同。見 [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) 及 [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1031)。

剩餘風險：
- `.claude/STATE.md` 的 commit replacement 遺留破碎、重複內容：第 29 行孤立的 `rebuild) support...`，第 32 行孤立舊驗證文字。這使狀態文件不一致且難以可靠交接。見 [.claude/STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:27)。
- ops 文件宣稱「Four operator-side knobs」，實際列出五項，屬文件計數不一致。見 [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:113)。

驗證：
- 僅執行唯讀 `git show be5a17e` 與 HEAD 原始碼比對；未執行測試、建置或網路操作。

Git：
- `be5a17e` 是 HEAD 祖先；工作區另有未追蹤 `work/`，未碰觸。

VERDICT: CHANGES-REQUIRED
tokens used
30,056
完成：
- Finding 5 的 ops 文件已修正：七個 internal keys、條件式 disarm 說明、以及可達六小時的 freshness 說明皆與實作一致。見 [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:39)。
- Finding 6 已修正：測試 `BOOKKEEPING_KEYS` 已包含 `rebuild_last_attempt_at`，並逐一驗證 `DELETE` 保留它們。見 [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11) 與 [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:365)。
- 實作的 DELETE 由七項 `AGGREGATE_BOOKKEEPING_KEYS` 建構，與測試的七項完全相同。見 [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) 及 [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1031)。

剩餘風險：
- `.claude/STATE.md` 的 commit replacement 遺留破碎、重複內容：第 29 行孤立的 `rebuild) support...`，第 32 行孤立舊驗證文字。這使狀態文件不一致且難以可靠交接。見 [.claude/STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:27)。
- ops 文件宣稱「Four operator-side knobs」，實際列出五項，屬文件計數不一致。見 [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:113)。

驗證：
- 僅執行唯讀 `git show be5a17e` 與 HEAD 原始碼比對；未執行測試、建置或網路操作。

Git：
- `be5a17e` 是 HEAD 祖先；工作區另有未追蹤 `work/`，未碰觸。

VERDICT: CHANGES-REQUIRED
