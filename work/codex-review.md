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
session id: 01a08b19-9cc2-7412-b352-9dc73db2544e
--------
user
You are reviewing a completed implementation for correctness and quality before final acceptance.

HARD RULES (violating these fails the review):
- Do NOT load or use any installed skill, plugin, or MCP tool. Do NOT use graph/impact/index tools.
- Do NOT run builds, tests, deploys or any command that writes files. You may only read files: `cat`, `sed -n`, `git show`, `git diff`, `grep`.
- Do NOT modify the repository. Review only.
- Answer directly from the diff and the source you read. No preamble, no tool-tour narration.

Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
Branch: fix/aggregate-rebuild-debounce (based on origin/main @ 42826a3)
Scope: one focused change — stop a Cloudflare Worker from rebuilding its D1 summary tables once per queue batch.

BACKGROUND
- Production incident: the D1 database `immi-catalog` (Worker `immi-case-standalone`, main `workers/cloudflare-native.js`) wrote 12,084,578,591 rows between 2026-08-23 and 2026-09-01, i.e. 12.06B billable rows ≈ $12,060, because `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` for every queue batch that changed anything. One rebuild clears and rewrites 17 summary/filter tables (~584k written rows). Queue `max_batch_size` is 20, so a 153k-case import produced ~7,700 full rewrites.
- The fix: queue batches only record staleness (`markAggregatesDirty()` writes one row into `catalog_summary`), and a new `scheduled()` handler does at most one rebuild per `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300), driven by a `[triggers]` cron `*/5 * * * *` added to `wrangler.toml` and `config/wrangler-cloudflare-native.toml.example`.
- State keys `rebuild_dirty` / `rebuild_last_at` live in the existing `catalog_summary` table (`summary_key TEXT PRIMARY KEY, value_int INTEGER NOT NULL CHECK(value_int >= 0), updated_at TEXT NOT NULL`); the rebuild's own `DELETE FROM catalog_summary` clears the dirty flag; `getStats()` reads only `total_cases` and `with_full_text`.
- Files changed: workers/cloudflare-native.js, workers/storage/cloudflare.js, wrangler.toml, config/wrangler-cloudflare-native.toml.example, workers/__tests__/cloudflare-native-queue.test.js, plus two new test files and docs/ops/aggregate-rebuild-cost-guard.md.

ALREADY VERIFIED BY THE AUTHOR (do not re-derive, and do not report these as gaps):
- Full Worker Vitest suite passes: 27 files, 362 tests (`npm run test:workers`).
- `node scripts/check_cloudflare_native_bundle.mjs` passes (bundle closure).
- `scripts/check_cloudflare_native_target.py` produces byte-identical gate output before/after the config edit (only placeholder-ID errors, which are expected for checked-in configs).
- `wrangler.toml` parses with tomllib and yields vars/triggers as intended.
- The Python test suite could not be run locally (missing project deps in the available interpreters); it does not exercise this JS-only change.

DESIGN INTENTS THAT MUST NOT BE FLAGGED
- Reusing `catalog_summary` for bookkeeping instead of adding a D1 migration is deliberate: the production deploy is operator-driven and does not run migrations automatically.
- A dirty flag that survives across ticks (i.e. rebuild happens on a later tick, not immediately) is acceptable: dashboard freshness within ~5 minutes is the agreed contract.
- The production deploy reads an operator-supplied config secret, not this repo's wrangler.toml; the doc records the operator step to regenerate it.

REVIEW FOCUS (cite file:line, severity HIGH/MED/LOW, concrete fix for each finding)
1. Correctness of the coalescing contract: is there any path where the queue consumer still triggers a rebuild, or where a mutation can be acknowledged while its staleness record is lost (silent stale dashboards forever)?
2. Failure semantics: what happens if the scheduled rebuild throws, or if the cron is missing/misconfigured in production? Is a permanently dirty flag distinguishable from a working system?
3. Concurrency: two scheduled invocations overlapping, clock skew between Workers and D1, or a rebuild running while `markAggregatesDirty()` writes — can the dirty flag be cleared without the data actually being refreshed?
4. Data-consistency of the bookkeeping rows: `value_int` constraints, the interaction with `scripts/transform_immi_snapshot.py` (which deletes/inserts `catalog_summary` directly) and with `getStats()`.
5. Test quality: do the new tests actually fail if the per-batch rebuild is reintroduced, or if the interval guard is removed?
6. Release safety: does adding a `[triggers]` cron to an already-deployed Worker introduce risk for the first deploy (e.g. a cold rebuild on a 5.9 GB database, D1 CPU limits, or a rebuild that runs before the operator's config carries the new var)?

Do NOT review: formatting, naming, comment style, or anything outside this change.
Output: findings ordered HIGH → LOW, each with file:line, severity, the issue, and a concrete fix. If a focus area has no finding, say "no finding" for it.
End with exactly one line: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T11:35:07.419444Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:35:07.797413Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T11:35:08.762096Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:35:08.852549Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
**Clarifying allowed shell commands**
**Planning to use git diff with sed**
codex
我會只讀取指定差異與相關原始碼，依所列六項焦點進行審查。
exec
/bin/zsh -lc 'git diff --unified=80 origin/main...HEAD -- workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example workers/__tests__/cloudflare-native-queue.test.js docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
2026-09-10T11:35:21.311699Z ERROR codex_core::tools::router: error=collab spawn failed: no thread with id: 01a08b19-a6bd-7140-8bc6-9565848beda2
 succeeded in 2425ms:
2026-09-10 21:35:19.628 xcodebuild[54415:134075867]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:19.886 xcodebuild[54415:134075866] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kzwU2MLL' (errno=Operation not permitted)
2026-09-10 21:35:20.396 xcodebuild[54421:134075926]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:20.526 xcodebuild[54421:134075925] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

hook: PostToolUse
hook: PostToolUse Completed
**Investigating git diff and git show outputs**
exec
/bin/zsh -lc 'git show --format=fuller --stat HEAD && git show --format= --unified=80 HEAD -- workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example workers/__tests__/cloudflare-native-queue.test.js docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 3823ms:
2026-09-10 21:35:26.746 xcodebuild[55300:134078338]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:26.892 xcodebuild[55300:134078335] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-rk7gpMiZ' (errno=Operation not permitted)
2026-09-10 21:35:27.336 xcodebuild[55370:134078611]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:27.487 xcodebuild[55370:134078602] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
commit 42826a3032129468d8022970b16f2aa7ce1c0ddf
Author:     Developer <dev@example.com>
AuthorDate: Wed Aug 26 20:23:52 2026 +1000
Commit:     Developer <dev@example.com>
CommitDate: Wed Aug 26 20:23:52 2026 +1000

    chore: untrack the stray agent dirs the first pass missed
    
    The earlier cleanup enumerated .omc paths one directory at a time and only
    caught .omc/ and frontend/.omc/. Three more were tracked at other depths:
    frontend/src/.omc/ (15), workers/.omc/ (5), frontend/src/.claude/ (1), plus a
    nested .omc/ inside an authored subtree (.omc/research/ux-audit/.omc/, 2).
    
    Enumeration is the wrong shape here — the hook writes an .omc/ into whichever
    directory a command happens to cd into, so any subdirectory can grow one.
    Replace the list with '**/.omc/' plus a re-admit of the repo-root .omc/, and
    the same for .claude/. A nested-.omc rule closes the hole the re-admit opens.
    
    23 files untracked (local copies untouched). The repo-root .omc/ keeps its 29
    authored files — plans, research, design, prd, autopilot — and .claude/ keeps
    its 11 tracked settings and skills.
    
    git ls-files now reports no .omc or .claude artefacts outside the repo root,
    and no tracked file is shadowed by an ignore rule.

 .gitignore                                         | 25 +++++++++++++++-------
 ...play-31f3d4a2-e930-45ca-942d-145d1798fb5e.jsonl |  2 --
 .../ux-audit/.omc/state/subagent-tracking.json     |  7 ------
 frontend/src/.claude/scheduled_tasks.lock          |  1 -
 ...play-b22f9f85-36a5-4637-a3ca-ac270fc45a52.jsonl |  1 -
 .../checkpoint-2026-05-06T19-38-07-730Z.json       | 16 --------------
 frontend/src/.omc/state/last-tool-error.json       |  7 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 .../session-started.json                           |  6 ------
 frontend/src/.omc/state/subagent-tracking.json     |  7 ------
 ...play-f31099ce-ed67-466b-9b63-d24b97706c68.jsonl |  1 -
 .../checkpoint-2026-04-17T22-16-39-076Z.json       | 16 --------------
 workers/.omc/state/idle-notif-cooldown.json        |  3 ---
 workers/.omc/state/last-tool-error.json            |  7 ------
 workers/.omc/state/subagent-tracking.json          |  7 ------
 24 files changed, 17 insertions(+), 149 deletions(-)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XcbQuvMH' (errno=Operation not permitted)
2026-09-10 21:35:28.798 xcodebuild[55537:134079202]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:28.971 xcodebuild[55537:134079195] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tcKCTNBk' (errno=Operation not permitted)
2026-09-10 21:35:29.485 xcodebuild[55564:134079481]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:35:29.640 xcodebuild[55564:134079477] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

hook: PostToolUse
hook: PostToolUse Completed
**Planning direct file access and grep usage**
exec
/bin/zsh -lc 'grep -n -E "handleCaseMutationQueue|markAggregatesDirty|rebuildAggregates|scheduled|AGGREGATE_REBUILD|catalog_summary|getStats" workers/cloudflare-native.js workers/storage/cloudflare.js wrangler.toml config/wrangler-cloudflare-native.toml.example workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/*aggregate* docs/ops/aggregate-rebuild-cost-guard.md' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/cloudflare-native.js:104:async function handleCaseMutationQueue(batch, env) {
workers/cloudflare-native.js:137: * Queue batches only mark the aggregates dirty; this scheduled handler decides
workers/cloudflare-native.js:144:    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
workers/cloudflare-native.js:153:  const result = await stores.caseStore.rebuildAggregates();
workers/cloudflare-native.js:182:  await stores.caseStore.markAggregatesDirty();
workers/cloudflare-native.js:184:    minIntervalSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_FALLBACK_SECONDS, DEFAULT_FALLBACK_INTERVAL_SECONDS),
workers/cloudflare-native.js:187:  await stores.caseStore.rebuildAggregates();
workers/cloudflare-native.js:258:    await handleCaseMutationQueue(batch, env);
workers/cloudflare-native.js:260:  async scheduled(event, env) {
workers/storage/cloudflare.js:758:  async getStats({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
workers/storage/cloudflare.js:774:      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
workers/storage/cloudflare.js:856:      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
workers/storage/cloudflare.js:990:   * work only marks the aggregates dirty (markAggregatesDirty) and the
workers/storage/cloudflare.js:991:   * scheduled handler coalesces those marks into at most one rebuild per
workers/storage/cloudflare.js:996:  async rebuildAggregates() {
workers/storage/cloudflare.js:1002:      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/storage/cloudflare.js:1011:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1013:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1071:    // Bookkeeping lives in catalog_summary itself: the rebuild's own DELETE
workers/storage/cloudflare.js:1072:    // clears the dirty flag, and getStats only reads total_cases/with_full_text,
workers/storage/cloudflare.js:1075:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_dirty', 0, ?`).bind(now),
workers/storage/cloudflare.js:1076:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_last_at', ?, ?`)
workers/storage/cloudflare.js:1087:  async markAggregatesDirty() {
workers/storage/cloudflare.js:1088:    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1096:   * Rate-limit decision for the scheduled handler: rebuild only when the
workers/storage/cloudflare.js:1105:      "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key IN ('rebuild_dirty', 'rebuild_last_at')",
wrangler.toml:95:AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
wrangler.toml:99:# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
config/wrangler-cloudflare-native.toml.example:56:AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
config/wrangler-cloudflare-native.toml.example:60:# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
workers/__tests__/cloudflare-native-queue.test.js:30:      markAggregatesDirty: vi.fn(async () => true),
workers/__tests__/cloudflare-native-queue.test.js:32:      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
workers/__tests__/cloudflare-native-queue.test.js:85:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:86:    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
workers/__tests__/cloudflare-native-queue.test.js:120:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:121:    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
workers/__tests__/cloudflare-native-queue.test.js:134:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:135:    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
workers/__tests__/cloudflare-native-queue.test.js:146:    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });
workers/__tests__/cloudflare-native-queue.test.js:148:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:150:    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledOnce();
workers/__tests__/cloudflare-native-queue.test.js:161:    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
workers/__tests__/cloudflare-native-queue.test.js:174:    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
workers/__tests__/cloudflare-native-queue.test.js:175:    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:7:  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:63:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:67:    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:77:    await stores.caseStore.markAggregatesDirty();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:135:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:148:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:164:    await stores.caseStore.rebuildAggregates();
docs/ops/aggregate-rebuild-cost-guard.md:11:- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
docs/ops/aggregate-rebuild-cost-guard.md:13:- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
docs/ops/aggregate-rebuild-cost-guard.md:14:  (`aggregate_*`, `catalog_summary`, `filter_options`) by scanning the whole
docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`. New `scheduled()` handler runs the rebuild at most once per interval. |
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()` and `aggregatesNeedRebuild({ minIntervalSeconds })`. `rebuildAggregates()` now clears `rebuild_dirty` and stamps `rebuild_last_at` as part of its own statement set. |
docs/ops/aggregate-rebuild-cost-guard.md:32:| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]` and `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`. |
docs/ops/aggregate-rebuild-cost-guard.md:34:| `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
docs/ops/aggregate-rebuild-cost-guard.md:37:State lives in `catalog_summary` (`summary_key` is the primary key) under the
docs/ops/aggregate-rebuild-cost-guard.md:39:`DELETE FROM catalog_summary` clears the dirty flag, and `getStats()` reads only
docs/ops/aggregate-rebuild-cost-guard.md:51:`AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` is the single knob. Raising it to 900
docs/ops/aggregate-rebuild-cost-guard.md:62:   (or add the `[triggers]` block and `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS`
docs/ops/aggregate-rebuild-cost-guard.md:82:Revert the one-line consumer change (`markAggregatesDirty()` →
docs/ops/aggregate-rebuild-cost-guard.md:83:`rebuildAggregates()`); no data migration or schema change is involved.

hook: PostToolUse
hook: PostToolUse Completed
**Planning selective sed line extractions**
exec
/bin/zsh -lc "sed -n '80,205p' workers/cloudflare-native.js
sed -n '240,272p' workers/cloudflare-native.js
sed -n '970,1135p' workers/storage/cloudflare.js
sed -n '1,240p' workers/__tests__/cloudflare-native-queue.test.js
sed -n '1,280p' workers/__tests__/cloudflare-native-scheduled-rebuild.test.js
sed -n '1,240p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
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
  const result = await stores.caseStore.rebuildAggregates();
  console.log(JSON.stringify({
    event: "cloudflare.aggregate_rebuild_completed",
    reason: decision.reason,
    min_interval_seconds: minIntervalSeconds,
    duration_ms: Date.now() - startedAt,
    rebuilt_at: result?.rebuilt_at ?? null,
  }));
  return { ...decision, ...result };
}

const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;

function positiveIntOr(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const fallback = await stores.caseStore.aggregatesNeedRebuild({
    minIntervalSeconds: positiveIntOr(env?.AGGREGATE_REBUILD_FALLBACK_SECONDS, DEFAULT_FALLBACK_INTERVAL_SECONDS),
  });
  if (!fallback?.due) return false;
  await stores.caseStore.rebuildAggregates();
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
  async rebuildAggregates() {
    const now = utcNow();
    const statements = [];
    for (const table of [
      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
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
    // Bookkeeping lives in catalog_summary itself: the rebuild's own DELETE
    // clears the dirty flag, and getStats only reads total_cases/with_full_text,
    // so these keys stay internal.
    statements.push(
      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_dirty', 0, ?`).bind(now),
      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_last_at', ?, ?`)
        .bind(Math.floor(Date.now() / 1000), now),
    );
    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
    return { rebuilt_at: now };
  }

  /**
   * Mark analytics as stale without paying for a rebuild: one row written per
   * queue batch instead of clearing and rewriting 17 tables.
   */
  async markAggregatesDirty() {
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_dirty', 1, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = 1, updated_at = excluded.updated_at`)
      .bind(utcNow()).run();
    return true;
  }

  /**
   * Rate-limit decision for the scheduled handler: rebuild only when the
   * aggregates are dirty and the last rebuild is older than the interval.
   * This is the only guard preventing a bulk import from rewriting the whole
   * summary set thousands of times.
   */
  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
      ? Math.floor(minIntervalSeconds) : 300;
    const current = rows(await this.db.prepare(
      "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key IN ('rebuild_dirty', 'rebuild_last_at')",
    ).all());
    const state = new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
    if (!state.get("rebuild_dirty")) return { due: false, reason: "clean" };
    const lastAt = state.get("rebuild_last_at") || 0;
    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
    if (elapsedSeconds < interval) {
      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
    }
    return { due: true, reason: "dirty", seconds_since_last_rebuild: lastAt > 0 ? elapsedSeconds : null };
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
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledOnce();
  });

  it("defaults the fallback window to an hour when unset", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600 });
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
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
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledOnce();
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

  it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
  });
});
import { describe, expect, it, vi } from "vitest";
import { createCloudflareStores } from "../storage/cloudflare.js";

const REBUILD_TABLES = [
  "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
];

function d1(responder = () => []) {
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
        run: async () => ({ meta: { changes: 1 } }),
      };
      prepared.push(statement);
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
  return binding;
}

function env(responder) {
  const catalog = d1(responder);
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

function stateRows(dirty, lastAt) {
  const all = [];
  if (dirty !== undefined) all.push({ summary_key: "rebuild_dirty", value_int: dirty });
  if (lastAt !== undefined) all.push({ summary_key: "rebuild_last_at", value_int: lastAt });
  return all;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("Catalog aggregate rebuild guard", () => {
  it("records staleness with a single upsert instead of a rebuild", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    expect(catalog.prepared).toHaveLength(1);
    const statement = catalog.prepared[0];
    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
    expect(statement.sql).toMatch(/rebuild_dirty/);
    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE/);
    expect(statement.params).toHaveLength(1);
  });

  it("never iterates the corpus when marking dirty", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    expect(catalog.batch).not.toHaveBeenCalled();
    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
  });

  it("reports clean when nothing is stale", async () => {
    const { value } = env(() => stateRows(0, nowSeconds() - 3600));
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toEqual({ due: false, reason: "clean" });
  });

  it("debounces a dirty flag inside the interval", async () => {
    const { value } = env(() => stateRows(1, nowSeconds() - 100));
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("debounced");
    expect(decision.seconds_until_due).toBeGreaterThan(0);
    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
  });

  it("rebuilds when the dirty flag is older than the interval", async () => {
    const { value } = env(() => stateRows(1, nowSeconds() - 400));
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe("dirty");
  });

  it("rebuilds on the first dirty flag when no rebuild timestamp exists", async () => {
    const { value } = env(() => stateRows(1, undefined));
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("falls back to the default interval for invalid input", async () => {
    const { value } = env(() => stateRows(1, nowSeconds() - 60));
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("debounced");
  });

  it("clears and rewrites exactly the documented summary tables", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();

    const deleted = catalog.prepared.filter((s) => /^DELETE FROM /.test(s.sql)).map((s) => s.sql.replace("DELETE FROM ", ""));
    expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
    // 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts + 2 bookkeeping rows.
    expect(catalog.prepared.length).toBe(REBUILD_TABLES.length * 2 + 7 + 2);
  });

  it("clears the dirty flag and stamps the rebuild time in the same statement set", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    const before = nowSeconds();
    await stores.caseStore.rebuildAggregates();
    const after = nowSeconds();

    const dirty = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty'"));
    const stamp = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_at'"));
    expect(dirty).toBeDefined();
    expect(dirty.params).toHaveLength(1);
    expect(stamp).toBeDefined();
    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
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
**Analyzing rebuild batch concurrency issue**
**Planning fix for dirty flag race condition**
exec
/bin/zsh -lc "sed -n '735,875p' workers/storage/cloudflare.js
sed -n '80,110p' wrangler.toml
sed -n '43,72p' config/wrangler-cloudflare-native.toml.example
sed -n '1,115p' docs/ops/aggregate-rebuild-cost-guard.md
grep -n -E \"catalog_summary|summary_key|value_int|updated_at\" scripts/transform_immi_snapshot.py workers/storage/cloudflare.js workers/schema/*.sql workers/*.sql" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 1 in 0ms:
      FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id
      JOIN cases c ON c.case_id = cj.case_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY c.year DESC, c.case_id DESC
      LIMIT ?
    `, [...tokens, size]).all());
  }

  async getJudgeCourtBaselines(courtCodes = []) {
    const values = [...new Set(courtCodes.map(String).filter(Boolean))];
    if (!values.length) return [];
    if (values.length > D1_MAX_BOUND_PARAMETERS - 1) {
      throw new StorageBoundaryError("too many judge courts", { code: "invalid_filter", status: 400 });
    }
    const placeholders = values.map(() => "?").join(",");
    return rows(await bindAll(this.db, `
      SELECT court_code, outcome, SUM(case_count) AS cnt
      FROM aggregate_court_year_outcome
      WHERE court_code IN (${placeholders})
      GROUP BY court_code, outcome
    `, values).all());
  }

  async getStats({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
    if (court || yearFrom || yearTo) {
      const scope = await this.analyticsRateRows({ court, yearFrom, yearTo });
      const recent = await bindAll(this.db, `
        SELECT case_id, title, citation, court_code,
               decision_date AS date, outcome
        FROM cases
        WHERE (? = '' OR court_code = ?)
          AND (? = 0 OR year >= ?)
          AND (? = 0 OR year <= ?)
        ORDER BY year DESC, case_id DESC
        LIMIT 5
      `, [court, court, yearFrom, yearFrom, yearTo, yearTo]).all();
      return { scope_rows: scope, recent_cases: rows(recent) };
    }
    const [summary, courts, years, natures, visas, sources, recent] = await Promise.all([
      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
      this.db.prepare("SELECT court_code, SUM(case_count) AS cnt FROM aggregate_court_year_outcome GROUP BY court_code ORDER BY cnt DESC").all(),
      this.db.prepare("SELECT year, SUM(case_count) AS cnt FROM aggregate_court_year_outcome GROUP BY year ORDER BY year ASC").all(),
      this.db.prepare("SELECT case_nature, SUM(case_count) AS cnt FROM aggregate_nature_outcome GROUP BY case_nature ORDER BY cnt DESC LIMIT 60").all(),
      this.db.prepare("SELECT visa_subclass, SUM(case_count) AS cnt FROM aggregate_visa GROUP BY visa_subclass ORDER BY cnt DESC LIMIT 80").all(),
      this.db.prepare("SELECT source, case_count AS cnt FROM aggregate_source ORDER BY cnt DESC").all(),
      this.db.prepare(`
        SELECT case_id, title, citation, court_code,
               decision_date AS date, outcome
        FROM cases
        ORDER BY year DESC, case_id DESC
        LIMIT 5
      `).all(),
    ]);
    const summaryValues = Object.fromEntries(rows(summary).map((row) => [row.summary_key, Number(row.value_int || 0)]));
    const toObject = (items, key) => Object.fromEntries(rows(items).map((row) => [String(row[key]), Number(row.cnt || 0)]));
    return {
      total_cases: summaryValues.total_cases || 0,
      with_full_text: summaryValues.with_full_text || 0,
      courts: toObject(courts, "court_code"), years: toObject(years, "year"),
      natures: toObject(natures, "case_nature"), visa_subclasses: toObject(visas, "visa_subclass"),
      visa_families: {}, sources: toObject(sources, "source"), recent_cases: rows(recent),
    };
  }

  async analyticsConcepts(limit = 20) {
    const size = clampLimit(limit, { fallback: 20, max: 100 });
    return rows(await this.db.prepare(`
      SELECT label AS concept, case_count AS cnt FROM aggregate_concept
      ORDER BY case_count DESC, label ASC LIMIT ?
    `).bind(size).all());
  }

  async analyticsJudges(limit = 20) {
    const size = clampLimit(limit, { fallback: 20, max: 100 });
    return rows(await this.db.prepare(`
      SELECT j.canonical_name AS name, j.case_count AS count,
             COALESCE((SELECT json_group_array(court_code) FROM aggregate_judge_court jc WHERE jc.judge_id = j.judge_id), '[]') AS courts_json
      FROM aggregate_judge j
      ORDER BY j.case_count DESC, j.canonical_name ASC LIMIT ?
    `).bind(size).all());
  }

  async findByIds(caseIds) {
    const ids = [...new Set((caseIds || []).map(assertCaseId))];
    if (ids.length === 0) return [];
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `, [JSON.stringify(ids)]);
    const found = rows(await statement.all());
    const rank = new Map(ids.map((id, index) => [id, index]));
    return found.sort((left, right) => rank.get(left.case_id) - rank.get(right.case_id));
  }

  async guidedPrecedents({ visaSubclass = "", country = "", legalConcepts = [], limit = 50 } = {}) {
    const clauses = [];
    const params = [];
    const visa = String(visaSubclass || "").trim();
    const origin = String(country || "").trim();
    if (visa) {
      if (visa.length > 128) throw new StorageBoundaryError("visa_subclass filter is invalid", { code: "invalid_filter", status: 400 });
      clauses.push("instr(lower(c.visa_subclass), lower(?)) > 0");
      params.push(visa);
    }
    if (origin) {
      if (origin.length > 256) throw new StorageBoundaryError("country filter is invalid", { code: "invalid_filter", status: 400 });
      clauses.push("instr(lower(c.country_of_origin), lower(?)) > 0");
      params.push(origin);
    }
    const concepts = [...new Set((Array.isArray(legalConcepts) ? legalConcepts : [legalConcepts])
      .map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20);
    if (concepts.length) {
      clauses.push(`(${concepts.map(() => `EXISTS (
        SELECT 1 FROM case_concepts cc JOIN concepts gc ON gc.concept_id = cc.concept_id
        WHERE cc.case_id = c.case_id AND lower(gc.label) = lower(?)
      )`).join(" OR ")})`);
      params.push(...concepts);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = clauses.length
      ? Number((await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first())?.total || 0)
      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
    const size = clampLimit(limit, { fallback: 50, max: 200 });
    const results = rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
    return { total, results };
  }

  async guidedJudge(name) {
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 256) return null;
    return this.db.prepare(`
      SELECT canonical_name AS name, case_count
      FROM aggregate_judge
      WHERE instr(lower(canonical_name), lower(?)) > 0
      ORDER BY case_count DESC, canonical_name ASC
      LIMIT 1
    `).bind(name.trim()).first();
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

# Coalesced analytics rebuild: the mutation queue only marks aggregates dirty,
# and this cron performs at most one full rebuild per
# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
# queue consumer again — one rebuild clears and rewrites 17 summary tables
# (~584k written rows), and per-batch rebuilds produced a ~$12k D1 bill.
[triggers]
crons = ["*/5 * * * *"]

# Operator-set secrets only; values never belong in this file:
# CSRF_SECRET, JWT_SECRET_CURRENT, JWT_SECRET_PREVIOUS, JWT_KID_CURRENT,
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
# Minimum seconds between coalesced analytics rebuilds (see [triggers]).
AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
# Safety valve: if the cron trigger is missing or failing, the queue path still
# refreshes aggregates, at most once per this window (never leaves the
# dashboard frozen forever).
AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"

# Coalesced analytics rebuild: the mutation queue only marks aggregates dirty,
# and this cron performs at most one full rebuild per
# AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS. Never trigger the rebuild from the
# queue consumer again — one rebuild clears and rewrites 17 summary tables
# (~584k written rows), and per-batch rebuilds produced a ~$12k D1 bill.
[triggers]
crons = ["*/5 * * * *"]

[[queues.producers]]
binding = "CASE_MUTATION_QUEUE"
queue = "immi-case-mutation-queue"
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
| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval. |
| `workers/storage/cloudflare.js` | New `markAggregatesDirty()` and `aggregatesNeedRebuild({ minIntervalSeconds })`. `rebuildAggregates()` now clears `rebuild_dirty` and stamps `rebuild_last_at` as part of its own statement set. |
| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
| `workers/__tests__/cloudflare-native-queue.test.js` | Asserts the queue path never rebuilds and coalesces 20 mutations into one stale flag. |
| `workers/__tests__/cloudflare-native-scheduled-rebuild.test.js` | New: rebuild/skip/debounce/interval/error behaviour of the scheduled handler. |
| `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` | New: storage-level guard — dirty flag is a single upsert, decision logic, and the exact 17-table rebuild statement set. |

State lives in `catalog_summary` (`summary_key` is the primary key) under the
internal keys `rebuild_dirty` and `rebuild_last_at`. The rebuild's own
`DELETE FROM catalog_summary` clears the dirty flag, and `getStats()` reads only
`total_cases` / `with_full_text`, so the bookkeeping keys never surface in API
responses. No D1 migration is required.

## Cost envelope after the change

| Scenario | Before | After (300 s interval) |
|---|---|---|
| One queue batch | ~584k rows (~$0.58) | 1–2 rows |
| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 4.5B rows ≈ **$4,500** | ≤ 48 rebuilds ≈ 28M rows ≈ **$28** |
| Dashboard freshness | per batch | ≤ 5 minutes stale |
| Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 14M rows/day ≈ **$14/day** |

Two knobs, both operator-side vars:

- `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (default 300) — the cron's own
  debounce. Raising it to 900 cuts a full import to about $10.
- `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
  queue path only reaches for it when the aggregates stay dirty longer than this
  window, i.e. when the cron trigger is absent or failing. With a working cron
  the last rebuild is always younger than the cron period, so the valve never
  opens.

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

## Verification checklist

- [ ] Cron trigger present and firing every 5 minutes.
- [ ] After a mutation, `d1 insights immi-catalog --sort-by writes --time-period 1d`
      shows the rebuild statements running a handful of times per hour, not per batch.
- [ ] `/api/v1/...` dashboard totals update within ~5 minutes of a mutation.
- [ ] D1 rows written per day returns to a low baseline (monitor with the local
      `d1_usage_watchdog.py` job or the `d1AnalyticsAdaptiveGroups` API).
- [ ] No `cloudflare.aggregate_rebuild_fallback` entries in Worker logs — their
      presence means the cron trigger is not draining the dirty flag.

## Rollback

Revert the one-line consumer change (`markAggregatesDirty()` →
`rebuildAggregates()`); no data migration or schema change is involved.
Observed symptom to watch for before rolling back: a dashboard whose totals stop
advancing — that means the cron trigger is missing, not that the queue path
should rebuild again.
zsh:5: no matches found: workers/schema/*.sql

hook: PostToolUse
hook: PostToolUse Completed
**Planning grep-based search approach**
exec
/bin/zsh -lc "grep -n -E \"catalog_summary|summary_key|value_int|updated_at\" scripts/transform_immi_snapshot.py
sed -n '1,220p' scripts/transform_immi_snapshot.py
grep -n -E \"CREATE TABLE.*catalog_summary|catalog_summary\" workers/schema.sql workers/storage/schema.sql workers/cloudflare-schema.sql workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 2 in 0ms:
254:        updated = normalise_timestamp(row.get("updated_at"), created)
282:              content_key,content_sha256,content_size,semantic_ready,created_at,updated_at
294:            output.catalog.execute("INSERT OR IGNORE INTO judges (judge_id,canonical_name,created_at,updated_at) VALUES (?,?,?,?)", (judge_id, label, created, updated))
325:    catalog.execute("DELETE FROM catalog_summary")
337:        INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
345:        INSERT INTO aggregate_source (source,case_count,updated_at)
351:        "INSERT INTO catalog_summary (summary_key,value_int,updated_at) VALUES (?,?,?)",
384:        INSERT INTO aggregate_country (country,case_count,updated_at)
393:        INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
402:        INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
500:        updated = normalise_timestamp(row.get("updated_at"), created)
513:              bio_size, bio_content_type, created_at, updated_at
519:              bio_content_type=excluded.bio_content_type, updated_at=excluded.updated_at
579:        account.execute("INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at) VALUES (?,?,?,?,?)", (required(row.get("id"), "immi_tenants.id").lower(), kind, required(row.get("name"), "immi_tenants.name"), created, created))
586:            "INSERT INTO users (user_id,telegram_id,first_name,last_name,username,photo_url,primary_tenant_id,last_login_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
605:        account.execute("INSERT INTO collections (collection_id,tenant_id,owner_id,title,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", (collection_id, tenant_id, owner_id, required(row.get("name"), "collection.name"), string(row.get("description")), created, normalise_timestamp(row.get("updated_at"), created)))
611:        account.execute("INSERT INTO saved_searches (saved_search_id,tenant_id,owner_id,title,query_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", (required(row.get("id"), "saved_search.id").lower(), required(row.get("tenant_id"), "saved_search.tenant_id").lower(), required(row.get("created_by"), "saved_search.created_by").lower(), required(row.get("name"), "saved_search.name"), canonical_json(parse_jsonish(row.get("filters"), {})), created, created))
629:        account.execute("INSERT INTO council_sessions (session_id,tenant_id,created_by,case_id,title,status,retrieve_code,total_turns,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (session_id, tenant_id.lower(), created_by.lower(), optional_string(row.get("case_id")), string(row.get("title")), string(row.get("status"), "active"), optional_string(row.get("retrieve_code")), int(row.get("total_turns") or 0), created, normalise_timestamp(row.get("updated_at"), created)))
#!/usr/bin/env python3
"""Transform a read-only IMMI NDJSON snapshot into local Cloudflare mirrors.

Input layout (produced only from a fresh, operator-approved source snapshot):

  SNAPSHOT/
    tables/<postgres-table>.ndjson
    artifacts/cases/<case_id>.txt
    artifacts/council/<turn_id>.json   (optional when payload is in the row)

The transformer writes three SQLite files using the actual D1 migrations, an
R2 directory mirror, and per-source-row SHA-256 manifests. It has no network
client and deliberately refuses lossy mappings. Vector generation is a later
Workers AI/Vectorize import phase, so this tool records it as pending rather
than claiming a complete import.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations" / "d1"
SUPPORTED_TABLES = {
    "immigration_cases",
    "immi_users",
    "immi_tenants",
    "immi_tenant_members",
    "immi_tenant_invites",
    "immi_collections",
    "immi_saved_searches",
    "immi_refresh_sessions",
    "council_sessions",
    "council_turns",
    "pipeline_runs",
    "extraction_audit",
    "judge_bios",
}
LOWERCASE_SOURCE_IDENTITIES = {
    "immigration_cases", "immi_users", "immi_tenants", "immi_tenant_invites",
    "immi_collections", "immi_saved_searches", "immi_refresh_sessions", "pipeline_runs",
}
SOURCE_ID_FIELDS = {
    "immigration_cases": "case_id",
    "judge_bios": "id",
    "immi_users": "id",
    "immi_tenants": "id",
    "immi_tenant_invites": "id",
    "immi_collections": "id",
    "immi_saved_searches": "id",
    "immi_refresh_sessions": "jti",
    "council_sessions": "session_id",
    "council_turns": "turn_id",
    "pipeline_runs": "run_id",
    "extraction_audit": "id",
}


class TransformError(RuntimeError):
    """A fail-closed source/target mapping error."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256_text(value: str | bytes) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def required(value: Any, label: str) -> str:
    result = optional_string(value)
    if result is None:
        raise TransformError(f"{label} is required for a lossless transform")
    return result


def normalise_timestamp(value: Any, fallback: str) -> str:
    return optional_string(value) or fallback


def load_rows(snapshot: Path, table: str) -> list[dict[str, Any]]:
    legacy_path = snapshot / "tables" / f"{table}.ndjson"
    if legacy_path.exists():
        paths = [legacy_path]
    else:
        table_dir = snapshot / "tables" / table
        paths = sorted(table_dir.glob("part-*.ndjson")) if table_dir.is_dir() else []
    if not paths:
        return []
    rows: list[dict[str, Any]] = []
    for path in paths:
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise TransformError(f"{path}:{line_no}: invalid JSON: {exc.msg}") from exc
            if not isinstance(row, dict):
                raise TransformError(f"{path}:{line_no}: every NDJSON row must be an object")
            rows.append(row)
    return rows


def source_identity(table: str, row: dict[str, Any], ordinal: int) -> str:
    if table == "immi_tenant_members":
        return f"{required(row.get('tenant_id'), 'membership.tenant_id').lower()}:{required(row.get('user_id'), 'membership.user_id').lower()}"
    key = SOURCE_ID_FIELDS.get(table)
    if key and optional_string(row.get(key)):
        value = required(row[key], f"{table}.{key}")
        return value.lower() if table in LOWERCASE_SOURCE_IDENTITIES else value
    return f"line-{ordinal}"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(payload) + "\n", encoding="utf-8")


def parse_jsonish(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return default


def split_labels(value: Any) -> list[str]:
    values = value if isinstance(value, list) else string(value).replace(";", ",").split(",")
    labels = [string(item).strip() for item in values if string(item).strip()]
    return list(dict.fromkeys(labels))


def parse_case_ids(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [string(item) for item in value]
    parsed = parse_jsonish(value, None)
    if isinstance(parsed, list):
        return [string(item) for item in parsed]
    text = string(value).strip()
    if text.startswith("{") and text.endswith("}"):
        return [item.strip().strip('"') for item in text[1:-1].split(",") if item.strip()]
    raise TransformError("collection.case_ids is not a JSON or PostgreSQL text array")


def split_utf8(text: str, maximum: int = 128 * 1024) -> list[str]:
    encoded = text.encode("utf-8")
    chunks: list[str] = []
    start = 0
    while start < len(encoded):
        end = min(start + maximum, len(encoded))
        while end > start:
            try:
                chunks.append(encoded[start:end].decode("utf-8"))
                break
            except UnicodeDecodeError:
                end -= 1
        if end == start:
            raise TransformError("unable to split UTF-8 case text under the D1 chunk limit")
        start = end
    return chunks


def exec_migration(connection: sqlite3.Connection, name: str) -> None:
    files = {
        "catalog": MIGRATIONS / "catalog" / "0001_catalog.sql",
        "account": MIGRATIONS / "account" / "0001_account.sql",
        "ops": MIGRATIONS / "ops" / "0001_ops.sql",
    }
    migration = files[name]
    connection.executescript(migration.read_text(encoding="utf-8"))
    connection.execute("PRAGMA foreign_keys = ON")


@dataclass
class Output:
    root: Path
    catalog: sqlite3.Connection
    account: sqlite3.Connection
    ops: sqlite3.Connection
    r2: Path
    snapshot_time: str


def create_output(path: Path, snapshot_time: str) -> Output:
    if path.exists():
        raise TransformError(f"output directory already exists: {path}; choose a new path to preserve evidence")
grep: workers/schema.sql: No such file or directory
grep: workers/storage/schema.sql: No such file or directory
grep: workers/cloudflare-schema.sql: No such file or directory

hook: PostToolUse
hook: PostToolUse Completed
**Transforming lines 315-370 with schema migration**
exec
/bin/zsh -lc "sed -n '310,370p' scripts/transform_immi_snapshot.py
sed -n '1,260p' migrations/d1/catalog/0001_catalog.sql
grep -n -E \"catalog_summary|rebuild_dirty|rebuild_last_at\" migrations/d1/catalog/0001_catalog.sql scripts/transform_immi_snapshot.py workers/storage/cloudflare.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
        count += 1
    output.catalog.commit()
    return count


def rebuild_catalog_aggregates(output: Output) -> None:
    """Materialise every public aggregate once during import, never per request."""
    catalog = output.catalog
    catalog.execute("DELETE FROM aggregate_court_year_outcome")
    catalog.execute("DELETE FROM aggregate_visa")
    catalog.execute("DELETE FROM aggregate_country")
    catalog.execute("DELETE FROM aggregate_judge")
    catalog.execute("DELETE FROM aggregate_judge_court")
    catalog.execute("DELETE FROM aggregate_nature_outcome")
    catalog.execute("DELETE FROM aggregate_source")
    catalog.execute("DELETE FROM catalog_summary")
    catalog.execute("DELETE FROM aggregate_concept")
    catalog.execute("DELETE FROM aggregate_scope")
    catalog.execute("DELETE FROM aggregate_court_nature_outcome")
    catalog.execute("DELETE FROM aggregate_concept_scope")
    catalog.execute("DELETE FROM aggregate_concept_pair")
    catalog.execute("DELETE FROM aggregate_judge_outcome")
    catalog.execute("DELETE FROM aggregate_judge_year")
    catalog.execute("DELETE FROM aggregate_judge_visa")
    catalog.execute("DELETE FROM filter_options")
    catalog.execute(
        """
        INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
        SELECT court_code, year, outcome, COUNT(*), ?
        FROM cases GROUP BY court_code, year, outcome
        """,
        (output.snapshot_time,),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_source (source,case_count,updated_at)
        SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source
        """,
        (output.snapshot_time,),
    )
    catalog.executemany(
        "INSERT INTO catalog_summary (summary_key,value_int,updated_at) VALUES (?,?,?)",
        (
            ("total_cases", catalog.execute("SELECT COUNT(*) FROM cases").fetchone()[0], output.snapshot_time),
            ("with_full_text", catalog.execute("SELECT COUNT(*) FROM cases WHERE content_key <> ''").fetchone()[0], output.snapshot_time),
        ),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
        SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        WHERE c.court_code <> ''
        GROUP BY cj.judge_id, c.court_code
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
        SELECT case_nature, outcome, COUNT(*)
        FROM cases WHERE case_nature <> ''
-- IMMI_CATALOG_DB: public case metadata, relationships, FTS5, and aggregates.
-- Full source text is held in R2; text chunks are capped at 128 KiB so every
-- D1 row remains well below the 256 KiB migration guard.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY CHECK(length(case_id) = 12 AND case_id NOT GLOB '*[^0-9a-f]*'),
  citation TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  court_code TEXT NOT NULL DEFAULT '',
  decision_date TEXT NOT NULL DEFAULT '',
  year INTEGER,
  outcome TEXT NOT NULL DEFAULT '',
  visa_type TEXT NOT NULL DEFAULT '',
  visa_subclass TEXT NOT NULL DEFAULT '',
  visa_class_code TEXT NOT NULL DEFAULT '',
  visa_subclass_number TEXT NOT NULL DEFAULT '',
  applicant_name TEXT NOT NULL DEFAULT '',
  respondent TEXT NOT NULL DEFAULT '',
  country_of_origin TEXT NOT NULL DEFAULT '',
  hearing_date TEXT NOT NULL DEFAULT '',
  is_represented INTEGER,
  representative TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  case_nature TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  catchwords TEXT NOT NULL DEFAULT '',
  legislation TEXT NOT NULL DEFAULT '',
  text_snippet TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  user_notes TEXT NOT NULL DEFAULT '',
  visa_outcome_reason TEXT NOT NULL DEFAULT '',
  legal_test_applied TEXT NOT NULL DEFAULT '',
  last_extraction_run_id TEXT,
  extraction_confidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extraction_confidence_json)),
  content_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  content_size INTEGER NOT NULL CHECK(content_size >= 0),
  semantic_ready INTEGER NOT NULL DEFAULT 0 CHECK(semantic_ready IN (0, 1)),
  vector_mutation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cases_court_year_idx ON cases(court_code, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_filter_idx ON cases(outcome, visa_subclass, source, year DESC);
CREATE INDEX IF NOT EXISTS cases_visa_type_idx ON cases(visa_type, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_semantic_ready_idx ON cases(semantic_ready, updated_at);

CREATE TABLE IF NOT EXISTS case_text_chunks (
  case_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
  content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) > 0 AND length(CAST(content AS BLOB)) <= 131072),
  content_sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, chunk_index),
  FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS case_text_fts USING fts5(
  case_id UNINDEXED,
  chunk_index UNINDEXED,
  content,
  content = 'case_text_chunks',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS case_text_chunks_ai AFTER INSERT ON case_text_chunks BEGIN
  INSERT INTO case_text_fts(rowid, case_id, chunk_index, content)
  VALUES (new.rowid, new.case_id, new.chunk_index, new.content);
END;
CREATE TRIGGER IF NOT EXISTS case_text_chunks_au AFTER UPDATE ON case_text_chunks BEGIN
  INSERT INTO case_text_fts(case_text_fts, rowid, case_id, chunk_index, content)
  VALUES ('delete', old.rowid, old.case_id, old.chunk_index, old.content);
  INSERT INTO case_text_fts(rowid, case_id, chunk_index, content)
  VALUES (new.rowid, new.case_id, new.chunk_index, new.content);
END;
CREATE TRIGGER IF NOT EXISTS case_text_chunks_ad AFTER DELETE ON case_text_chunks BEGIN
  INSERT INTO case_text_fts(case_text_fts, rowid, case_id, chunk_index, content)
  VALUES ('delete', old.rowid, old.case_id, old.chunk_index, old.content);
END;

CREATE TABLE IF NOT EXISTS judges (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  -- Stable source identity makes every legacy judge_bios row reconcilable
  -- without relying on a display-name match.
  source_bio_id TEXT UNIQUE,
  bio_key TEXT,
  bio_sha256 TEXT,
  bio_size INTEGER CHECK(bio_size IS NULL OR bio_size >= 0),
  bio_content_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_judges (
  case_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  PRIMARY KEY (case_id, judge_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE INDEX IF NOT EXISTS case_judges_judge_idx ON case_judges(judge_id, case_id);

CREATE TABLE IF NOT EXISTS concepts (
  concept_id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS case_concepts (
  case_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (case_id, concept_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);
CREATE TABLE IF NOT EXISTS visas (
  visa_id TEXT PRIMARY KEY,
  subclass TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS case_visas (
  case_id TEXT NOT NULL,
  visa_id TEXT NOT NULL,
  PRIMARY KEY (case_id, visa_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (visa_id) REFERENCES visas(visa_id)
);

CREATE TABLE IF NOT EXISTS filter_options (
  filter_name TEXT NOT NULL,
  option_value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (filter_name, option_value)
);
CREATE TABLE IF NOT EXISTS aggregate_court_year_outcome (
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (court_code, year, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_visa (
  visa_subclass TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (visa_subclass, court_code, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_country (
  country TEXT PRIMARY KEY,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aggregate_judge (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE INDEX IF NOT EXISTS aggregate_judge_name_idx ON aggregate_judge(canonical_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS aggregate_judge_court (
  judge_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, court_code),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE TABLE IF NOT EXISTS aggregate_nature_outcome (
  case_nature TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (case_nature, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_source (
  source TEXT PRIMARY KEY,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_summary (
  summary_key TEXT PRIMARY KEY,
  value_int INTEGER NOT NULL CHECK(value_int >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aggregate_concept (
  concept_id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);

-- Dimension-complete, queue-maintained aggregates used by analytics reads.
-- Requests must never scan the full `cases` corpus; empty strings/zero are
-- the canonical representation for nullable source dimensions.
CREATE TABLE IF NOT EXISTS aggregate_scope (
  court_code TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT '',
  visa_subclass TEXT NOT NULL DEFAULT '',
  visa_type TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  case_nature TEXT NOT NULL DEFAULT '',
  country_of_origin TEXT NOT NULL DEFAULT '',
  has_full_text INTEGER NOT NULL DEFAULT 0 CHECK(has_full_text IN (0, 1)),
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (court_code, year, outcome, visa_subclass, visa_type, source, case_nature, country_of_origin, has_full_text)
);
CREATE INDEX IF NOT EXISTS aggregate_scope_year_idx
  ON aggregate_scope(year, court_code, outcome);
CREATE INDEX IF NOT EXISTS aggregate_scope_nature_idx
  ON aggregate_scope(case_nature, court_code, year);
CREATE INDEX IF NOT EXISTS aggregate_scope_visa_idx
  ON aggregate_scope(visa_subclass, court_code, year);
CREATE INDEX IF NOT EXISTS aggregate_scope_source_idx
  ON aggregate_scope(source, court_code, year);

CREATE TABLE IF NOT EXISTS aggregate_court_nature_outcome (
  court_code TEXT NOT NULL,
  case_nature TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (court_code, case_nature, outcome)
);

CREATE TABLE IF NOT EXISTS aggregate_concept_scope (
  concept_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (concept_id, court_code, year, outcome),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);
CREATE INDEX IF NOT EXISTS aggregate_concept_scope_year_idx
  ON aggregate_concept_scope(year, concept_id, court_code);

CREATE TABLE IF NOT EXISTS aggregate_concept_pair (
  concept_id_a TEXT NOT NULL,
  concept_id_b TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (concept_id_a, concept_id_b, court_code, outcome),
  FOREIGN KEY (concept_id_a) REFERENCES concepts(concept_id),
  FOREIGN KEY (concept_id_b) REFERENCES concepts(concept_id)
);

CREATE TABLE IF NOT EXISTS aggregate_judge_outcome (
  judge_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, court_code, outcome),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE TABLE IF NOT EXISTS aggregate_judge_year (
migrations/d1/catalog/0001_catalog.sql:184:CREATE TABLE IF NOT EXISTS catalog_summary (
scripts/transform_immi_snapshot.py:325:    catalog.execute("DELETE FROM catalog_summary")
scripts/transform_immi_snapshot.py:351:        "INSERT INTO catalog_summary (summary_key,value_int,updated_at) VALUES (?,?,?)",
workers/storage/cloudflare.js:774:      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
workers/storage/cloudflare.js:856:      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
workers/storage/cloudflare.js:1002:      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/storage/cloudflare.js:1011:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1013:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1071:    // Bookkeeping lives in catalog_summary itself: the rebuild's own DELETE
workers/storage/cloudflare.js:1075:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_dirty', 0, ?`).bind(now),
workers/storage/cloudflare.js:1076:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at) SELECT 'rebuild_last_at', ?, ?`)
workers/storage/cloudflare.js:1088:    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1089:        VALUES ('rebuild_dirty', 1, ?)
workers/storage/cloudflare.js:1105:      "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key IN ('rebuild_dirty', 'rebuild_last_at')",
workers/storage/cloudflare.js:1108:    if (!state.get("rebuild_dirty")) return { due: false, reason: "clean" };
workers/storage/cloudflare.js:1109:    const lastAt = state.get("rebuild_last_at") || 0;

hook: PostToolUse
hook: PostToolUse Completed
**Assessing queue fallback and rebuild logic**
**Identifying rebuild race condition in fallback**
**Evaluating fallback as intentional design feature**
**Assessing permanent dirty flag observability**
**Analyzing git diff inconsistencies and concurrency**
**Evaluating batch rebuild concurrency risks**
**Planning atomic claim fix for concurrency**
**Designing atomic rebuild versioning scheme**
**Noting initial snapshot consistency post-import**
**Analyzing clock skew impact on scheduling**
**Planning robust D1 timestamp fix**
**Flagging lack of durable failure observability**
**Assessing rebuild race conditions**
**Analyzing concurrency impact on rebuild queue**
**Verifying rebuild trigger after deployment**
**Determining operator config impact**
**Analyzing batch SQL statement counts**
**Identifying atomicity race condition**
**Analyzing race condition in scheduled rebuilds**
**Confirming fallback retry handling as intentional**
**Identifying risky rollback in documentation**
**Assessing rollback safety and fix options**
**Verifying test coverage for rebuild changes**
**Finalizing clickable file:line citation format**
2026-09-10T11:37:27.845909Z ERROR codex_core::tools::router: error=apply_patch verification failed: invalid patch: multiple operations target /Users/david/.codex/memories/MEMORY.md
**Analyzing batch mutation and dirty flag timing**
**Identifying race condition in rebuild process**
**Confirming D1 batch transaction atomicity**
**Assessing failure semantics and state handling**
**Confirming error handling and release safety**
**Drafting findings summary with exact no finding phrase**
**Clarifying queue consumer fallback behavior**
**Identifying rebuild timestamp race condition**
**Analyzing rebuild dirty flag timing impact**
**Confirming documentation rollback details**
codex
- HIGH — [workers/storage/cloudflare.js:1075](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1075): 重建最後會無條件寫入 `rebuild_dirty = 0`。若案件變更及 `markAggregatesDirty()` 發生在所有 aggregate 查詢完成後、但最後 bookkeeping batch 前，新的資料不會進入本次 aggregate，卻會被最後的 `0` 覆蓋；訊息已確認，之後排程判為 clean，儀表板可永久過期。修正：以單調遞增的 generation／epoch 記錄 mutation；重建只確認其開始時觀察到的 generation，若 generation 已變則保留 dirty。

- HIGH — [workers/cloudflare-native.js:147](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:147): `aggregatesNeedRebuild()` 與 `rebuildAggregates()` 間沒有原子 claim 或 lease。兩個重疊的 cron invocation 都可讀到 `due: true`，並各自執行完整的 17-table 重建；由於重建分成多個 D1 batch，還可能互相刪除或造成部分寫入失敗。修正：先以 D1 的條件式更新原子取得 rebuild lease，再執行重建；完成時以同一 generation 規則釋放 lease／保留新 dirty 狀態。

- HIGH — [docs/ops/aggregate-rebuild-cost-guard.md:82](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:82): 文件指定的「rollback」會把 queue consumer 恢復為每 batch 完整重建，直接重新引入此次約 $12,060 的事故機制。修正：改為修復或移除 cron、調高 interval，或加入可停用 scheduled rebuild 的明確設定；不要把 per-batch rebuild 列為可操作 rollback。

- Queue coalescing／acknowledgement：除上述 race 外 no finding；`markAggregatesDirty()` 失敗會阻止 ack 並進入 retry。文件化的一小時 fallback 是有界的例外，不是每 batch 重建。

- Failure semantics：no finding；重建失敗會保留 dirty state 並向 runtime 拋出錯誤，queue fallback 也會重試。

- Bookkeeping data consistency：no finding；`value_int >= 0` 與既有 summary 讀取相容；snapshot transformer 重建完成的 aggregates 沒有 dirty key 時會被視為 clean。

- Test quality：no finding；queue 測試會在恢復無條件 per-batch rebuild 時失敗，storage 與 scheduled 測試也會在移除 interval guard 時失敗。

- First-deploy safety：除不安全 rollback 文件外 no finding；既有資料庫沒有 dirty key 時 cron 不會自行觸發冷重建，缺少 operator cron 時亦有文件化 fallback。

VERDICT: CHANGES-REQUIRED
tokens used
66,155
- HIGH — [workers/storage/cloudflare.js:1075](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/storage/cloudflare.js:1075): 重建最後會無條件寫入 `rebuild_dirty = 0`。若案件變更及 `markAggregatesDirty()` 發生在所有 aggregate 查詢完成後、但最後 bookkeeping batch 前，新的資料不會進入本次 aggregate，卻會被最後的 `0` 覆蓋；訊息已確認，之後排程判為 clean，儀表板可永久過期。修正：以單調遞增的 generation／epoch 記錄 mutation；重建只確認其開始時觀察到的 generation，若 generation 已變則保留 dirty。

- HIGH — [workers/cloudflare-native.js:147](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/workers/cloudflare-native.js:147): `aggregatesNeedRebuild()` 與 `rebuildAggregates()` 間沒有原子 claim 或 lease。兩個重疊的 cron invocation 都可讀到 `due: true`，並各自執行完整的 17-table 重建；由於重建分成多個 D1 batch，還可能互相刪除或造成部分寫入失敗。修正：先以 D1 的條件式更新原子取得 rebuild lease，再執行重建；完成時以同一 generation 規則釋放 lease／保留新 dirty 狀態。

- HIGH — [docs/ops/aggregate-rebuild-cost-guard.md:82](/Volumes/Storm%20Breaker/Developer/IMMI-Case-/docs/ops/aggregate-rebuild-cost-guard.md:82): 文件指定的「rollback」會把 queue consumer 恢復為每 batch 完整重建，直接重新引入此次約 $12,060 的事故機制。修正：改為修復或移除 cron、調高 interval，或加入可停用 scheduled rebuild 的明確設定；不要把 per-batch rebuild 列為可操作 rollback。

- Queue coalescing／acknowledgement：除上述 race 外 no finding；`markAggregatesDirty()` 失敗會阻止 ack 並進入 retry。文件化的一小時 fallback 是有界的例外，不是每 batch 重建。

- Failure semantics：no finding；重建失敗會保留 dirty state 並向 runtime 拋出錯誤，queue fallback 也會重試。

- Bookkeeping data consistency：no finding；`value_int >= 0` 與既有 summary 讀取相容；snapshot transformer 重建完成的 aggregates 沒有 dirty key 時會被視為 clean。

- Test quality：no finding；queue 測試會在恢復無條件 per-batch rebuild 時失敗，storage 與 scheduled 測試也會在移除 interval guard 時失敗。

- First-deploy safety：除不安全 rollback 文件外 no finding；既有資料庫沒有 dirty key 時 cron 不會自行觸發冷重建，缺少 operator cron 時亦有文件化 fallback。

VERDICT: CHANGES-REQUIRED
