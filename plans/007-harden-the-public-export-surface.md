# Plan 007: Authenticate, throttle and sanitise the bulk export endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
>   git diff --stat 42826a3..HEAD -- workers/case-api/cloudflare.js workers/storage/cloudflare.js workers/__tests__/case-api-cloudflare.test.js workers/__tests__/cloudflare-storage-contracts.test.js
> ```
> Expected at the time of writing: **no output** (nothing changed). If any
> in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`/api/v1/export/csv` and `/api/v1/export/json` are the only endpoints in this
Worker that hand a caller tens of thousands of case rows in one response. The
Flask implementation these routes replaced had three deliberate security
controls on it — a 5,000-row cap recorded as security work `sec-008`, an
hourly rate limit, and an audit log line. The Cloudflare Worker that took over
production traffic restored the pre-`sec-008` 50,000-row cap and shipped none
of the three. On top of that, every export row publishes the internal R2
object key of the case's full text, and the CSV writer does not neutralise
spreadsheet formula characters — so a case field scraped from AustLII, or a
`user_notes` value written through the mutation API, can execute as a formula
when a self-representing immigration applicant opens the download in Excel or
Google Sheets.

This plan restores the controls that can be restored inside the export code
itself: the 5,000-row cap, the audit log, removal of the R2 key, and CSV
formula neutralisation. Authentication and rate limiting are **deliberately
deferred** — see "Findings reconsidered" for exactly why and what the
follow-up is.

## Current state

### Files this plan touches

- `workers/case-api/cloudflare.js` — Cloudflare-native GET read handlers.
  Contains `EXPORT_FIELDS` (lines 56–62), `csvCell` (99–102), `handleExport`
  (124–142), `publicCase` (152–156), and the router
  `dispatchCloudflareCaseRead` (1029–1168) which mounts the two export routes
  at lines 1063–1064.
- `workers/storage/cloudflare.js` — D1/R2/Vectorize access layer. Contains
  `LEGACY_CASE_PROJECTION` (89–116), `compatPageNumber` (130–134),
  `compatCaseFilters` (136–175) and `CloudflareCaseStore.exportCases`
  (513–524).
- `workers/__tests__/case-api-cloudflare.test.js` — Vitest suite for the read
  router. Currently **20 tests, all passing**. The export test is at lines
  407–421.
- `workers/__tests__/cloudflare-storage-contracts.test.js` — Vitest suite for
  the storage layer, with a D1 mock that records every prepared statement.

### The export handler as it exists today

`workers/case-api/cloudflare.js:124-142` (verbatim):

```js
async function handleExport(url, stores, format) {
  const limit = intParam(url.searchParams.get("limit"), 50000, 1, 50000);
  const rows = await stores.caseStore.exportCases({ filters: requestFilters(url.searchParams), limit });
  const values = rows.map((row) => {
    const publicRow = publicCase(row);
    return { ...publicRow, full_text_path: row.content_key || null, visa_outcome_reason: row.visa_outcome_reason || "" };
  });
  const filename = `immigration_cases_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.${format}`;
  if (format === "json") {
    return new Response(JSON.stringify({ cases: values }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  }
  const lines = ["\uFEFF" + EXPORT_FIELDS.join(",")];
  for (const row of values) lines.push(EXPORT_FIELDS.map((field) => csvCell(row[field])).join(","));
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
```

Note: the default limit **equals** the maximum, so a caller who omits `limit`
gets 50,000 rows.

### The CSV cell writer as it exists today

`workers/case-api/cloudflare.js:99-102` (verbatim):

```js
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
```

A value beginning with `=`, `+`, `-`, `@`, TAB or CR is emitted raw. `csvCell`
is used **only** by `handleExport` (verified: the only references in
`workers/` are its definition at line 99 and its call at line 138).

### The export field list as it exists today

`workers/case-api/cloudflare.js:56-62` (verbatim):

```js
const EXPORT_FIELDS = Object.freeze([
  "case_id", "citation", "title", "court", "court_code", "date", "year", "url", "judges",
  "catchwords", "outcome", "visa_type", "legislation", "text_snippet", "full_text_path",
  "source", "user_notes", "tags", "case_nature", "legal_concepts", "visa_subclass",
  "visa_class_code", "applicant_name", "respondent", "country_of_origin", "visa_subclass_number",
  "hearing_date", "is_represented", "representative", "visa_outcome_reason",
]);
```

`EXPORT_FIELDS` is referenced **only** at lines 137 and 138 (the CSV header
and the CSV rows). `full_text_path` is at index 14. `user_notes` (index 16)
and `tags` (index 17) are writable through the mutation API; `catchwords`,
`text_snippet` and `representative` are scraped third-party text.

### The public row projection as it exists today

`workers/case-api/cloudflare.js:152-156` (verbatim):

```js
function publicCase(row) {
  if (!row) return row;
  const { content_key, content_sha256, content_size, semantic_ready, vector_mutation_id, ...response } = row;
  return { ...response, full_text_path: response.full_text_path ?? content_key ?? null };
}
```

`publicCase` strips `content_key`/`content_sha256`/`content_size` but then
re-publishes the key under the name `full_text_path`. It is shared by every
read endpoint (`/api/v1/cases`, case detail, compare, related, semantic) — do
**not** change `publicCase` itself in this plan; see "Out of scope".

### The D1 export query as it exists today

`workers/storage/cloudflare.js:513-524` (verbatim):

```js
  async exportCases({ filters = {}, limit = 50000 } = {}) {
    const size = compatPageNumber(limit, 50000, 1, 50000);
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}, c.url, c.visa_outcome_reason,
             c.content_key, c.content_sha256, c.content_size
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
  }
```

There is **no** `OFFSET` and no cursor: the query is LIMIT-only. `exportCases`
is called from exactly one place — `handleExport` at
`workers/case-api/cloudflare.js:126`.

`LEGACY_CASE_PROJECTION` (`workers/storage/cloudflare.js:89-116`) already
selects `c.url` (line 95), `c.visa_outcome_reason` (line 96) and
`c.content_key AS full_text_path` (line 97), so the three extra columns on
line 518 are **duplicates** and lines 518–519's `c.content_key,
c.content_sha256, c.content_size` exist only to feed `handleExport`'s explicit
re-attach. `LEGACY_CASE_PROJECTION` also builds the `judges` (lines 98–106)
and `legal_concepts` (107–115) columns from correlated subqueries — the export
genuinely needs both, because `EXPORT_FIELDS` lists `"judges"` and
`"legal_concepts"`. Do not remove those subqueries.

### The control that was lost — the Flask exporter this Worker replaced

`immi_case_downloader/web/routes/api_export.py:1-6` and `:24-39` (verbatim):

```python
"""Export endpoints — /api/v1/export/csv and /api/v1/export/json.

Extracted from api.py as cq-001 Phase A.
Security: MAX_EXPORT_ROWS reduced from 50 000 → 5 000 (sec-008 step-2).
Audit: every export logs IP, filters, and row count (sec-008 step-3).
"""
```

```python
# Hard cap on export size — reduces risk of data exfiltration and memory spikes.
# Raised from 50 000 to 5 000 as part of sec-008.
MAX_EXPORT_ROWS = 5_000


@api_export_bp.route("/export/csv")
@rate_limit(5, 3600, scope="export-csv")
def export_csv():
    repo = get_repo()
    cases = _filter_cases(repo.load_all(), request.args)[:MAX_EXPORT_ROWS]
    logger.info(
        "audit export_csv ip=%s filters=%s rows=%d",
        request.remote_addr,
        dict(request.args),
        len(cases),
    )
```

This Flask module is **local-dev only** and is not in the production request
path. It is quoted here as the source of the 5,000 number and the audit-log
shape, not as something to edit. Do not modify it in this plan.

### Why authentication cannot be added inside this plan's files

`workers/case-api/cloudflare.js:1029` (verbatim signature):

```js
export async function dispatchCloudflareCaseRead(url, path, env) {
```

The read dispatcher receives **no `Request` object** — only a parsed `URL`, the
path string, and `env`. There is therefore no `Authorization` header and no
`CF-Connecting-IP` reachable from `handleExport`. Its single caller is
`workers/cloudflare-native.js:231`:

```js
      const response = await dispatchCloudflareCaseRead(url, path, env);
```

Adding auth or an IP-keyed rate limit requires changing that signature in
`workers/cloudflare-native.js`, which is out of this plan's file territory.
See "Findings reconsidered" and "Maintenance notes".

### Repo conventions this plan must match

- **Structured logs** — Worker handlers emit one-line JSON:
  `console.error(JSON.stringify({ event: "case.cloudflare.read_error", error: err?.message }))`
  at `workers/case-api/cloudflare.js:1165`, and
  `console.log(JSON.stringify({ event: "auth.telegram.fail", reason: tgResult.reason }))`
  at `workers/auth/handlers.js:277`. Match this `event`-first shape.
- **Storage-boundary rule** — a Vitest contract test at
  `workers/__tests__/cloudflare-storage-contracts.test.js:94-100` fails the
  build if `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` /
  `IMMI_CONTENT` / `CASE_VECTORS` / `AI` is referenced from any `workers/**.js`
  file outside `workers/storage/`. Do not reference a D1/R2/Vectorize binding
  from `workers/case-api/cloudflare.js`.
- **Commit convention** — `<type>: <description>` with type in
  feat|fix|refactor|docs|test|chore|perf|ci. Real examples from `git log`:
  `fix: install root node_modules in make install`,
  `ci: stop ignoring the separation preflight suite`. No AI attribution lines.
- **Tenant isolation is app-layer** — there is no Postgres and no RLS in this
  stack; `env.IMMI_CATALOG_DB` etc. are D1 bindings.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (this plan's gate) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | `345 passed` / 25 files at HEAD; **349 passed** / 25 files after this plan |
| Just the read-router suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js` | `20 passed` at HEAD; **23 passed** after this plan |
| Just the storage suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-contracts.test.js` | `13 passed` at HEAD; **14 passed** after this plan |
| Frontend tests (regression sanity) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | `490 passed`, 55 files — unchanged |
| Python tests (regression sanity, optional) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | `1141 passed, 3 failed, 7 skipped` — **identical to HEAD**; the 3 failures are a pre-existing Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch in `tests/test_backfill_judge_overrides_from_pdf.py` and are **not** caused by this plan |
| Confirm nothing outside scope changed | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the 4 in-scope files listed |

Notes: the Worker suite has no `workers/package.json`; `npx vitest run` from
`workers/` picks up `workers/vitest.config.js`. Vitest version is 2.1.9.

## Scope

**In scope** (the only files you may modify):

- `workers/case-api/cloudflare.js` — `EXPORT_FIELDS`, `csvCell`, `handleExport`
  only.
- `workers/storage/cloudflare.js` — `CloudflareCaseStore.exportCases` only
  (lines 513–524).
- `workers/__tests__/case-api-cloudflare.test.js` — update the existing export
  test, add new ones.
- `workers/__tests__/cloudflare-storage-contracts.test.js` — add one test.

**Out of scope** (do NOT touch, even though they look related):

- `workers/cloudflare-native.js` — passing a `Request` into
  `dispatchCloudflareCaseRead` so the export can authenticate or rate-limit is
  a real follow-up, but it changes a shared entrypoint that other work is
  editing in parallel. Deferred on purpose; see "Maintenance notes".
- `wrangler.toml` — declaring a rate-limiter binding here would have to pass
  `scripts/check_cloudflare_native_target.py` and
  `scripts/check_immi_activation_evidence.py`, the fail-closed config gates.
  Its placeholder resource IDs and the `"false"` defaults for
  `IMMI_CASE_MUTATIONS_ENABLED` / pipeline flags are **by design** — never
  "fix" them.
- `publicCase` (`workers/case-api/cloudflare.js:152-156`) and
  `LEGACY_CASE_PROJECTION` (`workers/storage/cloudflare.js:89-116`) — both are
  shared by `/api/v1/cases`, case detail, compare, related and semantic search.
  Changing either would rewrite every read response and break tests at
  `workers/__tests__/case-api-cloudflare.test.js:172-173` and `:194`. This plan
  strips the R2 key **in the export payload only**.
- `immi_case_downloader/web/routes/api_export.py` and every `tests/*.py` file —
  the Flask exporter is local-dev only and has its own CSV-injection gap. It is
  a separate, lower-priority fix; noted in "Maintenance notes".
- `frontend/` — `downloadExportFile` at `frontend/src/lib/api.ts:1345` is
  `@deprecated` with a comment recording that UI entry points were removed on
  2026-05-05, and a repo-wide grep confirms it has **no callers**. Do not
  re-add export UI.

## Git workflow

- Branch: `advisor/007-harden-the-public-export-surface`
  (`git checkout -b advisor/007-harden-the-public-export-surface`).
- One commit per step, message style `<type>: <description>` — e.g.
  `fix: neutralise spreadsheet formula prefixes in worker CSV export`.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Neutralise spreadsheet formula prefixes in `csvCell`

In `workers/case-api/cloudflare.js`, add a module-level constant immediately
above `csvCell` (which is at line 99) and rewrite `csvCell` so that any value
whose first character is `=`, `+`, `-`, `@`, TAB (`\t`) or CR (`\r`) is both
force-quoted **and** prefixed with a single apostrophe, while existing quoting
behaviour is unchanged for everything else:

```js
// A leading =, +, -, @, TAB or CR makes Excel/Sheets treat the cell as a
// formula. Force-quote and prefix an apostrophe so the value stays inert data.
const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (CSV_FORMULA_PREFIX_RE.test(text)) return `"'${text.replace(/"/g, '""')}"`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
```

Do not change `intParam`, `requestFilters` or any other helper in this step.

Then add a test to `workers/__tests__/case-api-cloudflare.test.js`. Put it
directly after the existing `it("exports JSON and CSV from the native catalog
boundary", ...)` block (which currently ends at line 421). Model it on that
block's structure: override the `exportCases` mock for one call, dispatch, read
the body. Name it
`it("neutralises spreadsheet formula prefixes in the CSV export", ...)` and
assert all five dangerous prefixes plus one control case:

```js
  it("neutralises spreadsheet formula prefixes in the CSV export", async () => {
    const current = mockCreateStores();
    current.caseStore.exportCases.mockResolvedValueOnce([
      { case_id: CASE_ID, title: "=HYPERLINK(\"http://evil\",\"click\")", user_notes: "+1+1", tags: "-2+3", catchwords: "@SUM(A1)", representative: "\tcmd", citation: "[2025] FCA 1" },
    ]);
    const csv = await dispatchCloudflareCaseRead(
      url("/api/v1/export/csv?limit=1"), "/api/v1/export/csv", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    const body = await csv.text();
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(body).toContain(`"'+1+1"`);
    expect(body).toContain(`"'-2+3"`);
    expect(body).toContain(`"'@SUM(A1)"`);
    expect(body).toContain(`"'\tcmd"`);
    // A benign value is still written unquoted.
    expect(body).toContain("[2025] FCA 1");
  });
```

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js`
→ `21 passed` (was 20), 0 failed.

### Step 2: Cut the export row cap from 50,000 to 5,000

Two edits, both mechanical.

**2a.** `workers/case-api/cloudflare.js:125` — replace

```js
  const limit = intParam(url.searchParams.get("limit"), 50000, 1, 50000);
```

with

```js
  // sec-008 cap: the Flask exporter this route replaced truncates at 5 000
  // rows (immi_case_downloader/web/routes/api_export.py MAX_EXPORT_ROWS).
  const limit = intParam(url.searchParams.get("limit"), MAX_EXPORT_ROWS, 1, MAX_EXPORT_ROWS);
```

and add, immediately above `const EXPORT_FIELDS = Object.freeze([` at line 56:

```js
const MAX_EXPORT_ROWS = 5000;
```

Leave `intParam` itself (lines 104–108) untouched — it is shared by
`handleSearch`, the `/similar` and `/related` routes, and others.

**2b.** `workers/storage/cloudflare.js:513-514` — replace

```js
  async exportCases({ filters = {}, limit = 50000 } = {}) {
    const size = compatPageNumber(limit, 50000, 1, 50000);
```

with

```js
  async exportCases({ filters = {}, limit = MAX_EXPORT_ROWS } = {}) {
    const size = compatPageNumber(limit, MAX_EXPORT_ROWS, 1, MAX_EXPORT_ROWS);
```

and add a module-level constant immediately below `const
LEGACY_CASE_PROJECTION = \`...\`;` (which ends at line 116):

```js
// Hard server-side cap on a single export, independent of the caller's limit.
const MAX_EXPORT_ROWS = 5000;
```

Leave `compatPageNumber` (lines 130–134) untouched — it is shared by
`compatCaseFilters` and `listPage`.

Then add one test to `workers/__tests__/cloudflare-storage-contracts.test.js`,
inside the existing `describe("Cloudflare store factory", ...)` block. Model it
on the existing test `it("uses D1 bound values for lexical search and never
interpolates query text", ...)` — build `env()`, call `createCloudflareStores`,
invoke the store method, then inspect `value.IMMI_CATALOG_DB.calls`:

```js
  it("clamps a bulk export to the 5 000-row server cap", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    await stores.caseStore.exportCases({ filters: {}, limit: 50000 });
    const statement = value.IMMI_CATALOG_DB.calls.find((item) => item.sql.includes("ORDER BY c.year DESC"));
    expect(statement.params.at(-1)).toBe(5000);
  });
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -rn "50000" workers/case-api/cloudflare.js workers/storage/cloudflare.js
```
→ **no output** (exit 1). Then
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-contracts.test.js`
→ `14 passed` (was 13), 0 failed.

### Step 3: Stop publishing the internal R2 object key in the export payload

The export currently emits the R2 content key of each case's full text under
the column name `full_text_path`. Replace it with a boolean-valued
`has_full_text` column that keeps the useful signal without publishing the key.

**3a.** `workers/case-api/cloudflare.js` — in `EXPORT_FIELDS` (lines 56–62),
replace the string `"full_text_path"` (index 14, on the line beginning
`"catchwords", "outcome", ...`) with `"has_full_text"`. Change nothing else in
the list; keep the position and the rest of the order exactly as-is.

**3b.** `workers/case-api/cloudflare.js` — in `handleExport`, replace the
`values` mapping (lines 127–130) with:

```js
  const values = rows.map((row) => {
    // Drop full_text_path: LEGACY_CASE_PROJECTION aliases the internal R2
    // object key to that name, and the export must not publish it.
    const { full_text_path, ...publicRow } = publicCase(row);
    return { ...publicRow, has_full_text: full_text_path ? 1 : 0, visa_outcome_reason: row.visa_outcome_reason || "" };
  });
```

**3c.** `workers/storage/cloudflare.js` — in `exportCases`, replace the SELECT
list (lines 518–519):

```js
      SELECT ${LEGACY_CASE_PROJECTION}, c.url, c.visa_outcome_reason,
             c.content_key, c.content_sha256, c.content_size
```

with just:

```js
      SELECT ${LEGACY_CASE_PROJECTION}
```

This is safe and lossless: `LEGACY_CASE_PROJECTION` already selects `c.url`
(line 95) and `c.visa_outcome_reason` (line 96), so those two were duplicate
columns, and `c.content_key`/`c.content_sha256`/`c.content_size` existed only
to feed the re-attach you removed in 3b. Keep `FROM`, `WHERE`, `ORDER BY` and
`LIMIT ?` exactly as they are. **Do not** remove the `judges` or
`legal_concepts` correlated subqueries from `LEGACY_CASE_PROJECTION` — the
export needs both columns.

**3d.** Update the existing test
`it("exports JSON and CSV from the native catalog boundary", ...)` at
`workers/__tests__/case-api-cloudflare.test.js:407-421`. Its current assertion
is:

```js
    expect((await json.json()).cases[0]).toMatchObject({ case_id: CASE_ID, full_text_path: "cases/0123456789ab/source/abc.txt" });
```

Replace that single line with:

```js
    const exported = (await json.json()).cases[0];
    expect(exported).toMatchObject({ case_id: CASE_ID, has_full_text: 1 });
    expect(exported).not.toHaveProperty("full_text_path");
    expect(exported).not.toHaveProperty("content_key");
```

Leave the rest of that test (the CSV half and the `exportCases` call
assertion) unchanged.

**3e.** Add one more test after it, asserting the CSV header changed and the
key never appears in the CSV body:

```js
  it("never publishes the internal R2 object key in an export", async () => {
    const csv = await dispatchCloudflareCaseRead(
      url("/api/v1/export/csv?limit=1"), "/api/v1/export/csv", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    const body = await csv.text();
    expect(body).toContain("has_full_text");
    expect(body).not.toContain("full_text_path");
    expect(body).not.toContain("cases/0123456789ab/source/abc.txt");
  });
```

(The default `exportCases` mock at `workers/__tests__/case-api-cloudflare.test.js:63-67`
already returns `content_key: "cases/0123456789ab/source/abc.txt"`, so this
test is meaningful without any extra mock setup.)

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -n "full_text_path: row.content_key" workers/case-api/cloudflare.js
```
→ **no output** (exit 1). Then
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js`
→ `22 passed` (21 after step 1, +1 from step 3e), 0 failed.

### Step 4: Restore the export audit log line

The Flask exporter logged the caller's IP, the filters, and the row count on
every export (`immi_case_downloader/web/routes/api_export.py:34-39`). The
Worker cannot log the IP — `dispatchCloudflareCaseRead` receives no `Request`
(see "Current state") — but it can and must log the format, the effective
limit, the filters and the row count.

In `workers/case-api/cloudflare.js`, add this helper immediately above
`handleExport`:

```js
// Filter values are already length-bounded by the storage layer; truncate
// anyway so one audit line can never dominate the log stream.
function auditFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== 0)
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 64) : value]),
  );
}
```

Then in `handleExport`, hoist the filters into a local and emit the audit line
after the rows are projected. The first four lines of the function become:

```js
async function handleExport(url, stores, format) {
  // sec-008 cap: the Flask exporter this route replaced truncates at 5 000
  // rows (immi_case_downloader/web/routes/api_export.py MAX_EXPORT_ROWS).
  const limit = intParam(url.searchParams.get("limit"), MAX_EXPORT_ROWS, 1, MAX_EXPORT_ROWS);
  const filters = requestFilters(url.searchParams);
  const rows = await stores.caseStore.exportCases({ filters, limit });
```

and immediately after the `const values = rows.map(...)` block from step 3b,
insert:

```js
  console.log(JSON.stringify({ event: "case.export", format, limit, filters: auditFilters(filters), rows: values.length }));
```

Do not log any row content — only the counts and the filters.

Add the matching test to `workers/__tests__/case-api-cloudflare.test.js`, after
the test added in step 3e:

```js
  it("audits every export with format, limit, filters and row count", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await dispatchCloudflareCaseRead(
        url("/api/v1/export/json?limit=10&court=FCA"), "/api/v1/export/json",
        { IMMI_STORAGE_MODE: "cloudflare" },
      );
      const entries = logSpy.mock.calls.map(([line]) => JSON.parse(line));
      expect(entries).toContainEqual({
        event: "case.export", format: "json", limit: 10, filters: { court: "FCA" }, rows: 1,
      });
    } finally {
      logSpy.mockRestore();
    }
  });
```

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/case-api-cloudflare.test.js`
→ `23 passed` (20 baseline + 3 new), 0 failed.

### Step 5: Full-suite regression check

Run the whole Worker suite and the frontend suite. Nothing in `frontend/` or
`immi_case_downloader/` was touched, so both must be unchanged.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run
```
→ `Test Files 25 passed (25)`, `Tests 349 passed (349)` (345 at HEAD + 3 new in
`case-api-cloudflare.test.js` + 1 new in `cloudflare-storage-contracts.test.js`).

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run
```
→ `490 passed`, 55 files — identical to HEAD.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ exactly four modified files:
`workers/case-api/cloudflare.js`, `workers/storage/cloudflare.js`,
`workers/__tests__/case-api-cloudflare.test.js`,
`workers/__tests__/cloudflare-storage-contracts.test.js`, plus the new
untracked `plans/007-harden-the-public-export-surface.md`.

## Test plan

New tests, all in the Worker Vitest suite (run with
`cd workers && npx vitest run`):

In `workers/__tests__/case-api-cloudflare.test.js` (structural pattern: the
existing `it("exports JSON and CSV from the native catalog boundary", ...)` at
lines 407–421 — it builds `const current = mockCreateStores()`, dispatches via
`dispatchCloudflareCaseRead(url(path), path, { IMMI_STORAGE_MODE: "cloudflare" })`,
then asserts on the response and the store mock):

1. `neutralises spreadsheet formula prefixes in the CSV export` — one case row
   whose `title` starts `=`, `user_notes` starts `+`, `tags` starts `-`,
   `catchwords` starts `@`, `representative` starts TAB. Asserts each is
   force-quoted and apostrophe-prefixed, and that a benign `citation` value is
   still written plainly.
2. `never publishes the internal R2 object key in an export` — CSV body
   contains `has_full_text`, contains neither `full_text_path` nor the mock's
   `cases/0123456789ab/source/abc.txt`.
3. `audits every export with format, limit, filters and row count` — spies on
   `console.log`, asserts exactly one parsed entry equal to
   `{ event: "case.export", format: "json", limit: 10, filters: { court: "FCA" }, rows: 1 }`.
4. Modified: `exports JSON and CSV from the native catalog boundary` — the
   `full_text_path` assertion becomes `has_full_text: 1` plus two
   `not.toHaveProperty` assertions.

In `workers/__tests__/cloudflare-storage-contracts.test.js` (structural
pattern: `it("uses D1 bound values for lexical search and never interpolates
query text", ...)` — it builds `const value = env()`, calls
`createCloudflareStores(value)`, invokes the store method, then finds the
recorded statement in `value.IMMI_CATALOG_DB.calls`):

5. `clamps a bulk export to the 5 000-row server cap` — calls
   `exportCases({ filters: {}, limit: 50000 })` and asserts the last bound
   parameter of the `ORDER BY c.year DESC` statement is `5000`. This is the
   regression guard: it fails if anyone raises the cap in the handler without
   raising it in the store, or vice versa.

Regression coverage that must stay green untouched:
`workers/__tests__/case-api-cloudflare.test.js:172-173` and `:194` assert that
`/api/v1/cases` and case-detail responses still expose `full_text_path` and
never `content_key` — proof that this plan did not disturb `publicCase` for the
other read endpoints.

Verification: `cd workers && npx vitest run` → 25 files, **349 passed**
(345 baseline + 4 new: 3 in `case-api-cloudflare.test.js`, 1 in
`cloudflare-storage-contracts.test.js`; test 4 above modifies an existing test
and does not change the count).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with `Tests 349 passed (349)` across `25 passed (25)` files
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` exits 0 with `490 passed` — unchanged from HEAD
- [ ] `grep -rn "50000" workers/case-api/cloudflare.js workers/storage/cloudflare.js` returns no matches
- [ ] `grep -n "full_text_path: row.content_key" workers/case-api/cloudflare.js` returns no matches
- [ ] `grep -n "MAX_EXPORT_ROWS = 5000" workers/case-api/cloudflare.js workers/storage/cloudflare.js` returns exactly 2 matches (one per file)
- [ ] `grep -n "CSV_FORMULA_PREFIX_RE" workers/case-api/cloudflare.js` returns exactly 2 matches (the definition and its use in `csvCell`)
- [ ] `grep -n '"case.export"' workers/case-api/cloudflare.js` returns exactly 1 match
- [ ] `grep -n "has_full_text" workers/case-api/cloudflare.js` returns exactly 2 matches (`EXPORT_FIELDS` and the `values` mapping)
- [ ] `grep -n "AS judges" workers/storage/cloudflare.js` still returns a match — the `judges` subquery in `LEGACY_CASE_PROJECTION` was not removed
- [ ] `git status --short` shows only the four in-scope files modified, plus this untracked plan file
- [ ] `git diff --stat 42826a3..HEAD -- workers/cloudflare-native.js wrangler.toml immi_case_downloader/ frontend/` returns no output

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check produces output, or any excerpt in "Current state" does not
  match the live file byte-for-byte at the stated line numbers.
- `dispatchCloudflareCaseRead` no longer has the signature `(url, path, env)`
  at `workers/case-api/cloudflare.js:1029` — someone has already plumbed a
  `Request` through, which changes the whole auth/rate-limit calculus in this
  plan. Report and wait.
- `csvCell` or `EXPORT_FIELDS` gained a second caller anywhere in `workers/`
  (check with `grep -rn "csvCell\|EXPORT_FIELDS" workers/`). Both are export-only
  today; a second caller means this plan's changes have reach it did not
  account for.
- Any test outside the two Worker test files listed in Scope starts failing —
  in particular `workers/__tests__/cloudflare-storage-contracts.test.js`'s
  `keeps Cloudflare data bindings inside the storage boundary`, which fires if
  a D1/R2/Vectorize binding is referenced from outside `workers/storage/`.
- The Worker suite total drops below 345, or the frontend suite total moves off
  490.
- You conclude the fix needs `workers/cloudflare-native.js` or `wrangler.toml`.
  It does not, for these four steps. If you think it does, stop and report
  rather than editing either file.
- `make test-py` reports anything other than `1141 passed, 3 failed, 7 skipped`.
  The 3 failures are a known Homebrew Python 3.14.7 `pyexpat` ABI problem in
  `tests/test_backfill_judge_overrides_from_pdf.py` — a different count means
  something unrelated moved.

## Maintenance notes

For the human or agent who owns this code next:

- **The deferred half of this work is authentication and throttling.** The
  export routes remain reachable by any anonymous GET. Closing that requires,
  in one change: (1) widening `dispatchCloudflareCaseRead(url, path, env)` to
  accept the `Request`, (2) updating its single call site at
  `workers/cloudflare-native.js:231`, (3) gating `handleExport` on a verified
  JWT or on a rate-limiter binding. The exemplar for the binding already exists
  in this repo — `applyRateLimit` at
  `workers/llm-council/cloudflare_handlers.js:40-45` keys
  `env.RL_COUNCIL_TURN.limit({ key: clientIp(request) })` on `CF-Connecting-IP`
  and **fails closed** (`{ success: false, reason: "rate_limiter_unconfigured" }`)
  when the binding is absent. Note that `RL_COUNCIL_TURN` is not declared in the
  checked-in `wrangler.toml` — it is operator-supplied, like the placeholder
  resource IDs. A cheaper interim mitigation that needs no code at all is a
  Cloudflare Rate Limiting rule on the two `/api/v1/export/*` paths, configured
  in the dashboard.
- **The audit line cannot include the caller IP** until that same signature
  change lands. Today it records format, limit, filters and row count only.
  Ship it to Logpush and alert on export volume per unit time, since there is
  no per-caller attribution yet.
- **The Flask exporter has the same CSV-injection gap.**
  `immi_case_downloader/web/routes/api_export.py:41` uses `csv.DictWriter` with
  no formula neutralisation. It is local-dev only, so the risk is far lower,
  but the two paths now disagree. Fix it with the same rule when someone next
  touches that file.
- **The apostrophe prefix is visible in the cell.** A catchword that genuinely
  begins with `-` (e.g. `- MIGRATION - visa refusal`) will render as
  `'- MIGRATION - visa refusal` in Excel. That is the accepted cost; no
  exported field is ever a negative number, so a numeric exemption was
  deliberately not added. If a future export field can hold negative numbers,
  add an exemption for values matching `/^-?\d+(\.\d+)?$/` and a test for it.
- **`has_full_text` is a schema change to the export CSV/JSON.** It has no UI
  callers today (`frontend/src/lib/api.ts:1345` is `@deprecated` with none), but
  any operator script that parsed the `full_text_path` column will need
  updating.
- **What a reviewer should scrutinise**: that `publicCase` and
  `LEGACY_CASE_PROJECTION` are byte-identical to HEAD (they are shared by every
  read endpoint), that the `judges` and `legal_concepts` subqueries survived the
  `exportCases` SELECT edit, and that the two `MAX_EXPORT_ROWS` constants agree.

## Findings reconsidered

- **"Three anonymous requests pull the entire 149k-row corpus" (SEC-07,
  exfiltration arithmetic) — corrected.** `exportCases`
  (`workers/storage/cloudflare.js:513-524`) takes only `filters` and `limit`;
  there is no `OFFSET` and no cursor, and the ordering is a fixed
  `ORDER BY c.year DESC, c.case_id ASC`. Repeated identical requests therefore
  return the *same* top-N rows. Enumerating the corpus requires varying the
  `court`/`year`/`visa_type` filters, not paging. The security problem is real
  but the mechanism is filter-varied enumeration; the plan's fix (cap + audit)
  is sized to that, not to a three-request dump.
- **Authentication and rate limiting on the export routes (SEC-07, primary fix
  sketch) — deferred, not rejected.** `dispatchCloudflareCaseRead` is declared
  `(url, path, env)` at `workers/case-api/cloudflare.js:1029` and receives no
  `Request`, so neither an `Authorization` header nor `CF-Connecting-IP` is
  reachable from `handleExport`. Adding either requires editing
  `workers/cloudflare-native.js:231` and/or declaring a binding in
  `wrangler.toml` — both outside this plan's file territory, and `wrangler.toml`
  is additionally gated by the fail-closed
  `scripts/check_cloudflare_native_target.py`. The concrete follow-up, with the
  exemplar to copy, is written up in "Maintenance notes". Nothing in this plan
  substitutes for it.
- **"Use a projection without the judges/legal_concepts correlated subqueries"
  (PERF-06 fix sketch) — rejected.** `EXPORT_FIELDS`
  (`workers/case-api/cloudflare.js:56-62`) lists both `"judges"` (line 57) and
  `"legal_concepts"` (line 60), and those columns are produced *only* by the
  correlated subqueries at `workers/storage/cloudflare.js:98-115`. Dropping them
  would silently blank two columns of every export — a data regression, not an
  optimisation. Step 3c instead removes the genuinely redundant part of the
  SELECT: `c.url` and `c.visa_outcome_reason` are duplicates of
  `LEGACY_CASE_PROJECTION` lines 95–96, and `c.content_key`/`c.content_sha256`/
  `c.content_size` existed only to feed the R2-key re-attach being deleted.
- **Streaming the export via a `ReadableStream` with keyset paging (PERF-06
  fix sketch) — rejected for now.** No UI reaches these routes:
  `downloadExportFile` at `frontend/src/lib/api.ts:1345` carries an
  `@deprecated` block stating "UI entry points removed 2026-05-05 — bulk DB
  export was scoped out of the user-facing app … no React component should call
  this function", and a repo-wide grep confirms zero callers. At a 5,000-row
  cap a Worker isolate serialises the response comfortably, so streaming buys
  nothing today. Revisit only if the admin path is re-exposed or the cap is
  raised.
