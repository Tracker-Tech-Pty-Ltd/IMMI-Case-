# Plan 049: Make the legislation browser safe to publish into, then publish the 1,796 scraped sections

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` **if that file exists** (it did not at the time of
> writing; if it is still absent, skip it — the advisor maintains the index).
>
> **Drift check (run first)**:
> ```bash
> git diff --stat 42826a3..HEAD -- \
>   workers/case-api/cloudflare.js \
>   workers/__tests__/case-api-cloudflare.test.js \
>   frontend/src/pages/LegislationDetailPage.tsx \
>   frontend/__tests__/legislation-detail.test.tsx
> ```
> Expected at the time of writing: **no output** (no in-scope file changed).
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

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
- Baseline at `42826a3`: `workers/__tests__/case-api-cloudflare.test.js`
  = 20 tests passing; `frontend/__tests__/legislation-detail.test.tsx`
  = 15 tests passing. Whole suites: workers 345 / 25 files, frontend 490 /
  55 files.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests (this file) | `cd workers && npx vitest run __tests__/case-api-cloudflare.test.js` | 21 passed after step 3 (20 before) |
| Worker tests (all) | `cd workers && npx vitest run` | 346 passed, 25 files |
| Frontend tests (this file) | `cd frontend && npx vitest run __tests__/legislation-detail.test.tsx` | 18 passed after step 5 (15 before) |
| Frontend tests (all) | `cd frontend && npx vitest run` | 493 passed, 55 files |
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0 |
| Production probe (read-only, public) | `curl -s https://immi.trackit.today/api/v1/legislations/<id>` | JSON, HTTP 200 |
| Drift check | see the block at the top of this file | no output |

> **Do not use `make typecheck`.** It runs `cd frontend && npx tsc --noEmit`,
> which exits 0 while loading **zero** files — `frontend/tsconfig.json` is a
> project-references stub with `files: []`. Only the `-b` form actually checks
> the 169 source files. `plans/001-restore-the-frontend-compile-gate.md` fixes
> the Makefile target; until it lands, use `npx tsc -b --noEmit` as written
> above.

> **`make test-py` reports 3 failures at `42826a3` and they are not yours.**
> Homebrew Python 3.14.7 has a pyexpat/libexpat ABI mismatch that breaks the
> `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`.
> Baseline is 1141 passed / 3 failed / 7 skipped. This plan touches no Python;
> you do not need to run it.

## Scope

**In scope** (the only files you may modify):

- `workers/case-api/cloudflare.js` — **the legislation region only**
  (`handleLegislationDetail`, lines 392-404). Do not touch any other handler
  in this 1,100+ line file.
- `workers/__tests__/case-api-cloudflare.test.js` — add one test, add one
  assertion to an existing test.
- `frontend/src/pages/LegislationDetailPage.tsx`
- `frontend/__tests__/legislation-detail.test.tsx` — add three tests.
- `plans/049-ship-the-legislation-corpus.md` — this file, status row only.

**Out of scope** (do NOT touch, even though they look related):

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
  - `fix: stop advertising legislation section counts the page cannot show`
  - `test: cover the legislation fallback cache and empty state`
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
  return jsonOk({ success: true, data: scraped }, "public, max-age=3600");
```

`StorageBoundaryError` is already imported at
`workers/case-api/cloudflare.js:12` — do not add another import.

**Verify**:
```bash
cd workers && npx vitest run __tests__/case-api-cloudflare.test.js
```
→ `20 passed` (unchanged; the existing tests exercise both branches and must
not regress). If any test fails, re-read the excerpt above — you have almost
certainly changed a line outside 400-403.

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

**Verify**:
```bash
cd workers && npx vitest run __tests__/case-api-cloudflare.test.js
```
→ `21 passed`. Then `cd workers && npx vitest run` → `346 passed`, 25 files.

### Step 4: Stop the detail page advertising a section count it cannot show, and give the reader AustLII

Three edits in `frontend/src/pages/LegislationDetailPage.tsx`.

**(a)** The sections chip (lines 218-223). Only claim a count when the sections
are actually here. `sections` is already in scope at line 137
(`const sections = legislation.sections ?? [];`). Change `value` only:

```tsx
              value={
                sections.length > 0 ? legislation.sections_count : undefined
              }
```

`MetaChip` returns `null` when `value` is falsy and not `0` (line 35), so the
chip disappears on the unpublished path. On the published path the count is
unchanged — verified against the corpus, `sections.length === sections_count`
for all five laws.

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
→ typecheck exits 0, `15 passed`. The existing "應正確顯示條款數" test
(line 219) still passes because `mockLegislationDetail` carries two sections,
so `sections.length > 0` holds and `"500"` still renders.

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
→ `18 passed`. Then `cd frontend && npx vitest run` → `493 passed`, 55 files.

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
secrets.

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

for id in australian-border-force-act-2015 \
          administrative-review-tribunal-act-2024 \
          australian-citizenship-act-2007; do
  SUM=$(shasum -a 256 "/tmp/legis-out/$id.json" | cut -d' ' -f1)
  aws s3api put-object --endpoint-url "$R2_ENDPOINT" \
    --bucket immi-content --key "legislations/$id.json" \
    --body "/tmp/legis-out/$id.json" \
    --content-type application/json \
    --metadata "sha256=$SUM"
done
```

> This S3-API path is **documented but not executed** by the plan author — no
> production R2 credentials were available. Treat the first law as the
> experiment. If `aws s3api` is unavailable or R2 rejects the metadata, the
> fallback is the pattern in `docs/UPLOAD_JUDGE_PHOTOS.md`: a temporary,
> token-gated Worker `PUT` route that writes through the R2 binding with
> `env.IMMI_CONTENT.put(key, bytes, { customMetadata: { sha256 } })`, removed
> and its secret deleted immediately afterwards. **That runbook is stale in two
> ways** — it patches `workers/proxy.js`, which was deleted in commit
> `f91f45f`, and it predates the checksum requirement, so its `put()` call
> would produce exactly the 503 described above. Adapt, do not copy.

**3. Publish in ascending size order and check between each.** The three laws
in the loop above are the small ones (90 KB, 91 KB, 163 KB). Verify each:

```bash
curl -s "https://immi.trackit.today/api/v1/legislations/australian-border-force-act-2015" \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['data'];print(d['sections_count'], len(d['sections']))"
```
Expected: `60 60`. Any 503 means the metadata did not land — delete the object
and retry before touching another law.

**4. Only then consider the two large laws.**
`migration-regulations-1994` is 958,901 bytes / 394 sections and
`migration-act-1958` is 1,622,230 bytes / 940 sections. Publishing them makes
the detail endpoint return a ~1.6 MB JSON body **and** makes
`LegislationTextViewer` render 940 section cards in one non-virtualised
`sections.map(...)` (line 909). Load the ARTA 2024 page (318 sections, the
largest of the small three) on a mid-range phone first and judge from that
before shipping the Migration Act. If it is already sluggish at 318, hold the
big two until `plans/020-fix-render-performance.md` has landed.

**5. Rotate the R2 access key pair** used in step 2 as soon as the upload is
confirmed, and delete `/tmp/legis-out`.

## Test plan

New tests, all following the structure of the file they live in:

**`workers/__tests__/case-api-cloudflare.test.js`** (model after the two
existing legislation tests at lines 331 and 342):
- *(assertion added)* metadata-only fallback responds `Cache-Control: public, max-age=60`.
- *(assertion added)* checksum-verified payload responds `Cache-Control: public, max-age=3600`.
- *(new test)* a `StorageBoundaryError` from `getLegislation` yields HTTP 200
  with `sections: []` and the short cache header — **the regression this plan
  exists to prevent** (today it yields 503).

**`frontend/__tests__/legislation-detail.test.tsx`** (model after the existing
tests in the same file, which drive `mockUseLegislationDetail` directly):
- *(new)* unpublished law → the sections `MetaChip` is absent (`queryByText("500")`).
- *(new)* unpublished law → exactly two AustLII links, both with the correct
  `href` and `rel="noopener noreferrer"`.
- *(new)* unpublished law → the description is the AustLII-import copy and the
  string `Update Laws` appears nowhere.

Regression surface to re-run in full: `cd workers && npx vitest run`
(345 → 346) and `cd frontend && npx vitest run` (490 → 493). No Python file is
touched, so `make test-py` is not required.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd workers && npx vitest run` → `346 passed`, 25 files
- [ ] `cd frontend && npx vitest run` → `493 passed`, 55 files
- [ ] `grep -c "Update Laws" frontend/src/pages/LegislationDetailPage.tsx` → `0`
- [ ] `grep -c 'public, max-age=60' workers/case-api/cloudflare.js` → at least `1`
- [ ] `grep -c "legislation.import_unverifiable" workers/case-api/cloudflare.js` → `1`
- [ ] `git status --porcelain` lists only these paths:
      `workers/case-api/cloudflare.js`,
      `workers/__tests__/case-api-cloudflare.test.js`,
      `frontend/src/pages/LegislationDetailPage.tsx`,
      `frontend/__tests__/legislation-detail.test.tsx`,
      and optionally `plans/049-ship-the-legislation-corpus.md`
- [ ] `git diff --stat 42826a3..HEAD -- frontend/src/lib/api.ts frontend/src/i18n/locales workers/case-api/static.js migrations/d1/catalog` → no output
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
  line 219) fails after step 4.** That means `mockLegislationWithSections` no
  longer carries sections, and the chip conditional needs rethinking rather
  than patching the assertion.
- **The i18n keys `legislations.not_scraped_title`,
  `legislations.not_scraped_description` or `legislations.back_button` are
  missing from `frontend/src/i18n/locales/en.json` or `zh-TW.json`.** This plan
  is explicitly forbidden from editing those catalogues; if the keys are gone,
  report and stop rather than adding them (that is plan 018's territory).
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching a file on the "Out of scope" list.

## Maintenance notes

For whoever owns this next:

- **The unblocked follow-up is publication, not code.** After this lands, the
  corpus can be published with zero further code changes by following the
  runbook above. That runbook should be promoted out of this plan file into
  `docs/ops/publish-legislation-corpus.md` by whoever first runs it — kept
  here only because `docs/` belongs to other in-flight plans.
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
