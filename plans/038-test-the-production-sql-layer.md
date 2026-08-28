# Plan 038: Run the D1 query layer against a real schema

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or the file does not exist (in which case skip it).
>
> **Drift check (run first)** — all four commands, because a committed-only
> diff cannot see a dirty working tree:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE=(workers/__tests__ workers/vitest.config.js workers/storage/cloudflare.js workers/cloudflare-native.js workers/llm-council/cloudflare_handlers.js workers/case-api workers/admin workers/auth migrations/d1 config/cloudflare-native-route-manifest.json)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $IN_SCOPE          # committed since planning
> git diff --stat -- $IN_SCOPE                         # unstaged
> git diff --cached --stat -- $IN_SCOPE                # staged
> ```
>
> **Expected**: the last three commands print nothing, and `git status` shows a
> clean tree on your own branch. Every excerpt in "Current state" was read at
> `42826a3`. If any in-scope file appears in **any** of the three diffs, that is
> a STOP condition: re-read the cited lines and compare them against the
> excerpts below before writing any code, because this plan's whole value is
> that the tests encode the *real* schema and the *real* SQL.
>
> **Never** run `git checkout --` or `git clean -f` to "clear" drift. Those
> destroy work that belongs to the operator or to a parallel plan. Report and
> stop instead.
>
> **Parallel execution**: if another plan is running at the same time, run this
> one in its own `git worktree` / clone. Several plans in this series assert on
> `git status --porcelain`, so a shared checkout must be serialised.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27

Why "Depends on: none" even though plans 001–003 repair verification gates: this
plan adds files under `workers/__tests__/`, which the existing
`workers/vitest.config.js` glob already collects, and both `make test-workers`
and the CI job `test-worker` already run that suite green today. Nothing here
needs the frontend compile gate, pytest collection, or the test-suite lint pass.

## Why this matters

`workers/storage/cloudflare.js` is 1905 lines of hand-written SQL that is the
entire production read/write path for `https://immi.trackit.today`. Today **no
test anywhere executes a single one of those statements against a schema.** The
one test file that calls real store methods
(`workers/__tests__/cloudflare-storage-contracts.test.js`) hands them a fake D1
binding whose `all()` / `first()` / `run()` ignore the SQL string entirely, and
the other twelve worker test files `vi.mock("../storage/cloudflare.js")`
wholesale. The four migration files under `migrations/d1/` are bound to nothing:
`grep -rn "migrations/d1" workers/ tests/ scripts/` matches only two
`wrangler.toml` lines. Consequence: rename a column, drop an index, or ship an
unapplied migration and you get a fully green worker suite (345 tests at
`42826a3`, though the total moves as sibling plans land) plus a runtime 500 in
production.

The same hole exists at the security boundary. `assertMembership()` is the
*only* thing standing between tenants — there is no Postgres and therefore no
RLS backstop — and its 403 branch is unreachable in the current suite, so
deleting `AND revoked_at IS NULL` would ship green. And
`config/cloudflare-native-route-manifest.json` declares 72 implemented routes
but is only ever validated against itself; nothing proves the Worker serves any
of them.

After this plan: real SQL runs against the real migrations in-process, the
tenant-deny path is pinned by behaviour, and every manifest route is proven to
reach a handler instead of the fail-closed 503.

## Current state

### Files this plan reads (and the role of each)

| File | Role |
|---|---|
| `workers/storage/cloudflare.js` | 1905 lines. All D1/R2/Vectorize access. Contains `CloudflareCaseStore` (line 434), `CloudflareIdentityStore` (line 1295), `CloudflarePipelineStore` (line 1621). |
| `workers/storage/contracts.js` | `getStorageMode`, `assertCloudflareBindings`, `VECTOR_DIMENSIONS`, `StorageBoundaryError`. |
| `workers/cloudflare-native.js` | 246 lines. The production Worker entrypoint; `fetch()` at line 199. |
| `workers/llm-council/cloudflare_handlers.js` | 427 lines. `dispatchCloudflareCouncil` at line 407. |
| `migrations/d1/{catalog,account,ops}/*.sql` | 4 files, 534 lines total. The shipped D1 schema. Currently referenced by **no** test. |
| `config/cloudflare-native-route-manifest.json` | Declares `implemented` (72 routes) and `unported_fail_closed` (0). |
| `workers/__tests__/cloudflare-storage-contracts.test.js` | The only file that calls real store methods — with a SQL-blind fake. |
| `workers/vitest.config.js` | 14 lines. Collects `__tests__/**/*.test.js`. **Do not modify.** |

### The fake that makes today's coverage illusory

`workers/__tests__/cloudflare-storage-contracts.test.js:22-40` (verbatim):

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

`all()` returns a canned array regardless of `sql`. `first()` is constructed with
`firstRow: { role: "member" }` at line 46, so it can never return `null`.

### The tenant boundary whose deny branch is unreachable

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

The only test that reaches it is
`workers/__tests__/cloudflare-storage-contracts.test.js:127-134`, which asserts a
SQL substring and the bound params — deleting `AND revoked_at IS NULL` would not
fail it.

### The untested read path

`workers/storage/cloudflare.js:482-486` (verbatim) — `listPage`, never called by
any test:

```js
  async listPage({ filters = {}, sortBy = "date", sortDir = "desc", page = 1, pageSize = 100 } = {}) {
    const column = COMPAT_SORT_COLUMNS[sortBy];
    if (!column) {
      throw new StorageBoundaryError(`Invalid sort_by '${sortBy}'.`, { code: "invalid_sort", status: 400 });
    }
```

**Trap you must not fall into**: `listPage`, `exportCases` and `countCompat` use
`compatCaseFilters` (line 136), whose filter key is **`court`**, not
`court_code`. `searchLexical` uses `safeCaseFilters` (line 64), whose key **is**
`court_code`. `workers/storage/cloudflare.js:139-142` (verbatim):

```js
  const equalities = [
    ["court", "court_code"],
    ["visa_type", "visa_type"],
    ["source", "source"],
  ];
```

Passing `{ court_code: "AATA" }` to `listPage` silently filters nothing. This was
confirmed empirically while writing this plan.

### Shapes you will assert against (read them, do not guess)

- `listPage` returns `{ cases, total, ... }`; each row exposes
  `decision_date` **as `date`**, and `judges` / `legal_concepts` as
  `'; '`-joined strings built by `LEGACY_CASE_PROJECTION`
  (`workers/storage/cloudflare.js:89-116`; the alias is on line 91,
  `c.decision_date AS date`).
- `analyticsOutcomes()` (line 608) returns an **object**
  `{ court, year, subclass }`, not an array.
- `analyticsFilterOptions()` (line 655) returns
  `{ natures, subclasses, outcomes, total }`.
- `getStats()` (line 758) returns `{ total_cases, with_full_text, courts, years, ... }`.
- `assertMembership()` resolves to `{ userId, tenantId, role }`.

### Schema facts your fixtures must satisfy

From `migrations/d1/catalog/0001_catalog.sql:7`:

```sql
  case_id TEXT PRIMARY KEY CHECK(length(case_id) = 12 AND case_id NOT GLOB '*[^0-9a-f]*'),
```

Case ids must be exactly 12 lowercase-hex characters. `content_sha256` must be
64 chars (line 38); `content_key` is `UNIQUE` (line 37).

From `migrations/d1/account/0001_account.sql:26-35`, `memberships` has
`(tenant_id, user_id, role, created_at, revoked_at)` with
`role IN ('owner','admin','member','viewer')`, and both FK columns reference
`tenants` / `users` — so a membership fixture needs a tenant row and a user row
first (`PRAGMA foreign_keys = ON` is set at line 2).

### The entrypoint fall-through

`workers/cloudflare-native.js:160-165` (verbatim):

```js
function unavailable(error, code = "cloudflare_route_unavailable") {
  return Response.json({ error, code }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "0" },
  });
}
```

`workers/cloudflare-native.js:168` (verbatim):

```js
  if (env.AUTH_ENABLED === "false") return null;
```

`workers/cloudflare-native.js:234-243` (verbatim):

```js
    if (path.startsWith("/api/")) {
      return unavailable("This API route is not yet available in the Cloudflare-native runtime");
    }
    if (env.ASSETS) {
      try {
        return await env.ASSETS.fetch(request);
      } catch (err) {
        // fall through to unavailable when the ASSETS binding is misconfigured
      }
    }
```

`grep -rn "cloudflare_route_unavailable" workers/` matches **only** line 160 — so
"body.code === 'cloudflare_route_unavailable'" is an exact, unambiguous signal
that a request fell through unmatched.

**Documented behaviour that is wrong, and which you must NOT copy**: `CLAUDE.md`
says `AUTH_ENABLED=false` makes auth routes "fall through to the Worker's generic
404". They do not. Measured behaviour at `42826a3` is **503** with
`code: "cloudflare_route_unavailable"`. Assert the measured 503. `CLAUDE.md` is
out of scope for this plan; the discrepancy is recorded in "Maintenance notes".

### Council route id format

`workers/llm-council/cloudflare_handlers.js:415-420` (verbatim):

```js
    const turn = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})\/turns$/);
    if (turn && method === "POST") return handleAddTurn(request, env, turn[1]);
    if (turn && method === "GET") return handleGetTurns(request, env, turn[1]);
    const session = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})$/);
    if (session && method === "GET") return handleGetSession(request, env, session[1]);
    if (session && method === "DELETE") return handleDeleteSession(request, env, session[1]);
```

Session ids are nanoid-21, **not** UUIDs. A UUID placeholder makes those four
routes look broken when they are fine.

### Test-runner conventions to match

`workers/vitest.config.js` (verbatim, whole file — you will **not** change it):

```js
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.js"],
    globals: false,
  },
});
```

Consequences you rely on: (a) new `.test.js` files under `workers/__tests__/`
are collected automatically by both `make test-workers` and the CI step
`npm run test:workers` — **no CI change is needed to gate on them**; (b) a helper
file that does not end in `.test.js` is not collected as a suite; (c)
`globals: false` means every test file must `import { describe, expect, it, vi } from "vitest"` explicitly.

One more constraint from
`workers/__tests__/cloudflare-storage-contracts.test.js:94-100`: a test asserts
that no worker source file outside `/__tests__/` and `/storage/` mentions
`env.IMMI_CATALOG_DB` and friends. Your new files live under
`workers/__tests__/`, so they are exempt — keep them there.

### Runtime facts confirmed on this machine at `42826a3`

- `node --version` → `v22.23.1`; `node:sqlite` exposes `DatabaseSync` with no
  flag; SQLite 3.51.3 with FTS5, `json_valid()`, `json_each()` and window
  functions — everything the migrations and `rebuildAggregates()` need.
- All four migration files apply cleanly via `DatabaseSync.exec()`
  (catalog 30 tables, account 10, ops 10).
- CI pins `node-version: "22"` (`.github/workflows/ci.yml`), which resolves to a
  22.x newer than 22.13, so `node:sqlite` needs no flag there either.
- **Vite cannot resolve the `node:sqlite` builtin** — a plain
  `import { DatabaseSync } from "node:sqlite"` inside a vitest file fails with
  `Failed to load url sqlite (resolved id: sqlite)`. The working form, validated
  end-to-end, is `createRequire(import.meta.url)("node:sqlite")`.

## Commands you will need

Run everything from the repo root: `cd "/Users/d/Developer/Active Projects/IMMI-Case-"`.

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm Node has `node:sqlite` | `node -e "const s=require('node:sqlite'); if(!s.DatabaseSync) process.exit(1); console.log('ok')"` | prints `ok`, exit 0 |
| Worker suite (baseline) | `make test-workers` | exit 0; **record the file and test counts as `BEFORE_FILES` / `BEFORE_TESTS`** (see Step 1) |
| Worker suite (as CI runs it) | `npm run test:workers` | exit 0; same counts as `make test-workers` |
| One worker test file | `cd workers && npx vitest run __tests__/d1-schema-contract.test.js` | file passes |
| Native bundle closure gate | `node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (...)`, exit 0 |
| Native reference gate | `python3 scripts/check_native_effective_references.py --json` | `{"bundle_ok": true, ..., "ok": true, ...}`, exit 0 |
| Python route-manifest test (unchanged) | `.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q` | `4 passed` |
| Files changed | `git status --porcelain` | only the five new files in "Scope" |

Note: `make test-workers` runs `cd workers && npx vitest run`; `npm run test:workers`
runs `vitest run --config workers/vitest.config.js` from the root. Both collect the
same files.

`node:sqlite` prints `ExperimentalWarning: SQLite is an experimental feature` once
per vitest run. That is expected noise, not a failure. Do not add flags or config
to silence it.

## Scope

**In scope** (the only files you may create or modify):

- `workers/__tests__/helpers/d1-sqlite.js` (create — helper, not a suite)
- `workers/__tests__/d1-schema-contract.test.js` (create)
- `workers/__tests__/route-manifest-coverage.test.js` (create)
- `workers/__tests__/entry-fallthrough.test.js` (create)
- `workers/__tests__/route-tenant-matrix.test.js` (create — Step 5b)

**Out of scope** (do NOT touch, even though they look related):

- `workers/storage/cloudflare.js` and every other Worker source file. This plan
  adds coverage; it changes no behaviour. If a new test fails because production
  code is wrong, that is a STOP condition — report it, do not fix it here.
- `migrations/d1/**`. The tests must adapt to the shipped schema, never the
  reverse. Editing a migration to make a test pass defeats the entire purpose.
- `workers/vitest.config.js`. Its `include` glob already collects your files and
  the `node:sqlite` resolution problem is solved in the helper via
  `createRequire`. `plans/002-fix-test-collection-and-install.md` also treats this
  file as read-only; changing it would collide.
- `.github/workflows/ci.yml` and `Makefile`. CI already runs the worker suite;
  no gate change is required, and both files are owned by other plans.
- `workers/__tests__/cloudflare-storage-contracts.test.js`. Its SQL-blind `d1()`
  fake stays exactly as it is — it still usefully asserts *which SQL is emitted
  and with which bound params*, which the new schema-backed tests do not. Add
  coverage alongside it; delete nothing.
- `tests/test_cloudflare_route_manifest.py` — keep as is; the new worker test
  complements it.
- `tests/integration/test_revoke_member.py` — Postgres/Flask-era, module-skipped.
  See "Maintenance notes".
- `CLAUDE.md` — the `AUTH_ENABLED` 404-vs-503 error is recorded, not fixed here.

## Git workflow

- Branch: `advisor/038-test-the-production-sql-layer`
  (`git switch -c advisor/038-test-the-production-sql-layer`)
- Commit per step or per logical unit. Message style is conventional commits,
  `<type>: <description>`, type ∈ feat|fix|refactor|docs|test|chore|perf|ci.
  Example from `git log`: `fix: install root node_modules in make install`.
  Yours will mostly be `test: ...`.
- No AI attribution / co-author trailers.
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Preflight — confirm the runtime and record the baseline

Run, in order:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
node -e "const s=require('node:sqlite'); if(!s.DatabaseSync) process.exit(1); console.log('ok')"

# Record the baseline as a DELTA anchor. Do NOT hardcode absolute totals into
# any later check: a sibling plan landing in the same window changes them, and
# an absolute total then trains you to edit the yardstick instead of the code.
set -o pipefail
make test-workers 2>&1 | tee /tmp/immi-038-baseline.txt | tail -5
echo "make test-workers exit=$?"
BEFORE_FILES=$(grep -oE 'Test Files +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-038-baseline.txt | grep -oE '\([0-9]+\)' | tr -d '()')
BEFORE_TESTS=$(grep -oE 'Tests +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-038-baseline.txt | grep -oE '\([0-9]+\)' | tr -d '()')
echo "BEFORE_FILES=$BEFORE_FILES BEFORE_TESTS=$BEFORE_TESTS"
```

Write `BEFORE_FILES` and `BEFORE_TESTS` into your handoff notes now — every
later check in this plan is expressed against them. (For reference only: at
`42826a3` on the planning machine they were `25` and `345`. If yours differ,
that is fine and expected once a sibling plan has landed; use *your* numbers.)

If the `node -e` command does not print `ok`, your Node is older than 22.13 —
**STOP and report**; do not install `better-sqlite3` or any other dependency as
a workaround (this repo's root `package.json` has exactly two devDependencies
and adding a native module is out of scope).

**Verify**: `node -e ...` → prints `ok`; `make test-workers` → `exit=0` and both
`BEFORE_FILES` and `BEFORE_TESTS` are non-empty integers.

### Step 2: Add the node:sqlite-backed D1 shim

Create `workers/__tests__/helpers/d1-sqlite.js` with exactly this content. It is
a helper, not a suite — the filename deliberately does not end in `.test.js`, so
vitest will not try to collect it.

```js
/**
 * Test-only D1 binding shim backed by node:sqlite.
 *
 * It applies the checked-in `migrations/d1/**` schema to an in-memory SQLite
 * database and exposes the subset of the D1 API that `workers/storage/
 * cloudflare.js` actually uses: prepare/bind/all/first/run and a transactional
 * batch(). Production SQL therefore runs against the production schema, so a
 * renamed column or a dropped table fails the suite instead of shipping.
 *
 * Not for production use — no Worker source may import this file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Vite cannot resolve the `node:sqlite` builtin (it postdates the bundler's
// builtin list), so it is loaded through CommonJS require at runtime instead.
// Requires Node >= 22.13; an older runtime fails loudly here by design.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// The migrations root is overridable so a mutation drill can point the shim at
// a THROWAWAY COPY of migrations/d1 instead of editing the real files. Nothing
// in normal use sets it.
const MIGRATIONS_ROOT =
  process.env.IMMI_TEST_D1_MIGRATIONS_DIR ||
  fileURLToPath(new URL("../../../migrations/d1/", import.meta.url));

export const DATABASES = Object.freeze(["catalog", "account", "ops"]);

/**
 * Every `*.sql` in the database's directory, in filename order.
 *
 * Discovered from disk rather than hardcoded, on purpose: a hardcoded list
 * silently ignores a newly added migration, and if no test happens to query
 * the new tables the whole suite stays green against a stale schema. Reading
 * the directory means a new migration enters the tests the moment it is
 * committed. Wrangler orders migrations by the `NNNN_` filename prefix, so a
 * plain lexicographic sort matches how they are applied in production.
 */
export function migrationFiles(database) {
  const dir = join(MIGRATIONS_ROOT, database);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`No migrations found for '${database}' in ${dir}`);
  return files.map((name) => join(dir, name));
}

function isReadStatement(sql) {
  return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql);
}

class SqliteD1Statement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { rows_read: results.length } };
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row === undefined ? null : row;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

/** Build one migrated in-memory D1 binding: "catalog" | "account" | "ops". */
export function createSqliteD1(database) {
  if (!DATABASES.includes(database)) throw new Error(`Unknown D1 database '${database}'`);
  const db = new DatabaseSync(":memory:");
  for (const file of migrationFiles(database)) db.exec(readFileSync(file, "utf8"));
  return {
    /** Test-only escape hatch for seeding fixture rows directly. */
    exec(sql) { db.exec(sql); },
    prepare(sql) { return new SqliteD1Statement(db, sql, []); },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(isReadStatement(statement.sql) ? await statement.all() : await statement.run());
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
```

Four details that matter and must not be "simplified":

- **Migrations are discovered from disk, never hardcoded.** A frozen
  `MIGRATIONS = { catalog: ["catalog/0001_catalog.sql"], ... }` map looks tidier
  and is wrong: adding `0002_*.sql` and forgetting to append it leaves the shim
  applying a stale schema, and unless a test happens to query the new tables the
  suite stays fully green. `readdirSync(...).sort()` makes a new migration enter
  the tests the moment it lands.
- `bind()` returns a **new** statement, matching real D1. The old fake mutates
  and returns `this`.
- `first()` maps `undefined` → `null`; `workers/storage/cloudflare.js:1307`
  branches on falsiness, and `changeCount()` at line 50 reads `meta.changes`.
- `batch()` wraps in `BEGIN`/`COMMIT` because `upsertTelegramUser()`
  (line 1321) documents that it relies on D1 batch atomicity, and
  `rebuildAggregates()` (line 990) sends `DELETE`s and `INSERT ... SELECT`s
  through it in slices of 20.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
node --input-type=module -e "
const m = await import('./workers/__tests__/helpers/d1-sqlite.js');
for (const name of m.DATABASES) {
  // Prove the shim loads EVERY .sql on disk for this database, by identity —
  // not by counting. A count check passes while silently loading the wrong set.
  const loaded = m.migrationFiles(name).map((p) => p.split('/').pop());
  const db = m.createSqliteD1(name);
  const n = (await db.prepare(\"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'\").first()).n;
  console.log(name, JSON.stringify(loaded), 'tables=' + n);
}"

# Independent ground truth for the same question:
for d in catalog account ops; do printf '%s ' "$d"; ls migrations/d1/$d | sort | tr '\n' ' '; echo; done
```

→ the two outputs must name **the same files in the same order** for each
database. On the planning machine the first command printed
`catalog ["0001_catalog.sql"] tables=30`, `account ["0001_account.sql"] tables=10`,
`ops ["0001_ops.sql","0002_pipeline_control.sql"] tables=10` (plus one
`ExperimentalWarning`); your table counts may differ if a migration landed since.
The load-bearing assertion is the **file-set identity**, not the table count.

Then confirm the helper is not collected as a suite:

```bash
set -o pipefail
make test-workers 2>&1 | tail -3; echo "exit=$?"
```

→ `exit=0`, and the reported test count is still exactly `BEFORE_TESTS` from
Step 1 (the helper does not end in `.test.js`, so vitest ignores it).

### Step 3: Test the real read path and the tenant boundary against the real schema

Create `workers/__tests__/d1-schema-contract.test.js`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudflareStores, CloudflareIdentityStore } from "../storage/cloudflare.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TENANT_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const AUTH = { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] };

function schemaEnv() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: {
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
      head: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })),
      query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "mutation-1" })),
      deleteByIds: vi.fn(async () => ({ mutationId: "mutation-2" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
  };
}

function caseFixture(overrides) {
  return {
    citation: "[2026] FCA 1", title: "Alpha v Minister", court: "Federal Court of Australia",
    court_code: "FCA", year: 2026, decision_date: "2026-01-15", outcome: "allowed",
    visa_type: "student", visa_subclass: "500", source: "AustLII",
    case_nature: "judicial review", country_of_origin: "India",
    judges: ["Smith J"], legal_concepts: ["procedural fairness"], ...overrides,
  };
}

async function seedCase(stores, caseId, overrides = {}, chunk = "The applicant sought review of a visa refusal decision.") {
  await stores.caseStore.putImportedCase({
    case: caseFixture({ case_id: caseId, ...overrides }),
    sourcePointer: {
      key: `cases/${caseId}/source/${"a".repeat(64)}.txt`,
      sha256: "a".repeat(64), size: 12, contentType: "text/plain; charset=utf-8",
    },
    textChunks: [chunk],
  });
}

let env;
let stores;

beforeEach(() => {
  env = schemaEnv();
  stores = createCloudflareStores(env);
});

describe("D1 read path against the shipped catalog schema", () => {
  it("paginates, filters and projects relations exactly as the schema allows", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", {
      citation: "[2025] AATA 2", title: "Beta v Minister", court: "Administrative Appeals Tribunal",
      court_code: "AATA", year: 2025, decision_date: "2025-06-01", outcome: "affirmed",
      visa_subclass: "820", case_nature: "merits review", country_of_origin: "China",
      judges: ["Smith J"], legal_concepts: ["credibility"],
    }, "The tribunal affirmed the visa refusal on credibility grounds.");

    const all = await stores.caseStore.listPage({ sortBy: "date", sortDir: "desc", page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.cases.map((row) => row.case_id)).toEqual(["0123456789ab", "0123456789ac"]);
    expect(all.cases[0].date).toBe("2026-01-15");
    expect(all.cases[0].judges).toBe("Smith J");
    expect(all.cases[0].legal_concepts).toBe("procedural fairness");

    // listPage uses compatCaseFilters: the key is `court`, not `court_code`.
    const filtered = await stores.caseStore.listPage({ filters: { court: "AATA" }, pageSize: 10 });
    expect(filtered.total).toBe(1);
    expect(filtered.cases[0].case_id).toBe("0123456789ac");

    expect(await stores.caseStore.countCompat({ court: "FCA" })).toBe(1);
    expect(await stores.caseStore.exportCases({ limit: 10 })).toHaveLength(2);
  });

  it("returns bm25-ranked distinct cases from the FTS5 index", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", { court_code: "AATA" }, "Wholly unrelated tribunal text about tax.");
    const hits = await stores.caseStore.searchLexical({ query: "visa refusal", limit: 10 });
    expect(hits.map((row) => row.case_id)).toEqual(["0123456789ab"]);
    expect(typeof hits[0].rank).toBe("number");
  });

  it("rebuilds every aggregate table the analytics reads depend on", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", {
      court_code: "AATA", year: 2025, outcome: "affirmed", visa_subclass: "820",
      case_nature: "merits review", country_of_origin: "China", legal_concepts: ["credibility"],
    }, "The tribunal affirmed the visa refusal on credibility grounds.");

    const result = await stores.caseStore.rebuildAggregates();
    expect(result.rebuilt_at).toEqual(expect.any(String));

    const stats = await stores.caseStore.getStats({});
    expect(stats.total_cases).toBe(2);
    expect(stats.courts).toMatchObject({ FCA: 1, AATA: 1 });

    const options = await stores.caseStore.analyticsFilterOptions({});
    expect(options.total).toBe(2);
    expect(options.outcomes.map((row) => row.value).sort()).toEqual(["affirmed", "allowed"]);

    expect(await stores.caseStore.getFilterOptions()).not.toHaveLength(0);
    const outcomes = await stores.caseStore.analyticsOutcomes();
    expect(outcomes.court).not.toHaveLength(0);
    expect(outcomes.subclass).not.toHaveLength(0);
  });
});

describe("tenant isolation against the shipped account schema", () => {
  function identity() {
    return new CloudflareIdentityStore(env);
  }
  function seedTenancy() {
    const now = "2026-08-27T00:00:00.000Z";
    env.IMMI_ACCOUNT_DB.exec(`
      INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at)
      VALUES ('${TENANT_ID}','individual','Workspace','${now}','${now}'),
             ('${OTHER_TENANT_ID}','organisation','Other','${now}','${now}');
      INSERT INTO users (user_id,telegram_id,created_at,updated_at)
      VALUES ('${USER_ID}','42','${now}','${now}');
    `);
    return now;
  }

  it("denies when the tenant has no membership row at all", async () => {
    seedTenancy();
    await expect(identity().assertMembership(AUTH)).rejects.toMatchObject({
      code: "tenant_membership_denied", status: 403,
    });
  });

  it("propagates the stored role for a live membership", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','admin','${now}')`);
    await expect(identity().assertMembership(AUTH)).resolves.toEqual({
      userId: USER_ID, tenantId: TENANT_ID, role: "admin",
    });
  });

  it("denies after the membership is revoked", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','owner','${now}')`);
    await expect(identity().assertMembership(AUTH)).resolves.toMatchObject({ role: "owner" });
    env.IMMI_ACCOUNT_DB.exec(`UPDATE memberships SET revoked_at = '${now}' WHERE tenant_id = '${TENANT_ID}' AND user_id = '${USER_ID}'`);
    await expect(identity().assertMembership(AUTH)).rejects.toMatchObject({
      code: "tenant_membership_denied", status: 403,
    });
  });

  it("denies a tenant the user is not a member of", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','owner','${now}')`);
    await expect(identity().assertMembership({
      sub: USER_ID, tenant_id: OTHER_TENANT_ID, tenants: [OTHER_TENANT_ID],
    })).rejects.toMatchObject({ code: "tenant_membership_denied", status: 403 });
  });
});
```

The revocation test asserts *behaviour*, deliberately not the SQL substring
`revoked_at IS NULL`: a behavioural assertion survives a rewrite of that query
and still catches the predicate being dropped.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/d1-schema-contract.test.js
```

→ `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

### Step 4: Prove the entrypoint actually serves every route the manifest declares

Create `workers/__tests__/route-manifest-coverage.test.js`:

```js
/**
 * `config/cloudflare-native-route-manifest.json` claims 72 implemented routes.
 * tests/test_cloudflare_route_manifest.py only checks that file against itself,
 * so a route could exist on paper and 503 in production. This test drives every
 * manifest route through the real entrypoint and fails if it reaches the
 * fail-closed fall-through.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../config/cloudflare-native-route-manifest.json", import.meta.url)),
  "utf8",
));

// Each placeholder must satisfy the validator the matching handler applies,
// otherwise the route legitimately falls through and the test lies.
const PARAM_VALUES = Object.freeze({
  ":case_id": "0123456789ab",              // assertCaseId: 12 lowercase hex chars
  ":session_id": "V1StGXR8Z5jdHi6BmyT7K",  // SESSION_ID_RE: /^[A-Za-z0-9_-]{21}$/
  ":legislation_id": "migration-act-1958",
  ":filename": "smith-j.jpg",
});

function concretePath(template) {
  let path = template;
  for (const [token, value] of Object.entries(PARAM_VALUES)) path = path.split(token).join(value);
  return path;
}

function env() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: {
      put: vi.fn(async () => ({})), get: vi.fn(async () => null),
      head: vi.fn(async () => null), delete: vi.fn(async () => undefined),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "m" })), deleteByIds: vi.fn(async () => ({ mutationId: "m" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("spa", { status: 200 })) },
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

describe("every manifest route is served by the native entrypoint", () => {
  it.each(manifest.implemented)("%s does not fall through to the 503 handler", async (route) => {
    const [method, template] = route.split(" ", 2);
    const request = new Request(`https://immi.example${concretePath(template)}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({}),
    });
    let response;
    try {
      response = await worker.fetch(request, env(), ctx);
    } catch (error) {
      throw new Error(`${route} threw instead of returning a Response: ${error?.message}`);
    }
    let body = null;
    try { body = await response.clone().json(); } catch { body = null; }
    expect(body?.code, `${route} reached the fail-closed fall-through`).not.toBe("cloudflare_route_unavailable");
  });

  it("runs against a non-vacuous manifest", () => {
    // Guards against a truncated/empty manifest silently making it.each a no-op.
    expect(manifest.implemented.length).toBeGreaterThan(60);
    expect(manifest.unported_fail_closed).toEqual([]);
  });
});
```

The assertion is intentionally weak per route — "did not fall through" — because
auth-gated and CSRF-gated routes legitimately answer 401/403 here. That is
exactly the contract the manifest claims and nothing today checks. Do **not**
tighten it to `status === 200`; that would force you to stand up JWTs and CSRF
tokens for 72 routes and is a different plan.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/route-manifest-coverage.test.js
```

→ `Test Files  1 passed (1)` / `Tests  73 passed (73)` (72 parametrised + 1 guard).

If any route fails here, **STOP and report which one** — a manifest route that
falls through is a production defect, and fixing Worker source is out of scope.

### Step 5: Pin the entrypoint's fall-through and rollback levers

Create `workers/__tests__/entry-fallthrough.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const ctx = { waitUntil() {}, passThroughOnException() {} };

function env(overrides = {}) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: { put: vi.fn(), get: vi.fn(async () => null), head: vi.fn(async () => null), delete: vi.fn() },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(), deleteByIds: vi.fn(),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })) },
    ...overrides,
  };
}

describe("entrypoint fall-through behaviour", () => {
  it("takes every auth route out of service when AUTH_ENABLED is false", async () => {
    const value = env({ AUTH_ENABLED: "false" });
    const response = await worker.fetch(new Request("https://immi.example/api/v1/auth/me"), value, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
  });

  it("keeps auth routes in service when AUTH_ENABLED is not disabled", async () => {
    const response = await worker.fetch(new Request("https://immi.example/api/v1/auth/me"), env(), ctx);
    const body = await response.json();
    expect(body.code).not.toBe("cloudflare_route_unavailable");
  });

  it("fails closed on an unmatched /api path instead of reaching the SPA", async () => {
    const value = env();
    const response = await worker.fetch(new Request("https://immi.example/api/v1/definitely-not-a-route"), value, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
    expect(value.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("hands a non-API path to the static asset binding", async () => {
    const value = env();
    const response = await worker.fetch(new Request("https://immi.example/app/cases"), value, ctx);
    expect(response.status).toBe(200);
    expect(value.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed when the ASSETS binding is missing", async () => {
    const response = await worker.fetch(new Request("https://immi.example/app/cases"), env({ ASSETS: undefined }), ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
  });
});
```

The first test encodes **503**, the measured behaviour, not the 404 `CLAUDE.md`
claims. Do not change it to 404 to match the docs.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/entry-fallthrough.test.js
```

→ `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

### Step 5b: Prove one tenant-scoped route enforces membership end to end

Steps 3–5 test `assertMembership()` as a **method**. They do not prove that any
route actually calls it — a handler could skip it entirely and the suite would
still be green. This step closes the smallest honest version of that gap: a
four-cell deny matrix (**absent / revoked / wrong-tenant / wrong-role**) driven
through the real entrypoint against a real route.

`GET /api/v1/admin/pipeline-runs` is the right route to use, because it is the
only manifest route that exercises all four cells with no CSRF token and no
request body. Read `workers/admin/cloudflare_handlers.js:14-24` before writing
this — the branch order there is exactly what you are asserting:

```js
export async function handleAdminPipelineRuns(request, env, url) {
  if (env.AUTH_ENABLED === "false") return json({ error: "Admin auth is disabled", code: "admin_auth_disabled" }, 403);
  const auth = await requireAuth(request, env, verifyJwt);
  if (auth instanceof Response) return auth;
  try {
    const stores = createCloudflareStores(env);
    const membership = await stores.identityStore.assertMembership(auth.claims);
    if (!isAdmin({ role: membership.role })) return json({ error: "Admin access required", code: "admin_required" }, 403);
```

and it is dispatched from `workers/cloudflare-native.js:223-225`.

Create `workers/__tests__/route-tenant-matrix.test.js`:

```js
/**
 * Route-level tenant enforcement.
 *
 * d1-schema-contract.test.js proves assertMembership() denies correctly.
 * This file proves a REAL ROUTE reaches it: the request goes through
 * workers/cloudflare-native.js with a genuinely signed JWT, and the four deny
 * cells are asserted by response code, not by inspecting the handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../auth/jwt.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TENANT_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const ADMIN_PATH = "/api/v1/admin/pipeline-runs";
const ctx = { waitUntil() {}, passThroughOnException() {} };

let env;

function baseEnv() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    JWT_SECRET_CURRENT: "test-secret-not-a-real-credential",
    JWT_KID_CURRENT: "test-kid",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: { put: vi.fn(), get: vi.fn(async () => null), head: vi.fn(async () => null), delete: vi.fn() },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(), deleteByIds: vi.fn(),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("spa", { status: 200 })) },
  };
}

function seedTenancy() {
  const now = "2026-08-27T00:00:00.000Z";
  env.IMMI_ACCOUNT_DB.exec(`
    INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at)
    VALUES ('${TENANT_ID}','individual','Workspace','${now}','${now}'),
           ('${OTHER_TENANT_ID}','organisation','Other','${now}','${now}');
    INSERT INTO users (user_id,telegram_id,created_at,updated_at)
    VALUES ('${USER_ID}','42','${now}','${now}');
  `);
  return now;
}

function grant(role, tenantId = TENANT_ID, revokedAt = null) {
  const now = "2026-08-27T00:00:00.000Z";
  env.IMMI_ACCOUNT_DB.exec(
    `INSERT INTO memberships (tenant_id,user_id,role,created_at,revoked_at) VALUES ` +
    `('${tenantId}','${USER_ID}','${role}','${now}',${revokedAt ? `'${revokedAt}'` : "NULL"})`,
  );
}

async function callAdmin(tenantId = TENANT_ID) {
  const token = await signJwt(
    { sub: USER_ID, tenant_id: tenantId, tenants: [tenantId], exp: Math.floor(Date.now() / 1000) + 300 },
    env,
  );
  const response = await worker.fetch(
    new Request(`https://immi.example${ADMIN_PATH}`, { headers: { Authorization: `Bearer ${token}` } }),
    env,
    ctx,
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeEach(() => {
  env = baseEnv();
  seedTenancy();
});

describe("GET /api/v1/admin/pipeline-runs enforces membership at the route", () => {
  it("401s with no bearer token at all", async () => {
    const response = await worker.fetch(new Request(`https://immi.example${ADMIN_PATH}`), env, ctx);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("auth_required");
  });

  it("403 tenant_membership_denied when the user has no membership row", async () => {
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "tenant_membership_denied" } });
  });

  it("403 tenant_membership_denied after the membership is revoked", async () => {
    grant("owner", TENANT_ID, "2026-08-27T00:00:00.000Z");
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "tenant_membership_denied" } });
  });

  it("403 tenant_membership_denied for a tenant the user is not a member of", async () => {
    grant("owner", TENANT_ID);
    expect(await callAdmin(OTHER_TENANT_ID)).toMatchObject({
      status: 403, body: { code: "tenant_membership_denied" },
    });
  });

  it("403 admin_required for a live membership with an insufficient role", async () => {
    grant("viewer");
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "admin_required" } });
  });

  it("serves the route for a live owner membership", async () => {
    grant("owner");
    const result = await callAdmin();
    expect(result.status).toBe(200);
    expect(result.body).not.toBeNull();
  });
});

describe("case mutations stay fail-closed", () => {
  it("returns case_mutations_disabled while IMMI_CASE_MUTATIONS_ENABLED is unset", async () => {
    // wrangler.toml ships this flag as "false" by design; prove the freeze is
    // observable rather than assumed.
    const response = await worker.fetch(
      new Request("https://immi.example/api/v1/cases", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("case_mutations_disabled");
  });
});
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/route-tenant-matrix.test.js
```

→ `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

If the `403 admin_required` case instead returns `200`, or the no-membership
case returns anything other than 403, **STOP and report** — that is a live
cross-tenant or privilege-escalation defect, and Worker source is out of scope
for this plan.

**What this step deliberately does not do**: it covers *one* route out of the
five modules that call `assertMembership()`
(`workers/case-api/cloudflare_mutations.js:70`,
`workers/case-api/cloudflare_actions.js:47`,
`workers/pipeline/control_handlers.js:51`,
`workers/admin/cloudflare_handlers.js:20`,
`workers/llm-council/storage.js` ×5 and
`workers/llm-council/cloudflare_handlers.js:79`). A full per-route matrix over
all 72 manifest routes needs CSRF minting and per-route request bodies and is a
follow-up — recorded in "Maintenance notes", not silently dropped.

### Step 6: Run the drift drill, then the full gate

First prove the new tests actually bite. **Mutate a throwaway copy of the
migration tree — never the checked-in files.** The shim reads
`IMMI_TEST_D1_MIGRATIONS_DIR` (Step 2) precisely so this drill cannot corrupt
the working tree, cannot race a parallel agent that is reading
`migrations/d1/**`, and cannot leave a broken migration behind if you Ctrl-C
halfway through:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
DRILL="$(mktemp -d)"
trap 'rm -rf "$DRILL"' EXIT INT TERM
cp -R migrations/d1/. "$DRILL/"
python3 - "$DRILL" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "account" / "0001_account.sql"
s = p.read_text()
assert "  revoked_at TEXT,\n" in s, "anchor not found — re-read the migration"
p.write_text(s.replace("  revoked_at TEXT,\n", "", 1))
PY

# Capture the REAL exit status. `... | tail` would report tail's status (always
# 0) and turn a silent pass into a "successful" drill.
( cd workers && IMMI_TEST_D1_MIGRATIONS_DIR="$DRILL" npx vitest run __tests__/d1-schema-contract.test.js ) > /tmp/immi-038-drill.txt 2>&1
DRILL_STATUS=$?
tail -6 /tmp/immi-038-drill.txt
echo "drill exit=$DRILL_STATUS"
grep -c "no such column: revoked_at" /tmp/immi-038-drill.txt

# The real tree was never touched — prove it, in the working tree, not just HEAD:
git status --short -- migrations/d1
git diff --stat -- migrations/d1
git diff --cached --stat -- migrations/d1
```

Expected: `drill exit` is **non-zero**; the run reports
`Tests  4 failed | 3 passed (7)` — all four tests in the "tenant isolation
against the shipped account schema" block fail with `no such column:
revoked_at`, while the three catalog tests still pass because only the account
copy was broken; the `grep -c` prints a number **≥ 1**; and all three git
commands print **nothing**.

If the drill exits 0, the tests are not really reaching the schema and the whole
plan is worthless as written — **STOP and report**.

Then the real gate. Every command's status is captured explicitly; nothing is
piped into `tail` and then trusted:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
set -o pipefail
make test-workers 2>&1 | tee /tmp/immi-038-after.txt | tail -4; echo "make test-workers exit=$?"
npm run test:workers 2>&1 | tail -4; echo "npm run test:workers exit=$?"
node scripts/check_cloudflare_native_bundle.mjs; echo "bundle exit=$?"
python3 scripts/check_native_effective_references.py --json; echo "refs exit=$?"
.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q; echo "manifest exit=$?"
git status --porcelain

AFTER_FILES=$(grep -oE 'Test Files +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-038-after.txt | grep -oE '\([0-9]+\)' | tr -d '()')
AFTER_TESTS=$(grep -oE 'Tests +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-038-after.txt | grep -oE '\([0-9]+\)' | tr -d '()')
echo "files: $BEFORE_FILES -> $AFTER_FILES ; tests: $BEFORE_TESTS -> $AFTER_TESTS"
```

**Verify** (all deltas against the Step 1 baseline, never absolute totals):
- every `exit=` line prints `0`.
- `AFTER_FILES == BEFORE_FILES + 4` and `AFTER_TESTS == BEFORE_TESTS + 92`
  (7 schema-contract + 73 manifest + 5 fall-through + 7 tenant-matrix).
- `npm run test:workers` reports the same counts as `make test-workers`.
- `check_cloudflare_native_bundle.mjs` → `Cloudflare-native bundle closure passed`.
- `check_native_effective_references.py --json` → `"ok": true`.
- `pytest tests/test_cloudflare_route_manifest.py -q` → `4 passed`.
- `git status --porcelain` → exactly five `??` lines, all under
  `workers/__tests__/`, and nothing else.

## Test plan

All new tests live under `workers/__tests__/` and are collected automatically by
`workers/vitest.config.js` — no runner or CI configuration changes.

New files and what they cover:

| File | Tests | Covers |
|---|---|---|
| `workers/__tests__/helpers/d1-sqlite.js` | 0 (helper) | Discovers and applies **every** `migrations/d1/<db>/*.sql` on disk to in-memory SQLite; implements prepare/bind/all/first/run/batch; `IMMI_TEST_D1_MIGRATIONS_DIR` redirects the root for mutation drills. |
| `workers/__tests__/d1-schema-contract.test.js` | 7 | `listPage` (unfiltered + `court` filter + relation projection + `date` alias), `countCompat`, `exportCases`, `searchLexical` (FTS5 + bm25 + relevance ordering), `rebuildAggregates` → `getStats` / `analyticsFilterOptions` / `getFilterOptions` / `analyticsOutcomes`; `assertMembership` no-row deny, live-role propagation, post-revocation deny, cross-tenant deny. |
| `workers/__tests__/route-manifest-coverage.test.js` | 73 | Each of the 72 manifest `implemented` routes reaches a handler rather than the fail-closed 503; plus a non-vacuous-manifest guard. |
| `workers/__tests__/entry-fallthrough.test.js` | 5 | `AUTH_ENABLED=false` disables auth routes (503); `AUTH_ENABLED` unset keeps them live; unmatched `/api/*` → 503 and never reaches ASSETS; non-API path → `env.ASSETS.fetch`; missing ASSETS binding → 503. |
| `workers/__tests__/route-tenant-matrix.test.js` | 7 | `GET /api/v1/admin/pipeline-runs` through the real entrypoint with a genuinely signed JWT: no token → 401; absent membership / revoked membership / wrong tenant → 403 `tenant_membership_denied`; live `viewer` → 403 `admin_required`; live `owner` → 200. Plus `POST /api/v1/cases` → 503 `case_mutations_disabled` while the write freeze is on. |

Structural pattern to follow:
`workers/__tests__/cloudflare-storage-contracts.test.js` for the store-level
tests (explicit `vitest` imports, an `env()` factory returning fresh bindings per
test) and `workers/__tests__/cloudflare-native-entry.test.js` for the entrypoint
tests (`vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }))` before
importing the Worker).

Regression guarded: the drift drill in step 6 is the standing proof that a schema
change breaks the suite. Re-run it whenever a migration is added. Because the
shim now discovers migrations from disk, a **new** migration enters the suite
automatically — the previous hardcoded list would have let a new file be ignored
while everything stayed green.

Verification: `make test-workers` exits 0 and its test count equals
`BEFORE_TESTS + 92` from the Step 1 baseline.

## Done criteria

ALL must hold. Note there are **no absolute suite totals** here on purpose: a
sibling plan landing in the same window moves them, and a plan that pins a total
teaches its executor to edit the yardstick.

- [ ] `node -e "const s=require('node:sqlite'); if(!s.DatabaseSync) process.exit(1); console.log('ok')"` prints `ok`
- [ ] `make test-workers` exits 0, and its `Test Files` / `Tests` counts equal
      `BEFORE_FILES + 4` / `BEFORE_TESTS + 92` recorded in Step 1
- [ ] `npm run test:workers` exits 0 with the same counts as `make test-workers`
- [ ] `cd workers && npx vitest run __tests__/d1-schema-contract.test.js` → `Tests  7 passed (7)`
- [ ] `cd workers && npx vitest run __tests__/route-manifest-coverage.test.js` → `Tests  73 passed (73)`
- [ ] `cd workers && npx vitest run __tests__/entry-fallthrough.test.js` → `Tests  5 passed (5)`
- [ ] `cd workers && npx vitest run __tests__/route-tenant-matrix.test.js` → `Tests  7 passed (7)`
- [ ] `cd workers && npx vitest run __tests__/route-tenant-matrix.test.js -t "403 tenant_membership_denied after the membership is revoked"` → passes
- [ ] `node scripts/check_cloudflare_native_bundle.mjs` exits 0
- [ ] `python3 scripts/check_native_effective_references.py --json` exits 0 and prints `"ok": true`
- [ ] `.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q` → `4 passed`
- [ ] The shim loads the **same file set** the filesystem holds, checked by identity
      (not by count) with the two commands in Step 2's Verify block
- [ ] The drift drill in step 6 exited **non-zero**, reported
      `Tests  4 failed | 3 passed (7)` with `no such column: revoked_at`, and
      `git status --short -- migrations/d1`, `git diff --stat -- migrations/d1`
      and `git diff --cached --stat -- migrations/d1` were all empty afterwards
- [ ] `git status --porcelain` lists exactly these five paths and nothing else:
      `workers/__tests__/helpers/d1-sqlite.js`,
      `workers/__tests__/d1-schema-contract.test.js`,
      `workers/__tests__/route-manifest-coverage.test.js`,
      `workers/__tests__/entry-fallthrough.test.js`,
      `workers/__tests__/route-tenant-matrix.test.js`
- [ ] All three of these print nothing:
      `git diff --stat 42826a3..HEAD -- workers/storage workers/cloudflare-native.js workers/admin workers/case-api workers/auth migrations/d1 workers/vitest.config.js .github Makefile`,
      the same command with `--cached` and no revision range, and the same
      command with no revision range at all (unstaged)
- [ ] `plans/README.md` status row updated (skip if the file does not exist; if
      a coordinator told you they maintain the index, skip it too)

## STOP conditions

Stop and report back (do not improvise) if:

- `require('node:sqlite')` fails. The runtime is older than Node 22.13. Do **not**
  add `better-sqlite3` or any other dependency — the root `package.json` has two
  devDependencies by design and a native module changes the CI contract.
- A route in `route-manifest-coverage.test.js` returns
  `code: "cloudflare_route_unavailable"`. That is a real production defect: a
  route the manifest promises does not exist. Report the route; fixing Worker
  source is out of scope for this plan.
- A `d1-schema-contract.test.js` assertion fails with a SQLite error such as
  `no such column` / `no such table` on the **unmodified** migrations. That means
  `workers/storage/cloudflare.js` and `migrations/d1/**` have genuinely diverged
  in production — exactly the bug this plan was written to expose. Report the
  statement and the column; do not "fix" it by editing the migration.
- The drift drill in step 6 exits 0 instead of failing 4 tests. The tests
  are not really reaching the schema and the whole plan is worthless as written.
- The drift drill leaves anything under `migrations/d1/` modified. It operates on
  a `mktemp -d` copy with a `trap` cleanup and must never touch the real tree; if
  it did, another agent may already have read a corrupt migration. Report
  immediately and do **not** `git checkout --` the tree yourself.
- A route in `route-tenant-matrix.test.js` returns 200 where the matrix expects
  401/403. That is a live authorization defect, not a test bug.
- `check_cloudflare_native_bundle.mjs` or `check_native_effective_references.py`
  starts failing. Your test files should be nowhere near the Worker's bundle
  closure; if they are, a Worker source file imported the test helper.
- Making a test pass appears to require touching anything in "Out of scope" —
  especially `workers/storage/cloudflare.js`, `migrations/d1/**`, or
  `workers/vitest.config.js`.
- You discover that `assertMembership` resolves for a revoked or absent
  membership row. That is an active cross-tenant exposure; report it immediately
  rather than adjusting the test to match.

## Maintenance notes

For whoever owns this next:

- **Adding a D1 migration**: nothing to do. `migrationFiles()` reads the
  directory, so a new `NNNN_*.sql` is applied by the shim from the moment it is
  committed. (This is deliberate: the first draft of this plan hardcoded the
  filenames and claimed "if you forget, the tests fail with `no such table`" —
  which is only true if some test happens to query the new tables. A migration
  adding tables nothing queries would have been ignored with the suite fully
  green.)
- **The shim is not D1, and this plan does not close the D1 runtime gap.** It
  implements only prepare/bind/all/first/run/batch and is backed by SQLite
  3.51.3, not Cloudflare's fork. It does not model D1's 100-bound-parameter limit
  (`bindAll` at `workers/storage/cloudflare.js:54` enforces that in production
  code and is covered separately), the 256 KiB row guard, batch/transaction
  semantics as D1 implements them, or per-query metadata beyond `meta.changes` /
  `meta.last_row_id`. Do not use it to reason about D1 limits.
  **The missing gate**, which should be its own plan: a Wrangler/Miniflare
  *local D1* integration suite (`wrangler d1 migrations apply --local`, then
  drive the store methods against the real D1 implementation) covering
  migrations, FTS5 behaviour, `batch()` atomicity, bound-parameter limits and
  the row-size guard. Until that exists, a green suite here proves the SQL is
  consistent with the schema — not that D1 accepts it.
- **What a reviewer should scrutinise in the PR**: (1) that no file outside
  `workers/__tests__/` changed; (2) that `PARAM_VALUES` in
  `route-manifest-coverage.test.js` still satisfies each handler's validator —
  a bad placeholder makes a healthy route look broken and, worse, a lax
  placeholder could make the whole parametrised suite vacuous; (3) that the
  revocation test still asserts behaviour rather than a SQL substring.
- **Known documentation drift, deliberately not fixed here**: `CLAUDE.md`
  ("Critical Gotchas" → `AUTH_ENABLED=false`) says disabled auth routes return
  "the Worker's generic 404 (`cloudflare_route_unavailable`)". Measured at
  `42826a3` they return **503** — `unavailable()` at
  `workers/cloudflare-native.js:160-165` hardcodes `status: 503` on line 162.
  `entry-fallthrough.test.js` now pins the real behaviour. Correcting the prose is
  a docs-plan follow-up.
- **Deferred**: `tests/integration/test_revoke_member.py` still implies coverage
  it cannot deliver — it module-skips at line 33 unless `SUPABASE_DB_URL` is set,
  queries the Postgres-era table `tenant_members` (D1 uses `memberships`), and
  POSTs to `FLASK_BASE_URL`, none of which exist in the production path. CI also
  passes `--ignore=tests/integration`. Its intent — "revoked member gets 403" —
  is now covered by `d1-schema-contract.test.js` → "denies after the membership
  is revoked". Deleting or porting that file is out of this plan's territory
  (`tests/**`); it belongs to whichever plan owns dead-code removal.
- **The route security matrix is started, not finished.** Step 5b covers one
  route (`GET /api/v1/admin/pipeline-runs`) across absent / revoked /
  wrong-tenant / wrong-role. Seven other entrypoints call `assertMembership()`
  and are still unproven at the route level:
  `workers/case-api/cloudflare_mutations.js:70`,
  `workers/case-api/cloudflare_actions.js:47`,
  `workers/pipeline/control_handlers.js:51`,
  `workers/llm-council/cloudflare_handlers.js:79` and the five call sites in
  `workers/llm-council/storage.js`. Extending the matrix needs CSRF minting
  (`workers/auth/csrf.js` `getCsrfToken` + the `__Host-csrf` cookie) and a body
  per route. Also still missing: refresh-token rotation and replay tested against
  the real `immi_refresh_sessions` schema rather than a mocked
  `rotateRefreshSession()`. Both belong in a follow-up plan that owns
  `workers/__tests__/`.
- **Natural next step**: the same harness makes it cheap to cover the write path
  (`updateCaseFields`, `deleteCase`, `batchDeleteCases`, `batchAddTag`, the
  refresh-session rotation methods at
  `workers/storage/cloudflare.js:1412-1507`) and the Council store. Add those in a
  follow-up rather than widening this plan.

## Findings reconsidered

- **TEST-01, the SQL-injection framing of `analyticsFilterOptions`** — the audit
  described the `LIMIT ${limit}` string interpolation in
  `workers/storage/cloudflare.js:666` as an injection vector. It is not. `limit`
  is supplied only by the two internal call sites on line 669,
  `query("case_nature", 60)` and `query("visa_subclass", 80)`; it is never
  caller-reachable. Verified by reading lines 655-673. The coverage claim stands
  and this plan does test the method (via `analyticsFilterOptions` in
  `d1-schema-contract.test.js`), but no injection fix is warranted and none is
  planned.
- **Line-number corrections made while verifying** — the audit cited
  `analyticsFilterOptions` at line 666; it begins at **655** and the interpolation
  sits at **666**. Everything else reproduced exactly: `workers/storage/cloudflare.js`
  is 1905 lines, `listPage` at 482, `compatPageNumber` at 130, `assertMembership`
  at 1300 with `revoked_at IS NULL` at 1304 and the 403 throw at 1308-1311; the
  SQL-blind `d1()` helper at `cloudflare-storage-contracts.test.js:22-40`; the
  membership test at lines 127-134; `firstRow: { role: "member" }` at line 46;
  `vi.mock("../storage/cloudflare.js")` in 13 test files (the audit said 12 — the
  full list is `llm-council-storage`, `cloudflare-council-handlers`,
  `cloudflare-native-queue`, `cloudflare-mutations`, `council-session-do`,
  `pipeline-status`, `cloudflare-native-auth-handlers`, `pipeline-control`,
  `auth-handlers-cloudflare`, `pipeline-coordinator`, `case-api-cloudflare`,
  `llm-council-retrieval`, `cloudflare-admin-handlers`);
  `tests/test_cloudflare_route_manifest.py` with exactly 4 self-referential tests;
  `cloudflare-native-entry.test.js` with exactly 5 tests, none touching
  `env.ASSETS` or `AUTH_ENABLED`; `grep -rn "migrations/d1"` over `workers/`,
  `tests/`, `scripts/`, `.github/` and the `Makefile` matching only two
  `workers/austlii-scraper/wrangler.toml` lines; and no `better-sqlite3` /
  `node:sqlite` harness anywhere in the repo.
- **TEST-02's suggestion to assert the SQL contains `revoked_at IS NULL`** —
  dropped in favour of the behavioural revocation test in step 3. A substring
  assertion would break on any harmless reformatting of the query while a
  behavioural one catches the predicate actually being removed. Strictly stronger,
  so the string assertion adds nothing.
- **TEST-02's suggestion to port or delete `tests/integration/test_revoke_member.py`** —
  verified accurate (module-skips at line 33; targets `tenant_members` and
  `FLASK_BASE_URL`; CI ignores `tests/integration`), but that path is outside this
  plan's file territory. Recorded as a deferred follow-up in "Maintenance notes"
  rather than silently dropped.
