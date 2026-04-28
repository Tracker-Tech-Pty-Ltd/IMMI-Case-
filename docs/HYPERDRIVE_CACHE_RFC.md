# RFC — Hyperdrive query-cache treatment for LLM Council write-affected reads

**Status**: Spike complete (long-term item A from US-014/015 follow-up backlog).
Implementation gated on Cloudflare dashboard / API token access (not in
current session scope).

**Author**: Iteration 14 cleanup pass.

---

## 1. Problem statement

The LLM Council DELETE / CREATE flows currently use an optimistic-update +
delayed-invalidate workaround in TanStack Query because Hyperdrive caches
SELECT queries against `council_sessions` for ~5–10 seconds. Without the
workaround, the sequence is:

1. `useDeleteSession.mutate(id)` →
2. Worker `handleDeleteSession` runs the DELETE statement (writes bypass cache),
3. Mutation `onSuccess` calls `invalidateQueries(['council-sessions'])`,
4. TanStack refetches the list → Worker `handleListSessions` issues
   `SELECT * FROM council_sessions ORDER BY updated_at DESC LIMIT $1`,
5. Hyperdrive serves a **pre-DELETE cached snapshot** that still contains
   the deleted row,
6. UI re-renders with the stale snapshot — user sees the deleted session
   reappear in the sidebar until the cache TTL expires.

The same race exists in reverse for CREATE: `useCreateSession` finishes
server-side but the next list refetch returns a pre-create snapshot, so the
new session is missing from the sidebar.

The current workaround (commits `eabc9c0`, `3ebd8d2`, `8b2a7ef`) papers over
the problem at the client by:
- `setQueriesData` + `setQueryData` to optimistically mutate the cache,
- `setTimeout(invalidate, 10s)` to reconcile after Hyperdrive TTL expires.

This works in production (US-014 production e2e step 7 closes loop), but it
adds complexity and a 10-second window during which other tabs see stale
data even after a manual page reload.

## 2. Findings from Cloudflare Hyperdrive docs

Source: https://developers.cloudflare.com/hyperdrive/concepts/query-caching/

- **Default cache**: `max_age = 60s`, `stale_while_revalidate = 15s`.
  Maximum allowed `max_age` is 1 hour.
- **Disable per Hyperdrive config**:
  `npx wrangler hyperdrive update <id> --caching-disabled true`
  (CLI only; not expressible inside `wrangler.toml`.)
- **Two-binding pattern** (recommended by Cloudflare): run two Hyperdrive
  configs against the same DB — one cached, one not. The Worker picks
  per-query: cache-OK reads use `env.HYPERDRIVE`, cache-sensitive reads use
  `env.HYPERDRIVE_NO_CACHE`. Both still benefit from connection pooling and
  TLS termination.
- **Cache busting via SQL hint** is NOT robust: rotating a non-deterministic
  value (e.g. `Date.now()`) in a SQL comment forces a cache miss but ALSO
  loses cross-request reuse — equivalent to disabling the cache for that
  query class.

## 3. Recommended treatment — two-binding pattern

The LLM Council list endpoint (and any DELETE-affected read) is the smallest
queryable surface that genuinely needs strict consistency. The Cases /
Analytics endpoints (the bulk of read traffic) tolerate the 60s window and
benefit measurably from caching against a 149K-row corpus that changes once
per scrape cycle.

### 3.1 Cloudflare side (one-shot, requires CF Dashboard or API token)

```bash
# Replace <DB_PASSWORD> with the value from Supabase Dashboard
# → Project Settings → Database → "Database password" (per CLAUDE.md).
npx wrangler hyperdrive create immi-case-db-fresh \
  --connection-string="postgresql://postgres:<DB_PASSWORD>@db.urntbuqczarkuoaosjxd.supabase.co:5432/postgres" \
  --caching-disabled true
```

Capture the returned `id` (e.g. `<NEW_HD_ID>`) for step 3.2.

### 3.2 wrangler.toml — add a second binding

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "c961b377ef0c4ec2a01d9d7220db7c93"
localConnectionString = "postgresql://postgres:postgres@localhost:5432/immi_case"

# Future US-016: uncached binding for write-affected reads (LLM Council
# session list, etc.) so users do not see stale data after delete/create.
# Same DB, --caching-disabled true at config level.
[[hyperdrive]]
binding = "HYPERDRIVE_NO_CACHE"
id = "<NEW_HD_ID>"
localConnectionString = "postgresql://postgres:postgres@localhost:5432/immi_case"
```

### 3.3 Worker code — route LLM Council reads through the uncached binding

`workers/llm-council/storage.js` currently has:

```js
function getSql(env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    // ...
  });
}
```

Add a second helper for write-affected reads:

```js
function getSqlFresh(env) {
  return postgres(
    (env.HYPERDRIVE_NO_CACHE ?? env.HYPERDRIVE).connectionString,
    {
      // same options
    },
  );
}
```

Then `listSessions` (the one that drives the sidebar) switches to `getSqlFresh`:

```js
export async function listSessions({ env, limit = 20, before = null }) {
  const sql = getSqlFresh(env);
  // …unchanged…
}
```

`deleteSession`, `addTurn`, `getSession` are already write/auth-gated paths
where Hyperdrive bypasses caching for mutations and for queries containing
parameters that vary per request — they can stay on `getSql`.

### 3.4 Frontend — remove the workaround

After 3.3 deploys and is verified, the optimistic-update + delayed-invalidate
workaround in `frontend/src/hooks/use-llm-council-sessions.ts` becomes
load-bearing for nothing. Remove:

- `useDeleteSession.onSuccess`: drop `setQueriesData` + the 10s setTimeout.
  Restore the original `qc.invalidateQueries({ queryKey: ['council-sessions'] })`.
- `useCreateSession.onSuccess`: drop `setQueriesData` (list seed) + 10s
  setTimeout. Keep the per-session detail seed
  (`setQueryData(['council-session', data.session_id], …)`) — that one is
  unrelated to Hyperdrive caching.

### 3.5 Tests to revert

`frontend/__tests__/use-llm-council-sessions.test.ts`:
- `useDeleteSession` block: replace
  `optimistically removes the deleted session from cache on success` +
  `schedules a delayed invalidate (~10s) for eventual reconciliation` with
  the original `invalidates ['council-sessions'] on success`.
- `useCreateSession` block: same pattern (replace optimistic prepend +
  delayed invalidate with synchronous invalidate).

## 4. Verification plan

After 3.1–3.5 ship:

1. Deploy via `git push origin main` → CI runs preflight + deploy.
2. Run production e2e:
   `E2E_BASE_URL=https://immi.trackit.today pytest tests/e2e/playwright/test_council_thread_visual.py -v --timeout=180`
3. step 7 (delete from sidebar) MUST stay green without the optimistic
   workaround. The list locator polls for ≤20s; if the count assertion
   passes within that window, the uncached binding is in effect (was
   previously requiring up to 60s without the workaround).
4. Manual sanity: open the sidebar in two tabs, create a session in tab A,
   verify tab B shows it within 1–2 seconds of refetch (was 5–10s).

## 5. Cost assessment

- Cloudflare Hyperdrive configs are free; the only cost is one extra config
  per environment.
- The uncached binding adds ~15–30 ms latency to LLM Council list reads
  (no edge cache hit) but the list is at most 20 rows — negligible.
- All other read paths (Cases, Analytics, Stats) keep the cached binding
  and retain their full Hyperdrive cache benefit against the 149K-row
  corpus.

## 6. Why not now

Section 3.1 requires a CF API token / dashboard session that the current
agent run does not have. The exact wrangler command is captured here so a
future session (or the user directly) can execute it without re-spiking.

## 7. Cross-reference

- Original incident notes — `.omc/progress.txt` Iteration 13 §"US-014 — what
  was done", commits `eabc9c0` + `3ebd8d2` + `8b2a7ef`.
- Workaround code — `frontend/src/hooks/use-llm-council-sessions.ts`
  (search for "Hyperdrive caches list SELECTs").
- Production runtime — `workers/llm-council/storage.js` `getSql` helper
  is the single chokepoint for the swap.
