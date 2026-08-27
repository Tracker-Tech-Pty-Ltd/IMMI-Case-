# Plan 006: Separate platform roles from tenant roles and close the auth gaps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)** — all four commands. A committed-range diff
> cannot see uncommitted, staged or untracked edits, so the first command alone
> gives a dirty tree a false all-clear.
>
> Note the path list is **the files this plan actually owns**, not the whole of
> `workers/__tests__/`. Scanning the entire test directory would make this plan
> STOP every time any sibling plan adds an unrelated test file.
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS="workers/auth/cloudflare_handlers.js
>   workers/auth/jwt.js
>   workers/auth/nonce_do.js
>   workers/storage/cloudflare.js
>   workers/pipeline/control_handlers.js
>   workers/admin/cloudflare_handlers.js
>   workers/case-api/cloudflare_mutations.js
>   workers/__tests__/pipeline-control.test.js
>   workers/__tests__/cloudflare-admin-handlers.test.js
>   workers/__tests__/cloudflare-mutations.test.js
>   workers/__tests__/auth-jwt.test.js
>   workers/__tests__/auth-nonce.test.js
>   workers/__tests__/cloudflare-native-auth-handlers.test.js
>   migrations/d1/account"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS   # committed since the plan was written
> git diff --stat -- $PATHS                 # unstaged working-tree edits
> git diff --cached --stat -- $PATHS        # staged but uncommitted edits
> ```
> Expected: the last three print nothing and `git status --short` lists no
> in-scope path. Any in-scope path appearing in **any** of them is a STOP
> condition — compare the "Current state" excerpts below against the live code
> and report before proceeding.
>
> **Two deliberate exceptions**, because this plan runs *after* `plans/005-*.md`:
> - `workers/case-api/cloudflare_mutations.js` will contain
>   `return await handle…(` dispatch lines. Expected; keep them.
> - `workers/storage/cloudflare.js` will contain an
>   `ON CONFLICT(retrieve_code) DO NOTHING` inside
>   `CloudflareCouncilStore.createSession`. Expected; that region is 005's and
>   is disjoint from the `CloudflareIdentityStore` region this plan owns.
>
> Anything else in those two files is real drift.
>
> **Never** run `git checkout --`, `git restore` or `git clean` to clear a
> dirty tree — those edits may be the operator's uncommitted work. Report and
> stop instead.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — this plan deliberately revokes an authority every existing
  user currently has, and it requires a D1 migration applied in a specific
  order relative to the code deploy. Step 0 exists because getting that order
  wrong locks the operator out of their own pipeline controls.
- **Depends on**: `plans/005-*.md` (file-level: 005 rewrites
  `workers/case-api/cloudflare_mutations.js` and adds a mutation test whose
  store double this plan must update — see "Sequencing")
- **Category**: security
- **Planned at**: commit `42826a3`, 2026-08-27

This plan does not use `make typecheck` and its in-scope file list is disjoint
from the frontend and Python trees, so it needs none of the verification-gate
repairs plans 001–003 make.

### Sequencing (cross-plan) — read before starting

| Plan | Shared file | Order | What you must do |
|---|---|---|---|
| `005` | `workers/case-api/cloudflare_mutations.js`, `workers/storage/cloudflare.js` | **005 first** | Step 5 here rewires `requireWriter` from `assertMembership` to `assertPlatformOperator`. That **breaks the mutation test 005 adds** (`"surfaces a typed storage error from a case mutation handler"` in `workers/__tests__/dispatcher-error-propagation.test.js`), whose store double supplies only `assertMembership`. **This plan owns fixing it** — see Step 5. Do not leave it red and do not delete it. |
| `007` | `workers/storage/cloudflare.js` | either order | Disjoint regions (007 owns `CloudflareCaseStore.exportCases`; this plan owns `CloudflareIdentityStore`). 007 also declares a dependency on this plan for its operator-authorization policy, so in practice this lands first. |
| `008` | — | either order | No shared file. An earlier draft's drift check covered all of `workers/__tests__/`, which would have made 006 and 008 STOP on each other for no reason; both are now narrowed to the files they own. |

Do **not** run 005 and 006 concurrently against one working tree.

## Why this matters

The production Cloudflare Worker derives **global operator authority from a
per-tenant membership role that the signup flow grants to the user
themselves**. On first Telegram login the Worker auto-creates a personal
tenant and inserts a `memberships` row with the literal role `'owner'`
(`workers/storage/cloudflare.js:1354-1355`). Both the pipeline control surface
(`workers/pipeline/control_handlers.js:52`) and the platform admin read
(`workers/admin/cloudflare_handlers.js:11`) then accept `role === 'owner'` as
proof of operator status. The result: **any stranger who logs in with a
Telegram account becomes a platform operator** — they can enqueue global
scraper runs (`limit` up to 10000), issue a global `stop`, trigger legislation
update jobs, and read the platform-wide pipeline-run history.

The same missing distinction sits under case mutations: `requireWriter`
(`workers/case-api/cloudflare_mutations.js:53-76`) checks membership but never
inspects the role, so the day `IMMI_CASE_MUTATIONS_ENABLED` is flipped to
`"true"` for its stated purpose, any logged-in user can delete 200
shared-catalog cases per request with queued R2 source cleanup behind it.

This plan introduces an explicit, fail-closed **platform operator** signal that
is separate from tenant role, rewires all three surfaces onto it, and closes
four smaller auth defects found alongside it: an open redirect in the Telegram
login callback, refresh-token reuse that never kills the token family, a JWT
verifier that treats a missing `exp` as "never expires", and a Durable Object
nonce store that grows forever because it passes a KV-only TTL option.

## Current state

### Files and their roles

| File | Role |
|---|---|
| `workers/storage/cloudflare.js` | D1 access layer. `CloudflareIdentityStore` (class opens at line 1295) is the app-layer tenant-isolation boundary — there is **no Postgres and no RLS** in this stack. `assertMembership()` at 1300, `upsertTelegramUser()` at 1318, refresh-session methods at 1412-1506. |
| `workers/pipeline/control_handlers.js` | Global scraper pipeline controls. `requireOperator()` at 45, dispatcher at 99. |
| `workers/admin/cloudflare_handlers.js` | Platform-wide pipeline-run history read (30 lines total). |
| `workers/case-api/cloudflare_mutations.js` | Case create/update/delete/batch. `requireWriter()` at 53, dispatcher at 290. |
| `workers/auth/cloudflare_handlers.js` | Telegram login/callback, `/auth/me`, refresh, logout, switch-tenant, bootstrap. |
| `workers/auth/jwt.js` | HS256 sign/verify with kid rotation. |
| `workers/auth/nonce_do.js` | `AuthNonce` Durable Object — Telegram login replay protection. |
| `migrations/d1/account/0001_account.sql` | The only Account-D1 migration today. |

### SEC-01 — the self-granted `owner` role

`workers/storage/cloudflare.js:1300-1314` (verbatim):

```js
  async assertMembership(auth) {
    const context = assertAuthContext(auth);
    const membership = await this.db.prepare(`
      SELECT role FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1
    `).bind(context.tenantId, context.userId).first();
    if (!membership) {
      throw new StorageBoundaryError("Tenant membership not found", {
        code: "tenant_membership_denied",
        status: 403,
      });
    }
    return { ...context, role: membership.role };
  }
```

`workers/storage/cloudflare.js:1353-1359` — the role that `assertMembership`
returns is written by the signup flow itself, as a hardcoded SQL literal:

```js
      this.db.prepare(`
        INSERT OR IGNORE INTO memberships (tenant_id, user_id, role, created_at)
        SELECT ?, u.user_id, 'owner', ?
        FROM users u
        WHERE u.telegram_id = ?
          AND EXISTS (SELECT 1 FROM tenants WHERE tenant_id = ?)
      `).bind(prospectiveTenantId, now, telegramId, prospectiveTenantId),
```

`workers/pipeline/control_handlers.js:45-58` (verbatim):

```js
async function requireOperator(request, env, stores) {
  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    const auth = await stores.identityStore.assertMembership(authResult.claims);
    if (!['owner', 'admin'].includes(String(auth.role || "member"))) {
      return errorResponse("Pipeline operator role is required", 403, "operator_role_required");
    }
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}
```

The three paths this guards are global in effect —
`workers/pipeline/control_handlers.js:16-20` (verbatim):

```js
const CONTROL_PATHS = new Set([
  "/api/v1/download/start",
  "/api/v1/pipeline-action",
  "/api/v1/legislations/update",
]);
```

`workers/admin/cloudflare_handlers.js:10-21` (verbatim):

```js
function isAdmin(claims) {
  return claims?.is_admin === true || claims?.role === "owner" || claims?.role === "admin";
}

export async function handleAdminPipelineRuns(request, env, url) {
  if (env.AUTH_ENABLED === "false") return json({ error: "Admin auth is disabled", code: "admin_auth_disabled" }, 403);
  const auth = await requireAuth(request, env, verifyJwt);
  if (auth instanceof Response) return auth;
  try {
    const stores = createCloudflareStores(env);
    const membership = await stores.identityStore.assertMembership(auth.claims);
    if (!isAdmin({ role: membership.role })) return json({ error: "Admin access required", code: "admin_required" }, 403);
```

Nothing anywhere in the repository ever sets `is_admin`. The
`migrations/d1/account/0001_account.sql` `users` table has no admin column at
all — verified by reading the whole file; its `memberships` table constrains
role to `CHECK(role IN ('owner', 'admin', 'member', 'viewer'))` at line 29, and
the `users` table (lines 4-18) has columns `user_id, telegram_id, first_name,
last_name, username, photo_url, primary_tenant_id, last_login_at, created_at,
updated_at` and nothing else.

### SEC-02 — case mutations authorize on membership alone

`workers/case-api/cloudflare_mutations.js:53-76` (verbatim):

```js
async function requireWriter(request, env, stores) {
  // Service-to-service: the VPS AustLII crawler is a cron job with no login.
  // It presents a shared secret (CRAWLER_WRITE_TOKEN) in the Authorization
  // header. Compared in constant time; only honored when the secret is set.
  if (env.CRAWLER_WRITE_TOKEN) {
    const header = request.headers.get("Authorization") || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer && timingSafeEqualString(bearer, env.CRAWLER_WRITE_TOKEN)) {
      return { auth: { service: "crawler", subject: "austlii-crawler" } };
    }
  }

  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    const auth = await stores.identityStore.assertMembership(authResult.claims);
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}
```

No role is inspected. What it gates,
`workers/case-api/cloudflare_mutations.js:259-273` (verbatim):

```js
  const ids = Array.isArray(data.case_ids) ? [...new Set(data.case_ids.filter((id) => typeof id === "string" && CASE_ID_RE.test(id)))] : [];
  if (!ids.length) return errorResponse("No valid case IDs provided");
  if (ids.length > 200) return errorResponse("Batch limited to 200 cases");
  const action = String(data.action || "");
  if (action === "delete") {
    const current = typeof stores.caseStore.findByIds === "function"
      ? await stores.caseStore.findByIds(ids)
      : [];
    const affected = await stores.caseStore.batchDeleteCases(ids);
    if (affected) await Promise.all(ids.map((id) => stores.semanticIndex.deleteCase(id)));
    if (affected) {
      await Promise.all(current.map((row) => enqueueCaseSourceCleanup(env, row)));
      await enqueueAggregateRefresh(env, `batch-delete:${[...ids].sort().join(",")}`);
    }
    return json({ affected });
  }
```

The only thing standing between this and any authenticated user today is the
freeze flag at `workers/case-api/cloudflare_mutations.js:302-304` (verbatim):

```js
  if (env.IMMI_CASE_MUTATIONS_ENABLED !== "true") {
    return errorResponse("Case mutations are disabled during migration freeze", 503, "case_mutations_disabled");
  }
```

### SEC-03 — open redirect in `safeRedirectTarget`

`workers/auth/cloudflare_handlers.js:49-59` (verbatim):

```js
function redirect(next, accessToken, refreshToken) {
  const headers = new Headers({ Location: next });
  headers.append("Set-Cookie", `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`);
  headers.append("Set-Cookie", `immi_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE}`);
  return new Response(null, { status: 302, headers });
}

function safeRedirectTarget(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/app/";
  return value;
}
```

`workers/auth/cloudflare_handlers.js:127-138` feeds the raw query parameter in:

```js
export async function handleTelegramCallback(request, env) {
  const url = new URL(request.url);
  const next = safeRedirectTarget(url.searchParams.get("next"));
```

Three predicates only — not a string, does not start with `/`, starts with
`//`. The value `/\evil.example` passes all three. Per the WHATWG URL spec, a
relative URL under a special scheme that begins `/\` enters the
"special authority ignore slashes" state, so browsers resolve it exactly like
the protocol-relative `//evil.example`. The route is live —
`workers/cloudflare-native.js:175-177` dispatches
`GET /api/v1/auth/telegram/callback`. `safeRedirectTarget` is **not exported**,
so it currently has no unit test.

### SEC-10 — refresh-token reuse never revokes the token family

`workers/storage/cloudflare.js:1457-1473` (verbatim):

```js
  async loadRefreshAuthSnapshot({ jti, userId }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const session = await this.db.prepare(`
      SELECT jti, user_id, family_id, expires_at, revoked_at
      FROM immi_refresh_sessions WHERE jti = ? AND user_id = ? LIMIT 1
    `).bind(checkedJti, checkedUserId).first();
    if (!session) throw refreshSessionError("Refresh session not found", "refresh_session_not_found");
    if (session.revoked_at) throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    const expiresAt = new Date(session.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await this.revokeRefreshSession({ jti: checkedJti, userId: checkedUserId, reason: "expired" });
      throw refreshSessionError("Refresh token expired", "expired_refresh_token");
    }
    const snapshot = await this.getAuthSnapshot(checkedUserId);
    return { session, ...snapshot };
  }
```

Line 1465 is the **primary reuse-detection point**: `handleAuthRefresh`
(`workers/auth/cloudflare_handlers.js:224`) calls
`loadRefreshAuthSnapshot` *before* `rotateRefreshSession`
(`workers/auth/cloudflare_handlers.js:230`), so an already-rotated token is
caught here and the compare-and-swap in `rotateRefreshSession` is only the
concurrent-race backstop. Its failure throw is at
`workers/storage/cloudflare.js:1503-1505` (verbatim):

```js
    if (changeCount(result[0]) !== 1 || changeCount(result[1]) !== 1) {
      throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    }
```

`family_id` is written (lines 1417-1419 and 1490-1496) and read (line 1461) but
**never appears in any UPDATE or revoke statement anywhere in the repository**.
Verified with `grep -rn 'family_id\|familyId' workers migrations`: the only
non-test hits are those inserts/selects plus
`workers/auth/cloudflare_handlers.js:225`,
`workers/auth/refresh_sessions.js:26,30,56,57,78`,
`workers/storage/cloudflare.js:209,217`, the legacy
`workers/auth/handlers.js:536,613`, and the column declaration at
`migrations/d1/account/0001_account.sql:92`.

The existing single-row revoke helper the new family revoke should mirror,
`workers/storage/cloudflare.js:1442-1455` (verbatim):

```js
  async revokeRefreshSession({ jti, userId, reason, replacedByJti = null }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const checkedReplacement = replacedByJti === null ? null : assertUuid(replacedByJti, "refresh.replacedByJti");
    const now = utcNow();
    await this.db.prepare(`
      UPDATE immi_refresh_sessions
      SET revoked_at = COALESCE(revoked_at, ?),
          revoked_reason = COALESCE(revoked_reason, ?),
          replaced_by_jti = COALESCE(replaced_by_jti, ?),
          last_used_at = COALESCE(last_used_at, ?)
      WHERE jti = ? AND user_id = ?
    `).bind(now, reason, checkedReplacement, now, checkedJti, checkedUserId).run();
  }
```

### JSCORR-16 / TEST-19 — a missing `exp` means "valid forever"

`workers/auth/jwt.js:183-190` (verbatim):

```js
  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { valid: false, payload: null, reason: "expired" };
  }

  return { valid: true, payload, reason: "" };
}
```

An absent, `null`, or string `exp` skips the check and falls through to
`valid: true`. `workers/auth/request_auth.js:25-38` trusts that boolean and
re-checks nothing but `type === "refresh"`. The behaviour is pinned as intended
by `workers/__tests__/auth-jwt.test.js:154-158` (verbatim):

```js
  it("accepts a token with no exp field (no expiry enforced)", async () => {
    const token = await signJwt({ sub: "no-exp-user" }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
  });
```

No first-party path mints an exp-less token: `makeAccessToken`
(`workers/auth/jwt.js:214`, `exp: now + 300`) and `makeRefreshToken`
(`workers/auth/jwt.js:240`, `exp: now + 604800`) both set it, and the only
non-test `signJwt` callers are those two functions. CSRF tokens use a separate
HMAC scheme in `workers/auth/csrf.js` and do not go through `verifyJwt`.
This is therefore defence-in-depth hardening, not a live bypass: forging an
exp-less token requires the HS256 signing key.

### JSCORR-04 — `expirationTtl` is a KV option that DO storage ignores

`workers/auth/nonce_do.js:9-13` (verbatim) claims self-cleaning storage:

```js
 * Storage strategy:
 *   - In-memory Map for O(1) lookup within the same DO instance lifetime.
 *   - DO storage (KV) for cross-restart survival.
 *   - Expired nonces (>1 hr) are swept from memory on each request; DO storage
 *     entries are written with a 1-hour TTL via `expirationTtl`.
```

`workers/auth/nonce_do.js:74-77` sweeps memory only:

```js
    // Sweep expired in-memory nonces (>1 hour) to bound memory usage
    for (const [k, ts] of this.nonces) {
      if (now - ts > 3_600_000) this.nonces.delete(k);
    }
```

`workers/auth/nonce_do.js:96-97` (verbatim):

```js
    // Persist with 1-hour TTL so DO storage self-cleans
    await this.state.storage.put(hash, ts, { expirationTtl: 3600 });
```

`DurableObjectStorage.put()` accepts only `allowConcurrency`,
`allowUnconfirmed` and `noCache` — TTL is a KV concept and the option is
silently ignored. `wrangler.toml:62` registers the class as
`new_sqlite_classes = ["AuthNonce", "CouncilSessionDO"]`, where `deleteAll` and
`alarm` are the only cleanup mechanisms, and neither exists in this file. The
consequence is ~100 bytes of permanently retained storage per successful
Telegram login in one globally-shared DO (`idFromName("global")`, line 125),
plus a comment that documents behaviour the runtime does not provide. Note:
`storage.get(hash)` is a keyed point lookup and stays O(log n) — only stored
bytes grow, not per-request cost.

### Repo conventions this plan must match

- **Tenant isolation is app-layer.** `CloudflareIdentityStore.assertMembership()`
  runs a D1 SELECT per authenticated request; there is no database-level
  backstop. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1
  bindings, not Postgres connections.
- **Errors from the storage layer** are `StorageBoundaryError` with `{ code,
  status }` — see `workers/storage/contracts.js:21-28`. Handlers convert 4xx
  ones to typed JSON via their local `clientError()` helper. Match that shape:
  never throw a bare `Error` from a store method for an expected denial.
- **Structured logs**: mutation and auth handlers emit
  `console.log(JSON.stringify({ event, ... }))` / `console.error(...)`. New
  security events must follow the same one-line JSON shape.
- **Helpers already available inside `workers/storage/cloudflare.js`**:
  `assertUuid`, `assertAuthContext`, `StorageBoundaryError`, `utcNow` (all
  imported from `./contracts.js` in the import block at lines 10-29),
  `requireD1` (line 36), `rows` (line 46), `changeCount` (line 50),
  `refreshSessionError` (line 202).
- **Commit convention**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.
- **By design, do not "fix"**: the placeholder resource IDs in the checked-in
  `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags
  defaulting to `"false"`; `workers/austlii-scraper/scripts/rollback_run.ts`
  targeting legacy Supabase.

### Worker test conventions

Worker tests live in `workers/__tests__/*.test.js` and mock module boundaries
with `vi.mock`. The canonical shape, from
`workers/__tests__/cloudflare-mutations.test.js:1-49` (verbatim):

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));

import { dispatchCloudflareCaseMutation } from "../case-api/cloudflare_mutations.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function request(path, body, method = "POST") {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stores() {
  return {
    identityStore: { assertMembership: vi.fn(async (claims) => ({ ...claims, role: "owner" })) },
    objectStore: { putCaseSource: vi.fn(async ({ caseId }) => ({ key: `cases/${caseId}/source/${"a".repeat(64)}.txt`, sha256: "a".repeat(64), size: 4, contentType: "text/plain; charset=utf-8" })) },
    caseStore: {
      putImportedCase: vi.fn(async () => undefined),
      getCase: vi.fn(async (caseId) => ({ case_id: caseId, title: "Example", semantic_ready: 0, content_key: "hidden" })),
      updateCaseFields: vi.fn(async (caseId) => ({ case_id: caseId, title: "Updated", semantic_ready: 0 })),
      deleteCase: vi.fn(async () => true),
      batchDeleteCases: vi.fn(async () => 2),
      batchAddTag: vi.fn(async () => 2),
    },
    semanticIndex: { deleteCase: vi.fn(async () => ({ mutationId: "delete-1" })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockStores.mockReturnValue(stores());
});
```

For store-level tests, `workers/__tests__/cloudflare-storage-contracts.test.js:22-40`
supplies a fake D1 binding (verbatim):

```js
function d1({ allRows = [], firstRow = null, changes = 1 } = {}) {
  const calls = [];
  const binding = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; calls.push(this); return this; },
        all: vi.fn(async () => ({ results: allRows })),
        first: vi.fn(async () => firstRow),
        run: vi.fn(async () => ({ meta: { changes } })),
      };
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes } }))),
  };
  return binding;
}
```

That helper returns the same `firstRow` for every query, which is not enough
for a method that runs two different SELECTs. Step 2's test writes a small
SQL-dispatching variant instead; the shape above is the structural model.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (full) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0, **0 failed**; see "Baselines, not absolutes" |
| Worker tests (one file) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/auth-jwt.test.js` | exit 0, that file's tests pass |
| Worker test by name | `cd ".../workers" && npx vitest run __tests__/<file>.test.js -t "<test name>"` | that test passes |
| All tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test` | 0 failures except the 3 named Python ones below; frontend and workers green |
| Show a file region | `awk 'NR>=1290 && NR<=1320 {printf "%d: %s\n", NR, $0}' workers/storage/cloudflare.js` | prints numbered lines |
| Apply migrations to a scratch SQLite DB | `.venv/bin/python -c "..."` (Step 1) | see Step 1 |
| Confirm no stray edits | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope paths listed |

### Baselines, not absolutes

**Do not assert a whole-suite total anywhere in this plan.** Sibling plans
(004, 005, 007, 008) add tests to the same Worker suite, so any fixed total is
true only until one of them lands, and an executor who "corrects" a mismatched
total is editing the yardstick instead of the code. Record baselines first:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
WORKER_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
FILES_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Test Files +[0-9]+ passed' | grep -oE '[0-9]+')
for f in pipeline-control cloudflare-admin-handlers cloudflare-mutations auth-jwt auth-nonce cloudflare-native-auth-handlers; do
  printf '%s: ' "$f"; npx vitest run "__tests__/$f.test.js" 2>&1 | grep -oE 'Tests +[0-9]+ passed'
done
```

This plan adds **2 new test files** and **a net +31 tests** (see "Test plan").
The final assertion is `WORKER_BEFORE + 31` across `FILES_BEFORE + 2` files
with **0 failed**. Per-file deltas stated in each step are relative to the
per-file numbers you just recorded.

**Note on the 3 Python failures**: `make test-py` reports 3 failures that are
**environmental** — a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch
breaks the `pypdf` import. After this plan they must still be **exactly those
3, by name**:

- `tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent`

They are pre-existing, unrelated to this plan, and must not be "fixed" here.
Judge by **name**, not by count — a count can coincidentally stay at 3 while a
different test breaks.

## Suggested executor toolkit

- Python venv for this repo, if you need it: `.venv/bin/python`,
  `.venv/bin/pytest`, `.venv/bin/ruff`. Never use global `pip`. This plan
  changes no Python.
- Cloudflare Workers runtime API questions (Durable Object `alarm()`,
  `storage.list()`, `setAlarm()`): consult official Cloudflare Workers docs
  via the `context7` MCP tool if available rather than guessing option names.
  The key fact this plan already establishes: `DurableObjectStorage.put()` has
  **no** TTL option.

## Scope

**In scope** (the only files you may modify or create):

- `migrations/d1/account/0002_platform_admin.sql` (create)
- `workers/storage/cloudflare.js` — the identity/membership and refresh-session
  region only (the `CloudflareIdentityStore` class, lines ~1295-1506)
- `workers/pipeline/control_handlers.js`
- `workers/admin/cloudflare_handlers.js`
- `workers/case-api/cloudflare_mutations.js`
- `workers/auth/cloudflare_handlers.js`
- `workers/auth/jwt.js`
- `workers/auth/nonce_do.js`
- `workers/__tests__/pipeline-control.test.js`
- `workers/__tests__/cloudflare-admin-handlers.test.js`
- `workers/__tests__/cloudflare-mutations.test.js`
- `workers/__tests__/auth-jwt.test.js`
- `workers/__tests__/auth-nonce.test.js`
- `workers/__tests__/cloudflare-native-auth-handlers.test.js`
- `workers/__tests__/identity-platform-operator.test.js` (create)
- `workers/__tests__/identity-refresh-family.test.js` (create)
- `workers/__tests__/dispatcher-error-propagation.test.js` — **one line only**,
  and only if `plans/005-*.md` has landed: add `assertPlatformOperator` to the
  mutation test's store double, which Step 5 breaks. This plan owns that
  repair; see Step 5(iv).

**Out of scope** (do NOT touch, even though they look related):

- `wrangler.toml` — the checked-in file carries placeholder resource IDs and
  fail-closed flags **by design**; real values are operator-supplied secrets
  injected only inside the gated `workflow_dispatch` of `deploy-worker.yml`.
  The new `IMMI_PLATFORM_OPERATOR_IDS` var is operator-supplied for the same
  reason. Document it (Step 2 JSDoc + Maintenance notes); do not add it here.
- `frontend/**` — no frontend change is required by any step in this plan. In
  particular do **not** touch `frontend/src/contexts/AuthContext.tsx`; see
  "Findings reconsidered".
- `workers/auth/handlers.js`, `workers/auth/refresh_sessions.js`,
  `workers/llm-council/handlers.js` — legacy Hyperdrive/Postgres-era modules.
  `grep -rn "auth/handlers" workers` confirms nothing in the native path
  imports `workers/auth/handlers.js`.
- `immi_case_downloader/**`, `web.py`, and everything Python — the Flask app is
  local-dev only and is not in the production request path.
- `scripts/check_cloudflare_native_target.py`,
  `scripts/check_immi_activation_evidence.py` — the fail-closed deploy gates.
  Do not weaken or extend them.
- Any change to the `CRAWLER_WRITE_TOKEN` service-auth bypass in
  `requireWriter` — the VPS crawler depends on it and it is the documented
  production ingestion path.

## Git workflow

- Branch: `advisor/006-harden-auth-and-authorization`
  (`git switch -c advisor/006-harden-auth-and-authorization`)
- Commit per step, message style `<type>: <description>`, e.g.
  `feat: add platform operator grant separate from tenant role`,
  `fix: reject backslash-prefixed telegram callback redirect targets`.
- Do **NOT** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 0: Write the rollout runbook before you write any code

This plan removes an authority every current user has. **The order of
migration, grant and deploy is the difference between a clean cutover and a
window in which nobody — including the operator — can drive the pipeline.**
An earlier draft left this entirely to a "Maintenance notes" bullet that said
"deploy, then grant", which manufactures exactly that outage.

There is also no automation to lean on: `.github/workflows/deploy-worker.yml`
contains **no D1 migration step at all** (verified: a grep for `d1`,
`migration` and `migrate` over that workflow returns nothing). Migrations are
applied by hand via `wrangler d1 execute`. So the runbook is the only control.

Produce the following, verbatim, in the PR description. You do not execute it —
it needs production credentials you must not seek — but the plan is not done
without it.

**0a. Correct order (migration and grant BEFORE the code deploy).** Each step
is safe on the *old* code, which is what makes zero downtime possible:

| # | Action | Safe on old code because |
|---|---|---|
| 1 | `wrangler d1 execute IMMI_ACCOUNT_DB --file migrations/d1/account/0002_platform_admin.sql` (remote) | The column is additive and nothing reads it yet. |
| 2 | `SELECT user_id, username FROM users ORDER BY last_login_at DESC LIMIT 21;` — identify the operator's own `user_id` | Read-only. Use `LIMIT 21` and check whether 21 rows came back, so truncation is detectable; `LIMIT 20` with a `>= 20` check cannot tell "exactly 20" from "more". |
| 3 | `UPDATE users SET platform_admin = 1 WHERE user_id = '<uuid>';` for **at least two** people | Still nothing reads it. Two, not one, so a single lost device does not lock the platform. |
| 4 | Verify: `SELECT user_id, platform_admin FROM users WHERE platform_admin = 1;` returns the expected rows and **only** those | — |
| 5 | Deploy the Worker | The grants already exist, so the new gate admits the operator on the first request after rollout. |
| 6 | Smoke: `GET /api/v1/admin/pipeline-runs` as a granted user → `200`; as an ungranted user → `403 platform_operator_required` | This is the proof the cutover worked, in both directions. |

Steps 1–4 are reversible and can be done days ahead. Only step 5 changes
behaviour.

**0b. Break-glass path if the migration cannot be applied.** Set the Worker var
`IMMI_PLATFORM_OPERATOR_IDS` to a comma-separated list of user UUIDs. Step 2's
`assertPlatformOperator` checks the allowlist **before** touching the column
and fails closed if the column read throws, so this works with or without
migration 0002. Confirm the var is set *before* the deploy, not after.

**0c. Rollback.** Two independent levers, in preference order:

1. **Redeploy the previous Worker build.** The old code reads
   `memberships.role`, which is untouched, so it works immediately. This is the
   fast lever and the one to reach for first.
2. **Do not roll back the migration.** Dropping the column is unnecessary
   (nothing else reads it) and SQLite `DROP COLUMN` on a live table is riskier
   than leaving an unused integer column at 0.
3. To revoke a specific grant without a deploy:
   `UPDATE users SET platform_admin = 0 WHERE user_id = '<uuid>';` and remove
   the UUID from `IMMI_PLATFORM_OPERATOR_IDS`. **Both**, or the allowlist
   silently keeps the grant alive — that is the whole point of it being a
   break-glass override.

**0d. What to tell users.** After the deploy, everyone who is not granted gets
`403 platform_operator_required` on `POST /api/v1/pipeline-action`,
`POST /api/v1/download/start`, `POST /api/v1/legislations/update` and
`GET /api/v1/admin/pipeline-runs`. That is the fix, not a regression — but if
anyone besides the operator was using those routes, they need telling before
step 5, not after.

**Verify**: not machine-checkable. The Done criterion is that 0a–0d appear
verbatim in the PR description, with the operator's own `user_id` **not**
included (never write a real identifier into the plan or the PR — the operator
fills it in at run time).

### Step 1: Add the `platform_admin` column migration

Create `migrations/d1/account/0002_platform_admin.sql` with exactly this
content:

```sql
-- IMMI_ACCOUNT_DB migration 0002: platform-operator grant.
--
-- Tenant `memberships.role` is self-granted: the Telegram signup flow inserts
-- role='owner' for the auto-created personal tenant, so it can never be
-- evidence of platform authority. This column is the separate, operator-only
-- signal that gates the global pipeline controls, the platform admin read and
-- shared-catalog case writes.
--
-- Defaults to 0 for every existing and future row: fail-closed. Grant with
--   UPDATE users SET platform_admin = 1 WHERE user_id = '<uuid>';
-- run by an operator through `wrangler d1 execute`.
ALTER TABLE users ADD COLUMN platform_admin INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS users_platform_admin_idx ON users(platform_admin);
```

No code reads this yet — this step is purely additive.

**Verify — the file must actually execute, not merely exist.** An earlier draft
verified this step with `ls` plus `grep`, which proves nothing: a migration
with a syntax error, a wrong table name, or a column that already exists passes
both and then fails at `wrangler d1 execute` in front of the operator. Apply
both migrations to a throwaway SQLite database instead and inspect the
resulting schema:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/python - <<'PY'
import pathlib, sqlite3, sys

root = pathlib.Path(".")
con = sqlite3.connect(":memory:")
for name in ("0001_account.sql", "0002_platform_admin.sql"):
    sql = (root / "migrations/d1/account" / name).read_text(encoding="utf-8")
    con.executescript(sql)          # raises on any syntax or ordering error

cols = {row[1]: row for row in con.execute("PRAGMA table_info(users)")}
assert "platform_admin" in cols, f"platform_admin missing; got {sorted(cols)}"
_, _, coltype, notnull, default, _ = cols["platform_admin"]
assert coltype.upper() == "INTEGER", coltype
assert notnull == 1, "platform_admin must be NOT NULL"
assert str(default) == "0", f"platform_admin must default to 0 (fail closed), got {default!r}"

idx = {row[1] for row in con.execute("PRAGMA index_list(users)")}
assert "users_platform_admin_idx" in idx, sorted(idx)

# The grant must actually work, and must default to denied.
con.execute("INSERT INTO tenants VALUES ('t1','individual','T','now','now')")
con.execute("INSERT INTO users (user_id, created_at, updated_at) VALUES ('u1','now','now')")
assert con.execute("SELECT platform_admin FROM users WHERE user_id='u1'").fetchone()[0] == 0
con.execute("UPDATE users SET platform_admin = 1 WHERE user_id = 'u1'")
assert con.execute("SELECT platform_admin FROM users WHERE user_id='u1'").fetchone()[0] == 1
print("migration OK")
PY
```
→ prints `migration OK`. Any assertion failure or `sqlite3.OperationalError` is
a real defect in the migration — fix the SQL, not the check.

**Verify (the check can fail)**: temporarily change the migration's
`DEFAULT 0` to `DEFAULT 1`, re-run, and confirm the fail-closed assertion
fires. Restore it. A verification that cannot fail is not a verification.

**Note on `IF NOT EXISTS`**: SQLite's `ALTER TABLE ... ADD COLUMN` has no
`IF NOT EXISTS` form, so re-running `0002` against an already-migrated database
errors with `duplicate column name: platform_admin`. That is acceptable and
intended — it makes a double-apply loud rather than silent — but the operator
runbook in Step 0 must say so, because a runbook that re-runs migrations
blindly will trip on it.

### Step 2: Add `assertPlatformOperator()` to `CloudflareIdentityStore`

In `workers/storage/cloudflare.js`:

**2a.** Add a module-level helper and constant just above the
`export class CloudflareIdentityStore {` line (currently line 1295):

```js
/** Parse the operator break-glass allowlist: comma/space separated user UUIDs. */
function parseOperatorAllowlist(value) {
  if (typeof value !== "string" || !value.trim()) return new Set();
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}
```

**2b.** Extend the constructor (currently lines 1296-1298) to keep the
allowlist. It becomes:

```js
  constructor(env) {
    this.db = requireD1(env.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
    // Break-glass operator grant. Operator-supplied Worker var, absent from
    // the checked-in wrangler.toml by design (same policy as the resource IDs
    // and JWT secrets). Unset => nobody is a platform operator.
    this.platformOperatorIds = parseOperatorAllowlist(env?.IMMI_PLATFORM_OPERATOR_IDS);
  }
```

**2c.** Add `assertPlatformOperator()` immediately after `assertMembership()`
(i.e. after the closing brace on line 1314):

```js
  /**
   * Assert *platform* authority, which is deliberately NOT the tenant role.
   *
   * `memberships.role` is self-granted — upsertTelegramUser() inserts
   * role='owner' for the personal tenant it creates on first Telegram login —
   * so it can only ever authorize tenant-scoped resources. Global surfaces
   * (pipeline controls, platform admin reads, shared-catalog writes) must call
   * this instead.
   *
   * Two grant sources, both defaulting to "nobody":
   *   1. `users.platform_admin = 1` (migration 0002) — the durable grant.
   *   2. `IMMI_PLATFORM_OPERATOR_IDS` — an operator-supplied Worker var with a
   *      comma-separated list of user UUIDs. Break-glass, and the only way to
   *      grant the first operator before migration 0002 has been applied.
   *
   * Fails closed: any D1 error while reading the column (for example when
   * migration 0002 has not been applied yet) denies rather than throwing.
   */
  async assertPlatformOperator(auth) {
    const context = await this.assertMembership(auth);
    if (this.platformOperatorIds.has(context.userId)) {
      return { ...context, platformOperator: true, grant: "allowlist" };
    }
    let row = null;
    try {
      row = await this.db.prepare(`
        SELECT platform_admin FROM users WHERE user_id = ? LIMIT 1
      `).bind(context.userId).first();
    } catch (error) {
      console.error(JSON.stringify({
        event: "auth.platform_operator.lookup_failed",
        user_id: context.userId,
        error: error?.message,
      }));
      row = null;
    }
    if (Number(row?.platform_admin) === 1) {
      return { ...context, platformOperator: true, grant: "platform_admin" };
    }
    throw new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    });
  }
```

Note `assertMembership()` runs first on purpose: it keeps the live tenant and
revocation check, and it normalises `context.userId` to lowercase via
`assertAuthContext` → `assertUuid`, which is why the allowlist is lowercased
too.

Nothing calls the new method yet, so the suite must still be green unchanged.

**2c-test.** Create `workers/__tests__/identity-platform-operator.test.js`
testing `CloudflareIdentityStore.assertPlatformOperator` through the exported
factory `createCloudflareIdentityStore` (`workers/storage/cloudflare.js:1901`).
Because the method issues two different SELECTs, use a SQL-dispatching fake D1
rather than the fixed-`firstRow` helper:

```js
import { describe, expect, it, vi } from "vitest";
import { createCloudflareIdentityStore } from "../storage/cloudflare.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUTH = { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] };

/** Fake D1 that answers per-statement based on the SQL text. */
function accountDb({ membership = { role: "owner" }, user = { platform_admin: 0 }, throwOnUsers = false } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
        first: vi.fn(async () => {
          if (sql.includes("FROM memberships")) return membership;
          if (sql.includes("platform_admin")) {
            if (throwOnUsers) throw new Error("no such column: platform_admin");
            return user;
          }
          return null;
        }),
      };
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
}

function env(overrides = {}) {
  return { IMMI_STORAGE_MODE: "cloudflare", IMMI_ACCOUNT_DB: accountDb(), ...overrides };
}
```

Cases to assert (six):

1. A fresh Telegram signup — membership role `"owner"`, `platform_admin: 0` —
   is rejected: `await expect(store.assertPlatformOperator(AUTH)).rejects.toMatchObject({ code: "platform_operator_required", status: 403 })`.
2. Tenant role `"admin"` with `platform_admin: 0` is likewise rejected (proves
   the tenant role no longer confers platform authority).
3. `platform_admin: 1` is granted, and the result has
   `{ platformOperator: true, grant: "platform_admin" }`.
4. `IMMI_PLATFORM_OPERATOR_IDS` containing `USER_ID` grants with
   `grant: "allowlist"`, even when `platform_admin: 0`.
5. `IMMI_PLATFORM_OPERATOR_IDS` set to some *other* UUID still rejects.
6. `throwOnUsers: true` (migration 0002 not applied) rejects with 403 rather
   than propagating the D1 error.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ exit 0, **0 failed**, `Tests` == `WORKER_BEFORE + 6` and `Test Files` ==
`FILES_BEFORE + 1`. Separately,
`npx vitest run __tests__/identity-platform-operator.test.js` → `6 passed`
(a per-file count, stable).

### Step 3: Gate the global pipeline controls on platform operator

In `workers/pipeline/control_handlers.js`, replace the body of
`requireOperator` (lines 45-58) so the role check is gone and the platform
grant is consulted instead. The whole function becomes:

```js
async function requireOperator(request, env, stores) {
  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    // These three CONTROL_PATHS are global in effect, and the tenant role is
    // self-granted at signup, so only a platform grant can authorize them.
    // (Deliberately does not name the tenant-scoped check here: the Done
    // criteria grep for calls to it in this file, and a comment mentioning it
    // would be a false positive.)
    const auth = await stores.identityStore.assertPlatformOperator(authResult.claims);
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}
```

**Also fix the dispatcher's four missing `await`s — do not "leave it
untouched".** An earlier draft of this step said to leave
`dispatchCloudflarePipelineControl` alone. That was wrong twice over: it leaves
the exact defect `plans/005-*.md` explicitly hands to this plan, and the count
was wrong. There are **four** unawaited dispatch lines, not one — verified:

```
workers/pipeline/control_handlers.js:109:      return enqueueControl(request, env, stores, "download", {
workers/pipeline/control_handlers.js:119:      return enqueueControl(request, env, stores, "legislation_update", { law_ids: requested });
workers/pipeline/control_handlers.js:123:    if (action === "stop") return enqueueControl(request, env, stores, "stop", {});
workers/pipeline/control_handlers.js:124:    return enqueueControl(request, env, stores, "start", {
```

All four sit inside the `try` opened at line 101 whose `catch` is at line 129,
and `dispatchCloudflarePipelineControl` is `async` — so `return somePromise`
settles after the `try` scope is left and the `catch` never sees a rejection
raised inside `enqueueControl` (which throws a deliberate
`StorageBoundaryError` at line 88). Change all four to
`return await enqueueControl(...)`. Nothing else in the dispatcher changes: it
already handles a `Response` return at line 104 and routes
`StorageBoundaryError` through `clientError` at line 130.

**Verify the await fix**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -cE "return enqueueControl\(" workers/pipeline/control_handlers.js        # → 0
grep -cE "return await enqueueControl\(" workers/pipeline/control_handlers.js  # → 4
node --check workers/pipeline/control_handlers.js                              # → exit 0
```

**Test updates** in `workers/__tests__/pipeline-control.test.js`.

**(i) The shared `stores()` helper** at lines 28-36 currently supplies only
`assertMembership`. Add `assertPlatformOperator` alongside it (keep
`assertMembership` — other code in the file may still reference it):

```js
function stores() {
  return {
    identityStore: {
      assertMembership: vi.fn(async () => ({ ...CLAIMS, role: "admin" })),
      assertPlatformOperator: vi.fn(async () => ({ ...CLAIMS, platformOperator: true, grant: "platform_admin" })),
    },
    pipelineStore: {
      recordControlCommand: vi.fn(async () => true),
      updateControlCommand: vi.fn(async () => undefined),
    },
  };
}
```

**(ii) You must also fix the existing test that builds its own store double.**
`it("requires an operator role", ...)` at line 91 does **not** use the shared
helper — line 93 constructs an inline object containing only
`assertMembership: vi.fn(async () => ({ ...CLAIMS, role: "viewer" }))`
(verified verbatim). After the `requireOperator` rewrite, that test calls
`stores.identityStore.assertPlatformOperator(...)` on an object where it is
`undefined`, and fails with `assertPlatformOperator is not a function` — a
TypeError, not the 403 it asserts. Rewrite it so it tests the new gate:

```js
  it("requires a platform operator grant, not a tenant role", async () => {
    const current = stores();
    // A tenant `viewer` and a tenant `owner` are equally irrelevant now: the
    // signup flow self-grants `owner`, so only the platform grant decides.
    current.identityStore.assertMembership = vi.fn(async () => ({ ...CLAIMS, role: "viewer" }));
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
    mockStores.mockReturnValue(current);
    // ...rest of the original test body, but asserting 403 with
    // code "platform_operator_required" instead of "operator_role_required".
  });
```

Read the original test body before rewriting and preserve its dispatch call and
its "nothing was enqueued" assertions; only the store double and the expected
error code change.

**(iii) Add a queue-rejection regression test**, which is what the `await` fix
buys. Without it the fix is unverified:

```js
  it("returns a typed response when the control queue rejects", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => { throw new Error("queue unavailable"); });
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "start" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    // Before the `await` fix this rejects out of the dispatcher entirely and
    // the runtime turns it into a bodyless 500 with no `code` field.
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).toHaveProperty("code");
  });
```

**Verify (iii) can fail**: revert one `return await enqueueControl` to
`return enqueueControl`, re-run this test, and confirm it fails (the call
rejects instead of returning a Response). Restore, re-run green.

**(iv)** Then add one new test proving the SEC-01 regression is closed:

```js
  it("denies a self-granted tenant owner who is not a platform operator", async () => {
    const current = stores();
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => undefined);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "start" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(send).not.toHaveBeenCalled();
    expect(current.pipelineStore.recordControlCommand).not.toHaveBeenCalled();
  });
```

That test needs `StorageBoundaryError`. The file mocks
`../storage/cloudflare.js` at line 7 but not `../storage/contracts.js`, so add
a real import at the top of the test file:
`import { StorageBoundaryError } from "../storage/contracts.js";`

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/pipeline-control.test.js
```
→ exit 0, **0 failed**, and the per-file count is `pipeline-control BEFORE + 2`
(one rewritten in place, two added). Then check the three that matter by name:
```bash
npx vitest run __tests__/pipeline-control.test.js -t "requires a platform operator grant, not a tenant role"
npx vitest run __tests__/pipeline-control.test.js -t "returns a typed response when the control queue rejects"
npx vitest run __tests__/pipeline-control.test.js -t "denies a self-granted tenant owner"
```
→ each passes.

### Step 4: Gate the platform admin read on platform operator

In `workers/admin/cloudflare_handlers.js`, delete the `isAdmin` helper (lines
10-12) entirely — nothing anywhere sets `claims.is_admin`, so it is dead code
that reads as a real check. Replace the authorization lines 20-21 with a call
to the new method. The `try` block becomes:

```js
  try {
    const stores = createCloudflareStores(env);
    // Platform-wide read: gate on the operator grant, not the self-granted
    // tenant role.
    await stores.identityStore.assertPlatformOperator(auth.claims);
    const limit = Number.parseInt(url.searchParams.get("limit") || "30", 10);
    const result = await stores.pipelineStore.listRuns(Number.isFinite(limit) ? limit : 30);
    return json(result);
  } catch (error) {
```

The existing `catch` at lines 25-29 already converts `StorageBoundaryError` to
`json({error, code}, error.status)`, so a denial surfaces as
`403 platform_operator_required` with no further change.

**Test updates** in `workers/__tests__/cloudflare-admin-handlers.test.js`:

- Add `const mockAssertPlatformOperator = vi.fn();` next to the existing mocks
  (lines 3-5) and wire it into the `vi.mock` factory (lines 9-14) as
  `assertPlatformOperator: (...args) => mockAssertPlatformOperator(...args)`
  inside `identityStore`.
- In `beforeEach`, add
  `mockAssertPlatformOperator.mockResolvedValue({ platformOperator: true, grant: "platform_admin" });`
- Rewrite the second test (lines 37-46) so the denial arm rejects with the new
  typed error instead of returning `{ role: "member" }`:

```js
  it("requires a platform operator grant and reads only through PipelineStore", async () => {
    mockAssertPlatformOperator.mockRejectedValueOnce(new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    }));
    const denied = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs"));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "platform_operator_required" });
    expect(mockListRuns).not.toHaveBeenCalled();

    const response = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs?limit=10"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs?limit=10"));
    expect(response.status).toBe(200);
    expect(mockListRuns).toHaveBeenCalledWith(10);
    expect(await response.json()).toMatchObject({ summary: { total_runs: 0 } });
  });
```

  Add `import { StorageBoundaryError } from "../storage/contracts.js";` at the
  top of that test file.
- Add one more test asserting a tenant `owner` alone is not enough:

```js
  it("rejects a tenant owner with no platform grant", async () => {
    mockRequireAuth.mockResolvedValueOnce({ claims: {
      role: "owner",
      sub: "11111111-2222-4333-8444-555555555555",
      tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    } });
    mockAssertPlatformOperator.mockRejectedValueOnce(new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    }));
    const response = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs"));
    expect(response.status).toBe(403);
  });
```

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-admin-handlers.test.js`
→ exit 0, 3 tests pass. Also confirm the dead helper is gone:
`grep -c "is_admin" workers/admin/cloudflare_handlers.js` → `0`.

### Step 5: Gate shared-catalog case writes on platform operator (SEC-02)

In `workers/case-api/cloudflare_mutations.js`, change **only** the JWT arm of
`requireWriter`. Keep the `CRAWLER_WRITE_TOKEN` block (lines 57-63) and the
CSRF/auth calls exactly as they are; replace the `try` block at lines 69-75:

```js
  try {
    // The `cases` table has no tenant column — every write here mutates the
    // shared catalog, so tenant membership is not sufficient authorization.
    // The tenant role is self-granted at signup; require the platform grant.
    const auth = await stores.identityStore.assertPlatformOperator(authResult.claims);
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
```

Leave `dispatchCloudflareCaseMutation` (lines 290-320) untouched; the freeze
check at 302, `requireMutationQueue`, and the `Response` handling at 309 all
still work.

**Test updates — three of them, and two are repairs to tests that this change
breaks.** Skipping the repairs leaves the suite red.

**(i) The shared `stores()` helper** in
`workers/__tests__/cloudflare-mutations.test.js` (lines 28-42): add
`assertPlatformOperator` next to `assertMembership`:

```js
    identityStore: {
      assertMembership: vi.fn(async (claims) => ({ ...claims, role: "owner" })),
      assertPlatformOperator: vi.fn(async (claims) => ({ ...claims, platformOperator: true, grant: "platform_admin" })),
    },
```

**(ii) Two existing tests assert the *old* call and will fail.** Verified
verbatim:

- line 101, in `it("uses tenant auth and CSRF for metadata update", ...)`:
  `expect(current.identityStore.assertMembership).toHaveBeenCalledWith(CLAIMS);`
- line 267, in `it("falls through to JWT auth when the crawler token is absent", ...)`:
  `expect(current.identityStore.assertMembership).toHaveBeenCalledWith(CLAIMS);`

After this step `requireWriter` calls `assertPlatformOperator` instead, so both
assertions fail. Change **both** to
`expect(current.identityStore.assertPlatformOperator).toHaveBeenCalledWith(CLAIMS);`
and rename the first test to
`it("requires a platform operator grant and CSRF for metadata update", ...)`
so the name still describes what it checks.

Line 246, in `it("accepts a crawler service token without login or CSRF", ...)`,
reads `expect(current.identityStore.assertMembership).not.toHaveBeenCalled();`.
That one still passes, but it now proves less than it should — the crawler
bypass must skip the *platform* check too. Add, next to it:
`expect(current.identityStore.assertPlatformOperator).not.toHaveBeenCalled();`

**(iii)** Add `import { StorageBoundaryError } from "../storage/contracts.js";`
at the top, then add one new `describe` block with four cases — all with the freeze
lifted (`IMMI_CASE_MUTATIONS_ENABLED: "true"`) and the mutation queue bound the
same way the existing unfrozen tests in this file do it (copy the `env` object
from whichever existing test already passes `IMMI_CASE_MUTATIONS_ENABLED:
"true"`; run `grep -n 'IMMI_CASE_MUTATIONS_ENABLED' workers/__tests__/cloudflare-mutations.test.js`
to find it). Each case sets:

```js
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
```

and asserts `response.status === 403`, body `code === "platform_operator_required"`,
and that the corresponding store method was **not** called:

1. `POST /api/v1/cases` → `caseStore.putImportedCase` not called.
2. `PUT /api/v1/cases/0123456789ab` → `caseStore.updateCaseFields` not called.
3. `DELETE /api/v1/cases/0123456789ab` → `caseStore.deleteCase` not called.
4. `POST /api/v1/cases/batch` with `{ action: "delete", case_ids: ["0123456789ab","0123456789ac"] }`
   → `caseStore.batchDeleteCases` not called.

Add a fifth case proving the crawler bypass still works: with
`CRAWLER_WRITE_TOKEN: "s3cret"` in env and header
`Authorization: Bearer s3cret`, a `POST /api/v1/cases` succeeds without
`assertPlatformOperator` ever being called
(`expect(current.identityStore.assertPlatformOperator).not.toHaveBeenCalled()`).

**(iv) Repair the test `plans/005-*.md` added, if that plan has landed.**
005 creates `workers/__tests__/dispatcher-error-propagation.test.js` with
`it("surfaces a typed storage error from a case mutation handler", ...)`, whose
store double supplies only
`identityStore: { assertMembership: vi.fn(async () => AUTH) }`. After this step
that test fails with `assertPlatformOperator is not a function`. **This plan
owns the repair** — add `assertPlatformOperator: vi.fn(async () => AUTH)` to
that double. Do not delete or skip the test, and do not ask 005 to
pre-emptively add a method that did not exist when it was written. If 005 has
not landed, this sub-step is a no-op; check with
`ls workers/__tests__/dispatcher-error-propagation.test.js`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/cloudflare-mutations.test.js
```
→ exit 0, **0 failed**, per-file count is `cloudflare-mutations BEFORE + 5`.
Then, if 005 has landed:
```bash
npx vitest run __tests__/dispatcher-error-propagation.test.js
```
→ exit 0, **0 failed**.

**Verify the repairs were actually needed** (i.e. that you did not skip a
broken test): before making change (ii), run
`npx vitest run __tests__/cloudflare-mutations.test.js` with only the
`requireWriter` edit applied and confirm exactly the two named tests fail. If
they pass, `requireWriter` was not rewired — go back and check.

### Step 6: Close the open redirect in the Telegram callback (SEC-03)

In `workers/auth/cloudflare_handlers.js`, replace `safeRedirectTarget` (lines
56-59) with an origin-verifying version, and **export** it so it is unit
testable:

```js
const DEFAULT_REDIRECT = "/app/";

/**
 * Resolve the post-login `next` target to a same-origin path, or the default.
 *
 * Prefix checks alone are not sufficient: `/\evil.example` passes a
 * `startsWith("//")` test but browsers resolve it as a protocol-relative URL
 * (WHATWG URL "special authority ignore slashes" state), producing an open
 * redirect from a genuine immi.trackit.today login link. Parse against the
 * request origin and accept only when the resolved origin still matches.
 */
export function safeRedirectTarget(value, origin) {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_REDIRECT;
  // Reject C0 controls, DEL and backslashes outright — none belong in a path
  // and all of them are URL-parser ambiguity vectors.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return DEFAULT_REDIRECT;
  let resolved;
  try {
    resolved = new URL(value, origin);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (resolved.origin !== new URL(origin).origin) return DEFAULT_REDIRECT;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
```

Update the one caller, `handleTelegramCallback` line 129, to pass the origin it
already has:

```js
  const next = safeRedirectTarget(url.searchParams.get("next"), url.origin);
```

**Tests**: add a `describe("safeRedirectTarget")` block to
`workers/__tests__/cloudflare-native-auth-handlers.test.js` and add
`safeRedirectTarget` to that file's existing import from
`../auth/cloudflare_handlers.js` (lines 26-31). Write **one `it` block per
row below** (9 in total), calling it with origin `"https://immi.example"`:

| Input | Expected |
|---|---|
| `"/cases/abc"` | `"/cases/abc"` |
| `"/cases?year=2024#top"` | `"/cases?year=2024#top"` |
| `"/\\evil.example"` (JS source: a leading slash then one escaped backslash) | `"/app/"` |
| `"//evil.example"` | `"/app/"` |
| `"https://evil.example"` | `"/app/"` |
| `"/\\/evil.example"` | `"/app/"` |
| `"/cases\u0000evil"` (a NUL written as an escape in the test source) | `"/app/"` |
| `null` | `"/app/"` |
| `""` | `"/app/"` |

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-auth-handlers.test.js`
→ exit 0, 9 new assertions pass alongside the existing tests.

### Step 7: Revoke the whole refresh-token family on reuse (SEC-10)

In `workers/storage/cloudflare.js`:

**7a. No grace window — revoke the family on any reuse of a revoked token.**

An earlier draft of this step added a 10-second `REFRESH_REUSE_GRACE_MS` window
in which a rotated token could be replayed without revoking the family. That is
a real weakening of the control, not a refinement of it, and the attack it
admits is the exact one the control exists to stop:

> The attacker steals a refresh cookie and redeems it first. The victim's
> browser refreshes seconds later with the now-revoked token. Inside a
> 10-second window the victim gets a bare 401 and the **attacker's successor
> family stays live** — the attacker keeps a rolling 7-day lineage and the only
> signal anyone sees is one failed refresh, which looks like a flaky network.

Ten seconds is not a small window either: a proactive-refresh timer firing on a
background tab lands well inside it. So the default must be fail-secure:
**any reuse of a revoked refresh token revokes the whole family**, with no
time-based exemption.

Add **no** grace constant. Do not add a config knob for it either — a knob
whose safe value is zero is a footgun with a label on it.

The multi-tab concurrent-refresh case is real, and it is handled where it
belongs rather than by ignoring a security signal:

- The compare-and-swap failure branch in `rotateRefreshSession`
  (lines 1503-1505) already covers genuine simultaneity — two requests racing
  the *same* live token. That branch deliberately does **not** revoke the
  family (see 7b), because there the loser never held a revoked token.
- The remaining case — a tab whose refresh lands *after* another tab's
  rotation committed — is a client bug, and its fix is client-side
  single-flight in `frontend/src/contexts/AuthContext.tsx` (one in-flight
  refresh promise shared by all callers). `frontend/` is out of this plan's
  scope, so this is recorded as a follow-up in "Maintenance notes" with the
  telemetry to size it first.
- Because it is a client bug, ship this with the `auth.refresh.reuse_detected`
  log event and **watch it for one week before assuming the client is fine**.
  If it fires at a rate that correlates with active multi-tab users rather than
  with anything attack-shaped, do the client single-flight work — do not
  reintroduce the window.

**7b.** Add `revokeRefreshFamily()` immediately after `revokeRefreshSession()`
(after the closing brace on line 1455):

```js
  /**
   * Revoke every live session in a refresh-token family.
   *
   * COALESCE keeps the original revocation metadata on rows that were already
   * rotated, so this is idempotent and does not rewrite history.
   */
  async revokeRefreshFamily({ familyId, userId, reason = "reuse_detected" }) {
    const checkedFamilyId = assertUuid(familyId, "refresh.familyId");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const now = utcNow();
    const result = await this.db.prepare(`
      UPDATE immi_refresh_sessions
      SET revoked_at = COALESCE(revoked_at, ?),
          revoked_reason = COALESCE(revoked_reason, ?),
          last_used_at = COALESCE(last_used_at, ?)
      WHERE family_id = ? AND user_id = ?
    `).bind(now, reason, now, checkedFamilyId, checkedUserId).run();
    return changeCount(result);
  }
```

**7c.** In `loadRefreshAuthSnapshot`, add `revoked_reason` to the SELECT (line
1461) and replace the single-line revoked check at line 1465. The SELECT
becomes:

```js
    const session = await this.db.prepare(`
      SELECT jti, user_id, family_id, expires_at, revoked_at, revoked_reason
      FROM immi_refresh_sessions WHERE jti = ? AND user_id = ? LIMIT 1
    `).bind(checkedJti, checkedUserId).first();
```

and line 1465 becomes:

```js
    if (session.revoked_at) {
      // Primary reuse-detection point: handleAuthRefresh calls this BEFORE
      // rotateRefreshSession, so an already-rotated token lands here, not in
      // the CAS backstop. A stolen refresh cookie redeemed after the victim's
      // next refresh must kill the whole lineage, not just the presented jti.
      //
      // No time-based exemption, deliberately. A grace window would let an
      // attacker who rotated first keep a live successor family whenever the
      // victim's replay happens to land inside it, and a background tab's
      // proactive-refresh timer lands inside any window worth having. Benign
      // simultaneity is handled by the CAS branch in rotateRefreshSession,
      // where the loser never held a revoked token.
      await this.revokeRefreshFamily({
        familyId: session.family_id,
        userId: checkedUserId,
        reason: "reuse_detected",
      });
      console.log(JSON.stringify({
        event: "auth.refresh.reuse_detected",
        user_id: checkedUserId,
        family_id: session.family_id,
        revoked_reason: session.revoked_reason || null,
      }));
      throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    }
```

`revoked_reason` is still added to the SELECT: it is not used for a decision
any more, but it is what makes the log line diagnosable (`"rotated"` reads as
possible client double-refresh; `"logout"` or `"reuse_detected"` reads as a
replay of a token that was explicitly killed).

**7b. Do NOT add family revocation to the compare-and-swap failure branch** at
lines 1503-1505. That branch fires only on a genuine concurrent race — two
requests contending for the *same live* token — where the loser never held a
revoked credential and revoking the family would destroy the successor the
winning request just issued. This is the one place where not revoking is
correct, and test 4 below pins it so a later "consistency" refactor cannot
quietly remove the distinction.

**7c-test.** Create `workers/__tests__/identity-refresh-family.test.js` using
the same SQL-dispatching fake-D1 approach as Step 2, with `run()` recording the
SQL and bound params so the family UPDATE can be asserted. Cases (five):

1. **Reuse of a rotated token revokes the family**: `first()` returns
   `{ jti, user_id, family_id, expires_at: <future ISO>, revoked_at: <60s ago ISO>, revoked_reason: "rotated" }`.
   Assert `loadRefreshAuthSnapshot` rejects with `code: "revoked_refresh_token"`
   **and** that a statement whose SQL matches `/UPDATE immi_refresh_sessions/`
   and `/WHERE family_id = \? AND user_id = \?/` was `run()` with
   `reason === "reuse_detected"`.
2. **Reuse one second after rotation revokes the family too** — same row but
   `revoked_at` 1 second ago. This is the case an earlier draft exempted with a
   10-second grace window; it must now revoke, because that window is exactly
   where an attacker-who-rotated-first hides. Assert the family UPDATE ran.
3. **A logout-revoked token revokes the family**: `revoked_reason: "logout"`,
   `revoked_at` 1 second ago — same outcome, no reason-based exemption either.
4. **The CAS backstop does not revoke the family** — drive
   `rotateRefreshSession` so the compare-and-swap reports `changes: 0` and
   assert it rejects with `revoked_refresh_token` **and that no statement
   matching `/WHERE family_id = \?/` was run**. This pins the one place where
   *not* revoking is correct: a genuine concurrent race whose winner just
   minted the successor. Without this test, a later "simplification" that
   revokes there too would silently log the winning tab out.
5. **`revokeRefreshFamily` validates input**: a non-UUID `familyId` rejects
   with `code: "invalid_identifier"`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/identity-refresh-family.test.js
```
→ exit 0, `Tests 5 passed (5)` (a per-file count for a file only this plan
owns, so it is stable).

**Verify no grace window survived**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -c "REFRESH_REUSE_GRACE_MS\|benignRace" workers/storage/cloudflare.js
```
→ `0`.

Then confirm the whole suite still passes:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ exit 0, **0 failed**.

### Step 8: Require `exp` in `verifyJwt` (JSCORR-16 + TEST-19)

In `workers/auth/jwt.js`, replace lines 183-187:

```js
  // Check expiry. A missing or non-numeric exp is rejected, not treated as
  // "never expires": the 5-minute access-token TTL is the entire revocation
  // story for reads, so an exp-less token would be a permanent credential.
  // makeAccessToken and makeRefreshToken always set exp, so no first-party
  // token is affected.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp < now) {
    return { valid: false, payload: null, reason: "expired" };
  }
```

Then update the JSDoc `@returns` line at `workers/auth/jwt.js:120` is unchanged
(`'expired'` is already a documented reason).

**Test update** in `workers/__tests__/auth-jwt.test.js`: invert the test at
lines 154-158 so it pins the new contract:

```js
  it("rejects a token with no exp field — exp is mandatory", async () => {
    // A missing exp used to mean "never expires", which would turn any token
    // minted off a leaked signing key into a permanent credential. Both
    // first-party minters (makeAccessToken / makeRefreshToken) always set exp.
    const token = await signJwt({ sub: "no-exp-user" }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.payload).toBeNull();
  });

  it("rejects a token whose exp is a string rather than a number", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: "string-exp-user", exp: String(now + 3600) }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });
```

No other test in that file signs a verify-bound token without `exp` — verified
with `grep -n "signJwt(" workers/__tests__/auth-jwt.test.js`: every other call
either sets `exp` or is an error-path assertion on `signJwt` itself (lines 247,
252, 257) that never reaches `verifyJwt`.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/auth-jwt.test.js`
→ exit 0, **0 failed**, per-file count == `auth-jwt BEFORE + 1` (one test
rewritten in place, one added). At the time of writing the baseline was 30, so
`31 passed`; re-derive it from your own Step-0 recording rather than assuming.
Also check the two by name:
```bash
npx vitest run __tests__/auth-jwt.test.js -t "rejects a token with no exp field"
npx vitest run __tests__/auth-jwt.test.js -t "rejects a token whose exp is a string"
```

### Step 9: Make the AuthNonce DO actually prune its storage (JSCORR-04)

In `workers/auth/nonce_do.js`:

**9a.** Fix the misleading header comment. Replace lines 9-13 with:

```js
 * Storage strategy:
 *   - In-memory Map for O(1) lookup within the same DO instance lifetime.
 *   - DO storage for cross-restart survival.
 *   - Expired nonces (>1 hr) are swept from memory on each request, and from
 *     DO storage by the alarm() handler below. DurableObjectStorage.put() has
 *     no TTL option — `expirationTtl` is a KV concept and was silently ignored
 *     here, so entries accumulated forever.
```

**9b.** Add a module-level constant above the class:

```js
const NONCE_TTL_MS = 3_600_000;
```

and use it in place of the two `3_600_000` literals (line 76 and the new code).

**9c.** Replace the persist call at lines 96-97 with a plain put plus an alarm
schedule:

```js
    // DO storage has no TTL; alarm() below prunes expired entries instead.
    await this.state.storage.put(hash, ts);
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm === undefined) {
      await this.state.storage.setAlarm(Date.now() + NONCE_TTL_MS);
    }
```

**9d.** Add an `alarm()` method to the `AuthNonce` class, after `fetch()`:

```js
  /**
   * Prune nonces older than the TTL from DO storage, then re-arm while any
   * entries remain. Without this the store grows by ~100 bytes per successful
   * Telegram login, forever, in a single globally-shared Durable Object.
   */
  async alarm() {
    const now = Date.now();
    const stored = await this.state.storage.list();
    const expired = [];
    let remaining = 0;
    for (const [key, ts] of stored) {
      if (typeof ts === "number" && now - ts > NONCE_TTL_MS) expired.push(key);
      else remaining += 1;
    }
    if (expired.length) {
      await this.state.storage.delete(expired);
      for (const key of expired) this.nonces.delete(key);
    }
    if (remaining > 0) await this.state.storage.setAlarm(now + NONCE_TTL_MS);
  }
```

`wrangler.toml:62` already declares `new_sqlite_classes = ["AuthNonce",
"CouncilSessionDO"]`, which supports alarms — **no `wrangler.toml` change is
needed or permitted**.

**Tests**: add a `describe("AuthNonce storage pruning")` block to
`workers/__tests__/auth-nonce.test.js`, importing the class:
`import { AuthNonce, checkNonce } from "../auth/nonce_do.js";` (the file
currently imports only `checkNonce` at line 16). Build a fake `state`:

```js
function fakeState(initial = new Map()) {
  let alarm = null;
  const storage = {
    _map: initial,
    async get(key) { return initial.get(key); },
    async put(key, value) { initial.set(key, value); },
    async list() { return new Map(initial); },
    async delete(keys) { for (const k of [].concat(keys)) initial.delete(k); },
    async getAlarm() { return alarm; },
    async setAlarm(when) { alarm = when; },
    get _alarm() { return alarm; },
  };
  return { storage };
}
```

Cases (four):

1. `put` is called **without** an options argument — assert with a `vi.fn()`
   spy wrapping `storage.put` that it received exactly two arguments
   (`expect(spy.mock.calls[0]).toHaveLength(2)`). This is the direct regression
   pin for the ignored `expirationTtl`.
2. A first-seen hash schedules an alarm when none exists
   (`storage.getAlarm()` returns a number afterwards).
3. `alarm()` deletes entries older than one hour and keeps fresh ones: seed the
   map with `{ old: Date.now() - 7_200_000, fresh: Date.now() }`, run `alarm()`,
   assert the map has only `fresh`.
4. `alarm()` re-arms while entries remain, and does **not** re-arm when the map
   is emptied.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/auth-nonce.test.js`
→ exit 0, 6 existing + 4 new tests pass. Then confirm the literal is gone:
`grep -c "expirationTtl" workers/auth/nonce_do.js` → `0`.

## Test plan

New tests, by file:

| File | New cases |
|---|---|
| `workers/__tests__/identity-platform-operator.test.js` (new) | 6 — fresh signup denied; tenant `admin` denied; `platform_admin=1` granted; env allowlist granted; wrong allowlist entry denied; missing-column D1 error denied not thrown |
| `workers/__tests__/pipeline-control.test.js` | 1 rewritten + 2 new — `"requires an operator role"` rewritten onto the platform gate (it would otherwise die with `assertPlatformOperator is not a function`); queue rejection returns a typed response (pins the four `await` fixes); self-granted tenant owner gets 403 `platform_operator_required` and nothing is enqueued |
| `workers/__tests__/cloudflare-admin-handlers.test.js` | 1 rewritten + 1 new — denial arm returns 403 `platform_operator_required`; tenant `owner` alone rejected |
| `workers/__tests__/cloudflare-mutations.test.js` | 2 repaired + 5 new — the `assertMembership` call assertions at lines 101 and 267 become `assertPlatformOperator`; POST/PUT/DELETE/batch-delete each 403 with the store method uncalled; crawler token bypass still succeeds |
| `workers/__tests__/dispatcher-error-propagation.test.js` (owned by plan 005) | 1 repaired — add `assertPlatformOperator` to its mutation store double, if 005 has landed |
| `workers/__tests__/cloudflare-native-auth-handlers.test.js` | 9 — one `it` per row of the Step 6 table: `safeRedirectTarget` accepts same-origin paths and rejects `/\`, `//`, absolute, NUL, null, empty |
| `workers/__tests__/identity-refresh-family.test.js` (new) | 5 — reuse of a rotated token revokes the family; reuse 1s after rotation revokes it too (no grace window); logout-revoked reuse revokes it; the CAS backstop does **not**; invalid familyId rejected |
| `workers/__tests__/auth-jwt.test.js` | 1 rewritten + 1 new — exp-less token rejected as `expired`; string `exp` rejected |
| `workers/__tests__/auth-nonce.test.js` | 4 — `put` called with 2 args (no options); alarm scheduled on first write; `alarm()` prunes expired and keeps fresh; re-arms only while entries remain |

Structural patterns to copy: handler tests follow
`workers/__tests__/cloudflare-mutations.test.js:1-49` (module mocks +
`beforeEach` reset); store tests follow the fake-D1 shape in
`workers/__tests__/cloudflare-storage-contracts.test.js:22-40`, extended to
dispatch on SQL text.

**Net test delta: +31** (6 + 2 + 1 + 5 + 9 + 5 + 1 + 2, with three tests
rewritten in place and three repaired in place, none of which change the
count). Final verification:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ exit 0, **0 failed**, `Tests` == `WORKER_BEFORE + 31`, `Test Files` ==
`FILES_BEFORE + 2`, using the baselines from "Baselines, not absolutes". Do not
hard-code either number — plans 004, 005, 007 and 008 all move them.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with **0 failed**, `Tests` equal to `WORKER_BEFORE + 31` and `Test Files` equal to `FILES_BEFORE + 2` (baselines recorded before you started)
- [ ] `cd ".../workers" && npx vitest run __tests__/identity-platform-operator.test.js` reports `6 passed`
- [ ] `cd ".../workers" && npx vitest run __tests__/identity-refresh-family.test.js` reports `5 passed`
- [ ] `cd ".../workers" && npx vitest run __tests__/pipeline-control.test.js -t "returns a typed response when the control queue rejects"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/pipeline-control.test.js -t "requires a platform operator grant, not a tenant role"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/identity-refresh-family.test.js -t "does not revoke the family"` passes (the CAS-backstop case)
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` reports **0 failures other than exactly these 3, by name**: `test_clean_line_does_not_destroy_words`, `test_extract_judiciary_names_filters_non_judicial_judging`, `test_merge_treats_postnominal_variant_as_equivalent`, all in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` reports **0 failed** and the same passing count you recorded before starting (no frontend file changes here)
- [ ] The Step 1 migration script prints `migration OK` — i.e. `0001` + `0002` apply cleanly to a fresh SQLite DB, `platform_admin` is `INTEGER NOT NULL DEFAULT 0`, and `users_platform_admin_idx` exists
- [ ] `grep -rnE "\.assertMembership\(" workers/pipeline/control_handlers.js workers/admin/cloudflare_handlers.js workers/case-api/cloudflare_mutations.js` returns **no matches** — note the `\.` and `\(`: this matches an actual *call*, so an explanatory comment mentioning the name does not create a false positive the way a bare `grep "assertMembership"` would
- [ ] `grep -c "assertPlatformOperator" workers/storage/cloudflare.js` returns `1` and `grep -rc "assertPlatformOperator" workers/pipeline/control_handlers.js workers/admin/cloudflare_handlers.js workers/case-api/cloudflare_mutations.js` returns `1` for each file
- [ ] `grep -c "is_admin" workers/admin/cloudflare_handlers.js` returns `0`
- [ ] `grep -c "expirationTtl" workers/auth/nonce_do.js` returns `0`
- [ ] `grep -c "REFRESH_REUSE_GRACE_MS\|benignRace" workers/storage/cloudflare.js` returns `0` — no reuse grace window survived review
- [ ] `grep -c "revokeRefreshFamily" workers/storage/cloudflare.js` returns `2` (definition + the call in `loadRefreshAuthSnapshot`)
- [ ] `grep -cE "return enqueueControl\(" workers/pipeline/control_handlers.js` returns `0` and `grep -cE "return await enqueueControl\(" workers/pipeline/control_handlers.js` returns `4`
- [ ] `node --check workers/pipeline/control_handlers.js` exits 0
- [ ] `test -f migrations/d1/account/0002_platform_admin.sql` succeeds
- [ ] `git status --short` lists only the files in the "In scope" list (plus this plan file, `workers/__tests__/dispatcher-error-propagation.test.js` if you repaired plan 005's test, and, if it exists, `plans/README.md`); `wrangler.toml` and everything under `frontend/` are unmodified
- [ ] Step 0's runbook (0a–0d) appears verbatim in the PR description, with no real `user_id` filled in
- [ ] `plans/README.md` status row updated, if that file exists

## STOP conditions

Stop and report back (do not improvise) if:

- **The drift check reports changes.** Any of the "Current state" excerpts no
  longer matching the live code means the plan was written against different
  code; re-verify before touching anything.
- **`workers/storage/cloudflare.js` line numbers have moved far enough that you
  cannot confidently locate `assertMembership` (≈1300), `revokeRefreshSession`
  (≈1442), `loadRefreshAuthSnapshot` (≈1457) or `rotateRefreshSession` (≈1480).**
  Locate them by name, not by number, and if the surrounding code differs from
  the excerpts above, stop.
- **Any step's verification fails twice** after one reasonable fix attempt.
- **Removing `isAdmin` or rewiring `requireOperator` breaks a test you did not
  expect to touch.** Steps 3 and 5 name the five tests this change is *known*
  to break (`pipeline-control.test.js:91`, `cloudflare-mutations.test.js:101`
  and `:267`, plus plan 005's mutation dispatcher test) and this plan owns
  repairing all of them. A **sixth** breakage means some other caller depends
  on tenant role for a global surface — report which, do not loosen the new
  gate to make it pass and do not `.skip` it.
- **You are tempted to reintroduce a refresh-reuse grace window** because a
  test or a manual multi-tab check logs you out. That is the client bug
  described in Step 7a; the fix is client-side and out of scope. Report it.
- **The Step 1 migration script does not print `migration OK`.** Do not
  downgrade the check to `ls` + `grep`; a migration that cannot execute is the
  defect.
- **You find a caller that legitimately needs an exp-less JWT.** Step 8 assumes
  none exists (verified: only `makeAccessToken` and `makeRefreshToken` call
  `signJwt`, and both set `exp`). If a third minter appears, stop.
- **A step appears to require editing `wrangler.toml`, anything under
  `frontend/`, or either `scripts/check_*.py` gate.** Those are out of scope by
  design; report what you think is needed instead of editing them.
- **You are about to write a real credential value anywhere.** This plan never
  needs one. Reference names (`IMMI_PLATFORM_OPERATOR_IDS`,
  `CRAWLER_WRITE_TOKEN`, `JWT_SECRET_CURRENT`) only; never values, not even in
  tests — use obvious fakes like `"s3cret"`.

## Maintenance notes

For the human or agent who owns this code after the change lands:

- **This change deliberately locks everyone out of the operator surfaces until
  an operator grants access.** After deploy, `POST /api/v1/pipeline-action`,
  `POST /api/v1/download/start`, `POST /api/v1/legislations/update` and
  `GET /api/v1/admin/pipeline-runs` return `403 platform_operator_required` for
  every user, including whoever was using them before. That is the fix, not a
  regression — **but only if the grant lands before the deploy.** The full
  ordering, the grant SQL, the two-operator rule, the smoke checks and the
  rollback are in **Step 0**, which is a numbered step with its own Done
  criterion rather than a note here. An earlier draft had "deploy, then grant"
  buried in this section, which manufactures an avoidable all-users-403 window.
  Do not re-summarise Step 0 here; follow it.
- **`IMMI_PLATFORM_OPERATOR_IDS` is deliberately not in the checked-in
  `wrangler.toml`**, matching the existing policy for operator-supplied
  resource IDs and secrets (see the `# Operator-set secrets only` comment at
  `wrangler.toml:95-97`). Note it is an *override*, not a fallback: revoking a
  grant means clearing both the column and this var.
- **Follow-up this plan deliberately does not do: client-side refresh
  single-flight.** Step 7 revokes the refresh-token family on any reuse, with
  no grace window. If `auth.refresh.reuse_detected` fires for ordinary
  multi-tab users, the fix is a shared in-flight refresh promise in
  `frontend/src/contexts/AuthContext.tsx` so two tabs cannot both redeem the
  same cookie — **not** reintroducing a server-side window that an attacker who
  rotated first can hide inside. `frontend/` is outside this plan's scope, so
  measure first: watch the event for a week and check whether its rate tracks
  active multi-tab users or something attack-shaped.
- **A reviewer should scrutinise**: that no remaining global-effect route calls
  `assertMembership` directly; that the `CRAWLER_WRITE_TOKEN` bypass in
  `requireWriter` is byte-for-byte unchanged (production ingestion depends on
  it); and that the refresh grace window in Step 7 is only applied to
  `revoked_reason === "rotated"`.
- **Future interactions**: if a tenant-scoped admin UI is ever added (invite
  management, per-tenant collections), it should keep using `assertMembership`
  and the tenant role — `assertPlatformOperator` is for global surfaces only.
  Adding a new route under `CONTROL_PATHS` or a new case-mutation verb inherits
  the platform gate automatically; adding a new **GET** analytics route in
  `workers/case-api/cloudflare.js` does not, and should not.
- **Refresh reuse detection deliberately excludes the compare-and-swap failure
  branch** (`workers/storage/cloudflare.js`, `rotateRefreshSession`). A CAS
  failure means a genuine concurrent race for the *same live* token, where
  family revocation would kill the successor the winning request just minted.
  That distinction is pinned by test 4 in
  `workers/__tests__/identity-refresh-family.test.js`; do not "unify" the two
  branches.
- **There is no grace window, on purpose.** Any reuse of an already-revoked
  refresh token revokes the family. See Step 7a for why a time-based exemption
  is unsafe: it is precisely the window an attacker who rotated first survives
  inside.
- **Watch the `auth.refresh.reuse_detected` log event.** Pipe it through
  Cloudflare Logpush. A sustained rate correlated with multi-tab usage means
  the *client* needs single-flight refresh (see the follow-up above) — it does
  not mean the server should start ignoring the signal.
- **Explicitly deferred** (see "Findings reconsidered"): removing the
  `access_token` echo from `/api/v1/auth/me`. Doing that properly is a
  cookie-only-auth redesign spanning `frontend/src/contexts/AuthContext.tsx`
  and the refresh flow, and is worth a plan of its own.

## Findings reconsidered

- **SEC-13 — `/api/v1/auth/me` copies the HttpOnly access-token cookie into the
  JSON response body.** The finding's facts are correct — I verified
  `access_token: extractToken(request)` at `workers/auth/cloudflare_handlers.js:149`,
  `extractToken`'s cookie fallback at `workers/auth/request_auth.js:9-15`, and
  the `HttpOnly; Secure; SameSite=Lax` cookie at line 37 — but the proposed fix
  ("drop `access_token` from the `/auth/me` response") is rejected for this
  plan on two verified grounds. **First, it delivers no security benefit in
  isolation**: `handleAuthRefresh` returns `access_token` in its body at
  `workers/auth/cloudflare_handlers.js:231`, and the refresh cookie is scoped
  `Path=/api/v1/auth`, so an XSS-capable attacker simply calls
  `POST /api/v1/auth/refresh` with `credentials: "include"` and gets a bearer
  token plus a fresh 7-day lineage — the same one-fetch primitive the finding
  describes, only worse. **Second, removing the echo alone is a breaking
  change**: `frontend/src/contexts/AuthContext.tsx:88-102` gates its mount-time
  session restore on `data?.access_token` being truthy and falls back to
  `/auth/refresh` only on HTTP 401, so a 200-with-no-token would silently log
  every user out. Closing this genuinely means moving to cookie-only auth with
  no token in any response body, coordinated across `frontend/` — outside this
  plan's file territory and materially larger than the finding's "M" estimate.
  Recorded as a deferred follow-up in "Maintenance notes"; it is defence-in-depth
  erosion, not a live break, and the surrounding hardening in this plan (Steps 7
  and 8) reduces the value of a stolen token in the meantime.
