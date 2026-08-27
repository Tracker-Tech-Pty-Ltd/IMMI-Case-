# Plan 010: Stop the monthly-trends win rate diverging from every other analytics endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff cannot
> see uncommitted, staged or untracked work, so on a dirty tree it gives a false
> all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="workers/storage/cloudflare.js workers/case-api/cloudflare.js workers/__tests__/case-api-cloudflare.test.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> **This plan runs second in its lane** (see "Integration order" below), so
> `git diff --stat 42826a3..HEAD` is *expected* to list
> `workers/storage/cloudflare.js` once `plans/009-*.md` has landed — that is not
> drift. What matters is the analytics regions this plan owns. Re-read the
> verbatim excerpts in "Current state" against the live file before editing and
> re-derive the line numbers; on a mismatch in those regions, STOP. Anything
> appearing in the **unstaged** or **staged** diffs is a STOP condition
> regardless. Never run `git checkout --` or `git clean` to tidy the tree — the
> operator may have work in progress.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/009-make-the-mutation-queue-safe.md`. Not because this
  plan needs anything 009 produces, but because 009 rewrites three methods in
  `workers/storage/cloudflare.js` wholesale and every line number in this plan is
  taken from `42826a3`. Landing 010 first would force 009 to re-locate its own
  targets. Rebase on 009's HEAD, then re-derive the line numbers below.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

### Integration order

```
009  →  010 (this plan)  →  013  →  014  →  012
```

All five edit `workers/storage/cloudflare.js` and/or
`workers/case-api/cloudflare.js`; integrate them serially in that order, each
rebased on the previous one's HEAD. `plans/011-*.md` is independent and may run
in parallel.

**Note for whoever integrates 012 and 014 after this plan**: this plan modifies
`workers/__tests__/case-api-cloudflare.test.js` (the store mock in Step 5).
Plans 012 and 014 both declare that file must stay *unmodified* as their
regression signal. That is a contradiction only if it is read as "unmodified
since `42826a3`"; the correct reading after this plan lands is "unmodified **by
you**, relative to the branch you started from". Make that explicit when you
hand 012/014 to their executors.

## Why this matters

`GET /api/v1/analytics/monthly-trends` reports a win rate that is
systematically **inflated** compared with `/api/v1/analytics/success-rate`,
`/api/v1/analytics/visa-families` and the judge endpoints — all of which are
computed from the same corpus. The cause is one missing column: the SQL that
feeds monthly-trends does not select `court_code`, so the shared `isWin()`
helper cannot tell a tribunal row from a court row and falls back to the
**union** of both win sets. That makes `Allowed` count as a tribunal win and
`Remitted` count as a court win, neither of which is true. The primary user of
this product is a self-representing immigration applicant reading the chart to
judge their own odds; an inflated success trend is the single most harmful
thing this analytics page can show them.

The same helper method also scans one D1 table **twice per request** and hands
back three result sets to two callers that each read only one of them — so
fixing the correctness bug also removes two full aggregate-table reads from
every visa-families and monthly-trends request. Finally, one storage method in
the same block (`analyticsScope()`) is an unbounded table scan with no caller
at all; it is deleted here so nobody wires it up by accident.

## Current state

### Files

- `workers/storage/cloudflare.js` — D1 access layer. `CloudflareCaseStore`
  holds every analytics query. The block this plan edits is lines **608–636**
  (`analyticsOutcomes`, `analyticsScope`) plus `analyticsConceptScope` at
  **682–695**.
- `workers/case-api/cloudflare.js` — the read handlers and the route table.
  The analytics handlers this plan edits are at **522–543**
  (`handleAnalyticsOutcomes`), **593–607** (`handleAnalyticsVisaFamilies`),
  **609–629** (`handleAnalyticsMonthlyTrends`), **700–750**
  (`handleAnalyticsSuccessRate`), **752–791**
  (`handleAnalyticsConceptEffectiveness`) and **839–877**
  (`handleAnalyticsConceptTrends`).
- `workers/__tests__/case-api-cloudflare.test.js` — the existing Vitest suite
  for those handlers. It mocks the whole store, so its mock object must be kept
  in sync with the store's method names.

### The bug

`workers/storage/cloudflare.js:608-615` (verbatim):

```js
  async analyticsOutcomes() {
    const [court, year, subclass] = await Promise.all([
      this.db.prepare("SELECT court_code, outcome, case_count AS cnt FROM aggregate_court_year_outcome").all(),
      this.db.prepare("SELECT year AS year_key, outcome, case_count AS cnt FROM aggregate_court_year_outcome").all(),
      this.db.prepare("SELECT visa_subclass, court_code, outcome, case_count AS cnt FROM aggregate_visa").all(),
    ]);
    return { court: rows(court), year: rows(year), subclass: rows(subclass) };
  }
```

Note the middle query: it reads the **same table** as the first one and differs
only in projecting `year AS year_key` instead of `court_code`.

`workers/case-api/cloudflare.js:609-620` (verbatim) consumes exactly those
`year` rows:

```js
async function handleAnalyticsMonthlyTrends(stores) {
  const { year: rows } = await stores.caseStore.analyticsOutcomes();
  const byMonth = {};
  for (const row of rows) {
    const month = `${Number(row.year ?? row.year_key)}-01`;
    byMonth[month] ||= { total: 0, wins: 0 };
    const count = Number(row.cnt || 0);
    byMonth[month].total += count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) byMonth[month].wins += count;
  }
  const series = Object.entries(byMonth).sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({ month, total: values.total, wins: values.wins, win_rate: roundRate(values.wins, values.total) }));
```

`row.court_code` is **always `undefined`** on those rows, so `isWin` is always
called with `""`.

`workers/case-api/cloudflare.js:51-68` (verbatim) — the win sets and the
fallback that makes this wrong:

```js
const TRIBUNAL_CODES = new Set(["AATA", "ARTA", "MRTA", "RRTA"]);
const COURT_CODES = new Set(["FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"]);
const TRIBUNAL_WIN = new Set(["Remitted", "Set Aside", "Granted", "Quashed"]);
const COURT_WIN = new Set(["Allowed", "Set Aside", "Granted", "Quashed"]);
const ALL_WIN = new Set([...TRIBUNAL_WIN, ...COURT_WIN]);
```

```js
function isWin(outcome, courtCode) {
  if (TRIBUNAL_CODES.has(courtCode)) return TRIBUNAL_WIN.has(outcome);
  if (COURT_CODES.has(courtCode)) return COURT_WIN.has(outcome);
  return ALL_WIN.has(outcome);
}
```

Every other caller passes a real court code. `workers/case-api/cloudflare.js:601`
(verbatim, inside `handleAnalyticsVisaFamilies`):

```js
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) wins[family] = (wins[family] || 0) + count;
```

and `workers/case-api/cloudflare.js:718` (verbatim, inside
`handleAnalyticsSuccessRate`):

```js
    const won = isWin(outcome, row.court_code || "");
```

The **local-dev Flask implementation of the same endpoint gets it right**,
which confirms the Worker is the divergent one —
`immi_case_downloader/web/routes/api.py:2518-2520` (verbatim):

```python
        norm = _normalise_outcome(c.outcome)
        if _is_win(norm, c.court_code or ""):
            bucket["wins"] += 1
```

### The wasted work

`workers/case-api/cloudflare.js:594` (verbatim) — `handleAnalyticsVisaFamilies`
throws away two of the three result sets it paid for:

```js
  const { subclass } = await stores.caseStore.analyticsOutcomes();
```

`workers/case-api/cloudflare.js:610` (verbatim) — `handleAnalyticsMonthlyTrends`
does the same:

```js
  const { year: rows } = await stores.caseStore.analyticsOutcomes();
```

Only `handleAnalyticsOutcomes` (`workers/case-api/cloudflare.js:522-543`) reads
all three. Its first line is `workers/case-api/cloudflare.js:523` (verbatim):

```js
  const aggregates = await stores.caseStore.analyticsOutcomes();
```

and it uses them at `workers/case-api/cloudflare.js:535-538` (verbatim):

```js
  const bySubclass = build(aggregates.subclass, "visa_subclass");
  return jsonOk({
    by_court: build(aggregates.court, "court_code"),
    by_year: build(aggregates.year, "year_key"),
```

### The dead method

`workers/storage/cloudflare.js:621-636` (verbatim):

```js
  async analyticsScope({ court = "", yearFrom = 0, yearTo = 0, visaSubclass = "", caseNature = "" } = {}) {
    const clauses = [];
    const params = [];
    if (court) { clauses.push("court_code = ?"); params.push(String(court)); }
    if (visaSubclass) { clauses.push("visa_subclass = ?"); params.push(String(visaSubclass)); }
    if (caseNature) { clauses.push("lower(case_nature) = lower(?)"); params.push(String(caseNature)); }
    if (yearFrom) { clauses.push("year >= ?"); params.push(Number(yearFrom)); }
    if (yearTo) { clauses.push("year <= ?"); params.push(Number(yearTo)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT court_code, year, outcome, visa_subclass, visa_type, source, case_nature,
             has_full_text, case_count AS cnt
      FROM aggregate_scope ${where}
      ORDER BY year ASC, court_code ASC, outcome ASC
    `, params).all());
  }
```

It has **no production caller**. Verified with:

```bash
grep -rn "analyticsScope" workers/ scripts/ immi_case_downloader/ tests/
```

which returns exactly two hits — the definition above and a `vi.fn()` mock at
`workers/__tests__/case-api-cloudflare.test.js:78`. Note it has no `LIMIT`,
unlike its live sibling `analyticsRateRows` (`workers/storage/cloudflare.js:638-653`)
which does the same job with a `GROUP BY`.

### The silent truncation

`workers/storage/cloudflare.js:689-694` (verbatim):

```js
    return rows(await bindAll(this.db, `
      SELECT s.concept_id, c.label AS concept, s.court_code, s.year, s.outcome, s.case_count AS cnt
      FROM aggregate_concept_scope s JOIN concepts c ON c.concept_id = s.concept_id
      ${where}
      ORDER BY s.case_count DESC LIMIT 10000
    `, params).all());
```

`handleAnalyticsConceptTrends` (`workers/case-api/cloudflare.js:839-877`) calls
it with **no arguments** (`workers/case-api/cloudflare.js:841`, verbatim):

```js
  const rows = await stores.caseStore.analyticsConceptScope();
```

and then derives the ±25% "emerging"/"declining" growth percentages from that
capped sample (`workers/case-api/cloudflare.js:870-872`, verbatim):

```js
    const growth = previous === 0 ? (recent > 0 ? 100 : 0) : Math.round(((recent - previous) / previous) * 1000) / 10;
    if (growth > 25) emerging.push({ name: concept, growth_pct: growth, recent_count: recent });
    if (growth < -25) declining.push({ name: concept, decline_pct: growth, recent_count: recent });
```

The response carries no indication that the sample was capped.

### Schema facts you need (do not re-derive)

`migrations/d1/catalog/0001_catalog.sql:137-152` (verbatim):

```sql
CREATE TABLE IF NOT EXISTS aggregate_court_year_outcome (
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (court_code, year, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_visa (
  visa_subclass TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (visa_subclass, court_code, outcome)
);
```

Consequences that make the refactor safe:

- One row per `(court_code, year, outcome)`. The old `court` and `year`
  projections returned the **same row set**, differing only in which column
  they exposed. Grouping the combined rows by `court_code` (or by `year_key`)
  in JS therefore produces byte-identical `by_court` / `by_year` responses.
- `year` is `NOT NULL`, so the `?? row.year_key` fallback at
  `workers/case-api/cloudflare.js:613` never guards against a null year in
  practice.

`migrations/d1/catalog/0001_catalog.sql:229-237` (verbatim):

```sql
CREATE TABLE IF NOT EXISTS aggregate_concept_scope (
  concept_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (concept_id, court_code, year, outcome),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);
```

The table is **already at the finest grain the handlers consume** (they need
`court_code` for `isWin` and `year` for the trend). So "aggregate in SQL so the
cap is not load-bearing" is not available — no `GROUP BY` can shrink the row
count without dropping a dimension a handler reads. That is why this plan makes
the truncation *visible* instead of trying to remove it.

### Repo conventions that apply here

- **Storage boundary**: D1 access lives only in `workers/storage/`. There is a
  test that fails if `env.IMMI_CATALOG_DB` (and friends) is referenced from any
  other Worker file — `workers/__tests__/cloudflare-storage-contracts.test.js:94-100`.
  Keep all SQL inside `workers/storage/cloudflare.js`.
- **Tenant isolation is app-layer** via `CloudflareIdentityStore.assertMembership()`;
  there is no Postgres and no RLS anywhere in this stack. Analytics reads are
  corpus-wide and do not call it — do not add an auth call in this plan.
- **`env.IMMI_CATALOG_DB` is a D1 binding**, not a Postgres connection. There is
  no per-request client to construct.
- **Commit style**: `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`. No AI attribution lines.
- **By design, never "fix"**: the placeholder resource IDs in the checked-in
  `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags
  defaulting to `"false"`; `workers/austlii-scraper/scripts/rollback_run.ts`
  still targeting legacy Supabase.

## Commands you will need

Run every command from the repository root
`/Users/d/Developer/Active Projects/IMMI-Case-` unless the command itself
changes directory.

**Record your own baselines before you change anything.** Four sibling plans add
tests to the same Worker suite, so a hard-coded suite total is wrong the moment
one of them lands and trains you to edit the yardstick instead of the code:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_WORKER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_WORKER=$BEFORE_WORKER"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
BEFORE_FE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_FE=$BEFORE_FE"
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker test suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0, **zero failures**; final total equals `BEFORE_WORKER + 8` |
| One Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/analytics-win-rate.test.js` | exit 0, `Tests 8 passed (8)` — a per-file count, stable regardless of sibling plans |
| Same via Makefile | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers` | identical to the first row |
| Frontend tests (regression check only) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | exit 0, zero failures, total equal to `BEFORE_FE` — this plan changes no frontend file |
| Grep check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "analyticsOutcomes\|analyticsScope" workers/ scripts/ immi_case_downloader/ tests/` | no output |
| Changed-file check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the four in-scope files, plus anything already dirty before you started (record that list first) |

There is no TypeScript or lint gate over `workers/` — it is plain ESM
JavaScript. `make typecheck` and `make lint` cover `frontend/` and Python only;
you do not need them for this plan.

## Scope

**In scope** (the only files you may modify):

- `workers/storage/cloudflare.js` — **only** the analytics query block:
  `analyticsOutcomes` (lines 608–615, replaced), `analyticsScope`
  (lines 621–636, deleted), `analyticsConceptScope` (lines 682–695, return
  shape only). Do not touch any other method.
- `workers/case-api/cloudflare.js` — **only** these handlers:
  `handleAnalyticsOutcomes`, `handleAnalyticsVisaFamilies`,
  `handleAnalyticsMonthlyTrends`, `handleAnalyticsSuccessRate`,
  `handleAnalyticsConceptEffectiveness`, `handleAnalyticsConceptTrends`.
  Do not touch the route table at lines 1057–1092 — no route changes.
- `workers/__tests__/case-api-cloudflare.test.js` — **only** the store mock
  block at lines 70–99 and any assertion that breaks because of it.
- `workers/__tests__/analytics-win-rate.test.js` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `isWin`, `TRIBUNAL_WIN`, `COURT_WIN`, `ALL_WIN`, `normaliseOutcome`
  (`workers/case-api/cloudflare.js:18-68`) — the win-set definitions are
  correct and are shared by the judge, success-rate, concept and visa-family
  endpoints. This plan fixes the *input* to `isWin`, never `isWin` itself.
  Changing a win set would silently move every rate in the product.
- `analyticsRateRows`, `analyticsFilterOptions`, `analyticsFlowRows`,
  `analyticsConceptPairs`, `analyticsJudgeAggregate`
  (`workers/storage/cloudflare.js:638-719`) — adjacent in the file, unrelated to
  this bug.
- The `LIMIT 10000` value itself in `analyticsConceptScope`. Raising it blindly
  risks a D1 response-size failure on the production corpus, and the local
  Miniflare D1 (`.wrangler/state/v3/d1/…`) has **0 rows** in that table, so the
  real cardinality cannot be measured from this working copy. This plan makes
  truncation *reportable*; changing the cap is a separate, operator-informed
  decision. See "Maintenance notes".
- `immi_case_downloader/` and `tests/*.py` — the Flask app is local-dev only
  and its monthly-trends implementation is already correct (quoted above).
- `frontend/` — the SPA consumes `win_rate` from the JSON and needs no change;
  the fix is server-side. `frontend/src/lib/api-analytics.ts:255` and
  `frontend/src/hooks/use-analytics.ts:179` are the consumers, listed here so
  you can confirm they need nothing, not so you can edit them.
- `wrangler.toml`, `workers/cloudflare-native.js`, `migrations/` — no binding,
  entrypoint or schema change is needed.

**Parallel-work note**: another plan may be editing the export handlers in the
same two source files and the same existing test file. Your edits are confined
to the analytics regions listed above; if you find those regions already
changed, that is a drift STOP condition, not a merge exercise.

## Git workflow

- Branch: `advisor/010-fix-analytics-win-rate`
  (`git checkout -b advisor/010-fix-analytics-win-rate` from the current HEAD).
- Commit per step, conventional-commit style. Suggested messages:
  - Step 1–2: `fix: give monthly-trends the court code its win set needs`
  - Step 3: `refactor: drop the unreachable analyticsScope aggregate scan`
  - Step 4: `fix: report when the concept-scope sample is truncated`
  - Step 5: `test: reconcile monthly-trends win totals with success-rate`
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Replace `analyticsOutcomes()` with two single-purpose store methods

In `workers/storage/cloudflare.js`, delete the whole `analyticsOutcomes()`
method (lines 608–615, quoted verbatim in "Current state") and put these two
methods in its place, keeping the surrounding blank-line style of the file:

```js
  /**
   * One scan of aggregate_court_year_outcome. `court_code` is required by the
   * caller so isWin() can pick the tribunal or court win set; `year AS year_key`
   * keeps the by-year grouping key stable for /api/v1/analytics/outcomes.
   */
  async analyticsCourtYearOutcomes() {
    return rows(await this.db.prepare(
      "SELECT court_code, year AS year_key, outcome, case_count AS cnt FROM aggregate_court_year_outcome",
    ).all());
  }

  async analyticsVisaOutcomes() {
    return rows(await this.db.prepare(
      "SELECT visa_subclass, court_code, outcome, case_count AS cnt FROM aggregate_visa",
    ).all());
  }
```

Do not add a back-compat `analyticsOutcomes()` shim — Step 2 moves every
caller, and a leftover shim would keep the double scan alive.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "analyticsCourtYearOutcomes\|analyticsVisaOutcomes\|analyticsOutcomes" workers/storage/cloudflare.js`
→ exactly two hits, one for each new method name, and **no** hit for
`analyticsOutcomes`.

### Step 2: Move the three analytics handlers onto the new methods

All three edits are in `workers/case-api/cloudflare.js`.

**2a — `handleAnalyticsOutcomes` (line 523).** Replace

```js
  const aggregates = await stores.caseStore.analyticsOutcomes();
```

with

```js
  const [courtYear, subclass] = await Promise.all([
    stores.caseStore.analyticsCourtYearOutcomes(),
    stores.caseStore.analyticsVisaOutcomes(),
  ]);
```

then update the three uses (lines 535–538) to read from those two variables:

```js
  const bySubclass = build(subclass, "visa_subclass");
  return jsonOk({
    by_court: build(courtYear, "court_code"),
    by_year: build(courtYear, "year_key"),
```

Leave the `build` helper, the `by_subclass` sort and `by_family: {}` exactly as
they are. The response shape must not change.

**2b — `handleAnalyticsVisaFamilies` (line 594).** Replace

```js
  const { subclass } = await stores.caseStore.analyticsOutcomes();
```

with

```js
  const subclass = await stores.caseStore.analyticsVisaOutcomes();
```

Nothing else in that handler changes.

**2c — `handleAnalyticsMonthlyTrends` (lines 610 and 613).** Replace

```js
  const { year: rows } = await stores.caseStore.analyticsOutcomes();
```

with

```js
  const rows = await stores.caseStore.analyticsCourtYearOutcomes();
```

and change the month key line from

```js
    const month = `${Number(row.year ?? row.year_key)}-01`;
```

to

```js
    const month = `${Number(row.year_key ?? row.year)}-01`;
```

(The new query selects `year AS year_key`; reading that column first states the
intent. Both orderings evaluate identically against the new projection.)

Do **not** touch the `isWin(normaliseOutcome(row.outcome), row.court_code || "")`
line — it is already correct and now finally receives a real court code.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "analyticsOutcomes" workers/case-api/ workers/storage/`
→ no output.

### Step 3: Delete the unreachable `analyticsScope()` method

In `workers/storage/cloudflare.js`, delete the entire `analyticsScope()` method
(lines 621–636 as quoted verbatim in "Current state"), including its trailing
blank line, so that `analyticsNatureOutcome()` is followed directly by
`analyticsRateRows()`.

Do not delete `analyticsRateRows()` — it looks similar (same `aggregate_scope`
table, same filter arguments) but it is the **live** one, called from
`handleAnalyticsSuccessRate`, `handleAnalyticsConceptEffectiveness` and
`handleAnalyticsConceptCooccurrence`.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "analyticsScope" workers/ scripts/ immi_case_downloader/ tests/`
→ exactly one hit: the `analyticsScope: vi.fn(...)` mock at
`workers/__tests__/case-api-cloudflare.test.js:78` (removed in Step 5).

And confirm the live sibling survived:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c "analyticsRateRows" workers/storage/cloudflare.js workers/case-api/cloudflare.js`
→ `workers/storage/cloudflare.js:1` and `workers/case-api/cloudflare.js:3`.

### Step 4: Make the concept-scope truncation reportable

**4a — storage.** In `workers/storage/cloudflare.js`, add a module-level
constant next to the other module constants near the top of the file (place it
immediately after the `rows()`/`changeCount()` helper block, around line 53):

```js
/** Row cap on the concept-scope read. Callers must surface `truncated`. */
const CONCEPT_SCOPE_ROW_LIMIT = 10000;
```

Then change the tail of `analyticsConceptScope` (lines 689–694) from the
verbatim block quoted in "Current state" to:

```js
    // Read one row past the cap so truncation can be DETECTED rather than
    // guessed: `length >= LIMIT` cannot tell "exactly 10,000 rows exist" from
    // "more than 10,000 exist and we truncated", and would report the honest
    // full-corpus case as truncated forever. Fetching LIMIT+1 makes
    // `length > LIMIT` an exact test; the extra row is then discarded.
    const results = rows(await bindAll(this.db, `
      SELECT s.concept_id, c.label AS concept, s.court_code, s.year, s.outcome, s.case_count AS cnt
      FROM aggregate_concept_scope s JOIN concepts c ON c.concept_id = s.concept_id
      ${where}
      ORDER BY s.case_count DESC LIMIT ${CONCEPT_SCOPE_ROW_LIMIT + 1}
    `, params).all());
    const truncated = results.length > CONCEPT_SCOPE_ROW_LIMIT;
    return { rows: truncated ? results.slice(0, CONCEPT_SCOPE_ROW_LIMIT) : results, truncated };
```

`CONCEPT_SCOPE_ROW_LIMIT` is a module constant, never caller input, so
interpolating it (and `+ 1`) into the SQL introduces no injection surface — the
pattern matches the existing `${where}` interpolation of internally-built clauses
on the line above. Do **not** add a `limit` parameter.

Note the row cap the *callers* see is unchanged at 10,000; only the read is one
row wider. `ORDER BY s.case_count DESC` with no tiebreaker means which rows land
at the boundary is not deterministic, but that was already true before this
change and is not made worse by it.

**4b — all three callers surface the flag**, all in
`workers/case-api/cloudflare.js`. A flag that only one of three affected
endpoints reports is not a fix: `/api/v1/analytics/success-rate` and
`/api/v1/analytics/concept-effectiveness` derive numbers from the *same* capped
sample and would keep presenting them as complete. Adding a top-level key is
additive JSON; the SPA ignores unknown fields, and the frontend tests confirm it
(`BEFORE_FE` must not move).

`handleAnalyticsSuccessRate` (lines 706–709) becomes:

```js
  const [baseRows, conceptScope] = await Promise.all([
    stores.caseStore.analyticsRateRows({ court, yearFrom, yearTo, visaSubclass, caseNature }),
    (visaSubclass || caseNature)
      ? Promise.resolve({ rows: [], truncated: false })
      : stores.caseStore.analyticsConceptScope({ court, yearFrom, yearTo }),
  ]);
  const conceptRows = conceptScope.rows;
```

and its `jsonOk({ ... })` response object gains `concepts_truncated: conceptScope.truncated`
as a new top-level key. Do not rename or restructure anything already in that
object; add one key. (It is named `concepts_truncated` rather than `truncated`
here because only the *concept* half of this response is capped — the
success-rate numbers themselves come from `analyticsRateRows`, which is not
truncated. Saying plain `truncated: true` on this endpoint would overstate the
problem.)

`handleAnalyticsConceptEffectiveness` (lines 754–757) becomes:

```js
  const [baseRows, conceptScope] = await Promise.all([
    stores.caseStore.analyticsRateRows(),
    stores.caseStore.analyticsConceptScope(),
  ]);
  const conceptRows = conceptScope.rows;
```

and its response object likewise gains `truncated: conceptScope.truncated` —
plain `truncated` here, because this endpoint's entire payload is derived from
the capped concept sample.

In both handlers every later use of `conceptRows` stays exactly as it is.

`handleAnalyticsConceptTrends` (line 841) becomes:

```js
  const { rows, truncated } = await stores.caseStore.analyticsConceptScope();
```

and its response (line 876) gains the flag:

```js
  return jsonOk({ series, emerging, declining, truncated }, "public, max-age=600, stale-while-revalidate=120");
```

Everything between those two lines is unchanged.

**Verify** (a `grep` for the word `truncated` is not enough — a comment or an
unrelated identifier matches it. Assert on the actual responses instead, which
Step 6 does; here just confirm the wiring):
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "analyticsConceptScope" workers/case-api/cloudflare.js workers/storage/cloudflare.js
```
→ four hits total: the definition in storage plus the three call sites, and each
of the three call sites destructures or reads `.rows`.
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c "conceptScope.truncated" workers/case-api/cloudflare.js
```
→ `2` (success-rate and concept-effectiveness; concept-trends destructures
instead).

### Step 5: Update the existing store mock so the suite reflects the new API

In `workers/__tests__/case-api-cloudflare.test.js`, inside the `stores()`
factory:

1. Replace the `analyticsOutcomes` mock (lines 70–74) with:

```js
      analyticsCourtYearOutcomes: vi.fn(async () => [
        { court_code: "FCA", year_key: 2025, outcome: "Allowed", cnt: 4 },
      ]),
      analyticsVisaOutcomes: vi.fn(async () => [
        { visa_subclass: "189", court_code: "FCA", outcome: "Allowed", cnt: 4 },
      ]),
```

2. Delete the `analyticsScope` mock entirely (lines 78–81).

3. Change the `analyticsConceptScope` mock (lines 96–99) to return the new
   envelope — keep the same two rows:

```js
      analyticsConceptScope: vi.fn(async () => ({
        rows: [
          { concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2025, outcome: "Allowed", cnt: 4 },
          { concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2024, outcome: "Dismissed", cnt: 2 },
        ],
        truncated: false,
      })),
```

Do not change any `it(...)` block in this file, and do not change any expected
value. The three assertions that read these mocks — `by_court.FCA.Allowed` is
`4` (line 517), the `Skilled` family row is `{ total: 4, win_count: 4,
win_rate: 100 }` (line 533) and the monthly series row is `{ month: "2025-01",
total: 4, wins: 4, win_rate: 100 }` (line 537) — all still hold, because `FCA`
is in `COURT_CODES` and `Allowed` is in `COURT_WIN`.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js`
→ exit 0, all tests in that file pass, no `is not a function` error.

### Step 6: Add the regression and reconciliation tests

Create `workers/__tests__/analytics-win-rate.test.js` with the content
below **plus the three additional tests specified after it**, for **8**
`it(...)` blocks in total. The module mock uses
`importOriginal` so the real `createCloudflareCaseStore` is still available for
the SQL-shape test (Vitest 2.1.9 is installed at the repo root and supports
this).

```js
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createCloudflareStores: (...args) => mockCreateStores(...args) };
});

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
import { createCloudflareCaseStore } from "../storage/cloudflare.js";

const ENV = { IMMI_STORAGE_MODE: "cloudflare" };

function url(path) {
  return new URL(`https://immi.example${path}`);
}

// One corpus, expressed in both aggregate tables.
// AATA is a tribunal: only Remitted/Set Aside/Granted/Quashed count as a win,
// so its 10 "Allowed" cases are losses. FCA is a court: only
// Allowed/Set Aside/Granted/Quashed count, so its 3 "Remitted" cases are losses.
// Total 25 cases, 12 wins => 48.0%. Treating court_code as "" would score all
// 25 as wins (100%), which is the bug this file guards.
const COURT_YEAR_ROWS = [
  { court_code: "AATA", year_key: 2024, outcome: "Allowed", cnt: 10 },
  { court_code: "AATA", year_key: 2024, outcome: "Remitted", cnt: 5 },
  { court_code: "FCA", year_key: 2024, outcome: "Allowed", cnt: 7 },
  { court_code: "FCA", year_key: 2024, outcome: "Remitted", cnt: 3 },
];

const SCOPE_ROWS = [
  { court_code: "AATA", year: 2024, outcome: "Allowed", has_full_text: 1, cnt: 10 },
  { court_code: "AATA", year: 2024, outcome: "Remitted", has_full_text: 1, cnt: 5 },
  { court_code: "FCA", year: 2024, outcome: "Allowed", has_full_text: 1, cnt: 7 },
  { court_code: "FCA", year: 2024, outcome: "Remitted", has_full_text: 1, cnt: 3 },
];

function stores({ conceptTruncated = false } = {}) {
  return {
    caseStore: {
      analyticsCourtYearOutcomes: vi.fn(async () => COURT_YEAR_ROWS),
      analyticsVisaOutcomes: vi.fn(async () => [
        { visa_subclass: "866", court_code: "AATA", outcome: "Allowed", cnt: 10 },
      ]),
      analyticsRateRows: vi.fn(async () => SCOPE_ROWS),
      analyticsConceptScope: vi.fn(async () => ({
        rows: [{ concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2024, outcome: "Allowed", cnt: 4 }],
        truncated: conceptTruncated,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateStores.mockReturnValue(stores());
});

async function get(path) {
  return dispatchCloudflareCaseRead(url(path), path.split("?")[0], ENV);
}

describe("analytics win rate", () => {
  it("scores monthly trends with the per-court win set, not the union", async () => {
    const response = await get("/api/v1/analytics/monthly-trends");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toEqual({ month: "2024-01", total: 25, wins: 12, win_rate: 48 });
  });

  it("reconciles monthly-trends win totals with analytics/success-rate", async () => {
    const monthly = await (await get("/api/v1/analytics/monthly-trends")).json();
    const rate = await (await get("/api/v1/analytics/success-rate")).json();
    const monthlyWins = monthly.series.reduce((sum, point) => sum + point.wins, 0);
    const monthlyTotal = monthly.series.reduce((sum, point) => sum + point.total, 0);
    expect(monthlyWins).toBe(rate.success_rate.win_count);
    expect(monthlyTotal).toBe(rate.query.total_matching);
    expect(monthly.series[0].win_rate).toBe(rate.success_rate.overall);
  });

  it("reads only the aggregate each analytics endpoint actually uses", async () => {
    const current = mockCreateStores();
    await get("/api/v1/analytics/monthly-trends");
    expect(current.caseStore.analyticsCourtYearOutcomes).toHaveBeenCalledTimes(1);
    expect(current.caseStore.analyticsVisaOutcomes).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await get("/api/v1/analytics/visa-families");
    expect(current.caseStore.analyticsVisaOutcomes).toHaveBeenCalledTimes(1);
    expect(current.caseStore.analyticsCourtYearOutcomes).not.toHaveBeenCalled();
  });

  it("flags a truncated concept sample on concept-trends", async () => {
    mockCreateStores.mockReturnValue(stores({ conceptTruncated: true }));
    const body = await (await get("/api/v1/analytics/concept-trends")).json();
    expect(body.truncated).toBe(true);

    mockCreateStores.mockReturnValue(stores({ conceptTruncated: false }));
    expect((await (await get("/api/v1/analytics/concept-trends")).json()).truncated).toBe(false);
  });

  it("projects court_code in the court/year aggregate query", async () => {
    const prepared = [];
    const store = createCloudflareCaseStore({
      IMMI_STORAGE_MODE: "cloudflare",
      IMMI_CATALOG_DB: {
        prepare(sql) {
          prepared.push(sql);
          return { all: async () => ({ results: [] }) };
        },
      },
    });
    await store.analyticsCourtYearOutcomes();
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toContain("FROM aggregate_court_year_outcome");
    expect(prepared[0]).toContain("court_code");
    expect(prepared[0]).toContain("year AS year_key");
  });
});
```

Then add these three tests to the same `describe` block:

6. **`reports truncation only when more rows exist than the cap`** — the guard
   against the off-by-one that Step 4a fixes. Build the real store with
   `createCloudflareCaseStore` and a fake catalog binding whose `all()` returns
   a synthetic result set, and drive `analyticsConceptScope()` three times:
   ```js
   function conceptStore(rowCount) {
     const results = Array.from({ length: rowCount }, (_, index) => ({
       concept_id: `c${index}`, concept: "x", court_code: "FCA", year: 2024, outcome: "Allowed", cnt: 1,
     }));
     return createCloudflareCaseStore({
       IMMI_STORAGE_MODE: "cloudflare",
       IMMI_CATALOG_DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }) },
     });
   }
   ```
   Assert:
   - `(await conceptStore(9999).analyticsConceptScope())` → `truncated === false`
     and `rows.length === 9999`;
   - `(await conceptStore(10000).analyticsConceptScope())` → `truncated === false`
     and `rows.length === 10000` — **this is the case the old `>=` test got
     wrong**, and it fails against the pre-change code;
   - `(await conceptStore(10001).analyticsConceptScope())` → `truncated === true`
     and `rows.length === 10000` (the probe row is dropped, not returned).
7. **`flags a truncated concept sample on concept-effectiveness`** — with
   `stores({ conceptTruncated: true })`, `GET /api/v1/analytics/concept-effectiveness`
   returns a body with `truncated === true`; with `conceptTruncated: false` it
   returns `false`. Guards the endpoint the original plan left silent.
8. **`flags a truncated concept sample on success-rate`** — same two states
   against `/api/v1/analytics/success-rate`, asserting on
   `body.concepts_truncated` (the deliberately-different key name; see Step 4b),
   and additionally that `body.success_rate.overall` is unchanged between the two
   states — the flag must not perturb the numbers.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/analytics-win-rate.test.js`
→ exit 0, `Tests 8 passed (8)`.

Prove test 6 is a real regression guard, not a tautology:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git stash push -- workers/storage/cloudflare.js
cd workers && npx vitest run __tests__/analytics-win-rate.test.js -t "reports truncation only when more rows exist than the cap"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git stash pop
```
→ reports `1 failed` while stashed (the pre-change code has no
`analyticsConceptScope` envelope at all, so it fails loudly), and passes after
`stash pop`.

Sanity check that the first test is a real regression guard: temporarily change
`{ court_code: "AATA", year_key: 2024, outcome: "Allowed", cnt: 10 }` in
`COURT_YEAR_ROWS` to drop the `court_code` key, re-run, and confirm the test
**fails** with `wins: 22` instead of `12`. Restore the key immediately
afterwards and re-run to confirm it passes again.

### Step 7: Run the full Worker suite and the frontend suite

**Verify (both must pass)**:

1. `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
   → exit 0, **zero failures**, and the `Tests … passed` total equals
   `BEFORE_WORKER + 8`. This plan adds one file with eight tests and changes no
   existing test count. Do not assert an absolute number: four sibling plans add
   tests to this same suite.
2. `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run`
   → exit 0, zero failures, total equal to `BEFORE_FE` — proves the SPA needed no
   change and that the three added JSON keys broke no consumer.

## Test plan

New file `workers/__tests__/analytics-win-rate.test.js`, five tests:

| Test | Covers |
|---|---|
| "scores monthly trends with the per-court win set, not the union" | The JSCORR-07 regression itself: a mixed tribunal+court month must score 12/25, not 25/25. Fails on today's code. |
| "reconciles monthly-trends win totals with analytics/success-rate" | The cross-endpoint invariant that was broken: two endpoints fed the same corpus from two different aggregate tables must report the same win count, total and rate. |
| "reads only the aggregate each analytics endpoint actually uses" | The PERF-07 half: monthly-trends must not touch `aggregate_visa`, visa-families must not touch `aggregate_court_year_outcome`. |
| "flags a truncated concept sample on concept-trends" | The PERF-15 half: the `truncated` flag reaches the response in both states. |
| "projects court_code in the court/year aggregate query" | Guards the root cause at the SQL layer, where the handler mocks cannot see it. Uses the real `createCloudflareCaseStore` with a fake D1 binding. |

Structural pattern to follow: `workers/__tests__/case-api-cloudflare.test.js`
(module mock of `../storage/cloudflare.js`, a `stores()` factory rebuilt in
`beforeEach`, `dispatchCloudflareCaseRead(url, path, env)` with
`IMMI_STORAGE_MODE: "cloudflare"`). The fake-D1 style in the fifth test follows
`workers/__tests__/cloudflare-storage-contracts.test.js:22-38`.

Existing tests updated, not replaced: the store mock in
`workers/__tests__/case-api-cloudflare.test.js` (Step 5). No expected value in
that file changes.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with zero failures and a total equal to `BEFORE_WORKER + 8`
- [ ] `workers/__tests__/analytics-win-rate.test.js` exists and reports `Tests 8 passed (8)` on its own
- [ ] Each of the eight tests reports `Tests 1 passed` when run with `-t "<title>"` (none reports `0 passed` or `No test files`)
- [ ] The Step 6 stash check showed `reports truncation only when more rows exist than the cap` **failing** against the unmodified `workers/storage/cloudflare.js`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` exits 0 with zero failures and a total equal to `BEFORE_FE`
- [ ] `grep -rn "analyticsOutcomes\|analyticsScope" workers/ scripts/ immi_case_downloader/ tests/` returns no matches
- [ ] `grep -c "analyticsCourtYearOutcomes" workers/storage/cloudflare.js workers/case-api/cloudflare.js` returns `1` and `2`
- [ ] `grep -n "SELECT court_code, year AS year_key, outcome, case_count AS cnt FROM aggregate_court_year_outcome" workers/storage/cloudflare.js` returns exactly one line
- [ ] `grep -c "CONCEPT_SCOPE_ROW_LIMIT + 1" workers/storage/cloudflare.js` returns `1` and `grep -c "results.length >= CONCEPT_SCOPE_ROW_LIMIT" workers/storage/cloudflare.js` returns `0` (the off-by-one detector is gone)
- [ ] `grep -c "conceptScope.truncated" workers/case-api/cloudflare.js` returns `2`
- [ ] `git status --short` lists only: `workers/storage/cloudflare.js`, `workers/case-api/cloudflare.js`, `workers/__tests__/case-api-cloudflare.test.js`, `workers/__tests__/analytics-win-rate.test.js`, this plan's row in `plans/README.md` if that file exists, and anything already dirty before you started
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints any output, or the verbatim excerpts in "Current
  state" do not match the live code — in particular if `analyticsOutcomes()`
  already selects `court_code` in its second query, which would mean this bug
  was fixed by someone else and this plan must be re-scoped.
- `grep -rn "analyticsScope" …` in Step 3 returns a **production** caller
  (anything outside `workers/__tests__/`). The method was verified dead at
  `42826a3`; a live caller means someone wired it up and deleting it would
  break a route.
- Any existing test in `workers/__tests__/case-api-cloudflare.test.js` fails
  with a *changed expected number* (for example `by_court.FCA.Allowed` no longer
  being `4`). That would mean the `by_court`/`by_year` response shape moved,
  which this refactor must not do. Do not "fix" the assertion — report it.
- The monthly-trends or visa-families response gains or loses a top-level JSON
  key. The only intended response changes in this whole plan are three added
  booleans: `truncated` on `/api/v1/analytics/concept-trends` and
  `/api/v1/analytics/concept-effectiveness`, and `concepts_truncated` on
  `/api/v1/analytics/success-rate`.
- The frontend suite total moves off `BEFORE_FE`. The three added keys are
  additive and no frontend file is in scope; a change there means something else
  moved.
- You find yourself needing to edit `isWin`, a win set, `normaliseOutcome`,
  `wrangler.toml`, `workers/cloudflare-native.js`, `migrations/`, or anything
  under `frontend/` or `immi_case_downloader/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise**: that `by_court` and `by_year` in
  `/api/v1/analytics/outcomes` are still built from the *same* row array and
  still key off `court_code` and `year_key` respectively. The schema guarantees
  one row per `(court_code, year, outcome)`, so one array can serve both — if a
  future migration ever adds a second row per key, that assumption breaks and
  the by-year numbers would double-count.
- **The `LIMIT 10000` on `analyticsConceptScope` was deliberately left alone.**
  It is now observable: when `/api/v1/analytics/concept-trends` returns
  `truncated: true`, the emerging/declining growth percentages were computed
  over a top-10,000-by-volume sample, not the whole corpus. The correct next
  move is to (1) measure the real row count with
  `npx wrangler d1 execute <catalog-db> --remote --command "SELECT COUNT(*) FROM aggregate_concept_scope"`,
  and (2) if it exceeds the cap, either raise the cap within D1's response-size
  budget or push the year/court narrowing down into the query for the
  concept-trends call path (it currently passes no filters at all). Note the
  table's primary key is `(concept_id, court_code, year, outcome)` — the exact
  grain the handlers read — so no `GROUP BY` can shrink it for free. The local
  Miniflare D1 has 0 rows, so this cannot be answered from a dev machine.
- **The truncation flag is now on all three affected endpoints**, with two key
  names on purpose: `/api/v1/analytics/concept-trends` and
  `/api/v1/analytics/concept-effectiveness` report `truncated` (their whole
  payload derives from the capped sample), while
  `/api/v1/analytics/success-rate` reports `concepts_truncated` (only its
  concept breakdown does; its headline rate comes from `analyticsRateRows` and
  is not capped). Do not "tidy" these into one name without checking that the
  consumer distinguishes them.
- **REQUIRED follow-up: nothing renders any of these flags yet.** A JSON boolean
  no UI reads does not inform the self-representing applicant reading the
  emerging/declining badges — it only unblocks the person who adds the warning.
  The frontend work is deliberately not in this plan's scope because
  `frontend/src/**` is contested by several concurrent plans (`plans/015-*.md`
  owns the error-state surfaces, `plans/018-*.md` owns the i18n catalogue), and a
  drive-by edit here would conflict. The concrete follow-up, with the files
  already located: add `truncated?: boolean` to `ConceptTrendData` in
  `frontend/src/types/case.ts`; thread it through
  `frontend/src/lib/api-analytics.ts` and `frontend/src/hooks/use-analytics.ts`;
  render a warning above the emerging/declining badges on the analytics page when
  it is true, with a new i18n key in both `en.json` and `zh-TW.json`; add a
  frontend test asserting the warning appears only when the flag is set. Until
  that lands, the flag is operator-visible (via the API and Logpush) but not
  user-visible, and this plan's claim is exactly that and no more.
- **The Flask copy at `immi_case_downloader/web/routes/api.py:2502-2530` is
  local-dev only and was already correct** — it passes `c.court_code or ""` with
  a real value. If the two implementations ever diverge again, the Flask one is
  the reference for win-set semantics.
- **If a new analytics endpoint needs court-aware win rates**, call
  `analyticsCourtYearOutcomes()` (or `analyticsRateRows()` for the filterable
  `aggregate_scope` path) and always pass a real `row.court_code` into
  `isWin()`. Passing `""` silently selects the union of both win sets — that is
  the failure mode this plan removed, and it produces plausible-looking numbers
  rather than an error.

## Findings reconsidered

- **PERF-15, correctness half (the 10,000-row cap being load-bearing)** — kept,
  but **narrowed**. The audit's own fix sketch offered "aggregate in SQL so the
  cap is not load-bearing (GROUP BY concept, year with the cap applied after
  aggregation)". That option does not exist: `aggregate_concept_scope`'s primary
  key is already `(concept_id, court_code, year, outcome)`
  (`migrations/d1/catalog/0001_catalog.sql:229-237`) and every consuming handler
  reads `court_code` (for `isWin`) and `year` (for the trend), so no `GROUP BY`
  reduces the row count. Whether the cap actually bites also could not be
  established: the local Miniflare D1 reports `SELECT COUNT(*) FROM
  aggregate_concept_scope` = 0, and production D1 is not reachable from this
  working copy. This plan therefore implements only the audit's second option —
  return `{ rows, truncated }` and surface the flag — which is correct whether
  or not the cap is currently hit, and records the measurement command in
  "Maintenance notes".
- **The `Number(row.year ?? row.year_key)` nit** (verifier's note that
  `Number(null) === 0` rather than `NaN`) — real but **inert**, so no defensive
  guard was added. `aggregate_court_year_outcome.year` is `INTEGER NOT NULL`
  (`migrations/d1/catalog/0001_catalog.sql:139`), so the fallback never fires on
  a null. Step 2c only reorders the two operands to read the column the query
  actually selects; behaviour is unchanged.

## Review points not applied

Everything the reviewer raised about this plan is applied above, with one
scope-bounded exception recorded here rather than silently dropped.

- **"The truncation must reach actual users: update `ConceptTrendData`, the
  chart, the emerging/declining badges, the translations and the frontend
  tests."** The diagnosis is correct and is not disputed: `ConceptTrendData`
  (`frontend/src/types/case.ts`) has no `truncated` field, so today nothing in
  the SPA can render the flag. This plan therefore now surfaces the flag on
  **all three** affected endpoints instead of one (Step 4b), and fixes the
  off-by-one that made the flag itself unreliable (Step 4a) — the server-side
  half is fully applied. The **frontend half is deferred**, not rejected, on
  file-territory grounds: `frontend/src/**` is claimed by concurrent plans
  (`plans/015-*.md` for error surfaces, `plans/018-*.md` for the i18n
  catalogue), and adding a warning banner plus two locale keys from inside an
  analytics-correctness plan would produce a merge conflict in files this plan
  does not own. The exact follow-up — file by file, including the i18n keys and
  the test to add — is written out under "Maintenance notes", and the plan no
  longer claims the truncation is user-visible.
