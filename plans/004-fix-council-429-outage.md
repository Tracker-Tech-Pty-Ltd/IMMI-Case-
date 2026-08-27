# Plan 004: Restore LLM Council — every POST currently fails because its rate-limiter binding is not declared anywhere

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)** — all four commands, in order. The first sees
> committed history; the last three see the working tree, which committed
> history cannot show. An executor who starts from a dirty tree gets a false
> all-clear from the first command alone.
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS="workers/llm-council/cloudflare_handlers.js
>   workers/llm-council/auth.js
>   workers/__tests__/cloudflare-council-handlers.test.js
>   workers/__tests__/llm-council-auth.test.js
>   wrangler.toml
>   config/wrangler-cloudflare-native.toml.example
>   scripts/check_cloudflare_native_target.py
>   tests/test_cloudflare_native_target.py"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS   # committed since the plan was written
> git diff --stat -- $PATHS                 # unstaged working-tree edits
> git diff --cached --stat -- $PATHS        # staged but uncommitted edits
> ```
> Expected: the last three commands print nothing, and `git status --short`
> lists no in-scope path. If any in-scope file appears in **any** of them,
> that is a STOP condition — compare the "Current state" excerpts below
> against the live code and report before proceeding.
>
> **Never** run `git checkout --`, `git restore` or `git clean` to "clear" a
> dirty tree. Those edits may be the operator's uncommitted work. Report and
> stop instead.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Runs before**: `plans/005-*.md` (both edit
  `workers/llm-council/cloudflare_handlers.js`; see "Sequencing" below)
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

`Depends on: none` is deliberate. This is a live production outage fix whose
verification commands (`cd workers && npx vitest run`, `make test-py`,
`make lint`) all work correctly at commit `42826a3` and touch no TypeScript,
so it does not need the verification-gate plans (001–003) to land first. If
one of those plans lands before you start, re-run the drift check above.

### Sequencing (cross-plan)

`plans/005-*.md` edits the same file — `workers/llm-council/cloudflare_handlers.js`
— in its Steps 2, 4 and 5 (the dispatcher `await`s, the stream persist guard,
and the retrieve-code collision predicate). **This plan lands first**: it is the
outage hotfix and its edits (`applyRateLimit`, `rateLimitFailure`, the six call
sites, `handleDeleteSession`, `handleHealth`) are disjoint from 005's at the
hunk level but overlap the file. Plan 005 rebases onto this plan's result and
integrates hunk by hunk; whichever runs second must re-run its own drift check
and expect this plan's changes to be present rather than treating them as
unexplained drift.

Do **not** run 004 and 005 concurrently against the same working tree.

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
config without it (and refuses a nonsensical limit such as `0`, a negative
number or a boolean), a misconfigured deploy returns a distinguishable
`503 rate_limiter_unconfigured` instead of a misleading 429, session deletion
and the credit-spending `GET /llm-council/health?live=1` probe gain the rate
limit they were missing, the vestigial Council session-token credential stops
handing browsers an HMAC computed directly under the CSRF signing key, and the
operator has an explicit, verified path to update their private config and
confirm in production that Council POSTs succeed again.

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

Two unrelated protocols, one raw key. Not exploitable today, but the Council
token is handed to browsers, which makes it an **HMAC oracle under the CSRF
signing key**: a caller who can choose `sessionId` gets back
`HMAC(CSRF_SECRET, chosen_message)`.

**Be precise about what Step 6 does and does not fix.** The HMAC-as-KDF change
in Step 6 removes the oracle — after it, a browser never sees an HMAC computed
directly under `CSRF_SECRET`. It does **not** decouple compromise or rotation:
both keys are still derived from the one root secret, so leaking `CSRF_SECRET`
still compromises both, and rotating it still rotates both. Genuinely
decoupling them needs a second, independently rotatable
`COUNCIL_TOKEN_SECRET`, which needs an operator action and a
`scripts/preflight_secrets.sh` change. That is deliberately **not** done here
(see "Findings reconsidered"), and the residual is recorded in
"Maintenance notes". Do not describe Step 6 as fixing rotation coupling in the
commit message or the PR.

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
| Worker tests (all) | `cd workers && npx vitest run` | exit 0, **0 failed** — see "Baselines, not absolutes" below |
| Worker tests (one file) | `npx vitest run --config workers/vitest.config.js workers/__tests__/<file>` | exit 0, 0 failed |
| Worker test by name | `npx vitest run --config workers/vitest.config.js workers/__tests__/<file> -t "<test name>"` | exit 0, that test passes |
| Python tests (all) | `make test-py` | 0 failures **other than** the 3 named environmental ones below |
| Python tests (one file) | `.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q` | `11 passed` after Step 4 (a per-file count; stable regardless of sibling plans) |
| Python lint | `make lint` | `All checks passed!` |
| Ruff on in-scope files | `.venv/bin/ruff check tests/test_cloudflare_native_target.py scripts/check_cloudflare_native_target.py` | `All checks passed!` |
| Deploy gate (checked-in config) | `.venv/bin/python scripts/check_cloudflare_native_target.py` | exit 1 with exactly 6 placeholder errors — see note below |
| Parse `wrangler.toml` | `.venv/bin/python -c "import tomllib,pathlib;print(tomllib.loads(pathlib.Path('wrangler.toml').read_text())['ratelimits'])"` | prints the ratelimits list |

### Baselines, not absolutes

**Do not assert a whole-suite total anywhere.** Other plans in `plans/` add
tests to the same suites, so `Tests 345 passed (345)` is true only until a
sibling plan lands, and an executor who "fixes" a mismatched total is editing
the yardstick instead of the code. Record your own baseline in Step 0 and
assert a **delta** against it:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
WORKER_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
echo "WORKER_BEFORE=$WORKER_BEFORE"   # write this number down
```

At the end of this plan the same command must report exactly
`WORKER_BEFORE - 5` passing tests, with **0 failed**. That is the net of
Step 5 (+3), Step 6 (−13 deleted `verifyToken` tests, +2 new), and Step 7 (+3).
Per-file counts stated in individual steps are stable and may be asserted as
absolutes.

**Note on the 3 Python failures**: `make test-py` reports 3 failures that are
environmental — a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch
breaks the `pypdf` import. After this plan they must still be **exactly those
3, by name**:

- `tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent`

They are **not** caused by repo code and are **not** this plan's problem. Do
not attempt to fix them. Any fourth failure, or any failure with a different
name, is yours.

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
  unconfigured-vs-throttled; rate-limit `handleDeleteSession` and the live
  health probe (Steps 2–3, 7)
- `scripts/check_cloudflare_native_target.py` — assert the binding and a sane
  limit (Step 4)
- `tests/test_cloudflare_native_target.py` — fixture + 4 new tests (Step 4)
- `workers/__tests__/cloudflare-council-handlers.test.js` — 6 new tests
  (3 in Step 5, 3 in Step 7)
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
  - Step 7: `fix: rate-limit the credit-spending Council live health probe`
  - Step 8: no commit — it is operator handoff text for the PR description.
- No AI attribution / co-author lines.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

## Steps

### Step 0: Record your baselines

Nothing to change here — this step exists so every later "delta" assertion has
something to compare against, and so a dirty tree is caught before you edit.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git status --short --branch                       # must list no in-scope path
cd workers && npx vitest run 2>&1 | tail -5       # note "Tests N passed"
```

Write down `WORKER_BEFORE=N`. Also record the current per-file counts you will
change:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js 2>&1 | grep 'Tests '
npx vitest run --config workers/vitest.config.js workers/__tests__/llm-council-auth.test.js 2>&1 | grep 'Tests '
.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q 2>&1 | tail -1
```

At the time of writing these were 8, 23 and 6 respectively. If any differs,
the file drifted — re-read it before trusting the line numbers below.

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
→ exit 0, **0 failed**, and `Tests N passed` where `N == WORKER_BEFORE`
(this step adds no tests).

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
→ exit 0, **0 failed**, `Tests N passed` where `N == WORKER_BEFORE`.

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
        limit = simple.get("limit") if isinstance(simple, dict) else None
        # `type(limit) is int` rather than isinstance(): bool is a subclass of
        # int in Python, so isinstance(True, int) is True and `limit = true`
        # in the operator's TOML would sail through as "1 request/minute".
        # A limit of 0 or a negative number would pass an isinstance check too
        # and would throttle every Council POST to zero — i.e. reproduce this
        # very outage while reporting a healthy config.
        if (
            not isinstance(simple, dict)
            or type(limit) is not int
            or limit < 1
            or simple.get("period") not in (10, 60)
        ):
            errors.append(
                "ratelimits[RL_COUNCIL_TURN].simple must set a positive integer "
                "limit (not a boolean) and a period of 10 or 60"
            )
        elif limit != 30:
            # 30/min/IP is the figure this plan decided on (see "Current
            # state"). A different value is not necessarily wrong, but it must
            # be a deliberate operator choice, not a typo — so warn loudly in
            # the error stream rather than silently accepting it.
            errors.append(
                f"ratelimits[RL_COUNCIL_TURN].simple.limit is {limit}, not the "
                "expected 30 — change this line in the gate if that is intentional"
            )
```

Note the last branch makes the gate assert the **exact** agreed limit, so an
operator who fat-fingers `limit = 3` is told, rather than silently shipping a
10× tighter throttle. If a future operator genuinely wants a different number,
they change the gate and the plan together.

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

2. Add four new tests at the end of the file, modelled on the existing
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
- `test_operator_gate_rejects_a_non_positive_council_rate_limit` — a
  `pytest.mark.parametrize` over `["limit = 0", "limit = -1"]`, each written
  via `_valid_main().replace("limit = 30", case)`; assert some error contains
  `"positive integer"`. Rationale: `limit = 0` throttles every Council POST to
  zero, which is the outage this plan exists to fix, dressed up as a healthy
  config.
- `test_operator_gate_rejects_a_boolean_council_rate_limit` — write
  `_valid_main().replace("limit = 30", "limit = true")`; assert some error
  contains `"positive integer"`. Rationale: TOML `true` parses to Python
  `True`, and `isinstance(True, int)` is `True`, so a plain `isinstance` check
  would accept it as "1 request per minute".

Read lines 148–157 of that file first and copy its exact call/assert mechanics
(how it invokes `MODULE`, how it collects `errors`) rather than inventing a new
harness.

**Verify (a)** — file-level tests:

```bash
.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q 2>&1 | tail -1
```
→ `11 passed` (6 baseline + 5 new cases: three plain tests plus the
two-case parametrize). This is a **per-file** count, so it stays true
regardless of what other plans land. If your baseline in Step 0 was not 6,
assert `baseline + 5` instead.

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
→ exit 0, **0 failed**, `Tests N passed` where `N == WORKER_BEFORE + 3`.

### Step 6: Separate the Council token key from CSRF, and delete the dead verifier

In `workers/llm-council/auth.js`:

**What this step is and is not.** It removes the HMAC oracle (browsers stop
receiving `HMAC(CSRF_SECRET, sessionId)` directly). It does **not** decouple
compromise or rotation — one root secret still feeds both protocols. Write the
commit message accordingly (`refactor: derive the Council session-token key
separately from CSRF`), and do not claim rotation independence in the PR.

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
→ exit 0, **0 failed**, `Tests N passed` where `N == WORKER_BEFORE - 8`
(+3 from Step 5, −13 deleted, +2 added here).

### Step 7: Rate-limit the credit-spending live health probe

`handleHealth` (`workers/llm-council/cloudflare_handlers.js`) has two modes.
The default is a static config echo and costs nothing. But
`GET /api/v1/llm-council/health?live=1` requires auth and then calls
`runExpert({ ... modelRaw: "openai/gpt-5-mini-2025-08-07" ... })` — a **real
paid CF AI Gateway call** — on every request. Verified verbatim in the current
file: the `live` branch runs `requireAuth(...)` and then `await runExpert(...)`.

So it is a billing-drain vector reachable by *any* authenticated user, and it
is the one credit-spending Council route this plan's Steps 2–3 did not cover.
It is in this plan's file territory, so close it here.

In `handleHealth`, insert the rate-limit check **inside** the `live` branch,
immediately after the `requireAuth` result is checked and **before** the
`if (!live || !env.CF_AIG_TOKEN)` early return:

```js
  if (live) {
    const authResult = await requireAuth(request, env, verifyJwt);
    if (authResult instanceof Response) return authResult;
    // A live probe is a paid CF AI Gateway call. Same limiter, same
    // fail-closed contract as every other credit-spending Council route.
    const limited = await applyRateLimit(request, env);
    if (!limited.success) return rateLimitFailure(limited);
  }
```

Do **not** rate-limit the non-live branch — it is a static config echo used by
uptime monitors and costs nothing.

Add three tests to `workers/__tests__/cloudflare-council-handlers.test.js`.
The file already declares `mockRunExpert` and mocks `../llm-council/runner.js`
with it (verified at the top of that file), so no new mock plumbing is needed.
**Every one of these three must set `CF_AIG_TOKEN: "fake-token"` in `env`** —
without it `handleHealth` returns the static echo before it would ever reach
`runExpert`, and assertion 3 would pass vacuously.

1. **`does not rate-limit the static health echo`** — `GET /health` (no `live`
   param) with `env = { IMMI_STORAGE_MODE: "cloudflare", CF_AIG_TOKEN: "fake-token" }`
   and **no** `RL_COUNCIL_TURN` binding returns `200`, proving the plain probe
   used by uptime monitors stays reachable when the limiter is unbound.
2. **`fails closed on a live health probe when the limiter binding is absent`**
   — `GET /health?live=1`, same env, still no `RL_COUNCIL_TURN`: returns `503`
   and `code === "rate_limiter_unconfigured"`.
3. **`consults the limiter before spending AI credit on a live probe`** —
   `GET /health?live=1` with `CF_AIG_TOKEN: "fake-token"` and
   `RL_COUNCIL_TURN: { limit: vi.fn(async () => ({ success: false })) }`:
   returns `429` / `code === "rate_limited"`, **and** the mocked `runExpert`
   was never called (`expect(mockRunExpert).not.toHaveBeenCalled()`). That last
   assertion is the one that actually proves no credit was spent; a status-code
   assertion alone would pass even if the order were wrong.

**Verify (a)**:

```bash
npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js 2>&1 | grep 'Tests '
```
→ `Tests  14 passed (14)` (8 baseline + 3 from Step 5 + 3 here).

**Verify (b)** — the assertion can actually fail. Temporarily move the
`applyRateLimit` call to *after* the `runExpert` call, re-run, and confirm
test 3 fails on the `not.toHaveBeenCalled()` assertion. Restore, re-run green,
do not commit the temporary move.

**Verify (c)**:

```bash
cd workers && npx vitest run
```
→ exit 0, **0 failed**, `Tests N passed` where `N == WORKER_BEFORE - 5`.

### Step 8: Operator handoff and production closure

Steps 1–7 are code. **The outage is not over until the operator's private
config carries the binding and a real Council POST succeeds in production.**
This step is executed by the operator, not by you; your job is to produce the
handoff and to record the evidence when they run it.

You cannot run these yourself — the private config and the production
credentials are not in this repository, and you must not attempt to obtain
them. Write the following into the PR description verbatim, then stop.

**8a. Operator config update (blocking — the deploy will fail without it).**
The gate in `.github/workflows/deploy-worker.yml:70-73` validates
`$RUNNER_TEMP/immi-native-main.toml`, decoded from the operator secret
`IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`. After Step 4 that config must contain the
same `[[ratelimits]]` block added in Step 1, or **every deploy is blocked**.
The operator must:

1. Decode the current secret to a local file, add the `[[ratelimits]]` block
   (copy it verbatim from `config/wrangler-cloudflare-native.toml.example`),
   re-encode, and update the secret.
2. Before pushing the secret, dry-run the gate against the edited file:
   `.venv/bin/python scripts/check_cloudflare_native_target.py --main-config <edited.toml> --pipeline-config <pipeline.toml>`
   → must print **no** error mentioning `RL_COUNCIL_TURN`.
3. Confirm the Cloudflare account has a rate-limiting binding available on the
   plan in use; `[[ratelimits]]` is not available on every account tier.

**8b. Post-deploy production smoke (the actual proof the outage is fixed).**
After `wrangler deploy`, with a valid session:

| Probe | Expected |
|---|---|
| `POST /api/v1/llm-council/sessions` (1st request, valid JWT + `{"message":"smoke"}`) | `200` with a `session_id` — **not** 429, **not** 503 |
| 31 such POSTs from one IP inside 60s | the 31st returns `429` with `code: "rate_limited"` |
| `GET /api/v1/llm-council/health` (no `live`) | `200` |
| `GET /api/v1/llm-council/health?live=1` unauthenticated | `401` (unchanged) |

Record the first row's response status and `code` field in the PR. **If the
first POST still returns 429, the private config was not updated — go back to
8a; do not "fix" it by reverting to fail-open.**

**8c. Binding-removal check (proves the new 503 is reachable, not theoretical).**
On a staging Worker only, deploy once with the `[[ratelimits]]` block removed
and confirm `POST /sessions` returns `503` with
`code: "rate_limiter_unconfigured"` rather than `429`. Never do this against
production. If no staging Worker exists, say so in the PR and rely on the
Step 5 unit tests instead — do not skip silently.

**8d. Rollback.** If Council traffic breaks after this deploy:
1. Redeploy the previous Worker version (`wrangler rollback` or redeploy the
   prior git tag). The Worker code and the config are separate rollbacks —
   the previous Worker build does not require the `[[ratelimits]]` block, so
   rolling back the Worker alone is sufficient and safe.
2. Do **not** roll back only the config: an older config without the block,
   paired with the new Worker, reproduces the outage as a 503 instead of a 429.
3. The gate change in `scripts/check_cloudflare_native_target.py` is inert at
   runtime; it only blocks future deploys. Leave it in place.

**Verify**: this step has no machine-checkable verification you can run. Its
Done criterion is that 8a–8d appear verbatim in the PR description and that the
operator has reported the 8b results back. Do not mark this plan DONE on unit
tests alone — the production symptom is what this plan exists to remove.

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
- `test_operator_gate_rejects_a_non_positive_council_rate_limit` —
  parametrized over `limit = 0` and `limit = -1`. `limit = 0` is the important
  one: it would pass a naive `isinstance(..., int)` check and would throttle
  every Council POST to zero, reproducing this outage behind a "valid" config.
- `test_operator_gate_rejects_a_boolean_council_rate_limit` — `limit = true`
  is blocked. TOML `true` becomes Python `True`, and `isinstance(True, int)` is
  `True`, so this is the case a plain type check silently accepts as "1/min".

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
- `GET /health` (no `live`) stays reachable with the limiter unbound.
- `GET /health?live=1` with the limiter unbound → `503`
  `rate_limiter_unconfigured`.
- `GET /health?live=1` with a rejecting limiter → `429` **and** `runExpert`
  never called — the assertion that actually proves no AI credit was spent.

**New tests — `workers/__tests__/llm-council-auth.test.js`**:

- `mintToken` output ≠ raw-`CSRF_SECRET` HMAC of the same session id
  (purpose separation actually happened).
- `mintToken` output is stable against a pinned expected value (derivation
  changes cannot land silently).

**Existing tests that must keep passing unchanged**: the 8 current Council
handler tests, the 3 `nanoid21` and 7 `mintToken` tests, and the other 6
gate-contract tests.

**Full-suite verification** (deltas, not absolutes — see "Baselines, not
absolutes"):

```bash
cd workers && npx vitest run     # 0 failed; Tests == WORKER_BEFORE - 5
make test-py                     # 0 failures except the 3 named pyexpat ones
make lint                        # All checks passed!
```

No frontend files change, so `cd frontend && npx vitest run` and
`cd frontend && npx tsc -b --noEmit` (exit 0) should be unaffected. Run them
once at the end as a sanity check: assert **0 failed** and that the frontend
passing count is unchanged from the number you recorded in Step 0 — do not
assert a hard-coded frontend total, since sibling plans add frontend tests.

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
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js` reports `14 passed` (per-file count: 8 baseline + 3 + 3)
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/llm-council-auth.test.js` reports `12 passed` (per-file count)
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js -t "consults the limiter before spending AI credit on a live probe"` passes
- [ ] `npx vitest run --config workers/vitest.config.js workers/__tests__/cloudflare-council-handlers.test.js -t "fails closed with 503 rate_limiter_unconfigured"` passes
- [ ] `cd workers && npx vitest run` exits 0 with **0 failed** and `Tests` equal to `WORKER_BEFORE - 5` (the baseline recorded in Step 0)
- [ ] `.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q` reports `11 passed`
- [ ] `.venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q -k "boolean or non_positive"` reports `3 passed`
- [ ] `make test-py` reports **0 failures other than exactly these 3, by name**: `test_clean_line_does_not_destroy_words`, `test_extract_judiciary_names_filters_non_judicial_judging`, `test_merge_treats_postnominal_variant_as_equivalent`, all in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `make lint` prints `All checks passed!`
- [ ] `cd frontend && npx vitest run` reports **0 failed** with the same passing count recorded in Step 0, and `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `git status --short` lists only files from the "In scope" list
- [ ] Steps 8a–8d are reproduced verbatim in the PR description, and the operator has reported the 8b smoke results (specifically: the first Council POST returned 200, not 429)
- [ ] Nothing was pushed and no PR was opened (`git log origin/main..HEAD` shows your commits are local only)

## STOP conditions

Stop and report back (do not improvise) if:

- **Any of the four drift-check commands reports an in-scope path** — committed
  since `42826a3`, unstaged, staged, or listed by `git status --short`. The
  line numbers and excerpts in "Current state" are then unreliable. Report and
  stop; never `git checkout --` or `git clean` your way out of it.
- **`plans/005-*.md` has already landed** and
  `workers/llm-council/cloudflare_handlers.js` contains `return await handle…(`
  dispatch lines or a `council.stream.skipped_persist` log. This plan is
  supposed to land first (see "Sequencing"). Report the ordering inversion; the
  edits are still compatible but the line numbers in "Current state" are not.
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
- **`make test-py` shows any failure that is not one of the three named
  `tests/test_backfill_judge_overrides_from_pdf.py` tests listed in "Baselines,
  not absolutes".** Those three are a Homebrew `pyexpat`/`libexpat` ABI
  problem, unrelated to this work; anything else is yours. Judge by test
  **name**, not by count — a count can coincidentally still be 3 while a
  different test broke.
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
  operator must be told before they next run the workflow. **Step 8 now makes
  this a numbered step with its own Done criterion** rather than only a note —
  it was previously buried here, which is how a config-gap outage becomes a
  second config-gap outage.
- **Residual: rotation and compromise are still coupled.** Step 6 removes the
  HMAC oracle but both the CSRF token and the Council session token still
  derive from the single `CSRF_SECRET`. Fully decoupling them needs a separate,
  independently rotatable `COUNCIL_TOKEN_SECRET` plus a
  `scripts/preflight_secrets.sh` entry and an operator action. Worth doing only
  if the Council token ever becomes a real credential; today it is an opaque
  handle the Worker never reads, so a second secret buys operational cost with
  no security gain. Do not describe the current state as "decoupled".
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

## Review points not applied

- **"Atomically remove the frontend's fake-token dependency and `mintToken`,
  rather than deriving a Council key from `CSRF_SECRET`" — not applied.** The
  premise (the Worker never verifies the token) is correct and this plan
  already says so. The proposed remedy cannot be executed by this plan: the
  removal is not Worker-side. `frontend/src/lib/api-llm-council.ts:232` and
  `:259` call `persistToken(result.session_id, result.session_token)`, and its
  request helpers at `:285`, `:300` and `:353` build an `X-Session-Token`
  header from `localStorage` via `TOKEN_KEY` (`:93`), with the read path at
  `:105` and a client-side throw when the token is missing (documented at
  `:267`). Deleting `mintToken` without changing those five call sites breaks
  every Council turn in the SPA between deploys. `frontend/` is on this plan's
  "Out of scope" list precisely because a coordinated two-runtime change must
  ship atomically, which a Worker-only plan cannot do. The half that *is*
  Worker-side and *is* atomic — deleting the never-called `verifyToken` and
  removing the HMAC oracle — is done in Step 6. The rest is recorded as a
  deferred follow-up in "Maintenance notes", with the exact five frontend line
  references above so the follow-up does not have to rediscover them.
  Accepting the reviewer's version as written would have produced a broken
  Council feature, not a smaller attack surface.
