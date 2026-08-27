# Plan 014: Bound the judge-leaderboard aggregate read inside D1 instead of in Worker memory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` **if that file exists** (at the time of writing it does
> not; do not create it) — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> ```
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- workers/storage/cloudflare.js workers/case-api/cloudflare.js
> ```
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

Depends on "none" is deliberate and was checked: the only commands this plan
needs (`cd workers && npx vitest run`, `node scripts/check_cloudflare_native_bundle.mjs`)
both already pass at commit `42826a3`. This plan touches no Python, no
frontend TypeScript, and no build config, so the verification-gate plans
(001–003) are not prerequisites.

## Why this matters

`/api/v1/analytics/judge-leaderboard` powers the Judge Profiles page, which is
one of the product's headline surfaces for a self-representing immigration
applicant deciding whether a tribunal member's record is relevant to them.
Today the endpoint pulls **three entire aggregate tables** out of D1 into the
Worker on every single request, reassembles them in JavaScript, and then throws
away all but at most 200 rows. Worse, when the caller sets a `court` filter,
two of those three tables are fetched and then provably never read — the
handler's own `if (!court)` guard skips the loops that consume them.

The corpus has ~15,465 distinct judge records, so `aggregate_judge_outcome`
alone holds one row per `(judge, court, outcome)` combination. Every request
pays to serialise, transfer, parse and hold all of that in a Worker's memory to
answer a question D1 could have answered with a `WHERE` clause. This plan pushes
the two filters the handler already parses (`court`, `min_cases`) down into SQL
and stops issuing the two dead queries, without changing a single byte of the
JSON response.

## Current state

### The files

- `workers/storage/cloudflare.js` — the D1 access layer. `analyticsJudgeAggregate()`
  at lines 709–719 is the storage method this plan rewrites. Everything else in
  this file is out of scope.
- `workers/case-api/cloudflare.js` — the GET-only read handlers.
  `handleAnalyticsJudgeLeaderboard()` at lines 879–928 is the only caller of
  `analyticsJudgeAggregate()`. This plan changes **one line** of it (line 886).

Verified with `grep -rn "analyticsJudgeAggregate" workers/ tests/ frontend/src`
at commit `42826a3` — there are exactly three hits: the definition
(`workers/storage/cloudflare.js:709`), the single call site
(`workers/case-api/cloudflare.js:886`), and a `vi.fn()` mock in
`workers/__tests__/case-api-cloudflare.test.js:105`.

### The storage method as it exists today

`workers/storage/cloudflare.js:709-719`, verbatim:

```js
  async analyticsJudgeAggregate() {
    const [outcomes, years, visas] = await Promise.all([
      this.db.prepare(`
        SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
        FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
      `).all(),
      this.db.prepare("SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year").all(),
      this.db.prepare("SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa").all(),
    ]);
    return { outcomes: rows(outcomes), years: rows(years), visas: rows(visas) };
  }
```

Three `SELECT`s. No `WHERE`. No `LIMIT`. No parameters.

### The handler as it exists today

`workers/case-api/cloudflare.js:879-891`, verbatim:

```js
async function handleAnalyticsJudgeLeaderboard(url, stores) {
  const sortBy = url.searchParams.get("sort_by") || "cases";
  const nameQ = (url.searchParams.get("name_q") || "").trim().toLowerCase();
  const court = (url.searchParams.get("court") || "").trim();
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
  const minCases = intParam(url.searchParams.get("min_cases"), 1, 1, 100000);
  if (!["cases", "approval_rate", "name"].includes(sortBy)) return jsonErr("Invalid sort_by. Allowed: approval_rate, cases, name");
  const aggregate = await stores.caseStore.analyticsJudgeAggregate();
  const judges = new Map();
  for (const row of aggregate.outcomes) {
    if (court && row.court_code !== court) continue;
    const key = row.judge_id;
```

`court` and `minCases` are already parsed and validated at lines 882 and 884 —
this plan simply hands them to the store instead of only using them in JS.

The dead-fetch guard, `workers/case-api/cloudflare.js:900-914`, verbatim:

```js
  if (!court) {
    for (const row of aggregate.years) {
      const judge = judges.get(row.judge_id);
      if (!judge) continue;
      const year = Number(row.year);
      if (!year) continue;
      judge.activeYears.first = judge.activeYears.first === null ? year : Math.min(judge.activeYears.first, year);
      judge.activeYears.last = judge.activeYears.last === null ? year : Math.max(judge.activeYears.last, year);
    }
    for (const row of aggregate.visas) {
      const judge = judges.get(row.judge_id);
      if (!judge) continue;
      judge.visas.set(row.visa_subclass, (judge.visas.get(row.visa_subclass) || 0) + Number(row.cnt || 0));
    }
  }
```

When `court` is a non-empty string this block never runs, so
`aggregate.years` and `aggregate.visas` are fetched purely to be discarded.

The JS filters and the response, `workers/case-api/cloudflare.js:915-927`,
verbatim:

```js
  let result = [...judges.values()]
    .filter((judge) => judge.total >= minCases && (!nameQ || judge.name.toLowerCase().includes(nameQ)))
    .map((judge) => ({
      name: judge.name, display_name: judge.name, total_cases: judge.total,
      approval_rate: roundRate(judge.wins, judge.total), courts: [...judge.courts].sort(),
      primary_court: [...judge.courts].sort()[0] || null,
      top_visa_subclasses: [...judge.visas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([subclass, count]) => ({ subclass, count })),
      active_years: judge.activeYears, outcome_summary: judge.outcomes,
    }));
  if (sortBy === "approval_rate") result.sort((a, b) => b.approval_rate - a.approval_rate || b.total_cases - a.total_cases);
  else if (sortBy === "name") result.sort((a, b) => a.name.localeCompare(b.name));
  else result.sort((a, b) => b.total_cases - a.total_cases || b.approval_rate - a.approval_rate);
  return jsonOk({ judges: result.slice(0, limit), total_judges: result.length }, "public, max-age=600, stale-while-revalidate=120");
```

Two things here constrain the fix and you must respect both:

1. **`total_judges` is `result.length`, counted _before_ `slice(0, limit)`.**
   It is the count of judges surviving `minCases` **and** `nameQ`. Therefore
   `limit` must **not** be pushed into SQL — doing so would silently cap
   `total_judges` at `limit` and change the API contract.
2. **`nameQ` filtering uses JavaScript `String.prototype.toLowerCase()`**, which
   is Unicode-aware. SQLite's `lower()` is ASCII-only by default, so an
   `instr(lower(name), ?)` pushdown would drop rows that JS would have matched
   (e.g. a name containing `Ó`). Therefore `nameQ` must **not** be pushed into
   SQL either.

Only `court` (exact string equality) and `minCases` (an integer floor on a
per-judge sum) are safe to push down. Both are pushed in this plan; both JS
filters stay in place as backstops, which is what makes the change provably
output-identical.

### The schema this relies on

`migrations/d1/catalog/0001_catalog.sql:252-259`, verbatim:

```sql
CREATE TABLE IF NOT EXISTS aggregate_judge_outcome (
  judge_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, court_code, outcome),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
```

Note the primary key is `(judge_id, court_code, outcome)` — `court_code` is
**not** an index prefix, so `WHERE court_code = ?` still scans the table.
The win here is therefore **not** a faster scan: it is that D1 stops serialising
tens of thousands of rows into a response the Worker must parse and hold. Do not
add an index for this; index work is owned by a separate plan (see "Out of
scope").

### Repo conventions that apply

- **SQLite window functions are already proven available in this codebase** —
  `workers/storage/cloudflare.js:1062` uses
  `ROW_NUMBER() OVER (ORDER BY ${column})`. Step 1 uses `SUM(...) OVER (PARTITION BY ...)`
  on the same engine.
- **Bind parameters are positional `?`, never `?NNN`.** Every `.bind()` call in
  `workers/storage/cloudflare.js` passes positional arguments; match that.
- **`rows(result)` is the mandatory unwrapper** for a D1 `.all()` result.
  `workers/storage/cloudflare.js:46-48`, verbatim:
  ```js
  function rows(result) {
    return Array.isArray(result?.results) ? result.results : [];
  }
  ```
- **Never mutate; return new objects.** The storage layer returns fresh plain
  objects; keep it that way.
- **Tenant isolation in this stack is app-layer, not Postgres RLS.**
  `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`
  is the boundary. `analyticsJudgeAggregate()` is a public, non-tenant-scoped
  analytics read today and stays that way — **do not add an auth parameter to it
  in this plan**; that would be a behaviour change outside this plan's scope.
- **`env.IMMI_CATALOG_DB` is a D1 binding, not a Postgres connection.** There is
  no per-request client to build and no connection pool.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker unit tests (baseline) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | `Test Files 25 passed (25)`, `Tests 345 passed (345)` at `42826a3` |
| One Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/<file>` | that file passes |
| Worker bundle closure gate | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (…bytes): /tmp/immi-cloudflare-native-bundle.mjs`, exit 0 |
| Confirm the single call site | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "analyticsJudgeAggregate" workers/` | exactly 3 hits (definition, call site, test mock) — plus your new test files after Step 3 |
| Files changed so far | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the in-scope files |

Do **not** run `make test-py`. Three tests in
`tests/test_backfill_judge_overrides_from_pdf.py` fail on this machine for an
environmental reason (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch
breaking the `pypdf` import). Those failures pre-date this plan, are unrelated to
it, and are not yours to fix.

## Scope

**In scope** (the only files you may modify or create):

- `workers/storage/cloudflare.js` — **only** `CloudflareCaseStore.analyticsJudgeAggregate`
  (lines 709–719). Do not touch any other method, constant or helper in this
  file.
- `workers/case-api/cloudflare.js` — **only line 886**, the single call to
  `stores.caseStore.analyticsJudgeAggregate()` inside
  `handleAnalyticsJudgeLeaderboard`. Every other line of that handler, and every
  other handler in the file, stays byte-identical.
- `workers/__tests__/cloudflare-storage-judge-aggregate.test.js` — **create**.
- `workers/__tests__/case-api-judge-leaderboard-pushdown.test.js` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `CloudflareCaseStore.rebuildAggregates` (`workers/storage/cloudflare.js:990-1067`)
  and `handleCaseMutationQueue` (`workers/cloudflare-native.js:104-129`). Both
  are owned outright by `plans/009-make-the-mutation-queue-safe.md`, which
  rewrites both wholesale. See "Findings reconsidered".
- `analyticsOutcomes`, `analyticsScope`, `analyticsConceptScope`
  (`workers/storage/cloudflare.js:608-695`) — owned by a separate in-flight plan
  that is changing their return shapes.
- `listPage`, `countCompat`, `guidedPrecedents`, `relatedCompat`, `searchLexical`
  and `exportCases` in `workers/storage/cloudflare.js` — each is owned by a
  different in-flight plan.
- `migrations/d1/**` — do **not** add an index on `aggregate_judge_outcome.court_code`
  or anywhere else. Read-path index migrations are owned by a separate plan; a
  second migration file touching the same tables would collide.
- Any handler in `workers/case-api/cloudflare.js` other than the one line named
  above — including adding, removing or editing any `Cache-Control` string. The
  `"public, max-age=600, stale-while-revalidate=120"` on line 927 must survive
  untouched; another plan builds edge caching on top of exactly those declared
  TTLs.
- `workers/__tests__/case-api-cloudflare.test.js` — its judge-leaderboard test at
  lines 458–472 and its store mock at line 105 are the regression signal that
  your change is output-preserving. They must keep passing **unmodified**. Do
  not edit them; do not "adjust" them to match new behaviour, because there is
  no new behaviour to match.
- Any existing file under `workers/__tests__/` — add new files only.
- `wrangler.toml` — the placeholder resource IDs and the `"false"` defaults for
  `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags are deliberate,
  fail-closed design. Do not "fix" them.
- `frontend/`, `immi_case_downloader/`, `tests/`, `Makefile`, `.github/`.
- The three failing Python tests in `tests/test_backfill_judge_overrides_from_pdf.py`
  (environmental, see "Commands you will need").

**Parallel-work note**: `workers/case-api/cloudflare.js` is claimed broadly by at
least one other in-flight plan (for missing-`await` fixes in the dispatcher) and
narrowly by two more (export handlers; six named analytics handlers). None of
them names `handleAnalyticsJudgeLeaderboard`. Your edit is one line inside that
handler. If line 886 no longer reads exactly as quoted in "Current state", that
is a drift STOP condition — do not attempt a merge.

## Git workflow

- Branch: `advisor/014-bound-the-aggregate-workload`
  (`git checkout -b advisor/014-bound-the-aggregate-workload` from `main`).
- One commit per step, or one commit for Steps 1–2 and one for Step 3.
- Commit message style is conventional commits, `<type>: <description>`, with
  type from `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from
  `git log`: `fix: install root node_modules in make install`. Suggested
  messages: `perf: push judge-leaderboard filters into D1` and
  `test: pin the judge-aggregate query pushdown`.
- **No AI attribution lines** in commit messages. Attribution is disabled
  globally for this repository.
- Do **not** push, do **not** open a pull request, do **not** merge. The operator
  commits and ships.

## Steps

### Step 1: Push `court` and `minCases` into the judge-aggregate SQL

Replace `workers/storage/cloudflare.js` lines 709–719 in their entirety with the
following. Nothing above line 709 or below line 719 changes.

```js
  /**
   * Judge-leaderboard aggregate read.
   *
   * `court` and `minCases` are pushed into SQL so D1 returns only rows the
   * caller can use. The caller keeps its own equivalent JS filters as a
   * backstop, so the response is byte-identical to the unfiltered path.
   * `aggregate_judge_year` / `aggregate_judge_visa` are not read at all when a
   * court filter is set, because the caller discards them in that case.
   *
   * `limit` and the name query are deliberately NOT pushed down: the caller
   * reports `total_judges` as the pre-limit count, and JS `toLowerCase()` is
   * Unicode-aware where SQLite `lower()` is ASCII-only.
   */
  async analyticsJudgeAggregate({ court = "", minCases = 1 } = {}) {
    const courtCode = typeof court === "string" ? court.trim() : "";
    const parsedFloor = Number.parseInt(String(minCases ?? ""), 10);
    const floor = Number.isFinite(parsedFloor) ? Math.max(1, parsedFloor) : 1;
    const outcomes = rows(await this.db.prepare(`
      SELECT judge_id, name, court_code, outcome, cnt FROM (
        SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt,
               SUM(o.case_count) OVER (PARTITION BY o.judge_id) AS judge_total
        FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
        WHERE (? = '' OR o.court_code = ?)
      ) WHERE judge_total >= ?
    `).bind(courtCode, courtCode, floor).all());
    if (courtCode) return { outcomes, years: [], visas: [] };
    const [years, visas] = await Promise.all([
      this.db.prepare(`
        SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year
        WHERE judge_id IN (
          SELECT judge_id FROM aggregate_judge_outcome GROUP BY judge_id HAVING SUM(case_count) >= ?
        )
      `).bind(floor).all(),
      this.db.prepare(`
        SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa
        WHERE judge_id IN (
          SELECT judge_id FROM aggregate_judge_outcome GROUP BY judge_id HAVING SUM(case_count) >= ?
        )
      `).bind(floor).all(),
    ]);
    return { outcomes, years: rows(years), visas: rows(visas) };
  }
```

Why each piece is output-preserving — check these by eye before running anything:

- **The window sum matches `judge.total`.** SQLite evaluates window functions
  *after* `WHERE`, so `SUM(o.case_count) OVER (PARTITION BY o.judge_id)` is the
  sum over exactly the rows that survive the court filter — which is exactly how
  the handler accumulates `judge.total` (it `continue`s on a court mismatch
  before adding to `judge.total`).
- **`minCases` is never below 1.** The handler produces it via
  `intParam(..., 1, 1, 100000)`, whose `min` is 1. `floor` clamps to 1 as well,
  so the two agree even if the store is called directly.
- **Skipping years/visas when a court is set produces identical output.** With a
  court filter the handler's `if (!court)` block never runs, so `judge.activeYears`
  stays `{ first: null, last: null }` and `judge.visas` stays empty — the same
  values you get from empty arrays.
- **Restricting years/visas to floor-passing judges produces identical output.**
  Both handler loops begin `const judge = judges.get(row.judge_id); if (!judge) continue;`,
  so rows for judges that did not survive the floor were already discarded.
- **Zero-argument calls still work.** `analyticsJudgeAggregate()` destructures to
  `court = ""`, `minCases = 1`, i.e. today's unfiltered behaviour.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ the bundle line is printed, then `Test Files 25 passed (25)` and
`Tests 345 passed (345)`. All 345 must still pass; this step changes no
observable behaviour yet, because the call site still passes no arguments.

### Step 2: Hand the handler's already-parsed filters to the store

In `workers/case-api/cloudflare.js`, change **line 886 only**.

From:

```js
  const aggregate = await stores.caseStore.analyticsJudgeAggregate();
```

To:

```js
  const aggregate = await stores.caseStore.analyticsJudgeAggregate({ court, minCases });
```

`court` and `minCases` are the local constants already declared on lines 882 and
884. Do not add, remove or reorder any other line. In particular:

- Leave `if (court && row.court_code !== court) continue;` (line 889) in place —
  it is now a no-op and stays as a backstop.
- Leave the `if (!court) { … }` block (lines 900–914) in place — it is now
  iterating empty arrays when a court is set, and stays as a backstop.
- Leave `.filter((judge) => judge.total >= minCases && …)` (line 916) in place —
  the `minCases` half is now a no-op and stays as a backstop; the `nameQ` half is
  still doing real work and **must not** be removed.
- Leave `result.slice(0, limit)` and `total_judges: result.length` (line 927)
  exactly as they are.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ bundle line printed, then `Tests 345 passed (345)`. In particular
`__tests__/case-api-cloudflare.test.js › serves judge leaderboard, profile and
compare from normalized aggregates` must still pass **unmodified** — that test
mocks the store and asserts `judges[0]` is
`{ name: "Justice Example", total_cases: 7 }`, so it proves you did not disturb
the response assembly.

Also confirm you changed exactly one line in this file:

`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --numstat -- workers/case-api/cloudflare.js`
→ `1	1	workers/case-api/cloudflare.js`

### Step 3: Pin the pushdown with tests

Two new files. Both are new; do not edit any existing test file.

**3a. `workers/__tests__/cloudflare-storage-judge-aggregate.test.js`** — drives
the **real** storage module (no `vi.mock` of `../storage/cloudflare.js`) through
a D1 mock that records every prepared statement and its bound parameters. Use
`createCloudflareCaseStore`, which needs only the catalog binding — verified at
`workers/storage/cloudflare.js:1894-1898`, it calls `assertCloudflareRuntimeMode(env)`
and `requireD1(env?.IMMI_CATALOG_DB, "IMMI_CATALOG_DB")` and nothing else.

Scaffold:

```js
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareCaseStore } from "../storage/cloudflare.js";

function d1(resultsBySqlFragment = {}) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => { statement.params = params; return statement; };
      statement.all = vi.fn(async () => {
        const hit = Object.entries(resultsBySqlFragment).find(([fragment]) => sql.includes(fragment));
        return { results: hit ? hit[1] : [] };
      });
      statement.first = vi.fn(async () => null);
      statement.run = vi.fn(async () => ({ meta: { changes: 1 } }));
      prepared.push(statement);
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
}

function storeWith(catalog) {
  return createCloudflareCaseStore({ IMMI_STORAGE_MODE: "cloudflare", IMMI_CATALOG_DB: catalog });
}

const sqlOf = (catalog) => catalog.prepared.map((statement) => statement.sql);
const mentioning = (catalog, table) => catalog.prepared.filter((statement) => statement.sql.includes(table));
```

Write these five tests inside a single
`describe("analyticsJudgeAggregate query pushdown", …)`:

1. **`defaults to no court filter and a floor of one`** — `await storeWith(catalog).analyticsJudgeAggregate()`.
   Assert `mentioning(catalog, "aggregate_judge_outcome")[0].params` equals
   `["", "", 1]`.
2. **`pushes the court code and the minimum-case floor into SQL`** — call with
   `{ court: "FCA", minCases: 5 }`. Assert the first statement mentioning
   `aggregate_judge_outcome` has `params` equal to `["FCA", "FCA", 5]`, and its
   `sql` contains both `SUM(o.case_count) OVER (PARTITION BY o.judge_id)` and
   `judge_total >= ?`.
3. **`does not read the year or visa tables when a court filter is set`** — call
   with `{ court: "FCA" }`. Assert `sqlOf(catalog).some((sql) => sql.includes("aggregate_judge_year"))`
   is `false`, the same for `aggregate_judge_visa`, and that the returned value
   has `years` and `visas` both `[]`.
4. **`reads all three aggregate tables when no court filter is set`** — call with
   no arguments. Assert `mentioning(catalog, "aggregate_judge_year")` has length
   1 and `mentioning(catalog, "aggregate_judge_visa")` has length 1.
5. **`restricts the year and visa reads to judges above the floor`** — call with
   `{ minCases: 5 }`. Assert both the year and the visa statements have `params`
   equal to `[5]` and `sql` containing `HAVING SUM(case_count) >= ?`.

For test 4, seed the mock so the unwrapping is exercised, e.g.
`d1({ "aggregate_judge_year": [{ judge_id: "judge-a", year: 2025, cnt: 7 }] })`,
and assert the returned `years` equals that array — this proves `rows()` is still
applied.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-judge-aggregate.test.js`
→ `Test Files 1 passed (1)`, `Tests 5 passed (5)`.

**3b. `workers/__tests__/case-api-judge-leaderboard-pushdown.test.js`** — proves
the handler forwards its parsed filters and that the response shape is unchanged.
This file **must** mock `../storage/cloudflare.js`, which is why it cannot live
in the same file as 3a. Mirror the mocking style of
`workers/__tests__/case-api-cloudflare.test.js:1-16`:

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";

const ENV = { IMMI_STORAGE_MODE: "cloudflare" };
const PATH = "/api/v1/analytics/judge-leaderboard";
const url = (query = "") => new URL(`https://immi.example${PATH}${query}`);

function stores() {
  return {
    caseStore: {
      analyticsJudgeAggregate: vi.fn(async () => ({
        outcomes: [
          { judge_id: "judge-a", name: "Justice Example", court_code: "FCA", outcome: "Allowed", cnt: 7 },
          { judge_id: "judge-b", name: "Member Other", court_code: "AATA", outcome: "Dismissed", cnt: 3 },
        ],
        years: [{ judge_id: "judge-a", year: 2025, cnt: 7 }],
        visas: [{ judge_id: "judge-a", visa_subclass: "189", cnt: 7 }],
      })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());
```

Three tests:

1. **`forwards the parsed court and min_cases filters to the store`** — request
   `url("?court=FCA&min_cases=5")`. Assert
   `current.caseStore.analyticsJudgeAggregate` was called with
   `{ court: "FCA", minCases: 5 }`.
2. **`forwards an empty court and a floor of one by default`** — request
   `url()`. Assert the call argument is `{ court: "", minCases: 1 }`.
3. **`reports total_judges before the limit is applied`** — request
   `url("?limit=1")`. Assert the JSON body has `judges` of length 1 and
   `total_judges` of 2. This is the guard against anyone later "optimising"
   `limit` into SQL.

Each test needs `const current = stores(); mockCreateStores.mockReturnValue(current);`
before `await dispatchCloudflareCaseRead(url(...), PATH, ENV)`.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-judge-leaderboard-pushdown.test.js`
→ `Test Files 1 passed (1)`, `Tests 3 passed (3)`.

Then the whole Worker suite:

`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ `Test Files 27 passed (27)`, `Tests 353 passed (353)` (345 baseline + 5 + 3).

## Test plan

- **New file `workers/__tests__/cloudflare-storage-judge-aggregate.test.js`**
  (5 tests) — covers the storage layer against a recording D1 mock:
  - happy path / defaults: zero-argument call binds `["", "", 1]`;
  - the specific regression this plan fixes: with `{ court: "FCA" }` the
    `aggregate_judge_year` and `aggregate_judge_visa` statements are **never
    prepared** (today they are always prepared and always discarded);
  - filter pushdown: `court` and `minCases` reach `.bind()` in the right order,
    and the SQL carries the window sum and the `judge_total >= ?` predicate;
  - unfiltered path: all three tables are read exactly once;
  - floor propagation: the year and visa statements each bind `[minCases]`.
- **New file `workers/__tests__/case-api-judge-leaderboard-pushdown.test.js`**
  (3 tests) — covers the handler seam:
  - the two parsed filters are forwarded;
  - the defaults are forwarded (`""` / `1`), not `undefined`;
  - `total_judges` remains the pre-`limit` count — the named edge case that
    forbids a future `limit` pushdown.
- **Structural pattern to follow**: model 3b on
  `workers/__tests__/case-api-cloudflare.test.js` lines 1–16 (the
  `vi.mock("../storage/cloudflare.js")` + `mockCreateStores` + `url()` helper
  shape). Model 3a's D1 mock on the `prepare`/`bind`/`all` triple used
  throughout `workers/storage/cloudflare.js`.
- **Regression signal you must not touch**:
  `workers/__tests__/case-api-cloudflare.test.js › serves judge leaderboard,
  profile and compare from normalized aggregates` (lines 458–472) must pass
  unmodified. It is the proof that the response body is unchanged.
- **Verification**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
  → `Test Files 27 passed (27)`, `Tests 353 passed (353)`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` exits 0 and prints `Cloudflare-native bundle closure passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` reports `Test Files 27 passed (27)` and `Tests 353 passed (353)`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --numstat -- workers/case-api/cloudflare.js` outputs exactly `1	1	workers/case-api/cloudflare.js`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c "analyticsJudgeAggregate()" workers/case-api/cloudflare.js` returns `0`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "SUM(o.case_count) OVER (PARTITION BY o.judge_id)" workers/storage/cloudflare.js` returns exactly one line
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` lists only: `workers/storage/cloudflare.js`, `workers/case-api/cloudflare.js`, `workers/__tests__/cloudflare-storage-judge-aggregate.test.js`, `workers/__tests__/case-api-judge-leaderboard-pushdown.test.js`, and this plan file (plus any file that was already dirty before you started — check with `git status --short` first and record it)
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat -- workers/__tests__/case-api-cloudflare.test.js` is empty
- [ ] `plans/README.md` status row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- `workers/case-api/cloudflare.js:886` does not read exactly
  `  const aggregate = await stores.caseStore.analyticsJudgeAggregate();`
  — another plan has already edited this handler and merging is not your call.
- `workers/storage/cloudflare.js:709-719` does not match the verbatim excerpt in
  "Current state".
- `grep -rn "analyticsJudgeAggregate" workers/` returns anything other than the
  three expected hits before you start (definition, call site, mock in
  `case-api-cloudflare.test.js`). A fourth caller means the zero-argument default
  is load-bearing somewhere this plan did not analyse.
- `workers/__tests__/case-api-cloudflare.test.js › serves judge leaderboard,
  profile and compare from normalized aggregates` fails after Step 2. That test
  is the output-equivalence proof; a failure means the response changed, which
  this plan explicitly forbids. **Do not edit the test to make it pass.**
- The `SUM(...) OVER (PARTITION BY ...)` statement errors at runtime with a
  syntax error. Window functions are used elsewhere in this file
  (`workers/storage/cloudflare.js:1062`), so a syntax failure means the D1 mock
  or the SQL text is wrong, not that the feature is unavailable — but stop and
  report rather than rewriting the query into a self-join.
- The Worker suite total is anything other than 353 after Step 3. A number below
  353 means a test was lost; above means you added tests this plan did not
  specify — either way, report before continuing.
- You find yourself needing to change `total_judges`, `result.slice(0, limit)`,
  the `nameQ` filter, or the `Cache-Control` header to make something pass.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise**: the equivalence argument, not the speed.
  Three things carry the whole change: (1) SQLite evaluates window functions
  after `WHERE`, so the partition sum matches the handler's post-court-filter
  `judge.total`; (2) `limit` and `name_q` are deliberately *not* pushed down —
  `limit` would break `total_judges`, `name_q` would break on non-ASCII names;
  (3) the JS filters were kept as backstops on purpose, so the change is safe
  even if the SQL is subtly more permissive.
- **This is a transfer-size win, not an index win.** `aggregate_judge_outcome`
  has primary key `(judge_id, court_code, outcome)`, so `WHERE court_code = ?`
  still scans. Adding `CREATE INDEX … ON aggregate_judge_outcome(court_code)` is
  a reasonable follow-up but belongs in the read-path index migration owned by a
  separate plan — do not add a competing migration file.
- **If `name_q` ever needs to be pushed down**, the safe route is a generated,
  ASCII-folded column on `judges` populated by the aggregate rebuild, not
  `lower()` in the query. Revisit only with a measured cardinality.
- **If a `limit` pushdown is ever wanted**, `analyticsJudgeAggregate` must also
  return a separate total, and `handleAnalyticsJudgeLeaderboard` must report that
  total instead of `result.length`. Test 3 of
  `case-api-judge-leaderboard-pushdown.test.js` exists to make that a deliberate,
  visible change rather than an accident.
- **Deferred out of this plan, with a concrete recipe** — the aggregate-rebuild
  write amplification described under "Findings reconsidered" below. Once
  `plans/009-make-the-mutation-queue-safe.md` has landed, the follow-up is: in
  `handleCaseMutationQueue`, replace the direct `stores.caseStore.rebuildAggregates()`
  call for *data* messages with `env.CASE_MUTATION_QUEUE.send({ kind: "catalog.rebuild" })`,
  and let the existing `processAggregateRebuild` path (already wired, already
  covered by `cloudflare-native-queue.test.js › rebuilds catalog aggregates for a
  mutation-triggered refresh event`) perform the actual rebuild. That alone
  coalesces roughly `max_batch_size` rebuilds into one; true single-rebuild
  debouncing additionally needs a dirty flag plus a cron trigger, which means
  touching `wrangler.toml` — currently fenced off by two other plans.

## Findings reconsidered

- **"Stop rebuilding all 17 aggregate tables from full corpus scans on every
  mutation-queue batch" — real, confirmed, but not this plan's work.** I verified
  every cited line: `workers/cloudflare-native.js:120` is exactly
  `if (changed) await stores.caseStore.rebuildAggregates();`;
  `workers/storage/cloudflare.js:993-998` names exactly 17 tables;
  line 1065 is `for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));`,
  and the 17 `DELETE`s therefore all commit in batch 1 while most `INSERT`s land
  in later batches. The problem is real. It is nevertheless excluded here because
  `plans/009-make-the-mutation-queue-safe.md` claims both `rebuildAggregates()`
  and `handleCaseMutationQueue` in its In-scope list and rewrites both wholesale:
  its Step 2 already groups each table's `DELETE` with its `INSERT`s in one
  `db.batch()`, which is precisely the atomicity fix, and its Step 1 replaces the
  entire queue handler. Duplicating either half here would guarantee a merge
  conflict and could regress 009's new tests. The debounce half is carried
  forward as a concrete recipe in "Maintenance notes".
  - *Evidence correction*: the audit reported "19 INSERT…GROUP BY statements" and
    "43 total statements". Counting the live code, the explicit block at
    lines 1001–1058 contains **17** `INSERT`s, the loop at 1060–1064 adds **7**
    more (24 `INSERT`s total), and with 17 `DELETE`s that is **41** statements,
    not 43 — so the `offset += 20` loop makes three batches of 20/20/1. The
    structural conclusion (DELETEs commit before most INSERTs) is unaffected.
    Plan 009's own stated invariant of "24 INSERT statements total" matches my
    count, so 009 is correct and the audit's arithmetic was not.
- **"Council append re-downloads every prior turn's full R2 payload" — real but
  too small to act on, and the residual fix would introduce a leak.** The code
  path is exactly as described: `workers/llm-council/cloudflare_handlers.js:218`
  calls `readSession()`, whose fan-out at lines 130–136 issues one
  `objectStore.getVerifiedJson()` per turn, and lines 231–234 reduce all of it to
  `{ user_message, payload.moderator.composed_answer }`. But `MAX_TURNS = 15`
  (line 19) is enforced at line 220, so a session performs at most 15 R2 GETs —
  trivial against a Worker's subrequest budget, and negligible against the
  multiple LLM calls the same request then makes. The one remaining sub-item, a
  `LIMIT` on the `council_turns` `SELECT` in
  `workers/storage/cloudflare.js:1562-1568`, is **actively unsafe**: I traced the
  other caller and `workers/llm-council/session_do.js:112-124` uses that same
  method's `metadata.turns` to enumerate R2 objects for deletion. A `LIMIT` there
  would let `deleteSession` soft-delete the D1 rows while orphaning every R2
  payload past the cap. Rejected: no measurable gain, a new correctness hazard.
  - *Evidence correction*: the cited storage line was wrong.
    `getSessionMetadata` begins at line **1553**, and its `council_turns` query
    is at **1562–1568**; line 1560 is the *session* query's `.bind()`. The
    audit's "8 MB per turn" figure was also wrong — that number is the validation
    ceiling in the object store, not an observed payload size.
- **"Bound the judge-leaderboard aggregate load" — kept, with one correction.**
  The mechanism is confirmed exactly as described. The audit's row-count
  arithmetic ("six-figure row count, multi-MB D1 result") is an unmeasured
  extrapolation from the 15,465-judge figure and is not repeated in this plan.
  Additionally, the fix sketch implied an index-shaped win; it is not one.
  `migrations/d1/catalog/0001_catalog.sql:252-259` gives
  `aggregate_judge_outcome` the primary key `(judge_id, court_code, outcome)`, so
  `court_code` is not an index prefix and the table is still scanned. The real
  win is that D1 stops serialising and the Worker stops parsing and holding rows
  it will discard, plus the elimination of two entire table reads when a court
  filter is set. The plan is written around that honest claim.
