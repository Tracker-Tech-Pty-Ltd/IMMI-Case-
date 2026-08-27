# Plan 007: Authenticate, throttle and sanitise the bulk export endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)** — all four commands. A committed-range diff
> cannot see uncommitted, staged or untracked edits, so the first command alone
> gives a dirty tree a false all-clear.
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS="workers/case-api/cloudflare.js
>   workers/storage/cloudflare.js
>   workers/cloudflare-native.js
>   wrangler.toml
>   config/wrangler-cloudflare-native.toml.example
>   workers/__tests__/case-api-cloudflare.test.js
>   workers/__tests__/cloudflare-storage-contracts.test.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS   # committed since the plan was written
> git diff --stat -- $PATHS                 # unstaged working-tree edits
> git diff --cached --stat -- $PATHS        # staged but uncommitted edits
> ```
> Expected: the last three print nothing and `git status --short` lists no
> in-scope path. Any in-scope path in **any** of them is a STOP condition.
>
> **Expected prior changes**, because this plan runs last in its lane (see
> "Sequencing"). These are not drift:
> - `workers/case-api/cloudflare.js` and `workers/storage/cloudflare.js`:
>   `return await handle…(` dispatch lines and an
>   `ON CONFLICT(retrieve_code) DO NOTHING` from `plans/005-*.md`.
> - `workers/storage/cloudflare.js`: an `assertPlatformOperator` method on
>   `CloudflareIdentityStore` from `plans/006-*.md` — this plan **depends** on
>   it; if it is absent, STOP.
> - `workers/cloudflare-native.js`: a `withSpaSecurityHeaders` wrapper and
>   transport-header handling from `plans/008-*.md`.
> - `wrangler.toml`: a `[[ratelimits]] RL_COUNCIL_TURN` block from
>   `plans/004-*.md`.
>
> **Never** run `git checkout --`, `git restore` or `git clean` to clear a
> dirty tree — those edits may be the operator's uncommitted work.

## Status

- **Priority**: P1
- **Effort**: L (raised from M: this plan now closes the authentication and
  throttling half rather than deferring it)
- **Risk**: MED
- **Depends on**:
  - `plans/004-*.md` — establishes the `[[ratelimits]]` config shape, the
    deploy-gate assertion pattern, and the fail-closed
    unconfigured-vs-throttled split this plan reuses for `RL_EXPORT`.
  - `plans/006-*.md` — supplies
    `CloudflareIdentityStore.assertPlatformOperator()`, the authorization
    policy this plan adopts. **Hard dependency**: Step 5 cannot be written
    without it.
  - `plans/005-*.md` — rewrites every `return handle…(` line in
    `workers/case-api/cloudflare.js`, including the two export dispatch lines
    this plan edits.
  - `plans/008-*.md` — owns `workers/cloudflare-native.js`. This plan changes
    one line in that file (the read-dispatcher call site), so it lands after.
- **Category**: security
- **Planned at**: commit `42826a3`, 2026-08-27

### Sequencing (cross-plan)

This plan is **last in its lane**: 004 → 005 → 006 → 008 → 007. Every
dependency above is a shared file or a shared symbol, not a preference. If you
start this plan and find `assertPlatformOperator` missing from
`workers/storage/cloudflare.js`, plan 006 has not landed — stop rather than
inventing a local authorization check.

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

This plan restores **all** of those controls: authentication, an IP-keyed
fail-closed rate limit, the 5,000-row cap, an audit log that records the actor
rather than only the query, removal of the R2 key and of `user_notes`, and CSV
formula neutralisation.

**An earlier draft of this plan deferred authentication and throttling** on the
grounds that `dispatchCloudflareCaseRead(url, path, env)` receives no `Request`
and that the entrypoint was another plan's file. Both facts are true, but the
conclusion was wrong: the plan is titled "Authenticate, throttle and sanitise",
and shipping the sanitise third while leaving the surface anonymous would have
meant a 5,000-row cap and an audit line with **no caller identity in it** —
which still lets an anonymous client enumerate the corpus by varying filters,
just in more requests, and produces an audit trail that cannot answer "who".
A cap without attribution is a speed bump, not a control. So this plan now
takes the one-line signature change and the entrypoint call site too, sequenced
behind the plans that own those files. If you cannot land the auth half, this
plan's status is **BLOCKED**, not DONE — say so rather than shipping the easy
two-thirds under a title that promises three.

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

### What blocks authentication today, and what unblocks it

`workers/case-api/cloudflare.js:1029` (verbatim signature):

```js
export async function dispatchCloudflareCaseRead(url, path, env) {
```

The read dispatcher receives **no `Request` object** — only a parsed `URL`, the
path string, and `env`. There is therefore no `Authorization` header and no
`CF-Connecting-IP` reachable from `handleExport`. Its **single** caller is
`workers/cloudflare-native.js:231` (verified — a repo-wide grep finds only the
import at line 9 and this call):

```js
      const response = await dispatchCloudflareCaseRead(url, path, env);
```

That call sits inside `fetch(request, env, ctx)`, so `request` is already in
scope one line up. Widening the signature is therefore a **two-line change**:
add a parameter, pass the object that is already there. Step 5 does exactly
that, sequenced after `plans/008-*.md` which owns that file.

Everything the auth half needs already exists in the repo:

| Need | Existing exemplar |
|---|---|
| Verify a JWT and reject cleanly | `requireAuth(request, env, verifyJwt)` — used by `workers/llm-council/cloudflare_handlers.js` and `workers/admin/cloudflare_handlers.js` |
| Decide *who* may bulk-export | `CloudflareIdentityStore.assertPlatformOperator()` from `plans/006-*.md` |
| IP-keyed limiter that fails closed | `applyRateLimit` + `rateLimitFailure` in `workers/llm-council/cloudflare_handlers.js` after `plans/004-*.md` |
| Declare the binding, and gate the deploy on it | the `[[ratelimits]]` block and `_validate_main` assertion from `plans/004-*.md` |

So the deferral was a sequencing problem, not a design problem.

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
| Worker tests (this plan's gate) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0, **0 failed**; see "Baselines, not absolutes" |
| Just the read-router suite | `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js` | per-file count `+9` on the number you record in Step 0 |
| Just the storage suite | `cd ".../workers" && npx vitest run __tests__/cloudflare-storage-contracts.test.js` | per-file count `+1` |
| One test by name | `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "<name>"` | that test passes |
| Deploy gate | `.venv/bin/python scripts/check_cloudflare_native_target.py` | exit 1 with the same placeholder-error list as before your change, plus **nothing** about `RL_EXPORT` |
| Frontend tests (regression sanity) | `cd ".../frontend" && npx vitest run` | **0 failed**, count unchanged from Step 0 |
| Python tests (regression sanity) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | 0 failures except the 3 named below |
| Confirm nothing outside scope changed | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope files listed |

### Baselines, not absolutes

**Do not assert a whole-suite total.** This plan lands after four siblings that
each add Worker tests, so any fixed number written here is already wrong by the
time you run it — and an executor who "corrects" it is editing the yardstick.
Record baselines in Step 0 and assert deltas:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
WORKER_BEFORE=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
npx vitest run __tests__/case-api-cloudflare.test.js 2>&1 | grep -oE 'Tests +[0-9]+ passed'
npx vitest run __tests__/cloudflare-storage-contracts.test.js 2>&1 | grep -oE 'Tests +[0-9]+ passed'
```

This plan adds **10 tests** (9 to the read-router suite, 1 to the storage
suite) and no new files. Final assertion: `WORKER_BEFORE + 10`, **0 failed**.

**The 3 environmental Python failures** must remain **exactly these 3, by
name** — a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaking
the `pypdf` import:

- `tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging`
- `tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent`

They are not caused by this plan. Judge by name, not count.

Notes: the Worker suite has no `workers/package.json`; `npx vitest run` from
`workers/` picks up `workers/vitest.config.js`. Vitest version is 2.1.9.

## Scope

**In scope** (the only files you may modify):

- `workers/case-api/cloudflare.js` — `EXPORT_FIELDS`, `csvCell`, `handleExport`,
  the two export route lines inside `dispatchCloudflareCaseRead`, and that
  function's signature. Nothing else.
- `workers/storage/cloudflare.js` — `CloudflareCaseStore.exportCases` only
  (lines 513–524). Other plans own other regions of this file; do not stray.
- `workers/cloudflare-native.js` — **one line only**: the
  `dispatchCloudflareCaseRead(url, path, env)` call at line 231 gains the
  `request` argument. Do not touch anything else in that file; `plans/008-*.md`
  owns it.
- `wrangler.toml` and `config/wrangler-cloudflare-native.toml.example` — add
  one `[[ratelimits]] RL_EXPORT` block to each, mirroring the
  `RL_COUNCIL_TURN` block `plans/004-*.md` adds.
- `workers/__tests__/case-api-cloudflare.test.js` — update the existing export
  test, add new ones.
- `workers/__tests__/cloudflare-storage-contracts.test.js` — add one test.

**Out of scope** (do NOT touch, even though they look related):

- Anything in `workers/cloudflare-native.js` other than the single call-site
  line. In particular do not add headers, wrappers, or an outer `try/catch`.
- `scripts/check_cloudflare_native_target.py` — plan 004 owns the gate. Adding
  an `RL_EXPORT` assertion there is a **follow-up**, recorded in "Maintenance
  notes". Note the consequence and state it in the PR: until that follow-up
  lands, an operator whose private config lacks `RL_EXPORT` deploys a Worker on
  which every export returns `503 rate_limiter_unconfigured`. That is
  fail-closed and therefore acceptable, but it must not be a surprise.
- `scripts/check_immi_activation_evidence.py` — the other fail-closed gate.
  Adding a `[[ratelimits]]` block does not trip either gate's forbidden-key
  check (`hyperdrive`/`postgres`/`supabase` — verified at
  `scripts/check_cloudflare_native_target.py:103`), so no gate edit is needed
  to make the config parse.
- The placeholder resource IDs in `wrangler.toml` and the `"false"` defaults
  for `IMMI_CASE_MUTATIONS_ENABLED` / pipeline flags are **by design** — never
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
- One commit per step, message style `<type>: <description>`. Suggested:
  - Step 1: `fix: neutralise spreadsheet formula prefixes in worker CSV export`
  - Step 2: `fix: cut the worker export row cap from 50000 to 5000`
  - Step 3: `fix: stop exporting the internal R2 key and user notes`
  - Step 4: `feat: audit every export with actor and redacted filter shape`
  - Step 5: `feat: require a platform operator and a rate limit for bulk export`
  - Steps 0, 6, 7: no commit (baselines, PR text, verification).
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 0: Check dependencies and record baselines

Nothing changes here. This step catches the two failure modes that would make
everything after it meaningless: a missing dependency, and a moving yardstick.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
# Hard dependency: plan 006 must have landed.
grep -c "assertPlatformOperator" workers/storage/cloudflare.js   # must be >= 1
# Soft but expected: plan 005's awaited dispatch.
grep -c "return await handle" workers/case-api/cloudflare.js     # expect > 0
# Working tree must be clean of in-scope paths (see the drift check above).
git status --short --branch
```

If `assertPlatformOperator` is absent, **stop** — see STOP conditions.

Then record baselines:

```bash
cd workers
npx vitest run 2>&1 | grep -E 'Test Files|Tests '            # WORKER_BEFORE
npx vitest run __tests__/case-api-cloudflare.test.js 2>&1 | grep 'Tests '
npx vitest run __tests__/cloudflare-storage-contracts.test.js 2>&1 | grep 'Tests '
cd ../frontend && npx vitest run 2>&1 | grep 'Tests '
```

Also record the deploy gate's current error list, so Step 5b can prove it did
not change:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep '^- ' > /tmp/immi-gate-before.txt
wc -l < /tmp/immi-gate-before.txt
```

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
      { case_id: CASE_ID, title: "=HYPERLINK(\"http://evil\",\"click\")", tags: "-2+3", catchwords: "@SUM(A1)", representative: "\tcmd", legislation: "\r=cmd|'/c calc'!A1", citation: "[2025] FCA 1" },
    ]);
    const csv = await dispatchCloudflareCaseRead(
      request("/api/v1/export/csv?limit=1"), url("/api/v1/export/csv?limit=1"),
      "/api/v1/export/csv", operatorEnv(),
    );
    const body = await csv.text();
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(body).toContain(`"'-2+3"`);
    expect(body).toContain(`"'@SUM(A1)"`);
    expect(body).toContain(`"'\tcmd"`);
    // CR is in CSV_FORMULA_PREFIX_RE and must be covered too — an earlier
    // draft of this test listed the regex's six prefixes and then asserted
    // only five, leaving the CR branch unexercised.
    expect(body).toContain(`"'\r=cmd`);
    // A benign value is still written unquoted.
    expect(body).toContain("[2025] FCA 1");
  });

  it("prefixes a value that begins with +", async () => {
    // Separated from the case above because `+` is the prefix most likely to
    // be "optimised away" by someone adding a numeric exemption later.
    const current = mockCreateStores();
    current.caseStore.exportCases.mockResolvedValueOnce([
      { case_id: CASE_ID, title: "+1+1", citation: "[2025] FCA 2" },
    ]);
    const csv = await dispatchCloudflareCaseRead(
      request("/api/v1/export/csv?limit=1"), url("/api/v1/export/csv?limit=1"),
      "/api/v1/export/csv", operatorEnv(),
    );
    expect(await csv.text()).toContain(`"'+1+1"`);
  });
```

Note `user_notes` is deliberately **absent** from these fixtures: Step 3b
removes it from the export entirely, so asserting on it here would fail later
in this same plan.

`request(...)` and `operatorEnv()` are helpers you add in Step 5. **Write this
step's tests against the post-Step-5 signature from the start** rather than
writing them twice — Step 5 is in this same plan and lands in the same branch.
If you prefer to do Step 1 standalone first, use the current
`dispatchCloudflareCaseRead(url(...), path, { IMMI_STORAGE_MODE: "cloudflare" })`
form and update both calls in Step 5.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/case-api-cloudflare.test.js -t "neutralises spreadsheet formula prefixes in the CSV export"
npx vitest run __tests__/case-api-cloudflare.test.js -t "prefixes a value that begins with +"
```
→ both pass.

**Verify the assertion can fail**: temporarily drop `\r` from
`CSV_FORMULA_PREFIX_RE`, re-run the first test, confirm it fails on the CR
assertion, restore. A prefix listed in the regex but never asserted is exactly
how the CR gap survived the first draft.

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
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/cloudflare-storage-contracts.test.js
```
→ **0 failed**, per-file count == `storage-contracts BEFORE + 1` (13 at the
time of writing, so 14; re-derive from your Step-0 recording). And by name:
```bash
npx vitest run __tests__/cloudflare-storage-contracts.test.js -t "clamps a bulk export to the 5 000-row server cap"
```

### Step 3: Stop publishing the internal R2 object key in the export payload

The export currently emits the R2 content key of each case's full text under
the column name `full_text_path`. Replace it with a boolean-valued
`has_full_text` column that keeps the useful signal without publishing the key.

**3a.** `workers/case-api/cloudflare.js` — in `EXPORT_FIELDS` (lines 56–62),
replace the string `"full_text_path"` (index 14, on the line beginning
`"catchwords", "outcome", ...`) with `"has_full_text"`. Keep every other
field's position and order exactly as-is, except for 3b below.

**3b. Also remove `"user_notes"` from `EXPORT_FIELDS`** (index 16).

`user_notes` is a free-text field on the **shared** `cases` table — the table
has no tenant column, which is exactly why `plans/006-*.md` gates case writes
on a platform grant. So any authenticated user's notes are readable by every
export caller. Shipping a bulk export of other people's annotations is a
privacy problem independent of the row cap, and the cheapest correct fix is to
stop exporting the column.

**Residual you must state in the PR, not paper over**: `user_notes` is also in
`LEGACY_CASE_PROJECTION` (`workers/storage/cloudflare.js:96`), so
`GET /api/v1/cases` and the case-detail route still return it. This plan closes
the **bulk** vector only; the paginated read path is `publicCase` /
`LEGACY_CASE_PROJECTION` territory, shared by five endpoints and explicitly out
of scope here. `plans/050-*.md` ("move user data server-side") is the right home
for the rest. Do not silently imply `user_notes` is now private.

Add a test pinning the removal (see 3f).

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
      request("/api/v1/export/csv?limit=1"), url("/api/v1/export/csv?limit=1"),
      "/api/v1/export/csv", operatorEnv(),
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

**3f.** Add a test pinning the `user_notes` removal from 3b. Assert on the
**parsed field list**, not on a substring of the body — a `not.toContain`
against the whole CSV would pass for the wrong reason if the header were
renamed, and would fail spuriously if any *value* happened to contain the
string:

```js
  it("excludes user_notes from every export format", async () => {
    const current = mockCreateStores();
    current.caseStore.exportCases.mockResolvedValueOnce([
      { case_id: CASE_ID, citation: "[2025] FCA 1", user_notes: "private annotation" },
    ]);
    const json = await dispatchCloudflareCaseRead(
      request("/api/v1/export/json?limit=1"), url("/api/v1/export/json?limit=1"),
      "/api/v1/export/json", operatorEnv(),
    );
    const row = (await json.json()).cases[0];
    expect(Object.keys(row)).not.toContain("user_notes");
    expect(JSON.stringify(row)).not.toContain("private annotation");

    const csv = await dispatchCloudflareCaseRead(
      request("/api/v1/export/csv?limit=1"), url("/api/v1/export/csv?limit=1"),
      "/api/v1/export/csv", operatorEnv(),
    );
    const header = (await csv.text()).split("\n")[0].replace("﻿", "").split(",");
    expect(header).not.toContain("user_notes");
    expect(header).toContain("has_full_text");
  });
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -n "full_text_path: row.content_key" workers/case-api/cloudflare.js   # → no output
grep -c '"user_notes"' workers/case-api/cloudflare.js                      # → 0
```
Then:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/case-api-cloudflare.test.js -t "never publishes the internal R2 object key"
npx vitest run __tests__/case-api-cloudflare.test.js -t "excludes user_notes from every export format"
```
→ both pass. The whole-file count is now `case-api BEFORE + 5`.

### Step 4: Restore the export audit log line

The Flask exporter logged the caller's IP, the filters, and the row count on
every export (`immi_case_downloader/web/routes/api_export.py:34-39`). The
Worker cannot log the IP — `dispatchCloudflareCaseRead` receives no `Request`
(see "Current state") — but it can and must log the format, the effective
limit, the filters and the row count.

**Do not log raw filter values.** `requestFilters` (verified verbatim) builds a
`keyword` entry from `params.get("keyword") || params.get("q")` — free text a
user typed into a search box on an immigration-case site. That can be an
applicant's name, a file number, or a country-and-visa combination that
identifies a person. Writing it into a log stream that goes to Logpush turns an
audit control into a data-retention problem.

The rule for this audit line: **record the actor, the filter *keys*, the shape
of the query, and the row count — plus a salted hash of any free-text value if
you need to correlate repeated queries. Never the free text itself.**

In `workers/case-api/cloudflare.js`, add these helpers immediately above
`handleExport`:

```js
// Free-text filters on an immigration-case corpus can carry applicant names
// and file numbers, so the audit line records their SHAPE, never their value.
// Enumeration is still detectable: the key set plus the digest identifies
// "the same query repeated" and "many different queries" without retaining
// what was searched for.
const AUDIT_FREE_TEXT_KEYS = new Set(["keyword"]);

async function auditFilterDigest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function auditFilters(filters) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === 0 || value === null || value === undefined) continue;
    if (AUDIT_FREE_TEXT_KEYS.has(key)) {
      out[key] = { len: String(value).length, sha256_8: await auditFilterDigest(String(value)) };
      continue;
    }
    // court / year / visa_type / source / tag / nature are bounded enum-ish
    // values, safe to record verbatim, truncated for log hygiene.
    out[key] = typeof value === "string" ? value.slice(0, 64) : value;
  }
  return out;
}
```

`auditFilters` is now `async`, so `await` it at the call site.

**If a future filter accepts free text, add its key to `AUDIT_FREE_TEXT_KEYS`.**
The set is the single place that decision lives.

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
insert the audit line. `handleExport` gains an `auth` parameter in Step 5; the
line records it, because an audit entry with no actor cannot answer the only
question an audit exists to answer:

```js
  console.log(JSON.stringify({
    event: "case.export",
    format,
    limit,
    actor: auth?.userId ?? null,
    tenant: auth?.tenantId ?? null,
    grant: auth?.grant ?? null,
    filters: await auditFilters(filters),
    rows: values.length,
  }));
```

Do not log any row content — only the counts, the actor and the filter shapes.

Add the matching tests to `workers/__tests__/case-api-cloudflare.test.js`,
after the test added in step 3f:

```js
  it("audits every export with actor, format, limit, filter shape and row count", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await dispatchCloudflareCaseRead(
        request("/api/v1/export/json?limit=10&court=FCA"),
        url("/api/v1/export/json?limit=10&court=FCA"),
        "/api/v1/export/json", operatorEnv(),
      );
      const entry = logSpy.mock.calls
        .map(([line]) => JSON.parse(line))
        .find((item) => item.event === "case.export");
      expect(entry).toMatchObject({
        event: "case.export", format: "json", limit: 10,
        actor: OPERATOR_USER_ID, filters: { court: "FCA" }, rows: 1,
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("records a free-text filter as a digest, never as its value", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await dispatchCloudflareCaseRead(
        request("/api/v1/export/json?keyword=Nguyen%20visa%20866"),
        url("/api/v1/export/json?keyword=Nguyen%20visa%20866"),
        "/api/v1/export/json", operatorEnv(),
      );
      const lines = logSpy.mock.calls.map(([line]) => line).join("\n");
      // The load-bearing assertion: the searched-for text is nowhere in the
      // log stream, in any field.
      expect(lines).not.toContain("Nguyen");
      const entry = logSpy.mock.calls
        .map(([line]) => JSON.parse(line))
        .find((item) => item.event === "case.export");
      expect(entry.filters.keyword).toMatchObject({ len: 16 });
      expect(entry.filters.keyword.sha256_8).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      logSpy.mockRestore();
    }
  });
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/case-api-cloudflare.test.js -t "audits every export with actor"
npx vitest run __tests__/case-api-cloudflare.test.js -t "records a free-text filter as a digest"
```
→ both pass.

**Verify the digest test can fail**: temporarily make `auditFilters` return the
raw `keyword`, re-run the second test, and confirm the `not.toContain("Nguyen")`
assertion fires. Restore. Without that check you cannot tell a working
redaction from an absent one.

### Step 5: Authenticate and throttle the export routes

This is the half the plan's title promises and an earlier draft deferred. It
has four parts. **Do not stop after Steps 1–4 and mark the plan DONE** — if
this step cannot be completed, the plan's status is BLOCKED.

**5a. Widen the read dispatcher to receive the `Request`.**

In `workers/case-api/cloudflare.js`, change the signature at line 1029:

```js
export async function dispatchCloudflareCaseRead(request, url, path, env) {
```

`request` goes **first** so the shape matches every other dispatcher in this
Worker (`dispatchCloudflareCaseAction(request, path, env)`,
`dispatchCloudflareCouncil(request, env, path, method, ctx)`), which makes the
call sites read consistently and makes a forgotten argument a `TypeError`
rather than a silently-shifted one.

In `workers/cloudflare-native.js`, change the **one** call site at line 231:

```js
      const response = await dispatchCloudflareCaseRead(request, url, path, env);
```

`request` is already the first parameter of the enclosing
`fetch(request, env, ctx)`, so nothing else moves. Touch no other line in that
file.

**Verify there is exactly one call site**, so nothing was missed:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -rn "dispatchCloudflareCaseRead" workers/ --include=*.js | grep -v node_modules
```
→ exactly three lines: the export at `case-api/cloudflare.js:1029`, the import
at `cloudflare-native.js:9`, and the call at `cloudflare-native.js:231`. Plus
any test files, which you update in 5d. If a fourth non-test caller appears,
STOP — this plan's signature change would break it.

**5b. Declare an export rate limiter.**

Add to `wrangler.toml` and to `config/wrangler-cloudflare-native.toml.example`,
immediately after the `RL_COUNCIL_TURN` block that `plans/004-*.md` adds:

```toml
# Bulk export is the only route that returns thousands of case rows in one
# response. 5 requests / 60s / IP mirrors the Flask exporter's
# @rate_limit(5, 3600, scope="export-csv") intent at edge granularity.
# `period` accepts only 10 or 60.
[[ratelimits]]
name = "RL_EXPORT"
namespace_id = "1002"
simple = { limit = 5, period = 60 }
```

`namespace_id = "1002"` — a Worker-local integer label, distinct from
`RL_COUNCIL_TURN`'s `1001`. Not a secret, not an account resource ID.

**Verify**:
```bash
.venv/bin/python -c "import tomllib,pathlib; c=tomllib.loads(pathlib.Path('wrangler.toml').read_text()); print([r['name'] for r in c['ratelimits']])"
```
→ `['RL_COUNCIL_TURN', 'RL_EXPORT']`, and the same for the example template.

```bash
.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c 'RL_EXPORT'
```
→ `0` — adding a binding the gate does not know about must not trip the
forbidden-legacy-key check (`hyperdrive`/`postgres`/`supabase` only, verified
at `scripts/check_cloudflare_native_target.py:103`). The error list is
otherwise unchanged from before your edit; diff it if unsure.

**5c. Gate `handleExport` on a platform operator, then on the limiter.**

In `workers/case-api/cloudflare.js`, add these helpers above `handleExport`
(mirroring `workers/llm-council/cloudflare_handlers.js`, which is the
in-repo exemplar for all three):

```js
function exportClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

// Fails closed, exactly like the Council limiter: an unbound binding must
// never degrade a rate-limited bulk-data route to unlimited. A misconfigured
// deploy is reported as 503, not as a misleading 429.
async function applyExportRateLimit(request, env) {
  if (!env.RL_EXPORT) {
    console.error(JSON.stringify({ event: "case.export.rate_limiter_unconfigured" }));
    return { success: false, reason: "rate_limiter_unconfigured" };
  }
  return env.RL_EXPORT.limit({ key: exportClientIp(request) });
}

function exportRateLimitFailure(limited) {
  return limited.reason === "rate_limiter_unconfigured"
    ? jsonErr("Export is misconfigured: rate limiter binding missing", 503, "rate_limiter_unconfigured")
    : jsonErr("Export rate limit exceeded — try again shortly", 429, "rate_limited");
}
```

Then make `handleExport` require authorization **before** it touches the store.
Its first lines become:

```js
async function handleExport(request, url, stores, env, format) {
  // Bulk export is a platform-operator surface. Tenant membership is not
  // enough: the `cases` table has no tenant column, so an export is a dump of
  // the shared catalog, and the tenant role is self-granted at signup
  // (see plans/006 and CloudflareIdentityStore.assertPlatformOperator).
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const auth = await stores.identityStore.assertPlatformOperator(authResult.claims);
  // Throttle AFTER authorization so an anonymous flood cannot consume the
  // limiter budget of a legitimate operator sharing an egress IP.
  const limited = await applyExportRateLimit(request, env);
  if (!limited.success) return exportRateLimitFailure(limited);
```

`assertPlatformOperator` throws a `StorageBoundaryError`
(`platform_operator_required`, 403), which the read dispatcher's existing
`catch` already converts into `{ error, code }` with that status — **provided**
`plans/005-*.md` has landed and the handler is `await`ed. Verify that with the
403 test in 5d; if it comes back as a bodyless 500, 005 has not landed and the
error is escaping the dispatcher.

Update the two export route lines in `dispatchCloudflareCaseRead` to pass the
new arguments:

```js
    if (path === "/api/v1/export/csv") return await handleExport(request, url, stores, env, "csv");
    if (path === "/api/v1/export/json") return await handleExport(request, url, stores, env, "json");
```

`requireAuth` and `verifyJwt` must be imported at the top of
`workers/case-api/cloudflare.js` if they are not already
(`import { requireAuth } from "../auth/request_auth.js";` and
`import { verifyJwt } from "../auth/jwt.js";`) — check first with
`grep -n "requireAuth\|verifyJwt" workers/case-api/cloudflare.js`.

**This does not reference a D1/R2/Vectorize binding from outside
`workers/storage/`**, so the storage-boundary contract test at
`workers/__tests__/cloudflare-storage-contracts.test.js:94-100` stays green:
`env.RL_EXPORT` is a rate-limiter binding, not a data binding. Confirm by
running that test file after this step.

**5d. Tests.** Add to `workers/__tests__/case-api-cloudflare.test.js`. First
add the shared helpers the earlier steps referenced:

```js
const OPERATOR_USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function request(path) {
  return new Request(`https://immi.example${path}`, {
    headers: { Authorization: "Bearer valid" },
  });
}

function operatorEnv(overrides = {}) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    RL_EXPORT: { limit: vi.fn(async () => ({ success: true })) },
    ...overrides,
  };
}
```

Mock `../auth/request_auth.js` and `../auth/jwt.js` the way
`workers/__tests__/cloudflare-mutations.test.js:1-49` does, with
`mockRequireAuth.mockResolvedValue({ claims: { sub: OPERATOR_USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] } })`
in `beforeEach`, and add
`assertPlatformOperator: vi.fn(async () => ({ userId: OPERATOR_USER_ID, tenantId: TENANT_ID, platformOperator: true, grant: "platform_admin" }))`
to the `identityStore` in `mockCreateStores()`.

**Every non-export test in this file must keep passing unchanged.** The
signature change means they all need `request(...)` added as a first argument;
that is a mechanical edit, not a behaviour change. Do it, and confirm the count
of *pre-existing* tests is unchanged.

The four new tests:

1. `"rejects an anonymous bulk export"` — `mockRequireAuth` resolves a
   `Response` (401), as `requireAuth` does for a missing token. Assert
   `response.status === 401` **and** `current.caseStore.exportCases` was never
   called. The second assertion is the one that proves no data was read.
2. `"rejects an authenticated user with no platform grant"` —
   `assertPlatformOperator` rejects with
   `new StorageBoundaryError("Platform operator access is required", { code: "platform_operator_required", status: 403 })`.
   Assert `403`, body `code === "platform_operator_required"`, and
   `exportCases` never called. Import the real `StorageBoundaryError` from
   `../storage/contracts.js`; do not mock that module.
3. `"returns 429 when the export limiter rejects the caller"` —
   `RL_EXPORT: { limit: vi.fn(async () => ({ success: false })) }`. Assert
   `429`, `code === "rate_limited"`, and `exportCases` never called.
4. `"fails closed with 503 when the export limiter binding is absent"` —
   `operatorEnv({ RL_EXPORT: undefined })`. Assert `503` and
   `code === "rate_limiter_unconfigured"`. This is the regression pin for the
   fail-closed contract: without it, a config gap silently becomes an
   unthrottled bulk-data endpoint.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
npx vitest run __tests__/case-api-cloudflare.test.js -t "rejects an anonymous bulk export"
npx vitest run __tests__/case-api-cloudflare.test.js -t "rejects an authenticated user with no platform grant"
npx vitest run __tests__/case-api-cloudflare.test.js -t "returns 429 when the export limiter rejects"
npx vitest run __tests__/case-api-cloudflare.test.js -t "fails closed with 503 when the export limiter binding is absent"
npx vitest run __tests__/cloudflare-storage-contracts.test.js
```
→ all pass, `0 failed`.

**Verify the gate can fail**: temporarily comment out the
`assertPlatformOperator` call, re-run test 2, and confirm it fails (a 200 with
rows instead of a 403). Restore. A test that passes with the control removed is
not testing the control.

### Step 6: Publish the API-contract change

Three breaking changes ship here: `full_text_path` → `has_full_text`,
`user_notes` removed, and the default/maximum row count 50,000 → 5,000. The
export routes also stop accepting anonymous callers. Consumers have to be told,
and "there is no UI caller" is not the same as "there is no caller".

**6a. Consumer inventory.** Run and record the output in the PR:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -rn "export/csv\|export/json\|full_text_path" \
  --include=*.ts --include=*.tsx --include=*.js --include=*.py --include=*.sh --include=*.md \
  . | grep -v node_modules | grep -v '/plans/'
```

The known result at the time of writing: `downloadExportFile` at
`frontend/src/lib/api.ts:1345` is `@deprecated` with zero callers, and
`full_text_path` appears in the read-path tests and `LEGACY_CASE_PROJECTION`
(which this plan does not change). **What this grep cannot see is an operator's
local script or a scheduled job outside the repo** — so the PR must ask the
operator directly: "does anything you run consume `/api/v1/export/*`?" A
negative answer from a grep is not an answer from the operator.

**6b. Release note.** Add to the PR description, verbatim:

> **Breaking — `/api/v1/export/{csv,json}`**
> - Now requires a platform-operator JWT. Anonymous callers get `401`;
>   authenticated non-operators get `403 platform_operator_required`.
> - Rate limited to 5 requests/minute/IP. Exceeding it returns
>   `429 rate_limited`. A deploy whose config lacks the `RL_EXPORT` binding
>   returns `503 rate_limiter_unconfigured` for every export — fail-closed by
>   design.
> - Maximum and default rows per request: 50,000 → **5,000**.
> - Column `full_text_path` (an internal R2 object key) is replaced by
>   `has_full_text` (`1`/`0`).
> - Column `user_notes` is removed.

**6c. Rollback.** Redeploying the previous Worker build restores the old
contract in full; nothing here is a data migration and no stored data changes,
so rollback is a single deploy with no cleanup. The `RL_EXPORT` block may stay
in the config — an unused rate-limiter binding is inert.

**Verify**: not machine-checkable. The Done criterion is that 6a's grep output
and 6b's release note appear in the PR, and that the operator has answered the
6a question.

### Step 7: Full-suite regression check

Run the whole Worker suite and the frontend suite. Nothing in `frontend/` or
`immi_case_downloader/` was touched, so both must be unchanged.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run
```
→ **0 failed**, `Tests` == `WORKER_BEFORE + 10` (the baseline from
"Baselines, not absolutes").

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run
```
→ **0 failed**, count unchanged from your Step-0 recording.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ exactly these modified files and nothing else:
`workers/case-api/cloudflare.js`, `workers/storage/cloudflare.js`,
`workers/cloudflare-native.js`, `wrangler.toml`,
`config/wrangler-cloudflare-native.toml.example`,
`workers/__tests__/case-api-cloudflare.test.js`,
`workers/__tests__/cloudflare-storage-contracts.test.js`, plus the new
untracked `plans/007-harden-the-public-export-surface.md`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat -- workers/cloudflare-native.js
```
→ **1 file changed, 1 insertion(+), 1 deletion(-)**. More than one changed line
in that file means you strayed into `plans/008-*.md`'s territory.

## Test plan

New tests, all in the Worker Vitest suite (run with
`cd workers && npx vitest run`):

In `workers/__tests__/case-api-cloudflare.test.js` (structural pattern: the
existing `it("exports JSON and CSV from the native catalog boundary", ...)` at
lines 407–421 — it builds `const current = mockCreateStores()`, dispatches via
`dispatchCloudflareCaseRead(url(path), path, { IMMI_STORAGE_MODE: "cloudflare" })`,
then asserts on the response and the store mock):

1. `neutralises spreadsheet formula prefixes in the CSV export` — one case row
   whose `title` starts `=`, `tags` starts `-`, `catchwords` starts `@`,
   `representative` starts TAB and `legislation` starts **CR**. Asserts each is
   force-quoted and apostrophe-prefixed, and that a benign `citation` value is
   still written plainly. All six regex prefixes are covered; an earlier draft
   listed six and asserted five.
2. `prefixes a value that begins with +` — the `+` case, separated so a future
   numeric exemption cannot quietly drop it.
3. `never publishes the internal R2 object key in an export` — CSV body
   contains `has_full_text`, contains neither `full_text_path` nor the mock's
   `cases/0123456789ab/source/abc.txt`.
4. `excludes user_notes from every export format` — asserts on the parsed CSV
   header array and the JSON row's key set (not a body substring, which would
   pass for the wrong reason), and that the note's *value* is absent.
5. `audits every export with actor, format, limit, filter shape and row count`
   — spies on `console.log`, asserts the `case.export` entry carries
   `actor: OPERATOR_USER_ID` and `filters: { court: "FCA" }`.
6. `records a free-text filter as a digest, never as its value` — asserts the
   searched string appears nowhere in the log stream and that
   `filters.keyword` is `{ len, sha256_8 }`.
7. `rejects an anonymous bulk export` — 401, and `exportCases` never called.
8. `rejects an authenticated user with no platform grant` — 403
   `platform_operator_required`, and `exportCases` never called.
9. `returns 429 when the export limiter rejects the caller` — 429
   `rate_limited`, and `exportCases` never called.
10. `fails closed with 503 when the export limiter binding is absent` — 503
    `rate_limiter_unconfigured`.
11. Modified (no count change): `exports JSON and CSV from the native catalog
    boundary` — the `full_text_path` assertion becomes `has_full_text: 1` plus
    two `not.toHaveProperty` assertions.
12. Modified (no count change): every other test in the file gains
    `request(...)` as the new first argument to `dispatchCloudflareCaseRead`.

In `workers/__tests__/cloudflare-storage-contracts.test.js` (structural
pattern: `it("uses D1 bound values for lexical search and never interpolates
query text", ...)` — it builds `const value = env()`, calls
`createCloudflareStores(value)`, invokes the store method, then finds the
recorded statement in `value.IMMI_CATALOG_DB.calls`):

13. `clamps a bulk export to the 5 000-row server cap` — calls
    `exportCases({ filters: {}, limit: 50000 })` and asserts the last bound
    parameter of the `ORDER BY c.year DESC` statement is `5000`. This is the
    regression guard: it fails if anyone raises the cap in the handler without
    raising it in the store, or vice versa.

Regression coverage that must stay green untouched:
`workers/__tests__/case-api-cloudflare.test.js:172-173` and `:194` assert that
`/api/v1/cases` and case-detail responses still expose `full_text_path` and
never `content_key` — proof that this plan did not disturb `publicCase` for the
other read endpoints. (They will need the mechanical `request(...)` argument
added; their assertions do not change.)

**Net: +10 tests** (9 in `case-api-cloudflare.test.js`, 1 in
`cloudflare-storage-contracts.test.js`; items 11 and 12 modify existing tests
in place and do not change the count). Verification:
`cd workers && npx vitest run` → **0 failed**, `Tests` == `WORKER_BEFORE + 10`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd ".../workers" && npx vitest run` exits 0 with **0 failed** and `Tests` equal to `WORKER_BEFORE + 10` (the baseline you recorded before starting)
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "rejects an anonymous bulk export"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "rejects an authenticated user with no platform grant"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "returns 429 when the export limiter rejects"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "fails closed with 503 when the export limiter binding is absent"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "records a free-text filter as a digest"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/case-api-cloudflare.test.js -t "excludes user_notes from every export format"` passes
- [ ] `cd ".../workers" && npx vitest run __tests__/cloudflare-storage-contracts.test.js` exits 0 with **0 failed** (the storage-boundary contract test still holds)
- [ ] `cd ".../frontend" && npx vitest run` exits 0 with **0 failed** and the same count you recorded before starting
- [ ] `grep -rn "50000" workers/case-api/cloudflare.js workers/storage/cloudflare.js` returns no matches
- [ ] `grep -n "full_text_path: row.content_key" workers/case-api/cloudflare.js` returns no matches
- [ ] `grep -n "MAX_EXPORT_ROWS = 5000" workers/case-api/cloudflare.js workers/storage/cloudflare.js` returns exactly 2 matches (one per file)
- [ ] `grep -n "CSV_FORMULA_PREFIX_RE" workers/case-api/cloudflare.js` returns exactly 2 matches (the definition and its use in `csvCell`)
- [ ] `grep -n '"case.export"' workers/case-api/cloudflare.js` returns exactly 1 match
- [ ] `grep -n "has_full_text" workers/case-api/cloudflare.js` returns exactly 2 matches (`EXPORT_FIELDS` and the `values` mapping)
- [ ] `grep -c '"user_notes"' workers/case-api/cloudflare.js` returns `0`
- [ ] `grep -c "assertPlatformOperator" workers/case-api/cloudflare.js` returns `1`
- [ ] `grep -c "applyExportRateLimit" workers/case-api/cloudflare.js` returns `2` (definition + call site)
- [ ] `.venv/bin/python -c "import tomllib,pathlib; print([r['name'] for r in tomllib.loads(pathlib.Path('wrangler.toml').read_text())['ratelimits']])"` prints a list containing `RL_EXPORT`
- [ ] `.venv/bin/python scripts/check_cloudflare_native_target.py 2>&1 | grep -c 'RL_EXPORT'` returns `0` (the new binding does not trip the gate)
- [ ] `grep -rn "dispatchCloudflareCaseRead" workers/ --include=*.js | grep -v node_modules | grep -v __tests__` returns exactly 3 lines (declaration, import, single call site)
- [ ] `grep -n "AS judges" workers/storage/cloudflare.js` still returns a match — the `judges` subquery in `LEGACY_CASE_PROJECTION` was not removed
- [ ] `git diff --stat -- workers/cloudflare-native.js` shows exactly `1 insertion(+), 1 deletion(-)`
- [ ] `git status --short` shows only the in-scope files modified, plus this untracked plan file
- [ ] `git status --porcelain -- immi_case_downloader/ frontend/` returns no output (working-tree check, not a committed-range diff)
- [ ] Step 6's consumer-inventory grep output and release note appear in the PR description, and the operator has answered the "does anything you run consume `/api/v1/export/*`?" question
- [ ] If Step 5 could not be completed, the plan is reported as **BLOCKED**, not DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check produces output that is not one of the four documented
  expected prior changes, or any excerpt in "Current state" does not match the
  live file byte-for-byte at the stated line numbers.
- **`CloudflareIdentityStore.assertPlatformOperator` does not exist in
  `workers/storage/cloudflare.js`.** `plans/006-*.md` has not landed and Step 5
  has no authorization policy to adopt. Do **not** invent a local role check,
  and do not fall back to `assertMembership` — the tenant role is self-granted
  at signup, so it authorizes nothing here. Stop and report.
- `dispatchCloudflareCaseRead` already has a `Request` in its signature at
  `workers/case-api/cloudflare.js:1029` — someone else plumbed it through.
  Step 5a is then already done; verify the argument order matches what the call
  site passes before continuing, and report the divergence.
- `grep -rn "dispatchCloudflareCaseRead" workers/ --include=*.js` finds a
  **second** non-test call site. Step 5a's signature change would break it.
  Report which, and do not update it — it is outside this plan's scope.
- `csvCell` or `EXPORT_FIELDS` gained a second caller anywhere in `workers/`
  (check with `grep -rn "csvCell\|EXPORT_FIELDS" workers/`). Both are export-only
  today; a second caller means this plan's changes have reach it did not
  account for.
- Any test outside the two Worker test files listed in Scope starts failing —
  in particular `workers/__tests__/cloudflare-storage-contracts.test.js`'s
  `keeps Cloudflare data bindings inside the storage boundary`, which fires if
  a D1/R2/Vectorize binding is referenced from outside `workers/storage/`.
  (`env.RL_EXPORT` is a rate-limiter binding, not a data binding, so Step 5c
  should not trip it. If it does, read that test before working around it.)
- The Worker suite drops below `WORKER_BEFORE`, or the frontend count moves off
  the number you recorded — either means you broke something, not that the
  baseline was wrong.
- `git diff --stat -- workers/cloudflare-native.js` shows more than one changed
  line. That file belongs to `plans/008-*.md`; this plan gets exactly the call
  site.
- Adding the `RL_EXPORT` block makes
  `scripts/check_cloudflare_native_target.py` emit a new error. Do **not** edit
  the gate to silence it — plan 004 owns that script. Report the error text.
- `make test-py` reports any failure that is not one of the three named
  `tests/test_backfill_judge_overrides_from_pdf.py` tests listed in
  "Baselines, not absolutes". Judge by name, not count.
- **You are about to mark this plan DONE without Step 5.** The plan is titled
  "Authenticate, throttle and sanitise"; shipping only the sanitise third under
  that title is how the first draft's gap happened. Report BLOCKED instead.

## Maintenance notes

For the human or agent who owns this code next:

- **Authentication and throttling are no longer deferred — Step 5 ships them.**
  What remains is one operator-facing follow-up: the deploy gate
  `scripts/check_cloudflare_native_target.py` does **not** assert the
  `RL_EXPORT` binding (plan 004 owns that file). Until someone adds the
  assertion, an operator whose private config omits the block deploys a Worker
  on which every export returns `503 rate_limiter_unconfigured`. That is
  fail-closed and safe, but it is a support ticket waiting to happen — the fix
  is ten lines copied from the `RL_COUNCIL_TURN` assertion plan 004 adds.
- **The audit line records the actor, not the caller IP.** `CF-Connecting-IP`
  is available after Step 5a and is used as the rate-limiter key, but it is
  deliberately **not** written to the log: the actor `user_id` is the better
  attribution and an IP is personal data with no additional investigative
  value once you know who authenticated. If you later need IP for abuse
  investigation, add it behind a shorter retention than the rest of the log.
- **Free-text filters are hashed, not stored.** `AUDIT_FREE_TEXT_KEYS` in
  `workers/case-api/cloudflare.js` is the single place that decision lives.
  Any new free-text filter parameter must be added to it in the same commit
  that adds the parameter, or its values start flowing into Logpush.
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
- **`has_full_text`, the removal of `user_notes`, the 5,000-row cap and the new
  401/403 are all breaking API changes.** Step 6 is the rollout: consumer
  inventory, release note, rollback. A repo grep shows no UI caller
  (`frontend/src/lib/api.ts:1345` is `@deprecated` with none) — but a grep
  cannot see an operator's local script or a cron job outside the repo, so the
  operator has to be asked directly, which Step 6a requires.
- **`user_notes` is still exposed on the paginated read path.** It remains in
  `LEGACY_CASE_PROJECTION` (`workers/storage/cloudflare.js:96`), so
  `GET /api/v1/cases` and case detail still return it and this plan closes only
  the bulk vector. `plans/050-*.md` ("move user data server-side") is the right
  home for the rest. Do not describe `user_notes` as private after this plan.
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
  sketch) — now IMPLEMENTED in Step 5; the earlier deferral was wrong.** The
  facts behind the deferral were right: `dispatchCloudflareCaseRead` is declared
  `(url, path, env)` at `workers/case-api/cloudflare.js:1029`, so neither an
  `Authorization` header nor `CF-Connecting-IP` reaches `handleExport`, and
  fixing that touches `workers/cloudflare-native.js:231` plus `wrangler.toml`.
  But "another plan owns those files" is a **sequencing** constraint, not a
  scope boundary — and the residual it left was not small. A 5,000-row cap plus
  an audit line with no actor field still permits anonymous filter-varied
  enumeration of a 149k-row immigration corpus, and produces an audit trail
  that cannot answer who did it. Shipping that under a plan titled
  "Authenticate, throttle and sanitise" would have looked like the control was
  in place. This plan now declares hard dependencies on 004 (limiter shape),
  006 (`assertPlatformOperator`), 005 (`await`ed dispatch) and 008
  (`cloudflare-native.js` ownership), runs last in that lane, and takes the
  two-line signature change plus the `RL_EXPORT` binding itself.
  The one genuinely deferred piece is the deploy-gate assertion for
  `RL_EXPORT`, which lives in plan 004's file; its consequence (fail-closed
  503s on a config gap) is stated in Scope and in "Maintenance notes".
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
