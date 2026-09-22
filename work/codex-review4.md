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
session id: 01a08b2e-d8a5-7203-a249-ca276792db63
--------
user
Fourth (final) pass: confirm the fix is complete. Review only — do not modify anything.

HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files. Read-only commands only (cat, sed -n, git diff, git show, grep). Answer directly, no narration.

Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
Branch: fix/aggregate-rebuild-debounce (commit ed49b15, pushed). Compare against origin/main @ 42826a3.

CONTEXT
The mutation queue used to rebuild 17 summary tables per batch (~584k written rows each); that produced a ~$12,060 D1 bill. The fix coalesces rebuilds behind a cron-driven rebuild, guarded by a D1 lease. Three earlier review passes raised five findings, all now fixed:

1. unconditional `dirty = 0` discarded a mutation landing mid-rebuild → monotonic generation; "dirty" is `rebuild_generation > rebuild_applied_generation`; the rebuild snapshots the generation before scanning and writes it as `rebuild_applied_generation`; the rebuild's `DELETE FROM catalog_summary` keeps the bookkeeping keys.
2. no mutual exclusion → `claimRebuildLease()` conditional upsert; `rebuildAggregates({ lease })` renews before each 20-statement chunk and throws `rebuild_lease_lost` when renewal fails; the worker releases in `finally`.
3. unsafe documented rollback → docs now forbid restoring the per-batch rebuild.
4. lease without fencing / torn claim → the lease row holds expiry in `value_int` and the fencing token in `updated_at`, written by ONE statement; `renewRebuildLease`/`releaseRebuildLease` are token-conditional (`WHERE ... AND updated_at = ?`); a release without a token returns false instead of zeroing unconditionally.
5. failed rebuilds were not throttled → `claimRebuildLease()` stamps `rebuild_last_attempt_at`; `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.

TASK — verify the current code state only, and be decisive about whether it is shippable:
1. Walk the four invariants end to end and say whether each holds now: (a) coalescing (queue never rebuilds on the happy path, at most one rebuild per interval), (b) no lost staleness (generation semantics + bookkeeping keys surviving every write path), (c) mutual exclusion (claim/renew/release are single-statement and token-conditional; abort on lost lease), (d) bounded recovery (attempt throttle + fallback window + cron-debounce).
2. Report only problems you can point at in the current source with file:line. If an earlier finding is genuinely closed, say so in one line each rather than re-litigating it.
3. Explicitly state any residual risk you consider acceptable (with reasoning) — e.g. behaviour during the first deploy, lease expiry mid-rebuild, operator misconfiguration — rather than filing it as a finding.
4. Do not raise style, naming, comment or legacy-layer issues.

ALREADY VERIFIED BY THE AUTHOR (do not re-derive): Worker Vitest 27 files / 380 tests pass; Python suite 1141 passed / 10 skipped; native bundle closure passes; native-config gate output unchanged vs main; a real-SQLite harness replays rebuild, the mid-rebuild mutation race, and lease claim/renew/release with real rowcounts (21/21 checks, including that a stale token cannot free another owner's lease).

Final line exactly one of: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T11:58:18.942710Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:58:19.335359Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T11:58:20.228486Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:58:20.321073Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
codex
我會只用唯讀原始碼與差異檢查，對照指定的四項不變條件；不會載入任何 skill、plugin、MCP、圖譜工具，也不會執行測試或修改檔案。
exec
/bin/zsh -lc 'git status --short --branch && git rev-parse --show-toplevel && git log --oneline --decorate -3 && git diff --stat origin/main...HEAD && git diff --name-only origin/main...HEAD' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 10576ms:
2026-09-10 21:58:29.759 xcodebuild[55423:134476878]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:30.051 xcodebuild[55423:134476877] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-1pZrUtah' (errno=Operation not permitted)
2026-09-10 21:58:30.584 xcodebuild[55474:134477251]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:30.746 xcodebuild[55474:134477250] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## fix/aggregate-rebuild-debounce...origin/fix/aggregate-rebuild-debounce
?? work/
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UPWJ4mnk' (errno=Operation not permitted)
2026-09-10 21:58:31.879 xcodebuild[55498:134477460]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:32.052 xcodebuild[55498:134477457] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-beOy9xLC' (errno=Operation not permitted)
2026-09-10 21:58:32.510 xcodebuild[55504:134477552]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:32.690 xcodebuild[55504:134477551] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
/Volumes/Storm Breaker/Developer/IMMI-Case-
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-peHMNqdC' (errno=Operation not permitted)
2026-09-10 21:58:34.034 xcodebuild[55542:134478094]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:34.333 xcodebuild[55542:134478091] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-9gS2MabK' (errno=Operation not permitted)
2026-09-10 21:58:34.949 xcodebuild[55571:134478383]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:35.130 xcodebuild[55571:134478372] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
ed49b15 (HEAD -> fix/aggregate-rebuild-debounce, origin/fix/aggregate-rebuild-debounce) fix(cloudflare): coalesce aggregate rebuilds behind a scheduled, fenced lease
42826a3 (origin/main, origin/HEAD) chore: untrack the stray agent dirs the first pass missed
9cea3c4 ci: stop ignoring the separation preflight suite
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-erJ6UkPV' (errno=Operation not permitted)
2026-09-10 21:58:36.206 xcodebuild[55602:134478582]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:36.378 xcodebuild[55602:134478578] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Y6Wbkdxl' (errno=Operation not permitted)
2026-09-10 21:58:36.802 xcodebuild[55626:134478678]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:36.934 xcodebuild[55626:134478677] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
 .claude/STATE.md                                   |  63 +++-
 config/wrangler-cloudflare-native.toml.example     |  14 +
 docs/ops/aggregate-rebuild-cost-guard.md           | 170 +++++++++++
 .../cloudflare-aggregate-rebuild-guard.test.js     | 317 +++++++++++++++++++++
 workers/__tests__/cloudflare-native-queue.test.js  |  73 ++++-
 .../cloudflare-native-scheduled-rebuild.test.js    | 116 ++++++++
 workers/cloudflare-native.js                       |  99 ++++++-
 workers/storage/cloudflare.js                      | 170 ++++++++++-
 wrangler.toml                                      |  14 +
 9 files changed, 1022 insertions(+), 14 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-N6pz3yEz' (errno=Operation not permitted)
2026-09-10 21:58:37.853 xcodebuild[55647:134478887]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:37.985 xcodebuild[55647:134478886] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-TDc7H4T1' (errno=Operation not permitted)
2026-09-10 21:58:38.403 xcodebuild[55652:134478925]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:38.547 xcodebuild[55652:134478924] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
.claude/STATE.md
config/wrangler-cloudflare-native.toml.example
docs/ops/aggregate-rebuild-cost-guard.md
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
workers/__tests__/cloudflare-native-queue.test.js
workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
workers/cloudflare-native.js
workers/storage/cloudflare.js
wrangler.toml

**Planning source audit with git diff and grep**
exec
/bin/zsh -lc 'grep -n -E "rebuild|aggregate|catalog_summary|mutation|scheduled|cron|lease|dirty|generation" workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example docs/ops/aggregate-rebuild-cost-guard.md && git diff --find-renames --unified=80 origin/main...HEAD -- workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 2166ms:
2026-09-10 21:58:44.980 xcodebuild[56405:134481261]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:45.136 xcodebuild[56405:134481260] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-im8zZAgC' (errno=Operation not permitted)
2026-09-10 21:58:45.874 xcodebuild[56431:134481467]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:58:46.074 xcodebuild[56431:134481466] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/config/wrangler-cloudflare-native.toml.example b/config/wrangler-cloudflare-native.toml.example
index 310d086..2d12eb6 100644
--- a/config/wrangler-cloudflare-native.toml.example
+++ b/config/wrangler-cloudflare-native.toml.example
@@ -1,78 +1,92 @@
 # Non-deployable operator template for the standalone Cloudflare-native IMMI
 # Worker. It deliberately contains invalid placeholder IDs and no account_id,
 # routes, secrets, Hyperdrive, Supabase or Flask binding. Copy outside source
 # control only after the paid-resource, privacy and staging gates are approved.
 name = "immi-case-standalone"
 main = "workers/cloudflare-native.js"
 compatibility_date = "2026-08-10"
 compatibility_flags = ["nodejs_compat"]
 
 [[d1_databases]]
 binding = "IMMI_CATALOG_DB"
 database_name = "REPLACE_WITH_IMMI_CATALOG_DB"
 database_id = "REPLACE_WITH_TARGET_D1_ID"
 migrations_dir = "migrations/d1/catalog"
 
 [[d1_databases]]
 binding = "IMMI_ACCOUNT_DB"
 database_name = "REPLACE_WITH_IMMI_ACCOUNT_DB"
 database_id = "REPLACE_WITH_TARGET_D1_ID"
 migrations_dir = "migrations/d1/account"
 
 [[d1_databases]]
 binding = "IMMI_OPS_DB"
 database_name = "REPLACE_WITH_IMMI_OPS_DB"
 database_id = "REPLACE_WITH_TARGET_D1_ID"
 migrations_dir = "migrations/d1/ops"
 
 [[r2_buckets]]
 binding = "IMMI_CONTENT"
 bucket_name = "REPLACE_WITH_IMMI_CONTENT_BUCKET"
 
 [[vectorize]]
 binding = "CASE_VECTORS"
 index_name = "REPLACE_WITH_CASE_VECTORS_INDEX"
 
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
 
 [vars]
 AUTH_ENABLED = "true"
 IMMI_STORAGE_MODE = "cloudflare"
 IMMI_CASE_MUTATIONS_ENABLED = "false"
+# Minimum seconds between coalesced analytics rebuilds (see [triggers]).
+AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
+# Safety valve: if the cron trigger is missing or failing, the queue path still
+# refreshes aggregates, at most once per this window (never leaves the
+# dashboard frozen forever).
+AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
+
+# Coalesced analytics rebuild: the mutation queue only marks aggregates dirty,
+# and this cron performs at most one full rebuild per
+# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
+# queue consumer again — one rebuild clears and rewrites 17 summary tables
+# (~584k written rows), and per-batch rebuilds produced a ~$12k D1 bill.
+[triggers]
+crons = ["*/5 * * * *"]
 
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
 dead_letter_queue = "immi-case-mutation-dlq"
 
 [[queues.consumers]]
 queue = "immi-case-mutation-dlq"
 max_batch_size = 20
 max_batch_timeout = 5
 max_retries = 3
 
 # Operator-set secrets only (never write values into this template):
 # CSRF_SECRET, JWT_SECRET_CURRENT, JWT_SECRET_PREVIOUS, JWT_KID_CURRENT,
 # JWT_KID_PREVIOUS, TELEGRAM_BOT_TOKEN, CF_AIG_TOKEN
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index f37b3b0..0464749 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -40,207 +40,304 @@ async function processCaseReindex(message, stores) {
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
-    if (changed) await stores.caseStore.rebuildAggregates();
+    // Never rebuild on the happy path: one rebuild clears and rewrites 17
+    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
+    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
+    if (changed) await markStaleAndMaybeRebuild(stores, env);
     for (const message of messages) if (typeof message?.ack === "function") message.ack();
   } catch (error) {
     console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
     for (const message of messages) {
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
+const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
+const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
+const DEFAULT_REBUILD_LEASE_SECONDS = 900;
+
+function positiveIntOr(value, fallback) {
+  const parsed = Number.parseInt(value ?? "", 10);
+  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
+}
+
+/**
+ * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
+ * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
+ * The lease length is derived from the interval so it always outlives a rebuild
+ * while still expiring on its own if this invocation dies mid-flight.
+ */
+async function rebuildUnderLease(stores, env) {
+  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
+  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
+  if (!lease) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
+    return { skipped: "lease_held" };
+  }
+  try {
+    return await stores.caseStore.rebuildAggregates({ lease });
+  } finally {
+    try {
+      // Token-conditional: if this run outlived its lease, the new owner's
+      // lease is left untouched.
+      await stores.caseStore.releaseRebuildLease({ token: lease.token });
+    } catch (error) {
+      console.error(JSON.stringify({
+        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
+      }));
+    }
+  }
+}
+
+/**
+ * Coalesced analytics rebuild.
+ *
+ * Queue batches only mark the aggregates dirty; this scheduled handler decides
+ * when to pay for the rebuild, so N queue batches cost at most one rebuild per
+ * interval instead of N full rewrites of 17 tables.
+ */
+async function handleScheduledRebuild(env) {
+  const stores = createCloudflareStores(env);
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
+    DEFAULT_REBUILD_INTERVAL_SECONDS,
+  );
+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!decision.due) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
+    return decision;
+  }
+  const startedAt = Date.now();
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return { ...decision, ...result };
+  console.log(JSON.stringify({
+    event: "cloudflare.aggregate_rebuild_completed",
+    reason: decision.reason,
+    min_interval_seconds: minIntervalSeconds,
+    duration_ms: Date.now() - startedAt,
+    rebuilt_at: result?.rebuilt_at ?? null,
+  }));
+  return { ...decision, ...result };
+}
+
+/**
+ * Safety valve for the coalesced rebuild.
+ *
+ * The cron trigger normally performs every rebuild, so the queue path only
+ * records staleness. If that trigger is missing or failing, the flag would
+ * never be drained and every dashboard would freeze silently — so the queue
+ * path still refreshes, at most once per fallback window. With a working cron
+ * the last rebuild is never older than the cron period, and this never fires.
+ */
+async function markStaleAndMaybeRebuild(stores, env) {
+  await stores.caseStore.markAggregatesDirty();
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
+    DEFAULT_FALLBACK_INTERVAL_SECONDS,
+  );
+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!fallback?.due) return false;
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return false;
+  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
+  return true;
+}
+
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
+  async scheduled(event, env) {
+    return handleScheduledRebuild(env);
+  },
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
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index 441eb69..f42d675 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -1,129 +1,147 @@
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
 
+// catalog_summary doubles as the aggregate-rebuild control table. Its
+// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
+// mid-rebuild still leaves a pending generation behind.
+const AGGREGATE_BOOKKEEPING_KEYS = [
+  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
+  "rebuild_last_attempt_at", "rebuild_lease_until",
+];
+
+// The rebuild lease keeps its fencing token in the `updated_at` column of the
+// SAME row that holds the expiry, so claiming, renewing and releasing are each
+// a single atomic statement: a token captured in one column and an expiry in
+// another could otherwise be read in a torn state by an expiring holder.
+function leaseToken() {
+  const uuid = globalThis.crypto?.randomUUID?.();
+  if (uuid) return uuid;
+  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
+}
+
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
 
 const COMPAT_SORT_COLUMNS = Object.freeze({
   date: "c.year",
   title: "c.title",
   court: "c.court_code",
   outcome: "c.outcome",
   visa_subclass_number: "c.visa_subclass_number",
   applicant_name: "c.applicant_name",
   hearing_date: "c.hearing_date",
   case_id: "c.case_id",
   citation: "c.citation",
 });
 
@@ -906,241 +924,379 @@ export class CloudflareCaseStore {
     if (changeCount(result) === 0) {
       throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
     }
     const relationStatements = [];
     if (Object.prototype.hasOwnProperty.call(updates, "judges")) {
       const labels = normaliseRelationLabels(updates.judges, "judge");
       relationStatements.push(this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id));
       for (const label of labels) {
         const judgeId = (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
         relationStatements.push(
           this.db.prepare("INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(judgeId, label, now, now),
           this.db.prepare("INSERT OR IGNORE INTO case_judges (case_id, judge_id) VALUES (?, ?)").bind(id, judgeId),
         );
       }
     }
     if (Object.prototype.hasOwnProperty.call(updates, "legal_concepts")) {
       const labels = normaliseRelationLabels(updates.legal_concepts, "legal concept");
       relationStatements.push(this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id));
       for (const label of labels) {
         const conceptId = (await sha256Hex(`concept:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
         relationStatements.push(
           this.db.prepare("INSERT OR IGNORE INTO concepts (concept_id, label) VALUES (?, ?)").bind(conceptId, label),
           this.db.prepare("INSERT OR IGNORE INTO case_concepts (case_id, concept_id) VALUES (?, ?)").bind(id, conceptId),
         );
       }
     }
     if (relationStatements.length) await this.db.batch(relationStatements);
     return this.getCase(id);
   }
 
   async deleteCase(caseId) {
     const id = assertCaseId(caseId);
     const result = await this.db.batch([
       this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id),
       this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id),
       this.db.prepare("DELETE FROM case_text_chunks WHERE case_id = ?").bind(id),
       this.db.prepare("DELETE FROM cases WHERE case_id = ?").bind(id),
     ]);
     if (changeCount(result[3]) === 0) {
       throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
     }
     return true;
   }
 
   async batchDeleteCases(caseIds) {
     const ids = [...new Set((caseIds || []).map(assertCaseId))];
     if (!ids.length) return 0;
     if (ids.length > 200) throw new StorageBoundaryError("Batch limited to 200 cases", { code: "batch_limit", status: 400 });
     const encoded = JSON.stringify(ids);
     const result = await this.db.batch([
       this.db.prepare("DELETE FROM case_concepts WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
       this.db.prepare("DELETE FROM case_judges WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
       this.db.prepare("DELETE FROM case_text_chunks WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
       this.db.prepare("DELETE FROM cases WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
     ]);
     return changeCount(result[3]);
   }
 
   async batchAddTag(caseIds, tag) {
     const ids = [...new Set((caseIds || []).map(assertCaseId))];
     if (!ids.length) return 0;
     if (ids.length > 200) throw new StorageBoundaryError("Batch limited to 200 cases", { code: "batch_limit", status: 400 });
     if (typeof tag !== "string" || !tag.trim() || tag.length > 64 || /[,<>]/.test(tag)) {
       throw new StorageBoundaryError("Tag is invalid", { code: "invalid_tag", status: 400 });
     }
     const current = rows(await this.db.prepare(`
       SELECT c.case_id, c.tags
       FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
     `).bind(JSON.stringify(ids)).all());
     const updates = current.map((row) => {
       const values = new Set(String(row.tags || "").split(",").map((value) => value.trim()).filter(Boolean));
       values.add(tag.trim());
       return this.db.prepare("UPDATE cases SET tags = ?, semantic_ready = 0, vector_mutation_id = NULL, updated_at = ? WHERE case_id = ?")
         .bind([...values].sort().join(", "), utcNow(), row.case_id);
     });
     if (updates.length) await this.db.batch(updates);
     return updates.length;
   }
 
   /**
-   * Rebuild queue-maintained analytics outside the request path. A mutation
-   * queue batch calls this once after its D1/R2/Vectorize work, so dashboard
-   * reads remain aggregate-only and never scan the corpus.
+   * Rebuild queue-maintained analytics outside the request path.
+   *
+   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
+   * the whole `cases` table, so it must never run once per queue batch. Queue
+   * work only marks the aggregates dirty (markAggregatesDirty) and the
+   * scheduled handler coalesces those marks into at most one rebuild per
+   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
+   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
+   * $12,060 in D1 write charges.
    */
-  async rebuildAggregates() {
+  async rebuildAggregates({ lease } = {}) {
     const now = utcNow();
+    // Snapshot the pending generation before scanning: anything that arrives
+    // while this rebuild runs must stay pending, not be marked applied.
+    const state = await this.readAggregateState();
+    const appliedGeneration = state.get("rebuild_generation") || 0;
+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
     const statements = [];
     for (const table of [
       "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
       "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
       "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
       "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
       "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
-    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
+    ]) {
+      statements.push(table === "catalog_summary"
+        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
+        : this.db.prepare(`DELETE FROM ${table}`));
+    }
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
-    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
-    return { rebuilt_at: now };
+    // Bookkeeping lives in catalog_summary itself (getStats reads only
+    // total_cases/with_full_text, so these keys stay internal). Recording the
+    // generation observed at the start — not a bare dirty=0 — is what keeps a
+    // mid-rebuild mutation pending.
+    statements.push(
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
+    );
+    for (let offset = 0; offset < statements.length; offset += 20) {
+      // While we still own the lease, extend it before each chunk; if another
+      // invocation took over (this run outlived its lease), abort instead of
+      // interleaving DELETEs with it. At most one chunk can overlap.
+      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
+        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
+          code: "rebuild_lease_lost", status: 503,
+        });
+      }
+      await this.db.batch(statements.slice(offset, offset + 20));
+    }
+    return { rebuilt_at: now, applied_generation: appliedGeneration };
+  }
+
+  /**
+   * Mark analytics as stale without paying for a rebuild: one row written per
+   * queue batch instead of clearing and rewriting 17 tables.
+   *
+   * A monotonic generation, not a boolean: a rebuild applies the generation it
+   * observed when it started, so a mutation landing mid-rebuild stays pending
+   * instead of being wiped by the rebuild's own bookkeeping write.
+   */
+  async markAggregatesDirty() {
+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_generation', 1, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
+      .bind(utcNow()).run();
+    return true;
+  }
+
+  async readAggregateState() {
+    const current = rows(await this.db.prepare(
+      `SELECT summary_key, value_int FROM catalog_summary
+        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
+                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
+    ).all());
+    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
+  }
+
+  /**
+   * Rate-limit decision for the scheduled handler: rebuild only when a
+   * generation is pending and the last rebuild is older than the interval.
+   * This is the only guard preventing a bulk import from rewriting the whole
+   * summary set thousands of times.
+   */
+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
+    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
+      ? Math.floor(minIntervalSeconds) : 300;
+    const state = await this.readAggregateState();
+    const pending = state.get("rebuild_generation") || 0;
+    const applied = state.get("rebuild_applied_generation") || 0;
+    if (pending <= applied) return { due: false, reason: "clean" };
+    // Throttle on the last *attempt*, not only the last success: a rebuild that
+    // throws releases its lease without stamping `rebuild_last_at`, and the
+    // 30-second queue retry must not therefore rebuild on every retry.
+    const lastSuccessAt = state.get("rebuild_last_at") || 0;
+    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
+    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
+    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
+    if (elapsedSeconds < interval) {
+      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
+    }
+    return {
+      due: true,
+      reason: "dirty",
+      pending_generation: pending,
+      applied_generation: applied,
+      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
+    };
+  }
+
+  /**
+   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
+   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
+   * interleave their DELETEs. The conditional upsert only writes when the held
+   * lease has expired, so `changes === 1` means this caller won.
+   */
+  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
+    const now = Math.floor(Date.now() / 1000);
+    const lease = Math.max(60, Math.floor(leaseSeconds));
+    const token = leaseToken();
+    // One statement takes the lease, writes its expiry and rotates the token:
+    // a winner cannot be confused with the previous holder, and an expired
+    // holder's token stops matching the moment a new claim lands.
+    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_lease_until', ?, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
+      WHERE catalog_summary.value_int < ?`)
+      .bind(now + lease, token, now).run();
+    if (changeCount(result) === 0) return null;
+    // Throttles retries of a rebuild that failed (a failure never stamps
+    // rebuild_last_at). Losing this write only costs one extra rebuild.
+    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
+    return { token, leaseSeconds: lease };
+  }
+
+  /** Extend the lease, but only while this caller still owns it. */
+  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
+    if (typeof token !== "string" || !token) return false;
+    const lease = Math.max(60, Math.floor(leaseSeconds));
+    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
+        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
+      .bind(Math.floor(Date.now() / 1000) + lease, token, token).run();
+    return changeCount(result) > 0;
+  }
+
+  /** Release the lease — only the token holder can, so an expired run cannot
+   *  free (or extend) a lease that a newer invocation now owns. */
+  async releaseRebuildLease({ token } = {}) {
+    if (typeof token !== "string" || !token) return false;
+    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
+      .bind(utcNow(), token).run();
+    return changeCount(result) > 0;
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
     const { clauses, params } = safeCaseFilters(filters);
     const size = clampLimit(limit, { fallback: 50, max: 100 });
     // bm25() is valid only in the direct FTS query context. Paginate over chunk
     // candidates (a single long case can monopolise the first page) until enough
     // distinct cases are found, then aggregate their best-chunk rank per case.
     const ranks = new Map();
     const CHUNK_PAGE = 100;
     const MAX_PAGES = 5;
     for (let offset = 0; offset < CHUNK_PAGE * MAX_PAGES; offset += CHUNK_PAGE) {
       const hits = rows(await this.db.prepare(`
         SELECT case_id, bm25(case_text_fts) AS rank
         FROM case_text_fts
         WHERE case_text_fts MATCH ?
         ORDER BY rank ASC
         LIMIT ? OFFSET ?
       `).bind(matchString, CHUNK_PAGE, offset).all());
       if (hits.length === 0) break;
       for (const hit of hits) {
         const rank = Number(hit.rank);
         if (!ranks.has(hit.case_id) || rank < ranks.get(hit.case_id)) ranks.set(hit.case_id, rank);
       }
       if (ranks.size >= size) break;
     }
     const caseIds = [...ranks.keys()];
     if (caseIds.length === 0) return [];
     const where = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
     const statement = bindAll(this.db, `
       SELECT ${LEGACY_CASE_PROJECTION}
       FROM cases c
       JOIN json_each(?) candidate_ids ON candidate_ids.value = c.case_id
       WHERE 1 = 1 ${where}
       ORDER BY candidate_ids.key
       LIMIT ?
     `, [JSON.stringify(caseIds), ...params, size]);
     return rows(await statement.all())
       .map((row) => ({ ...row, rank: ranks.get(row.case_id) }))
       .sort((left, right) => left.rank - right.rank || left.case_id.localeCompare(right.case_id));
   }
 
   /**
    * Import metadata only after its R2 object has been uploaded and checksum
    * checked. Text chunks are deliberately bounded below the D1 row guard.
    */
   async putImportedCase({ case: record, sourcePointer, textChunks = [] }) {
     const pointer = assertObjectPointer(sourcePointer, "cases");
     const caseId = assertCaseId(record?.case_id);
diff --git a/wrangler.toml b/wrangler.toml
index 9f71d1f..d03b619 100644
--- a/wrangler.toml
+++ b/wrangler.toml
@@ -14,84 +14,98 @@ compatibility_flags = ["nodejs_compat"]
 [assets]
 directory = "./frontend/dist"
 binding = "ASSETS"
 not_found_handling = "single-page-application"
 
 [[d1_databases]]
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
+# Minimum seconds between coalesced analytics rebuilds (see [triggers]).
+AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
+# Safety valve: if the cron trigger is missing or failing, the queue path still
+# refreshes aggregates, at most once per this window (never leaves the
+# dashboard frozen forever).
+AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
+
+# Coalesced analytics rebuild: the mutation queue only marks aggregates dirty,
+# and this cron performs at most one full rebuild per
+# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
+# queue consumer again — one rebuild clears and rewrites 17 summary tables
+# (~584k written rows), and per-batch rebuilds produced a ~$12k D1 bill.
+[triggers]
+crons = ["*/5 * * * *"]
 
 # Operator-set secrets only; values never belong in this file:
 # CSRF_SECRET, JWT_SECRET_CURRENT, JWT_SECRET_PREVIOUS, JWT_KID_CURRENT,
 # JWT_KID_PREVIOUS, TELEGRAM_BOT_TOKEN, CF_AIG_TOKEN

hook: PostToolUse
hook: PostToolUse Completed
**Planning repository grep for rebuild detection**
exec
/bin/zsh -lc "sed -n '1,235p' workers/cloudflare-native.js && sed -n '1,80p' workers/storage/cloudflare.js && sed -n '990,1235p' workers/storage/cloudflare.js && grep -R -n -E \"rebuildAggregates\\(|markAggregatesDirty\\(|aggregatesNeedRebuild\\(|claimRebuildLease\\(|renewRebuildLease\\(|releaseRebuildLease\\(\" workers --exclude-dir=node_modules --exclude='*.map' && grep -R -n -E \"catalog_summary|rebuild_generation|rebuild_applied_generation|rebuild_last_attempt_at|rebuild_lease_until\" workers --exclude-dir=node_modules --exclude='*.map'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
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

function positiveIntOr(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
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
  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
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
      SELECT c.case_id, c.tags
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `).bind(JSON.stringify(ids)).all());
    const updates = current.map((row) => {
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
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_generation', 1, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
      .bind(utcNow()).run();
    return true;
  }

  async readAggregateState() {
    const current = rows(await this.db.prepare(
      `SELECT summary_key, value_int FROM catalog_summary
        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
    ).all());
    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
  }

  /**
   * Rate-limit decision for the scheduled handler: rebuild only when a
   * generation is pending and the last rebuild is older than the interval.
   * This is the only guard preventing a bulk import from rewriting the whole
   * summary set thousands of times.
   */
  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
      ? Math.floor(minIntervalSeconds) : 300;
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
    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
    if (elapsedSeconds < interval) {
      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
    }
    return {
      due: true,
      reason: "dirty",
      pending_generation: pending,
      applied_generation: applied,
      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
    };
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
workers/cloudflare-native.js:151:  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
workers/cloudflare-native.js:157:    return await stores.caseStore.rebuildAggregates({ lease });
workers/cloudflare-native.js:162:      await stores.caseStore.releaseRebuildLease({ token: lease.token });
workers/cloudflare-native.js:184:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
workers/cloudflare-native.js:212:  await stores.caseStore.markAggregatesDirty();
workers/cloudflare-native.js:217:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
workers/storage/cloudflare.js:1014:  async rebuildAggregates({ lease } = {}) {
workers/storage/cloudflare.js:1112:      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
workers/storage/cloudflare.js:1130:  async markAggregatesDirty() {
workers/storage/cloudflare.js:1153:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
workers/storage/cloudflare.js:1185:  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1206:  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1217:  async releaseRebuildLease({ token } = {}) {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:69:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:83:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:93:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:103:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:111:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:123:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:131:    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:139:    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:147:    await expect(createCloudflareStores(held.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:151:    const lease = await createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:170:    const first = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:171:    const second = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:179:    const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:194:    await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:201:    await expect(createCloudflareStores(owned.value).caseStore.renewRebuildLease({ token: "owner-token", leaseSeconds: 900 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:208:    await expect(createCloudflareStores(lost.value).caseStore.renewRebuildLease({ token: "stale-token", leaseSeconds: 900 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:215:    await createCloudflareStores(value).caseStore.releaseRebuildLease({ token: "owner-token" });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:226:    await expect(stores.caseStore.releaseRebuildLease()).resolves.toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:227:    await expect(stores.caseStore.releaseRebuildLease({ token: "" })).resolves.toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:237:    await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:245:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:254:    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:258:    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:266:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:281:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:294:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:312:    await stores.caseStore.rebuildAggregates();
workers/storage/cloudflare.js:50:// catalog_summary doubles as the aggregate-rebuild control table. Its
workers/storage/cloudflare.js:54:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/storage/cloudflare.js:55:  "rebuild_last_attempt_at", "rebuild_lease_until",
workers/storage/cloudflare.js:792:      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
workers/storage/cloudflare.js:874:      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
workers/storage/cloudflare.js:1019:    const appliedGeneration = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1025:      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/storage/cloudflare.js:1029:      statements.push(table === "catalog_summary"
workers/storage/cloudflare.js:1030:        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
workers/storage/cloudflare.js:1038:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1040:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1098:    // Bookkeeping lives in catalog_summary itself (getStats reads only
workers/storage/cloudflare.js:1103:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1104:        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
workers/storage/cloudflare.js:1105:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1131:    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1132:        VALUES ('rebuild_generation', 1, ?)
workers/storage/cloudflare.js:1133:      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
workers/storage/cloudflare.js:1140:      `SELECT summary_key, value_int FROM catalog_summary
workers/storage/cloudflare.js:1141:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
workers/storage/cloudflare.js:1142:                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
workers/storage/cloudflare.js:1157:    const pending = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1158:    const applied = state.get("rebuild_applied_generation") || 0;
workers/storage/cloudflare.js:1164:    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
workers/storage/cloudflare.js:1192:    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1193:        VALUES ('rebuild_lease_until', ?, ?)
workers/storage/cloudflare.js:1195:      WHERE catalog_summary.value_int < ?`)
workers/storage/cloudflare.js:1200:    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1201:        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
workers/storage/cloudflare.js:1209:    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
workers/storage/cloudflare.js:1210:        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
workers/storage/cloudflare.js:1219:    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
workers/storage/cloudflare.js:1220:        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:7:  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:11:const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until"];
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:53:  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:54:  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:56:  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:57:  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:73:    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:74:    expect(statement.sql).toMatch(/rebuild_generation/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:75:    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:159:    expect(statement.sql).toMatch(/rebuild_lease_until/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:160:    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:181:    const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:204:    expect(renew.sql).toMatch(/WHERE summary_key = 'rebuild_lease_until' AND updated_at = \?/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:217:    expect(catalog.prepared[0].sql).toMatch(/UPDATE catalog_summary SET value_int = 0/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:234:    const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:247:    expect(catalog.prepared.some((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"))).toBe(false);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:283:    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:298:      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:301:    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);

hook: PostToolUse
hook: PostToolUse Completed
**Assessing queue rebuild behavior on first deploy**
**Identifying lease release and rebuild snapshot race**
**Verifying queue mutation dispatch coverage**
exec
/bin/zsh -lc "sed -n '260,315p' workers/cloudflare-native.js && sed -n '80,125p' wrangler.toml && sed -n '1,260p' docs/ops/aggregate-rebuild-cost-guard.md && git show --format=fuller --stat ed49b15 && git diff --check origin/main...HEAD && grep -R -n -E \"catalog\\.rebuild|CASE_MUTATION_QUEUE|send\\(|sendBatch\\(\" workers/case-api workers/pipeline workers/storage workers --exclude='cloudflare-native.js' --exclude-dir=node_modules --exclude='*.map'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 3504ms:
2026-09-10 21:59:08.055 xcodebuild[57491:134486864]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:08.305 xcodebuild[57491:134486863] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-EIgiI2wv' (errno=Operation not permitted)
2026-09-10 21:59:08.933 xcodebuild[57515:134487044]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:09.105 xcodebuild[57515:134487042] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
commit ed49b159e651409f5a08a3562dadb31c5fd05ff1
Author:     Sasuke.Inu <233004175+Sasuke-inu@users.noreply.github.com>
AuthorDate: Thu Sep 10 21:56:32 2026 +1000
Commit:     Sasuke.Inu <233004175+Sasuke-inu@users.noreply.github.com>
CommitDate: Thu Sep 10 21:56:32 2026 +1000

    fix(cloudflare): coalesce aggregate rebuilds behind a scheduled, fenced lease
    
    The mutation queue rebuilt all 17 summary/filter tables once per batch
    (~584k written rows each). With max_batch_size=20 a 153k-case import meant
    ~7,700 full rewrites: immi-catalog wrote 12.08B rows between 2026-08-23 and
    2026-09-01, i.e. 12.06B billable rows and about $12,060 in D1 rows-written
    charges. Query insights attribute 6.68B of them to three INSERT ... SELECT
    statements running ~24,000 times.
    
    Behaviour now:
    
    - Queue batches record staleness only: markAggregatesDirty() increments a
      monotonic generation (one row) instead of paying for a rebuild.
    - A new scheduled() handler rebuilds at most once per
      AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS (default 300, cron */5 * * * *).
      "Dirty" is generation > applied_generation, so a mutation landing while a
      rebuild runs stays pending instead of being cleared by the rebuild's own
      bookkeeping write.
    - Rebuilds run under a D1 lease whose expiry and fencing token are written in
      one statement; renew/release are token-conditional and the rebuild renews per
      20-statement chunk and aborts if it lost the lease, so overlapping
      invocations cannot interleave DELETEs.
    - A failed rebuild is throttled by rebuild_last_attempt_at, so a 30-second
      queue retry cannot rebuild repeatedly.
    - A bounded queue-side fallback (AGGREGATE_REBUILD_FALLBACK_SECONDS, default
      3600) keeps aggregates fresh if the cron trigger is missing or failing.
    
    Bookkeeping lives in catalog_summary, so no D1 migration is required and
    getStats() still reads only total_cases/with_full_text.
    
    Operator action: regenerate IMMI_NATIVE_MAIN_WRANGLER_TOML_B64 so the deployed
    config carries the [triggers] block and the AGGREGATE_REBUILD_* vars; without
    the cron the fallback still refreshes, but only about hourly. Details, cost
    envelope, verification checklist and rollback rules:
    docs/ops/aggregate-rebuild-cost-guard.md.
    
    Validation: Worker Vitest 27 files / 380 tests; Python suite 1141 passed /
    10 skipped; native bundle closure; native-config gate output unchanged vs
    main; a real-SQLite harness replays the rebuild, the mid-rebuild mutation race
    and the lease fencing (21/21 checks). Three read-only Codex review passes drove
    the generation, lease and rollback fixes; evidence under work/.

 .claude/STATE.md                                   |  63 +++-
 config/wrangler-cloudflare-native.toml.example     |  14 +
 docs/ops/aggregate-rebuild-cost-guard.md           | 170 +++++++++++
 .../cloudflare-aggregate-rebuild-guard.test.js     | 317 +++++++++++++++++++++
 workers/__tests__/cloudflare-native-queue.test.js  |  73 ++++-
 .../cloudflare-native-scheduled-rebuild.test.js    | 116 ++++++++
 workers/cloudflare-native.js                       |  99 ++++++-
 workers/storage/cloudflare.js                      | 170 ++++++++++-
 wrangler.toml                                      |  14 +
 9 files changed, 1022 insertions(+), 14 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-fqX1LURz' (errno=Operation not permitted)
2026-09-10 21:59:10.104 xcodebuild[57553:134487412]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:10.233 xcodebuild[57553:134487411] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-5pI19glE' (errno=Operation not permitted)
2026-09-10 21:59:10.612 xcodebuild[57556:134487440]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:10.737 xcodebuild[57556:134487439] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
workers/case-api/cloudflare_mutations.js:132:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:133:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:146:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:148:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:149:    event_id: `catalog.rebuild:${digest}`,
workers/case-api/cloudflare_mutations.js:150:    kind: "catalog.rebuild",
workers/case-api/cloudflare_mutations.js:173:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:174:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:187:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") {
workers/pipeline/control_handlers.js:80:    await env.PIPELINE_CONTROL_QUEUE.send({
workers/pipeline/control_handlers.js:80:    await env.PIPELINE_CONTROL_QUEUE.send({
workers/case-api/cloudflare_mutations.js:132:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:133:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:146:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:148:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:149:    event_id: `catalog.rebuild:${digest}`,
workers/case-api/cloudflare_mutations.js:150:    kind: "catalog.rebuild",
workers/case-api/cloudflare_mutations.js:173:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
workers/case-api/cloudflare_mutations.js:174:  await env.CASE_MUTATION_QUEUE.send({
workers/case-api/cloudflare_mutations.js:187:  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") {
workers/austlii-scraper/src/extract.ts:227:      await env.NATIVE_CASE_QUEUE.send(event);
workers/austlii-scraper/src/discover.ts:212:        await env.SCRAPE_QUEUE.sendBatch(chunk);
workers/austlii-scraper/src/index.ts:113:          await env.SCRAPE_QUEUE.sendBatch(jobs.slice(index, index + 25));
workers/austlii-scraper/src/index.ts:479:  await env.EXTRACT_QUEUE.send({
workers/__tests__/cloudflare-mutations.test.js:83:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:98:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:120:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:139:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:163:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:196:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:217:      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
workers/__tests__/cloudflare-mutations.test.js:221:    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "catalog.rebuild" }));
workers/__tests__/cloudflare-mutations.test.js:239:        CASE_MUTATION_QUEUE: queue,
workers/__tests__/cloudflare-mutations.test.js:260:        CASE_MUTATION_QUEUE: queue,
workers/__tests__/cloudflare-native-queue.test.js:131:      body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
workers/llm-council/runner.js:1851:          await send(`${providerKey}.delta`, { text: delta });
workers/llm-council/runner.js:1855:          await send(`${providerKey}.source`, ev.source);
workers/llm-council/runner.js:1861:        await send(`${providerKey}.error`, {
workers/llm-council/runner.js:1881:      await send(`${providerKey}.done`, {
workers/llm-council/runner.js:1897:      await send(`${providerKey}.error`, {
workers/llm-council/runner.js:1918:      await send("council.start", {
workers/llm-council/runner.js:1931:      await send("council.retrieval", {
workers/llm-council/runner.js:1940:        await send("council.session", {
workers/llm-council/runner.js:1984:        await send("council.error", {
workers/llm-council/runner.js:2000:        await send("council.done", allFailedDonePayload);
workers/llm-council/runner.js:2009:      await send("moderator.start", { model: geminiFlashModel });
workers/llm-council/runner.js:2013:        onDelta: (text) => { void send("moderator.delta", { text }); },
workers/llm-council/runner.js:2016:      await send("moderator.complete", moderator);
workers/llm-council/runner.js:2030:      await send("council.done", donePayload);
workers/llm-council/runner.js:2035:      await send("council.error", { error: String(err).slice(0, 700) });

hook: PostToolUse
hook: PostToolUse Completed
**Inspecting mutation function near enqueue rebuild**
exec
/bin/zsh -lc "sed -n '100,210p' workers/case-api/cloudflare_mutations.js && sed -n '1,180p' workers/__tests__/cloudflare-native-scheduled-rebuild.test.js && sed -n '1,175p' workers/__tests__/cloudflare-native-queue.test.js && sed -n '1,340p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
    respondent: data.respondent,
    country_of_origin: data.country_of_origin,
    hearing_date: data.hearing_date,
    is_represented: data.is_represented,
    representative: data.representative,
    source: data.source,
    case_nature: data.case_nature,
    url: data.url,
    catchwords: data.catchwords,
    legislation: data.legislation,
    text_snippet: data.text_snippet,
    tags: data.tags,
    user_notes: data.user_notes,
    visa_outcome_reason: data.visa_outcome_reason,
    legal_test_applied: data.legal_test_applied,
    last_extraction_run_id: data.last_extraction_run_id,
    extraction_confidence_json: data.extraction_confidence_json,
    judges: data.judges,
    legal_concepts: data.legal_concepts,
  };
}

function canonicalText(data) {
  return String(data.full_text ?? data.text ?? data.text_snippet ?? [data.title, data.citation, data.catchwords].filter(Boolean).join(" ")).trim();
}

async function caseIdFor(data) {
  const key = data.citation || data.url || data.title;
  return (await sha256Hex(String(key))).hex.slice(0, 12);
}

async function enqueueSemanticMutation(env, record, sourcePointer) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `case:${record.case_id}:${sourcePointer.sha256}`,
    kind: "case.reindex",
    case_id: record.case_id,
    content_key: sourcePointer.key,
    content_sha256: sourcePointer.sha256,
    content_size: sourcePointer.size,
    content_type: sourcePointer.contentType,
  });
  return true;
}

async function enqueueAggregateRefresh(env, reason) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  const digest = (await sha256Hex(String(reason))).hex.slice(0, 32);
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `catalog.rebuild:${digest}`,
    kind: "catalog.rebuild",
    reason: String(reason).slice(0, 256),
  });
  return true;
}

function sourcePointerFromCase(row) {
  if (!row || typeof row.content_key !== "string" || !/^[0-9a-f]{64}$/.test(String(row.content_sha256 || ""))) {
    return null;
  }
  const size = Number(row.content_size);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return {
    key: row.content_key,
    sha256: row.content_sha256,
    size,
    contentType: "text/plain; charset=utf-8",
  };
}

async function enqueueCaseSourceCleanup(env, row) {
  const sourcePointer = sourcePointerFromCase(row);
  if (!sourcePointer || typeof row?.case_id !== "string") return false;
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `case.source.delete:${row.case_id}:${sourcePointer.sha256}`,
    kind: "case.source.delete",
    case_id: row.case_id,
    content_key: sourcePointer.key,
    content_sha256: sourcePointer.sha256,
    content_size: sourcePointer.size,
    content_type: sourcePointer.contentType,
  });
  return true;
}

function requireMutationQueue(env) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") {
    throw new StorageBoundaryError("Native case mutation queue is unavailable", {
      code: "case_mutation_queue_unavailable",
      status: 503,
    });
  }
}

async function handleCreate(request, env, stores) {
  const data = await readJson(request);
  if (!data) return errorResponse("invalid json");
  if (!data.title && !data.citation) return errorResponse("Title or citation is required");
  const caseId = await caseIdFor(data);
  const record = caseRecord(data, caseId);
  const text = canonicalText(data);
  const sourcePointer = await stores.objectStore.putCaseSource({ caseId, body: text });
  await stores.caseStore.putImportedCase({
    case: record,
    sourcePointer,
    textChunks: text ? splitFtsChunks(text) : [],
  });
  const queued = await enqueueSemanticMutation(env, record, sourcePointer);
  const result = await stores.caseStore.getCase(caseId);
  return json({ case: publicCase(result), semantic_ready: Boolean(result?.semantic_ready), semantic_queued: queued }, 201);
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

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
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

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600 });
  });

  it("falls back to the default interval when the variable is missing or invalid", async () => {
    for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
      const current = stores({ due: false, reason: "debounced" });
      mockCreateStores.mockReturnValue(current);
      await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300 });
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

  it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
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
    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800 });
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
  });

  it("defaults the fallback window to an hour when unset", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600 });
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
  });

  it("does not rebuild from the queue path when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
    current.caseStore.claimRebuildLease.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
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
function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken } = {}) {
  const rows = [];
  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
  if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
  return rows;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("Catalog aggregate rebuild guard", () => {
  it("records staleness as a monotonic generation, not a boolean", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    expect(catalog.prepared).toHaveLength(1);
    const statement = catalog.prepared[0];
    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
    expect(statement.sql).toMatch(/rebuild_generation/);
    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
    expect(statement.params).toHaveLength(1);
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
    // + 2 bookkeeping rows.
    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 2);
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
    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
    expect(Number(applied.params[0])).toBe(7);
    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
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

hook: PostToolUse
hook: PostToolUse Completed
**Investigating enqueueAggregateRefresh timing**
**Inspecting enqueueAggregateRefresh references**
exec
/bin/zsh -lc "grep -n -E \"enqueueAggregateRefresh|enqueueSemanticMutation|enqueueCaseSourceCleanup|putImportedCase|updateCase|deleteCase\" workers/case-api/cloudflare_mutations.js && sed -n '200,430p' workers/case-api/cloudflare_mutations.js && sed -n '1,155p' config/wrangler-cloudflare-native.toml.example && git diff --unified=25 origin/main...HEAD -- workers/case-api/cloudflare_mutations.js workers/cloudflare-native.js workers/storage/cloudflare.js docs/ops/aggregate-rebuild-cost-guard.md" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1512ms:
2026-09-10 21:59:21.233 xcodebuild[58376:134490028]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:21.409 xcodebuild[58376:134490027] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-C9twLW8w' (errno=Operation not permitted)
2026-09-10 21:59:21.821 xcodebuild[58383:134490111]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:59:21.949 xcodebuild[58383:134490110] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/docs/ops/aggregate-rebuild-cost-guard.md b/docs/ops/aggregate-rebuild-cost-guard.md
new file mode 100644
index 0000000..4ad4c36
--- /dev/null
+++ b/docs/ops/aggregate-rebuild-cost-guard.md
@@ -0,0 +1,170 @@
+# Aggregate rebuild cost guard (2026-09-10)
+
+## Why this exists
+
+Between 2026-08-23 and 2026-09-01 the `immi-catalog` D1 database wrote
+**12,084,578,591 rows**, of which 12.06B were billable: **$12,060** in D1
+rows-written charges for a single billing cycle, 99.77% of the account total.
+
+The cause was in this Worker, not in the database or the queue configuration:
+
+- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
+  for **every queue batch** that changed anything.
+- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
+  (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
+  `cases` table — roughly **584,000 written rows** (and ~2.5M rows read) per
+  call, about **$0.58** at the published $1.00/million-rows rate.
+- With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
+  batches, i.e. ~7,700 full rewrites ≈ **4.5 billion written rows** per import.
+  Query insights confirmed the pattern: the top three `INSERT ... SELECT`
+  statements alone accounted for 6.68B written rows over ~24,000 executions.
+
+D1 charges for rows *modified*, and a `DELETE` plus re-`INSERT` of the same
+summary data is charged again on every pass, so "the data set is small" does not
+bound the bill — the number of rebuild passes does.
+
+## What changed
+
+| File | Change |
+|---|---|
+| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
+| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
+| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
+| `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
+| `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
+| `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |
+
+### Bookkeeping model (why generations, not a boolean)
+
+State lives in `catalog_summary` (`summary_key` is the primary key) under four
+internal keys, none of which reach API responses (`getStats()` reads only
+`total_cases` / `with_full_text`). No D1 migration is required.
+
+| Key | Written by | Meaning |
+|---|---|---|
+| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
+| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
+| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
+| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
+| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
+
+"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
+would be wrong: a rebuild that starts at generation 5 and takes a minute can be
+interleaved with a mutation, and a plain `dirty = 0` write at the end would
+discard that mutation's pending state and leave the dashboard permanently stale.
+The rebuild therefore snapshots the generation *before* it scans and records that
+value as applied — anything that arrived meanwhile stays pending and the next
+tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
+bookkeeping keys for the same reason.
+
+Two invocations cannot rebuild at once. `claimRebuildLease()` is a conditional
+upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that writes the
+expiry **and rotates the fencing token in the same statement**, so a lease is
+never observable in a torn state (expiry already renewed, token still the
+previous owner's — the flaw a second review pass caught in the first version of
+this fix). `changes === 1` means the caller won; the winner then stamps
+`rebuild_last_attempt_at`.
+
+Fencing matters because a lease can expire while its holder is still working:
+
+- `rebuildAggregates({ lease })` renews the lease (`UPDATE ... WHERE summary_key
+  = 'rebuild_lease_until' AND updated_at = ?`) before every 20-statement chunk and
+  **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
+  its lease cannot keep interleaving its DELETEs with the new owner's.
+- `releaseRebuildLease({ token })` uses the same token-conditional `UPDATE`, so an
+  expired holder can never free (or extend) the new owner's lease. Without a
+  token it refuses (`false`) instead of falling back to an unconditional write.
+- The `finally` release is therefore safe even on the abort path.
+
+The attempt timestamp is the second half of the same problem: a rebuild that
+throws releases its lease but never writes `rebuild_last_at`, so throttling on
+success alone would let a retry storm rebuild on every 30-second queue retry.
+`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
+
+## Cost envelope after the change
+
+| Scenario | Before | After (300 s interval) |
+|---|---|---|
+| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
+| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | ≤ 48 rebuilds ≈ 28M rows ≈ **$28** |
+| Dashboard freshness | per batch | ≤ 5 minutes stale |
+| Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |
+
+Two knobs, both operator-side vars:
+
+- `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300) — the cron's own
+  debounce. Raising it to 900 cuts a full import to about $10.
+- `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
+  queue path only reaches for it when the aggregates stay dirty longer than this
+  window, i.e. when the cron trigger is absent or failing. With a working cron
+  the last rebuild is always younger than the cron period, so the valve never
+  opens.
+- `AGGREGATE_REBUILD_LEASE_SECONDS` (default 900) — how long one invocation owns
+  the rebuild before another may take over. It is renewed per chunk while the
+  owner is alive, so it only matters if an invocation dies mid-rebuild: the
+  longer the lease, the longer a crashed run blocks the next one.
+
+Removing the cron, lowering the interval towards the cron period, or moving the
+rebuild back into the queue consumer restores the old cost curve.
+
+## Deploy requirements (operator action)
+
+The production deploy does **not** read this repository's `wrangler.toml`; it
+materialises the operator-supplied configs from
+`IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After merging:
+
+1. Regenerate that config secret from `config/wrangler-cloudflare-native.toml.example`
+   (or add the `[triggers]` block plus the two `AGGREGATE_REBUILD_*` vars to the
+   stored copy) — without the cron the aggregates fall back to hourly refreshes
+   (≈$14/day) instead of every 5 minutes, and the incident's cost guarantee is
+   weakened even though dashboards keep working.
+2. Confirm the deployed Worker has the cron trigger:
+   `npx wrangler deployments status` / dashboard → Workers → immi-case-standalone
+   → Triggers → Cron, next run within 5 minutes.
+3. Run `make test-workers` and `node scripts/check_cloudflare_native_bundle.mjs`
+   before the deploy (both pass as of this change).
+
+## Verification checklist
+
+- [ ] Cron trigger present and firing every 5 minutes.
+- [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
+      shows the rebuild statements running a handful of times per hour, not per batch.
+- [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
+- [ ] D1 rows written per day returns to a low baseline (monitor with the local
+      `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
+- [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
+      presence means the cron trigger is not draining the dirty flag.
+- [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
+      shows `rebuild_applied_generation` catching up with `rebuild_generation`
+      after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
+- [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
+      is normal; constant entries mean rebuilds take longer than the lease.
+- [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
+      normal operation; a widening gap means rebuilds are failing and being
+      retried (check Worker logs for `aggregate_rebuild_lease_release_error`
+      and for the underlying D1 error).
+
+## Rollback
+
+**Do not restore the per-batch rebuild.** That is the incident mechanism, and
+reverting to it re-creates the ~$12,060 cost curve within a single import.
+
+Safe rollback levers, in order of preference:
+
+1. **Cron missing or not firing** (symptom: the queue log shows repeated
+   `cloudflare.aggregate_rebuild_fallback` events, or totals advance only about
+   hourly): fix the trigger / regenerate the operator config. Nothing is broken
+   by leaving the fallback in place — it is bounded at one rebuild per
+   `AGGREGATE_REBUILD_FALLBACK_SECONDS`.
+2. **Rebuild is too expensive or too frequent**: raise
+   `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (300 → 900 → 3600). Cost scales
+   linearly with the number of rebuilds, so this is the correct lever.
+3. **Scheduled rebuild must stop entirely** (e.g. during a schema change): set
+   the cron aside (`[triggers] crons = []`) and raise the fallback interval. The
+   queue path keeps the data fresh at the fallback cadence.
+4. **Full revert of this change**: only with the original bug explicitly
+   re-fixed first (coalescing must survive); record the decision in this file.
+
+Observed symptom to watch for: a dashboard whose totals stop advancing means the
+dirty flag is not being drained — fix the drain path, never the queue's cost
+profile.
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index f37b3b0..0464749 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -95,61 +95,155 @@ async function processCaseExtracted(message, env) {
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
-    if (changed) await stores.caseStore.rebuildAggregates();
+    // Never rebuild on the happy path: one rebuild clears and rewrites 17
+    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
+    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
+    if (changed) await markStaleAndMaybeRebuild(stores, env);
     for (const message of messages) if (typeof message?.ack === "function") message.ack();
   } catch (error) {
     console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
     for (const message of messages) {
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
+const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
+const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
+const DEFAULT_REBUILD_LEASE_SECONDS = 900;
+
+function positiveIntOr(value, fallback) {
+  const parsed = Number.parseInt(value ?? "", 10);
+  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
+}
+
+/**
+ * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
+ * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
+ * The lease length is derived from the interval so it always outlives a rebuild
+ * while still expiring on its own if this invocation dies mid-flight.
+ */
+async function rebuildUnderLease(stores, env) {
+  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
+  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
+  if (!lease) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
+    return { skipped: "lease_held" };
+  }
+  try {
+    return await stores.caseStore.rebuildAggregates({ lease });
+  } finally {
+    try {
+      // Token-conditional: if this run outlived its lease, the new owner's
+      // lease is left untouched.
+      await stores.caseStore.releaseRebuildLease({ token: lease.token });
+    } catch (error) {
+      console.error(JSON.stringify({
+        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
+      }));
+    }
+  }
+}
+
+/**
+ * Coalesced analytics rebuild.
+ *
+ * Queue batches only mark the aggregates dirty; this scheduled handler decides
+ * when to pay for the rebuild, so N queue batches cost at most one rebuild per
+ * interval instead of N full rewrites of 17 tables.
+ */
+async function handleScheduledRebuild(env) {
+  const stores = createCloudflareStores(env);
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
+    DEFAULT_REBUILD_INTERVAL_SECONDS,
+  );
+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!decision.due) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
+    return decision;
+  }
+  const startedAt = Date.now();
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return { ...decision, ...result };
+  console.log(JSON.stringify({
+    event: "cloudflare.aggregate_rebuild_completed",
+    reason: decision.reason,
+    min_interval_seconds: minIntervalSeconds,
+    duration_ms: Date.now() - startedAt,
+    rebuilt_at: result?.rebuilt_at ?? null,
+  }));
+  return { ...decision, ...result };
+}
+
+/**
+ * Safety valve for the coalesced rebuild.
+ *
+ * The cron trigger normally performs every rebuild, so the queue path only
+ * records staleness. If that trigger is missing or failing, the flag would
+ * never be drained and every dashboard would freeze silently — so the queue
+ * path still refreshes, at most once per fallback window. With a working cron
+ * the last rebuild is never older than the cron period, and this never fires.
+ */
+async function markStaleAndMaybeRebuild(stores, env) {
+  await stores.caseStore.markAggregatesDirty();
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
+    DEFAULT_FALLBACK_INTERVAL_SECONDS,
+  );
+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!fallback?.due) return false;
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return false;
+  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
+  return true;
+}
+
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
@@ -174,50 +268,53 @@ async function dispatchAuth(request, env, path, method) {
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
+  async scheduled(event, env) {
+    return handleScheduledRebuild(env);
+  },
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
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index 441eb69..f42d675 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -25,50 +25,68 @@ import {
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
 
+// catalog_summary doubles as the aggregate-rebuild control table. Its
+// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
+// mid-rebuild still leaves a pending generation behind.
+const AGGREGATE_BOOKKEEPING_KEYS = [
+  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
+  "rebuild_last_attempt_at", "rebuild_lease_until",
+];
+
+// The rebuild lease keeps its fencing token in the `updated_at` column of the
+// SAME row that holds the expiry, so claiming, renewing and releasing are each
+// a single atomic statement: a token captured in one column and an expiry in
+// another could otherwise be read in a torn state by an expiring holder.
+function leaseToken() {
+  const uuid = globalThis.crypto?.randomUUID?.();
+  if (uuid) return uuid;
+  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
+}
+
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
@@ -961,64 +979,79 @@ export class CloudflareCaseStore {
     return changeCount(result[3]);
   }
 
   async batchAddTag(caseIds, tag) {
     const ids = [...new Set((caseIds || []).map(assertCaseId))];
     if (!ids.length) return 0;
     if (ids.length > 200) throw new StorageBoundaryError("Batch limited to 200 cases", { code: "batch_limit", status: 400 });
     if (typeof tag !== "string" || !tag.trim() || tag.length > 64 || /[,<>]/.test(tag)) {
       throw new StorageBoundaryError("Tag is invalid", { code: "invalid_tag", status: 400 });
     }
     const current = rows(await this.db.prepare(`
       SELECT c.case_id, c.tags
       FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
     `).bind(JSON.stringify(ids)).all());
     const updates = current.map((row) => {
       const values = new Set(String(row.tags || "").split(",").map((value) => value.trim()).filter(Boolean));
       values.add(tag.trim());
       return this.db.prepare("UPDATE cases SET tags = ?, semantic_ready = 0, vector_mutation_id = NULL, updated_at = ? WHERE case_id = ?")
         .bind([...values].sort().join(", "), utcNow(), row.case_id);
     });
     if (updates.length) await this.db.batch(updates);
     return updates.length;
   }
 
   /**
-   * Rebuild queue-maintained analytics outside the request path. A mutation
-   * queue batch calls this once after its D1/R2/Vectorize work, so dashboard
-   * reads remain aggregate-only and never scan the corpus.
+   * Rebuild queue-maintained analytics outside the request path.
+   *
+   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
+   * the whole `cases` table, so it must never run once per queue batch. Queue
+   * work only marks the aggregates dirty (markAggregatesDirty) and the
+   * scheduled handler coalesces those marks into at most one rebuild per
+   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
+   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
+   * $12,060 in D1 write charges.
    */
-  async rebuildAggregates() {
+  async rebuildAggregates({ lease } = {}) {
     const now = utcNow();
+    // Snapshot the pending generation before scanning: anything that arrives
+    // while this rebuild runs must stay pending, not be marked applied.
+    const state = await this.readAggregateState();
+    const appliedGeneration = state.get("rebuild_generation") || 0;
+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
     const statements = [];
     for (const table of [
       "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
       "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
       "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
       "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
       "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
-    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
+    ]) {
+      statements.push(table === "catalog_summary"
+        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
+        : this.db.prepare(`DELETE FROM ${table}`));
+    }
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
@@ -1040,52 +1073,175 @@ export class CloudflareCaseStore {
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
-    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
-    return { rebuilt_at: now };
+    // Bookkeeping lives in catalog_summary itself (getStats reads only
+    // total_cases/with_full_text, so these keys stay internal). Recording the
+    // generation observed at the start — not a bare dirty=0 — is what keeps a
+    // mid-rebuild mutation pending.
+    statements.push(
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
+    );
+    for (let offset = 0; offset < statements.length; offset += 20) {
+      // While we still own the lease, extend it before each chunk; if another
+      // invocation took over (this run outlived its lease), abort instead of
+      // interleaving DELETEs with it. At most one chunk can overlap.
+      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
+        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
+          code: "rebuild_lease_lost", status: 503,
+        });
+      }
+      await this.db.batch(statements.slice(offset, offset + 20));
+    }
+    return { rebuilt_at: now, applied_generation: appliedGeneration };
+  }
+
+  /**
+   * Mark analytics as stale without paying for a rebuild: one row written per
+   * queue batch instead of clearing and rewriting 17 tables.
+   *
+   * A monotonic generation, not a boolean: a rebuild applies the generation it
+   * observed when it started, so a mutation landing mid-rebuild stays pending
+   * instead of being wiped by the rebuild's own bookkeeping write.
+   */
+  async markAggregatesDirty() {
+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_generation', 1, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
+      .bind(utcNow()).run();
+    return true;
+  }
+
+  async readAggregateState() {
+    const current = rows(await this.db.prepare(
+      `SELECT summary_key, value_int FROM catalog_summary
+        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
+                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
+    ).all());
+    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
+  }
+
+  /**
+   * Rate-limit decision for the scheduled handler: rebuild only when a
+   * generation is pending and the last rebuild is older than the interval.
+   * This is the only guard preventing a bulk import from rewriting the whole
+   * summary set thousands of times.
+   */
+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
+    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
+      ? Math.floor(minIntervalSeconds) : 300;
+    const state = await this.readAggregateState();
+    const pending = state.get("rebuild_generation") || 0;
+    const applied = state.get("rebuild_applied_generation") || 0;
+    if (pending <= applied) return { due: false, reason: "clean" };
+    // Throttle on the last *attempt*, not only the last success: a rebuild that
+    // throws releases its lease without stamping `rebuild_last_at`, and the
+    // 30-second queue retry must not therefore rebuild on every retry.
+    const lastSuccessAt = state.get("rebuild_last_at") || 0;
+    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
+    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
+    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
+    if (elapsedSeconds < interval) {
+      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
+    }
+    return {
+      due: true,
+      reason: "dirty",
+      pending_generation: pending,
+      applied_generation: applied,
+      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
+    };
+  }
+
+  /**
+   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
+   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
+   * interleave their DELETEs. The conditional upsert only writes when the held
+   * lease has expired, so `changes === 1` means this caller won.
+   */
+  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
+    const now = Math.floor(Date.now() / 1000);
+    const lease = Math.max(60, Math.floor(leaseSeconds));
+    const token = leaseToken();
+    // One statement takes the lease, writes its expiry and rotates the token:
+    // a winner cannot be confused with the previous holder, and an expired
+    // holder's token stops matching the moment a new claim lands.
+    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_lease_until', ?, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
+      WHERE catalog_summary.value_int < ?`)
+      .bind(now + lease, token, now).run();
+    if (changeCount(result) === 0) return null;
+    // Throttles retries of a rebuild that failed (a failure never stamps
+    // rebuild_last_at). Losing this write only costs one extra rebuild.
+    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
+    return { token, leaseSeconds: lease };
+  }
+
+  /** Extend the lease, but only while this caller still owns it. */
+  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
+    if (typeof token !== "string" || !token) return false;
+    const lease = Math.max(60, Math.floor(leaseSeconds));
+    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
+        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
+      .bind(Math.floor(Date.now() / 1000) + lease, token, token).run();
+    return changeCount(result) > 0;
+  }
+
+  /** Release the lease — only the token holder can, so an expired run cannot
+   *  free (or extend) a lease that a newer invocation now owns. */
+  async releaseRebuildLease({ token } = {}) {
+    if (typeof token !== "string" || !token) return false;
+    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+        WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?`)
+      .bind(utcNow(), token).run();
+    return changeCount(result) > 0;
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

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing semantic reindex enqueue logic**
**Evaluating rebuild scheduling and lease handling**
**Clarifying lease expiry residual risk acceptance**
**Noting expected first deploy fallback behavior**
**Analyzing D1 batch rebuild atomicity and bookkeeping**
**Assessing partial rebuild failure recovery and overlap risks**
**Analyzing lease rebuild and failure handling**
**Verifying rebuild timing and test coverage**
**Clarifying rebuild frequency constraints**
**Separating claim and attempt stamp with rebuild locking**
**Assessing rebuild queue scheduling and interval overlap**
exec
/bin/zsh -lc 'grep -n -E "Do not restore|rebuild_generation|rebuild_applied_generation|DELETE FROM catalog_summary|rebuild_last_attempt_at|async claimRebuildLease|async renewRebuildLease|async releaseRebuildLease|rebuild_lease_lost|async markStaleAndMaybeRebuild|async handleScheduledRebuild|async handleCaseMutationQueue|crons" workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/storage/cloudflare.js:54:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/storage/cloudflare.js:55:  "rebuild_last_attempt_at", "rebuild_lease_until",
workers/storage/cloudflare.js:1019:    const appliedGeneration = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1030:        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
workers/storage/cloudflare.js:1104:        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
workers/storage/cloudflare.js:1114:          code: "rebuild_lease_lost", status: 503,
workers/storage/cloudflare.js:1132:        VALUES ('rebuild_generation', 1, ?)
workers/storage/cloudflare.js:1141:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
workers/storage/cloudflare.js:1142:                              'rebuild_last_attempt_at', 'rebuild_lease_until')`,
workers/storage/cloudflare.js:1157:    const pending = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1158:    const applied = state.get("rebuild_applied_generation") || 0;
workers/storage/cloudflare.js:1164:    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
workers/storage/cloudflare.js:1185:  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1201:        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
workers/storage/cloudflare.js:1206:  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1217:  async releaseRebuildLease({ token } = {}) {
wrangler.toml:107:crons = ["*/5 * * * *"]
config/wrangler-cloudflare-native.toml.example:68:crons = ["*/5 * * * *"]
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
docs/ops/aggregate-rebuild-cost-guard.md:32:| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:46:| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
docs/ops/aggregate-rebuild-cost-guard.md:48:| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
docs/ops/aggregate-rebuild-cost-guard.md:51:"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
docs/ops/aggregate-rebuild-cost-guard.md:57:tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
docs/ops/aggregate-rebuild-cost-guard.md:66:`rebuild_last_attempt_at`.
docs/ops/aggregate-rebuild-cost-guard.md:72:  **throws** (`rebuild_lease_lost`) as soon as renewal fails, so a run that lost
docs/ops/aggregate-rebuild-cost-guard.md:82:`aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.
docs/ops/aggregate-rebuild-cost-guard.md:138:      shows `rebuild_applied_generation` catching up with `rebuild_generation`
docs/ops/aggregate-rebuild-cost-guard.md:142:- [ ] `rebuild_last_attempt_at` and `rebuild_last_at` stay close together in
docs/ops/aggregate-rebuild-cost-guard.md:149:**Do not restore the per-batch rebuild.** That is the incident mechanism, and
docs/ops/aggregate-rebuild-cost-guard.md:163:   the cron aside (`[triggers] crons = []`) and raise the fallback interval. The

hook: PostToolUse
hook: PostToolUse Completed
**Summarizing residual risk scenarios**
**Analyzing batch lease renewal and rebuild timing**
**Reviewing lease duration and state assumptions**
codex
四項不變條件均成立：

- (a) Coalescing：正常路徑的 queue 僅遞增 stale generation；cron 才依 300 秒 debounce 決定重建。fallback 另以 3600 秒限制，且同樣受 lease 保護。`workers/cloudflare-native.js:120-124,172-221`、`wrangler.toml:94-107`。
- (b) 不遺失 staleness：重建前快照 generation、完成時只寫入該快照為 applied generation；`catalog_summary` 清除時保留所有 bookkeeping keys，期間的新 mutation 會保持 pending。`workers/storage/cloudflare.js:1014-1119`。
- (c) Mutual exclusion：claim 以單一 conditional upsert 同時寫入 expiry 與 token；renew/release 均以 token 條件更新；每個 20-statement chunk 前續租，失去租約即拋出 `rebuild_lease_lost`，並在 `finally` 安全釋放。`workers/storage/cloudflare.js:1185-1222`、`workers/cloudflare-native.js:149-166`。
- (d) Bounded recovery：成功與失敗嘗試都會參與 debounce（`max(rebuild_last_at, rebuild_last_attempt_at)`）；cron 是主路徑，queue fallback 有獨立上限。`workers/storage/cloudflare.js:1153-1176`、`workers/cloudflare-native.js:203-221`。

先前五項 finding 均已關閉：

- Mid-rebuild mutation 不再被裸 `dirty = 0` 清除。
- 重疊重建已有 lease。
- 文件明確禁止恢復 per-batch rebuild。`docs/ops/aggregate-rebuild-cost-guard.md:149`
- Lease claim 沒有 expiry/token torn state；舊 token 無法釋放新 owner。
- 失敗重建受 attempt timestamp 節流。

沒有可指向目前原始碼的 ship blocker。

可接受的殘餘風險：

- 首次部署、尚無 rebuild timestamp 時，第一個 queue mutation 可走一次 fallback；此為一次性且有 lease 保護。
- 若單一 D1 batch 超過 lease 時間，舊 owner 下一個 chunk 續租會失敗並中止；後續完整重建會收斂資料。
- 正式部署仍須把 cron 與變數帶入 operator-supplied config；漏帶 cron 時不會回到 per-batch 成本曲線，但會退化為每小時 fallback。此為操作設定風險，文件已明示。

VERDICT: APPROVE
tokens used
78,868
四項不變條件均成立：

- (a) Coalescing：正常路徑的 queue 僅遞增 stale generation；cron 才依 300 秒 debounce 決定重建。fallback 另以 3600 秒限制，且同樣受 lease 保護。`workers/cloudflare-native.js:120-124,172-221`、`wrangler.toml:94-107`。
- (b) 不遺失 staleness：重建前快照 generation、完成時只寫入該快照為 applied generation；`catalog_summary` 清除時保留所有 bookkeeping keys，期間的新 mutation 會保持 pending。`workers/storage/cloudflare.js:1014-1119`。
- (c) Mutual exclusion：claim 以單一 conditional upsert 同時寫入 expiry 與 token；renew/release 均以 token 條件更新；每個 20-statement chunk 前續租，失去租約即拋出 `rebuild_lease_lost`，並在 `finally` 安全釋放。`workers/storage/cloudflare.js:1185-1222`、`workers/cloudflare-native.js:149-166`。
- (d) Bounded recovery：成功與失敗嘗試都會參與 debounce（`max(rebuild_last_at, rebuild_last_attempt_at)`）；cron 是主路徑，queue fallback 有獨立上限。`workers/storage/cloudflare.js:1153-1176`、`workers/cloudflare-native.js:203-221`。

先前五項 finding 均已關閉：

- Mid-rebuild mutation 不再被裸 `dirty = 0` 清除。
- 重疊重建已有 lease。
- 文件明確禁止恢復 per-batch rebuild。`docs/ops/aggregate-rebuild-cost-guard.md:149`
- Lease claim 沒有 expiry/token torn state；舊 token 無法釋放新 owner。
- 失敗重建受 attempt timestamp 節流。

沒有可指向目前原始碼的 ship blocker。

可接受的殘餘風險：

- 首次部署、尚無 rebuild timestamp 時，第一個 queue mutation 可走一次 fallback；此為一次性且有 lease 保護。
- 若單一 D1 batch 超過 lease 時間，舊 owner 下一個 chunk 續租會失敗並中止；後續完整重建會收斂資料。
- 正式部署仍須把 cron 與變數帶入 operator-supplied config；漏帶 cron 時不會回到 per-batch 成本曲線，但會退化為每小時 fallback。此為操作設定風險，文件已明示。

VERDICT: APPROVE
