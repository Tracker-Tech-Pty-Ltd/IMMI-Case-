# Plan 038: Run the D1 query layer against a real schema

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or the file does not exist (in which case skip it).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   workers/__tests__ workers/vitest.config.js \
>   workers/storage/cloudflare.js workers/cloudflare-native.js \
>   workers/llm-council/cloudflare_handlers.js \
>   migrations/d1 config/cloudflare-native-route-manifest.json
> ```
>
> **Expected**: empty output. Every excerpt in "Current state" was read at
> `42826a3`. If any of those files is listed, re-read the cited lines and
> compare them against the excerpts below **before** writing any code — a
> mismatch is a STOP condition, because this plan's whole value is that the
> tests encode the *real* schema and the *real* SQL.

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
unapplied migration and you get a fully green 345-test worker suite plus a
runtime 500 in production.

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
| Worker suite (baseline) | `make test-workers` | `Test Files 25 passed (25)` / `Tests 345 passed (345)` before your changes |
| Worker suite (as CI runs it) | `npm run test:workers` | same counts |
| One worker test file | `cd workers && npx vitest run __tests__/d1-schema-contract.test.js` | file passes |
| Native bundle closure gate | `node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (...)`, exit 0 |
| Native reference gate | `python3 scripts/check_native_effective_references.py --json` | `{"bundle_ok": true, ..., "ok": true, ...}`, exit 0 |
| Python route-manifest test (unchanged) | `.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q` | `4 passed` |
| Files changed | `git status --porcelain` | only the four new files in "Scope" |

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
make test-workers 2>&1 | tail -5
```

If the first command does not print `ok`, your Node is older than 22.13 —
**STOP and report**; do not install `better-sqlite3` or any other dependency as
a workaround (this repo's root `package.json` has exactly two devDependencies
and adding a native module is out of scope).

**Verify**: `node -e ...` → prints `ok`; `make test-workers` →
`Test Files  25 passed (25)` and `Tests  345 passed (345)`.

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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Vite cannot resolve the `node:sqlite` builtin (it postdates the bundler's
// builtin list), so it is loaded through CommonJS require at runtime instead.
// Requires Node >= 22.13; an older runtime fails loudly here by design.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const MIGRATIONS = Object.freeze({
  catalog: ["catalog/0001_catalog.sql"],
  account: ["account/0001_account.sql"],
  ops: ["ops/0001_ops.sql", "ops/0002_pipeline_control.sql"],
});

function migrationPath(relative) {
  return fileURLToPath(new URL(`../../../migrations/d1/${relative}`, import.meta.url));
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
  const files = MIGRATIONS[database];
  if (!files) throw new Error(`Unknown D1 database '${database}'`);
  const db = new DatabaseSync(":memory:");
  for (const file of files) db.exec(readFileSync(migrationPath(file), "utf8"));
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

Three details that matter and must not be "simplified":

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
const { createSqliteD1 } = await import('./workers/__tests__/helpers/d1-sqlite.js');
for (const name of ['catalog','account','ops']) {
  const db = createSqliteD1(name);
  const n = (await db.prepare(\"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'\").first()).n;
  console.log(name, n);
}"
```

→ prints `catalog 30`, `account 10`, `ops 10` (plus one `ExperimentalWarning`).
`make test-workers` still reports `Tests  345 passed (345)` — the helper is not
collected.

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

### Step 6: Run the drift drill, then the full gate

First prove the new tests actually bite. Break the schema on purpose, confirm a
loud failure, then restore:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
cp migrations/d1/account/0001_account.sql /tmp/immi-acc.bak
python3 - <<'PY'
p = "migrations/d1/account/0001_account.sql"
s = open(p).read()
open(p, "w").write(s.replace("  revoked_at TEXT,\n", "", 1))
PY
(cd workers && npx vitest run __tests__/d1-schema-contract.test.js) 2>&1 | tail -4
cp /tmp/immi-acc.bak migrations/d1/account/0001_account.sql
git diff --stat -- migrations/d1
```

Expected: the vitest run reports `Tests  4 failed | 3 passed (7)` — all four
tests in the "tenant isolation against the shipped account schema" block fail
with `no such column: revoked_at`, while the three catalog tests still pass
because only the account migration was broken. `git diff --stat -- migrations/d1`
must print **nothing** after the restore. If the drill run passes all 7, the
tests are not touching the schema — **STOP and report**.

Then the real gate:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers 2>&1 | tail -4
npm run test:workers 2>&1 | tail -4
node scripts/check_cloudflare_native_bundle.mjs
python3 scripts/check_native_effective_references.py --json
.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q
git status --porcelain
```

**Verify**:
- `make test-workers` and `npm run test:workers` → `Test Files  28 passed (28)`,
  `Tests  430 passed (430)` (345 baseline + 7 + 73 + 5).
- `check_cloudflare_native_bundle.mjs` → `Cloudflare-native bundle closure passed`, exit 0.
- `check_native_effective_references.py --json` → `"ok": true`, exit 0.
- `pytest tests/test_cloudflare_route_manifest.py -q` → `4 passed`.
- `git status --porcelain` → exactly four `??` lines, all under
  `workers/__tests__/`.

## Test plan

All new tests live under `workers/__tests__/` and are collected automatically by
`workers/vitest.config.js` — no runner or CI configuration changes.

New files and what they cover:

| File | Tests | Covers |
|---|---|---|
| `workers/__tests__/helpers/d1-sqlite.js` | 0 (helper) | Applies `migrations/d1/**` to in-memory SQLite; implements prepare/bind/all/first/run/batch. |
| `workers/__tests__/d1-schema-contract.test.js` | 7 | `listPage` (unfiltered + `court` filter + relation projection + `date` alias), `countCompat`, `exportCases`, `searchLexical` (FTS5 + bm25 + relevance ordering), `rebuildAggregates` → `getStats` / `analyticsFilterOptions` / `getFilterOptions` / `analyticsOutcomes`; `assertMembership` no-row deny, live-role propagation, post-revocation deny, cross-tenant deny. |
| `workers/__tests__/route-manifest-coverage.test.js` | 73 | Each of the 72 manifest `implemented` routes reaches a handler rather than the fail-closed 503; plus a non-vacuous-manifest guard. |
| `workers/__tests__/entry-fallthrough.test.js` | 5 | `AUTH_ENABLED=false` disables auth routes (503); `AUTH_ENABLED` unset keeps them live; unmatched `/api/*` → 503 and never reaches ASSETS; non-API path → `env.ASSETS.fetch`; missing ASSETS binding → 503. |

Structural pattern to follow:
`workers/__tests__/cloudflare-storage-contracts.test.js` for the store-level
tests (explicit `vitest` imports, an `env()` factory returning fresh bindings per
test) and `workers/__tests__/cloudflare-native-entry.test.js` for the entrypoint
tests (`vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }))` before
importing the Worker).

Regression guarded: the drift drill in step 6 is the standing proof that a schema
change breaks the suite. Re-run it whenever a migration is added.

Verification: `make test-workers` → `Tests  430 passed (430)`, i.e. the 345
pre-existing tests plus 85 new ones.

## Done criteria

ALL must hold:

- [ ] `node -e "const s=require('node:sqlite'); if(!s.DatabaseSync) process.exit(1); console.log('ok')"` prints `ok`
- [ ] `make test-workers` exits 0 with `Test Files  28 passed (28)` and `Tests  430 passed (430)`
- [ ] `npm run test:workers` exits 0 with the same counts
- [ ] `cd workers && npx vitest run __tests__/d1-schema-contract.test.js` → `Tests  7 passed (7)`
- [ ] `cd workers && npx vitest run __tests__/route-manifest-coverage.test.js` → `Tests  73 passed (73)`
- [ ] `cd workers && npx vitest run __tests__/entry-fallthrough.test.js` → `Tests  5 passed (5)`
- [ ] `node scripts/check_cloudflare_native_bundle.mjs` exits 0
- [ ] `python3 scripts/check_native_effective_references.py --json` exits 0 and prints `"ok": true`
- [ ] `.venv/bin/pytest tests/test_cloudflare_route_manifest.py -q` → `4 passed`
- [ ] `grep -rln "migrations/d1" workers/__tests__/` returns `workers/__tests__/helpers/d1-sqlite.js`
- [ ] The drift drill in step 6 produced `Tests  4 failed | 3 passed (7)` with `no such column: revoked_at`, and `git diff --stat -- migrations/d1` is empty afterwards
- [ ] `git status --porcelain` lists exactly these four paths and nothing else:
      `workers/__tests__/helpers/d1-sqlite.js`,
      `workers/__tests__/d1-schema-contract.test.js`,
      `workers/__tests__/route-manifest-coverage.test.js`,
      `workers/__tests__/entry-fallthrough.test.js`
- [ ] `git diff --stat 42826a3..HEAD -- workers/storage workers/cloudflare-native.js migrations/d1 workers/vitest.config.js .github Makefile` is empty
- [ ] `plans/README.md` status row updated (skip if the file does not exist)

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
- The drift drill in step 6 passes all 7 tests instead of failing 4. The tests
  are not really reaching the schema and the whole plan is worthless as written.
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

- **Adding a D1 migration**: append its filename to `MIGRATIONS` in
  `workers/__tests__/helpers/d1-sqlite.js`. If you forget, the new tables simply
  will not exist and the schema-contract tests fail with `no such table` — which
  is the intended alarm, not a bug in the helper.
- **The shim is not D1.** It implements only prepare/bind/all/first/run/batch and
  is backed by SQLite 3.51.3, not Cloudflare's fork. It does not model D1's
  100-bound-parameter limit (`bindAll` at `workers/storage/cloudflare.js:54`
  enforces that in production code and is covered separately), the 256 KiB row
  guard, or per-query billing metadata beyond `meta.changes` /
  `meta.last_row_id`. Do not use it to reason about D1 limits.
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
