# ADR-0001: Production is one Cloudflare Worker over D1, R2 and Vectorize

- **Status**: Accepted
- **Date**: 2026-08-21
- **Commits**: `f91f45f` (`refactor(cloudflare): remove legacy Supabase/Hyperdrive worker code`)

## Context

Production originally served requests through `workers/proxy.js`, which reached
Supabase Postgres via Cloudflare Hyperdrive, with a Flask container behind it
for anything the Worker did not implement. That stack carried three moving
parts (Hyperdrive config + Postgres origin + container) for one read-mostly
corpus of ~149,000 cases, and its cache-consistency behaviour needed a
dedicated RFC to reason about (`docs/HYPERDRIVE_CACHE_RFC.md`).

## Decision

All production traffic is served by a single Worker,
`workers/cloudflare-native.js` (`name = "immi-case-standalone"`), over
Cloudflare-native storage: D1 ×3 (`IMMI_CATALOG_DB`, `IMMI_ACCOUNT_DB`,
`IMMI_OPS_DB`), R2 (`IMMI_CONTENT`), Vectorize (`CASE_VECTORS`), Queues and two
Durable Objects (`AuthNonce`, `CouncilSessionDO`). `workers/proxy.js` and
`workers/db/getSqlAsUser.js` were deleted. The Flask app
(`immi_case_downloader/`, `web.py`, `make api`) is local-dev only and is not
deployed, proxied to, or otherwise in the production request path.

## Consequences

- There is no fallback. An unhandled `/api/*` route is a genuine `503`
  (`cloudflare_route_unavailable`), not a soft degrade to Flask. Every new GET
  endpoint must be implemented as a D1 query in `workers/case-api/cloudflare.js`.
- `docs/HYPERDRIVE_CACHE_RFC.md` is void; do not provision Hyperdrive.
- Supabase migrations and scripts in this repo are one-time ETL tooling, not a
  live dependency. `workers/austlii-scraper/scripts/rollback_run.ts` still
  targets legacy Supabase on purpose, as break-glass for the retired stack.
- The `docs/plans/2026-05-03-perf-optimization-plan.md` benchmark and the
  "Performance Baseline (2026-05-05)" section of `CLAUDE.md` measure the retired
  stack. No equivalent benchmark has been re-run against D1/Vectorize.
- Deployment is operator-gated: `.github/workflows/deploy-worker.yml` is
  `workflow_dispatch` only, behind an `I_UNDERSTAND` confirmation, and the
  checked-in `wrangler.toml` deliberately carries placeholder resource IDs.
