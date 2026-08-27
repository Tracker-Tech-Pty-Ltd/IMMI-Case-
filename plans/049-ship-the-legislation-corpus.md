# Plan 049: Make the legislation browser safe to publish into, then publish the 1,796 scraped sections

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` **if that file exists** (it did not at the time of
> writing; if it is still absent, skip it — the advisor maintains the index).
>
> **Drift check (run first)**. The committed-history diff cannot see
> uncommitted, staged or untracked work, so all four commands must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE="workers/case-api/cloudflare.js
>   workers/__tests__/case-api-cloudflare.test.js
>   frontend/src/pages/LegislationDetailPage.tsx
>   frontend/__tests__/legislation-detail.test.tsx
>   docs/adr/0049-legislation-corpus-publication.md"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $SCOPE     # committed since the plan was written
> git diff --stat -- $SCOPE                   # unstaged
> git diff --cached --stat -- $SCOPE          # staged
> ```
> Expected: the last three print nothing and no in-scope path appears in
> `git status` — `docs/adr/` merely existing (because
> `plans/044-retire-the-stale-planning-docs.md` owns and created it) is fine.
> If any in-scope file appears in **any** of them, treat it as a STOP
> condition: compare the "Current state" excerpts against the live code and
> report. **Never** run `git checkout --` or `git clean -f` to force a clean
> tree — the uncommitted work is the operator's.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md` (soft — see "Commands you will need"; this plan runs the working typecheck form itself, so it is not blocked by 001)
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

IMMI-Case has already scraped and checked in the complete text of five
Australian immigration laws — 1,796 sections, 2.9 MB, sitting in
`immi_case_downloader/data/legislations.json` since February 2026. None of it
reaches users. Production serves the Migration Act 1958 as a 454-byte
metadata shell that advertises `"sections_count":940` next to an empty page.
For the product's primary user — a self-representing visa applicant, not a
lawyer — the highest-value non-case content on the site is a promise the site
does not keep.

Publishing it is a data-upload job, not a build job. But the upload cannot be
done safely today: the Worker's R2 read path **hard-requires** a `sha256`
custom-metadata field on the object, `wrangler r2 object put` has **no flag
that can set custom metadata**, and an object uploaded without it makes the
whole legislation detail route return **HTTP 503** instead of the (merely
empty) page it returns now. So the naive publication attempt makes the product
strictly worse, and there is no in-repo signal warning anyone about that.

This plan does the two things that must happen *before* an operator uploads
anything: make a bad or unverifiable import degrade to today's behaviour
instead of a hard outage, and stop the page from advertising 940 sections it
cannot show. It then hands the operator a runbook whose upload step actually
works. After that, publication is a five-object copy with no code change.

## Current state

### The corpus exists and is complete

`immi_case_downloader/data/legislations.json` is git-tracked (2.9 MB) and its
`_comment` field reads
`"Populated by scripts/download_legislations.py — do not edit sections manually"`.
Measured directly with `.venv/bin/python` at commit `42826a3` — for every law,
the `sections` array length equals the declared `sections_count`, and the
canonical-JSON byte size is:

| law id | sections | canonical JSON bytes |
|---|---|---|
| `migration-act-1958` | 940 | 1,622,230 |
| `migration-regulations-1994` | 394 | 958,901 |
| `australian-citizenship-act-2007` | 84 | 162,633 |
| `australian-border-force-act-2015` | 60 | 89,836 |
| `administrative-review-tribunal-act-2024` | 318 | 90,667 |
| **total** | **1,796** | **2,924,267** |

A section object has exactly these keys: `division`, `id`, `number`, `part`,
`text`, `title`.

### Production serves none of it (verified live, 2026-08-27)

```
$ curl -s -D - https://immi.trackit.today/api/v1/legislations/migration-act-1958
HTTP/2 200
content-type: application/json
content-length: 454
cache-control: public, max-age=3600
```

Parsed: `sections_count= 940   len(sections)= 0`. The same probe on the other
four ids returns `394/0`, `84/0`, `60/0`, `318/0`. So all five laws are
metadata-only in production.

### The Worker handler that produces that response

`workers/case-api/cloudflare.js:392-404` — verbatim:

```js
async function handleLegislationDetail(path, stores) {
  const match = path.match(/^\/api\/v1\/legislations\/([^/]+)$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!id) return jsonErr("legislation_id is required");
  if (id === "search" || id === "update") return null;
  const legislation = LEGISLATIONS_META.find((item) => item.id.toLowerCase() === id);
  if (!legislation) return jsonErr(`Legislation '${id}' not found`, 404);
  const scraped = await stores.objectStore.getLegislation(id);
  // The static catalogue remains a safe metadata fallback until the first
  // native legislation Queue import completes; sections are never fabricated.
  return jsonOk({ success: true, data: scraped || { ...legislation, sections: [] } }, "public, max-age=3600");
}
```

`jsonOk` is the tiny helper at `workers/case-api/cloudflare.js:74-76` — verbatim:

```js
function jsonOk(body, cacheControl = "no-cache") {
  return Response.json(body, { headers: { "Cache-Control": cacheControl } });
}
```

`LEGISLATIONS_META` is the frozen static catalogue at
`workers/case-api/static.js:101-107`. Line 102 begins (truncated here after the
field this plan cares about — the real line continues to `last_scraped`):

```js
export const LEGISLATIONS_META = Object.freeze([
  { id: "migration-act-1958", title: "Migration Act 1958", austlii_id: "consol_act/ma1958118", shortcode: "MA1958", type: "Act", jurisdiction: "Commonwealth", description: "The primary legislation governing migration to, from and within Australia. Establishes visa framework, deportation procedures, and rights of non-citizens.", sections_count: 940, …
```

That `sections_count: 940` is correct data — it matches the corpus. It is not
the bug. The bug is shipping it alongside an empty `sections` array.

### The R2 read path hard-requires sha256 custom metadata

`workers/storage/cloudflare.js:403-415` — verbatim:

```js
  async getLegislation(lawId) {
    if (typeof lawId !== "string" || !/^[a-z0-9][a-z0-9-]{1,127}$/.test(lawId)) return null;
    const key = assertObjectKey(`legislations/${lawId}.json`, "legislations");
    const object = await this.bucket.get(key);
    if (!object || typeof object.arrayBuffer !== "function") return null;
    const checksum = object.customMetadata?.sha256;
    if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new StorageBoundaryError("Legislation checksum metadata is missing", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
```

It continues by recomputing sha256 over the bytes and throwing the same
`r2_verification_failed` on mismatch, or `r2_payload_invalid` on bad JSON.
`this.bucket` is `env.IMMI_CONTENT` (`workers/storage/cloudflare.js:248`),
bound in `wrangler.toml:37-39` to bucket `immi-content`.

Those throws are **not** caught inside `handleLegislationDetail`. They
propagate to the dispatcher's catch at
`workers/case-api/cloudflare.js:1163-1167` — verbatim:

```js
  } catch (err) {
    if (err instanceof StorageBoundaryError) return jsonErr(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "case.cloudflare.read_error", error: err?.message }));
    return jsonErr("Case service unavailable", 503, "case_store_unavailable");
  }
```

**Consequence, and the reason this plan exists**: an object uploaded without
`customMetadata.sha256` turns `GET /api/v1/legislations/{id}` from "200 with an
empty section list" into "503". `npx wrangler r2 object put --help` (run at
`42826a3`) lists `--content-type`, `--content-disposition`,
`--content-encoding`, `--content-language`, `--cache-control`, `--expires`,
`--storage-class`, `--jurisdiction`, `--file`, `--pipe` — and **no custom /
user metadata flag at all**. The obvious upload command therefore breaks the
page.

### The frontend advertises a count it cannot honour

`frontend/src/pages/LegislationDetailPage.tsx:218-223` — verbatim:

```tsx
            <MetaChip
              icon={<BookOpen className="h-3.5 w-3.5" />}
              label={t("legislations.sections", { defaultValue: "Sections" })}
              value={legislation.sections_count || undefined}
              accent
            />
```

`frontend/src/pages/LegislationDetailPage.tsx:249-254` — verbatim:

```tsx
      {/* Sections viewer */}
      {sections.length === 0 ? (
        <NotScrapedState onUpdate={() => navigate("/legislations")} />
      ) : (
        <LegislationTextViewer sections={sections} />
      )}
```

`frontend/src/pages/LegislationDetailPage.tsx:65-89` — verbatim:

```tsx
/** Empty state when sections haven't been scraped yet */
function NotScrapedState({ onUpdate }: { onUpdate: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<BookOpen className="h-8 w-8" />}
      title={t("legislations.not_scraped_title", {
        defaultValue: "Full text not yet downloaded",
      })}
      description={t("legislations.not_scraped_description", {
        defaultValue:
          'Click "Update Laws" on the legislations list to download section text from AustLII.',
      })}
      action={
        <button
          type="button"
          onClick={onUpdate}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          {t("legislations.back_button")}
        </button>
      }
    />
  );
}
```

That `defaultValue` names an "Update Laws" control that **does not exist
anywhere in the SPA**: `useStartLegislationUpdate` is defined at
`frontend/src/hooks/use-legislations.ts:49` and has zero callers; the only
consumer of that module family on `LegislationsPage.tsx:53` is the read-only
`useLegislationUpdateStatus`. The user does not actually read that string —
`frontend/src/i18n/locales/en.json:664` overrides the key with
`"Full section text for this legislation has not yet been imported from AustLII. Section navigation may be limited until the next scheduled update completes."`
and `zh-TW.json:664` has an equivalent — so the stale copy is dead source text,
not a live lie. Fix it anyway so nobody trusts it.

The page already computes and renders an AustLII deep link. Line 138:

```tsx
  const austliiUrl = `${AUSTLII_BASE}/${legislation.austlii_id}/`;
```

and `AUSTLII_BASE` at line 22 is `"https://www.austlii.edu.au/au/legis/cth"`.
The header renders it at lines 190-198 — verbatim, and this plan reuses these
exact classes so no new token or magic number is introduced:

```tsx
              <a
                href={austliiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md border border-accent/30 bg-background px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                AustLII
              </a>
```

`EmptyState` (`frontend/src/components/shared/EmptyState.tsx`) declares
`action?: ReactNode`, so an anchor or a wrapper `<div>` is a legal value there.

### Repo conventions this plan must match

Quoted from `CLAUDE.md` and `~/.claude/rules/` because the executor has not
read them:

- **React**: use `.toSorted()` not `.sort()`; wrap every `localStorage` call in
  try/catch; use `t("key", { defaultValue: "..." })` for UI strings;
  filter-dependent TanStack Query hooks use `placeholderData`/`keepPreviousData`;
  every Recharts `Tooltip` `contentStyle` must set `color: "var(--color-text)"`;
  put `animate-spin` on a wrapper `<div>`, never on the SVG icon; all
  spacing/shadow/radius/colour values come from
  `frontend/src/tokens/tokens.json` — **no magic numbers**.
  (None of these except the `defaultValue` rule and the no-magic-numbers rule
  bite in this plan; reuse the existing utility classes quoted above.)
- **Responsive**: "filter row 相關元素（separator + 下拉選單）需包在同一 `<div>`
  一起換行" — related controls that must wrap together go in one flex-wrap
  container. Step 4 puts the two empty-state actions in one such container.
- **Design direction** is decided and named **"Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. The brand is *authoritative,
  precise, academic*; the primary user is a self-representing immigration
  applicant, not a lawyer. A page that claims 940 sections and shows none is
  the single most brand-damaging state in the product.
- **Worker**: tenant isolation is app-layer via
  `CloudflareIdentityStore.assertMembership()` — there is **no Postgres and no
  RLS**. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1
  bindings. (The legislation route is unauthenticated public read; none of this
  applies to it, but do not "add" auth to it.)
- **Structured logs**: mutation and auth handlers use
  `console.log(JSON.stringify({event, ...}))`. Step 2 follows that shape.
- **Commit convention**: `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.

### Test-harness facts you will need

- Frontend tests live in `frontend/__tests__/` (NOT `frontend/src/__tests__/`).
  `frontend/vitest.config.ts` sets
  `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]` and
  `setupFiles: ["./__tests__/legislations-setup.ts"]`.
- **`CLAUDE.md` is wrong about the i18n mock.** It claims the mock returns the
  key string without `defaultValue`. The actual mock in
  `frontend/__tests__/legislations-setup.ts` returns `options.defaultValue`
  when one is supplied, and the key string otherwise. Write assertions
  accordingly: a `t(key, { defaultValue })` call renders the *defaultValue*
  text in tests.
- Worker tests live in `workers/__tests__/`. There is **no**
  `workers/package.json`; `cd workers && npx vitest run` resolves against the
  root `node_modules` (see the comment in the `Makefile` `install` target).
- Baseline at `42826a3`, **per file** — these are the numbers this plan asserts
  on, because only this plan edits these two files:
  `workers/__tests__/case-api-cloudflare.test.js` = 20 passing;
  `frontend/__tests__/legislation-detail.test.tsx` = 15 passing.
  Whole-suite totals at `42826a3` were workers 345 / 25 files and frontend
  490 / 55 files, but **do not assert those** — several sibling plans add tests
  to both suites, so record your own `WK_BEFORE` / `FE_BEFORE` and assert the
  delta (see "Commands you will need").

## Commands you will need

**Record baselines; do not assert absolute suite totals.** Sibling plans add
tests to both suites in parallel, so any total written here is stale on arrival:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
(cd workers  && npx vitest run 2>&1 | tail -3)   # -> WK_BEFORE (passed count, 0 failed)
(cd frontend && npx vitest run 2>&1 | tail -3)   # -> FE_BEFORE (passed count, 0 failed)
```

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (this file) | `cd workers && npx vitest run __tests__/case-api-cloudflare.test.js` | `22 passed` after step 3 (`20` before) |
| Worker tests (all) | `cd workers && npx vitest run` | `WK_BEFORE + 2` passed, 0 failed |
| Frontend tests (this file) | `cd frontend && npx vitest run __tests__/legislation-detail.test.tsx` | `19 passed` after step 5 (`15` before) |
| Frontend tests (all) | `cd frontend && npx vitest run` | `FE_BEFORE + 4` passed, 0 failed |
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0 |
| Production probe (read-only, public) | `curl -s https://immi.trackit.today/api/v1/legislations/<id>` | JSON, HTTP 200 |
| Drift check | see the four-command block at the top of this file | no in-scope path in any of them |

> **Do not use `make typecheck`.** It runs `cd frontend && npx tsc --noEmit`,
> which exits 0 while loading **zero** files — `frontend/tsconfig.json` is a
> project-references stub with `files: []`. Only the `-b` form actually checks
> the 169 source files. `plans/001-restore-the-frontend-compile-gate.md` fixes
> the Makefile target; until it lands, use `npx tsc -b --noEmit` as written
> above.

> **`make test-py` has pre-existing failures that are not yours.** Homebrew
> Python 3.14.7 has a pyexpat/libexpat ABI mismatch that breaks the `pypdf`
> import in `tests/test_backfill_judge_overrides_from_pdf.py` — exactly three
> ImportErrors, all in that one file. This plan touches no Python, so you do
> not need to run it; if you do, check the failures **by name**
> (`make test-py 2>&1 | grep -E "^(FAILED|ERROR)"`) rather than by counting a
> total, which sibling plans move.

## Scope

**In scope** (the only files you may modify):

- `workers/case-api/cloudflare.js` — **the legislation region only**
  (`handleLegislationDetail`, lines 392-404). Do not touch any other handler
  in this 1,100+ line file.
- `workers/__tests__/case-api-cloudflare.test.js` — add two tests, add one
  assertion to each of two existing tests.
- `frontend/src/pages/LegislationDetailPage.tsx`
- `frontend/__tests__/legislation-detail.test.tsx` — add four tests, and update
  the `應正確顯示條款數` assertion (see Step 4a — the change is deliberate).
- `docs/adr/0049-legislation-corpus-publication.md` (create — the **only** file
  you may add under `docs/adr/`).
- `plans/049-ship-the-legislation-corpus.md` — this file, status row only.

**Out of scope** (do NOT touch, even though they look related):

- `docs/adr/README.md` and `docs/adr/TEMPLATE.md` — owned by `plans/044`. Do
  not create them, append to them, or reformat them. Your ADR's index row is
  added by 044 when it lands (see "Maintenance notes").
- `frontend/src/__mocks__/legislations.ts` — `mockLegislationWithSections`
  declares `sections_count: 500` while carrying 2 sections. That mismatch is
  *useful*: it is what makes the Step 4a assertion meaningful. Do not "fix" the
  fixture to make the old assertion pass.
- `workers/case-api/static.js` — `LEGISLATIONS_META` was checked against the
  corpus and every `sections_count` is correct. There is nothing to fix here.
- `migrations/d1/catalog/` — the legislation corpus is an immutable R2
  artifact, not a catalog row; `scripts/transform_immi_snapshot.py:531`
  (`transform_legislations`) deliberately routes it to R2. Do not invent a
  D1 table for it.
- `frontend/src/lib/api.ts` — do not add a `sections_available` field to the
  `Legislation` interface. Everything this plan needs is derivable from the
  existing `sections` and `sections_count` fields, and other plans own this file.
- `frontend/src/i18n/locales/*.json` — `plans/018-complete-the-i18n-catalogue.md`
  owns the catalogues. This plan deliberately reuses only keys that already
  exist in both `en.json` and `zh-TW.json`, plus one bare literal (`AustLII`)
  that the page already renders untranslated at line 197.
- `frontend/src/components/legislation/LegislationTextViewer.tsx` — it renders
  sections non-virtualised (`sections.map(...)` at line 909). With 940 sections
  that is a real render-performance problem, but it is
  `plans/020-fix-render-performance.md`'s territory. See "Maintenance notes".
- `workers/pipeline/control_handlers.js` — `POST /api/v1/legislations/update`
  is operator-gated by design (`requireOperator` at line 45 returns 403
  `operator_role_required` at line 53 for anyone who is not owner/admin). That
  gate is correct. Do not weaken it, and do not wire a UI button to it.
- `scripts/`, `docs/`, `wrangler.toml`, and anything under
  `workers/austlii-scraper/`.
- Deploying, pushing, opening a PR, or uploading anything to R2. The operator
  does all of that using the runbook below.

## Git workflow

- Branch: `advisor/049-ship-the-legislation-corpus`
- Commit per logical unit. Suggested messages:
  - `fix: degrade legislation detail to metadata when the R2 import is unverifiable`
  - `fix: report the legislation sections actually served, not the declared count`
  - `test: cover the legislation fallback cache, count honesty and empty state`
  - `docs: record the legislation corpus publication decision as ADR 0049`
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits.

## Steps

### Step 1: Re-confirm the gap is still real before changing anything

This plan's entire premise is that production serves zero sections. That was
true on 2026-08-27. If someone published the corpus out-of-band since, steps
2-5 are still correct but step 4's empty state becomes unreachable in
production — and if the endpoint now returns 503, the upload was done wrongly
and that is a live incident, not a plan.

Run, from anywhere (public, unauthenticated, read-only):

```bash
for id in migration-act-1958 migration-regulations-1994 \
          australian-citizenship-act-2007 australian-border-force-act-2015 \
          administrative-review-tribunal-act-2024; do
  printf "%-42s " "$id"
  curl -s -o /tmp/l.json -w "http=%{http_code} " \
    "https://immi.trackit.today/api/v1/legislations/$id"
  python3 -c "import json;d=json.load(open('/tmp/l.json'))['data'];print('count=',d['sections_count'],'sections=',len(d.get('sections',[])))"
done
```

**Verify**: every line reads `http=200` and `sections= 0`, with counts
`940 / 394 / 84 / 60 / 318` respectively.

If any line shows `sections=` greater than 0, or any `http=` other than 200,
**STOP** — see "STOP conditions".

### Step 2: Make an unverifiable legislation import degrade instead of 503, and stop caching the empty page for an hour

Two defects in one four-line region of `workers/case-api/cloudflare.js`:

1. A `StorageBoundaryError` from `getLegislation` (missing sha256 metadata,
   checksum mismatch, or unparseable JSON) escapes to the dispatcher catch at
   line 1164 and becomes a 503 for the whole route. That is worse than the
   metadata-only page, and it is precisely what a `wrangler r2 object put`
   upload produces.
2. Both branches get `public, max-age=3600`. After the operator publishes, the
   edge keeps serving the empty body for up to an hour, so the operator cannot
   tell whether the upload worked.

Replace the body of `handleLegislationDetail` from `const scraped =` through
the `return jsonOk(...)` line (currently lines 400-403) with this shape. Keep
everything above line 400 exactly as it is:

```js
  let scraped = null;
  try {
    scraped = await stores.objectStore.getLegislation(id);
  } catch (error) {
    // A missing/incorrect checksum or unparseable payload must not take the
    // whole law browser down. Degrade to the metadata-only catalogue — the
    // page links out to AustLII — and log so a bad import is still visible.
    if (!(error instanceof StorageBoundaryError)) throw error;
    console.error(JSON.stringify({
      event: "legislation.import_unverifiable",
      law_id: id,
      code: error.code,
    }));
  }
  // The static catalogue remains a safe metadata fallback until the first
  // native legislation import completes; sections are never fabricated. The
  // fallback is cached briefly so a fresh import is not masked for an hour.
  if (!scraped) {
    return jsonOk({ success: true, data: { ...legislation, sections: [] } }, "public, max-age=60");
  }
  // Shape + self-consistency check on the imported payload. The checksum in
  // getLegislation() proves the bytes are the ones we uploaded; it says
  // nothing about whether the JSON inside them is coherent. A payload that
  // declares sections_count: 940 while carrying 2 sections would otherwise be
  // served as authoritative. Serve the real sections and report the real
  // count, and log the disagreement so a truncated import is discoverable.
  const sections = Array.isArray(scraped.sections) ? scraped.sections : [];
  if (scraped.sections_count !== sections.length) {
    console.error(JSON.stringify({
      event: "legislation.section_count_mismatch",
      law_id: id,
      declared: scraped.sections_count ?? null,
      actual: sections.length,
    }));
  }
  return jsonOk(
    { success: true, data: { ...scraped, sections, sections_count: sections.length } },
    "public, max-age=3600",
  );
```

`StorageBoundaryError` is already imported at
`workers/case-api/cloudflare.js:12` — do not add another import.

Note the response now reports `sections_count` as the number of sections it is
actually returning. That is a deliberate contract choice: `sections_count` is a
property of the payload being served, not a promise about a corpus the client
cannot see. The frontend chip in Step 4a reads `sections.length` and so agrees
with it either way; the two changes are belt and braces, not duplicates —
this one fixes the API for every consumer, that one fixes the page even if a
future payload bypasses this handler.

**Verify**:
```bash
cd workers && npx vitest run __tests__/case-api-cloudflare.test.js
```
→ `20 passed` (unchanged; the existing tests exercise both branches and must
not regress). If any test fails, re-read the excerpt above — you have almost
certainly changed a line outside 400-403, or the existing
"prefers a checksum-verified native legislation payload" test's fixture
declares a `sections_count` that disagrees with its `sections` array, in which
case the new normalisation is doing exactly its job and the fixture, not the
code, is what to look at. Report before changing that test's fixture.

### Step 3: Cover both cache branches and the degrade path in the Worker suite

Edit `workers/__tests__/case-api-cloudflare.test.js`.

**(a)** In the existing test `"serves legislation detail metadata with an
explicit not-scraped section list"` (starts at line 331), add one assertion
after the existing `expect(body).toMatchObject(...)`:

```js
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=60");
```

**(b)** In the existing test `"prefers a checksum-verified native legislation
payload when imported"` (starts at line 342), add one assertion after the
existing `expect(await result.json()).toMatchObject(...)`:

```js
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=3600");
```

**(c)** Add one new test immediately after (b). Follow the file's existing
style: `mockCreateStores()` returns the current stores object, and
`objectStore.getLegislation` is a `vi.fn()` you can drive with
`mockRejectedValueOnce`. `StorageBoundaryError` must be imported from
`../storage/contracts.js` — add that import next to the existing
`import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";` line
if it is not already present:

```js
  it("degrades to the metadata catalogue when a legislation import fails verification", async () => {
    const current = mockCreateStores();
    current.objectStore.getLegislation.mockRejectedValueOnce(
      new StorageBoundaryError("Legislation checksum metadata is missing", {
        code: "r2_verification_failed",
        status: 503,
      }),
    );
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/migration-act-1958"),
      "/api/v1/legislations/migration-act-1958",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true, data: { id: "migration-act-1958", sections: [] } });
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
```

**(d)** Add a second new test, immediately after (c), covering the
self-consistency normalisation:

```js
  it("reports the sections it actually returns, not the payload's declared count", async () => {
    const current = mockCreateStores();
    current.objectStore.getLegislation.mockResolvedValueOnce({
      id: "migration-act-1958",
      title: "Migration Act 1958",
      sections_count: 940,                       // the payload lies
      sections: [{ id: "s1", number: "1", title: "Short title", part: "", division: "", text: "x" }],
    });
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/migration-act-1958"),
      "/api/v1/legislations/migration-act-1958",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.data.sections).toHaveLength(1);
    expect(body.data.sections_count).toBe(1);
  });
```

**Verify**:
```bash
cd workers && npx vitest run __tests__/case-api-cloudflare.test.js
```
→ `22 passed` (20 existing + 2 new). Then `cd workers && npx vitest run` →
`WK_BEFORE + 2` passed, 0 failed. Record `WK_BEFORE` before you start; do not
assert an absolute suite total, because sibling plans add tests to this suite
in parallel.

### Step 4: Stop the detail page advertising a section count it cannot show, and give the reader AustLII

Three edits in `frontend/src/pages/LegislationDetailPage.tsx`.

**(a)** The sections chip (lines 218-223). Show **what is actually here**, not
what the payload claims. `sections` is already in scope at line 137
(`const sections = legislation.sections ?? [];`). Change `value` only:

```tsx
              value={sections.length > 0 ? sections.length : undefined}
```

`MetaChip` returns `null` when `value` is falsy and not `0` (line 35), so the
chip still disappears on the unpublished path.

**Why `sections.length` and not `legislation.sections_count`.** An earlier
draft kept rendering `sections_count` and merely hid it when the array was
empty. That fixes only the all-or-nothing case. If a payload declares 940 and
carries 2 — a truncated import, a partial upload, a future paginated response —
the page still advertises 940 above a list of 2, which is the exact failure
this step exists to remove, in a form nobody would notice. `sections.length` is
the number the reader can verify by scrolling. On a correctly published law the
two are identical (verified against the corpus: `len(sections) ==
sections_count` for all five laws), so nothing changes on the happy path.

**This changes an existing test's expectation, deliberately.** The test
`應正確顯示條款數` (`frontend/__tests__/legislation-detail.test.tsx:219`)
asserts `"500"` renders, because `mockLegislationWithSections`
(`frontend/src/__mocks__/legislations.ts`) declares `sections_count: 500` while
carrying **2** section objects. That mock is itself an instance of the bug: it
is a payload whose declared count and real content disagree. Update the
assertion to expect `"2"` and rename nothing else:

```tsx
    // The chip reports the sections actually present (2 in the fixture), not
    // the payload's declared sections_count (500). See plan 049 Step 4a.
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.queryByText("500")).not.toBeInTheDocument();
```

`frontend/src/__mocks__/legislations.ts` is **out of scope** — do not "fix" the
fixture to make the old assertion pass. Its mismatch is what makes the new
assertion meaningful.

**(b)** `NotScrapedState` (lines 65-89). Replace the whole function with:

```tsx
/** Empty state when the full section text has not been published yet. */
function NotScrapedState({
  austliiUrl,
  onBack,
}: {
  austliiUrl: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<BookOpen className="h-8 w-8" />}
      title={t("legislations.not_scraped_title", {
        defaultValue: "Full text not yet downloaded",
      })}
      description={t("legislations.not_scraped_description", {
        defaultValue:
          "Full section text for this legislation has not yet been imported from AustLII. Section navigation may be limited until the next scheduled update completes.",
      })}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href={austliiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md border border-accent/30 bg-background px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/5"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            AustLII
          </a>
          <button
            type="button"
            onClick={onBack}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            {t("legislations.back_button")}
          </button>
        </div>
      }
    />
  );
}
```

Notes so you do not second-guess this:
- The new `defaultValue` is copied **verbatim** from
  `frontend/src/i18n/locales/en.json:664`, so source and catalogue finally
  agree and the dead `"Update Laws"` reference is gone. Both `en.json` and
  `zh-TW.json` already define `legislations.not_scraped_title`,
  `legislations.not_scraped_description` and `legislations.back_button`, so
  **no catalogue edit is needed**.
- The literal `AustLII` matches the untranslated label the header already uses
  at line 197. Do not add an i18n key for it.
- The anchor's classes are copied verbatim from the header link (lines 190-198)
  — every colour, radius and spacing value is an existing token utility, so no
  magic numbers are introduced.
- The wrapper `<div>` with `flex flex-wrap` keeps the two actions wrapping
  together, per the repo's flex-wrap convention.
- `ExternalLink` is already imported at line 6; `BookOpen` at line 5. Add no
  imports.

**(c)** The call site (lines 249-254). Pass the two new props:

```tsx
      {/* Sections viewer */}
      {sections.length === 0 ? (
        <NotScrapedState
          austliiUrl={austliiUrl}
          onBack={() => navigate("/legislations")}
        />
      ) : (
        <LegislationTextViewer sections={sections} />
      )}
```

`austliiUrl` is already computed at line 138.

**Verify**:
```bash
cd frontend && npx tsc -b --noEmit && npx vitest run __tests__/legislation-detail.test.tsx
```
→ typecheck exits 0, `15 passed` — with the `應正確顯示條款數` assertion
updated as described in 4a (it now expects `"2"`, the real section count, and
asserts `"500"` is absent). If you run this **before** updating that
assertion, it will fail on exactly that test; that failure is the change
working, not a mistake.

### Step 5: Cover the honest empty state in the frontend suite

Edit `frontend/__tests__/legislation-detail.test.tsx`. Add these three tests at
the end of the `describe("LegislationDetailPage", ...)` block, before its
closing `});`.

First add the import for the base mock at the top of the file, next to the
existing `import { mockLegislationDetail } from "@/__mocks__/legislations";`:

```tsx
import { mockLegislationWithSections } from "@/__mocks__/legislations";
```

(Both are exported from `frontend/src/__mocks__/legislations.ts`; you may merge
them into one import statement.)

Then add, inside the describe block:

```tsx
  const unpublishedDetail = {
    success: true as const,
    data: { ...mockLegislationWithSections, sections: [] },
  };

  const successQuery = (data: unknown) => ({
    data,
    isLoading: false,
    error: null,
    status: "success",
    isPending: false,
    isSuccess: true,
    failureCount: 0,
    failureReason: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    remove: vi.fn(),
    refetch: vi.fn(),
  });

  // Test 16: an unpublished law must not advertise a section count
  it("在條文尚未發佈時不顯示條款數", async () => {
    mockUseLegislationDetail.mockReturnValue(successQuery(unpublishedDetail));

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.queryByText("500")).not.toBeInTheDocument();
    });
  });

  // Test 16b: a partially-loaded law must advertise what it has, not what the
  // payload claims. mockLegislationWithSections declares sections_count: 500
  // and carries 2 sections — the regression this guards is showing "500".
  it("條款數以實際載入的條文數為準", async () => {
    mockUseLegislationDetail.mockReturnValue(
      successQuery({ success: true as const, data: mockLegislationWithSections }),
    );

    renderWithProviders(<LegislationDetailPage />);

    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(screen.queryByText("500")).not.toBeInTheDocument();
  });

  // Test 17: the empty state sends the reader to AustLII, not to a dead end
  it("在條文尚未發佈時提供 AustLII 連結", async () => {
    mockUseLegislationDetail.mockReturnValue(successQuery(unpublishedDetail));

    renderWithProviders(<LegislationDetailPage />);

    const links = await screen.findAllByRole("link", { name: /austlii/i });
    // one in the page header, one in the empty state
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute(
        "href",
        "https://www.austlii.edu.au/au/legis/cth/consol_act/ma1958116/",
      );
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  // Test 18: regression guard — the empty state must not name a control that
  // does not exist. `useStartLegislationUpdate` has no callers in the SPA.
  it("空狀態不得提及不存在的 Update Laws 控制項", async () => {
    mockUseLegislationDetail.mockReturnValue(successQuery(unpublishedDetail));

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/not yet been imported from AustLII/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Update Laws/i)).not.toBeInTheDocument();
  });
```

The `austlii_id` in `mockLegislationWithSections` is `"consol_act/ma1958116"`
(note: `…116`, which differs from production's `…118` — that is the mock's
value and the assertion above uses the mock's, correctly). The setup mock
returns `defaultValue` when one is supplied, which is why Test 18 can assert on
the English description text.

**Verify**:
```bash
cd frontend && npx vitest run __tests__/legislation-detail.test.tsx
```
→ `19 passed` (15 existing — one of them with an updated assertion, see Step 4a
— plus 4 new). Then `cd frontend && npx vitest run` → `FE_BEFORE + 4` passed,
0 failed. Record `FE_BEFORE` before you start; do not assert an absolute suite
total.

### Step 6: Record the publication decision as ADR 0049

The runbook below is the most perishable thing in this plan: it encodes a
rollback story, an unverified upload mechanism and a provenance decision that
somebody will need six months from now, and plan files are not where that
survives. Create **exactly one** file:

`docs/adr/0049-legislation-corpus-publication.md`

**ADR numbering is centrally assigned.** `0049` is this plan's, and only this
plan's. `plans/044-retire-the-stale-planning-docs.md` **owns** `docs/adr/` —
including `docs/adr/README.md` and `docs/adr/TEMPLATE.md`. Do **not** create or
edit either; `mkdir -p docs/adr` is fine and the directory already existing is
normal, not a STOP condition.

The ADR must contain, in English:

1. `## Status` — `Proposed`, dated, with an unchecked operator sign-off line.
   This ADR gates a publication that cannot be un-published cleanly; it must
   not read as already decided.
2. `## Context` — the corpus exists and is complete (the five-law table from
   "Current state", with byte sizes and section counts); production serves
   metadata-only 200s; `getLegislation` hard-requires `customMetadata.sha256`
   (`workers/storage/cloudflare.js:407-412`) and `wrangler r2 object put` has
   no flag that can set it, so the obvious upload command turns the route into
   a 503.
3. `## Decision — how the corpus is published` — the staging-key probe first,
   then one law at a time smallest-first, each verified with `head-object`
   before the next. Record that the S3 `--metadata` → `customMetadata` mapping
   was **unverified at authoring time** and name the staging probe as the thing
   that verifies it.
4. `## Rollback` — the two cases from runbook step 1a, stated plainly: with no
   prior object, rollback is `delete-object`; with a prior object, rollback is
   re-uploading the saved bytes **with recomputed sha256 metadata**, and
   deleting instead would be a silent downgrade. Record that R2 has no object
   versioning here, so the local `/tmp/legis-prior-*.json` copies are the only
   version that exists.
5. `## Provenance and staleness` — **the operator's decision, recorded**: the
   as-at date shown to users and where; the source (AustLII) and its
   licence/attribution terms; what the page shows when `last_scraped` is beyond
   some age. Record the measured facts that force the question: every law's
   `last_scraped` is 2026-02-23, and `last_amended` is empty for **all five**
   laws — the corpus carries no amendment date whatsoever. State that
   publication is blocked until this section is filled in —
   a self-represented applicant relying on superseded law is the worst outcome
   available to this feature.
6. `## Performance gate for the two large laws` — the `plans/020` precondition
   and the measured TBT / longest-task numbers at 318 sections, with the actual
   figures once measured.
7. `## Consequences` — what publishing buys, and what it costs (a ~1.6 MB JSON
   response for the Migration Act; `sections_count` in the API now reports what
   is returned rather than what the payload claims).

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && ADR=docs/adr/0049-legislation-corpus-publication.md && \
  test -f "$ADR" && \
  grep -c "^## " "$ADR" && \
  grep -q "Rollback" "$ADR" && \
  grep -q "last_scraped" "$ADR" && \
  grep -q "head-object" "$ADR" && \
  git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md
```
→ a heading count `≥ 7`, the three greps exit 0, and the `git status` prints
**nothing** (you did not touch plan 044's files).

## Operator publication runbook (hand this to the operator — do NOT run it yourself)

The executor has no production credentials and must not attempt any of this.
This section exists so the person who does have them can finish the job in one
sitting, without rediscovering the wrangler trap.

**Precondition**: steps 1-5 above are merged and deployed. Publishing before
the step 2 fix lands means a bad upload = site-wide 503 on the law browser.

**1. Generate the exact bytes the Worker expects.** The bytes must be
byte-identical to what `transform_legislations`
(`scripts/transform_immi_snapshot.py:531`) would emit, because the Worker
recomputes sha256 over them. Note that you **cannot** just run that script for
this: `main()` (line 690) takes a required `snapshot` positional and refuses to
run without a full Postgres-era snapshot directory. Reproduce its two helpers
directly — `canonical_json` (line 70) and `sha256_text` (line 74):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
mkdir -p /tmp/legis-out
.venv/bin/python - <<'PY'
import hashlib, json, pathlib
src = pathlib.Path("immi_case_downloader/data/legislations.json")
out = pathlib.Path("/tmp/legis-out"); out.mkdir(parents=True, exist_ok=True)
for law in json.loads(src.read_text(encoding="utf-8"))["legislations"]:
    encoded = json.dumps(law, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), default=str) + "\n"
    data = encoded.encode("utf-8")
    (out / f"{law['id']}.json").write_bytes(data)
    print(f"{law['id']:45s} {len(data):9,d} bytes  sha256={hashlib.sha256(data).hexdigest()}")
PY
```

Record the five sha256 values. They are content hashes of public law text, not
secrets. Keep `/tmp/legis-out` until step 5 — it is your rollback source.

**1a. Record the prior state of every key you are about to write.** "Delete the
object" is not a rollback; it is a second, different outcome. If a key already
holds an object, you need its bytes and its metadata before you overwrite it:

```bash
for id in migration-act-1958 migration-regulations-1994 \
          australian-citizenship-act-2007 australian-border-force-act-2015 \
          administrative-review-tribunal-act-2024; do
  echo "== $id"
  aws s3api head-object --endpoint-url "$R2_ENDPOINT" \
    --bucket immi-content --key "legislations/$id.json" 2>&1 | \
    grep -E 'ETag|ContentLength|LastModified|sha256|Not Found' || true
  aws s3api get-object --endpoint-url "$R2_ENDPOINT" \
    --bucket immi-content --key "legislations/$id.json" \
    "/tmp/legis-prior-$id.json" >/dev/null 2>&1 \
    && echo "prior bytes saved to /tmp/legis-prior-$id.json" \
    || echo "no prior object (rollback = delete the key)"
done
```

Write the result down per key. There are exactly two rollback stories and you
must know which one applies **before** you upload:

- **No prior object** (the expected case today — production serves the static
  catalogue, so nothing is in R2): rollback is `aws s3api delete-object` on
  that key, which returns the route to today's metadata-only 200.
- **A prior object exists**: rollback is re-uploading
  `/tmp/legis-prior-<id>.json` **with its own recomputed sha256 metadata**, by
  the same procedure as step 2. Deleting would be a silent downgrade, not a
  restore. Note R2 does not give you object versioning by default, so the local
  copy is the only version you have — do not delete `/tmp/legis-prior-*.json`
  until the new object has been live and correct for a full day.

**1b. Decide the provenance and staleness disclosure before publishing
anything.** This is a legal-information product for self-represented
applicants; publishing 1,796 sections with no as-at date is the highest-harm
thing in this plan. Check what the corpus actually carries:

```bash
.venv/bin/python - <<'PY'
import json, pathlib
d = json.loads(pathlib.Path("immi_case_downloader/data/legislations.json").read_text(encoding="utf-8"))
for law in d["legislations"]:
    print(f"{law['id']:45s} last_scraped={law.get('last_scraped')!r:28s} last_amended={law.get('last_amended')!r}")
PY
```

Measured at `42826a3`: `last_scraped` is 2026-02-23 for **every** law — six
months stale at the time of writing — and `last_amended` is the empty string
for **all five**, not just the Migration Act. So the corpus carries no
amendment date at all for any law it would publish. Publishing that without
disclosure invites an applicant to rely on superseded law. **Do not
publish until the operator has decided and recorded, in
`docs/adr/0049-legislation-corpus-publication.md` (Step 6):** the as-at date
shown to users, where it is shown, the source and its licence/attribution
terms (AustLII's terms of use apply to reproduced material), and what the page
says when `last_scraped` is older than some threshold. That decision is the
operator's; this runbook's job is to refuse to proceed without it.

**2. Upload with custom metadata — `wrangler` cannot do this.**
`npx wrangler r2 object put` has no custom/user-metadata flag (verified at
`42826a3`), and `workers/storage/cloudflare.js:407-412` rejects any object
whose `customMetadata.sha256` is missing or malformed with a 503. Use the R2
**S3-compatible API**, which maps `x-amz-meta-sha256` onto R2 custom metadata.
This needs an R2 **access key ID + secret access key** (created in the
Cloudflare dashboard under R2 → Manage API tokens) — a different credential
from the wrangler API token. Store them in the environment, never in a file
that could be committed, and rotate them immediately after the upload since
they are write-capable:

```bash
export AWS_ACCESS_KEY_ID=...        # R2 access key id
export AWS_SECRET_ACCESS_KEY=...    # R2 secret access key
export R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
```

**2a. Prove the custom-metadata mechanism on a STAGING key first.** Whether
`--metadata` survives into R2's `customMetadata` is **unverified** — no
production R2 credentials were available when this plan was written, and the
whole publication rests on it. Do not discover the answer by overwriting a live
key. Use a key the Worker never reads:

```bash
ID=australian-border-force-act-2015
SUM=$(shasum -a 256 "/tmp/legis-out/$ID.json" | cut -d' ' -f1)
aws s3api put-object --endpoint-url "$R2_ENDPOINT" \
  --bucket immi-content --key "staging/legislations/$ID.json" \
  --body "/tmp/legis-out/$ID.json" \
  --content-type application/json \
  --metadata "sha256=$SUM"

aws s3api head-object --endpoint-url "$R2_ENDPOINT" \
  --bucket immi-content --key "staging/legislations/$ID.json"
```

**The head-object output must show `"Metadata": {"sha256": "<the same hex>"}`.**
If `Metadata` is absent, empty, or the key is mangled (some S3 clients lowercase
or prefix it), **stop — the mechanism does not work and no live key may be
written.** Compare the returned value against `$SUM` character for character;
"a metadata block is present" is not the assertion, "it carries this exact
digest under this exact key" is. `getLegislation`
(`workers/storage/cloudflare.js:407-412`) requires
`customMetadata.sha256` to match `/^[0-9a-f]{64}$/` and to equal the recomputed
digest of the bytes, so anything else produces a 503.

If the staging probe fails, the fallback is the pattern in
`docs/UPLOAD_JUDGE_PHOTOS.md`: a temporary, token-gated Worker `PUT` route that
writes through the R2 binding with
`env.IMMI_CONTENT.put(key, bytes, { customMetadata: { sha256 } })`, removed and
its secret deleted immediately afterwards. **That runbook is stale in two
ways** — it patches `workers/proxy.js`, which was deleted in commit `f91f45f`,
and it predates the checksum requirement, so its `put()` call would produce
exactly the 503 described above. Adapt, do not copy.

Delete the staging object once the probe has answered the question:
`aws s3api delete-object --endpoint-url "$R2_ENDPOINT" --bucket immi-content --key "staging/legislations/$ID.json"`.

**2b. Promote one law at a time, verifying metadata before trusting it.** Only
after 2a proved the mechanism, and only after 1a recorded the prior state:

```bash
for id in australian-border-force-act-2015 \
          administrative-review-tribunal-act-2024 \
          australian-citizenship-act-2007; do
  SUM=$(shasum -a 256 "/tmp/legis-out/$id.json" | cut -d' ' -f1)
  aws s3api put-object --endpoint-url "$R2_ENDPOINT" \
    --bucket immi-content --key "legislations/$id.json" \
    --body "/tmp/legis-out/$id.json" \
    --content-type application/json \
    --metadata "sha256=$SUM"
  # Verify the metadata landed BEFORE moving to the next law.
  GOT=$(aws s3api head-object --endpoint-url "$R2_ENDPOINT" \
          --bucket immi-content --key "legislations/$id.json" \
          --query 'Metadata.sha256' --output text)
  [ "$GOT" = "$SUM" ] || { echo "METADATA MISMATCH on $id: got '$GOT' want '$SUM' — ROLL BACK NOW"; break; }
  echo "$id ok"
done
```

There is no atomic swap in R2: `put-object` on a live key replaces it in place,
so the window between "written" and "verified" is real. That is why each law is
promoted and checked individually, smallest first, rather than looping over all
five — a mistake costs one law, and the rollback recorded in 1a restores it.

**3. Publish in ascending size order and check between each.** The three laws
in the loop above are the small ones (90 KB, 91 KB, 163 KB). Verify each:

```bash
curl -s "https://immi.trackit.today/api/v1/legislations/australian-border-force-act-2015" \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];print(d['sections_count'], len(d['sections']))"
```
Expected: `60 60`. Any 503 means the metadata did not land — apply the rollback
recorded in step 1a for that key before touching another law.

**4. The two large laws are gated on `plans/020`, not on a judgement call.**
`migration-regulations-1994` is 958,901 bytes / 394 sections and
`migration-act-1958` is 1,622,230 bytes / 940 sections — 1,334 sections between
them. Publishing them makes the detail endpoint return a ~1.6 MB JSON body
**and** makes `LegislationTextViewer` render 940 section cards in one
non-virtualised `sections.map(...)` (line 909), each running
`stripAustliiHeader` + `mergeContiguousBodyLines` through `useMemo`.

An earlier draft said to "load the ARTA 2024 page on a mid-range phone first
and judge from that". That is not a gate — it has no threshold, no device
definition, and no recorded result, so it always resolves to "seemed fine".
Replace it with a hard precondition and a measurable one:

- **Precondition**: `plans/020-fix-render-performance.md` has landed and
  `LegislationTextViewer` renders sections virtualised. Confirm with
  `git grep -n -- "virtual" -- frontend/src/components/legislation/LegislationTextViewer.tsx`
  returning a match, or by reading the component. If it still does a bare
  `sections.map(...)` over the whole array, **do not publish the big two.**
- **Measurement, on the largest already-published law (ARTA 2024, 318
  sections)**, recorded with numbers before and after:
  Chrome DevTools → Performance, mid-tier mobile emulation with 4× CPU
  throttling and "Fast 4G". Record Largest Contentful Paint, Total Blocking
  Time, and the longest single task. Publish the big two only if **TBT < 600 ms
  and no single task exceeds 200 ms** at 318 sections — at ~3× the section
  count the Migration Act will not be better than linear in these.
- If either bound fails at 318, the answer is not "try it and see": hold the
  two large laws and hand the numbers to whoever owns `plans/020`.

Write the measured numbers into
`docs/adr/0049-legislation-corpus-publication.md` (Step 6) alongside the
decision, so the next person inherits evidence rather than a vibe.

**5. Post-publication checks and cleanup.**
- Re-verify each published law's endpoint returns `N N` (declared == actual)
  and **200**, not 503, an hour after publishing — long enough for the
  `max-age=3600` response to have been cached and re-fetched at least once.
- Keep `/tmp/legis-prior-*.json` (your only copy of any prior object) for at
  least 24 hours after the last promotion. Only then delete them and
  `/tmp/legis-out`.
- **Rotate the R2 access key pair** used in step 2 as soon as the upload is
  confirmed. They are write-capable credentials on the production content
  bucket.

## Test plan

New tests, all following the structure of the file they live in:

**`workers/__tests__/case-api-cloudflare.test.js`** (model after the two
existing legislation tests at lines 331 and 342):
- *(assertion added)* metadata-only fallback responds `Cache-Control: public, max-age=60`.
- *(assertion added)* checksum-verified payload responds `Cache-Control: public, max-age=3600`.
- *(new test)* a `StorageBoundaryError` from `getLegislation` yields HTTP 200
  with `sections: []` and the short cache header — **the regression this plan
  exists to prevent** (today it yields 503).
- *(new test)* a payload declaring `sections_count: 940` while carrying 1
  section is served with `sections_count: 1` — the API never reports a count it
  is not delivering.

**`frontend/__tests__/legislation-detail.test.tsx`** (model after the existing
tests in the same file, which drive `mockUseLegislationDetail` directly):
- *(assertion changed)* `應正確顯示條款數` now expects `"2"` (the sections
  actually present) and asserts `"500"` (the fixture's declared count) is
  absent. See Step 4a for why this is the fix, not a broken test.
- *(new)* a partially-loaded law shows the real section count, not the declared
  one — the same property, pinned as its own named test so a future revert of
  4a fails loudly.
- *(new)* unpublished law → the sections `MetaChip` is absent.
- *(new)* unpublished law → exactly two AustLII links, both with the correct
  `href` and `rel="noopener noreferrer"`.
- *(new)* unpublished law → the description is the AustLII-import copy and the
  string `Update Laws` appears nowhere.

Regression surface to re-run in full: `cd workers && npx vitest run`
(`WK_BEFORE + 2`) and `cd frontend && npx vitest run` (`FE_BEFORE + 4`), both
with **0 failed**. No Python file is touched, so `make test-py` is not
required.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd workers && npx vitest run __tests__/case-api-cloudflare.test.js` → `22 passed`
- [ ] `cd workers && npx vitest run` → `WK_BEFORE + 2` passed, 0 failed
- [ ] `cd frontend && npx vitest run __tests__/legislation-detail.test.tsx` → `19 passed`
- [ ] `cd frontend && npx vitest run` → `FE_BEFORE + 4` passed, 0 failed
- [ ] `grep -c "Update Laws" frontend/src/pages/LegislationDetailPage.tsx` → `0`
- [ ] `grep -c "sections_count" frontend/src/pages/LegislationDetailPage.tsx` → `0` (the chip reads `sections.length`; a surviving reference means Step 4a was half-applied)
- [ ] `grep -c 'public, max-age=60' workers/case-api/cloudflare.js` → at least `1`
- [ ] `grep -c "legislation.import_unverifiable" workers/case-api/cloudflare.js` → `1`
- [ ] `grep -c "legislation.section_count_mismatch" workers/case-api/cloudflare.js` → `1`
- [ ] `test -f docs/adr/0049-legislation-corpus-publication.md` exits 0 and `grep -c "^## " ` on it prints `7` or more
- [ ] `git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md` prints nothing (plan 044 owns both)
- [ ] `git status --porcelain --untracked-files=all` lists only these paths:
      `workers/case-api/cloudflare.js`,
      `workers/__tests__/case-api-cloudflare.test.js`,
      `frontend/src/pages/LegislationDetailPage.tsx`,
      `frontend/__tests__/legislation-detail.test.tsx`,
      `docs/adr/0049-legislation-corpus-publication.md`,
      optionally `plans/049-ship-the-legislation-corpus.md`,
      plus anything already dirty at the drift check
- [ ] For each of `frontend/src/lib/api.ts`, `frontend/src/i18n/locales`, `workers/case-api/static.js`, `frontend/src/__mocks__/legislations.ts`, `migrations/d1/catalog`: all three of `git diff --stat 42826a3..HEAD -- <path>`, `git diff --stat -- <path>` and `git diff --cached --stat -- <path>` produce no output (the committed-only form cannot see your own uncommitted edit)
- [ ] Nothing was pushed, no PR opened, nothing uploaded to R2

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 1 shows any law already serving `sections` > 0.** The corpus was
  published out-of-band. Steps 2-5 remain correct but the premise changed;
  report which laws are live and their response sizes before continuing.
- **Step 1 shows any `http=` other than 200 — especially 503.** A 503 with code
  `r2_verification_failed` means someone already uploaded an object without
  sha256 custom metadata and the law browser is *currently broken in
  production*. That is an incident: report it immediately, and say that
  deleting the offending `legislations/*.json` object restores the 200
  behaviour.
- **`workers/case-api/cloudflare.js` no longer contains the verbatim
  `handleLegislationDetail` body quoted in "Current state"** — in particular if
  the `scraped ||` expression is gone, someone has already reworked this
  region.
- **`getLegislation` in `workers/storage/cloudflare.js` no longer throws on a
  missing `customMetadata.sha256`.** The whole justification for step 2 and for
  the runbook's S3-API detour is that hard requirement. If it has been relaxed,
  re-derive the upload path before writing anything.
- **`frontend/__tests__/legislation-detail.test.tsx` test 7 (`應正確顯示條款數`,
  line 219) fails after step 4 with an expectation other than the documented
  `"500"` → `"2"` change.** Step 4a deliberately changes that assertion; a
  failure showing `"2"` where `"500"` was expected is the change working. Any
  *other* failure there means `mockLegislationWithSections` no longer carries 2
  sections, and the chip conditional needs rethinking rather than patching the
  assertion.
- **The staging-key probe in runbook step 2a shows `Metadata` absent or under a
  different key.** The custom-metadata mechanism does not work as documented;
  no live key may be written. Report the exact `head-object` output.
- **The operator has not filled in the provenance/staleness section of
  `docs/adr/0049-legislation-corpus-publication.md`.** Publication is blocked
  on it; do not upload "just the small ones" to get moving.
- **The i18n keys `legislations.not_scraped_title`,
  `legislations.not_scraped_description` or `legislations.back_button` are
  missing from `frontend/src/i18n/locales/en.json` or `zh-TW.json`.** This plan
  is explicitly forbidden from editing those catalogues; if the keys are gone,
  report and stop rather than adding them (that is plan 018's territory).
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching a file on the "Out of scope" list.

## Maintenance notes

For whoever owns this next:

- **`docs/adr/README.md` is owned by plan 044; add the index row there when 044
  lands.** The row is
  `| [0049](0049-legislation-corpus-publication.md) | Legislation corpus publication | Proposed |`.
  This plan creates no index and no template.
- **The unblocked follow-up is publication, not code — but it is gated.** After
  this lands, the three small laws can be published with zero further code
  changes by following the runbook. The two large laws are additionally gated
  on `plans/020-fix-render-performance.md` landing virtualisation, plus the
  measured TBT / longest-task bounds in runbook step 4. The runbook's durable
  home is `docs/adr/0049-legislation-corpus-publication.md` (Step 6); whoever
  first runs it should also copy the operational half into
  `docs/ops/publish-legislation-corpus.md` and record the measured numbers back
  into the ADR.
- **`plans/020` is a hard dependency for the Migration Act, not a suggestion.**
  940 non-virtualised section cards is the load-bearing risk of this whole
  feature. If 020 is descoped or deferred, the big two stay unpublished; do not
  substitute a subjective "seemed fine on my phone".
- **`docs/UPLOAD_JUDGE_PHOTOS.md` is stale and dangerous to copy.** It patches
  `workers/proxy.js` (deleted in `f91f45f`) and its `put()` call omits the
  `customMetadata.sha256` that `getJudgePhoto`
  (`workers/storage/cloudflare.js:378-389`, which throws
  `"Judge photo checksum metadata is missing"` at line 386) and
  `getLegislation` now both require. Following it verbatim produces 503s.
  Fixing that doc is a good standalone chore.
- **Render performance is the real gate on the Migration Act.**
  `LegislationTextViewer.tsx:909` maps all sections with no virtualisation.
  940 section cards, each running `stripAustliiHeader` +
  `mergeContiguousBodyLines` through `useMemo`, is the load-bearing risk of
  publishing the largest law. Coordinate with
  `plans/020-fix-render-performance.md`.
- **A reviewer should scrutinise** the step 2 `catch`: it deliberately swallows
  `StorageBoundaryError` for this one route. Confirm it rethrows anything that
  is *not* a `StorageBoundaryError`, and that the `console.error` line is
  present so a silently-failing import is still discoverable in Logpush.
- **Deferred out of this plan**: roadmap item T16 (`docs/plans/2026-03-15-system-integration-roadmap.md:551`)
  — parsing `immigration_cases.legislation` into section references and adding
  a "cases citing this section" route. That needs its own spike; it is a
  genuine feature, not a publication fix, and nothing here blocks it.
- **Do not "fix"** the placeholder resource IDs in the checked-in
  `wrangler.toml`, the `IMMI_CASE_MUTATIONS_ENABLED` / pipeline flags
  defaulting to `"false"`, or `workers/austlii-scraper/scripts/rollback_run.ts`
  targeting legacy Supabase. All three are deliberate fail-closed / break-glass
  designs.

## Findings reconsidered

Corrections to the audit finding this plan was written from. Nothing was
silently dropped.

- **"a dead button that 403s for ordinary users" — not accurate; corrected.**
  The empty state's action is `t("legislations.back_button")`
  (`LegislationDetailPage.tsx:84`), a client-side `navigate("/legislations")`.
  It works. The *source* `defaultValue` at lines 75-77 names an "Update Laws"
  control, but `frontend/src/i18n/locales/en.json:664` and `zh-TW.json:664`
  both override that key with accurate copy, so users never read it. And there
  is no "Update Laws" control anywhere: `useStartLegislationUpdate`
  (`frontend/src/hooks/use-legislations.ts:49`) has zero callers —
  `LegislationsPage.tsx:53` uses only the read-only
  `useLegislationUpdateStatus`. The 403 gate at
  `workers/pipeline/control_handlers.js:53` is real and correct, but no UI
  reaches it. Step 4 still fixes the stale `defaultValue`; the plan does not
  claim a broken button.
- **"a one-off upload… making this a one-off upload rather than the M-effort
  build the finding assumed" — materially understated; corrected.**
  `transform_legislations` (`scripts/transform_immi_snapshot.py:531`) does emit
  the right `legislations/{id}.json` objects, but (a) its `main()` at line 690
  requires a full Postgres-era snapshot directory and cannot be invoked for
  legislation alone, and (b) `npx wrangler r2 object put` has **no custom
  metadata flag**, while `getLegislation`
  (`workers/storage/cloudflare.js:407-412`) 503s without
  `customMetadata.sha256`. The obvious upload command therefore breaks the
  route. That is why this plan ships the degrade-instead-of-503 fix first and
  routes the operator through the R2 S3 API.
- **Payload size was not considered by the finding; added.** Measured at
  `42826a3`: `migration-act-1958` is 1,622,230 canonical-JSON bytes over 940
  sections, and `LegislationTextViewer.tsx:909` renders them non-virtualised.
  Publication is therefore staged smallest-law-first in the runbook rather than
  all five at once.
- **`workers/case-api/static.js:101` and `migrations/d1/catalog/` need no
  change.** Every `sections_count` in `LEGISLATIONS_META` was checked against
  the corpus and is correct; legislation is deliberately an R2 artifact rather
  than a D1 row. Both are listed under "Out of scope" instead of being given
  invented work.
