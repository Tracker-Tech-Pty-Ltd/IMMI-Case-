# Plan 045: Make `.env.example` the source of truth it claims to be

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**. A committed-history diff alone cannot see a dirty
> working tree, so all four commands below must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE=".env.example
>   scripts/preflight_secrets.sh scripts/test_preflight_secrets.sh
>   immi_case_downloader/web/internal_extract.py immi_case_downloader/web/__init__.py
>   workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js
>   workers/pipeline/control_handlers.js tests/test_internal_extract.py"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $SCOPE     # committed since the plan was written
> git diff --stat -- $SCOPE                   # unstaged
> git diff --cached --stat -- $SCOPE          # staged
> ```
> Expected: the last three print nothing, and `git status --short --branch` lists
> no in-scope path. If any in-scope file appears in **any** of them, that is a
> STOP condition: compare the "Current state" excerpts against the live code and
> report before proceeding. **Never** run `git checkout --` or `git clean -f` to
> get a clean tree — the uncommitted work is the operator's.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none for correctness, but Step 7a edits
  `workers/case-api/cloudflare_mutations.js`, whose `requireWriter` /
  body-reading region is also edited by the auth-hardening plan
  (`plans/006-harden-auth-and-authorization.md`). The imports, `readJson` and
  `requireWriter` sit within ~30 lines of each other, so "different function"
  is not enough separation for a clean parallel merge. **Sequencing rule: the
  auth plan owns that file first. Run Step 7a only after 006 has landed (or
  after confirming it is not running), then re-read lines 1-70 of the live file
  before editing.** If 006 has already landed, the line numbers quoted in
  "Current state" for that file will have shifted — re-derive them, do not
  trust them.
- **Category**: dx
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`CLAUDE.md:51` tells every human and every agent working on this repo that
`.env.example` is the authoritative list of environment variables. It is not.
It documents 20 variables; the Python code reads 50, and one of its two
sentences about the local dev endpoint is simply false (`web.py` never reads
`BACKEND_HOST`). A newcomer or agent that trusts it concludes a required
variable "does not exist", or spends an hour on an unexplained 503. Alongside
that, three smaller pieces of config drift have accumulated: a deploy gate that
forces operators to keep a **retired** secret bound (so the real fix — rotating
and deleting it — never happens), a Cloudflare account identifier baked into a
copy-me template, and a hand-rolled file read in the Flask SPA route that skips
the framework's traversal check. Finally, three Worker request-body ceilings are
enforced by reading a `content-length` header that a chunked client simply
omits, which makes them advisory rather than real. After this plan, the config
contract is true, and a test keeps it true.

## Current state

### The files this plan touches, and their role

- `.env.example` — the declared source of truth; 61 lines, 20 variables.
- `scripts/preflight_secrets.sh` — CI gate that fails a deploy when a required
  Cloudflare Worker secret is not bound.
- `scripts/test_preflight_secrets.sh` — the gate's own test harness; run in CI
  by `.github/workflows/ci.yml:85`.
- `immi_case_downloader/web/internal_extract.py` — Flask blueprint serving
  `POST /internal/extract`; a weaker duplicate of `extract_container.py`.
- `immi_case_downloader/web/__init__.py` — Flask app factory; registers the
  blueprint above and defines the SPA catch-all route `serve_spa`.
- `workers/case-api/cloudflare_mutations.js` — production Worker case writes.
- `workers/case-api/cloudflare_actions.js` — production Worker non-mutating POSTs.
- `workers/pipeline/control_handlers.js` — production Worker operator controls.
- `tests/test_internal_extract.py` — the only tests for the Flask blueprint.

### 1. `.env.example` omits most variables and asserts one false thing

`CLAUDE.md:51`, verbatim:

```
Source of truth: `.env.example` (NOT this section — re-verify with `cat .env.example` if anything looks off). Real keys grouped by purpose:
```

`.env.example:8-11`, verbatim:

```
# Shared local development backend endpoint
# Both backend (web.py) and frontend Vite proxy can read these values.
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8080
```

That claim is half false. `BACKEND_PORT` **is** read by `web.py:52`. `BACKEND_HOST`
is **not** read by any Python file — `grep -rn "BACKEND_HOST" --include='*.py' .`
returns nothing, and `web.py:87-90` hardcodes the bind address:

```python
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to listen on (default: 127.0.0.1; use --host 0.0.0.0 to expose externally)",
    )
```

The only consumer is the Vite dev-server proxy, `frontend/vite.config.ts:10-11`:

```ts
  const backendHost =
    env.BACKEND_HOST || env.VITE_BACKEND_HOST || "127.0.0.1";
```

Variables the Python code reads that `.env.example` never names include
`IMMI_OUTPUT_DIR` (`immi_case_downloader/config.py:112`),
`SEMANTIC_SEARCH_PROVIDER` (`immi_case_downloader/web/routes/api_cases.py:1224`),
`OPENAI_API_KEY` (`scripts/backfill_case_embeddings.py:76`),
`EXTRACTION_SHARED_SECRET` (`extract_container.py:30`), the whole `R2_*` and
`CF_*` script family, and the `PIPELINE_*` / `LLM_*` extraction knobs. The full
verified list of 50 is in Step 1.

A second, separate defect in the same file: `.env.example:52-53` documents
`VITE_TELEGRAM_BOT_NAME` as if the root `.env` fed the browser bundle. It does
not. `frontend/vite.config.ts` sets no `envDir` and no `root`, so Vite's
`envDir` defaults to the cwd (`frontend/`) and only `frontend/.env*` reaches
`import.meta.env`. Verified empirically with Vite's own `loadEnv`: with
`envDir` pointed at a directory, a `.env` in its **parent** is not loaded. The
`loadEnv(mode, path.resolve(process.cwd(), ".."), "")` call at
`frontend/vite.config.ts:7` exists precisely because the parent `.env` is *not*
picked up automatically — and it only feeds the proxy target computed inside
the config file, never `import.meta.env`. `frontend/src/pages/LoginPage.tsx:7`
falls back to the same literal (`|| "immi_case_bot"`), which is why nobody
noticed.

`.env.example:24-28` also embeds a **Cloudflare account identifier** in the
default `LLM_COUNCIL_CF_GATEWAY_URL`. (Referenced by file:line only — do not
copy the value anywhere.) Leaving it in a copy-me template silently points a
different operator's local run at the project owner's AI Gateway. It is an
account *identifier*, not a credential: it cannot be rotated and it is useless
without `CF_AIG_TOKEN`, so no rotation is required here. If a *token* was ever
committed alongside it, that token must be rotated — check with
`git log -p -- .env.example` before assuming otherwise. Note also that the same
identifier is hardcoded in `immi_case_downloader/llm_council.py:40`,
`workers/llm-council/runner.js:29`, `workers/llm-council/runner.js:1460` and
`workers/llm-council/handlers.js:145`, so Step 1 does **not** remove it from
the repository — it only stops the template from handing it to a new operator.
Emptying the value is behaviour-preserving, because
`immi_case_downloader/llm_council.py:181-184` falls back to the same default:

```python
            cf_gateway_url=(
                os.environ.get("LLM_COUNCIL_CF_GATEWAY_URL", "").strip()
                or CF_GATEWAY_DEFAULT_URL
            ),
```

One claim in `.env.example` that IS true and must be preserved: line 55 says the
JWT secrets are "also needed by Flask". `immi_case_downloader/web/auth.py:77-78`:

```python
        for secret_env in ('JWT_SECRET_CURRENT', 'JWT_SECRET_PREVIOUS'):
            secret = os.environ.get(secret_env, '')
```

`JWT_KID_CURRENT` / `JWT_KID_PREVIOUS` are Worker-only — no Python file reads them.

### 2. The deploy gate requires a retired secret

`scripts/preflight_secrets.sh:45-47`, verbatim:

```bash
  pipeline)
    REQUIRED_SECRETS=(AUTH_TOKEN EXTRACTION_SHARED_SECRET)
    ;;
```

and its documentation block at `scripts/preflight_secrets.sh:25`:

```bash
#   AUTH_TOKEN        — pipeline enqueue authentication (pipeline worker only).
```

But the pipeline Worker states in code that the secret is gone —
`workers/austlii-scraper/src/index.ts:166-172`:

```ts
    // Cron-triggered only: the pipeline is driven exclusively by the scheduled
    // handler and queue consumers. No HTTP trigger endpoints are exposed, so
    // no AUTH_TOKEN secret is required.
    return Response.json(
      { error: "Cron-triggered only", code: "cron_only" },
      { status: 404 },
    );
```

Nothing under `workers/` reads `env.AUTH_TOKEN`; the only hit is that comment.
`EXTRACTION_SHARED_SECRET` by contrast is genuinely required —
`workers/austlii-scraper/src/extract.ts:45`:

```ts
  if (!env.EXTRACTION_SHARED_SECRET) {
    retryAll(messages, "missing_extraction_shared_secret");
```

The gate's test asserts the stale pair, `scripts/test_preflight_secrets.sh:108-112`:

```bash
run_case "pipeline requires only AUTH_TOKEN" \
  '[{"name":"AUTH_TOKEN","type":"secret_text"},{"name":"EXTRACTION_SHARED_SECRET","type":"secret_text"}]' \
  0 \
  "" \
  pipeline
```

### 3. The Flask `/internal/extract` copy is weaker than the container copy

`immi_case_downloader/web/internal_extract.py:15-26`, verbatim:

```python
@internal_extract_bp.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    if request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_cron_extract"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = _text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list):
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400
```

and `immi_case_downloader/web/internal_extract.py:109`:

```python
csrf.exempt(internal_extract_bp)
```

Authentication is two client-settable headers and nothing else; `batch` may be
any length. `cost_usd` is re-initialised at line 32 on every request, so the
`PIPELINE_RUN_COST_CAP_USD` cap at line 33 bounds a single call, not a run.

The container copy that actually ships is stricter —
`extract_container.py:26-38`, verbatim:

```python
@app.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker" or request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    shared_secret = os.environ.get("EXTRACTION_SHARED_SECRET", "")
    if not shared_secret or request.headers.get("X-Extraction-Token") != shared_secret:
        return jsonify({"error": "Forbidden", "code": "invalid_extraction_token"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list) or len(batch) > 20:
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400
```

`Dockerfile.extractor:14` confirms the container runs the strict copy:
`CMD ["python", "extract_container.py"]`.

The real caller **already sends the token** —
`workers/austlii-scraper/src/extract.ts:136-145`:

```ts
    const response = await env.EXTRACTION_BACKEND!.fetch("https://internal/internal/extract", {
      method: "POST",
      headers: {
        "X-Internal-Route": "worker",
        "X-Internal-Route-Subtype": "cron-extract",
        "Content-Type": "application/json",
        ...(env.EXTRACTION_SHARED_SECRET ? { "X-Extraction-Token": env.EXTRACTION_SHARED_SECRET } : {}),
      },
```

so bringing the Flask copy to parity breaks no live caller.

The weaker copy is registered unconditionally at
`immi_case_downloader/web/__init__.py:153-156`:

```python
    # Register internal Cloudflare pipeline endpoint. It has its own Worker
    # service-binding guard and is CSRF-exempt because it is not browser-facing.
    from .internal_extract import internal_extract_bp
    app.register_blueprint(internal_extract_bp)
```

**Honest scoping of the risk**: the Flask app is local-dev-only by design and
`make api` (`Makefile:45-46`) runs `web.py --port $(PORT) --backend $(BACKEND)`
with no `--host`, so it binds `127.0.0.1`. The concrete exposure is a developer
who starts it with `--host 0.0.0.0` while `CF_AIG_TOKEN` is in `.env`: anyone
who can reach the port can then drive unbounded LLM extraction against the
operator's AI Gateway credits, with no token and no batch cap.

### 4. Flask SPA route opens a joined path directly in testing mode

`immi_case_downloader/web/__init__.py:173-187`, verbatim:

```python
        # Static assets (JS, CSS, images) — serve the actual file
        if path and os.path.exists(os.path.join(react_dir, path)):
            asset_path = os.path.join(react_dir, path)
            if not app.testing:
                return send_from_directory(react_dir, path)

            mime_type, encoding = mimetypes.guess_type(asset_path)
            with open(asset_path, "rb") as asset_file:
                response = app.response_class(
                    asset_file.read(),
                    mimetype=mime_type or "application/octet-stream",
                )
            if encoding:
                response.headers["Content-Encoding"] = encoding
            return response
```

The non-testing path uses `send_from_directory`, which has its own traversal
check. The `app.testing` branch opens the joined path directly. Werkzeug's URL
normalisation plus testing-only reachability make this close to inert in
practice — this is defence in depth, not a live exploit. The repo already has
the pattern to copy, `immi_case_downloader/web/routes/api.py:2548-2554`:

```python
    photos_dir = (Path(get_output_dir()) / "judge_photos").resolve()
    requested = (photos_dir / filename).resolve()

    try:
        requested.relative_to(photos_dir)
    except ValueError:
        return jsonify({"error": "Not found"}), 404
```

Note `immi_case_downloader/web/__init__.py` imports only `os`, `secrets`,
`warnings`, `logging`, `mimetypes` (lines 12-16) — there is no `Path` import,
so Step 5 uses `os.path` and adds no import.

### 5. Three Worker body-size ceilings trust a header a client can omit

Three verbatim copies of the same helper.

`workers/case-api/cloudflare_mutations.js:31-42`:

```js
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || "0");
  // 1 MiB ceiling: case full text can exceed 128 KiB (e.g. AATA 2 ≈ 170 KiB),
  // so the original 128 KiB cap silently rejected legitimate large cases.
  if (Number.isFinite(length) && length > 1024 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
```

`workers/case-api/cloudflare_actions.js:30-39`:

```js
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 32 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
```

`workers/pipeline/control_handlers.js:34-43` — **note the `{}` fallback, which
differs from the other two and must be preserved**:

```js
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 32 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}
```

A missing header yields `Number("0")` → `0`, which passes every ceiling, and
`await request.json()` then buffers the entire body into isolate memory. A
non-numeric header yields `NaN`, `Number.isFinite(NaN)` is `false`, and the
check is skipped too. This is reproducible in the existing test harness today:
in Node's `undici`, `new Request(url, { method: "POST", body: "..." })` sets
**no** `content-length` header (verified: `r.headers.get("content-length")`
returns `null` on Node v22.23.1), which is exactly how
`workers/__tests__/cloudflare-actions.test.js:20-26` builds requests.

Every `readJson` caller treats `null` as a 400 —
`workers/case-api/cloudflare_mutations.js:196-197`,
`:215-216`, `:257-258`, `workers/case-api/cloudflare_actions.js:89-90`,
`:112-113`, `workers/pipeline/control_handlers.js:105-106` all read:

```js
  const body = await readJson(request);
  if (!body) return errorResponse("invalid json");
```

**Mitigations that keep this MED, not HIGH**: all three surfaces sit behind
`requireWriter` / `requireOperator` (CSRF + JWT + `assertMembership`, or the
crawler token), mutations are additionally disabled by default
(`wrangler.toml:92` `IMMI_CASE_MUTATIONS_ENABLED = "false"`), and Cloudflare
enforces its own platform request-body ceiling above these numbers.

### Repo conventions this plan must honour

- **Commit style**: `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- **Python venv**: always `/Users/d/Developer/Active Projects/IMMI-Case-/.venv/bin/…`.
  Never global `pip`/`python3`.
- **Worker facts**: tenant isolation is app-layer via
  `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`.
  There is no Postgres and no RLS. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` /
  `IMMI_OPS_DB` are D1 bindings.
- **By design — do NOT "fix"**: placeholder resource IDs in the checked-in
  `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags
  defaulting to `"false"`; `workers/austlii-scraper/scripts/rollback_run.ts`
  targeting legacy Supabase; the CLAUDE.md "Performance Baseline (2026-05-05)"
  section being historical.

## Commands you will need

**Baselines are recorded, not asserted.** Sibling plans add tests in parallel,
so a hard-coded suite total is guaranteed to be wrong by the time you run it.
Before you change anything, record these four numbers and refer to them as
`PY_BEFORE`, `WK_BEFORE`, `FE_BEFORE` and `RUFF_BEFORE`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | tail -1                     # -> PY_BEFORE (e.g. "1141 passed, 3 failed, 7 skipped")
(cd workers  && npx vitest run 2>&1 | tail -3)  # -> WK_BEFORE  (passed count)
(cd frontend && npx vitest run 2>&1 | tail -3)  # -> FE_BEFORE  (passed count)
.venv/bin/ruff check . 2>&1 | tail -1           # -> RUFF_BEFORE
```

| Purpose | Command | Expected on success |
|---|---|---|
| Python unit tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | passed count = `PY_BEFORE + 8`; **failed count is unchanged and every failure is still in `tests/test_backfill_judge_overrides_from_pdf.py`** (see Test plan) |
| One Python test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_internal_extract.py -q` | `4 passed` after Step 4 (`2 passed` before) |
| Worker tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | passed count = `WK_BEFORE + 5`, 0 failed |
| Python lint (this plan's Python territory) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check immi_case_downloader/ scripts/ *.py` | `All checks passed!` |
| Lint the new test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check tests/test_env_example_contract.py` | `All checks passed!` |
| Preflight gate self-test | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && bash scripts/test_preflight_secrets.sh` | `ALL PREFLIGHT TESTS PASSED`, exit 0 |
| Shell syntax check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && bash -n scripts/preflight_secrets.sh && bash -n scripts/test_preflight_secrets.sh` | exit 0, no output |
| Frontend tests (regression only) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | passed count = `FE_BEFORE`, unchanged |

Two notes on the lint command:

- Do **not** run `.venv/bin/ruff check .` as a gate: it reports pre-existing
  errors under `tests/`, all owned by `plans/003-lint-the-test-suite.md`. Its
  output must simply be **unchanged** from `RUFF_BEFORE`.
- The table deliberately spells out the ruff invocation instead of using
  `make lint`. `plans/001-restore-the-frontend-compile-gate.md` Step 3 splits
  `lint:` into `lint: lint-py lint-fe`, so after 001 lands `make lint` also runs
  ESLint over the frontend and can fail for reasons this plan did not cause.
  If `make lint-py` exists when you run, it is equivalent and may be used.

## Scope

**In scope** (the only files you may modify or create):

- `.env.example` (rewrite)
- `tests/test_env_example_contract.py` (create)
- `scripts/preflight_secrets.sh` (edit)
- `scripts/test_preflight_secrets.sh` (edit — the gate's own harness; coupled)
- `immi_case_downloader/web/internal_extract.py` (edit)
- `tests/test_internal_extract.py` (edit)
- `immi_case_downloader/web/__init__.py` (edit — `serve_spa` only)
- `tests/test_spa_asset_containment.py` (create — Step 5's traversal tests; a
  new file so it cannot collide with any plan editing `tests/test_app_factory.py`)
- `workers/storage/body_limit.js` (create)
- `workers/__tests__/body-limit.test.js` (create)
- `workers/case-api/cloudflare_mutations.js` (edit — **`readJson` at lines
  31-42 only**)
- `workers/case-api/cloudflare_actions.js` (edit — **`readJson` at lines 30-39
  only**)
- `workers/pipeline/control_handlers.js` (edit — **`readJson` at lines 34-43
  only**)

**Out of scope** (do NOT touch, even though they look related):

- `wrangler.toml` — the operator-secrets comment at lines 95-97 omits
  `CRAWLER_WRITE_TOKEN`, which is a real gap, but that file is owned by another
  plan running in parallel. This plan documents `CRAWLER_WRITE_TOKEN` in
  `.env.example` instead. The deferred one-line change is spelled out in
  "Maintenance notes".
- `CLAUDE.md`, `AGENTS.md`, `README.md` — all three repeat the false
  `BACKEND_HOST` claim (`CLAUDE.md:59`, `AGENTS.md:59`, `README.md:141`). They
  are documentation owned elsewhere; recorded in "Maintenance notes".
- `web.py` — do **not** make it read `BACKEND_HOST`. That would be a behaviour
  change to the bind address of a dev server, and `web.py` is not in this
  plan's territory.
- `extract_container.py` — it is already the strict reference implementation.
  Do not weaken it and do not delete the Flask blueprint in Step 4; deletion is
  a separate decision (see "Maintenance notes").
- `workers/llm-council/cloudflare_handlers.js` — its `readBody` (around lines
  67-74) has no size guard either, but the LLM Council surface is owned by
  another plan. Do not touch it.
- `immi_case_downloader/llm_council.py`, `workers/llm-council/runner.js`,
  `workers/llm-council/handlers.js` — they hardcode the same account
  identifier. Leave them; changing them is a behaviour change to the default
  gateway.
- `config/immi-separation.json` — its `pipeline_required_secrets` list at lines
  64-67 also names `AUTH_TOKEN`. Verified that **nothing reads that key**
  (`grep -rn "pipeline_required_secrets" .` matches only the JSON file itself),
  so removing it here would be a no-op edit in another plan's territory.
- Any change to `requireWriter` / `requireOperator` in the three Worker files.
  Only the `readJson` helper is yours.
- `.github/workflows/*` — no CI wiring changes. The new contract test runs
  under the existing `make test-py`.

## Git workflow

- Branch: `advisor/045-fix-the-config-contract`, created from `main`.
- Commit per step, conventional style. Suggested messages:
  1. `docs: regenerate .env.example from the variables the code actually reads`
  2. `test: fail when Python reads an env var .env.example does not document`
  3. `chore: drop the retired AUTH_TOKEN from the pipeline deploy gate`
  4. `fix: require the extraction shared secret on the Flask internal route`
  5. `fix: contain SPA asset paths inside the React build directory`
  6. `refactor: add a stream-bounded JSON body reader for the Worker`
  7. `fix: enforce Worker body ceilings without trusting content-length`
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits.

## Steps

### Step 1: Rewrite `.env.example` grouped by consumer

Replace the entire contents of `.env.example` with the block below. It is
grouped by *who reads the variable*, marks Worker-only values as Wrangler
secrets rather than dotenv entries, corrects the `BACKEND_HOST` sentence,
corrects the `VITE_TELEGRAM_BOT_NAME` placement, and empties the gateway URL so
the template no longer carries an account identifier.

Every variable name below was verified against a read site in the code. Do not
add, drop, or rename entries.

```dotenv
# ─────────────────────────────────────────────────────────────────────────────
# IMMI-Case environment template — copy to `.env` and fill in what you need.
#
# WHAT IS ENFORCED, AND WHAT IS NOT.
# `tests/test_env_example_contract.py` fails the build if any **Python** file
# under `immi_case_downloader/`, `scripts/` or the repo root reads an
# environment variable that is not named somewhere in this file. That is the
# only automatically enforced part of this contract.
#
# NOT enforced by any test, and therefore documented here on trust — if you add
# one of these, add it here too, by hand:
#   - Cloudflare Worker reads (`env.*` in `workers/**`) and the Wrangler
#     `[vars]` / `wrangler secret put` values behind them  → section 7
#   - `import.meta.env.*` reads in the Vite client bundle                → section 8
#   - shell scripts (`scripts/*.sh`, `Makefile`, CI workflow `env:` blocks)
#   - anything read only inside `tests/`
# Extending the contract test to cover those surfaces is recorded as a
# follow-up in plans/045; until it lands, do not describe this file as a
# machine-verified inventory of the whole repository.
#
# Grouped BY CONSUMER, because not everything below belongs in `.env`:
#   - Section 7 is the production Cloudflare Worker. Those are Wrangler
#     secrets/vars set with `wrangler secret put`, NOT dotenv entries.
#   - Section 8 is the Vite client bundle, which only reads `frontend/.env`.
# ─────────────────────────────────────────────────────────────────────────────


# ── 1. Flask local-dev server (web.py, immi_case_downloader/web/) ────────────
# The Flask app is LOCAL DEV ONLY. Production is the Cloudflare Worker.

# Generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
# Required when APP_ENV is production or staging; dev auto-generates ephemeral.
SECRET_KEY=your-secret-key-here

# development (default) | staging | production.
APP_ENV=development

# Only enable behind a trusted reverse proxy that rewrites client IP headers.
TRUST_PROXY_HEADERS=false

# Read by web.py:52. Port 5000 conflicts with macOS AirPlay.
BACKEND_PORT=8080

# There is deliberately no BACKEND_HOST here for Flask: web.py does NOT read it
# (verify: grep -rn BACKEND_HOST --include='*.py' . returns nothing). The bind
# address comes from the CLI flag only — `python web.py --host 0.0.0.0`.
# BACKEND_HOST below in section 8 is consumed by the Vite proxy, not by Flask.

# Local-dev JWT verification. immi_case_downloader/web/auth.py:77 reads these
# two to verify access tokens minted by the Worker. The matching KID variables
# are Worker-only — see section 7.
JWT_SECRET_CURRENT=
JWT_SECRET_PREVIOUS=


# ── 2. CLI + scraper defaults (immi_case_downloader/config.py) ───────────────
# All optional; the defaults shown are the code defaults.

IMMI_OUTPUT_DIR=downloaded_cases
# Defaults are dynamic: START_YEAR = current year - 10, END_YEAR = current year.
IMMI_START_YEAR=
IMMI_END_YEAR=
IMMI_TIMEOUT=30
IMMI_DELAY=1.0
IMMI_MAX_RETRIES=3


# ── 3. Supabase local-dev backend ────────────────────────────────────────────
# Required only for `python web.py --backend supabase`. Production uses D1.

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Only scripts/migrate_anon_data.py and scripts/generate_missing_embeddings.py.
SUPABASE_ANON_KEY=
# Optional direct Postgres DSN used by supabase_repository.py and web/__init__.py.
HYPERDRIVE_DATABASE_URL=


# ── 4. LLM Council via Cloudflare AI Gateway (unified billing) ───────────────
# 3 expert models + a Gemini Flash moderator, all routed through one CF AI
# Gateway compat endpoint. Credits come from the Cloudflare account behind
# CF_AIG_TOKEN — do NOT add per-provider keys here.
# Load credits at: https://dash.cloudflare.com/?to=/:account/ai/ai-gateway

# CF AI Gateway unified token (cfut_*). Auth header: cf-aig-authorization.
CF_AIG_TOKEN=

# Leave EMPTY to use the project's own gateway (the default constant in
# immi_case_downloader/llm_council.py:40). Set it to your own
# https://gateway.ai.cloudflare.com/v1/<YOUR_ACCOUNT_ID>/<GATEWAY>/compat/chat/completions
# to bill your own account instead of the project owner's.
LLM_COUNCIL_CF_GATEWAY_URL=

# Model routing — the provider prefix is REQUIRED on the compat endpoint:
#   openai/<model> | anthropic/<model> | google-ai-studio/<model>
LLM_COUNCIL_OPENAI_MODEL=openai/gpt-5-mini-2025-08-07
LLM_COUNCIL_GEMINI_PRO_MODEL=google-ai-studio/gemini-3.1-pro-preview
LLM_COUNCIL_ANTHROPIC_MODEL=anthropic/claude-sonnet-4-6
LLM_COUNCIL_GEMINI_FLASH_MODEL=google-ai-studio/gemini-2.5-flash
LLM_COUNCIL_GPT5_REASONING_EFFORT=low

# Limits sized for reasoning models. Probe data: gemini-2.5-pro at 2400 returned
# completion=0; 4096 is the reliability/cost sweet spot. 8192 is reserved for
# the moderator's 14-field JSON output.
LLM_COUNCIL_MAX_OUTPUT_TOKENS=4096
LLM_COUNCIL_MODERATOR_MAX_TOKENS=8192
LLM_COUNCIL_TIMEOUT_SECONDS=120

# Optional system-prompt overrides.
LLM_COUNCIL_SYSTEM_PROMPT_OPENAI=
LLM_COUNCIL_SYSTEM_PROMPT_GEMINI_PRO=
LLM_COUNCIL_SYSTEM_PROMPT_ANTHROPIC=
LLM_COUNCIL_SYSTEM_PROMPT_MODERATOR=


# ── 5. Extraction service (extract_container.py, /internal/extract) ──────────
# Shared secret sent by the scraper Worker as the X-Extraction-Token header
# (workers/austlii-scraper/src/extract.ts:142). Both the container and the
# local Flask blueprint fail CLOSED when it is unset.
EXTRACTION_SHARED_SECRET=

LLM_EXTRACT_CF_GATEWAY_URL=
LLM_GEMMA_MODEL=workers-ai/@cf/google/gemma-4-26b-a4b-it
LLM_MAX_OUTPUT_TOKENS=512
PIPELINE_RUN_COST_CAP_USD=5.0
PIPELINE_LLM_CALL_TIMEOUT_MS=28000


# ── 6. Standalone maintenance scripts (set only when running them) ───────────
# These are NOT read by the web app. Each is listed with its consumer so you
# know whether you need it at all.
#
#   OPENAI_API_KEY — scripts/backfill_case_embeddings.py:76,
#                    scripts/two_stage_embedding_backfill.py:84,
#                    immi_case_downloader/semantic_search_eval.py:770,
#                    immi_case_downloader/web/routes/api_cases.py:594.
#                    NOT used by LLM Council (that bills through CF Gateway).
#   GEMINI_API_KEY — the same embedding scripts, plus scripts/fetch_judge_bios.py:566.
#   GOOGLE_API_KEY — accepted as an alias for GEMINI_API_KEY by fill_country_gemini.py,
#                    fill_outcomes_gemini.py, scripts/extract_gemini.py.
#   SEMANTIC_SEARCH_PROVIDER — default embedding provider for
#                    /api/v1/cases semantic search (api_cases.py:1224, "openai").
#   CF_ACCOUNT_ID / CF_API_TOKEN / WORKER_AUTH_TOKEN — scripts/cloudflare_config.py.
#                    WORKER_AUTH_TOKEN is a script-side header value for
#                    scripts/enqueue_urls.py and scripts/sync_results.py; it is
#                    NOT the Worker secret of a similar name (see section 7).
#   R2_BUCKET_NAME / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — scripts/cloudflare_config.py.
#   DATABASE_URL / SUPABASE_DB_URL / HYPERDRIVE_SERVICE_URL —
#                    scripts/bootstrap_pipeline_baselines.py:44-46, legacy-stack only.
#   IMMI_SOURCE_DATABASE_URL / IMMI_SOURCE_TEXT_ROOT — scripts/export_immi_ndjson.py:292-293.
#   NEXT_PUBLIC_SUPABASE_URL — sync_judge_bios_supabase.py:35, alias for SUPABASE_URL.


# ── 7. Cloudflare Worker secrets and vars — NOT dotenv entries ───────────────
# Set with: npx wrangler secret put <NAME> --name immi-case-standalone
# Never put these values in this file or in .env.
#
#   CSRF_SECRET — HMAC key for the double-submit CSRF token. Without it,
#                 GET /api/v1/csrf-token returns 503 csrf_secret_not_configured
#                 (workers/auth/csrf.js:20) and every write fails.
#   JWT_SECRET_CURRENT / JWT_SECRET_PREVIOUS — HS256 signing material. Also
#                 read by the local Flask middleware, so they appear in section 1.
#   JWT_KID_CURRENT / JWT_KID_PREVIOUS — key ids for rotation. Worker-only.
#   TELEGRAM_BOT_TOKEN — Telegram Login HMAC verification secret.
#   CF_AIG_TOKEN — AI Gateway token for the Worker-side council runner.
#   EXTRACTION_SHARED_SECRET — required by the scraper Worker
#                 (workers/austlii-scraper/src/extract.ts:45).
#   CRAWLER_WRITE_TOKEN — DANGER: setting this opens a write path that skips
#                 BOTH CSRF verification and tenant-membership checks. See
#                 workers/case-api/cloudflare_mutations.js:57-63: a request
#                 bearing this token as `Authorization: Bearer <token>` is
#                 accepted as the VPS AustLII crawler without a user JWT. Set
#                 it only when that crawler is live, treat it as a production
#                 write credential, and rotate it on any suspicion of exposure.
#
# Worker [vars] (plain config, live in wrangler.toml, not here):
#   AUTH_ENABLED, IMMI_STORAGE_MODE, IMMI_CASE_MUTATIONS_ENABLED,
#   CUTOVER_WRITE_FREEZE. The mutation and pipeline flags default to "false"
#   BY DESIGN (fail-closed); do not "fix" them.


# ── 8. Vite client bundle — set these in frontend/.env, not here ─────────────
# Vite's envDir defaults to the project root, which is `frontend/` when you run
# `npm run dev` there. A VITE_* variable placed in THIS file never reaches
# import.meta.env. See frontend/.env.example.
#
#   VITE_TELEGRAM_BOT_NAME — Telegram login widget bot username, no @ prefix.
#                 Falls back to "immi_case_bot" (frontend/src/pages/LoginPage.tsx:7).
#
# BACKEND_HOST and BACKEND_PORT below are read by frontend/vite.config.ts:10-12
# to compute the dev proxy target. vite.config.ts loads them from the repo root
# .env explicitly, so they DO work from this file — unlike VITE_* variables.
BACKEND_HOST=127.0.0.1
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c '' .env.example && \
  ! grep -qE 'gateway\.ai\.cloudflare\.com/v1/[0-9a-f]{8}' .env.example && \
  grep -q '^BACKEND_HOST=127.0.0.1$' .env.example && \
  grep -q '^LLM_COUNCIL_CF_GATEWAY_URL=$' .env.example && \
  ! grep -q '^VITE_TELEGRAM_BOT_NAME=' .env.example && echo OK
```
→ prints a line count, then `OK`. (The `!` clauses assert the account
identifier is gone and no `VITE_*` assignment remains.)

### Step 2: Add the contract test that keeps `.env.example` honest

Create `tests/test_env_example_contract.py` with exactly this content:

```python
"""Contract test: .env.example must name every env var the PYTHON code reads.

CLAUDE.md:51 designates .env.example the source of truth for environment
variables. Nothing enforced that, so it drifted ~30 variables behind the code.
This test fails when a Python file under the scanned roots reads a variable
that .env.example never mentions.

SCOPE — read this before citing the test as evidence of anything wider.
It covers ONLY Python reads (`os.environ` / `os.getenv` / the project's
`_*_env()` helpers) under `immi_case_downloader/`, `scripts/` and the repo
root. It does NOT cover, and cannot fail on:

  * Cloudflare Worker `env.*` reads under `workers/`
  * Wrangler `[vars]` and `wrangler secret put` names
  * `import.meta.env.*` in the Vite client bundle
  * shell scripts, the Makefile, or CI workflow `env:` blocks

Those surfaces are documented in .env.example by hand. Extending this test to
them is a real follow-up (see plans/045 "Maintenance notes"); until someone
does it, this file is the *Python* env contract, not a repo-wide inventory.

If this test fails, the fix is to DOCUMENT the printed variable in the right
section of .env.example (or, if it is genuinely internal, add it to
UNDOCUMENTED_BY_DESIGN with a one-line reason). Do not relax the patterns.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = REPO_ROOT / ".env.example"

# Directories and files scanned for env reads. Deliberately excludes tests/ and
# frontend/ — tests set variables, they do not consume configuration, and the
# frontend reads frontend/.env.
SCAN_DIRS = ("immi_case_downloader", "scripts")

# os.environ.get("X") / os.environ["X"] / os.getenv("X")
DIRECT_READ_RE = re.compile(
    r"""os\.(?:environ(?:\.get)?[(\[]|getenv\()\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
)
# Project env helpers: _float_env("X"), _env_int("X"), _env_flag("X"), ...
HELPER_READ_RE = re.compile(
    r"""_(?:float|int|bool|str)_env\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
    r"""|_env_(?:int|float|flag|str)\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]"""
)

# A variable counts as documented when .env.example either assigns it
# (`NAME=...`) or names it on a comment line (`#   A / B / C — ...`). Comment
# scanning requires at least one underscore so ordinary prose words in ALL CAPS
# ("NOT", "DANGER") are not mistaken for documented variable names; every real
# variable in this project contains one. Assignments are matched without that
# restriction, so a single-word variable can still be documented by assigning it.
ASSIGNED_RE = re.compile(r"^([A-Z][A-Z0-9_]{2,})=", re.MULTILINE)
COMMENT_LINE_RE = re.compile(r"^#.*$", re.MULTILINE)
COMMENT_NAME_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")

# Variables intentionally absent from .env.example. Keep this list empty unless
# there is a real reason, and always give the reason.
UNDOCUMENTED_BY_DESIGN: dict[str, str] = {}


def _python_files() -> list[Path]:
    files = sorted(REPO_ROOT.glob("*.py"))
    for name in SCAN_DIRS:
        files.extend(sorted((REPO_ROOT / name).rglob("*.py")))
    return files


def _read_variables() -> dict[str, str]:
    """Map variable name -> "relative/path.py:line" of its first read site."""
    found: dict[str, str] = {}
    for path in _python_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            names = [m.group(1) for m in DIRECT_READ_RE.finditer(line)]
            for match in HELPER_READ_RE.finditer(line):
                names.append(match.group(1) or match.group(2))
            for name in names:
                found.setdefault(
                    name, f"{path.relative_to(REPO_ROOT)}:{lineno}"
                )
    return found


def _documented_names() -> set[str]:
    text = ENV_EXAMPLE.read_text(encoding="utf-8")
    names = set(ASSIGNED_RE.findall(text))
    for comment in COMMENT_LINE_RE.findall(text):
        names.update(COMMENT_NAME_RE.findall(comment))
    return names


def test_env_example_exists():
    assert ENV_EXAMPLE.is_file(), f"{ENV_EXAMPLE} is missing"


def test_env_example_documents_every_variable_python_reads():
    read_sites = _read_variables()
    documented = _documented_names()

    missing = {
        name: site
        for name, site in read_sites.items()
        if name not in documented and name not in UNDOCUMENTED_BY_DESIGN
    }

    assert not missing, (
        "These environment variables are read by Python but not documented in "
        ".env.example:\n"
        + "\n".join(f"  {name}  (first read at {site})" for name, site in sorted(missing.items()))
        + "\n\nDocument each one in the matching section of .env.example, or add "
        "it to UNDOCUMENTED_BY_DESIGN in this file with a reason."
    )


def test_env_example_carries_no_cloudflare_account_id():
    """The template must not hand a new operator the project's AI Gateway."""
    text = ENV_EXAMPLE.read_text(encoding="utf-8")
    hits = re.findall(r"gateway\.ai\.cloudflare\.com/v1/[0-9a-f]{8,}", text)
    assert not hits, (
        "A Cloudflare account identifier is embedded in .env.example. Replace "
        "the value with an empty string; the code default in "
        "immi_case_downloader/llm_council.py:40 already supplies it."
    )
```

If `test_env_example_documents_every_variable_python_reads` fails, read the
printed names and add each one to the matching `.env.example` section — the
list in Step 1 was derived the same way, so a failure means a read site the
plan's greps missed, not a broken test.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_env_example_contract.py -q && \
  .venv/bin/ruff check tests/test_env_example_contract.py
```
→ `3 passed`, then `All checks passed!`

### Step 3: Drop the retired `AUTH_TOKEN` from the pipeline deploy gate

Two edits in `scripts/preflight_secrets.sh`.

1. Replace line 25:
   ```bash
   #   AUTH_TOKEN        — pipeline enqueue authentication (pipeline worker only).
   ```
   with:
   ```bash
   #   EXTRACTION_SHARED_SECRET — pipeline worker only. Sent to the extraction
   #                    backend as X-Extraction-Token
   #                    (workers/austlii-scraper/src/extract.ts:142) and
   #                    required before any extract batch runs (extract.ts:45).
   #                    AUTH_TOKEN was removed from this list on 2026-08-27:
   #                    the scraper Worker is cron-only and exposes no HTTP
   #                    trigger, so nothing reads env.AUTH_TOKEN any more
   #                    (workers/austlii-scraper/src/index.ts:166-168).
   ```

2. Replace line 46:
   ```bash
       REQUIRED_SECRETS=(AUTH_TOKEN EXTRACTION_SHARED_SECRET)
   ```
   with:
   ```bash
       REQUIRED_SECRETS=(EXTRACTION_SHARED_SECRET)
   ```

Then update the harness in `scripts/test_preflight_secrets.sh`. Replace the
case at lines 108-112:

```bash
run_case "pipeline requires only AUTH_TOKEN" \
  '[{"name":"AUTH_TOKEN","type":"secret_text"},{"name":"EXTRACTION_SHARED_SECRET","type":"secret_text"}]' \
  0 \
  "" \
  pipeline
```

with these two cases (a pass case that no longer binds `AUTH_TOKEN`, and a
regression case proving the gate still fails when the real secret is absent):

```bash
run_case "pipeline requires only EXTRACTION_SHARED_SECRET" \
  '[{"name":"EXTRACTION_SHARED_SECRET","type":"secret_text"}]' \
  0 \
  "" \
  pipeline

run_case "pipeline fails without EXTRACTION_SHARED_SECRET" \
  '[{"name":"AUTH_TOKEN","type":"secret_text"}]' \
  1 \
  "EXTRACTION_SHARED_SECRET" \
  pipeline
```

Before editing, read `scripts/test_preflight_secrets.sh` lines 1-60 and confirm
`run_case`'s parameter order is `<name> <secrets_json> <expected_exit>
<expected_stdout_or_stderr_substring> [worker_kind]` — the two existing calls in
the file use that shape. If it differs, STOP.

Note that `AUTH_TOKEN` remains a **live Cloudflare secret** on the pipeline
Worker until an operator deletes it. Removing it from the gate is what makes
that deletion possible; the actual removal is an operator action recorded in
"Maintenance notes". If the token was ever shared or logged, it should be
rotated before deletion rather than merely unbound.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  bash -n scripts/preflight_secrets.sh && bash -n scripts/test_preflight_secrets.sh && \
  bash scripts/test_preflight_secrets.sh && \
  ! grep -q 'REQUIRED_SECRETS=(AUTH_TOKEN' scripts/preflight_secrets.sh && echo OK
```
→ `ALL PREFLIGHT TESTS PASSED`, then `OK`.

### Step 4: Bring the Flask `/internal/extract` route to parity with the container

Edit `immi_case_downloader/web/internal_extract.py`.

Replace lines 15-26 (the handler prologue shown in "Current state") with:

```python
MAX_BATCH_ITEMS = 20


@internal_extract_bp.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    if request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_cron_extract"}), 403

    # Parity with extract_container.py:30-32 — the shipped container copy of
    # this route. Fails CLOSED when the secret is unset: without this, any
    # client that can reach the port drives LLM extraction against the
    # operator's CF AI Gateway credits. The real caller already sends the
    # header (workers/austlii-scraper/src/extract.ts:142).
    shared_secret = os.environ.get("EXTRACTION_SHARED_SECRET", "")
    presented = request.headers.get("X-Extraction-Token", "")
    if not shared_secret or not compare_digest(presented, shared_secret):
        return jsonify({"error": "Forbidden", "code": "invalid_extraction_token"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = _text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list) or len(batch) > MAX_BATCH_ITEMS:
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400
```

Add the constant-time comparison import next to the existing `import os` at the
top of the file, so lines 5-8 read:

```python
import os
from hmac import compare_digest
from typing import Any

from flask import Blueprint, jsonify, request
```

**Do NOT remove `csrf.exempt(internal_extract_bp)` at line 109.** The caller is
a Cloudflare Worker service binding with no CSRF token; dropping the exemption
would make the route permanently unusable. The custom `X-Extraction-Token`
header already defeats CSRF on its own, because a cross-site form or image
request cannot set a custom header without a CORS preflight the server never
approves.

Now update `tests/test_internal_extract.py`, which currently asserts a `200`
for a request carrying only the two `X-Internal-Route*` headers (lines 25-32)
and would fail. Change `_app()` to bind a test secret, add the token header to
the two requests that must succeed, and add two new cases:

```python
import os
from unittest.mock import patch

from immi_case_downloader.web import create_app

TOKEN = "test-extraction-secret"
HEADERS = {
    "X-Internal-Route": "worker",
    "X-Internal-Route-Subtype": "cron-extract",
    "X-Extraction-Token": TOKEN,
}


def _app():
    with patch.dict(
        os.environ,
        {"SECRET_KEY": "test-key", "EXTRACTION_SHARED_SECRET": TOKEN},
        clear=False,
    ):
        app = create_app(backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = True
    return app
```

- In `test_internal_extract_requires_worker_and_subtype_headers`, keep the two
  403 assertions, and change the final request to use `headers=HEADERS` so it
  still asserts `200`. Wrap the request in the same
  `patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False)`
  context if the handler reads the variable at request time (it does — the read
  is inside the view function), so the environment is set during the call, not
  only during `create_app`.
- In `test_internal_extract_returns_field_envelopes_without_echoing_full_text`,
  replace the inline `headers={...}` dict with `headers=HEADERS` and wrap the
  call in the same `patch.dict` context.
- Add `test_internal_extract_rejects_missing_token`: with the secret set in the
  environment, POST with `X-Internal-Route` and `X-Internal-Route-Subtype` but
  **no** `X-Extraction-Token`; assert `403` and
  `response.get_json()["code"] == "invalid_extraction_token"`.
- Add `test_internal_extract_rejects_oversize_batch`: with `HEADERS` and the
  secret set, POST `{"run_id": "run-1", "batch": [{} for _ in range(21)]}`;
  assert `400` and `response.get_json()["code"] == "bad_payload"`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_internal_extract.py -q && \
  .venv/bin/ruff check immi_case_downloader/ scripts/ *.py tests/test_internal_extract.py
```
→ `4 passed` (2 existing + 2 new), then `All checks passed!`

### Step 5: Contain SPA asset paths inside the React build directory

Edit `immi_case_downloader/web/__init__.py`. Replace lines 173-175:

```python
        # Static assets (JS, CSS, images) — serve the actual file
        if path and os.path.exists(os.path.join(react_dir, path)):
            asset_path = os.path.join(react_dir, path)
```

with:

```python
        # Static assets (JS, CSS, images) — serve the actual file.
        # Containment guard: resolve symlinks and reject anything that escapes
        # the build directory BEFORE opening it. The app.testing branch below
        # opens the path directly instead of going through send_from_directory,
        # which is where the framework's own traversal check lives. Mirrors the
        # resolve()+relative_to guard in routes/api.py:2548-2554.
        react_root = os.path.realpath(react_dir)
        asset_path = os.path.realpath(os.path.join(react_dir, path)) if path else ""
        if path and not (
            asset_path == react_root or asset_path.startswith(react_root + os.sep)
        ):
            abort(404)
        if path and os.path.exists(asset_path):
```

Leave every other line of `serve_spa` unchanged, including the
`return send_from_directory(react_dir, path)` call — it must keep receiving the
original relative `path`, not `asset_path`.

`abort` is already imported inside the function at line 166
(`from flask import send_from_directory, abort`); add no import.

Then create `tests/test_spa_asset_containment.py`. **`pytest tests/test_app_factory.py`
is not sufficient evidence for this step** — its only SPA case
(`test_serves_static_js_file_in_test_mode`, lines 162-185) is a happy path that
`pytest.skip`s outright when no React build is present, so it passes identically
whether or not the guard exists. The file below actually exercises the escape.

```python
"""SPA static-asset containment: a path resolving outside the React build
directory must 404 instead of being served.

serve_spa() has two branches. The normal one delegates to
send_from_directory(), which carries Werkzeug's own traversal check. The
`app.testing` branch open()s the joined path directly and had no check at all —
that is the branch these tests cover, and the branch the Step 5 guard protects.

The React build directory is a fixed path inside the installed package
(<pkg>/static/react), so the fixture materialises files there under
plan045-prefixed names and removes exactly what it created.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

import immi_case_downloader as pkg

REACT_DIR = Path(os.path.dirname(pkg.__file__)) / "static" / "react"
OUTSIDE_MARKER = "PLAN045-OUTSIDE-THE-BUILD-DIRECTORY"


def _make_app():
    from immi_case_downloader.web import create_app

    with patch.dict(os.environ, {"SECRET_KEY": "test-key"}):
        app = create_app(backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


@pytest.fixture()
def react_build(tmp_path):
    """A minimal build dir containing one real asset and one escaping symlink."""
    missing_root = None
    probe = REACT_DIR
    while not probe.exists():
        missing_root = probe
        probe = probe.parent
    REACT_DIR.mkdir(parents=True, exist_ok=True)

    outside = tmp_path / "outside.txt"
    outside.write_text(OUTSIDE_MARKER, encoding="utf-8")

    created: list[Path] = []

    def _write(name: str, body: str) -> Path:
        path = REACT_DIR / name
        if path.exists() or path.is_symlink():
            pytest.skip(f"{path} already exists; refusing to touch a real build artifact")
        path.write_text(body, encoding="utf-8")
        created.append(path)
        return path

    _write("plan045-index.html", "<!doctype html><title>t</title>")
    _write("plan045-asset.js", "console.log('INSIDE-THE-BUILD');")

    link = REACT_DIR / "plan045-escape.js"
    if link.exists() or link.is_symlink():
        pytest.skip("symlink fixture name already taken")
    link.symlink_to(outside)
    created.append(link)

    try:
        yield outside
    finally:
        for path in created:
            if path.is_symlink() or path.exists():
                path.unlink()
        if missing_root is not None:
            shutil.rmtree(missing_root, ignore_errors=True)


def test_serves_a_file_inside_the_build_directory(react_build):
    """The guard must not break the legitimate case it wraps."""
    response = _make_app().test_client().get("/plan045-asset.js")
    assert response.status_code == 200
    assert b"INSIDE-THE-BUILD" in response.data


def test_rejects_a_symlink_that_escapes_the_build_directory(react_build):
    """Before the Step 5 guard this returned 200 with the outside file's bytes."""
    response = _make_app().test_client().get("/plan045-escape.js")
    assert response.status_code == 404
    assert OUTSIDE_MARKER.encode() not in response.data


def test_encoded_traversal_never_serves_a_file_outside_the_build(react_build):
    """Defence in depth: Werkzeug normalises most of these, the guard covers the rest."""
    client = _make_app().test_client()
    for path in ("/../plan045-escape.js", "/%2e%2e%2fplan045-escape.js", "/a/../../setup.py"):
        response = client.get(path)
        assert response.status_code != 500
        assert OUTSIDE_MARKER.encode() not in response.data
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_spa_asset_containment.py -q && \
  .venv/bin/python -m pytest tests/test_app_factory.py -q && \
  .venv/bin/ruff check immi_case_downloader/ scripts/ *.py tests/test_spa_asset_containment.py
```
→ `3 passed` for the new file (**and none of the three skipped** — a skip means
the fixture refused to write and the step is unverified, which is a STOP
condition); then `tests/test_app_factory.py` unchanged from its own baseline
(`9 passed, 1 skipped` at `42826a3` — the skip is the pre-existing
no-React-build case at lines 170-172); then `All checks passed!`.

Sanity check that the test can actually fail: with Step 5's guard temporarily
reverted, `test_rejects_a_symlink_that_escapes_the_build_directory` must fail
with a 200. If it passes against the unpatched code, the fixture is not
reaching the `app.testing` branch and the test proves nothing — STOP.

### Step 6: Add a stream-bounded body reader for the Worker

Create `workers/storage/body_limit.js`:

```js
/**
 * Bounded request-body reader.
 *
 * The three readJson helpers in the Worker used to enforce their ceilings by
 * reading the content-length header. A chunked or HTTP/2 client simply omits
 * that header, `Number(null || "0")` is 0, every ceiling passes, and
 * `request.json()` then buffers the whole body into isolate memory. This reads
 * the body as a stream and aborts the moment the byte count exceeds the limit,
 * so the ceiling holds regardless of what the client declares.
 */

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<string | null>} the body text, or null when it exceeds
 *   maxBytes or cannot be read.
 */
export async function readBoundedBodyText(request, maxBytes) {
  // Fast reject when the client is honest about an oversize body.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = request.body;
  if (!body) {
    try {
      return await request.text();
    } catch {
      return null;
    }
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      /* already errored */
    }
    return null;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
```

Create `workers/__tests__/body-limit.test.js`:

```js
import { describe, expect, it } from "vitest";

import { readBoundedBodyText } from "../storage/body_limit.js";

function post(body) {
  return new Request("https://immi.example/x", { method: "POST", body });
}

describe("readBoundedBodyText", () => {
  it("returns the body text when under the limit", async () => {
    expect(await readBoundedBodyText(post('{"a":1}'), 1024)).toBe('{"a":1}');
  });

  it("rejects an oversize body even with no content-length header", async () => {
    const body = JSON.stringify({ blob: "x".repeat(2048) });
    const request = post(body);
    // Node's undici does not set content-length for a string body, which is
    // exactly the case the old header-based ceiling missed.
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("rejects an oversize chunked body", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(700)));
        controller.enqueue(encoder.encode("x".repeat(700)));
        controller.close();
      },
    });
    const request = new Request("https://immi.example/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    });
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("rejects when the declared content-length alone exceeds the limit", async () => {
    const request = new Request("https://immi.example/x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: '{"a":1}',
    });
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("returns an empty string for a body-less request", async () => {
    const request = new Request("https://immi.example/x", { method: "POST" });
    expect(await readBoundedBodyText(request, 1024)).toBe("");
  });
});
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/body-limit.test.js
```
→ `5 passed`, 0 failed.

All five cases were run against this exact helper source on Node v22.23.1 (the
version this repo uses) before the plan was written, and all five passed. If
any of them fails for you, the helper text was transcribed incorrectly — re-read
it rather than adjusting the test.

### Step 7: Rewire the three `readJson` helpers onto the bounded reader

Three edits, each replacing **only** the `readJson` function body and adding
one import. Do not reformat anything else in these files; another plan is
editing `requireWriter` in `cloudflare_mutations.js` in parallel.

**7a. `workers/case-api/cloudflare_mutations.js`** — add to the import block at
lines 10-15:

```js
import { readBoundedBodyText } from "../storage/body_limit.js";
```

and replace lines 31-42 with:

```js
const MAX_BODY_BYTES = 1024 * 1024;

async function readJson(request) {
  // 1 MiB ceiling: case full text can exceed 128 KiB (e.g. AATA 2 ≈ 170 KiB),
  // so the original 128 KiB cap silently rejected legitimate large cases.
  // Enforced by counting streamed bytes, not by trusting content-length,
  // which a chunked client omits entirely.
  const text = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
```

**7b. `workers/case-api/cloudflare_actions.js`** — add to the import block at
lines 10-14:

```js
import { readBoundedBodyText } from "../storage/body_limit.js";
```

and replace lines 30-39 with:

```js
const MAX_BODY_BYTES = 32 * 1024;

async function readJson(request) {
  const text = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
```

**7c. `workers/pipeline/control_handlers.js`** — add to the import block at
lines 8-13:

```js
import { readBoundedBodyText } from "../storage/body_limit.js";
```

and replace lines 34-43 with — note the `{}` fallback, which differs from the
other two and **must** be preserved, because `dispatchCloudflarePipelineControl`
relies on a non-object body falling through to per-path defaults:

```js
const MAX_BODY_BYTES = 32 * 1024;

async function readJson(request) {
  const text = await readBoundedBodyText(request, MAX_BODY_BYTES);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}
```

Every caller already maps `null` to a 400 `invalid json`, so oversize bodies
now produce the same 400 they were supposed to produce all along. No caller
changes.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run && \
  ! git grep -n -- 'content-length' -- 'workers/case-api/cloudflare_mutations.js' \
      'workers/case-api/cloudflare_actions.js' 'workers/pipeline/control_handlers.js' && echo OK
```
→ passed count = `WK_BEFORE + 5`, 0 failed, then `OK`. (`git grep` is used
rather than `grep --include`: this repo's shell may alias `grep` to `ugrep`,
which rejects `--include` with a warning and exit 0 — making the negated check
pass vacuously.)

## Test plan

New tests, all modelled on the file next to them:

- `tests/test_env_example_contract.py` (new, 3 tests) — the `.env.example`
  contract: file exists; every Python-read variable is documented; no Cloudflare
  account identifier is embedded. No existing test to model on; it is
  self-contained and uses only `re` + `pathlib`.
- `tests/test_internal_extract.py` (extended, 2 → 4 tests) — keeps the two
  existing header cases, adds `test_internal_extract_rejects_missing_token`
  (403 `invalid_extraction_token`) and `test_internal_extract_rejects_oversize_batch`
  (400 `bad_payload` at 21 items). Structural pattern: the existing tests in the
  same file.
- `tests/test_spa_asset_containment.py` (new, 3 tests) — a file inside the build
  dir is still served; a symlink escaping it 404s (this is the one that fails
  against unpatched code); encoded traversal never serves outside content.
- `workers/__tests__/body-limit.test.js` (new, 5 tests) — under the limit;
  oversize with **no** `content-length` (the regression this plan fixes);
  oversize via a chunked `ReadableStream`; oversize declared by header; empty
  body. Structural pattern: `workers/__tests__/cloudflare-actions.test.js`
  (plain `vitest` imports, `new Request(...)` helpers).
- `scripts/test_preflight_secrets.sh` (extended, 2 pipeline cases) — pipeline
  passes with only `EXTRACTION_SHARED_SECRET`; pipeline fails when it is absent.

Regression runs:

- `make test-py` — **delta, not an absolute**: the passed count must be exactly
  `PY_BEFORE + 8` (+3 contract, +2 internal extract, +3 SPA containment). Do not
  assert a total; sibling plans add tests in parallel and any figure written here
  would be stale. The failed count must be **unchanged**, and every remaining
  failure must still be one of the three `pypdf` `ImportError`s in
  `tests/test_backfill_judge_overrides_from_pdf.py` — check them **by name**,
  not by counting:
  ```bash
  make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort
  ```
  Every line must name `tests/test_backfill_judge_overrides_from_pdf.py`. Those
  three are environmental (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI
  mismatch breaking the `pypdf` import), not repo defects. A failure naming any
  other file is a regression — STOP.
- `cd workers && npx vitest run` — passed count = `WK_BEFORE + 5`, 0 failed.
- `cd frontend && npx vitest run` — passed count = `FE_BEFORE`, unchanged (this
  plan touches no frontend source).
- `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` — `All checks
  passed!` both before and after; `.venv/bin/ruff check . 2>&1 | tail -1`
  byte-identical to `RUFF_BEFORE`.

## Done criteria

ALL must hold:

- [ ] `make test-py 2>&1 | grep -E "^(FAILED|ERROR)"` prints only lines naming `tests/test_backfill_judge_overrides_from_pdf.py` (the three `pypdf` ImportErrors, by name — not by count), and the passed count equals `PY_BEFORE + 8`
- [ ] `.venv/bin/python -m pytest tests/test_env_example_contract.py -q` → `3 passed`
- [ ] `.venv/bin/python -m pytest tests/test_internal_extract.py -q` → `4 passed`
- [ ] `.venv/bin/python -m pytest tests/test_spa_asset_containment.py -q` → `3 passed`, **0 skipped**
- [ ] `.venv/bin/python -m pytest tests/test_app_factory.py -q` exits 0 with the same counts it had before this plan
- [ ] `cd workers && npx vitest run __tests__/body-limit.test.js` → `5 passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with 0 failed and a passed count equal to `WK_BEFORE + 5`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` passed count equals `FE_BEFORE`, unchanged
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check immi_case_downloader/ scripts/ *.py` prints `All checks passed!`
- [ ] `.venv/bin/ruff check . 2>&1 | tail -1` is byte-identical to `RUFF_BEFORE`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check tests/test_env_example_contract.py tests/test_internal_extract.py tests/test_spa_asset_containment.py` prints `All checks passed!`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && bash scripts/test_preflight_secrets.sh` prints `ALL PREFLIGHT TESTS PASSED` and exits 0
- [ ] `git grep -n -- 'content-length' -- 'workers/case-api/cloudflare_mutations.js' 'workers/case-api/cloudflare_actions.js' 'workers/pipeline/control_handlers.js'` returns no matches (use `git grep`, not `grep --include` — see Step 7)
- [ ] `grep -n 'AUTH_TOKEN' scripts/preflight_secrets.sh` matches only the explanatory comment added in Step 3, never a `REQUIRED_SECRETS=` line
- [ ] `grep -cE 'gateway\.ai\.cloudflare\.com/v1/[0-9a-f]{8}' .env.example` returns `0`
- [ ] `grep -n 'csrf.exempt(internal_extract_bp)' immi_case_downloader/web/internal_extract.py` still matches
- [ ] `git status --porcelain` lists only the 13 files named in "Scope" (plus any path that was already dirty when you started, recorded in the Step 0 drift check — do not clean those)
- [ ] `plans/README.md` status row for plan 045 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top produces output, or any excerpt in "Current state"
  does not match the live file at the cited lines.
- `run_case`'s parameter order in `scripts/test_preflight_secrets.sh` is not
  `<name> <secrets_json> <expected_exit> <expected_output_substring> [worker_kind]`
  — the Step 3 replacement cases would silently assert the wrong thing.
- After Step 3, `grep -rn "env\.AUTH_TOKEN" workers/` returns any match. That
  would mean the pipeline Worker still reads the secret and the gate is
  correct as written — leave `preflight_secrets.sh` alone and report.
- After Step 4, any existing test outside `tests/test_internal_extract.py`
  fails. That would mean something else calls the Flask `/internal/extract`
  route without the token header, and the parity change has a caller you were
  not told about.
- After Step 7, the Worker suite reports failures in
  `workers/__tests__/pipeline-control.test.js`,
  `workers/__tests__/cloudflare-actions.test.js`, or
  `workers/__tests__/cloudflare-mutations.test.js`. The most likely cause is
  the `{}` vs `null` fallback difference between the three helpers being lost
  in Step 7c — re-read the three replacements before retrying.
- `make test-py` reports a failing test outside
  `tests/test_backfill_judge_overrides_from_pdf.py`, or the failure set changes
  in any way from the one you recorded before starting.
- Any test in `tests/test_spa_asset_containment.py` **skips**. A skip means the
  fixture refused to write into the React build directory, so Step 5 is
  unverified — report it rather than accepting a green run.
- Step 7a is reached while `plans/006-harden-auth-and-authorization.md` is
  still in flight on `workers/case-api/cloudflare_mutations.js`. Stop and let
  the auth plan land first (see "Depends on").
- Step 2's contract test fails with a variable you cannot place in any
  `.env.example` section — report the name and its read site rather than
  guessing at a section or silently adding it to `UNDOCUMENTED_BY_DESIGN`.
- You find yourself needing to edit `wrangler.toml`, `web.py`, `CLAUDE.md`,
  `README.md`, `AGENTS.md`, `extract_container.py`, or anything under
  `workers/llm-council/`. Those are out of scope; report what you found.

## Maintenance notes

For the human or agent who owns this code next:

- **What a reviewer should scrutinise**: (1) that Step 7c preserved the `{}`
  fallback in `control_handlers.js` while the other two kept `null` — the three
  helpers look identical but are not; (2) that `csrf.exempt` survived Step 4,
  because removing it silently bricks the extraction route with no test to
  catch it; (3) that `send_from_directory(react_dir, path)` in Step 5 still
  receives the original relative `path`, not the resolved `asset_path`.
- **Deferred, deliberately out of this plan's file territory**:
  - `wrangler.toml:95-97` — the operator-secrets comment lists `CSRF_SECRET`,
    `JWT_SECRET_CURRENT/PREVIOUS`, `JWT_KID_CURRENT/PREVIOUS`,
    `TELEGRAM_BOT_TOKEN`, `CF_AIG_TOKEN` and omits `CRAWLER_WRITE_TOKEN`. Add a
    line naming it and stating that setting it enables a CSRF-free and
    membership-free write path (`workers/case-api/cloudflare_mutations.js:57-63`).
    This plan documents it in `.env.example` §7 instead.
  - `config/immi-separation.json:64-67` still lists `AUTH_TOKEN` under
    `pipeline_required_secrets`. Nothing reads that key today, so it is inert
    documentation drift, but it should follow Step 3 whenever that file is next
    touched.
  - `CLAUDE.md:59`, `AGENTS.md:59` and `README.md:141` all still describe
    `BACKEND_HOST` as the Flask bind address. Correct them to "Vite dev-proxy
    target host; Flask binds via `python web.py --host`" when those docs are
    next edited.
- **Operator action this plan enables, but cannot perform**: `AUTH_TOKEN` is
  still bound as a live secret on the pipeline Worker. Now that the gate no
  longer requires it, rotate it (if it was ever shared or logged) and then
  delete it:
  `npx wrangler secret delete AUTH_TOKEN --name <pipeline-worker-name>`.
- **Deliberately not done — deleting the Flask blueprint**: the cleanest
  long-term answer to the duplicate `/internal/extract` is to delete
  `immi_case_downloader/web/internal_extract.py` and keep `extract_container.py`
  as the single implementation (`Dockerfile.extractor:14` already runs only the
  container copy). That was rejected here because it is a deletion whose blast
  radius reaches the app factory and the local dev workflow, and it belongs
  with the other dead-code removals rather than with a hardening pass. Revisit
  it when someone confirms no local workflow POSTs to the Flask route.
- **What will interact with this next**: if a future endpoint needs a body
  ceiling, import `readBoundedBodyText` from `workers/storage/body_limit.js`
  rather than adding a fourth header-based copy — the LLM Council `readBody`
  (`workers/llm-council/cloudflare_handlers.js`, around lines 67-74) is the
  obvious next candidate and currently has no size guard at all.
- **The contract test is the thing that keeps this fixed.** If it ever becomes
  noisy, document the variable rather than relaxing `DIRECT_READ_RE` /
  `HELPER_READ_RE`; the whole point is that `.env.example` cannot silently fall
  behind again.
- **Follow-up: the contract test covers Python only.** It scans
  `immi_case_downloader/`, `scripts/` and the repo root for `os.environ` /
  `os.getenv` / `_*_env()` reads. It does **not** see Worker `env.*` reads,
  Wrangler `[vars]` / secret names, `import.meta.env.*` in the Vite bundle, or
  shell/CI `env:` blocks — so those four surfaces are documented by hand and can
  drift silently, exactly the way the Python list did. Extending it is a real
  piece of work with its own decisions (a Worker `env.X` scanner needs a
  destructuring-aware parse, not a regex; Wrangler names live in a TOML the
  repo deliberately ships with placeholders). Until someone does it, both the
  `.env.example` header and the test docstring say so explicitly — do not
  re-describe this file as a repo-wide machine-verified inventory.

## Findings reconsidered

- **SEC-18, `wrangler.toml` sub-item** — real and confirmed (the operator-secrets
  comment at `wrangler.toml:95-97` omits `CRAWLER_WRITE_TOKEN`, the one secret
  that enables a CSRF-free and membership-free write path), but `wrangler.toml`
  is outside this plan's file territory and is being edited by a plan running in
  parallel. The substance is addressed in `.env.example` §7 with the same
  warning text; the exact one-line `wrangler.toml` change is recorded in
  "Maintenance notes" so it is not lost.
- **SEC-05, "drop the `csrf.exempt`" sub-recommendation** — not done, and
  deliberately so. `flask-wtf`'s `CSRFProtect` would reject every POST from the
  Cloudflare Worker service binding, which carries no CSRF token, so removing
  the exemption would disable the route rather than harden it. The custom
  `X-Extraction-Token` header requirement added in Step 4 already provides the
  CSRF property the recommendation was reaching for, because a cross-site
  request cannot set a custom header without a CORS preflight.
- **Line-number corrections made against the original audit** (the underlying
  problems all held; only the coordinates drifted): `extract_container.py`'s
  shared-secret check is at lines 28-32 and its batch cap at line 37 (audit said
  29-31 and 36); `immi_case_downloader/web/routes/api.py`'s `resolve()` +
  `relative_to` guard is at lines 2548-2554 (audit said 2551);
  `workers/austlii-scraper/src/extract.ts`'s `EXTRACTION_SHARED_SECRET` check is
  at line 45 as claimed, and its outbound `X-Extraction-Token` header — which
  the audit did not mention but which is what makes Step 4 safe — is at line 142.
- **`.env.example` account-identifier framing corrected** — the audit called it
  "an account identifier in `.env.example`", which is accurate, but removing it
  from that one file does **not** remove it from the repository: the same
  identifier is hardcoded in `immi_case_downloader/llm_council.py:40`,
  `workers/llm-council/runner.js:29`, `workers/llm-council/runner.js:1460` and
  `workers/llm-council/handlers.js:145`. Step 1 is still worth doing (it stops
  the copy-me template from pointing a new operator at the project owner's
  gateway) but it is not a secret-removal, and a Cloudflare account ID is an
  identifier, not a rotatable credential.
- **Two defects found while verifying, folded into Step 1** — neither was in the
  audit. (1) `.env.example:52-53` documents `VITE_TELEGRAM_BOT_NAME` as a root
  `.env` entry, but `frontend/vite.config.ts` sets no `envDir`, so Vite loads
  client env only from `frontend/`; verified empirically with Vite's own
  `loadEnv` that a parent-directory `.env` is not picked up. (2) `.env.example:55`
  claims the JWT secrets are "also needed by Flask" — that one is **true**
  (`immi_case_downloader/web/auth.py:77-78` reads `JWT_SECRET_CURRENT` and
  `JWT_SECRET_PREVIOUS`) and was preserved, but the `JWT_KID_*` pair alongside
  it is Worker-only and was reclassified.
