# Plan 014: Bound the judge-leaderboard aggregate read inside D1 instead of in Worker memory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` **if that file exists** (at the time of writing it does
> not; do not create it) — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff sees
> only what is committed, so on a dirty tree it gives a false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="workers/storage/cloudflare.js workers/case-api/cloudflare.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> **This plan runs fourth in its lane** (see "Integration order" below), so
> `git diff --stat 42826a3..HEAD` is *expected* to list both files — plans 009,
> 010 and 013 landed before you. That is not drift. What you must do instead:
> re-read every verbatim excerpt in "Current state" against the live file and
> **re-derive every line number in this plan**; a mismatch in the specific
> excerpts is a STOP condition. Anything appearing in the **unstaged** or
> **staged** diffs is a STOP condition regardless. Never run `git checkout --`
> or `git clean` to tidy the tree — the operator may have work in progress.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/013-fix-d1-query-shapes.md` (and transitively 009, 010).
  Two reasons, one functional and one file-ordering:
  1. **Functional**: the `court` pushdown this plan adds is only a *filter*, not
     a faster query, unless `aggregate_judge_outcome` is indexed on
     `court_code` — its primary key is `(judge_id, court_code, outcome)`, so
     `court_code` is not a prefix. That index is
     `aggregate_judge_outcome_court_idx`, declared in
     `migrations/d1/catalog/0002_read_path_indexes.sql`, which plan 013 owns.
     Without it, the court-filtered path still scans the table.
  2. **File-ordering**: 009, 010 and 013 all rewrite regions of
     `workers/storage/cloudflare.js` / `workers/case-api/cloudflare.js`, and
     every line number below was taken at `42826a3`. Rebase on 013's HEAD and
     re-derive them.
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

This plan touches no Python, no frontend TypeScript, and no build config, so the
verification-gate plans (001–003) are not prerequisites.

### Integration order

```
009  →  010  →  013  →  014 (this plan)  →  012
```

Five plans edit `workers/storage/cloudflare.js` and/or
`workers/case-api/cloudflare.js`; integrate serially in that order, each rebased
on the previous one's HEAD. `plans/011-*.md` is independent and runs in parallel.

Note that `plans/010-*.md` legitimately modifies
`workers/__tests__/case-api-cloudflare.test.js` (its store mock) before you
start. This plan's requirement that the file stay unmodified means "unmodified
**by you**, relative to the branch you branch from" — not "identical to
`42826a3`".

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

**Record your baseline first (Step 0).** Three plans land before this one and one
after, all adding tests to the same suite, so no absolute total is valid:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_WORKER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_WORKER=$BEFORE_WORKER"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short > /tmp/immi-014-dirty-before.txt
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker unit tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | zero failures; total equals `BEFORE_WORKER` mid-plan and `BEFORE_WORKER + 15` after Step 3 |
| One Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/<file>` | that file passes; per-file counts are 7 / 3 / 5 for the three new files |
| Worker bundle closure gate | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (…bytes): /tmp/immi-cloudflare-native-bundle.mjs`, exit 0. **Parse/closure check only** — it does not parse SQL and cannot detect a behaviour or performance change. |
| `node:sqlite` availability (Step 3c prerequisite) | `node -e "const {DatabaseSync}=require('node:sqlite'); console.log(typeof DatabaseSync)"` | prints `function` (an `ExperimentalWarning` on stderr is expected) |
| Confirm the single call site | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "analyticsJudgeAggregate" workers/` | exactly 3 hits (definition, call site, test mock) — plus your new test files after Step 3 |
| Files changed so far | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short && git diff --stat && git diff --cached --stat` | only the in-scope files, plus whatever `/tmp/immi-014-dirty-before.txt` already listed |

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
- `workers/__tests__/cloudflare-storage-judge-aggregate-sql.test.js` —
  **create** (Step 3c, the real-SQLite equivalence and query-plan file).

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
  or anywhere else. `plans/013-*.md` owns the read-path index migration and now
  declares `aggregate_judge_outcome_court_idx` for you in
  `migrations/d1/catalog/0002_read_path_indexes.sql`; a second migration file
  touching the same table would collide. Step 3c test 5 reads that file if it
  exists, which is the check that the index is actually usable by this plan's
  query.
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

### Step 1: Push `court` and `minCases` into the judge-aggregate SQL — without penalising the unfiltered path

**The default request must not get slower.** `handleAnalyticsJudgeLeaderboard`
parses `court` with a default of `""` and `minCases` with
`intParam(..., 1, 1, 100000)`, i.e. a default of `1`
(`workers/case-api/cloudflare.js:882`, `:884`). The Judge Profiles page's own
default request therefore arrives with `court = ""` and `minCases = 1` — and
with those values **neither filter removes a single row**: `? = '' OR ...` is
always true, and `judge_total >= 1` excludes only judges whose outcomes sum to
zero. A naive pushdown would then return exactly the same three full tables it
returns today, while *additionally* computing a window sum over
`aggregate_judge_outcome` and running two `GROUP BY … HAVING` aggregations over
that same table for the year/visa subqueries. That is three extra full passes on
the single most common request — a regression dressed as an optimisation.

So the query shape must be **conditional**: only add machinery that can actually
remove rows.

- `courtCode === ""` → no court predicate at all, and no `SELECT` wrapper for it.
- `floor <= 1` → no window sum, no `judge_total` filter, and **no**
  `judge_id IN (SELECT … HAVING …)` subquery on the year/visa reads.

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
    // A floor of 1 excludes nothing (case_count >= 0 and every judge in this
    // table has at least one outcome row), so anything built to enforce it is
    // pure cost on the most common request. Same for an empty court code.
    const filtersRows = floor > 1;

    const courtClause = courtCode ? "WHERE o.court_code = ?" : "";
    const base = `
      SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
      FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
      ${courtClause}
    `;
    const outcomes = filtersRows
      // Only when a real floor is set do we pay for the window sum. It is
      // evaluated AFTER the WHERE, so the partition total is the post-court
      // sum — exactly what the handler accumulates into judge.total.
      ? rows(await bindAll(this.db, `
          SELECT judge_id, name, court_code, outcome, cnt FROM (
            SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt,
                   SUM(o.case_count) OVER (PARTITION BY o.judge_id) AS judge_total
            FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
            ${courtClause}
          ) WHERE judge_total >= ?
        `, courtCode ? [courtCode, floor] : [floor]).all())
      : rows(await bindAll(this.db, base, courtCode ? [courtCode] : []).all());

    if (courtCode) return { outcomes, years: [], visas: [] };

    // Same rule for the year/visa reads: the HAVING subquery is a second full
    // aggregation of aggregate_judge_outcome, so only issue it when the floor
    // can actually exclude a judge.
    const floorFilter = filtersRows
      ? `WHERE judge_id IN (
           SELECT judge_id FROM aggregate_judge_outcome GROUP BY judge_id HAVING SUM(case_count) >= ?
         )`
      : "";
    const floorParams = filtersRows ? [floor] : [];
    const [years, visas] = await Promise.all([
      bindAll(this.db, `
        SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year
        ${floorFilter}
      `, floorParams).all(),
      bindAll(this.db, `
        SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa
        ${floorFilter}
      `, floorParams).all(),
    ]);
    return { outcomes, years: rows(years), visas: rows(visas) };
  }
```

Note the switch from `this.db.prepare(...).bind(...)` to `bindAll(...)`: the
parameter list is now variable-arity (0, 1 or 2 parameters depending on the
filters), and `bindAll` (`workers/storage/cloudflare.js:54-62`) is this module's
sanctioned way to bind a variable-length list. It also always calls `.bind()`,
which matters for the recording D1 fakes in the tests. All interpolation
(`${courtClause}`, `${floorFilter}`) is of module-local literal strings — never
of request data, which stays in bound parameters.

Why each piece is output-preserving — check these by eye before running anything:

- **The window sum matches `judge.total`.** SQLite evaluates window functions
  *after* `WHERE`, so `SUM(o.case_count) OVER (PARTITION BY o.judge_id)` is the
  sum over exactly the rows that survive the court filter — which is exactly how
  the handler accumulates `judge.total` (it `continue`s on a court mismatch
  before adding to `judge.total`).
- **Skipping the window sum at `floor === 1` is safe.** `case_count` is
  `INTEGER NOT NULL CHECK(case_count >= 0)`
  (`migrations/d1/catalog/0001_catalog.sql:252-259`), and every `judge_id`
  present in `aggregate_judge_outcome` has at least one row there, so
  `SUM(case_count) >= 1` can only exclude a judge all of whose outcome rows are
  zero. Such a judge contributes `judge.total === 0` and is then removed anyway
  by the handler's own surviving `judge.total >= minCases` filter
  (`workers/case-api/cloudflare.js:916`), which this plan keeps. So the output is
  identical either way, and the cheap path is the correct one.
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
→ the bundle line is printed, then zero failures and a total equal to
`BEFORE_WORKER`. This step changes no observable behaviour yet, because the call
site still passes no arguments.

**The bundle script and `node --check` only prove the file parses.** Neither
parses SQL, and the existing suite mocks the store, so a syntax error inside the
new SQL strings, a wrong column name, or the query being materially slower would
all pass here. Step 3b is where those are actually caught — do not treat this
step's green run as evidence the SQL works.

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
→ bundle line printed, then zero failures and a total equal to `BEFORE_WORKER`.
In particular this named test must still pass **unmodified by you**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "serves judge leaderboard, profile and compare from normalized aggregates"
```
→ `Tests 1 passed`, `0 failed`. That test mocks the store and asserts `judges[0]`
is `{ name: "Justice Example", total_cases: 7 }`, so it proves you did not
disturb the response assembly.

Also confirm you changed exactly one line in this file:

`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --numstat -- workers/case-api/cloudflare.js`
→ `1	1	workers/case-api/cloudflare.js`

### Step 3: Pin the pushdown with tests

Three new files. All are new; do not edit any existing test file.

**Why three and not two.** The recording D1 fake in 3a never executes SQL, and
`node --check` / the bundle script never parse it. A test suite built only from
those cannot detect a SQL syntax error, cannot show that the new query returns
the same rows as the old one, and cannot show whether the query got slower —
which are the three things this change actually needs to establish. 3c adds a
real SQLite fixture that does all three. It uses Node's built-in `node:sqlite`
(`DatabaseSync`), which is present on the Node 22 toolchain this repo runs on —
verify before writing the file:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); console.log(typeof DatabaseSync)"
```
→ prints `function` (an `ExperimentalWarning` on stderr is expected and
harmless). If it throws instead, skip 3c, say so explicitly in your report, and
flag that the equivalence and query-plan evidence is missing — do **not** call
the step done on 3a and 3b alone.

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

Write these seven tests inside a single
`describe("analyticsJudgeAggregate query pushdown", …)`:

1. **`issues no filter machinery on the default request`** — the guard against
   making the most common request slower.
   `await storeWith(catalog).analyticsJudgeAggregate()`. Assert the single
   statement mentioning `aggregate_judge_outcome` has `params` equal to `[]`,
   and that its `sql` contains **neither** `OVER (PARTITION BY` **nor**
   `judge_total`. Then assert the year and visa statements each have `params`
   equal to `[]` and their `sql` does **not** contain `HAVING SUM(case_count)`.
   Against a query shape that always emits the window sum and the `HAVING`
   subqueries, this test fails.
2. **`pushes the court code into SQL without a floor`** — call with
   `{ court: "FCA" }`. Assert the statement mentioning
   `aggregate_judge_outcome` has `params` equal to `["FCA"]`, its `sql` contains
   `WHERE o.court_code = ?`, and its `sql` does **not** contain
   `OVER (PARTITION BY`.
3. **`pushes the court code and the minimum-case floor into SQL`** — call with
   `{ court: "FCA", minCases: 5 }`. Assert the first statement mentioning
   `aggregate_judge_outcome` has `params` equal to `["FCA", 5]`, and its
   `sql` contains both `SUM(o.case_count) OVER (PARTITION BY o.judge_id)` and
   `judge_total >= ?`.
4. **`does not read the year or visa tables when a court filter is set`** — call
   with `{ court: "FCA" }`. Assert `sqlOf(catalog).some((sql) => sql.includes("aggregate_judge_year"))`
   is `false`, the same for `aggregate_judge_visa`, and that the returned value
   has `years` and `visas` both `[]`.
5. **`reads all three aggregate tables when no court filter is set`** — call with
   no arguments. Assert `mentioning(catalog, "aggregate_judge_year")` has length
   1 and `mentioning(catalog, "aggregate_judge_visa")` has length 1.
6. **`restricts the year and visa reads to judges above the floor`** — call with
   `{ minCases: 5 }`. Assert both the year and the visa statements have `params`
   equal to `[5]` and `sql` containing `HAVING SUM(case_count) >= ?`.
7. **`clamps a nonsense floor to one and issues no filter machinery`** — call
   with `{ minCases: "abc" }` and again with `{ minCases: 0 }`. Both must behave
   exactly like test 1.

For test 5, seed the mock so the unwrapping is exercised, e.g.
`d1({ "aggregate_judge_year": [{ judge_id: "judge-a", year: 2025, cnt: 7 }] })`,
and assert the returned `years` equals that array — this proves `rows()` is still
applied.

Note the `d1()` scaffold above records `params` only because `bindAll` always
calls `.bind()`, even with zero parameters. Keep the `bindAll` form from Step 1;
a bare `this.db.prepare(sql).all()` would make these statements invisible to
`prepared`.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-judge-aggregate.test.js`
→ `Test Files 1 passed (1)`, `Tests 7 passed (7)`.

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

**3c. `workers/__tests__/cloudflare-storage-judge-aggregate-sql.test.js`** — runs
the real SQL against a real SQLite loaded from the real migration, which is the
only thing here that can catch a syntax error, prove output equivalence, or show
the query plan.

Adapter and fixture:

```js
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareCaseStore } from "../storage/cloudflare.js";

/** Minimal D1-shaped adapter over node:sqlite. */
function d1(db) {
  return {
    db,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        all() {
          return Promise.resolve({ results: db.prepare(sql).all(...this.params) });
        },
        first() {
          return Promise.resolve(db.prepare(sql).get(...this.params) ?? null);
        },
        run() { db.prepare(sql).run(...this.params); return Promise.resolve({ meta: { changes: 1 } }); },
      };
      return statement;
    },
    batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
}

function seeded() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(
    new URL("../../migrations/d1/catalog/0001_catalog.sql", import.meta.url), "utf8",
  ));
  // Two judges: "big" has 6 cases across two courts, "small" has 1.
  db.exec(`
    INSERT INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES
      ('judge-big', 'Justice Big', '2026-01-01', '2026-01-01'),
      ('judge-small', 'Member Small', '2026-01-01', '2026-01-01');
    INSERT INTO aggregate_judge_outcome (judge_id, court_code, outcome, case_count) VALUES
      ('judge-big', 'FCA', 'Allowed', 4),
      ('judge-big', 'AATA', 'Remitted', 2),
      ('judge-small', 'FCA', 'Dismissed', 1);
    INSERT INTO aggregate_judge_year (judge_id, year, case_count) VALUES
      ('judge-big', 2025, 6), ('judge-small', 2024, 1);
    INSERT INTO aggregate_judge_visa (judge_id, visa_subclass, case_count) VALUES
      ('judge-big', '189', 6), ('judge-small', '866', 1);
  `);
  return db;
}

/** The pre-change implementation, kept verbatim as the equivalence oracle. */
function legacyAggregate(db) {
  return {
    outcomes: db.prepare(`
      SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
      FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
    `).all(),
    years: db.prepare("SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year").all(),
    visas: db.prepare("SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa").all(),
  };
}
```

Five tests:

1. **`returns exactly what the pre-change query returned on the default request`**
   — the equivalence oracle. Compare
   `await store.analyticsJudgeAggregate()` against `legacyAggregate(db)`, sorting
   both sides by `judge_id`/`court_code`/`outcome` before comparing so row order
   is not asserted. All three arrays must match element for element.
2. **`filters to the requested court and drops the year and visa reads`** —
   `{ court: "FCA" }` returns only the two `FCA` outcome rows and empty
   `years`/`visas`.
3. **`applies the minimum-case floor across all three tables`** —
   `{ minCases: 2 }` returns only `judge-big`'s outcome rows, and `years` /
   `visas` contain only `judge-big`. `judge-small` (1 case) is excluded
   everywhere. This is the test that would catch a broken window sum or a broken
   `HAVING` subquery — both are silently wrong under the fake D1.
4. **`the court+floor query is syntactically valid`** — call with
   `{ court: "FCA", minCases: 2 }` and assert it resolves without throwing. Under
   `node:sqlite` a malformed statement throws at `prepare`, so this is a real
   syntax gate; under the fake D1 it is not.
5. **`the court-filtered query uses the court index`** — apply
   `migrations/d1/catalog/0002_read_path_indexes.sql` (owned by
   `plans/013-*.md`; skip this test with a clear message if the file is absent
   because 013 has not landed), then assert
   `db.prepare("EXPLAIN QUERY PLAN SELECT o.judge_id FROM aggregate_judge_outcome o WHERE o.court_code = ?").all()`
   yields a `detail` mentioning `USING INDEX` and **not** a bare
   `SCAN aggregate_judge_outcome`. This is the only check in the plan that the
   pushdown is an index win rather than a scan-with-a-filter.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-judge-aggregate-sql.test.js`
→ `Test Files 1 passed (1)`, `Tests 5 passed (5)` (or `4 passed, 1 skipped` if
013 has not landed).

Prove test 1 is a real oracle rather than a tautology: temporarily change the
`courtClause` in Step 1 to always emit `WHERE o.court_code = ?` with an empty
string bound, re-run test 1, and confirm it **fails** (the new result is empty
while the legacy one is not). Restore the conditional immediately.

Then the whole Worker suite:

`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ zero failures, total equal to `BEFORE_WORKER + 15` (7 + 3 + 5).

## Test plan

- **New file `workers/__tests__/cloudflare-storage-judge-aggregate.test.js`**
  (7 tests) — covers the *query shape* against a recording D1 mock:
  - the default request emits **no** window sum, **no** `judge_total` filter and
    **no** `HAVING` subqueries — the guard against making the most common
    request slower, which is the specific way a naive pushdown regresses;
  - court-only pushdown binds `["FCA"]` and still emits no window sum;
  - court + floor binds `["FCA", 5]` and carries the window sum and
    `judge_total >= ?`;
  - the specific waste this plan removes: with `{ court: "FCA" }` the
    `aggregate_judge_year` and `aggregate_judge_visa` statements are **never
    prepared** (today they are always prepared and always discarded);
  - unfiltered path: all three tables are read exactly once;
  - floor propagation: the year and visa statements each bind `[minCases]`;
  - a nonsense or zero `minCases` clamps to 1 and takes the cheap path.
- **New file `workers/__tests__/cloudflare-storage-judge-aggregate-sql.test.js`**
  (5 tests) — covers what the recording mock structurally cannot, by executing
  the real SQL against a real SQLite seeded from
  `migrations/d1/catalog/0001_catalog.sql`:
  - **equivalence**: the default request returns exactly what the pre-change
    query returned, compared against a verbatim copy of the old SQL kept in the
    test as an oracle;
  - the court filter and the floor produce the right rows across all three
    tables — a broken window sum or `HAVING` subquery is invisible to the fake
    D1 and caught here;
  - the court+floor statement is syntactically valid (`node:sqlite` throws at
    `prepare` on malformed SQL; the fake D1 never would);
  - **query plan**: with `plans/013-*.md`'s index applied, the court-filtered
    read uses an index rather than scanning `aggregate_judge_outcome`.
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
  unmodified **by you**. (Note `plans/010-*.md` edits that file's store mock
  before you start; "unmodified" is relative to the branch you branch from.) It
  is the proof that the response body is unchanged.
- **Verification**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
  → zero failures, total equal to `BEFORE_WORKER + 15`; plus the three per-file
  counts (7 / 3 / 5), which are stable regardless of sibling plans.
- **What is still NOT proven, and must not be claimed**: that this is faster on
  the production corpus. Step 3c shows the plan shape and the equivalence on a
  three-row fixture; it says nothing about latency at ~15,465 judges. The
  benchmark that would settle it is specified under "Maintenance notes" and
  needs production-like cardinality, which is not reachable from this working
  copy (the local Miniflare D1 is empty).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` exits 0 and prints `Cloudflare-native bundle closure passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` reports zero failures and a total equal to `BEFORE_WORKER + 15`
- [ ] The three new files report `Tests 7 passed (7)`, `Tests 3 passed (3)` and `Tests 5 passed (5)` when run individually (5 may be `4 passed, 1 skipped` if plan 013's migration has not landed — say so in the report if it is)
- [ ] The Step 3c oracle check showed test 1 **failing** with an unconditional `WHERE o.court_code = ?`, and passing with the conditional restored
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --numstat -- workers/case-api/cloudflare.js` outputs exactly `1	1	workers/case-api/cloudflare.js`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c "analyticsJudgeAggregate()" workers/case-api/cloudflare.js` returns `0`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "SUM(o.case_count) OVER (PARTITION BY o.judge_id)" workers/storage/cloudflare.js` returns exactly one line
- [ ] The default path emits no filter machinery. Asserted by test, not by grep (a grep for `OVER (PARTITION BY` matches the conditional branch that legitimately exists): `cd workers && npx vitest run __tests__/cloudflare-storage-judge-aggregate.test.js -t "issues no filter machinery on the default request"` → `Tests 1 passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` lists only: `workers/storage/cloudflare.js`, `workers/case-api/cloudflare.js`, the three new `workers/__tests__/` files, and this plan file (plus anything recorded in `/tmp/immi-014-dirty-before.txt`)
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && BASE=$(git merge-base HEAD main); git diff --stat "$BASE" -- workers/__tests__/case-api-cloudflare.test.js` is empty (diff against the branch point, not `42826a3` — plan 010 edits that file before you)
- [ ] Your report states that no production-cardinality benchmark was run, and quotes the Step 3c `EXPLAIN QUERY PLAN` output
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
- The Worker suite total is anything other than `BEFORE_WORKER + 15` after
  Step 3. Below means a test was lost; above means you added tests this plan did
  not specify — either way, report before continuing. Do not use an absolute
  number here: four sibling plans add tests to this suite.
- Step 3c's equivalence test (test 1) fails. That means the new query does **not**
  return what the old one returned, which is this plan's central claim. Report
  the diff between the two result sets; do not adjust the oracle to match.
- `node:sqlite` is unavailable, so Step 3c cannot be written. Report it
  explicitly and state that the equivalence, syntax and query-plan evidence is
  missing — do not quietly declare Step 3 done on 3a and 3b, which cannot
  produce any of it.
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
- **This is primarily a transfer-size win.** `aggregate_judge_outcome`'s primary
  key is `(judge_id, court_code, outcome)`, so `court_code` is not a prefix and
  `WHERE court_code = ?` would scan on its own. `plans/013-*.md` now declares
  `aggregate_judge_outcome_court_idx ON aggregate_judge_outcome(court_code, judge_id)`
  in `migrations/d1/catalog/0002_read_path_indexes.sql`, which turns the
  court-filtered read into an index scan — but **only once an operator has
  applied that migration.** Until then the court filter is a scan-with-a-WHERE
  and the win is confined to D1 serialising fewer rows and the Worker parsing
  and holding fewer of them. Step 3c test 5 is the check that the index is
  usable; the migration runbook lives in plan 013's Step 9a. Do not add a
  competing migration file here.
- **Outstanding: a production-cardinality benchmark.** Nothing in this plan
  measures latency; the local Miniflare D1 is empty and `CLAUDE.md`'s
  "Performance Baseline (2026-05-05)" is the retired Hyperdrive stack, so there
  is no D1-era number to compare against. Before claiming a win for
  `/api/v1/analytics/judge-leaderboard`, measure against production-like data:
  p50/p95 response time, D1 rows read and response bytes, and Worker CPU time,
  for four request shapes — default (no court, `min_cases=1`), court-filtered,
  `min_cases`-filtered, and both. The default shape is the one to watch: it is
  the most common request and it is the one a careless pushdown makes *slower*
  by adding a window sum and two `HAVING` aggregations that exclude nothing,
  which is why Step 1 branches instead of always emitting them.
- **If `name_q` ever needs to be pushed down**, the safe route is a generated,
  ASCII-folded column on `judges` populated by the aggregate rebuild, not
  `lower()` in the query. Revisit only with a measured cardinality.
- **If a `limit` pushdown is ever wanted**, `analyticsJudgeAggregate` must also
  return a separate total, and `handleAnalyticsJudgeLeaderboard` must report that
  total instead of `result.length`. Test 3 of
  `case-api-judge-leaderboard-pushdown.test.js` exists to make that a deliberate,
  visible change rather than an accident.
- **Deferred out of this plan: the aggregate-rebuild write amplification**
  described under "Findings reconsidered" below. `handleCaseMutationQueue` calls
  `rebuildAggregates()` — 17 full-corpus table rebuilds — once per changed queue
  batch, so a bulk ingest of 10,000 cases at `max_batch_size = 20` triggers ~500
  of them. **This sketch is not an executable plan and must not be mistaken for
  one; someone needs to write that plan.** What is missing from the sketch below
  is precisely what makes it risky: a durable dirty flag, a debounce trigger,
  retention for the aggregate history, monitoring, and a rollback path.
  As a starting point only: once `plans/009-*.md` has landed, replacing the
  direct `stores.caseStore.rebuildAggregates()` call for *data* messages with
  `env.CASE_MUTATION_QUEUE.send({ kind: "catalog.rebuild" })` would let the
  existing `processAggregateRebuild` path (already wired, already covered by
  `cloudflare-native-queue.test.js › rebuilds catalog aggregates for a
  mutation-triggered refresh event`) perform the rebuild, coalescing roughly
  `max_batch_size` rebuilds into one. Note the sketch is not free of hazards
  either: the enqueued rebuild message can itself fail and dead-letter, leaving
  analytics stale with no retry, and it needs the same partial-rebuild
  observability plan 009 adds. True debouncing additionally needs a dirty flag
  plus a cron trigger, which means touching `wrangler.toml` — currently fenced
  off by other plans.

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
