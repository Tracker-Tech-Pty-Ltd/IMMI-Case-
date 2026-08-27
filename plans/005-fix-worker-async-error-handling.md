# Plan 005: Make the Worker dispatchers' try/catch actually catch handler rejections

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists; if it does not exist, do not
> create it.
>
> **Drift check (run first)** — all four commands. Committed history alone
> cannot see uncommitted, staged or untracked edits, so an executor starting
> from a dirty tree would get a false all-clear from the first command.
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS="workers/case-api/cloudflare.js
>   workers/case-api/cloudflare_mutations.js
>   workers/case-api/cloudflare_actions.js
>   workers/llm-council/cloudflare_handlers.js
>   workers/llm-council/session_do.js
>   workers/storage/cloudflare.js
>   workers/auth/csrf.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS   # committed since the plan was written
> git diff --stat -- $PATHS                 # unstaged working-tree edits
> git diff --cached --stat -- $PATHS        # staged but uncommitted edits
> ```
> Expected: the last three print nothing and `git status --short` lists no
> in-scope path. Any in-scope file appearing in **any** of them is a STOP
> condition: compare the "Current state" excerpts below against the live code
> and report before proceeding.
>
> **Two deliberate exceptions.** `workers/llm-council/cloudflare_handlers.js`
> and `workers/storage/cloudflare.js` are shared with sibling plans:
> - `plans/004-*.md` lands **before** this plan and changes
>   `cloudflare_handlers.js` (`applyRateLimit`, a new `rateLimitFailure`, six
>   rate-limit call sites, `handleDeleteSession`, `handleHealth`). If you see
>   those, that is expected — rebase onto them and integrate hunk by hunk.
>   Anything else in that file is real drift.
> - `workers/storage/cloudflare.js` is edited by several plans in **disjoint
>   regions**. This plan owns exactly one region:
>   `CloudflareCouncilStore.createSession`. Scope your inspection to that
>   method (`awk '/^export class CloudflareCouncilStore/,/^  async getSessionByCode/' workers/storage/cloudflare.js`)
>   rather than treating any change to the file as drift.
>
> **Never** run `git checkout --`, `git restore` or `git clean` to clear a
> dirty tree — those edits may be the operator's uncommitted work.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/004-*.md` (file-level, not gate-level — see below)
- **Runs before**: `plans/006-*.md` (006 takes over
  `workers/case-api/cloudflare_mutations.js` and must update the tests this
  plan adds) and `plans/007-*.md` (007 edits
  `workers/case-api/cloudflare.js`, which this plan rewrites mechanically)
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

**Why the toolchain gates are not a dependency** — this plan's only
verification gate is the Worker Vitest suite (`cd workers && npx vitest run`),
which is green at commit `42826a3`. It touches no TypeScript, no Python and no
CI config, so it does not need the verification-gate repairs plans 001–003
make.

### Sequencing (cross-plan) — read before starting

This plan shares files with three siblings. The order is not negotiable:

| Plan | Shared file | Order | What the executor must do |
|---|---|---|---|
| `004` | `workers/llm-council/cloudflare_handlers.js` | **004 first** | 004 is a live outage hotfix. Rebase this plan onto it and expect `rateLimitFailure` + six rate-limit call sites to already exist. Steps 2, 4 and 5 here touch different hunks of the same file. |
| `006` | `workers/case-api/cloudflare_mutations.js`, `workers/storage/cloudflare.js` | **this plan first** | 006 rewires `requireWriter` from `assertMembership` to `assertPlatformOperator`. That **breaks the mutation test this plan adds in Step 1** (its store double supplies only `assertMembership`). 006 owns updating it; this plan flags it, 006's own plan text now names it explicitly. |
| `007` | `workers/case-api/cloudflare.js`, `workers/storage/cloudflare.js` | **this plan first** | Step 2 here rewrites every `return handle…(` line in `cloudflare.js`, including the two export dispatch lines 007 edits. 007 rebases. |

Do **not** run these plans concurrently against one working tree. If you are
executing this plan and find 006's `assertPlatformOperator` already present in
`cloudflare_mutations.js`, the order was inverted — stop and report.

## Why this matters

Every route dispatcher in the production Cloudflare Worker wraps its handler
table in `try { ... } catch (err) { ... }`, and every dispatch line is written
as `return handleX(...)` — without `await`. In an `async` function,
`return somePromise` settles the promise *after* the `try` scope has been left,
so the `catch` block never sees a rejection thrown inside a handler. The
handlers are exactly where `StorageBoundaryError` is raised (404 case not found,
403 membership, 503 R2 checksum mismatch), so those typed errors escape the
dispatcher entirely.

Nothing catches them further up: `workers/cloudflare-native.js`'s `fetch()` has
no outer `try/catch` around the dispatch chain, so the runtime turns the
rejection into a bare 500 with no JSON body. The React client reads the
structured `code` field off error responses
(`frontend/src/lib/api.ts:154-161`); a bodyless 500 yields
`ApiError.code === undefined`, so every code-aware branch in the SPA degrades to
a generic failure. The `console.error(JSON.stringify({event: ...}))` breadcrumb
in each catch also never fires, so Logpush sees nothing either.

Alongside that, four smaller defects in the same files are fixed here: a
malformed CSRF token throws instead of returning 403; a failed Council stream
still writes a zero-turn session row to D1; the retrieve-code collision retry is
driven by substring-matching an error message the project does not control; and
`CouncilSessionDO.appendTurn` has no guard for storage that `deleteSession`
wiped.

## Current state

### Files in play

- `workers/case-api/cloudflare.js` — GET read dispatcher
  `dispatchCloudflareCaseRead` (declared line 1029); the handler table is lines
  1057–1162 inside one `try`.
- `workers/case-api/cloudflare_mutations.js` — POST/PUT/DELETE case mutations
  dispatcher `dispatchCloudflareCaseMutation` (line 290).
- `workers/case-api/cloudflare_actions.js` — three safe POST actions dispatcher
  `dispatchCloudflareCaseAction` (line 151).
- `workers/llm-council/cloudflare_handlers.js` — LLM Council dispatcher
  `dispatchCloudflareCouncil` (line 407), plus `createSessionWithRetrieveCode`
  (line 83), `generateRetrieveCode` (line 47) and `handleStream` (line 335).
- `workers/llm-council/session_do.js` — `CouncilSessionDO` Durable Object.
- `workers/auth/csrf.js` — double-submit CSRF token issue/verify.
- `workers/cloudflare-native.js` — production Worker entrypoint (READ ONLY here,
  quoted for context; do not modify).
- `workers/__tests__/*.test.js` — Vitest suite, `environment: "node"`,
  `globals: false` (see `workers/vitest.config.js`), so every test file must
  `import { beforeEach, describe, expect, it, vi } from "vitest";` explicitly.

### 1. The missing `await` (JSCORR-01)

`workers/case-api/cloudflare.js:1057-1063` — verbatim:

```js
  try {
    const stores = createCloudflareStores(env);
    if (path.startsWith("/api/v1/judge-photo/") && url.pathname === path) {
      return handleJudgePhoto(path, stores);
    }
    if (path === "/api/v1/stats") return handleStats(url, stores);
    if (path === "/api/v1/export/csv") return handleExport(url, stores, "csv");
```

...and the catch that never sees those handlers' rejections,
`workers/case-api/cloudflare.js:1162-1168` — verbatim:

```js
    return null;
  } catch (err) {
    if (err instanceof StorageBoundaryError) return jsonErr(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "case.cloudflare.read_error", error: err?.message }));
    return jsonErr("Case service unavailable", 503, "case_store_unavailable");
  }
}
```

`workers/case-api/cloudflare_mutations.js:305-319` — verbatim:

```js
  try {
    requireMutationQueue(env);
    const stores = createCloudflareStores(env);
    const writer = await requireWriter(request, env, stores);
    if (writer instanceof Response) return writer;
    if (isCreate) return handleCreate(request, env, stores);
    if (isBatch) return handleBatch(request, env, stores);
    if (isUpdate) return handleUpdate(idMatch[1], request, env, stores);
    return handleDelete(idMatch[1], env, stores);
  } catch (error) {
    if (error instanceof StorageBoundaryError) return errorResponse(error.message, error.status, error.code);
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    console.error(JSON.stringify({ event: "cloudflare.case_mutation_error", path, error: error?.message }));
    return errorResponse("Cloudflare case mutation unavailable", 503, "cloudflare_case_mutation_unavailable");
  }
```

`workers/case-api/cloudflare_actions.js:154-165` — verbatim:

```js
  try {
    const stores = createCloudflareStores(env);
    const writer = await requireWriter(request, env, stores);
    if (writer instanceof Response) return writer;
    if (path === "/api/v1/cache/invalidate") return handleCacheInvalidate();
    if (path === "/api/v1/taxonomy/guided-search") return handleGuidedSearch(request, stores);
    return handleCollectionExport(request, stores);
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    console.error(JSON.stringify({ event: "cloudflare.action_error", path, error: error?.message }));
    return errorResponse("Cloudflare action unavailable", 503, "cloudflare_action_unavailable");
  }
```

Note: this catch maps only `clientError(error)` (a `StorageBoundaryError` with
`status` in 400–499). A 5xx `StorageBoundaryError` deliberately becomes the
generic 503. Keep that behaviour.

`workers/llm-council/cloudflare_handlers.js:407-426` — verbatim:

```js
export async function dispatchCloudflareCouncil(request, env, path, method, ctx) {
  try {
    if (path === "/api/v1/llm-council/health" && method === "GET") return handleHealth(request, env);
    if (path === "/api/v1/llm-council/sessions" && method === "POST") return handleCreateSession(request, env);
    if (path === "/api/v1/llm-council/sessions" && method === "GET") return handleListSessions(request, env);
    if (path === "/api/v1/llm-council/run" && method === "POST") return handleLegacyRun(request, env);
    if (path === "/api/v1/llm-council/stream" && method === "POST") return handleStream(request, env, ctx);
    if (path === "/api/v1/llm-council/sessions/restore" && method === "POST") return handleRestoreByCode(request, env);
    const turn = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})\/turns$/);
    if (turn && method === "POST") return handleAddTurn(request, env, turn[1]);
    if (turn && method === "GET") return handleGetTurns(request, env, turn[1]);
    const session = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})$/);
    if (session && method === "GET") return handleGetSession(request, env, session[1]);
    if (session && method === "DELETE") return handleDeleteSession(request, env, session[1]);
    return null;
  } catch (err) {
    if (err instanceof StorageBoundaryError) return errorResponse(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "council.cloudflare.handler_error", error: err?.message }));
    return errorResponse("LLM Council unavailable", 503, "council_unavailable");
  }
```

Nothing upstream catches an escaping rejection —
`workers/cloudflare-native.js` `fetch()` dispatches with no surrounding
`try/catch`:

```js
    const action = await dispatchCloudflareCaseAction(request, path, env);
    if (action !== null) return action;
```

**Accuracy note (correcting the audit that produced this plan):** the catch
blocks are *not* entirely dead. They still cover the awaited work above the
handler table — `createCloudflareStores`, `requireMutationQueue`,
`await requireWriter(...)`, the `readJson` inside it, and the regex matching.
Only rejections raised *inside* a handler escape. That is why the existing
tests all pass today.

### 2. CSRF decode throws instead of returning 403 (JSCORR-11)

`workers/auth/csrf.js:35-49` — verbatim:

```js
export async function verifyCsrf(request, env) {
  if (!env.CSRF_SECRET) return Response.json({ error: "csrf_secret_not_configured", code: "csrf_secret_not_configured" }, { status: 503 });
  const header = request.headers.get("X-CSRF-Token") || request.headers.get("X-CSRFToken");
  const cookie = (request.headers.get("Cookie") || "").split(/;\s*/).find((item) => item.startsWith(CSRF_COOKIE + "="))?.slice(CSRF_COOKIE.length + 1);
  if (!header || !cookie || header !== cookie) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const parts = header.split(".");
  const payloadB64 = parts[0];
  const signatureB64 = parts[1];
  if (!payloadB64 || !signatureB64) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const payload = new TextDecoder().decode(b64urlDecode(payloadB64));
  const expiry = Number(payload.split(".")[1]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return Response.json({ error: "csrf_expired", code: "csrf_expired" }, { status: 403 });
  const valid = await crypto.subtle.verify("HMAC", await importHmacKey(env.CSRF_SECRET), b64urlDecode(signatureB64), new TextEncoder().encode(payload));
  return valid ? null : Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
}
```

`b64urlDecode` (line 9-13) calls `atob`, which throws a `DOMException`
("Invalid character") on non-base64 input — verified locally with
`b64urlDecode("abc!")` and `b64urlDecode("@@@@")`.

**Accuracy note:** line 39 already rejects a *mismatched* header/cookie pair
with 403, so a merely truncated client token never reaches line 44. Reaching the
throw requires a crafted request that puts the *same* malformed value in both
the `X-CSRF-Token` header and the `__Host-csrf` cookie. The throw is caught by
the caller's dispatcher and mapped to a misleading generic 503 — it is an
attacker-triggerable wrong status code, not organic alert noise. `verifyCsrf` is
awaited from `requireWriter` at `workers/case-api/cloudflare_mutations.js:65`
and `workers/case-api/cloudflare_actions.js:42`. Case mutations are fail-closed
by default (`IMMI_CASE_MUTATIONS_ENABLED` defaults to `"false"`), so the
reachable surface today is the action routes.

### 3. SSE persist callback writes an empty session (JSCORR-03)

`workers/llm-council/cloudflare_handlers.js:361-370` — verbatim:

```js
  const persist = stream.work.then(async (result) => {
    // Recheck at write time: membership could have been revoked while the
    // response streamed, and D1 itself has no transaction-local RLS claims.
    const current = await councilStoresForClaims(env, authResult.claims);
    await createSessionWithRetrieveCode(current.stores, current.auth, {
      sessionId, caseId: body.case_id || null, title: message.slice(0, 80),
    }, retrieveCode);
    await persistTurn({ env, auth: current.auth, sessionId, turnId, message, caseContext, councilResult: result });
  }).catch((err) => console.error(JSON.stringify({ event: "council.stream.persist_error", error: err?.message })));
```

`persistTurn` dereferences the result at
`workers/llm-council/cloudflare_handlers.js:108` — verbatim:

```js
      retrieved_cases: councilResult.retrieved_cases || null,
```

`streamCouncil` resolves `work` with `null` on three documented paths in
`workers/llm-council/runner.js`:

- `1971-1972`: `if (orchestrationAbort.signal.aborted) {` / `return null;`
  (client disconnected mid-orchestration)
- `2001-2002`: `// Resolve work with null so handler skips persistence on all-failed`
  / `return null;`
- `2035-2036`: `await send("council.error", { error: String(err).slice(0, 700) });`
  / `return null;`

So the runner's documented contract ("handler skips persistence on all-failed")
is not honoured: the D1 `council_sessions` row is created first (line 365), then
`persistTurn` throws a synchronous `TypeError` on `null`, which the `.catch` at
line 369 swallows as `council.stream.persist_error`. Net effect: a zero-turn
session row plus a retrieve code the user was already shown.

**Accuracy note:** on the all-failed and orchestration-throw paths the client
*does* receive a `council.error` SSE event, so this is not a silent failure
dressed as success. The defect is the orphan zero-turn row and the lost turn.

### 4. Retrieve-code collision retry (JSCORR-18) and advertise/persist skew (JSCORR-17)

`workers/llm-council/cloudflare_handlers.js:83-97` — verbatim:

```js
async function createSessionWithRetrieveCode(stores, auth, values, preferredRetrieveCode = null) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retrieveCode = attempt === 0 && preferredRetrieveCode
      ? preferredRetrieveCode : generateRetrieveCode();
    try {
      const session = await stores.councilStore.createSession(auth, { ...values, retrieveCode });
      return { session, retrieveCode };
    } catch (err) {
      lastError = err;
      if (!String(err?.message || "").includes("retrieve_code")) throw err;
    }
  }
  throw lastError;
}
```

The store it calls issues a plain `INSERT` with no `ON CONFLICT` and no typed
error mapping — `workers/storage/cloudflare.js:1528-1541`, and the constraint is
`retrieve_code TEXT UNIQUE` at `migrations/d1/account/0001_account.sql:110`. So
the only thing distinguishing a collision from any other failure is whether
D1's raw SQLite message happens to contain the column name. Consequences: a
constraint rename or message-format change turns a collision into an unhandled
throw, and any unrelated error whose text mentions `retrieve_code` is retried
three times.

`generateRetrieveCode` at `workers/llm-council/cloudflare_handlers.js:47-51` —
verbatim:

```js
function generateRetrieveCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => RETRIEVE_CODE_ALPHABET[byte % RETRIEVE_CODE_ALPHABET.length]).join("");
}
```

with `RETRIEVE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"` (line 22, 31
symbols). `256 % 31 === 8`, so the first 8 symbols are over-represented by
~12.5%.

In `handleStream` the code is minted at line 351 and handed to the client as
`sessionMeta` at line 356 *before* any D1 write; the same value is only a
*preferred* code on attempt 0 of `createSessionWithRetrieveCode` (line 365), so
a collision re-rolls and the persisted code differs from the advertised one. The
non-streaming path does not have this problem — `handleCreateSession` reads the
persisted value back at line 201: `retrieve_code: created?.retrieve_code || retrieveCode`.

### 5. `CouncilSessionDO.appendTurn` has no guard for wiped storage (JSCORR-06)

`workers/llm-council/session_do.js:29-49` — the schema and seed run **only** in
the constructor:

```js
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS council_turn_ledger (
          turn_id TEXT PRIMARY KEY,
          turn_index INTEGER NOT NULL UNIQUE,
          completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS council_turn_sequence (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          next_turn INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO council_turn_sequence (singleton, next_turn) VALUES (1, -1)",
      );
    });
  }
```

`workers/llm-council/session_do.js:64-79` — the unguarded allocation:

```js
    let ledger = first(this.ctx.storage.sql.exec(
      "SELECT turn_index, completed FROM council_turn_ledger WHERE turn_id = ?",
      checkedTurnId,
    ));
    if (!ledger) {
      const allocated = first(this.ctx.storage.sql.exec(`
        INSERT INTO council_turn_ledger (turn_id, turn_index, completed)
        SELECT ?, next_turn + 1, 0 FROM council_turn_sequence WHERE singleton = 1
        RETURNING turn_index, completed
      `, checkedTurnId));
      this.ctx.storage.sql.exec(
        "UPDATE council_turn_sequence SET next_turn = ? WHERE singleton = 1",
        allocated.turn_index,
      );
      ledger = allocated;
    }
```

`workers/llm-council/session_do.js:126` wipes that storage:

```js
    await this.ctx.storage.deleteAll();
```

**Accuracy note (correcting the audit):** this DO is SQLite-backed
(`wrangler.toml:62` — `new_sqlite_classes = ["AuthNonce", "CouncilSessionDO"]`),
so `deleteAll()` drops
the SQL tables themselves. After a `deleteSession`, the *first* statement to
fail in a racing `appendTurn` is the `SELECT` at line 64-67 ("no such table"),
not the `allocated.turn_index` dereference at line 76. Both are unguarded
throws on an already-deleted session, and both are fixed by the same change:
make the schema seed idempotent and callable from `appendTurn`, and add a typed
guard on `allocated`. A second sub-claim from the original audit — that a Queue
retry gets a different turn index — is **wrong** and is not addressed here: the
ledger row is keyed by `turn_id` and looked up first at lines 64-67, so a retry
does resume the same index, exactly as the comment at lines 51-55 promises.

### Repo conventions this plan must match

- Structured logs are one line of `console.log(JSON.stringify({ event, ... }))`
  for normal events and `console.error(JSON.stringify({ event, ... }))` for
  errors — see `workers/llm-council/cloudflare_handlers.js:369` and `:424`.
  Event names are dot-namespaced (`council.stream.persist_error`,
  `cloudflare.case_mutation_error`).
- Typed storage failures use
  `new StorageBoundaryError(message, { code, status })` from
  `workers/storage/contracts.js:21-28`. Every dispatcher already converts a
  `StorageBoundaryError` into `{ error, code }` with the error's own `status`.
- Tenant isolation is **app-layer**: `CloudflareIdentityStore.assertMembership()`
  in `workers/storage/cloudflare.js`. There is no Postgres and no RLS.
  `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings.
  Do not weaken or bypass any `assertMembership` call in this plan.
- Worker tests live in `workers/__tests__/<name>.test.js`, mock collaborators
  with `vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }))`,
  and never mock `../storage/contracts.js` (so `instanceof StorageBoundaryError`
  keeps working). Model new files on
  `workers/__tests__/cloudflare-actions.test.js` (94 lines, the smallest
  complete example) and `workers/__tests__/cloudflare-council-handlers.test.js`.
- Commit messages are `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- There is **no ESLint config covering `workers/`** (only
  `frontend/eslint.config.js`), so `return await` will not be flagged by any
  linter in this repo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | the four commands in the header block above | no in-scope path listed |
| Worker tests (all) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0, **0 failed**; see "Baselines, not absolutes" |
| Worker tests (one file) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/<file>.test.js` | as stated per step (per-file counts are stable) |
| Worker test by name | `cd ".../workers" && npx vitest run __tests__/<file>.test.js -t "<test name>"` | that test passes |
| Syntax check one file | `node --check "<absolute path>.js"` | exit 0, no output |
| Same via make | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers` | same as "Worker tests (all)" |
| Confirm scope | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain` | only the in-scope paths listed below |

### Baselines, not absolutes

**Never assert a whole-suite total.** Sibling plans (004, 006, 007, 008) add
tests to the same Worker suite, so `Tests 345 passed (345)` stops being true
the moment any of them lands — and an executor who "corrects" a mismatched
total is editing the yardstick instead of the code. Record a baseline first:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
WORKER_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
FILES_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Test Files +[0-9]+ passed' | grep -oE '[0-9]+')
echo "WORKER_BEFORE=$WORKER_BEFORE FILES_BEFORE=$FILES_BEFORE"
```

This plan adds **5 new test files** and **21 new tests**: Step 1 → 4,
Step 3 → 3, Steps 4–5 → 8 (2 + 6), Step 5b → 2, Step 6 → 4. The final
assertion is therefore `WORKER_BEFORE + 21` tests across `FILES_BEFORE + 5`
files, with **0 failed**. Per-file counts stated in individual steps are stable
and may be asserted as absolutes.

All commands were run at commit `42826a3` while writing this plan. `node` here
is v22.23.1; `npx vitest` resolves from the root `package.json`
(`workers/` has no `package.json` of its own — the root one holds vitest and
wrangler).

## Scope

**In scope** (the only files you may modify or create):

- `workers/case-api/cloudflare.js` (modify)
- `workers/case-api/cloudflare_mutations.js` (modify)
- `workers/case-api/cloudflare_actions.js` (modify)
- `workers/llm-council/cloudflare_handlers.js` (modify)
- `workers/llm-council/session_do.js` (modify)
- `workers/auth/csrf.js` (modify)
- `workers/storage/cloudflare.js` — **`CloudflareCouncilStore.createSession`
  only** (the method at ~line 1528). Do not touch any other part of this
  ~1900-line file; other plans own other regions of it.
- `workers/__tests__/dispatcher-error-propagation.test.js` (create)
- `workers/__tests__/csrf-malformed-token.test.js` (create)
- `workers/__tests__/council-stream-persistence.test.js` (create)
- `workers/__tests__/council-store-retrieve-code.test.js` (create)
- `workers/__tests__/council-session-do-recovery.test.js` (create)

**Out of scope** (do NOT touch, even though they look related):

- `workers/pipeline/control_handlers.js` — it has the *same* missing-`await`
  defect, and not once but **four times**: `return enqueueControl(...)` at
  lines 109, 119, 123 and 124, all inside the `try` whose catch is at line 129.
  `plans/006-*.md` owns that file and now fixes all four explicitly. Leave it
  alone so the two plans do not conflict. If 006 is cancelled, apply the
  identical one-word fix to all four lines — not just the first.
- `workers/llm-council/runner.js` — its three `return null` paths are the
  documented contract; the handler is what must honour them.
- `workers/cloudflare-native.js` — adding an outer `try/catch` to `fetch()`
  would mask exactly the bug this plan fixes. Do not add one.
- **Any existing file under `workers/__tests__/`** — add new files only.
  Editing existing test files risks conflicting with parallel plans.
- `wrangler.toml` — placeholder resource IDs and the `"false"` defaults for
  `IMMI_CASE_MUTATIONS_ENABLED` / pipeline flags are deliberate. Do not "fix".
- Anything under `frontend/`, `immi_case_downloader/`, `tests/`, `Makefile`,
  `.github/`.

## Git workflow

- Branch: `git checkout -b advisor/005-worker-async-error-handling`
- One commit per step, conventional format. Suggested messages:
  - Step 2: `fix: await dispatcher handlers so typed storage errors are caught`
  - Step 3: `fix: return 403 for a malformed CSRF token instead of throwing`
  - Step 4: `fix: skip Council session persistence when the stream yields no result`
  - Step 5: `fix: match retrieve-code collisions explicitly instead of by message substring`
  - Step 6: `fix: re-seed CouncilSessionDO schema and guard turn allocation`
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Write the failing dispatcher tests (RED)

Create `workers/__tests__/dispatcher-error-propagation.test.js`. It proves that
a `StorageBoundaryError` raised *inside* a handler comes back as a typed
response rather than escaping as a rejection. One test per in-scope dispatcher
(4 tests).

Mock only `../storage/cloudflare.js`, `../auth/request_auth.js`,
`../auth/csrf.js`, `../auth/jwt.js` — never `../storage/contracts.js`, because
each dispatcher checks `err instanceof StorageBoundaryError` against the real
class.

Target shape:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));

import { StorageBoundaryError } from "../storage/contracts.js";
import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
import { dispatchCloudflareCaseMutation } from "../case-api/cloudflare_mutations.js";
import { dispatchCloudflareCaseAction } from "../case-api/cloudflare_actions.js";
import { dispatchCloudflareCouncil } from "../llm-council/cloudflare_handlers.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};
const AUTH = { userId: CLAIMS.sub, tenantId: CLAIMS.tenant_id, role: "member" };
const ENV = { IMMI_STORAGE_MODE: "cloudflare" };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
});
```

The four tests:

1. `"surfaces a typed storage error from a GET read handler"` — set
   `mockStores.mockReturnValue({ caseStore: { getStats: vi.fn(async () => { throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 }); }) } })`,
   call
   `await dispatchCloudflareCaseRead(new URL("https://immi.example/api/v1/stats"), "/api/v1/stats", ENV)`,
   expect `response.status === 404` and
   `await response.json()` to match `{ error: "Case not found", code: "case_not_found" }`.
   (`handleStats` calls `stores.caseStore.getStats()` — verified at
   `workers/case-api/cloudflare.js:314-320`.)
2. `"surfaces a typed storage error from a case mutation handler"` — stores:
   `{ identityStore: { assertMembership: vi.fn(async () => AUTH) }, objectStore: { putCaseSource: vi.fn(async () => { throw new StorageBoundaryError("Case source checksum mismatch", { code: "r2_checksum_mismatch", status: 503 }); }) }, caseStore: {} }`.
   Request: `POST https://immi.example/api/v1/cases` with JSON body
   `{ title: "Example" }` and headers
   `{ "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" }`.
   Env: `{ ...ENV, IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: { send: vi.fn(async () => undefined) } }`
   (both are required — `requireMutationQueue` throws without the queue and the
   route is frozen without the flag). Expect 503 and
   `{ code: "r2_checksum_mismatch" }`.
3. `"surfaces a typed storage error from a safe POST action handler"` — stores:
   `{ identityStore: { assertMembership: vi.fn(async () => AUTH) }, caseStore: { guidedPrecedents: vi.fn(async () => { throw new StorageBoundaryError("Guided search unavailable", { code: "guided_search_unavailable", status: 404 }); }) } }`.
   Request: `POST /api/v1/taxonomy/guided-search` with body
   `{ flow: "find-precedents", visa_subclass: "866" }`. Expect 404 and
   `{ code: "guided_search_unavailable" }`. Use a 4xx status here: this
   dispatcher's catch only maps `clientError` (400–499) to a typed response.
4. `"surfaces a typed storage error from a Council handler"` — stores:
   `{ identityStore: { assertMembership: vi.fn(async () => AUTH), listCouncilSessions: vi.fn(async () => { throw new StorageBoundaryError("Membership is not active", { code: "membership_inactive", status: 403 }); }) } }`.
   Call
   `await dispatchCloudflareCouncil(new Request("https://immi.example/api/v1/llm-council/sessions", { headers: { Authorization: "Bearer valid" } }), ENV, "/api/v1/llm-council/sessions", "GET")`.
   Expect 403 and `{ code: "membership_inactive" }`.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/dispatcher-error-propagation.test.js`
→ `Tests 4 failed (4)`. Each failure must be an *unhandled rejection surfacing
through the await* (the thrown `StorageBoundaryError` message, e.g.
`Case not found`), **not** a `TypeError`, `undefined is not a function`, or a
mock-shape error. If a failure is a mock-shape error, fix the mock before
continuing — the test must fail for the right reason.

### Step 2: Add the missing `await` to all four dispatchers (GREEN)

Every `return handle…(` in these four files sits inside its dispatcher's `try`,
and every one of those dispatchers is an `async function` — verified: the only
matches in each file are the dispatch-table lines quoted in "Current state".
Rewrite them mechanically:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && perl -pi -e 's/\breturn (handle[A-Za-z0-9_]*\()/return await $1/g' \
  workers/case-api/cloudflare.js \
  workers/case-api/cloudflare_mutations.js \
  workers/case-api/cloudflare_actions.js \
  workers/llm-council/cloudflare_handlers.js
```

Do **not** touch `workers/llm-council/cloudflare_handlers.js:54`
(`return requireAuth(request, env, verifyJwt);`) — it is not inside a `try`, and
the regex above does not match it.

**Verify** (all four must hold):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -rnE "return handle[A-Za-z0-9_]*\(" workers/case-api/cloudflare.js workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js workers/llm-council/cloudflare_handlers.js
```
→ no output (exit status 1).

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -c "return await handle" workers/case-api/cloudflare.js workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js workers/llm-council/cloudflare_handlers.js
```
→ exactly:
```
workers/case-api/cloudflare.js:34
workers/case-api/cloudflare_mutations.js:4
workers/case-api/cloudflare_actions.js:3
workers/llm-council/cloudflare_handlers.js:10
```

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && for f in workers/case-api/cloudflare.js workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js workers/llm-council/cloudflare_handlers.js; do node --check "$f" || echo "SYNTAX FAIL $f"; done
```
→ no output.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run
```
→ **0 failed**, `Tests` == `WORKER_BEFORE + 4` (Step 1's four tests now pass),
`Test Files` == `FILES_BEFORE + 1`.

### Step 3: Return 403 for a malformed CSRF token

Create `workers/__tests__/csrf-malformed-token.test.js` with 3 tests, then fix
`workers/auth/csrf.js`.

Tests (write them first and confirm they fail):

1. `"returns 403 when the payload segment is not base64url"` — import
   `{ verifyCsrf }` from `../auth/csrf.js` directly (no mocks needed), build
   `new Request("https://immi.example/api/v1/write", { headers: { "X-CSRFToken": "abc!.def!", Cookie: "__Host-csrf=abc!.def!" } })`,
   call with `{ CSRF_SECRET: "test-secret" }`, expect `status === 403` and
   `{ code: "csrf" }`.
2. `"returns 403 when the signature segment is not base64url"` — build the
   payload in the test so nothing is hardcoded:
   ```js
   const payload = btoa("aa.9999999999999").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
   const token = `${payload}.@@@@`;
   ```
   (`9999999999999` is a far-future expiry, so the expiry check at line 46
   passes and execution reaches the signature decode.) Expect 403 and
   `{ code: "csrf" }`.
3. `"maps a crafted malformed token to 403, not a generic 503, through the action dispatcher"` —
   in this test mock **only** `../storage/cloudflare.js` (so the real
   `verifyCsrf` runs) and dispatch
   `POST /api/v1/taxonomy/guided-search` with headers
   `{ "Content-Type": "application/json", "X-CSRF-Token": "abc!.def!", Cookie: "__Host-csrf=abc!.def!" }`
   and env `{ IMMI_STORAGE_MODE: "cloudflare", CSRF_SECRET: "test-secret" }`.
   Expect 403 / `{ code: "csrf" }` (before the fix this is 503 /
   `{ code: "cloudflare_action_unavailable" }`).
   Because `vi.mock` calls are hoisted per file, put this test in its own file
   only if mixing mocked and unmocked `../auth/csrf.js` in one file proves
   awkward — it does not: this file never mocks `../auth/csrf.js` at all, it
   only mocks `../storage/cloudflare.js`.

Fix in `workers/auth/csrf.js` — add a helper next to `b64urlDecode` and use it
in `verifyCsrf`, preserving the current check order (payload decode → expiry →
signature decode → HMAC verify) so an expired token still reports
`csrf_expired`:

```js
function b64urlDecodeOrNull(value) {
  try {
    return b64urlDecode(value);
  } catch {
    return null;
  }
}
```

Replace lines 44–48 of `verifyCsrf` with:

```js
  const payloadBytes = b64urlDecodeOrNull(payloadB64);
  if (!payloadBytes) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const payload = new TextDecoder().decode(payloadBytes);
  const expiry = Number(payload.split(".")[1]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return Response.json({ error: "csrf_expired", code: "csrf_expired" }, { status: 403 });
  const signatureBytes = b64urlDecodeOrNull(signatureB64);
  if (!signatureBytes) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const valid = await crypto.subtle.verify("HMAC", await importHmacKey(env.CSRF_SECRET), signatureBytes, new TextEncoder().encode(payload));
  return valid ? null : Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
```

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/csrf-malformed-token.test.js __tests__/csrf.test.js`
→ `Test Files 2 passed (2)` / `Tests 5 passed (5)` — a two-file count, stable
because no sibling plan owns either file (3 new + the 2 pre-existing CSRF
tests, which must still pass unchanged).

### Step 4: Skip Council session persistence when the stream yields no result

Create `workers/__tests__/council-stream-persistence.test.js`. Copy the mock
preamble from `workers/__tests__/cloudflare-council-handlers.test.js:1-76`
(same mocks: `../auth/request_auth.js`, `../auth/jwt.js`, `../llm-council/auth.js`,
`../llm-council/runner.js`, `../storage/cloudflare.js`,
`../llm-council/session_namespace.js`), and use its `stores()` /
`rateLimiter()` / `request()` helpers.

**Required env for every test in this file**: `/api/v1/llm-council/stream`,
`/api/v1/llm-council/sessions` (POST) and `/sessions/restore` all call
`applyRateLimit`, which returns 429 when `env.RL_COUNCIL_TURN` is absent
(`workers/llm-council/cloudflare_handlers.js:40-45`). So every dispatch in this
file must pass
`{ IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() }`. If a test
unexpectedly returns 429, that binding is what is missing.

Add these two tests in this step (the remaining five come in Step 5):

1. `"does not create a session row when the stream resolves with no result"` —
   ```js
   mockStreamCouncil.mockReturnValue({
     readable: new ReadableStream({ start(controller) { controller.close(); } }),
     work: Promise.resolve(null),
   });
   ```
   dispatch `POST /api/v1/llm-council/stream` with `ctx = { waitUntil: (p) => pending.push(p) }`,
   `await Promise.all(pending)`, then expect: `response.status === 200`,
   `current.councilStore.createSession` **not** called, `mockStub.appendTurn`
   **not** called, and a `console.log` spy
   (`vi.spyOn(console, "log").mockImplementation(() => {})`) to have received a
   JSON string containing `"council.stream.skipped_persist"`.
2. `"still persists the session and turn when the stream resolves with a result"` —
   same setup but `work: Promise.resolve({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] })`;
   expect `createSession` and `appendTurn` each called once. (Regression guard;
   this one passes before and after.)

Fix in `workers/llm-council/cloudflare_handlers.js` — guard the persist callback
at line 361 before any store call:

```js
  const persist = stream.work.then(async (result) => {
    // runner.js resolves work with null on client disconnect, all-experts-failed
    // and orchestration throw. Persisting then would write a zero-turn session
    // row and lose the turn, so skip the whole write path.
    if (!result) {
      console.log(JSON.stringify({ event: "council.stream.skipped_persist", session_id: sessionId }));
      return;
    }
    // Recheck at write time: membership could have been revoked while the
    // response streamed, and D1 itself has no transaction-local RLS claims.
    const current = await councilStoresForClaims(env, authResult.claims);
    ...
```

Keep the rest of the callback (the membership recheck, `createSessionWithRetrieveCode`,
`persistTurn`, the trailing `.catch`) exactly as it is.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/council-stream-persistence.test.js`
→ `Tests 2 passed (2)`.

### Step 5: Detect retrieve-code collisions explicitly; log advertise/persist skew; remove the modulo bias

All three edits are in `workers/llm-council/cloudflare_handlers.js`.

**Correction applied after review**: an earlier draft of this plan left the
collision detection as a *narrowed* substring match on a D1 error message the
project does not control, and deferred the real fix to "another plan". That was
wrong on both counts. First, narrowing a regex does not repair the defect — the
handler is still coupled to an English SQLite message whose wording D1 may
change at any time. Second, a check of every plan file confirms **no other plan
owns `CloudflareCouncilStore.createSession`**: `plans/013-*.md` lists the
`CloudflareCaseStore` methods it owns and this is not among them, and
`plans/009-*.md` owns `rebuildAggregates` / `updateCaseFields` /
`putImportedCase`. So the region is unowned, and this plan takes it (Step 5b).
The message-shape predicate survives only as a **transitional fallback**.

**5a — explicit collision predicate.** Add above `createSessionWithRetrieveCode`:

```js
/**
 * The authoritative signal is the typed error raised by
 * CloudflareCouncilStore.createSession (Step 5b): a UNIQUE conflict on
 * retrieve_code becomes StorageBoundaryError{code:"retrieve_code_conflict"}.
 *
 * The message-shape branch below is a TRANSITIONAL fallback for a Worker
 * deployed against an older store build during a rolling deploy. It matches a
 * SQLite message this project does not control, so it must never be the only
 * detection path — if you find yourself relying on it, the store change did
 * not land. Delete this branch once one full deploy cycle has passed.
 */
function isRetrieveCodeConflict(err) {
  if (err instanceof StorageBoundaryError) return err.code === "retrieve_code_conflict";
  const message = String(err?.message || "");
  return /constraint|unique/i.test(message) && message.includes("retrieve_code");
}
```

Then rewrite the tail of `createSessionWithRetrieveCode` (lines 91–96):

```js
    } catch (err) {
      lastError = err;
      if (!isRetrieveCodeConflict(err)) throw err;
      console.log(JSON.stringify({ event: "council.retrieve_code_conflict", attempt }));
    }
  }
  console.error(JSON.stringify({ event: "council.retrieve_code_exhausted", error: lastError?.message }));
  throw new StorageBoundaryError("Could not allocate a unique retrieve code", {
    code: "retrieve_code_conflict",
    status: 503,
  });
}
```

`StorageBoundaryError` is already imported at line 15 — do not add an import.

**5b — make an advertise/persist skew observable.** In `handleStream`'s persist
callback (as edited in Step 4), capture the persisted code and compare:

```js
    const persisted = await createSessionWithRetrieveCode(current.stores, current.auth, {
      sessionId, caseId: body.case_id || null, title: message.slice(0, 80),
    }, retrieveCode);
    if (persisted.retrieveCode !== retrieveCode) {
      // The code already streamed to the client as `council.session` collided,
      // so the session carries a different one. Astronomically rare (31^6
      // space) but silent until now — log the fact, never the codes.
      console.error(JSON.stringify({ event: "council.stream.retrieve_code_reissued", session_id: sessionId }));
    }
```

Do **not** log the retrieve code values themselves — a live retrieve code
restores a session for anyone inside the tenant.

**5b — raise a typed conflict from the store (the real fix).**

In `workers/storage/cloudflare.js`, inside `CloudflareCouncilStore.createSession`
**only**, replace the bare `INSERT ... .run()` with a conflict-targeted upsert
plus a change-count check. The current code (verified verbatim) is a plain
`INSERT INTO council_sessions (...) VALUES (...)` followed by a `SELECT`.
It becomes:

```js
  async createSession(auth, { sessionId, caseId = null, title = "", retrieveCode = null }) {
    const context = assertAuthContext(auth);
    const now = utcNow();
    // ON CONFLICT targets the `retrieve_code TEXT UNIQUE` constraint declared
    // at migrations/d1/account/0001_account.sql:110. A collision then yields
    // zero changes instead of a raw SQLite exception, so the caller gets a
    // typed error rather than having to pattern-match D1's message text.
    // NOTE: the conflict target is deliberately narrow — a session_id primary
    // key collision still throws, because that is a genuine bug, not a
    // re-rollable code clash.
    const result = await this.db.prepare(`
      INSERT INTO council_sessions (
        session_id, tenant_id, created_by, case_id, title, status, retrieve_code,
        total_turns, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)
      ON CONFLICT(retrieve_code) DO NOTHING
    `).bind(sessionId, context.tenantId, context.userId, caseId, title, retrieveCode, now, now).run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Retrieve code already in use", {
        code: "retrieve_code_conflict",
        status: 409,
      });
    }
    return this.db.prepare(`
      SELECT session_id, case_id, title, status, retrieve_code, total_turns, created_at, updated_at
      FROM council_sessions WHERE session_id = ? AND tenant_id = ?
    `).bind(sessionId, context.tenantId).first();
  }
```

`changeCount` (module-level, line ~50) and `StorageBoundaryError` (imported in
the block at lines 10–29) are both already available in this file — do not add
imports.

**Two facts you must not get wrong**, because both would turn this into a
silent data bug:

- `retrieve_code` is nullable and `createSession` is called with
  `retrieveCode = null` from paths that do not mint a code. SQLite's UNIQUE
  treats each NULL as distinct, so `ON CONFLICT(retrieve_code) DO NOTHING`
  **never** suppresses a NULL-code insert. Confirm this with test 2 below
  rather than assuming it.
- `ON CONFLICT(retrieve_code)` names a conflict *target*, so it only swallows
  collisions on that one index. A duplicate `session_id` still raises, which is
  what we want.

Create `workers/__tests__/council-store-retrieve-code.test.js` with 2 tests,
modelled on the fake-D1 helper in
`workers/__tests__/cloudflare-storage-contracts.test.js:22-40` (extended so
`run()` can return `{ meta: { changes: 0 } }` on demand) and the export-style
assertions that inspect `value.IMMI_ACCOUNT_DB.calls`:

1. `"raises a typed retrieve_code_conflict when the insert changes no rows"` —
   a D1 double whose `run()` resolves `{ meta: { changes: 0 } }`; assert
   `await expect(store.createSession(AUTH, { sessionId: "s1", retrieveCode: "ABCDEF" })).rejects.toMatchObject({ code: "retrieve_code_conflict", status: 409 })`,
   and that the recorded INSERT statement's SQL contains
   `ON CONFLICT(retrieve_code) DO NOTHING`.
2. `"inserts a null retrieve code without tripping the conflict branch"` —
   `run()` resolves `{ meta: { changes: 1 } }`; call with `retrieveCode`
   omitted; assert it resolves and does not throw. This is the regression pin
   for the nullable-column subtlety above.

**Verify (5b)**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/council-store-retrieve-code.test.js
```
→ `Tests 2 passed (2)`.

**Verify (5b, the assertion can fail)**: temporarily change the store's
`changeCount(result) === 0` guard to `=== -1`, re-run, confirm test 1 fails,
restore, re-run green. Do not commit the temporary change.

**5c — rejection sampling in `generateRetrieveCode`** (replaces lines 47–51):

```js
function generateRetrieveCode() {
  const size = RETRIEVE_CODE_ALPHABET.length;
  // 256 % 31 === 8, so bytes >= 248 would over-represent the first 8 symbols.
  // Reject that tail instead of folding it in with a plain modulo.
  const limit = 256 - (256 % size);
  const code = [];
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(6))) {
      if (byte >= limit) continue;
      code.push(RETRIEVE_CODE_ALPHABET[byte % size]);
      if (code.length === 6) break;
    }
  }
  return code.join("");
}
```

Add these five tests to `workers/__tests__/council-stream-persistence.test.js`:

3. `"retries a typed retrieve-code collision and then succeeds"` — on the
   non-streaming route `POST /api/v1/llm-council/sessions` with
   `current.councilStore.createSession` rejecting twice with the **typed**
   error the store now raises —
   `new StorageBoundaryError("Retrieve code already in use", { code: "retrieve_code_conflict", status: 409 })`
   — then resolving; expect `status === 200` and `createSession` called 3
   times. This is the primary path after Step 5b.
3b. `"still retries a legacy message-shaped collision during a rolling deploy"` —
   the same test but rejecting twice with
   `new Error("D1_ERROR: UNIQUE constraint failed: council_sessions.retrieve_code: SQLITE_CONSTRAINT")`.
   This pins the transitional fallback branch only. Delete this test in the
   same change that deletes the fallback branch.
4. `"surfaces a typed retrieve_code_conflict when every attempt collides"` —
   the typed 409 on all three attempts; expect `status === 503` and
   `{ code: "retrieve_code_conflict" }`. (The handler deliberately re-raises as
   503, not 409: three independent collisions in a 31^6 space means the code
   generator or the store is broken, which is a server fault, not a client one.)
5. `"rethrows an unrelated error that merely mentions retrieve_code"` —
   `createSession` rejects with
   `new Error("D1_ERROR: no such column: retrieve_code_v2")`; expect
   `createSession` called **exactly once** and the response to be 503 with
   `{ code: "council_unavailable" }`. (Before the fix it is called 3 times.)
6. `"logs a reissue when the advertised retrieve code collides on the stream path"` —
   stream route, `work` resolving with a real payload, `createSession` rejecting
   once with the UNIQUE message then resolving; expect a `console.error` spy to
   have seen `"council.stream.retrieve_code_reissued"`.
7. `"rejects biased random bytes when minting a retrieve code"` —
   ```js
   const spy = vi.spyOn(globalThis.crypto, "getRandomValues")
     .mockImplementationOnce((array) => { array.fill(255); return array; })
     .mockImplementation((array) => { array.fill(0); return array; });
   ```
   then dispatch the stream route and read the advertised code from
   `mockStreamCouncil.mock.calls[0][0].sessionMeta.retrieve_code`; expect
   `"222222"` (byte 0 → `RETRIEVE_CODE_ALPHABET[0]` === `"2"`) and
   `spy).toHaveBeenCalledTimes(2)`. Restore the spy in the test
   (`spy.mockRestore()`) or rely on `vi.clearAllMocks()` plus an explicit
   `vi.restoreAllMocks()` in an `afterEach`.

   **Warning**: `generateRetrieveCode` loops until it has 6 accepted bytes. A
   mock that *always* returns bytes >= 248 will hang the test. Use
   `mockImplementationOnce` for the rejected round exactly as above. Do not
   "fix" a hang by bounding the loop — a bounded loop can emit a code shorter
   than 6 characters, which is worse than the bias.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/council-stream-persistence.test.js
```
→ `Tests 8 passed (8)` (a per-file count: 2 from Step 4 + 6 here).

```bash
npx vitest run __tests__/cloudflare-council-handlers.test.js
```
→ **0 failed**, and the same per-file count you recorded before starting.
Do not assert a fixed number here: if `plans/004-*.md` landed first it added
6 tests to this file. In particular
`"persists the exact retrieve code advertised by an SSE stream"` must still
pass — check it by name:
```bash
npx vitest run __tests__/cloudflare-council-handlers.test.js -t "persists the exact retrieve code advertised by an SSE stream"
```

### Step 6: Re-seed the CouncilSessionDO schema, guard turn allocation, and refuse to write to a deleted session

**Read this before writing any code — an earlier draft of this step was wrong.**

Re-seeding the schema is necessary but **not sufficient**, and on its own it is
actively harmful. Here is the full sequence for an `appendTurn` that races a
completed `deleteSession`, verified against the live code:

1. `deleteSession` (`workers/llm-council/session_do.js`) calls
   `stores.councilStore.deleteSession(...)`, which is a **soft delete** — it
   sets `deleted_at` on the `council_sessions` row (verified verbatim in
   `CloudflareCouncilStore.deleteSession`). It then calls
   `this.ctx.storage.deleteAll()`, dropping the DO's SQL tables.
2. A racing `appendTurn` with only `ensureSchema()` added would: recreate the
   tables, allocate `turn_index = 0`, then call
   `stores.objectStore.putCouncilPayload(...)` — **an R2 write** — and only
   *then* call `stores.councilStore.appendTurnMetadata(...)`.
3. `appendTurnMetadata` guards its INSERT with
   `WHERE EXISTS (SELECT 1 FROM council_sessions WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL)`
   and throws `StorageBoundaryError{code:"council_session_not_found", status:404}`
   when both statements change zero rows (verified verbatim).

So in production the append **fails with a 404 after the R2 object is already
written**, leaving an orphan payload. A test double whose metadata write
succeeds unconditionally would assert `{ turnIndex: 0, replayed: false }` and
thereby **pin the wrong behaviour as correct**. Do not write that test.

The correct shape of this step is therefore three changes, not one:

- `ensureSchema()` so the tables exist (stops the "no such table" throw and
  makes the failure a *typed* one instead of an opaque SQL error);
- a null guard on the allocation (typed 404 instead of a `TypeError`);
- **a session-liveness check before the R2 write**, so a deleted session is
  rejected with the typed 404 and `putCouncilPayload` is never called.

Edit `workers/llm-council/session_do.js`. Hoist the three schema statements out
of the constructor so `appendTurn` can re-run them idempotently, add the null
guard, and add the liveness check.

Add above the class (after the `first` helper at lines 23-26):

```js
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS council_turn_ledger (
    turn_id TEXT PRIMARY KEY,
    turn_index INTEGER NOT NULL UNIQUE,
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS council_turn_sequence (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    next_turn INTEGER NOT NULL
  )`,
  "INSERT OR IGNORE INTO council_turn_sequence (singleton, next_turn) VALUES (1, -1)",
];

/**
 * deleteSession() calls storage.deleteAll(), which drops these tables on a
 * SQLite-backed DO. The constructor only runs on a cold start, so appendTurn
 * re-asserts the schema instead of throwing "no such table" on a DELETE that
 * races an in-flight append.
 */
function ensureSchema(sql) {
  for (const statement of SCHEMA_STATEMENTS) sql.exec(statement);
}
```

Replace the constructor body's three `exec` calls with
`ensureSchema(this.ctx.storage.sql);` (keep `super(ctx, env)` and the
`ctx.blockConcurrencyWhile(async () => { ... })` wrapper exactly as they are).

In `appendTurn`, call `ensureSchema(this.ctx.storage.sql);` immediately after
the role validation (i.e. after the `if (typeof role !== "string" ...)` block,
before the `SELECT`), and guard the allocation:

```js
      if (!allocated) {
        throw new StorageBoundaryError("Council session not found", {
          code: "council_session_not_found",
          status: 404,
        });
      }
      this.ctx.storage.sql.exec(
        "UPDATE council_turn_sequence SET next_turn = ? WHERE singleton = 1",
        allocated.turn_index,
      );
```

`StorageBoundaryError` is already imported at line 11 and
`council_session_not_found` is the code `handleDeleteSession` already maps to
404 (`workers/llm-council/cloudflare_handlers.js:286`), so this integrates with
the existing contract.

**Then add the liveness check**, immediately after the `stores` are created and
**before** the `putCouncilPayload` call — i.e. between these two existing
lines:

```js
    const stores = createCloudflareStores(this.env);
    // A deleteSession that already committed leaves a soft-deleted D1 row
    // (deleted_at set) while this DO's tables were wiped and have just been
    // re-seeded by ensureSchema(). Writing the R2 payload first would strand
    // an orphan object, because appendTurnMetadata refuses a soft-deleted
    // session. Check liveness before spending the write.
    const live = await stores.councilStore.getSessionMetadata(context, checkedSessionId);
    if (!live) {
      throw new StorageBoundaryError("Council session not found", {
        code: "council_session_not_found",
        status: 404,
      });
    }
    const payloadPointer = await stores.objectStore.putCouncilPayload({
```

`getSessionMetadata` already filters on `deleted_at IS NULL` (verified in
`CloudflareCouncilStore.getSessionMetadata`), so it returns falsy for a
soft-deleted session and truthy otherwise — no new store method is needed.

**Cost note, state it in the PR**: this adds one D1 SELECT to every
`appendTurn`. `appendTurn` already performs an R2 write plus a two-statement D1
batch, so one more indexed point read is not a meaningful regression, and it
replaces an orphaned R2 object with a clean typed 404. If a future profile
shows otherwise, the alternative is to move the liveness check into
`appendTurnMetadata` and reorder the R2 write after it — a larger store-layer
change.

Create `workers/__tests__/council-session-do-recovery.test.js` with 2 tests.
Model the mocks on `workers/__tests__/council-session-do.test.js:1-17` (mock
`cloudflare:workers` with a stub `DurableObject` class and mock
`../storage/cloudflare.js`). Use a fake `sql` that models table existence, so
the pre-fix code fails with a real "no such table" error:

```js
function makeState({ ledgerInsertReturnsNothing = false } = {}) {
  let tables = new Set();
  let sequenceSeeded = false;
  let nextTurn = -1;
  const ledger = new Map();
  const sql = {
    exec(statement, ...params) {
      if (statement.includes("CREATE TABLE IF NOT EXISTS council_turn_ledger")) { tables.add("ledger"); return []; }
      if (statement.includes("CREATE TABLE IF NOT EXISTS council_turn_sequence")) { tables.add("sequence"); return []; }
      if (statement.includes("INSERT OR IGNORE INTO council_turn_sequence")) {
        if (!tables.has("sequence")) throw new Error("no such table: council_turn_sequence");
        if (!sequenceSeeded) { sequenceSeeded = true; nextTurn = -1; }
        return [];
      }
      if (statement.includes("SELECT turn_index, completed FROM council_turn_ledger")) {
        if (!tables.has("ledger")) throw new Error("no such table: council_turn_ledger");
        const row = ledger.get(params[0]);
        return row ? [row] : [];
      }
      if (statement.includes("INSERT INTO council_turn_ledger")) {
        if (!tables.has("ledger") || !sequenceSeeded || ledgerInsertReturnsNothing) return [];
        const row = { turn_index: nextTurn + 1, completed: 0 };
        ledger.set(params[0], row);
        return [row];
      }
      if (statement.includes("UPDATE council_turn_sequence")) { nextTurn = params[0]; return []; }
      if (statement.includes("SET completed = 1")) { const row = ledger.get(params[0]); if (row) row.completed = 1; return []; }
      return [];
    },
  };
  return {
    blockConcurrencyWhile: async (callback) => callback(),
    storage: {
      sql,
      deleteAll: vi.fn(async () => { tables = new Set(); sequenceSeeded = false; nextTurn = -1; ledger.clear(); }),
    },
  };
}
```

**The `stores()` double must model the soft delete.** Copy the one at
`workers/__tests__/council-session-do.test.js:55-79`, then make it stateful so
`deleteSession` actually changes what `getSessionMetadata` returns — otherwise
every test below passes vacuously:

```js
function stores() {
  let deleted = false;
  return {
    councilStore: {
      getSessionMetadata: vi.fn(async () => (deleted
        ? null                                   // soft-deleted: deleted_at IS NOT NULL
        : { session: { session_id: "session-1", total_turns: 0 }, turns: [] })),
      deleteSession: vi.fn(async () => { deleted = true; }),
      appendTurnMetadata: vi.fn(async () => {
        // Mirrors the real store: the INSERT is guarded by
        // `WHERE EXISTS (... deleted_at IS NULL)`, so a soft-deleted session
        // changes zero rows and raises. A double that always succeeds would
        // certify the exact bug this step exists to prevent.
        if (deleted) {
          throw new StorageBoundaryError("Council session not found", {
            code: "council_session_not_found",
            status: 404,
          });
        }
      }),
    },
    objectStore: {
      putCouncilPayload: vi.fn(async () => ({ key: "council/s1/t1.json", sha256: "a".repeat(64), size: 2, contentType: "application/json" })),
      deleteVerified: vi.fn(async () => undefined),
    },
  };
}
```

Import the real `StorageBoundaryError` from `../storage/contracts.js` (do not
mock that module — `instanceof` checks depend on the real class).

Tests (4):

1. `"refuses a turn append that races a completed deleteSession, without
   writing R2"` — construct the DO with the stateful `stores()` above, call
   `await object.deleteSession(AUTH, { sessionId: "session-1" })`, then:
   ```js
   await expect(object.appendTurn(AUTH, {
     sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hi" },
   })).rejects.toMatchObject({ code: "council_session_not_found", status: 404 });
   expect(current.objectStore.putCouncilPayload).not.toHaveBeenCalled();
   ```
   The `not.toHaveBeenCalled()` assertion is the load-bearing one: it is what
   distinguishes "rejected cleanly" from "rejected after stranding an orphan R2
   object". A test asserting only the rejection would pass without the liveness
   check.
   **Before the fix** this rejects with `no such table: council_turn_ledger`
   (not the typed 404), so the test is red for the right reason — confirm the
   failure message before writing the fix.
2. `"appends normally when the session is still live"` — no `deleteSession`
   call; expect `toMatchObject({ turnIndex: 0, replayed: false })` and
   `putCouncilPayload` called once. This is the guard that the liveness check
   did not break the happy path.
3. `"re-seeds its schema so a post-delete append fails typed rather than on
   missing tables"` — after `deleteSession`, assert the rejection's `code` is
   `"council_session_not_found"` and **not** a message matching `/no such table/`.
   This is what `ensureSchema()` buys: a typed contract error instead of an
   opaque SQL error the dispatcher maps to a generic 503.
4. `"throws a typed 404 when the turn sequence allocates no row"` — build the
   state with `makeState({ ledgerInsertReturnsNothing: true })`, session live,
   and expect
   `rejects.toMatchObject({ code: "council_session_not_found", status: 404 })`.
   Before the fix this rejects with a `TypeError`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/council-session-do-recovery.test.js
```
→ `Tests 4 passed (4)` (per-file count).

```bash
npx vitest run __tests__/council-session-do.test.js
```
→ **0 failed**; in particular
`npx vitest run __tests__/council-session-do.test.js -t "serializes a turn, writes R2 before metadata, then replays idempotently"`
must still pass. That existing test asserts R2-before-metadata ordering for a
**live** session, which the liveness check does not change — if it fails, your
check ran in the wrong place or the double is not modelling liveness.

### Step 7: Inventory (and offer to clean up) the rows the bug already created

The JSCORR-03 defect has been live, so production D1 may already hold
zero-turn `council_sessions` rows created by failed streams, each holding a
retrieve code that was shown to a user and restores nothing. Fixing the code
does not remove them. This step is **read-only for you**; the cleanup is an
operator action with a dry run in front of it.

**7a. Produce the read-only inventory query** and put it in the PR description.
Do not run it — it needs production D1 credentials you do not have and must
not seek:

```sql
-- Zero-turn sessions: the fingerprint of a stream that failed after the
-- session row was written. Read-only. Run first, on its own, and read the
-- output before considering any DELETE.
SELECT COUNT(*) AS zero_turn_sessions,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM council_sessions
WHERE total_turns = 0 AND deleted_at IS NULL;

-- Same rows, bounded sample for eyeballing. Never select retrieve_code into a
-- log or a ticket: a live code restores the session for anyone in the tenant.
SELECT session_id, tenant_id, created_at, title
FROM council_sessions
WHERE total_turns = 0 AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 51;
```

Use `LIMIT 51` and check whether 51 rows came back, not `LIMIT 50` and
`>= 50` — the point is to detect truncation, and `>= 50` cannot distinguish
"exactly 50" from "more than 50".

**7b. Dry-run before any write.** The repo's standing production-cleanup rule
(CLAUDE.md, "Production data cleanup rule") applies in full here: back the
column up first, dry-run on a bounded sample, and eyeball the matches against
ground truth. Concretely, before any soft-delete:

```sql
-- 1. Reversible: mark, do not delete. This is a soft delete the app already
--    understands (getSessionMetadata filters on deleted_at IS NULL), so the
--    rollback is `SET deleted_at = NULL` on the same predicate.
UPDATE council_sessions
SET deleted_at = <iso-timestamp>, updated_at = <iso-timestamp>
WHERE total_turns = 0 AND deleted_at IS NULL AND created_at < <cutoff>;
```

State the exact row count from 7a in the PR **before** proposing this, and
require the operator to confirm that number matches their expectation. A
`created_at < <cutoff>` clause of at least 24 hours is mandatory so an
in-flight stream that has not yet written its first turn is never swept.

**7c. Rollback**: `UPDATE council_sessions SET deleted_at = NULL WHERE ...`
restores them; nothing is destroyed. Record the exact predicate used, so the
rollback can name the same rows.

**Verify**: none of 7a–7c is machine-verifiable from this repo. The Done
criterion is that the three SQL blocks appear verbatim in the PR description
and that the operator has reported the 7a counts. Do not run any DELETE, and
do not mark this step done by asserting it is "probably zero rows".

### Step 8: Full suite and scope check

**Verify** (all three):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run
```
→ **0 failed**, `Tests` == `WORKER_BEFORE + 21`, `Test Files` ==
`FILES_BEFORE + 5` (the baselines from "Baselines, not absolutes"). Do not
hard-code either number: sibling plans move both.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain -- workers/ | sort
```
→ exactly these twelve lines and nothing else:
```
 M workers/auth/csrf.js
 M workers/case-api/cloudflare.js
 M workers/case-api/cloudflare_actions.js
 M workers/case-api/cloudflare_mutations.js
 M workers/llm-council/cloudflare_handlers.js
 M workers/llm-council/session_do.js
 M workers/storage/cloudflare.js
?? workers/__tests__/council-session-do-recovery.test.js
?? workers/__tests__/council-store-retrieve-code.test.js
?? workers/__tests__/council-stream-persistence.test.js
?? workers/__tests__/csrf-malformed-token.test.js
?? workers/__tests__/dispatcher-error-propagation.test.js
```
If any other `workers/` path appears, you modified something out of scope —
revert **that path specifically**; never run a blanket `git checkout --` or
`git clean`. Outside `workers/`, the only path this plan may add is
`plans/005-fix-worker-async-error-handling.md` (this file). Note that
`.claude/STATE.md` was already modified in the working tree at commit `42826a3`
— that is pre-existing, not yours; leave it alone and do not commit it.

Confirm your `workers/storage/cloudflare.js` diff touches only
`CloudflareCouncilStore.createSession`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff -U0 -- workers/storage/cloudflare.js | grep '^@@'
```
→ every hunk header must fall inside that method. If a hunk lands anywhere
else, you edited a region another plan owns — revert that hunk.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain -- workers/pipeline/control_handlers.js workers/llm-council/runner.js workers/cloudflare-native.js wrangler.toml
```
→ no output (you did not touch the out-of-scope Worker files). Run this against
the **working tree**, not `git diff 42826a3..HEAD`: a committed-range diff
cannot see the uncommitted edit you are trying to catch.

## Test plan

New tests, 21 total, all under `workers/__tests__/`:

| File | Tests | Covers |
|---|---|---|
| `dispatcher-error-propagation.test.js` (new) | 4 | A `StorageBoundaryError` thrown inside a handler returns a typed status+code from each of the four dispatchers (read 404, mutation 503, action 404, council 403) instead of escaping as a rejection |
| `csrf-malformed-token.test.js` (new) | 3 | Malformed payload segment → 403; malformed signature segment → 403; crafted malformed token through the action dispatcher → 403 `csrf` not 503 `cloudflare_action_unavailable` |
| `council-stream-persistence.test.js` (new) | 8 | Null stream result → no session row, no turn, `council.stream.skipped_persist` logged; real result still persists; typed 409 collision retried then succeeds; legacy message-shaped collision also retried (transitional); three collisions → typed 503 `retrieve_code_conflict`; unrelated `retrieve_code` error rethrown after one attempt; advertise/persist skew logged; rejection sampling drops bytes >= 248 |
| `council-store-retrieve-code.test.js` (new) | 2 | `createSession` raises typed `retrieve_code_conflict` when the `ON CONFLICT` insert changes no rows; a NULL retrieve code still inserts |
| `council-session-do-recovery.test.js` (new) | 4 | Post-delete append rejects with a typed 404 **and never writes R2**; live append still succeeds; the failure is typed rather than "no such table"; unallocatable turn → typed 404 rather than `TypeError` |

Structural patterns to copy:

- Mock preamble and `stores()` helper:
  `workers/__tests__/cloudflare-actions.test.js` (whole file, 94 lines).
- Council mocks, `rateLimiter()`, `request()`, and the SSE `waitUntil` idiom:
  `workers/__tests__/cloudflare-council-handlers.test.js:1-76` and `:174-190`.
- Durable Object fakes: `workers/__tests__/council-session-do.test.js:1-79`.
- Typed-rejection assertions:
  `workers/__tests__/llm-council-storage.test.js:203` uses
  `.rejects.toMatchObject({ code: "...", status: 503 })` — match that style.

Existing tests that must keep passing unchanged (do not edit them):
`cloudflare-council-handlers.test.js`, `cloudflare-actions.test.js`,
`cloudflare-mutations.test.js`, `case-api-cloudflare.test.js`, `csrf.test.js`,
`council-session-do.test.js`, `cloudflare-native-entry.test.js`.

Verification: `cd workers && npx vitest run` → **0 failed**,
`Tests` == `WORKER_BEFORE + 21`, `Test Files` == `FILES_BEFORE + 5`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd workers && npx vitest run` exits 0 with **0 failed**, `Tests` equal to `WORKER_BEFORE + 21` and `Test Files` equal to `FILES_BEFORE + 5` (baselines recorded before you started)
- [ ] `cd workers && npx vitest run __tests__/dispatcher-error-propagation.test.js` reports `4 passed`
- [ ] `cd workers && npx vitest run __tests__/csrf-malformed-token.test.js` reports `3 passed`
- [ ] `cd workers && npx vitest run __tests__/council-stream-persistence.test.js` reports `8 passed`
- [ ] `cd workers && npx vitest run __tests__/council-store-retrieve-code.test.js` reports `2 passed`
- [ ] `cd workers && npx vitest run __tests__/council-session-do-recovery.test.js` reports `4 passed`
- [ ] `cd workers && npx vitest run __tests__/council-session-do-recovery.test.js -t "refuses a turn append that races a completed deleteSession"` passes
- [ ] `cd workers && npx vitest run __tests__/council-session-do.test.js -t "serializes a turn, writes R2 before metadata, then replays idempotently"` still passes
- [ ] `grep -rnE "return handle[A-Za-z0-9_]*\(" workers/case-api/cloudflare.js workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js workers/llm-council/cloudflare_handlers.js` returns no matches (exit 1)
- [ ] `grep -c "return await handle" workers/case-api/cloudflare.js workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js workers/llm-council/cloudflare_handlers.js` prints `34`, `4`, `3`, `10` respectively — **unless `plans/004-*.md` landed first**, in which case the council file's count may be higher; verify by re-running the `grep -rnE` above rather than by adjusting this number
- [ ] `grep -c "b64urlDecodeOrNull" workers/auth/csrf.js` is `3` (one definition, two call sites)
- [ ] `grep -c "council.stream.skipped_persist" workers/llm-council/cloudflare_handlers.js` is `1`
- [ ] `grep -c "isRetrieveCodeConflict" workers/llm-council/cloudflare_handlers.js` is `2` (definition + call site)
- [ ] `grep -c "ON CONFLICT(retrieve_code) DO NOTHING" workers/storage/cloudflare.js` is `1`
- [ ] `grep -c "ensureSchema" workers/llm-council/session_do.js` is `3` (definition + constructor + appendTurn)
- [ ] `grep -c "getSessionMetadata" workers/llm-council/session_do.js` is `2` (the pre-existing `deleteSession` call + the new liveness check in `appendTurn`)
- [ ] `node --check` exits 0 for all seven modified source files
- [ ] `git status --porcelain -- workers/` lists exactly the twelve in-scope `workers/` paths and nothing else
- [ ] `git diff -U0 -- workers/storage/cloudflare.js | grep '^@@'` shows hunks only inside `CloudflareCouncilStore.createSession`
- [ ] `git status --porcelain -- workers/pipeline/control_handlers.js workers/llm-council/runner.js workers/cloudflare-native.js wrangler.toml` returns no output (working-tree check, not a committed-range diff)
- [ ] Step 7's three SQL blocks appear verbatim in the PR description, and the operator has reported the 7a zero-turn-session count

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file lists any in-scope file, or a
  "Current state" excerpt does not match the live code verbatim.
- After Step 2, the `grep -c "return await handle"` counts differ from
  34 / 4 / 3 / 10. A different count means either the file drifted or the perl
  regex matched something it should not have — inspect the diff, do not adjust
  the expected numbers.
- Any of the 4 tests written in Step 1 fails with a `TypeError`, a
  "not a function" error, or a mock-shape error rather than with the thrown
  `StorageBoundaryError` message. That means the mock does not match the
  handler's real store calls, and the test is not proving the bug.
- Step 5's test 7 (rejection sampling) hangs. That is a mock that always
  returns bytes >= 248. Fix the mock; do **not** add a loop bound to
  `generateRetrieveCode` — a bounded loop can emit a code shorter than 6
  characters.
- Any previously passing test in `workers/__tests__/` starts failing. In
  particular `"persists the exact retrieve code advertised by an SSE stream"`
  (`cloudflare-council-handlers.test.js:174`) and
  `"serializes a turn, writes R2 before metadata, then replays idempotently"`
  (`council-session-do.test.js:88`) are the two most likely to break from
  Steps 4–6. Report the failure rather than editing the existing test.
- You find yourself wanting to change `workers/storage/cloudflare.js` **outside
  `CloudflareCouncilStore.createSession`**, or `workers/llm-council/runner.js`,
  or `workers/pipeline/control_handlers.js`, or to add a `try/catch` around the
  dispatch chain in `workers/cloudflare-native.js`. All are deliberately out of
  scope; only that one store method is yours.
- `plans/006-*.md` has already landed and `requireWriter` in
  `workers/case-api/cloudflare_mutations.js` calls `assertPlatformOperator`.
  The order was inverted (see "Sequencing"); the Step 1 mutation test's store
  double will need `assertPlatformOperator` instead of `assertMembership`.
  Report the inversion rather than silently adapting — 006 was written on the
  assumption that it inherits and updates this plan's tests.
- Step 6 test 1 passes **before** you make the code change. That means the
  store double is not modelling the soft delete, so the test is certifying the
  bug. Fix the double (`getSessionMetadata` must return falsy after
  `deleteSession`) before writing any production code.
- The assumption "every `return handle…(` in the four in-scope files sits inside
  its dispatcher's `try` block, and every one of those dispatchers is declared
  `async`" turns out to be false for any file.
- A step's verification fails twice after one reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **The same defect still exists in `workers/pipeline/control_handlers.js`, in
  four places, not one**: `return enqueueControl(...)` at lines 109, 119, 123
  and 124, all inside the `try` whose catch is at line 129, with a deliberate
  `StorageBoundaryError` thrown at line 88. `plans/006-*.md` owns that file and
  now fixes all four. If that plan does not land, apply the identical one-word
  fix to **all four** lines — an earlier draft of this note said "line 109",
  which would have left three of them broken.
- **The retrieve-code collision fix is now complete on both sides.** Step 5b
  raises a typed `retrieve_code_conflict` from
  `CloudflareCouncilStore.createSession`; Step 5a's handler predicate consumes
  it. The message-shape branch in `isRetrieveCodeConflict` is a **transitional
  fallback for a rolling deploy only** — delete it (and its dedicated test
  `"still retries a legacy message-shaped collision during a rolling deploy"`)
  once one full deploy cycle has passed, so the handler stops depending on a
  D1 message string entirely.
- **Unresolved risk, stated plainly: advertise/persist retrieve-code skew.**
  `handleStream` still hands the client a retrieve code *before* any D1 write.
  If that exact code collides, the session persists under a different one and
  the code the user was shown restores nothing. Step 5 makes this **observable**
  (`council.stream.retrieve_code_reissued`) and much rarer (rejection sampling
  removes the modulo bias) — it does **not** eliminate it. Do not describe this
  plan as fixing JSCORR-17. Eliminating it needs a code *reservation* before the
  stream opens, which conflicts with the Step 4 fix (reserving means writing a
  row, which is the zero-turn row Step 4 removes); the clean version is a
  separate `council_retrieve_codes` reservation table with its own TTL. Estimated
  exposure at current volume: ~N/887M per session. Alert on the reissue event;
  if it ever fires more than once a month, build the reservation table.
- **A reviewer should scrutinise**: that no `await` was added to a `return` in a
  non-`async` function (would be a syntax error — `node --check` covers it);
  that the `handleStream` persist callback still performs the membership
  recheck via `councilStoresForClaims` *after* the `!result` guard; and that
  `verifyCsrf` still returns `csrf_expired` (not `csrf`) for a well-formed but
  expired token — the decode order was preserved specifically for that.
- **Behaviour change to expect in Logpush**: routes that previously produced a
  bodyless 500 now emit `{error, code}` JSON with the handler's real status.
  Any dashboard counting 5xx on `/api/v1/*` will see counts move from 500 to
  403/404/503. That is the intended outcome.
- **No longer deferred — the orphan-R2 race is fixed here.** An earlier draft
  deferred it on the mistaken belief that it needed a store-layer change. It
  does not: `CloudflareCouncilStore.getSessionMetadata` already filters on
  `deleted_at IS NULL`, so `appendTurn` can check liveness with an existing
  method before spending the R2 write. Step 6 does exactly that, and the
  regression pin is
  `expect(current.objectStore.putCouncilPayload).not.toHaveBeenCalled()`.
  The residual is a TOCTOU window of one D1 round-trip — a `deleteSession`
  committing between the liveness check and the R2 write can still strand one
  object. That is now a genuinely narrow race rather than the guaranteed
  outcome it was before, and closing it entirely needs a store-layer
  conditional write.
- **Not fixed, deliberately** — see the "Unresolved risk" bullet above; it is
  the same item and is stated there in full.
- **Also update the Step 2 git-workflow commit list** if you add commits:
  Step 5b is a store change and deserves its own commit
  (`fix: raise a typed retrieve_code_conflict from the Council store`), and
  Step 6's liveness check belongs in the same commit as the rest of Step 6.
- **Steps 7 and 8 produce no commits.** Step 7 is operator handoff text;
  Step 8 is verification only.

## Findings reconsidered

Nothing was dropped, but four claims were corrected against the live code and
one fix sketch was rejected:

- **JSCORR-01 title overstated.** "Every dispatcher's try/catch is dead" is too
  strong. The catches still cover the awaited pre-handler work
  (`createCloudflareStores`, `requireMutationQueue`, `requireWriter`, `readJson`,
  regex matching). Only rejections raised *inside* a handler escape. Retitled
  and corrected in "Current state"; the fix is unchanged.
- **JSCORR-11 trigger corrected.** The audit claimed "a caller who sets both the
  CSRF header and cookie to non-base64 text"; that is right, but the derived
  claim that a truncated or garbled *client* token triggers it is wrong — line
  39 rejects a header/cookie mismatch with 403 first. The trigger is a crafted
  request with the same malformed value in both places, so this is an
  attacker-reachable wrong status code, not organic alert noise. Fix unchanged.
- **JSCORR-03 impact corrected.** On two of the three null paths the client does
  receive a `council.error` SSE event, so this is not "silent data loss dressed
  up as success". The real defect is the orphan zero-turn `council_sessions`
  row plus the lost turn. Fix unchanged.
- **JSCORR-06 evidence corrected, one sub-claim dropped.** On a SQLite-backed DO
  (`new_sqlite_classes` in `wrangler.toml`), `deleteAll()` drops the tables, so
  the first failure after a delete is the `SELECT` at `session_do.js:64-67`
  ("no such table"), not the `allocated.turn_index` deref at line 76. Step 6
  therefore adds an idempotent `ensureSchema()` *as well as* the null guard —
  the guard alone would not fix the race. The audit's second sub-claim, that a
  Queue retry receives a different `turn_index`, is **false**: the ledger is
  keyed by `turn_id` and looked up first, so a retry resumes the same index
  exactly as the comment at lines 51-55 promises. That sub-claim is dropped and
  no work was created for it.
- **JSCORR-17 fix sketch rejected; replaced.** The sketch says "persist the
  session (or at least reserve the retrieve code) before opening the stream".
  Done literally, that re-creates the zero-turn session row on every failed
  stream — precisely the JSCORR-03 defect this plan removes, and JSCORR-03 fires
  on a real, documented path (all experts failed) while JSCORR-17 needs a
  ~N/887M collision. A genuine reservation needs a *separate* reservation table
  with its own TTL, which is a schema change beyond this plan. Step 5 therefore
  delivers the parts that fit: a structured
  `council.stream.retrieve_code_reissued` log so the skew stops being silent,
  and rejection sampling to remove the ~12.5% modulo bias the finding also
  flagged. **The skew itself is not fixed** and is recorded as an explicit
  unresolved risk in "Maintenance notes" — not as a closed finding.

- **Two claims in the first draft of this plan were wrong and are corrected
  above.** Recorded here so a reader of the diff can see what changed and why:
  1. *"`workers/storage/cloudflare.js` is owned elsewhere"* — no plan owns
     `CloudflareCouncilStore.createSession`. `plans/013-*.md` enumerates the
     `CloudflareCaseStore` methods it owns (`listPage`, `countCompat`,
     `guidedPrecedents`, `relatedCompat`, `searchLexical`) and `plans/009-*.md`
     owns `rebuildAggregates` / `updateCaseFields` / `putImportedCase`. The
     region was simply unclaimed, so deferring the real fix to a phantom plan
     would have left the handler pattern-matching a D1 message indefinitely.
     Step 5b now takes it.
  2. *"`ensureSchema()` plus a null guard fixes the delete/append race"* — it
     does not. `CloudflareCouncilStore.deleteSession` is a soft delete and
     `appendTurnMetadata` guards on `deleted_at IS NULL`, while `appendTurn`
     writes R2 **before** calling it. Re-seeding the schema alone converts a
     "no such table" throw into a successful R2 write followed by a 404 — an
     orphan object. The first draft's test double made the metadata write
     succeed unconditionally, so it would have asserted `{ turnIndex: 0,
     replayed: false }` and certified that behaviour as correct. Step 6 now
     adds a liveness check before the R2 write and asserts
     `putCouncilPayload` was never called.
