# Plan 004: Restore LLM Council — every POST currently fails because its rate-limiter binding is not declared anywhere

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   workers/llm-council/cloudflare_handlers.js \
>   workers/llm-council/auth.js \
>   workers/__tests__/cloudflare-council-handlers.test.js \
>   workers/__tests__/llm-council-auth.test.js \
>   wrangler.toml \
>   config/wrangler-cloudflare-native.toml.example \
>   scripts/check_cloudflare_native_target.py \
>   tests/test_cloudflare_native_target.py
> ```
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

`Depends on: none` is deliberate. This is a live production outage fix whose
verification commands (`cd workers && npx vitest run`, `make test-py`,
`make lint`) all work correctly at commit `42826a3` and touch no TypeScript,
so it does not need the verification-gate plans (001–003) to land first. If
one of those plans lands before you start, re-run the drift check above.

## Why this matters

`workers/llm-council/cloudflare_handlers.js` fails **closed** when
`env.RL_COUNCIL_TURN` is missing: `applyRateLimit()` returns
`{ success: false }` and five routes immediately return HTTP 429. But
`RL_COUNCIL_TURN` is a **Cloudflare rate-limiter binding that is declared in no
config file in this repository** — not in `wrangler.toml`, not in the operator
template `config/wrangler-cloudflare-native.toml.example`, and not asserted by
the fail-closed deploy gate `scripts/check_cloudflare_native_target.py`. Unless
the operator's private, out-of-source-control `wrangler.toml` happens to declare
a binding that nothing in the repo ever asked for, `POST /sessions`,
`POST /sessions/{id}/turns`, `POST /sessions/restore`, `POST /run` and
`POST /stream` all return 429 unconditionally, and the LLM Council feature —
one of the app's headline capabilities — is dead in production.

The reason this went unnoticed is that the 429 is a **lie**: a misconfigured
deploy is reported to the user (and to monitoring) as "Rate limit exceeded — try
again shortly", which reads like normal throttling. Every existing Worker test
passes a mock limiter into `env`, so no test ever exercises the unbound path.

After this plan: the binding is declared, the deploy gate refuses to ship a
config without it, a misconfigured deploy returns a distinguishable
`503 rate_limiter_unconfigured` instead of a misleading 429, session deletion
gains the rate limit it was missing, and the vestigial Council session-token
credential stops sharing raw key material with the CSRF signing key.

## Current state

### Files in play

- `workers/llm-council/cloudflare_handlers.js` — production LLM Council route
  dispatcher. Contains `applyRateLimit` (lines 40–45) and the five 429 call
  sites (lines 173–174, 211–212, 294–295, 312–313, 338–339).
- `workers/llm-council/auth.js` — mints and (nominally) verifies the Council
  session token. `mintToken` at line 114; the never-called `verifyToken` at
  line 150.
- `wrangler.toml` — the checked-in production Worker config (97 lines). Has no
  rate-limiter block of any kind.
- `config/wrangler-cloudflare-native.toml.example` — the operator template the
  real deploy config is copied from. Also has no rate-limiter block.
- `scripts/check_cloudflare_native_target.py` — the fail-closed deploy gate.
  `_validate_main()` (lines 131–158) enumerates every required binding; the
  rate limiter is absent from that list.
- `tests/test_cloudflare_native_target.py` — contract tests for that gate.
  `_valid_main()` (lines 19–60) is the "complete operator config" fixture.
- `workers/__tests__/cloudflare-council-handlers.test.js` — Council handler
  tests. Every case passes `RL_COUNCIL_TURN: rateLimiter()`, so the unbound
  path is never exercised.
- `workers/__tests__/llm-council-auth.test.js` — 23 tests for `auth.js`.

### The fail-closed limiter (`workers/llm-council/cloudflare_handlers.js:40-45`)

```js
async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) {
    return { success: false, reason: "rate_limiter_unconfigured" };
  }
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}
```

The `reason` field is never read. All five call sites are byte-identical —
for example `workers/llm-council/cloudflare_handlers.js:173-174`:

```js
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
```

The other four are at lines 211–212 (`handleAddTurn`), 294–295
(`handleRestoreByCode`), 312–313 (`handleLegacyRun`) and 338–339
(`handleStream`). `handleDeleteSession` (lines 277–289) calls `applyRateLimit`
**not at all** — it is the one Council mutation with no rate limiting.

The `errorResponse` helper already supports an error code
(`workers/llm-council/cloudflare_handlers.js:31-33`):

```js
function errorResponse(error, status = 400, code = undefined) {
  return jsonResponse(code ? { error, code } : { error }, status);
}
```

### The binding exists nowhere

`wrangler.toml` at HEAD contains, in order: `[assets]`, three
`[[d1_databases]]`, `[[r2_buckets]]`, `[[vectorize]]`, `[[kv_namespaces]]`,
`[ai]`, two `[[durable_objects.bindings]]`, `[[migrations]]`, two
`[[queues.producers]]`, two `[[queues.consumers]]`, `[[routes]]`, `[vars]`.
The `[ai]` block is `wrangler.toml:49-50`:

```toml
[ai]
binding = "AI"
```

A repo-wide grep for `RL_COUNCIL_TURN` (excluding `node_modules` and `.git`)
finds it only in: the two handler modules, two Worker test files,
`.claude/STATE.md`, and two `.omc/` design notes. Never in a `.toml`.

One of those design notes states the original intent —
`.omc/plans/llm-council-worker-migration.md:304`:

```
| Cost spike | LLM goes wild | Wrangler `[[unsafe.bindings]] RL_COUNCIL_TURN` rate limit (30/min/IP) |
```

That is where the `30/min/IP` figure in Step 1 comes from. (The
`[[unsafe.bindings]]` syntax in that note is outdated — see Step 1.)

### The retired handler failed OPEN — the cutover flipped the default

`workers/llm-council/handlers.js:70-73` (dead module; no live importer — grep
for `llm-council/handlers` finds only its own header and its test file):

```js
async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) return { success: true };
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}
```

**Decision recorded by this plan: keep fail-closed; do not revert to
fail-open.** Every Council POST spends real money — CLAUDE.md documents the
LLM Council as billing through a Cloudflare AI Gateway unified-billing token
(`CF_AIG_TOKEN`), so an unlimited Council endpoint is a direct billing-drain
vector. Fail-closed also matches this repo's stated idiom everywhere else
(`IMMI_CASE_MUTATIONS_ENABLED = "false"`, `PIPELINE_ENABLED = "false"`, and the
gate script's own docstring "Validate operator-supplied Cloudflare-native IMMI
configs, fail closed"). The root cause is the missing binding plus a deploy
gate that never asked for it — **not** the default. Reverting to fail-open would
paper over a config gap and silently delete the only cost control.

### The deploy gate does not require the binding

`scripts/check_cloudflare_native_target.py:151-157` — the full required-binding
list for the main Worker:

```python
    _require_binding(errors, config, "ai", "AI", "main")
    for binding in ("AUTH_NONCE", "COUNCIL_SESSION"):
        _require_binding(errors, config, "durable_objects.bindings", binding, "main", field="name")
    _require_binding(errors, config, "queues.producers", "CASE_MUTATION_QUEUE", "main")
    _require_binding(errors, config, "queues.producers", "PIPELINE_CONTROL_QUEUE", "main")
    _require_queue(errors, config, "immi-case-mutation-queue", "main")
    _require_dlq_consumer(errors, config, "immi-case-mutation-dlq", "main")
```

Note `field="name"` is already supported for the Durable Object case — you will
reuse that pattern. The helper it calls, at lines 66–68:

```python
def _require_binding(errors: list[str], config: dict[str, Any], section: str, binding: str, label: str | None = None, field: str = "binding") -> None:
    if not any(item.get(field) == binding for item in _entries(config, section)):
        errors.append(f"{label or section} must declare binding {binding}")
```

And the placeholder detector at lines 120–128:

```python
def _is_placeholder(value: Any) -> bool:
    return (
        not isinstance(value, str)
        or not value.strip()
        or "REPLACE_WITH_" in value
        or "replace" in value.lower()
        or value.startswith("<")
        or value.startswith("00000000-0000-0000-0000-00000000000")
    )
```

The gate runs in CI against the **operator's private config**, not the
checked-in one — `.github/workflows/deploy-worker.yml:70-73`:

```yaml
      - name: Gate native config and disabled mutation defaults
        run: >-
          python3 scripts/check_cloudflare_native_target.py
          --main-config "$RUNNER_TEMP/immi-native-main.toml"
          --pipeline-config "$RUNNER_TEMP/immi-native-pipeline.toml"
```

This has an operator consequence — see **STOP conditions** and
**Maintenance notes**.

### Council session token shares raw key material with CSRF

`workers/llm-council/auth.js:114-128` (mint) uses `env.CSRF_SECRET` directly:

```js
export async function mintToken(env, sessionId) {
  if (!env || !env.CSRF_SECRET) {
    throw new Error("CSRF_SECRET not configured");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId required");
  }
  const key = await importHmacKey(env.CSRF_SECRET);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sessionId),
  );
  return b64urlEncode(sig);
}
```

`workers/auth/csrf.js:24` signs the double-submit CSRF token with the *same*
raw key material:

```js
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(env.CSRF_SECRET), new TextEncoder().encode(payload));
```

Two unrelated protocols, one raw key. Not exploitable today, but rotation and
compromise are coupled, and the Council token is handed to browsers, which
makes it an HMAC oracle under the CSRF signing key.

### The Council session token is verified nowhere

`workers/llm-council/auth.js:150` declares `verifyToken`. A grep for
`verifyToken` across `workers/`, `frontend/src`, `scripts/` and
`immi_case_downloader/` finds **no live caller** — only
`workers/__tests__/llm-council-auth.test.js` and `auth.js`'s own comments.
Meanwhile `auth.js:141-143` claims an authority the code does not exercise:

```js
 * Returns false (never throws) for any malformed input, missing secret,
 * decode failure, or signature mismatch — callers should treat the boolean
 * as the sole authority.
```

The real authority is JWT + `assertMembership()`:
`workers/llm-council/cloudflare_handlers.js:53-55`

```js
async function requireSessionAuth(request, env) {
  return requireAuth(request, env, verifyJwt);
}
```

And this is a **deliberate, documented decision**, recorded in the retired
module's header at `workers/llm-council/handlers.js:11-12`:

```
 *   transaction wrapper sets `SET LOCAL request.jwt.claims` before any DML
 *   runs. The legacy X-Session-Token HMAC is no longer accepted as a
 *   standalone auth — JWT is the sole gate.
```

So the correct resolution is to **delete** the dead verifier and correct the
docs — not to wire it in, which would contradict that decision (and would break
users after any secret rotation, since stale `localStorage` tokens would start
returning 403). The frontend still needs `session_token` in responses:
`frontend/src/lib/api-llm-council.ts` persists it and `addTurn` throws
client-side without it. `mintToken` therefore stays.

### Repo conventions that apply here

- **Structured logs**: CLAUDE.md — "mutation and auth handlers
  `console.log(JSON.stringify({event, ...}))`". Match that shape for the new
  misconfiguration log. An existing exemplar is
  `workers/llm-council/cloudflare_handlers.js:424`:
  `console.error(JSON.stringify({ event: "council.cloudflare.handler_error", error: err?.message }));`
- **Commit convention**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- **By design — do NOT "fix"**: the placeholder resource IDs in the checked-in
  `wrangler.toml` (real IDs are operator secrets injected only inside the gated
  `workflow_dispatch` of `deploy-worker.yml`); `IMMI_CASE_MUTATIONS_ENABLED`
  and the pipeline flags defaulting to `"false"`.
- **Worker facts**: tenant isolation is app-layer via
  `CloudflareIdentityStore.assertMembership()` — there is no Postgres and no
  RLS. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1
  bindings.
- **Python**: use the repo venv at
  `/Users/d/Developer/Active Projects/IMMI-Case-/.venv`. Never global `pip`.

### Wrangler rate-limit config syntax (verified, do not guess)

The repo pins `wrangler` **4.120.0** (root `package.json` `devDependencies`).
Extracted from `node_modules/wrangler/config-schema.json`
(`definitions.RawConfig.properties.ratelimits`), the array-of-tables is
`[[ratelimits]]` and each entry **requires** exactly `name`, `namespace_id`
and `simple`, where `simple` requires `limit` (number) and `period` — and
`period` is an enum whose **only legal values are `10` and `60`**. The key is
`name`, *not* `binding`. `additionalProperties` is `false`, so no extra keys.

## Commands you will need

Run all of these from `/Users/d/Developer/Active Projects/IMMI-Case-`.

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (all) | `cd workers && npx vitest run` | exit 0, `25 passed (25)` files, 0 failed |
| Worker tests (one file) | `npx vitest run --config workers/vitest.config.js workers/__tests__/<file>` | exit 0, 0 failed |
| Python tests (all) | `make test-py` | `1143 passed, 3 failed, 7 skipped` — the 3 failures are pre-existing and environmental (see note below) |
| Python tests (one file) | `.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q` | `8 passed` |
| Python lint | `make lint` | `All checks passed!` |
| Ruff on in-scope files | `.venv/bin/ruff check tests/test_cloudflare_native_target.py scripts/check_cloudflare_native_target.py` | `All checks passed!` |
| Deploy gate (checked-in config) | `.venv/bin/python scripts/check_cloudflare_native_target.py` | exit 1 with exactly 6 placeholder errors — see note below |
| Parse `wrangler.toml` | `.venv/bin/python -c "import tomllib,pathlib;print(tomllib.loads(pathlib.Path('wrangler.toml').read_text())['ratelimits'])"` | prints the ratelimits list |

**Note on the 3 Python failures**: at commit `42826a3`, `make test-py` reports
`1141 passed, 3 failed, 7 skipped`. All 3 failures are in
`tests/test_backfill_judge_overrides_from_pdf.py` and are caused by a Homebrew
Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf` import.
They are environmental, are **not** caused by repo code, and are **not** this
plan's problem. Do not attempt to fix them. Your target after this plan is
`1143 passed, 3 failed, 7 skipped` (+2 from Step 4).

**Note on the deploy gate**: `scripts/check_cloudflare_native_target.py` is
**expected to exit 1** against the checked-in configs. At commit `42826a3` it
prints exactly these six errors, all about placeholder resource IDs:

```
Cloudflare-native IMMI deploy blocked:
- d1_databases[IMMI_CATALOG_DB].database_id is missing or still a placeholder
- d1_databases[IMMI_ACCOUNT_DB].database_id is missing or still a placeholder
- d1_databases[IMMI_OPS_DB].database_id is missing or still a placeholder
- d1_databases[IMMI_CATALOG_DB].database_id is missing or still a placeholder
- d1_databases[IMMI_OPS_DB].database_id is missing or still a placeholder
- kv_namespaces[PIPELINE_KV].id is missing or still a placeholder
```

That is by design (the real IDs are operator secrets). **After this plan the
error list must still be exactly these six** — the new rate-limiter assertion
must be satisfied by the block you add in Step 1, not add a seventh line.

## Scope

**In scope** (the only files you may modify):

- `wrangler.toml` — add the `[[ratelimits]]` block (Step 1)
- `config/wrangler-cloudflare-native.toml.example` — same block, so an operator
  copying the template produces a config the gate accepts (Step 1)
- `workers/llm-council/cloudflare_handlers.js` — distinguish
  unconfigured-vs-throttled; rate-limit `handleDeleteSession` (Steps 2–3)
- `scripts/check_cloudflare_native_target.py` — assert the binding (Step 4)
- `tests/test_cloudflare_native_target.py` — fixture + 2 new tests (Step 4)
- `workers/__tests__/cloudflare-council-handlers.test.js` — 3 new tests (Step 5)
- `workers/llm-council/auth.js` — purpose-separated key; delete dead verifier
  (Step 6)
- `workers/__tests__/llm-council-auth.test.js` — drop tests for the deleted
  function; add 2 purpose-separation tests (Step 6)
- `plans/004-fix-council-429-outage.md` — this file, status only

`tests/test_cloudflare_native_target.py`, `workers/__tests__/llm-council-auth.test.js`
and `workers/__tests__/cloudflare-council-handlers.test.js` are included because
they are the dedicated test files for source files this plan already owns —
they cannot be separated from those edits.

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/lib/api-llm-council.ts`,
  `frontend/src/components/llm-council/StreamingCouncilView.tsx` — these
  deliberately send no CSRF token (`api-llm-council.ts:120`:
  `// Core fetch helper (no CSRF — Worker uses HMAC token auth, not Flask CSRF)`).
  Do not add CSRF enforcement to Council routes in this plan; see
  **Findings reconsidered**.
- `workers/auth/csrf.js` — the malformed-token-throws-503 defect is real but
  lives outside this plan's file territory; see **Findings reconsidered**.
- `workers/auth/cloudflare_handlers.js` and `workers/cloudflare-native.js` —
  rate limiting the bootstrap/telegram/export routes is a separate change; see
  **Maintenance notes**.
- `workers/llm-council/handlers.js` and
  `workers/__tests__/llm-council-handlers.test.js` — the retired pre-cutover
  module. It has no live importer. Leave both exactly as they are.
- `workers/llm-council/runner.js`, `retrieval.js`, `session_do.js` — untouched.
- The placeholder resource IDs in `wrangler.toml`, and the `"false"` defaults
  for `IMMI_CASE_MUTATIONS_ENABLED` / `PIPELINE_ENABLED` — by design.
- Anything under `.omc/` or `.claude/`.

## Git workflow

- Branch: `git switch -c advisor/004-fix-council-429-outage`
- One commit per step, or one per logical unit. Message style is conventional
  commits: `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Suggested messages:
  - Step 1: `fix: declare the RL_COUNCIL_TURN rate-limiter binding`
  - Steps 2–3: `fix: distinguish an unconfigured Council rate limiter from a throttled caller`
  - Step 4: `ci: make the native config gate require the Council rate limiter`
  - Step 5: `test: cover the unbound Council rate-limiter path`
  - Step 6: `refactor: derive the Council session-token key separately from CSRF`
- No AI attribution / co-author lines.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

## Steps

### Step 1: Declare the `RL_COUNCIL_TURN` rate-limiter binding

In `wrangler.toml`, insert this block immediately **after** the `[ai]` block
(currently lines 49–50) and **before** the first
`[[durable_objects.bindings]]`:

```toml
# Council routes fail closed without this binding (see
# workers/llm-council/cloudflare_handlers.js applyRateLimit): every Council POST
# spends paid CF AI Gateway credit, so "no limiter" must never mean "unlimited".
# 30 requests / 60s / IP. `period` accepts only 10 or 60.
[[ratelimits]]
name = "RL_COUNCIL_TURN"
namespace_id = "1001"
simple = { limit = 30, period = 60 }
```

Add the **same block** to `config/wrangler-cloudflare-native.toml.example`,
after its `[ai]` block (currently lines 36–37) and before the first
`[[durable_objects.bindings]]`. Keep `namespace_id = "1001"` there too — it is
a Worker-local integer label, not a secret and not an account resource ID, so
it is not a placeholder that needs replacing.

Do not change anything else in either file.

**Verify (a)** — the block parses and has the right shape:

```bash
.venv/bin/python -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('wrangler.toml').read_text()); print(c['ratelimits'])"
```
→ `[{'name': 'RL_COUNCIL_TURN', 'namespace_id': '1001', 'simple': {'limit': 30, 'period': 60}}]`

**Verify (b)** — the template got the same block:

```bash
.venv/bin/python -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('config/wrangler-cloudflare-native.toml.example').read_text()); print(c['ratelimits'])"
```
→ `[{'name': 'RL_COUNCIL_TURN', 'namespace_id': '1001', 'simple': {'limit': 30, 'period': 60}}]`

**Verify (c)** — the gate's error list is unchanged (still exactly the 6
placeholder errors; in particular no `forbidden legacy key` error):

```bash
.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c '^- '
```
→ `6`

### Step 2: Make a missing limiter binding diagnosable instead of a fake 429

In `workers/llm-council/cloudflare_handlers.js`, replace `applyRateLimit`
(lines 40–45) with the version below and add the new `rateLimitFailure` helper
directly beneath it:

```js
async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) {
    // Fail closed on purpose: every Council POST spends paid CF AI Gateway
    // credit, so a missing limiter must never degrade to "unlimited". The
    // binding is declared in wrangler.toml and enforced by
    // scripts/check_cloudflare_native_target.py.
    console.error(JSON.stringify({ event: "council.rate_limiter_unconfigured" }));
    return { success: false, reason: "rate_limiter_unconfigured" };
  }
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}

// A misconfigured deploy must not masquerade as an over-eager user: 503 tells
// the operator the binding is missing, 429 tells the caller to slow down.
function rateLimitFailure(limited) {
  return limited.reason === "rate_limiter_unconfigured"
    ? errorResponse("LLM Council is misconfigured: rate limiter binding missing", 503, "rate_limiter_unconfigured")
    : errorResponse("Rate limit exceeded — try again shortly", 429, "rate_limited");
}
```

Then replace **all five** existing call sites — currently at lines 174, 212,
295, 313 and 339, each reading exactly:

```js
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
```

with:

```js
  if (!limited.success) return rateLimitFailure(limited);
```

Leave the `const limited = await applyRateLimit(request, env);` lines above
each of them untouched.

**Verify (a)** — no old-style call site survives:

```bash
grep -c 'errorResponse("Rate limit exceeded — try again shortly", 429)' workers/llm-council/cloudflare_handlers.js
```
→ `0`

**Verify (b)** — five call sites now use the helper:

```bash
grep -c 'return rateLimitFailure(limited);' workers/llm-council/cloudflare_handlers.js
```
→ `5`

**Verify (c)** — nothing regressed:

```bash
cd workers && npx vitest run
```
→ exit 0, `Test Files 25 passed (25)`, `Tests 345 passed (345)`

### Step 3: Rate-limit session deletion

`handleDeleteSession` (`workers/llm-council/cloudflare_handlers.js:277-289`) is
the only Council mutation with no rate limiting. Add the same two lines the
other handlers use, immediately after the `SESSION_ID_RE` guard and before
`councilStoresForClaims`, so the function begins:

```js
async function handleDeleteSession(request, env, sessionId) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  if (!SESSION_ID_RE.test(sessionId)) return errorResponse("session_id missing from path", 400);
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return rateLimitFailure(limited);
  const { auth } = await councilStoresForClaims(env, authResult.claims);
```

Leave the rest of the function unchanged.

**Verify (a)** — six call sites now:

```bash
grep -c 'return rateLimitFailure(limited);' workers/llm-council/cloudflare_handlers.js
```
→ `6`

**Verify (b)**:

```bash
cd workers && npx vitest run
```
→ exit 0, `Test Files 25 passed (25)`, `Tests 345 passed (345)`

### Step 4: Make the deploy gate require the binding

In `scripts/check_cloudflare_native_target.py`, inside `_validate_main`, insert
the following immediately **after** the `_require_binding(errors, config, "ai", "AI", "main")`
line (currently line 151) and before the `for binding in ("AUTH_NONCE", "COUNCIL_SESSION"):`
loop:

```python
    council_limiter = next(
        (item for item in _entries(config, "ratelimits") if item.get("name") == "RL_COUNCIL_TURN"),
        None,
    )
    if council_limiter is None:
        errors.append(
            "main must declare ratelimits binding RL_COUNCIL_TURN "
            "(every Council POST route fails closed without it)"
        )
    else:
        if _is_placeholder(council_limiter.get("namespace_id")):
            errors.append("ratelimits[RL_COUNCIL_TURN].namespace_id is missing or still a placeholder")
        simple = council_limiter.get("simple")
        if (
            not isinstance(simple, dict)
            or not isinstance(simple.get("limit"), int)
            or simple.get("period") not in (10, 60)
        ):
            errors.append(
                "ratelimits[RL_COUNCIL_TURN].simple must set an integer limit "
                "and a period of 10 or 60"
            )
```

Then update `tests/test_cloudflare_native_target.py`:

1. In `_valid_main()` (lines 19–60), add these four lines to the fixture
   string, immediately after the `[[ai]]` / `binding = "AI"` pair (lines
   41–42) — otherwise `test_operator_configs_pass_when_complete` will fail:

```
[[ratelimits]]
name = "RL_COUNCIL_TURN"
namespace_id = "1001"
simple = { limit = 30, period = 60 }
```

2. Add two new tests at the end of the file, modelled on the existing
   `test_operator_gate_requires_runtime_bindings_and_queue_dlq` (lines
   148–157), which writes a mutated `_valid_main()` into `tmp_path` and asserts
   the resulting error list:

- `test_operator_gate_requires_council_rate_limiter` — write
  `_valid_main().replace('name = "RL_COUNCIL_TURN"', 'name = "RL_SOMETHING_ELSE"')`
  plus a valid pipeline config; assert the gate returns a non-zero result and
  that some error contains `"RL_COUNCIL_TURN"`.
- `test_operator_gate_rejects_invalid_council_rate_limit_window` — write
  `_valid_main().replace("period = 60", "period = 30")`; assert some error
  contains `"period of 10 or 60"`.

Read lines 148–157 of that file first and copy its exact call/assert mechanics
(how it invokes `MODULE`, how it collects `errors`) rather than inventing a new
harness.

**Verify (a)** — file-level tests:

```bash
.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q 2>&1 | tail -1
```
→ `8 passed` (was 6)

**Verify (b)** — the assertion really fires when the binding is removed:

```bash
grep -v 'RL_COUNCIL_TURN' wrangler.toml > /tmp/immi-no-rl.toml && \
.venv/bin/python scripts/check_cloudflare_native_target.py --main-config /tmp/immi-no-rl.toml 2>&1 | grep -c 'RL_COUNCIL_TURN'
```
→ `1`

**Verify (c)** — and does *not* fire on the real config (still exactly 6
errors, none about the limiter):

```bash
.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c '^- '
```
→ `6`

```bash
.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c 'RL_COUNCIL_TURN'
```
→ `0`

**Verify (d)** — lint clean:

```bash
make lint
```
→ `All checks passed!`

### Step 5: Cover the unbound-limiter path in Worker tests

In `workers/__tests__/cloudflare-council-handlers.test.js`, add exactly three
tests inside the existing `describe("Cloudflare-native Council handlers", ...)`
block. Reuse the file's existing `request()`, `stores()` and `rateLimiter()`
helpers (lines 34–63) — do not write new ones.

Note the existing `request(method, path, body)` helper sends
`Authorization: Bearer valid`, and `beforeEach` already makes
`mockRequireAuth` resolve to `{ claims: CLAIMS }`, so auth passes and the
rate-limit branch is reached.

1. **`fails closed with 503 rate_limiter_unconfigured on every rate-limited route when the binding is absent`**
   — loop over the six rate-limited routes, calling `dispatchCloudflareCouncil`
   with an env of `{ IMMI_STORAGE_MODE: "cloudflare", CSRF_SECRET: "secret" }`
   (**no** `RL_COUNCIL_TURN`). For each, assert `response.status === 503` and
   `(await response.json()).code === "rate_limiter_unconfigured"`. The six
   routes and methods are:
   - `POST /api/v1/llm-council/sessions`
   - `POST /api/v1/llm-council/sessions/${SESSION_ID}/turns`
   - `POST /api/v1/llm-council/sessions/restore`
   - `POST /api/v1/llm-council/run`
   - `POST /api/v1/llm-council/stream`
   - `DELETE /api/v1/llm-council/sessions/${SESSION_ID}`

   Give POST bodies that pass validation: `{ message: "x" }` for sessions,
   turns and stream; `{ code: "ABCDEF" }` for restore; `{ question: "x" }` for
   run; no body for the DELETE.

2. **`returns 429 rate_limited when the configured limiter rejects the caller`**
   — pass `RL_COUNCIL_TURN: { limit: vi.fn(async () => ({ success: false })) }`
   and `POST /api/v1/llm-council/sessions`; assert status `429` and
   `code === "rate_limited"`.

3. **`rate-limits session deletion`** — pass a passing `rateLimiter()`, issue
   `DELETE /api/v1/llm-council/sessions/${SESSION_ID}`, and assert the
   limiter's `limit` mock was called once and the response status is `200`.
   Capture the limiter in a local `const rl = rateLimiter();` so you can assert
   `expect(rl.limit).toHaveBeenCalledTimes(1)`.

**Verify (a)**:

```bash
npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js 2>&1 | grep 'Tests '
```
→ `Tests  11 passed (11)` (was 8)

**Verify (b)** — these tests must fail without Steps 2–3. Temporarily revert
just the `rateLimitFailure` helper's 503 branch to always return the 429 form,
re-run the command above, confirm test 1 fails, then restore the correct code
and re-run to green. Do not commit the temporary revert.

**Verify (c)**:

```bash
cd workers && npx vitest run
```
→ exit 0, `Test Files 25 passed (25)`, `Tests 348 passed (348)`

### Step 6: Separate the Council token key from CSRF, and delete the dead verifier

In `workers/llm-council/auth.js`:

1. **Add** a purpose-separated key derivation. HMAC-as-KDF with a fixed label
   means no new operator secret is required. Place it where `importHmacKey`
   currently sits (lines 56–69) and **delete `importHmacKey`**:

```js
// Purpose separation: the Council session token and the double-submit CSRF
// token both derive from CSRF_SECRET, but must never share raw key material —
// otherwise a compromise or rotation of one protocol silently couples to the
// other. HMAC with a fixed label is a KDF here, not an authentication step.
const COUNCIL_TOKEN_LABEL = "immi-council-session-token/v1";

/**
 * Derive the Council-session signing key from the base secret.
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
async function importCouncilTokenKey(secret) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    base,
    new TextEncoder().encode(COUNCIL_TOKEN_LABEL),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
```

2. In `mintToken` (line 114), change the one line
   `const key = await importHmacKey(env.CSRF_SECRET);` to
   `const key = await importCouncilTokenKey(env.CSRF_SECRET);`. Leave the rest
   of `mintToken` — including both `throw`s and the `b64urlEncode` return —
   exactly as it is.

3. **Delete** the entire `verifyToken` function and its banner comment
   (currently lines 130–183), and delete `b64urlDecode` (lines 35–50), which
   was only used by it. Keep `b64urlEncode`, `nanoid21` and `mintToken`.

4. **Correct the module docstring** (lines 1–16). The current text describes a
   verification discipline that no longer exists. Replace the
   "Constant-time comparison" and "Stateless" paragraphs with an accurate
   statement, e.g.:

```
 * AUTHORITY: this token is NOT an authentication credential. Access to every
 * Council route is gated by JWT + CloudflareIdentityStore.assertMembership()
 * (see workers/llm-council/cloudflare_handlers.js requireSessionAuth). The
 * token is an opaque per-session handle the SPA stores in localStorage and
 * echoes back as X-Session-Token; the Worker does not read it. Do not
 * reintroduce a verifier without first changing that documented auth model.
 *
 * NOTE: never log token values.
```

Then update `workers/__tests__/llm-council-auth.test.js`:

5. Change the import on line 14 from
   `import { mintToken, verifyToken, nanoid21 } from "../llm-council/auth.js";`
   to `import { mintToken, nanoid21 } from "../llm-council/auth.js";`.
6. Delete the two `verifyToken` describe blocks (`verifyToken — happy path`
   and `verifyToken — rejection paths`, lines 94–188 inclusive of their banner
   comments) — 13 tests. Keep the `nanoid21` (3 tests) and `mintToken`
   (7 tests) blocks untouched.
7. Add a new `describe("mintToken — key purpose separation", ...)` with two
   tests:
   - **`does not sign with the raw CSRF_SECRET`** — compute the raw-key HMAC
     inline in the test (`crypto.subtle.importKey` on
     `new TextEncoder().encode(FAKE_ENV.CSRF_SECRET)`, sign `SESSION_ID`,
     base64url-encode it the same way `auth.js` does) and assert
     `await mintToken(FAKE_ENV, SESSION_ID)` is **not equal** to it. This is
     the test that proves the separation and fails if someone reverts to
     `importHmacKey`.
   - **`is stable for a given secret and sessionId`** — assert
     `await mintToken(FAKE_ENV, SESSION_ID)` equals a hard-coded expected
     base64url string. Generate that constant by running `mintToken` once after
     the change and pasting the value, so any future change to
     `COUNCIL_TOKEN_LABEL` or the derivation breaks the test loudly.

**Verify (a)** — the dead verifier is gone:

```bash
grep -c 'verifyToken' workers/llm-council/auth.js workers/__tests__/llm-council-auth.test.js
```
→ `workers/llm-council/auth.js:0` and
`workers/__tests__/llm-council-auth.test.js:0`

**Verify (b)** — no live caller was broken:

```bash
grep -rn 'verifyToken' workers/ frontend/src --include=*.js --include=*.ts --include=*.tsx | grep -v node_modules
```
→ no output

**Verify (c)** — `importHmacKey` and `b64urlDecode` are gone from this module
only (they still legitimately exist in `workers/auth/csrf.js`; do not touch
that file):

```bash
grep -c 'importHmacKey\|b64urlDecode' workers/llm-council/auth.js
```
→ `0`

**Verify (d)**:

```bash
npx vitest run --config workers/vitest.config.js workers/__tests__/llm-council-auth.test.js 2>&1 | grep 'Tests '
```
→ `Tests  12 passed (12)` (was 23: 13 `verifyToken` tests removed, 2 added)

**Verify (e)** — full Worker suite:

```bash
cd workers && npx vitest run
```
→ exit 0, `Test Files 25 passed (25)`, `Tests 337 passed (337)`

## Test plan

**New tests — `tests/test_cloudflare_native_target.py`** (model after the
existing `test_operator_gate_requires_runtime_bindings_and_queue_dlq`, lines
148–157):

- `test_operator_gate_requires_council_rate_limiter` — a complete operator
  config missing the `RL_COUNCIL_TURN` name is blocked, and the error text
  names the binding. This is the regression test for the outage: it is the
  check that would have caught the original omission at deploy time.
- `test_operator_gate_rejects_invalid_council_rate_limit_window` — `period = 30`
  (illegal per the wrangler schema, which allows only 10 or 60) is blocked.

Also required: `_valid_main()` gains the `[[ratelimits]]` block so
`test_operator_configs_pass_when_complete` keeps passing — treat a failure
there as a signal you forgot the fixture update, not as a reason to weaken the
gate.

**New tests — `workers/__tests__/cloudflare-council-handlers.test.js`** (model
after the existing cases in the same `describe`, which already build env
objects inline):

- Unbound binding → `503` + `code: "rate_limiter_unconfigured"` on all six
  rate-limited routes (create, add-turn, restore, run, stream, delete). This is
  the direct regression test for the production symptom.
- Configured limiter that rejects → `429` + `code: "rate_limited"`.
- `DELETE /sessions/{id}` consults the limiter at all (it did not before).

**New tests — `workers/__tests__/llm-council-auth.test.js`**:

- `mintToken` output ≠ raw-`CSRF_SECRET` HMAC of the same session id
  (purpose separation actually happened).
- `mintToken` output is stable against a pinned expected value (derivation
  changes cannot land silently).

**Existing tests that must keep passing unchanged**: the 8 current Council
handler tests, the 3 `nanoid21` and 7 `mintToken` tests, and the other 6
gate-contract tests.

**Full-suite verification**:

```bash
cd workers && npx vitest run     # 25 files, 337 tests, exit 0
make test-py                     # 1143 passed, 3 failed (environmental), 7 skipped
make lint                        # All checks passed!
```

No frontend files change, so `cd frontend && npx vitest run` (490 passed) and
`cd frontend && npx tsc -b --noEmit` (exit 0) should be unaffected. Run them
once at the end as a sanity check.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.venv/bin/python -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('wrangler.toml').read_text()); print(c['ratelimits'][0])"` prints `{'name': 'RL_COUNCIL_TURN', 'namespace_id': '1001', 'simple': {'limit': 30, 'period': 60}}`
- [ ] `.venv/bin/python -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('config/wrangler-cloudflare-native.toml.example').read_text()); print(c['ratelimits'][0]['name'])"` prints `RL_COUNCIL_TURN`
- [ ] `grep -v 'RL_COUNCIL_TURN' wrangler.toml > /tmp/immi-no-rl.toml && .venv/bin/python scripts/check_cloudflare_native_target.py --main-config /tmp/immi-no-rl.toml 2>&1 | grep -c 'RL_COUNCIL_TURN'` returns `1`
- [ ] `.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c '^- '` returns `6` (unchanged from HEAD)
- [ ] `grep -c 'errorResponse("Rate limit exceeded — try again shortly", 429)' workers/llm-council/cloudflare_handlers.js` returns `0`
- [ ] `grep -c 'return rateLimitFailure(limited);' workers/llm-council/cloudflare_handlers.js` returns `6`
- [ ] `grep -c 'verifyToken' workers/llm-council/auth.js` returns `0`
- [ ] `grep -rn 'verifyToken' workers/ frontend/src --include=*.js --include=*.ts --include=*.tsx | grep -v node_modules` returns no output
- [ ] `grep -c 'importCouncilTokenKey' workers/llm-council/auth.js` returns `2` or more
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js` reports `11 passed`
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/llm-council-auth.test.js` reports `12 passed`
- [ ] `cd workers && npx vitest run` exits 0 with `Test Files 25 passed (25)` and `Tests 337 passed (337)`
- [ ] `.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q` reports `8 passed`
- [ ] `make test-py` reports `1143 passed, 3 failed, 7 skipped` — and the 3 failures are all in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `make lint` prints `All checks passed!`
- [ ] `cd frontend && npx vitest run` reports `490 passed` and `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `git status --short` lists only files from the "In scope" list
- [ ] Nothing was pushed and no PR was opened (`git log origin/main..HEAD` shows your commits are local only)

## STOP conditions

Stop and report back (do not improvise) if:

- **The drift check is non-empty.** Any of the eight in-scope files changed
  since `42826a3`; the line numbers and excerpts in "Current state" are then
  unreliable.
- **`applyRateLimit` at `workers/llm-council/cloudflare_handlers.js:40-45` is
  not byte-identical to the excerpt in "Current state"** — in particular, if it
  already returns `{ success: true }` when the binding is absent, someone has
  flipped the default to fail-open since this plan was written, and the whole
  premise (and the Step 2 design) needs re-deciding before you touch anything.
- **`grep -rn 'verifyToken' workers/ frontend/src` finds a live caller** before
  Step 6. The plan deletes that function on the verified basis that it has
  none. If one exists, deleting it is a real behaviour change — stop.
- **A rate-limiter binding already exists in `wrangler.toml`** under any name
  or syntax (`[[ratelimits]]`, `[[unsafe.bindings]]`, anything else). Do not
  add a second one; report what you found.
- **`.venv/bin/python scripts/check_cloudflare_native_target.py` gains a
  seventh error line after Step 1 or Step 4**, or the wording of the existing
  six changes. That means the new assertion or the new TOML block is wrong,
  not that the config is.
- **`make test-py` shows more than 3 failures, or a failure outside
  `tests/test_backfill_judge_overrides_from_pdf.py`.** The 3 known failures are
  a Homebrew `pyexpat`/`libexpat` ABI problem, unrelated to this work; anything
  else is yours.
- **Any verification fails twice after a reasonable fix attempt.**
- **The fix appears to require editing a file on the "Out of scope" list** —
  especially `workers/auth/csrf.js` or anything under `frontend/`.
- **You conclude the fail-closed default should be reverted to fail-open.**
  That decision was made deliberately in this plan (see "Current state"); it is
  an operator/architecture call, not an executor call. Report your reasoning
  and stop.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **⚠️ This change requires an operator action before the next deploy.**
  `.github/workflows/deploy-worker.yml:70-73` runs the gate against
  `$RUNNER_TEMP/immi-native-main.toml`, which is decoded from an operator-held
  secret — **not** the checked-in `wrangler.toml`. After Step 4, that private
  config must also contain the `[[ratelimits]] RL_COUNCIL_TURN` block or the
  deploy will be blocked. That is the intended fail-closed behaviour, but the
  operator must be told before they next run the workflow. Flag this
  explicitly in the PR description.
- **`namespace_id = "1001"`** is a Worker-local integer label chosen by the
  developer, unique within this Worker. It is not an account resource ID and
  not a secret. If a second rate limiter is ever added, give it a different
  `namespace_id`.
- **`period` accepts only `10` or `60`** per the wrangler 4.120.0 config
  schema. The gate now enforces this, so a typo fails at gate time rather than
  at `wrangler deploy`.
- **Deferred out of this plan — rate limiting the auth and export surfaces.**
  `handleBootstrapLogin` (`workers/auth/cloudflare_handlers.js:164-193`)
  constant-time-compares `BOOTSTRAP_ADMIN_SECRET` and mints an access+refresh
  pair on a hit, with no throttle, nonce or lockout — the only guard is the 503
  at lines 165–167 when the secret is unset. `dispatchAuth`
  (`workers/cloudflare-native.js:167-189`) applies no throttling to
  `/api/v1/auth/telegram` or any other auth route either. A follow-up plan
  should add an IP-keyed limiter (a second `[[ratelimits]]` binding, e.g.
  `RL_AUTH_IP`) to `/api/v1/auth/bootstrap` and `/api/v1/auth/telegram`, with a
  low ceiling and a failed-attempt structured log event on bootstrap. Until
  then, treat `BOOTSTRAP_ADMIN_SECRET` as break-glass only and leave it unset
  outside recovery windows — it already 503s when unset. This was left out here
  solely because those files are outside this plan's territory, not because it
  is unimportant.
- **Deferred out of this plan — malformed CSRF tokens surface as 503.** In
  `workers/auth/csrf.js:44`,
  `const payload = new TextDecoder().decode(b64urlDecode(payloadB64));` sits
  outside any try/catch, and `b64urlDecode` (lines 9–13) calls `atob`, which
  throws on non-base64url input. A client controls both the `X-CSRFToken`
  header and the `__Host-csrf` cookie, so it can satisfy the equality check at
  line 39 with a matching-but-malformed pair and force the throw; callers'
  outer catches (`workers/case-api/cloudflare_mutations.js:314-318`,
  `workers/pipeline/control_handlers.js:129-133`) turn it into a 503. It should
  be the 403 the function returns for every other failure. Not exploitable, but
  it pollutes monitoring with fake server faults. `workers/llm-council/auth.js`
  already documents its own decode as throwing and wraps it — copy that
  discipline. Out of scope here only because `workers/auth/csrf.js` is not this
  plan's file territory.
- **Deferred — CSRF on Council routes.** See "Findings reconsidered" below;
  this needs a coordinated frontend + Worker change and cannot be done
  Worker-side alone.
- **What a reviewer should scrutinise**: (1) that the 503-vs-429 split really
  is keyed on `reason` and not on anything attacker-controlled; (2) that
  `_valid_main()` in `tests/test_cloudflare_native_target.py` was updated in
  the *same* commit as the gate assertion, so the gate is never briefly
  self-contradicting; (3) that deleting `verifyToken` did not also delete the
  `mintToken` tests, which are the only remaining coverage of the token path;
  (4) the pinned expected token value in the new stability test — confirm it
  was generated from the new derivation, not copied from the old one.
- **Future interaction**: if anyone ever decides the Council session token
  *should* gate access, they must first change the auth model documented at
  `workers/llm-council/handlers.js:11-12` ("The legacy X-Session-Token HMAC is
  no longer accepted as a standalone auth — JWT is the sole gate"), and they
  must handle the rotation footgun — the SPA caches tokens in `localStorage`
  under `llm-council-token-${sessionId}`, so any change to `CSRF_SECRET` or to
  `COUNCIL_TOKEN_LABEL` would start 403-ing existing users.

## Findings reconsidered

- **SEC-06 (LLM Council state-changing routes skip CSRF verification) —
  correct diagnosis, wrong fix; dropped from the steps.** The absence is real
  and I verified it: `grep -n verifyCsrf workers/llm-council/cloudflare_handlers.js`
  returns nothing, while `workers/case-api/cloudflare_actions.js:42`,
  `workers/case-api/cloudflare_mutations.js:65` and
  `workers/pipeline/control_handlers.js:46` all call it first thing. **But the
  proposed fix would take the feature from broken to differently broken.** The
  SPA's Council client deliberately sends no CSRF token —
  `frontend/src/lib/api-llm-council.ts:120` reads
  `// Core fetch helper (no CSRF — Worker uses HMAC token auth, not Flask CSRF)`,
  and its `councilFetch` (lines 140–182) sets only `Content-Type` plus an
  optional `X-Session-Token`; `StreamingCouncilView.tsx:232` likewise POSTs to
  `/api/v1/llm-council/stream` with only `Content-Type`. Adding `verifyCsrf`
  Worker-side would 403 every Council create/turn/restore/run/stream/delete.
  Fixing it properly means changing the frontend client at the same time —
  outside this plan's file territory, and a change that must be shipped
  atomically with the Worker side or the feature breaks between deploys.
  Mitigating context that makes deferring safe: the `immi_access` cookie is
  `SameSite=Lax` (`workers/auth/cloudflare_handlers.js:37`), which already
  blocks cross-site fetch/XHR of any method, so this is defence-in-depth
  erosion rather than a live hole. **Partial mitigation shipped here anyway**:
  Step 3 adds a rate limit to `DELETE /sessions/{id}`, which the verifier
  identified as the only currently-reachable unprotected Council mutation
  (every other one already fails closed at `applyRateLimit`). Full fix
  deferred and recorded in "Maintenance notes".

- **SEC-09 (no effective rate limiting anywhere, including the bootstrap
  secret check) — split; the Council half is fixed here, the auth half is
  deferred.** I verified both halves. The Council half *is* the outage and is
  fixed by Steps 1–4. The auth half —
  `handleBootstrapLogin` at `workers/auth/cloudflare_handlers.js:164-193` with
  no throttle, and `dispatchAuth` at `workers/cloudflare-native.js:167-189`
  with none either — is real but lives in files outside this plan's territory,
  so it is written up with a concrete recipe under "Maintenance notes" instead
  of being half-done here. Note that Step 1 unblocks it: the follow-up now only
  needs handler edits plus one more `[[ratelimits]]` entry, since the config
  shape and the gate pattern already exist.

- **SEC-15 (CSRF_SECRET reused for Council tokens; malformed CSRF surfaces as
  503) — split; key reuse fixed here, the 503 deferred.** Evidence correction:
  the finding cited `workers/llm-council/auth.js:3`, which is the module
  docstring line `* Token shape:  base64url(HMAC-SHA256(env.CSRF_SECRET, sessionId))`
  (actually line 4). The load-bearing line — where the key material is actually
  used — is `workers/llm-council/auth.js:121`,
  `const key = await importHmacKey(env.CSRF_SECRET);` inside `mintToken`. Step 6
  fixes that with HMAC-as-KDF purpose separation rather than a new
  `COUNCIL_TOKEN_SECRET`, because a new secret would require an operator action
  and a `scripts/preflight_secrets.sh` change for no additional security. The
  malformed-token-503 half at `workers/auth/csrf.js:44` is confirmed
  (verified: line 44 is outside any try/catch, `b64urlDecode` at lines 9–13
  calls `atob`) but is deferred — see "Maintenance notes".

- **JSCORR-25 (Council session tokens minted but never verified) — confirmed,
  resolved by deletion rather than by wiring it in.** Verified: `verifyToken`
  at `workers/llm-council/auth.js:150` has zero live callers; a grep across
  `workers/`, `frontend/src`, `scripts/` and `immi_case_downloader/` finds it
  only in `workers/__tests__/llm-council-auth.test.js`. The finding offers two
  options; I chose deletion for three reasons, none of which were in the
  finding: (1) wiring it in would contradict a deliberate, documented decision
  — `workers/llm-council/handlers.js:11-12` states "The legacy X-Session-Token
  HMAC is no longer accepted as a standalone auth — JWT is the sole gate";
  (2) verifying it would create a rotation footgun, since the SPA caches tokens
  in `localStorage` (`api-llm-council.ts:93`, `TOKEN_KEY`) and any
  `CSRF_SECRET` rotation would start 403-ing existing users — and SEC-15's
  key-separation change in Step 6 alters the derivation, so the two fixes
  together would trigger exactly that on one deploy; (3) the finding's own
  option (a) also suggests dropping `session_token` from responses, which is
  **not** safe: `frontend/src/lib/api-llm-council.ts` persists it and `addTurn`
  throws client-side without it. So `mintToken` and `session_token` stay;
  only the never-called verifier and its now-inaccurate docstring go.
