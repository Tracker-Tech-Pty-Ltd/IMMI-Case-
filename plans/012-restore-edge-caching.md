# Plan 012: Bring back the Cache API layer the proxy.js deletion removed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists; if it does not exist, do not
> create it.
>
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff sees
> only what is committed, so on a dirty tree it gives a false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="workers/case-api/cloudflare.js workers/cloudflare-native.js workers/__tests__/"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> **This plan runs LAST in its lane** (see "Integration order" below), so
> `git diff --stat 42826a3..HEAD` is *expected* to list all three paths. That is
> not drift; it is the four plans you are rebasing onto. What you must do instead
> of a blanket comparison: re-read every verbatim excerpt in "Current state"
> against the live file and **re-derive every line number in this plan** before
> editing. A mismatch in the specific excerpts is a STOP condition.
> Anything appearing in the **unstaged** or **staged** diffs is a STOP condition
> regardless — that is someone's uncommitted work. Never run `git checkout --`
> or `git clean` to tidy it away.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/009-*.md`, `plans/010-*.md`, `plans/013-*.md`,
  `plans/014-*.md` — **all four, and this is not merely a merge-order
  preference.** An edge cache freezes whatever the handlers return for up to the
  declared TTL, so caching a response that is still wrong is worse than not
  caching it:
  - **010** fixes `/api/v1/analytics/monthly-trends` returning an inflated win
    rate, and adds the `truncated` flags. Cache this endpoint before 010 lands
    and a self-representing applicant is served a wrong success rate from the
    edge for 600 s at a time, with no way for a fix to reach them until the
    entry expires.
  - **009** stops a failed aggregate rebuild from publishing empty analytics
    tables. Cache before that and a transient rebuild failure gets pinned at the
    edge — a dashboard confidently reporting zero cases, held for 600 s.
  - **013** changes `/api/v1/cases`' `total` semantics and adds the indexes that
    make the uncached path affordable in the first place.
  - **014** changes what `/api/v1/analytics/judge-leaderboard` reads.
  Land all four first, then this.
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

### Integration order

```
009  →  010  →  013  →  014  →  012 (this plan)
```

Five plans edit `workers/storage/cloudflare.js` and/or
`workers/case-api/cloudflare.js`; integrate serially in that order, each rebased
on the previous one's HEAD. Because this plan is last, **every line number below
is stale by construction** — re-derive them all from the live file.
`plans/011-*.md` is independent and may run in parallel.

Note also that `plans/010-*.md` modifies
`workers/__tests__/case-api-cloudflare.test.js` (its store mock). This plan's
requirement that the file stay unmodified means "unmodified **by you**, relative
to the branch you start from" — not "identical to `42826a3`".

## Why this matters

Commit `f91f45f` ("refactor(cloudflare): remove legacy Supabase/Hyperdrive
worker code") deleted `workers/proxy.js`, and with it every Cloudflare Cache
API call in the repository. Six separate perf commits' worth of edge caching
(`88b2d2b`, `55be717`, `75049d3`, `764ed1c`, `4c24ef6`, `e9a2ff5`) went out the
door as collateral damage of that deletion — it was not a deliberate decision to
stop caching. Today `grep -rn 'caches\.' workers/` returns **zero** hits.

The consequence is concrete: 28 read handlers in
`workers/case-api/cloudflare.js` still declare `Cache-Control: public, max-age=…`
on their responses, but Cloudflare does **not** automatically store a
Worker-generated `Response` at the edge. That header therefore only reaches the
*viewer's own browser*. Every distinct visitor — and every first request from a
returning visitor whose browser entry expired — pays the full D1 aggregate scan
again. The endpoints affected are the expensive ones: judge leaderboard,
concept co-occurrence, concept trends, flow matrix, success rate, court lineage,
taxonomy/countries.

After this plan, a single `cachedRead` wrapper at the dispatch boundary honours
those already-declared TTLs at the edge, so the second and subsequent viewers in
a colo are served from cache instead of D1. The change is deliberately keyed off
headers the handlers *already* set: no handler's caching contract is altered,
nothing that says `no-cache` or `no-store` starts being cached, and an operator
can kill the whole layer with one environment variable and no redeploy.

### Why this ships DISABLED by default

The layer is opt-in (`IMMI_EDGE_CACHE_ENABLED="true"`), and that is not
timidity — three things must be true before a **shared** cache in front of this
data is safe, and only the first is true today:

1. ✅ **Read responses cannot vary per user.** Verified structurally: the router
   takes no `Request`. See Verified fact 4.
2. ❌ **The corpus is not being written behind the cache.** It is. The original
   version of this plan argued the corpus is "near-static in production because
   `IMMI_CASE_MUTATIONS_ENABLED` defaults to `\"false\"`". That flag gates only
   the **HTTP** mutation routes (`workers/case-api/cloudflare_mutations.js:302`
   returns 503 before anything else runs). The AustLII scraper Worker is a
   *producer* on the very same queue the main Worker consumes:
   `config/wrangler-austlii-native.toml.example:38-40` binds
   `NATIVE_CASE_QUEUE` to `queue = "immi-case-mutation-queue"`, and
   `workers/austlii-scraper/src/extract.ts:227` sends to it. Every such message
   lands in `handleCaseMutationQueue`, which calls `rebuildAggregates()` — so
   cases and all 17 analytics tables change without the flag being touched.
3. ❌ **There is a way to purge what the cache holds.** There is not.
   `handleCacheInvalidate` (`workers/case-api/cloudflare_actions.js:80-85`)
   returns a hardcoded `{ invalidated: true }` and purges nothing, and even a
   real `caches.default.delete()` only affects the colo that served the request
   — Cloudflare's Cache API is per-colo, so one delete cannot clear the other
   hundreds, nor every query-string variant of an endpoint.

This plan therefore ships the **mechanism** plus the two things point 3 needs to
become achievable: a version-namespaced cache key (`__v`, driven by
`IMMI_EDGE_CACHE_VERSION`), which gives a global, cross-colo purge lever that a
per-colo `delete()` cannot; and an off-by-default switch so nothing changes for
users until an operator decides. The remaining work before flipping it on is
listed under "Maintenance notes → Before enabling this in production", and
includes an end-to-end mutation → invalidate → fresh-read test that this plan
cannot write, because it needs a deployed Worker and a real queue.

## Current state

### The files this plan touches

- `workers/case-api/cloudflare.js` (1168 lines) — every Cloudflare-native GET
  read handler plus the `dispatchCloudflareCaseRead` router at the bottom.
- `workers/cloudflare-native.js` (247 lines) — the production Worker entrypoint;
  its `fetch()` calls `dispatchCloudflareCaseRead` for GET requests.
- `workers/__tests__/case-api-edge-cache.test.js` — does not exist yet; you
  create it.

### Verified fact 1 — there is zero Cache API usage in the Worker tree

```
$ grep -rn 'caches\.' workers --include='*.js' --include='*.ts' | grep -v node_modules | wc -l
0
```

`grep -rn 'scheduled' workers --include='*.js' | grep -v node_modules` also
returns nothing, and `wrangler.toml` has no `[triggers]` / `crons` block.

### Verified fact 2 — `jsonOk` only sets a header; it never stores anything

`workers/case-api/cloudflare.js:74-80` (verbatim):

```js
function jsonOk(body, cacheControl = "no-cache") {
  return Response.json(body, { headers: { "Cache-Control": cacheControl } });
}

function jsonErr(error, status = 400, code = undefined) {
  return Response.json(code ? { error, code } : { error }, { status });
}
```

The default is `"no-cache"`. Handlers that want caching pass an explicit string.

### Verified fact 3 — 28 call sites already declare `public, max-age=…`

```
$ grep -c '"public, max-age' workers/case-api/cloudflare.js
28
```

Two representative sites, verbatim:

`workers/case-api/cloudflare.js:356-357`

```js
function handleDataDictionary() {
  return jsonOk({ fields: DATA_DICTIONARY_FIELDS }, "public, max-age=86400");
}
```

`workers/case-api/cloudflare.js:1093-1103`

```js
    if (path === "/api/v1/cases") {
      const response = await stores.caseStore.listPage({
        filters: requestFilters(url.searchParams),
        sortBy: url.searchParams.get("sort_by") || "date",
        sortDir: url.searchParams.get("sort_dir") || "desc",
        page: url.searchParams.get("page") || 1,
        pageSize: url.searchParams.get("page_size") || 100,
      });
      return jsonOk({ ...response, cases: response.cases.map(publicCase), count_mode: "exact" },
        "public, max-age=30, stale-while-revalidate=10");
    }
```

Handlers that must **not** be cached already say so and will be excluded
automatically by the `public,` prefix test this plan introduces. Verbatim
examples:

`workers/case-api/cloudflare.js:1104-1106` (default `no-cache`):

```js
    if (path === "/api/v1/cases/count") {
      return jsonOk({ total: await stores.caseStore.countCompat(requestFilters(url.searchParams)), count_mode: "exact" });
    }
```

`workers/case-api/cloudflare.js:135-137` — the CSV/JSON export path sets
`"Cache-Control": "no-store"` on both branches of `handleExport`.

### Verified fact 4 — the read path is structurally header-blind (this is the safety proof)

`workers/case-api/cloudflare.js:1029-1030` (verbatim — the two lines you will
replace in Step 1):

```js
export async function dispatchCloudflareCaseRead(url, path, env) {
  if (getStorageMode(env) !== "cloudflare") return null;
```

The router receives `(url, path, env)` and **no `Request` object**. Every
handler it calls takes `(url, stores)`, `(path, stores)`, `(stores)` or nothing:

```
$ grep -n 'function handle.*request' workers/case-api/cloudflare.js
(no matches)
```

Because no read handler can see a cookie, an `Authorization` header, or a tenant
id, no read response can vary per user. That is what makes a **shared** edge
cache safe here. Preserving this property is a hard constraint of this plan:
you must not add a `request` parameter to the read path.

### Verified fact 5 — the entrypoint calls the router without `ctx`

`workers/cloudflare-native.js:228-236` (verbatim):

```js
    const council = await dispatchCloudflareCouncil(request, env, path, request.method, ctx);
    if (council !== null) return council;
    if (request.method === "GET") {
      const response = await dispatchCloudflareCaseRead(url, path, env);
      if (response !== null) return response;
    }
    if (path.startsWith("/api/")) {
      return unavailable("This API route is not yet available in the Cloudflare-native runtime");
    }
```

Note that `dispatchCloudflareCouncil` on line 228 already receives `ctx` — that
is the in-repo precedent for threading it, and you will follow it.

`workers/cloudflare-native.js:191-199` — the default export declares only
`queue()` and `fetch()`; there is no `scheduled()` handler:

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
```

### Repo conventions you must match

**Environment kill switches use the `=== "false"` shape.** From
`workers/cloudflare-native.js:167-168` (verbatim):

```js
async function dispatchAuth(request, env, path, method) {
  if (env.AUTH_ENABLED === "false") return null;
```

That is the shape used for a kill switch on a feature that is **on by default**.
This plan deliberately uses the **inverse** — `env?.IMMI_EDGE_CACHE_ENABLED !== "true"`
— so an unset variable means **off**. The reason is in "Why this ships
disabled": with no working cross-colo invalidation and a corpus that the scraper
Worker actively writes to, a default-on shared cache would pin stale (or wrong)
analytics in front of users for up to 600 s with no lever to clear it. Opting in
is also what lets this land, and be tested, without an operator decision
attached to the merge. Do not "align it with the `AUTH_ENABLED` convention" —
the conventions differ because the defaults differ.

**Structured logs are one-line JSON via `console.error`.** From
`workers/case-api/cloudflare.js:1165` (verbatim):

```js
    console.error(JSON.stringify({ event: "case.cloudflare.read_error", error: err?.message }));
```

**The Worker test environment is plain Node, not workerd.**
`workers/vitest.config.js` sets `environment: "node"`, and
`node -e "console.log(typeof caches)"` prints `undefined`. Therefore the
production code must tolerate `caches` being absent, and your tests must install
a fake `globalThis.caches` themselves.

**Worker tests mock the storage layer at the module boundary.** From
`workers/__tests__/case-api-cloudflare.test.js:1-11` (verbatim):

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
```

**Storage mode is selected by `env.IMMI_STORAGE_MODE`.** From
`workers/storage/contracts.js:34-35`:

```js
export function getStorageMode(env) {
  const mode = env?.IMMI_STORAGE_MODE || "legacy";
```

Tests pass `{ IMMI_STORAGE_MODE: "cloudflare" }` as the env object.

**Architecture constraint from `CLAUDE.md`, quoted so you don't have to look it
up**: "`env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1
bindings, not Postgres connections — there is no per-request client to construct
and no Hyperdrive pooler in this stack." There is nothing to pool-warm; the only
thing worth caching is the finished response.

**Commit convention** (from `git log`): `<type>: <description>` where type is
one of `feat|fix|refactor|docs|test|chore|perf|ci`. Real example:
`fix: install root node_modules in make install`. No AI attribution lines.

## Commands you will need

**Record your baselines first (Step 0).** This plan lands after four siblings
that all add tests to the same suite, so an absolute total is guaranteed wrong:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_WORKER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_WORKER=$BEFORE_WORKER"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
BEFORE_FE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_FE=$BEFORE_FE"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short > /tmp/immi-012-dirty-before.txt
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (all) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | zero failures; total equals `BEFORE_WORKER + 10` after Step 3 |
| Worker tests (this plan only) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-edge-cache.test.js` | `Tests 10 passed (10)` — a per-file count, stable regardless of siblings |
| Worker tests (regression file) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js __tests__/cloudflare-native-entry.test.js` | all pass, 0 failed |
| Node syntax check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/case-api/cloudflare.js && node --check workers/cloudflare-native.js` | exit 0, no output. **Parse check only** — it cannot tell a correct refactor from a wrong one; the two regression test files above are what prove behaviour was preserved. |
| Frontend tests (unaffected; run once at the end) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | zero failures, total equal to `BEFORE_FE` |
| Files changed | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` and `git diff --stat` and `git diff --cached --stat` | exactly the three in-scope files, plus whatever `/tmp/immi-012-dirty-before.txt` already listed |

Do **not** run `make test` for this plan. It also runs the Python suite, which
has 3 pre-existing environment-only failures at this commit (a Homebrew Python
3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import in
`tests/test_backfill_judge_overrides_from_pdf.py`). Those failures are unrelated
to this plan and must not be "fixed" here.

## Scope

**In scope** (the only files you may modify or create):

- `workers/case-api/cloudflare.js` — add the edge-cache helpers next to
  `jsonOk`/`jsonErr`, and split `dispatchCloudflareCaseRead` into a caching
  wrapper plus an unexported `resolveCloudflareCaseRead`. Touch **no handler
  body**.
- `workers/cloudflare-native.js` — one line: pass `ctx` into
  `dispatchCloudflareCaseRead`.
- `workers/__tests__/case-api-edge-cache.test.js` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `wrangler.toml` — a `[triggers]`/`crons` block is deliberately not part of
  this plan (see "Findings reconsidered"), and this file is owned by another
  in-flight plan.
- `workers/case-api/cloudflare_actions.js` — `handleCacheInvalidate` lives here
  and is deliberately left for a follow-up (see "Findings reconsidered"). This
  file is owned by another in-flight plan; editing it here would create a merge
  conflict.
- `scripts/check_cloudflare_native_target.py` and
  `tests/test_cloudflare_native_target.py` — the deploy config gates. Nothing in
  this plan changes the deployable config shape, so they need no edits.
- `workers/__tests__/case-api-cloudflare.test.js` and
  `workers/__tests__/cloudflare-native-entry.test.js` — existing tests owned by
  other plans. They must keep passing **unmodified**; that is the regression
  signal that your change is behaviour-preserving on the non-cached paths.
- Any handler body in `workers/case-api/cloudflare.js`. Do not change a single
  `Cache-Control` string, do not add a TTL, do not remove one. The whole design
  is "honour what the handlers already declare".
- The three failing Python tests in
  `tests/test_backfill_judge_overrides_from_pdf.py` (environmental, see above).

## Git workflow

- Branch: `git checkout -b advisor/012-restore-edge-caching`
- Commit per step (Steps 1+2 may share one commit since the codebase is only
  coherent once `ctx` is threaded). Message style — conventional commits,
  e.g. `perf: cache public GET reads at the Cloudflare edge`.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

## Steps

### Step 1: Add the edge-cache helpers and wrap the read router

**1a.** In `workers/case-api/cloudflare.js`, insert the following block
immediately after the `jsonErr` function (i.e. after line 80, before
`async function handleJudgePhoto`):

```js
// --- Edge cache (Cloudflare Cache API) ---------------------------------------
// Safe to SHARE across viewers because the read path is header-blind:
// dispatchCloudflareCaseRead takes (url, path, env) and never a Request, so no
// read response can vary by cookie, Authorization header or tenant. Only 200
// responses that ALREADY declare `Cache-Control: public, ...` are stored, so
// every `no-cache` / `no-store` handler keeps its current behaviour.
//
// OPT-IN, not opt-out. Set IMMI_EDGE_CACHE_ENABLED="true" to turn the layer on;
// anything else (including unset) leaves it off. See "Why this ships disabled"
// in the plan: there is no working cross-colo invalidation, and the case corpus
// is NOT static — the AustLII scraper Worker writes cases straight into
// immi-case-mutation-queue via its NATIVE_CASE_QUEUE producer binding
// (config/wrangler-austlii-native.toml.example:38-40), which bypasses the
// IMMI_CASE_MUTATIONS_ENABLED flag entirely.
//
// IMMI_EDGE_CACHE_VERSION is the global purge lever: every cache key is
// namespaced by it, so bumping the variable makes every previously stored entry
// unreachable in every colo at once. caches.default.delete() cannot do that —
// it only affects the colo that served the delete.
const EDGE_CACHEABLE_CONTROL_RE = /^\s*public\s*,/i;

function edgeCache(env) {
  if (env?.IMMI_EDGE_CACHE_ENABLED !== "true") return null;
  return typeof caches !== "undefined" && caches?.default ? caches.default : null;
}

function edgeCacheKey(url, env) {
  // Canonicalise so ?a=1&b=2 and ?b=2&a=1 share one entry.
  //
  // Sort by parameter NAME ONLY. Array.prototype.sort is stable (ES2019+), so
  // repeated parameters keep their original relative order. Sorting by
  // [name, value] would be a correctness bug: the handlers read repeated
  // parameters with searchParams.get(), which returns the FIRST value
  // (see requestFilters, workers/case-api/cloudflare.js:110-122), so
  // ?court=FCA&court=AATA and ?court=AATA&court=FCA produce DIFFERENT responses
  // — and a value-sorting key would collapse them onto one entry and serve the
  // wrong one.
  const source = new URL(url.toString());
  const params = [...source.searchParams.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]));
  const key = new URL(source.toString());
  key.search = "";
  // Namespace by version so an operator can invalidate everything at once.
  key.searchParams.append("__v", String(env?.IMMI_EDGE_CACHE_VERSION || "1"));
  for (const [name, value] of params) key.searchParams.append(name, value);
  return new Request(key.toString(), { method: "GET" });
}

function isEdgeCacheable(response) {
  return response instanceof Response
    && response.status === 200
    && !response.headers.has("Set-Cookie")
    && EDGE_CACHEABLE_CONTROL_RE.test(response.headers.get("Cache-Control") || "");
}
```

Three notes on the key:

- `__v` is prepended before the caller's parameters and is a reserved name. No
  handler reads it — confirm with
  `grep -n '"__v"' workers/case-api/cloudflare.js` → no matches — and it never
  reaches a handler anyway, because the key is only ever used as a `cache.match`
  / `cache.put` argument; the real `url` is what is passed to
  `resolveCloudflareCaseRead`.
- Sorting by name only is what makes the key **behaviour-preserving**. If you
  find yourself wanting to sort values too "for a better hit rate", re-read the
  comment: the hit rate improvement would come from serving wrong answers.
- The version namespace is a *lever*, not automatic invalidation. Bumping it is
  an operator action; nothing bumps it on a case write. That is why the layer
  ships off — see below.

**1b.** Replace exactly these two lines at `workers/case-api/cloudflare.js:1029-1030`:

```js
export async function dispatchCloudflareCaseRead(url, path, env) {
  if (getStorageMode(env) !== "cloudflare") return null;
```

with this:

```js
export async function dispatchCloudflareCaseRead(url, path, env, ctx = undefined) {
  if (getStorageMode(env) !== "cloudflare") return null;
  const cache = edgeCache(env);
  if (!cache) return resolveCloudflareCaseRead(url, path, env);
  const cacheKey = edgeCacheKey(url, env);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  } catch (error) {
    console.error(JSON.stringify({ event: "case.cloudflare.cache_match_error", path, error: error?.message }));
  }
  const response = await resolveCloudflareCaseRead(url, path, env);
  if (isEdgeCacheable(response)) {
    const write = cache.put(cacheKey, response.clone()).catch((error) => {
      console.error(JSON.stringify({ event: "case.cloudflare.cache_put_error", path, error: error?.message }));
    });
    if (typeof ctx?.waitUntil === "function") ctx.waitUntil(write);
    else await write;
  }
  return response;
}

async function resolveCloudflareCaseRead(url, path, env) {
```

Everything from the old line 1031 (`  if (path === "/api/v1/legislations/update/status") {`)
to the closing brace at old line 1168 stays **byte-for-byte unchanged** and
becomes the body of `resolveCloudflareCaseRead`. Note that the
`getStorageMode` guard moved up into the wrapper and is deliberately **not**
duplicated in `resolveCloudflareCaseRead` — it must still be called exactly once
per request.

Three details that matter and are easy to get wrong:

- `response.clone()` must be evaluated *before* you return `response`. Writing
  `cache.put(cacheKey, response.clone())` inline as above does that correctly.
- `resolveCloudflareCaseRead` can return `null` (unknown route).
  `isEdgeCacheable(null)` is `false` because of the `instanceof Response` test,
  so `null` is returned untouched and the entrypoint's fall-through still works.
- When `ctx` is absent (every current unit test, and any caller that omits it)
  the `put` is awaited instead. Do not drop the write silently in that case.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/case-api/cloudflare.js && echo SYNTAX_OK
```
→ prints `SYNTAX_OK`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js
```
→ all tests pass, `0 failed`. (These tests never define `globalThis.caches`, so
`edgeCache()` returns `null` and they exercise the unchanged
`resolveCloudflareCaseRead` path. If any of them fail, your refactor was not
behaviour-preserving — see STOP conditions.)

### Step 2: Thread `ctx` from the Worker entrypoint

In `workers/cloudflare-native.js`, change line 231 from:

```js
      const response = await dispatchCloudflareCaseRead(url, path, env);
```

to:

```js
      const response = await dispatchCloudflareCaseRead(url, path, env, ctx);
```

That is the only change to this file. Do not add a `scheduled()` handler, do not
add imports, do not touch the `env.ASSETS.fetch` block.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/cloudflare-native.js && grep -n 'dispatchCloudflareCaseRead(url, path, env, ctx)' workers/cloudflare-native.js
```
→ exit 0 and one match on line 231

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-entry.test.js
```
→ all tests pass, `0 failed`

### Step 3: Create the edge-cache test file

Create `workers/__tests__/case-api-edge-cache.test.js` with exactly this
content:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";

// The layer is opt-in, so every test that expects caching must enable it.
const ENV = { IMMI_STORAGE_MODE: "cloudflare", IMMI_EDGE_CACHE_ENABLED: "true" };

/** Minimal stand-in for Cloudflare's per-colo `caches.default`. */
class FakeCache {
  constructor() {
    this.store = new Map();
    this.putCalls = 0;
  }

  async match(request) {
    const stored = this.store.get(request.url);
    // The real Cache API hands back a fresh readable body every time.
    return stored ? stored.clone() : undefined;
  }

  async put(request, response) {
    this.putCalls += 1;
    this.store.set(request.url, response);
  }
}

let cache;

function stores() {
  return {
    caseStore: {
      countCompat: vi.fn(async () => 7),
    },
  };
}

function url(path) {
  return new URL(`https://immi.example${path}`);
}

beforeEach(() => {
  cache = new FakeCache();
  globalThis.caches = { default: cache };
  mockCreateStores.mockReset();
  mockCreateStores.mockImplementation(() => stores());
});

afterEach(() => {
  delete globalThis.caches;
});

describe("dispatchCloudflareCaseRead edge cache", () => {
  it("stores a 200 response that declares Cache-Control: public", async () => {
    const response = await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(cache.putCalls).toBe(1);
    expect(cache.store.has("https://immi.example/api/v1/data-dictionary")).toBe(true);
    // The returned body must still be readable after the clone was stored.
    await expect(response.json()).resolves.toHaveProperty("fields");
  });

  it("serves the second request from cache without re-running the handler", async () => {
    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );
    expect(mockCreateStores).toHaveBeenCalledTimes(1);

    const second = await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(mockCreateStores).toHaveBeenCalledTimes(1);
    expect(cache.putCalls).toBe(1);
    await expect(second.json()).resolves.toHaveProperty("fields");
  });

  it("does NOT store a response whose Cache-Control is no-cache", async () => {
    const response = await dispatchCloudflareCaseRead(
      url("/api/v1/cases/count"), "/api/v1/cases/count", ENV,
    );

    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(cache.putCalls).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it("canonicalises query-parameter order into one cache entry", async () => {
    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary?b=2&a=1"), "/api/v1/data-dictionary", ENV,
    );
    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary?a=1&b=2"), "/api/v1/data-dictionary", ENV,
    );

    expect(cache.store.size).toBe(1);
    expect(mockCreateStores).toHaveBeenCalledTimes(1);
  });

  it("defers the cache write to ctx.waitUntil when a ctx is supplied", async () => {
    const pending = [];
    const ctx = { waitUntil: vi.fn((promise) => pending.push(promise)) };

    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV, ctx,
    );

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(pending);
    expect(cache.putCalls).toBe(1);
  });

  it("is OFF unless IMMI_EDGE_CACHE_ENABLED is exactly \"true\"", async () => {
    // The default: the variable is not set at all.
    const off = { IMMI_STORAGE_MODE: "cloudflare" };

    await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", off);
    await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", off);

    expect(cache.putCalls).toBe(0);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);

    // And an explicit "false", and any other truthy-looking string.
    for (const value of ["false", "1", "yes", "TRUE"]) {
      vi.clearAllMocks();
      cache = new FakeCache();
      globalThis.caches = { default: cache };
      const env = { IMMI_STORAGE_MODE: "cloudflare", IMMI_EDGE_CACHE_ENABLED: value };
      await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", env);
      await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", env);
      expect(cache.putCalls, `IMMI_EDGE_CACHE_ENABLED=${value} must not enable the cache`).toBe(0);
    }
  });

  it("keeps repeated query parameters in their original order", async () => {
    // requestFilters uses searchParams.get(), which returns the FIRST value, so
    // these two URLs produce different responses and must NOT share a key.
    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary?court=FCA&court=AATA"), "/api/v1/data-dictionary", ENV,
    );
    await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary?court=AATA&court=FCA"), "/api/v1/data-dictionary", ENV,
    );

    expect(cache.store.size).toBe(2);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
  });

  it("namespaces entries by IMMI_EDGE_CACHE_VERSION", async () => {
    const v1 = { ...ENV, IMMI_EDGE_CACHE_VERSION: "1" };
    const v2 = { ...ENV, IMMI_EDGE_CACHE_VERSION: "2" };

    await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v1);
    expect(mockCreateStores).toHaveBeenCalledTimes(1);

    // Same URL, bumped version: the old entry is unreachable, so the handler runs.
    await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v2);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(2);

    // Back to v1: served from cache, handler not re-run.
    await dispatchCloudflareCaseRead(url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v1);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
  });

  it("still serves the response when the cache backend throws", async () => {
    globalThis.caches = {
      default: {
        match: vi.fn(async () => { throw new Error("cache unavailable"); }),
        put: vi.fn(async () => { throw new Error("cache unavailable"); }),
      },
    };

    const response = await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveProperty("fields");
  });

  it("returns null for an unknown route without touching the cache", async () => {
    const response = await dispatchCloudflareCaseRead(
      url("/api/v1/not-a-route"), "/api/v1/not-a-route", ENV,
    );

    expect(response).toBeNull();
    expect(cache.putCalls).toBe(0);
  });
});
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-edge-cache.test.js
```
→ `Test Files 1 passed (1)`, `Tests 10 passed (10)`

Prove the repeated-parameter test is a real guard, not a tautology. Temporarily
change `edgeCacheKey`'s comparator back to the buggy
`left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])`, re-run just
that test, and confirm it **fails** with `cache.store.size` equal to `1` instead
of `2`. Restore the name-only comparator immediately and re-run to confirm it
passes:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-edge-cache.test.js -t "keeps repeated query parameters in their original order"
```

### Step 4: Full Worker suite regression

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -6
```
→ zero failures, and the `Tests … passed` total equals `BEFORE_WORKER + 10`
(+1 file / +10 tests). Do not assert an absolute number.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short && git diff --stat && git diff --cached --stat
```
→ your three files:
```
 M workers/case-api/cloudflare.js
 M workers/cloudflare-native.js
?? workers/__tests__/case-api-edge-cache.test.js
```
plus exactly whatever `/tmp/immi-012-dirty-before.txt` recorded before you
started (on the machine this plan was written on that was ` M .claude/STATE.md`
and `?? plans/`, but do not hard-code that — compare against your own file).
Leave every pre-existing entry exactly as you found it; do not stage, revert or
edit it. If a file you did not edit and did not record shows up, stop.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -4
```
→ zero failures and a total equal to `BEFORE_FE` — unchanged; this plan touches
no frontend code.

## Test plan

New file `workers/__tests__/case-api-edge-cache.test.js`, modelled structurally
on `workers/__tests__/case-api-cloudflare.test.js` (same
`vi.mock("../storage/cloudflare.js", …)` boundary, same
`new URL("https://immi.example…")` helper, same
`{ IMMI_STORAGE_MODE: "cloudflare", IMMI_EDGE_CACHE_ENABLED: "true" }` env
object — the flag is required now that the layer is opt-in). Ten cases:

1. **Happy path / store** — `/api/v1/data-dictionary` declares
   `public, max-age=86400`, so exactly one `cache.put` happens and the returned
   body is still readable afterwards (proves the `clone()` ordering is right).
2. **Cache hit** — a second identical request does not construct stores again,
   i.e. the D1 layer is genuinely skipped.
3. **Negative / `no-cache`** — `/api/v1/cases/count` uses `jsonOk`'s default
   `"no-cache"` and must never be stored. This is the regression guard against
   someone widening `EDGE_CACHEABLE_CONTROL_RE` later.
4. **Key canonicalisation** — `?b=2&a=1` and `?a=1&b=2` collapse to one entry.
5. **`ctx.waitUntil`** — when a ctx is passed the write is deferred, not
   awaited inline, and still completes.
6. **Off by default** — with the variable unset, and with `"false"`, `"1"`,
   `"yes"` and `"TRUE"`, the layer is bypassed entirely and both requests reach
   the handler. Only the exact string `"true"` enables it.
7. **Cache backend failure** — a `caches.default` whose `match`/`put` throw must
   degrade to a normal uncached response, never a 500.
8. **Unknown route** — `null` passes through untouched so the entrypoint's
   fall-through to `unavailable(...)` / `env.ASSETS.fetch` still works.

9. **Repeated parameters keep their order** — `?court=FCA&court=AATA` and
   `?court=AATA&court=FCA` must produce **two** entries, because the handlers
   read the first value and therefore return different bodies. This is the guard
   against a "tidier" cache key that collapses them.
10. **Version namespace** — bumping `IMMI_EDGE_CACHE_VERSION` orphans the old
    entry (handler re-runs), and reverting the version finds the original entry
    again. This is the cross-colo purge lever, so it needs a test.

The two existing files `case-api-cloudflare.test.js` (45 calls to
`dispatchCloudflareCaseRead`) and `cloudflare-native-entry.test.js` must pass
**unmodified by you** — note `plans/010-*.md` legitimately edits the store mock
in the first of those before you start, so "unmodified" means relative to the
branch you branch from, not to `42826a3`. They never set `globalThis.caches`,
and they never set `IMMI_EDGE_CACHE_ENABLED`, so they run the cache-disabled
path twice over and are the proof that the Step 1 refactor preserved behaviour.

## Done criteria

ALL must hold:

- [ ] `node --check workers/case-api/cloudflare.js` exits 0 (parse check)
- [ ] `node --check workers/cloudflare-native.js` exits 0 (parse check)
- [ ] `cd workers && npx vitest run` reports `0 failed` and a total equal to
      `BEFORE_WORKER + 10`
- [ ] `cd workers && npx vitest run __tests__/case-api-edge-cache.test.js`
      reports `Tests 10 passed (10)`
- [ ] Each of the ten tests reports `Tests 1 passed` when run with `-t "<title>"`
      (none reports `0 passed` or `No test files`)
- [ ] The Step 3 comparator check showed
      `keeps repeated query parameters in their original order` **failing** with
      the value-sorting comparator restored, and passing again afterwards
- [ ] The cache is off by default. This is asserted by a test rather than a grep
      (a grep for `IMMI_EDGE_CACHE_ENABLED` matches the comment too):
      `cd workers && npx vitest run __tests__/case-api-edge-cache.test.js -t 'is OFF unless'`
      → `Tests 1 passed`
- [ ] `grep -c 'caches\.default' workers/case-api/cloudflare.js` returns `1`
      (the single accessor inside `edgeCache`; a bare `grep -c 'caches'` would
      also match the explanatory comment block and prove nothing)
- [ ] `grep -n 'dispatchCloudflareCaseRead(url, path, env, ctx)' workers/cloudflare-native.js`
      returns exactly one match
- [ ] `grep -c 'resolveCloudflareCaseRead' workers/case-api/cloudflare.js`
      returns `3` (one wrapper call in the `!cache` branch, one in the main
      path, one function declaration)
- [ ] No `Cache-Control` string changed. Diff against **the commit you branched
      from**, not `42826a3` — four sibling plans have landed in between and one
      of them may legitimately have touched this file:
      `BASE=$(git merge-base HEAD main); git diff "$BASE" -- workers/case-api/cloudflare.js | grep -c '^[-+].*max-age'`
      returns `0`
- [ ] No file outside this plan's scope changed. Same base:
      ```bash
      BASE=$(git merge-base HEAD main)
      git diff --name-only "$BASE" | grep -v -E '^(workers/case-api/cloudflare\.js|workers/cloudflare-native\.js|workers/__tests__/case-api-edge-cache\.test\.js|plans/012-restore-edge-caching\.md)$'
      ```
      → prints nothing except entries you recorded in
      `/tmp/immi-012-dirty-before.txt`. Leave those exactly as you found them.
- [ ] `workers/__tests__/case-api-edge-cache.test.js` exists:
      `test -f workers/__tests__/case-api-edge-cache.test.js && echo NEW_TEST_PRESENT`
      → prints `NEW_TEST_PRESENT`
- [ ] `cd frontend && npx vitest run` reports `0 failed` and a total equal to
      `BEFORE_FE`
- [ ] Your completion report states explicitly that the layer ships **disabled**,
      and lists the "Before enabling this in production" checklist as outstanding

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `workers/case-api/cloudflare.js` changed since `42826a3`
  and the verbatim excerpts at lines 74-80, 1029-1030 or 1093-1106 no longer
  match. Two other in-flight plans edit regions of this same file
  (`handleExport`/`EXPORT_FIELDS`, and dispatcher error handling); if one of them
  landed first, the line numbers here are stale and you need a fresh read before
  editing.
- `workers/__tests__/case-api-cloudflare.test.js` starts failing after Step 1.
  That means the Step 1b split was **not** byte-for-byte behaviour-preserving —
  the most likely cause is that you moved, duplicated, or dropped the
  `getStorageMode(env)` guard. Do not edit that test file to make it pass; it is
  out of scope and its passing unmodified is the point.
- You find yourself needing to add a `request` parameter to
  `dispatchCloudflareCaseRead` or to any read handler in order to make the cache
  key work. The header-blindness of the read path (Verified fact 4) is the
  entire safety argument for a **shared** edge cache. If a read response can
  vary per user, this plan is unsafe as written and must be re-planned.
- You conclude a handler needs its `Cache-Control` string changed (a longer TTL,
  a new `public,` where there was `no-cache`, an `s-maxage`). That is a
  behavioural product decision about data freshness for a self-representing
  applicant reading tribunal outcomes — it is not yours to make inside a perf
  refactor. Report which endpoint and why.
- The full Worker suite total is anything other than `BEFORE_WORKER + 10`, or
  reports any failure. A total below `BEFORE_WORKER` means you deleted or
  skipped something; report the delta rather than adjusting the expectation.
- You are tempted to make the cache on by default, or to widen the cache key by
  sorting repeated parameter values. Both are the specific mistakes this
  revision exists to prevent: read "Why this ships disabled" and the comment in
  `edgeCacheKey` before arguing with either.
- Any verification fails twice after one reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise.** Three things, in order: (1) that no
  `Cache-Control` string in `workers/case-api/cloudflare.js` changed — the
  `git diff | grep -c '^[-+].*max-age'` check in Done criteria is exactly this;
  (2) that `response.clone()` is evaluated before `response` is returned, not
  inside a deferred callback; (3) that `EDGE_CACHEABLE_CONTROL_RE` still anchors
  on `^\s*public\s*,` — loosening it to match `max-age` anywhere in the header
  would start caching `no-cache, max-age=0` responses.

- **The real trade-off this introduces.** Before this change, a
  `public, max-age=600` analytics response was cached only in the requesting
  viewer's browser. With the layer **enabled**, it is shared across every viewer
  hitting the same Cloudflare colo. The staleness *window* is unchanged (it is
  still the handler's own declared `max-age`), but the *blast radius* is not:
  after a case write, viewer B can see up-to-600s-old analytics where previously
  they would have seen fresh data on their first request.
  **Do not repeat the claim that the corpus is near-static because
  `IMMI_CASE_MUTATIONS_ENABLED` is `"false"`.** That was wrong and is corrected
  in "Why this ships disabled": the flag gates only the HTTP mutation routes
  (`workers/case-api/cloudflare_mutations.js:302`), while the AustLII scraper
  Worker produces directly into `immi-case-mutation-queue` through its
  `NATIVE_CASE_QUEUE` binding (`config/wrangler-austlii-native.toml.example:38-40`,
  sent at `workers/austlii-scraper/src/extract.ts:227`), which triggers
  `rebuildAggregates()` on the consumer side. Cases and analytics do change in
  production with that flag off. This is why the layer ships disabled.

- **Before enabling this in production** — the checklist that must be completed
  first, none of which this plan can do from a working copy:
  1. Make `/api/v1/cache/invalidate` honest (follow-up A below) **or** wire
     `IMMI_EDGE_CACHE_VERSION` into the deploy so every deploy bumps it.
  2. Decide how a *scraper-driven* case write invalidates. A per-colo
     `caches.default.delete()` cannot do it; the realistic options are
     (a) bumping `IMMI_EDGE_CACHE_VERSION` from the queue consumer after a
     rebuild — which means the variable has to live somewhere writable, e.g. a
     `catalog_summary` row read per request, not a Worker var; or (b) accepting
     the `max-age` window as the invalidation SLA and shortening the analytics
     TTLs to match how fresh the data must be. Option (b) is a product decision
     about a self-representing applicant reading tribunal statistics, not a
     perf decision.
  3. Run the end-to-end test this plan cannot: with the layer on, read an
     analytics endpoint, push one case through the mutation queue, invalidate,
     read again, and confirm the second read reflects the new case. Until that
     has passed once against a deployed Worker, the layer stays off.
  4. Confirm on a **multi-colo** basis, not from one location — a single-colo
     test cannot detect that `delete()` did not propagate.

- **Instant rollback.** `wrangler secret`/vars: set
  `IMMI_EDGE_CACHE_ENABLED` to anything other than `"true"` (or delete the
  variable). No code change, no redeploy of the bundle. Every read reverts to
  hitting D1 directly. A softer lever, if entries are stale but the layer should
  stay on: bump `IMMI_EDGE_CACHE_VERSION`, which orphans every stored entry in
  every colo at once.

- **Deferred follow-up A — make `/api/v1/cache/invalidate` honest.**
  `handleCacheInvalidate` in `workers/case-api/cloudflare_actions.js:80-85`
  currently returns a hardcoded `{ invalidated: true }` and purges nothing. With
  an edge cache actually in place, that response is now actively misleading to an
  operator. Note the honest version is **not** just "call `caches.default.delete()`
  for each canonical URL": that only clears the colo that served the invalidate
  request, and only the exact query-string variants you enumerate. A correct
  implementation bumps the cache-key version instead (see item 2 above), or uses
  Cloudflare's zone-level purge API with a real token. It was excluded here
  partly because `cloudflare_actions.js` is owned by another in-flight plan, and
  partly because it is a larger design question than a two-line edit. Do this
  before enabling the layer, not after.

- **Deferred follow-up B — a cron pre-warm is NOT a straight re-add.** See
  "Findings reconsidered" for why the 2026-05-era cron does not transfer to this
  stack. If someone wants post-deploy warming, the honest version measures D1
  cold-path latency first.

- **Interaction with a future security-headers wrapper.** If a later change
  mutates response headers inside `cloudflare-native.js`'s `fetch()` (e.g.
  adding CSP/HSTS to every response), note that a `Response` returned from
  `cache.match()` may have immutable headers — `headers.set()` on it can throw.
  Such a wrapper must construct a new `Response` rather than mutating in place.

- **If per-tenant reads are ever added.** The moment any handler reachable from
  `resolveCloudflareCaseRead` starts varying by tenant, the shared cache becomes
  a cross-tenant data leak. The structural guard is that the router takes no
  `Request`; keep it that way, and if that ever has to change, gate the cache on
  an explicit per-route allow-list instead of on the `public,` header prefix.

## Findings reconsidered

The audit finding PERF-01 proposed three fixes. The first (the Cache API layer)
is implemented above. The other two are deliberately not done here, for the
reasons below — recorded so nobody re-audits them from scratch.

- **Cron pre-warm (`scheduled()` + `[triggers]` crons) — dropped, not deferred
  as a like-for-like re-add.** The claim that it was removed is true and
  verified (`grep -rn 'scheduled' workers/` → 0 hits; no `[triggers]` block in
  `wrangler.toml`). But the original cron's payoff does not transfer. It was
  built for the Hyperdrive + Postgres stack, where the eight `ctx.waitUntil(fetch(...))`
  calls warmed a **shared, origin-side** resource: the Hyperdrive connection pool
  and Postgres plan cache, which every colo then benefited from. This stack has
  neither — `CLAUDE.md` states plainly that the D1 bindings have "no per-request
  client to construct and no Hyperdrive pooler". What remains for a cron to warm
  is `caches.default`, which is **per-colo**: a cron fires in exactly one data
  centre, so it would warm one colo's cache out of hundreds while spending eight
  subrequests every five minutes forever. The `CLAUDE.md` "Performance Baseline
  (2026-05-05)" numbers that would justify it are explicitly marked HISTORICAL
  and no D1-era benchmark has replaced them, so sizing a permanent cron off them
  would be speculation. Secondarily, it would require editing `wrangler.toml`
  plus the two deploy-config gates (`scripts/check_cloudflare_native_target.py`,
  `tests/test_cloudflare_native_target.py`), all owned by another in-flight plan.
  If post-deploy warming is wanted later, measure D1 cold-path latency for the
  eight endpoints first and decide from real numbers.

- **`/api/v1/cache/invalidate` purge — deferred, not rejected.** The finding is
  correct: `handleCacheInvalidate` at
  `workers/case-api/cloudflare_actions.js:80-85` returns
  `{ invalidated: true, timestamp: … }` and touches nothing. Verified verbatim.
  It is excluded from this plan on two grounds: `cloudflare_actions.js` is owned
  by a concurrently-executing plan, and — the more important one — the obvious
  implementation (`caches.default.delete()` per URL) would still not work, being
  per-colo and per-query-string-variant. That is why this plan ships a
  version-namespaced key instead, which *does* give a cross-colo lever, and why
  the layer is off until the invalidation story is finished. See "Maintenance
  notes → Before enabling this in production".

- **Evidence correction — the "corpus is near-static" premise was wrong.** The
  first draft of this plan justified a default-on shared cache with
  "`IMMI_CASE_MUTATIONS_ENABLED` defaults to `\"false\"`, so the corpus is
  near-static in production". Re-checked and refuted:
  `workers/case-api/cloudflare_mutations.js:302` shows that flag guarding only
  the HTTP mutation routes, and the flag check sits *before* the
  `CRAWLER_WRITE_TOKEN` writer check at `:308`, so it is not even the
  crawler's path. The actual production write path is the scraper Worker's
  queue producer: `config/wrangler-austlii-native.toml.example:38-40` binds
  `NATIVE_CASE_QUEUE` to `queue = "immi-case-mutation-queue"` — the same queue
  `wrangler.toml:73` consumes — and `workers/austlii-scraper/src/extract.ts:227`
  sends to it. That consumer calls `rebuildAggregates()`. Cases and all 17
  analytics tables therefore change with the mutations flag off, the safety
  argument for default-on does not hold, and the plan now ships opt-in.

- **Evidence correction (line references).** The audit cited "12 handlers" still
  emitting `public, max-age=…` at lines 357, 361, 403, 413, 553, 697, 790, 836,
  876, 927, 1014, 1021 plus 1101-1102. That list is a subset — it captured only
  the sites where the whole `jsonOk(...)` call fits on one line. The verified
  total is **28**: `grep -c '"public, max-age' workers/case-api/cloudflare.js`
  → `28`, at lines 94, 295, 311, 344, 353, 357, 361, 374, 389, 403, 413, 455,
  519, 542, 553, 568, 606, 628, 647, 697, 749, 790, 836, 876, 927, 1014, 1021
  and 1102. The dispatch-level wrapper in Step 1 covers all 28 without needing
  to enumerate them, which is why it was chosen over per-handler wrapping. All
  other cited evidence (`cloudflare.js:74`, `cloudflare_actions.js:81`,
  `cloudflare-native.js:191`) checked out exactly as claimed.
