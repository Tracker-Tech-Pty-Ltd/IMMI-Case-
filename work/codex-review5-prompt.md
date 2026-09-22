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
