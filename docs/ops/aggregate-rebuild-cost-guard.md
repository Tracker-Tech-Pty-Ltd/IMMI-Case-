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
  `cases` table — **~1.46M written rows** (measured, see below; and ~2.5M rows read) per call,
  about **$1.51** at the published $1.00/million-rows rate.

  > **How this number is derived (reproducible, 2026-09-22).** From the primary
  > evidence `evidence/query-insights-30d.json` (D1 Query Insights, 30-day window):
  >
  > 1. Take the 41 statements that belong to the rebuild (everything touching
  >    `aggregate_*`, `catalog_summary`, `filter_options`) and sum their
  >    `totalRowsWritten` = **12,218,579,618**.
  > 2. Count the rebuilds with a statement that provably runs **exactly once per
  >    rebuild**: `DELETE FROM catalog_summary` -> `numberOfTimesRun = 8,373`
  >    (the median across all 41 statements is 8,197; using either changes the
  >    answer by <3%).
  > 3. `12,218,579,618 / 8,373 = ` **1,459,283 rows per rebuild** (1.49M by the
  >    median, 1.51M if you (invalidly) sum the per-statement averages - all
  >    agree at ~1.45-1.51M).
  >
  > **Why the old 584,000 figure is impossible, not merely imprecise.** It came
  > from dividing a day's rows by that day's *requests*. Check the burst days:
  > at 584k rows/rebuild, 2026-08-24 needs 8,913 rebuilds for 8,915 requests
  > (100%), 2026-08-25 needs 2,700 for 2,380 requests (**113%**), 2026-09-01
  > needs 5,713 for 5,311 (**108%**) - more rebuilds than requests. At the
  > measured 1.45M the same days give 3,567 / 1,080 / 1,330 / 2,286 rebuilds
  > against 8,915 / 2,380 / 3,322 / 5,311 requests, i.e. **40-45% of batches
  > changed something** - which is what the `if (changed)` guard in
  > `handleCaseMutationQueue()` predicts. Every dollar figure below follows from
  > the measured number; the incident total (12.08B rows / $12,060) was always
  > right and needs no correction.
- With `max_batch_size = 20`, a catalog import of 153,438 cases produced ~7,700
  batches, i.e. ~7,700 full rewrites ≈ **11.7 billion written rows** per import
  (the observed incident total was 12.08 billion).
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

State lives in `catalog_summary` (`summary_key` is the primary key) under nine
internal keys, none of which reach API responses (`getStats()` reads only
`total_cases` / `with_full_text`). No D1 migration is required.

| Key | Written by | Meaning |
|---|---|---|
| `rebuild_generation` | `markAggregatesDirty()` | Monotonic counter — every queue batch that changed something increments it |
| `rebuild_applied_generation` | `rebuildAggregates()` | The generation the last completed rebuild actually covered |
| `rebuild_last_at` | `rebuildAggregates()` | Epoch seconds of the last **successful** rebuild |
| `rebuild_last_attempt_at` | `claimRebuildLease()` | Epoch seconds of the last attempt — throttles retries of a *failed* rebuild, which never stamps `rebuild_last_at` |
| `rebuild_last_mutation_at` | `markAggregatesDirty()` | Epoch seconds of the most recent queue mutation — the quiet window is measured from here |
| `rebuild_dirty_since` | `markAggregatesDirty()` | Epoch seconds when the current pending work first appeared — armed only on the clean→dirty edge, and **disarmed unconditionally at the start of every rebuild attempt** plus again on success, so continuous writes can never keep the staleness bound armed |
| `rebuild_lease_until` | `claimRebuildLease()` | Epoch seconds until which one invocation owns the rebuild; its **`updated_at` column holds the owner's fencing token** (a UUID-style string) rather than a timestamp |
| `rebuild_day` | `consumeRebuildBudget()` | The UTC day (`YYYYMMDD` as an integer) the daily budget counter belongs to — a change of day resets the counter |
| `rebuild_count_today` | `consumeRebuildBudget()` | Rebuild attempts consumed that UTC day — capped by `AGGREGATE_REBUILD_DAILY_BUDGET` (48). Must stay in this list: the rebuild's own `DELETE FROM catalog_summary` keeps only these keys, so dropping it would let every completed rebuild restart the day's budget |

Note the deliberate overload: `catalog_summary.updated_at` holds a timestamp for
every key **except** `rebuild_lease_until`, where it carries the owner's fencing
token. Any future analytics or maintenance query that treats that column as a
time must exclude the lease row.

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
| One queue batch | ~1.51M rows (~$1.51) | 3 control rows in one atomic batch |
| 153k-case import (7,700 batches, ~4 h) | ~7,700 rebuilds ≈ 11.7B rows ≈ **$11,700** | **1 rebuild ≈ 1.51M rows ≈ $1.51** (quiet window) + ~23k control rows ≈ $0.02 |
| Continuous writes, 24 h, no quiet gap (6 h staleness bound) | same mechanism, per batch | **3-5 rebuilds ≈ $4.53-7.55** (04:00/10:00/16:00/22:00 boundaries) |
| Continuous writes + a rebuild that keeps failing, 24 h | 2,025 failed attempts, each with partial writes | **3 attempts ≈ $4.53** |
| Operator sets max-staleness = "1" | 106 rebuilds/hour | **12/hour** (floor raises it to 300 s; with the `*/5` cron that is 288/day ≈ $436/day - the row below) |
| Steady traffic (a few mutations/min, never quiet for 5 min) | — | bounded by `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (3-5 rebuilds/day ≈ $4.53-7.55 at the 6 h default) |
| **Intermittent bursts: every burst followed by > QUIET_SECONDS of silence** | same mechanism, per batch | **up to one rebuild per elapsed interval - 288/day ≈ $436/day** with the shipped defaults (no misconfiguration required) |
| Gate-permitted misconfiguration: an extra `* * * * *` cron (the gate only requires `*/5` to be *included*) + `MIN_INTERVAL=60` (its floor) + `QUIET=30` + `MAX_STALENESS=300` | — | **1,440/day ≈ $2,181/day** - 5.4x the original incident |
| Dashboard freshness | per batch | a few minutes after the last queued mutation (quiet window 300 s), and at most one rebuild per `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (6 h) window while writes never pause |

### The true ceiling (know this before changing any knob)

There is **no rows-written budget, no rebuild counter and no spend-keyed kill
switch** in this design. Every frequency bound is a *variable*: the cron list
(gate-constrained only by inclusion), `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS`,
`AGGREGATE_REBUILD_FALLBACK_SECONDS`, `AGGREGATE_REBUILD_QUIET_SECONDS` and
`AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`. The code-enforced invariants are the
knob **floors** and "one rebuild at a time per lease" (and that lease is keyed to
each isolate's own `Date.now()`, so clock skew can double it).

- With the shipped defaults and a correct deploy: **≤ 288 rebuilds/day ≈ $436/day**
  (the intermittent-burst shape).
- Worst case that still passes the deploy gate: **≈ $2,181/day**.
- Recommended production setting: `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "1800"`
  and exactly one `*/5` cron entry, which pulls the burst shape down to ≤ 48/day ≈ $73/day.

Four properties keep the rebuild frequency bounded, and an independent reviewer
measured each one against the real handlers (see the table below):

1. **The interval is the backstop.** Every trigger path - the queue fallback, the
   cron, and the max-staleness bound - must respect `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS`,
   so no path can retry on every queue batch (a persistently failing rebuild
   retried 2,025x/day before this).
2. **Every rebuild disarms the staleness clock twice**: once when the attempt
   starts (so a rebuild that throws still ends the era instead of leaving the
   bound armed) and once at the end of a successful run.
3. **The lease holder re-checks the work is still pending** before rebuilding, so
   N in-flight queue decisions cannot each rebuild after one cron rebuild
   (measured: 20 extra rebuilds, now 0).
5. **An absolute daily budget** (`AGGREGATE_REBUILD_DAILY_BUDGET`, default **48**,
   clamped to at most 48 at runtime - an operator can lower it, never raise it):
   consumed in `rebuildUnderLease()` only when there is pending work, so
   once the day's count is spent the attempt is refused *before* the 17 aggregate
   tables are touched - and it is refused by code, not by a knob. This is the one
   bound that survives a mistyped variable, an extra cron entry, a dashboard edit,
   a lease race or clock skew. At the measured ~1.46M rows per rebuild it caps the
   Worker at ~70M rows/day (~$70/day) whatever the other variables say, which turns
   "the worst case is $436-2,181/day" into "the worst case is 48 x rows-per-rebuild".
   `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` proves the 49th
   attempt of a UTC day is refused and that a new day resets the budget; the SQL
   harness (`scripts/sql-harness/verify-rebuild-sql.py`) proves the counter **survives the
   rebuild's own `DELETE FROM catalog_summary`** - both keys must stay in
   `AGGREGATE_BOOKKEEPING_KEYS` (and in the mirror list in
   `scripts/transform_immi_snapshot.py`), otherwise every completed rebuild wipes
   the count and the cap restarts at 1. That regression is two-way proven: remove
   the two keys and the harness fails with "consumption after a completed rebuild
   increments to 2 (not restarting at 1) :: (1,)".
   Exhaustion logs `cloudflare.aggregate_rebuild_budget_exhausted`, with
   `cloudflare.aggregate_rebuild_budget_low` emitted at 75% so exhaustion is never
   the first signal.

4. **Floors on the knobs** (interval/fallback >= 60 s, quiet >= 30 s,
   max-staleness >= 300 s) so a mistyped value cannot rebuild per minute
   (a max-staleness of "1" rebuilt 106x/hour).

The staleness bound is only safe because **every rebuild disarms the staleness
clock** (`rebuild_dirty_since`): the clock measures how long the current era of
pending work has gone unrebuilt, and it is the bound's only throttle. If a
rebuild ever leaves it armed — for example because a mutation landed mid-scan —
the bound fires again on the next queue batch and the bill returns to the
incident curve. An independent review measured that regression at **216 rebuilds
in 24 h ≈ $326/day** (versus 4/day with the disarm);
`workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` pins both the
statement shape and the 24-hour cadence, so a future change cannot reintroduce it
quietly. Pending work is never lost by disarming: the generation counter records
what the rebuild covered.

| Cron missing / failing (fallback path only) | n/a | ≤ 1 rebuild/hour ≈ 36M rows/day ≈ **$36/day** |

### Quiet window (why an import costs cents, not dollars)

The interval alone only bounds *how often* a rebuild may run; during a four-hour
bulk import it still fires every interval, which is how a fixed version could
still spend ~$73 on one import. The rebuild therefore waits for a **quiet
window**: it will not run until mutations have been silent for
`AGGREGATE_REBUILD_QUIET_SECONDS` (default 300). A 153k-case import now costs
**one rebuild (~$1.51)** because the pending work accumulates while the import
runs and is rebuilt once afterwards. A dashboard read during an import therefore
sees figures from before the import — acceptable, since nobody is reading
aggregates while bulk data is still landing.

The safety net is `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` (default 21600, six
hours): if mutations never pause, analytics are still refreshed on that cadence
instead of drifting indefinitely. Lower it if continuous-write periods must stay
fresher; raise it to make very long imports even cheaper.

5 operator-side knobs:

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
   stored copy) — without the cron the aggregates fall back to the queue-side
   interval path: **24-288 rebuilds/day ≈ $36-436/day** depending on traffic shape
   (`MIN_FALLBACK_FLOOR_SECONDS = 300` in the Worker caps the frequency, so the
   fallback alone can never return to the incident curve), and
   the incident's cost guarantee is
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
