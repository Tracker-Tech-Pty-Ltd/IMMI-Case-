# RFC — Hyperdrive query-cache treatment for LLM Council write-affected reads

**Status**: Spike complete. **Path 4 (quick-win) shipped 2026-04-28** and
the **Path 3 code-side fresh-binding path shipped 2026-06-08**.

Current repo state:
- Worker storage exposes `getSqlFresh` / `withSqlFreshAsUser`.
- `listSessions` uses the fresh authenticated path and falls back to cached
  `HYPERDRIVE` only when `HYPERDRIVE_NO_CACHE` is not bound.
- The frontend 10-second delayed invalidate workaround has been removed;
  create/delete now invalidate `['council-sessions']` immediately.
- Production still needs the second Cloudflare Hyperdrive config id inserted
  into `wrangler.toml`. The attempted `immi-case-db-fresh` create on
  2026-06-08 failed with Cloudflare API code `2013` (`Invalid database
  credentials`), so the repo keeps the binding block commented until a valid
  Supabase origin password is supplied.

**Quick-win shipped 2026-04-28** (no code change, infra only):

```
npx wrangler hyperdrive update c961b377ef0c4ec2a01d9d7220db7c93 \
    --max-age 10 --swr 0
```

reduced the cached `max_age` from default 60 s to 10 s AND set
`stale_while_revalidate` to 0 s on the production Hyperdrive config.

Why both: max_age alone leaves Cloudflare serving stale cached responses
for an additional `stale_while_revalidate` window (default 15 s) while it
revalidates in the background. With `swr=0`, the strict total stale
window was 10 s — which aligned with the former frontend
`setTimeout(invalidate, 10s)` workaround while that workaround existed.

This shrank the worst-case stale window 7.5× (60+15 = 75 s → 10 s)
without disabling caching globally. It is now a fallback only; the intended
LLM Council list path is `HYPERDRIVE_NO_CACHE`.

Verification (`wrangler hyperdrive get c961b377…`):
```
"caching": {
  "disabled": false,
  "max_age": 10,
  "stale_while_revalidate": 0
}
```

**Reversible**: `wrangler hyperdrive update c961b377… --max-age 60 --swr 15`.

**Author**: Iteration 14 cleanup pass.

---

## 1. Problem statement

Before the 2026-06-08 code cleanup, the LLM Council DELETE / CREATE flows
used an optimistic-update + delayed-invalidate workaround in TanStack Query
because Hyperdrive cached SELECT queries against `council_sessions` for
~5–10 seconds. Without that workaround, the sequence was:

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

The former workaround (commits `eabc9c0`, `3ebd8d2`, `8b2a7ef`) papered over
the problem at the client by:
- `setQueriesData` + `setQueryData` to optimistically mutate the cache,
- `setTimeout(invalidate, 10s)` to reconcile after Hyperdrive TTL expires.

That worked in production (US-014 production e2e step 7 closed the loop),
but it added complexity and a 10-second window during which other tabs saw
stale data even after a manual page reload.

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

Then `listSessions` (the one that drives the sidebar) uses the fresh
authenticated path:

```js
export async function listSessions({ env, claims, limit = 20, before = null }) {
  return withSqlFreshAsUser(env, claims, async (tx) => {
    // …unchanged SELECT…
  });
}
```

`deleteSession`, `addTurn`, `getSession` are already write/auth-gated paths
where Hyperdrive bypasses caching for mutations and for queries containing
parameters that vary per request — they can stay on `getSql`.

### 3.4 Frontend — workaround removed

The optimistic-update + delayed-invalidate workaround in
`frontend/src/hooks/use-llm-council-sessions.ts` has been removed:

- `useDeleteSession.onSuccess`: removes the detail query and immediately
  invalidates `['council-sessions']`.
- `useCreateSession.onSuccess`: keeps the per-session detail seed
  (`setQueryData(['council-session', data.session_id], …)`) and immediately
  invalidates `['council-sessions']`.

### 3.5 Tests to revert

`frontend/__tests__/use-llm-council-sessions.test.ts` now asserts synchronous
`['council-sessions']` invalidation for both create and delete. Worker storage
tests assert that `listSessions` routes through the fresh binding when present.

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

## 6. Production binding status

The code and frontend cleanup are in repo. The Cloudflare-side fresh binding
still needs a valid Supabase origin password. On 2026-06-08, `wrangler
hyperdrive list` showed only `immi-case-db` (cached) for this project, and
`wrangler hyperdrive create immi-case-db-fresh ... --caching-disabled`
failed with Cloudflare API code `2013` (`Invalid database credentials`).

Until a valid fresh Hyperdrive id is added to `wrangler.toml`, production will
fall back to the cached `HYPERDRIVE` binding. The cached binding is still set
to `max_age=10` and `swr=0`, but strict post-write freshness requires
`HYPERDRIVE_NO_CACHE`.

## 7. Cross-reference

- Original incident notes — `.omc/progress.txt` Iteration 13 §"US-014 — what
  was done", commits `eabc9c0` + `3ebd8d2` + `8b2a7ef`.
- Former workaround code — `frontend/src/hooks/use-llm-council-sessions.ts`
  (create/delete now immediately invalidate `['council-sessions']`).
- Production runtime — `workers/llm-council/storage.js` `getSqlFresh` /
  `withSqlFreshAsUser` helpers route strict reads to `HYPERDRIVE_NO_CACHE`
  when the binding is present.
