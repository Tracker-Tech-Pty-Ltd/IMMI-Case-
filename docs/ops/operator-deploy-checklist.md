# Operator deploy checklist — aggregate rebuild cost guard

For the operator who deploys `immi-case-standalone` from
`github.com/Tracker-Tech-Pty-Ltd/IMMI-Case-`. The production deploy does **not**
read this repository's `wrangler.toml`: it materialises the operator-supplied
config from the `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64` secret. Until that secret
carries the block below, the cron never fires and the fix degrades to the hourly
fallback — dashboards keep working, but the cost guarantee is weakened.

## 1. Add this block to the stored operator config

Append to the `[vars]` table (values are the defaults from `wrangler.toml`):

```toml
AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "300"
AGGREGATE_REBUILD_FALLBACK_SECONDS = "3600"
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

Verify the merge before uploading:

```bash
python3 - <<'PY'
import tomllib
d = tomllib.load(open("/path/to/operator-main.toml", "rb"))
assert d["triggers"]["crons"] == ["*/5 * * * *"], d.get("triggers")
for key in ("AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS", "AGGREGATE_REBUILD_FALLBACK_SECONDS",
            "AGGREGATE_REBUILD_QUIET_SECONDS", "AGGREGATE_REBUILD_MAX_STALENESS_SECONDS"):
    assert key in d["vars"], key
print("config ok:", {k: v for k, v in d["vars"].items() if k.startswith("AGGREGATE")})
PY
```

## 2. Refresh the deploy secret

```bash
base64 < /path/to/operator-main.toml | tr -d '\n' > /tmp/main.b64   # macOS: base64 -i
gh secret set IMMI_NATIVE_MAIN_WRANGLER_TOML_B64 --repo Tracker-Tech-Pty-Ltd/IMMI-Case- < /tmp/main.b64
```

## 3. Run the gates locally (same checks the workflow runs)

```bash
cd IMMI-Case-
node scripts/check_cloudflare_native_bundle.mjs
python3 scripts/check_cloudflare_native_target.py --main-config /path/to/operator-main.toml
npm run test:workers            # expect 27 files / 388 tests
```

## 4. Deploy

GitHub → Actions → **Deploy IMMI Workers (Cloudflare-native, operator-only)** →
Run workflow → `confirm_native_deploy: I_UNDERSTAND`.

## 5. Verify after the deploy (do not skip)

| Check | Command / where | Expected |
|---|---|---|
| Cron trigger installed | Dashboard → Workers → `immi-case-standalone` → Triggers, or `npx wrangler deployments status` | `*/5 * * * *`, next run within 5 minutes |
| Worker serves reads | `curl -s https://immi.trackit.today/health` | `{"status":"ok",...}` |
| Control keys exist | `npx wrangler d1 execute immi-catalog --remote --command "SELECT summary_key, value_int FROM catalog_summary WHERE summary_key LIKE 'rebuild_%'"` | `rebuild_generation`, `rebuild_applied_generation`, `rebuild_last_at`, `rebuild_dirty_since`, `rebuild_lease_until`, `rebuild_last_attempt_at` once activity resumed |
| One rebuild per burst | Worker logs (Observability) | `cloudflare.aggregate_rebuild_completed` with `reason: "dirty"` after a quiet period; **`reason: "awaiting-quiet"` while an import is running is correct** |
| No per-batch rebuilds | `npx wrangler d1 insights immi-catalog --sort-by writes --time-period 1d` | The three `INSERT ... SELECT` statements appear a handful of times per day, not thousands |
| Fallback not looping | Worker logs | No repeated `cloudflare.aggregate_rebuild_fallback` entries |

## 6. Incident state to unwind (only after the fix is live)

The 2026-09 incident left the worker intentionally crippled:

```bash
# 1. re-enable the write API (the deployed var is currently "false")
#    safest path: the same authenticated PATCH documented in the
#    cloudflare-worker-var-edit skill, or the dashboard once Cloudflare's
#    "binding AI failed to generate" bug is fixed
# 2. resume queue delivery
npx wrangler queues resume-delivery immi-case-mutation-queue
```

Do these **after** the deploy that carries `[triggers]` and the vars, otherwise
mutations queue up with no consumer and expire after four days.

## 7. Rollback

Never restore the per-batch rebuild (`markAggregatesDirty()` →
`rebuildAggregates()` in the queue consumer); that is the incident mechanism.
Safe levers, in order: fix the cron → raise
`AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS` / `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`
→ set `[triggers] crons = []` and let the queue fallback carry freshness. A Worker
rollback to version 13 (or earlier) also removes the cron, which puts the system
back on the fallback path rather than the per-batch path.
