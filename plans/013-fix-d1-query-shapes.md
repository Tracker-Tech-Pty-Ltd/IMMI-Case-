# Plan 013: Add the missing indexes and stop the full scans on the hot read paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> Every path in this file is relative to the repository root
> `/Users/d/Developer/Active Projects/IMMI-Case-`. The directory name contains
> a space and a trailing hyphen, so always quote it in shell commands.
>
> **Drift check (run first)**:
> ```
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- migrations/d1 workers/storage/cloudflare.js workers/__tests__/cloudflare-storage-contracts.test.js
> ```
> If that prints nothing, the codebase has not drifted — proceed. If any
> in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

Why "none" for dependencies: this plan touches only SQL migration files, one
Worker JavaScript module and two Worker test files. It runs no frontend
TypeScript compile and no Python test, so the verification-gate plans that fix
those toolchains are not prerequisites here. The only gate this plan relies on
is `make test-workers`, which is green at `42826a3` (345 passed, 25 files —
re-verified while writing this plan).

## Why this matters

Production is a single Cloudflare Worker reading a D1 catalog of ~149,000 case
rows. Four of the most-hit read paths are shaped so SQLite cannot use any
index: the default case listing sorts by a column with no index and counts the
whole table a second time to do it; the related-cases panel on every case-detail
page full-scans and sorts the entire corpus (evaluating a 30-column projection
with two correlated subqueries per row) just to return five links; lexical
search issues up to five sequential round trips for data one query could
return; and the operator pipeline dashboard polls two unindexed queries every
two seconds. None of these needs new infrastructure — three indexes are simply
missing, one already-maintained aggregate row is being recomputed by hand, and
two queries are serialised where they could be parallel.

After this plan lands, the default `/api/v1/cases` request does one indexed
range scan and one primary-key read instead of two full table traversals;
`/api/v1/cases/:id/related` does three narrow indexed lookups instead of one
full scan; lexical search does one D1 round trip instead of up to five; and the
pipeline dashboard's listing query is indexed. A user-facing 400 on the "Year"
sort option in the cases UI is fixed as a side effect (see Step 4).

## Current state

### Files this plan touches

- `migrations/d1/catalog/0001_catalog.sql` — the only Catalog-D1 migration
  today; declares the `cases` table and its four indexes. **Read-only for this
  plan**; you add a new `0002_*.sql` beside it.
- `migrations/d1/ops/0001_ops.sql` and `migrations/d1/ops/0002_pipeline_control.sql`
  — the two Ops-D1 migrations. **Read-only for this plan**; you add a new
  `0003_*.sql` beside them.
- `workers/storage/cloudflare.js` — 1,905 lines. The D1/R2/Vectorize access
  layer and the only module allowed to touch `env.IMMI_*_DB` bindings. Contains
  every query builder this plan changes.
- `workers/__tests__/cloudflare-storage-contracts.test.js` — 215 lines. Storage
  contract tests against a fake D1 binding that records SQL and bound params.
- `workers/__tests__/cloudflare-storage-query-shapes.test.js` — does not exist
  yet; you create it in Step 8.

### `migrations/d1/catalog/0001_catalog.sql:46-49` (verbatim) — the only `cases` indexes

```sql
CREATE INDEX IF NOT EXISTS cases_court_year_idx ON cases(court_code, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_filter_idx ON cases(outcome, visa_subclass, source, year DESC);
CREATE INDEX IF NOT EXISTS cases_visa_type_idx ON cases(visa_type, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_semantic_ready_idx ON cases(semantic_ready, updated_at);
```

No index has `year` as a leading column, and `case_nature` is not indexed at
all. `year` is declared nullable (`year INTEGER` at line 13); `case_nature TEXT
NOT NULL DEFAULT ''` at line 26.

### `migrations/d1/catalog/0001_catalog.sql:184-188` (verbatim) — the precomputed total

```sql
CREATE TABLE IF NOT EXISTS catalog_summary (
  summary_key TEXT PRIMARY KEY,
  value_int INTEGER NOT NULL CHECK(value_int >= 0),
  updated_at TEXT NOT NULL
);
```

`rebuildAggregates()` populates the `total_cases` key at
`workers/storage/cloudflare.js:1005-1006` (verbatim):

```js
      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
```

### `workers/storage/cloudflare.js:482-511` (verbatim) — `listPage`, the default case listing

```js
  async listPage({ filters = {}, sortBy = "date", sortDir = "desc", page = 1, pageSize = 100 } = {}) {
    const column = COMPAT_SORT_COLUMNS[sortBy];
    if (!column) {
      throw new StorageBoundaryError(`Invalid sort_by '${sortBy}'.`, { code: "invalid_sort", status: 400 });
    }
    const direction = String(sortDir).toLowerCase();
    if (direction !== "asc" && direction !== "desc") {
      throw new StorageBoundaryError("sort_dir must be asc or desc.", { code: "invalid_sort", status: 400 });
    }
    const checkedPage = compatPageNumber(page, 1, 1, 10000);
    const checkedPageSize = compatPageNumber(pageSize, 100, 1, 200);
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const count = await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
    const total = Number(count?.total || 0);
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY ${column} ${direction.toUpperCase()}, c.case_id ASC
      LIMIT ? OFFSET ?
    `, [...params, checkedPageSize, (checkedPage - 1) * checkedPageSize]);
    return {
      cases: rows(await statement.all()),
      total,
      page: checkedPage,
      page_size: checkedPageSize,
      total_pages: Math.max(1, Math.ceil(total / checkedPageSize)),
      next_cursor: null,
    };
  }
```

Two things to notice. First, on the default no-filter request `where` is the
empty string, so `COUNT(*)` traverses all ~149,000 rows and the page query then
sorts all of them again on an unindexed column. Second, the two queries are
**sequential** — line 495 is awaited before line 497 even builds the second
statement — so the request pays both round trips end to end.

### `workers/storage/cloudflare.js:526-531` (verbatim) — the same unfiltered count, again

```js
  async countCompat(filters = {}) {
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
    return Number(result?.total || 0);
  }
```

Reached from `/api/v1/cases/count` (`workers/case-api/cloudflare.js:1105`).

### `workers/storage/cloudflare.js:853-864` (verbatim) — `guidedPrecedents`, which already has the fix pattern

```js
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = clauses.length
      ? Number((await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first())?.total || 0)
      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
    const size = clampLimit(limit, { fallback: 50, max: 200 });
    const results = rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
    return { total, results };
```

This is the precedent Step 3 generalises: when there are no filters, read the
count from `catalog_summary` instead of counting rows. Note it has no fallback
if the aggregate row is missing, and its two queries are also sequential.

### `workers/storage/cloudflare.js:118-128` (verbatim) — the sort whitelist

```js
const COMPAT_SORT_COLUMNS = Object.freeze({
  date: "c.year",
  title: "c.title",
  court: "c.court_code",
  outcome: "c.outcome",
  visa_subclass_number: "c.visa_subclass_number",
  applicant_name: "c.applicant_name",
  hearing_date: "c.hearing_date",
  case_id: "c.case_id",
  citation: "c.citation",
});
```

There is no `year` key. The cases UI offers exactly four sort options —
`frontend/src/components/cases/CasesFilters.tsx:144-147` (verbatim):

```tsx
            <option value="date">{t("cases.date")}</option>
            <option value="year">{t("units.year")}</option>
            <option value="title">{t("cases.title")}</option>
            <option value="court">{t("filters.court")}</option>
```

`frontend/src/pages/CasesPage.tsx:60` forwards that value unchanged, and
`workers/case-api/cloudflare.js:1095` passes it straight into `listPage`. So
choosing "Year" in the dropdown returns HTTP 400 today. Step 4 fixes it with a
one-line addition to the whitelist above; no frontend file is touched.

### `workers/storage/cloudflare.js:1069-1097` (verbatim) — `relatedCompat`

```js
  async relatedCompat(caseId, { limit = 5 } = {}) {
    const id = assertCaseId(caseId);
    const size = compatPageNumber(limit, 5, 1, 20);
    const anchor = await this.db.prepare(`
      SELECT case_nature, visa_type, court_code FROM cases WHERE case_id = ?
    `).bind(id).first();
    if (!anchor) return null;
    const statements = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION},
        (CASE WHEN ? <> '' AND c.case_nature = ? THEN 4 ELSE 0 END) +
        (CASE WHEN ? <> '' AND c.visa_type = ? THEN 2 ELSE 0 END) +
        (CASE WHEN ? <> '' AND c.court_code = ? THEN 1 ELSE 0 END) AS related_score
      FROM cases c
      WHERE c.case_id <> ?
        AND ((? <> '' AND c.case_nature = ?) OR (? <> '' AND c.visa_type = ?) OR (? <> '' AND c.court_code = ?))
      ORDER BY related_score DESC, c.year DESC, c.case_id ASC
      LIMIT ?
    `, [
      anchor.case_nature, anchor.case_nature,
      anchor.visa_type, anchor.visa_type,
      anchor.court_code, anchor.court_code,
      id,
      anchor.case_nature, anchor.case_nature,
      anchor.visa_type, anchor.visa_type,
      anchor.court_code, anchor.court_code,
      size,
    ]);
    return rows(await statements.all());
  }
```

The `WHERE` is a three-way `OR` across three different columns, one of which
(`case_nature`) has no index at all, so SQLite cannot apply its multi-index OR
optimisation and must scan `cases` end to end. Worse, `ORDER BY related_score`
sorts on a computed expression, which forces the whole SELECT list — including
the two correlated subqueries in `LEGACY_CASE_PROJECTION` — to be evaluated for
every candidate row before `LIMIT` can apply.

Its only caller is `workers/case-api/cloudflare.js:1119-1121` (verbatim):

```js
      const cases = await stores.caseStore.relatedCompat(related[1], { limit: intParam(url.searchParams.get("limit"), 5, 1, 20) });
      if (cases === null) return jsonErr("Case not found", 404);
      return jsonOk({ cases: cases.map(({ related_score, ...row }) => publicCase(row)) });
```

So the contract you must preserve is: return `null` when the anchor case does
not exist, otherwise an array of row objects each carrying a `related_score`
property plus every field `publicCase` reads.

### `workers/storage/cloudflare.js:89-116` (verbatim) — `LEGACY_CASE_PROJECTION`

```js
const LEGACY_CASE_PROJECTION = `
  c.case_id, c.citation, c.title, c.court, c.court_code,
  c.decision_date AS date, c.year, c.outcome, c.visa_type, c.source,
  c.tags, c.case_nature, c.visa_subclass, c.visa_class_code,
  c.applicant_name, c.respondent, c.country_of_origin,
  c.visa_subclass_number, c.hearing_date, c.is_represented,
  c.representative, c.url, c.catchwords, c.legislation, c.text_snippet,
  c.user_notes, c.visa_outcome_reason, c.legal_test_applied,
  c.content_key AS full_text_path,
  COALESCE((
    SELECT group_concat(canonical_name, '; ')
    FROM (
      SELECT j.canonical_name
      FROM case_judges cj JOIN judges j ON j.judge_id = cj.judge_id
      WHERE cj.case_id = c.case_id
      ORDER BY j.canonical_name
    )
  ), '') AS judges,
  COALESCE((
    SELECT group_concat(label, '; ')
    FROM (
      SELECT lc.label
      FROM case_concepts cc JOIN concepts lc ON lc.concept_id = cc.concept_id
      WHERE cc.case_id = c.case_id
      ORDER BY lc.label
    )
  ), '') AS legal_concepts
`;
```

**Do not modify this constant.** It is shared by eight call sites
(`cloudflare.js` lines 442, 474, 498, 518, 821, 859, 1077, 1128) and by a
separate in-flight plan that explicitly declares it out of scope. Step 6 stops
`relatedCompat` from *using* it across a whole-corpus candidate set; the
constant itself stays byte-identical.

### `workers/storage/cloudflare.js:817-827` (verbatim) — `findByIds`, the hydration pattern to reuse

```js
  async findByIds(caseIds) {
    const ids = [...new Set((caseIds || []).map(assertCaseId))];
    if (ids.length === 0) return [];
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `, [JSON.stringify(ids)]);
    const found = rows(await statement.all());
    const rank = new Map(ids.map((id, index) => [id, index]));
    return found.sort((left, right) => rank.get(left.case_id) - rank.get(right.case_id));
  }
```

One bound parameter regardless of id count, and it returns rows in the caller's
requested order. Step 6 hydrates through this method so the returned row shape
is identical to today's by construction.

### `workers/storage/cloudflare.js:1099-1123` (verbatim) — `searchLexical`'s OFFSET loop

```js
  async searchLexical({ query, match, filters = {}, limit } = {}) {
    const matchString = match ?? toFtsMatch(query);
    const { clauses, params } = safeCaseFilters(filters);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    // bm25() is valid only in the direct FTS query context. Paginate over chunk
    // candidates (a single long case can monopolise the first page) until enough
    // distinct cases are found, then aggregate their best-chunk rank per case.
    const ranks = new Map();
    const CHUNK_PAGE = 100;
    const MAX_PAGES = 5;
    for (let offset = 0; offset < CHUNK_PAGE * MAX_PAGES; offset += CHUNK_PAGE) {
      const hits = rows(await this.db.prepare(`
        SELECT case_id, bm25(case_text_fts) AS rank
        FROM case_text_fts
        WHERE case_text_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ? OFFSET ?
      `).bind(matchString, CHUNK_PAGE, offset).all());
      if (hits.length === 0) break;
      for (const hit of hits) {
        const rank = Number(hit.rank);
        if (!ranks.has(hit.case_id) || rank < ranks.get(hit.case_id)) ranks.set(hit.case_id, rank);
      }
      if (ranks.size >= size) break;
    }
```

Each iteration awaits its own round trip. The five pages read at most 500 chunk
rows in total — the same 500 rows one `LIMIT 500` query would return, because
the `ORDER BY rank ASC` is identical across pages.

### `workers/storage/cloudflare.js:1658-1683` (verbatim) — `listRuns`, polled every 2s

```js
  async listRuns(limit = 30) {
    const size = clampLimit(limit, { fallback: 30, max: 100 });
    const [runRows, summary] = await Promise.all([
      this.db.prepare(`
        SELECT run_id, started_at, finished_at, trigger, court, phase, status,
               discovered, scraped, extracted, upserted, llm_calls, cost_usd,
               errors, abort_reason, detail_json
        FROM pipeline_runs
        ORDER BY started_at DESC LIMIT ?
      `).bind(size).all(),
      this.db.prepare(`
        SELECT COUNT(*) AS total_runs,
               SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
               SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_runs,
               COALESCE(SUM(discovered), 0) AS discovered,
               COALESCE(SUM(scraped), 0) AS scraped,
               COALESCE(SUM(extracted), 0) AS extracted,
               COALESCE(SUM(upserted), 0) AS upserted,
               COALESCE(SUM(llm_calls), 0) AS llm_calls,
               COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM pipeline_runs
      `).first(),
    ]);
    return { runs: rows(runRows), summary: summary || {} };
  }
```

`migrations/d1/ops/0001_ops.sql:4-22` declares `pipeline_runs` with `run_id TEXT
PRIMARY KEY` and no index on `started_at`, `status` or `finished_at`. Both
`/api/v1/pipeline-status` and `/api/v1/job-status` reach this through
`readStatus()` in `workers/pipeline/cloudflare_handlers.js:66-68`, and
`frontend/src/pages/DataToolsPage.tsx` polls both every 2000 ms while a run is
active (15000 ms otherwise). Step 2 indexes the listing query. The aggregate and
the duplicate frontend polling are deliberately **not** changed here — see
"Out of scope".

### `workers/storage/cloudflare.js:1689-1693` (verbatim) — `latestControlCommand`

```js
    return this.db.prepare(`
      SELECT command_id, action, payload_json, status, run_id, error, created_at, updated_at, completed_at
      FROM pipeline_control_commands
      WHERE action = ? ORDER BY created_at DESC LIMIT 1
    `).bind(action).first();
```

`migrations/d1/ops/0002_pipeline_control.sql:14-15` (verbatim):

```sql
CREATE INDEX IF NOT EXISTS pipeline_control_status_idx
  ON pipeline_control_commands(status, created_at);
```

The index leads with `status`, which this query does not constrain. Reached from
`/api/v1/legislations/update/status` (`workers/case-api/cloudflare.js:1033`),
polled every 2 s by `frontend/src/hooks/use-legislations.ts` while an update
runs.

### `workers/__tests__/cloudflare-storage-contracts.test.js:22-38` (verbatim) — the fake D1

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

Two properties you must design your tests around:

1. A statement is pushed to `calls` **only when `.bind()` is called**. A
   `db.prepare(sql).first()` with no `.bind()` is invisible to `calls`. Note
   that `bindAll()` always calls `.bind()`, even with zero params.
2. `all()` and `first()` ignore the SQL — every statement on a binding returns
   the same `allRows` / `firstRow`. Build one binding per scenario.

### `workers/__tests__/cloudflare-storage-contracts.test.js:118-125` (verbatim) — the one assertion Step 7 must update

```js
    const ftsStatement = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("case_text_fts MATCH ?"));
    const metadataStatement = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("json_each(?)"));
    expect(ftsStatement.sql).not.toContain("drop table");
    expect(ftsStatement.params).toEqual(['"visa" AND "OR" AND "drop" AND "table"', 100, 0]);
    expect(metadataStatement.params).toContain("FCA");
    expect(metadataStatement.params).toContain(2025);
  });
```

`[..., 100, 0]` is `[matchString, CHUNK_PAGE, offset]`. After Step 7 there is no
`offset`, so this becomes `[..., 500]`.

### Repo conventions that apply here

- **Migrations are applied by Wrangler, not by a custom runner.** `wrangler.toml`
  lines 23/29/35 set `migrations_dir` to `migrations/d1/catalog`,
  `migrations/d1/account` and `migrations/d1/ops`. Files are named
  `NNNN_snake_case.sql` and applied in filename order. Nothing in `scripts/` or
  `tests/` parses these files, so adding one is inert until an operator runs
  `wrangler d1 migrations apply` — which is **not** part of this plan.
- **All D1 binding access stays inside `workers/storage/`.** A contract test at
  `workers/__tests__/cloudflare-storage-contracts.test.js:96-102` fails the
  build if `env.IMMI_CATALOG_DB` (or the other five bindings) is referenced from
  any Worker file outside `workers/storage/`. Do not move query code out of this
  module.
- **`bindAll(database, sql, params)`** (`workers/storage/cloudflare.js:54-62`) is
  the only sanctioned way to bind a variable-length parameter list; it throws a
  `StorageBoundaryError` above `D1_MAX_BOUND_PARAMETERS = 100`
  (`workers/storage/contracts.js:13`). Use `db.prepare(...).bind(...)` directly
  only for fixed-arity statements, as the existing code does.
- **`rows(result)`** (`workers/storage/cloudflare.js:46-48`) unwraps
  `result.results` and returns `[]` when it is absent. Always use it; never read
  `.results` directly.
- **Column names may be interpolated into SQL only from a frozen whitelist**
  defined in this module (see `COMPAT_SORT_COLUMNS` usage at line 500). Never
  interpolate a value that came from a request; those are always bound
  parameters.
- **Immutability**: this repo's style rules forbid mutating inputs. Build new
  arrays/objects (`[...ids]`, `{ ...row, related_score }`), never mutate a row
  returned from D1.
- **Commit convention** (from `git log`): `<type>: <description>` with type one
  of `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from history:
  `fix: install root node_modules in make install`. No AI attribution lines.

### By design — never "fix" these

- Placeholder resource IDs in the checked-in `wrangler.toml`.
- `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags defaulting to `"false"`.
- `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase.
- The "Performance Baseline (2026-05-05)" section of `CLAUDE.md` being
  historical (it describes the retired Hyperdrive stack).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | `Test Files 25 passed` / `Tests 345 passed` before your changes; `26 passed` / `≥353 passed` after Step 8 |
| One Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-query-shapes.test.js` | all pass |
| Worker tests via Make | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers` | same as above |
| Python lint (unaffected, run once at the end) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` | `All checks passed!` |
| Node syntax check of the edited module | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js` | exit 0, no output |
| SQL sanity check of a new migration | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 -c "import sqlite3,sys;c=sqlite3.connect(':memory:');c.executescript(open('migrations/d1/catalog/0001_catalog.sql').read());c.executescript(open('migrations/d1/catalog/0002_read_path_indexes.sql').read());print('ok')"` | prints `ok` |
| Drift/scope check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope paths listed |

Do **not** run `wrangler d1 migrations apply`, `wrangler deploy`, `git push`, or
open a PR. The operator does all of that.

## Scope

**In scope** (the only files you may create or modify):

- `migrations/d1/catalog/0002_read_path_indexes.sql` (create)
- `migrations/d1/ops/0003_read_path_indexes.sql` (create)
- `workers/storage/cloudflare.js` — only these regions:
  - a new module-level `compatTotal()` helper inserted after `compatCaseFilters`
    (which ends at line 176)
  - `COMPAT_SORT_COLUMNS` (lines 118–128) — add one key
  - `CloudflareCaseStore.listPage` (lines 482–511)
  - `CloudflareCaseStore.countCompat` (lines 526–531)
  - `CloudflareCaseStore.guidedPrecedents` (lines 829–865)
  - `CloudflareCaseStore.relatedCompat` (lines 1069–1097)
  - `CloudflareCaseStore.searchLexical` (lines 1099–1138)
- `workers/__tests__/cloudflare-storage-query-shapes.test.js` (create)
- `workers/__tests__/cloudflare-storage-contracts.test.js` — **one line only**:
  the `expect(ftsStatement.params).toEqual([...])` assertion at line 122.

**Out of scope** (do NOT touch, even though they look related):

- `LEGACY_CASE_PROJECTION` (`workers/storage/cloudflare.js:89-116`) — shared by
  eight call sites and by a separate in-flight plan that declares it out of
  scope. Step 6 changes which rows reach it, never the constant.
- `CloudflareCaseStore.exportCases` (`workers/storage/cloudflare.js:513-524`) —
  owned exclusively by `plans/007-harden-the-public-export-surface.md`, which is
  rewriting its `LIMIT`, its `SELECT` list and its tests. Editing it here
  guarantees a merge conflict. Its correlated-subquery cost is real; see
  "Findings reconsidered".
- `workers/case-api/cloudflare.js` — including adding a `Cache-Control` header
  to the `/api/v1/cases/:id/related` response at line 1121. It is a legitimate
  follow-up, but this plan owns the storage layer only and that file is being
  edited by another plan.
- Any file under `frontend/` — including making `DataToolsPage.tsx` share one
  query key between its two 2 s polls. Correct, but a frontend change.
- The whole-table aggregate inside `listRuns` (`workers/storage/cloudflare.js:1668-1680`)
  — splitting it out or maintaining it as a counter changes the
  `/api/v1/pipeline-status` and `/api/v1/job-status` payload contracts and the
  tests in `workers/__tests__/pipeline-status.test.js`. Deferred deliberately;
  Step 2 indexes the listing half, which is the part that grows unbounded.
- `wrangler.toml`, `scripts/check_cloudflare_native_target.py`,
  `scripts/check_immi_activation_evidence.py` — verified: none of them reads
  `migrations/d1/**`, so a new migration file needs no change there.
- Anything under `immi_case_downloader/`, `tests/`, or `workers/austlii-scraper/`.
- Applying the migrations to a real D1 database.

## Git workflow

- Branch: `advisor/013-fix-d1-query-shapes`
  (`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git checkout -b advisor/013-fix-d1-query-shapes`)
- Commit per step or per logical unit, e.g.:
  - `perf: index cases by year and case_nature for the listing and related reads`
  - `perf: read the unfiltered case total from catalog_summary`
  - `fix: accept sort_by=year on the case listing`
  - `perf: resolve related cases with three indexed lookups`
  - `perf: fetch lexical search candidates in one D1 round trip`
  - `test: cover the D1 read-path query shapes`
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits and deploys.

## Steps

### Step 1: Add the two missing `cases` indexes

Create `migrations/d1/catalog/0002_read_path_indexes.sql` with exactly this
content:

```sql
-- Read-path indexes for the case listing and the related-case lookup.
--
-- 0001_catalog.sql indexes `cases` by (court_code, year), (outcome,
-- visa_subclass, source, year), (visa_type, year) and (semantic_ready,
-- updated_at). None of those has `year` as a leading column, so the default
-- unfiltered listing -- ORDER BY c.year DESC, c.case_id ASC -- sorts the whole
-- corpus in a temp B-tree on every page. `case_nature` is not indexed at all,
-- which is why the related-case query cannot use SQLite's multi-index OR
-- optimisation and falls back to a full scan.
--
-- Column order matches the ORDER BY of the queries these serve so SQLite can
-- walk the index and stop at LIMIT instead of materialising a sorter.
CREATE INDEX IF NOT EXISTS cases_year_case_idx ON cases(year DESC, case_id ASC);
CREATE INDEX IF NOT EXISTS cases_nature_year_idx ON cases(case_nature, year DESC, case_id ASC);
```

Do not add indexes for the `title`, `citation` or `applicant_name` sorts in this
plan — see "Maintenance notes" for why that is deferred.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 -c "import sqlite3;c=sqlite3.connect(':memory:');c.executescript(open('migrations/d1/catalog/0001_catalog.sql').read());c.executescript(open('migrations/d1/catalog/0002_read_path_indexes.sql').read());print(sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cases' AND name NOT LIKE 'sqlite_%'\")))"
```
→ prints exactly:
`['cases_court_year_idx', 'cases_filter_idx', 'cases_nature_year_idx', 'cases_semantic_ready_idx', 'cases_visa_type_idx', 'cases_year_case_idx']`

### Step 2: Add the Ops-D1 read-path indexes and drop the unused one

First re-confirm that no query constrains `status` as a leading predicate on
`pipeline_control_commands`:

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "pipeline_control_commands" --include="*.js" --include="*.ts" --include="*.sql" . | grep -v node_modules
```

Expected: exactly six lines — the `CREATE TABLE`/`CREATE INDEX` pair in
`migrations/d1/ops/0002_pipeline_control.sql`, an `UPDATE ... WHERE command_id = ?`
in `workers/austlii-scraper/src/pipeline-db.ts`, and the `SELECT ... WHERE
action = ?` / `INSERT OR IGNORE` / `UPDATE ... WHERE command_id = ?` trio in
`workers/storage/cloudflare.js`. If any additional query filters on `status`
first, **stop** — see STOP conditions.

Then create `migrations/d1/ops/0003_read_path_indexes.sql` with exactly this
content:

```sql
-- Ops read-path indexes.
--
-- pipeline_runs is listed with ORDER BY started_at DESC LIMIT ? by the operator
-- dashboard, which polls every 2s while a run is active. The table has only a
-- PRIMARY KEY on run_id and no retention policy, so that listing degrades
-- linearly as runs accumulate.
CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx ON pipeline_runs(started_at DESC);

-- pipeline_control_commands is only ever read as
--   WHERE action = ? ORDER BY created_at DESC LIMIT 1
-- but 0002_pipeline_control.sql indexed it as (status, created_at). `status` is
-- never a leading predicate in any query (every write targets command_id, the
-- primary key), so that index can serve nothing and is replaced rather than
-- supplemented. Recreate it with
--   CREATE INDEX pipeline_control_status_idx ON pipeline_control_commands(status, created_at);
-- if a status-first query is ever introduced.
CREATE INDEX IF NOT EXISTS pipeline_control_action_idx
  ON pipeline_control_commands(action, created_at DESC);
DROP INDEX IF EXISTS pipeline_control_status_idx;
```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 -c "import sqlite3;c=sqlite3.connect(':memory:');[c.executescript(open(p).read()) for p in ['migrations/d1/ops/0001_ops.sql','migrations/d1/ops/0002_pipeline_control.sql','migrations/d1/ops/0003_read_path_indexes.sql']];print(sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'\")))"
```
→ prints exactly:
`['extraction_audit_run_case_idx', 'outbox_ready_idx', 'pipeline_control_action_idx', 'pipeline_runs_started_idx']`

(`pipeline_control_status_idx` must be absent — that is the DROP taking effect.)

### Step 3: Read the unfiltered case total from `catalog_summary`, and stop serialising the two listing queries

All edits in this step are in `workers/storage/cloudflare.js`.

**3a.** Insert this new module-level helper immediately after the closing brace
of `compatCaseFilters` (line 176) and before `function contentKeyFor(`:

```js
/**
 * Resolve the row count for a compat listing/count request.
 *
 * The unfiltered total is already maintained in `catalog_summary` by
 * rebuildAggregates(), so counting the ~149K-row `cases` table again on the
 * default request is pure waste. Falls back to COUNT(*) whenever a filter is
 * present, and also when the aggregate has never been built, so a freshly
 * seeded database still reports an accurate total instead of zero.
 */
async function compatTotal(database, clauses, params, where) {
  if (clauses.length === 0) {
    const summary = await database
      .prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'")
      .first();
    const cached = Number(summary?.value_int);
    if (Number.isFinite(cached) && cached > 0) return cached;
  }
  const counted = await bindAll(database, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
  return Number(counted?.total || 0);
}
```

**3b.** In `listPage`, replace lines 495–504 — that is, everything from
`const count = await bindAll(` down to and including `cases: rows(await statement.all()),`
— so the method body after `const where = ...` reads:

```js
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY ${column} ${direction.toUpperCase()}, c.case_id ASC
      LIMIT ? OFFSET ?
    `, [...params, checkedPageSize, (checkedPage - 1) * checkedPageSize]);
    const [pageResult, total] = await Promise.all([
      statement.all(),
      compatTotal(this.db, clauses, params, where),
    ]);
    return {
      cases: rows(pageResult),
      total,
      page: checkedPage,
      page_size: checkedPageSize,
      total_pages: Math.max(1, Math.ceil(total / checkedPageSize)),
      next_cursor: null,
    };
```

Leave the `column` / `direction` / `checkedPage` / `checkedPageSize` /
`clauses, params` / `where` lines above it untouched.

**3c.** Replace the body of `countCompat` (lines 526–531) with:

```js
  async countCompat(filters = {}) {
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return compatTotal(this.db, clauses, params, where);
  }
```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "async function compatTotal" workers/storage/cloudflare.js && grep -c "compatTotal(this.db, clauses, params, where)" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0 with no output; the first `grep -c` prints `1`; the
second prints `2`; vitest prints `Test Files 25 passed` and `Tests 345 passed`.

### Step 4: Accept `sort_by=year` on the case listing

In `workers/storage/cloudflare.js`, add one key to `COMPAT_SORT_COLUMNS` so it
reads:

```js
const COMPAT_SORT_COLUMNS = Object.freeze({
  date: "c.year",
  year: "c.year",
  title: "c.title",
  court: "c.court_code",
  outcome: "c.outcome",
  visa_subclass_number: "c.visa_subclass_number",
  applicant_name: "c.applicant_name",
  hearing_date: "c.hearing_date",
  case_id: "c.case_id",
  citation: "c.citation",
});
```

This is a bug fix, not one of the performance findings: the cases UI offers a
"Year" sort option that currently makes `/api/v1/cases` throw
`Invalid sort_by 'year'` and return HTTP 400. Mapping it to `c.year` — the same
column `date` already uses — makes it work and lets it use the new
`cases_year_case_idx` from Step 1. No frontend file changes.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && node -e "const s=require('fs').readFileSync('workers/storage/cloudflare.js','utf8');const m=s.match(/const COMPAT_SORT_COLUMNS = Object\.freeze\(\{[^}]*\}\)/)[0];console.log(m.includes('year: \"c.year\"') && m.includes('date: \"c.year\"') ? 'ok' : 'MISSING');"
```
→ prints `ok`.

### Step 5: Parallelise `guidedPrecedents` and give it the same count fallback

In `workers/storage/cloudflare.js`, replace lines 853–864 of `guidedPrecedents`
— from `const where = clauses.length ? ...` down to and including
`return { total, results };` — with:

```js
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const size = clampLimit(limit, { fallback: 50, max: 200 });
    const [total, found] = await Promise.all([
      compatTotal(this.db, clauses, params, where),
      bindAll(this.db, `
        SELECT ${LEGACY_CASE_PROJECTION}
        FROM cases c ${where}
        ORDER BY c.year DESC, c.case_id ASC
        LIMIT ?
      `, [...params, size]).all(),
    ]);
    return { total, results: rows(found) };
```

Nothing above `const where = ...` in that method changes. Note this both halves
the wall-clock latency of a guided search (the count and the page no longer run
back to back) and gives the previously-missing `catalog_summary` fallback when
the aggregate has not been built.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "compatTotal(this.db, clauses, params, where)" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0; `grep -c` prints `3`; vitest prints
`Test Files 25 passed` and `Tests 345 passed`.

### Step 6: Resolve related cases with three indexed lookups instead of one full scan

In `workers/storage/cloudflare.js`, replace the whole of `relatedCompat`
(lines 1069–1097, quoted verbatim in "Current state") with:

```js
  async relatedCompat(caseId, { limit = 5 } = {}) {
    const id = assertCaseId(caseId);
    const size = compatPageNumber(limit, 5, 1, 20);
    const anchor = await this.db.prepare(`
      SELECT case_nature, visa_type, court_code FROM cases WHERE case_id = ?
    `).bind(id).first();
    if (!anchor) return null;
    // One OR across three different columns cannot use an index, so the previous
    // single query scanned the whole corpus and evaluated the full projection --
    // including its two correlated subqueries -- for every candidate before the
    // sorter applied LIMIT. Score each dimension with its own indexed range scan
    // instead (cases_nature_year_idx / cases_visa_type_idx / cases_court_year_idx),
    // merge in JS, and hydrate only the winners.
    const dimensions = [
      ["case_nature", anchor.case_nature, 4],
      ["visa_type", anchor.visa_type, 2],
      ["court_code", anchor.court_code, 1],
    ].filter(([, value]) => typeof value === "string" && value !== "");
    if (dimensions.length === 0) return [];
    const candidatePages = await Promise.all(dimensions.map(([column, value]) => bindAll(this.db, `
      SELECT case_id, year FROM cases
      WHERE ${column} = ? AND case_id <> ?
      ORDER BY year DESC, case_id ASC
      LIMIT ?
    `, [value, id, RELATED_CANDIDATES_PER_DIMENSION]).all()));
    const scored = new Map();
    dimensions.forEach(([, , weight], index) => {
      for (const row of rows(candidatePages[index])) {
        const previous = scored.get(row.case_id);
        scored.set(row.case_id, {
          score: (previous?.score || 0) + weight,
          year: previous?.year ?? (Number.isFinite(Number(row.year)) ? Number(row.year) : -1),
        });
      }
    });
    const ordered = [...scored.entries()]
      .sort(([leftId, left], [rightId, right]) =>
        right.score - left.score || right.year - left.year || leftId.localeCompare(rightId))
      .slice(0, size);
    const scoreById = new Map(ordered.map(([candidateId, entry]) => [candidateId, entry.score]));
    const hydrated = await this.findByIds(ordered.map(([candidateId]) => candidateId));
    return hydrated.map((row) => ({ ...row, related_score: scoreById.get(row.case_id) || 0 }));
  }
```

The `${column}` interpolation is safe: it comes from the frozen three-element
literal array immediately above, never from a request. The anchor values stay
bound parameters.

Also add this constant next to `COMPAT_SORT_COLUMNS` (i.e. immediately after the
closing `});` of `COMPAT_SORT_COLUMNS` at line 128):

```js
/**
 * Candidates read per related-case dimension. Three indexed range scans of 200
 * narrow rows replace one full scan of ~149K fully-projected rows; the endpoint
 * returns at most 20 links, so the recall window is generous.
 */
const RELATED_CANDIDATES_PER_DIMENSION = 200;
```

Contract preserved: `null` when the anchor does not exist, otherwise an array of
rows each with a `related_score` property, hydrated through `findByIds` so the
column set is byte-identical to `LEGACY_CASE_PROJECTION`. The one intentional
behaviour change — an old case that matches all three dimensions but falls
outside the 200 most-recent rows of every dimension is no longer reachable — is
documented in "Maintenance notes".

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "RELATED_CANDIDATES_PER_DIMENSION" workers/storage/cloudflare.js && grep -c "related_score" workers/storage/cloudflare.js && grep -c "SELECT case_id, year FROM cases" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0; the first `grep -c` prints `2` (the declaration and
its one use); the second prints `1` (down from `2` at baseline — the computed
`related_score` SQL expression is gone, only the JS property assignment
remains); the third prints `1`; vitest prints `Test Files 25 passed` and
`Tests 345 passed`.

### Step 7: Fetch lexical search candidates in one D1 round trip

**7a.** In `workers/storage/cloudflare.js`, replace lines 1103–1123 of
`searchLexical` — from the `// bm25() is valid only ...` comment through the
closing brace of the `for` loop — with:

```js
    // bm25() is valid only in the direct FTS query context, and a single long
    // case can monopolise the top chunk ranks, so read one wide page of chunk
    // candidates and reduce to the best chunk rank per case in JS. This is the
    // same 500-row candidate ceiling the previous five sequential LIMIT/OFFSET
    // pages had, in one round trip instead of up to five.
    const hits = rows(await this.db.prepare(`
      SELECT case_id, bm25(case_text_fts) AS rank
      FROM case_text_fts
      WHERE case_text_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).bind(matchString, FTS_CANDIDATE_CHUNKS).all());
    const ranks = new Map();
    for (const hit of hits) {
      const rank = Number(hit.rank);
      if (!ranks.has(hit.case_id) || rank < ranks.get(hit.case_id)) ranks.set(hit.case_id, rank);
    }
```

Everything from `const caseIds = [...ranks.keys()];` onward stays exactly as it
is. In particular **do not** slice `caseIds` down to `size` — the hydration query
applies the caller's filters, so trimming the candidate list first would lose
recall on filtered searches.

**7b.** Add this constant immediately after `RELATED_CANDIDATES_PER_DIMENSION`
from Step 6:

```js
/** Chunk candidates read per lexical search before reducing to best-rank-per-case. */
const FTS_CANDIDATE_CHUNKS = 500;
```

**7c.** In `workers/__tests__/cloudflare-storage-contracts.test.js`, change the
single assertion on line 122 from:

```js
    expect(ftsStatement.params).toEqual(['"visa" AND "OR" AND "drop" AND "table"', 100, 0]);
```

to:

```js
    expect(ftsStatement.params).toEqual(['"visa" AND "OR" AND "drop" AND "table"', 500]);
```

Change nothing else in that file.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "OFFSET ?" workers/storage/cloudflare.js && grep -c "MAX_PAGES\|CHUNK_PAGE" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0; the first `grep -c` prints `1` (only `listPage` still
uses OFFSET); the second prints `0`; vitest prints `Test Files 25 passed` and
`Tests 345 passed`.

### Step 8: Add a test file that pins the new query shapes

Create `workers/__tests__/cloudflare-storage-query-shapes.test.js`. Model it on
`workers/__tests__/cloudflare-storage-contracts.test.js` — same imports, same
fake-D1 helper, same `createCloudflareStores(env)` construction. Remember the
two fake-D1 properties from "Current state": a statement only lands in `calls`
when `.bind()` is called, and `all()`/`first()` ignore the SQL.

Write exactly these eight tests:

1. **`listPage` with no filters does not COUNT the corpus.** Build a catalog
   binding with `firstRow: { value_int: 149016 }` and `allRows: [{ case_id: "0123456789ab" }]`.
   Call `caseStore.listPage({})`. Assert the returned `total` is `149016` and
   that `calls.every((s) => !s.sql.includes("COUNT(*)"))` is true.
2. **`listPage` falls back to COUNT when the aggregate row is missing.** Same
   binding but `firstRow: { total: 7 }` (no `value_int`). Assert `total` is `7`
   and that some statement in `calls` includes `COUNT(*) AS total`.
3. **`listPage` with a filter always counts.** `firstRow: { total: 3 }`,
   call `listPage({ filters: { court: "FCA" } })`. Assert `total` is `3` and the
   `COUNT(*)` statement's `params` contains `"FCA"`.
4. **`listPage` accepts `sort_by=year`.** Call
   `listPage({ sortBy: "year", sortDir: "asc" })` and assert it does not throw
   and that the page statement's SQL contains `ORDER BY c.year ASC`.
   Additionally assert `listPage({ sortBy: "nonsense" })` still rejects with a
   message matching `/Invalid sort_by/`.
5. **`countCompat` reuses the aggregate.** `firstRow: { value_int: 149016 }`,
   call `countCompat({})`, assert it returns `149016` and no `COUNT(*)`
   statement was bound.
6. **`relatedCompat` issues one narrow lookup per non-empty dimension.**
   `firstRow: { case_nature: "protection", visa_type: "", court_code: "AATA" }`,
   `allRows: [{ case_id: "0123456789ab", year: 2026 }]`. Call
   `relatedCompat("0123456789ab")`. Assert that the statements whose SQL
   contains `SELECT case_id, year FROM cases` number exactly **2** (the empty
   `visa_type` dimension is skipped), that none of the bound statements' SQL
   contains `related_score`, and that the returned rows each carry a numeric
   `related_score`.
7. **`relatedCompat` returns `null` for an unknown anchor.** Binding with
   `firstRow: null`; assert the result is exactly `null`.
8. **`searchLexical` makes exactly one FTS query.** Reuse the `env()` shape from
   the contracts test (catalog `allRows: [{ case_id: "0123456789ab", rank: -1.1 }]`).
   Call `searchLexical({ query: "visa", limit: 100 })` and assert that
   `calls.filter((s) => s.sql.includes("case_text_fts MATCH ?"))` has length
   `1`, and that its `params` equals `['"visa"', 500]`.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-query-shapes.test.js 2>&1 | tail -4
```
→ `Test Files 1 passed` and `Tests 8 passed`.

### Step 9: Full-suite verification and scope check

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers 2>&1 | tail -4 && make lint && git status --short
```
→ vitest prints `Test Files 26 passed (26)` and `Tests 353 passed (353)`;
`make lint` prints `All checks passed!`; `git status --short` lists **only**:

```
 M workers/__tests__/cloudflare-storage-contracts.test.js
 M workers/storage/cloudflare.js
?? migrations/d1/catalog/0002_read_path_indexes.sql
?? migrations/d1/ops/0003_read_path_indexes.sql
?? workers/__tests__/cloudflare-storage-query-shapes.test.js
```

(Plus `plans/013-fix-d1-query-shapes.md` and `plans/README.md` if you updated the
index. Nothing else.)

## Test plan

- **New file** `workers/__tests__/cloudflare-storage-query-shapes.test.js`, 8
  tests, listed one by one in Step 8. They cover: the `catalog_summary`
  short-circuit (happy path), its fallback when the aggregate is missing
  (the regression this plan could otherwise introduce on a fresh database), the
  filtered path still counting exactly, the `sort_by=year` fix plus its
  still-rejecting invalid sibling, the per-dimension related-case lookups
  including the skip-empty-dimension edge case, the `null` anchor case, and the
  single-round-trip lexical search.
- **Structural pattern to copy**: `workers/__tests__/cloudflare-storage-contracts.test.js`
  — its `d1()` fake, its `env()` builder, and its style of asserting on
  `binding.calls[].sql` / `.params`.
- **Existing test updated**: one assertion at
  `workers/__tests__/cloudflare-storage-contracts.test.js:122` (Step 7c). That is
  the only pre-existing test this plan's changes invalidate; every other
  affected test mocks the store rather than the SQL, so it is unaffected.
- **Verification**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers`
  → `Test Files 26 passed`, `Tests 353 passed` (345 at baseline + 8 new).
- **Not run here**: `make test-py` and `make test-fe`. This plan touches no
  Python and no frontend file. For reference, `make test-py` at `42826a3` reports
  3 pre-existing failures caused by a Homebrew Python 3.14 `pyexpat`/`libexpat`
  ABI mismatch breaking a `pypdf` import — an environment problem, unrelated to
  this plan, and not yours to fix.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f migrations/d1/catalog/0002_read_path_indexes.sql` succeeds
- [ ] `test -f migrations/d1/ops/0003_read_path_indexes.sql` succeeds
- [ ] The Step 1 verify command prints the six-element index list including
      `cases_year_case_idx` and `cases_nature_year_idx`
- [ ] The Step 2 verify command prints the four-element index list including
      `pipeline_runs_started_idx` and `pipeline_control_action_idx`, and
      **excluding** `pipeline_control_status_idx`
- [ ] `node --check workers/storage/cloudflare.js` exits 0
- [ ] `grep -c "async function compatTotal" workers/storage/cloudflare.js` prints `1`
- [ ] `grep -c "compatTotal(this.db, clauses, params, where)" workers/storage/cloudflare.js` prints `3`
- [ ] `grep -c "MAX_PAGES\|CHUNK_PAGE" workers/storage/cloudflare.js` prints `0`
- [ ] `grep -c "OFFSET ?" workers/storage/cloudflare.js` prints `1`
- [ ] `grep -c 'year: "c.year"' workers/storage/cloudflare.js` prints `1`
- [ ] The shared projection constant is byte-identical to `42826a3` — this
      prints `PROJ IDENTICAL`:
      ```
      cd "/Users/d/Developer/Active Projects/IMMI-Case-" && diff <(git show 42826a3:workers/storage/cloudflare.js | sed -n '/^const LEGACY_CASE_PROJECTION/,/^`;$/p') <(sed -n '/^const LEGACY_CASE_PROJECTION/,/^`;$/p' workers/storage/cloudflare.js) && echo "PROJ IDENTICAL"
      ```
- [ ] `exportCases` is byte-identical to `42826a3` (it belongs to another plan)
      — this prints `EXPORT IDENTICAL`:
      ```
      cd "/Users/d/Developer/Active Projects/IMMI-Case-" && diff <(git show 42826a3:workers/storage/cloudflare.js | sed -n '/  async exportCases/,/^  }$/p') <(sed -n '/  async exportCases/,/^  }$/p' workers/storage/cloudflare.js) && echo "EXPORT IDENTICAL"
      ```
- [ ] `cd workers && npx vitest run` prints `Test Files 26 passed` and `Tests 353 passed`
- [ ] `make lint` prints `All checks passed!`
- [ ] `git status --short` lists only the five in-scope paths (plus the plan files)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file shows any in-scope file changed since
  `42826a3`, and the "Current state" excerpts no longer match the live code.
- The Step 2 grep finds a query on `pipeline_control_commands` that constrains
  `status` as a **leading** predicate. That would make the `DROP INDEX
  pipeline_control_status_idx` a regression — report it and omit only the DROP
  line, keeping the rest of the migration.
- `LEGACY_CASE_PROJECTION` or `CloudflareCaseStore.exportCases` in
  `workers/storage/cloudflare.js` already differs from the excerpts in "Current
  state". Another plan owns those; a difference means it landed first and you
  must re-read before editing anything nearby.
- After Step 6, `workers/__tests__/case-api-cloudflare.test.js` fails. That test
  mocks `relatedCompat` entirely, so it should be immune; a failure means the
  method's return contract changed in a way this plan did not intend.
- `bindAll` throws `d1_parameter_limit` from any query you wrote. Every new
  statement in this plan binds at most three parameters, so this would mean a
  loop is binding per-candidate parameters instead of using `json_each`.
- The Step 8 test asserting `calls.every((s) => !s.sql.includes("COUNT(*)"))`
  cannot be made to pass. Re-read the fake-D1 note in "Current state": a
  `prepare(...).first()` without `.bind()` never reaches `calls`, so the
  `catalog_summary` read is invisible there by design — assert on the returned
  `total` for the positive case, not on `calls`.
- Any verification fails twice after a reasonable fix attempt.
- The fix appears to require touching a file in the "Out of scope" list.

## Maintenance notes

For the human or agent who owns this code after the change lands:

- **The migrations are inert until an operator applies them.** Nothing in CI or
  the test suite reads `migrations/d1/**`. The operator must run
  `wrangler d1 migrations apply` against each of the three D1 databases. Until
  then the code changes are still correct — they are all either fewer queries or
  narrower queries — but the index-dependent wins (Steps 1, 2, 6) will not show
  up in production latency.
- **`listPage`'s `total` is now eventually consistent on the unfiltered
  request.** It reads `catalog_summary.total_cases`, which `rebuildAggregates()`
  refreshes from the mutation queue. Between a case ingest and the next aggregate
  rebuild, the listing's `total` and `total_pages` can lag by the number of newly
  ingested cases. `guidedPrecedents` has behaved this way since before this plan;
  Step 3 makes the trade-off consistent across the three count paths and adds the
  missing "aggregate never built" fallback. If exact live counts ever become a
  requirement for `/api/v1/cases`, the change to revert is `compatTotal`'s first
  branch — not the indexes.
- **`relatedCompat`'s recall window is now bounded.** It considers the 200
  most-recent cases per matching dimension rather than the entire corpus. A case
  matching all three dimensions but older than the 200th most recent case in
  every one of them will no longer appear. Raising
  `RELATED_CANDIDATES_PER_DIMENSION` widens the window linearly and cheaply
  (each candidate row is two columns from an index). Watch for user reports of
  "an obviously related old case disappeared".
- **`searchLexical` recall went up, not down.** The old loop usually exited after
  the first 100 chunks; it now always considers 500. Filtered lexical searches
  in particular should return more results than before. If a test elsewhere
  asserted on an exact result count from a filtered lexical search, that is why.
- **Deliberately deferred, with reasons** (do not treat these as oversights):
  - Indexes for the `title`, `citation`, `applicant_name`, `outcome` and
    `hearing_date` sort columns. Each costs write amplification on every case
    upsert across a 149K-row table, and nothing measures how often those sorts
    are actually requested — only `date`, `year`, `title` and `court` are even
    reachable from the UI. Add `cases_title_idx ON cases(title, case_id)` first
    if a title-sort complaint ever arrives.
    `court` already partially benefits from `cases_court_year_idx`.
  - Splitting the whole-table aggregate out of `listRuns`, and sharing one
    TanStack Query key between `DataToolsPage`'s two 2 s polls. Both are real
    wins; both change contracts (API payload / frontend state) outside this
    plan's file territory.
  - A `Cache-Control` header on `/api/v1/cases/:id/related`. That response is
    now cheap enough to serve uncached, but a `public, max-age=…` would still
    help; it lives in `workers/case-api/cloudflare.js`, owned elsewhere.
  - Everything under "Findings reconsidered" below.
- **What a reviewer should scrutinise**: (1) that `LEGACY_CASE_PROJECTION` and
  `exportCases` are byte-identical to `42826a3`; (2) that the `${column}`
  interpolation in the new `relatedCompat` can only ever receive one of the three
  hard-coded column names; (3) that `compatTotal`'s fallback really does fire
  when `catalog_summary` is empty — that is the one path that could silently
  report `total: 0` on a fresh database if it were wrong.

## Findings reconsidered

Items from the audit that this plan corrects, narrows, or deliberately does not
act on. Nothing here is silently dropped.

- **PERF-03 (correlated subqueries in `LEGACY_CASE_PROJECTION`) — half fixed,
  half handed off.** Verified: the two `group_concat` subqueries at
  `workers/storage/cloudflare.js:98` and `:107` are real, and all eight call
  sites named in the audit exist verbatim. But `case_judges` and `case_concepts`
  declare `PRIMARY KEY (case_id, judge_id)` and `PRIMARY KEY (case_id, concept_id)`
  (`migrations/d1/catalog/0001_catalog.sql:101` and `:114`), so each lookup is a
  primary-key probe, not a scan — the page-listing path is not a problem and this
  is not an N+1. Only two call sites carry a large multiplier. `relatedCompat`
  (line 1077) is fixed by Step 6, which stops evaluating the projection across the
  whole candidate set. `exportCases` (line 518, up to 50,000 rows) is **not**
  touched here: `plans/007-harden-the-public-export-surface.md` declares that
  method and `LEGACY_CASE_PROJECTION` its exclusive territory and is already
  rewriting both its `LIMIT` and its `SELECT` list. Editing it here would
  guarantee a merge conflict for no benefit, and plan 007's row-cap reduction
  shrinks the multiplier anyway.
- **PERF-08 (`instr()` / leading-wildcard `LIKE`) — scope corrected, judge half
  rejected, `cases` half deferred.** All four cited locations verified exactly
  (`:172` keyword `LIKE`, `:166` tag `instr`, `:726` judge `instr`,
  `guidedPrecedents` `instr` at `:836`/`:841`).
  - *Rejected*: the claim that judge autocomplete "scans one of the two largest
    tables end to end". `autocompleteJudges` (`:602`) and `guidedJudge` (`:872`)
    query `aggregate_judge`, and `getJudgeCases` (`:726`) / `findJudgeBio`
    (`:458`) query `judges` — both are one row per judge, roughly 15,000 rows,
    not the 149,000-row `cases` table. A full scan of a 15K-row two-column table
    is not a latency problem worth an FTS5 table plus triggers plus a backfill,
    and substring-matching a name the user is halfway through typing genuinely
    needs `instr()` semantics (`"Smith"` must match `"Justice Smith"`, which a
    prefix-anchored, index-usable `LIKE 'x%'` would miss). No work planned.
  - *Partially addressed*: `guidedPrecedents`' `instr()` predicates do scan
    `cases`, and the audit correctly noted the `COUNT(*)` at `:855` runs the same
    predicate a second time. Step 5 makes those two queries run in parallel and
    gives the count a `catalog_summary` fast path when unfiltered — a real,
    zero-risk latency halving. Replacing `instr()` with equality on
    `visa_subclass` / `country_of_origin` is **not** done: it would silently
    change matching semantics on columns whose data quality is documented as
    messy in `CLAUDE.md`, turning a slow-but-correct search into a fast one that
    quietly returns fewer results. That needs a data audit first, not a query
    rewrite.
  - *Deferred with reason*: the `tag` filter (`:166`) matches inside a
    delimited string column and cannot be indexed without a normalised
    `case_tags` table plus a backfill and a `rebuildAggregates()` change. The
    `keyword` filter (`:172`) is a leading-wildcard `LIKE`, which no index can
    ever serve; the only fix is a new FTS5 index over `title` + `citation`
    (`case_text_fts` indexes chunk *content*, not titles), and that changes
    substring matching into token matching — `"smit"` would stop matching
    `"Smith"`. Both are genuine follow-ups, both are larger and riskier than
    everything else in this plan, and neither belongs in a change whose other
    steps are provably behaviour-preserving.
- **PERF-09 evidence corrected (one-line offset).** The audit cited
  `workers/storage/cloudflare.js:1082` as the three-way `OR`. Line 1082 is
  actually `WHERE c.case_id <> ?`; the `OR` is on line 1083. The substance is
  unaffected and Step 6 fixes it. Worth recording that the deeper reason the
  query cannot use an index is not merely that "no single index satisfies it" —
  SQLite could union three separate indexes — but that `case_nature` has no index
  at all, which is why Step 1 adds `cases_nature_year_idx`.
- **PERF-11 severity corrected.** The five-page loop is real and Step 7 collapses
  it, but the audit's council-outage framing overstates it: `retrieval.js:19`
  sets `RETRIEVAL_RECALL = 20`, so the loop exits after page 1 whenever the first
  100 chunks yield 20 distinct `case_id`s — the common case. Five pages only
  happens when a few long cases monopolise the chunk ranking. The 2 s
  `withTimeout` at `retrieval.js:159` and the silent `state: "timeout"` return at
  `:193-205` are both verified real, but that is a tail scenario, not the norm.
  The single-round-trip fix is still correct and cheap.
- **PERF-12 partially addressed.** The two queries at
  `workers/storage/cloudflare.js:1661` and `:1668` were verified, as was the
  absence of any index on `pipeline_runs.started_at`. Step 2 indexes the listing
  query — the half that grows unbounded, since `pipeline_runs` gains a row per
  run with no retention policy. The whole-table aggregate is left alone on
  purpose (see "Out of scope"), as is the duplicate frontend polling. Two
  corrections to the finding's framing: the aggregate has ten columns, not nine;
  and the 2 s poll interval applies only while a run is active — it drops to
  15000 ms otherwise (`frontend/src/pages/DataToolsPage.tsx:88` and `:95`).
- **PERF-16 confirmed and acted on, with the audit's own suggested check
  performed.** `latestControlCommand`'s `WHERE action = ?` is on line 1692, not
  1690 as cited (1690 is the column list). The audit asked whether any query uses
  a leading `status` predicate before adding a second index; it does not — every
  other statement against `pipeline_control_commands` targets `command_id`, the
  primary key (verified across `workers/storage/cloudflare.js:1706`, `:1723-1730`
  and `workers/austlii-scraper/src/pipeline-db.ts:117-127`). So Step 2 replaces
  `pipeline_control_status_idx` rather than supplementing it, and Step 2's first
  command makes the executor re-confirm this before the DROP.
- **New bug found while verifying, fixed in Step 4** (not from the audit): the
  cases UI offers a "Year" sort option
  (`frontend/src/components/cases/CasesFilters.tsx:145`) but `COMPAT_SORT_COLUMNS`
  (`workers/storage/cloudflare.js:118-128`) has no `year` key, so
  `/api/v1/cases?sort_by=year` throws `Invalid sort_by 'year'` and returns HTTP
  400. Fixed with a one-line whitelist addition inside this plan's own file
  territory; no frontend change required.
