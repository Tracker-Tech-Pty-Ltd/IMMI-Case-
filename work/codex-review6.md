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
session id: 01a08c45-965e-7ae0-991f-e46befca702b
--------
user
Sixth review pass — verify ONLY that the six findings from your previous review (work/codex-review5.md) are now correctly closed. Review only; do not modify anything.

HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files, do not touch the network. Use `git show 8676d5c` and read files at HEAD.

Scope: commit 8676d5c on branch fix/aggregate-rebuild-debounce, files
workers/storage/cloudflare.js, workers/cloudflare-native.js,
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js,
docs/ops/aggregate-rebuild-cost-guard.md, .claude/STATE.md.

Previous findings to confirm:
1. HIGH: rebuild disarmed rebuild_dirty_since unconditionally, so a mid-scan mutation reset the staleness clock and the bound became unreachable under continuous writes.
2. MED: three separate awaited writes in markAggregatesDirty could interleave between isolates (older epoch overwriting newer, clock starting late).
3. MED: the interval debounce returned before the staleness bound, so a failed rebuild's attempt stamp postponed overdue work.
4. LOW: no structured failure event for rebuild failures.
5. LOW: docs claimed one control row and stale cost numbers.
6. LOW: the test's BOOKKEEPING_KEYS constant missed the two new keys.

For each: does the committed code actually close it, and does a test or the SQL harness (work/verify-rebuild-sql.py) demonstrate it? Specifically check:
- Whether the conditional disarm is race-safe as written in SQL (COALESCE guard, comparison against the applied generation, correct statement ordering relative to the aggregate scan and the applied-generation row within the batched/looped execution).
- Whether db.batch() is used correctly for the mark-dirty path and whether any caller depends on the old three-await shape.
- Whether the reordering broke the "debounced"/"awaiting-quiet" reasons or their reported fields, and whether the tests assert the new precedence.
- Whether the harness truly simulates a mid-scan mutation (it executes the control-row writes then the bookkeeping statements with the runtime-observed generation).

Report any residual or newly introduced risk with file:line evidence, then your verdict on the LAST line exactly as one of:
VERDICT: APPROVE
VERDICT: CHANGES-REQUIRED

If APPROVE, list (max 3) residual risks worth watching in production but not blocking.
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T17:02:46.500046Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T17:02:47.775256Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T17:02:48.540536Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
codex
我會只做靜態審查：讀取指定提交與 HEAD 檔案，不執行測試、建置、網路或任何寫入。
exec
/bin/zsh -lc 'git status --short --branch && git show --stat --oneline --decorate --no-renames 8676d5c && git show --format=fuller --no-ext-diff --unified=80 8676d5c -- workers/storage/cloudflare.js workers/cloudflare-native.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js docs/ops/aggregate-rebuild-cost-guard.md .claude/STATE.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 6496ms:
2026-09-11 03:02:57.435 xcodebuild[28638:137209114]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:02:57.708 xcodebuild[28638:137209112] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-bg7MQUW0' (errno=Operation not permitted)
2026-09-11 03:02:58.290 xcodebuild[28653:137209288]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:02:58.444 xcodebuild[28653:137209287] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## fix/aggregate-rebuild-debounce...origin/fix/aggregate-rebuild-debounce
?? work/
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Lstg5u9r' (errno=Operation not permitted)
2026-09-11 03:02:59.529 xcodebuild[28668:137209399]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:02:59.684 xcodebuild[28668:137209398] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-EcoIREzP' (errno=Operation not permitted)
2026-09-11 03:03:00.149 xcodebuild[28670:137209413]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:03:00.300 xcodebuild[28670:137209410] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
8676d5c (HEAD -> fix/aggregate-rebuild-debounce, origin/fix/aggregate-rebuild-debounce) fix(cloudflare): close the review findings on the quiet-window rebuild
 .claude/STATE.md                                   | 14 ++++++
 docs/ops/aggregate-rebuild-cost-guard.md           |  7 +--
 .../cloudflare-aggregate-rebuild-guard.test.js     | 50 ++++++++++++++++---
 workers/cloudflare-native.js                       | 34 ++++++++++++-
 workers/storage/cloudflare.js                      | 58 +++++++++++++---------
 5 files changed, 126 insertions(+), 37 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-QdZb7KMr' (errno=Operation not permitted)
2026-09-11 03:03:01.440 xcodebuild[28683:137209592]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:03:01.578 xcodebuild[28683:137209591] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-fftrrgG5' (errno=Operation not permitted)
2026-09-11 03:03:02.001 xcodebuild[28687:137209619]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:03:02.143 xcodebuild[28687:137209618] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
commit 8676d5cf1259018b60fa515cb86df8c0eb656913
Author:     Sasuke.Inu <233004175+Sasuke-inu@users.noreply.github.com>
AuthorDate: Fri Sep 11 03:02:33 2026 +1000
Commit:     Sasuke.Inu <233004175+Sasuke-inu@users.noreply.github.com>
CommitDate: Fri Sep 11 03:02:33 2026 +1000

    fix(cloudflare): close the review findings on the quiet-window rebuild
    
    Codex review 5 returned CHANGES-REQUIRED; every finding is fixed and covered:
    - HIGH: the rebuild disarmed rebuild_dirty_since unconditionally. A mutation
      landing mid-scan then reset the staleness clock, making the bound unreachable
      under continuous writes (analytics could stay stale forever). The disarm is now
      a conditional UPDATE that only fires when the rebuild applied the generation it
      observed (COALESCE-guarded, so a missing generation row is deterministic).
    - MED: markAggregatesDirty() writes generation, mutation timestamp and staleness
      clock as one atomic db.batch() (no interleaving between isolates) and the
      timestamp only moves forward (MAX).
    - MED: the staleness bound is checked before the interval debounce, so a failed
      rebuild's attempt stamp cannot postpone overdue work past the bound.
    - LOW: rebuild failures emit a structured cloudflare.aggregate_rebuild_failed
      event instead of being visible only as a missing completion line.
    - LOW: docs/tests corrected - three control rows per batch, real per-import cost,
      BOOKKEEPING_KEYS covers every key.
    
    Verified: 390/390 worker tests, real-SQLite harness 27/27 (clean rebuild
    disarms, mutation arms, mid-scan mutation stays armed, one-armed-edge,
    nothing-new disarms), bundle closure 343684 bytes, python target tests 6/6.

diff --git a/.claude/STATE.md b/.claude/STATE.md
index 80a73d2..9d45f21 100644
--- a/.claude/STATE.md
+++ b/.claude/STATE.md
@@ -1,86 +1,100 @@
 # IMMI-Case Worktree Closeout State
 
 Updated: 2026-09-10 Australia/Melbourne
 
 ## 2026-09-10 Aggregate Rebuild Cost Guard — DONE ✓
 
+### Review 5 fixes (2026-09-11)
+
+- HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
+  landing mid-scan reset the clock and the staleness bound became unreachable
+  under continuous writes. The disarm is now a conditional UPDATE that only
+  fires when the rebuild applied the generation it observed.
+- MED: `markAggregatesDirty()` writes its three control rows in one atomic
+  `db.batch()`, and the mutation timestamp is monotonic (`MAX`), so isolates
+  with skewed clocks cannot rewind the quiet window.
+- MED: the staleness bound is evaluated before the interval debounce, so a
+  freshly stamped failed attempt cannot postpone overdue work.
+- LOW: failures emit a structured `cloudflare.aggregate_rebuild_failed` event.
+- LOW: docs state the real control-row counts and per-import cost.
+
 ### Follow-up: quiet window (2026-09-11)
 - The interval alone still cost ~$28 per 153k-case import (one rebuild per
   5-minute interval for four hours). The rebuild now waits for a quiet window:
   `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) of no mutations, so an import
   collapses into **one rebuild (~$0.58)**; `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
   (default 21600) bounds staleness when mutations never pause.
 - New bookkeeping keys `rebuild_last_mutation_at` (refreshed by every mutation)
   and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
   rebuild) support the window and the bound.
 - Validation: Worker Vitest 27 files / **388 tests**; real-SQLite harness
   **24/24** (including "staleness clock arms on the first mutation only" and
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
 - The queue path now records staleness (`markAggregatesDirty()`, one row); the
   new `scheduled()` handler rebuilds at most once per
   `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300 s) driven by the
   `[triggers]` cron `*/5 * * * *`, under a conditional-upsert D1 lease so
   overlapping invocations cannot rewrite the 17 tables at once.
 - Bookkeeping lives in `catalog_summary` under `rebuild_generation` /
   `rebuild_applied_generation` / `rebuild_last_at` / `rebuild_last_attempt_at` /
   `rebuild_lease_until` / `rebuild_lease_token` (no D1 migration; `getStats()`
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
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
index 30a4af1..4e8e51d 100644
--- a/docs/ops/aggregate-rebuild-cost-guard.md
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -1,171 +1,172 @@
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
-| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
+| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
 | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
 | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
 | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
 | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
 | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
 
 ### Bookkeeping model (why generations, not a boolean)
 
 State lives in `catalog_summary` (`summary_key` is the primary key) under four
 internal keys, none of which reach API responses (`getStats()` reads only
 `total_cases` / `with_full_text`). No D1 migration is required.
 
 | Key | Written by | Meaning |
 |---|---|---|
 | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
 | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
 | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
 | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
 | `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
 | `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
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
-| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
-| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window); ≤ 4 rebuilds ≈ $2.3 if it runs longer than the staleness bound |
+| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
 | Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
 | Dashboard freshness | per batch | ≤ 5 minutes stale |
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
 
diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
index 6435ac4..6fff8f1 100644
--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
@@ -1,379 +1,413 @@
 import { describe, expect, it, vi } from "vitest";
 import { createCloudflareStores } from "../storage/cloudflare.js";
 
 const REBUILD_TABLES = [
   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
 ];
-const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
+const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
+  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
 
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
 
-    // Three rows: the generation counter, the mutation timestamp and the
-    // staleness clock (which only arms when it is currently zero).
+    // Three control rows committed as one transaction: the generation counter,
+    // the mutation timestamp and the staleness clock (armed only when zero).
     expect(catalog.prepared).toHaveLength(3);
+    expect(catalog.batch).toHaveBeenCalledTimes(1);
+    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
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
 
-    expect(catalog.batch).not.toHaveBeenCalled();
+    // The only batch is the three control rows - no aggregate DELETE/INSERT.
+    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
+    expect(batched).toHaveLength(3);
+    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
     expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   });
 
+  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
+    const { catalog, value } = env();
+
+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
+
+    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
+    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
+  });
+
   it("reports clean when nothing is pending", async () => {
     const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toEqual({ due: false, reason: "clean" });
   });
 
   it("stays dirty when a mutation arrives after the applied generation", async () => {
     const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     // This is the race the boolean flag could not express: the rebuild applied
     // generation 5, and generation 6 arrived while it was running.
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
   });
 
   it("debounces a pending generation inside the interval", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
 
     expect(decision.due).toBe(false);
     expect(decision.reason).toBe("debounced");
     expect(decision.seconds_until_due).toBeGreaterThan(0);
     expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
   });
 
   it("rebuilds when the pending generation is older than the interval", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
     const { value } = env({ responder: () => state({ pending: 1 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("falls back to the default interval for invalid input", async () => {
     const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
 
     expect(decision.due).toBe(false);
     expect(decision.reason).toBe("debounced");
   });
 
+  it("lets the staleness bound win over a just-stamped attempt", async () => {
+    // A failed rebuild stamps an attempt; the interval must not postpone work
+    // that has already exceeded the staleness bound.
+    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
+      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
+    const stores = createCloudflareStores(value);
+
+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
+      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
+  });
+
   it("waits for a quiet window before rebuilding", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
 
     expect(decision.due).toBe(false);
     expect(decision.reason).toBe("awaiting-quiet");
     expect(decision.seconds_until_quiet).toBeGreaterThan(0);
     expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
   });
 
   it("rebuilds once mutations have been quiet long enough", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
     const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
 
     expect(decision.due).toBe(true);
     expect(decision.reason).toBe("max-staleness");
     expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
   });
 
   it("keeps the legacy behaviour when no quiet window is configured", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("claims the rebuild lease only when the previous lease has expired", async () => {
     const held = env({ changes: 0 });
     await expect(createCloudflareStores(held.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
       .resolves.toBeNull();
 
     const free = env({ changes: 1 });
     const lease = await createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 });
     expect(lease).toMatchObject({ leaseSeconds: 600 });
     expect(typeof lease.token).toBe("string");
     expect(lease.token.length).toBeGreaterThan(7);
 
     // Expiry and fencing token are written by the SAME statement, so the lease
     // can never be observed in a torn state by an expiring holder.
     const statement = free.catalog.prepared[0];
     expect(statement.sql).toMatch(/rebuild_lease_until/);
     expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
     expect(statement.params).toHaveLength(3);
     expect(statement.params[0]).toBeGreaterThan(nowSeconds());
     expect(statement.params[1]).toBe(lease.token);
   });
 
   it("rotates the token when a new owner claims the lease", async () => {
     const { value } = env({ changes: 1 });
     const stores = createCloudflareStores(value);
 
     const first = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
     const second = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
 
     expect(first.token).not.toBe(second.token);
   });
 
   it("stamps the attempt time when the lease is taken", async () => {
     const { catalog, value } = env();
 
     const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });
 
     const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
     expect(attempt).toBeDefined();
     expect(Number(attempt.params[0])).toBeLessThanOrEqual(nowSeconds());
     // Two statements only: the lease itself (expiry + token) and the attempt
     // stamp. There is no third write that could leave the token out of sync.
     expect(catalog.prepared).toHaveLength(2);
     expect(catalog.prepared[0].params[1]).toBe(lease.token);
   });
 
   it("enforces a floor on the lease length", async () => {
     const { catalog, value } = env();
     const before = nowSeconds();
 
     await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });
 
     expect(catalog.prepared[0].params[0]).toBeGreaterThanOrEqual(before + 60);
   });
 
   it("renews only while this caller still owns the lease", async () => {
     const owned = env({ changes: 1 });
     await expect(createCloudflareStores(owned.value).caseStore.renewRebuildLease({ token: "owner-token", leaseSeconds: 900 }))
       .resolves.toBe(true);
     const renew = owned.catalog.prepared[0];
     expect(renew.sql).toMatch(/WHERE summary_key = 'rebuild_lease_until' AND updated_at = \?/);
     expect(renew.params).toEqual([expect.any(Number), "owner-token", "owner-token"]);
 
     const lost = env({ changes: 0 });
     await expect(createCloudflareStores(lost.value).caseStore.renewRebuildLease({ token: "stale-token", leaseSeconds: 900 }))
       .resolves.toBe(false);
   });
 
   it("releases the lease only when the token still matches", async () => {
     const { catalog, value } = env();
 
     await createCloudflareStores(value).caseStore.releaseRebuildLease({ token: "owner-token" });
 
     expect(catalog.prepared[0].sql).toMatch(/UPDATE catalog_summary SET value_int = 0/);
     expect(catalog.prepared[0].sql).toMatch(/AND updated_at = \?/);
     expect(catalog.prepared[0].params).toEqual([expect.any(String), "owner-token"]);
   });
 
   it("refuses a release without a token", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.releaseRebuildLease()).resolves.toBe(false);
     await expect(stores.caseStore.releaseRebuildLease({ token: "" })).resolves.toBe(false);
     expect(catalog.prepared).toHaveLength(0);
   });
 
   it("aborts the rebuild when the lease is lost mid-run", async () => {
     // The renewal update matches no row, so this invocation no longer owns the
     // lease and must stop instead of interleaving its DELETEs with the new owner.
     const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
       .rejects.toThrow(/lease lost/);
   });
 
   it("does not consult the lease when the rebuild runs without one", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
-    expect(catalog.prepared.some((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"))).toBe(false);
+    // The only UPDATE is the conditional dirty_since disarm, never a lease renewal.
+    const updates = catalog.prepared.filter((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"));
+    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
+    expect(updates.some((s) => s.sql.includes("'rebuild_lease_until'"))).toBe(false);
   });
 
   it("throttles a retry after a failed rebuild", async () => {
     // A failed rebuild releases its lease without stamping rebuild_last_at, so
     // the decision must also consider the attempt stamp.
     const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: false, reason: "debounced" });
 
     const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("clears and rewrites exactly the documented summary tables", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     const deleted = catalog.prepared
       .filter((s) => /^DELETE FROM /.test(s.sql))
       .map((s) => s.sql.replace("DELETE FROM ", "").split(" ")[0]);
     expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
     // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
-    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
+    // + 3 bookkeeping statements (applied generation, last rebuild, conditional
+    // dirty_since disarm).
     expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
   });
 
   it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
     expect(summaryDelete).toBeDefined();
     expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
   });
 
   it("records the generation observed before the scan, not a bare clean flag", async () => {
     const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     const before = nowSeconds();
     await stores.caseStore.rebuildAggregates();
     const after = nowSeconds();
 
     const applied = catalog.prepared
       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
     const stamp = catalog.prepared
       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
     const resetDirtySince = catalog.prepared
-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
+      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
     expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
     expect(Number(applied.params[0])).toBe(7);
     expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
     expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
+    // The disarm is conditional on no mutation arriving mid-scan, so continuous
+    // writes can never reset the staleness clock on every rebuild.
     expect(resetDirtySince).toBeDefined();
-    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
+    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
+    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
+    expect(Number(resetDirtySince.params[1])).toBe(7);
     expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
   });
 
   it("batches the rebuild statements in bounded chunks", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     for (const call of catalog.batch.mock.calls) expect(call[0].length).toBeLessThanOrEqual(20);
     expect(catalog.batch.mock.calls.length).toBeGreaterThan(1);
   });
 });
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index 3f81a3d..8aa67fb 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -125,190 +125,220 @@ async function handleCaseMutationQueue(batch, env) {
   } catch (error) {
     console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
     for (const message of messages) {
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
 const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
 const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
 const DEFAULT_REBUILD_LEASE_SECONDS = 900;
 // Quiet window: a rebuild waits until mutations have stopped for this long, so a
 // multi-hour bulk import collapses into one rebuild instead of one per interval
 // (measured: ~$28 -> ~$0.58 per 153k-case import).
 const DEFAULT_QUIET_SECONDS = 300;
 // Hard staleness bound: however busy the queue is, analytics refresh at least
 // this often. Only reachable while mutations never pause.
 const DEFAULT_MAX_STALENESS_SECONDS = 21600;
 
 function positiveIntOr(value, fallback) {
   const parsed = Number.parseInt(value ?? "", 10);
   return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
 }
 
 function rebuildDecisionParams(env, minIntervalSeconds) {
   return {
     minIntervalSeconds,
     quietSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_QUIET_SECONDS, DEFAULT_QUIET_SECONDS),
     maxStalenessSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_MAX_STALENESS_SECONDS, DEFAULT_MAX_STALENESS_SECONDS),
   };
 }
 
 /**
  * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
  * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
  * The lease length is derived from the interval so it always outlives a rebuild
  * while still expiring on its own if this invocation dies mid-flight.
  */
 async function rebuildUnderLease(stores, env) {
   const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
   const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
   if (!lease) {
     console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
     return { skipped: "lease_held" };
   }
   try {
     return await stores.caseStore.rebuildAggregates({ lease });
   } finally {
     try {
       // Token-conditional: if this run outlived its lease, the new owner's
       // lease is left untouched.
       await stores.caseStore.releaseRebuildLease({ token: lease.token });
     } catch (error) {
       console.error(JSON.stringify({
         event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
       }));
     }
   }
 }
 
 /**
  * Coalesced analytics rebuild.
  *
  * Queue batches only mark the aggregates dirty; this scheduled handler decides
  * when to pay for the rebuild, so N queue batches cost at most one rebuild per
  * interval instead of N full rewrites of 17 tables.
  */
 async function handleScheduledRebuild(env) {
   const stores = createCloudflareStores(env);
   const minIntervalSeconds = positiveIntOr(
     env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
     DEFAULT_REBUILD_INTERVAL_SECONDS,
   );
   const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!decision.due) {
     console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
     return decision;
   }
   const startedAt = Date.now();
-  const result = await rebuildUnderLease(stores, env);
+  let result;
+  try {
+    result = await rebuildUnderLease(stores, env);
+  } catch (error) {
+    // A structured failure event: without it, a failed rebuild is only visible
+    // as the absence of a completion line, which reads exactly like a healthy
+    // debounce.
+    console.error(JSON.stringify({
+      event: "cloudflare.aggregate_rebuild_failed",
+      reason: decision.reason,
+      pending_generation: decision.pending_generation ?? null,
+      applied_generation: decision.applied_generation ?? null,
+      seconds_since_first_pending: decision.seconds_since_first_pending ?? null,
+      duration_ms: Date.now() - startedAt,
+      error: error?.message ?? String(error),
+    }));
+    throw error;
+  }
   if (result?.skipped) return { ...decision, ...result };
   console.log(JSON.stringify({
     event: "cloudflare.aggregate_rebuild_completed",
     reason: decision.reason,
     min_interval_seconds: minIntervalSeconds,
     duration_ms: Date.now() - startedAt,
     rebuilt_at: result?.rebuilt_at ?? null,
   }));
   return { ...decision, ...result };
 }
 
 /**
  * Safety valve for the coalesced rebuild.
  *
  * The cron trigger normally performs every rebuild, so the queue path only
  * records staleness. If that trigger is missing or failing, the flag would
  * never be drained and every dashboard would freeze silently — so the queue
  * path still refreshes, at most once per fallback window. With a working cron
  * the last rebuild is never older than the cron period, and this never fires.
  */
 async function markStaleAndMaybeRebuild(stores, env) {
   await stores.caseStore.markAggregatesDirty();
   const minIntervalSeconds = positiveIntOr(
     env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
     DEFAULT_FALLBACK_INTERVAL_SECONDS,
   );
   const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!fallback?.due) return false;
-  const result = await rebuildUnderLease(stores, env);
+  let result;
+  try {
+    result = await rebuildUnderLease(stores, env);
+  } catch (error) {
+    console.error(JSON.stringify({
+      event: "cloudflare.aggregate_rebuild_failed",
+      path: "queue-fallback",
+      reason: fallback.reason,
+      pending_generation: fallback.pending_generation ?? null,
+      seconds_since_first_pending: fallback.seconds_since_first_pending ?? null,
+      error: error?.message ?? String(error),
+    }));
+    throw error;
+  }
   if (result?.skipped) return false;
   console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
   return true;
 }
 
 async function handleDeadLetterQueue(batch, env) {
   const stores = createCloudflareStores(env);
   for (const message of batch?.messages || []) {
     try {
       const body = message?.body ?? null;
       const encoded = JSON.stringify(body);
       const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
       const pointer = await stores.objectStore.putVerified({
         key: `imports/dlq/${batch.queue}/${hex}.json`,
         body: encoded,
         contentType: "application/json",
       });
       const eventId = typeof body?.event_id === "string" && body.event_id
         ? body.event_id : `dlq:${batch.queue}:${hex}`;
       await stores.pipelineStore.recordDeadLetter({
         eventId,
         outboxEventId: typeof body?.event_id === "string" ? body.event_id : null,
         reason: `queue:${batch.queue}`,
         payloadPointer: pointer,
       });
       if (typeof message?.ack === "function") message.ack();
     } catch (error) {
       console.error(JSON.stringify({ event: "cloudflare.dlq_record_error", error: error?.message }));
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
 function unavailable(error, code = "cloudflare_route_unavailable") {
   return Response.json({ error, code }, {
     status: 503,
     headers: { "Cache-Control": "no-store", "Retry-After": "0" },
   });
 }
 
 async function dispatchAuth(request, env, path, method) {
   if (env.AUTH_ENABLED === "false") return null;
   if (path === "/api/v1/auth/telegram" && method === "POST") {
     return handleTelegramLogin(request, env);
   }
   if (path === "/api/v1/auth/bootstrap" && method === "POST") {
     return handleBootstrapLogin(request, env);
   }
   if (path === "/api/v1/auth/telegram/callback" && method === "GET") {
     return handleTelegramCallback(request, env);
   }
   if (path === "/api/v1/auth/me" && method === "GET") return handleAuthMe(request, env);
   if (path === "/api/v1/auth/logout" && method === "POST") {
     return handleAuthLogout(request, env);
   }
   if (path === "/api/v1/auth/refresh" && method === "POST") {
     return handleAuthRefresh(request, env);
   }
   if (path === "/api/v1/auth/switch-tenant" && method === "POST") {
     return handleAuthSwitchTenant(request, env);
   }
   return null;
 }
 
 export default {
   async queue(batch, env) {
     if (batch?.queue === "immi-case-mutation-dlq") {
       await handleDeadLetterQueue(batch, env);
       return;
     }
     await handleCaseMutationQueue(batch, env);
   },
   async scheduled(event, env) {
     return handleScheduledRebuild(env);
   },
   async fetch(request, env, ctx) {
     let mode;
     try {
       mode = getStorageMode(env);
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index 9182d51..7858b61 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -1028,263 +1028,273 @@ export class CloudflareCaseStore {
       "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
     ]) {
       statements.push(table === "catalog_summary"
         ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
         : this.db.prepare(`DELETE FROM ${table}`));
     }
     statements.push(
       this.db.prepare(`INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
         SELECT court_code, year, outcome, COUNT(*), ? FROM cases GROUP BY court_code, year, outcome`).bind(now),
       this.db.prepare(`INSERT INTO aggregate_source (source,case_count,updated_at)
         SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source`).bind(now),
       this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
       this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'with_full_text', COUNT(*), ? FROM cases WHERE content_key <> ''`).bind(now),
       this.db.prepare(`INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
         SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
         FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
         WHERE c.court_code <> '' GROUP BY cj.judge_id, c.court_code`),
       this.db.prepare(`INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
         SELECT case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> '' GROUP BY case_nature, outcome`),
       this.db.prepare(`INSERT INTO aggregate_concept (concept_id,label,case_count)
         SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
         FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id GROUP BY cc.concept_id, c.label`),
       this.db.prepare(`INSERT INTO aggregate_country (country,case_count,updated_at)
         SELECT country_of_origin, COUNT(*), ? FROM cases WHERE country_of_origin <> '' GROUP BY country_of_origin`).bind(now),
       this.db.prepare(`INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
         SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
         FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id GROUP BY j.judge_id, j.canonical_name`).bind(now),
       this.db.prepare(`INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
         SELECT visa_subclass, court_code, outcome, COUNT(*), ? FROM cases
         WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome`).bind(now),
       this.db.prepare(`INSERT INTO aggregate_scope
         (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
         SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
                COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
                CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
         FROM cases GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
           COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
           CASE WHEN content_key <> '' THEN 1 ELSE 0 END`),
       this.db.prepare(`INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
         SELECT court_code, case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> ''
         GROUP BY court_code, case_nature, outcome`),
       this.db.prepare(`INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
         SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
         FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
         GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome`),
       this.db.prepare(`INSERT INTO aggregate_concept_pair
         (concept_id_a,concept_id_b,court_code,outcome,case_count)
         SELECT a.concept_id, b.concept_id, c.court_code, c.outcome, COUNT(DISTINCT a.case_id)
         FROM case_concepts a JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
         JOIN cases c ON c.case_id = a.case_id
         GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome`),
       this.db.prepare(`INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
         SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
         FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
         GROUP BY cj.judge_id, c.court_code, c.outcome`),
       this.db.prepare(`INSERT INTO aggregate_judge_year (judge_id,year,case_count)
         SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
         FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.year IS NOT NULL
         GROUP BY cj.judge_id, c.year`),
       this.db.prepare(`INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
         SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
         FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
         GROUP BY cj.judge_id, c.visa_subclass`),
     );
     for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
       statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
         SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
         FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
     }
     // Bookkeeping lives in catalog_summary itself (getStats reads only
     // total_cases/with_full_text, so these keys stay internal). Recording the
     // generation observed at the start — not a bare dirty=0 — is what keeps a
     // mid-rebuild mutation pending.
     statements.push(
       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
-        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
+      // Only disarm the staleness clock when nothing arrived while this rebuild
+      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
+      // the staleness bound stays reachable under continuous writes.
+      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+         WHERE summary_key = 'rebuild_dirty_since'
+           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
+        .bind(now, appliedGeneration),
     );
     for (let offset = 0; offset < statements.length; offset += 20) {
       // While we still own the lease, extend it before each chunk; if another
       // invocation took over (this run outlived its lease), abort instead of
       // interleaving DELETEs with it. At most one chunk can overlap.
       if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
         throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
           code: "rebuild_lease_lost", status: 503,
         });
       }
       await this.db.batch(statements.slice(offset, offset + 20));
     }
     return { rebuilt_at: now, applied_generation: appliedGeneration };
   }
 
   /**
    * Mark analytics as stale without paying for a rebuild: one row written per
    * queue batch instead of clearing and rewriting 17 tables.
    *
    * A monotonic generation, not a boolean: a rebuild applies the generation it
    * observed when it started, so a mutation landing mid-rebuild stays pending
    * instead of being wiped by the rebuild's own bookkeeping write.
    */
   async markAggregatesDirty() {
     const now = Math.floor(Date.now() / 1000);
     const stamp = utcNow();
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_generation', 1, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
-      .bind(stamp).run();
-    // When the last mutation happened: the scheduled rebuild waits for a quiet
-    // window so a long bulk import costs one rebuild, not one per interval.
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_last_mutation_at', ?, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
-      .bind(now, stamp).run();
-    // When the pending work first appeared: bounds how stale analytics may get
-    // while mutations keep arriving without a quiet gap.
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_dirty_since', ?, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET
-        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
-        updated_at = excluded.updated_at`)
-      .bind(now, stamp).run();
+    // One batch = one transaction, so two isolates cannot interleave these rows.
+    await this.db.batch([
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_generation', 1, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
+        .bind(stamp),
+      // When the last mutation happened: the scheduled rebuild waits for a quiet
+      // window so a long bulk import costs one rebuild, not one per interval.
+      // MAX() keeps it monotonic when isolates with skewed clocks interleave.
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_last_mutation_at', ?, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET
+          value_int = MAX(catalog_summary.value_int, excluded.value_int), updated_at = excluded.updated_at`)
+        .bind(now, stamp),
+      // When the pending work first appeared: bounds how stale analytics may get
+      // while mutations keep arriving without a quiet gap.
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_dirty_since', ?, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET
+          value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
+          updated_at = excluded.updated_at`)
+        .bind(now, stamp),
+    ]);
     return true;
   }
 
   async readAggregateState() {
     const current = rows(await this.db.prepare(
       `SELECT summary_key, value_int FROM catalog_summary
         WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
                               'rebuild_last_attempt_at', 'rebuild_lease_until',
                               'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
     ).all());
     return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
   }
 
   /**
    * Rate-limit decision for the scheduled handler: rebuild only when a
    * generation is pending and the last rebuild is older than the interval.
    * This is the only guard preventing a bulk import from rewriting the whole
    * summary set thousands of times.
    */
   async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
     const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
       ? Math.floor(minIntervalSeconds) : 300;
     const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
     const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
       ? Math.floor(maxStalenessSeconds) : 0;
     const state = await this.readAggregateState();
     const pending = state.get("rebuild_generation") || 0;
     const applied = state.get("rebuild_applied_generation") || 0;
     if (pending <= applied) return { due: false, reason: "clean" };
 
     // Throttle on the last *attempt*, not only the last success: a rebuild that
     // throws releases its lease without stamping `rebuild_last_at`, and the
     // 30-second queue retry must not therefore rebuild on every retry.
     const lastSuccessAt = state.get("rebuild_last_at") || 0;
     const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
     const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
     const nowSeconds = Math.floor(Date.now() / 1000);
     const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
-    if (elapsedSeconds < interval) {
-      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
-    }
-
     const dirtySince = state.get("rebuild_dirty_since") || 0;
     const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
     const base = {
       pending_generation: pending,
       applied_generation: applied,
       seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
     };
 
     // Hard bound: however busy the queue is, analytics may not stay stale longer
     // than this, so a bulk import costs one rebuild per window instead of one
     // per interval.
     if (maxStaleness > 0 && staleness >= maxStaleness) {
       return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
     }
 
+    if (elapsedSeconds < interval) {
+      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
+    }
+
     // Quiet window: wait for mutations to stop, so a multi-hour import collapses
     // into a single rebuild afterwards.
     if (quiet > 0) {
       const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
       const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
       if (quietFor < quiet) {
         return {
           due: false,
           reason: "awaiting-quiet",
           seconds_until_quiet: quiet - quietFor,
           seconds_since_first_pending: staleness,
           ...base,
         };
       }
     }
 
     return { due: true, reason: "dirty", seconds_since_first_pending: staleness, ...base };
   }
 
   /**
    * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
    * cron racing the queue fallback) would otherwise both rewrite 17 tables and
    * interleave their DELETEs. The conditional upsert only writes when the held
    * lease has expired, so `changes === 1` means this caller won.
    */
   async claimRebuildLease({ leaseSeconds = 900 } = {}) {
     const now = Math.floor(Date.now() / 1000);
     const lease = Math.max(60, Math.floor(leaseSeconds));
     const token = leaseToken();
     // One statement takes the lease, writes its expiry and rotates the token:
     // a winner cannot be confused with the previous holder, and an expired
     // holder's token stops matching the moment a new claim lands.
     const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
         VALUES ('rebuild_lease_until', ?, ?)
       ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
       WHERE catalog_summary.value_int < ?`)
       .bind(now + lease, token, now).run();
     if (changeCount(result) === 0) return null;
     // Throttles retries of a rebuild that failed (a failure never stamps
     // rebuild_last_at). Losing this write only costs one extra rebuild.
     await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
         VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
     return { token, leaseSeconds: lease };
   }
 
   /** Extend the lease, but only while this caller still owns it. */
   async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
     if (typeof token !== "string" || !token) return false;
     const lease = Math.max(60, Math.floor(leaseSeconds));
     const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
         WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
       .bind(Math.floor(Date.now() / 1000) + lease, token, token).run();
     return changeCount(result) > 0;
   }
 
   /** Release the lease — only the token holder can, so an expired run cannot
    *  free (or extend) a lease that a newer invocation now owns. */
   async releaseRebuildLease({ token } = {}) {
     if (typeof token !== "string" || !token) return false;
     const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
         WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
       .bind(utcNow(), token).run();
     return changeCount(result) > 0;
   }
 
   async relatedCompat(caseId, { limit = 5 } = {}) {
     const id = assertCaseId(caseId);
     const size = compatPageNumber(limit, 5, 1, 20);
     const anchor = await this.db.prepare(`
       SELECT case_nature, visa_type, court_code FROM cases WHERE case_id = ?
     `).bind(id).first();
     if (!anchor) return null;
     const statements = bindAll(this.db, `
       SELECT ${LEGACY_CASE_PROJECTION},
         (CASE WHEN ? <> '' AND c.case_nature = ? THEN 4 ELSE 0 END) +
         (CASE WHEN ? <> '' AND c.visa_type = ? THEN 2 ELSE 0 END) +
         (CASE WHEN ? <> '' AND c.court_code = ? THEN 1 ELSE 0 END) AS related_score
       FROM cases c
       WHERE c.case_id <> ?
         AND ((? <> '' AND c.case_nature = ?) OR (? <> '' AND c.visa_type = ?) OR (? <> '' AND c.court_code = ?))

hook: PostToolUse
hook: PostToolUse Completed
**Reviewing previous codex-review5 findings**
exec
/bin/zsh -lc "rg -n -C 5 \"rebuild_dirty_since|markAggregatesDirty|aggregatesNeedRebuild|aggregate_rebuild_failed|rebuild_applied_generation|BOOKKEEPING_KEYS|mid-scan|mid.*scan|runtime-observed|runtimeObserved|control-row|control row|debounced|awaiting-quiet\" workers/storage/cloudflare.js workers/cloudflare-native.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js docs/ops/aggregate-rebuild-cost-guard.md work/codex-review5.md work/verify-rebuild-sql.py && nl -ba workers/storage/cloudflare.js | sed -n '1020,1250p' && nl -ba workers/cloudflare-native.js | sed -n '1,260p' && nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '1,420p' && nl -ba work/verify-rebuild-sql.py | sed -n '1,500p'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/cloudflare-native.js-194-  const stores = createCloudflareStores(env);
workers/cloudflare-native.js-195-  const minIntervalSeconds = positiveIntOr(
workers/cloudflare-native.js-196-    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
workers/cloudflare-native.js-197-    DEFAULT_REBUILD_INTERVAL_SECONDS,
workers/cloudflare-native.js-198-  );
workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
workers/cloudflare-native.js-200-  if (!decision.due) {
workers/cloudflare-native.js-201-    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
workers/cloudflare-native.js-202-    return decision;
workers/cloudflare-native.js-203-  }
workers/cloudflare-native.js-204-  const startedAt = Date.now();
--
workers/cloudflare-native.js-208-  } catch (error) {
workers/cloudflare-native.js-209-    // A structured failure event: without it, a failed rebuild is only visible
workers/cloudflare-native.js-210-    // as the absence of a completion line, which reads exactly like a healthy
workers/cloudflare-native.js-211-    // debounce.
workers/cloudflare-native.js-212-    console.error(JSON.stringify({
workers/cloudflare-native.js:213:      event: "cloudflare.aggregate_rebuild_failed",
workers/cloudflare-native.js-214-      reason: decision.reason,
workers/cloudflare-native.js-215-      pending_generation: decision.pending_generation ?? null,
workers/cloudflare-native.js-216-      applied_generation: decision.applied_generation ?? null,
workers/cloudflare-native.js-217-      seconds_since_first_pending: decision.seconds_since_first_pending ?? null,
workers/cloudflare-native.js-218-      duration_ms: Date.now() - startedAt,
--
workers/cloudflare-native.js-239- * never be drained and every dashboard would freeze silently — so the queue
workers/cloudflare-native.js-240- * path still refreshes, at most once per fallback window. With a working cron
workers/cloudflare-native.js-241- * the last rebuild is never older than the cron period, and this never fires.
workers/cloudflare-native.js-242- */
workers/cloudflare-native.js-243-async function markStaleAndMaybeRebuild(stores, env) {
workers/cloudflare-native.js:244:  await stores.caseStore.markAggregatesDirty();
workers/cloudflare-native.js-245-  const minIntervalSeconds = positiveIntOr(
workers/cloudflare-native.js-246-    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
workers/cloudflare-native.js-247-    DEFAULT_FALLBACK_INTERVAL_SECONDS,
workers/cloudflare-native.js-248-  );
workers/cloudflare-native.js:249:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
workers/cloudflare-native.js-250-  if (!fallback?.due) return false;
workers/cloudflare-native.js-251-  let result;
workers/cloudflare-native.js-252-  try {
workers/cloudflare-native.js-253-    result = await rebuildUnderLease(stores, env);
workers/cloudflare-native.js-254-  } catch (error) {
workers/cloudflare-native.js-255-    console.error(JSON.stringify({
workers/cloudflare-native.js:256:      event: "cloudflare.aggregate_rebuild_failed",
workers/cloudflare-native.js-257-      path: "queue-fallback",
workers/cloudflare-native.js-258-      reason: fallback.reason,
workers/cloudflare-native.js-259-      pending_generation: fallback.pending_generation ?? null,
workers/cloudflare-native.js-260-      seconds_since_first_pending: fallback.seconds_since_first_pending ?? null,
workers/cloudflare-native.js-261-      error: error?.message ?? String(error),
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-6-  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-7-  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-8-  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-9-  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-10-];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:12:  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-13-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-14-function d1({ responder = () => [], changes = 1, changesFor } = {}) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-15-  const prepared = [];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-16-  const binding = {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-17-    prepared,
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-50-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-51-/** Build the bookkeeping rows the decision query reads. */
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-52-function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-53-  const rows = [];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-54-  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:55:  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-56-  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-57-  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
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
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-70-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-71-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:72:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-73-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74:    // Three control rows committed as one transaction: the generation counter,
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-75-    // the mutation timestamp and the staleness clock (armed only when zero).
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-76-    expect(catalog.prepared).toHaveLength(3);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-77-    expect(catalog.batch).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-78-    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-79-    const statement = catalog.prepared[0];
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-85-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-86-  it("stamps the mutation time and arms the staleness clock", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-87-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-88-    const before = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-89-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-91-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-92-    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-94-    expect(mutation).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-95-    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-96-    expect(dirtySince).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-97-    // The staleness clock only arms when it is currently zero.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-98-    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-100-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-101-  it("never iterates the corpus when marking dirty", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-102-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-103-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-104-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:105:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-106-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:107:    // The only batch is the three control rows - no aggregate DELETE/INSERT.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-108-    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-109-    expect(batched).toHaveLength(3);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-110-    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-111-    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-112-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-113-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-114-  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-115-    const { catalog, value } = env();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-116-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:117:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-118-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-119-    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-120-    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-121-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-122-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-123-  it("reports clean when nothing is pending", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-124-    const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-125-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-126-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:127:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-128-      .resolves.toEqual({ due: false, reason: "clean" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-129-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-130-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-131-  it("stays dirty when a mutation arrives after the applied generation", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-132-    const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-133-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-134-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-135-    // This is the race the boolean flag could not express: the rebuild applied
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-136-    // generation 5, and generation 6 arrived while it was running.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:137:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-138-      .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-139-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-140-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-141-  it("debounces a pending generation inside the interval", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-142-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-143-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-144-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:145:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-146-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-147-    expect(decision.due).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:148:    expect(decision.reason).toBe("debounced");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-149-    expect(decision.seconds_until_due).toBeGreaterThan(0);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-150-    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-151-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-152-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-153-  it("rebuilds when the pending generation is older than the interval", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-154-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-155-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-156-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:157:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-158-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-159-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-160-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-161-  it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-162-    const { value } = env({ responder: () => state({ pending: 1 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-163-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-164-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:165:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-166-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-167-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-168-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-169-  it("falls back to the default interval for invalid input", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-170-    const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-171-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-172-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:173:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-174-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-175-    expect(decision.due).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:176:    expect(decision.reason).toBe("debounced");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-177-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-178-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-179-  it("lets the staleness bound win over a just-stamped attempt", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-180-    // A failed rebuild stamps an attempt; the interval must not postpone work
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-181-    // that has already exceeded the staleness bound.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-182-    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-183-      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-184-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-185-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:186:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-187-      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-188-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-189-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-190-  it("waits for a quiet window before rebuilding", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-191-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-192-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-193-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:194:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-195-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-196-    expect(decision.due).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:197:    expect(decision.reason).toBe("awaiting-quiet");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-198-    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-199-    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-200-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-201-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-202-  it("rebuilds once mutations have been quiet long enough", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-203-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-204-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-205-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:206:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-207-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-208-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-209-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-210-  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-211-    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-212-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-213-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:214:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-215-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-216-    expect(decision.due).toBe(true);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-217-    expect(decision.reason).toBe("max-staleness");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-218-    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-219-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-220-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-221-  it("keeps the legacy behaviour when no quiet window is configured", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-222-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-223-    const stores = createCloudflareStores(value);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-224-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:225:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-226-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-227-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-228-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-229-  it("claims the rebuild lease only when the previous lease has expired", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-230-    const held = env({ changes: 0 });
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-328-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-329-    await stores.caseStore.rebuildAggregates();
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
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:341:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:342:      .resolves.toMatchObject({ due: false, reason: "debounced" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-343-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-344-    const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:345:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-346-      .resolves.toMatchObject({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-347-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-348-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-349-  it("clears and rewrites exactly the documented summary tables", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-350-    const { catalog, value } = env();
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-369-    await stores.caseStore.rebuildAggregates();
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
--
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-381-    const before = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-382-    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-383-    const after = nowSeconds();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-384-
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-385-    const applied = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:386:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-387-    const stamp = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-388-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-389-    const resetDirtySince = catalog.prepared
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-390-      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-391-    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-392-    expect(Number(applied.params[0])).toBe(7);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-393-    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-394-    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:395:    // The disarm is conditional on no mutation arriving mid-scan, so continuous
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-396-    // writes can never reset the staleness clock on every rebuild.
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-397-    expect(resetDirtySince).toBeDefined();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:398:    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-399-    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-400-    expect(Number(resetDirtySince.params[1])).toBe(7);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-401-    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-402-  });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js-403-
--
workers/storage/cloudflare.js-48-}
workers/storage/cloudflare.js-49-
workers/storage/cloudflare.js-50-// catalog_summary doubles as the aggregate-rebuild control table. Its
workers/storage/cloudflare.js-51-// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
workers/storage/cloudflare.js-52-// mid-rebuild still leaves a pending generation behind.
workers/storage/cloudflare.js:53:const AGGREGATE_BOOKKEEPING_KEYS = [
workers/storage/cloudflare.js:54:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/storage/cloudflare.js-55-  "rebuild_last_attempt_at", "rebuild_lease_until",
workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
workers/storage/cloudflare.js-57-];
workers/storage/cloudflare.js-58-
workers/storage/cloudflare.js-59-// The rebuild lease keeps its fencing token in the `updated_at` column of the
workers/storage/cloudflare.js-60-// SAME row that holds the expiry, so claiming, renewing and releasing are each
workers/storage/cloudflare.js-61-// a single atomic statement: a token captured in one column and an expiry in
--
workers/storage/cloudflare.js-1004-  /**
workers/storage/cloudflare.js-1005-   * Rebuild queue-maintained analytics outside the request path.
workers/storage/cloudflare.js-1006-   *
workers/storage/cloudflare.js-1007-   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
workers/storage/cloudflare.js-1008-   * the whole `cases` table, so it must never run once per queue batch. Queue
workers/storage/cloudflare.js:1009:   * work only marks the aggregates dirty (markAggregatesDirty) and the
workers/storage/cloudflare.js-1010-   * scheduled handler coalesces those marks into at most one rebuild per
workers/storage/cloudflare.js:1011:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
workers/storage/cloudflare.js-1012-   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
workers/storage/cloudflare.js-1013-   * $12,060 in D1 write charges.
workers/storage/cloudflare.js-1014-   */
workers/storage/cloudflare.js-1015-  async rebuildAggregates({ lease } = {}) {
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
--
workers/storage/cloudflare.js-1100-    // total_cases/with_full_text, so these keys stay internal). Recording the
workers/storage/cloudflare.js-1101-    // generation observed at the start — not a bare dirty=0 — is what keeps a
workers/storage/cloudflare.js-1102-    // mid-rebuild mutation pending.
workers/storage/cloudflare.js-1103-    statements.push(
workers/storage/cloudflare.js-1104-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1105:        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
workers/storage/cloudflare.js-1106-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js-1107-        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
workers/storage/cloudflare.js-1108-      // Only disarm the staleness clock when nothing arrived while this rebuild
workers/storage/cloudflare.js:1109:      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
workers/storage/cloudflare.js-1110-      // the staleness bound stays reachable under continuous writes.
workers/storage/cloudflare.js-1111-      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
workers/storage/cloudflare.js:1112:         WHERE summary_key = 'rebuild_dirty_since'
workers/storage/cloudflare.js-1113-           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
workers/storage/cloudflare.js-1114-        .bind(now, appliedGeneration),
workers/storage/cloudflare.js-1115-    );
workers/storage/cloudflare.js-1116-    for (let offset = 0; offset < statements.length; offset += 20) {
workers/storage/cloudflare.js-1117-      // While we still own the lease, extend it before each chunk; if another
--
workers/storage/cloudflare.js-1133-   *
workers/storage/cloudflare.js-1134-   * A monotonic generation, not a boolean: a rebuild applies the generation it
workers/storage/cloudflare.js-1135-   * observed when it started, so a mutation landing mid-rebuild stays pending
workers/storage/cloudflare.js-1136-   * instead of being wiped by the rebuild's own bookkeeping write.
workers/storage/cloudflare.js-1137-   */
workers/storage/cloudflare.js:1138:  async markAggregatesDirty() {
workers/storage/cloudflare.js-1139-    const now = Math.floor(Date.now() / 1000);
workers/storage/cloudflare.js-1140-    const stamp = utcNow();
workers/storage/cloudflare.js-1141-    // One batch = one transaction, so two isolates cannot interleave these rows.
workers/storage/cloudflare.js-1142-    await this.db.batch([
workers/storage/cloudflare.js-1143-      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
--
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
--
workers/storage/cloudflare.js-1165-  }
workers/storage/cloudflare.js-1166-
workers/storage/cloudflare.js-1167-  async readAggregateState() {
workers/storage/cloudflare.js-1168-    const current = rows(await this.db.prepare(
workers/storage/cloudflare.js-1169-      `SELECT summary_key, value_int FROM catalog_summary
workers/storage/cloudflare.js:1170:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
workers/storage/cloudflare.js-1171-                              'rebuild_last_attempt_at', 'rebuild_lease_until',
workers/storage/cloudflare.js:1172:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
workers/storage/cloudflare.js-1173-    ).all());
workers/storage/cloudflare.js-1174-    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
workers/storage/cloudflare.js-1175-  }
workers/storage/cloudflare.js-1176-
workers/storage/cloudflare.js-1177-  /**
workers/storage/cloudflare.js-1178-   * Rate-limit decision for the scheduled handler: rebuild only when a
workers/storage/cloudflare.js-1179-   * generation is pending and the last rebuild is older than the interval.
workers/storage/cloudflare.js-1180-   * This is the only guard preventing a bulk import from rewriting the whole
workers/storage/cloudflare.js-1181-   * summary set thousands of times.
workers/storage/cloudflare.js-1182-   */
workers/storage/cloudflare.js:1183:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
workers/storage/cloudflare.js-1184-    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
workers/storage/cloudflare.js-1185-      ? Math.floor(minIntervalSeconds) : 300;
workers/storage/cloudflare.js-1186-    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
workers/storage/cloudflare.js-1187-    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
workers/storage/cloudflare.js-1188-      ? Math.floor(maxStalenessSeconds) : 0;
workers/storage/cloudflare.js-1189-    const state = await this.readAggregateState();
workers/storage/cloudflare.js-1190-    const pending = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1191:    const applied = state.get("rebuild_applied_generation") || 0;
workers/storage/cloudflare.js-1192-    if (pending <= applied) return { due: false, reason: "clean" };
workers/storage/cloudflare.js-1193-
workers/storage/cloudflare.js-1194-    // Throttle on the last *attempt*, not only the last success: a rebuild that
workers/storage/cloudflare.js-1195-    // throws releases its lease without stamping `rebuild_last_at`, and the
workers/storage/cloudflare.js-1196-    // 30-second queue retry must not therefore rebuild on every retry.
workers/storage/cloudflare.js-1197-    const lastSuccessAt = state.get("rebuild_last_at") || 0;
workers/storage/cloudflare.js-1198-    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
workers/storage/cloudflare.js-1199-    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
workers/storage/cloudflare.js-1200-    const nowSeconds = Math.floor(Date.now() / 1000);
workers/storage/cloudflare.js-1201-    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
workers/storage/cloudflare.js:1202:    const dirtySince = state.get("rebuild_dirty_since") || 0;
workers/storage/cloudflare.js-1203-    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
workers/storage/cloudflare.js-1204-    const base = {
workers/storage/cloudflare.js-1205-      pending_generation: pending,
workers/storage/cloudflare.js-1206-      applied_generation: applied,
workers/storage/cloudflare.js-1207-      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
--
workers/storage/cloudflare.js-1213-    if (maxStaleness > 0 && staleness >= maxStaleness) {
workers/storage/cloudflare.js-1214-      return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
workers/storage/cloudflare.js-1215-    }
workers/storage/cloudflare.js-1216-
workers/storage/cloudflare.js-1217-    if (elapsedSeconds < interval) {
workers/storage/cloudflare.js:1218:      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
workers/storage/cloudflare.js-1219-    }
workers/storage/cloudflare.js-1220-
workers/storage/cloudflare.js-1221-    // Quiet window: wait for mutations to stop, so a multi-hour import collapses
workers/storage/cloudflare.js-1222-    // into a single rebuild afterwards.
workers/storage/cloudflare.js-1223-    if (quiet > 0) {
workers/storage/cloudflare.js-1224-      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
workers/storage/cloudflare.js-1225-      const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
workers/storage/cloudflare.js-1226-      if (quietFor < quiet) {
workers/storage/cloudflare.js-1227-        return {
workers/storage/cloudflare.js-1228-          due: false,
workers/storage/cloudflare.js:1229:          reason: "awaiting-quiet",
workers/storage/cloudflare.js-1230-          seconds_until_quiet: quiet - quietFor,
workers/storage/cloudflare.js-1231-          seconds_since_first_pending: staleness,
workers/storage/cloudflare.js-1232-          ...base,
workers/storage/cloudflare.js-1233-        };
workers/storage/cloudflare.js-1234-      }
--
work/verify-rebuild-sql.py-61-
work/verify-rebuild-sql.py-62-def summary() -> dict:
work/verify-rebuild-sql.py-63-    return dict(connection.execute("SELECT summary_key, value_int FROM catalog_summary").fetchall())
work/verify-rebuild-sql.py-64-
work/verify-rebuild-sql.py-65-def bookkeeping_params(statement: dict, observed: int) -> list:
work/verify-rebuild-sql.py:66:    """Bind the runtime-observed generation into the capture-time bookkeeping SQL.
work/verify-rebuild-sql.py-67-
work/verify-rebuild-sql.py-68-    The Worker reads the generation at the start of every rebuild, so the two
work/verify-rebuild-sql.py-69-    statements that consume it (the applied-generation row and the conditional
work/verify-rebuild-sql.py-70-    disarm) must be replayed with the value the harness observed.
work/verify-rebuild-sql.py-71-    """
work/verify-rebuild-sql.py-72-    params = list(statement["params"])
work/verify-rebuild-sql.py:73:    if statement["sql"].startswith("INSERT OR REPLACE") and "'rebuild_applied_generation'" in statement["sql"]:
work/verify-rebuild-sql.py-74-        params[0] = observed
work/verify-rebuild-sql.py-75-    elif statement["sql"].startswith("UPDATE catalog_summary"):
work/verify-rebuild-sql.py-76-        params[-1] = observed
work/verify-rebuild-sql.py-77-    return params
work/verify-rebuild-sql.py-78-
--
work/verify-rebuild-sql.py-84-assert len(rebuild) == 44, f"expected 44 rebuild statements, captured {len(rebuild)}"
work/verify-rebuild-sql.py-85-
work/verify-rebuild-sql.py-86-# 1. Happy path: the whole rebuild runs against the real schema. The staleness
work/verify-rebuild-sql.py-87-#    clock starts armed so the conditional disarm is actually exercised.
work/verify-rebuild-sql.py-88-connection.execute(
work/verify-rebuild-sql.py:89:    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
work/verify-rebuild-sql.py-90-)
work/verify-rebuild-sql.py-91-connection.commit()
work/verify-rebuild-sql.py-92-for statement in rebuild:
work/verify-rebuild-sql.py-93-    connection.execute(statement["sql"], statement["params"])
work/verify-rebuild-sql.py-94-connection.commit()
work/verify-rebuild-sql.py-95-state = summary()
work/verify-rebuild-sql.py-96-check("rebuild writes total_cases", state.get("total_cases") == 3, state)
work/verify-rebuild-sql.py-97-check("rebuild writes with_full_text", state.get("with_full_text") == 2, state)
work/verify-rebuild-sql.py-98-check("rebuild stamps last rebuild time", abs(state.get("rebuild_last_at", 0) - int(time.time())) < 60, state)
work/verify-rebuild-sql.py-99-check("rebuild applies the generation it observed",
work/verify-rebuild-sql.py:100:      state.get("rebuild_applied_generation") == state.get("rebuild_generation", 0), state)
work/verify-rebuild-sql.py-101-
work/verify-rebuild-sql.py-102-counts = {
work/verify-rebuild-sql.py-103-    "aggregate_court_year_outcome": connection.execute("SELECT COUNT(*) FROM aggregate_court_year_outcome").fetchone()[0],
work/verify-rebuild-sql.py-104-    "aggregate_visa": connection.execute("SELECT COUNT(*) FROM aggregate_visa").fetchone()[0],
work/verify-rebuild-sql.py-105-    "aggregate_concept_pair": connection.execute("SELECT COUNT(*) FROM aggregate_concept_pair").fetchone()[0],
work/verify-rebuild-sql.py-106-    "filter_options": connection.execute("SELECT COUNT(*) FROM filter_options").fetchone()[0],
work/verify-rebuild-sql.py-107-}
work/verify-rebuild-sql.py-108-check("aggregates are populated", all(v > 0 for v in counts.values()), counts)
work/verify-rebuild-sql.py-109-check("bookkeeping rows exist after the rebuild",
work/verify-rebuild-sql.py:110:      {"rebuild_applied_generation", "rebuild_last_at"} <= set(state), list(state))
work/verify-rebuild-sql.py-111-check("a clean rebuild disarms the staleness clock",
work/verify-rebuild-sql.py:112:      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))
work/verify-rebuild-sql.py-113-
work/verify-rebuild-sql.py-114-# 2. The race the boolean flag could not express: a mutation lands after the
work/verify-rebuild-sql.py-115-#    aggregate scan but before the bookkeeping write.
work/verify-rebuild-sql.py:116:connection.execute("DELETE FROM catalog_summary WHERE summary_key NOT IN ('rebuild_generation','rebuild_applied_generation','rebuild_last_at','rebuild_lease_until')")
work/verify-rebuild-sql.py-117-connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_generation', 5, 'seed')")
work/verify-rebuild-sql.py:118:connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_applied_generation', 4, 'seed')")
work/verify-rebuild-sql.py-119-connection.commit()
work/verify-rebuild-sql.py-120-
work/verify-rebuild-sql.py-121-# The Worker re-reads the generation at the start of every rebuild, so bind the
work/verify-rebuild-sql.py:122:# runtime-observed value here rather than the capture-time parameter.
work/verify-rebuild-sql.py-123-observed = connection.execute(
work/verify-rebuild-sql.py-124-    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
work/verify-rebuild-sql.py-125-).fetchone()[0]
work/verify-rebuild-sql.py-126-assert observed == 5, observed
work/verify-rebuild-sql.py-127-for statement in aggregate_work:
work/verify-rebuild-sql.py-128-    connection.execute(statement["sql"], statement["params"])
work/verify-rebuild-sql.py-129-dirty = [s for s in statements if s["phase"] == "mark_dirty"]
work/verify-rebuild-sql.py-130-for statement in dirty:                                    # ← mutation mid-rebuild
work/verify-rebuild-sql.py-131-    connection.execute(statement["sql"], statement["params"])
work/verify-rebuild-sql.py-132-armed = connection.execute(
work/verify-rebuild-sql.py:133:    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
work/verify-rebuild-sql.py-134-).fetchone()
work/verify-rebuild-sql.py-135-check("a mutation arms the staleness clock", bool(armed) and armed[0] > 0, armed)
work/verify-rebuild-sql.py-136-for statement in bookkeeping:
work/verify-rebuild-sql.py-137-    connection.execute(statement["sql"], bookkeeping_params(statement, observed))
work/verify-rebuild-sql.py-138-connection.commit()
work/verify-rebuild-sql.py-139-
work/verify-rebuild-sql.py-140-state = summary()
work/verify-rebuild-sql.py-141-check("mid-rebuild mutation stays pending",
work/verify-rebuild-sql.py:142:      state.get("rebuild_generation", 0) > state.get("rebuild_applied_generation", 0), state)
work/verify-rebuild-sql.py:143:check("applied generation equals the pre-scan snapshot", state.get("rebuild_applied_generation") == 5, state)
work/verify-rebuild-sql.py:144:check("a mid-scan mutation keeps the staleness clock armed",
work/verify-rebuild-sql.py:145:      state.get("rebuild_dirty_since", 0) > 0, state.get("rebuild_dirty_since"))
work/verify-rebuild-sql.py-146-
work/verify-rebuild-sql.py-147-decision_sql = [s for s in statements if s["phase"] == "decision"][0]
work/verify-rebuild-sql.py-148-rows = {row[0]: row[1] for row in connection.execute(decision_sql["sql"], decision_sql["params"]).fetchall()}
work/verify-rebuild-sql.py-149-check("decision query sees the pending generation",
work/verify-rebuild-sql.py:150:      rows.get("rebuild_generation", 0) > rows.get("rebuild_applied_generation", 0), rows)
work/verify-rebuild-sql.py-151-
work/verify-rebuild-sql.py-152-# 3. Lease semantics under real SQLite: the conditional upsert must only win
work/verify-rebuild-sql.py-153-#    when the held lease has expired.
work/verify-rebuild-sql.py-154-lease_claim = [s for s in statements if s["phase"] == "lease_claim"]
work/verify-rebuild-sql.py-155-claim = lease_claim[0]
--
work/verify-rebuild-sql.py-204-
work/verify-rebuild-sql.py-205-# 4. Dirty upsert stays a single row and keeps other summaries intact.
work/verify-rebuild-sql.py-206-mark_dirty = [s for s in statements if s["phase"] == "mark_dirty"]
work/verify-rebuild-sql.py-207-generation_write = mark_dirty[0]
work/verify-rebuild-sql.py-208-mutation_write = next(s for s in mark_dirty if "rebuild_last_mutation_at" in s["sql"])
work/verify-rebuild-sql.py:209:dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
work/verify-rebuild-sql.py-210-for statement in (generation_write, mutation_write, dirty_since_write):
work/verify-rebuild-sql.py-211-    connection.execute(statement["sql"], statement["params"])
work/verify-rebuild-sql.py-212-connection.execute(mutation_write["sql"], mutation_write["params"])
work/verify-rebuild-sql.py:213:first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
work/verify-rebuild-sql.py-214-connection.execute(mutation_write["sql"], mutation_write["params"])
work/verify-rebuild-sql.py:215:second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
work/verify-rebuild-sql.py-216-check("staleness clock arms on the first mutation only", first_arm == second_arm and first_arm > 0, (first_arm, second_arm))
work/verify-rebuild-sql.py-217-last_mutation = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_last_mutation_at'").fetchone()[0]
work/verify-rebuild-sql.py-218-check("mutation timestamp is refreshed", abs(last_mutation - int(time.time())) < 60, last_mutation)
work/verify-rebuild-sql.py-219-# The disarm is conditional: a rebuild that applied the generation it observed
work/verify-rebuild-sql.py-220-# (nothing new arrived) clears the clock, one that observed an older generation
--
work/verify-rebuild-sql.py-223-    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
work/verify-rebuild-sql.py-224-).fetchone()[0]
work/verify-rebuild-sql.py-225-for statement in bookkeeping:
work/verify-rebuild-sql.py-226-    connection.execute(statement["sql"], bookkeeping_params(statement, observed_now))
work/verify-rebuild-sql.py-227-connection.commit()
work/verify-rebuild-sql.py:228:reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
work/verify-rebuild-sql.py-229-check("rebuild with nothing new disarms the staleness clock", reset == 0, reset)
work/verify-rebuild-sql.py-230-
work/verify-rebuild-sql.py-231-for _ in range(3):
work/verify-rebuild-sql.py-232-    connection.execute(generation_write["sql"], generation_write["params"])
work/verify-rebuild-sql.py-233-connection.commit()
--
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
--
docs/ops/aggregate-rebuild-cost-guard.md-40-internal keys, none of which reach API responses (`getStats()` reads only
docs/ops/aggregate-rebuild-cost-guard.md-41-`total_cases` / `with_full_text`). No D1 migration is required.
docs/ops/aggregate-rebuild-cost-guard.md-42-
docs/ops/aggregate-rebuild-cost-guard.md-43-| Key | Written by | Meaning |
docs/ops/aggregate-rebuild-cost-guard.md-44-|---|---|---|
docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:46:| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
docs/ops/aggregate-rebuild-cost-guard.md-47-| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
docs/ops/aggregate-rebuild-cost-guard.md-48-| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
docs/ops/aggregate-rebuild-cost-guard.md:51:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
docs/ops/aggregate-rebuild-cost-guard.md-52-| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
docs/ops/aggregate-rebuild-cost-guard.md-53-
docs/ops/aggregate-rebuild-cost-guard.md:54:"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
docs/ops/aggregate-rebuild-cost-guard.md-55-would be wrong: a rebuild that starts at generation 5 and takes a minute can be
docs/ops/aggregate-rebuild-cost-guard.md-56-interleaved with a mutation, and a plain `dirty = 0` write at the end would
docs/ops/aggregate-rebuild-cost-guard.md-57-discard that mutation's pending state and leave the dashboard permanently stale.
docs/ops/aggregate-rebuild-cost-guard.md-58-The rebuild therefore snapshots the generation *before* it scans and records that
docs/ops/aggregate-rebuild-cost-guard.md-59-value as applied — anything that arrived meanwhile stays pending and the next
--
docs/ops/aggregate-rebuild-cost-guard.md-80-- The `finally` release is therefore safe even on the abort path.
docs/ops/aggregate-rebuild-cost-guard.md-81-
docs/ops/aggregate-rebuild-cost-guard.md-82-The attempt timestamp is the second half of the same problem: a rebuild that
docs/ops/aggregate-rebuild-cost-guard.md-83-throws releases its lease but never writes `rebuild_last_at`, so throttling on
docs/ops/aggregate-rebuild-cost-guard.md-84-success alone would let a retry storm rebuild on every 30-second queue retry.
docs/ops/aggregate-rebuild-cost-guard.md:85:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
docs/ops/aggregate-rebuild-cost-guard.md-86-
docs/ops/aggregate-rebuild-cost-guard.md-87-## Cost envelope after the change
docs/ops/aggregate-rebuild-cost-guard.md-88-
docs/ops/aggregate-rebuild-cost-guard.md-89-| Scenario | Before | After (300 s interval) |
docs/ops/aggregate-rebuild-cost-guard.md-90-|---|---|---|
docs/ops/aggregate-rebuild-cost-guard.md:91:| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
docs/ops/aggregate-rebuild-cost-guard.md:92:| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
docs/ops/aggregate-rebuild-cost-guard.md-93-| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
docs/ops/aggregate-rebuild-cost-guard.md-94-| Dashboard freshness | per batch | ≤ 5 minutes stale |
docs/ops/aggregate-rebuild-cost-guard.md-95-| Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
docs/ops/aggregate-rebuild-cost-guard.md-96-
docs/ops/aggregate-rebuild-cost-guard.md-97-### Quiet window (why an import costs cents, not dollars)
--
docs/ops/aggregate-rebuild-cost-guard.md-174-
docs/ops/aggregate-rebuild-cost-guard.md-175-- [ ] Cron trigger present and firing every 5 minutes.
docs/ops/aggregate-rebuild-cost-guard.md-176-- [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
docs/ops/aggregate-rebuild-cost-guard.md-177-      shows the rebuild statements running a handful of times per hour, not per batch.
docs/ops/aggregate-rebuild-cost-guard.md-178-- [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
docs/ops/aggregate-rebuild-cost-guard.md:179:- [ ] After the first mutation following deploy, `rebuild_applied_generation`
docs/ops/aggregate-rebuild-cost-guard.md-180-      catches up with `rebuild_generation` within one cron period (proves the
docs/ops/aggregate-rebuild-cost-guard.md-181-      trigger is wired, not just present).
docs/ops/aggregate-rebuild-cost-guard.md-182-- [ ] D1 rows written per day returns to a low baseline (monitor with the local
docs/ops/aggregate-rebuild-cost-guard.md-183-      `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
docs/ops/aggregate-rebuild-cost-guard.md-184-- [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
docs/ops/aggregate-rebuild-cost-guard.md-185-      presence means the cron trigger is not draining the dirty flag.
docs/ops/aggregate-rebuild-cost-guard.md-186-- [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
docs/ops/aggregate-rebuild-cost-guard.md:187:      shows `rebuild_applied_generation` catching up with `rebuild_generation`
docs/ops/aggregate-rebuild-cost-guard.md-188-      after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
docs/ops/aggregate-rebuild-cost-guard.md:189:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
docs/ops/aggregate-rebuild-cost-guard.md:190:      `rebuild_applied_generation` does **not** chase it until the import goes
docs/ops/aggregate-rebuild-cost-guard.md-191-      quiet — that is the quiet window working, not a stalled pipeline.
docs/ops/aggregate-rebuild-cost-guard.md-192-- [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
docs/ops/aggregate-rebuild-cost-guard.md-193-      is normal; constant entries mean rebuilds take longer than the lease.
docs/ops/aggregate-rebuild-cost-guard.md-194-- [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
docs/ops/aggregate-rebuild-cost-guard.md-195-      normal operation; a widening gap means rebuilds are failing and being
--
work/codex-review5.md-18-Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
work/codex-review5.md-19-Branch: fix/aggregate-rebuild-debounce, HEAD e30f910 (vs 30999fb). Earlier commits ed49b15 + 30999fb were already reviewed and approved in a fourth pass; review ONLY the e30f910 delta unless it invalidates something older.
work/codex-review5.md-20-
work/codex-review5.md-21-WHAT CHANGED (the problem it solves)
work/codex-review5.md-22-The previous design rebuilt at most once per AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS (300 s). During a four-hour bulk import that still meant ~48 rebuilds ≈ $28, because every interval found pending work. The delta:
work/codex-review5.md:23:- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
work/codex-review5.md:24:- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
work/codex-review5.md:25:- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
work/codex-review5.md-26-- Worker entry: `rebuildDecisionParams()` supplies `quietSeconds` from `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) and `maxStalenessSeconds` from `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) for both the cron path and the queue fallback.
work/codex-review5.md-27-- Config/docs/tests updated; four AGGREGATE_REBUILD_* vars + the cron are in wrangler.toml and the operator example.
work/codex-review5.md-28-
work/codex-review5.md-29-VERIFY ADVERSARIALLY (cite file:line, severity, concrete fix)
work/codex-review5.md:30:1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
work/codex-review5.md:31:2. Ordering of the three checks: can `max-staleness` be masked by `debounced`, or can a failing rebuild keep the pipeline permanently in `debounced`/`awaiting-quiet`? Is `waiting` distinguishable from a broken pipeline in the logs?
work/codex-review5.md:32:3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
work/codex-review5.md-33-4. Does the extra write per mutation (3 statements instead of 1) change the cost story the docs claim (~$0.58 per import), and are the new keys genuinely excluded from the rebuild's DELETE?
work/codex-review5.md-34-5. Do the new tests fail if the quiet window, the bound, or the arming edge is removed? Name the test per invariant.
work/codex-review5.md-35-
work/codex-review5.md-36-ALREADY VERIFIED BY THE AUTHOR (do not re-derive): Worker Vitest 27 files / 388 tests; real-SQLite harness 24/24 (including "staleness clock arms on the first mutation only", "mutation timestamp is refreshed", "rebuild disarms the staleness clock", the generation race replay and lease fencing); bundle closure passes; the native-config gate output is unchanged.
work/codex-review5.md-37-
--
work/codex-review5.md-91- 
work/codex-review5.md-92- ## What changed
work/codex-review5.md-93- 
work/codex-review5.md-94- | File | Change |
work/codex-review5.md-95- |---|---|
work/codex-review5.md:96: | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
work/codex-review5.md:97: | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
work/codex-review5.md-98- | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
work/codex-review5.md-99- | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
work/codex-review5.md-100- | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
work/codex-review5.md-101- | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
work/codex-review5.md-102- 
--
work/codex-review5.md-106- internal keys, none of which reach API responses (`getStats()` reads only
work/codex-review5.md-107- `total_cases` / `with_full_text`). No D1 migration is required.
work/codex-review5.md-108- 
work/codex-review5.md-109- | Key | Written by | Meaning |
work/codex-review5.md-110- |---|---|---|
work/codex-review5.md:111: | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
work/codex-review5.md:112: | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
work/codex-review5.md-113- | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
work/codex-review5.md-114- | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
work/codex-review5.md:115:+| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
work/codex-review5.md:116:+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
work/codex-review5.md-117- | `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
work/codex-review5.md-118- 
work/codex-review5.md:119: "Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
work/codex-review5.md-120- would be wrong: a rebuild that starts at generation 5 and takes a minute can be
work/codex-review5.md-121- interleaved with a mutation, and a plain `dirty = 0` write at the end would
work/codex-review5.md-122- discard that mutation's pending state and leave the dashboard permanently stale.
work/codex-review5.md-123- The rebuild therefore snapshots the generation *before* it scans and records that
work/codex-review5.md-124- value as applied — anything that arrived meanwhile stays pending and the next
--
work/codex-review5.md-145- - The `finally` release is therefore safe even on the abort path.
work/codex-review5.md-146- 
work/codex-review5.md-147- The attempt timestamp is the second half of the same problem: a rebuild that
work/codex-review5.md-148- throws releases its lease but never writes `rebuild_last_at`, so throttling on
work/codex-review5.md-149- success alone would let a retry storm rebuild on every 30-second queue retry.
work/codex-review5.md:150: `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
work/codex-review5.md-151- 
work/codex-review5.md-152- ## Cost envelope after the change
work/codex-review5.md-153- 
work/codex-review5.md-154- | Scenario | Before | After (300 s interval) |
work/codex-review5.md-155- |---|---|---|
--
work/codex-review5.md-238- 
work/codex-review5.md-239- - [ ] Cron trigger present and firing every 5 minutes.
work/codex-review5.md-240- - [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
work/codex-review5.md-241-       shows the rebuild statements running a handful of times per hour, not per batch.
work/codex-review5.md-242- - [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
work/codex-review5.md:243: - [ ] After the first mutation following deploy, `rebuild_applied_generation`
work/codex-review5.md-244-       catches up with `rebuild_generation` within one cron period (proves the
work/codex-review5.md-245-       trigger is wired, not just present).
work/codex-review5.md-246- - [ ] D1 rows written per day returns to a low baseline (monitor with the local
work/codex-review5.md-247-       `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
work/codex-review5.md-248- - [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
work/codex-review5.md-249-       presence means the cron trigger is not draining the dirty flag.
work/codex-review5.md-250- - [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
work/codex-review5.md:251:       shows `rebuild_applied_generation` catching up with `rebuild_generation`
work/codex-review5.md-252-       after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
work/codex-review5.md:253:+- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
work/codex-review5.md:254:+      `rebuild_applied_generation` does **not** chase it until the import goes
work/codex-review5.md-255-+      quiet — that is the quiet window working, not a stalled pipeline.
work/codex-review5.md-256- - [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
work/codex-review5.md-257-       is normal; constant entries mean rebuilds take longer than the lease.
work/codex-review5.md-258- - [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
work/codex-review5.md-259-       normal operation; a widening gap means rebuilds are failing and being
--
work/codex-review5.md-297-   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
work/codex-review5.md-298-   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
work/codex-review5.md-299-   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
work/codex-review5.md-300-   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
work/codex-review5.md-301- ];
work/codex-review5.md:302: const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
work/codex-review5.md-303- 
work/codex-review5.md-304- function d1({ responder = () => [], changes = 1, changesFor } = {}) {
work/codex-review5.md-305-   const prepared = [];
work/codex-review5.md-306-   const binding = {
work/codex-review5.md-307-     prepared,
--
work/codex-review5.md-341- /** Build the bookkeeping rows the decision query reads. */
work/codex-review5.md-342--function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken } = {}) {
work/codex-review5.md-343-+function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
work/codex-review5.md-344-   const rows = [];
work/codex-review5.md-345-   if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
work/codex-review5.md:346:   if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
work/codex-review5.md-347-   if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
work/codex-review5.md-348-   if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
work/codex-review5.md-349-   if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
work/codex-review5.md-350-   if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
work/codex-review5.md-351-+  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
work/codex-review5.md:352:+  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
work/codex-review5.md-353-   return rows;
work/codex-review5.md-354- }
work/codex-review5.md-355- 
work/codex-review5.md-356- const nowSeconds = () => Math.floor(Date.now() / 1000);
work/codex-review5.md-357- 
work/codex-review5.md-358- describe("Catalog aggregate rebuild guard", () => {
work/codex-review5.md-359-   it("records staleness as a monotonic generation, not a boolean", async () => {
work/codex-review5.md-360-     const { catalog, value } = env();
work/codex-review5.md-361-     const stores = createCloudflareStores(value);
work/codex-review5.md-362- 
work/codex-review5.md:363:     await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-364- 
work/codex-review5.md-365--    expect(catalog.prepared).toHaveLength(1);
work/codex-review5.md-366-+    // Three rows: the generation counter, the mutation timestamp and the
work/codex-review5.md-367-+    // staleness clock (which only arms when it is currently zero).
work/codex-review5.md-368-+    expect(catalog.prepared).toHaveLength(3);
--
work/codex-review5.md-375- 
work/codex-review5.md-376-+  it("stamps the mutation time and arms the staleness clock", async () => {
work/codex-review5.md-377-+    const { catalog, value } = env();
work/codex-review5.md-378-+    const before = nowSeconds();
work/codex-review5.md-379-+
work/codex-review5.md:380:+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
work/codex-review5.md-381-+
work/codex-review5.md-382-+    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
work/codex-review5.md:383:+    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-384-+    expect(mutation).toBeDefined();
work/codex-review5.md-385-+    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
work/codex-review5.md-386-+    expect(dirtySince).toBeDefined();
work/codex-review5.md-387-+    // The staleness clock only arms when it is currently zero.
work/codex-review5.md-388-+    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
--
work/codex-review5.md-390-+
work/codex-review5.md-391-   it("never iterates the corpus when marking dirty", async () => {
work/codex-review5.md-392-     const { catalog, value } = env();
work/codex-review5.md-393-     const stores = createCloudflareStores(value);
work/codex-review5.md-394- 
work/codex-review5.md:395:     await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-396- 
work/codex-review5.md-397-     expect(catalog.batch).not.toHaveBeenCalled();
work/codex-review5.md-398-     expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
work/codex-review5.md-399-   });
work/codex-review5.md-400- 
work/codex-review5.md-401-   it("reports clean when nothing is pending", async () => {
work/codex-review5.md-402-     const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
work/codex-review5.md-403-     const stores = createCloudflareStores(value);
work/codex-review5.md-404- 
work/codex-review5.md:405:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-406-       .resolves.toEqual({ due: false, reason: "clean" });
work/codex-review5.md-407-   });
work/codex-review5.md-408- 
work/codex-review5.md-409-   it("stays dirty when a mutation arrives after the applied generation", async () => {
work/codex-review5.md-410-     const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-411-     const stores = createCloudflareStores(value);
work/codex-review5.md-412- 
work/codex-review5.md-413-     // This is the race the boolean flag could not express: the rebuild applied
work/codex-review5.md-414-     // generation 5, and generation 6 arrived while it was running.
work/codex-review5.md:415:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-416-       .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
work/codex-review5.md-417-   });
work/codex-review5.md-418- 
work/codex-review5.md-419-   it("debounces a pending generation inside the interval", async () => {
work/codex-review5.md-420-     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
work/codex-review5.md-421-     const stores = createCloudflareStores(value);
work/codex-review5.md-422- 
work/codex-review5.md:423:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
work/codex-review5.md-424- 
work/codex-review5.md-425-     expect(decision.due).toBe(false);
work/codex-review5.md:426:     expect(decision.reason).toBe("debounced");
work/codex-review5.md-427-     expect(decision.seconds_until_due).toBeGreaterThan(0);
work/codex-review5.md-428-     expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
work/codex-review5.md-429-   });
work/codex-review5.md-430- 
work/codex-review5.md-431-   it("rebuilds when the pending generation is older than the interval", async () => {
work/codex-review5.md-432-     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-433-     const stores = createCloudflareStores(value);
work/codex-review5.md-434- 
work/codex-review5.md:435:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-436-       .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-437-   });
work/codex-review5.md-438- 
work/codex-review5.md-439-   it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
work/codex-review5.md-440-     const { value } = env({ responder: () => state({ pending: 1 }) });
work/codex-review5.md-441-     const stores = createCloudflareStores(value);
work/codex-review5.md-442- 
work/codex-review5.md:443:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-444-       .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-445-   });
work/codex-review5.md-446- 
work/codex-review5.md-447-   it("falls back to the default interval for invalid input", async () => {
work/codex-review5.md-448-     const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
work/codex-review5.md-449-     const stores = createCloudflareStores(value);
work/codex-review5.md-450- 
work/codex-review5.md:451:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
work/codex-review5.md-452- 
work/codex-review5.md-453-     expect(decision.due).toBe(false);
work/codex-review5.md:454:     expect(decision.reason).toBe("debounced");
work/codex-review5.md-455-   });
work/codex-review5.md-456- 
work/codex-review5.md-457-+  it("waits for a quiet window before rebuilding", async () => {
work/codex-review5.md-458-+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
work/codex-review5.md-459-+    const stores = createCloudflareStores(value);
work/codex-review5.md-460-+
work/codex-review5.md:461:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-462-+
work/codex-review5.md-463-+    expect(decision.due).toBe(false);
work/codex-review5.md:464:+    expect(decision.reason).toBe("awaiting-quiet");
work/codex-review5.md-465-+    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
work/codex-review5.md-466-+    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
work/codex-review5.md-467-+  });
work/codex-review5.md-468-+
work/codex-review5.md-469-+  it("rebuilds once mutations have been quiet long enough", async () => {
work/codex-review5.md-470-+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
work/codex-review5.md-471-+    const stores = createCloudflareStores(value);
work/codex-review5.md-472-+
work/codex-review5.md:473:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
work/codex-review5.md-474-+      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-475-+  });
work/codex-review5.md-476-+
work/codex-review5.md-477-+  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
work/codex-review5.md-478-+    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
work/codex-review5.md-479-+    const stores = createCloudflareStores(value);
work/codex-review5.md-480-+
work/codex-review5.md:481:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-482-+
work/codex-review5.md-483-+    expect(decision.due).toBe(true);
work/codex-review5.md-484-+    expect(decision.reason).toBe("max-staleness");
work/codex-review5.md-485-+    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
work/codex-review5.md-486-+  });
work/codex-review5.md-487-+
work/codex-review5.md-488-+  it("keeps the legacy behaviour when no quiet window is configured", async () => {
work/codex-review5.md-489-+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
work/codex-review5.md-490-+    const stores = createCloudflareStores(value);
work/codex-review5.md-491-+
work/codex-review5.md:492:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-493-+      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-494-+  });
work/codex-review5.md-495-+
work/codex-review5.md-496-   it("claims the rebuild lease only when the previous lease has expired", async () => {
work/codex-review5.md-497-     const held = env({ changes: 0 });
--
work/codex-review5.md-600- 
work/codex-review5.md-601-   it("throttles a retry after a failed rebuild", async () => {
work/codex-review5.md-602-     // A failed rebuild releases its lease without stamping rebuild_last_at, so
work/codex-review5.md-603-     // the decision must also consider the attempt stamp.
work/codex-review5.md-604-     const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
work/codex-review5.md:605:     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:606:       .resolves.toMatchObject({ due: false, reason: "debounced" });
work/codex-review5.md-607- 
work/codex-review5.md-608-     const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
work/codex-review5.md:609:     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-610-       .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-611-   });
work/codex-review5.md-612- 
work/codex-review5.md-613-   it("clears and rewrites exactly the documented summary tables", async () => {
work/codex-review5.md-614-     const { catalog, value } = env();
--
work/codex-review5.md-634-     await stores.caseStore.rebuildAggregates();
work/codex-review5.md-635- 
work/codex-review5.md-636-     const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
work/codex-review5.md-637-     expect(summaryDelete).toBeDefined();
work/codex-review5.md-638-     expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
work/codex-review5.md:639:     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
work/codex-review5.md-640-   });
work/codex-review5.md-641- 
work/codex-review5.md-642-   it("records the generation observed before the scan, not a bare clean flag", async () => {
work/codex-review5.md-643-     const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-644-     const stores = createCloudflareStores(value);
--
work/codex-review5.md-646-     const before = nowSeconds();
work/codex-review5.md-647-     await stores.caseStore.rebuildAggregates();
work/codex-review5.md-648-     const after = nowSeconds();
work/codex-review5.md-649- 
work/codex-review5.md-650-     const applied = catalog.prepared
work/codex-review5.md:651:       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
work/codex-review5.md-652-     const stamp = catalog.prepared
work/codex-review5.md-653-       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
work/codex-review5.md-654-+    const resetDirtySince = catalog.prepared
work/codex-review5.md:655:+      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-656-     expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
work/codex-review5.md-657-     expect(Number(applied.params[0])).toBe(7);
work/codex-review5.md-658-     expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
work/codex-review5.md-659-     expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
work/codex-review5.md-660-+    expect(resetDirtySince).toBeDefined();
work/codex-review5.md:661:+    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
work/codex-review5.md-662-     expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
work/codex-review5.md-663-   });
work/codex-review5.md-664- 
work/codex-review5.md-665-   it("batches the rebuild statements in bounded chunks", async () => {
work/codex-review5.md-666-     const { catalog, value } = env();
--
work/codex-review5.md-691-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-692-     expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({ contentType: "text/plain; charset=utf-8" }));
work/codex-review5.md-693-     expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith("0123456789ab", expect.any(Array), expect.objectContaining({ court_code: "FCA", year: 2026 }));
work/codex-review5.md-694-     expect(current.caseStore.markSemanticReady).toHaveBeenCalledWith("0123456789ab", "mutation-1");
work/codex-review5.md-695-     // A queue batch must never pay for a full rebuild; it only flags staleness.
work/codex-review5.md:696:     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-697-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-698-     expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-699-     expect(message.retry).not.toHaveBeenCalled();
work/codex-review5.md-700-   });
work/codex-review5.md-701- 
--
work/codex-review5.md-726-       ack: vi.fn(), retry: vi.fn(),
work/codex-review5.md-727-     };
work/codex-review5.md-728-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-729-     expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({ key: message.body.payload_key }), expect.objectContaining({ prefix: "pipeline" }));
work/codex-review5.md-730-     expect(mockCoordinate).toHaveBeenCalledWith(expect.objectContaining({ eventId: message.body.event_id, runId: "run", canonicalText: "canonical text" }));
work/codex-review5.md:731:     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-732-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-733-     expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-734-   });
work/codex-review5.md-735- 
work/codex-review5.md-736-   it("flags catalog aggregates as stale for a mutation-triggered refresh event", async () => {
--
work/codex-review5.md-740-       body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
work/codex-review5.md-741-       ack: vi.fn(),
work/codex-review5.md-742-       retry: vi.fn(),
work/codex-review5.md-743-     };
work/codex-review5.md-744-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md:745:     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-746-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-747-     expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-748-     expect(message.retry).not.toHaveBeenCalled();
work/codex-review5.md-749-   });
work/codex-review5.md-750- 
work/codex-review5.md-751-   it("uses the fallback rebuild only when the cron path has gone quiet", async () => {
work/codex-review5.md-752-     const current = stores();
work/codex-review5.md:753:     current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md-754-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-755-     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-756- 
work/codex-review5.md-757-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });
work/codex-review5.md-758- 
work/codex-review5.md:759:     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:760:-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800 });
work/codex-review5.md:761:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-762-     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
work/codex-review5.md-763-     expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
work/codex-review5.md-764-     expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
work/codex-review5.md-765-   });
work/codex-review5.md-766- 
--
work/codex-review5.md-769-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-770-     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-771- 
work/codex-review5.md-772-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-773- 
work/codex-review5.md:774:-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600 });
work/codex-review5.md:775:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-776-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-777-   });
work/codex-review5.md-778- 
work/codex-review5.md-779-   it("does not rebuild from the queue path when another invocation holds the lease", async () => {
work/codex-review5.md-780-     const current = stores();
work/codex-review5.md:781:     current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md-782-     current.caseStore.claimRebuildLease.mockResolvedValue(null);
work/codex-review5.md-783-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-784-     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-785- 
work/codex-review5.md-786-     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
--
work/codex-review5.md-800-+      AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800",
work/codex-review5.md-801-+      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
work/codex-review5.md-802-+      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
work/codex-review5.md-803-+    });
work/codex-review5.md-804-+
work/codex-review5.md:805:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md-806-+      minIntervalSeconds: 1800, quietSeconds: 900, maxStalenessSeconds: 43200,
work/codex-review5.md-807-+    });
work/codex-review5.md-808-+  });
work/codex-review5.md-809-+
work/codex-review5.md-810-   it("coalesces many mutations in one batch into a single stale flag", async () => {
--
work/codex-review5.md-815-       ack: vi.fn(),
work/codex-review5.md-816-       retry: vi.fn(),
work/codex-review5.md-817-     }));
work/codex-review5.md-818-     await worker.queue({ messages }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-819-     // 20 mutations used to mean one 584k-row rebuild; now they mean one row.
work/codex-review5.md:820:     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-821-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-822-     for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-823-   });
work/codex-review5.md-824- 
work/codex-review5.md-825-   it("deletes a case source only through its validated R2 pointer", async () => {
--
work/codex-review5.md-864- import worker from "../cloudflare-native.js";
work/codex-review5.md-865- 
work/codex-review5.md-866- function stores(decision = { due: true, reason: "dirty" }) {
work/codex-review5.md-867-   return {
work/codex-review5.md-868-     caseStore: {
work/codex-review5.md:869:       aggregatesNeedRebuild: vi.fn(async () => decision),
work/codex-review5.md-870-       rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
work/codex-review5.md:871:       markAggregatesDirty: vi.fn(async () => true),
work/codex-review5.md-872-       claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
work/codex-review5.md-873-       releaseRebuildLease: vi.fn(async () => true),
work/codex-review5.md-874-     },
work/codex-review5.md-875-   };
work/codex-review5.md-876- }
--
work/codex-review5.md-882-     const current = stores();
work/codex-review5.md-883-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-884- 
work/codex-review5.md-885-     const result = await worker.scheduled({ cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-886- 
work/codex-review5.md:887:-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
work/codex-review5.md:888:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-889-     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
work/codex-review5.md-890-     expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "cron-lease", leaseSeconds: 900 } });
work/codex-review5.md-891-     expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
work/codex-review5.md-892-     expect(result).toMatchObject({ due: true, rebuilt_at: "2026-09-10T00:00:00.000Z" });
work/codex-review5.md-893-   });
work/codex-review5.md-894- 
work/codex-review5.md-895-   it("does not rebuild while the interval is still debouncing", async () => {
work/codex-review5.md:896:     const current = stores({ due: false, reason: "debounced", seconds_until_due: 120 });
work/codex-review5.md-897-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-898- 
work/codex-review5.md-899-     const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-900- 
work/codex-review5.md-901-     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md:902:     expect(result).toMatchObject({ due: false, reason: "debounced" });
work/codex-review5.md-903-   });
work/codex-review5.md-904- 
work/codex-review5.md-905-   it("does not rebuild when nothing changed", async () => {
work/codex-review5.md-906-     const current = stores({ due: false, reason: "clean" });
work/codex-review5.md-907-     mockCreateStores.mockReturnValue(current);
--
work/codex-review5.md-919- 
work/codex-review5.md-920-     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 1800 });
work/codex-review5.md-921-   });
work/codex-review5.md-922- 
work/codex-review5.md-923-   it("honours the configured minimum interval", async () => {
work/codex-review5.md:924:     const current = stores({ due: false, reason: "debounced", seconds_until_due: 30 });
work/codex-review5.md-925-     mockCreateStores.mockReturnValue(current);
work/codex-review5.md-926- 
work/codex-review5.md-927-     await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: "600" });
work/codex-review5.md-928- 
work/codex-review5.md:929:-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600 });
work/codex-review5.md:930:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-931-   });
work/codex-review5.md-932- 
work/codex-review5.md-933-   it("falls back to the default interval when the variable is missing or invalid", async () => {
work/codex-review5.md-934-     for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
work/codex-review5.md:935:       const current = stores({ due: false, reason: "debounced" });
work/codex-review5.md-936-       mockCreateStores.mockReturnValue(current);
work/codex-review5.md-937-       await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
work/codex-review5.md:938:-      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
work/codex-review5.md:939:+      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-940-     }
work/codex-review5.md-941-   });
work/codex-review5.md-942- 
work/codex-review5.md-943-   it("skips the rebuild when another invocation holds the lease", async () => {
work/codex-review5.md-944-     const current = stores();
--
work/codex-review5.md-969-+      IMMI_STORAGE_MODE: "cloudflare",
work/codex-review5.md-970-+      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
work/codex-review5.md-971-+      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
work/codex-review5.md-972-+    });
work/codex-review5.md-973-+
work/codex-review5.md:974:+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md-975-+      minIntervalSeconds: 300, quietSeconds: 120, maxStalenessSeconds: 7200,
work/codex-review5.md-976-+    });
work/codex-review5.md-977-+  });
work/codex-review5.md-978-+
work/codex-review5.md-979-+  it("reports a quiet-window deferral instead of rebuilding", async () => {
work/codex-review5.md:980:+    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
work/codex-review5.md-981-+    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-982-+
work/codex-review5.md-983-+    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-984-+
work/codex-review5.md-985-+    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md:986:+    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
work/codex-review5.md-987-+  });
work/codex-review5.md-988-+
work/codex-review5.md-989-   it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
work/codex-review5.md-990-     const current = stores();
work/codex-review5.md-991-     current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
--
work/codex-review5.md-1139-   const stores = createCloudflareStores(env);
work/codex-review5.md-1140-   const minIntervalSeconds = positiveIntOr(
work/codex-review5.md-1141-     env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
work/codex-review5.md-1142-     DEFAULT_REBUILD_INTERVAL_SECONDS,
work/codex-review5.md-1143-   );
work/codex-review5.md:1144:-  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
work/codex-review5.md:1145:+  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md-1146-   if (!decision.due) {
work/codex-review5.md-1147-     console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
work/codex-review5.md-1148-     return decision;
work/codex-review5.md-1149-   }
work/codex-review5.md-1150-   const startedAt = Date.now();
--
work/codex-review5.md-1168-  * never be drained and every dashboard would freeze silently — so the queue
work/codex-review5.md-1169-  * path still refreshes, at most once per fallback window. With a working cron
work/codex-review5.md-1170-  * the last rebuild is never older than the cron period, and this never fires.
work/codex-review5.md-1171-  */
work/codex-review5.md-1172- async function markStaleAndMaybeRebuild(stores, env) {
work/codex-review5.md:1173:   await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-1174-   const minIntervalSeconds = positiveIntOr(
work/codex-review5.md-1175-     env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
work/codex-review5.md-1176-     DEFAULT_FALLBACK_INTERVAL_SECONDS,
work/codex-review5.md-1177-   );
work/codex-review5.md:1178:-  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
work/codex-review5.md:1179:+  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md-1180-   if (!fallback?.due) return false;
work/codex-review5.md-1181-   const result = await rebuildUnderLease(stores, env);
work/codex-review5.md-1182-   if (result?.skipped) return false;
work/codex-review5.md-1183-   console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
work/codex-review5.md-1184-   return true;
--
work/codex-review5.md-1312- }
work/codex-review5.md-1313- 
work/codex-review5.md-1314- // catalog_summary doubles as the aggregate-rebuild control table. Its
work/codex-review5.md-1315- // bookkeeping keys must survive a rebuild's DELETE so a mutation landing
work/codex-review5.md-1316- // mid-rebuild still leaves a pending generation behind.
work/codex-review5.md:1317: const AGGREGATE_BOOKKEEPING_KEYS = [
work/codex-review5.md:1318:   "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
work/codex-review5.md-1319-   "rebuild_last_attempt_at", "rebuild_lease_until",
work/codex-review5.md:1320:+  "rebuild_last_mutation_at", "rebuild_dirty_since",
work/codex-review5.md-1321- ];
work/codex-review5.md-1322- 
work/codex-review5.md-1323- // The rebuild lease keeps its fencing token in the `updated_at` column of the
work/codex-review5.md-1324- // SAME row that holds the expiry, so claiming, renewing and releasing are each
work/codex-review5.md-1325- // a single atomic statement: a token captured in one column and an expiry in
--
work/codex-review5.md-1474-     // total_cases/with_full_text, so these keys stay internal). Recording the
work/codex-review5.md-1475-     // generation observed at the start — not a bare dirty=0 — is what keeps a
work/codex-review5.md-1476-     // mid-rebuild mutation pending.
work/codex-review5.md-1477-     statements.push(
work/codex-review5.md-1478-       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md:1479:         SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
work/codex-review5.md-1480-       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md-1481-         SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
work/codex-review5.md-1482-+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md:1483:+        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
work/codex-review5.md-1484-     );
work/codex-review5.md-1485-     for (let offset = 0; offset < statements.length; offset += 20) {
work/codex-review5.md-1486-       // While we still own the lease, extend it before each chunk; if another
work/codex-review5.md-1487-       // invocation took over (this run outlived its lease), abort instead of
work/codex-review5.md-1488-       // interleaving DELETEs with it. At most one chunk can overlap.
--
work/codex-review5.md-1502-    *
work/codex-review5.md-1503-    * A monotonic generation, not a boolean: a rebuild applies the generation it
work/codex-review5.md-1504-    * observed when it started, so a mutation landing mid-rebuild stays pending
work/codex-review5.md-1505-    * instead of being wiped by the rebuild's own bookkeeping write.
work/codex-review5.md-1506-    */
work/codex-review5.md:1507:   async markAggregatesDirty() {
work/codex-review5.md-1508-+    const now = Math.floor(Date.now() / 1000);
work/codex-review5.md-1509-+    const stamp = utcNow();
work/codex-review5.md-1510-     await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
work/codex-review5.md-1511-         VALUES ('rebuild_generation', 1, ?)
work/codex-review5.md-1512-       ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
--
work/codex-review5.md-1519-+      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
work/codex-review5.md-1520-+      .bind(now, stamp).run();
work/codex-review5.md-1521-+    // When the pending work first appeared: bounds how stale analytics may get
work/codex-review5.md-1522-+    // while mutations keep arriving without a quiet gap.
work/codex-review5.md-1523-+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
work/codex-review5.md:1524:+        VALUES ('rebuild_dirty_since', ?, ?)
work/codex-review5.md-1525-+      ON CONFLICT(summary_key) DO UPDATE SET
work/codex-review5.md-1526-+        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
work/codex-review5.md-1527-+        updated_at = excluded.updated_at`)
work/codex-review5.md-1528-+      .bind(now, stamp).run();
work/codex-review5.md-1529-     return true;
work/codex-review5.md-1530-   }
work/codex-review5.md-1531- 
work/codex-review5.md-1532-   async readAggregateState() {
work/codex-review5.md-1533-     const current = rows(await this.db.prepare(
work/codex-review5.md-1534-       `SELECT summary_key, value_int FROM catalog_summary
work/codex-review5.md:1535:         WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
work/codex-review5.md-1536--                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
work/codex-review5.md-1537-+                              'rebuild_last_attempt_at', 'rebuild_lease_until',
work/codex-review5.md:1538:+                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
work/codex-review5.md-1539-     ).all());
work/codex-review5.md-1540-     return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
work/codex-review5.md-1541-   }
work/codex-review5.md-1542- 
work/codex-review5.md-1543-   /**
work/codex-review5.md-1544-    * Rate-limit decision for the scheduled handler: rebuild only when a
work/codex-review5.md-1545-    * generation is pending and the last rebuild is older than the interval.
work/codex-review5.md-1546-    * This is the only guard preventing a bulk import from rewriting the whole
work/codex-review5.md-1547-    * summary set thousands of times.
work/codex-review5.md-1548-    */
work/codex-review5.md:1549:-  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
work/codex-review5.md:1550:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
work/codex-review5.md-1551-     const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
work/codex-review5.md-1552-       ? Math.floor(minIntervalSeconds) : 300;
work/codex-review5.md-1553-+    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
work/codex-review5.md-1554-+    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
work/codex-review5.md-1555-+      ? Math.floor(maxStalenessSeconds) : 0;
work/codex-review5.md-1556-     const state = await this.readAggregateState();
work/codex-review5.md-1557-     const pending = state.get("rebuild_generation") || 0;
work/codex-review5.md:1558:     const applied = state.get("rebuild_applied_generation") || 0;
work/codex-review5.md-1559-     if (pending <= applied) return { due: false, reason: "clean" };
work/codex-review5.md-1560-+
work/codex-review5.md-1561-     // Throttle on the last *attempt*, not only the last success: a rebuild that
work/codex-review5.md-1562-     // throws releases its lease without stamping `rebuild_last_at`, and the
work/codex-review5.md-1563-     // 30-second queue retry must not therefore rebuild on every retry.
--
work/codex-review5.md-1566-     const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
work/codex-review5.md-1567--    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
work/codex-review5.md-1568-+    const nowSeconds = Math.floor(Date.now() / 1000);
work/codex-review5.md-1569-+    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
work/codex-review5.md-1570-     if (elapsedSeconds < interval) {
work/codex-review5.md:1571:       return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
work/codex-review5.md-1572-     }
work/codex-review5.md-1573--    return {
work/codex-review5.md-1574--      due: true,
work/codex-review5.md-1575--      reason: "dirty",
work/codex-review5.md-1576-+
work/codex-review5.md:1577:+    const dirtySince = state.get("rebuild_dirty_since") || 0;
work/codex-review5.md-1578-+    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
work/codex-review5.md-1579-+    const base = {
work/codex-review5.md-1580-       pending_generation: pending,
work/codex-review5.md-1581-       applied_generation: applied,
work/codex-review5.md-1582-       seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
--
work/codex-review5.md-1595-+      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
work/codex-review5.md-1596-+      const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
work/codex-review5.md-1597-+      if (quietFor < quiet) {
work/codex-review5.md-1598-+        return {
work/codex-review5.md-1599-+          due: false,
work/codex-review5.md:1600:+          reason: "awaiting-quiet",
work/codex-review5.md-1601-+          seconds_until_quiet: quiet - quietFor,
work/codex-review5.md-1602-+          seconds_since_first_pending: staleness,
work/codex-review5.md-1603-+          ...base,
work/codex-review5.md-1604-+        };
work/codex-review5.md-1605-+      }
--
work/codex-review5.md-1814-hook: PostToolUse
work/codex-review5.md-1815-hook: PostToolUse Completed
work/codex-review5.md-1816-**Planning precise git diff extraction**
work/codex-review5.md-1817-**Starting identifier search**
work/codex-review5.md-1818-exec
work/codex-review5.md:1819:/bin/zsh -c 'grep -n -E "rebuildDecisionParams|markAggregatesDirty|aggregatesNeedRebuild|rebuild_dirty_since|rebuild_last_mutation_at|AGGREGATE_REBUILD_(QUIET|MAX_STALENESS)" workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-native-scheduled-rebuild.test.js config/wrangler-cloudflare-native.toml.example wrangler.toml docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
work/codex-review5.md-1820- succeeded in 0ms:
work/codex-review5.md-1821-workers/cloudflare-native.js:150:function rebuildDecisionParams(env, minIntervalSeconds) {
work/codex-review5.md-1822-workers/cloudflare-native.js:153:    quietSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_QUIET_SECONDS, DEFAULT_QUIET_SECONDS),
work/codex-review5.md-1823-workers/cloudflare-native.js:154:    maxStalenessSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_MAX_STALENESS_SECONDS, DEFAULT_MAX_STALENESS_SECONDS),
work/codex-review5.md:1824:workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md:1825:workers/cloudflare-native.js:227:  await stores.caseStore.markAggregatesDirty();
work/codex-review5.md:1826:workers/cloudflare-native.js:232:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md:1827:workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
work/codex-review5.md:1828:workers/storage/cloudflare.js:1009:   * work only marks the aggregates dirty (markAggregatesDirty) and the
work/codex-review5.md:1829:workers/storage/cloudflare.js:1011:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
work/codex-review5.md:1830:workers/storage/cloudflare.js:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
work/codex-review5.md:1831:workers/storage/cloudflare.js:1133:  async markAggregatesDirty() {
work/codex-review5.md-1832-workers/storage/cloudflare.js:1143:        VALUES ('rebuild_last_mutation_at', ?, ?)
work/codex-review5.md:1833:workers/storage/cloudflare.js:1149:        VALUES ('rebuild_dirty_since', ?, ?)
work/codex-review5.md:1834:workers/storage/cloudflare.js:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
work/codex-review5.md:1835:workers/storage/cloudflare.js:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
work/codex-review5.md:1836:workers/storage/cloudflare.js:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
work/codex-review5.md-1837-workers/storage/cloudflare.js:1214:      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
work/codex-review5.md-1838-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:59:  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
work/codex-review5.md:1839:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
work/codex-review5.md:1840:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:71:    await stores.caseStore.markAggregatesDirty();
work/codex-review5.md:1841:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:87:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
work/codex-review5.md-1842-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:89:    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
work/codex-review5.md:1843:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md:1844:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:102:    await stores.caseStore.markAggregatesDirty();
work/codex-review5.md:1845:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:112:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1846:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:122:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1847:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:130:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
work/codex-review5.md:1848:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:142:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1849:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:150:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1850:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:158:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
work/codex-review5.md:1851:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:168:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1852:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:180:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
work/codex-review5.md:1853:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:188:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1854:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:199:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1855:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:312:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1856:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:316:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:1857:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md:1858:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
work/codex-review5.md:1859:workers/__tests__/cloudflare-native-queue.test.js:30:      markAggregatesDirty: vi.fn(async () => true),
work/codex-review5.md:1860:workers/__tests__/cloudflare-native-queue.test.js:31:      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
work/codex-review5.md:1861:workers/__tests__/cloudflare-native-queue.test.js:87:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:1862:workers/__tests__/cloudflare-native-queue.test.js:122:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:1863:workers/__tests__/cloudflare-native-queue.test.js:136:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:1864:workers/__tests__/cloudflare-native-queue.test.js:144:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md:1865:workers/__tests__/cloudflare-native-queue.test.js:150:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:1866:workers/__tests__/cloudflare-native-queue.test.js:151:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1867:workers/__tests__/cloudflare-native-queue.test.js:164:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1868:workers/__tests__/cloudflare-native-queue.test.js:170:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md-1869-workers/__tests__/cloudflare-native-queue.test.js:190:      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
work/codex-review5.md-1870-workers/__tests__/cloudflare-native-queue.test.js:191:      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
work/codex-review5.md:1871:workers/__tests__/cloudflare-native-queue.test.js:194:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md:1872:workers/__tests__/cloudflare-native-queue.test.js:209:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:1873:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:17:      aggregatesNeedRebuild: vi.fn(async () => decision),
work/codex-review5.md:1874:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:19:      markAggregatesDirty: vi.fn(async () => true),
work/codex-review5.md:1875:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:35:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1876:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:76:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md:1877:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:84:      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-1878-workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:115:      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
work/codex-review5.md-1879-workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:116:      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
work/codex-review5.md:1880:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:119:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md-1881-config/wrangler-cloudflare-native.toml.example:63:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
work/codex-review5.md-1882-config/wrangler-cloudflare-native.toml.example:65:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
work/codex-review5.md-1883-wrangler.toml:102:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
work/codex-review5.md-1884-wrangler.toml:104:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
work/codex-review5.md:1885:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
work/codex-review5.md:1886:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
work/codex-review5.md:1887:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
work/codex-review5.md:1888:docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
work/codex-review5.md:1889:docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
work/codex-review5.md:1890:docs/ops/aggregate-rebuild-cost-guard.md:84:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
work/codex-review5.md-1891-docs/ops/aggregate-rebuild-cost-guard.md:92:| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
work/codex-review5.md-1892-docs/ops/aggregate-rebuild-cost-guard.md:102:`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
work/codex-review5.md-1893-docs/ops/aggregate-rebuild-cost-guard.md:108:The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
work/codex-review5.md-1894-docs/ops/aggregate-rebuild-cost-guard.md:126:- `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
work/codex-review5.md-1895-docs/ops/aggregate-rebuild-cost-guard.md:128:- `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
work/codex-review5.md:1896:docs/ops/aggregate-rebuild-cost-guard.md:188:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
work/codex-review5.md-1897-
work/codex-review5.md-1898-hook: PostToolUse
work/codex-review5.md-1899-hook: PostToolUse Completed
work/codex-review5.md-1900-**Analyzing atomicity of multi-step writes**
work/codex-review5.md-1901-exec
--
work/codex-review5.md-2101-  const stores = createCloudflareStores(env);
work/codex-review5.md-2102-  const minIntervalSeconds = positiveIntOr(
work/codex-review5.md-2103-    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
work/codex-review5.md-2104-    DEFAULT_REBUILD_INTERVAL_SECONDS,
work/codex-review5.md-2105-  );
work/codex-review5.md:2106:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md-2107-  if (!decision.due) {
work/codex-review5.md-2108-    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
work/codex-review5.md-2109-    return decision;
work/codex-review5.md-2110-  }
work/codex-review5.md-2111-  const startedAt = Date.now();
--
work/codex-review5.md-2129- * never be drained and every dashboard would freeze silently — so the queue
work/codex-review5.md-2130- * path still refreshes, at most once per fallback window. With a working cron
work/codex-review5.md-2131- * the last rebuild is never older than the cron period, and this never fires.
work/codex-review5.md-2132- */
work/codex-review5.md-2133-async function markStaleAndMaybeRebuild(stores, env) {
work/codex-review5.md:2134:  await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-2135-  const minIntervalSeconds = positiveIntOr(
work/codex-review5.md-2136-    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
work/codex-review5.md-2137-    DEFAULT_FALLBACK_INTERVAL_SECONDS,
work/codex-review5.md-2138-  );
work/codex-review5.md:2139:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md-2140-  if (!fallback?.due) return false;
work/codex-review5.md-2141-  const result = await rebuildUnderLease(stores, env);
work/codex-review5.md-2142-  if (result?.skipped) return false;
work/codex-review5.md-2143-  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
work/codex-review5.md-2144-  return true;
--
work/codex-review5.md-2181-}
work/codex-review5.md-2182-
work/codex-review5.md-2183-// catalog_summary doubles as the aggregate-rebuild control table. Its
work/codex-review5.md-2184-// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
work/codex-review5.md-2185-// mid-rebuild still leaves a pending generation behind.
work/codex-review5.md:2186:const AGGREGATE_BOOKKEEPING_KEYS = [
work/codex-review5.md:2187:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
work/codex-review5.md-2188-  "rebuild_last_attempt_at", "rebuild_lease_until",
work/codex-review5.md:2189:  "rebuild_last_mutation_at", "rebuild_dirty_since",
work/codex-review5.md-2190-];
work/codex-review5.md-2191-
work/codex-review5.md-2192-// The rebuild lease keeps its fencing token in the `updated_at` column of the
work/codex-review5.md-2193-// SAME row that holds the expiry, so claiming, renewing and releasing are each
work/codex-review5.md-2194-// a single atomic statement: a token captured in one column and an expiry in
--
work/codex-review5.md-2208-  /**
work/codex-review5.md-2209-   * Rebuild queue-maintained analytics outside the request path.
work/codex-review5.md-2210-   *
work/codex-review5.md-2211-   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
work/codex-review5.md-2212-   * the whole `cases` table, so it must never run once per queue batch. Queue
work/codex-review5.md:2213:   * work only marks the aggregates dirty (markAggregatesDirty) and the
work/codex-review5.md-2214-   * scheduled handler coalesces those marks into at most one rebuild per
work/codex-review5.md:2215:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
work/codex-review5.md-2216-   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
work/codex-review5.md-2217-   * $12,060 in D1 write charges.
work/codex-review5.md-2218-   */
work/codex-review5.md-2219-  async rebuildAggregates({ lease } = {}) {
work/codex-review5.md-2220-    const now = utcNow();
work/codex-review5.md-2221-    // Snapshot the pending generation before scanning: anything that arrives
work/codex-review5.md-2222-    // while this rebuild runs must stay pending, not be marked applied.
work/codex-review5.md-2223-    const state = await this.readAggregateState();
work/codex-review5.md-2224-    const appliedGeneration = state.get("rebuild_generation") || 0;
work/codex-review5.md:2225:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
work/codex-review5.md-2226-    const statements = [];
work/codex-review5.md-2227-    for (const table of [
work/codex-review5.md-2228-      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
work/codex-review5.md-2229-      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
work/codex-review5.md-2230-      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
--
work/codex-review5.md-2304-    // total_cases/with_full_text, so these keys stay internal). Recording the
work/codex-review5.md-2305-    // generation observed at the start — not a bare dirty=0 — is what keeps a
work/codex-review5.md-2306-    // mid-rebuild mutation pending.
work/codex-review5.md-2307-    statements.push(
work/codex-review5.md-2308-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md:2309:        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
work/codex-review5.md-2310-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md-2311-        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
work/codex-review5.md-2312-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md:2313:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
work/codex-review5.md-2314-    );
work/codex-review5.md-2315-    for (let offset = 0; offset < statements.length; offset += 20) {
work/codex-review5.md-2316-      // While we still own the lease, extend it before each chunk; if another
work/codex-review5.md-2317-      // invocation took over (this run outlived its lease), abort instead of
work/codex-review5.md-2318-      // interleaving DELETEs with it. At most one chunk can overlap.
--
work/codex-review5.md-2332-   *
work/codex-review5.md-2333-   * A monotonic generation, not a boolean: a rebuild applies the generation it
work/codex-review5.md-2334-   * observed when it started, so a mutation landing mid-rebuild stays pending
work/codex-review5.md-2335-   * instead of being wiped by the rebuild's own bookkeeping write.
work/codex-review5.md-2336-   */
work/codex-review5.md:2337:  async markAggregatesDirty() {
work/codex-review5.md-2338-    const now = Math.floor(Date.now() / 1000);
work/codex-review5.md-2339-    const stamp = utcNow();
work/codex-review5.md-2340-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
work/codex-review5.md-2341-        VALUES ('rebuild_generation', 1, ?)
work/codex-review5.md-2342-      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
--
work/codex-review5.md-2348-      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
work/codex-review5.md-2349-      .bind(now, stamp).run();
work/codex-review5.md-2350-    // When the pending work first appeared: bounds how stale analytics may get
work/codex-review5.md-2351-    // while mutations keep arriving without a quiet gap.
work/codex-review5.md-2352-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
work/codex-review5.md:2353:        VALUES ('rebuild_dirty_since', ?, ?)
work/codex-review5.md-2354-      ON CONFLICT(summary_key) DO UPDATE SET
work/codex-review5.md-2355-        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
work/codex-review5.md-2356-        updated_at = excluded.updated_at`)
work/codex-review5.md-2357-      .bind(now, stamp).run();
work/codex-review5.md-2358-    return true;
work/codex-review5.md-2359-  }
work/codex-review5.md-2360-
work/codex-review5.md-2361-  async readAggregateState() {
work/codex-review5.md-2362-    const current = rows(await this.db.prepare(
work/codex-review5.md-2363-      `SELECT summary_key, value_int FROM catalog_summary
work/codex-review5.md:2364:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
work/codex-review5.md-2365-                              'rebuild_last_attempt_at', 'rebuild_lease_until',
work/codex-review5.md:2366:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
work/codex-review5.md-2367-    ).all());
work/codex-review5.md-2368-    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
work/codex-review5.md-2369-  }
work/codex-review5.md-2370-
work/codex-review5.md-2371-  /**
work/codex-review5.md-2372-   * Rate-limit decision for the scheduled handler: rebuild only when a
work/codex-review5.md-2373-   * generation is pending and the last rebuild is older than the interval.
work/codex-review5.md-2374-   * This is the only guard preventing a bulk import from rewriting the whole
work/codex-review5.md-2375-   * summary set thousands of times.
work/codex-review5.md-2376-   */
work/codex-review5.md:2377:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
work/codex-review5.md-2378-    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
work/codex-review5.md-2379-      ? Math.floor(minIntervalSeconds) : 300;
work/codex-review5.md-2380-    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
work/codex-review5.md-2381-    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
work/codex-review5.md-2382-      ? Math.floor(maxStalenessSeconds) : 0;
work/codex-review5.md-2383-    const state = await this.readAggregateState();
work/codex-review5.md-2384-    const pending = state.get("rebuild_generation") || 0;
work/codex-review5.md:2385:    const applied = state.get("rebuild_applied_generation") || 0;
work/codex-review5.md-2386-    if (pending <= applied) return { due: false, reason: "clean" };
work/codex-review5.md-2387-
work/codex-review5.md-2388-    // Throttle on the last *attempt*, not only the last success: a rebuild that
work/codex-review5.md-2389-    // throws releases its lease without stamping `rebuild_last_at`, and the
work/codex-review5.md-2390-    // 30-second queue retry must not therefore rebuild on every retry.
--
work/codex-review5.md-2392-    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
work/codex-review5.md-2393-    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
work/codex-review5.md-2394-    const nowSeconds = Math.floor(Date.now() / 1000);
work/codex-review5.md-2395-    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
work/codex-review5.md-2396-    if (elapsedSeconds < interval) {
work/codex-review5.md:2397:      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
work/codex-review5.md-2398-    }
work/codex-review5.md-2399-
work/codex-review5.md:2400:    const dirtySince = state.get("rebuild_dirty_since") || 0;
work/codex-review5.md-2401-    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
work/codex-review5.md-2402-    const base = {
work/codex-review5.md-2403-      pending_generation: pending,
work/codex-review5.md-2404-      applied_generation: applied,
work/codex-review5.md-2405-      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
--
work/codex-review5.md-2418-      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
work/codex-review5.md-2419-      const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
work/codex-review5.md-2420-      if (quietFor < quiet) {
work/codex-review5.md-2421-        return {
work/codex-review5.md-2422-          due: false,
work/codex-review5.md:2423:          reason: "awaiting-quiet",
work/codex-review5.md-2424-          seconds_until_quiet: quiet - quietFor,
work/codex-review5.md-2425-          seconds_since_first_pending: staleness,
work/codex-review5.md-2426-          ...base,
work/codex-review5.md-2427-        };
work/codex-review5.md-2428-      }
--
work/codex-review5.md-2430-
work/codex-review5.md-2431-    return { due: true, reason: "dirty", seconds_since_first_pending: staleness, ...base };
work/codex-review5.md-2432-  }
work/codex-review5.md-2433-
work/codex-review5.md-2434-  /**
work/codex-review5.md:2435:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
work/codex-review5.md-2436-  return rows;
work/codex-review5.md-2437-}
work/codex-review5.md-2438-
work/codex-review5.md-2439-const nowSeconds = () => Math.floor(Date.now() / 1000);
work/codex-review5.md-2440-
work/codex-review5.md-2441-describe("Catalog aggregate rebuild guard", () => {
work/codex-review5.md-2442-  it("records staleness as a monotonic generation, not a boolean", async () => {
work/codex-review5.md-2443-    const { catalog, value } = env();
work/codex-review5.md-2444-    const stores = createCloudflareStores(value);
work/codex-review5.md-2445-
work/codex-review5.md:2446:    await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-2447-
work/codex-review5.md-2448-    // Three rows: the generation counter, the mutation timestamp and the
work/codex-review5.md-2449-    // staleness clock (which only arms when it is currently zero).
work/codex-review5.md-2450-    expect(catalog.prepared).toHaveLength(3);
work/codex-review5.md-2451-    const statement = catalog.prepared[0];
--
work/codex-review5.md-2457-
work/codex-review5.md-2458-  it("stamps the mutation time and arms the staleness clock", async () => {
work/codex-review5.md-2459-    const { catalog, value } = env();
work/codex-review5.md-2460-    const before = nowSeconds();
work/codex-review5.md-2461-
work/codex-review5.md:2462:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
work/codex-review5.md-2463-
work/codex-review5.md-2464-    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
work/codex-review5.md:2465:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-2466-    expect(mutation).toBeDefined();
work/codex-review5.md-2467-    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
work/codex-review5.md-2468-    expect(dirtySince).toBeDefined();
work/codex-review5.md-2469-    // The staleness clock only arms when it is currently zero.
work/codex-review5.md-2470-    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
--
work/codex-review5.md-2472-
work/codex-review5.md-2473-  it("never iterates the corpus when marking dirty", async () => {
work/codex-review5.md-2474-    const { catalog, value } = env();
work/codex-review5.md-2475-    const stores = createCloudflareStores(value);
work/codex-review5.md-2476-
work/codex-review5.md:2477:    await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-2478-
work/codex-review5.md-2479-    expect(catalog.batch).not.toHaveBeenCalled();
work/codex-review5.md-2480-    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
work/codex-review5.md-2481-  });
work/codex-review5.md-2482-
work/codex-review5.md-2483-  it("reports clean when nothing is pending", async () => {
work/codex-review5.md-2484-    const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
work/codex-review5.md-2485-    const stores = createCloudflareStores(value);
work/codex-review5.md-2486-
work/codex-review5.md:2487:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2488-      .resolves.toEqual({ due: false, reason: "clean" });
work/codex-review5.md-2489-  });
work/codex-review5.md-2490-
work/codex-review5.md-2491-  it("stays dirty when a mutation arrives after the applied generation", async () => {
work/codex-review5.md-2492-    const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-2493-    const stores = createCloudflareStores(value);
work/codex-review5.md-2494-
work/codex-review5.md-2495-    // This is the race the boolean flag could not express: the rebuild applied
work/codex-review5.md-2496-    // generation 5, and generation 6 arrived while it was running.
work/codex-review5.md:2497:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2498-      .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
work/codex-review5.md-2499-  });
work/codex-review5.md-2500-
work/codex-review5.md-2501-  it("debounces a pending generation inside the interval", async () => {
work/codex-review5.md-2502-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
work/codex-review5.md-2503-    const stores = createCloudflareStores(value);
work/codex-review5.md-2504-
work/codex-review5.md:2505:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
work/codex-review5.md-2506-
work/codex-review5.md-2507-    expect(decision.due).toBe(false);
work/codex-review5.md:2508:    expect(decision.reason).toBe("debounced");
work/codex-review5.md-2509-    expect(decision.seconds_until_due).toBeGreaterThan(0);
work/codex-review5.md-2510-    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
work/codex-review5.md-2511-  });
work/codex-review5.md-2512-
work/codex-review5.md-2513-  it("rebuilds when the pending generation is older than the interval", async () => {
work/codex-review5.md-2514-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-2515-    const stores = createCloudflareStores(value);
work/codex-review5.md-2516-
work/codex-review5.md:2517:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2518-      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-2519-  });
work/codex-review5.md-2520-
work/codex-review5.md-2521-  it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
work/codex-review5.md-2522-    const { value } = env({ responder: () => state({ pending: 1 }) });
work/codex-review5.md-2523-    const stores = createCloudflareStores(value);
work/codex-review5.md-2524-
work/codex-review5.md:2525:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2526-      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-2527-  });
work/codex-review5.md-2528-
work/codex-review5.md-2529-  it("falls back to the default interval for invalid input", async () => {
work/codex-review5.md-2530-    const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
work/codex-review5.md-2531-    const stores = createCloudflareStores(value);
work/codex-review5.md-2532-
work/codex-review5.md:2533:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
work/codex-review5.md-2534-
work/codex-review5.md-2535-    expect(decision.due).toBe(false);
work/codex-review5.md:2536:    expect(decision.reason).toBe("debounced");
work/codex-review5.md-2537-  });
work/codex-review5.md-2538-
work/codex-review5.md-2539-  it("waits for a quiet window before rebuilding", async () => {
work/codex-review5.md-2540-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
work/codex-review5.md-2541-    const stores = createCloudflareStores(value);
work/codex-review5.md-2542-
work/codex-review5.md:2543:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-2544-
work/codex-review5.md-2545-    expect(decision.due).toBe(false);
work/codex-review5.md:2546:    expect(decision.reason).toBe("awaiting-quiet");
work/codex-review5.md-2547-    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
work/codex-review5.md-2548-    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
work/codex-review5.md-2549-  });
work/codex-review5.md-2550-
work/codex-review5.md-2551-  it("rebuilds once mutations have been quiet long enough", async () => {
work/codex-review5.md-2552-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
work/codex-review5.md-2553-    const stores = createCloudflareStores(value);
work/codex-review5.md-2554-
work/codex-review5.md:2555:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
work/codex-review5.md-2556-      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-2557-  });
work/codex-review5.md-2558-
work/codex-review5.md-2559-  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
work/codex-review5.md-2560-    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
work/codex-review5.md-2561-    const stores = createCloudflareStores(value);
work/codex-review5.md-2562-
work/codex-review5.md:2563:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-2564-
work/codex-review5.md-2565-    expect(decision.due).toBe(true);
work/codex-review5.md-2566-    expect(decision.reason).toBe("max-staleness");
work/codex-review5.md-2567-    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
work/codex-review5.md-2568-  });
work/codex-review5.md-2569-
work/codex-review5.md-2570-  it("keeps the legacy behaviour when no quiet window is configured", async () => {
work/codex-review5.md-2571-    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
work/codex-review5.md-2572-    const stores = createCloudflareStores(value);
work/codex-review5.md-2573-
work/codex-review5.md:2574:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2575-      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-2576-  });
work/codex-review5.md-2577-
work/codex-review5.md-2578-  it("claims the rebuild lease only when the previous lease has expired", async () => {
work/codex-review5.md-2579-    const held = env({ changes: 0 });
--
work/codex-review5.md-2605-    await stores.caseStore.rebuildAggregates();
work/codex-review5.md-2606-
work/codex-review5.md-2607-    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
work/codex-review5.md-2608-    expect(summaryDelete).toBeDefined();
work/codex-review5.md-2609-    expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
work/codex-review5.md:2610:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
work/codex-review5.md-2611-  });
work/codex-review5.md-2612-
work/codex-review5.md-2613-  it("records the generation observed before the scan, not a bare clean flag", async () => {
work/codex-review5.md-2614-    const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-2615-    const stores = createCloudflareStores(value);
--
work/codex-review5.md-2617-    const before = nowSeconds();
work/codex-review5.md-2618-    await stores.caseStore.rebuildAggregates();
work/codex-review5.md-2619-    const after = nowSeconds();
work/codex-review5.md-2620-
work/codex-review5.md-2621-    const applied = catalog.prepared
work/codex-review5.md:2622:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
work/codex-review5.md-2623-    const stamp = catalog.prepared
work/codex-review5.md-2624-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
work/codex-review5.md-2625-    const resetDirtySince = catalog.prepared
work/codex-review5.md:2626:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-2627-    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
work/codex-review5.md-2628-    expect(Number(applied.params[0])).toBe(7);
work/codex-review5.md-2629-    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
work/codex-review5.md-2630-    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
work/codex-review5.md-2631-    expect(resetDirtySince).toBeDefined();
work/codex-review5.md:2632:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
work/codex-review5.md-2633-    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
work/codex-review5.md-2634-  });
work/codex-review5.md-2635-
work/codex-review5.md-2636-  it("batches the rebuild statements in bounded chunks", async () => {
work/codex-review5.md-2637-    const { catalog, value } = env();
--
work/codex-review5.md-2660- * never be drained and every dashboard would freeze silently — so the queue
work/codex-review5.md-2661- * path still refreshes, at most once per fallback window. With a working cron
work/codex-review5.md-2662- * the last rebuild is never older than the cron period, and this never fires.
work/codex-review5.md-2663- */
work/codex-review5.md-2664-async function markStaleAndMaybeRebuild(stores, env) {
work/codex-review5.md:2665:  await stores.caseStore.markAggregatesDirty();
work/codex-review5.md-2666-  const minIntervalSeconds = positiveIntOr(
work/codex-review5.md-2667-    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
work/codex-review5.md-2668-    DEFAULT_FALLBACK_INTERVAL_SECONDS,
work/codex-review5.md-2669-  );
work/codex-review5.md:2670:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
work/codex-review5.md-2671-  if (!fallback?.due) return false;
work/codex-review5.md-2672-  const result = await rebuildUnderLease(stores, env);
work/codex-review5.md-2673-  if (result?.skipped) return false;
work/codex-review5.md-2674-  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
work/codex-review5.md-2675-  return true;
--
work/codex-review5.md-2884-
work/codex-review5.md-2885-  it("throttles a retry after a failed rebuild", async () => {
work/codex-review5.md-2886-    // A failed rebuild releases its lease without stamping rebuild_last_at, so
work/codex-review5.md-2887-    // the decision must also consider the attempt stamp.
work/codex-review5.md-2888-    const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
work/codex-review5.md:2889:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md:2890:      .resolves.toMatchObject({ due: false, reason: "debounced" });
work/codex-review5.md-2891-
work/codex-review5.md-2892-    const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
work/codex-review5.md:2893:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
work/codex-review5.md-2894-      .resolves.toMatchObject({ due: true, reason: "dirty" });
work/codex-review5.md-2895-  });
work/codex-review5.md-2896-
work/codex-review5.md-2897-  it("clears and rewrites exactly the documented summary tables", async () => {
work/codex-review5.md-2898-    const { catalog, value } = env();
--
work/codex-review5.md-2916-    await stores.caseStore.rebuildAggregates();
work/codex-review5.md-2917-
work/codex-review5.md-2918-    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
work/codex-review5.md-2919-    expect(summaryDelete).toBeDefined();
work/codex-review5.md-2920-    expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
work/codex-review5.md:2921:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
work/codex-review5.md-2922-  });
work/codex-review5.md-2923-
work/codex-review5.md-2924-  it("records the generation observed before the scan, not a bare clean flag", async () => {
work/codex-review5.md-2925-    const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
work/codex-review5.md-2926-    const stores = createCloudflareStores(value);
--
work/codex-review5.md-2928-    const before = nowSeconds();
work/codex-review5.md-2929-    await stores.caseStore.rebuildAggregates();
work/codex-review5.md-2930-    const after = nowSeconds();
work/codex-review5.md-2931-
work/codex-review5.md-2932-    const applied = catalog.prepared
work/codex-review5.md:2933:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
work/codex-review5.md-2934-    const stamp = catalog.prepared
work/codex-review5.md-2935-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
work/codex-review5.md-2936-    const resetDirtySince = catalog.prepared
work/codex-review5.md:2937:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-2938-    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
work/codex-review5.md-2939-    expect(Number(applied.params[0])).toBe(7);
work/codex-review5.md-2940-    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
work/codex-review5.md-2941-    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
work/codex-review5.md-2942-    expect(resetDirtySince).toBeDefined();
work/codex-review5.md:2943:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
work/codex-review5.md-2944-    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
work/codex-review5.md-2945-  });
work/codex-review5.md-2946-
work/codex-review5.md-2947-  it("batches the rebuild statements in bounded chunks", async () => {
work/codex-review5.md-2948-    const { catalog, value } = env();
--
work/codex-review5.md-2981-      deleteVerified: vi.fn(async () => undefined),
work/codex-review5.md-2982-    },
work/codex-review5.md-2983-    caseStore: {
work/codex-review5.md-2984-      getCase: vi.fn(async () => ({ case_id: "0123456789ab", title: "Example", citation: "[2026] FCA 1", court_code: "FCA", year: 2026, source: "austlii", visa_subclass: "482" })),
work/codex-review5.md-2985-      markSemanticReady: vi.fn(async () => undefined),
work/codex-review5.md:2986:      markAggregatesDirty: vi.fn(async () => true),
work/codex-review5.md:2987:      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
work/codex-review5.md-2988-      claimRebuildLease: vi.fn(async () => ({ token: "queue-lease", leaseSeconds: 900 })),
work/codex-review5.md-2989-      releaseRebuildLease: vi.fn(async () => true),
work/codex-review5.md-2990-      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
work/codex-review5.md-2991-    },
work/codex-review5.md-2992-    semanticIndex: {
--
work/codex-review5.md-3038-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3039-    expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({ contentType: "text/plain; charset=utf-8" }));
work/codex-review5.md-3040-    expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith("0123456789ab", expect.any(Array), expect.objectContaining({ court_code: "FCA", year: 2026 }));
work/codex-review5.md-3041-    expect(current.caseStore.markSemanticReady).toHaveBeenCalledWith("0123456789ab", "mutation-1");
work/codex-review5.md-3042-    // A queue batch must never pay for a full rebuild; it only flags staleness.
work/codex-review5.md:3043:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-3044-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-3045-    expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-3046-    expect(message.retry).not.toHaveBeenCalled();
work/codex-review5.md-3047-  });
work/codex-review5.md-3048-
--
work/codex-review5.md-3073-      ack: vi.fn(), retry: vi.fn(),
work/codex-review5.md-3074-    };
work/codex-review5.md-3075-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3076-    expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({ key: message.body.payload_key }), expect.objectContaining({ prefix: "pipeline" }));
work/codex-review5.md-3077-    expect(mockCoordinate).toHaveBeenCalledWith(expect.objectContaining({ eventId: message.body.event_id, runId: "run", canonicalText: "canonical text" }));
work/codex-review5.md:3078:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-3079-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-3080-    expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-3081-  });
work/codex-review5.md-3082-
work/codex-review5.md-3083-  it("flags catalog aggregates as stale for a mutation-triggered refresh event", async () => {
--
work/codex-review5.md-3087-      body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
work/codex-review5.md-3088-      ack: vi.fn(),
work/codex-review5.md-3089-      retry: vi.fn(),
work/codex-review5.md-3090-    };
work/codex-review5.md-3091-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md:3092:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-3093-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-3094-    expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-3095-    expect(message.retry).not.toHaveBeenCalled();
work/codex-review5.md-3096-  });
work/codex-review5.md-3097-
work/codex-review5.md-3098-  it("uses the fallback rebuild only when the cron path has gone quiet", async () => {
work/codex-review5.md-3099-    const current = stores();
work/codex-review5.md:3100:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md-3101-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3102-    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-3103-
work/codex-review5.md-3104-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });
work/codex-review5.md-3105-
work/codex-review5.md:3106:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md:3107:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-3108-    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
work/codex-review5.md-3109-    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
work/codex-review5.md-3110-    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
work/codex-review5.md-3111-  });
work/codex-review5.md-3112-
--
work/codex-review5.md-3115-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3116-    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-3117-
work/codex-review5.md-3118-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3119-
work/codex-review5.md:3120:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-3121-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-3122-  });
work/codex-review5.md-3123-
work/codex-review5.md-3124-  it("does not rebuild from the queue path when another invocation holds the lease", async () => {
work/codex-review5.md-3125-    const current = stores();
work/codex-review5.md:3126:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
work/codex-review5.md-3127-    current.caseStore.claimRebuildLease.mockResolvedValue(null);
work/codex-review5.md-3128-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3129-    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
work/codex-review5.md-3130-
work/codex-review5.md-3131-    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
--
work/codex-review5.md-3145-      AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800",
work/codex-review5.md-3146-      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
work/codex-review5.md-3147-      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
work/codex-review5.md-3148-    });
work/codex-review5.md-3149-
work/codex-review5.md:3150:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md-3151-      minIntervalSeconds: 1800, quietSeconds: 900, maxStalenessSeconds: 43200,
work/codex-review5.md-3152-    });
work/codex-review5.md-3153-  });
work/codex-review5.md-3154-
work/codex-review5.md-3155-  it("coalesces many mutations in one batch into a single stale flag", async () => {
--
work/codex-review5.md-3160-      ack: vi.fn(),
work/codex-review5.md-3161-      retry: vi.fn(),
work/codex-review5.md-3162-    }));
work/codex-review5.md-3163-    await worker.queue({ messages }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3164-    // 20 mutations used to mean one 584k-row rebuild; now they mean one row.
work/codex-review5.md:3165:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
work/codex-review5.md-3166-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md-3167-    for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
work/codex-review5.md-3168-  });
work/codex-review5.md-3169-
work/codex-review5.md-3170-  it("deletes a case source only through its validated R2 pointer", async () => {
--
work/codex-review5.md-3203-import worker from "../cloudflare-native.js";
work/codex-review5.md-3204-
work/codex-review5.md-3205-function stores(decision = { due: true, reason: "dirty" }) {
work/codex-review5.md-3206-  return {
work/codex-review5.md-3207-    caseStore: {
work/codex-review5.md:3208:      aggregatesNeedRebuild: vi.fn(async () => decision),
work/codex-review5.md-3209-      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
work/codex-review5.md:3210:      markAggregatesDirty: vi.fn(async () => true),
work/codex-review5.md-3211-      claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
work/codex-review5.md-3212-      releaseRebuildLease: vi.fn(async () => true),
work/codex-review5.md-3213-    },
work/codex-review5.md-3214-  };
work/codex-review5.md-3215-}
--
work/codex-review5.md-3221-    const current = stores();
work/codex-review5.md-3222-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3223-
work/codex-review5.md-3224-    const result = await worker.scheduled({ cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3225-
work/codex-review5.md:3226:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-3227-    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
work/codex-review5.md-3228-    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "cron-lease", leaseSeconds: 900 } });
work/codex-review5.md-3229-    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
work/codex-review5.md-3230-    expect(result).toMatchObject({ due: true, rebuilt_at: "2026-09-10T00:00:00.000Z" });
work/codex-review5.md-3231-  });
work/codex-review5.md-3232-
work/codex-review5.md-3233-  it("does not rebuild while the interval is still debouncing", async () => {
work/codex-review5.md:3234:    const current = stores({ due: false, reason: "debounced", seconds_until_due: 120 });
work/codex-review5.md-3235-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3236-
work/codex-review5.md-3237-    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3238-
work/codex-review5.md-3239-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md:3240:    expect(result).toMatchObject({ due: false, reason: "debounced" });
work/codex-review5.md-3241-  });
work/codex-review5.md-3242-
work/codex-review5.md-3243-  it("does not rebuild when nothing changed", async () => {
work/codex-review5.md-3244-    const current = stores({ due: false, reason: "clean" });
work/codex-review5.md-3245-    mockCreateStores.mockReturnValue(current);
--
work/codex-review5.md-3257-
work/codex-review5.md-3258-    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 1800 });
work/codex-review5.md-3259-  });
work/codex-review5.md-3260-
work/codex-review5.md-3261-  it("honours the configured minimum interval", async () => {
work/codex-review5.md:3262:    const current = stores({ due: false, reason: "debounced", seconds_until_due: 30 });
work/codex-review5.md-3263-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3264-
work/codex-review5.md-3265-    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: "600" });
work/codex-review5.md-3266-
work/codex-review5.md:3267:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-3268-  });
work/codex-review5.md-3269-
work/codex-review5.md-3270-  it("falls back to the default interval when the variable is missing or invalid", async () => {
work/codex-review5.md-3271-    for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
work/codex-review5.md:3272:      const current = stores({ due: false, reason: "debounced" });
work/codex-review5.md-3273-      mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3274-      await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
work/codex-review5.md:3275:      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
work/codex-review5.md-3276-    }
work/codex-review5.md-3277-  });
work/codex-review5.md-3278-
work/codex-review5.md-3279-  it("skips the rebuild when another invocation holds the lease", async () => {
work/codex-review5.md-3280-    const current = stores();
--
work/codex-review5.md-3305-      IMMI_STORAGE_MODE: "cloudflare",
work/codex-review5.md-3306-      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
work/codex-review5.md-3307-      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
work/codex-review5.md-3308-    });
work/codex-review5.md-3309-
work/codex-review5.md:3310:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
work/codex-review5.md-3311-      minIntervalSeconds: 300, quietSeconds: 120, maxStalenessSeconds: 7200,
work/codex-review5.md-3312-    });
work/codex-review5.md-3313-  });
work/codex-review5.md-3314-
work/codex-review5.md-3315-  it("reports a quiet-window deferral instead of rebuilding", async () => {
work/codex-review5.md:3316:    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
work/codex-review5.md-3317-    mockCreateStores.mockReturnValue(current);
work/codex-review5.md-3318-
work/codex-review5.md-3319-    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
work/codex-review5.md-3320-
work/codex-review5.md-3321-    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
work/codex-review5.md:3322:    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
work/codex-review5.md-3323-  });
work/codex-review5.md-3324-
work/codex-review5.md-3325-  it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
work/codex-review5.md-3326-    const current = stores();
work/codex-review5.md-3327-    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
--
work/codex-review5.md-3343-**Identifying minor documentation cost inaccuracies**
work/codex-review5.md-3344-**Assessing staleness handling tests**
work/codex-review5.md-3345-**Verifying test coverage for staleness invariants**
work/codex-review5.md-3346-**Planning repository-wide grep for mutation tests**
work/codex-review5.md-3347-exec
work/codex-review5.md:3348:/bin/zsh -c "grep -R -n -E \"staleness clock arms|first mutation only|quiet window|staleness bound|max-staleness|awaiting-quiet|dirty_since\" workers/__tests__ | head -250
work/codex-review5.md-3349-grep -n -E \"AGGREGATE_REBUILD|crons\" config/wrangler-cloudflare-native.toml.example
work/codex-review5.md-3350-grep -n -E \"one row|1–2 rows|\\"'$0'"\\.58|one rebuild|two .*vars|four .*vars\" docs/ops/aggregate-rebuild-cost-guard.md" in /Volumes/Storm Breaker/Developer/IMMI-Case-
work/codex-review5.md-3351- succeeded in 0ms:
work/codex-review5.md-3352-workers/__tests__/cloudflare-native-queue.test.js:182:  it("honours the configured quiet window and staleness bound", async () => {
work/codex-review5.md-3353-workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:109:  it("reads the quiet window and staleness bound from the environment", async () => {
work/codex-review5.md:3354:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:125:    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
work/codex-review5.md:3355:workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:131:    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
work/codex-review5.md:3356:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
work/codex-review5.md:3357:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md-3358-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164:  it("waits for a quiet window before rebuilding", async () => {
work/codex-review5.md:3359:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:171:    expect(decision.reason).toBe("awaiting-quiet");
work/codex-review5.md-3360-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:184:  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
work/codex-review5.md-3361-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:191:    expect(decision.reason).toBe("max-staleness");
work/codex-review5.md-3362-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:195:  it("keeps the legacy behaviour when no quiet window is configured", async () => {
work/codex-review5.md-3363-workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:331:    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
work/codex-review5.md:3364:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
work/codex-review5.md:3365:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
work/codex-review5.md-3366-56:AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
work/codex-review5.md-3367-60:AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
work/codex-review5.md-3368-63:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
work/codex-review5.md-3369-65:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
work/codex-review5.md-3370-69:# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
work/codex-review5.md-3371-73:crons = ["*/5 * * * *"]
work/codex-review5.md:3372:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
work/codex-review5.md-3373-90:| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
work/codex-review5.md-3374-103:**one rebuild (~$0.58)** because the pending work accumulates while the import
work/codex-review5.md-3375-144:   (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
work/codex-review5.md-3376-208:   by leaving the fallback in place — it is bounded at one rebuild per
work/codex-review5.md-3377-
work/codex-review5.md-3378-hook: PostToolUse
work/codex-review5.md-3379-hook: PostToolUse Completed
work/codex-review5.md-3380-**Deciding verdict on command usage**
work/codex-review5.md-3381-**Summarizing high-severity findings and fixes**
work/codex-review5.md:3382:**Assessing robustness of rebuild_dirty_since handling**
work/codex-review5.md-3383-**Designing atomic mutation handling**
work/codex-review5.md-3384-**Evaluating staleness severity impact**
work/codex-review5.md-3385-**Refining staleness retry logic**
work/codex-review5.md:3386:**Designing failure throttle with debounced ordering**
work/codex-review5.md-3387-**Assessing log distinguishability for failure states**
work/codex-review5.md-3388-**Analyzing elapsed time calculation in logs**
work/codex-review5.md-3389-**Flagging indistinguishable pipeline errors in logs**
work/codex-review5.md-3390-**Identifying missing functional test for ordering invariant**
work/codex-review5.md-3391-**Flagging low-risk test gap for mutation timing**
work/codex-review5.md-3392-**Clarifying test results and fix scope**
work/codex-review5.md-3393-**Citing exact code and test line ranges**
work/codex-review5.md-3394-exec
work/codex-review5.md-3395-/bin/zsh -c "grep -n -E 'it\\(\"(stamps the mutation|waits for a quiet|forces a rebuild|records the generation|keeps the bookkeeping)' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
work/codex-review5.md:3396:grep -n -E 'if \\(elapsedSeconds < interval\\)|maxStaleness|INSERT OR REPLACE INTO catalog_summary|rebuild_dirty_since|DELETE FROM catalog_summary WHERE' workers/storage/cloudflare.js
work/codex-review5.md-3397-grep -n -E 'aggregate_rebuild_skipped|aggregate_rebuild_completed|handleScheduledRebuild' workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
work/codex-review5.md-3398- succeeded in 0ms:
work/codex-review5.md-3399-83:  it("stamps the mutation time and arms the staleness clock", async () => {
work/codex-review5.md-3400-164:  it("waits for a quiet window before rebuilding", async () => {
work/codex-review5.md-3401-184:  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
work/codex-review5.md-3402-335:  it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
work/codex-review5.md-3403-347:  it("records the generation observed before the scan, not a bare clean flag", async () => {
work/codex-review5.md:3404:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
work/codex-review5.md-3405-1031:        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
work/codex-review5.md-3406-1104:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md-3407-1106:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md-3408-1108:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
work/codex-review5.md:3409:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
work/codex-review5.md:3410:1149:        VALUES ('rebuild_dirty_since', ?, ?)
work/codex-review5.md:3411:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
work/codex-review5.md:3412:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
work/codex-review5.md-3413-1177:    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
work/codex-review5.md-3414-1178:      ? Math.floor(maxStalenessSeconds) : 0;
work/codex-review5.md-3415-1192:    if (elapsedSeconds < interval) {
work/codex-review5.md:3416:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
work/codex-review5.md-3417-1207:    if (maxStaleness > 0 && staleness >= maxStaleness) {
work/codex-review5.md-3418-1251:    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
work/codex-review5.md-3419-193:async function handleScheduledRebuild(env) {
work/codex-review5.md-3420-201:    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
work/codex-review5.md-3421-208:    event: "cloudflare.aggregate_rebuild_completed",
--
work/codex-review5.md-3435-**Ranking concurrency and logging issues**
work/codex-review5.md-3436-**Identifying logging gaps in runtime failures**
work/codex-review5.md-3437-**Highlighting missing key tests**
work/codex-review5.md-3438-**Confirming low test coverage gap**
work/codex-review5.md-3439-codex
work/codex-review5.md:3440:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
work/codex-review5.md-3441-
work/codex-review5.md-3442-- `workers/storage/cloudflare.js:1133-1155` — **MEDIUM**：三個獨立 `await` 可被不同 isolate 交錯。較早 mutation 暫停後，可能在較晚 mutation 完成後以較舊的 epoch 覆寫 `rebuild_last_mutation_at`，使 quiet window 過早到期；dirty clock 也可能從較晚的寫入開始。修正：以單一 D1 transaction/batch 原子提交三筆控制列，並令 mutation timestamp 使用單調 `MAX(existing, excluded)` 更新。
work/codex-review5.md-3443-
work/codex-review5.md:3444:- `workers/storage/cloudflare.js:1192-1207` — **MEDIUM**：`debounced` 在 `max-staleness` 前返回。一次失敗 rebuild 剛寫入 `rebuild_last_attempt_at` 時，即使 dirty work 已超過 max staleness，仍可再被 interval 延後；若 interval 被設得比 bound 大，違反的時間更長。修正：先檢查 max staleness，或將 debounce 等待時間限制為距離 staleness deadline 的剩餘時間。
work/codex-review5.md-3445-
work/codex-review5.md:3446:- `workers/cloudflare-native.js:201-214` — **LOW**：正常等待會留下帶 `reason` 的 `cloudflare.aggregate_rebuild_skipped`，但 rebuild failure 沒有同等的結構化失敗事件；後續 `debounced` 記錄難以和成功後的正常 debounce 區分。修正：捕捉、記錄含 decision、generation、dirty age 與 error 的 `cloudflare.aggregate_rebuild_failed` 後再拋出。
work/codex-review5.md-3447-
work/codex-review5.md-3448-- `docs/ops/aggregate-rebuild-cost-guard.md:30,90,103` — **LOW**：文件仍稱 dirty mark 是「one row」或「1–2 rows」，實作是三筆 D1 writes。7,700 queue batches 約增加 23,100 writes，約 $0.023；完整 import 約為 $0.61 而非精確的 $0.58。核心「cents, not dollars」結論不變。修正：改為三筆控制列與約 $0.61 的完整成本說明。
work/codex-review5.md-3449-
work/codex-review5.md:3450:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
work/codex-review5.md-3451-
work/codex-review5.md-3452-- 5. **No finding**：quiet window 由 `waits for a quiet window before rebuilding`（`workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164`）覆蓋；bound 由 `forces a rebuild when the staleness bound is exceeded even while mutations continue`（`:184`）覆蓋；arming edge 由 `stamps the mutation time and arms the staleness clock`（`:83`）檢查 `CASE WHEN ... = 0`。但上述 HIGH interleaving 尚無測試。
work/codex-review5.md-3453-
work/codex-review5.md-3454-VERDICT: CHANGES-REQUIRED
work/codex-review5.md-3455-tokens used
work/codex-review5.md-3456-81,113
work/codex-review5.md:3457:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
work/codex-review5.md-3458-
work/codex-review5.md-3459-- `workers/storage/cloudflare.js:1133-1155` — **MEDIUM**：三個獨立 `await` 可被不同 isolate 交錯。較早 mutation 暫停後，可能在較晚 mutation 完成後以較舊的 epoch 覆寫 `rebuild_last_mutation_at`，使 quiet window 過早到期；dirty clock 也可能從較晚的寫入開始。修正：以單一 D1 transaction/batch 原子提交三筆控制列，並令 mutation timestamp 使用單調 `MAX(existing, excluded)` 更新。
work/codex-review5.md-3460-
work/codex-review5.md:3461:- `workers/storage/cloudflare.js:1192-1207` — **MEDIUM**：`debounced` 在 `max-staleness` 前返回。一次失敗 rebuild 剛寫入 `rebuild_last_attempt_at` 時，即使 dirty work 已超過 max staleness，仍可再被 interval 延後；若 interval 被設得比 bound 大，違反的時間更長。修正：先檢查 max staleness，或將 debounce 等待時間限制為距離 staleness deadline 的剩餘時間。
work/codex-review5.md-3462-
work/codex-review5.md:3463:- `workers/cloudflare-native.js:201-214` — **LOW**：正常等待會留下帶 `reason` 的 `cloudflare.aggregate_rebuild_skipped`，但 rebuild failure 沒有同等的結構化失敗事件；後續 `debounced` 記錄難以和成功後的正常 debounce 區分。修正：捕捉、記錄含 decision、generation、dirty age 與 error 的 `cloudflare.aggregate_rebuild_failed` 後再拋出。
work/codex-review5.md-3464-
work/codex-review5.md-3465-- `docs/ops/aggregate-rebuild-cost-guard.md:30,90,103` — **LOW**：文件仍稱 dirty mark 是「one row」或「1–2 rows」，實作是三筆 D1 writes。7,700 queue batches 約增加 23,100 writes，約 $0.023；完整 import 約為 $0.61 而非精確的 $0.58。核心「cents, not dollars」結論不變。修正：改為三筆控制列與約 $0.61 的完整成本說明。
work/codex-review5.md-3466-
work/codex-review5.md:3467:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
work/codex-review5.md-3468-
work/codex-review5.md-3469-- 5. **No finding**：quiet window 由 `waits for a quiet window before rebuilding`（`workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164`）覆蓋；bound 由 `forces a rebuild when the staleness bound is exceeded even while mutations continue`（`:184`）覆蓋；arming edge 由 `stamps the mutation time and arms the staleness clock`（`:83`）檢查 `CASE WHEN ... = 0`。但上述 HIGH interleaving 尚無測試。
work/codex-review5.md-3470-
work/codex-review5.md-3471-VERDICT: CHANGES-REQUIRED
  1020	    const appliedGeneration = state.get("rebuild_generation") || 0;
  1021	    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
  1022	    const statements = [];
  1023	    for (const table of [
  1024	      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
  1025	      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
  1026	      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
  1027	      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
  1028	      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
  1029	    ]) {
  1030	      statements.push(table === "catalog_summary"
  1031	        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
  1032	        : this.db.prepare(`DELETE FROM ${table}`));
  1033	    }
  1034	    statements.push(
  1035	      this.db.prepare(`INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
  1036	        SELECT court_code, year, outcome, COUNT(*), ? FROM cases GROUP BY court_code, year, outcome`).bind(now),
  1037	      this.db.prepare(`INSERT INTO aggregate_source (source,case_count,updated_at)
  1038	        SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source`).bind(now),
  1039	      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
  1040	        SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
  1041	      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
  1042	        SELECT 'with_full_text', COUNT(*), ? FROM cases WHERE content_key <> ''`).bind(now),
  1043	      this.db.prepare(`INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
  1044	        SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
  1045	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
  1046	        WHERE c.court_code <> '' GROUP BY cj.judge_id, c.court_code`),
  1047	      this.db.prepare(`INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
  1048	        SELECT case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> '' GROUP BY case_nature, outcome`),
  1049	      this.db.prepare(`INSERT INTO aggregate_concept (concept_id,label,case_count)
  1050	        SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
  1051	        FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id GROUP BY cc.concept_id, c.label`),
  1052	      this.db.prepare(`INSERT INTO aggregate_country (country,case_count,updated_at)
  1053	        SELECT country_of_origin, COUNT(*), ? FROM cases WHERE country_of_origin <> '' GROUP BY country_of_origin`).bind(now),
  1054	      this.db.prepare(`INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
  1055	        SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
  1056	        FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id GROUP BY j.judge_id, j.canonical_name`).bind(now),
  1057	      this.db.prepare(`INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
  1058	        SELECT visa_subclass, court_code, outcome, COUNT(*), ? FROM cases
  1059	        WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome`).bind(now),
  1060	      this.db.prepare(`INSERT INTO aggregate_scope
  1061	        (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
  1062	        SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
  1063	               COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
  1064	               CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
  1065	        FROM cases GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
  1066	          COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
  1067	          CASE WHEN content_key <> '' THEN 1 ELSE 0 END`),
  1068	      this.db.prepare(`INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
  1069	        SELECT court_code, case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> ''
  1070	        GROUP BY court_code, case_nature, outcome`),
  1071	      this.db.prepare(`INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
  1072	        SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
  1073	        FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
  1074	        GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome`),
  1075	      this.db.prepare(`INSERT INTO aggregate_concept_pair
  1076	        (concept_id_a,concept_id_b,court_code,outcome,case_count)
  1077	        SELECT a.concept_id, b.concept_id, c.court_code, c.outcome, COUNT(DISTINCT a.case_id)
  1078	        FROM case_concepts a JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
  1079	        JOIN cases c ON c.case_id = a.case_id
  1080	        GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome`),
  1081	      this.db.prepare(`INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
  1082	        SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
  1083	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
  1084	        GROUP BY cj.judge_id, c.court_code, c.outcome`),
  1085	      this.db.prepare(`INSERT INTO aggregate_judge_year (judge_id,year,case_count)
  1086	        SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
  1087	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.year IS NOT NULL
  1088	        GROUP BY cj.judge_id, c.year`),
  1089	      this.db.prepare(`INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
  1090	        SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
  1091	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
  1092	        GROUP BY cj.judge_id, c.visa_subclass`),
  1093	    );
  1094	    for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
  1095	      statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
  1096	        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
  1097	        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
  1098	    }
  1099	    // Bookkeeping lives in catalog_summary itself (getStats reads only
  1100	    // total_cases/with_full_text, so these keys stay internal). Recording the
  1101	    // generation observed at the start — not a bare dirty=0 — is what keeps a
  1102	    // mid-rebuild mutation pending.
  1103	    statements.push(
  1104	      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
  1105	        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
  1106	      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
  1107	        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
  1108	      // Only disarm the staleness clock when nothing arrived while this rebuild
  1109	      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
  1110	      // the staleness bound stays reachable under continuous writes.
  1111	      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
  1112	         WHERE summary_key = 'rebuild_dirty_since'
  1113	           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
  1114	        .bind(now, appliedGeneration),
  1115	    );
  1116	    for (let offset = 0; offset < statements.length; offset += 20) {
  1117	      // While we still own the lease, extend it before each chunk; if another
  1118	      // invocation took over (this run outlived its lease), abort instead of
  1119	      // interleaving DELETEs with it. At most one chunk can overlap.
  1120	      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
  1121	        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
  1122	          code: "rebuild_lease_lost", status: 503,
  1123	        });
  1124	      }
  1125	      await this.db.batch(statements.slice(offset, offset + 20));
  1126	    }
  1127	    return { rebuilt_at: now, applied_generation: appliedGeneration };
  1128	  }
  1129	
  1130	  /**
  1131	   * Mark analytics as stale without paying for a rebuild: one row written per
  1132	   * queue batch instead of clearing and rewriting 17 tables.
  1133	   *
  1134	   * A monotonic generation, not a boolean: a rebuild applies the generation it
  1135	   * observed when it started, so a mutation landing mid-rebuild stays pending
  1136	   * instead of being wiped by the rebuild's own bookkeeping write.
  1137	   */
  1138	  async markAggregatesDirty() {
  1139	    const now = Math.floor(Date.now() / 1000);
  1140	    const stamp = utcNow();
  1141	    // One batch = one transaction, so two isolates cannot interleave these rows.
  1142	    await this.db.batch([
  1143	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1144	          VALUES ('rebuild_generation', 1, ?)
  1145	        ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
  1146	        .bind(stamp),
  1147	      // When the last mutation happened: the scheduled rebuild waits for a quiet
  1148	      // window so a long bulk import costs one rebuild, not one per interval.
  1149	      // MAX() keeps it monotonic when isolates with skewed clocks interleave.
  1150	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1151	          VALUES ('rebuild_last_mutation_at', ?, ?)
  1152	        ON CONFLICT(summary_key) DO UPDATE SET
  1153	          value_int = MAX(catalog_summary.value_int, excluded.value_int), updated_at = excluded.updated_at`)
  1154	        .bind(now, stamp),
  1155	      // When the pending work first appeared: bounds how stale analytics may get
  1156	      // while mutations keep arriving without a quiet gap.
  1157	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1158	          VALUES ('rebuild_dirty_since', ?, ?)
  1159	        ON CONFLICT(summary_key) DO UPDATE SET
  1160	          value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
  1161	          updated_at = excluded.updated_at`)
  1162	        .bind(now, stamp),
  1163	    ]);
  1164	    return true;
  1165	  }
  1166	
  1167	  async readAggregateState() {
  1168	    const current = rows(await this.db.prepare(
  1169	      `SELECT summary_key, value_int FROM catalog_summary
  1170	        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
  1171	                              'rebuild_last_attempt_at', 'rebuild_lease_until',
  1172	                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
  1173	    ).all());
  1174	    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
  1175	  }
  1176	
  1177	  /**
  1178	   * Rate-limit decision for the scheduled handler: rebuild only when a
  1179	   * generation is pending and the last rebuild is older than the interval.
  1180	   * This is the only guard preventing a bulk import from rewriting the whole
  1181	   * summary set thousands of times.
  1182	   */
  1183	  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
  1184	    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
  1185	      ? Math.floor(minIntervalSeconds) : 300;
  1186	    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
  1187	    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
  1188	      ? Math.floor(maxStalenessSeconds) : 0;
  1189	    const state = await this.readAggregateState();
  1190	    const pending = state.get("rebuild_generation") || 0;
  1191	    const applied = state.get("rebuild_applied_generation") || 0;
  1192	    if (pending <= applied) return { due: false, reason: "clean" };
  1193	
  1194	    // Throttle on the last *attempt*, not only the last success: a rebuild that
  1195	    // throws releases its lease without stamping `rebuild_last_at`, and the
  1196	    // 30-second queue retry must not therefore rebuild on every retry.
  1197	    const lastSuccessAt = state.get("rebuild_last_at") || 0;
  1198	    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
  1199	    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
  1200	    const nowSeconds = Math.floor(Date.now() / 1000);
  1201	    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
  1202	    const dirtySince = state.get("rebuild_dirty_since") || 0;
  1203	    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
  1204	    const base = {
  1205	      pending_generation: pending,
  1206	      applied_generation: applied,
  1207	      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
  1208	    };
  1209	
  1210	    // Hard bound: however busy the queue is, analytics may not stay stale longer
  1211	    // than this, so a bulk import costs one rebuild per window instead of one
  1212	    // per interval.
  1213	    if (maxStaleness > 0 && staleness >= maxStaleness) {
  1214	      return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
  1215	    }
  1216	
  1217	    if (elapsedSeconds < interval) {
  1218	      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
  1219	    }
  1220	
  1221	    // Quiet window: wait for mutations to stop, so a multi-hour import collapses
  1222	    // into a single rebuild afterwards.
  1223	    if (quiet > 0) {
  1224	      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
  1225	      const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
  1226	      if (quietFor < quiet) {
  1227	        return {
  1228	          due: false,
  1229	          reason: "awaiting-quiet",
  1230	          seconds_until_quiet: quiet - quietFor,
  1231	          seconds_since_first_pending: staleness,
  1232	          ...base,
  1233	        };
  1234	      }
  1235	    }
  1236	
  1237	    return { due: true, reason: "dirty", seconds_since_first_pending: staleness, ...base };
  1238	  }
  1239	
  1240	  /**
  1241	   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
  1242	   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
  1243	   * interleave their DELETEs. The conditional upsert only writes when the held
  1244	   * lease has expired, so `changes === 1` means this caller won.
  1245	   */
  1246	  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
  1247	    const now = Math.floor(Date.now() / 1000);
  1248	    const lease = Math.max(60, Math.floor(leaseSeconds));
  1249	    const token = leaseToken();
  1250	    // One statement takes the lease, writes its expiry and rotates the token:
     1	/**
     2	 * Standalone IMMI Cloudflare-native Worker entrypoint.
     3	 *
     4	 * It intentionally does not import the legacy proxy, Flask container, or
     5	 * postgres.js. This entrypoint cannot be deployed until the route-manifest,
     6	 * import reconciliation, privacy, shadow, and rollback gates are all green.
     7	 */
     8	
     9	import { dispatchCloudflareCaseRead } from "./case-api/cloudflare.js";
    10	import { dispatchCloudflareCouncil } from "./llm-council/cloudflare_handlers.js";
    11	import {
    12	  handleTelegramLogin,
    13	  handleTelegramCallback,
    14	  handleBootstrapLogin,
    15	  handleAuthMe,
    16	  handleAuthLogout,
    17	  handleAuthRefresh,
    18	  handleAuthSwitchTenant,
    19	} from "./auth/cloudflare_handlers.js";
    20	import { getStorageMode } from "./storage/contracts.js";
    21	import { handleAdminPipelineRuns } from "./admin/cloudflare_handlers.js";
    22	import { getCsrfToken } from "./auth/csrf.js";
    23	import { dispatchCloudflareCaseAction } from "./case-api/cloudflare_actions.js";
    24	import { dispatchCloudflareCaseMutation } from "./case-api/cloudflare_mutations.js";
    25	import { createCloudflareStores } from "./storage/cloudflare.js";
    26	import { sha256Hex, VECTOR_DIMENSIONS, StorageBoundaryError } from "./storage/contracts.js";
    27	import { coordinateExtractedCase } from "./storage/pipeline_coordinator.js";
    28	import { handleJobStatus, handlePipelineStatus } from "./pipeline/cloudflare_handlers.js";
    29	import { dispatchCloudflarePipelineControl } from "./pipeline/control_handlers.js";
    30	
    31	export { AuthNonce } from "./auth/nonce_do.js";
    32	export { CouncilSessionDO } from "./llm-council/session_do.js";
    33	
    34	async function processCaseReindex(message, stores) {
    35	  const event = message?.body;
    36	  if (!event || event.kind !== "case.reindex" || typeof event.case_id !== "string") {
    37	    return false;
    38	  }
    39	  const current = await stores.caseStore.getCase(event.case_id);
    40	  if (!current) {
    41	    await stores.semanticIndex.deleteCase(event.case_id);
    42	    return true;
    43	  }
    44	  const text = await stores.objectStore.getVerifiedText({
    45	    key: event.content_key,
    46	    sha256: event.content_sha256,
    47	    size: event.content_size,
    48	    contentType: event.content_type || "text/plain; charset=utf-8",
    49	  });
    50	  const embedding = await stores.semanticIndex.embed(text || `${current.title} ${current.citation}`.trim());
    51	  if (!Array.isArray(embedding) || embedding.length !== VECTOR_DIMENSIONS) {
    52	    throw new StorageBoundaryError("Reindex embedding dimensions are invalid", { code: "embedding_shape_invalid", status: 503 });
    53	  }
    54	  const mutation = await stores.semanticIndex.upsertCase(event.case_id, embedding, {
    55	    court_code: String(current.court_code || ""),
    56	    ...(Number.isInteger(current.year) ? { year: current.year } : {}),
    57	    source: String(current.source || ""),
    58	    visa_subclass: String(current.visa_subclass || ""),
    59	  });
    60	  await stores.caseStore.markSemanticReady(event.case_id, mutation?.mutationId || null);
    61	  return true;
    62	}
    63	
    64	async function processAggregateRebuild(message) {
    65	  const event = message?.body;
    66	  if (!event || event.kind !== "catalog.rebuild") return false;
    67	  return true;
    68	}
    69	
    70	async function processCaseSourceDelete(message, stores) {
    71	  const event = message?.body;
    72	  if (!event || event.kind !== "case.source.delete") return false;
    73	  await stores.objectStore.deleteVerified({
    74	    key: event.content_key,
    75	    sha256: event.content_sha256,
    76	    size: event.content_size,
    77	    contentType: event.content_type || "text/plain; charset=utf-8",
    78	  }, { prefix: "cases" });
    79	  return true;
    80	}
    81	
    82	async function processCaseExtracted(message, env) {
    83	  const event = message?.body;
    84	  if (!event || event.kind !== "case.extracted") return false;
    85	  const stores = createCloudflareStores(env);
    86	  const payload = await stores.objectStore.getVerifiedJson({
    87	    key: event.payload_key,
    88	    sha256: event.payload_sha256,
    89	    size: event.payload_size,
    90	    contentType: event.payload_content_type || "application/json",
    91	  }, { prefix: "pipeline", maxBytes: 16 * 1024 * 1024, label: "Pipeline extraction payload" });
    92	  if (!payload || typeof payload !== "object") throw new StorageBoundaryError("Pipeline extraction payload is invalid", { code: "pipeline_payload_invalid", status: 503 });
    93	  await coordinateExtractedCase({
    94	    env,
    95	    eventId: event.event_id,
    96	    runId: event.run_id,
    97	    record: payload.record,
    98	    canonicalText: payload.canonicalText,
    99	    audit: payload.audit,
   100	  });
   101	  return true;
   102	}
   103	
   104	async function handleCaseMutationQueue(batch, env) {
   105	  const messages = batch?.messages || [];
   106	  const stores = createCloudflareStores(env);
   107	  try {
   108	    let changed = false;
   109	    for (const message of messages) {
   110	      if (await processCaseExtracted(message, env)) {
   111	        changed = true;
   112	      } else if (await processCaseReindex(message, stores)) {
   113	        changed = true;
   114	      } else if (await processCaseSourceDelete(message, stores)) {
   115	        changed = true;
   116	      } else if (await processAggregateRebuild(message)) {
   117	        changed = true;
   118	      }
   119	    }
   120	    // Never rebuild on the happy path: one rebuild clears and rewrites 17
   121	    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
   122	    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
   123	    if (changed) await markStaleAndMaybeRebuild(stores, env);
   124	    for (const message of messages) if (typeof message?.ack === "function") message.ack();
   125	  } catch (error) {
   126	    console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
   127	    for (const message of messages) {
   128	      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
   129	      else throw error;
   130	    }
   131	  }
   132	}
   133	
   134	const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
   135	const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
   136	const DEFAULT_REBUILD_LEASE_SECONDS = 900;
   137	// Quiet window: a rebuild waits until mutations have stopped for this long, so a
   138	// multi-hour bulk import collapses into one rebuild instead of one per interval
   139	// (measured: ~$28 -> ~$0.58 per 153k-case import).
   140	const DEFAULT_QUIET_SECONDS = 300;
   141	// Hard staleness bound: however busy the queue is, analytics refresh at least
   142	// this often. Only reachable while mutations never pause.
   143	const DEFAULT_MAX_STALENESS_SECONDS = 21600;
   144	
   145	function positiveIntOr(value, fallback) {
   146	  const parsed = Number.parseInt(value ?? "", 10);
   147	  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
   148	}
   149	
   150	function rebuildDecisionParams(env, minIntervalSeconds) {
   151	  return {
   152	    minIntervalSeconds,
   153	    quietSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_QUIET_SECONDS, DEFAULT_QUIET_SECONDS),
   154	    maxStalenessSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_MAX_STALENESS_SECONDS, DEFAULT_MAX_STALENESS_SECONDS),
   155	  };
   156	}
   157	
   158	/**
   159	 * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
   160	 * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
   161	 * The lease length is derived from the interval so it always outlives a rebuild
   162	 * while still expiring on its own if this invocation dies mid-flight.
   163	 */
   164	async function rebuildUnderLease(stores, env) {
   165	  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
   166	  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
   167	  if (!lease) {
   168	    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
   169	    return { skipped: "lease_held" };
   170	  }
   171	  try {
   172	    return await stores.caseStore.rebuildAggregates({ lease });
   173	  } finally {
   174	    try {
   175	      // Token-conditional: if this run outlived its lease, the new owner's
   176	      // lease is left untouched.
   177	      await stores.caseStore.releaseRebuildLease({ token: lease.token });
   178	    } catch (error) {
   179	      console.error(JSON.stringify({
   180	        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
   181	      }));
   182	    }
   183	  }
   184	}
   185	
   186	/**
   187	 * Coalesced analytics rebuild.
   188	 *
   189	 * Queue batches only mark the aggregates dirty; this scheduled handler decides
   190	 * when to pay for the rebuild, so N queue batches cost at most one rebuild per
   191	 * interval instead of N full rewrites of 17 tables.
   192	 */
   193	async function handleScheduledRebuild(env) {
   194	  const stores = createCloudflareStores(env);
   195	  const minIntervalSeconds = positiveIntOr(
   196	    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
   197	    DEFAULT_REBUILD_INTERVAL_SECONDS,
   198	  );
   199	  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   200	  if (!decision.due) {
   201	    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
   202	    return decision;
   203	  }
   204	  const startedAt = Date.now();
   205	  let result;
   206	  try {
   207	    result = await rebuildUnderLease(stores, env);
   208	  } catch (error) {
   209	    // A structured failure event: without it, a failed rebuild is only visible
   210	    // as the absence of a completion line, which reads exactly like a healthy
   211	    // debounce.
   212	    console.error(JSON.stringify({
   213	      event: "cloudflare.aggregate_rebuild_failed",
   214	      reason: decision.reason,
   215	      pending_generation: decision.pending_generation ?? null,
   216	      applied_generation: decision.applied_generation ?? null,
   217	      seconds_since_first_pending: decision.seconds_since_first_pending ?? null,
   218	      duration_ms: Date.now() - startedAt,
   219	      error: error?.message ?? String(error),
   220	    }));
   221	    throw error;
   222	  }
   223	  if (result?.skipped) return { ...decision, ...result };
   224	  console.log(JSON.stringify({
   225	    event: "cloudflare.aggregate_rebuild_completed",
   226	    reason: decision.reason,
   227	    min_interval_seconds: minIntervalSeconds,
   228	    duration_ms: Date.now() - startedAt,
   229	    rebuilt_at: result?.rebuilt_at ?? null,
   230	  }));
   231	  return { ...decision, ...result };
   232	}
   233	
   234	/**
   235	 * Safety valve for the coalesced rebuild.
   236	 *
   237	 * The cron trigger normally performs every rebuild, so the queue path only
   238	 * records staleness. If that trigger is missing or failing, the flag would
   239	 * never be drained and every dashboard would freeze silently — so the queue
   240	 * path still refreshes, at most once per fallback window. With a working cron
   241	 * the last rebuild is never older than the cron period, and this never fires.
   242	 */
   243	async function markStaleAndMaybeRebuild(stores, env) {
   244	  await stores.caseStore.markAggregatesDirty();
   245	  const minIntervalSeconds = positiveIntOr(
   246	    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
   247	    DEFAULT_FALLBACK_INTERVAL_SECONDS,
   248	  );
   249	  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   250	  if (!fallback?.due) return false;
   251	  let result;
   252	  try {
   253	    result = await rebuildUnderLease(stores, env);
   254	  } catch (error) {
   255	    console.error(JSON.stringify({
   256	      event: "cloudflare.aggregate_rebuild_failed",
   257	      path: "queue-fallback",
   258	      reason: fallback.reason,
   259	      pending_generation: fallback.pending_generation ?? null,
   260	      seconds_since_first_pending: fallback.seconds_since_first_pending ?? null,
     1	import { describe, expect, it, vi } from "vitest";
     2	import { createCloudflareStores } from "../storage/cloudflare.js";
     3	
     4	const REBUILD_TABLES = [
     5	  "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
     6	  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
     7	  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
     8	  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
     9	  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    10	];
    11	const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
    12	  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
    13	
    14	function d1({ responder = () => [], changes = 1, changesFor } = {}) {
    15	  const prepared = [];
    16	  const binding = {
    17	    prepared,
    18	    prepare(sql) {
    19	      const statement = {
    20	        sql,
    21	        params: [],
    22	        bind(...params) { this.params = params; return this; },
    23	        all: async () => ({ results: responder(sql) }),
    24	        first: async () => responder(sql)[0] ?? null,
    25	        run: async () => ({ meta: { changes: changesFor ? changesFor(sql) : changes } }),
    26	      };
    27	      prepared.push(statement);
    28	      return statement;
    29	    },
    30	    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
    31	  };
    32	  return binding;
    33	}
    34	
    35	function env(options) {
    36	  const catalog = d1(options);
    37	  return {
    38	    catalog,
    39	    value: {
    40	      IMMI_STORAGE_MODE: "cloudflare",
    41	      IMMI_CATALOG_DB: catalog,
    42	      IMMI_ACCOUNT_DB: d1(),
    43	      IMMI_OPS_DB: d1(),
    44	      IMMI_CONTENT: { put: vi.fn(), head: vi.fn(), get: vi.fn() },
    45	      CASE_VECTORS: { queryById: vi.fn(), query: vi.fn(), upsert: vi.fn() },
    46	      AI: { run: vi.fn() },
    47	    },
    48	  };
    49	}
    50	
    51	/** Build the bookkeeping rows the decision query reads. */
    52	function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
    53	  const rows = [];
    54	  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
    55	  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
    56	  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
    57	  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
    58	  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
    59	  if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
    60	  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
    61	  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
    62	  return rows;
    63	}
    64	
    65	const nowSeconds = () => Math.floor(Date.now() / 1000);
    66	
    67	describe("Catalog aggregate rebuild guard", () => {
    68	  it("records staleness as a monotonic generation, not a boolean", async () => {
    69	    const { catalog, value } = env();
    70	    const stores = createCloudflareStores(value);
    71	
    72	    await stores.caseStore.markAggregatesDirty();
    73	
    74	    // Three control rows committed as one transaction: the generation counter,
    75	    // the mutation timestamp and the staleness clock (armed only when zero).
    76	    expect(catalog.prepared).toHaveLength(3);
    77	    expect(catalog.batch).toHaveBeenCalledTimes(1);
    78	    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
    79	    const statement = catalog.prepared[0];
    80	    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
    81	    expect(statement.sql).toMatch(/rebuild_generation/);
    82	    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
    83	    expect(statement.params).toHaveLength(1);
    84	  });
    85	
    86	  it("stamps the mutation time and arms the staleness clock", async () => {
    87	    const { catalog, value } = env();
    88	    const before = nowSeconds();
    89	
    90	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
    91	
    92	    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
    93	    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
    94	    expect(mutation).toBeDefined();
    95	    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
    96	    expect(dirtySince).toBeDefined();
    97	    // The staleness clock only arms when it is currently zero.
    98	    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
    99	  });
   100	
   101	  it("never iterates the corpus when marking dirty", async () => {
   102	    const { catalog, value } = env();
   103	    const stores = createCloudflareStores(value);
   104	
   105	    await stores.caseStore.markAggregatesDirty();
   106	
   107	    // The only batch is the three control rows - no aggregate DELETE/INSERT.
   108	    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
   109	    expect(batched).toHaveLength(3);
   110	    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
   111	    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   112	  });
   113	
   114	  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
   115	    const { catalog, value } = env();
   116	
   117	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
   118	
   119	    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
   120	    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
   121	  });
   122	
   123	  it("reports clean when nothing is pending", async () => {
   124	    const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
   125	    const stores = createCloudflareStores(value);
   126	
   127	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   128	      .resolves.toEqual({ due: false, reason: "clean" });
   129	  });
   130	
   131	  it("stays dirty when a mutation arrives after the applied generation", async () => {
   132	    const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
   133	    const stores = createCloudflareStores(value);
   134	
   135	    // This is the race the boolean flag could not express: the rebuild applied
   136	    // generation 5, and generation 6 arrived while it was running.
   137	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   138	      .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
   139	  });
   140	
   141	  it("debounces a pending generation inside the interval", async () => {
   142	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
   143	    const stores = createCloudflareStores(value);
   144	
   145	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
   146	
   147	    expect(decision.due).toBe(false);
   148	    expect(decision.reason).toBe("debounced");
   149	    expect(decision.seconds_until_due).toBeGreaterThan(0);
   150	    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
   151	  });
   152	
   153	  it("rebuilds when the pending generation is older than the interval", async () => {
   154	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
   155	    const stores = createCloudflareStores(value);
   156	
   157	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   158	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   159	  });
   160	
   161	  it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
   162	    const { value } = env({ responder: () => state({ pending: 1 }) });
   163	    const stores = createCloudflareStores(value);
   164	
   165	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   166	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   167	  });
   168	
   169	  it("falls back to the default interval for invalid input", async () => {
   170	    const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
   171	    const stores = createCloudflareStores(value);
   172	
   173	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
   174	
   175	    expect(decision.due).toBe(false);
   176	    expect(decision.reason).toBe("debounced");
   177	  });
   178	
   179	  it("lets the staleness bound win over a just-stamped attempt", async () => {
   180	    // A failed rebuild stamps an attempt; the interval must not postpone work
   181	    // that has already exceeded the staleness bound.
   182	    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
   183	      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
   184	    const stores = createCloudflareStores(value);
   185	
   186	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
   187	      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
   188	  });
   189	
   190	  it("waits for a quiet window before rebuilding", async () => {
   191	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
   192	    const stores = createCloudflareStores(value);
   193	
   194	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
   195	
   196	    expect(decision.due).toBe(false);
   197	    expect(decision.reason).toBe("awaiting-quiet");
   198	    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
   199	    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
   200	  });
   201	
   202	  it("rebuilds once mutations have been quiet long enough", async () => {
   203	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
   204	    const stores = createCloudflareStores(value);
   205	
   206	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
   207	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   208	  });
   209	
   210	  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
   211	    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
   212	    const stores = createCloudflareStores(value);
   213	
   214	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
   215	
   216	    expect(decision.due).toBe(true);
   217	    expect(decision.reason).toBe("max-staleness");
   218	    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
   219	  });
   220	
   221	  it("keeps the legacy behaviour when no quiet window is configured", async () => {
   222	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
   223	    const stores = createCloudflareStores(value);
   224	
   225	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   226	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   227	  });
   228	
   229	  it("claims the rebuild lease only when the previous lease has expired", async () => {
   230	    const held = env({ changes: 0 });
   231	    await expect(createCloudflareStores(held.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
   232	      .resolves.toBeNull();
   233	
   234	    const free = env({ changes: 1 });
   235	    const lease = await createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 });
   236	    expect(lease).toMatchObject({ leaseSeconds: 600 });
   237	    expect(typeof lease.token).toBe("string");
   238	    expect(lease.token.length).toBeGreaterThan(7);
   239	
   240	    // Expiry and fencing token are written by the SAME statement, so the lease
   241	    // can never be observed in a torn state by an expiring holder.
   242	    const statement = free.catalog.prepared[0];
   243	    expect(statement.sql).toMatch(/rebuild_lease_until/);
   244	    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
   245	    expect(statement.params).toHaveLength(3);
   246	    expect(statement.params[0]).toBeGreaterThan(nowSeconds());
   247	    expect(statement.params[1]).toBe(lease.token);
   248	  });
   249	
   250	  it("rotates the token when a new owner claims the lease", async () => {
   251	    const { value } = env({ changes: 1 });
   252	    const stores = createCloudflareStores(value);
   253	
   254	    const first = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
   255	    const second = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
   256	
   257	    expect(first.token).not.toBe(second.token);
   258	  });
   259	
   260	  it("stamps the attempt time when the lease is taken", async () => {
   261	    const { catalog, value } = env();
   262	
   263	    const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });
   264	
   265	    const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
   266	    expect(attempt).toBeDefined();
   267	    expect(Number(attempt.params[0])).toBeLessThanOrEqual(nowSeconds());
   268	    // Two statements only: the lease itself (expiry + token) and the attempt
   269	    // stamp. There is no third write that could leave the token out of sync.
   270	    expect(catalog.prepared).toHaveLength(2);
   271	    expect(catalog.prepared[0].params[1]).toBe(lease.token);
   272	  });
   273	
   274	  it("enforces a floor on the lease length", async () => {
   275	    const { catalog, value } = env();
   276	    const before = nowSeconds();
   277	
   278	    await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });
   279	
   280	    expect(catalog.prepared[0].params[0]).toBeGreaterThanOrEqual(before + 60);
   281	  });
   282	
   283	  it("renews only while this caller still owns the lease", async () => {
   284	    const owned = env({ changes: 1 });
   285	    await expect(createCloudflareStores(owned.value).caseStore.renewRebuildLease({ token: "owner-token", leaseSeconds: 900 }))
   286	      .resolves.toBe(true);
   287	    const renew = owned.catalog.prepared[0];
   288	    expect(renew.sql).toMatch(/WHERE summary_key = 'rebuild_lease_until' AND updated_at = \?/);
   289	    expect(renew.params).toEqual([expect.any(Number), "owner-token", "owner-token"]);
   290	
   291	    const lost = env({ changes: 0 });
   292	    await expect(createCloudflareStores(lost.value).caseStore.renewRebuildLease({ token: "stale-token", leaseSeconds: 900 }))
   293	      .resolves.toBe(false);
   294	  });
   295	
   296	  it("releases the lease only when the token still matches", async () => {
   297	    const { catalog, value } = env();
   298	
   299	    await createCloudflareStores(value).caseStore.releaseRebuildLease({ token: "owner-token" });
   300	
   301	    expect(catalog.prepared[0].sql).toMatch(/UPDATE catalog_summary SET value_int = 0/);
   302	    expect(catalog.prepared[0].sql).toMatch(/AND updated_at = \?/);
   303	    expect(catalog.prepared[0].params).toEqual([expect.any(String), "owner-token"]);
   304	  });
   305	
   306	  it("refuses a release without a token", async () => {
   307	    const { catalog, value } = env();
   308	    const stores = createCloudflareStores(value);
   309	
   310	    await expect(stores.caseStore.releaseRebuildLease()).resolves.toBe(false);
   311	    await expect(stores.caseStore.releaseRebuildLease({ token: "" })).resolves.toBe(false);
   312	    expect(catalog.prepared).toHaveLength(0);
   313	  });
   314	
   315	  it("aborts the rebuild when the lease is lost mid-run", async () => {
   316	    // The renewal update matches no row, so this invocation no longer owns the
   317	    // lease and must stop instead of interleaving its DELETEs with the new owner.
   318	    const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
   319	    const stores = createCloudflareStores(value);
   320	
   321	    await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
   322	      .rejects.toThrow(/lease lost/);
   323	  });
   324	
   325	  it("does not consult the lease when the rebuild runs without one", async () => {
   326	    const { catalog, value } = env();
   327	    const stores = createCloudflareStores(value);
   328	
   329	    await stores.caseStore.rebuildAggregates();
   330	
   331	    // The only UPDATE is the conditional dirty_since disarm, never a lease renewal.
   332	    const updates = catalog.prepared.filter((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"));
   333	    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
   334	    expect(updates.some((s) => s.sql.includes("'rebuild_lease_until'"))).toBe(false);
   335	  });
   336	
   337	  it("throttles a retry after a failed rebuild", async () => {
   338	    // A failed rebuild releases its lease without stamping rebuild_last_at, so
   339	    // the decision must also consider the attempt stamp.
   340	    const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
   341	    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   342	      .resolves.toMatchObject({ due: false, reason: "debounced" });
   343	
   344	    const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
   345	    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   346	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   347	  });
   348	
   349	  it("clears and rewrites exactly the documented summary tables", async () => {
   350	    const { catalog, value } = env();
   351	    const stores = createCloudflareStores(value);
   352	
   353	    await stores.caseStore.rebuildAggregates();
   354	
   355	    const deleted = catalog.prepared
   356	      .filter((s) => /^DELETE FROM /.test(s.sql))
   357	      .map((s) => s.sql.replace("DELETE FROM ", "").split(" ")[0]);
   358	    expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
   359	    // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
   360	    // + 3 bookkeeping statements (applied generation, last rebuild, conditional
   361	    // dirty_since disarm).
   362	    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
   363	  });
   364	
   365	  it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
   366	    const { catalog, value } = env();
   367	    const stores = createCloudflareStores(value);
   368	
   369	    await stores.caseStore.rebuildAggregates();
   370	
   371	    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
   372	    expect(summaryDelete).toBeDefined();
   373	    expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
   374	    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
   375	  });
   376	
   377	  it("records the generation observed before the scan, not a bare clean flag", async () => {
   378	    const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
   379	    const stores = createCloudflareStores(value);
   380	
   381	    const before = nowSeconds();
   382	    await stores.caseStore.rebuildAggregates();
   383	    const after = nowSeconds();
   384	
   385	    const applied = catalog.prepared
   386	      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
   387	    const stamp = catalog.prepared
   388	      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
   389	    const resetDirtySince = catalog.prepared
   390	      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
   391	    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
   392	    expect(Number(applied.params[0])).toBe(7);
   393	    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
   394	    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
   395	    // The disarm is conditional on no mutation arriving mid-scan, so continuous
   396	    // writes can never reset the staleness clock on every rebuild.
   397	    expect(resetDirtySince).toBeDefined();
   398	    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
   399	    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
   400	    expect(Number(resetDirtySince.params[1])).toBe(7);
   401	    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
   402	  });
   403	
   404	  it("batches the rebuild statements in bounded chunks", async () => {
   405	    const { catalog, value } = env();
   406	    const stores = createCloudflareStores(value);
   407	
   408	    await stores.caseStore.rebuildAggregates();
   409	
   410	    for (const call of catalog.batch.mock.calls) expect(call[0].length).toBeLessThanOrEqual(20);
   411	    expect(catalog.batch.mock.calls.length).toBeGreaterThan(1);
   412	  });
   413	});
     1	"""Execute the captured statements against a real SQLite DB with the real schema.
     2	
     3	Mocks cannot catch CHECK-constraint violations, UPSERT syntax errors, duplicate
     4	keys, or the mid-rebuild race this change exists to fix; this harness runs the
     5	exact SQL the Worker issues and simulates the race deterministically.
     6	"""
     7	import json
     8	import sqlite3
     9	import sys
    10	import time
    11	from pathlib import Path
    12	
    13	REPO = Path("/Volumes/Storm Breaker/Developer/IMMI-Case-")
    14	statements = json.loads((REPO / "work/rebuild-statements.json").read_text())
    15	schema = (REPO / "migrations/d1/catalog/0001_catalog.sql").read_text()
    16	
    17	connection = sqlite3.connect(":memory:")
    18	skipped = []
    19	try:
    20	    connection.executescript(schema)
    21	except sqlite3.OperationalError as error:
    22	    skipped.append(("schema", str(error)))
    23	connection.commit()
    24	tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
    25	missing = [name for name in ("cases", "case_concepts", "case_judges", "judges", "concepts", "catalog_summary",
    26	                             "filter_options", "aggregate_concept_pair", "aggregate_concept_scope")
    27	           if name not in tables]
    28	print(f"  schema tables: {len(tables)} | missing: {missing}")
    29	
    30	SHA = "a" * 64
    31	CASE_COLUMNS = ("case_id, title, citation, court_code, year, outcome, visa_subclass, visa_type, "
    32	                "case_nature, country_of_origin, source, content_key, content_sha256, content_size, "
    33	                "created_at, updated_at")
    34	def case_row(case_id, court_code, year, outcome, visa_subclass, nature, country, source, content_key):
    35	    values = (f"'{case_id}','Case {case_id[:4]}','[{year}] {court_code} 1','{court_code}',{year},"
    36	              f"'{outcome}','{visa_subclass}','skilled','{nature}','{country}','{source}',"
    37	              f"'{content_key}','{SHA}',10,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'")
    38	    return f"INSERT INTO cases ({CASE_COLUMNS}) VALUES ({values})"
    39	
    40	SEED = [
    41	    case_row("aaaaaaaaaaaa", "FCA", 2026, "Affirmed", "482", "review", "India", "austlii", "cases/aaaa.txt"),
    42	    case_row("bbbbbbbbbbbb", "FCA", 2025, "Dismissed", "500", "review", "China", "austlii", ""),
    43	    case_row("cccccccccccc", "HCA", 2025, "Affirmed", "482", "appeal", "India", "hca", "cases/cccc.txt"),
    44	    "INSERT INTO concepts (concept_id, label) VALUES ('c1','procedural fairness'),('c2','jurisdictional error')",
    45	    "INSERT INTO case_concepts (case_id, concept_id) VALUES ('aaaaaaaaaaaa','c1'),('aaaaaaaaaaaa','c2'),('bbbbbbbbbbbb','c1')",
    46	    "INSERT INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES ('j1','Justice Example','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    47	    "INSERT INTO case_judges (case_id, judge_id) VALUES ('aaaaaaaaaaaa','j1'),('bbbbbbbbbbbb','j1')",
    48	]
    49	for statement in SEED:
    50	    connection.execute(statement)
    51	connection.commit()
    52	
    53	failures = []
    54	def check(label, condition, detail=""):
    55	    if condition:
    56	        print(f"  ok   {label}")
    57	    else:
    58	        text = f"{label} :: {detail}"
    59	        print(f"  FAIL {text}")
    60	        failures.append(text)
    61	
    62	def summary() -> dict:
    63	    return dict(connection.execute("SELECT summary_key, value_int FROM catalog_summary").fetchall())
    64	
    65	def bookkeeping_params(statement: dict, observed: int) -> list:
    66	    """Bind the runtime-observed generation into the capture-time bookkeeping SQL.
    67	
    68	    The Worker reads the generation at the start of every rebuild, so the two
    69	    statements that consume it (the applied-generation row and the conditional
    70	    disarm) must be replayed with the value the harness observed.
    71	    """
    72	    params = list(statement["params"])
    73	    if statement["sql"].startswith("INSERT OR REPLACE") and "'rebuild_applied_generation'" in statement["sql"]:
    74	        params[0] = observed
    75	    elif statement["sql"].startswith("UPDATE catalog_summary"):
    76	        params[-1] = observed
    77	    return params
    78	
    79	rebuild = [s for s in statements if s["phase"] == "init"
    80	           and (s["sql"].startswith(("DELETE FROM", "INSERT INTO", "INSERT OR REPLACE"))
    81	                or s["sql"].startswith("UPDATE catalog_summary"))]
    82	bookkeeping = [s for s in rebuild if "catalog_summary" in s["sql"] and not s["sql"].startswith("SELECT")]
    83	aggregate_work = [s for s in rebuild if "catalog_summary" not in s["sql"]]
    84	assert len(rebuild) == 44, f"expected 44 rebuild statements, captured {len(rebuild)}"
    85	
    86	# 1. Happy path: the whole rebuild runs against the real schema. The staleness
    87	#    clock starts armed so the conditional disarm is actually exercised.
    88	connection.execute(
    89	    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
    90	)
    91	connection.commit()
    92	for statement in rebuild:
    93	    connection.execute(statement["sql"], statement["params"])
    94	connection.commit()
    95	state = summary()
    96	check("rebuild writes total_cases", state.get("total_cases") == 3, state)
    97	check("rebuild writes with_full_text", state.get("with_full_text") == 2, state)
    98	check("rebuild stamps last rebuild time", abs(state.get("rebuild_last_at", 0) - int(time.time())) < 60, state)
    99	check("rebuild applies the generation it observed",
   100	      state.get("rebuild_applied_generation") == state.get("rebuild_generation", 0), state)
   101	
   102	counts = {
   103	    "aggregate_court_year_outcome": connection.execute("SELECT COUNT(*) FROM aggregate_court_year_outcome").fetchone()[0],
   104	    "aggregate_visa": connection.execute("SELECT COUNT(*) FROM aggregate_visa").fetchone()[0],
   105	    "aggregate_concept_pair": connection.execute("SELECT COUNT(*) FROM aggregate_concept_pair").fetchone()[0],
   106	    "filter_options": connection.execute("SELECT COUNT(*) FROM filter_options").fetchone()[0],
   107	}
   108	check("aggregates are populated", all(v > 0 for v in counts.values()), counts)
   109	check("bookkeeping rows exist after the rebuild",
   110	      {"rebuild_applied_generation", "rebuild_last_at"} <= set(state), list(state))
   111	check("a clean rebuild disarms the staleness clock",
   112	      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))
   113	
   114	# 2. The race the boolean flag could not express: a mutation lands after the
   115	#    aggregate scan but before the bookkeeping write.
   116	connection.execute("DELETE FROM catalog_summary WHERE summary_key NOT IN ('rebuild_generation','rebuild_applied_generation','rebuild_last_at','rebuild_lease_until')")
   117	connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_generation', 5, 'seed')")
   118	connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_applied_generation', 4, 'seed')")
   119	connection.commit()
   120	
   121	# The Worker re-reads the generation at the start of every rebuild, so bind the
   122	# runtime-observed value here rather than the capture-time parameter.
   123	observed = connection.execute(
   124	    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
   125	).fetchone()[0]
   126	assert observed == 5, observed
   127	for statement in aggregate_work:
   128	    connection.execute(statement["sql"], statement["params"])
   129	dirty = [s for s in statements if s["phase"] == "mark_dirty"]
   130	for statement in dirty:                                    # ← mutation mid-rebuild
   131	    connection.execute(statement["sql"], statement["params"])
   132	armed = connection.execute(
   133	    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
   134	).fetchone()
   135	check("a mutation arms the staleness clock", bool(armed) and armed[0] > 0, armed)
   136	for statement in bookkeeping:
   137	    connection.execute(statement["sql"], bookkeeping_params(statement, observed))
   138	connection.commit()
   139	
   140	state = summary()
   141	check("mid-rebuild mutation stays pending",
   142	      state.get("rebuild_generation", 0) > state.get("rebuild_applied_generation", 0), state)
   143	check("applied generation equals the pre-scan snapshot", state.get("rebuild_applied_generation") == 5, state)
   144	check("a mid-scan mutation keeps the staleness clock armed",
   145	      state.get("rebuild_dirty_since", 0) > 0, state.get("rebuild_dirty_since"))
   146	
   147	decision_sql = [s for s in statements if s["phase"] == "decision"][0]
   148	rows = {row[0]: row[1] for row in connection.execute(decision_sql["sql"], decision_sql["params"]).fetchall()}
   149	check("decision query sees the pending generation",
   150	      rows.get("rebuild_generation", 0) > rows.get("rebuild_applied_generation", 0), rows)
   151	
   152	# 3. Lease semantics under real SQLite: the conditional upsert must only win
   153	#    when the held lease has expired.
   154	lease_claim = [s for s in statements if s["phase"] == "lease_claim"]
   155	claim = lease_claim[0]
   156	token_write = next((s for s in lease_claim if "rebuild_lease_token" in s["sql"]), None)
   157	attempt_write = next(s for s in lease_claim if "'rebuild_last_attempt_at'" in s["sql"])
   158	check("claim writes expiry and token in one statement",
   159	      token_write is None and len(claim["params"]) == 3, [s["sql"][:40] for s in lease_claim])
   160	renew = [s for s in statements if s["phase"] == "lease_renew"][0]
   161	release = [s for s in statements if s["phase"] == "lease_release"][0]
   162	release_sql, release_params = release["sql"], release["params"]
   163	
   164	connection.execute("UPDATE catalog_summary SET value_int = 0 WHERE summary_key = 'rebuild_lease_until'")
   165	connection.commit()
   166	cursor = connection.execute(claim["sql"], claim["params"])
   167	held_until = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
   168	check("lease claim wins when free", cursor.rowcount > 0 and held_until > int(time.time()), held_until)
   169	
   170	cursor = connection.execute(claim["sql"], claim["params"])
   171	check("second claim loses while the lease holds", cursor.rowcount == 0, cursor.rowcount)
   172	
   173	# The attempt stamp is the only follow-up write; the token lives on the lease row.
   174	connection.execute(attempt_write["sql"], attempt_write["params"])
   175	connection.commit()
   176	token, held_updated_at = connection.execute(
   177	    "SELECT value_int, updated_at FROM catalog_summary WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?",
   178	    [claim["params"][1]],
   179	).fetchone() or (None, None)
   180	check("lease row carries the fencing token", token is not None and held_updated_at == claim["params"][1], held_updated_at)
   181	attempt = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_last_attempt_at'").fetchone()[0]
   182	check("claim stamps the attempt time", attempt <= int(time.time()), attempt)
   183	
   184	# Renewal: wins with the owner token, loses with anyone else's.
   185	owner_token = claim["params"][1]
   186	cursor = connection.execute(renew["sql"], [int(time.time()) + 600, owner_token, owner_token])
   187	check("renew wins for the owner token", cursor.rowcount > 0, cursor.rowcount)
   188	cursor = connection.execute(renew["sql"], [int(time.time()) + 600, "stale-token", "stale-token"])
   189	check("renew loses for a stale token", cursor.rowcount == 0, cursor.rowcount)
   190	
   191	# Release: a stale owner must NOT be able to free the current lease.
   192	cursor = connection.execute(release_sql, [release_params[0], "stale-token"])
   193	still_held = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
   194	check("stale release cannot free someone else's lease", cursor.rowcount == 0 and still_held > int(time.time()), (cursor.rowcount, still_held))
   195	
   196	cursor = connection.execute(release_sql, [release_params[0], owner_token])
   197	released = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
   198	check("owner release frees the lease", cursor.rowcount > 0 and released == 0, (cursor.rowcount, released))
   199	
   200	connection.execute("UPDATE catalog_summary SET value_int = 1 WHERE summary_key = 'rebuild_lease_until'")
   201	connection.commit()
   202	cursor = connection.execute(claim["sql"], claim["params"])
   203	check("claim wins again after expiry", cursor.rowcount > 0, cursor.rowcount)
   204	
   205	# 4. Dirty upsert stays a single row and keeps other summaries intact.
   206	mark_dirty = [s for s in statements if s["phase"] == "mark_dirty"]
   207	generation_write = mark_dirty[0]
   208	mutation_write = next(s for s in mark_dirty if "rebuild_last_mutation_at" in s["sql"])
   209	dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
   210	for statement in (generation_write, mutation_write, dirty_since_write):
   211	    connection.execute(statement["sql"], statement["params"])
   212	connection.execute(mutation_write["sql"], mutation_write["params"])
   213	first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
   214	connection.execute(mutation_write["sql"], mutation_write["params"])
   215	second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
   216	check("staleness clock arms on the first mutation only", first_arm == second_arm and first_arm > 0, (first_arm, second_arm))
   217	last_mutation = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_last_mutation_at'").fetchone()[0]
   218	check("mutation timestamp is refreshed", abs(last_mutation - int(time.time())) < 60, last_mutation)
   219	# The disarm is conditional: a rebuild that applied the generation it observed
   220	# (nothing new arrived) clears the clock, one that observed an older generation
   221	# leaves it armed (covered above).
   222	observed_now = connection.execute(
   223	    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
   224	).fetchone()[0]
   225	for statement in bookkeeping:
   226	    connection.execute(statement["sql"], bookkeeping_params(statement, observed_now))
   227	connection.commit()
   228	reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
   229	check("rebuild with nothing new disarms the staleness clock", reset == 0, reset)
   230	
   231	for _ in range(3):
   232	    connection.execute(generation_write["sql"], generation_write["params"])
   233	connection.commit()
   234	check("generation upsert stays a single row",
   235	      connection.execute("SELECT COUNT(*) FROM catalog_summary WHERE summary_key = 'rebuild_generation'").fetchone()[0] == 1)
   236	check("dirty writes do not clobber other summaries",
   237	      connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").fetchone()[0] == 3)
   238	
   239	print()
   240	if skipped:
   241	    print("skipped schema statements:", [s[0] for s in skipped])
   242	print(json.dumps({"failures": failures, "state": state, "aggregate_counts": counts, "decision_rows": rows},
   243	                 default=str, indent=1))
   244	sys.exit(1 if failures else 0)

hook: PostToolUse
hook: PostToolUse Completed
**Identifying duplicate stale rows in docs**
**Analyzing atomicity of batch SQL mutations**
**Verifying statement ordering in batch execution**
**Searching aggregate references**
**Analyzing mid-scan mutation sequencing**
**Confirming individual control writes sequencing**
**Assessing db.batch atomicity in tests**
exec
/bin/zsh -lc "rg -n \"markAggregatesDirty\\(|aggregatesNeedRebuild\\(|rebuildUnderLease\\(|rebuild_dirty_since|control row|control-row|\\"'$0'"\\.58|\\"'$4,500|'"\\"'$28|BOOKKEEPING_KEYS" --glob '"'"'!work/rebuild-statements.json'"' . && nl -ba workers/storage/cloudflare.js | sed -n '990,1220p' && nl -ba workers/cloudflare-native.js | sed -n '160,280p' && nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '1,280p' && nl -ba docs/ops/aggregate-rebuild-cost-guard.md | sed -n '1,145p' && nl -ba work/codex-review5.md | sed -n '1,300p'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
./.claude/STATE.md:9:- HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
./.claude/STATE.md:13:- MED: `markAggregatesDirty()` writes its three control rows in one atomic
./.claude/STATE.md:19:- LOW: docs state the real control-row counts and per-import cost.
./.claude/STATE.md:28:  and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
./.claude/STATE.md:49:- The queue path now records staleness (`markAggregatesDirty()`, one row); the
./docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
./docs/ops/aggregate-rebuild-cost-guard.md:51:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./docs/ops/aggregate-rebuild-cost-guard.md:85:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./docs/ops/aggregate-rebuild-cost-guard.md:91:| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
./docs/ops/aggregate-rebuild-cost-guard.md:92:| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
./docs/ops/aggregate-rebuild-cost-guard.md:189:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review4.md:28:5. failed rebuilds were not throttled → `claimRebuildLease()` stamps `rebuild_last_attempt_at`; `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review4.md:338:+async function rebuildUnderLease(stores, env) {
./work/codex-review4.md:373:+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:379:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:401:+  await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:406:+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:408:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:590:+const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review4.md:786:+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review4.md:899:+  async markAggregatesDirty() {
./work/codex-review4.md:922:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review4.md:1330:async function rebuildUnderLease(stores, env) {
./work/codex-review4.md:1365:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:1371:  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:1393:  await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:1398:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:1400:  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:1469:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review4.md:1527:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review4.md:1637:  async markAggregatesDirty() {
./work/codex-review4.md:1660:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review4.md:1746:workers/cloudflare-native.js:184:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:1747:workers/cloudflare-native.js:212:  await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:1748:workers/cloudflare-native.js:217:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:1751:workers/storage/cloudflare.js:1130:  async markAggregatesDirty() {
./work/codex-review4.md:1752:workers/storage/cloudflare.js:1153:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review4.md:1756:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:69:    await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:1757:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:83:    await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:1758:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1759:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:103:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1760:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:111:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review4.md:1761:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:123:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1762:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:131:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1763:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:139:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review4.md:1777:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:254:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1778:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:258:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:1817:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-review4.md:1867:    - Queue batches record staleness only: markAggregatesDirty() increments a
./work/codex-review4.md:2385:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-review4.md:2443:    await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:2457:    await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:2467:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2477:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2485:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review4.md:2497:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2505:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2513:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review4.md:2628:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2632:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review4.md:2660:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review4.md:2741:+| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review4.md:2742:+| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review4.md:2756:+| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review4.md:2793:+`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review4.md:2942:+async function rebuildUnderLease(stores, env) {
./work/codex-review4.md:2977:+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:2983:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:3005:+  await stores.caseStore.markAggregatesDirty();
./work/codex-review4.md:3010:+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review4.md:3012:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review4.md:3130:+const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review4.md:3216:+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review4.md:3315:+  async markAggregatesDirty() {
./work/codex-review4.md:3338:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review4.md:3468:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review4.md:3470:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review4.md:3477:docs/ops/aggregate-rebuild-cost-guard.md:82:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./docs/ops/operator-deploy-checklist.md:75:| Control keys exist | `npx wrangler d1 execute immi-catalog --remote --command "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'"` | `rebuild_generation`, `rebuild_applied_generation`, `rebuild_last_at`, `rebuild_dirty_since`, `rebuild_lease_until`, `rebuild_last_attempt_at` once activity resumed |
./docs/ops/operator-deploy-checklist.md:98:Never restore the per-batch rebuild (`markAggregatesDirty()` →
./work/verify-rebuild-sql.py:89:    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
./work/verify-rebuild-sql.py:112:      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))
./work/verify-rebuild-sql.py:133:    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
./work/verify-rebuild-sql.py:145:      state.get("rebuild_dirty_since", 0) > 0, state.get("rebuild_dirty_since"))
./work/verify-rebuild-sql.py:209:dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
./work/verify-rebuild-sql.py:213:first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/verify-rebuild-sql.py:215:second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/verify-rebuild-sql.py:228:reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review.md:28:- The fix: queue batches only record staleness (`markAggregatesDirty()` writes one row into `catalog_summary`), and a new `scheduled()` handler does at most one rebuild per `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300), driven by a `[triggers]` cron `*/5 * * * *` added to `wrangler.toml` and `config/wrangler-cloudflare-native.toml.example`.
./work/codex-review.md:47:3. Concurrency: two scheduled invocations overlapping, clock skew between Workers and D1, or a rebuild running while `markAggregatesDirty()` writes — can the dirty flag be cleared without the data actually being refreshed?
./work/codex-review.md:159:workers/cloudflare-native.js:182:  await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:177:workers/storage/cloudflare.js:1087:  async markAggregatesDirty() {
./work/codex-review.md:200:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:63:    await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:202:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:77:    await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:209:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`. New `scheduled()` handler runs the rebuild at most once per interval. |
./work/codex-review.md:210:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()` and `aggregatesNeedRebuild({ minIntervalSeconds })`. `rebuildAggregates()` now clears `rebuild_dirty` and stamps `rebuild_last_at` as part of its own statement set. |
./work/codex-review.md:217:docs/ops/aggregate-rebuild-cost-guard.md:82:Revert the one-line consumer change (`markAggregatesDirty()` →
./work/codex-review.md:298:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review.md:333:  await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:334:  const fallback = await stores.caseStore.aggregatesNeedRebuild({
./work/codex-review.md:507:  async markAggregatesDirty() {
./work/codex-review.md:521:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review.md:901:    await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:915:    await stores.caseStore.markAggregatesDirty();
./work/codex-review.md:925:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review.md:933:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review.md:945:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review.md:955:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review.md:963:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review.md:1251:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval. |
./work/codex-review.md:1252:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()` and `aggregatesNeedRebuild({ minIntervalSeconds })`. `rebuildAggregates()` now clears `rebuild_dirty` and stamps `rebuild_last_at` as part of its own statement set. |
./work/codex-review.md:1316:Revert the one-line consumer change (`markAggregatesDirty()` →
./work/codex-review.md:1957:- HIGH — [workers/storage/cloudflare.js:1075](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1075): 重建最後會無條件寫入 `rebuild_dirty = 0`。若案件變更及 `markAggregatesDirty()` 發生在所有 aggregate 查詢完成後、但最後 bookkeeping batch 前，新的資料不會進入本次 aggregate，卻會被最後的 `0` 覆蓋；訊息已確認，之後排程判為 clean，儀表板可永久過期。修正：以單調遞增的 generation／epoch 記錄 mutation；重建只確認其開始時觀察到的 generation，若 generation 已變則保留 dirty。
./work/codex-review.md:1959:- HIGH — [workers/cloudflare-native.js:147](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:147): `aggregatesNeedRebuild()` 與 `rebuildAggregates()` 間沒有原子 claim 或 lease。兩個重疊的 cron invocation 都可讀到 `due: true`，並各自執行完整的 17-table 重建；由於重建分成多個 D1 batch，還可能互相刪除或造成部分寫入失敗。修正：先以 D1 的條件式更新原子取得 rebuild lease，再執行重建；完成時以同一 generation 規則釋放 lease／保留新 dirty 狀態。
./work/codex-review.md:1963:- Queue coalescing／acknowledgement：除上述 race 外 no finding；`markAggregatesDirty()` 失敗會阻止 ack 並進入 retry。文件化的一小時 fallback 是有界的例外，不是每 batch 重建。
./work/codex-review.md:1976:- HIGH — [workers/storage/cloudflare.js:1075](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1075): 重建最後會無條件寫入 `rebuild_dirty = 0`。若案件變更及 `markAggregatesDirty()` 發生在所有 aggregate 查詢完成後、但最後 bookkeeping batch 前，新的資料不會進入本次 aggregate，卻會被最後的 `0` 覆蓋；訊息已確認，之後排程判為 clean，儀表板可永久過期。修正：以單調遞增的 generation／epoch 記錄 mutation；重建只確認其開始時觀察到的 generation，若 generation 已變則保留 dirty。
./work/codex-review.md:1978:- HIGH — [workers/cloudflare-native.js:147](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:147): `aggregatesNeedRebuild()` 與 `rebuildAggregates()` 間沒有原子 claim 或 lease。兩個重疊的 cron invocation 都可讀到 `due: true`，並各自執行完整的 17-table 重建；由於重建分成多個 D1 batch，還可能互相刪除或造成部分寫入失敗。修正：先以 D1 的條件式更新原子取得 rebuild lease，再執行重建；完成時以同一 generation 規則釋放 lease／保留新 dirty 狀態。
./work/codex-review.md:1982:- Queue coalescing／acknowledgement：除上述 race 外 no finding；`markAggregatesDirty()` 失敗會阻止 ack 並進入 retry。文件化的一小時 fallback 是有界的例外，不是每 batch 重建。
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:12:  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:61:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:72:    await stores.caseStore.markAggregatesDirty();
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74:    // Three control rows committed as one transaction: the generation counter,
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:105:    await stores.caseStore.markAggregatesDirty();
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:107:    // The only batch is the three control rows - no aggregate DELETE/INSERT.
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:117:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:127:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:137:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:145:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:157:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:165:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:173:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:186:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:194:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:206:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:214:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:225:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:333:    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:341:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:345:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:374:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:398:    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
./work/codex-review5.md:23:- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
./work/codex-review5.md:24:- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
./work/codex-review5.md:25:- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
./work/codex-review5.md:30:1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
./work/codex-review5.md:32:3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
./work/codex-review5.md:96: | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review5.md:97: | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review5.md:111: | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review5.md:115:+| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review5.md:116:+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review5.md:150: `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review5.md:253:+- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review5.md:302: const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-review5.md:352:+  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review5.md:363:     await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:380:+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review5.md:383:+    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:395:     await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:405:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:415:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:423:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review5.md:435:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:443:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:451:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review5.md:461:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:473:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review5.md:481:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:492:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:605:     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:609:     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:639:     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review5.md:655:+      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:661:+    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review5.md:1109: async function rebuildUnderLease(stores, env) {
./work/codex-review5.md:1144:-  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review5.md:1145:+  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:1151:   const result = await rebuildUnderLease(stores, env);
./work/codex-review5.md:1173:   await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:1178:-  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review5.md:1179:+  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:1181:   const result = await rebuildUnderLease(stores, env);
./work/codex-review5.md:1317: const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review5.md:1320:+  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review5.md:1483:+        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review5.md:1507:   async markAggregatesDirty() {
./work/codex-review5.md:1524:+        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review5.md:1538:+                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review5.md:1549:-  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review5.md:1550:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review5.md:1577:+    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review5.md:1819:/bin/zsh -c 'grep -n -E "rebuildDecisionParams|markAggregatesDirty|aggregatesNeedRebuild|rebuild_dirty_since|rebuild_last_mutation_at|AGGREGATE_REBUILD_(QUIET|MAX_STALENESS)" workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-native-scheduled-rebuild.test.js config/wrangler-cloudflare-native.toml.example wrangler.toml docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
./work/codex-review5.md:1824:workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:1825:workers/cloudflare-native.js:227:  await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:1826:workers/cloudflare-native.js:232:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:1827:workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review5.md:1830:workers/storage/cloudflare.js:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review5.md:1831:workers/storage/cloudflare.js:1133:  async markAggregatesDirty() {
./work/codex-review5.md:1833:workers/storage/cloudflare.js:1149:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review5.md:1834:workers/storage/cloudflare.js:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review5.md:1835:workers/storage/cloudflare.js:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review5.md:1836:workers/storage/cloudflare.js:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review5.md:1839:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review5.md:1840:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:71:    await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:1841:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:87:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review5.md:1843:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:1844:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:102:    await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:1845:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:112:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1846:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:122:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1847:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:130:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review5.md:1848:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:142:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1849:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:150:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1850:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:158:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review5.md:1851:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:168:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:1852:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:180:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review5.md:1853:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:188:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:1854:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:199:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1855:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:312:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1856:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:316:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:1857:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:1858:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review5.md:1885:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review5.md:1886:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review5.md:1887:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review5.md:1888:docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review5.md:1889:docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review5.md:1890:docs/ops/aggregate-rebuild-cost-guard.md:84:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review5.md:1896:docs/ops/aggregate-rebuild-cost-guard.md:188:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review5.md:2071:async function rebuildUnderLease(stores, env) {
./work/codex-review5.md:2106:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:2112:  const result = await rebuildUnderLease(stores, env);
./work/codex-review5.md:2134:  await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:2139:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:2141:  const result = await rebuildUnderLease(stores, env);
./work/codex-review5.md:2186:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review5.md:2189:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review5.md:2225:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review5.md:2313:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review5.md:2337:  async markAggregatesDirty() {
./work/codex-review5.md:2353:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review5.md:2366:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review5.md:2377:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review5.md:2400:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review5.md:2435:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review5.md:2446:    await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:2462:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review5.md:2465:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:2477:    await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:2487:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2497:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2505:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review5.md:2517:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2525:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2533:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review5.md:2543:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:2555:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review5.md:2563:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review5.md:2574:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2610:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review5.md:2626:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:2632:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review5.md:2665:  await stores.caseStore.markAggregatesDirty();
./work/codex-review5.md:2670:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review5.md:2672:  const result = await rebuildUnderLease(stores, env);
./work/codex-review5.md:2889:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2893:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review5.md:2921:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review5.md:2937:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:2943:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review5.md:3356:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review5.md:3357:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:3364:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review5.md:3365:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review5.md:3372:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review5.md:3382:**Assessing robustness of rebuild_dirty_since handling**
./work/codex-review5.md:3396:grep -n -E 'if \\(elapsedSeconds < interval\\)|maxStaleness|INSERT OR REPLACE INTO catalog_summary|rebuild_dirty_since|DELETE FROM catalog_summary WHERE' workers/storage/cloudflare.js
./work/codex-review5.md:3404:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review5.md:3409:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review5.md:3410:1149:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review5.md:3411:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review5.md:3412:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review5.md:3416:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review5.md:3440:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
./work/codex-review5.md:3450:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
./work/codex-review5.md:3457:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
./work/codex-review5.md:3467:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
./work/codex-rereview.md:28:   Fix: bookkeeping is now a monotonic generation. `markAggregatesDirty()` increments `rebuild_generation` (`ON CONFLICT ... SET value_int = catalog_summary.value_int + 1`); `rebuildAggregates()` snapshots `rebuild_generation` BEFORE scanning and writes `rebuild_applied_generation` = that snapshot at the end; "dirty" is `rebuild_generation > rebuild_applied_generation`. The rebuild's `DELETE FROM catalog_summary` now excludes the four bookkeeping keys.
./work/codex-rereview.md:29:2. HIGH — no atomic claim between `aggregatesNeedRebuild()` and `rebuildAggregates()`, so two overlapping invocations could both rebuild and interleave 17-table DELETEs.
./work/codex-rereview.md:30:   Fix: `claimRebuildLease()` is a conditional upsert (`... DO UPDATE SET value_int = excluded.value_int ... WHERE catalog_summary.value_int < ?`) whose `changes` value decides ownership; `rebuildUnderLease()` in the worker releases the lease in a `finally`, with a lease length of `max(600, interval * 2)`.
./work/codex-rereview.md:251:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-rereview.md:252:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-rereview.md:254:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-rereview.md:325:workers/cloudflare-native.js:148:async function rebuildUnderLease(stores, minIntervalSeconds) {
./work/codex-rereview.md:329:workers/cloudflare-native.js:181:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-rereview.md:330:workers/cloudflare-native.js:187:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
./work/codex-rereview.md:331:workers/cloudflare-native.js:209:  await stores.caseStore.markAggregatesDirty();
./work/codex-rereview.md:333:workers/cloudflare-native.js:214:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-rereview.md:334:workers/cloudflare-native.js:216:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
./work/codex-rereview.md:341:workers/storage/cloudflare.js:1109:  async markAggregatesDirty() {
./work/codex-rereview.md:345:workers/storage/cloudflare.js:1132:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-rereview.md:354:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-rereview.md:355:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-rereview.md:357:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-rereview.md:404:async function rebuildUnderLease(stores, minIntervalSeconds) {
./work/codex-rereview.md:437:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-rereview.md:443:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
./work/codex-rereview.md:465:  await stores.caseStore.markAggregatesDirty();
./work/codex-rereview.md:470:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-rereview.md:472:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
./work/codex-rereview.md:506:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-rereview.md:606:  async markAggregatesDirty() {
./work/codex-rereview.md:629:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-rereview.md:743:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-rereview.md:744:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-rereview.md:758:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-rereview.md:1114:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-rereview.md:1170:    await stores.caseStore.markAggregatesDirty();
./work/codex-rereview.md:1184:    await stores.caseStore.markAggregatesDirty();
./work/codex-rereview.md:1194:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-rereview.md:1204:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-rereview.md:1212:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-rereview.md:1224:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-rereview.md:1232:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-rereview.md:1240:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-rereview.md:1303:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-rereview.md:1669:/bin/zsh -lc "grep -n -E 'rebuild_catalog_aggregates|Output\\(|catalog_path|sqlite|D1|d1' scripts/transform_immi_snapshot.py && grep -n -E 'CREATE TABLE.*catalog_summary|catalog_summary' migrations/d1/catalog/0001_catalog.sql && grep -n -E 'AGGREGATE_BOOKKEEPING_KEYS|async rebuildAggregates|async markAggregatesDirty|async aggregatesNeedRebuild|async claimRebuildLease|async releaseRebuildLease' workers/storage/cloudflare.js && grep -n -E 'async function rebuildUnderLease|async function handleScheduledRebuild|async function markStaleAndMaybeRebuild' workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
./work/codex-rereview.md:1687:53:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-rereview.md:1689:1009:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-rereview.md:1690:1109:  async markAggregatesDirty() {
./work/codex-rereview.md:1691:1132:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-rereview.md:1694:148:async function rebuildUnderLease(stores, minIntervalSeconds) {
./work/codex-rereview.md:1759:No finding — generation snapshot：唯一正式呼叫點是 `workers/cloudflare-native.js:156`，scheduled 與 queue fallback 都經由同一個 `rebuildUnderLease()`；`rebuildAggregates()` 在任何 aggregate DELETE/INSERT 前讀取 generation（`workers/storage/cloudflare.js:1003`）。
./work/codex-rereview.md:1784:No finding — generation snapshot：唯一正式呼叫點是 `workers/cloudflare-native.js:156`，scheduled 與 queue fallback 都經由同一個 `rebuildUnderLease()`；`rebuildAggregates()` 在任何 aggregate DELETE/INSERT 前讀取 generation（`workers/storage/cloudflare.js:1003`）。
./work/codex-review6-prompt.md:11:1. HIGH: rebuild disarmed rebuild_dirty_since unconditionally, so a mid-scan mutation reset the staleness clock and the bound became unreachable under continuous writes.
./work/codex-review6-prompt.md:15:5. LOW: docs claimed one control row and stale cost numbers.
./work/codex-review6-prompt.md:16:6. LOW: the test's BOOKKEEPING_KEYS constant missed the two new keys.
./work/codex-review6-prompt.md:22:- Whether the harness truly simulates a mid-scan mutation (it executes the control-row writes then the bookkeeping statements with the runtime-observed generation).
./work/codex-rereview-prompt.md:15:   Fix: bookkeeping is now a monotonic generation. `markAggregatesDirty()` increments `rebuild_generation` (`ON CONFLICT ... SET value_int = catalog_summary.value_int + 1`); `rebuildAggregates()` snapshots `rebuild_generation` BEFORE scanning and writes `rebuild_applied_generation` = that snapshot at the end; "dirty" is `rebuild_generation > rebuild_applied_generation`. The rebuild's `DELETE FROM catalog_summary` now excludes the four bookkeeping keys.
./work/codex-rereview-prompt.md:16:2. HIGH — no atomic claim between `aggregatesNeedRebuild()` and `rebuildAggregates()`, so two overlapping invocations could both rebuild and interleave 17-table DELETEs.
./work/codex-rereview-prompt.md:17:   Fix: `claimRebuildLease()` is a conditional upsert (`... DO UPDATE SET value_int = excluded.value_int ... WHERE catalog_summary.value_int < ?`) whose `changes` value decides ownership; `rebuildUnderLease()` in the worker releases the lease in a `finally`, with a lease length of `max(600, interval * 2)`.
./work/codex-review5-prompt.md:10:- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
./work/codex-review5-prompt.md:11:- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
./work/codex-review5-prompt.md:12:- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
./work/codex-review5-prompt.md:17:1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
./work/codex-review5-prompt.md:19:3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
./work/codex-review-prompt.md:15:- The fix: queue batches only record staleness (`markAggregatesDirty()` writes one row into `catalog_summary`), and a new `scheduled()` handler does at most one rebuild per `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300), driven by a `[triggers]` cron `*/5 * * * *` added to `wrangler.toml` and `config/wrangler-cloudflare-native.toml.example`.
./work/codex-review-prompt.md:34:3. Concurrency: two scheduled invocations overlapping, clock skew between Workers and D1, or a rebuild running while `markAggregatesDirty()` writes — can the dirty flag be cleared without the data actually being refreshed?
./work/codex-review4-prompt.md:15:5. failed rebuilds were not throttled → `claimRebuildLease()` stamps `rebuild_last_attempt_at`; `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review3-prompt.md:17:- `workers/cloudflare-native.js` `rebuildUnderLease()` passes the lease into `rebuildAggregates` and releases with `{ token }` in `finally`.
./work/codex-review3-prompt.md:21:Fix now: `claimRebuildLease()` stamps `rebuild_last_attempt_at`, and `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/capture-statements.mjs:40:await stores.caseStore.markAggregatesDirty();
./work/capture-statements.mjs:41:await stores.caseStore.markAggregatesDirty();
./work/capture-statements.mjs:43:await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review3.md:30:- `workers/cloudflare-native.js` `rebuildUnderLease()` passes the lease into `rebuildAggregates` and releases with `{ token }` in `finally`.
./work/codex-review3.md:34:Fix now: `claimRebuildLease()` stamps `rebuild_last_attempt_at`, and `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review3.md:106:workers/storage/cloudflare.js:1143:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review3.md:126:workers/cloudflare-native.js:184:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:127:workers/cloudflare-native.js:217:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:566:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review3.md:676:  async markAggregatesDirty() {
./work/codex-review3.md:699:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review3.md:816:async function rebuildUnderLease(stores, env) {
./work/codex-review3.md:851:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:857:  const result = await rebuildUnderLease(stores, env);
./work/codex-review3.md:879:  await stores.caseStore.markAggregatesDirty();
./work/codex-review3.md:884:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:886:  const result = await rebuildUnderLease(stores, env);
./work/codex-review3.md:1036:+async function rebuildUnderLease(stores, env) {
./work/codex-review3.md:1071:+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:1077:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review3.md:1099:+  await stores.caseStore.markAggregatesDirty();
./work/codex-review3.md:1104:+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review3.md:1106:+  const result = await rebuildUnderLease(stores, env);
./work/codex-review3.md:1281:+const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review3.md:1397:+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review3.md:1510:+  async markAggregatesDirty() {
./work/codex-review3.md:1533:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review3.md:1665:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review3.md:1718:  async markAggregatesDirty() {
./work/codex-review3.md:1746:- Area 3 — **No finding**：在成功 claim 並完成 attempt stamp 的正常路徑中，`aggregatesNeedRebuild()` 正確以 `max(rebuild_last_at, rebuild_last_attempt_at)` 節流（`workers/storage/cloudflare.js:1143-1169`）；queue 的 30 秒 retry 與 cron 都會經過此判斷（`workers/cloudflare-native.js:184-221`）。
./work/codex-review3.md:1761:- Area 3 — **No finding**：在成功 claim 並完成 attempt stamp 的正常路徑中，`aggregatesNeedRebuild()` 正確以 `max(rebuild_last_at, rebuild_last_attempt_at)` 節流（`workers/storage/cloudflare.js:1143-1169`）；queue 的 30 秒 retry 與 cron 都會經過此判斷（`workers/cloudflare-native.js:184-221`）。
./workers/cloudflare-native.js:164:async function rebuildUnderLease(stores, env) {
./workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./workers/cloudflare-native.js:207:    result = await rebuildUnderLease(stores, env);
./workers/cloudflare-native.js:244:  await stores.caseStore.markAggregatesDirty();
./workers/cloudflare-native.js:249:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./workers/cloudflare-native.js:253:    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:24:1. HIGH: rebuild disarmed rebuild_dirty_since unconditionally, so a mid-scan mutation reset the staleness clock and the bound became unreachable under continuous writes.
./work/codex-review6.md:28:5. LOW: docs claimed one control row and stale cost numbers.
./work/codex-review6.md:29:6. LOW: the test's BOOKKEEPING_KEYS constant missed the two new keys.
./work/codex-review6.md:35:- Whether the harness truly simulates a mid-scan mutation (it executes the control-row writes then the bookkeeping statements with the runtime-observed generation).
./work/codex-review6.md:94:    - HIGH: the rebuild disarmed rebuild_dirty_since unconditionally. A mutation
./work/codex-review6.md:99:    - MED: markAggregatesDirty() writes generation, mutation timestamp and staleness
./work/codex-review6.md:106:    - LOW: docs/tests corrected - three control rows per batch, real per-import cost,
./work/codex-review6.md:107:      BOOKKEEPING_KEYS covers every key.
./work/codex-review6.md:126:+- HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
./work/codex-review6.md:130:+- MED: `markAggregatesDirty()` writes its three control rows in one atomic
./work/codex-review6.md:136:+- LOW: docs state the real control-row counts and per-import cost.
./work/codex-review6.md:145:   and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
./work/codex-review6.md:166: - The queue path now records staleness (`markAggregatesDirty()`, one row); the
./work/codex-review6.md:252:-| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:253:+| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:254: | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review6.md:268: | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review6.md:272: | `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review6.md:273:+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
./work/codex-review6.md:274: | `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review6.md:308: `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review6.md:316:+| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
./work/codex-review6.md:317:+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
./work/codex-review6.md:413:-const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-review6.md:414:+const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
./work/codex-review6.md:415:+  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
./work/codex-review6.md:464:   if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:475:     await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:479:+    // Three control rows committed as one transaction: the generation counter,
./work/codex-review6.md:495:     await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:498:     const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:510:     await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:513:+    // The only batch is the three control rows - no aggregate DELETE/INSERT.
./work/codex-review6.md:523:+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:533:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:543:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:551:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:563:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:571:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:579:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:592:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:600:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:612:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:620:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:631:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:740:+    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
./work/codex-review6.md:748:     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:752:     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:782:     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:798:-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:807:-    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:808:+    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
./work/codex-review6.md:868: async function rebuildUnderLease(stores, env) {
./work/codex-review6.md:903:   const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:909:-  const result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:912:+    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:949:   await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:954:   const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:956:-  const result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:959:+    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:1137:-        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review6.md:1142:+         WHERE summary_key = 'rebuild_dirty_since'
./work/codex-review6.md:1168:   async markAggregatesDirty() {
./work/codex-review6.md:1184:-        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:1206:+          VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:1220:                               'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:1231:   async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:1254:     const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:1358:/bin/zsh -lc "rg -n -C 5 \"rebuild_dirty_since|markAggregatesDirty|aggregatesNeedRebuild|aggregate_rebuild_failed|rebuild_applied_generation|BOOKKEEPING_KEYS|mid-scan|mid.*scan|runtime-observed|runtimeObserved|control-row|control row|debounced|awaiting-quiet\" workers/storage/cloudflare.js workers/cloudflare-native.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js docs/ops/aggregate-rebuild-cost-guard.md work/codex-review5.md work/verify-rebuild-sql.py && nl -ba workers/storage/cloudflare.js | sed -n '1020,1250p' && nl -ba workers/cloudflare-native.js | sed -n '1,260p' && nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '1,420p' && nl -ba work/verify-rebuild-sql.py | sed -n '1,500p'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
./work/codex-review6.md:1365:workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:1389:workers/cloudflare-native.js:244:  await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:1394:workers/cloudflare-native.js:249:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:1398:workers/cloudflare-native.js-253-    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:1413:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
./work/codex-review6.md:1414:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:12:  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
./work/codex-review6.md:1432:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:61:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:1443:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:72:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:1445:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74:    // Three control rows committed as one transaction: the generation counter,
./work/codex-review6.md:1457:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:1460:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:1472:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:105:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:1474:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:107:    // The only batch is the three control rows - no aggregate DELETE/INSERT.
./work/codex-review6.md:1484:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:117:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:1494:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:127:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1504:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:137:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1512:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:145:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:1524:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:157:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1532:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:165:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1540:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:173:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:1553:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:186:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:1561:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:194:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:1573:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:206:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:1581:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:214:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:1592:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:225:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1604:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:333:    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
./work/codex-review6.md:1612:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:341:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1616:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:345:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:1628:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:374:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:1652:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:398:    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
./work/codex-review6.md:1664:workers/storage/cloudflare.js:53:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review6.md:1667:workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review6.md:1691:workers/storage/cloudflare.js:1021:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review6.md:1710:workers/storage/cloudflare.js:1112:         WHERE summary_key = 'rebuild_dirty_since'
./work/codex-review6.md:1722:workers/storage/cloudflare.js:1138:  async markAggregatesDirty() {
./work/codex-review6.md:1734:workers/storage/cloudflare.js:1158:          VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:1748:workers/storage/cloudflare.js:1172:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:1759:workers/storage/cloudflare.js:1183:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:1778:workers/storage/cloudflare.js:1202:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:1832:work/verify-rebuild-sql.py:89:    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
./work/codex-review6.md:1855:work/verify-rebuild-sql.py:112:      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))
./work/codex-review6.md:1876:work/verify-rebuild-sql.py:133:    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
./work/codex-review6.md:1888:work/verify-rebuild-sql.py:145:      state.get("rebuild_dirty_since", 0) > 0, state.get("rebuild_dirty_since"))
./work/codex-review6.md:1905:work/verify-rebuild-sql.py:209:dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
./work/codex-review6.md:1909:work/verify-rebuild-sql.py:213:first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review6.md:1911:work/verify-rebuild-sql.py:215:second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review6.md:1923:work/verify-rebuild-sql.py:228:reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review6.md:1935:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:1936:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review6.md:1948:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review6.md:1952:docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review6.md:1953:docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
./work/codex-review6.md:1954:docs/ops/aggregate-rebuild-cost-guard.md:51:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review6.md:1969:docs/ops/aggregate-rebuild-cost-guard.md:85:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review6.md:1975:docs/ops/aggregate-rebuild-cost-guard.md:91:| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
./work/codex-review6.md:1976:docs/ops/aggregate-rebuild-cost-guard.md:92:| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
./work/codex-review6.md:1998:docs/ops/aggregate-rebuild-cost-guard.md:189:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review6.md:2011:work/codex-review5.md:23:- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
./work/codex-review6.md:2012:work/codex-review5.md:24:- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
./work/codex-review6.md:2013:work/codex-review5.md:25:- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
./work/codex-review6.md:2018:work/codex-review5.md:30:1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
./work/codex-review6.md:2020:work/codex-review5.md:32:3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
./work/codex-review6.md:2032:work/codex-review5.md:96: | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:2033:work/codex-review5.md:97: | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review6.md:2045:work/codex-review5.md:111: | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review6.md:2049:work/codex-review5.md:115:+| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review6.md:2050:work/codex-review5.md:116:+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review6.md:2065:work/codex-review5.md:150: `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review6.md:2087:work/codex-review5.md:253:+- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review6.md:2100:work/codex-review5.md:302: const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
./work/codex-review6.md:2118:work/codex-review5.md:352:+  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:2129:work/codex-review5.md:363:     await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2141:work/codex-review5.md:380:+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:2144:work/codex-review5.md:383:+    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:2156:work/codex-review5.md:395:     await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2166:work/codex-review5.md:405:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2176:work/codex-review5.md:415:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2184:work/codex-review5.md:423:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:2196:work/codex-review5.md:435:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2204:work/codex-review5.md:443:     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2212:work/codex-review5.md:451:     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:2222:work/codex-review5.md:461:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:2234:work/codex-review5.md:473:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:2242:work/codex-review5.md:481:+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:2253:work/codex-review5.md:492:+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2265:work/codex-review5.md:605:     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2269:work/codex-review5.md:609:     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2281:work/codex-review5.md:639:     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:2297:work/codex-review5.md:655:+      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:2303:work/codex-review5.md:661:+    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:2502:work/codex-review5.md:1144:-  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review6.md:2503:work/codex-review5.md:1145:+  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2515:work/codex-review5.md:1173:   await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2520:work/codex-review5.md:1178:-  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
./work/codex-review6.md:2521:work/codex-review5.md:1179:+  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2523:work/codex-review5.md-1181-   const result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:2533:work/codex-review5.md:1317: const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review6.md:2536:work/codex-review5.md:1320:+  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review6.md:2552:work/codex-review5.md:1483:+        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review6.md:2564:work/codex-review5.md:1507:   async markAggregatesDirty() {
./work/codex-review6.md:2576:work/codex-review5.md:1524:+        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:2590:work/codex-review5.md:1538:+                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:2601:work/codex-review5.md:1549:-  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
./work/codex-review6.md:2602:work/codex-review5.md:1550:+  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:2628:work/codex-review5.md:1577:+    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:2652:work/codex-review5.md:1819:/bin/zsh -c 'grep -n -E "rebuildDecisionParams|markAggregatesDirty|aggregatesNeedRebuild|rebuild_dirty_since|rebuild_last_mutation_at|AGGREGATE_REBUILD_(QUIET|MAX_STALENESS)" workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-native-scheduled-rebuild.test.js config/wrangler-cloudflare-native.toml.example wrangler.toml docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
./work/codex-review6.md:2657:work/codex-review5.md:1824:workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2658:work/codex-review5.md:1825:workers/cloudflare-native.js:227:  await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2659:work/codex-review5.md:1826:workers/cloudflare-native.js:232:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2660:work/codex-review5.md:1827:workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review6.md:2663:work/codex-review5.md:1830:workers/storage/cloudflare.js:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review6.md:2664:work/codex-review5.md:1831:workers/storage/cloudflare.js:1133:  async markAggregatesDirty() {
./work/codex-review6.md:2666:work/codex-review5.md:1833:workers/storage/cloudflare.js:1149:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:2667:work/codex-review5.md:1834:workers/storage/cloudflare.js:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:2668:work/codex-review5.md:1835:workers/storage/cloudflare.js:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:2669:work/codex-review5.md:1836:workers/storage/cloudflare.js:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:2672:work/codex-review5.md:1839:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:2673:work/codex-review5.md:1840:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:71:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2674:work/codex-review5.md:1841:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:87:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:2676:work/codex-review5.md:1843:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:2677:work/codex-review5.md:1844:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:102:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2678:work/codex-review5.md:1845:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:112:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2679:work/codex-review5.md:1846:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:122:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2680:work/codex-review5.md:1847:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:130:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:2681:work/codex-review5.md:1848:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:142:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2682:work/codex-review5.md:1849:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:150:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2683:work/codex-review5.md:1850:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:158:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:2684:work/codex-review5.md:1851:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:168:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:2685:work/codex-review5.md:1852:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:180:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:2686:work/codex-review5.md:1853:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:188:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:2687:work/codex-review5.md:1854:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:199:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2688:work/codex-review5.md:1855:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:312:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2689:work/codex-review5.md:1856:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:316:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2690:work/codex-review5.md:1857:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:2691:work/codex-review5.md:1858:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:2718:work/codex-review5.md:1885:docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:2719:work/codex-review5.md:1886:docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
./work/codex-review6.md:2720:work/codex-review5.md:1887:docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
./work/codex-review6.md:2721:work/codex-review5.md:1888:docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
./work/codex-review6.md:2722:work/codex-review5.md:1889:docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
./work/codex-review6.md:2723:work/codex-review5.md:1890:docs/ops/aggregate-rebuild-cost-guard.md:84:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
./work/codex-review6.md:2729:work/codex-review5.md:1896:docs/ops/aggregate-rebuild-cost-guard.md:188:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
./work/codex-review6.md:2741:work/codex-review5.md:2106:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2753:work/codex-review5.md:2134:  await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2758:work/codex-review5.md:2139:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:2760:work/codex-review5.md-2141-  const result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:2770:work/codex-review5.md:2186:const AGGREGATE_BOOKKEEPING_KEYS = [
./work/codex-review6.md:2773:work/codex-review5.md:2189:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review6.md:2797:work/codex-review5.md:2225:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review6.md:2813:work/codex-review5.md:2313:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review6.md:2825:work/codex-review5.md:2337:  async markAggregatesDirty() {
./work/codex-review6.md:2837:work/codex-review5.md:2353:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:2850:work/codex-review5.md:2366:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:2861:work/codex-review5.md:2377:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:2884:work/codex-review5.md:2400:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:2908:work/codex-review5.md:2435:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:2919:work/codex-review5.md:2446:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2931:work/codex-review5.md:2462:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:2934:work/codex-review5.md:2465:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:2946:work/codex-review5.md:2477:    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:2956:work/codex-review5.md:2487:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2966:work/codex-review5.md:2497:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2974:work/codex-review5.md:2505:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:2986:work/codex-review5.md:2517:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:2994:work/codex-review5.md:2525:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:3002:work/codex-review5.md:2533:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:3012:work/codex-review5.md:2543:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:3024:work/codex-review5.md:2555:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:3032:work/codex-review5.md:2563:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:3043:work/codex-review5.md:2574:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:3055:work/codex-review5.md:2610:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:3071:work/codex-review5.md:2626:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:3077:work/codex-review5.md:2632:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:3089:work/codex-review5.md:2665:  await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:3094:work/codex-review5.md:2670:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:3096:work/codex-review5.md-2672-  const result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:3106:work/codex-review5.md:2889:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:3110:work/codex-review5.md:2893:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:3122:work/codex-review5.md:2921:    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:3138:work/codex-review5.md:2937:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:3144:work/codex-review5.md:2943:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:3359:work/codex-review5.md:3356:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:3360:work/codex-review5.md:3357:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:3367:work/codex-review5.md:3364:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:3368:work/codex-review5.md:3365:workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
./work/codex-review6.md:3375:work/codex-review5.md:3372:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
./work/codex-review6.md:3385:work/codex-review5.md:3382:**Assessing robustness of rebuild_dirty_since handling**
./work/codex-review6.md:3399:work/codex-review5.md:3396:grep -n -E 'if \\(elapsedSeconds < interval\\)|maxStaleness|INSERT OR REPLACE INTO catalog_summary|rebuild_dirty_since|DELETE FROM catalog_summary WHERE' workers/storage/cloudflare.js
./work/codex-review6.md:3407:work/codex-review5.md:3404:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./work/codex-review6.md:3412:work/codex-review5.md:3409:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
./work/codex-review6.md:3413:work/codex-review5.md:3410:1149:        VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:3414:work/codex-review5.md:3411:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:3415:work/codex-review5.md:3412:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:3419:work/codex-review5.md:3416:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:3431:work/codex-review5.md:3440:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
./work/codex-review6.md:3441:work/codex-review5.md:3450:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
./work/codex-review6.md:3448:work/codex-review5.md:3457:- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。
./work/codex-review6.md:3458:work/codex-review5.md:3467:- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。
./work/codex-review6.md:3464:  1021	    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./work/codex-review6.md:3555:  1112	         WHERE summary_key = 'rebuild_dirty_since'
./work/codex-review6.md:3581:  1138	  async markAggregatesDirty() {
./work/codex-review6.md:3601:  1158	          VALUES ('rebuild_dirty_since', ?, ?)
./work/codex-review6.md:3615:  1172	                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./work/codex-review6.md:3626:  1183	  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./work/codex-review6.md:3645:  1202	    const dirtySince = state.get("rebuild_dirty_since") || 0;
./work/codex-review6.md:3857:   164	async function rebuildUnderLease(stores, env) {
./work/codex-review6.md:3892:   199	  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:3900:   207	    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:3937:   244	  await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:3942:   249	  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
./work/codex-review6.md:3946:   253	    result = await rebuildUnderLease(stores, env);
./work/codex-review6.md:3964:    11	const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
./work/codex-review6.md:3965:    12	  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
./work/codex-review6.md:4014:    61	  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
./work/codex-review6.md:4025:    72	    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:4027:    74	    // Three control rows committed as one transaction: the generation counter,
./work/codex-review6.md:4043:    90	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:4046:    93	    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
./work/codex-review6.md:4058:   105	    await stores.caseStore.markAggregatesDirty();
./work/codex-review6.md:4060:   107	    // The only batch is the three control rows - no aggregate DELETE/INSERT.
./work/codex-review6.md:4070:   117	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
./work/codex-review6.md:4080:   127	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4090:   137	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4098:   145	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
./work/codex-review6.md:4110:   157	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4118:   165	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4126:   173	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
./work/codex-review6.md:4139:   186	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:4147:   194	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:4159:   206	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
./work/codex-review6.md:4167:   214	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
./work/codex-review6.md:4178:   225	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4286:   333	    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
./work/codex-review6.md:4294:   341	    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4298:   345	    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
./work/codex-review6.md:4327:   374	    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
./work/codex-review6.md:4351:   398	    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
./work/codex-review6.md:4455:    89	    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
./work/codex-review6.md:4478:   112	      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))
./work/codex-review6.md:4499:   133	    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
./work/codex-review6.md:4511:   145	      state.get("rebuild_dirty_since", 0) > 0, state.get("rebuild_dirty_since"))
./work/codex-review6.md:4575:   209	dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
./work/codex-review6.md:4579:   213	first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review6.md:4581:   215	second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./work/codex-review6.md:4594:   228	reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
./workers/storage/cloudflare.js:53:const AGGREGATE_BOOKKEEPING_KEYS = [
./workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
./workers/storage/cloudflare.js:1021:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
./workers/storage/cloudflare.js:1112:         WHERE summary_key = 'rebuild_dirty_since'
./workers/storage/cloudflare.js:1138:  async markAggregatesDirty() {
./workers/storage/cloudflare.js:1158:          VALUES ('rebuild_dirty_since', ?, ?)
./workers/storage/cloudflare.js:1172:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
./workers/storage/cloudflare.js:1183:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
./workers/storage/cloudflare.js:1202:    const dirtySince = state.get("rebuild_dirty_since") || 0;
./immi android app/app/src/main/java/au/gov/immi/cases/ui/components/Pagination.kt:62: * Pagination control row with previous/next buttons and page number chips.
   990	    const current = rows(await this.db.prepare(`
   991	      SELECT c.case_id, c.tags
   992	      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
   993	    `).bind(JSON.stringify(ids)).all());
   994	    const updates = current.map((row) => {
   995	      const values = new Set(String(row.tags || "").split(",").map((value) => value.trim()).filter(Boolean));
   996	      values.add(tag.trim());
   997	      return this.db.prepare("UPDATE cases SET tags = ?, semantic_ready = 0, vector_mutation_id = NULL, updated_at = ? WHERE case_id = ?")
   998	        .bind([...values].sort().join(", "), utcNow(), row.case_id);
   999	    });
  1000	    if (updates.length) await this.db.batch(updates);
  1001	    return updates.length;
  1002	  }
  1003	
  1004	  /**
  1005	   * Rebuild queue-maintained analytics outside the request path.
  1006	   *
  1007	   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
  1008	   * the whole `cases` table, so it must never run once per queue batch. Queue
  1009	   * work only marks the aggregates dirty (markAggregatesDirty) and the
  1010	   * scheduled handler coalesces those marks into at most one rebuild per
  1011	   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
  1012	   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
  1013	   * $12,060 in D1 write charges.
  1014	   */
  1015	  async rebuildAggregates({ lease } = {}) {
  1016	    const now = utcNow();
  1017	    // Snapshot the pending generation before scanning: anything that arrives
  1018	    // while this rebuild runs must stay pending, not be marked applied.
  1019	    const state = await this.readAggregateState();
  1020	    const appliedGeneration = state.get("rebuild_generation") || 0;
  1021	    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
  1022	    const statements = [];
  1023	    for (const table of [
  1024	      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
  1025	      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
  1026	      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
  1027	      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
  1028	      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
  1029	    ]) {
  1030	      statements.push(table === "catalog_summary"
  1031	        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
  1032	        : this.db.prepare(`DELETE FROM ${table}`));
  1033	    }
  1034	    statements.push(
  1035	      this.db.prepare(`INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
  1036	        SELECT court_code, year, outcome, COUNT(*), ? FROM cases GROUP BY court_code, year, outcome`).bind(now),
  1037	      this.db.prepare(`INSERT INTO aggregate_source (source,case_count,updated_at)
  1038	        SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source`).bind(now),
  1039	      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
  1040	        SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
  1041	      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
  1042	        SELECT 'with_full_text', COUNT(*), ? FROM cases WHERE content_key <> ''`).bind(now),
  1043	      this.db.prepare(`INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
  1044	        SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
  1045	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
  1046	        WHERE c.court_code <> '' GROUP BY cj.judge_id, c.court_code`),
  1047	      this.db.prepare(`INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
  1048	        SELECT case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> '' GROUP BY case_nature, outcome`),
  1049	      this.db.prepare(`INSERT INTO aggregate_concept (concept_id,label,case_count)
  1050	        SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
  1051	        FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id GROUP BY cc.concept_id, c.label`),
  1052	      this.db.prepare(`INSERT INTO aggregate_country (country,case_count,updated_at)
  1053	        SELECT country_of_origin, COUNT(*), ? FROM cases WHERE country_of_origin <> '' GROUP BY country_of_origin`).bind(now),
  1054	      this.db.prepare(`INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
  1055	        SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
  1056	        FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id GROUP BY j.judge_id, j.canonical_name`).bind(now),
  1057	      this.db.prepare(`INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
  1058	        SELECT visa_subclass, court_code, outcome, COUNT(*), ? FROM cases
  1059	        WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome`).bind(now),
  1060	      this.db.prepare(`INSERT INTO aggregate_scope
  1061	        (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
  1062	        SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
  1063	               COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
  1064	               CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
  1065	        FROM cases GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
  1066	          COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
  1067	          CASE WHEN content_key <> '' THEN 1 ELSE 0 END`),
  1068	      this.db.prepare(`INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
  1069	        SELECT court_code, case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> ''
  1070	        GROUP BY court_code, case_nature, outcome`),
  1071	      this.db.prepare(`INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
  1072	        SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
  1073	        FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
  1074	        GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome`),
  1075	      this.db.prepare(`INSERT INTO aggregate_concept_pair
  1076	        (concept_id_a,concept_id_b,court_code,outcome,case_count)
  1077	        SELECT a.concept_id, b.concept_id, c.court_code, c.outcome, COUNT(DISTINCT a.case_id)
  1078	        FROM case_concepts a JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
  1079	        JOIN cases c ON c.case_id = a.case_id
  1080	        GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome`),
  1081	      this.db.prepare(`INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
  1082	        SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
  1083	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
  1084	        GROUP BY cj.judge_id, c.court_code, c.outcome`),
  1085	      this.db.prepare(`INSERT INTO aggregate_judge_year (judge_id,year,case_count)
  1086	        SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
  1087	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.year IS NOT NULL
  1088	        GROUP BY cj.judge_id, c.year`),
  1089	      this.db.prepare(`INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
  1090	        SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
  1091	        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
  1092	        GROUP BY cj.judge_id, c.visa_subclass`),
  1093	    );
  1094	    for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
  1095	      statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
  1096	        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
  1097	        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
  1098	    }
  1099	    // Bookkeeping lives in catalog_summary itself (getStats reads only
  1100	    // total_cases/with_full_text, so these keys stay internal). Recording the
  1101	    // generation observed at the start — not a bare dirty=0 — is what keeps a
  1102	    // mid-rebuild mutation pending.
  1103	    statements.push(
  1104	      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
  1105	        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
  1106	      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
  1107	        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
  1108	      // Only disarm the staleness clock when nothing arrived while this rebuild
  1109	      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
  1110	      // the staleness bound stays reachable under continuous writes.
  1111	      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
  1112	         WHERE summary_key = 'rebuild_dirty_since'
  1113	           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
  1114	        .bind(now, appliedGeneration),
  1115	    );
  1116	    for (let offset = 0; offset < statements.length; offset += 20) {
  1117	      // While we still own the lease, extend it before each chunk; if another
  1118	      // invocation took over (this run outlived its lease), abort instead of
  1119	      // interleaving DELETEs with it. At most one chunk can overlap.
  1120	      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
  1121	        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
  1122	          code: "rebuild_lease_lost", status: 503,
  1123	        });
  1124	      }
  1125	      await this.db.batch(statements.slice(offset, offset + 20));
  1126	    }
  1127	    return { rebuilt_at: now, applied_generation: appliedGeneration };
  1128	  }
  1129	
  1130	  /**
  1131	   * Mark analytics as stale without paying for a rebuild: one row written per
  1132	   * queue batch instead of clearing and rewriting 17 tables.
  1133	   *
  1134	   * A monotonic generation, not a boolean: a rebuild applies the generation it
  1135	   * observed when it started, so a mutation landing mid-rebuild stays pending
  1136	   * instead of being wiped by the rebuild's own bookkeeping write.
  1137	   */
  1138	  async markAggregatesDirty() {
  1139	    const now = Math.floor(Date.now() / 1000);
  1140	    const stamp = utcNow();
  1141	    // One batch = one transaction, so two isolates cannot interleave these rows.
  1142	    await this.db.batch([
  1143	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1144	          VALUES ('rebuild_generation', 1, ?)
  1145	        ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
  1146	        .bind(stamp),
  1147	      // When the last mutation happened: the scheduled rebuild waits for a quiet
  1148	      // window so a long bulk import costs one rebuild, not one per interval.
  1149	      // MAX() keeps it monotonic when isolates with skewed clocks interleave.
  1150	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1151	          VALUES ('rebuild_last_mutation_at', ?, ?)
  1152	        ON CONFLICT(summary_key) DO UPDATE SET
  1153	          value_int = MAX(catalog_summary.value_int, excluded.value_int), updated_at = excluded.updated_at`)
  1154	        .bind(now, stamp),
  1155	      // When the pending work first appeared: bounds how stale analytics may get
  1156	      // while mutations keep arriving without a quiet gap.
  1157	      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
  1158	          VALUES ('rebuild_dirty_since', ?, ?)
  1159	        ON CONFLICT(summary_key) DO UPDATE SET
  1160	          value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
  1161	          updated_at = excluded.updated_at`)
  1162	        .bind(now, stamp),
  1163	    ]);
  1164	    return true;
  1165	  }
  1166	
  1167	  async readAggregateState() {
  1168	    const current = rows(await this.db.prepare(
  1169	      `SELECT summary_key, value_int FROM catalog_summary
  1170	        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
  1171	                              'rebuild_last_attempt_at', 'rebuild_lease_until',
  1172	                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
  1173	    ).all());
  1174	    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
  1175	  }
  1176	
  1177	  /**
  1178	   * Rate-limit decision for the scheduled handler: rebuild only when a
  1179	   * generation is pending and the last rebuild is older than the interval.
  1180	   * This is the only guard preventing a bulk import from rewriting the whole
  1181	   * summary set thousands of times.
  1182	   */
  1183	  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
  1184	    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
  1185	      ? Math.floor(minIntervalSeconds) : 300;
  1186	    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
  1187	    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
  1188	      ? Math.floor(maxStalenessSeconds) : 0;
  1189	    const state = await this.readAggregateState();
  1190	    const pending = state.get("rebuild_generation") || 0;
  1191	    const applied = state.get("rebuild_applied_generation") || 0;
  1192	    if (pending <= applied) return { due: false, reason: "clean" };
  1193	
  1194	    // Throttle on the last *attempt*, not only the last success: a rebuild that
  1195	    // throws releases its lease without stamping `rebuild_last_at`, and the
  1196	    // 30-second queue retry must not therefore rebuild on every retry.
  1197	    const lastSuccessAt = state.get("rebuild_last_at") || 0;
  1198	    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
  1199	    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
  1200	    const nowSeconds = Math.floor(Date.now() / 1000);
  1201	    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
  1202	    const dirtySince = state.get("rebuild_dirty_since") || 0;
  1203	    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
  1204	    const base = {
  1205	      pending_generation: pending,
  1206	      applied_generation: applied,
  1207	      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
  1208	    };
  1209	
  1210	    // Hard bound: however busy the queue is, analytics may not stay stale longer
  1211	    // than this, so a bulk import costs one rebuild per window instead of one
  1212	    // per interval.
  1213	    if (maxStaleness > 0 && staleness >= maxStaleness) {
  1214	      return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
  1215	    }
  1216	
  1217	    if (elapsedSeconds < interval) {
  1218	      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
  1219	    }
  1220	
   160	 * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
   161	 * The lease length is derived from the interval so it always outlives a rebuild
   162	 * while still expiring on its own if this invocation dies mid-flight.
   163	 */
   164	async function rebuildUnderLease(stores, env) {
   165	  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
   166	  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
   167	  if (!lease) {
   168	    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
   169	    return { skipped: "lease_held" };
   170	  }
   171	  try {
   172	    return await stores.caseStore.rebuildAggregates({ lease });
   173	  } finally {
   174	    try {
   175	      // Token-conditional: if this run outlived its lease, the new owner's
   176	      // lease is left untouched.
   177	      await stores.caseStore.releaseRebuildLease({ token: lease.token });
   178	    } catch (error) {
   179	      console.error(JSON.stringify({
   180	        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
   181	      }));
   182	    }
   183	  }
   184	}
   185	
   186	/**
   187	 * Coalesced analytics rebuild.
   188	 *
   189	 * Queue batches only mark the aggregates dirty; this scheduled handler decides
   190	 * when to pay for the rebuild, so N queue batches cost at most one rebuild per
   191	 * interval instead of N full rewrites of 17 tables.
   192	 */
   193	async function handleScheduledRebuild(env) {
   194	  const stores = createCloudflareStores(env);
   195	  const minIntervalSeconds = positiveIntOr(
   196	    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
   197	    DEFAULT_REBUILD_INTERVAL_SECONDS,
   198	  );
   199	  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   200	  if (!decision.due) {
   201	    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
   202	    return decision;
   203	  }
   204	  const startedAt = Date.now();
   205	  let result;
   206	  try {
   207	    result = await rebuildUnderLease(stores, env);
   208	  } catch (error) {
   209	    // A structured failure event: without it, a failed rebuild is only visible
   210	    // as the absence of a completion line, which reads exactly like a healthy
   211	    // debounce.
   212	    console.error(JSON.stringify({
   213	      event: "cloudflare.aggregate_rebuild_failed",
   214	      reason: decision.reason,
   215	      pending_generation: decision.pending_generation ?? null,
   216	      applied_generation: decision.applied_generation ?? null,
   217	      seconds_since_first_pending: decision.seconds_since_first_pending ?? null,
   218	      duration_ms: Date.now() - startedAt,
   219	      error: error?.message ?? String(error),
   220	    }));
   221	    throw error;
   222	  }
   223	  if (result?.skipped) return { ...decision, ...result };
   224	  console.log(JSON.stringify({
   225	    event: "cloudflare.aggregate_rebuild_completed",
   226	    reason: decision.reason,
   227	    min_interval_seconds: minIntervalSeconds,
   228	    duration_ms: Date.now() - startedAt,
   229	    rebuilt_at: result?.rebuilt_at ?? null,
   230	  }));
   231	  return { ...decision, ...result };
   232	}
   233	
   234	/**
   235	 * Safety valve for the coalesced rebuild.
   236	 *
   237	 * The cron trigger normally performs every rebuild, so the queue path only
   238	 * records staleness. If that trigger is missing or failing, the flag would
   239	 * never be drained and every dashboard would freeze silently — so the queue
   240	 * path still refreshes, at most once per fallback window. With a working cron
   241	 * the last rebuild is never older than the cron period, and this never fires.
   242	 */
   243	async function markStaleAndMaybeRebuild(stores, env) {
   244	  await stores.caseStore.markAggregatesDirty();
   245	  const minIntervalSeconds = positiveIntOr(
   246	    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
   247	    DEFAULT_FALLBACK_INTERVAL_SECONDS,
   248	  );
   249	  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   250	  if (!fallback?.due) return false;
   251	  let result;
   252	  try {
   253	    result = await rebuildUnderLease(stores, env);
   254	  } catch (error) {
   255	    console.error(JSON.stringify({
   256	      event: "cloudflare.aggregate_rebuild_failed",
   257	      path: "queue-fallback",
   258	      reason: fallback.reason,
   259	      pending_generation: fallback.pending_generation ?? null,
   260	      seconds_since_first_pending: fallback.seconds_since_first_pending ?? null,
   261	      error: error?.message ?? String(error),
   262	    }));
   263	    throw error;
   264	  }
   265	  if (result?.skipped) return false;
   266	  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
   267	  return true;
   268	}
   269	
   270	async function handleDeadLetterQueue(batch, env) {
   271	  const stores = createCloudflareStores(env);
   272	  for (const message of batch?.messages || []) {
   273	    try {
   274	      const body = message?.body ?? null;
   275	      const encoded = JSON.stringify(body);
   276	      const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
   277	      const pointer = await stores.objectStore.putVerified({
   278	        key: `imports/dlq/${batch.queue}/${hex}.json`,
   279	        body: encoded,
   280	        contentType: "application/json",
     1	import { describe, expect, it, vi } from "vitest";
     2	import { createCloudflareStores } from "../storage/cloudflare.js";
     3	
     4	const REBUILD_TABLES = [
     5	  "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
     6	  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
     7	  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
     8	  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
     9	  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    10	];
    11	const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
    12	  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
    13	
    14	function d1({ responder = () => [], changes = 1, changesFor } = {}) {
    15	  const prepared = [];
    16	  const binding = {
    17	    prepared,
    18	    prepare(sql) {
    19	      const statement = {
    20	        sql,
    21	        params: [],
    22	        bind(...params) { this.params = params; return this; },
    23	        all: async () => ({ results: responder(sql) }),
    24	        first: async () => responder(sql)[0] ?? null,
    25	        run: async () => ({ meta: { changes: changesFor ? changesFor(sql) : changes } }),
    26	      };
    27	      prepared.push(statement);
    28	      return statement;
    29	    },
    30	    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
    31	  };
    32	  return binding;
    33	}
    34	
    35	function env(options) {
    36	  const catalog = d1(options);
    37	  return {
    38	    catalog,
    39	    value: {
    40	      IMMI_STORAGE_MODE: "cloudflare",
    41	      IMMI_CATALOG_DB: catalog,
    42	      IMMI_ACCOUNT_DB: d1(),
    43	      IMMI_OPS_DB: d1(),
    44	      IMMI_CONTENT: { put: vi.fn(), head: vi.fn(), get: vi.fn() },
    45	      CASE_VECTORS: { queryById: vi.fn(), query: vi.fn(), upsert: vi.fn() },
    46	      AI: { run: vi.fn() },
    47	    },
    48	  };
    49	}
    50	
    51	/** Build the bookkeeping rows the decision query reads. */
    52	function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
    53	  const rows = [];
    54	  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
    55	  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
    56	  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
    57	  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
    58	  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
    59	  if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
    60	  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
    61	  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
    62	  return rows;
    63	}
    64	
    65	const nowSeconds = () => Math.floor(Date.now() / 1000);
    66	
    67	describe("Catalog aggregate rebuild guard", () => {
    68	  it("records staleness as a monotonic generation, not a boolean", async () => {
    69	    const { catalog, value } = env();
    70	    const stores = createCloudflareStores(value);
    71	
    72	    await stores.caseStore.markAggregatesDirty();
    73	
    74	    // Three control rows committed as one transaction: the generation counter,
    75	    // the mutation timestamp and the staleness clock (armed only when zero).
    76	    expect(catalog.prepared).toHaveLength(3);
    77	    expect(catalog.batch).toHaveBeenCalledTimes(1);
    78	    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
    79	    const statement = catalog.prepared[0];
    80	    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
    81	    expect(statement.sql).toMatch(/rebuild_generation/);
    82	    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
    83	    expect(statement.params).toHaveLength(1);
    84	  });
    85	
    86	  it("stamps the mutation time and arms the staleness clock", async () => {
    87	    const { catalog, value } = env();
    88	    const before = nowSeconds();
    89	
    90	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
    91	
    92	    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
    93	    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
    94	    expect(mutation).toBeDefined();
    95	    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
    96	    expect(dirtySince).toBeDefined();
    97	    // The staleness clock only arms when it is currently zero.
    98	    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
    99	  });
   100	
   101	  it("never iterates the corpus when marking dirty", async () => {
   102	    const { catalog, value } = env();
   103	    const stores = createCloudflareStores(value);
   104	
   105	    await stores.caseStore.markAggregatesDirty();
   106	
   107	    // The only batch is the three control rows - no aggregate DELETE/INSERT.
   108	    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
   109	    expect(batched).toHaveLength(3);
   110	    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
   111	    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   112	  });
   113	
   114	  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
   115	    const { catalog, value } = env();
   116	
   117	    await createCloudflareStores(value).caseStore.markAggregatesDirty();
   118	
   119	    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
   120	    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
   121	  });
   122	
   123	  it("reports clean when nothing is pending", async () => {
   124	    const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
   125	    const stores = createCloudflareStores(value);
   126	
   127	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   128	      .resolves.toEqual({ due: false, reason: "clean" });
   129	  });
   130	
   131	  it("stays dirty when a mutation arrives after the applied generation", async () => {
   132	    const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
   133	    const stores = createCloudflareStores(value);
   134	
   135	    // This is the race the boolean flag could not express: the rebuild applied
   136	    // generation 5, and generation 6 arrived while it was running.
   137	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   138	      .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
   139	  });
   140	
   141	  it("debounces a pending generation inside the interval", async () => {
   142	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
   143	    const stores = createCloudflareStores(value);
   144	
   145	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
   146	
   147	    expect(decision.due).toBe(false);
   148	    expect(decision.reason).toBe("debounced");
   149	    expect(decision.seconds_until_due).toBeGreaterThan(0);
   150	    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
   151	  });
   152	
   153	  it("rebuilds when the pending generation is older than the interval", async () => {
   154	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
   155	    const stores = createCloudflareStores(value);
   156	
   157	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   158	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   159	  });
   160	
   161	  it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
   162	    const { value } = env({ responder: () => state({ pending: 1 }) });
   163	    const stores = createCloudflareStores(value);
   164	
   165	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   166	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   167	  });
   168	
   169	  it("falls back to the default interval for invalid input", async () => {
   170	    const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
   171	    const stores = createCloudflareStores(value);
   172	
   173	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
   174	
   175	    expect(decision.due).toBe(false);
   176	    expect(decision.reason).toBe("debounced");
   177	  });
   178	
   179	  it("lets the staleness bound win over a just-stamped attempt", async () => {
   180	    // A failed rebuild stamps an attempt; the interval must not postpone work
   181	    // that has already exceeded the staleness bound.
   182	    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
   183	      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
   184	    const stores = createCloudflareStores(value);
   185	
   186	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
   187	      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
   188	  });
   189	
   190	  it("waits for a quiet window before rebuilding", async () => {
   191	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
   192	    const stores = createCloudflareStores(value);
   193	
   194	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
   195	
   196	    expect(decision.due).toBe(false);
   197	    expect(decision.reason).toBe("awaiting-quiet");
   198	    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
   199	    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
   200	  });
   201	
   202	  it("rebuilds once mutations have been quiet long enough", async () => {
   203	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
   204	    const stores = createCloudflareStores(value);
   205	
   206	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
   207	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   208	  });
   209	
   210	  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
   211	    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
   212	    const stores = createCloudflareStores(value);
   213	
   214	    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
   215	
   216	    expect(decision.due).toBe(true);
   217	    expect(decision.reason).toBe("max-staleness");
   218	    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
   219	  });
   220	
   221	  it("keeps the legacy behaviour when no quiet window is configured", async () => {
   222	    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
   223	    const stores = createCloudflareStores(value);
   224	
   225	    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
   226	      .resolves.toMatchObject({ due: true, reason: "dirty" });
   227	  });
   228	
   229	  it("claims the rebuild lease only when the previous lease has expired", async () => {
   230	    const held = env({ changes: 0 });
   231	    await expect(createCloudflareStores(held.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
   232	      .resolves.toBeNull();
   233	
   234	    const free = env({ changes: 1 });
   235	    const lease = await createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 });
   236	    expect(lease).toMatchObject({ leaseSeconds: 600 });
   237	    expect(typeof lease.token).toBe("string");
   238	    expect(lease.token.length).toBeGreaterThan(7);
   239	
   240	    // Expiry and fencing token are written by the SAME statement, so the lease
   241	    // can never be observed in a torn state by an expiring holder.
   242	    const statement = free.catalog.prepared[0];
   243	    expect(statement.sql).toMatch(/rebuild_lease_until/);
   244	    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
   245	    expect(statement.params).toHaveLength(3);
   246	    expect(statement.params[0]).toBeGreaterThan(nowSeconds());
   247	    expect(statement.params[1]).toBe(lease.token);
   248	  });
   249	
   250	  it("rotates the token when a new owner claims the lease", async () => {
   251	    const { value } = env({ changes: 1 });
   252	    const stores = createCloudflareStores(value);
   253	
   254	    const first = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
   255	    const second = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
   256	
   257	    expect(first.token).not.toBe(second.token);
   258	  });
   259	
   260	  it("stamps the attempt time when the lease is taken", async () => {
   261	    const { catalog, value } = env();
   262	
   263	    const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });
   264	
   265	    const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
   266	    expect(attempt).toBeDefined();
   267	    expect(Number(attempt.params[0])).toBeLessThanOrEqual(nowSeconds());
   268	    // Two statements only: the lease itself (expiry + token) and the attempt
   269	    // stamp. There is no third write that could leave the token out of sync.
   270	    expect(catalog.prepared).toHaveLength(2);
   271	    expect(catalog.prepared[0].params[1]).toBe(lease.token);
   272	  });
   273	
   274	  it("enforces a floor on the lease length", async () => {
   275	    const { catalog, value } = env();
   276	    const before = nowSeconds();
   277	
   278	    await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });
   279	
   280	    expect(catalog.prepared[0].params[0]).toBeGreaterThanOrEqual(before + 60);
     1	# Aggregate rebuild cost guard (2026-09-10)
     2	
     3	## Why this exists
     4	
     5	Between 2026-08-23 and 2026-09-01 the `immi-catalog` D1 database wrote
     6	**12,084,578,591 rows**, of which 12.06B were billable: **$12,060** in D1
     7	rows-written charges for a single billing cycle, 99.77% of the account total.
     8	
     9	The cause was in this Worker, not in the database or the queue configuration:
    10	
    11	- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
    12	  for **every queue batch** that changed anything.
    13	- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
    14	  (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
    15	  `cases` table — roughly **584,000 written rows** (and ~2.5M rows read) per
    16	  call, about **$0.58** at the published $1.00/million-rows rate.
    17	- With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
    18	  batches, i.e. ~7,700 full rewrites ≈ **4.5 billion written rows** per import.
    19	  Query insights confirmed the pattern: the top three `INSERT ... SELECT`
    20	  statements alone accounted for 6.68B written rows over ~24,000 executions.
    21	
    22	D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
    23	summary data is charged again on every pass, so "the data set is small" does not
    24	bound the bill — the number of rebuild passes does.
    25	
    26	## What changed
    27	
    28	| File | Change |
    29	|---|---|
    30	| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
    31	| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
    32	| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
    33	| `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
    34	| `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
    35	| `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
    36	
    37	### Bookkeeping model (why generations, not a boolean)
    38	
    39	State lives in `catalog_summary` (`summary_key` is the primary key) under four
    40	internal keys, none of which reach API responses (`getStats()` reads only
    41	`total_cases` / `with_full_text`). No D1 migration is required.
    42	
    43	| Key | Written by | Meaning |
    44	|---|---|---|
    45	| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
    46	| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
    47	| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
    48	| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
    49	| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
    50	| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
    51	| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
    52	| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
    53	
    54	"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
    55	would be wrong: a rebuild that starts at generation 5 and takes a minute can be
    56	interleaved with a mutation, and a plain `dirty = 0` write at the end would
    57	discard that mutation's pending state and leave the dashboard permanently stale.
    58	The rebuild therefore snapshots the generation *before* it scans and records that
    59	value as applied — anything that arrived meanwhile stays pending and the next
    60	tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
    61	bookkeeping keys for the same reason.
    62	
    63	Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
    64	upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
    65	expiry **and rotates the fencing token in the same statement**, so a lease is
    66	never observable in a torn state (expiry already renewed, token still the
    67	previous owner's — the flaw a second review pass caught in the first version of
    68	this fix). `changes === 1` means the caller won; the winner then stamps
    69	`rebuild_last_attempt_at`.
    70	
    71	Fencing matters because a lease can expire while its holder is still working:
    72	
    73	- `rebuildAggregates({ lease })` renews the lease (`UPDATE ... WHERE summary_key
    74	  = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
    75	  **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
    76	  its lease cannot keep interleaving its DELETEs with the new owner's.
    77	- `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
    78	  expired holder can never free (or extend) the new owner's lease. Without a
    79	  token it refuses (`false`) instead of falling back to an unconditional write.
    80	- The `finally` release is therefore safe even on the abort path.
    81	
    82	The attempt timestamp is the second half of the same problem: a rebuild that
    83	throws releases its lease but never writes `rebuild_last_at`, so throttling on
    84	success alone would let a retry storm rebuild on every 30-second queue retry.
    85	`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
    86	
    87	## Cost envelope after the change
    88	
    89	| Scenario | Before | After (300 s interval) |
    90	|---|---|---|
    91	| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
    92	| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
    93	| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
    94	| Dashboard freshness | per batch | ≤ 5 minutes stale |
    95	| Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
    96	
    97	### Quiet window (why an import costs cents, not dollars)
    98	
    99	The interval alone only bounds *how often* a rebuild may run; during a four-hour
   100	bulk import it still fires every interval, which is how a fixed version could
   101	still spend ~$28 on one import. The rebuild therefore waits for a **quiet
   102	window**: it will not run until mutations have been silent for
   103	`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
   104	**one rebuild (~$0.58)** because the pending work accumulates while the import
   105	runs and is rebuilt once afterwards. A dashboard read during an import therefore
   106	sees figures from before the import — acceptable, since nobody is reading
   107	aggregates while bulk data is still landing.
   108	
   109	The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
   110	hours): if mutations never pause, analytics are still refreshed on that cadence
   111	instead of drifting indefinitely. Lower it if continuous-write periods must stay
   112	fresher; raise it to make very long imports even cheaper.
   113	
   114	Four operator-side knobs:
   115	
   116	- `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300) — the cron's own
   117	  debounce. Raising it to 900 cuts a full import to about $10.
   118	- `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
   119	  queue path only reaches for it when the aggregates stay dirty longer than this
   120	  window, i.e. when the cron trigger is absent or failing. With a working cron
   121	  the last rebuild is always younger than the cron period, so the valve never
   122	  opens.
   123	- `AGGREGATE_REBUILD_LEASE_SECONDS` (default 900) — how long one invocation owns
   124	  the rebuild before another may take over. It is renewed per chunk while the
   125	  owner is alive, so it only matters if an invocation dies mid-rebuild: the
   126	  longer the lease, the longer a crashed run blocks the next one.
   127	- `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
   128	  above: no rebuild until mutations have been silent this long.
   129	- `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
   130	  staleness while mutations never stop.
   131	
   132	Removing the cron, lowering the interval towards the cron period, or moving the
   133	rebuild back into the queue consumer restores the old cost curve.
   134	
   135	## Deploy requirements (operator action)
   136	
   137	Step-by-step instructions, exact config block and post-deploy verification live in
   138	[operator-deploy-checklist.md](operator-deploy-checklist.md).
   139	
   140	The production deploy does **not** read this repository's `wrangler.toml`; it
   141	materialises the operator-supplied configs from
   142	`IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After merging:
   143	
   144	1. Regenerate that config secret from `config/wrangler-cloudflare-native.toml.example`
   145	   (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
     1	Reading additional input from stdin...
     2	OpenAI Codex v0.153.4
     3	--------
     4	workdir: /Volumes/Storm Breaker/Developer/IMMI-Case-
     5	model: gpt-5.6-terra
     6	provider: openai
     7	approval: never
     8	sandbox: read-only
     9	reasoning effort: high
    10	reasoning summaries: auto
    11	session id: 01a08c3c-16e7-7bd3-bf78-fec23cd77088
    12	--------
    13	user
    14	Fifth review pass — verify the quiet-window delta only. Review only, do not modify anything.
    15	
    16	HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files. Read-only commands only (cat, sed -n, git diff, git show, grep). Answer directly, no narration.
    17	
    18	Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
    19	Branch: fix/aggregate-rebuild-debounce, HEAD e30f910 (vs 30999fb). Earlier commits ed49b15 + 30999fb were already reviewed and approved in a fourth pass; review ONLY the e30f910 delta unless it invalidates something older.
    20	
    21	WHAT CHANGED (the problem it solves)
    22	The previous design rebuilt at most once per AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS (300 s). During a four-hour bulk import that still meant ~48 rebuilds ≈ $28, because every interval found pending work. The delta:
    23	- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
    24	- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
    25	- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
    26	- Worker entry: `rebuildDecisionParams()` supplies `quietSeconds` from `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) and `maxStalenessSeconds` from `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) for both the cron path and the queue fallback.
    27	- Config/docs/tests updated; four AGGREGATE_REBUILD_* vars + the cron are in wrangler.toml and the operator example.
    28	
    29	VERIFY ADVERSARIALLY (cite file:line, severity, concrete fix)
    30	1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
    31	2. Ordering of the three checks: can `max-staleness` be masked by `debounced`, or can a failing rebuild keep the pipeline permanently in `debounced`/`awaiting-quiet`? Is `waiting` distinguishable from a broken pipeline in the logs?
    32	3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
    33	4. Does the extra write per mutation (3 statements instead of 1) change the cost story the docs claim (~$0.58 per import), and are the new keys genuinely excluded from the rebuild's DELETE?
    34	5. Do the new tests fail if the quiet window, the bound, or the arming edge is removed? Name the test per invariant.
    35	
    36	ALREADY VERIFIED BY THE AUTHOR (do not re-derive): Worker Vitest 27 files / 388 tests; real-SQLite harness 24/24 (including "staleness clock arms on the first mutation only", "mutation timestamp is refreshed", "rebuild disarms the staleness clock", the generation race replay and lease fencing); bundle closure passes; the native-config gate output is unchanged.
    37	
    38	NOT IN SCOPE: style, naming, comments, the earlier commits' design decisions already approved, or the operator's deploy process.
    39	
    40	Output: findings HIGH → LOW with file:line, severity, issue, concrete fix; say "no finding" for any numbered area above that is clean. Final line exactly: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
    41	warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
    42	2026-09-10T16:52:23.948831Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
    43	2026-09-10T16:52:24.293320Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
    44	2026-09-10T16:52:25.596320Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
    45	2026-09-10T16:52:25.605091Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
    46	warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
    47	hook: SessionStart
    48	hook: SessionStart Completed
    49	**Confirming strict no-tool policy**
    50	**Defining allowed read-only commands**
    51	codex
    52	我會只讀檢視 `e30f910` 相對 `30999fb` 的差異，僅依指定五項提出可重現的風險。
    53	exec
    54	/bin/zsh -c 'git diff --unified=80 30999fb e30f910 -- workers wrangler.toml docs || git diff --unified=80 30999fb e30f910' in /Volumes/Storm Breaker/Developer/IMMI-Case-
    55	 succeeded in 2336ms:
    56	2026-09-11 02:52:37.771 xcodebuild[13557:137122330]  DVTFilePathFSEvents: Failed to start fs event stream.
    57	2026-09-11 02:52:38.051 xcodebuild[13557:137122329] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
    58	git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
    59	git: error: couldn't create cache file '/tmp/xcrun_db-xCDq1ItD' (errno=Operation not permitted)
    60	2026-09-11 02:52:38.572 xcodebuild[13582:137122605]  DVTFilePathFSEvents: Failed to start fs event stream.
    61	2026-09-11 02:52:38.707 xcodebuild[13582:137122599] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
    62	diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
    63	index c973ce1..7c3da43 100644
    64	--- a/docs/ops/aggregate-rebuild-cost-guard.md
    65	+++ b/docs/ops/aggregate-rebuild-cost-guard.md
    66	@@ -1,191 +1,218 @@
    67	 # Aggregate rebuild cost guard (2026-09-10)
    68	 
    69	 ## Why this exists
    70	 
    71	 Between 2026-08-23 and 2026-09-01 the `immi-catalog` D1 database wrote
    72	 **12,084,578,591 rows**, of which 12.06B were billable: **$12,060** in D1
    73	 rows-written charges for a single billing cycle, 99.77% of the account total.
    74	 
    75	 The cause was in this Worker, not in the database or the queue configuration:
    76	 
    77	 - `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
    78	   for **every queue batch** that changed anything.
    79	 - `rebuildAggregates()` clears and rewrites **17** summary/filter tables
    80	   (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
    81	   `cases` table — roughly **584,000 written rows** (and ~2.5M rows read) per
    82	   call, about **$0.58** at the published $1.00/million-rows rate.
    83	 - With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
    84	   batches, i.e. ~7,700 full rewrites ≈ **4.5 billion written rows** per import.
    85	   Query insights confirmed the pattern: the top three `INSERT ... SELECT`
    86	   statements alone accounted for 6.68B written rows over ~24,000 executions.
    87	 
    88	 D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
    89	 summary data is charged again on every pass, so "the data set is small" does not
    90	 bound the bill — the number of rebuild passes does.
    91	 
    92	 ## What changed
    93	 
    94	 | File | Change |
    95	 |---|---|
    96	 | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
    97	 | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
    98	 | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
    99	 | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
   100	 | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
   101	 | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
   102	 
   103	 ### Bookkeeping model (why generations, not a boolean)
   104	 
   105	 State lives in `catalog_summary` (`summary_key` is the primary key) under four
   106	 internal keys, none of which reach API responses (`getStats()` reads only
   107	 `total_cases` / `with_full_text`). No D1 migration is required.
   108	 
   109	 | Key | Written by | Meaning |
   110	 |---|---|---|
   111	 | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
   112	 | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
   113	 | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
   114	 | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
   115	+| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
   116	+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
   117	 | `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
   118	 
   119	 "Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
   120	 would be wrong: a rebuild that starts at generation 5 and takes a minute can be
   121	 interleaved with a mutation, and a plain `dirty = 0` write at the end would
   122	 discard that mutation's pending state and leave the dashboard permanently stale.
   123	 The rebuild therefore snapshots the generation *before* it scans and records that
   124	 value as applied — anything that arrived meanwhile stays pending and the next
   125	 tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
   126	 bookkeeping keys for the same reason.
   127	 
   128	 Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
   129	 upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
   130	 expiry **and rotates the fencing token in the same statement**, so a lease is
   131	 never observable in a torn state (expiry already renewed, token still the
   132	 previous owner's — the flaw a second review pass caught in the first version of
   133	 this fix). `changes === 1` means the caller won; the winner then stamps
   134	 `rebuild_last_attempt_at`.
   135	 
   136	 Fencing matters because a lease can expire while its holder is still working:
   137	 
   138	 - `rebuildAggregates({ lease })` renews the lease (`UPDATE ... WHERE summary_key
   139	   = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
   140	   **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
   141	   its lease cannot keep interleaving its DELETEs with the new owner's.
   142	 - `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
   143	   expired holder can never free (or extend) the new owner's lease. Without a
   144	   token it refuses (`false`) instead of falling back to an unconditional write.
   145	 - The `finally` release is therefore safe even on the abort path.
   146	 
   147	 The attempt timestamp is the second half of the same problem: a rebuild that
   148	 throws releases its lease but never writes `rebuild_last_at`, so throttling on
   149	 success alone would let a retry storm rebuild on every 30-second queue retry.
   150	 `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
   151	 
   152	 ## Cost envelope after the change
   153	 
   154	 | Scenario | Before | After (300 s interval) |
   155	 |---|---|---|
   156	 | One queue batch | ~584k rows (~$0.58) | 1–2 rows |
   157	-| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | ≤ 48 rebuilds ≈ 28M rows ≈ **$28** |
   158	+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window); ≤ 4 rebuilds ≈ $2.3 if it runs longer than the staleness bound |
   159	+| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
   160	 | Dashboard freshness | per batch | ≤ 5 minutes stale |
   161	 | Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
   162	 
   163	-Two knobs, both operator-side vars:
   164	+### Quiet window (why an import costs cents, not dollars)
   165	+
   166	+The interval alone only bounds *how often* a rebuild may run; during a four-hour
   167	+bulk import it still fires every interval, which is how a fixed version could
   168	+still spend ~$28 on one import. The rebuild therefore waits for a **quiet
   169	+window**: it will not run until mutations have been silent for
   170	+`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
   171	+**one rebuild (~$0.58)** because the pending work accumulates while the import
   172	+runs and is rebuilt once afterwards. A dashboard read during an import therefore
   173	+sees figures from before the import — acceptable, since nobody is reading
   174	+aggregates while bulk data is still landing.
   175	+
   176	+The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
   177	+hours): if mutations never pause, analytics are still refreshed on that cadence
   178	+instead of drifting indefinitely. Lower it if continuous-write periods must stay
   179	+fresher; raise it to make very long imports even cheaper.
   180	+
   181	+Four operator-side knobs:
   182	 
   183	 - `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300) — the cron's own
   184	   debounce. Raising it to 900 cuts a full import to about $10.
   185	 - `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
   186	   queue path only reaches for it when the aggregates stay dirty longer than this
   187	   window, i.e. when the cron trigger is absent or failing. With a working cron
   188	   the last rebuild is always younger than the cron period, so the valve never
   189	   opens.
   190	 - `AGGREGATE_REBUILD_LEASE_SECONDS` (default 900) — how long one invocation owns
   191	   the rebuild before another may take over. It is renewed per chunk while the
   192	   owner is alive, so it only matters if an invocation dies mid-rebuild: the
   193	   longer the lease, the longer a crashed run blocks the next one.
   194	+- `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
   195	+  above: no rebuild until mutations have been silent this long.
   196	+- `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
   197	+  staleness while mutations never stop.
   198	 
   199	 Removing the cron, lowering the interval towards the cron period, or moving the
   200	 rebuild back into the queue consumer restores the old cost curve.
   201	 
   202	 ## Deploy requirements (operator action)
   203	 
   204	 The production deploy does **not** read this repository's `wrangler.toml`; it
   205	 materialises the operator-supplied configs from
   206	 `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After merging:
   207	 
   208	 1. Regenerate that config secret from `config/wrangler-cloudflare-native.toml.example`
   209	    (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
   210	    stored copy) — without the cron the aggregates fall back to hourly refreshes
   211	    (≈$14/day) instead of every 5 minutes, and the incident's cost guarantee is
   212	    weakened even though dashboards keep working.
   213	 2. Confirm the deployed Worker has the cron trigger:
   214	    `npx wrangler deployments status` / dashboard → Workers → immi-case-standalone
   215	    → Triggers → Cron, next run within 5 minutes.
   216	 3. Run `make test-workers` and `node scripts/check_cloudflare_native_bundle.mjs`
   217	    before the deploy (both pass as of this change).
   218	 
   219	 ## Review record
   220	 
   221	 Four read-only Codex passes reviewed this change. The first three returned
   222	 CHANGES-REQUIRED and produced five findings, all fixed and re-verified; the
   223	 fourth confirmed all four invariants (coalescing, no lost staleness, mutual
   224	 exclusion, bounded recovery) and returned **APPROVE** with no ship blocker.
   225	 The reviewer's named acceptable residual risks:
   226	 
   227	 - On first deploy (no rebuild timestamp yet) the first queue mutation may perform
   228	   one fallback rebuild — one-off and lease-protected.
   229	 - A single D1 batch that outlives the lease makes that run abort on its next
   230	   renewal; the following rebuild converges the data.
   231	 - If the operator config ships without the cron, cost does not return to the
   232	   per-batch curve, but freshness degrades to the hourly fallback.
   233	 
   234	 Review evidence lives in `work/` and is intentionally not committed (this repo
   235	 keeps agent scratch dirs untracked).
   236	 
   237	 ## Verification checklist
   238	 
   239	 - [ ] Cron trigger present and firing every 5 minutes.
   240	 - [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
   241	       shows the rebuild statements running a handful of times per hour, not per batch.
   242	 - [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
   243	 - [ ] After the first mutation following deploy, `rebuild_applied_generation`
   244	       catches up with `rebuild_generation` within one cron period (proves the
   245	       trigger is wired, not just present).
   246	 - [ ] D1 rows written per day returns to a low baseline (monitor with the local
   247	       `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
   248	 - [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
   249	       presence means the cron trigger is not draining the dirty flag.
   250	 - [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
   251	       shows `rebuild_applied_generation` catching up with `rebuild_generation`
   252	       after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
   253	+- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
   254	+      `rebuild_applied_generation` does **not** chase it until the import goes
   255	+      quiet — that is the quiet window working, not a stalled pipeline.
   256	 - [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
   257	       is normal; constant entries mean rebuilds take longer than the lease.
   258	 - [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
   259	       normal operation; a widening gap means rebuilds are failing and being
   260	       retried (check Worker logs for `aggregate_rebuild_lease_release_error`
   261	       and for the underlying D1 error).
   262	 
   263	 ## Rollback
   264	 
   265	 **Do not restore the per-batch rebuild.** That is the incident mechanism, and
   266	 reverting to it re-creates the ~$12,060 cost curve within a single import.
   267	 
   268	 Safe rollback levers, in order of preference:
   269	 
   270	 1. **Cron missing or not firing** (symptom: the queue log shows repeated
   271	    `cloudflare.aggregate_rebuild_fallback` events, or totals advance only about
   272	    hourly): fix the trigger / regenerate the operator config. Nothing is broken
   273	    by leaving the fallback in place — it is bounded at one rebuild per
   274	    `AGGREGATE_REBUILD_FALLBACK_SECONDS`.
   275	 2. **Rebuild is too expensive or too frequent**: raise
   276	    `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (300 → 900 → 3600). Cost scales
   277	    linearly with the number of rebuilds, so this is the correct lever.
   278	 3. **Scheduled rebuild must stop entirely** (e.g. during a schema change): set
   279	    the cron aside (`[triggers] crons = []`) and raise the fallback interval. The
   280	    queue path keeps the data fresh at the fallback cadence.
   281	 4. **Full revert of this change**: only with the original bug explicitly
   282	    re-fixed first (coalescing must survive); record the decision in this file.
   283	 
   284	 Observed symptom to watch for: a dashboard whose totals stop advancing means the
   285	 dirty flag is not being drained — fix the drain path, never the queue's cost
   286	 profile.
   287	diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
   288	index 3b20472..6435ac4 100644
   289	--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
   290	+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
   291	@@ -1,317 +1,379 @@
   292	 import { describe, expect, it, vi } from "vitest";
   293	 import { createCloudflareStores } from "../storage/cloudflare.js";
   294	 
   295	 const REBUILD_TABLES = [
   296	   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   297	   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   298	   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   299	   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   300	   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",

hook: PostToolUse
hook: PostToolUse Completed
**Identifying documentation inconsistencies in state handling**
**Analyzing staleness calculation and debounce logic inconsistencies**
**Reviewing guard tests for field precedence**
exec
/bin/zsh -lc "nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '170,420p'
nl -ba workers/cloudflare-native.js | sed -n '180,285p'
nl -ba workers/storage/cloudflare.js | sed -n '990,1085p'
nl -ba workers/storage/cloudflare.js | sed -n '1100,1195p'
nl -ba docs/ops/aggregate-rebuild-cost-guard.md | sed -n '35,105p'
nl -ba .claude/STATE.md | sed -n '1,62p'
git show --format= --no-ext-diff --unified=25 8676d5c -- workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1949ms:
2026-09-11 03:03:52.719 xcodebuild[29282:137216052]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:03:52.985 xcodebuild[29282:137216051] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-f9HImrQf' (errno=Operation not permitted)
2026-09-11 03:03:53.636 xcodebuild[29309:137216268]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:03:53.792 xcodebuild[29309:137216267] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
index 6435ac4..6fff8f1 100644
--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
@@ -1,36 +1,37 @@
 import { describe, expect, it, vi } from "vitest";
 import { createCloudflareStores } from "../storage/cloudflare.js";
 
 const REBUILD_TABLES = [
   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
 ];
-const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
+const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
+  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];
 
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
@@ -48,85 +49,99 @@ function env(options) {
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
 
-    // Three rows: the generation counter, the mutation timestamp and the
-    // staleness clock (which only arms when it is currently zero).
+    // Three control rows committed as one transaction: the generation counter,
+    // the mutation timestamp and the staleness clock (armed only when zero).
     expect(catalog.prepared).toHaveLength(3);
+    expect(catalog.batch).toHaveBeenCalledTimes(1);
+    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
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
 
-    expect(catalog.batch).not.toHaveBeenCalled();
+    // The only batch is the three control rows - no aggregate DELETE/INSERT.
+    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
+    expect(batched).toHaveLength(3);
+    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
     expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   });
 
+  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
+    const { catalog, value } = env();
+
+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
+
+    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
+    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
+  });
+
   it("reports clean when nothing is pending", async () => {
     const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toEqual({ due: false, reason: "clean" });
   });
 
   it("stays dirty when a mutation arrives after the applied generation", async () => {
     const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     // This is the race the boolean flag could not express: the rebuild applied
     // generation 5, and generation 6 arrived while it was running.
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
   });
 
   it("debounces a pending generation inside the interval", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
 
     expect(decision.due).toBe(false);
@@ -139,50 +154,61 @@ describe("Catalog aggregate rebuild guard", () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
     const { value } = env({ responder: () => state({ pending: 1 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("falls back to the default interval for invalid input", async () => {
     const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
 
     expect(decision.due).toBe(false);
     expect(decision.reason).toBe("debounced");
   });
 
+  it("lets the staleness bound win over a just-stamped attempt", async () => {
+    // A failed rebuild stamps an attempt; the interval must not postpone work
+    // that has already exceeded the staleness bound.
+    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
+      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
+    const stores = createCloudflareStores(value);
+
+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
+      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
+  });
+
   it("waits for a quiet window before rebuilding", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
 
     expect(decision.due).toBe(false);
     expect(decision.reason).toBe("awaiting-quiet");
     expect(decision.seconds_until_quiet).toBeGreaterThan(0);
     expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
   });
 
   it("rebuilds once mutations have been quiet long enough", async () => {
     const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
     const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
     const stores = createCloudflareStores(value);
 
     const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
@@ -280,100 +306,108 @@ describe("Catalog aggregate rebuild guard", () => {
   it("refuses a release without a token", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.releaseRebuildLease()).resolves.toBe(false);
     await expect(stores.caseStore.releaseRebuildLease({ token: "" })).resolves.toBe(false);
     expect(catalog.prepared).toHaveLength(0);
   });
 
   it("aborts the rebuild when the lease is lost mid-run", async () => {
     // The renewal update matches no row, so this invocation no longer owns the
     // lease and must stop instead of interleaving its DELETEs with the new owner.
     const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
     const stores = createCloudflareStores(value);
 
     await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
       .rejects.toThrow(/lease lost/);
   });
 
   it("does not consult the lease when the rebuild runs without one", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
-    expect(catalog.prepared.some((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"))).toBe(false);
+    // The only UPDATE is the conditional dirty_since disarm, never a lease renewal.
+    const updates = catalog.prepared.filter((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"));
+    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
+    expect(updates.some((s) => s.sql.includes("'rebuild_lease_until'"))).toBe(false);
   });
 
   it("throttles a retry after a failed rebuild", async () => {
     // A failed rebuild releases its lease without stamping rebuild_last_at, so
     // the decision must also consider the attempt stamp.
     const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
     await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: false, reason: "debounced" });
 
     const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
     await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
       .resolves.toMatchObject({ due: true, reason: "dirty" });
   });
 
   it("clears and rewrites exactly the documented summary tables", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     const deleted = catalog.prepared
       .filter((s) => /^DELETE FROM /.test(s.sql))
       .map((s) => s.sql.replace("DELETE FROM ", "").split(" ")[0]);
     expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
     // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
-    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
+    // + 3 bookkeeping statements (applied generation, last rebuild, conditional
+    // dirty_since disarm).
     expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
   });
 
   it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
     expect(summaryDelete).toBeDefined();
     expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
     for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
   });
 
   it("records the generation observed before the scan, not a bare clean flag", async () => {
     const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
     const stores = createCloudflareStores(value);
 
     const before = nowSeconds();
     await stores.caseStore.rebuildAggregates();
     const after = nowSeconds();
 
     const applied = catalog.prepared
       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
     const stamp = catalog.prepared
       .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
     const resetDirtySince = catalog.prepared
-      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
+      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
     expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
     expect(Number(applied.params[0])).toBe(7);
     expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
     expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
+    // The disarm is conditional on no mutation arriving mid-scan, so continuous
+    // writes can never reset the staleness clock on every rebuild.
     expect(resetDirtySince).toBeDefined();
-    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
+    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
+    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
+    expect(Number(resetDirtySince.params[1])).toBe(7);
     expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
   });
 
   it("batches the rebuild statements in bounded chunks", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.rebuildAggregates();
 
     for (const call of catalog.batch.mock.calls) expect(call[0].length).toBeLessThanOrEqual(20);
     expect(catalog.batch.mock.calls.length).toBeGreaterThan(1);
   });
 });
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index 3f81a3d..8aa67fb 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -180,80 +180,110 @@ async function rebuildUnderLease(stores, env) {
         event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
       }));
     }
   }
 }
 
 /**
  * Coalesced analytics rebuild.
  *
  * Queue batches only mark the aggregates dirty; this scheduled handler decides
  * when to pay for the rebuild, so N queue batches cost at most one rebuild per
  * interval instead of N full rewrites of 17 tables.
  */
 async function handleScheduledRebuild(env) {
   const stores = createCloudflareStores(env);
   const minIntervalSeconds = positiveIntOr(
     env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
     DEFAULT_REBUILD_INTERVAL_SECONDS,
   );
   const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!decision.due) {
     console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
     return decision;
   }
   const startedAt = Date.now();
-  const result = await rebuildUnderLease(stores, env);
+  let result;
+  try {
+    result = await rebuildUnderLease(stores, env);
+  } catch (error) {
+    // A structured failure event: without it, a failed rebuild is only visible
+    // as the absence of a completion line, which reads exactly like a healthy
+    // debounce.
+    console.error(JSON.stringify({
+      event: "cloudflare.aggregate_rebuild_failed",
+      reason: decision.reason,
+      pending_generation: decision.pending_generation ?? null,
+      applied_generation: decision.applied_generation ?? null,
+      seconds_since_first_pending: decision.seconds_since_first_pending ?? null,
+      duration_ms: Date.now() - startedAt,
+      error: error?.message ?? String(error),
+    }));
+    throw error;
+  }
   if (result?.skipped) return { ...decision, ...result };
   console.log(JSON.stringify({
     event: "cloudflare.aggregate_rebuild_completed",
     reason: decision.reason,
     min_interval_seconds: minIntervalSeconds,
     duration_ms: Date.now() - startedAt,
     rebuilt_at: result?.rebuilt_at ?? null,
   }));
   return { ...decision, ...result };
 }
 
 /**
  * Safety valve for the coalesced rebuild.
  *
  * The cron trigger normally performs every rebuild, so the queue path only
  * records staleness. If that trigger is missing or failing, the flag would
  * never be drained and every dashboard would freeze silently — so the queue
  * path still refreshes, at most once per fallback window. With a working cron
  * the last rebuild is never older than the cron period, and this never fires.
  */
 async function markStaleAndMaybeRebuild(stores, env) {
   await stores.caseStore.markAggregatesDirty();
   const minIntervalSeconds = positiveIntOr(
     env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
     DEFAULT_FALLBACK_INTERVAL_SECONDS,
   );
   const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!fallback?.due) return false;
-  const result = await rebuildUnderLease(stores, env);
+  let result;
+  try {
+    result = await rebuildUnderLease(stores, env);
+  } catch (error) {
+    console.error(JSON.stringify({
+      event: "cloudflare.aggregate_rebuild_failed",
+      path: "queue-fallback",
+      reason: fallback.reason,
+      pending_generation: fallback.pending_generation ?? null,
+      seconds_since_first_pending: fallback.seconds_since_first_pending ?? null,
+      error: error?.message ?? String(error),
+    }));
+    throw error;
+  }
   if (result?.skipped) return false;
   console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
   return true;
 }
 
 async function handleDeadLetterQueue(batch, env) {
   const stores = createCloudflareStores(env);
   for (const message of batch?.messages || []) {
     try {
       const body = message?.body ?? null;
       const encoded = JSON.stringify(body);
       const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
       const pointer = await stores.objectStore.putVerified({
         key: `imports/dlq/${batch.queue}/${hex}.json`,
         body: encoded,
         contentType: "application/json",
       });
       const eventId = typeof body?.event_id === "string" && body.event_id
         ? body.event_id : `dlq:${batch.queue}:${hex}`;
       await stores.pipelineStore.recordDeadLetter({
         eventId,
         outboxEventId: typeof body?.event_id === "string" ? body.event_id : null,
         reason: `queue:${batch.queue}`,
         payloadPointer: pointer,
       });

hook: PostToolUse
hook: PostToolUse Completed
**Assessing test coverage for native logger**
**Verifying test coverage and bookkeeping keys update**
**Identifying missing keys in BOOKKEEPING_KEYS constant**
**Inspecting source constants for rebuild_lease_token**
**Identifying incomplete bookkeeping keys coverage**
**Verifying attempt timestamp preservation**
exec
/bin/zsh -lc "rg -n -C 4 \"AGGREGATE_BOOKKEEPING_KEYS|rebuild_last_attempt_at|rebuild_last_mutation_at|rebuild_dirty_since\" workers/storage/cloudflare.js && nl -ba workers/storage/cloudflare.js | sed -n '60,110p' && nl -ba workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js | sed -n '1,125p' && nl -ba work/verify-rebuild-sql.py | sed -n '62,155p' && git show --format= --no-ext-diff --unified=18 8676d5c -- docs/ops/aggregate-rebuild-cost-guard.md .claude/STATE.md workers/storage/cloudflare.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1651ms:
2026-09-11 03:04:13.404 xcodebuild[29604:137218548]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:04:13.586 xcodebuild[29604:137218547] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-dugFkMg8' (errno=Operation not permitted)
2026-09-11 03:04:14.044 xcodebuild[29611:137218609]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 03:04:14.178 xcodebuild[29611:137218607] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/.claude/STATE.md b/.claude/STATE.md
index 80a73d2..9d45f21 100644
--- a/.claude/STATE.md
+++ b/.claude/STATE.md
@@ -1,24 +1,38 @@
 # IMMI-Case Worktree Closeout State
 
 Updated: 2026-09-10 Australia/Melbourne
 
 ## 2026-09-10 Aggregate Rebuild Cost Guard — DONE ✓
 
+### Review 5 fixes (2026-09-11)
+
+- HIGH: the rebuild disarmed `rebuild_dirty_since` unconditionally, so a mutation
+  landing mid-scan reset the clock and the staleness bound became unreachable
+  under continuous writes. The disarm is now a conditional UPDATE that only
+  fires when the rebuild applied the generation it observed.
+- MED: `markAggregatesDirty()` writes its three control rows in one atomic
+  `db.batch()`, and the mutation timestamp is monotonic (`MAX`), so isolates
+  with skewed clocks cannot rewind the quiet window.
+- MED: the staleness bound is evaluated before the interval debounce, so a
+  freshly stamped failed attempt cannot postpone overdue work.
+- LOW: failures emit a structured `cloudflare.aggregate_rebuild_failed` event.
+- LOW: docs state the real control-row counts and per-import cost.
+
 ### Follow-up: quiet window (2026-09-11)
 - The interval alone still cost ~$28 per 153k-case import (one rebuild per
   5-minute interval for four hours). The rebuild now waits for a quiet window:
   `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) of no mutations, so an import
   collapses into **one rebuild (~$0.58)**; `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
   (default 21600) bounds staleness when mutations never pause.
 - New bookkeeping keys `rebuild_last_mutation_at` (refreshed by every mutation)
   and `rebuild_dirty_since` (armed only on the clean→dirty edge, reset by every
   rebuild) support the window and the bound.
 - Validation: Worker Vitest 27 files / **388 tests**; real-SQLite harness
   **24/24** (including "staleness clock arms on the first mutation only" and
   "rebuild disarms the staleness clock"); bundle closure passes; gate unchanged.
 
 ### Symptom
 - `immi-catalog` D1 wrote 12,084,578,591 rows (99.77% of the account's analytical
   writes) across 2026-08-23 → 2026-09-01: 12.06B billable rows ≈ **$12,060** of
   D1 rows-written charges. The budget-alert email fired once (2026-08-25 23:55
   local, quoting $5,190.94) and further spend produced no new notice.
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
index 30a4af1..4e8e51d 100644
--- a/docs/ops/aggregate-rebuild-cost-guard.md
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -12,56 +12,57 @@ The cause was in this Worker, not in the database or the queue configuration:
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
-| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
+| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (three control rows, one atomic batch) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
 | `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
 | `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
 | `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
 | `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
 | `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
 
 ### Bookkeeping model (why generations, not a boolean)
 
 State lives in `catalog_summary` (`summary_key` is the primary key) under four
 internal keys, none of which reach API responses (`getStats()` reads only
 `total_cases` / `with_full_text`). No D1 migration is required.
 
 | Key | Written by | Meaning |
 |---|---|---|
 | `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
 | `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
 | `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
 | `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
 | `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, disarmed only by a rebuild that applied the generation it observed (so continuous writes can never reset the staleness bound) |
 | `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
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
@@ -72,38 +73,38 @@ Fencing matters because a lease can expire while its holder is still working:
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
-| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
-| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window); ≤ 4 rebuilds ≈ $2.3 if it runs longer than the staleness bound |
+| One queue batch | ~584k rows (~$0.58) | 3 control rows in one atomic batch |
+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window) + ~23k control rows ≈ $0.02; a run longer than the staleness bound adds one rebuild per window |
 | Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
 | Dashboard freshness | per batch | ≤ 5 minutes stale |
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
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index 9182d51..7858b61 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -1090,82 +1090,92 @@ export class CloudflareCaseStore {
         SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
         FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
         GROUP BY cj.judge_id, c.visa_subclass`),
     );
     for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
       statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
         SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
         FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
     }
     // Bookkeeping lives in catalog_summary itself (getStats reads only
     // total_cases/with_full_text, so these keys stay internal). Recording the
     // generation observed at the start — not a bare dirty=0 — is what keeps a
     // mid-rebuild mutation pending.
     statements.push(
       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
       this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
         SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
-      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
-        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
+      // Only disarm the staleness clock when nothing arrived while this rebuild
+      // was scanning: a mutation that landed mid-scan keeps its clock armed, so
+      // the staleness bound stays reachable under continuous writes.
+      this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+         WHERE summary_key = 'rebuild_dirty_since'
+           AND COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0) <= ?`)
+        .bind(now, appliedGeneration),
     );
     for (let offset = 0; offset < statements.length; offset += 20) {
       // While we still own the lease, extend it before each chunk; if another
       // invocation took over (this run outlived its lease), abort instead of
       // interleaving DELETEs with it. At most one chunk can overlap.
       if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
         throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
           code: "rebuild_lease_lost", status: 503,
         });
       }
       await this.db.batch(statements.slice(offset, offset + 20));
     }
     return { rebuilt_at: now, applied_generation: appliedGeneration };
   }
 
   /**
    * Mark analytics as stale without paying for a rebuild: one row written per
    * queue batch instead of clearing and rewriting 17 tables.
    *
    * A monotonic generation, not a boolean: a rebuild applies the generation it
    * observed when it started, so a mutation landing mid-rebuild stays pending
    * instead of being wiped by the rebuild's own bookkeeping write.
    */
   async markAggregatesDirty() {
     const now = Math.floor(Date.now() / 1000);
     const stamp = utcNow();
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_generation', 1, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
-      .bind(stamp).run();
-    // When the last mutation happened: the scheduled rebuild waits for a quiet
-    // window so a long bulk import costs one rebuild, not one per interval.
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_last_mutation_at', ?, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
-      .bind(now, stamp).run();
-    // When the pending work first appeared: bounds how stale analytics may get
-    // while mutations keep arriving without a quiet gap.
-    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
-        VALUES ('rebuild_dirty_since', ?, ?)
-      ON CONFLICT(summary_key) DO UPDATE SET
-        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
-        updated_at = excluded.updated_at`)
-      .bind(now, stamp).run();
+    // One batch = one transaction, so two isolates cannot interleave these rows.
+    await this.db.batch([
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_generation', 1, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
+        .bind(stamp),
+      // When the last mutation happened: the scheduled rebuild waits for a quiet
+      // window so a long bulk import costs one rebuild, not one per interval.
+      // MAX() keeps it monotonic when isolates with skewed clocks interleave.
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_last_mutation_at', ?, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET
+          value_int = MAX(catalog_summary.value_int, excluded.value_int), updated_at = excluded.updated_at`)
+        .bind(now, stamp),
+      // When the pending work first appeared: bounds how stale analytics may get
+      // while mutations keep arriving without a quiet gap.
+      this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+          VALUES ('rebuild_dirty_since', ?, ?)
+        ON CONFLICT(summary_key) DO UPDATE SET
+          value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
+          updated_at = excluded.updated_at`)
+        .bind(now, stamp),
+    ]);
     return true;
   }
 
   async readAggregateState() {
     const current = rows(await this.db.prepare(
       `SELECT summary_key, value_int FROM catalog_summary
         WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
                               'rebuild_last_attempt_at', 'rebuild_lease_until',
                               'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
     ).all());
     return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
   }
 
   /**
    * Rate-limit decision for the scheduled handler: rebuild only when a
    * generation is pending and the last rebuild is older than the interval.
    * This is the only guard preventing a bulk import from rewriting the whole
    * summary set thousands of times.
@@ -1174,55 +1184,55 @@ export class CloudflareCaseStore {
     const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
       ? Math.floor(minIntervalSeconds) : 300;
     const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
     const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
       ? Math.floor(maxStalenessSeconds) : 0;
     const state = await this.readAggregateState();
     const pending = state.get("rebuild_generation") || 0;
     const applied = state.get("rebuild_applied_generation") || 0;
     if (pending <= applied) return { due: false, reason: "clean" };
 
     // Throttle on the last *attempt*, not only the last success: a rebuild that
     // throws releases its lease without stamping `rebuild_last_at`, and the
     // 30-second queue retry must not therefore rebuild on every retry.
     const lastSuccessAt = state.get("rebuild_last_at") || 0;
     const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
     const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
     const nowSeconds = Math.floor(Date.now() / 1000);
     const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
-    if (elapsedSeconds < interval) {
-      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
-    }
-
     const dirtySince = state.get("rebuild_dirty_since") || 0;
     const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
     const base = {
       pending_generation: pending,
       applied_generation: applied,
       seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
     };
 
     // Hard bound: however busy the queue is, analytics may not stay stale longer
     // than this, so a bulk import costs one rebuild per window instead of one
     // per interval.
     if (maxStaleness > 0 && staleness >= maxStaleness) {
       return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
     }
 
+    if (elapsedSeconds < interval) {
+      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
+    }
+
     // Quiet window: wait for mutations to stop, so a multi-hour import collapses
     // into a single rebuild afterwards.
     if (quiet > 0) {
       const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
       const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
       if (quietFor < quiet) {
         return {
           due: false,
           reason: "awaiting-quiet",
           seconds_until_quiet: quiet - quietFor,
           seconds_since_first_pending: staleness,
           ...base,
         };
       }
     }
 
     return { due: true, reason: "dirty", seconds_since_first_pending: staleness, ...base };
   }

hook: PostToolUse
hook: PostToolUse Completed
**Identifying outdated documentation and required changes**
**Confirming snapshot and aggregation closure status**
**Verifying atomic race-safety and comparison logic**
**Assessing caller presence in batch code**
**Verifying batch harness test coverage and field ordering**
**Identifying stale duplicate reset logic**
**Assessing staleness discrepancies in documentation**
**Identifying test key mismatches and doc inaccuracies**
**Planning final report structure and handoff**
codex
完成：

| Finding | 結論 | 證據 |
|---|---|---|
| 1 | 已關閉 | 條件式 disarm 使用 `COALESCE` 並比較掃描前 generation；applied-generation 寫入、成功時間、disarm 依序在 aggregate scan 後的最終 batch 執行。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1017) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1103) SQL harness 以執行期觀察到的 generation=5，先重播 aggregate work，再執行 dirty 寫入，最後才重播 bookkeeping，並驗證仍為 pending、dirty clock 仍 armed。[verify-rebuild-sql.py](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/work/verify-rebuild-sql.py:121) |
| 2 | 已關閉 | `markAggregatesDirty()` 將三個控制列放入一次 `db.batch()`；目前呼叫端只等待整個方法，沒有依賴舊有三次 await 的中間狀態。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1140) [cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:243) 測試驗證一次 batch、三個 statement；但 harness 對此段仍逐條執行 SQL，未驗證 batch 原子性。[cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74) |
| 3 | 已關閉 | max-staleness 現在先於 interval debounce 判斷；既有 `debounced` 與 `awaiting-quiet` 回傳原因及倒數欄位未被改壞。測試明確覆蓋「剛寫 attempt 但已超過 staleness bound」的優先序。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1204) [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:179) |
| 4 | 已關閉，但沒有直接測試 | scheduled 與 queue-fallback 的失敗路徑均輸出 `cloudflare.aggregate_rebuild_failed` 結構化事件。[cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:208) [cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:252) |
| 5 | 未完全關閉 | 成本表已改為三個控制列與約 `$0.02` 控制列成本，但文件仍重複 `rebuild_dirty_since`，第二列仍錯稱「每次 rebuild reset」；也仍稱只有 four internal keys，實作實際有七個。[aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:40) [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:50) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) |
| 6 | 未關閉 | 測試常數仍漏掉 `rebuild_last_attempt_at`；實作保留七個 key，測試只檢查六個。因此它未真正保證所有 bookkeeping key 不會被 rebuild delete 清除。[cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) |

新增風險：

- `.claude/STATE.md` 舊段落仍稱 `rebuild_dirty_since` 每次 rebuild reset，且稱 mark-dirty 只寫一列，與目前實作衝突。[STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:28) [STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:49)
- 文件的「Dashboard freshness ≤ 5 minutes」不符合 quiet window 加上 six-hour max-staleness 的實際行為。[aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:94)

未修改檔案；未執行測試、建置或網路操作。下一位 Codex 應修正文件矛盾並讓測試常數與實作 key 清單一致後再複審。  
VERDICT: CHANGES-REQUIRED
tokens used
95,542
完成：

| Finding | 結論 | 證據 |
|---|---|---|
| 1 | 已關閉 | 條件式 disarm 使用 `COALESCE` 並比較掃描前 generation；applied-generation 寫入、成功時間、disarm 依序在 aggregate scan 後的最終 batch 執行。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1017) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1103) SQL harness 以執行期觀察到的 generation=5，先重播 aggregate work，再執行 dirty 寫入，最後才重播 bookkeeping，並驗證仍為 pending、dirty clock 仍 armed。[verify-rebuild-sql.py](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/work/verify-rebuild-sql.py:121) |
| 2 | 已關閉 | `markAggregatesDirty()` 將三個控制列放入一次 `db.batch()`；目前呼叫端只等待整個方法，沒有依賴舊有三次 await 的中間狀態。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1140) [cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:243) 測試驗證一次 batch、三個 statement；但 harness 對此段仍逐條執行 SQL，未驗證 batch 原子性。[cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74) |
| 3 | 已關閉 | max-staleness 現在先於 interval debounce 判斷；既有 `debounced` 與 `awaiting-quiet` 回傳原因及倒數欄位未被改壞。測試明確覆蓋「剛寫 attempt 但已超過 staleness bound」的優先序。[cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1204) [cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:179) |
| 4 | 已關閉，但沒有直接測試 | scheduled 與 queue-fallback 的失敗路徑均輸出 `cloudflare.aggregate_rebuild_failed` 結構化事件。[cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:208) [cloudflare-native.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:252) |
| 5 | 未完全關閉 | 成本表已改為三個控制列與約 `$0.02` 控制列成本，但文件仍重複 `rebuild_dirty_since`，第二列仍錯稱「每次 rebuild reset」；也仍稱只有 four internal keys，實作實際有七個。[aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:40) [aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:50) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) |
| 6 | 未關閉 | 測試常數仍漏掉 `rebuild_last_attempt_at`；實作保留七個 key，測試只檢查六個。因此它未真正保證所有 bookkeeping key 不會被 rebuild delete 清除。[cloudflare-aggregate-rebuild-guard.test.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11) [cloudflare.js](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:53) |

新增風險：

- `.claude/STATE.md` 舊段落仍稱 `rebuild_dirty_since` 每次 rebuild reset，且稱 mark-dirty 只寫一列，與目前實作衝突。[STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:28) [STATE.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/.claude/STATE.md:49)
- 文件的「Dashboard freshness ≤ 5 minutes」不符合 quiet window 加上 six-hour max-staleness 的實際行為。[aggregate-rebuild-cost-guard.md](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:94)

未修改檔案；未執行測試、建置或網路操作。下一位 Codex 應修正文件矛盾並讓測試常數與實作 key 清單一致後再複審。  
VERDICT: CHANGES-REQUIRED
