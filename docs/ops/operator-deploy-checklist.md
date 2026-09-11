# Operator deploy checklist — aggregate rebuild cost guard

For the operator who deploys `immi-case-standalone` from
`github.com/Tracker-Tech-Pty-Ltd/IMMI-Case-`. The production deploy does **not**
read this repository's `wrangler.toml`: it materialises the operator-supplied
config from the `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64` secret. Until that secret
carries the block below, the cron never fires and the fix degrades to the hourly
fallback — dashboards keep working, but the cost guarantee is weakened. The
deploy gate (`scripts/check_cloudflare_native_target.py`) now **fails closed** if
the trigger or any of the five knobs is missing, so a forgotten merge can no
longer ship silently.

## 1. Add this block to the stored operator config

Append to the `[vars]` table (values are the defaults from `wrangler.toml`):

```toml
AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
AGGREGATE_REBUILD_LEASE_SECONDS = "900"
AGGREGATE_REBUILD_QUIET_SECONDS = "300"
AGGREGATE_REBUILD_MAX_STALENESS_SECONDS = "21600"
```

and add the trigger table **after** all `[vars]` keys (a new table header ends the
`[vars]` table — putting this in the middle silently reassigns the remaining keys
to `[triggers]`):

```toml
# Coalesced analytics rebuild: queue batches only mark aggregates dirty, and this
# cron performs at most one rebuild per quiet window. Never trigger the rebuild
# from the queue consumer again: one rebuild clears and rewrites 17 summary
# tables (~584k written rows) and per-batch rebuilds produced a ~$12k bill.
[triggers]
crons = ["*/5 * * * *"]
```

Verify the merge before uploading (needs Python 3.11+; on macOS use
`./.venv/bin/python` or Homebrew's `python3`, not `/usr/bin/python3` which is
3.9 and has no `tomllib`):

```bash
./.venv/bin/python - <<'PY'
import tomllib
d = tomllib.load(open("/path/to/operator-main.toml", "rb"))
assert d["triggers"]["crons"] == ["*/5 * * * *"], d.get("triggers")
for key in ("AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS", "AGGREGATE_REBUILD_FALLBACK_SECONDS",
            "AGGREGATE_REBUILD_LEASE_SECONDS", "AGGREGATE_REBUILD_QUIET_SECONDS",
            "AGGREGATE_REBUILD_MAX_STALENESS_SECONDS"):
    assert key in d["vars"], key
print("config ok:", {k: v for k, v in d["vars"].items() if k.startswith("AGGREGATE")})
PY
```

## 2. Refresh the deploy secret

```bash
base64 < /path/to/operator-main.toml | tr -d '\n' > /tmp/main.b64   # macOS: base64 -i
gh secret set IMMI_NATIVE_MAIN_WRANGLER_TOML_B64 --repo Tracker-Tech-Pty-Ltd/IMMI-Case- < /tmp/main.b64
```

## 3. Run the gates locally (CI runs the same checks; the deploy workflow itself only deploys)

```bash
cd IMMI-Case-
node scripts/check_cloudflare_native_bundle.mjs
./.venv/bin/python scripts/check_cloudflare_native_target.py \
  --main-config /path/to/operator-main.toml \
  --pipeline-config /path/to/operator-pipeline.toml
npm run test:workers            # expect 27 files / 391 tests
```

`--pipeline-config` is not optional: without it the script falls back to the
checked-in placeholder config and fails with five placeholder errors that look
like a config problem. The two configs must agree on the `IMMI_CATALOG_DB` and
`IMMI_OPS_DB` ids.

## 4. Deploy

GitHub → Actions → **Deploy IMMI Workers (Cloudflare-native, operator-only)** →
Run workflow → `confirm_native_deploy: I_UNDERSTAND`.

## 5. Verify after the deploy (do not skip)

| Check | Command / where | Expected |
|---|---|---|
| Cron trigger installed | Dashboard → Workers → `immi-case-standalone` → Triggers, or `npx wrangler deployments status` | `*/5 * * * *`, next run within 5 minutes |
| Worker serves reads | `curl -s https://immi.trackit.today/health` | `{"status":"ok",...}` |
| Control keys exist | `npx wrangler d1 execute immi-catalog --remote --command "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'"` | `rebuild_generation`, `rebuild_applied_generation`, `rebuild_last_at`, `rebuild_last_attempt_at`, `rebuild_lease_until`, `rebuild_last_mutation_at`, `rebuild_dirty_since` once activity resumed (7 keys) |
| One rebuild per burst | Worker logs (Observability) | `cloudflare.aggregate_rebuild_completed` with `reason: "dirty"` after a quiet period; **`reason: "awaiting-quiet"` while an import is running is correct** |
| Cadence under a long import | Worker logs, or D1 insights | At most one `reason: "max-staleness"` rebuild per `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` window; **never one per queue batch** (the regression test in `workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js` pins this) |
| No per-batch rebuilds | `npx wrangler d1 insights immi-catalog --sort-by writes --time-period 1d` | The three `INSERT ... SELECT` statements appear a handful of times per day, not thousands; **alert yourself if rows written/day exceeds ~5M** |
| Rebuilds per day match the write cadence | Worker logs: count `cloudflare.aggregate_rebuild_completed` per day | One rebuild per quiet period, so ~$0.58 each. A steady trickle of writes with >5-minute gaps means one rebuild per burst: if this exceeds ~50/day (~$30/day), raise `AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` (e.g. to 900) - analytics freshness is not worth hundreds a month |
| Fallback not looping | Worker logs | No repeated `cloudflare.aggregate_rebuild_fallback` entries |
| Mutations var after deploy | `npx wrangler deployments status` / dashboard var view | Every deploy re-asserts the config's `IMMI_CASE_MUTATIONS_ENABLED` (currently `"false"`); re-apply §6 if the write API should be live |

## 6. Incident state to unwind (only after the fix is live)

The 2026-09 incident left the worker intentionally crippled. Unwind **in this
order** — resuming the queue first, because a write API that accepts mutations
while the queue is paused enqueues messages that expire after the four-day
retention and are lost silently:

```bash
# 1. resume queue delivery first (a consumer must exist before writes resume)
npx wrangler queues resume-delivery immi-case-mutation-queue

# 2. then re-enable the write API (the deployed var is currently "false")
#    safest path: the authenticated PATCH documented in the
#    cloudflare-worker-var-edit skill, or the dashboard once Cloudflare's
#    "binding AI failed to generate" bug is fixed
```

Confirm between the two steps that the consumer is actually running (Queues →
`immi-case-mutation-queue` → consumer backlog draining). Note that the next
operator deploy re-applies the config value, so either set
`IMMI_CASE_MUTATIONS_ENABLED = "true"` in the stored config at the same time or
repeat step 2 after every deploy.

## 7. Rollback

Never restore the per-batch rebuild (`markAggregatesDirty()` →
`rebuildAggregates()` in the queue consumer); that is the incident mechanism.
Safe levers, in order: fix the cron → raise
`AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` / `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
→ set `[triggers] crons = []` and let the queue fallback carry freshness. A Worker
rollback to version 13 (or earlier) also removes the cron, which puts the system
back on the fallback path rather than the per-batch path.
