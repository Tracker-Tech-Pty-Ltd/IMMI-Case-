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
session id: 01a08c3c-16e7-7bd3-bf78-fec23cd77088
--------
user
Fifth review pass — verify the quiet-window delta only. Review only, do not modify anything.

HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files. Read-only commands only (cat, sed -n, git diff, git show, grep). Answer directly, no narration.

Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
Branch: fix/aggregate-rebuild-debounce, HEAD e30f910 (vs 30999fb). Earlier commits ed49b15 + 30999fb were already reviewed and approved in a fourth pass; review ONLY the e30f910 delta unless it invalidates something older.

WHAT CHANGED (the problem it solves)
The previous design rebuilt at most once per AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS (300 s). During a four-hour bulk import that still meant ~48 rebuilds ≈ $28, because every interval found pending work. The delta:
- `markAggregatesDirty()` now writes three rows: the generation counter (unchanged), `rebuild_last_mutation_at` (epoch seconds, refreshed on every mutation) and `rebuild_dirty_since` (epoch seconds, armed only on the clean→dirty edge via `CASE WHEN catalog_summary.value_int = 0`).
- `aggregatesNeedRebuild({ minIntervalSeconds, quietSeconds, maxStalenessSeconds })` now: not-due when clean → not-due `debounced` when the last attempt is younger than the interval → **due `max-staleness`** when `now - dirty_since >= maxStalenessSeconds` → not-due `awaiting-quiet` when `now - last_mutation_at < quietSeconds` → otherwise due `dirty`.
- `rebuildAggregates()` additionally writes `rebuild_dirty_since = 0` in its bookkeeping batch and the two new keys joined AGGREGATE_BOOKKEEPING_KEYS (so the rebuild's DELETE keeps them).
- Worker entry: `rebuildDecisionParams()` supplies `quietSeconds` from `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) and `maxStalenessSeconds` from `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) for both the cron path and the queue fallback.
- Config/docs/tests updated; four AGGREGATE_REBUILD_* vars + the cron are in wrangler.toml and the operator example.

VERIFY ADVERSARIALLY (cite file:line, severity, concrete fix)
1. Can the quiet window starve analytics permanently, or leave `rebuild_dirty_since` stuck at 0 while work is pending (making the staleness bound unreachable)? Check the arming edge, the case where the first mutation arrives before any rebuild ever ran, and the case where a rebuild crashes after disarming.
2. Ordering of the three checks: can `max-staleness` be masked by `debounced`, or can a failing rebuild keep the pipeline permanently in `debounced`/`awaiting-quiet`? Is `waiting` distinguishable from a broken pipeline in the logs?
3. Concurrency: two mutations landing in different isolates, `rebuild_dirty_since` written concurrently by both (both see 0 and both write), a rebuild's `= 0` racing a fresh mutation — does any interleaving lose pending work or mis-measure staleness?
4. Does the extra write per mutation (3 statements instead of 1) change the cost story the docs claim (~$0.58 per import), and are the new keys genuinely excluded from the rebuild's DELETE?
5. Do the new tests fail if the quiet window, the bound, or the arming edge is removed? Name the test per invariant.

ALREADY VERIFIED BY THE AUTHOR (do not re-derive): Worker Vitest 27 files / 388 tests; real-SQLite harness 24/24 (including "staleness clock arms on the first mutation only", "mutation timestamp is refreshed", "rebuild disarms the staleness clock", the generation race replay and lease fencing); bundle closure passes; the native-config gate output is unchanged.

NOT IN SCOPE: style, naming, comments, the earlier commits' design decisions already approved, or the operator's deploy process.

Output: findings HIGH → LOW with file:line, severity, issue, concrete fix; say "no finding" for any numbered area above that is clean. Final line exactly: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T16:52:23.948831Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T16:52:24.293320Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T16:52:25.596320Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T16:52:25.605091Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
**Confirming strict no-tool policy**
**Defining allowed read-only commands**
codex
我會只讀檢視 `e30f910` 相對 `30999fb` 的差異，僅依指定五項提出可重現的風險。
exec
/bin/zsh -c 'git diff --unified=80 30999fb e30f910 -- workers wrangler.toml docs || git diff --unified=80 30999fb e30f910' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 2336ms:
2026-09-11 02:52:37.771 xcodebuild[13557:137122330]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 02:52:38.051 xcodebuild[13557:137122329] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-xCDq1ItD' (errno=Operation not permitted)
2026-09-11 02:52:38.572 xcodebuild[13582:137122605]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 02:52:38.707 xcodebuild[13582:137122599] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
index c973ce1..7c3da43 100644
--- a/docs/ops/aggregate-rebuild-cost-guard.md
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -1,191 +1,218 @@
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
 | `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
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
+| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
+| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
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
 | One queue batch | ~584k rows (~$0.58) | 1–2 rows |
-| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | ≤ 48 rebuilds ≈ 28M rows ≈ **$28** |
+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | **1 rebuild ≈ 584k rows ≈ $0.58** (quiet window); ≤ 4 rebuilds ≈ $2.3 if it runs longer than the staleness bound |
+| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
 | Dashboard freshness | per batch | ≤ 5 minutes stale |
 | Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
 
-Two knobs, both operator-side vars:
+### Quiet window (why an import costs cents, not dollars)
+
+The interval alone only bounds *how often* a rebuild may run; during a four-hour
+bulk import it still fires every interval, which is how a fixed version could
+still spend ~$28 on one import. The rebuild therefore waits for a **quiet
+window**: it will not run until mutations have been silent for
+`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
+**one rebuild (~$0.58)** because the pending work accumulates while the import
+runs and is rebuilt once afterwards. A dashboard read during an import therefore
+sees figures from before the import — acceptable, since nobody is reading
+aggregates while bulk data is still landing.
+
+The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
+hours): if mutations never pause, analytics are still refreshed on that cadence
+instead of drifting indefinitely. Lower it if continuous-write periods must stay
+fresher; raise it to make very long imports even cheaper.
+
+Four operator-side knobs:
 
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
+- `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
+  above: no rebuild until mutations have been silent this long.
+- `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
+  staleness while mutations never stop.
 
 Removing the cron, lowering the interval towards the cron period, or moving the
 rebuild back into the queue consumer restores the old cost curve.
 
 ## Deploy requirements (operator action)
 
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
+- [ ] During a bulk import, `rebuild_dirty_since` stays armed and
+      `rebuild_applied_generation` does **not** chase it until the import goes
+      quiet — that is the quiet window working, not a stalled pipeline.
 - [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
       is normal; constant entries mean rebuilds take longer than the lease.
 - [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
       normal operation; a widening gap means rebuilds are failing and being
       retried (check Worker logs for `aggregate_rebuild_lease_release_error`
       and for the underlying D1 error).
 
 ## Rollback
 
 **Do not restore the per-batch rebuild.** That is the incident mechanism, and
 reverting to it re-creates the ~$12,060 cost curve within a single import.
 
 Safe rollback levers, in order of preference:
 
 1. **Cron missing or not firing** (symptom: the queue log shows repeated
    `cloudflare.aggregate_rebuild_fallback` events, or totals advance only about
    hourly): fix the trigger / regenerate the operator config. Nothing is broken
    by leaving the fallback in place — it is bounded at one rebuild per
    `AGGREGATE_REBUILD_FALLBACK_SECONDS`.
 2. **Rebuild is too expensive or too frequent**: raise
    `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (300 → 900 → 3600). Cost scales
    linearly with the number of rebuilds, so this is the correct lever.
 3. **Scheduled rebuild must stop entirely** (e.g. during a schema change): set
    the cron aside (`[triggers] crons = []`) and raise the fallback interval. The
    queue path keeps the data fresh at the fallback cadence.
 4. **Full revert of this change**: only with the original bug explicitly
    re-fixed first (coalescing must survive); record the decision in this file.
 
 Observed symptom to watch for: a dashboard whose totals stop advancing means the
 dirty flag is not being drained — fix the drain path, never the queue's cost
 profile.
diff --git a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
index 3b20472..6435ac4 100644
--- a/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
+++ b/workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
@@ -1,317 +1,379 @@
 import { describe, expect, it, vi } from "vitest";
 import { createCloudflareStores } from "../storage/cloudflare.js";
 
 const REBUILD_TABLES = [
   "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
   "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
   "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
   "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
   "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
 ];
 const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
 
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
-function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken } = {}) {
+function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
   const rows = [];
   if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
   if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
   if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
   if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
   if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
   if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
+  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
+  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
   return rows;
 }
 
 const nowSeconds = () => Math.floor(Date.now() / 1000);
 
 describe("Catalog aggregate rebuild guard", () => {
   it("records staleness as a monotonic generation, not a boolean", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.markAggregatesDirty();
 
-    expect(catalog.prepared).toHaveLength(1);
+    // Three rows: the generation counter, the mutation timestamp and the
+    // staleness clock (which only arms when it is currently zero).
+    expect(catalog.prepared).toHaveLength(3);
     const statement = catalog.prepared[0];
     expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
     expect(statement.sql).toMatch(/rebuild_generation/);
     expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
     expect(statement.params).toHaveLength(1);
   });
 
+  it("stamps the mutation time and arms the staleness clock", async () => {
+    const { catalog, value } = env();
+    const before = nowSeconds();
+
+    await createCloudflareStores(value).caseStore.markAggregatesDirty();
+
+    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
+    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
+    expect(mutation).toBeDefined();
+    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
+    expect(dirtySince).toBeDefined();
+    // The staleness clock only arms when it is currently zero.
+    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
+  });
+
   it("never iterates the corpus when marking dirty", async () => {
     const { catalog, value } = env();
     const stores = createCloudflareStores(value);
 
     await stores.caseStore.markAggregatesDirty();
 
     expect(catalog.batch).not.toHaveBeenCalled();
     expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
   });
 
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
 
+  it("waits for a quiet window before rebuilding", async () => {
+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
+    const stores = createCloudflareStores(value);
+
+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
+
+    expect(decision.due).toBe(false);
+    expect(decision.reason).toBe("awaiting-quiet");
+    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
+    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
+  });
+
+  it("rebuilds once mutations have been quiet long enough", async () => {
+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
+    const stores = createCloudflareStores(value);
+
+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
+      .resolves.toMatchObject({ due: true, reason: "dirty" });
+  });
+
+  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
+    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
+    const stores = createCloudflareStores(value);
+
+    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
+
+    expect(decision.due).toBe(true);
+    expect(decision.reason).toBe("max-staleness");
+    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
+  });
+
+  it("keeps the legacy behaviour when no quiet window is configured", async () => {
+    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
+    const stores = createCloudflareStores(value);
+
+    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
+      .resolves.toMatchObject({ due: true, reason: "dirty" });
+  });
+
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
 
     expect(catalog.prepared.some((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"))).toBe(false);
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
-    // + 2 bookkeeping rows.
-    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 2);
+    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
+    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
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
+    const resetDirtySince = catalog.prepared
+      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
     expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
     expect(Number(applied.params[0])).toBe(7);
     expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
     expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
+    expect(resetDirtySince).toBeDefined();
+    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
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
diff --git a/workers/__tests__/cloudflare-native-queue.test.js b/workers/__tests__/cloudflare-native-queue.test.js
index f6d75f6..d9b63ec 100644
--- a/workers/__tests__/cloudflare-native-queue.test.js
+++ b/workers/__tests__/cloudflare-native-queue.test.js
@@ -71,149 +71,166 @@ describe("Cloudflare-native case mutation queue", () => {
 
   it("verifies the R2 pointer before re-embedding and marks semantic-ready", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
     const message = {
       body: {
         kind: "case.reindex", case_id: "0123456789ab", content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
         content_sha256: "a".repeat(64), content_size: 20, content_type: "text/plain; charset=utf-8",
       },
       ack: vi.fn(), retry: vi.fn(),
     };
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
     expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({ contentType: "text/plain; charset=utf-8" }));
     expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith("0123456789ab", expect.any(Array), expect.objectContaining({ court_code: "FCA", year: 2026 }));
     expect(current.caseStore.markSemanticReady).toHaveBeenCalledWith("0123456789ab", "mutation-1");
     // A queue batch must never pay for a full rebuild; it only flags staleness.
     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(message.ack).toHaveBeenCalledOnce();
     expect(message.retry).not.toHaveBeenCalled();
   });
 
   it("retries when the verified source or embedding fails", async () => {
     const current = stores();
     current.objectStore.getVerifiedText.mockRejectedValue(new Error("checksum mismatch"));
     mockCreateStores.mockReturnValue(current);
     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
     expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
     expect(message.ack).not.toHaveBeenCalled();
   });
 
   it("hands pointer-addressed extraction payloads to the storage coordinator", async () => {
     const current = stores();
     current.objectStore.getVerifiedJson = vi.fn(async () => ({
       record: { case_id: "0123456789ab", title: "Example" },
       canonicalText: "canonical text",
       audit: [],
     }));
     mockCreateStores.mockReturnValue(current);
     const message = {
       body: {
         kind: "case.extracted", event_id: "case.extracted:run:0123456789ab", run_id: "run",
         payload_key: "pipeline/run/0123456789ab.json", payload_sha256: "a".repeat(64), payload_size: 100,
         payload_content_type: "application/json",
       },
       ack: vi.fn(), retry: vi.fn(),
     };
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
     expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({ key: message.body.payload_key }), expect.objectContaining({ prefix: "pipeline" }));
     expect(mockCoordinate).toHaveBeenCalledWith(expect.objectContaining({ eventId: message.body.event_id, runId: "run", canonicalText: "canonical text" }));
     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(message.ack).toHaveBeenCalledOnce();
   });
 
   it("flags catalog aggregates as stale for a mutation-triggered refresh event", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
     const message = {
       body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
       ack: vi.fn(),
       retry: vi.fn(),
     };
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(message.ack).toHaveBeenCalledOnce();
     expect(message.retry).not.toHaveBeenCalled();
   });
 
   it("uses the fallback rebuild only when the cron path has gone quiet", async () => {
     const current = stores();
     current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
     mockCreateStores.mockReturnValue(current);
     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
 
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });
 
     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800 });
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
     expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
     expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
   });
 
   it("defaults the fallback window to an hour when unset", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
 
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
 
-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600 });
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
   });
 
   it("does not rebuild from the queue path when another invocation holds the lease", async () => {
     const current = stores();
     current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
     current.caseStore.claimRebuildLease.mockResolvedValue(null);
     mockCreateStores.mockReturnValue(current);
     const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
 
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
 
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
     expect(message.ack).toHaveBeenCalledOnce();
   });
 
+  it("honours the configured quiet window and staleness bound", async () => {
+    const current = stores();
+    mockCreateStores.mockReturnValue(current);
+    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
+
+    await worker.queue({ messages: [message] }, {
+      IMMI_STORAGE_MODE: "cloudflare",
+      AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800",
+      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
+      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
+    });
+
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
+      minIntervalSeconds: 1800, quietSeconds: 900, maxStalenessSeconds: 43200,
+    });
+  });
+
   it("coalesces many mutations in one batch into a single stale flag", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
     const messages = Array.from({ length: 20 }, (_, index) => ({
       body: { kind: "case.reindex", case_id: "0123456789ab", event_id: `case.reindex:${index}` },
       ack: vi.fn(),
       retry: vi.fn(),
     }));
     await worker.queue({ messages }, { IMMI_STORAGE_MODE: "cloudflare" });
     // 20 mutations used to mean one 584k-row rebuild; now they mean one row.
     expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
   });
 
   it("deletes a case source only through its validated R2 pointer", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
     const message = {
       body: {
         kind: "case.source.delete",
         case_id: "0123456789ab",
         content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
         content_sha256: "a".repeat(64),
         content_size: 20,
         content_type: "text/plain; charset=utf-8",
       },
       ack: vi.fn(),
       retry: vi.fn(),
     };
     await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
     expect(current.objectStore.deleteVerified).toHaveBeenCalledWith(
       expect.objectContaining({ key: message.body.content_key, sha256: message.body.content_sha256 }),
       { prefix: "cases" },
     );
     expect(message.ack).toHaveBeenCalledOnce();
   });
 });
diff --git a/workers/__tests__/cloudflare-native-scheduled-rebuild.test.js b/workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
index add7387..c2b1146 100644
--- a/workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
+++ b/workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
@@ -1,116 +1,141 @@
 import { beforeEach, describe, expect, it, vi } from "vitest";
 
 vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
 
 const mockCreateStores = vi.fn();
 vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
 vi.mock("../storage/pipeline_coordinator.js", () => ({
   coordinateExtractedCase: vi.fn(async () => ({ status: "completed" })),
   splitFtsChunks: (text) => [text],
 }));
 
 import worker from "../cloudflare-native.js";
 
 function stores(decision = { due: true, reason: "dirty" }) {
   return {
     caseStore: {
       aggregatesNeedRebuild: vi.fn(async () => decision),
       rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
       markAggregatesDirty: vi.fn(async () => true),
       claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
       releaseRebuildLease: vi.fn(async () => true),
     },
   };
 }
 
 beforeEach(() => vi.clearAllMocks());
 
 describe("Cloudflare-native scheduled aggregate rebuild", () => {
   it("rebuilds once when the aggregates are dirty", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
 
     const result = await worker.scheduled({ cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });
 
-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
     expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "cron-lease", leaseSeconds: 900 } });
     expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
     expect(result).toMatchObject({ due: true, rebuilt_at: "2026-09-10T00:00:00.000Z" });
   });
 
   it("does not rebuild while the interval is still debouncing", async () => {
     const current = stores({ due: false, reason: "debounced", seconds_until_due: 120 });
     mockCreateStores.mockReturnValue(current);
 
     const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
 
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(result).toMatchObject({ due: false, reason: "debounced" });
   });
 
   it("does not rebuild when nothing changed", async () => {
     const current = stores({ due: false, reason: "clean" });
     mockCreateStores.mockReturnValue(current);
 
     await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
 
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
   });
 
   it("honours the configured lease length", async () => {
     const current = stores();
     mockCreateStores.mockReturnValue(current);
 
     await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_LEASE_SECONDS: "1800" });
 
     expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 1800 });
   });
 
   it("honours the configured minimum interval", async () => {
     const current = stores({ due: false, reason: "debounced", seconds_until_due: 30 });
     mockCreateStores.mockReturnValue(current);
 
     await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: "600" });
 
-    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600 });
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
   });
 
   it("falls back to the default interval when the variable is missing or invalid", async () => {
     for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
       const current = stores({ due: false, reason: "debounced" });
       mockCreateStores.mockReturnValue(current);
       await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
-      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
+      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
     }
   });
 
   it("skips the rebuild when another invocation holds the lease", async () => {
     const current = stores();
     current.caseStore.claimRebuildLease.mockResolvedValue(null);
     mockCreateStores.mockReturnValue(current);
 
     const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
 
     expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
     expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
     expect(result).toMatchObject({ skipped: "lease_held" });
   });
 
   it("releases the lease even when the rebuild fails", async () => {
     const current = stores();
     current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
     mockCreateStores.mockReturnValue(current);
 
     await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
     expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
   });
 
+  it("reads the quiet window and staleness bound from the environment", async () => {
+    const current = stores();
+    mockCreateStores.mockReturnValue(current);
+
+    await worker.scheduled({}, {
+      IMMI_STORAGE_MODE: "cloudflare",
+      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
+      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
+    });
+
+    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
+      minIntervalSeconds: 300, quietSeconds: 120, maxStalenessSeconds: 7200,
+    });
+  });
+
+  it("reports a quiet-window deferral instead of rebuilding", async () => {
+    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
+    mockCreateStores.mockReturnValue(current);
+
+    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });
+
+    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
+    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
+  });
+
   it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
     const current = stores();
     current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
     mockCreateStores.mockReturnValue(current);
 
     await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
   });
 });
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index 0464749..3f81a3d 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -57,241 +57,256 @@ async function processCaseReindex(message, stores) {
     source: String(current.source || ""),
     visa_subclass: String(current.visa_subclass || ""),
   });
   await stores.caseStore.markSemanticReady(event.case_id, mutation?.mutationId || null);
   return true;
 }
 
 async function processAggregateRebuild(message) {
   const event = message?.body;
   if (!event || event.kind !== "catalog.rebuild") return false;
   return true;
 }
 
 async function processCaseSourceDelete(message, stores) {
   const event = message?.body;
   if (!event || event.kind !== "case.source.delete") return false;
   await stores.objectStore.deleteVerified({
     key: event.content_key,
     sha256: event.content_sha256,
     size: event.content_size,
     contentType: event.content_type || "text/plain; charset=utf-8",
   }, { prefix: "cases" });
   return true;
 }
 
 async function processCaseExtracted(message, env) {
   const event = message?.body;
   if (!event || event.kind !== "case.extracted") return false;
   const stores = createCloudflareStores(env);
   const payload = await stores.objectStore.getVerifiedJson({
     key: event.payload_key,
     sha256: event.payload_sha256,
     size: event.payload_size,
     contentType: event.payload_content_type || "application/json",
   }, { prefix: "pipeline", maxBytes: 16 * 1024 * 1024, label: "Pipeline extraction payload" });
   if (!payload || typeof payload !== "object") throw new StorageBoundaryError("Pipeline extraction payload is invalid", { code: "pipeline_payload_invalid", status: 503 });
   await coordinateExtractedCase({
     env,
     eventId: event.event_id,
     runId: event.run_id,
     record: payload.record,
     canonicalText: payload.canonicalText,
     audit: payload.audit,
   });
   return true;
 }
 
 async function handleCaseMutationQueue(batch, env) {
   const messages = batch?.messages || [];
   const stores = createCloudflareStores(env);
   try {
     let changed = false;
     for (const message of messages) {
       if (await processCaseExtracted(message, env)) {
         changed = true;
       } else if (await processCaseReindex(message, stores)) {
         changed = true;
       } else if (await processCaseSourceDelete(message, stores)) {
         changed = true;
       } else if (await processAggregateRebuild(message)) {
         changed = true;
       }
     }
     // Never rebuild on the happy path: one rebuild clears and rewrites 17
     // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
     // Aug 2026. Record staleness instead; the cron trigger coalesces it.
     if (changed) await markStaleAndMaybeRebuild(stores, env);
     for (const message of messages) if (typeof message?.ack === "function") message.ack();
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
+// Quiet window: a rebuild waits until mutations have stopped for this long, so a
+// multi-hour bulk import collapses into one rebuild instead of one per interval
+// (measured: ~$28 -> ~$0.58 per 153k-case import).
+const DEFAULT_QUIET_SECONDS = 300;
+// Hard staleness bound: however busy the queue is, analytics refresh at least
+// this often. Only reachable while mutations never pause.
+const DEFAULT_MAX_STALENESS_SECONDS = 21600;
 
 function positiveIntOr(value, fallback) {
   const parsed = Number.parseInt(value ?? "", 10);
   return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
 }
 
+function rebuildDecisionParams(env, minIntervalSeconds) {
+  return {
+    minIntervalSeconds,
+    quietSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_QUIET_SECONDS, DEFAULT_QUIET_SECONDS),
+    maxStalenessSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_MAX_STALENESS_SECONDS, DEFAULT_MAX_STALENESS_SECONDS),
+  };
+}
+
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
-  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!decision.due) {
     console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
     return decision;
   }
   const startedAt = Date.now();
   const result = await rebuildUnderLease(stores, env);
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
-  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
   if (!fallback?.due) return false;
   const result = await rebuildUnderLease(stores, env);
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
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index f42d675..9182d51 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -1,135 +1,136 @@
 /**
  * Cloudflare-native repository implementations.
  *
  * This module owns all D1/R2/Vectorize/Workers AI binding access. Council
  * storage activates only under the explicit `cloudflare` mode; all other
  * public API paths remain legacy until their contract, reconciliation and
  * rollback gates pass.
  */
 
 import {
   assertAuthContext,
   assertCaseId,
   assertCloudflareBindings,
   assertCloudflareRuntimeMode,
   assertObjectKey,
   assertObjectPointer,
   assertSha256,
   assertUuid,
   clampLimit,
   D1_MAX_BOUND_PARAMETERS,
   FTS_CHUNK_MAX_BYTES,
   sha256Hex,
   StorageBoundaryError,
   textBytes,
   toFtsMatch,
   utcNow,
   VECTOR_DIMENSIONS,
   VECTOR_MODEL,
 } from "./contracts.js";
 
 const VECTOR_FILTER_KEYS = new Set(["court_code", "year", "source", "visa_subclass"]);
 const MAX_COUNCIL_PAYLOAD_BYTES = 8 * 1024 * 1024;
 const JUDGE_PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
 const JUDGE_PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
 
 function requireD1(binding, name) {
   if (!binding || typeof binding.prepare !== "function") {
     throw new StorageBoundaryError(`${name} D1 binding is unavailable`, {
       code: "missing_cloudflare_binding",
       status: 503,
     });
   }
   return binding;
 }
 
 function rows(result) {
   return Array.isArray(result?.results) ? result.results : [];
 }
 
 // catalog_summary doubles as the aggregate-rebuild control table. Its
 // bookkeeping keys must survive a rebuild's DELETE so a mutation landing
 // mid-rebuild still leaves a pending generation behind.
 const AGGREGATE_BOOKKEEPING_KEYS = [
   "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
   "rebuild_last_attempt_at", "rebuild_lease_until",
+  "rebuild_last_mutation_at", "rebuild_dirty_since",
 ];
 
 // The rebuild lease keeps its fencing token in the `updated_at` column of the
 // SAME row that holds the expiry, so claiming, renewing and releasing are each
 // a single atomic statement: a token captured in one column and an expiry in
 // another could otherwise be read in a torn state by an expiring holder.
 function leaseToken() {
   const uuid = globalThis.crypto?.randomUUID?.();
   if (uuid) return uuid;
   return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
 }
 
 function changeCount(result) {
   return Number(result?.meta?.changes || 0);
 }
 
 function bindAll(database, sql, params) {
   if (params.length > D1_MAX_BOUND_PARAMETERS) {
     throw new StorageBoundaryError("D1 statement exceeds the 100-parameter limit", {
       code: "d1_parameter_limit",
       status: 500,
     });
   }
   return database.prepare(sql).bind(...params);
 }
 
 function safeCaseFilters(filters = {}) {
   const clauses = [];
   const params = [];
   const supported = ["court_code", "year", "outcome", "visa_subclass", "visa_type", "source", "case_nature"];
   for (const key of supported) {
     const value = filters[key];
     if (value === undefined || value === null || value === "") continue;
     if (key === "year") {
       const year = Number.parseInt(String(value), 10);
       if (!Number.isInteger(year) || year < 1800 || year > 3000) {
         throw new StorageBoundaryError("year filter is invalid", { code: "invalid_filter", status: 400 });
       }
       clauses.push("c.year = ?");
       params.push(year);
     } else {
       if (typeof value !== "string" || value.length > 128) {
         throw new StorageBoundaryError(`${key} filter is invalid`, { code: "invalid_filter", status: 400 });
       }
       clauses.push(`c.${key} = ?`);
       params.push(value);
     }
   }
   return { clauses, params };
 }
 
 const LEGACY_CASE_PROJECTION = `
   c.case_id, c.citation, c.title, c.court, c.court_code,
   c.decision_date AS date, c.year, c.outcome, c.visa_type, c.source,
   c.tags, c.case_nature, c.visa_subclass, c.visa_class_code,
   c.applicant_name, c.respondent, c.country_of_origin,
   c.visa_subclass_number, c.hearing_date, c.is_represented,
   c.representative, c.url, c.catchwords, c.legislation, c.text_snippet,
   c.user_notes, c.visa_outcome_reason, c.legal_test_applied,
   c.content_key AS full_text_path,
   COALESCE((
     SELECT group_concat(canonical_name, '; ')
     FROM (
       SELECT j.canonical_name
       FROM case_judges cj JOIN judges j ON j.judge_id = cj.judge_id
       WHERE cj.case_id = c.case_id
       ORDER BY j.canonical_name
     )
   ), '') AS judges,
   COALESCE((
     SELECT group_concat(label, '; ')
     FROM (
       SELECT lc.label
       FROM case_concepts cc JOIN concepts lc ON lc.concept_id = cc.concept_id
       WHERE cc.case_id = c.case_id
       ORDER BY lc.label
     )
   ), '') AS legal_concepts
 `;
 
@@ -1027,230 +1028,280 @@ export class CloudflareCaseStore {
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
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
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
+    const now = Math.floor(Date.now() / 1000);
+    const stamp = utcNow();
     await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
         VALUES ('rebuild_generation', 1, ?)
       ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
-      .bind(utcNow()).run();
+      .bind(stamp).run();
+    // When the last mutation happened: the scheduled rebuild waits for a quiet
+    // window so a long bulk import costs one rebuild, not one per interval.
+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_last_mutation_at', ?, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
+      .bind(now, stamp).run();
+    // When the pending work first appeared: bounds how stale analytics may get
+    // while mutations keep arriving without a quiet gap.
+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_dirty_since', ?, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET
+        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
+        updated_at = excluded.updated_at`)
+      .bind(now, stamp).run();
     return true;
   }
 
   async readAggregateState() {
     const current = rows(await this.db.prepare(
       `SELECT summary_key, value_int FROM catalog_summary
         WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
-                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
+                              'rebuild_last_attempt_at', 'rebuild_lease_until',
+                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
     ).all());
     return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
   }
 
   /**
    * Rate-limit decision for the scheduled handler: rebuild only when a
    * generation is pending and the last rebuild is older than the interval.
    * This is the only guard preventing a bulk import from rewriting the whole
    * summary set thousands of times.
    */
-  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
+  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
     const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
       ? Math.floor(minIntervalSeconds) : 300;
+    const quiet = Number.isFinite(quietSeconds) && quietSeconds > 0 ? Math.floor(quietSeconds) : 0;
+    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
+      ? Math.floor(maxStalenessSeconds) : 0;
     const state = await this.readAggregateState();
     const pending = state.get("rebuild_generation") || 0;
     const applied = state.get("rebuild_applied_generation") || 0;
     if (pending <= applied) return { due: false, reason: "clean" };
+
     // Throttle on the last *attempt*, not only the last success: a rebuild that
     // throws releases its lease without stamping `rebuild_last_at`, and the
     // 30-second queue retry must not therefore rebuild on every retry.
     const lastSuccessAt = state.get("rebuild_last_at") || 0;
     const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
     const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
-    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
+    const nowSeconds = Math.floor(Date.now() / 1000);
+    const elapsedSeconds = lastAt > 0 ? nowSeconds - lastAt : interval;
     if (elapsedSeconds < interval) {
       return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
     }
-    return {
-      due: true,
-      reason: "dirty",
+
+    const dirtySince = state.get("rebuild_dirty_since") || 0;
+    const staleness = dirtySince > 0 ? nowSeconds - dirtySince : 0;
+    const base = {
       pending_generation: pending,
       applied_generation: applied,
       seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
     };
+
+    // Hard bound: however busy the queue is, analytics may not stay stale longer
+    // than this, so a bulk import costs one rebuild per window instead of one
+    // per interval.
+    if (maxStaleness > 0 && staleness >= maxStaleness) {
+      return { due: true, reason: "max-staleness", seconds_since_first_pending: staleness, ...base };
+    }
+
+    // Quiet window: wait for mutations to stop, so a multi-hour import collapses
+    // into a single rebuild afterwards.
+    if (quiet > 0) {
+      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
+      const quietFor = lastMutationAt > 0 ? nowSeconds - lastMutationAt : Number.MAX_SAFE_INTEGER;
+      if (quietFor < quiet) {
+        return {
+          due: false,
+          reason: "awaiting-quiet",
+          seconds_until_quiet: quiet - quietFor,
+          seconds_since_first_pending: staleness,
+          ...base,
+        };
+      }
+    }
+
+    return { due: true, reason: "dirty", seconds_since_first_pending: staleness, ...base };
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
       ORDER BY related_score DESC, c.year DESC, c.case_id ASC
       LIMIT ?
     `, [
       anchor.case_nature, anchor.case_nature,
       anchor.visa_type, anchor.visa_type,
       anchor.court_code, anchor.court_code,
       id,
       anchor.case_nature, anchor.case_nature,
       anchor.visa_type, anchor.visa_type,
       anchor.court_code, anchor.court_code,
       size,
     ]);
     return rows(await statements.all());
   }
 
   async searchLexical({ query, match, filters = {}, limit } = {}) {
     const matchString = match ?? toFtsMatch(query);
diff --git a/wrangler.toml b/wrangler.toml
index d03b619..ab72be8 100644
--- a/wrangler.toml
+++ b/wrangler.toml
@@ -20,92 +20,97 @@ not_found_handling = "single-page-application"
 binding = "IMMI_CATALOG_DB"
 database_name = "immi-catalog"
 database_id = "00000000-0000-0000-0000-000000000001"
 migrations_dir = "migrations/d1/catalog"
 
 [[d1_databases]]
 binding = "IMMI_ACCOUNT_DB"
 database_name = "immi-account"
 database_id = "00000000-0000-0000-0000-000000000002"
 migrations_dir = "migrations/d1/account"
 
 [[d1_databases]]
 binding = "IMMI_OPS_DB"
 database_name = "immi-ops"
 database_id = "00000000-0000-0000-0000-000000000003"
 migrations_dir = "migrations/d1/ops"
 
 [[r2_buckets]]
 binding = "IMMI_CONTENT"
 bucket_name = "immi-content"
 
 [[vectorize]]
 binding = "CASE_VECTORS"
 index_name = "case-vectors"
 
 [[kv_namespaces]]
 binding = "PIPELINE_KV"
 id = "00000000-0000-0000-0000-000000000004"
 
 [ai]
 binding = "AI"
 
 [[durable_objects.bindings]]
 name = "AUTH_NONCE"
 class_name = "AuthNonce"
 
 [[durable_objects.bindings]]
 name = "COUNCIL_SESSION"
 class_name = "CouncilSessionDO"
 
 [[migrations]]
 tag = "cloudflare-native-v1"
 new_sqlite_classes = ["AuthNonce", "CouncilSessionDO"]
 
 [[queues.producers]]
 binding = "CASE_MUTATION_QUEUE"
 queue = "immi-case-mutation-queue"
 
 [[queues.producers]]
 binding = "PIPELINE_CONTROL_QUEUE"
 queue = "immi-pipeline-control-queue"
 
 [[queues.consumers]]
 queue = "immi-case-mutation-queue"
 max_batch_size = 20
 max_batch_timeout = 5
 max_retries = 5
 dead_letter_queue = "immi-case-mutation-dlq"
 
 [[queues.consumers]]
 queue = "immi-case-mutation-dlq"
 max_batch_size = 20
 max_batch_timeout = 5
 max_retries = 3
 
 [[routes]]
 pattern = "immi.trackit.today"
 custom_domain = true
 
 [vars]
 AUTH_ENABLED = "true"
 IMMI_STORAGE_MODE = "cloudflare"
 IMMI_CASE_MUTATIONS_ENABLED = "false"
 CUTOVER_WRITE_FREEZE = "false"
 # Minimum seconds between coalesced analytics rebuilds (see [triggers]).
 AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
 # Safety valve: if the cron trigger is missing or failing, the queue path still
 # refreshes aggregates, at most once per this window (never leaves the
 # dashboard frozen forever).
 AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
+# Quiet window: rebuild only after mutations have stopped for this long, so a
+# bulk import costs one rebuild instead of one per interval (~$28 -> ~$0.58).
+AGGREGATE_REBUILD_QUIET_SECONDS = "300"
+# Hard bound on staleness while mutations never pause (default 6 hours).
+AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
 
 # Coalesced analytics rebuild: the mutation queue only marks aggregates dirty,
 # and this cron performs at most one full rebuild per
 # AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
 # queue consumer again — one rebuild clears and rewrites 17 summary tables
 # (~584k written rows), and per-batch rebuilds produced a ~$12k D1 bill.
 [triggers]
 crons = ["*/5 * * * *"]
 
 # Operator-set secrets only; values never belong in this file:
 # CSRF_SECRET, JWT_SECRET_CURRENT, JWT_SECRET_PREVIOUS, JWT_KID_CURRENT,
 # JWT_KID_PREVIOUS, TELEGRAM_BOT_TOKEN, CF_AIG_TOKEN

hook: PostToolUse
hook: PostToolUse Completed
**Running git diff filename list**
exec
/bin/zsh -c 'git diff --name-only 30999fb e30f910' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1392ms:
2026-09-11 02:52:44.876 xcodebuild[13619:137122888]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 02:52:45.003 xcodebuild[13619:137122887] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-8JGHPDgH' (errno=Operation not permitted)
2026-09-11 02:52:45.386 xcodebuild[13673:137123178]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-11 02:52:45.529 xcodebuild[13673:137123140] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
.claude/STATE.md
config/wrangler-cloudflare-native.toml.example
docs/ops/aggregate-rebuild-cost-guard.md
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
workers/__tests__/cloudflare-native-queue.test.js
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
workers/cloudflare-native.js
workers/storage/cloudflare.js
wrangler.toml

hook: PostToolUse
hook: PostToolUse Completed
**Planning precise git diff extraction**
**Starting identifier search**
exec
/bin/zsh -c 'grep -n -E "rebuildDecisionParams|markAggregatesDirty|aggregatesNeedRebuild|rebuild_dirty_since|rebuild_last_mutation_at|AGGREGATE_REBUILD_(QUIET|MAX_STALENESS)" workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-native-scheduled-rebuild.test.js config/wrangler-cloudflare-native.toml.example wrangler.toml docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/cloudflare-native.js:150:function rebuildDecisionParams(env, minIntervalSeconds) {
workers/cloudflare-native.js:153:    quietSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_QUIET_SECONDS, DEFAULT_QUIET_SECONDS),
workers/cloudflare-native.js:154:    maxStalenessSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_MAX_STALENESS_SECONDS, DEFAULT_MAX_STALENESS_SECONDS),
workers/cloudflare-native.js:199:  const decision = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
workers/cloudflare-native.js:227:  await stores.caseStore.markAggregatesDirty();
workers/cloudflare-native.js:232:  const fallback = await stores.caseStore.aggregatesNeedRebuild(rebuildDecisionParams(env, minIntervalSeconds));
workers/storage/cloudflare.js:56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
workers/storage/cloudflare.js:1009:   * work only marks the aggregates dirty (markAggregatesDirty) and the
workers/storage/cloudflare.js:1011:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
workers/storage/cloudflare.js:1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
workers/storage/cloudflare.js:1133:  async markAggregatesDirty() {
workers/storage/cloudflare.js:1143:        VALUES ('rebuild_last_mutation_at', ?, ?)
workers/storage/cloudflare.js:1149:        VALUES ('rebuild_dirty_since', ?, ?)
workers/storage/cloudflare.js:1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
workers/storage/cloudflare.js:1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
workers/storage/cloudflare.js:1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
workers/storage/cloudflare.js:1214:      const lastMutationAt = state.get("rebuild_last_mutation_at") || 0;
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:59:  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:71:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:87:    await createCloudflareStores(value).caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:89:    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:102:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:112:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:122:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:130:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:142:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:150:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:158:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:168:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:180:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:188:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:199:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:312:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:316:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
workers/__tests__/cloudflare-native-queue.test.js:30:      markAggregatesDirty: vi.fn(async () => true),
workers/__tests__/cloudflare-native-queue.test.js:31:      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
workers/__tests__/cloudflare-native-queue.test.js:87:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:122:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:136:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:144:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-native-queue.test.js:150:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:151:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-native-queue.test.js:164:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-native-queue.test.js:170:    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
workers/__tests__/cloudflare-native-queue.test.js:190:      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
workers/__tests__/cloudflare-native-queue.test.js:191:      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
workers/__tests__/cloudflare-native-queue.test.js:194:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
workers/__tests__/cloudflare-native-queue.test.js:209:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:17:      aggregatesNeedRebuild: vi.fn(async () => decision),
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:19:      markAggregatesDirty: vi.fn(async () => true),
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:35:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:76:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:84:      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:115:      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:116:      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:119:    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
config/wrangler-cloudflare-native.toml.example:63:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
config/wrangler-cloudflare-native.toml.example:65:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
wrangler.toml:102:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
wrangler.toml:104:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:49:| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
docs/ops/aggregate-rebuild-cost-guard.md:50:| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the *current* batch of pending work first appeared; armed only on the clean→dirty edge and reset by every rebuild, so it bounds total staleness |
docs/ops/aggregate-rebuild-cost-guard.md:84:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
docs/ops/aggregate-rebuild-cost-guard.md:92:| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (≤ 4 rebuilds/day ≈ $2.30 at the 6 h default) |
docs/ops/aggregate-rebuild-cost-guard.md:102:`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
docs/ops/aggregate-rebuild-cost-guard.md:108:The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
docs/ops/aggregate-rebuild-cost-guard.md:126:- `AGGREGATE_REBUILD_QUIET_SECONDS` (default 300) — the quiet window described
docs/ops/aggregate-rebuild-cost-guard.md:128:- `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600) — the upper bound on
docs/ops/aggregate-rebuild-cost-guard.md:188:- [ ] During a bulk import, `rebuild_dirty_since` stays armed and

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing atomicity of multi-step writes**
exec
/bin/zsh -c "sed -n '1,260p' workers/cloudflare-native.js
sed -n '35,65p' workers/storage/cloudflare.js
sed -n '995,1230p' workers/storage/cloudflare.js
sed -n '60,220p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
sed -n '330,375p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
/**
 * Standalone IMMI Cloudflare-native Worker entrypoint.
 *
 * It intentionally does not import the legacy proxy, Flask container, or
 * postgres.js. This entrypoint cannot be deployed until the route-manifest,
 * import reconciliation, privacy, shadow, and rollback gates are all green.
 */

import { dispatchCloudflareCaseRead } from "./case-api/cloudflare.js";
import { dispatchCloudflareCouncil } from "./llm-council/cloudflare_handlers.js";
import {
  handleTelegramLogin,
  handleTelegramCallback,
  handleBootstrapLogin,
  handleAuthMe,
  handleAuthLogout,
  handleAuthRefresh,
  handleAuthSwitchTenant,
} from "./auth/cloudflare_handlers.js";
import { getStorageMode } from "./storage/contracts.js";
import { handleAdminPipelineRuns } from "./admin/cloudflare_handlers.js";
import { getCsrfToken } from "./auth/csrf.js";
import { dispatchCloudflareCaseAction } from "./case-api/cloudflare_actions.js";
import { dispatchCloudflareCaseMutation } from "./case-api/cloudflare_mutations.js";
import { createCloudflareStores } from "./storage/cloudflare.js";
import { sha256Hex, VECTOR_DIMENSIONS, StorageBoundaryError } from "./storage/contracts.js";
import { coordinateExtractedCase } from "./storage/pipeline_coordinator.js";
import { handleJobStatus, handlePipelineStatus } from "./pipeline/cloudflare_handlers.js";
import { dispatchCloudflarePipelineControl } from "./pipeline/control_handlers.js";

export { AuthNonce } from "./auth/nonce_do.js";
export { CouncilSessionDO } from "./llm-council/session_do.js";

async function processCaseReindex(message, stores) {
  const event = message?.body;
  if (!event || event.kind !== "case.reindex" || typeof event.case_id !== "string") {
    return false;
  }
  const current = await stores.caseStore.getCase(event.case_id);
  if (!current) {
    await stores.semanticIndex.deleteCase(event.case_id);
    return true;
  }
  const text = await stores.objectStore.getVerifiedText({
    key: event.content_key,
    sha256: event.content_sha256,
    size: event.content_size,
    contentType: event.content_type || "text/plain; charset=utf-8",
  });
  const embedding = await stores.semanticIndex.embed(text || `${current.title} ${current.citation}`.trim());
  if (!Array.isArray(embedding) || embedding.length !== VECTOR_DIMENSIONS) {
    throw new StorageBoundaryError("Reindex embedding dimensions are invalid", { code: "embedding_shape_invalid", status: 503 });
  }
  const mutation = await stores.semanticIndex.upsertCase(event.case_id, embedding, {
    court_code: String(current.court_code || ""),
    ...(Number.isInteger(current.year) ? { year: current.year } : {}),
    source: String(current.source || ""),
    visa_subclass: String(current.visa_subclass || ""),
  });
  await stores.caseStore.markSemanticReady(event.case_id, mutation?.mutationId || null);
  return true;
}

async function processAggregateRebuild(message) {
  const event = message?.body;
  if (!event || event.kind !== "catalog.rebuild") return false;
  return true;
}

async function processCaseSourceDelete(message, stores) {
  const event = message?.body;
  if (!event || event.kind !== "case.source.delete") return false;
  await stores.objectStore.deleteVerified({
    key: event.content_key,
    sha256: event.content_sha256,
    size: event.content_size,
    contentType: event.content_type || "text/plain; charset=utf-8",
  }, { prefix: "cases" });
  return true;
}

async function processCaseExtracted(message, env) {
  const event = message?.body;
  if (!event || event.kind !== "case.extracted") return false;
  const stores = createCloudflareStores(env);
  const payload = await stores.objectStore.getVerifiedJson({
    key: event.payload_key,
    sha256: event.payload_sha256,
    size: event.payload_size,
    contentType: event.payload_content_type || "application/json",
  }, { prefix: "pipeline", maxBytes: 16 * 1024 * 1024, label: "Pipeline extraction payload" });
  if (!payload || typeof payload !== "object") throw new StorageBoundaryError("Pipeline extraction payload is invalid", { code: "pipeline_payload_invalid", status: 503 });
  await coordinateExtractedCase({
    env,
    eventId: event.event_id,
    runId: event.run_id,
    record: payload.record,
    canonicalText: payload.canonicalText,
    audit: payload.audit,
  });
  return true;
}

async function handleCaseMutationQueue(batch, env) {
  const messages = batch?.messages || [];
  const stores = createCloudflareStores(env);
  try {
    let changed = false;
    for (const message of messages) {
      if (await processCaseExtracted(message, env)) {
        changed = true;
      } else if (await processCaseReindex(message, stores)) {
        changed = true;
      } else if (await processCaseSourceDelete(message, stores)) {
        changed = true;
      } else if (await processAggregateRebuild(message)) {
        changed = true;
      }
    }
    // Never rebuild on the happy path: one rebuild clears and rewrites 17
    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
    if (changed) await markStaleAndMaybeRebuild(stores, env);
    for (const message of messages) if (typeof message?.ack === "function") message.ack();
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
  const result = await rebuildUnderLease(stores, env);
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
  const result = await rebuildUnderLease(stores, env);
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

function requireD1(binding, name) {
  if (!binding || typeof binding.prepare !== "function") {
    throw new StorageBoundaryError(`${name} D1 binding is unavailable`, {
      code: "missing_cloudflare_binding",
      status: 503,
    });
  }
  return binding;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

// catalog_summary doubles as the aggregate-rebuild control table. Its
// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
// mid-rebuild still leaves a pending generation behind.
const AGGREGATE_BOOKKEEPING_KEYS = [
  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
  "rebuild_last_attempt_at", "rebuild_lease_until",
  "rebuild_last_mutation_at", "rebuild_dirty_since",
];

// The rebuild lease keeps its fencing token in the `updated_at` column of the
// SAME row that holds the expiry, so claiming, renewing and releasing are each
// a single atomic statement: a token captured in one column and an expiry in
// another could otherwise be read in a torn state by an expiring holder.
function leaseToken() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
      const values = new Set(String(row.tags || "").split(",").map((value) => value.trim()).filter(Boolean));
      values.add(tag.trim());
      return this.db.prepare("UPDATE cases SET tags = ?, semantic_ready = 0, vector_mutation_id = NULL, updated_at = ? WHERE case_id = ?")
        .bind([...values].sort().join(", "), utcNow(), row.case_id);
    });
    if (updates.length) await this.db.batch(updates);
    return updates.length;
  }

  /**
   * Rebuild queue-maintained analytics outside the request path.
   *
   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
   * the whole `cases` table, so it must never run once per queue batch. Queue
   * work only marks the aggregates dirty (markAggregatesDirty) and the
   * scheduled handler coalesces those marks into at most one rebuild per
   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
   * $12,060 in D1 write charges.
   */
  async rebuildAggregates({ lease } = {}) {
    const now = utcNow();
    // Snapshot the pending generation before scanning: anything that arrives
    // while this rebuild runs must stay pending, not be marked applied.
    const state = await this.readAggregateState();
    const appliedGeneration = state.get("rebuild_generation") || 0;
    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
    const statements = [];
    for (const table of [
      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
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
      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
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
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_generation', 1, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
      .bind(stamp).run();
    // When the last mutation happened: the scheduled rebuild waits for a quiet
    // window so a long bulk import costs one rebuild, not one per interval.
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_last_mutation_at', ?, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at`)
      .bind(now, stamp).run();
    // When the pending work first appeared: bounds how stale analytics may get
    // while mutations keep arriving without a quiet gap.
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_dirty_since', ?, ?)
      ON CONFLICT(summary_key) DO UPDATE SET
        value_int = CASE WHEN catalog_summary.value_int = 0 THEN excluded.value_int ELSE catalog_summary.value_int END,
        updated_at = excluded.updated_at`)
      .bind(now, stamp).run();
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
    if (elapsedSeconds < interval) {
      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
    }

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
  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
  return rows;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("Catalog aggregate rebuild guard", () => {
  it("records staleness as a monotonic generation, not a boolean", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    // Three rows: the generation counter, the mutation timestamp and the
    // staleness clock (which only arms when it is currently zero).
    expect(catalog.prepared).toHaveLength(3);
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

    expect(catalog.batch).not.toHaveBeenCalled();
    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
  });

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
    // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
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
      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
    expect(Number(applied.params[0])).toBe(7);
    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
    expect(resetDirtySince).toBeDefined();
    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
  });

  it("batches the rebuild statements in bounded chunks", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();


hook: PostToolUse
hook: PostToolUse Completed
**Identifying snapshot rebuild and dirtySince inconsistency**
**Planning conditional dirtySince reset by generation**
**Examining initial dirtySince key creation and crash timing**
**Confirming D1 batch transactional behavior**
**Identifying max staleness bound violation risk**
**Evaluating retry rate limit versus staleness trade-off**
**Inspecting scheduled rebuild error handling**
exec
/bin/zsh -c "sed -n '220,520p' workers/cloudflare-native.js
sed -n '220,390p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
sed -n '1,235p' workers/__tests__/cloudflare-native-queue.test.js
sed -n '1,150p' workers/__tests__/cloudflare-native-scheduled-rebuild.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
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
  const result = await rebuildUnderLease(stores, env);
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
    } catch (err) {
      return unavailable("Cloudflare-native runtime is misconfigured", "invalid_storage_mode");
    }
    if (mode !== "cloudflare") {
      return unavailable("Cloudflare-native runtime requires IMMI_STORAGE_MODE=cloudflare", "cloudflare_mode_required");
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", worker: "immi-case", layer: "edge+cloudflare-native" });
    }
    if (path === "/api/v1/csrf-token" && request.method === "GET") return getCsrfToken(env);
    const auth = await dispatchAuth(request, env, path, request.method);
    if (auth !== null) return auth;
    const action = await dispatchCloudflareCaseAction(request, path, env);
    if (action !== null) return action;
    const pipelineControl = await dispatchCloudflarePipelineControl(request, path, env);
    if (pipelineControl !== null) return pipelineControl;
    const mutation = await dispatchCloudflareCaseMutation(request, path, env);
    if (mutation !== null) return mutation;
    if (path === "/api/v1/admin/pipeline-runs" && request.method === "GET") {
      return handleAdminPipelineRuns(request, env, url);
    }
    if (path === "/api/v1/job-status" && request.method === "GET") return handleJobStatus(env);
    if (path === "/api/v1/pipeline-status" && request.method === "GET") return handlePipelineStatus(env);
    const council = await dispatchCloudflareCouncil(request, env, path, request.method, ctx);
    if (council !== null) return council;
    if (request.method === "GET") {
      const response = await dispatchCloudflareCaseRead(url, path, env);
      if (response !== null) return response;
    }
    if (path.startsWith("/api/")) {
      return unavailable("This API route is not yet available in the Cloudflare-native runtime");
    }
    if (env.ASSETS) {
      try {
        return await env.ASSETS.fetch(request);
      } catch (err) {
        // fall through to unavailable when the ASSETS binding is misconfigured
      }
    }
    return unavailable("This API route is not yet available in the Cloudflare-native runtime");
  },
};
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

    expect(catalog.prepared.some((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"))).toBe(false);
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
    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
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
      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
    expect(Number(applied.params[0])).toBe(7);
    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
    expect(resetDirtySince).toBeDefined();
    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
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
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
const mockCoordinate = vi.fn(async () => ({ status: "completed" }));
vi.mock("../storage/pipeline_coordinator.js", () => ({
  coordinateExtractedCase: (...args) => mockCoordinate(...args),
  splitFtsChunks: (text) => [text],
}));

import worker from "../cloudflare-native.js";

function stores() {
  return {
    objectStore: {
      putVerified: vi.fn(async ({ key, body, contentType }) => ({
        key,
        sha256: "b".repeat(64),
        size: new TextEncoder().encode(body).byteLength,
        contentType,
      })),
      getVerifiedText: vi.fn(async () => "canonical case text"),
      deleteVerified: vi.fn(async () => undefined),
    },
    caseStore: {
      getCase: vi.fn(async () => ({ case_id: "0123456789ab", title: "Example", citation: "[2026] FCA 1", court_code: "FCA", year: 2026, source: "austlii", visa_subclass: "482" })),
      markSemanticReady: vi.fn(async () => undefined),
      markAggregatesDirty: vi.fn(async () => true),
      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
      claimRebuildLease: vi.fn(async () => ({ token: "queue-lease", leaseSeconds: 900 })),
      releaseRebuildLease: vi.fn(async () => true),
      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
    },
    semanticIndex: {
      embed: vi.fn(async () => Array(1024).fill(0)),
      upsertCase: vi.fn(async () => ({ mutationId: "mutation-1" })),
      deleteCase: vi.fn(async () => undefined),
    },
    pipelineStore: {
      recordDeadLetter: vi.fn(async () => undefined),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Cloudflare-native case mutation queue", () => {
  it("records a case mutation dead-letter payload in R2 and Ops D1", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: { kind: "case.reindex", event_id: "case.reindex:abc" },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ queue: "immi-case-mutation-dlq", messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.putVerified).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^imports\/dlq\/immi-case-mutation-dlq\//),
      contentType: "application/json",
    }));
    expect(current.pipelineStore.recordDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "case.reindex:abc",
      outboxEventId: "case.reindex:abc",
      reason: "queue:immi-case-mutation-dlq",
    }));
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("verifies the R2 pointer before re-embedding and marks semantic-ready", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.reindex", case_id: "0123456789ab", content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
        content_sha256: "a".repeat(64), content_size: 20, content_type: "text/plain; charset=utf-8",
      },
      ack: vi.fn(), retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({ contentType: "text/plain; charset=utf-8" }));
    expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith("0123456789ab", expect.any(Array), expect.objectContaining({ court_code: "FCA", year: 2026 }));
    expect(current.caseStore.markSemanticReady).toHaveBeenCalledWith("0123456789ab", "mutation-1");
    // A queue batch must never pay for a full rebuild; it only flags staleness.
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries when the verified source or embedding fails", async () => {
    const current = stores();
    current.objectStore.getVerifiedText.mockRejectedValue(new Error("checksum mismatch"));
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("hands pointer-addressed extraction payloads to the storage coordinator", async () => {
    const current = stores();
    current.objectStore.getVerifiedJson = vi.fn(async () => ({
      record: { case_id: "0123456789ab", title: "Example" },
      canonicalText: "canonical text",
      audit: [],
    }));
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.extracted", event_id: "case.extracted:run:0123456789ab", run_id: "run",
        payload_key: "pipeline/run/0123456789ab.json", payload_sha256: "a".repeat(64), payload_size: 100,
        payload_content_type: "application/json",
      },
      ack: vi.fn(), retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({ key: message.body.payload_key }), expect.objectContaining({ prefix: "pipeline" }));
    expect(mockCoordinate).toHaveBeenCalledWith(expect.objectContaining({ eventId: message.body.event_id, runId: "run", canonicalText: "canonical text" }));
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("flags catalog aggregates as stale for a mutation-triggered refresh event", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("uses the fallback rebuild only when the cron path has gone quiet", async () => {
    const current = stores();
    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });

    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800, quietSeconds: 300, maxStalenessSeconds: 21600 });
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
  });

  it("defaults the fallback window to an hour when unset", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600, quietSeconds: 300, maxStalenessSeconds: 21600 });
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
  });

  it("does not rebuild from the queue path when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
    current.caseStore.claimRebuildLease.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("honours the configured quiet window and staleness bound", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, {
      IMMI_STORAGE_MODE: "cloudflare",
      AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800",
      AGGREGATE_REBUILD_QUIET_SECONDS: "900",
      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "43200",
    });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
      minIntervalSeconds: 1800, quietSeconds: 900, maxStalenessSeconds: 43200,
    });
  });

  it("coalesces many mutations in one batch into a single stale flag", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const messages = Array.from({ length: 20 }, (_, index) => ({
      body: { kind: "case.reindex", case_id: "0123456789ab", event_id: `case.reindex:${index}` },
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    await worker.queue({ messages }, { IMMI_STORAGE_MODE: "cloudflare" });
    // 20 mutations used to mean one 584k-row rebuild; now they mean one row.
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
  });

  it("deletes a case source only through its validated R2 pointer", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.source.delete",
        case_id: "0123456789ab",
        content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
        content_sha256: "a".repeat(64),
        content_size: 20,
        content_type: "text/plain; charset=utf-8",
      },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.deleteVerified).toHaveBeenCalledWith(
      expect.objectContaining({ key: message.body.content_key, sha256: message.body.content_sha256 }),
      { prefix: "cases" },
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
vi.mock("../storage/pipeline_coordinator.js", () => ({
  coordinateExtractedCase: vi.fn(async () => ({ status: "completed" })),
  splitFtsChunks: (text) => [text],
}));

import worker from "../cloudflare-native.js";

function stores(decision = { due: true, reason: "dirty" }) {
  return {
    caseStore: {
      aggregatesNeedRebuild: vi.fn(async () => decision),
      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
      markAggregatesDirty: vi.fn(async () => true),
      claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
      releaseRebuildLease: vi.fn(async () => true),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Cloudflare-native scheduled aggregate rebuild", () => {
  it("rebuilds once when the aggregates are dirty", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({ cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "cron-lease", leaseSeconds: 900 } });
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
    expect(result).toMatchObject({ due: true, rebuilt_at: "2026-09-10T00:00:00.000Z" });
  });

  it("does not rebuild while the interval is still debouncing", async () => {
    const current = stores({ due: false, reason: "debounced", seconds_until_due: 120 });
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: false, reason: "debounced" });
  });

  it("does not rebuild when nothing changed", async () => {
    const current = stores({ due: false, reason: "clean" });
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
  });

  it("honours the configured lease length", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_LEASE_SECONDS: "1800" });

    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 1800 });
  });

  it("honours the configured minimum interval", async () => {
    const current = stores({ due: false, reason: "debounced", seconds_until_due: 30 });
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: "600" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
  });

  it("falls back to the default interval when the variable is missing or invalid", async () => {
    for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
      const current = stores({ due: false, reason: "debounced" });
      mockCreateStores.mockReturnValue(current);
      await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
    }
  });

  it("skips the rebuild when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.claimRebuildLease.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: "lease_held" });
  });

  it("releases the lease even when the rebuild fails", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
  });

  it("reads the quiet window and staleness bound from the environment", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, {
      IMMI_STORAGE_MODE: "cloudflare",
      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
    });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
      minIntervalSeconds: 300, quietSeconds: 120, maxStalenessSeconds: 7200,
    });
  });

  it("reports a quiet-window deferral instead of rebuilding", async () => {
    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
  });

  it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
  });
});

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing mutation timestamp concurrency issue**
**Evaluating dirtySince concurrency staleness risk**
**Proposing atomic last_mutation update strategy**
**Planning batch transaction ordering**
**Fixing rebuild reset race condition**
**Verifying batch promise error handling**
**Validating write cost estimates**
**Identifying minor documentation cost inaccuracies**
**Assessing staleness handling tests**
**Verifying test coverage for staleness invariants**
**Planning repository-wide grep for mutation tests**
exec
/bin/zsh -c "grep -R -n -E \"staleness clock arms|first mutation only|quiet window|staleness bound|max-staleness|awaiting-quiet|dirty_since\" workers/__tests__ | head -250
grep -n -E \"AGGREGATE_REBUILD|crons\" config/wrangler-cloudflare-native.toml.example
grep -n -E \"one row|1–2 rows|\\"'$0'"\\.58|one rebuild|two .*vars|four .*vars\" docs/ops/aggregate-rebuild-cost-guard.md" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/__tests__/cloudflare-native-queue.test.js:182:  it("honours the configured quiet window and staleness bound", async () => {
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:109:  it("reads the quiet window and staleness bound from the environment", async () => {
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:125:    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js:131:    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:60:  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:90:    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164:  it("waits for a quiet window before rebuilding", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:171:    expect(decision.reason).toBe("awaiting-quiet");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:184:  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:191:    expect(decision.reason).toBe("max-staleness");
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:195:  it("keeps the legacy behaviour when no quiet window is configured", async () => {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:331:    // + 3 bookkeeping rows (applied generation, last rebuild, dirty_since reset).
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:360:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_dirty_since'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:366:    expect(resetDirtySince.sql).toMatch(/SELECT 'rebuild_dirty_since', 0/);
56:AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
60:AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
63:AGGREGATE_REBUILD_QUIET_SECONDS = "300"
65:AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
69:# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
73:crons = ["*/5 * * * *"]
30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
90:| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
103:**one rebuild (~$0.58)** because the pending work accumulates while the import
144:   (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
208:   by leaving the fallback in place — it is bounded at one rebuild per

hook: PostToolUse
hook: PostToolUse Completed
**Deciding verdict on command usage**
**Summarizing high-severity findings and fixes**
**Assessing robustness of rebuild_dirty_since handling**
**Designing atomic mutation handling**
**Evaluating staleness severity impact**
**Refining staleness retry logic**
**Designing failure throttle with debounced ordering**
**Assessing log distinguishability for failure states**
**Analyzing elapsed time calculation in logs**
**Flagging indistinguishable pipeline errors in logs**
**Identifying missing functional test for ordering invariant**
**Flagging low-risk test gap for mutation timing**
**Clarifying test results and fix scope**
**Citing exact code and test line ranges**
exec
/bin/zsh -c "grep -n -E 'it\\(\"(stamps the mutation|waits for a quiet|forces a rebuild|records the generation|keeps the bookkeeping)' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
grep -n -E 'if \\(elapsedSeconds < interval\\)|maxStaleness|INSERT OR REPLACE INTO catalog_summary|rebuild_dirty_since|DELETE FROM catalog_summary WHERE' workers/storage/cloudflare.js
grep -n -E 'aggregate_rebuild_skipped|aggregate_rebuild_completed|handleScheduledRebuild' workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
83:  it("stamps the mutation time and arms the staleness clock", async () => {
164:  it("waits for a quiet window before rebuilding", async () => {
184:  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
335:  it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
347:  it("records the generation observed before the scan, not a bare clean flag", async () => {
56:  "rebuild_last_mutation_at", "rebuild_dirty_since",
1031:        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
1104:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
1106:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
1108:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
1109:        SELECT 'rebuild_dirty_since', 0, ?`).bind(now),
1149:        VALUES ('rebuild_dirty_since', ?, ?)
1162:                              'rebuild_last_mutation_at', 'rebuild_dirty_since')`,
1173:  async aggregatesNeedRebuild({ minIntervalSeconds = 300, quietSeconds = 0, maxStalenessSeconds = 0 } = {}) {
1177:    const maxStaleness = Number.isFinite(maxStalenessSeconds) && maxStalenessSeconds > 0
1178:      ? Math.floor(maxStalenessSeconds) : 0;
1192:    if (elapsedSeconds < interval) {
1196:    const dirtySince = state.get("rebuild_dirty_since") || 0;
1207:    if (maxStaleness > 0 && staleness >= maxStaleness) {
1251:    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
193:async function handleScheduledRebuild(env) {
201:    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
208:    event: "cloudflare.aggregate_rebuild_completed",
309:    return handleScheduledRebuild(env);

hook: PostToolUse
hook: PostToolUse Completed
**Verifying bookkeeping keys exclusion**
**Identifying test coverage gap for new keys**
**Clarifying area findings and clean status**
**Detailing concurrency race conditions**
**Analyzing timing impact on mutation rebuilds**
**Analyzing concurrency impact on rebuild frequency**
**Designing atomic batch update for D1 writes**
**Evaluating single-statement multi-upsert feasibility**
**Designing structured logging improvements**
**Ranking concurrency and logging issues**
**Identifying logging gaps in runtime failures**
**Highlighting missing key tests**
**Confirming low test coverage gap**
codex
- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。

- `workers/storage/cloudflare.js:1133-1155` — **MEDIUM**：三個獨立 `await` 可被不同 isolate 交錯。較早 mutation 暫停後，可能在較晚 mutation 完成後以較舊的 epoch 覆寫 `rebuild_last_mutation_at`，使 quiet window 過早到期；dirty clock 也可能從較晚的寫入開始。修正：以單一 D1 transaction/batch 原子提交三筆控制列，並令 mutation timestamp 使用單調 `MAX(existing, excluded)` 更新。

- `workers/storage/cloudflare.js:1192-1207` — **MEDIUM**：`debounced` 在 `max-staleness` 前返回。一次失敗 rebuild 剛寫入 `rebuild_last_attempt_at` 時，即使 dirty work 已超過 max staleness，仍可再被 interval 延後；若 interval 被設得比 bound 大，違反的時間更長。修正：先檢查 max staleness，或將 debounce 等待時間限制為距離 staleness deadline 的剩餘時間。

- `workers/cloudflare-native.js:201-214` — **LOW**：正常等待會留下帶 `reason` 的 `cloudflare.aggregate_rebuild_skipped`，但 rebuild failure 沒有同等的結構化失敗事件；後續 `debounced` 記錄難以和成功後的正常 debounce 區分。修正：捕捉、記錄含 decision、generation、dirty age 與 error 的 `cloudflare.aggregate_rebuild_failed` 後再拋出。

- `docs/ops/aggregate-rebuild-cost-guard.md:30,90,103` — **LOW**：文件仍稱 dirty mark 是「one row」或「1–2 rows」，實作是三筆 D1 writes。7,700 queue batches 約增加 23,100 writes，約 $0.023；完整 import 約為 $0.61 而非精確的 $0.58。核心「cents, not dollars」結論不變。修正：改為三筆控制列與約 $0.61 的完整成本說明。

- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。

- 5. **No finding**：quiet window 由 `waits for a quiet window before rebuilding`（`workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164`）覆蓋；bound 由 `forces a rebuild when the staleness bound is exceeded even while mutations continue`（`:184`）覆蓋；arming edge 由 `stamps the mutation time and arms the staleness clock`（`:83`）檢查 `CASE WHEN ... = 0`。但上述 HIGH interleaving 尚無測試。

VERDICT: CHANGES-REQUIRED
tokens used
81,113
- `workers/storage/cloudflare.js:1104-1109` — **HIGH**：rebuild 在快照 generation 後若有新 mutation 已完成三筆 dirty 寫入，最終仍會無條件把 `rebuild_dirty_since` 設為 `0`。generation 會保持 pending，但 staleness clock 被抹除；持續寫入時 quiet window 永遠不滿足，`max-staleness` 也永遠不可達，analytics 可永久不重建。修正：僅當目前 `rebuild_generation` 仍等於快照的 `appliedGeneration` 時才清除 `rebuild_dirty_since`；否則保留它。新增此 interleaving 的回歸測試。

- `workers/storage/cloudflare.js:1133-1155` — **MEDIUM**：三個獨立 `await` 可被不同 isolate 交錯。較早 mutation 暫停後，可能在較晚 mutation 完成後以較舊的 epoch 覆寫 `rebuild_last_mutation_at`，使 quiet window 過早到期；dirty clock 也可能從較晚的寫入開始。修正：以單一 D1 transaction/batch 原子提交三筆控制列，並令 mutation timestamp 使用單調 `MAX(existing, excluded)` 更新。

- `workers/storage/cloudflare.js:1192-1207` — **MEDIUM**：`debounced` 在 `max-staleness` 前返回。一次失敗 rebuild 剛寫入 `rebuild_last_attempt_at` 時，即使 dirty work 已超過 max staleness，仍可再被 interval 延後；若 interval 被設得比 bound 大，違反的時間更長。修正：先檢查 max staleness，或將 debounce 等待時間限制為距離 staleness deadline 的剩餘時間。

- `workers/cloudflare-native.js:201-214` — **LOW**：正常等待會留下帶 `reason` 的 `cloudflare.aggregate_rebuild_skipped`，但 rebuild failure 沒有同等的結構化失敗事件；後續 `debounced` 記錄難以和成功後的正常 debounce 區分。修正：捕捉、記錄含 decision、generation、dirty age 與 error 的 `cloudflare.aggregate_rebuild_failed` 後再拋出。

- `docs/ops/aggregate-rebuild-cost-guard.md:30,90,103` — **LOW**：文件仍稱 dirty mark 是「one row」或「1–2 rows」，實作是三筆 D1 writes。7,700 queue batches 約增加 23,100 writes，約 $0.023；完整 import 約為 $0.61 而非精確的 $0.58。核心「cents, not dollars」結論不變。修正：改為三筆控制列與約 $0.61 的完整成本說明。

- `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:335` — **LOW**：新 keys 確實在 production `AGGREGATE_BOOKKEEPING_KEYS` 中並由 `workers/storage/cloudflare.js:56,1031` 排除於 DELETE；但測試中的 `BOOKKEEPING_KEYS` 未加入兩個新 key，無法防止未來移除它們。修正：將 `rebuild_last_mutation_at`、`rebuild_dirty_since` 加入測試常數。

- 5. **No finding**：quiet window 由 `waits for a quiet window before rebuilding`（`workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164`）覆蓋；bound 由 `forces a rebuild when the staleness bound is exceeded even while mutations continue`（`:184`）覆蓋；arming edge 由 `stamps the mutation time and arms the staleness clock`（`:83`）檢查 `CASE WHEN ... = 0`。但上述 HIGH interleaving 尚無測試。

VERDICT: CHANGES-REQUIRED
