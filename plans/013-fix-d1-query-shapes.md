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
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff sees
> only what is committed, so on a dirty tree it gives a false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="migrations/d1 workers/storage/cloudflare.js workers/__tests__/cloudflare-storage-contracts.test.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> **This plan runs third in its lane** (see "Integration order" below), so
> `git diff --stat 42826a3..HEAD` is *expected* to list
> `workers/storage/cloudflare.js` — plans 009 and 010 landed before you. That is
> not drift. What you must do instead: re-read every verbatim excerpt in
> "Current state" against the live file and **re-derive every line number in this
> plan**; a mismatch in the specific excerpts is a STOP condition. Anything
> appearing in the **unstaged** or **staged** diffs is a STOP condition
> regardless. Never run `git checkout --` or `git clean` to tidy the tree — the
> operator may have work in progress.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/009-*.md` and `plans/010-*.md` — file-ordering, not
  functional. Both rewrite regions of `workers/storage/cloudflare.js` (009:
  `rebuildAggregates`, `updateCaseFields`, `putImportedCase`; 010: the analytics
  query block), and every line number below was taken at `42826a3`. Rebase on
  010's HEAD and re-derive them.
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

This plan touches only SQL migration files, one Worker JavaScript module and two
Worker test files. It runs no frontend TypeScript compile and no Python test, so
the verification-gate plans that fix those toolchains are not prerequisites. The
only gate it relies on is `make test-workers`, green at `42826a3`.

### Integration order

```
009  →  010  →  013 (this plan)  →  014  →  012
```

Five plans edit `workers/storage/cloudflare.js` and/or
`workers/case-api/cloudflare.js`; integrate serially in that order, each rebased
on the previous one's HEAD. `plans/011-*.md` is independent and runs in parallel
— note it adds a query against `pipeline_control_commands`, which is why Step 2
below checks *predicates* rather than counting grep lines.

**Downstream consumer**: `plans/014-*.md` needs an index this plan owns.
Step 2 adds `aggregate_judge_outcome(court_code, judge_id)` for it, so 014 does
not have to create a competing migration file. Do not drop that index because
nothing in *this* plan's queries uses it.

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

**Record your baseline first (Step 0).** Two plans land before this one and two
after, all adding tests to the same suite, so no absolute total is valid:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_WORKER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_WORKER=$BEFORE_WORKER"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short > /tmp/immi-013-dirty-before.txt
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | zero failures; total equals `BEFORE_WORKER` mid-plan and `BEFORE_WORKER + 10` after Step 8 |
| One Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-query-shapes.test.js` | `Tests 10 passed (10)` |
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
- `migrations/d1/catalog/0003_rollback_read_path_indexes.sql.disabled` (create,
  Step 9a — staged rollback text, not applied by Wrangler)
- `migrations/d1/ops/0004_rollback_read_path_indexes.sql.disabled` (create,
  Step 9a)
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
  **This is a real, unfixed defect, not a non-issue**: the aggregate has no
  `WHERE` and no `LIMIT`, so it full-scans `pipeline_runs` on every poll — and
  the operator dashboard polls it every 2 s while a run is active
  (`frontend/src/pages/DataToolsPage.tsx:88`, `:95`). `pipeline_runs` has no
  retention policy, so the cost grows without bound. Step 2's index does nothing
  for it. Closing it properly needs a summary/counter table maintained on write,
  a retention policy for `pipeline_runs`, the payload-contract change, and a
  rollback path — i.e. its own plan. The note here is a description of the gap,
  not an executable recipe; someone must write that plan.
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

-- aggregate_judge_outcome's primary key is (judge_id, court_code, outcome), so
-- court_code is not an index prefix and the judge-leaderboard's court filter
-- scans the whole table. plans/014-*.md pushes that filter into SQL and needs
-- this index to make it a range scan rather than a scan-with-a-WHERE. It is
-- declared here, in the single catalog read-path migration, so 014 does not have
-- to create a competing migration file touching the same tables. Do NOT drop it
-- because no query in plan 013 itself uses it.
CREATE INDEX IF NOT EXISTS aggregate_judge_outcome_court_idx
  ON aggregate_judge_outcome(court_code, judge_id);
```

Do not add indexes for the `title`, `citation` or `applicant_name` sorts in this
plan — see "Maintenance notes" for why that is deferred.

**Verify** (identity, not count — the question is *which* indexes exist):
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 -c "import sqlite3;c=sqlite3.connect(':memory:');c.executescript(open('migrations/d1/catalog/0001_catalog.sql').read());c.executescript(open('migrations/d1/catalog/0002_read_path_indexes.sql').read());print(sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cases' AND name NOT LIKE 'sqlite_%'\")));print(sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='aggregate_judge_outcome' AND name NOT LIKE 'sqlite_%'\")))"
```
→ prints exactly, on two lines:
`['cases_court_year_idx', 'cases_filter_idx', 'cases_nature_year_idx', 'cases_semantic_ready_idx', 'cases_visa_type_idx', 'cases_year_case_idx']`
then
`['aggregate_judge_outcome_court_idx']`

Then confirm the new `cases` indexes are actually *usable* by the queries they
exist for — a `CREATE INDEX` that the planner ignores is worthless, and no test
in this repo would notice:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 - <<'PY'
import sqlite3
c = sqlite3.connect(":memory:")
c.executescript(open("migrations/d1/catalog/0001_catalog.sql").read())
c.executescript(open("migrations/d1/catalog/0002_read_path_indexes.sql").read())
for sql in [
    "SELECT case_id FROM cases ORDER BY year DESC, case_id ASC LIMIT 100",
    "SELECT case_id, year FROM cases WHERE case_nature = 'protection' AND case_id <> 'x' ORDER BY year DESC, case_id ASC LIMIT 200",
    "SELECT judge_id FROM aggregate_judge_outcome WHERE court_code = 'FCA'",
]:
    print(sql[:48], "=>", [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql)])
PY
```
→ every line must mention `USING INDEX` (or `USING COVERING INDEX`) and **must
not** say `SCAN cases` / `SCAN aggregate_judge_outcome` without an index. Record
the output in your report; it is the only evidence in this plan that the
migrations do anything. An empty table can still show the intended plan, so this
is a plan-shape check, not a latency measurement — see "Maintenance notes" for
the benchmark that is genuinely outstanding.

### Step 2: Add the Ops-D1 read-path indexes and drop the unused one

First re-confirm that no query constrains `status` as a **leading predicate** on
`pipeline_control_commands`. That is the only thing that would make dropping
`pipeline_control_status_idx` a regression.

**Do not check this by counting grep lines.** An earlier draft of this plan
expected "exactly six lines", which is not a property of the thing being tested:
`plans/011-*.md` legitimately adds a seventh (a
`SELECT status, run_id ... WHERE command_id = ?` read helper in
`workers/austlii-scraper/src/pipeline-db.ts`) that goes through the primary key
and does not need the status index at all. A line count would fail on a
perfectly safe change and pass on an unsafe one that happened to replace a line.

Enumerate the statements and read each one's `WHERE`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -rn -B2 -A4 "pipeline_control_commands" --include="*.js" --include="*.ts" --include="*.sql" . | grep -v node_modules
```

For **every** statement in that output, classify its leading predicate. The
migration's `CREATE TABLE` / `CREATE INDEX` are not queries. At the time of
writing, every actual query is one of:

- `... WHERE command_id = ?` — primary key, index-irrelevant.
- `INSERT ... ` / `INSERT OR IGNORE ...` — no predicate.
- `SELECT ... WHERE action = ? ORDER BY created_at DESC LIMIT 1` — the one this
  step's new index serves.

**Proceed only if every query you find falls into one of those three shapes.**
If any statement has `WHERE status = ?` (or `status IN (...)`) as its first
predicate, **stop** and omit only the `DROP INDEX` line — see STOP conditions.

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

### Step 3: Stop serialising the two listing queries (and do NOT weaken `/api/v1/cases`' count contract)

All edits in this step are in `workers/storage/cloudflare.js`.

**Read this before writing any code.** An earlier draft of this step routed
`listPage` and `countCompat` through the `catalog_summary` fast path as well.
That is a silent API-contract break: both endpoints stamp their responses
`count_mode: "exact"` — `workers/case-api/cloudflare.js:1101` for
`/api/v1/cases` and `:1105` for `/api/v1/cases/count` — and
`catalog_summary.total_cases` is a queue-maintained aggregate that lags every
case ingest until the next `rebuildAggregates()` completes, and can be stale for
longer if a rebuild is retrying. `total` and `total_pages` would then be wrong
while the response still claimed to be exact, and the pagination UI would show a
page count that does not match the rows available.

The aggregate fast path is therefore applied **only** where the endpoint already
has eventual-consistency semantics (`guidedPrecedents`, Step 5, which has read
`catalog_summary` since before this plan). `listPage` and `countCompat` keep an
exact `COUNT(*)`. The latency win for `/api/v1/cases` comes from the
parallelisation below plus `cases_year_case_idx` from Step 1, both of which are
free of contract change.

Making `/api/v1/cases` eventually-consistent may still be the right trade later,
but it is an API-contract decision that must ship *with* the contract change —
`count_mode: "aggregate"` plus an `as_of` timestamp, the frontend updated to
render it, and the tests updated. `workers/case-api/cloudflare.js` is owned by
other plans in this wave, so that cannot happen here. It is recorded in
"Maintenance notes".

**3a.** Insert this new module-level helper immediately after the closing brace
of `compatCaseFilters` (line 176) and before `function contentKeyFor(`:

```js
/**
 * Resolve the row count for a compat listing/count request.
 *
 * `allowAggregate` opts into the queue-maintained `catalog_summary.total_cases`
 * row for the unfiltered case, which avoids counting the ~149K-row `cases`
 * table. It is OFF by default and must stay off for any caller whose response
 * declares `count_mode: "exact"` (/api/v1/cases and /api/v1/cases/count both
 * do): the aggregate lags case ingests until the next rebuildAggregates().
 * Only guidedPrecedents opts in, because it has read that row since before this
 * change.
 *
 * Even when opted in, falls back to COUNT(*) whenever a filter is present, and
 * when the aggregate has never been built, so a freshly seeded database reports
 * an accurate total instead of zero.
 */
async function compatTotal(database, clauses, params, where, { allowAggregate = false } = {}) {
  if (allowAggregate && clauses.length === 0) {
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
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "async function compatTotal" workers/storage/cloudflare.js && grep -c "compatTotal(this.db, clauses, params, where)" workers/storage/cloudflare.js && grep -c "allowAggregate: true" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0 with no output; the first `grep -c` prints `1`; the
second prints `2` (`listPage` and `countCompat`, both exact); the third prints
`0` for now and becomes `1` after Step 5 (`guidedPrecedents` is the only opt-in);
vitest reports zero failures with a total equal to `BEFORE_WORKER`.
(`node --check` is a parse check only — it cannot tell a correct helper from a
wrong one. Step 8's tests are what pin the behaviour.)

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
      // The only opt-in to the queue-maintained aggregate: this method has read
      // catalog_summary since before this plan, and /api/v1/guided-search makes
      // no `count_mode: "exact"` claim. Do NOT copy this flag to listPage or
      // countCompat — see Step 3.
      compatTotal(this.db, clauses, params, where, { allowAggregate: true }),
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
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "compatTotal(this.db, clauses, params, where" workers/storage/cloudflare.js && grep -c "allowAggregate: true" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0; the first `grep -c` prints `3`; the second prints `1`
(only `guidedPrecedents`); vitest reports zero failures with a total equal to
`BEFORE_WORKER`.

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
      SELECT case_id FROM cases
      WHERE ${column} = ? AND case_id <> ?
      ORDER BY year DESC, case_id ASC
      LIMIT ?
    `, [value, id, RELATED_CANDIDATES_PER_DIMENSION]).all()));
    // Union the candidate ids FIRST, then read each candidate's actual
    // dimension values and score from those.
    //
    // Do NOT derive the score from which pages a candidate appeared in. A case
    // that shares all three dimensions with the anchor but ranks 201st in, say,
    // the court page would be missing from that page and would silently score 2
    // instead of 3 -- so it would sort below a genuinely weaker match. The page
    // is a recall device; it is not evidence about the row's columns.
    const candidateIds = [...new Set(candidatePages.flatMap((page) => rows(page).map((row) => row.case_id)))];
    if (candidateIds.length === 0) return [];
    const facts = rows(await bindAll(this.db, `
      SELECT c.case_id, c.case_nature, c.visa_type, c.court_code, c.year
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `, [JSON.stringify(candidateIds)]).all());
    const ordered = facts
      .map((row) => ({
        case_id: row.case_id,
        year: Number.isFinite(Number(row.year)) ? Number(row.year) : -1,
        score: dimensions.reduce(
          (total, [column, value, weight]) => total + (row[column] === value ? weight : 0),
          0,
        ),
      }))
      .sort((left, right) =>
        right.score - left.score || right.year - left.year || left.case_id.localeCompare(right.case_id))
      .slice(0, size);
    const scoreById = new Map(ordered.map((entry) => [entry.case_id, entry.score]));
    const hydrated = await this.findByIds(ordered.map((entry) => entry.case_id));
    return hydrated.map((row) => ({ ...row, related_score: scoreById.get(row.case_id) || 0 }));
  }
```

Three notes on the extra query:

- It is **one** round trip with **one** bound parameter, using the same
  `json_each(?)` pattern as `findByIds`
  (`workers/storage/cloudflare.js:817-827`), so it does not reintroduce the
  `D1_MAX_BOUND_PARAMETERS = 100` ceiling that a per-id `IN (?, ?, …)` would.
- It selects five narrow columns, not `LEGACY_CASE_PROJECTION`, so the two
  correlated `group_concat` subqueries are still evaluated only for the ≤20 rows
  that `findByIds` hydrates.
- `row[column]` works because `dimensions` holds the literal column names
  `case_nature` / `visa_type` / `court_code`, which are also the aliases this
  query selects. Keep those three names identical in both places or the score
  silently becomes 0 — Step 8 test 6 asserts a non-zero score for exactly this
  reason.

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
column set is byte-identical to `LEGACY_CASE_PROJECTION`, and the score for any
returned row equals what the old whole-corpus query would have computed for it.

**One intentional behaviour change — recall, and it needs sign-off before this
ships to users.** Candidates are drawn from the 200 most-recent cases per
matching dimension instead of the whole corpus, so an old case matching all
three dimensions but older than the 200th most recent in *every* one of them is
no longer reachable. For a self-representing applicant, "an obviously related
older case vanished from the panel" is a user-visible regression, and this plan
cannot measure how often it happens: the local Miniflare D1 is empty, so the
loss rate is unmeasured. Requirements before enabling in production, recorded in
"Maintenance notes" and **not** satisfiable from this working copy:

1. Run a differential evaluation on a production-like sample (≥200 anchor cases
   spread across courts and decades): compute the old exact top-N and the new
   bounded top-N for each, and report the proportion of anchors whose result set
   changed at all, and the proportion where a *higher-scoring* case was lost.
2. Get explicit product sign-off on that number, or raise
   `RELATED_CANDIDATES_PER_DIMENSION` until it is acceptable — each candidate row
   is one narrow indexed column, so the window is cheap to widen.
3. If neither is possible, ship Steps 1–5 and 7 and hold Step 6.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js && grep -c "RELATED_CANDIDATES_PER_DIMENSION" workers/storage/cloudflare.js && grep -c "related_score" workers/storage/cloudflare.js && grep -c "SELECT case_id FROM cases" workers/storage/cloudflare.js && cd workers && npx vitest run 2>&1 | tail -4
```
→ `node --check` exits 0; the first `grep -c` prints `2` (the declaration and
its one use); the second prints `1` (down from `2` at baseline — the computed
`related_score` SQL expression is gone, only the JS property assignment
remains); the third prints `1`; vitest reports zero failures with a total equal
to `BEFORE_WORKER`.

### Step 7: Fetch lexical search candidates in one D1 round trip

**Be precise about what this buys, because it is not unambiguously faster.** The
old loop exits after the first page whenever 100 chunks yield enough distinct
cases, which `retrieval.js:19` (`RETRIEVAL_RECALL = 20`) makes the common case.
So the typical request goes from **one round trip reading 100 rows** to **one
round trip reading 500 rows** — same trip count, 5× the rows and response bytes.
The win is confined to the tail, where the old code made up to five sequential
trips; the cost is paid on every request.

What is unambiguously true: recall goes **up** (500 chunk candidates always
considered instead of usually 100), and the worst case gets much better. What is
*not* established, and must not be claimed: that p50 latency improves. Measuring
it needs production-like cardinality in `case_text_fts`, which the empty local
Miniflare D1 cannot provide. The benchmark is specified in "Maintenance notes";
until it is run, describe this step as "one round trip, wider recall", not "one
round trip, faster".

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
uses OFFSET); the second prints `0`; vitest reports zero failures with a total
equal to `BEFORE_WORKER`.

### Step 8: Add a test file that pins the new query shapes

Create `workers/__tests__/cloudflare-storage-query-shapes.test.js`. Model it on
`workers/__tests__/cloudflare-storage-contracts.test.js` — same imports, same
fake-D1 helper, same `createCloudflareStores(env)` construction. Remember the
two fake-D1 properties from "Current state": a statement only lands in `calls`
when `.bind()` is called, and `all()`/`first()` ignore the SQL.

Write exactly these ten tests:

1. **`listPage` still counts exactly, and does not read the aggregate.** Build a
   catalog binding with `firstRow: { total: 7, value_int: 149016 }` and
   `allRows: [{ case_id: "0123456789ab" }]`. Call `caseStore.listPage({})`.
   Assert the returned `total` is `7` (the `COUNT(*)`, **not** the `149016`
   aggregate) and that some bound statement's sql includes `COUNT(*) AS total`.
   This is the guard on `count_mode: "exact"`: if someone later flips
   `allowAggregate` on for `listPage`, this test fails.
2. **`listPage` runs the count and the page concurrently.** Same binding; assert
   both the `COUNT(*)` statement and the `LIMIT ? OFFSET ?` page statement
   appear in `calls`, and that the returned `total_pages` is
   `Math.max(1, Math.ceil(7 / 100))`. (The fake D1 cannot observe concurrency
   directly; what is asserted is that neither query was dropped. The
   `Promise.all` shape is verified by reading the diff.)
3. **`listPage` with a filter counts with the filter's params.**
   `firstRow: { total: 3 }`, call `listPage({ filters: { court: "FCA" } })`.
   Assert `total` is `3` and the `COUNT(*)` statement's `params` contains
   `"FCA"`.
4. **`listPage` accepts `sort_by=year`.** Call
   `listPage({ sortBy: "year", sortDir: "asc" })` and assert it does not throw
   and that the page statement's SQL contains `ORDER BY c.year ASC`.
   Additionally assert `listPage({ sortBy: "nonsense" })` still rejects with a
   message matching `/Invalid sort_by/`.
5. **`countCompat` counts exactly.** `firstRow: { total: 42, value_int: 149016 }`,
   call `countCompat({})`, assert it returns `42` and that a `COUNT(*)`
   statement was bound. Same contract guard as test 1, for
   `/api/v1/cases/count`.
6. **`guidedPrecedents` is the one caller that may use the aggregate.**
   `firstRow: { value_int: 149016 }` with no filters; assert the returned `total`
   is `149016`. Then with `firstRow: { total: 5 }` (aggregate row absent), assert
   `total` is `5` — the fallback that stops a fresh database reporting zero.
7. **`relatedCompat` issues one narrow lookup per non-empty dimension.**
   `firstRow: { case_nature: "protection", visa_type: "", court_code: "AATA" }`,
   `allRows: [{ case_id: "0123456789ab" }]`. Call
   `relatedCompat("0123456789ab")`. Assert that the statements whose SQL
   contains `SELECT case_id FROM cases` number exactly **2** (the empty
   `visa_type` dimension is skipped), and that none of the bound statements' SQL
   contains `related_score`.
8. **`relatedCompat` scores from the candidate's own columns, not from which
   page it appeared in.** This is the guard on the scoring bug. The fake D1
   returns the same `allRows` for every statement, which is not expressive
   enough here, so give this test a per-SQL-fragment binding (the shape used in
   `plans/014-*.md` Step 3a: `prepare(sql)` picks its `allRows` by matching a
   fragment of `sql`). Configure it so:
   - the `case_nature` candidate page returns `[{ case_id: "aaaaaaaaaaaa" }]`;
   - the `court_code` candidate page returns `[{ case_id: "bbbbbbbbbbbb" }]` —
     i.e. `aaaaaaaaaaaa` is *absent* from the court page, simulating a case that
     ranks past `RELATED_CANDIDATES_PER_DIMENSION` there;
   - the `json_each(?)` facts query returns
     `[{ case_id: "aaaaaaaaaaaa", case_nature: "protection", visa_type: "", court_code: "AATA", year: 2020 },
        { case_id: "bbbbbbbbbbbb", case_nature: "other", visa_type: "", court_code: "AATA", year: 2026 }]`;
   - `findByIds` hydration returns both rows.
   With the anchor `{ case_nature: "protection", visa_type: "", court_code: "AATA" }`,
   assert `aaaaaaaaaaaa` scores **5** (nature 4 + court 1) and sorts **first**,
   ahead of `bbbbbbbbbbbb` which scores 1 — despite being the older case and
   despite never appearing in the court page. Under the page-membership scoring
   this test fails: `aaaaaaaaaaaa` would score 4 and still lead here, so also
   assert the exact numeric `related_score` values (`5` and `1`), which is the
   part that distinguishes the two implementations.
9. **`relatedCompat` returns `null` for an unknown anchor.** Binding with
   `firstRow: null`; assert the result is exactly `null`.
10. **`searchLexical` makes exactly one FTS query.** Reuse the `env()` shape from
    the contracts test (catalog `allRows: [{ case_id: "0123456789ab", rank: -1.1 }]`).
    Call `searchLexical({ query: "visa", limit: 100 })` and assert that
    `calls.filter((s) => s.sql.includes("case_text_fts MATCH ?"))` has length
    `1`, and that its `params` equals `['"visa"', 500]`.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-query-shapes.test.js 2>&1 | tail -4
```
→ `Test Files 1 passed` and `Tests 10 passed` — a per-file count, stable
regardless of sibling plans.

Prove test 8 is a real guard. Temporarily revert `relatedCompat`'s scoring to
page membership (accumulate `weight` per page a candidate appeared in, skipping
the `json_each` facts query), re-run just that test, and confirm it **fails** on
the `related_score` values. Restore the column-based scoring and re-run:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-query-shapes.test.js -t "scores from the candidate"
```

### Step 9: Write the migration runbook, then verify the full suite

**9a — the runbook is a deliverable, not a footnote.** Nothing in CI or the test
suite reads `migrations/d1/**`, so these files are inert until an operator
applies them — and Steps 3, 6 and 7 change *code* that assumes the indexes
exist. Deploying the code without applying the migrations can make things
**slower**: `relatedCompat` would issue three unindexed range scans plus a
`json_each` join where it previously issued one scan. Ordering therefore
matters, and must be written down. Produce this in your completion report; do
**not** execute any of it (you have no credentials, and `wrangler d1 migrations
apply` / `wrangler deploy` are forbidden by this plan).

The runbook must state:

1. **Migrations before code, staging before production.** For each of the two
   affected databases (catalog, ops) and each environment:
   ```bash
   npx wrangler d1 migrations list  <db-binding> --remote   # confirm 0002/0003 are pending
   npx wrangler d1 migrations apply <db-binding> --remote
   npx wrangler d1 migrations list  <db-binding> --remote   # confirm applied
   ```
2. **Before/after plans on the real data**, not on an empty local D1, for the
   three queries whose indexes are new. Capture both:
   ```bash
   npx wrangler d1 execute <catalog-db> --remote --command \
     "EXPLAIN QUERY PLAN SELECT case_id FROM cases ORDER BY year DESC, case_id ASC LIMIT 100"
   npx wrangler d1 execute <catalog-db> --remote --command \
     "EXPLAIN QUERY PLAN SELECT case_id FROM cases WHERE case_nature='protection' ORDER BY year DESC, case_id ASC LIMIT 200"
   npx wrangler d1 execute <ops-db> --remote --command \
     "EXPLAIN QUERY PLAN SELECT run_id FROM pipeline_runs ORDER BY started_at DESC LIMIT 30"
   ```
   Each must go from `SCAN` to `SEARCH … USING INDEX`. If one does not, do not
   deploy the corresponding code change.
3. **Write-side cost.** Four new indexes on a ~149K-row table plus two ops
   tables is write amplification on every case upsert. Record the catalog DB
   size before and after (`npx wrangler d1 info <catalog-db>`), and watch queue
   consumer duration for the first bulk ingest after the change.
4. **Rollback is forward-only.** D1 has no `migrations down`. The rollback is a
   new migration, and the executor must write it as part of this plan so the
   operator is not authoring SQL under pressure. Create
   `migrations/d1/catalog/0003_rollback_read_path_indexes.sql.disabled` and
   `migrations/d1/ops/0004_rollback_read_path_indexes.sql.disabled` — the
   `.disabled` suffix keeps Wrangler from applying them (it collects `*.sql`),
   so they are staged text an operator renames if needed:
   ```sql
   -- catalog rollback: drop what 0002_read_path_indexes.sql added.
   DROP INDEX IF EXISTS cases_year_case_idx;
   DROP INDEX IF EXISTS cases_nature_year_idx;
   DROP INDEX IF EXISTS aggregate_judge_outcome_court_idx;
   ```
   ```sql
   -- ops rollback: drop what 0003_read_path_indexes.sql added AND restore the
   -- index it dropped, so the schema returns to its pre-change shape exactly.
   DROP INDEX IF EXISTS pipeline_runs_started_idx;
   DROP INDEX IF EXISTS pipeline_control_action_idx;
   CREATE INDEX IF NOT EXISTS pipeline_control_status_idx
     ON pipeline_control_commands(status, created_at);
   ```
   Note the asymmetry that makes this worth writing down: rolling back the code
   without rolling back the indexes is harmless (unused indexes only cost write
   throughput), but rolling back the *indexes* while the new code is live makes
   `relatedCompat` and the listing slower than they were originally. So: roll
   back code first, indexes second, and only if the write cost is the problem.

Add these two files to your In-scope list; they are part of this step.

**9b — full-suite verification.**
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers 2>&1 | tail -4 && make lint && git status --short && git diff --stat && git diff --cached --stat
```
→ vitest reports zero failures with a total equal to `BEFORE_WORKER + 10`;
`make lint` prints `All checks passed!`; the three git commands list **only**:

```
 M workers/__tests__/cloudflare-storage-contracts.test.js
 M workers/storage/cloudflare.js
?? migrations/d1/catalog/0002_read_path_indexes.sql
?? migrations/d1/catalog/0003_rollback_read_path_indexes.sql.disabled
?? migrations/d1/ops/0003_read_path_indexes.sql
?? migrations/d1/ops/0004_rollback_read_path_indexes.sql.disabled
?? workers/__tests__/cloudflare-storage-query-shapes.test.js
```

(Plus `plans/013-fix-d1-query-shapes.md` and `plans/README.md` if you updated the
index, and anything already dirty when you started. Nothing else.)

## Test plan

- **New file** `workers/__tests__/cloudflare-storage-query-shapes.test.js`, 10
  tests, listed one by one in Step 8. They cover: `listPage` and `countCompat`
  still counting **exactly** (the guard on `count_mode: "exact"`), the count and
  page queries both being issued, the filtered path binding its filter params,
  the `sort_by=year` fix plus its still-rejecting invalid sibling,
  `guidedPrecedents` as the sole aggregate consumer *and* its
  aggregate-never-built fallback (the regression this plan could otherwise
  introduce on a fresh database), the per-dimension related-case lookups
  including the skip-empty-dimension edge case, **related-case scoring being
  computed from each candidate's own columns rather than from page membership**,
  the `null` anchor case, and the single-round-trip lexical search.
- **Structural pattern to copy**: `workers/__tests__/cloudflare-storage-contracts.test.js`
  — its `d1()` fake, its `env()` builder, and its style of asserting on
  `binding.calls[].sql` / `.params`.
- **Existing test updated**: one assertion at
  `workers/__tests__/cloudflare-storage-contracts.test.js:122` (Step 7c). That is
  the only pre-existing test this plan's changes invalidate; every other
  affected test mocks the store rather than the SQL, so it is unaffected.
- **Verification**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers`
  → zero failures, total equal to `BEFORE_WORKER + 10`. Plus the per-file check
  `npx vitest run __tests__/cloudflare-storage-query-shapes.test.js` →
  `Tests 10 passed (10)`, which is stable regardless of sibling plans.
- **What no test here can prove**: none of these execute SQL, so a wrong column
  name, a broken `json_each` projection or an index the planner ignores would all
  pass. Step 1's `EXPLAIN QUERY PLAN` probe and Step 9a's runbook are the
  compensating checks, and `plans/038-test-the-production-sql-layer.md` is the
  real-schema harness these tests should eventually be ported onto.
- **Not run here**: `make test-py` and `make test-fe`. This plan touches no
  Python and no frontend file. For reference, `make test-py` at `42826a3` reports
  3 pre-existing failures caused by a Homebrew Python 3.14 `pyexpat`/`libexpat`
  ABI mismatch breaking a `pypdf` import — an environment problem, unrelated to
  this plan, and not yours to fix.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f migrations/d1/catalog/0002_read_path_indexes.sql` succeeds
- [ ] `test -f migrations/d1/ops/0003_read_path_indexes.sql` succeeds
- [ ] `test -f migrations/d1/catalog/0003_rollback_read_path_indexes.sql.disabled` and `test -f migrations/d1/ops/0004_rollback_read_path_indexes.sql.disabled` both succeed
- [ ] The Step 1 verify command prints the six-element `cases` index list
      including `cases_year_case_idx` and `cases_nature_year_idx`, and the
      one-element `aggregate_judge_outcome` list
- [ ] The Step 1 `EXPLAIN QUERY PLAN` probe shows `USING INDEX` (not a bare
      `SCAN`) for all three queries, and the output is quoted in your report
- [ ] The Step 2 verify command prints the four-element index list including
      `pipeline_runs_started_idx` and `pipeline_control_action_idx`, and
      **excluding** `pipeline_control_status_idx`
- [ ] The Step 2 predicate audit was performed by reading each statement's
      `WHERE`, and your report lists each statement found and its leading
      predicate — not merely a line count
- [ ] Applying the two rollback files on top of the forward ones returns the
      schema to its original index set. This prints `ROLLBACK OK`:
      ```bash
      cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 - <<'PY'
      import sqlite3
      def idx(c): return sorted(r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"))
      for base, fwd, back in [
          (["migrations/d1/catalog/0001_catalog.sql"], "migrations/d1/catalog/0002_read_path_indexes.sql", "migrations/d1/catalog/0003_rollback_read_path_indexes.sql.disabled"),
          (["migrations/d1/ops/0001_ops.sql", "migrations/d1/ops/0002_pipeline_control.sql"], "migrations/d1/ops/0003_read_path_indexes.sql", "migrations/d1/ops/0004_rollback_read_path_indexes.sql.disabled"),
      ]:
          c = sqlite3.connect(":memory:")
          for p in base: c.executescript(open(p).read())
          before = idx(c)
          c.executescript(open(fwd).read()); c.executescript(open(back).read())
          assert idx(c) == before, (fwd, before, idx(c))
      print("ROLLBACK OK")
      PY
      ```
- [ ] `node --check workers/storage/cloudflare.js` exits 0 (parse check only)
- [ ] `grep -c "async function compatTotal" workers/storage/cloudflare.js` prints `1`
- [ ] `grep -c "compatTotal(this.db, clauses, params, where" workers/storage/cloudflare.js` prints `3`
- [ ] `grep -c "allowAggregate: true" workers/storage/cloudflare.js` prints `1` — only `guidedPrecedents`. If this prints `2` or more, `/api/v1/cases` is silently no longer `count_mode: "exact"`; that is a STOP condition, not a passing check.
- [ ] `grep -c "MAX_PAGES\|CHUNK_PAGE" workers/storage/cloudflare.js` prints `0`
- [ ] `grep -c "OFFSET ?" workers/storage/cloudflare.js` prints `1`
- [ ] `grep -c 'year: "c.year"' workers/storage/cloudflare.js` prints `1`
- [ ] The Step 8 scoring check showed test 8 **failing** with page-membership
      scoring restored, and passing with column-based scoring
- [ ] The Step 9a migration runbook (including both rollback files) is written
      out in your completion report, and the report states that no migration was
      applied and no benchmark was run
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
- [ ] `cd workers && npx vitest run` reports zero failures with a total equal to `BEFORE_WORKER + 10`
- [ ] `make lint` prints `All checks passed!`
- [ ] `git status --short`, `git diff --stat` and `git diff --cached --stat` list only the seven in-scope paths (plus the plan files and anything in `/tmp/immi-013-dirty-before.txt`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file shows any in-scope file changed since
  `42826a3`, and the "Current state" excerpts no longer match the live code.
- The Step 2 predicate audit finds a query on `pipeline_control_commands` that
  constrains `status` as a **leading** predicate. That would make the
  `DROP INDEX pipeline_control_status_idx` a regression — report it and omit
  only the DROP line, keeping the rest of the migration. (A *new* query keyed on
  `command_id`, such as the one `plans/011-*.md` adds, is not this: it goes
  through the primary key and needs no index. Do not stop for it.)
- `grep -c "allowAggregate: true"` returns more than `1`. Something has routed
  `listPage` or `countCompat` through the queue-maintained aggregate while their
  responses still say `count_mode: "exact"` — that is the contract break Step 3
  exists to avoid.
- The Step 1 `EXPLAIN QUERY PLAN` probe shows a bare `SCAN` for any of the three
  queries after the new migration is applied. The index is then not usable by
  that query and the migration is wrong; report the plan output rather than
  shipping an index nothing uses.
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
- A Step 8 test that expects to see the `catalog_summary` read in `calls` cannot
  be made to pass. That is by design, not a bug: the fake D1 pushes a statement
  into `calls` only when `.bind()` is called, and `compatTotal`'s aggregate
  branch uses `prepare(...).first()` with no `.bind()`. Assert on the returned
  `total` for that branch (test 6), and on the presence of the bound `COUNT(*)`
  statement for the exact-count branches (tests 1 and 5).
- Any verification fails twice after a reasonable fix attempt.
- The fix appears to require touching a file in the "Out of scope" list.

## Maintenance notes

For the human or agent who owns this code after the change lands:

- **The migrations are inert until an operator applies them, and the ordering is
  not optional.** Nothing in CI or the test suite reads `migrations/d1/**`. The
  full runbook is in Step 9a and must be handed to the operator with the change.
  The important asymmetry: deploying the *code* without the migrations can make
  `relatedCompat` **slower** than before (three unindexed range scans plus a
  `json_each` join, where it previously did one scan), so migrations go first —
  staging, then production — and rollback goes code first, indexes second.
- **`/api/v1/cases` and `/api/v1/cases/count` still count exactly.** This was
  deliberately *not* switched to the `catalog_summary` aggregate, because both
  responses declare `count_mode: "exact"`
  (`workers/case-api/cloudflare.js:1101`, `:1105`) and the aggregate lags every
  ingest until the next `rebuildAggregates()`. If that trade is wanted later it
  must ship **with** the contract change, not before it: flip `allowAggregate`
  on for those two callers, change the responses to
  `count_mode: "aggregate"` plus an `as_of` from `catalog_summary.updated_at`,
  update the frontend pagination to tolerate a lagging `total_pages`, and update
  the tests. That is a change to `workers/case-api/cloudflare.js`, owned by other
  plans in this wave.
- **`guidedPrecedents` is the one caller reading the aggregate**, as it did
  before this plan. Step 5 adds the previously-missing "aggregate never built"
  fallback so a freshly seeded database reports a real total instead of zero.
- **`relatedCompat`'s recall window is now bounded, and the loss rate is
  UNMEASURED.** It considers the 200 most-recent cases per matching dimension
  rather than the entire corpus. Scoring itself is exact — each candidate's real
  `case_nature` / `visa_type` / `court_code` are read back and scored, rather
  than inferring the score from which candidate page the row appeared in, which
  would under-score any case that ranked past the cutoff in one dimension. But
  recall is not exact: a case matching all three dimensions yet older than the
  200th most recent in every one of them will not appear at all. **Before this
  ships to users**, run the differential evaluation described in Step 6 on a
  production-like sample and get sign-off on the loss rate, or raise
  `RELATED_CANDIDATES_PER_DIMENSION` until it is acceptable (each candidate row
  is one narrow indexed column, so widening is cheap). Watch for user reports of
  "an obviously related old case disappeared".
- **Two benchmarks are outstanding and are not optional before claiming a perf
  win.** Neither can be run from this working copy — the local Miniflare D1 is
  empty — and no D1-era baseline exists (`CLAUDE.md`'s "Performance Baseline
  (2026-05-05)" is explicitly the retired Hyperdrive stack). Both need
  production-like cardinality:
  1. **Step 7, lexical search.** The common path goes from one round trip
     reading ~100 chunk rows to one round trip reading 500. Compare p50/p95
     latency, D1 rows read and response bytes before and after. If p50 regresses,
     the fix is to make `FTS_CANDIDATE_CHUNKS` adaptive (start at 100, widen only
     when distinct-case recall is short) rather than to revert the round-trip
     collapse.
  2. **Step 6, related cases.** One full scan with a full projection becomes
     three narrow indexed scans + one `json_each` fact read + one hydration.
     That is four round trips where there was one. Compare p50/p95 and Worker
     CPU time, not just rows read.
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
