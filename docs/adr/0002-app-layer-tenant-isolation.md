# ADR-0002: Tenant isolation is enforced in application code, not by the database

- **Status**: Accepted
- **Date**: 2026-08-21
- **Commits**: `f91f45f` (the move off Postgres that forced this)

## Context

The 2026-05 multi-tenant auth design enforced isolation with Postgres
row-level security, driven by `SET LOCAL request.jwt.claims` inside a
transaction wrapper (`workers/db/getSqlAsUser.js`). That design explicitly
considered and **rejected** an app-layer tenant filter, on the grounds that
"a single missed `WHERE tenant_id=` causes silent leak". Cloudflare D1 has no
RLS equivalent, so moving the data layer to D1 (ADR-0001) removed the mechanism
the original design depended on.

## Decision

Isolation is enforced by `CloudflareIdentityStore.assertMembership(auth)` in
`workers/storage/cloudflare.js`. It runs
`SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL`
against D1 `IMMI_ACCOUNT_DB` and throws `403 tenant_membership_denied` on a
miss. Every route that touches tenant-scoped data must call it.

## Consequences

- **This is the rejected Option C, adopted under duress.** There is no
  database-level backstop. A route that forgets `assertMembership()` is a real
  cross-tenant leak, and nothing below the application layer will catch it.
- Code review of any new tenant-scoped route must check for the call
  explicitly; "the database will stop it" is no longer true.
- `tests/integration/rls_isolation.sql` verifies the retired Postgres
  mechanism and does not exercise this one. Coverage of the real mechanism is
  partial: `workers/__tests__/cloudflare-storage-contracts.test.js:127-134`
  asserts the SQL text against a SQL-blind fake, and `plans/038` adds
  behavioural store-level deny tests plus a route-level matrix for one admin
  route. A **full route security matrix** — absent / revoked / wrong-tenant /
  wrong-role for every tenant-scoped route — does not exist, and the seven other
  `assertMembership()` call sites are unproven at the route level. Tracked as an
  operator-blocked item in `.claude/STATE.md`.
- Revocation is near-instant for writes (D1 re-check per request) but lags by
  up to the 5-minute access-token TTL for reads.
