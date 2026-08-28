# ADR-0049: Publishing the scraped legislation corpus to R2

## Status

**Proposed** — 2026-08-28. This ADR gates a publication that cannot be
un-published cleanly (see Rollback), so it does not read as already decided.
Publication of any law object may not proceed until an operator has:

- [ ] Read this ADR in full, including the Provenance and staleness section,
      and recorded the as-at date / licence disclosure decision there.
- [ ] Run the staging-key metadata probe (runbook step 2a in
      `plans/049-ship-the-legislation-corpus.md`) and confirmed
      `customMetadata.sha256` actually lands in R2.
- [ ] Signed off below with a name and date before uploading any live key.

Operator sign-off: `______________________`  Date: `____________`

## Context

`immi_case_downloader/data/legislations.json` (git-tracked, ~2.9 MB) contains
the complete scraped text of five Australian immigration laws. Every
`sections` array length matches its declared `sections_count`. Re-measured at
the commit this ADR was written against (canonical JSON, one trailing
newline per file — the exact bytes the upload script in the runbook produces
and the exact bytes the Worker's R2 read path re-hashes):

| law id | sections | canonical JSON bytes (upload form) |
|---|---|---|
| `migration-act-1958` | 940 | 1,622,231 |
| `migration-regulations-1994` | 394 | 958,902 |
| `australian-citizenship-act-2007` | 84 | 162,634 |
| `australian-border-force-act-2015` | 60 | 89,837 |
| `administrative-review-tribunal-act-2024` | 318 | 90,668 |
| **total** | **1,796** | **2,924,272** |

Production serves none of it. `GET /api/v1/legislations/{id}` returns HTTP
200 for all five ids, but every response carries `sections: []` next to a
`sections_count` that still advertises the full corpus (e.g.
`migration-act-1958` reports `sections_count: 940` with zero sections
present) — verified live against `https://immi.trackit.today` on 2026-08-28,
same result as when this plan was authored the day before.

The Worker's R2 read path hard-requires verified checksum metadata:
`getLegislation()` (`workers/storage/object.js:181-206` — this logic
originated in `workers/storage/cloudflare.js:403-415` and moved verbatim
when that file was split into per-domain modules; the requirement itself is
unchanged) throws a `StorageBoundaryError` (`code: "r2_verification_failed"`,
`status: 503`) whenever `object.customMetadata.sha256` is missing, malformed,
or does not match a recomputed SHA-256 of the object bytes. `npx wrangler r2
object put --help` (re-verified 2026-08-28, on the current wrangler in this
repo) lists `--content-type`, `--content-disposition`, `--content-encoding`,
`--content-language`, `--cache-control`, `--expires`, `--storage-class`,
`--jurisdiction`, `--file`, `--pipe` — and has **no flag that can set custom
metadata**. Before this plan's code changes, an object uploaded with the
obvious `wrangler` command therefore turned the whole legislation detail
route into a site-wide 503, which is worse than today's metadata-only page.
Plan 049's code changes (commits on branch
`advisor/049-ship-the-legislation-corpus`) make an unverifiable import
degrade to the metadata-only response instead, so this ADR's publication
decision no longer risks an outage — only the two other unresolved questions
below.

## Decision — how the corpus is published

Publication is a five-object R2 upload with no further code change, done
through the R2 **S3-compatible API** (`x-amz-meta-sha256` maps onto R2
`customMetadata`), because `wrangler` cannot set the required metadata. Full
step-by-step commands live in the "Operator publication runbook" section of
`plans/049-ship-the-legislation-corpus.md`; this ADR records the shape of the
decision, not a duplicate of the commands:

1. Generate upload bytes locally with the two helpers `transform_legislations`
   (`scripts/transform_immi_snapshot.py`) already uses —
   `canonical_json` / `sha256_text` — reproduced standalone because that
   script's `main()` requires a full Postgres-era snapshot directory it no
   longer has.
2. **Prove the metadata mechanism on a staging key first**
   (`staging/legislations/<id>.json`, a key the Worker never reads) before
   touching anything live. Whether the S3 API's `--metadata` flag actually
   survives into R2's `customMetadata` was **unverified at authoring time** —
   no production R2 credentials were available while writing plan 049. The
   staging probe is what answers that question; if it fails, no live key may
   be written (see Rollback and STOP conditions in the plan).
3. Promote laws **one at a time, smallest byte size first**, verifying
   `head-object` metadata after each before starting the next. There is no
   atomic swap in R2 — `put-object` replaces a live key in place — so each law
   is checked individually rather than looped, and a mistake costs one law
   instead of five.
4. The two large laws (`migration-regulations-1994`,
   `migration-act-1958` — 1,334 sections between them) are additionally
   gated on the Performance gate below, not on the same three-small-laws
   timeline.

## Rollback

R2 has **no object versioning** in this bucket, so the only prior-state
record is whatever the operator saves locally before overwriting a key
(runbook step 1a). There are exactly two cases, and which one applies must be
known **before** uploading:

- **No prior object at that key** (the expected case today — production
  currently serves the static catalogue with nothing in R2 under
  `legislations/`): rollback is `aws s3api delete-object`. Deleting restores
  exactly today's behaviour — a 200 with an empty `sections` array from the
  metadata-only fallback this plan's Worker fix now provides.
- **A prior object already exists at that key**: rollback is **not**
  deletion. It is re-uploading the saved prior bytes
  (`/tmp/legis-prior-<id>.json`) with their own **recomputed** sha256
  `customMetadata` — deleting a real prior import would be a silent
  downgrade to the metadata-only page, not a restore of what was actually
  live. The runbook requires the operator to determine which case applies,
  per key, before any upload, and to keep `/tmp/legis-prior-*.json` for at
  least 24 hours after the last promotion, since it is the only copy of that
  version that exists anywhere.

## Provenance and staleness

**Blocking.** This section must be filled in and this ADR's Status checklist
signed off before any law is published — an applicant relying on superseded
immigration law is the highest-harm outcome this feature can produce, worse
than the current empty state.

Measured facts that force the question (re-verified 2026-08-28 against
`immi_case_downloader/data/legislations.json`):

| law id | `last_scraped` | `last_amended` |
|---|---|---|
| `migration-act-1958` | 2026-02-23 | *(empty)* |
| `migration-regulations-1994` | 2026-02-23 | *(empty)* |
| `australian-citizenship-act-2007` | 2026-02-23 | *(empty)* |
| `australian-border-force-act-2015` | 2026-02-23 | *(empty)* |
| `administrative-review-tribunal-act-2024` | 2026-02-23 | *(empty)* |

Every law was scraped on the same day, now roughly six months before this
ADR was written, and **`last_amended` is empty for all five** — the corpus
carries no amendment date whatsoever, for any law, not only the Migration
Act. `LEGISLATIONS_META` (`workers/case-api/static.js`) does not carry a
`last_amended` field either, so there is nothing today's frontend could
surface even if the operator wanted a per-law date.

**Open, operator-owned decisions — none of these are resolved by this ADR:**

- What as-at date is shown to the reader, and where (the detail page header?
  a banner? per-section?) — `last_scraped` is the only true date the corpus
  has; whether that alone is an honest label for six-month-old primary-legal-
  source text is a product and legal-risk call, not an engineering one.
- The source and its licence/attribution terms — AustLII's terms of use
  apply to any reproduced material; whether the current byline (`AustLII`
  link on the detail page) satisfies them has not been reviewed here.
- What the page shows when `last_scraped` is older than some threshold (a
  standing warning banner? refuse to serve stale law past N months? nothing?)
  — no threshold exists in code today.

## Performance gate for the two large laws

`migration-regulations-1994` (394 sections) and `migration-act-1958` (940
sections) are gated on measured render performance, not a judgement call.
`LegislationTextViewer.tsx:909` renders `sections.map(...)` with no
virtualisation — re-confirmed 2026-08-28:
`git grep -n -- "virtual" -- frontend/src/components/legislation/LegislationTextViewer.tsx`
returns no match. Each of 940 section cards runs `stripAustliiHeader` +
`mergeContiguousBodyLines` through `useMemo` per render.

- **Precondition**: `plans/020-fix-render-performance.md` lands
  virtualisation in `LegislationTextViewer`. **Not yet true as of this
  writing** — the grep above is empty, so the big two must not be published
  yet regardless of what follows.
- **Measurement** (not yet performed): Chrome DevTools Performance, mid-tier
  mobile emulation, 4× CPU throttling, "Fast 4G", on the largest
  already-published law (`administrative-review-tribunal-act-2024`, 318
  sections). Record Largest Contentful Paint, Total Blocking Time, and the
  longest single task. Threshold: publish the big two only if **TBT < 600 ms
  and no single task exceeds 200 ms** at 318 sections.
  **This cannot be measured yet either** — ARTA itself is not published in
  production (see Context), so there is no live 318-section page to profile.
  The dependency order is therefore: publish the three small laws first
  (unblocked once the sign-off above is complete) → measure against the
  now-live ARTA page → only then decide on the two large laws.
- Measured numbers (LCP / TBT / longest task, before and after) go here once
  they exist. Until they do, the big two stay unpublished — a subjective
  "seemed fine on my phone" does not satisfy this gate.

## Consequences

**What publishing buys**: the primary non-case content on the site — 1,796
sections of the actual law text — reaches the self-representing applicants
this product is for, instead of a page that structurally promises 940
sections and shows none.

**What it costs**:

- The Migration Act detail response becomes a ~1.6 MB JSON body once
  published, versus today's 454-byte metadata shell.
- `sections_count` in the API response now reports the number of sections
  actually being returned in that response, not the payload's declared
  total (`workers/case-api/cloudflare.js`, `handleLegislationDetail`). This
  is a deliberate contract change from before plan 049: a truncated or
  partial import can no longer report a count it is not delivering. Any
  future consumer of this field must not assume it equals the corpus total.
- Two write-capable R2 credentials (access key ID + secret) must be created,
  used, and then **rotated immediately** after the upload — the runbook
  requires this and it is easy to skip once the upload "worked".
- Ongoing staleness risk: nothing in this plan adds automated re-scraping,
  amendment-date tracking, or a stale-content banner. Once published, the
  corpus is exactly as stale as it is today, indefinitely, until the
  Provenance decision above is acted on with actual product changes (not
  just this ADR's disclosure text).
- **Rejected alternative**: publish all five laws in one pass without the
  smallest-first staged rollout. Rejected because R2 `put-object` has no
  atomic swap and a metadata mistake is only discoverable after the fact —
  staging one law at a time turns a possible five-law incident into a
  one-law incident with a known rollback.
- **Rejected alternative**: treat the corpus as a D1 catalog table instead
  of an immutable R2 artifact. Rejected in the original audit and reaffirmed
  here — `scripts/transform_immi_snapshot.py`'s `transform_legislations`
  deliberately routes legislation to R2, and `LEGISLATIONS_META`'s
  `sections_count` values were checked against the corpus and are correct as
  static metadata; there is nothing to fix in `workers/case-api/static.js`.
