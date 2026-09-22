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
session id: 01a08b21-a1d9-7d22-b4a7-3e6f4d014dcd
--------
user
You are re-reviewing a fix pass on a Cloudflare Worker change. Review only — do not modify anything.

HARD RULES:
- Do NOT load or use any installed skill, plugin, MCP or graph tool. Do NOT run builds or tests. Do NOT write files.
- You may only read: `cat`, `sed -n`, `git diff`, `git show`, `grep`.
- Read the changed regions only; answer directly, no tool-tour narration.

Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
Branch: fix/aggregate-rebuild-debounce (vs origin/main @ 42826a3)

A previous review of this branch found three HIGH issues, which have now been fixed. Verify the fixes and look for NEW problems introduced by them.

PREVIOUS FINDINGS AND THE FIXES APPLIED
1. HIGH — `rebuildAggregates()` unconditionally wrote `rebuild_dirty = 0` at the end, so a mutation landing between the aggregate scan and the final bookkeeping write was discarded and the dashboard could stay stale forever.
   Fix: bookkeeping is now a monotonic generation. `markAggregatesDirty()` increments `rebuild_generation` (`ON CONFLICT ... SET value_int = catalog_summary.value_int + 1`); `rebuildAggregates()` snapshots `rebuild_generation` BEFORE scanning and writes `rebuild_applied_generation` = that snapshot at the end; "dirty" is `rebuild_generation > rebuild_applied_generation`. The rebuild's `DELETE FROM catalog_summary` now excludes the four bookkeeping keys.
2. HIGH — no atomic claim between `aggregatesNeedRebuild()` and `rebuildAggregates()`, so two overlapping invocations could both rebuild and interleave 17-table DELETEs.
   Fix: `claimRebuildLease()` is a conditional upsert (`... DO UPDATE SET value_int = excluded.value_int ... WHERE catalog_summary.value_int < ?`) whose `changes` value decides ownership; `rebuildUnderLease()` in the worker releases the lease in a `finally`, with a lease length of `max(600, interval * 2)`.
3. HIGH — the documented rollback ("revert the consumer to `rebuildAggregates()`") re-introduced the incident mechanism.
   Fix: `docs/ops/aggregate-rebuild-cost-guard.md` now forbids that, and lists safe levers (fix the cron, raise the interval, disable the cron and rely on the bounded fallback).

VERIFY SPECIFICALLY (be adversarial, cite file:line)
- Is the generation snapshot really taken before any aggregate statement executes, on every path (scheduled handler, queue fallback, any other caller)?
- Can any interleaving still lose a mutation, or leave `rebuild_generation` reset/duplicated (e.g. through the rebuild's DELETE, the `INSERT OR REPLACE` of bookkeeping rows, or `scripts/transform_immi_snapshot.py` wiping `catalog_summary`)?
- Is the lease genuinely mutual-exclusion under D1/SQLite semantics, including lease expiry mid-run, a crashed invocation, and the release-in-`finally` path (does a failed rebuild release the lease and then immediately retry, or can it wedge)?
- Does the queue-side fallback stay bounded (at most one rebuild per `AGGREGATE_REBUILD_FALLBACK_SECONDS`) and does it share the lease with the cron?
- Are the new tests able to fail if the fixes are reverted? Name the specific test per invariant.

ALREADY VERIFIED BY THE AUTHOR (do not re-derive, do not report as gaps)
- `npm run test:workers`: 27 files / 372 tests pass (re-run twice).
- `node scripts/check_cloudflare_native_bundle.mjs` passes; the native-config gate output is unchanged vs origin/main.
- A real-SQLite harness executes the captured rebuild/dirty/decision/lease SQL against `migrations/d1/catalog/0001_catalog.sql` and replays the mid-rebuild race deterministically (14/14 checks).
- The Python suite cannot run locally (project dependency set is split across requirements-app/extractor and not installed); it does not exercise this JS change.
- `tests/auth-telegram` has a pre-existing flaky timestamp-boundary test, unrelated to this change.

NOT IN SCOPE: formatting, naming, comments, the surrounding legacy storage layer, or anything outside the changed hunks.

Output: findings HIGH → LOW with file:line, severity, issue, concrete fix; state "no finding" for any area above that is clean. Then one final line: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T11:43:53.208761Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:43:53.729825Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T11:43:55.034654Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:43:55.108512Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
codex
我會只讀取差異區段與必要上下文，逐項核對世代、租約、佇列回退與測試可回歸性；不會執行測試或修改任何檔案。
exec
/bin/zsh -lc 'git diff --unified=80 origin/main...HEAD -- workers/proxy.js workers/wrangler.toml workers/*.toml scripts/transform_immi_snapshot.py docs/ops/aggregate-rebuild-cost-guard.md tests 2>/dev/null' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 1 in 0ms:
zsh:1: no matches found: workers/*.toml

hook: PostToolUse
hook: PostToolUse Completed
**Adjusting commands to exclude glob**
exec
/bin/zsh -lc 'git diff --name-only origin/main...HEAD' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 3798ms:
2026-09-10 21:44:09.272 xcodebuild[96389:134246570]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:09.586 xcodebuild[96389:134246569] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-AFc8kep7' (errno=Operation not permitted)
2026-09-10 21:44:10.281 xcodebuild[96425:134247111]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:10.492 xcodebuild[96425:134247109] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

hook: PostToolUse
hook: PostToolUse Completed
**Adjusting git diff command for branch comparison**
exec
/bin/zsh -lc 'git show --stat --oneline 42826a3' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 2199ms:
2026-09-10 21:44:17.031 xcodebuild[96538:134248528]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:17.234 xcodebuild[96538:134248526] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-TSa5NTPL' (errno=Operation not permitted)
2026-09-10 21:44:17.777 xcodebuild[96547:134248596]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:17.955 xcodebuild[96547:134248595] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
42826a3 chore: untrack the stray agent dirs the first pass missed
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

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing git diff and commit discrepancies**
**Evaluating staged changes with git diff --cached**
exec
/bin/zsh -lc 'git diff --cached --name-only' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 2070ms:
2026-09-10 21:44:26.628 xcodebuild[96738:134250268]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:26.831 xcodebuild[96738:134250233] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-SkuE1zue' (errno=Operation not permitted)
2026-09-10 21:44:27.359 xcodebuild[97227:134251111]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:27.556 xcodebuild[97227:134251093] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.

hook: PostToolUse
hook: PostToolUse Completed
**Checking recent commits beyond 428**
exec
/bin/zsh -lc 'git show --no-patch --oneline --decorate HEAD && git show --no-patch --oneline --decorate fix/aggregate-rebuild-debounce && git show --no-patch --oneline --decorate origin/main' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 6231ms:
2026-09-10 21:44:33.348 xcodebuild[97433:134252322]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:33.542 xcodebuild[97433:134252321] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-eIIXMsJW' (errno=Operation not permitted)
2026-09-10 21:44:34.060 xcodebuild[97442:134252415]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:34.225 xcodebuild[97442:134252414] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
42826a3 (HEAD -> fix/aggregate-rebuild-debounce, origin/main, origin/HEAD) chore: untrack the stray agent dirs the first pass missed
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-uG8MpDTy' (errno=Operation not permitted)
2026-09-10 21:44:35.255 xcodebuild[97457:134252547]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:35.416 xcodebuild[97457:134252546] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-nbdGfU0v' (errno=Operation not permitted)
2026-09-10 21:44:35.890 xcodebuild[97465:134252584]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:36.070 xcodebuild[97465:134252583] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
42826a3 (HEAD -> fix/aggregate-rebuild-debounce, origin/main, origin/HEAD) chore: untrack the stray agent dirs the first pass missed
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VabL89OZ' (errno=Operation not permitted)
2026-09-10 21:44:37.180 xcodebuild[97480:134252773]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:37.327 xcodebuild[97480:134252772] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ONt504K2' (errno=Operation not permitted)
2026-09-10 21:44:37.937 xcodebuild[97499:134252973]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:38.141 xcodebuild[97499:134252972] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
42826a3 (HEAD -> fix/aggregate-rebuild-debounce, origin/main, origin/HEAD) chore: untrack the stray agent dirs the first pass missed

hook: PostToolUse
hook: PostToolUse Completed
**Investigating untracked file changes**
**Verifying commit range for changes**
exec
/bin/zsh -lc "git show --format='%H %s' --no-patch HEAD~20..HEAD" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 2032ms:
2026-09-10 21:44:47.486 xcodebuild[98303:134255491]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:47.695 xcodebuild[98303:134255490] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Spos0vH8' (errno=Operation not permitted)
2026-09-10 21:44:48.232 xcodebuild[98325:134255755]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:44:48.389 xcodebuild[98325:134255735] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
42826a3032129468d8022970b16f2aa7ce1c0ddf chore: untrack the stray agent dirs the first pass missed
9cea3c4f9c92aea895e5d79d9a54786161f8fcce ci: stop ignoring the separation preflight suite
d02d3fc4538c02fafd992f50a41add4b700bff3a test: skip separation preflight when the manifest is absent
be676164fc0cc4ebcadc663d4e0ce8250c3555f0 docs: make test also runs the Worker suite
f19e5f403ff121416c435fae5b7b7135a39a649a fix: install root node_modules in make install
60c6e98ec934efce7a44ed463f91872298445e1b chore: untrack OMC agent runtime state
17a9f11843dcf632b3693a1c8c9b0403718d4439 merge: dependency hygiene — align make install with CI, fix frontend peer conflict
fe996bee03954c1e25ec9f1a744ea937687506a0 chore: ignore Claude Code worktrees
114e88b6cc12c1d119ba73f6d729fd983962e14b fix: sync collection order during render instead of in an effect
a8ee788171d2d7f93acddece70c145796592fc81 chore: remove stale postgres lock entry
2217b9a445e16eb86fb14fd1347df542a8c9a53b ci: enforce frontend peer dependencies
ce1154dd481143ac71d9f805c0bc51869119b7e6 chore: update React Hooks ESLint plugin
845638f9aa06c470b72b26055a8592d0e858c968 fix: align make install with the CI python dependency set
f0a4517439ede51ad7ce8956c2f65c34c3e88321 ci: move step comment above name key to satisfy boundary-gate extractor
a8db5d2696c4293939204fc507c999e29b1bb53b ci: exclude node-dependent bundle checks from test-python job
4ec9c73a8755506d333627db5488130d2311d01b ci: pin ruff to 0.15.18 to keep lint baseline stable
b5a8f00ac52876e34d9ac4e6cfa66641c032ac00 docs: align architecture docs with the shipped Cloudflare-native stack
1b486a5bbae9d110f5435d505b12417f3f93d494 feat(frontend): mobile/iOS council input — haptics, swipe-to-send, iOS hint
a1222c1a6c2d8445928f4bd5da9e2eda90d53614 feat(frontend): graceful read-only notice when case mutations are disabled
65abc6a79a49bdb98e62294ccc84f3b2e924d6cf feat(worker): compute shared law-section confidence in LLM Council natively
6cf7f7a2ff06ce46cefbd4e599d2f9be23a5c1fc ci: restore full Python unit suite, add ruff lint step, fix F401s
5e1d560be152d59aca56b06b04121e89c31361a6 fix(worker): raise case mutation JSON ceiling 128 KiB -> 1 MiB
abe5b0261b27c143579404a391dd8d58c383e724 feat(worker): add CRAWLER_WRITE_TOKEN service-to-service auth for VPS crawler
b2bd34ca53104a6ceb69488e3c3f2ff1c550137f Merge pull request #4 from Tracker-Tech-Pty-Ltd/chore/immi-migration-phase1-provisioning
d0972db376cfcfca804fa3f102c0014d4eab3a20 refactor(pipeline): make austlii-scraper cron-triggered only
9ebd222e623f4f7d5fbc5f59f276fce412d92b66 fix(frontend): remove Pages-era _redirects rules breaking Workers Static Assets
f91f45f815bd179574e732cd0db318c72ea1bf98 refactor(cloudflare): remove legacy Supabase/Hyperdrive worker code
2878751947393cfa595efc37339dee3da7374c05 docs(state): record D1 capacity migration + Supabase decommission status
1d200606598cf5bee506f0fdcebadb46dd726082 Merge pull request #3 from Tracker-Tech-Pty-Ltd/chore/immi-migration-phase1-provisioning
b1a89f2b8cbbf22ff6eb6f33c807656c0512fe5c docs(ci): correct requirements-legacy-rollback comment
008e499ca8d50c3b52d5fd22b09bc83611211202 ci: drop separation-preflight test from test-python job
b5b6cd9d575a4bc4dfb38a1484af072661791a1e ci: drop duplicate bundle-closure test from test-python job
620aea4bfbdb3c60640e4721a5ae0a6c180e687e ci: install full app deps via existing requirements files
bd6df6b3fef305fa46465fa333c8d0a6267459ff ci: install full test dependency set for native migration tests
aa32e2dac77a3b13897a7f9db9c5c99230be7205 ci: install pandas for the native migration test suite
167a84bbae4fded3292c6a67310b245fd12ce722 fix(cloudflare): paginate lexical recall, stream retrieval non-blocking, P3 nits
fc09fd0f5b33adf071d59744f80ca6139aaa7c20 fix(cloudflare): address Codex review — preserve OR query, deterministic LIMIT, wire all council entrypoints
93cace761783d876ecb5a35d6901ef89ae39bb9e refactor(cloudflare): switch Council RAG retrieval from Vectorize to FTS5 lexical
763ec5f557e4a8afe610c68cb93b4fe36cc463fc feat(cloudflare): ground LLM Council in corpus via Vectorize retrieval
2d4ffb1d721ab0d3d84f43425814cd05f5f9c2e0 docs(state): downgrade Blocker #4 — visa_type/case_nature are D1 WHERE filters, not Vectorize
619c9da809159f8dd80ffac94d3a3639199f4f34 fix(cloudflare): dedupe catalog FTS via external-content FTS5 (blocker #2)
5ee2bed7fa1bdac2ee3ec0e5b90a8e10143e225b fix(cloudflare): add Workers Static Assets and SPA fallback (blocker #1)
381941459aa8c2083b27dc4f37ce14ae2c4cdfbf chore: update dependencies, state log, and gitnexus metadata
819316f2851735bb01b1265a8d38b0c2d3b68c03 chore(cloudflare): remove supabase baseline, add ops docs and config
dbe547e08e501bc3851b2f22e1d387e47774d797 test(cloudflare): add migration verification and separation tests
643a0ee2ca55d4003237e905c880a16f6d63531f feat(cloudflare): add migration verification and IMMI separation scripts
41a8d02f5074adc027d521574a59a28c95726eeb chore(cloudflare): add wrangler config, deploy/CI workflows, extractor container
40ecd243353259020ac8ad9f7529ba821bc26cc4 feat(cloudflare): update austlii-scraper pipeline with legislation and D1 outbox
2929019fa23837c35640519164eb452b842f9460 feat(cloudflare): add cloudflare-native entrypoint and extraction container
f25c0fb5291e10e6ecc620f066fbac46121dfd75 feat(cloudflare): add llm-council native handlers and session Durable Object
7fdf99c3eceade8d59484621aabb62101c55929e feat(cloudflare): add native case-api, admin, and pipeline handlers
7cd880aac7b4fb1d4fc534fa1e88822776572f7d feat(cloudflare): add native auth handlers (telegram/bootstrap/csrf/jwt)
63c22fd15b29145c50e0412e1206557c9f380842 feat(cloudflare): add D1 migrations and native storage contracts
b8baf45c843092cb6db7647aa203435aa23964c5 fix(make): route Python targets through venv
b4e1d3944b45a5628ecf837f94ec93f19d3974fa chore(gitnexus): refresh index metadata
42089a6acaa46d0ee7ebc57ca5241b942dd80c39 chore(lint): clear Ruff debt
18a5b0ccb841229a9125f0816403323eede1f2d4 feat(pipeline): finish cloud extraction rollout
7a44106555809459331d52529a50a99dab6fc168 Add Cloudflare discovery pipeline foundations
1c28007fc45dce4ac45bad1c552cf1cb44923a3b Slim Cloudflare container build context
8724b0ce39a8968f921ab8d8ee516d441a4aa1be chore: slim cloudflare container context
5a70917d67a01f14236ea69f74ec0e8fd445cb15 force fresh flask container for login bundle
bcf8b9be70c48b9e8fa65f658356bae44ec6f966 fix telegram login redirect flow
6687ef8af5360bde665773b6caeea536b42bc793 fix local automation paths
f3fd5b8a51e23cc2980188e2c814ed72c40fc42b force fresh flask container instance
c7758270aeeb818087ae1331bf2e3b82e2abee7b fix llm council auth and health routing

hook: PostToolUse
hook: PostToolUse Completed
exec
/bin/zsh -lc "grep -n -E 'rebuildAggregates|markAggregatesDirty|claimRebuildLease|rebuildUnderLease|AGGREGATE_REBUILD_FALLBACK_SECONDS|rebuild_generation|rebuild_applied_generation' workers/proxy.js scripts/transform_immi_snapshot.py docs/ops/aggregate-rebuild-cost-guard.md" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 2 in 0ms:
grep: workers/proxy.js: No such file or directory
docs/ops/aggregate-rebuild-cost-guard.md:11:- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
docs/ops/aggregate-rebuild-cost-guard.md:13:- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
docs/ops/aggregate-rebuild-cost-guard.md:32:| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:46:| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
docs/ops/aggregate-rebuild-cost-guard.md:47:| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last completed rebuild (drives the interval) |
docs/ops/aggregate-rebuild-cost-guard.md:48:| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild |
docs/ops/aggregate-rebuild-cost-guard.md:50:"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
docs/ops/aggregate-rebuild-cost-guard.md:59:Two invocations cannot rebuild at once: `claimRebuildLease()` is a conditional
docs/ops/aggregate-rebuild-cost-guard.md:78:- `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
docs/ops/aggregate-rebuild-cost-guard.md:115:      shows `rebuild_applied_generation` catching up with `rebuild_generation`
docs/ops/aggregate-rebuild-cost-guard.md:131:   `AGGREGATE_REBUILD_FALLBACK_SECONDS`.

hook: PostToolUse
hook: PostToolUse Completed
**Inspecting code changes across commits**
**Investigating hidden or unstaged changes**
exec
/bin/zsh -lc "git show --format='%H %s' --name-only HEAD~80..HEAD -- workers/cloudflare-native.js workers/storage/cloudflare.js scripts/transform_immi_snapshot.py docs/ops/aggregate-rebuild-cost-guard.md wrangler.toml config/wrangler-cloudflare-native.toml.example" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 1988ms:
2026-09-10 21:45:04.503 xcodebuild[99210:134259249]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:45:04.688 xcodebuild[99210:134259248] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kTOCHMKc' (errno=Operation not permitted)
2026-09-10 21:45:05.203 xcodebuild[99224:134259483]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:45:05.383 xcodebuild[99224:134259482] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
167a84bbae4fded3292c6a67310b245fd12ce722 fix(cloudflare): paginate lexical recall, stream retrieval non-blocking, P3 nits

workers/storage/cloudflare.js
fc09fd0f5b33adf071d59744f80ca6139aaa7c20 fix(cloudflare): address Codex review — preserve OR query, deterministic LIMIT, wire all council entrypoints

workers/storage/cloudflare.js
93cace761783d876ecb5a35d6901ef89ae39bb9e refactor(cloudflare): switch Council RAG retrieval from Vectorize to FTS5 lexical

workers/storage/cloudflare.js
5ee2bed7fa1bdac2ee3ec0e5b90a8e10143e225b fix(cloudflare): add Workers Static Assets and SPA fallback (blocker #1)

workers/cloudflare-native.js
wrangler.toml
819316f2851735bb01b1265a8d38b0c2d3b68c03 chore(cloudflare): remove supabase baseline, add ops docs and config

config/wrangler-cloudflare-native.toml.example
643a0ee2ca55d4003237e905c880a16f6d63531f feat(cloudflare): add migration verification and IMMI separation scripts

scripts/transform_immi_snapshot.py
41a8d02f5074adc027d521574a59a28c95726eeb chore(cloudflare): add wrangler config, deploy/CI workflows, extractor container

wrangler.toml
2929019fa23837c35640519164eb452b842f9460 feat(cloudflare): add cloudflare-native entrypoint and extraction container

workers/cloudflare-native.js
63c22fd15b29145c50e0412e1206557c9f380842 feat(cloudflare): add D1 migrations and native storage contracts

workers/storage/cloudflare.js
18a5b0ccb841229a9125f0816403323eede1f2d4 feat(pipeline): finish cloud extraction rollout

wrangler.toml
7a44106555809459331d52529a50a99dab6fc168 Add Cloudflare discovery pipeline foundations

wrangler.toml
e2fb65122468d96b9772b479b8108328c5912e49 fix(security)!: lock down auth nonce, case writes, and LLM Council tenant isolation

wrangler.toml
3c5c2ee14f8b27e1579cdf9d4f78387500ebe4cd infra(wrangler): bump containers max_instances 3 to 7 — prevent v23-style production brick

wrangler.toml

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing git diff limitations on untracked docs**
**Identifying changed functions via grep and sed**
exec
/bin/zsh -lc "grep -n -E 'rebuildAggregates|markAggregatesDirty|aggregatesNeedRebuild|claimRebuildLease|releaseRebuildLease|rebuildUnderLease|AGGREGATE_REBUILD_FALLBACK_SECONDS|rebuild_generation|rebuild_applied_generation|rebuild_lease_until' workers/cloudflare-native.js workers/storage/cloudflare.js scripts/transform_immi_snapshot.py docs/ops/aggregate-rebuild-cost-guard.md wrangler.toml config/wrangler-cloudflare-native.toml.example" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/cloudflare-native.js:148:async function rebuildUnderLease(stores, minIntervalSeconds) {
workers/cloudflare-native.js:150:  const claimed = await stores.caseStore.claimRebuildLease({ leaseSeconds });
workers/cloudflare-native.js:156:    return await stores.caseStore.rebuildAggregates();
workers/cloudflare-native.js:159:      await stores.caseStore.releaseRebuildLease();
workers/cloudflare-native.js:181:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
workers/cloudflare-native.js:187:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
workers/cloudflare-native.js:209:  await stores.caseStore.markAggregatesDirty();
workers/cloudflare-native.js:211:    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
workers/cloudflare-native.js:214:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
workers/cloudflare-native.js:216:  const result = await rebuildUnderLease(stores, minIntervalSeconds);
workers/storage/cloudflare.js:54:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at", "rebuild_lease_until",
workers/storage/cloudflare.js:997:   * work only marks the aggregates dirty (markAggregatesDirty) and the
workers/storage/cloudflare.js:999:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
workers/storage/cloudflare.js:1003:  async rebuildAggregates() {
workers/storage/cloudflare.js:1008:    const appliedGeneration = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1093:        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
workers/storage/cloudflare.js:1109:  async markAggregatesDirty() {
workers/storage/cloudflare.js:1111:        VALUES ('rebuild_generation', 1, ?)
workers/storage/cloudflare.js:1120:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation',
workers/storage/cloudflare.js:1121:                              'rebuild_last_at', 'rebuild_lease_until')`,
workers/storage/cloudflare.js:1132:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
workers/storage/cloudflare.js:1136:    const pending = state.get("rebuild_generation") || 0;
workers/storage/cloudflare.js:1137:    const applied = state.get("rebuild_applied_generation") || 0;
workers/storage/cloudflare.js:1159:  async claimRebuildLease({ leaseSeconds = 600 } = {}) {
workers/storage/cloudflare.js:1162:        VALUES ('rebuild_lease_until', ?, ?)
workers/storage/cloudflare.js:1169:  async releaseRebuildLease() {
workers/storage/cloudflare.js:1171:        VALUES ('rebuild_lease_until', 0, ?)
docs/ops/aggregate-rebuild-cost-guard.md:11:- `handleCaseMutationQueue()` called `stores.caseStore.rebuildAggregates()` once
docs/ops/aggregate-rebuild-cost-guard.md:13:- `rebuildAggregates()` clears and rewrites **17** summary/filter tables
docs/ops/aggregate-rebuild-cost-guard.md:30:| `workers/cloudflare-native.js` | Queue batches now call `markAggregatesDirty()` (one row) instead of `rebuildAggregates()`, plus a safety valve (`AGGREGATE_REBUILD_FALLBACK_SECONDS`, default 3600) so a missing cron can never freeze dashboards permanently. New `scheduled()` handler runs the rebuild at most once per interval, under a D1 lease. |
docs/ops/aggregate-rebuild-cost-guard.md:31:| `workers/storage/cloudflare.js` | New `markAggregatesDirty()`, `aggregatesNeedRebuild()`, `claimRebuildLease()` / `releaseRebuildLease()`. `rebuildAggregates()` snapshots the pending generation before scanning and records `rebuild_applied_generation` + `rebuild_last_at` at the end. |
docs/ops/aggregate-rebuild-cost-guard.md:32:| `wrangler.toml`, `config/wrangler-cloudflare-native.toml.example` | `[triggers] crons = ["*/5 * * * *"]`, `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"`, `AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"`. |
docs/ops/aggregate-rebuild-cost-guard.md:45:| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
docs/ops/aggregate-rebuild-cost-guard.md:46:| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
docs/ops/aggregate-rebuild-cost-guard.md:47:| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last completed rebuild (drives the interval) |
docs/ops/aggregate-rebuild-cost-guard.md:48:| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild |
docs/ops/aggregate-rebuild-cost-guard.md:50:"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
docs/ops/aggregate-rebuild-cost-guard.md:59:Two invocations cannot rebuild at once: `claimRebuildLease()` is a conditional
docs/ops/aggregate-rebuild-cost-guard.md:78:- `AGGREGATE_REBUILD_FALLBACK_SECONDS` (default 3600) — the safety valve. The
docs/ops/aggregate-rebuild-cost-guard.md:115:      shows `rebuild_applied_generation` catching up with `rebuild_generation`
docs/ops/aggregate-rebuild-cost-guard.md:116:      after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
docs/ops/aggregate-rebuild-cost-guard.md:131:   `AGGREGATE_REBUILD_FALLBACK_SECONDS`.
wrangler.toml:99:AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
config/wrangler-cloudflare-native.toml.example:60:AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"

hook: PostToolUse
hook: PostToolUse Completed
**Planning sed region extraction**
exec
/bin/zsh -lc "sed -n '120,225p' workers/cloudflare-native.js && sed -n '985,1185p' workers/storage/cloudflare.js && sed -n '88,104p' wrangler.toml && sed -n '52,65p' config/wrangler-cloudflare-native.toml.example && sed -n '1,145p' docs/ops/aggregate-rebuild-cost-guard.md" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
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
async function rebuildUnderLease(stores, minIntervalSeconds) {
  const leaseSeconds = Math.max(600, minIntervalSeconds * 2);
  const claimed = await stores.caseStore.claimRebuildLease({ leaseSeconds });
  if (!claimed) {
    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
    return { skipped: "lease_held" };
  }
  try {
    return await stores.caseStore.rebuildAggregates();
  } finally {
    try {
      await stores.caseStore.releaseRebuildLease();
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
  const result = await rebuildUnderLease(stores, minIntervalSeconds);
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
  const result = await rebuildUnderLease(stores, minIntervalSeconds);
  if (result?.skipped) return false;
  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
  return true;
}

async function handleDeadLetterQueue(batch, env) {
  const stores = createCloudflareStores(env);
  for (const message of batch?.messages || []) {
    try {
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
    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
    return { rebuilt_at: now };
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
        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation',
                              'rebuild_last_at', 'rebuild_lease_until')`,
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
    const lastAt = state.get("rebuild_last_at") || 0;
    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
    if (elapsedSeconds < interval) {
      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
    }
    return {
      due: true,
      reason: "dirty",
      pending_generation: pending,
      applied_generation: applied,
      seconds_since_last_rebuild: lastAt > 0 ? elapsedSeconds : null,
    };
  }

  /**
   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
   * interleave their DELETEs. The conditional upsert only writes when the held
   * lease has expired, so `changes === 1` means this caller won.
   */
  async claimRebuildLease({ leaseSeconds = 600 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_lease_until', ?, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
      WHERE catalog_summary.value_int < ?`)
      .bind(now + Math.max(60, Math.floor(leaseSeconds)), utcNow(), now).run();
    return changeCount(result) > 0;
  }

  async releaseRebuildLease() {
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_lease_until', 0, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = 0, updated_at = excluded.updated_at`)
      .bind(utcNow()).run();
    return true;
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
| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last completed rebuild (drives the interval) |
| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild |

"Dirty" is `rebuild_generation > rebuild_applied_generation`. A boolean flag
would be wrong: a rebuild that starts at generation 5 and takes a minute can be
interleaved with a mutation, and a plain `dirty = 0` write at the end would
discard that mutation's pending state and leave the dashboard permanently stale.
The rebuild therefore snapshots the generation *before* it scans and records that
value as applied — anything that arrived meanwhile stays pending and the next
tick rebuilds again. The rebuild's own `DELETE FROM catalog_summary` excludes the
bookkeeping keys for the same reason.

Two invocations cannot rebuild at once: `claimRebuildLease()` is a conditional
upsert (`... DO UPDATE ... WHERE catalog_summary.value_int < ?`) that only writes
when the previous lease has expired, so `changes === 1` means the caller won. The
lease is released in a `finally` block; if the invocation dies mid-rebuild, the
lease expires on its own rather than wedging the pipeline.

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
- [ ] `SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'`
      shows `rebuild_applied_generation` catching up with `rebuild_generation`
      after each mutation burst, and `rebuild_lease_until` back at 0 between runs.
- [ ] No `cloudflare.aggregate_rebuild_lease_held` storms — an occasional entry
      is normal; constant entries mean rebuilds take longer than the lease.

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

hook: PostToolUse
hook: PostToolUse Completed
**Assessing race condition in lease handling**
**Planning lease token and conditional release fix**
**Designing renewable token lease with heartbeat**
**Planning lease renewal logic**
**Identifying unbounded retry issue on rebuild failure**
**Planning retry rate limiting on rebuild failure**
**Investigating Cloudflare scheduled event handling**
exec
/bin/zsh -lc "grep -n -E 'scheduled\\(|handleScheduledRebuild|markStaleAndMaybeRebuild|handleCaseMutationQueue|handle.*Queue' workers/cloudflare-native.js && sed -n '1,125p' workers/cloudflare-native.js && sed -n '2530,2630p' workers/cloudflare-native.js && grep -n -E 'transform_immi_snapshot|catalog_summary|DELETE FROM catalog_summary|INSERT.*catalog_summary' scripts/transform_immi_snapshot.py workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-native-scheduled-rebuild.test.js workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
104:async function handleCaseMutationQueue(batch, env) {
123:    if (changed) await markStaleAndMaybeRebuild(stores, env);
175:async function handleScheduledRebuild(env) {
208:async function markStaleAndMaybeRebuild(stores, env) {
222:async function handleDeadLetterQueue(batch, env) {
285:      await handleDeadLetterQueue(batch, env);
288:    await handleCaseMutationQueue(batch, env);
290:  async scheduled(event, env) {
291:    return handleScheduledRebuild(env);
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
scripts/transform_immi_snapshot.py:325:    catalog.execute("DELETE FROM catalog_summary")
scripts/transform_immi_snapshot.py:351:        "INSERT INTO catalog_summary (summary_key,value_int,updated_at) VALUES (?,?,?)",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:7:  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:71:    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:73:    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:154:    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:197:    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:215:    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);

hook: PostToolUse
hook: PostToolUse Completed
**Planning sed tests and script dispatch**
exec
/bin/zsh -lc "sed -n '275,298p' workers/cloudflare-native.js && sed -n '300,360p' scripts/transform_immi_snapshot.py && sed -n '1,250p' workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js && sed -n '1,260p' workers/__tests__/cloudflare-native-scheduled-rebuild.test.js && sed -n '1,260p' workers/__tests__/cloudflare-native-queue.test.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
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
        for subclass in split_labels(row.get("visa_subclass")):
            visa_id = sha256_text("visa:" + subclass.casefold())[:32]
            output.catalog.execute(
                "INSERT OR IGNORE INTO visas (visa_id,subclass) VALUES (?,?)",
                (visa_id, subclass),
            )
            output.catalog.execute(
                "INSERT OR IGNORE INTO case_visas (case_id,visa_id) VALUES (?,?)",
                (case_id, visa_id),
            )
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

function d1({ responder = () => [], changes = 1 } = {}) {
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
        run: async () => ({ meta: { changes } }),
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
function state({ pending, applied, lastAt, leaseUntil } = {}) {
  const rows = [];
  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
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
      .resolves.toBe(false);

    const free = env({ changes: 1 });
    await expect(createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
      .resolves.toBe(true);

    const statement = free.catalog.prepared[0];
    expect(statement.sql).toMatch(/rebuild_lease_until/);
    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
    expect(statement.params).toHaveLength(3);
    expect(statement.params[0]).toBeGreaterThan(nowSeconds());
  });

  it("enforces a floor on the lease length", async () => {
    const { catalog, value } = env();
    const before = nowSeconds();

    await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });

    expect(catalog.prepared[0].params[0]).toBeGreaterThanOrEqual(before + 60);
  });

  it("releases the lease by zeroing it", async () => {
    const { catalog, value } = env();

    await createCloudflareStores(value).caseStore.releaseRebuildLease();

    expect(catalog.prepared[0].sql).toMatch(/rebuild_lease_until', 0/);
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
      claimRebuildLease: vi.fn(async () => true),
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
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 600 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledOnce();
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledOnce();
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

  it("skips the rebuild when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.claimRebuildLease.mockResolvedValue(false);
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
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledOnce();
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
      claimRebuildLease: vi.fn(async () => true),
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
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 3600 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledOnce();
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledOnce();
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
    current.caseStore.claimRebuildLease.mockResolvedValue(false);
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
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

hook: PostToolUse
hook: PostToolUse Completed
**Identifying critical catalog-wiping risk**
**Analyzing catalog summary reset risks**
**Assessing mutation loss from script concurrency**
**Verifying line numbering with grep and sed**
exec
/bin/zsh -lc "grep -n -E 'rebuild_catalog_aggregates|Output\\(|catalog_path|sqlite|D1|d1' scripts/transform_immi_snapshot.py && grep -n -E 'CREATE TABLE.*catalog_summary|catalog_summary' migrations/d1/catalog/0001_catalog.sql && grep -n -E 'AGGREGATE_BOOKKEEPING_KEYS|async rebuildAggregates|async markAggregatesDirty|async aggregatesNeedRebuild|async claimRebuildLease|async releaseRebuildLease' workers/storage/cloudflare.js && grep -n -E 'async function rebuildUnderLease|async function handleScheduledRebuild|async function markStaleAndMaybeRebuild' workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
11:The transformer writes three SQLite files using the actual D1 migrations, an
23:import sqlite3
32:MIGRATIONS = ROOT / "migrations" / "d1"
192:            raise TransformError("unable to split UTF-8 case text under the D1 chunk limit")
197:def exec_migration(connection: sqlite3.Connection, name: str) -> None:
211:    catalog: sqlite3.Connection
212:    account: sqlite3.Connection
213:    ops: sqlite3.Connection
222:    catalog = sqlite3.connect(path / "catalog.sqlite")
223:    account = sqlite3.connect(path / "account.sqlite")
224:    ops = sqlite3.connect(path / "ops.sqlite")
227:    return Output(path, catalog, account, ops, path / "r2", snapshot_time)
315:def rebuild_catalog_aggregates(output: Output) -> None:
714:        rebuild_catalog_aggregates(output)
727:    except (OSError, sqlite3.Error, TransformError, ValueError) as exc:
184:CREATE TABLE IF NOT EXISTS catalog_summary (
53:const AGGREGATE_BOOKKEEPING_KEYS = [
1003:  async rebuildAggregates() {
1009:    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
1109:  async markAggregatesDirty() {
1132:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
1159:  async claimRebuildLease({ leaseSeconds = 600 } = {}) {
1169:  async releaseRebuildLease() {
148:async function rebuildUnderLease(stores, minIntervalSeconds) {
175:async function handleScheduledRebuild(env) {
208:async function markStaleAndMaybeRebuild(stores, env) {

hook: PostToolUse
hook: PostToolUse Completed
**Verifying snapshot rebuild integrity**
**Assessing aggregate state mutation timing**
exec
/bin/zsh -lc "grep -n -E 'rebuildAggregates\\(|markAggregatesDirty\\(|aggregatesNeedRebuild\\(|claimRebuildLease\\(|releaseRebuildLease\\(' workers/*.js workers/*/*.js workers/*/*/*.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 1 in 0ms:
zsh:1: no matches found: workers/*/*/*.js

hook: PostToolUse
hook: PostToolUse Completed
**Listing key tests for generation invariants**
**Analyzing dirty state test coverage**
exec
/bin/zsh -lc "grep -n -E 'mid.rebuild|generation|lease|fallback|rebuild_dirty|transform_immi_snapshot|real.sqlite|SQLite' workers/__tests__/*.js tests/*.py tests/*/*.py scripts/*.js scripts/*.py" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 exited 1 in 0ms:
zsh:1: no matches found: scripts/*.js

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing test failure conditions**
**Examining lack of doc rollback tests**
**Identifying lease release race condition**
**Analyzing data state consistency with dependent mutations**
**Planning fallback retry and rebuild scheduling**
**Designing lease claim and retry logic**
**Verifying snapshot path handling**
**Planning recursive grep usage**
exec
/bin/zsh -lc "grep -R -n -E 'rebuildAggregates\\(' workers --include='*.js'" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/cloudflare-native.js:156:    return await stores.caseStore.rebuildAggregates();
workers/storage/cloudflare.js:1003:  async rebuildAggregates() {
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:180:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:195:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:208:    await stores.caseStore.rebuildAggregates();
workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js:226:    await stores.caseStore.rebuildAggregates();

hook: PostToolUse
hook: PostToolUse Completed
**Verifying aggregate rebuild snapshot handling**
**Assessing test coverage for invariant failures**
**Identifying test failures on lease and rebuild logic**
**Confirming lease timing and retry logic**
**Documenting lease issue with concrete fix**
**Planning conditional lease release on ownership**
**Tracing retry logic in mutation queue**
**Planning rebuild attempt timestamp separation**
**Verifying rebuildAgg snapshot consistency**
**Mapping method lines and snapshots**
**Identifying test insufficiencies and labeling findings**
**Clarifying usage of file line ranges**
codex
HIGH — `workers/storage/cloudflare.js:1159`, `workers/cloudflare-native.js:148`, `workers/storage/cloudflare.js:1169`  
問題：租約到期時，仍在執行的舊 rebuild 可與新持有者重疊；舊呼叫在 `finally` 中無條件把新持有者的 lease 歸零，第三個呼叫即可再進入。這不是真正的互斥。  
修正：租約需有 owner/fencing token；release 與續租必須以 token 條件更新。每批 D1 操作前續租並在失去 lease 時停止 rebuild。

HIGH — `workers/cloudflare-native.js:154-165`, `workers/cloudflare-native.js:209-217`, `workers/storage/cloudflare.js:1132-1155`  
問題：rebuild 失敗後會立刻 release lease，但 `rebuild_last_at` 未更新；佇列 30 秒重試後仍判定 fallback 已到期，可在 `AGGREGATE_REBUILD_FALLBACK_SECONDS` 期間反覆重建，違反「最多一次」保證。  
修正：在取得 lease 時記錄 `rebuild_last_attempt_at`，並用它節流失敗重試；保留 `rebuild_last_at` 作成功完成時間。

No finding — generation snapshot：唯一正式呼叫點是 `workers/cloudflare-native.js:156`，scheduled 與 queue fallback 都經由同一個 `rebuildUnderLease()`；`rebuildAggregates()` 在任何 aggregate DELETE/INSERT 前讀取 generation（`workers/storage/cloudflare.js:1003`）。

No finding — generation 遺失／重設：`catalog_summary` DELETE 排除四個 bookkeeping keys，dirty 使用原子遞增，applied 只寫入開始時快照。`scripts/transform_immi_snapshot.py:222-227,325` 操作的是新建的離線 SQLite snapshot，不會與 Worker 的 D1 寫入交錯。

No finding — rollback 文件：`docs/ops/aggregate-rebuild-cost-guard.md:120-132` 明確禁止恢復逐批 rebuild，並列出安全調整方式。

測試可抓到原先修復被直接回退：
- Generation：`records staleness as a monotonic generation, not a boolean`、`keeps the bookkeeping keys alive across the rebuild delete`、`records the generation observed before the scan, not a bare clean flag`。
- Lease claim：`claims the rebuild lease only when the previous lease has expired`、`skips the rebuild when another invocation holds the lease`。
- Queue fallback 成功路徑：`uses the fallback rebuild only when the cron path has gone quiet`。

但現有測試沒有覆蓋「lease 到期後舊 owner release」或「失敗後 fallback 節流」兩個上述問題。

交接：審查完成，需先修正兩項 HIGH 問題。  
VERDICT: CHANGES-REQUIRED
tokens used
79,194
HIGH — `workers/storage/cloudflare.js:1159`, `workers/cloudflare-native.js:148`, `workers/storage/cloudflare.js:1169`  
問題：租約到期時，仍在執行的舊 rebuild 可與新持有者重疊；舊呼叫在 `finally` 中無條件把新持有者的 lease 歸零，第三個呼叫即可再進入。這不是真正的互斥。  
修正：租約需有 owner/fencing token；release 與續租必須以 token 條件更新。每批 D1 操作前續租並在失去 lease 時停止 rebuild。

HIGH — `workers/cloudflare-native.js:154-165`, `workers/cloudflare-native.js:209-217`, `workers/storage/cloudflare.js:1132-1155`  
問題：rebuild 失敗後會立刻 release lease，但 `rebuild_last_at` 未更新；佇列 30 秒重試後仍判定 fallback 已到期，可在 `AGGREGATE_REBUILD_FALLBACK_SECONDS` 期間反覆重建，違反「最多一次」保證。  
修正：在取得 lease 時記錄 `rebuild_last_attempt_at`，並用它節流失敗重試；保留 `rebuild_last_at` 作成功完成時間。

No finding — generation snapshot：唯一正式呼叫點是 `workers/cloudflare-native.js:156`，scheduled 與 queue fallback 都經由同一個 `rebuildUnderLease()`；`rebuildAggregates()` 在任何 aggregate DELETE/INSERT 前讀取 generation（`workers/storage/cloudflare.js:1003`）。

No finding — generation 遺失／重設：`catalog_summary` DELETE 排除四個 bookkeeping keys，dirty 使用原子遞增，applied 只寫入開始時快照。`scripts/transform_immi_snapshot.py:222-227,325` 操作的是新建的離線 SQLite snapshot，不會與 Worker 的 D1 寫入交錯。

No finding — rollback 文件：`docs/ops/aggregate-rebuild-cost-guard.md:120-132` 明確禁止恢復逐批 rebuild，並列出安全調整方式。

測試可抓到原先修復被直接回退：
- Generation：`records staleness as a monotonic generation, not a boolean`、`keeps the bookkeeping keys alive across the rebuild delete`、`records the generation observed before the scan, not a bare clean flag`。
- Lease claim：`claims the rebuild lease only when the previous lease has expired`、`skips the rebuild when another invocation holds the lease`。
- Queue fallback 成功路徑：`uses the fallback rebuild only when the cron path has gone quiet`。

但現有測試沒有覆蓋「lease 到期後舊 owner release」或「失敗後 fallback 節流」兩個上述問題。

交接：審查完成，需先修正兩項 HIGH 問題。  
VERDICT: CHANGES-REQUIRED
