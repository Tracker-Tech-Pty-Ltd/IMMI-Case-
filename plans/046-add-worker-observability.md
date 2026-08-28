# Plan 046: Correlation IDs, honest upstream error bodies and real safety gates

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**. The committed-history diff cannot see uncommitted,
> staged or untracked work, so all four commands must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE=(workers/cloudflare-native.js workers/llm-council/runner.js Makefile frontend/scripts/build-tokens.ts .gitignore ruff.toml .editorconfig .pre-commit-config.yaml)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${SCOPE[@]}"     # committed since the plan was written
> git diff --stat -- "${SCOPE[@]}"                   # unstaged
> git diff --cached --stat -- "${SCOPE[@]}"          # staged
> ```
> Expected: the last three print nothing and no in-scope path appears in
> `git status`. If any in-scope file appears in **any** of them, treat it as a
> STOP condition: compare the "Current state" excerpts against the live code and
> report. **Never** run `git checkout --` or `git clean -f` to force a clean
> tree — that destroys the operator's uncommitted work.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`,
  `plans/002-fix-test-collection-and-install.md`,
  `plans/003-lint-the-test-suite.md`
  (all three edit `Makefile`; running after them avoids a textual collision.
  Nothing in this plan needs their *behaviour*, only their turn at the file.)
- **Category**: dx
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Three of this repo's safety and observability surfaces are decorative rather
than real. (1) The production Worker emits 37 structured log events and not one
of them says *which tenant or user* the request belonged to, and no id is ever
handed back to the caller — so when a user reports "the Council failed", there
is nothing they can quote and nothing to filter Logpush by. (2) When the
Cloudflare AI Gateway returns a 4xx/5xx, up to 700 characters of the raw
provider body — model names, routing, quota state — are embedded in
`opinions[].error` and returned inside an ordinary **200** Council response.
(3) `make audit-rls-guards` is advertised as a cross-tenant-leak guard and cited
as standing acceptance evidence, but it greps for `set_config(`, a pattern that
no longer exists anywhere in `workers/`, so it prints OK unconditionally and is
wired into nothing.

After this plan: every response **the Worker itself produces** carries an
`X-Request-Id`, every API request emits one access line with verified
tenant/user attribution — including requests whose handler throws — provider
error bodies are logged (redacted) instead of returned, the dead RLS guard is
replaced by one that asserts a real invariant, and the repo has baseline tooling
(`ruff.toml`, `.editorconfig`, `.pre-commit-config.yaml`) plus a design-token
freshness gate.

Three limits, stated up front so nobody over-claims them later:

- **Header coverage is not total.** If `handlers.fetch` throws, there is no
  Response object to attach a header to, and this plan deliberately does not
  synthesise one (`plans/005-fix-worker-async-error-handling.md` requires the
  exception to keep propagating). Such a request produces Cloudflare's own 500,
  with no `X-Request-Id`. It does get an access line — see Step 4.
- **The tenant guard is module-granular, not route-granular.** It proves each
  authenticating *file* reaches `assertMembership()`; a new unguarded handler
  added to an already-compliant file passes. It is a floor, not a proof. The
  route-level check is `plans/038-test-the-production-sql-layer.md`'s route
  manifest.
- **None of the new gates run in CI.** `.github/workflows/ci.yml` is another
  plan's territory; until it is wired (exact steps in "Maintenance notes")
  `make audit-tenant-guards` and `make tokens-check` only fire when a human
  runs them locally. Do not describe them as CI gates.

## Current state

### Files this plan touches, and their role

- `workers/cloudflare-native.js` (246 lines) — the **entire** production request
  path. Its `fetch()` handler dispatches auth, case actions, pipeline control,
  mutations, admin, Council, case reads, then static assets. No correlation id,
  no access log.
- `workers/llm-council/runner.js` (2043 lines) — LLM Council orchestration.
  Contains four byte-identical `throw new Error(\`HTTP ...\`)` sites that embed
  the upstream body in the error message.
- `Makefile` (115 lines) — dev command surface. Holds the dead
  `audit-rls-guards` target.
- `frontend/scripts/build-tokens.ts` (415 lines) — `tokens.json` →
  `tokens.css` + `tokens.ts` generator. Its validation warnings are advisory
  only; the file contains **no** `process.exit` at all.
- `.gitignore` — contains an unanchored `dashboard.png` rule that silently
  hides files elsewhere in the tree.
- `ruff.toml`, `.editorconfig`, `.pre-commit-config.yaml` — do not exist yet
  (verified: no `pyproject.toml`, `ruff.toml`, `.ruff.toml`, `setup.cfg`,
  `tox.ini`, `.editorconfig` or `.pre-commit-config.yaml` at the repo root, and
  `.git/hooks/` contains only `*.sample` files).

### Excerpt 1 — `workers/cloudflare-native.js:190-212` (the entrypoint object)

```js
export default {
  async queue(batch, env) {
    if (batch?.queue === "immi-case-mutation-dlq") {
      await handleDeadLetterQueue(batch, env);
      return;
    }
    await handleCaseMutationQueue(batch, env);
  },
  async fetch(request, env, ctx) {
    let mode;
    try {
      mode = getStorageMode(env);
    } catch (err) {
      return unavailable("Cloudflare-native runtime is misconfigured", "invalid_storage_mode");
    }
    if (mode !== "cloudflare") {
      return unavailable("Cloudflare-native runtime requires IMMI_STORAGE_MODE=cloudflare", "cloudflare_mode_required");
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", worker: "immi-case", layer: "edge+cloudflare-native" });
    }
```

The file ends at line 244-246:

```js
    return unavailable("This API route is not yet available in the Cloudflare-native runtime");
  },
};
```

Verified facts about this file at commit `42826a3`:

- `grep -rni 'cf-ray|x-request-id|requestid|request_id' workers/**/*.js` returns
  **zero** hits. The only `crypto.randomUUID()` uses in the tree are for JWT
  `jti`, command ids and row ids — never a request id.
- The `fetch` body uses no `this`.
- There are **37** `console.log|error|warn(JSON.stringify({event, ...}))` sites
  across 13 files under `workers/`. None carries `tenant_id`, `user_id` or a
  request id. Two representative ones:
  - `workers/case-api/cloudflare_mutations.js:317`:
    ```js
    console.error(JSON.stringify({ event: "cloudflare.case_mutation_error", path, error: error?.message }));
    ```
  - `workers/auth/cloudflare_handlers.js:234`:
    ```js
    console.error(JSON.stringify({ event: "auth.cloudflare.refresh_error", error: err?.message }));
    ```

### Excerpt 2 — `workers/llm-council/runner.js:87-103` (existing log + classify helpers)

```js
function logCouncilEvent(fields) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
  } catch (_) {
    // logging must never throw
  }
}

function classifyError(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("aborted")) return "timeout";
  if (msg.includes("http 4")) return "client_error";
  if (msg.includes("http 5")) return "server_error";
  if (msg.includes("did not include text output")) return "empty_output";
  if (msg.includes("missing cf_aig_token")) return "auth_missing";
  return "unknown";
}
```

**Load-bearing**: `classifyError` matches on the *prefix* `http 4` / `http 5`.
An error message of `HTTP 429` still classifies as `client_error`, and
`HTTP 500` still classifies as `server_error`. The retry policy at
`runner.js:480-483` depends on this. Removing the body from the message does
not change classification.

### Excerpt 3 — `workers/llm-council/runner.js:314-318` (the leak source)

```js
    if (!res.ok) {
      let detail;
      try { detail = await res.json(); } catch (_) { detail = await res.text().catch(() => ""); }
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(detail).slice(0, 800)}`);
    }
```

This exact `throw` line, **including its six leading spaces**, appears four
times — at lines **317, 1376, 1554 and 1698** — inside `gatewayChatCompletion`,
`streamGatewayChatCompletion`, `streamAnthropicNative` and `streamGeminiNative`
respectively. `model` is a destructured parameter in all four functions.

### Excerpt 4 — `workers/llm-council/runner.js:506-515` (where it reaches the client)

```js
      return {
        provider_key: providerKey,
        provider_label: providerLabel,
        model,
        success: false,
        answer: "",
        error: `${providerLabel} request failed: ${String(err).slice(0, 700)}`,
        sources: [],
        latency_ms: elapsed,
      };
```

That object becomes an element of `opinions[]`, which `runCouncil` returns at
`runner.js:1246` inside an ordinary **200** response. The same truncated string
is also pushed to the browser as an SSE `<provider_key>.error` event at
`runner.js:1898`.

**The 503 path is not the leak vector.** `workers/llm-council/cloudflare_handlers.js:189`
reads `return errorResponse(\`LLM Council error: ${err?.message || "unavailable"}\`, 503);`
but `runExpert` catches its own errors and `runModerator` falls back, so that
line fires only on unexpected crashes. Fixing the four `throw` sites fixes both
the 200 body and the SSE event at once.

### Excerpt 5 — `Makefile:4`, `Makefile:62` and `Makefile:73-81` (the dead guard)

```make
.PHONY: help dev build test test-py test-fe test-workers test-e2e lint typecheck audit-rls-guards clean
```

```make
test: test-py test-fe test-workers
```

```make
# AC4 safety guard: reject any set_config call without transaction-local flag (true).
# A literal `false` or missing third argument leaks JWT claims across pooled connections.
audit-rls-guards:
	@echo "Checking set_config calls for transaction-local flag..."
	@BAD=$$(grep -rn "set_config(" "$(REPO_ROOT)/workers" --include="*.js" | grep -v "set_config('request.jwt.claims'.*true)" || true); \
	if [ -n "$$BAD" ]; then \
	  echo "ERROR: set_config without transaction-local=true (cross-tenant leak risk):"; \
	  echo "$$BAD"; exit 1; \
	else echo "OK: all set_config calls verified with transaction-local=true"; fi
```

Verified: `grep -rn "set_config(" workers --include="*.js"` returns **zero**
matches, so the guard's subject no longer exists and the target always prints
`OK`. `grep -rn audit-rls-guards` across the repo finds it only at `Makefile:4`,
`Makefile:75` and `.omc/plans/auth-multitenant-jwt-rls.md:24` — no workflow and
no aggregate target invokes it, and `Makefile:62` `test:` excludes it. (The
`.omc` row also cites `workers/db/getSqlAsUser.js`, which was deleted.)

Also worth knowing: the original grep had **no** `--exclude-dir`, so it would
have scanned `workers/austlii-scraper/node_modules/` too — confirmed by running
the equivalent shell loop, which matched
`workers/austlii-scraper/node_modules/wrangler/wrangler-dist/cli.js`. The
replacement in Step 1 excludes vendored directories.

### Excerpt 6 — the invariant that replaces it

`CloudflareIdentityStore.assertMembership()` (`workers/storage/cloudflare.js:1300`)
is the app-layer tenant boundary. `CLAUDE.md` states the constraint verbatim:

> **Tenant isolation is app-layer, not RLS** — `assertMembership()` runs a D1
> SELECT per authenticated request; there is no database-level enforcement
> backstop like Postgres RLS. A route that forgets to call it is a real leak
> vector.

Running the candidate invariant ("every non-test Worker module that calls
`requireAuth(` also reaches `assertMembership(`") at `42826a3` gives:

```
OK   workers/admin/cloudflare_handlers.js
MISS workers/auth/cloudflare_handlers.js
MISS workers/auth/handlers.js
MISS workers/auth/request_auth.js
OK   workers/case-api/cloudflare_actions.js
OK   workers/case-api/cloudflare_mutations.js
OK   workers/llm-council/cloudflare_handlers.js
MISS workers/llm-council/handlers.js
OK   workers/pipeline/control_handlers.js
```

The four MISSes are legitimately exempt: `request_auth.js` *defines*
`requireAuth`; `auth/cloudflare_handlers.js` handles login/me/logout/refresh/
switch-tenant, which operate on the caller's own identity before a tenant
context exists; `auth/handlers.js` and `llm-council/handlers.js` are retired
pre-cutover modules with no live importer.

### Excerpt 7 — `frontend/package.json:6-13`

```json
  "scripts": {
    "tokens": "tsx scripts/build-tokens.ts",
    "dev": "npm run tokens && vite",
    "build": "npm run tokens && tsc -b && vite build",
    "build:cloudflare": "npm run tokens && tsc -b && vite build --outDir dist --emptyOutDir",
    "dev:cloudflare": "npm run build:cloudflare && wrangler pages dev dist",
    "deploy:cloudflare": "npm run build:cloudflare && wrangler pages deploy dist",
    "lint": "eslint .",
```

`dev`, `build` and `build:cloudflare` all regenerate tokens first, so **the
running app and every deployed bundle are always fresh**. `npx vitest run` does
**not**, so Vitest reads the committed `tokens.ts`. `git ls-files frontend/src/tokens/`
lists `tokens.css`, `tokens.json` **and** `tokens.ts` — both generated artifacts
are tracked.

### Excerpt 8 — `frontend/scripts/build-tokens.ts:110-116` and `:407-415`

```ts
    if (!(key in dark)) {
      console.warn(
        `⚠ WARN: ${prefix}.dark.${key.replace(prefix + ".", "")} is missing (exists in light mode)`,
      );
    } else if (
```

```ts
writeFileSync(resolve(__dirname_resolved, "../src/tokens/tokens.ts"), ts);

console.log("✓ tokens.css generated");
console.log("✓ tokens.ts generated");
if (validationWarnings.length > 0) {
  console.log(
    `  (${validationWarnings.length} validation warning(s) — see above)`,
  );
}
```

`validationWarnings` is declared at line 64 (`const validationWarnings: string[] = [];`).
There is no `process.exit` anywhere in the 415-line file. The dark/light
symmetry check `console.warn`s directly and never reaches `validationWarnings`.

Verified by an independent read-only re-implementation of the script's own
validators against `tokens.json` at `42826a3`: **0 symmetry warnings, 0 missing
root keys, 0 missing colour keys, 0 malformed colours.** `--strict` therefore
passes cleanly today.

`frontend/scripts/build-tokens.ts` is **not** type-checked: `frontend/tsconfig.node.json`
has `"include": ["vite.config.ts"]`. It *is* linted by `npm run lint`
(`eslint .` from `frontend/`, config matches `**/*.{ts,tsx}`). Using `process`
in a `.ts` file under that config was probed with
`echo '...' | npx eslint --stdin --stdin-filename scripts/probe-tmp.ts` and
exits 0 — `no-undef` is disabled for TypeScript by `tseslint.configs.recommended`.

### Excerpt 9 — `.gitignore:78-81`

```
# Misc artifacts
dashboard.png
=1.0.0
=2.0.0
```

`dashboard.png` is unanchored, so it matches at any depth. Proof:

```
$ git check-ignore -v audit/ui/dashboard.png
.gitignore:79:dashboard.png	audit/ui/dashboard.png
```

`audit/` contains exactly one file (`audit/ui/dashboard.png`), is not tracked
and is not otherwise ignored — it is invisible to `git status` *only* because
of this unanchored rule. `=1.0.0` and `=2.0.0` are real 10 KB stray files at the
repo root, created by a mistyped shell redirect; the ignore entries are correct
but undocumented.

### Excerpt 10 — `requirements-test.txt:7` (why `ruff.toml` is worth having)

```
ruff==0.15.18  # pinned: 0.16 expanded default rules (394 new findings); bump deliberately with a cleanup pass
```

The lint gate's meaning is currently a property of the installed ruff version,
not of this repo.

### Repo conventions this plan must honour

From `CLAUDE.md`:

- "**No Flask in production** — there is nothing to proxy writes to;
  `dispatchCloudflareCaseMutation` handles them directly in the Worker."
- "**Structured logs** — mutation and auth handlers
  `console.log(JSON.stringify({event, ...}))`; pipe to Cloudflare Logpush →
  Grafana or Datadog to monitor per-tenant activity and failure rates."
- "`env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings,
  not Postgres connections."
- "**localStorage must be try-catch wrapped**", "**Use `.toSorted()` not
  `.sort()`**", "`t(\"key\", { defaultValue: ... })`" — none of these apply
  here; this plan touches no React component.
- Commit format: `<type>: <description>`, type ∈
  feat|fix|refactor|docs|test|chore|perf|ci. No AI attribution lines. Example
  from `git log`: `fix: install root node_modules in make install`.

Existing Worker-test style to copy — `workers/__tests__/cloudflare-native-entry.test.js:1-37`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCaseRead = vi.fn();
...
vi.mock("../case-api/cloudflare.js", () => ({
  dispatchCloudflareCaseRead: (...args) => mockCaseRead(...args),
}));

import worker from "../cloudflare-native.js";
```

and `workers/__tests__/llm-council-runner.test.js:31-53`:

```js
function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const mockEnv = {
  CF_AIG_TOKEN: "test-token-abc",
  CF_GATEWAY_URL: "https://gateway.example.com/v1/chat",
};
```

## Commands you will need

Run everything from the repo root, `/Users/d/Developer/Active Projects/IMMI-Case-`,
unless a command says otherwise. Never use a global `pip`/`python3` for this
project — always `.venv/bin/…`.

**Record baselines; do not assert totals.** Sibling plans add tests in parallel,
so any absolute suite count written into this plan is wrong the moment one of
them lands. Before changing anything, capture and name these:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
(cd workers  && npx vitest run 2>&1 | tail -3)   # -> WK_BEFORE  (passed count)
(cd frontend && npx vitest run 2>&1 | tail -3)   # -> FE_BEFORE  (passed count)
make test-py 2>&1 | tail -1                      # -> PY_BEFORE
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort   # -> PY_FAIL_BEFORE (the named failures)
.venv/bin/ruff check . 2>&1 | tail -1            # -> RUFF_BEFORE
cd frontend && npm run lint 2>&1 | tail -2       # -> LINT_BEFORE (error count must stay 0)
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests | `cd workers && npx vitest run` | `WK_BEFORE + 13` passed, 0 failed (6 from Step 3, 7 from Step 5) |
| Python unit tests | `make test-py` | passed count = `PY_BEFORE` (this plan adds no Python test) and `make test-py 2>&1 \| grep -E "^(FAILED\|ERROR)" \| sort` identical to `PY_FAIL_BEFORE` — i.e. still exactly the three `pypdf` ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`, **by name** |
| Frontend tests | `cd frontend && npx vitest run` | passed count = `FE_BEFORE`, unchanged |
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0 |
| Frontend lint | `cd frontend && npm run lint` | exit 0, `0 errors`; warning count unchanged from `LINT_BEFORE` |
| Python lint | `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` | `All checks passed!` (spelled out rather than `make lint`, because `plans/001` Step 3 turns `lint:` into `lint: lint-py lint-fe`; `make lint-py` is equivalent once 001 lands) |
| Full ruff sweep | `.venv/bin/ruff check . 2>&1 \| tail -1` | byte-identical to `RUFF_BEFORE`. Whatever the baseline is, it must not **change** |
| Token build | `cd frontend && npm run tokens` | `✓ tokens.css generated` / `✓ tokens.ts generated`, exit 0 |
| Guard (new) | `make audit-tenant-guards` | `OK: every authenticating Worker module reaches assertMembership() (module granularity only)` |
| Token gate (new) | `make tokens-check` | `OK: generated design tokens match tokens.json` **and the working tree is unchanged afterwards** |

Do **not** run `cd frontend && npx tsc --noEmit` as a gate: `frontend/tsconfig.json`
is `{"files": [], "references": [...]}`, so that form exits 0 having loaded zero
files. Use `npx tsc -b --noEmit`.

## Scope

**In scope** (the only files you may modify or create):

- `workers/cloudflare-native.js` (modify — Step 4)
- `workers/llm-council/runner.js` (modify — Steps 2 and 6 touch different files;
  runner.js is Step 2 only)
- `workers/__tests__/llm-council-upstream-redaction.test.js` (**create** — Step 3)
- `workers/__tests__/cloudflare-native-observability.test.js` (**create** — Step 5)
- `Makefile` (modify — Steps 1, 7, 10)
- `frontend/scripts/build-tokens.ts` (modify — Step 6)
- `ruff.toml` (**create** — Step 8)
- `.editorconfig` (**create** — Step 9)
- `.pre-commit-config.yaml` (**create** — Step 10)
- `.gitignore` (modify — Step 11)
- `plans/046-add-worker-observability.md` — this file, status line only

**Out of scope** (do NOT touch, even though they look related):

- **Any existing file under `workers/__tests__/`.** Create new files only.
  `plans/005` and `plans/038` are editing that directory in parallel and an edit
  to a shared file would collide.
- `workers/llm-council/cloudflare_handlers.js` — owned by `plans/004` and
  `plans/005`. Its `LLM Council error: ${err?.message}` 503 paths are **not**
  the leak vector (see Excerpt 4); fixing the four `throw` sites in `runner.js`
  is sufficient and does not require touching the handler.
- `workers/case-api/*.js`, `workers/auth/*.js`, `workers/pipeline/*.js`,
  `workers/admin/*.js`, `workers/storage/*.js` — the other 35 structured-log
  sites live here and these files are owned by `plans/005` and others. This plan
  deliberately does **not** thread a request id into them; see
  "Findings reconsidered" for why that is the right call, not a shortcut.
- `README.md` — line 570 claims "TypeScript：ESLint + Prettier" while Prettier
  exists nowhere in this repo (`git ls-files | grep -i prettier` is empty and
  neither `package.json` mentions it). Real defect, different plan's territory
  (`DX-20`). Do not edit README here.
- `.github/workflows/ci.yml` and `.github/workflows/deploy-worker.yml` — owned
  by the CI-gate plans. The exact CI steps this plan's new targets deserve are
  written out in "Maintenance notes" for that plan to pick up.
- `requirements-test.txt` — the `ruff==0.15.18` pin is deliberate and documented.
  Do not bump it.
- `.omc/plans/auth-multitenant-jwt-rls.md` — its line 24 cites the guard Step 1
  deletes. It is a historical planning artifact under `.omc/`, which every
  sibling plan treats as out of scope. Leave it; noted in Maintenance notes.
- The 41 tracked images at the repo root (29 `*.png` + 12 `*.jpeg`) and the
  106 tracked images / 12,852 KB overall. See "Findings reconsidered".
- `wrangler.toml` placeholder resource IDs; `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"`;
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase;
  the historical "Performance Baseline (2026-05-05)" section of `CLAUDE.md` —
  **all four are by design. Do not "fix" them.**
- Adding an outer `try/catch` around the Worker's dispatch chain.
  `plans/005-fix-worker-async-error-handling.md` states: *"adding an outer
  try/catch to `fetch()` would mask exactly the bug this plan fixes. Do not add
  one."* Step 4 honours that — the wrapper it adds has **no catch**; an
  exception still propagates unchanged.
- Running `ruff format` or adopting Prettier. See "Findings reconsidered".

## Git workflow

- Branch: `advisor/046-worker-observability` (create from the current branch).
- Commit per step. Message style, matching `git log`:
  - Step 1 → `refactor: replace the dead RLS grep guard with a tenant-isolation guard`
  - Step 2 → `fix: stop returning upstream AI-gateway error bodies to Council clients`
  - Step 3 → `test: assert Council responses never carry an upstream error body`
  - Step 4 → `feat: add request correlation ids and an access log to the Worker`
  - Step 5 → `test: cover Worker request ids and access-log attribution`
  - Step 6 → `feat: make design-token validation fatal under --strict`
  - Step 7 → `ci: gate make test-fe on design-token freshness`
  - Step 8 → `chore: pin the ruff rule selection in ruff.toml`
  - Step 9 → `chore: add .editorconfig`
  - Step 10 → `chore: add an opt-in pre-commit gate`
  - Step 11 → `fix: anchor the dashboard.png ignore rule`
- No AI attribution / co-author lines.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Replace the dead `audit-rls-guards` guard with a real tenant-isolation guard

Three edits to `Makefile`.

**1a.** In the `.PHONY` line (line 4 at `42826a3`, but sibling plans may have
rewritten it — edit whatever it says now), remove the token `audit-rls-guards`
and add `audit-tenant-guards tokens-check hooks`. At `42826a3` the line becomes:

```make
.PHONY: help dev build test test-py test-fe test-workers test-e2e lint typecheck audit-tenant-guards tokens-check hooks clean
```

**1b.** Delete the entire dead target — the two comment lines and the recipe,
lines 73-81 at `42826a3` (quoted verbatim in Excerpt 5). Delete the blank line
that separated it from `test-e2e:` only if it leaves a double blank line.

**1c.** In its place, insert the replacement guard. Note the `--exclude-dir`
flags: without them the loop matches vendored wrangler sources under
`workers/austlii-scraper/node_modules/`.

```make
# Tenant-isolation guard. This stack has no Postgres and no RLS, so
# CloudflareIdentityStore.assertMembership() is the only thing between an
# authenticated caller and another tenant's rows. Any Worker module that
# authenticates a caller must therefore also reach it.
#
# KNOWN LIMIT — READ BEFORE TRUSTING THIS: the check is MODULE-granular. It
# proves the file mentions assertMembership( somewhere, not that the handler
# you just added calls it. A new unguarded route in an already-compliant file
# passes this guard. It is a floor that catches a whole new authenticating
# module written without any membership check; it is NOT a proof of
# per-route isolation. The route-level complement is the route manifest in
# plans/038-test-the-production-sql-layer.md. Do not cite this target as
# evidence that a specific route is tenant-isolated.
#
# The exemptions are listed explicitly so that adding a fifth is a reviewable
# diff:
#   request_auth.js          defines requireAuth; it is not a route handler
#   auth/cloudflare_handlers.js  login/me/logout/refresh/switch-tenant operate
#                                on the caller's own identity, before a tenant
#                                context exists
#   auth/handlers.js, llm-council/handlers.js  retired pre-cutover modules with
#                                no live importer (safe to delete from this list
#                                once the files themselves are gone)
AUTH_GUARD_EXEMPT := workers/auth/request_auth.js workers/auth/cloudflare_handlers.js workers/auth/handlers.js workers/llm-council/handlers.js

audit-tenant-guards:
	@echo "Checking every authenticating Worker module reaches assertMembership()..."
	@cd "$(REPO_ROOT)" || exit 1; \
	MISSING=""; \
	for f in $$(grep -rl "requireAuth(" workers --include="*.js" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=__tests__ | sort); do \
	  case " $(AUTH_GUARD_EXEMPT) " in *" $$f "*) continue ;; esac; \
	  grep -q "assertMembership(" "$$f" || MISSING="$$MISSING $$f"; \
	done; \
	if [ -n "$$MISSING" ]; then \
	  echo "ERROR: module(s) authenticate without reaching assertMembership() (cross-tenant leak risk):$$MISSING"; \
	  exit 1; \
	else echo "OK: every authenticating Worker module reaches assertMembership() (module granularity only)"; fi
```

**1d.** Wire it into `make test` so it is not another guard nobody runs. Change
line 62 from `test: test-py test-fe test-workers` to:

```make
test: audit-tenant-guards test-py test-fe test-workers
```

**1e.** In the `help:` recipe, after the `make typecheck` line, add:

```make
	@echo "  make audit-tenant-guards  Assert authenticating Workers reach assertMembership() (module-level)"
```

**Verify** (all five must hold):

```bash
make audit-tenant-guards
```
→ prints `OK: every authenticating Worker module reaches assertMembership() (module granularity only)`, exit 0.

**The guard must be able to fail.** A green run over a compliant tree proves
nothing about the guard itself, so force a failure with a throwaway module and
delete it immediately:

```bash
printf 'import { requireAuth } from "./auth/request_auth.js";\nexport const x = requireAuth;\n' \
  > workers/zz-guard-probe.js
make audit-tenant-guards; echo "probe-exit=$?"
rm -f workers/zz-guard-probe.js
make audit-tenant-guards; echo "clean-exit=$?"
```
→ `probe-exit=2` (make propagates the recipe's `exit 1` as 2) with an `ERROR:`
line naming `workers/zz-guard-probe.js`, then `clean-exit=0`. If `probe-exit`
is 0, the loop is not scanning what you think it is — STOP. Confirm
`git status --short -- workers/` is clean afterwards.

```bash
git grep -c -- audit-rls-guards -- Makefile; echo "exit=$?"
```
→ no output, `exit=1` (no occurrences left).

```bash
git grep -n -- "set_config(" -- Makefile; echo "exit=$?"
```
→ no output, `exit=1`.

```bash
make -n test | grep -c "assertMembership"
```
→ at least `1`. (`make -n test | head -1` was the previous check and proved
nothing — it exits 0 whether or not the guard is a prerequisite. This form
fails if 1d was not applied. `make -n` still only proves the recipe is
*scheduled*; the `probe-exit` check above is what proves it *runs*.)

### Step 2: Stop returning upstream AI-gateway error bodies to Council clients

Edit `workers/llm-council/runner.js` only.

**2a.** Insert a new helper immediately after `classifyError` ends (after the
closing `}` on line 103 at `42826a3`, before the
`// ---------------------------------------------------------------------------`
banner that introduces the system prompts):

```js
const UPSTREAM_DETAIL_MAX_CHARS = 400;

/**
 * Extract only allow-listed diagnostic fields from an upstream error body.
 *
 * The body comes from a third-party provider and is NOT a safe thing to log
 * wholesale: on some providers it echoes part of the request, which for this
 * product means user question text and retrieved case content. Log the fields
 * an operator actually triages on — type, code, param, and a truncated message
 * — and drop everything else. A body that is a bare string (an HTML error page,
 * a proxy banner) is truncated hard rather than parsed.
 *
 * Retention: these lines go to Cloudflare Workers Trace Events / Logpush and
 * inherit whatever retention the operator configured there. Because the
 * allow-list can still carry a provider-authored `message`, treat
 * `council.upstream_error` as operational data, not as something to forward
 * into a third-party analytics sink.
 */
function redactUpstreamDetail(detail) {
  if (detail == null) return {};
  if (typeof detail === "string") {
    return { detail_text: detail.slice(0, UPSTREAM_DETAIL_MAX_CHARS) };
  }
  const err = (typeof detail === "object" && detail.error) || detail;
  const pick = {};
  for (const key of ["type", "code", "param"]) {
    const value = err?.[key];
    if (typeof value === "string" || typeof value === "number") pick[key] = value;
  }
  if (typeof err?.message === "string") {
    pick.message = err.message.slice(0, UPSTREAM_DETAIL_MAX_CHARS);
  }
  return Object.keys(pick).length ? { detail_fields: pick } : { detail_shape: "unrecognised" };
}

/**
 * Build a client-safe Error for a non-OK upstream gateway response.
 *
 * The Cloudflare AI Gateway / provider body can name models, routing and quota
 * state, so it never becomes part of `err.message`. `err.message` is exactly
 * `HTTP <status>` — which is what classifyError() matches on ("http 4" /
 * "http 5"), and what ends up in the user-visible opinions[].error string and
 * in the SSE <provider>.error event. An allow-listed, truncated projection of
 * the body is logged instead, so an operator can still triage a 429 or a model
 * rename without the raw body reaching either the client or the log.
 *
 * `err.upstreamDetail` carries the same redacted projection — deliberately not
 * the raw body, so that a future handler that decides to surface the Error
 * cannot re-open the leak this function exists to close.
 */
function upstreamGatewayError(status, detail, context = {}) {
  let redacted;
  try {
    redacted = redactUpstreamDetail(detail);
  } catch (_) {
    redacted = { detail_shape: "unserializable" };
  }
  logCouncilEvent({ event: "council.upstream_error", status, ...context, ...redacted });
  const err = new Error(`HTTP ${status}`);
  err.upstreamStatus = status;
  err.upstreamDetail = redacted;
  return err;
}
```

**2b.** Replace **all four** occurrences of this exact line (it is byte-identical
at lines 317, 1376, 1554 and 1698, six leading spaces each — use a
replace-all edit):

```js
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(detail).slice(0, 800)}`);
```

with:

```js
      throw upstreamGatewayError(res.status, detail, { model });
```

`model` is a destructured parameter of all four enclosing functions
(`gatewayChatCompletion`, `streamGatewayChatCompletion`,
`streamAnthropicNative`, `streamGeminiNative`) — verified at `42826a3`.

Do **not** change lines 512, 527, 809, 1192, 1898, 1907 or 2035. They already
render `String(err)`, which now yields `Error: HTTP 429` instead of
`Error: HTTP 429: {…}`. That is the whole fix.

**Verify**:

```bash
git grep -c -- 'throw upstreamGatewayError(res.status, detail, { model });' -- workers/llm-council/runner.js
```
→ `4`

```bash
git grep -c -- 'JSON.stringify(detail).slice(0, 800)' -- workers/llm-council/runner.js; echo "exit=$?"
```
→ no output, `exit=1`. **Zero, not one.** (An earlier draft of this plan
expected `1` on the theory that the helper kept the same truncation
expression. It does not: the helper never calls
`JSON.stringify(detail).slice(...)` — it slices individual allow-listed fields.
Any remaining occurrence means a `throw` site was missed.)

The greps above only prove the text changed. The behaviour is proved by the
Step 3 tests — in particular `keeps the upstream body out of the thrown Error
message` and the truncation case. Do not treat the grep alone as evidence.

```bash
cd workers && npx vitest run
```
→ `WK_BEFORE` passed, 0 failed — **unchanged**, because Step 2 adds no test.
In particular `llm-council-runner.test.js` must still pass: its failure
assertions are `expect(openaiOp.error).toBeTruthy()` and retry-count behaviour,
neither of which depends on the message body.

### Step 3: Add the upstream-redaction regression test

Create `workers/__tests__/llm-council-upstream-redaction.test.js`:

```js
/**
 * Regression test for the upstream-error redaction contract.
 *
 * Before this contract existed, a provider 4xx/5xx body (model names, routing,
 * quota state) was embedded in opinions[].error and returned to the browser
 * inside an ordinary 200 Council response. The body must now reach the logs
 * and nothing else.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runCouncil, gatewayChatCompletion } from "../llm-council/runner.js";

const SECRET_MARKER = "quota-exhausted-for-account-acct_1234567890";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const mockEnv = {
  CF_AIG_TOKEN: "test-token-abc",
  CF_GATEWAY_URL: "https://gateway.example.com/v1/chat",
};

function upstream429() {
  return makeResponse({ error: { message: SECRET_MARKER, type: "insufficient_quota" } }, 429);
}

describe("upstream gateway errors are redacted before they reach a client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the upstream body out of the thrown Error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    let caught;
    try {
      await gatewayChatCompletion({
        env: mockEnv,
        model: "openai/gpt-5-mini",
        systemPrompt: "system",
        userPrompt: "user",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe("HTTP 429");
    expect(String(caught)).not.toContain(SECRET_MARKER);
    // A redacted projection survives on the Error for operators, never the
    // raw body, and never in the message.
    expect(caught.upstreamStatus).toBe(429);
    expect(caught.upstreamDetail).toEqual({
      detail_fields: { type: "insufficient_quota", message: SECRET_MARKER },
    });
  });

  it("keeps non-allow-listed body fields out of the log and the Error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse(
        {
          error: { message: "over quota", type: "insufficient_quota" },
          echoed_prompt: "APPLICANT-PII-SHOULD-NEVER-BE-LOGGED",
        },
        429,
      ),
    );

    await gatewayChatCompletion({
      env: mockEnv,
      model: "openai/gpt-5-mini",
      systemPrompt: "system",
      userPrompt: "user",
    }).catch(() => {});

    const logged = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).not.toContain("APPLICANT-PII-SHOULD-NEVER-BE-LOGGED");
    expect(logged).toContain("insufficient_quota");
  });

  it("truncates a long provider message before it reaches the log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const long = "z".repeat(5000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({ error: { message: long, type: "server_error" } }, 500),
    );

    let caught;
    try {
      await gatewayChatCompletion({
        env: mockEnv,
        model: "openai/gpt-5-mini",
        systemPrompt: "system",
        userPrompt: "user",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught.upstreamDetail.detail_fields.message).toHaveLength(400);
    const entry = logSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .find((e) => e && e.event === "council.upstream_error");
    expect(entry.detail_fields.message).toHaveLength(400);
  });

  it("keeps the upstream body out of the 200 runCouncil response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    const result = await runCouncil({ env: mockEnv, question: "Redaction check" });

    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    expect(result.opinions).toHaveLength(3);
    for (const opinion of result.opinions) {
      expect(opinion.success).toBe(false);
      expect(opinion.error).toContain("HTTP 429");
      expect(opinion.error).not.toContain(SECRET_MARKER);
    }
  });

  it("still logs the allow-listed upstream fields so operators do not lose the signal", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    await runCouncil({ env: mockEnv, question: "Redaction logging check" });

    const events = logSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((entry) => entry && entry.event === "council.upstream_error");

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].status).toBe(429);
    expect(events[0].detail_fields.type).toBe("insufficient_quota");
    // The provider's `message` IS allow-listed (it is what an operator triages
    // on) — the marker is a quota string here, not user content. The
    // non-allow-listed-field case is covered by its own test above.
    expect(events[0].detail_fields.message).toBe(SECRET_MARKER);
  });

  it("still classifies a redacted 429 as a non-retryable client error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    await runCouncil({ env: mockEnv, question: "Retry policy check" });

    // 3 experts + 1 moderator, each attempted exactly once: a 4xx is not
    // retried, which only holds if classifyError still sees "http 4".
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
```

**Verify**:

```bash
cd workers && npx vitest run __tests__/llm-council-upstream-redaction.test.js
```
→ `6 passed`, 0 failed.

```bash
cd workers && npx vitest run
```
→ `WK_BEFORE + 6` passed, 0 failed.

### Step 4: Add request correlation ids and an access log to the Worker entrypoint

Edit `workers/cloudflare-native.js` only. This is the highest-risk step in the
plan — it sits on the entire production request path — so it is deliberately
structured as **two tiny edits with no code movement and no re-indentation**.

**4a.** Add two imports after the existing import block (after
`import { dispatchCloudflarePipelineControl } from "./pipeline/control_handlers.js";`,
line 29 at `42826a3`):

```js
import { extractToken } from "./auth/request_auth.js";
import { verifyJwt } from "./auth/jwt.js";
```

**4b.** Add three module-level helpers immediately after the existing
`function unavailable(error, code = "cloudflare_route_unavailable") { … }`
block (which ends at line 164 at `42826a3`, just before `async function dispatchAuth`):

```js
/**
 * Per-request correlation id.
 *
 * Cloudflare's Workers Trace Events dataset already groups every console line
 * from one invocation together with that invocation's URL, method, status and
 * timing, so this id is not what makes the logs joinable — it is what a user
 * can quote from a request that failed. `cf-ray` is preferred so the id matches
 * the one Cloudflare itself recorded; randomUUID() covers `wrangler dev` and
 * tests, where no Ray ID exists.
 */
function requestIdFor(request) {
  const ray = request.headers.get("cf-ray");
  if (ray) return ray;
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `rid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function withRequestId(response, requestId) {
  try {
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (_) {
    // Responses handed back by env.ASSETS.fetch() have immutable headers.
    const copy = new Response(response.body, response);
    copy.headers.set("X-Request-Id", requestId);
    return copy;
  }
}

/**
 * Application-level attribution for the access log.
 *
 * Cloudflare records the URL, status and timing of every invocation; what it
 * cannot know is which tenant and user a request belonged to — and that is the
 * per-tenant activity monitoring this Worker's structured logs are supposed to
 * support. The token is *verified*, never merely decoded, so a forged
 * Authorization header cannot write an arbitrary tenant id into the logs.
 * Never throws: a logging path must not be able to fail a request.
 */
async function accessLogPrincipal(request, env) {
  if (env.AUTH_ENABLED === "false") return {};
  try {
    const token = extractToken(request);
    if (!token) return {};
    const result = await verifyJwt(token, env);
    if (!result.valid || !result.payload) return {};
    if (result.payload.type === "refresh") return {};
    return {
      user_id: result.payload.sub || null,
      tenant_id: result.payload.tenant_id || null,
    };
  } catch (_) {
    return {};
  }
}
```

**4c.** Change **one line** — line 190 at `42826a3`, `export default {` — to:

```js
// The dispatch object. It is wrapped by the default export below so that every
// response picks up an X-Request-Id and every API request produces one access
// line. Deliberately no try/catch anywhere in the wrapper: an unhandled
// rejection must still surface as an unhandled rejection.
const handlers = {
```

**4d.** Append the new default export at the very end of the file, after the
closing `};` on line 246:

```js

export default {
  queue: handlers.queue,
  async fetch(request, env, ctx) {
    const requestId = requestIdFor(request);
    const startedAt = Date.now();
    const { pathname } = new URL(request.url);
    // Static-asset fetches are deliberately not logged: Trace Events already
    // carry their URL and status, and they would dominate Logpush volume.
    const logged = pathname.startsWith("/api/") || pathname === "/health";
    let response;
    let failure = null;
    try {
      response = await handlers.fetch(request, env, ctx);
    } catch (err) {
      // Record, then RE-THROW unchanged. This is not an error-handling
      // try/catch and must never become one: plans/005 requires an unhandled
      // rejection to keep surfacing as an unhandled rejection, and Cloudflare
      // still produces its own 500 for this request. Without this branch a
      // failing request produced NO access line at all, which is the one case
      // an operator most needs to find.
      failure = err;
    }
    if (logged) {
      const principal = await accessLogPrincipal(request, env);
      console.log(JSON.stringify({
        event: "cloudflare.request",
        request_id: requestId,
        method: request.method,
        path: pathname,
        // No Response exists on the throw path, so there is no status to
        // report and no header to attach — see outcome.
        status: failure ? null : response.status,
        outcome: failure ? "handler_threw" : "ok",
        error: failure ? String(failure?.message || failure).slice(0, 200) : undefined,
        duration_ms: Date.now() - startedAt,
        ...principal,
      }));
    }
    if (failure) throw failure;
    return withRequestId(response, requestId);
  },
};
```

Make **no other change**. In particular: do not move, re-indent, or edit the
body of `handlers.fetch`; do not remove the existing
`export { AuthNonce } …` / `export { CouncilSessionDO } …` lines at 31-32. The
`handlers.fetch` body uses no `this` (verified), so calling it as
`handlers.fetch(...)` is safe.

**On the `try/catch` and `plans/005`.** That plan forbids an outer try/catch
that would "mask exactly the bug this plan fixes". This one masks nothing: it
binds the error, emits one log line, and rethrows the *same* object. The
runtime still sees an unhandled rejection with the original stack. What it must
never become is a `catch` that returns a Response — that would swallow the bug
`plans/005` is chasing. If you find yourself writing
`return new Response(..., { status: 500 })` inside that catch, stop.

**Honest scope of the header.** A thrown request gets an access line but **no**
`X-Request-Id`, because there is no Response to attach one to. Synthesising a
500 here to carry the header would be exactly the masking `plans/005` forbids,
so it is deliberately not done. State this limitation wherever the feature is
described; do not claim "every response carries X-Request-Id" without the
qualifier.

**Verify**:

```bash
grep -c "^const handlers = {$" workers/cloudflare-native.js
```
→ `1`

```bash
grep -c "^export default {$" workers/cloudflare-native.js
```
→ `1`

```bash
node --check workers/cloudflare-native.js
```
→ exit 0, no output.

```bash
cd workers && npx vitest run __tests__/cloudflare-native-entry.test.js __tests__/cloudflare-native-queue.test.js __tests__/cloudflare-native-auth-handlers.test.js
```
→ all pass, 0 failed. (These call `worker.fetch(...)` and `worker.queue(...)`
directly; they exercise the new wrapper.)

```bash
cd workers && npx vitest run
```
→ `WK_BEFORE + 6` passed (Step 3's six only; Step 4 adds no test of its own),
0 failed.

### Step 5: Cover the request id and access-log attribution

Create `workers/__tests__/cloudflare-native-observability.test.js`:

```js
/**
 * Request-correlation contract for the production Worker entrypoint.
 *
 * Cloudflare Trace Events already group one invocation's console lines; what
 * this covers is the part Cloudflare cannot supply — an id echoed back to the
 * caller, and tenant/user attribution derived from a *verified* token.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCaseRead = vi.fn();
const mockCouncil = vi.fn();
const noop = vi.fn();

vi.mock("../case-api/cloudflare.js", () => ({
  dispatchCloudflareCaseRead: (...args) => mockCaseRead(...args),
}));
vi.mock("../llm-council/cloudflare_handlers.js", () => ({
  dispatchCloudflareCouncil: (...args) => mockCouncil(...args),
}));
vi.mock("../auth/cloudflare_handlers.js", () => ({
  handleTelegramLogin: (...args) => noop(...args),
  handleTelegramCallback: (...args) => noop(...args),
  handleBootstrapLogin: (...args) => noop(...args),
  handleAuthMe: (...args) => noop(...args),
  handleAuthLogout: (...args) => noop(...args),
  handleAuthRefresh: (...args) => noop(...args),
  handleAuthSwitchTenant: (...args) => noop(...args),
}));

import worker from "../cloudflare-native.js";
import { signJwt } from "../auth/jwt.js";

const baseEnv = {
  IMMI_STORAGE_MODE: "cloudflare",
  JWT_SECRET_CURRENT: "test-secret-value-for-observability",
  JWT_KID_CURRENT: "kid-test",
};

let logSpy;

beforeEach(() => {
  vi.clearAllMocks();
  mockCaseRead.mockResolvedValue(null);
  mockCouncil.mockResolvedValue(null);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function accessLines() {
  return logSpy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter((entry) => entry && entry.event === "cloudflare.request");
}

describe("Worker request correlation", () => {
  it("echoes the Cloudflare Ray ID back as X-Request-Id", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    const response = await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "8abc123def456789-SYD" } }),
      baseEnv,
    );
    expect(response.headers.get("X-Request-Id")).toBe("8abc123def456789-SYD");
    expect(await response.text()).toBe("case-data");
  });

  it("generates an id when there is no Ray ID", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    const response = await worker.fetch(new Request("https://immi.example/api/v1/cases"), baseEnv);
    const id = response.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("emits exactly one access line carrying method, path, status and duration", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data", { status: 200 }));
    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "ray-1" } }),
      baseEnv,
    );
    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      request_id: "ray-1",
      method: "GET",
      path: "/api/v1/cases",
      status: 200,
    });
    expect(typeof lines[0].duration_ms).toBe("number");
  });

  it("attributes the access line to the verified token's user and tenant", async () => {
    const token = await signJwt(
      { sub: "user-abc", tenant_id: "tenant-xyz", exp: Math.floor(Date.now() / 1000) + 300 },
      baseEnv,
    );
    mockCaseRead.mockResolvedValue(new Response("case-data"));

    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { Authorization: `Bearer ${token}` } }),
      baseEnv,
    );

    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].user_id).toBe("user-abc");
    expect(lines[0].tenant_id).toBe("tenant-xyz");
  });

  it("does not attribute a forged token", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { Authorization: "Bearer not.a.jwt" } }),
      baseEnv,
    );
    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].user_id).toBeUndefined();
    expect(lines[0].tenant_id).toBeUndefined();
  });

  it("covers /health but not static assets", async () => {
    await worker.fetch(new Request("https://immi.example/health"), baseEnv);
    expect(accessLines()).toHaveLength(1);

    logSpy.mockClear();
    const assetResponse = await worker.fetch(new Request("https://immi.example/app/cases"), {
      ...baseEnv,
      ASSETS: { fetch: async () => new Response("<html></html>", { status: 200 }) },
    });
    expect(accessLines()).toHaveLength(0);
    expect(assetResponse.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("still logs — and still rethrows — when the handler throws", async () => {
    // The regression this covers: the first draft of the wrapper awaited
    // handlers.fetch() with no catch, so a throwing handler produced NO access
    // line at all — the one case an operator most needs to find.
    const boom = new Error("dispatcher exploded");
    mockCaseRead.mockRejectedValue(boom);

    await expect(
      worker.fetch(
        new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "ray-boom" } }),
        baseEnv,
      ),
    ).rejects.toBe(boom); // same object, unwrapped — plans/005 depends on this

    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      request_id: "ray-boom",
      path: "/api/v1/cases",
      outcome: "handler_threw",
      status: null,
    });
    expect(lines[0].error).toContain("dispatcher exploded");
  });
});
```

**Verify**:

```bash
cd workers && npx vitest run __tests__/cloudflare-native-observability.test.js
```
→ `7 passed`, 0 failed.

```bash
cd workers && npx vitest run
```
→ `WK_BEFORE + 13` passed (6 from Step 3 + 7 here), 0 failed.

### Step 6: Make design-token validation fatal under `--strict`

Edit `frontend/scripts/build-tokens.ts` only. Three edits.

**6a.** After the `const tokensPath = …` line (line 12 at `42826a3`), insert:

```ts
// `--strict` (used by `make tokens-check`) turns the advisory validation
// warnings below into a non-zero exit, so a malformed token cannot reach a
// build unnoticed. Without the flag the behaviour is unchanged.
const STRICT = process.argv.includes("--strict");
```

**6b.** Route the dark/light symmetry warnings into `validationWarnings` so
`--strict` actually covers them. Replace lines 112-116 at `42826a3`:

```ts
    if (!(key in dark)) {
      console.warn(
        `⚠ WARN: ${prefix}.dark.${key.replace(prefix + ".", "")} is missing (exists in light mode)`,
      );
    } else if (
```

with:

```ts
    if (!(key in dark)) {
      const message = `${prefix}.dark.${key.replace(prefix + ".", "")} is missing (exists in light mode)`;
      console.warn(`⚠ WARN: ${message}`);
      validationWarnings.push(`  WARN ${message}`);
    } else if (
```

(`validationWarnings` is declared at line 64; `validateDarkLightSymmetry` is
first called at line 128, well after that, so there is no temporal-dead-zone
problem.)

**6c.** Append at the very end of the file, after the closing `}` on line 415:

```ts

if (STRICT && validationWarnings.length > 0) {
  console.error(
    `✗ --strict: ${validationWarnings.length} token validation warning(s); refusing to report success.`,
  );
  process.exitCode = 1;
}
```

Use `process.exitCode = 1`, **not** `process.exit(1)` — the latter can truncate
buffered stdout.

**Verify**:

```bash
cd frontend && npm run tokens -- --strict
```
→ prints `✓ tokens.css generated` and `✓ tokens.ts generated`, no `✗ --strict`
line, exit 0. (Verified at `42826a3`: `tokens.json` produces zero warnings of
any kind, so strict mode is clean today.)

```bash
git diff --stat -- frontend/src/tokens/
```
→ no output (regeneration is a no-op; the committed artifacts are in sync).

```bash
cd frontend && npm run lint
```
→ exit 0, still `0 errors`.

### Step 7: Add `make tokens-check` and gate `make test-fe` on it

Edit `Makefile` only.

**7a.** Add the target in the "Testing" section, immediately after the
`test-workers:` recipe:

```make
# Design-token freshness. `npm run dev|build|build:cloudflare` all regenerate
# tokens first, so production and the dev server are never stale — but
# `npx vitest run` does not, so a tokens.json edit committed without
# regenerating leaves the frontend suite asserting against stale token values.
#
# NON-DESTRUCTIVE BY CONSTRUCTION. build-tokens.ts writes to fixed paths, so
# this target snapshots the two generated files, regenerates, compares, and
# then RESTORES the snapshot unconditionally. A check that rewrites the
# working tree on failure is not a check — and because `test-fe` depends on
# this, `make test` would otherwise be able to modify tracked files.
# Regenerating for real is `make tokens-fix`, which is explicit about it.
tokens-check:
	@cd "$(REPO_ROOT)/frontend" || exit 1; \
	SNAP=$$(mktemp -d) || exit 1; \
	trap 'cp -p "$$SNAP/tokens.css" src/tokens/tokens.css 2>/dev/null; \
	      cp -p "$$SNAP/tokens.ts"  src/tokens/tokens.ts  2>/dev/null; \
	      rm -rf "$$SNAP"' EXIT INT TERM; \
	cp -p src/tokens/tokens.css src/tokens/tokens.ts "$$SNAP/" || exit 1; \
	BEFORE=$$(cat src/tokens/tokens.css src/tokens/tokens.ts | shasum -a 256 | cut -d' ' -f1); \
	npm run --silent tokens -- --strict || exit 1; \
	AFTER=$$(cat src/tokens/tokens.css src/tokens/tokens.ts | shasum -a 256 | cut -d' ' -f1); \
	if [ "$$BEFORE" != "$$AFTER" ]; then \
	  echo "ERROR: frontend/src/tokens/{tokens.css,tokens.ts} are stale relative to tokens.json."; \
	  echo "       The working tree was left UNCHANGED. Run 'make tokens-fix', review the diff, and commit."; \
	  exit 1; \
	else echo "OK: generated design tokens match tokens.json"; fi

# The write half, deliberately separate and never a prerequisite of anything.
tokens-fix:
	cd "$(REPO_ROOT)/frontend" && npm run tokens -- --strict
	@echo "Regenerated frontend/src/tokens/. Review 'git diff -- frontend/src/tokens/' and commit."
```

**7b.** Make the frontend suite depend on it. Change:

```make
test-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run
```

to:

```make
test-fe: tokens-check
	cd "$(REPO_ROOT)/frontend" && npx vitest run
```

**7c.** In `help:`, after the `make test-e2e` line, add:

```make
	@echo "  make tokens-check Verify frontend/src/tokens/ is in sync with tokens.json (read-only)"
	@echo "  make tokens-fix   Regenerate frontend/src/tokens/ from tokens.json"
```

**7d.** Add both to the `.PHONY` line alongside the tokens targets already
added in Step 1a (`tokens-check` was listed there; add `tokens-fix`).

**Verify**:

```bash
make tokens-check
git status --short -- frontend/src/tokens/
```
→ `OK: generated design tokens match tokens.json`, exit 0, then **no output**
from `git status`.

**The check must be able to fail, and must fail without touching the tree.**
Perturb a generated file, confirm the failure, confirm restoration:

```bash
cp -p frontend/src/tokens/tokens.css /tmp/tokens.css.orig
printf '\n/* deliberate staleness probe */\n' >> frontend/src/tokens/tokens.css
make tokens-check; echo "probe-exit=$?"
git diff --stat -- frontend/src/tokens/tokens.css     # must still show the probe line, nothing more
cp -p /tmp/tokens.css.orig frontend/src/tokens/tokens.css && rm -f /tmp/tokens.css.orig
make tokens-check; echo "clean-exit=$?"
git status --short -- frontend/src/tokens/
```
→ `probe-exit` is non-zero with the `ERROR: … stale …` line; the `git diff`
shows **only** your probe line, proving the target did not overwrite the file;
then `clean-exit=0` and `git status` is empty.

```bash
make test-fe
```
→ the `OK: generated design tokens…` line, then the frontend suite at
`FE_BEFORE` passed, exit 0, and `git status --short -- frontend/` still empty.

### Step 8: Pin the ruff rule selection in `ruff.toml`

**Before you start**, record the baseline:

```bash
.venv/bin/ruff check . 2>&1 | tail -1
```

Note the exact last line (at `42826a3` it is `Found 43 errors.`; if
`plans/003` has already landed it will be `All checks passed!`). Call this
value **B**.

Create `ruff.toml` at the repo root:

```toml
# Ruff configuration for IMMI-Case.
#
# Why this file exists: requirements-test.txt pins ruff at 0.15.18 precisely
# because "0.16 expanded default rules (394 new findings)". Relying on ruff's
# *implicit* defaults means the lint gate silently changes meaning whenever
# that pin moves. Selecting the rules explicitly makes the gate a property of
# this repo instead of a property of the installed ruff version.
#
# The selection below reproduces ruff 0.15.18's own defaults exactly. Verified
# at commit 42826a3: `ruff check .` and `ruff check . --select E4,E7,E9,F` both
# report the identical 43 findings, and `ruff check immi_case_downloader/
# scripts/ *.py` (what `make lint` runs) passes under both. Adopting this file
# therefore changes no current result; it only freezes them.

target-version = "py314"
line-length = 100

[lint]
select = ["E4", "E7", "E9", "F"]

# `ruff format` is deliberately NOT wired into any gate. This repo has never
# been formatted, so a first pass would rewrite nearly every Python file and
# bury real history under a whitespace commit. These settings exist so that
# decision is already made when someone schedules that pass.
[format]
quote-style = "double"
indent-style = "space"
line-ending = "lf"
```

`line-length` is inert for the selected rules — `E501` (line-too-long) lives in
`E5`, which is not selected — so it only takes effect if someone runs
`ruff format`.

**Verify**:

```bash
.venv/bin/ruff check . 2>&1 | tail -1
```
→ **identical to B** (= `RUFF_BEFORE`). If the count changed, revert
`ruff.toml` and STOP.

```bash
.venv/bin/ruff check immi_case_downloader/ scripts/ *.py
```
→ `All checks passed!`, exit 0.

```bash
.venv/bin/ruff check --show-settings . 2>&1 | grep -c 'py314'
```
→ at least `1`. (The previous form grepped for the *word* `target_version` and
accepted "any non-empty line", which matches whether or not `ruff.toml` was
read — ruff prints that key from its defaults too. Matching the configured
**value** `py314` is what actually distinguishes "file picked up" from "file
ignored". If your ruff build formats the value differently, find the real
string in the full `--show-settings` output and assert on that, not on the key
name.)

### Step 9: Add `.editorconfig`

Create `.editorconfig` at the repo root. These values match the styles already
in the tree (Python 4 spaces, TS/JS/JSON/YAML 2 spaces, Makefile tabs).
EditorConfig is advisory to editors; it rewrites nothing.

```ini
# https://editorconfig.org
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4

[*.{md,markdown}]
# Markdown uses trailing double-space for hard line breaks.
trim_trailing_whitespace = false

[Makefile]
indent_style = tab

[*.{mk,mak}]
indent_style = tab
```

**Verify**:

```bash
test -f .editorconfig && grep -c "indent_style = tab" .editorconfig
```
→ `2`

```bash
.venv/bin/ruff check immi_case_downloader/ scripts/ *.py && make audit-tenant-guards
```
→ both exit 0 (confirms nothing about the build reads `.editorconfig`).

### Step 10: Add an opt-in pre-commit gate

**10a.** Create `.pre-commit-config.yaml` at the repo root:

```yaml
# Local pre-commit gate for IMMI-Case.
#
# Both hooks use `language: system`, so pre-commit runs the tools this repo
# already installs (.venv/bin/ruff, and eslint from frontend/node_modules)
# rather than building isolated environments of its own. That keeps hook
# behaviour identical to `make lint` and `npm run lint` — a hook that
# disagrees with the gate it mirrors is worse than no hook.
#
# Install with: make hooks
minimum_pre_commit_version: "3.5.0"

repos:
  - repo: local
    hooks:
      - id: ruff
        name: ruff check (python)
        language: system
        entry: .venv/bin/ruff check --force-exclude
        types_or: [python, pyi]

      - id: eslint
        name: eslint (frontend)
        language: system
        # pass_filenames is false because the flat ESLint config lives in
        # frontend/, so the hook must change directory — at which point the
        # repo-root-relative paths pre-commit would pass no longer resolve.
        pass_filenames: false
        files: ^frontend/(src|scripts)/.*\.(ts|tsx)$
        entry: sh -c 'cd frontend && npx --no-install eslint .'
```

**10b.** Add the installer to `Makefile`, in the "Setup" section immediately
after the `install:` recipe:

```make
# Opt-in on purpose: `make install` must stay deterministic and offline-safe,
# and a git hook that appears without the contributor asking for it is a
# surprise, not a service.
hooks:
	"$(PYTHON)" -m pip install pre-commit
	"$(PYTHON)" -m pre_commit install
	@echo "Installed .git/hooks/pre-commit (ruff + eslint). Remove with: $(PYTHON) -m pre_commit uninstall"
```

**10c.** In `help:`, after the `make install` line, add:

```make
	@echo "  make hooks        Install the pre-commit gate (ruff + eslint)"
```

**10d.** Commit the config *before* verifying — pre-commit refuses to run
against an unstaged configuration file:

```bash
git add .pre-commit-config.yaml Makefile && git commit -m "chore: add an opt-in pre-commit gate"
```

**Verify**:

```bash
make hooks
```
→ installs `pre-commit` into `.venv` and prints
`pre-commit installed at .git/hooks/pre-commit`, exit 0.

```bash
.venv/bin/pre-commit validate-config .pre-commit-config.yaml
```
→ exit 0, no output.

```bash
.venv/bin/pre-commit run ruff --files immi_case_downloader/models.py
```
→ `ruff check (python)...........................................Passed`

```bash
.venv/bin/pre-commit run eslint --files frontend/src/App.tsx
```
→ `eslint (frontend)............................................Passed`
(eslint emits 25 warnings but exits 0, so the hook passes.)

If `make hooks` cannot reach the network, that is a STOP condition — report it
rather than hand-writing a hook script.

### Step 11: Anchor the `dashboard.png` ignore rule

Edit `.gitignore` only. Replace lines 78-81 at `42826a3`:

```
# Misc artifacts
dashboard.png
=1.0.0
=2.0.0
```

with:

```
# Local scratch screenshot at the repo root. Anchored deliberately: an
# unanchored `dashboard.png` matches at ANY depth, and was silently hiding
# audit/ui/dashboard.png from `git status` entirely.
/dashboard.png

# Stray files left by a mistyped shell redirect (`pip install foo >=1.0.0`).
# The files still exist at the repo root; these entries keep them out of git.
=1.0.0
=2.0.0
```

**Do NOT add an `/audit/` rule.** An earlier draft of this plan anchored
`dashboard.png` and then added `/audit/` in the same edit — which re-hides
`audit/ui/dashboard.png` through a different rule and cancels the entire point
of the change. The visibility of that file is the *outcome*, not a side effect
to be tidied away.

Consequence you must expect and must not "fix": after this edit,
`audit/ui/dashboard.png` appears as a new untracked path in `git status`. That
is correct. It has been invisible; now the operator can see it and decide.
Report it in your hand-off with the two options (commit it as a tracked audit
artefact, or add a *deliberate, commented* ignore rule for the audit output
directory) and let them choose. Do not choose for them, and do not delete it.

**Verify**:

```bash
git check-ignore -v design/exports/dashboard.png; echo "rc=$?"
```
→ no output, `rc=1` (a design asset with that name is no longer swallowed).

```bash
git check-ignore -v audit/ui/dashboard.png; echo "rc=$?"
```
→ no output, `rc=1`. **This is the assertion that proves the fix landed.** If
it prints a `.gitignore` line, some rule is still hiding the file and the edit
achieved nothing.

```bash
git check-ignore -v dashboard.png
```
→ `.gitignore:<n>:/dashboard.png	dashboard.png` (the root file is still ignored).

```bash
git status --short
```
→ the files this plan modified, **plus** `?? audit/` — that new entry is the
expected result of the fix, not a scope violation.

## Test plan

New tests, both in new files so no parallel plan's test file is touched:

1. `workers/__tests__/llm-council-upstream-redaction.test.js` — 6 tests:
   - the thrown `Error.message` is exactly `HTTP 429` and `String(err)` does not
     contain the upstream body, while `err.upstreamDetail` carries the
     **redacted projection** (the operator path survives, the raw body does not);
   - non-allow-listed body fields (e.g. an echoed prompt) reach neither the log
     nor the Error, while the allow-listed `type` still does;
   - a 5,000-character provider `message` is truncated to 400 in both the Error
     and the log line;
   - `JSON.stringify(runCouncil(...))` contains no upstream body, and every
     `opinions[].error` says `HTTP 429` and nothing more;
   - a `council.upstream_error` structured log **is** emitted carrying status
     and the allow-listed fields (redaction must not become a blind spot);
   - the redacted 429 is still classified non-retryable — exactly 4 fetches for
     3 experts + 1 moderator, which only holds while `classifyError` can still
     see `http 4`.
2. `workers/__tests__/cloudflare-native-observability.test.js` — 7 tests:
   `cf-ray` echoed as `X-Request-Id`; a generated id when absent; exactly one
   `cloudflare.request` access line with method/path/status/duration_ms;
   verified-token attribution (`user_id`, `tenant_id`); **no** attribution from
   a forged token; `/health` logged, static assets not logged but still
   carrying `X-Request-Id`; and a throwing handler that still emits one access
   line (`outcome: "handler_threw"`, `status: null`) while rethrowing the
   identical Error object.

Structural patterns to copy: `workers/__tests__/llm-council-runner.test.js`
(lines 31-53 for `makeResponse` / `mockEnv`) and
`workers/__tests__/cloudflare-native-entry.test.js` (lines 1-37 for the
`vi.mock` layout and the `import worker from "../cloudflare-native.js"` idiom).

No new Python or frontend tests: this plan changes no Python behaviour, and the
only frontend change (`build-tokens.ts`) is a build script that
`frontend/tsconfig.node.json` does not even include — it is covered by
`make tokens-check` instead.

Full-suite verification — **deltas against the baselines recorded in "Commands
you will need", never absolute totals**:

```bash
cd workers && npx vitest run          # WK_BEFORE + 13 passed, 0 failed
cd frontend && npx vitest run         # FE_BEFORE passed, unchanged
cd frontend && npx tsc -b --noEmit    # exit 0
cd frontend && npm run lint           # exit 0, 0 errors, warning count = LINT_BEFORE
make test-py                          # PY_BEFORE passed; failure set identical to PY_FAIL_BEFORE
                                      # (still exactly the three pypdf ImportErrors in
                                      #  tests/test_backfill_judge_overrides_from_pdf.py, by name)
.venv/bin/ruff check immi_case_downloader/ scripts/ *.py   # All checks passed!
.venv/bin/ruff check . 2>&1 | tail -1 # byte-identical to RUFF_BEFORE
make audit-tenant-guards              # OK: … (module granularity only)
make tokens-check                     # OK: …  AND git status -s -- frontend/src/tokens/ empty
```

## Done criteria

All must hold:

- [ ] `git grep -c -- audit-rls-guards -- Makefile` returns no output (exit 1)
- [ ] `make audit-tenant-guards` exits 0 and prints
      `OK: every authenticating Worker module reaches assertMembership() (module granularity only)`
- [ ] The Step 1 failure probe (`workers/zz-guard-probe.js`) made
      `make audit-tenant-guards` exit non-zero, and the probe file was deleted
- [ ] `make -n test | grep -c "assertMembership"` → at least `1`
      (the guard is wired into `make test`)
- [ ] `git grep -c -- 'throw upstreamGatewayError(res.status, detail, { model });' -- workers/llm-council/runner.js` → `4`
- [ ] `git grep -c -- 'JSON.stringify(detail).slice(0, 800)' -- workers/llm-council/runner.js` returns no output (exit 1) — **zero occurrences**
- [ ] `node --check workers/cloudflare-native.js` exits 0
- [ ] `cd workers && npx vitest run __tests__/llm-council-upstream-redaction.test.js` → `6 passed`
- [ ] `cd workers && npx vitest run __tests__/cloudflare-native-observability.test.js` → `7 passed`
- [ ] `cd workers && npx vitest run` → `WK_BEFORE + 13` passed, 0 failed
- [ ] `cd frontend && npx vitest run` → `FE_BEFORE` passed, 0 failed
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npm run lint` exits 0 with `0 errors` and the same warning count as `LINT_BEFORE`
- [ ] `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` prints `All checks passed!`
- [ ] `.venv/bin/ruff check . 2>&1 | tail -1` is byte-identical to `RUFF_BEFORE`
- [ ] `make tokens-check` exits 0 and `git status --short -- frontend/src/tokens/`
      is empty; the Step 7 staleness probe made it exit non-zero **without**
      modifying either generated file
- [ ] `make test-py` passed count = `PY_BEFORE`, and
      `make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort` is identical to
      `PY_FAIL_BEFORE` — still exactly the three `pypdf` ImportErrors in
      `tests/test_backfill_judge_overrides_from_pdf.py`, by name
- [ ] `test -f ruff.toml && test -f .editorconfig && test -f .pre-commit-config.yaml`
      exits 0
- [ ] `.venv/bin/pre-commit validate-config .pre-commit-config.yaml` exits 0
- [ ] `git check-ignore -q design/exports/dashboard.png; test $? -eq 1` exits 0
- [ ] `git check-ignore -q audit/ui/dashboard.png; test $? -eq 1` exits 0 — the
      audit screenshot is no longer hidden, and no `/audit/` rule was added
- [ ] `git grep -c -- '^/audit/' -- .gitignore` returns no output (exit 1)
- [ ] `git status --short` lists only files from the In-scope list, plus the
      expected new `?? audit/` entry and any path already dirty at the drift check
- [ ] `plans/README.md` status row updated (if that file exists)

## STOP conditions

Stop and report back — do not improvise — if:

- **Drift.** Any excerpt in "Current state" does not match the live file. In
  particular:
  `grep -c '^      throw new Error(\`HTTP ${res.status}: ${JSON.stringify(detail).slice(0, 800)}\`);$' workers/llm-council/runner.js`
  returns anything other than `4`, or `workers/cloudflare-native.js` no longer
  contains a single top-level `export default {`.
- **The Worker baseline is not clean.** Before Step 2, `cd workers && npx vitest run`
  must report **0 failed**. Whatever the passed count is, that is `WK_BEFORE`
  — record it and continue. **Any failure at all** means stop; do not treat a
  pre-existing failure as "not mine" and proceed.
- **A ruff config already exists.** If `ruff.toml`, `.ruff.toml`,
  `pyproject.toml` or `setup.cfg` is present at the repo root when you reach
  Step 8, a sibling plan added Python config. Do not overwrite or merge it —
  stop and report. (`plans/003-lint-the-test-suite.md` explicitly declares such
  a file out of its own scope, so its presence means something unplanned
  happened.)
- **`ruff.toml` changes the finding count.** If the Step 8 verification does not
  reproduce baseline **B** exactly, delete `ruff.toml` and stop. This file must
  be behaviour-preserving; if it is not, the selection is wrong for the ruff
  version actually installed.
- **`npm run tokens` is not a no-op before you touch anything.** If
  `cd frontend && npm run tokens && git diff --stat -- frontend/src/tokens/`
  shows changes *before* Step 6, the committed generated tokens are already
  stale. That is a separate fix, it invalidates Step 7's expected output, and it
  needs a design review of the diff. Stop.
- **A Council test starts asserting on an error body.** If any existing test in
  `workers/__tests__/llm-council-*.test.js` fails after Step 2 because it
  expected the upstream body in `opinions[].error`, do **not** loosen the fix.
  Stop and report which test — that would mean the leak is a load-bearing
  contract somewhere and needs a decision.
- **`make hooks` cannot reach the network** or `pre-commit` fails to install.
  Report it; do not hand-write a `.git/hooks/pre-commit` script as a substitute.
- **Any verification fails twice** after one reasonable fix attempt.
- **The fix appears to need a file outside the In-scope list** — especially
  `workers/llm-council/cloudflare_handlers.js`, `workers/case-api/*`,
  `workers/auth/*`, `README.md` or `.github/workflows/ci.yml`, all of which
  other plans own.
- **You discover that `classifyError` no longer keys on the `http 4` / `http 5`
  message prefix.** The entire retry policy and Step 2's safety argument rest on
  that; if it has been rewritten, the redaction needs redesigning.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise.** Step 4 sits on the whole production
  request path. Check three things: (a) the wrapper has no `try/catch`, so an
  unhandled rejection still surfaces — `plans/005` depends on that; (b)
  `handlers.fetch` was not re-indented or otherwise edited, so the diff for
  lines 190-246 is exactly two lines; (c) `accessLogPrincipal` *verifies* the
  JWT rather than decoding it, so a forged `Authorization` header cannot write
  an arbitrary `tenant_id` into Logpush.
- **Double JWT verification.** `accessLogPrincipal` verifies the access token a
  second time (the handler already did). HS256 verify is sub-millisecond and
  only runs when a token is present, so this was accepted deliberately. If it
  ever shows up in latency profiles, the fix is to have the handlers publish
  their resolved auth context onto a per-request object rather than to weaken
  the verification.
- **Failed requests get an access line but no `X-Request-Id`.** The wrapper
  catches, logs `outcome: "handler_threw"` with `status: null`, and rethrows the
  identical Error — so the request is findable in Logpush, but there is no
  Response object to hang a header on and this plan deliberately does not
  synthesise one (that would be the masking `plans/005` forbids). If a future
  change wants the header on error responses too, it must first decide who owns
  producing that 500, and it must not swallow the exception to do it.
- **Observability data policy — read before adding a field.** The access line
  carries only `request_id`, `method`, `path`, `status`, `outcome`,
  `duration_ms`, a ≤200-char `error` message, and the verified `user_id` /
  `tenant_id`. It carries **no** query string, **no** request body, and **no**
  case content — several of these routes take a free-text legal question, and
  `path` alone is safe where `url` would not be. `council.upstream_error`
  carries only the allow-listed provider fields (`type`, `code`, `param`, and a
  400-char `message`) via `redactUpstreamDetail`, never the raw body. Both
  streams land in Cloudflare Trace Events / Logpush and inherit whatever
  retention the operator configured there; neither is safe to forward verbatim
  into a third-party analytics sink. If you add a field, ask what it looks like
  when the user pasted their own visa history into the question box.
- **`X-Request-Id` is not surfaced to the user.** It is a response header only.
  A self-represented applicant who hits an error has no way to see or copy it,
  which is most of the value the header was supposed to buy. Displaying it in
  the error UI belongs to `plans/015-surface-frontend-errors.md` (that plan owns
  the frontend error surfaces); the concrete ask is: read
  `response.headers.get("X-Request-Id")` in `frontend/src/lib/api.ts`, carry it
  on the thrown error, and render it as copyable text in the error state. Until
  that lands, do not describe this as "the user can quote an id".
- **CI wiring is deliberately not done here** (`.github/workflows/ci.yml` is
  another plan's territory — see `plans/001`, `plans/002`, `plans/003`, which
  all edit it). **Until it is wired, none of this plan's gates run anywhere but
  a developer's laptop.** Hand these to whoever owns that file:
  - in `test-python`, after "Lint with ruff":
    `- name: Tenant-isolation guard` / `run: make audit-tenant-guards`
  - in `test-frontend`, before "Run Vitest tests":
    `- name: Design-token freshness` / `run: make tokens-check`
    (use the Make target, not a raw `npm run tokens && git diff --exit-code`:
    the target is the non-destructive form, and a raw regenerate-then-diff both
    dirties the runner's tree and misses the `--strict` exit code)
  - in `test-frontend`, the typecheck step must be `npx tsc -b --noEmit`, not
    `npx tsc --noEmit`. The latter loads **zero** files in this repo
    (`frontend/tsconfig.json` is a `files: []` project-references stub) and is a
    false green; `plans/001-restore-the-frontend-compile-gate.md` owns that fix.
- **`.omc/plans/auth-multitenant-jwt-rls.md:24`** still claims
  `✅ workers/db/getSqlAsUser.js + make audit-rls-guards` as acceptance evidence
  for row 4. Both artifacts are now gone. That file is under `.omc/` and out of
  every plan's territory; someone should mark the row superseded by
  `make audit-tenant-guards` when they next touch it.
- **The exemption list will rot.** `AUTH_GUARD_EXEMPT` names
  `workers/auth/handlers.js` and `workers/llm-council/handlers.js`, both retired
  modules that `plans/030` and `plans/004` may delete. The guard is
  deletion-tolerant — a missing file simply never appears in the scan — so the
  stale entries are harmless, but drop them when the files go.
- **Deferred: `ruff format`.** `ruff.toml` carries a `[format]` block but
  nothing runs it. Scheduling the first pass means one whitespace-only commit
  across nearly every Python file; do it as its own commit, immediately after a
  release, and add `--- (formatting only)` to the message so `git blame -w`
  users know to skip it.
- **Deferred: the 41 root-level images.** 106 tracked image files totalling
  12,852 KB, 41 of them loose at the repo root (29 `*.png` + 12 `*.jpeg`).
  Whether `design/exports/` is durable collateral and the `qa-*` / `mobile-*` /
  `guided-search-*` captures are disposable is a maintainer call, not an
  executor's. Do **not** rewrite history for it.
- **Interactions.** If a new authenticated route is added to
  `workers/cloudflare-native.js`, `make audit-tenant-guards` catches it only at
  *module* granularity — a new handler in an already-compliant file slips
  through. `plans/038`'s route-manifest test is the finer-grained complement,
  and is the thing to cite when someone asks "is route X tenant-isolated?".
  This target answers only "does this file know about `assertMembership` at
  all?". The exemption list makes the gap worse in one specific way worth
  knowing: `workers/auth/cloudflare_handlers.js` is exempt as a whole, so a new
  *tenant-scoped* route added to that file would be invisible to the guard.
  When 038 lands, that is the first file its manifest should cover.

## Findings reconsidered

- **DX-09, impact overstated (corrected, then implemented).** The finding
  claimed a user report "carries no id to quote… no way to find their request in
  Logpush: no correlation id, no access log". The second half is wrong:
  Cloudflare's Workers Trace Events dataset already groups every `console` line
  from one invocation with that invocation's URL, method, status, wall/CPU time
  and Ray ID, so per-request correlation and traffic/latency signal exist for
  free. The count is **37** structured-log sites, not 39. What genuinely does
  not exist is (a) application-level tenant/user attribution and (b) an id
  echoed back to the caller — and those are what Steps 4-5 add. This plan
  deliberately does **not** thread `request_id` into the other 36 log sites:
  Trace Events already joins them by invocation, so the field would be
  redundant, and doing it would edit 12 files owned by parallel plans.
- **SEC-11, wrong path (corrected, then implemented).** The finding cited
  `workers/llm-council/cloudflare_handlers.js:189/237/331/359` — the
  `LLM Council error: ${err?.message}` 503 responses — as the leak vector. They
  are not: `runExpert` catches its own errors (`runner.js:476` → `512`) and
  `runModerator` falls back rather than throwing, so those 503s fire only on
  unexpected crashes. The real leak is the truncated upstream body embedded in
  `opinions[].error` and returned inside a **200** response
  (`runner.js:512` → `1171-1196` → `1246`), plus the SSE `<provider>.error`
  event at `runner.js:1898`. Fixing the four `throw` sites closes both at once
  and requires no edit to the handler file, which two sibling plans own.
- **DX-13, `ruff format --check` in `make lint`: not done.** The repo has never
  been formatted; wiring `--check` into the gate without first running the
  formatter would fail on nearly every Python file, and running it would produce
  a blame-polluting whitespace commit across the tree. `ruff.toml` pre-decides
  the format settings and Maintenance notes describe how to schedule the pass.
- **DX-13, Prettier: not done.** `README.md:570` claims
  "TypeScript：ESLint + Prettier（`cd frontend && npm run lint`）" while
  `git ls-files | grep -i prettier` is empty and neither `package.json` mentions
  it. Real defect — but `README.md` is not in this plan's file territory, and
  the verifier noted the false claim is already carried by finding DX-20.
- **DX-13, pre-commit installed by `make install`: not done.** The finding asked
  for the hooks to be "installed by `make install`". `make install` is the first
  command a new contributor runs and must stay deterministic and offline-safe;
  `pre-commit install` needs a network fetch and silently rewrites
  `.git/hooks/pre-commit`. A dedicated `make hooks` target (Step 10) gets the
  same adoption at one command's cost, without the surprise.
- **DX-18, impact overstated (corrected, then implemented).** The finding
  claimed "stale committed tokens cannot reach production or the dev server" was
  in doubt. It is not: `frontend/package.json:8/9/10` show `dev`, `build` and
  `build:cloudflare` all prefixed with `npm run tokens`, so every dev server and
  every deployed bundle regenerates from `tokens.json`. The genuine residual
  exposure is narrower — `npx vitest run` does not regenerate, so tests read the
  committed `tokens.ts`, and every `npm run dev` risks a dirty worktree. Steps 6-7
  target exactly that. The finding's proposed CI step is recorded in Maintenance
  notes because `.github/workflows/ci.yml` is another plan's territory.
- **DX-22, mostly not done (LOW confidence, and two cited details were wrong).**
  Corrections: the gitignore entry is at **`.gitignore:79`**, not `:89`; there are
  **41** tracked images at the repo root, not "~30" (29 `*.png` + 12 `*.jpeg`);
  totals are 106 tracked image files / 12,852 KB. Removing or relocating those
  41 files is a maintainer decision — 12.5 MB is trivial next to the 322 MB
  gitignored local SQLite, `design/exports/` is plausibly durable design
  collateral, and the finding's own guidance is "do not rewrite history for
  this". The `README.md` structure note the finding asked for is outside this
  plan's file territory. What *was* implemented is the one verified defect in the
  bundle: the unanchored `dashboard.png` rule, proved with
  `git check-ignore -v audit/ui/dashboard.png` to be hiding a real file
  elsewhere in the tree (Step 11).
- **DX-12: confirmed, with one addition.** Everything the finding claimed was
  verified. Additionally, the original guard's `grep -rn "set_config(" .../workers`
  had no `--exclude-dir`, so it would also have scanned
  `workers/austlii-scraper/node_modules/` — confirmed by running the equivalent
  loop, which matched `wrangler/wrangler-dist/cli.js`. The replacement in Step 1
  excludes `node_modules`, `dist` and `__tests__`.

## Review points not applied

Two sub-recommendations from the cross-plan review were deliberately **not**
implemented here. Both underlying findings were confirmed and their *primary*
remedy is applied above; what is rejected is the specific extra step, with the
evidence for rejecting it.

- **"If you want the error response to carry `X-Request-Id` too, have the
  wrapper produce a standard 500 and test that behaviour change."** The first
  half of this finding is correct and is applied: the old wrapper logged
  nothing when `handlers.fetch` threw, and Step 4d now catches, logs
  `outcome: "handler_threw"`, and rethrows the identical Error. The 500-
  synthesising half is refused, because it is forbidden by a sibling plan that
  owns the file: `plans/005-fix-worker-async-error-handling.md:535-536` states
  *"`workers/cloudflare-native.js` — adding an outer `try/catch` to `fetch()`
  would mask exactly the bug this plan fixes. Do not add one."* A catch that
  returns a Response **is** that masking — the unhandled rejection stops
  surfacing, which is precisely the signal 005 is chasing. The residual gap is
  documented instead of hidden: a thrown request gets an access line and no
  `X-Request-Id`, stated in "Why this matters" and in Maintenance notes, so
  nobody claims total header coverage.

- **"Replace the module-level tenant guard with a route/handler manifest, AST
  analysis, or per-route behavioural tests."** The finding is correct —
  `grep -l "requireAuth(" … && grep -q "assertMembership("` passes a file that
  contains one guarded handler and one unguarded one, so the guard cannot
  prove per-route isolation. It is not implemented here for two reasons.
  (1) File territory: a route manifest belongs to
  `plans/038-test-the-production-sql-layer.md`, which owns the route-level
  tests; building a second, competing one in a `Makefile` recipe would collide
  with it. (2) An AST analyser for this stack is not a Make target — the routes
  are dispatched through a chain of `dispatchCloudflare*()` functions across
  eight modules, so "which handler serves which path" is not recoverable from a
  syntax tree without modelling that dispatch. What is applied instead: the
  guard's own output and comment now say **"module granularity only"**, the
  limitation is stated in "Why this matters", Maintenance notes names
  `workers/auth/cloudflare_handlers.js` as the specific blind spot the manifest
  should cover first, and Step 1 adds a failure probe so the guard is at least
  proven to be able to fail. The claim is demoted to what the check can prove;
  it is no longer described as a cross-tenant-leak gate.
