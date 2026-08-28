# ADR 0047: AustLII ingestion architecture

## Status

**Proposed** — 2026-08-27. Binding only once an operator changes this line to
`Accepted` and records their name and the date below.

- [ ] Operator sign-off: _name_, _date_

## Context

1. Two pipelines exist. The native Cloudflare Worker pipeline
   (`workers/austlii-scraper/`, TypeScript across 10 modules, 49 passing tests
   as of 2026-08-28, typechecked in CI) is gated off by two flags that have
   never both been `"true"` (`workers/austlii-scraper/wrangler.toml:111-112`,
   `workers/austlii-scraper/src/index.ts:328-330`). The external VPS Python
   crawler (`crawler.py` + `pipeline.sh` on `/opt/austlii-crawler/`) is the one
   that ingests production data and is in no version control system.
2. The native pipeline's own design doc,
   `.omc/plans/biweekly-cloud-extraction-pipeline.md:9-20`, is already marked
   `SUPERSEDED` and records that its recommended path never shipped, citing
   commits `d0972db`, `abe5b02`, `f91f45f`, `5e1d560` — all four verified
   present in this repository's history.
3. Measured against production on 2026-08-27: `GET /api/v1/stats` reports
   153,198 total cases, 4,381 of them for 2026. Three 100-row samples of
   `GET /api/v1/cases?year=2026` returned `date`/`judges`/`outcome` filled on
   0/0/0, 0/0/0 and 2/2/2 rows; the same probe against `year=2025` returned
   100/99/100 and against `year=2024` returned 100/95/100. The 2026 cohort is
   ingested but unextracted, and therefore absent from Analytics, judge
   profiles and every structured filter. A local operations log
   (`.claude/STATE.md`, section B/D, committed at `9290600`) corroborates this
   independently from an earlier snapshot (2026-08-25): 151,295 total /
   2,478 for 2026, with new-case `date` 95% empty and `judges`/`outcome`/
   `applicant`/`visa_type` empty entirely, noting the hearing/decision date is
   present in the case title and could be filled by regex at ingest time.
4. AustLII challenges or blocks datacentre egress at volume. The VPS routes
   through a WireGuard tunnel to a residential IP for exactly this reason
   (`.claude/STATE.md` section B), and even then needed a 120s challenge-page
   timeout added on 2026-08-24. The native pipeline scrapes from Cloudflare
   egress and has no answer to this.
5. Operator pipeline commands report success that is not real.
   `workers/pipeline/control_handlers.js:96` returns `202 {started: true,
   ok: true, command_id, native: true}` at enqueue time; the consumer at
   `workers/austlii-scraper/src/index.ts:95` throws when the gate is closed
   and `:161` calls `message.retry()`, so with `max_retries = 3` and
   `dead_letter_queue = "immi-pipeline-control-dlq"`
   (`workers/austlii-scraper/wrangler.toml:43-48`) the command lands in a DLQ.
   A status read path exists for exactly one of the four actions —
   `workers/case-api/cloudflare.js:1033` serves
   `GET /api/v1/legislations/update/status` from
   `latestControlCommand("legislation_update")`. For `start`, `stop` and
   `download` there is no read route in `workers/` and no `command_id`
   reference anywhere in `frontend/src/`.

## Decision drivers

- **Proven production throughput.** The VPS crawler is the only path that has
  ever ingested a real case into production.
- **Egress viability against AustLII.** AustLII challenges or blocks
  datacentre IPs; the VPS's residential WireGuard egress is the only answer
  either pipeline has to this today.
- **Structured-field parity.** The Python extractor
  (`extract_structured_fields.py`) already ships 14 fields at documented fill
  rates over 149K historical rows; the native TypeScript extraction path was
  scoped at 8 fields, which the superseded design doc itself calls a feature
  regression.
- **Recoverability.** Unversioned code on one rented box is a single-disk,
  single-operator point of failure.
- **Operator honesty.** The current control loop tells the operator a command
  succeeded before any consumer has looked at it.
- **Cost.** The native pipeline's extraction Container
  (`workers/austlii-scraper/wrangler.toml:98-101`, service
  `immi-extraction-replace`) is still a placeholder; standing it up is new
  spend the VPS path does not require.

## Options considered

- **Option A — native Worker pipeline wins.** Flip both flags, provision the
  extraction Container (`workers/austlii-scraper/wrangler.toml:98-101` still
  names the placeholder service `immi-extraction-replace`), retire the VPS.
  *Against*: has never run in production; no answer to AustLII's datacentre-IP
  blocking; would ship an 8-field extractor where the corpus already has 14;
  requires new paid resources and new cost-cap operations.

- **Option B — VPS crawler wins for discovery and fetch; extraction runs
  alongside it on the same box.** *For*: the only path with proven production
  throughput; the only viable egress; the Python extractor
  (`extract_structured_fields.py`) is already in this repo and already proven
  over 149K rows at documented fill rates; the VPS already has a Python venv.
  *Against*: the crawler is not in version control today; one box, one
  residential line, one operator.

  **This caveat is written verbatim, not softened: "run the existing
  extractor on the VPS" is not something that already works today.** The gap
  is structural, not a matter of copying a file:

  - `extract_structured_fields.py:30-31` hard-codes
    `CASES_DIR = Path("downloaded_cases/case_texts")` and
    `CSV_PATH = Path("downloaded_cases/immigration_cases.csv")`. It reads a
    local directory of per-case text files and rewrites a local CSV in place
    (backup-then-write via `backup_csv()` at lines 1016-1041). Both paths are
    module-level constants with no CLI override — the script's `argparse`
    surface (`extract_structured_fields.py:1136-1141`) exposes `--dry-run`,
    `--sample`, `--court`, `--workers`, nothing that redirects input or
    output location.
  - The production crawler contract is different in both directions: it POSTs
    each case to the Worker's `POST /api/v1/cases` and keeps no CSV, and there
    is **no route anywhere** that accepts extracted-field updates back into D1
    other than the same flag-gated mutation path.

  So Option B, as written, requires three interfaces that do not exist yet.
  They are **preconditions of this decision**, not consequences to discover
  later — see "Consequences" below, where they are listed first for that
  reason:

  1. **Crawler output contract** — what the crawler writes to local disk (a
     `case_texts/` corpus, or nothing at all) and where the extractor reads it
     from. Today the crawler POSTs and discards.
  2. **Incremental extraction input** — which cases a run should process. The
     script's unit of work is "every file in a directory, dedup against a
     CSV"; an incremental daily/weekly run needs "the cases ingested since
     timestamp T", which means either a local state file or a read endpoint.
  3. **Write-back path** — how extracted fields reach D1. Either the mutation
     route with `CRAWLER_WRITE_TOKEN` accepts a fields-only update (and how
     `IMMI_CASE_MUTATIONS_ENABLED` interacts with that), or a new
     authenticated bulk-update route exists. Neither is designed today.

  Until those three are specified, "the VPS is the extraction system of
  record" is an *intent*, not a description. `extract_structured_fields.py`
  is owned by `plans/032-consolidate-the-extraction-scripts.md` and
  `plans/041-cover-the-extraction-scripts.md`; this ADR does not design or
  implement any of the three interfaces above, and this plan does not touch
  that file.

- **Option C — keep both with clear roles.** *Against*: this is the status quo
  and it is what produced a whole unextracted year plus an operator UI that
  lies. Rejected because "both" without an owner means neither is maintained.

## Decision

> **The VPS crawler is the system of record for AustLII discovery, fetch and
> structured-field extraction.** The native Cloudflare Worker pipeline in
> `workers/austlii-scraper/` is **quarantined, not deleted**: it stays in the
> tree, stays typechecked and tested in CI, and stays fail-closed behind
> `PIPELINE_ENABLED` / `NATIVE_PIPELINE_ENABLED`. It is break-glass, not a
> second production path. Its operator-facing controls must state plainly that
> they are inert until this ADR is superseded.

## Consequences

**Preconditions of Option B that do not exist yet** (see "Options considered"
for the evidence — listed first because the decision is not actionable until
these are specified):

- A crawler output contract: what the crawler leaves on local disk for an
  extractor to read. `extract_structured_fields.py:30` reads
  `downloaded_cases/case_texts`; the crawler writes nothing there today.
- An incremental extraction input: "cases ingested since T", versus the
  script's current "every file in a directory, deduped against a CSV"
  (`extract_structured_fields.py:31`, `:1016-1041`).
- A write-back path for extracted fields into D1. Owner: whoever owns
  `workers/case-api/cloudflare_mutations.js` — not this plan.

**Immediate, and delivered by the plan that produced this ADR:**

- The VPS crawler gets an import path into version control
  (`scripts/crawler/`) plus a written operational contract, so the code stops
  being recoverable only from one disk.
- The control-queue consumer stops treating a closed feature gate as a
  transient fault: it records a terminal failure in Ops D1 and acks, instead
  of burning three retries into a DLQ nothing reads.
- The inert crons are documented as inert in
  `workers/austlii-scraper/wrangler.toml`.

**Required follow-ups, deliberately NOT done here** (owning file named for
each):

- `workers/pipeline/control_handlers.js:96` must return a typed `503` rather
  than `202 {started: true}` when the consumer's gate is closed. **This is
  the producer half of the change this plan makes on the consumer side, and
  until it lands the loop is only half-closed**: the consumer now records a
  terminal `failed` and acks instead of dead-lettering, but the operator
  still sees `202 {started: true, ok: true}` and — for `start`, `stop` and
  `download` — still has no route on which to read the failure back. This
  plan improves the *record* without improving the *operator's view*; the
  "operator UI lies" problem is not fixed by it.
- Surface DLQ depth and per-command status on
  `GET /api/v1/admin/pipeline-runs` (`workers/admin/cloudflare_handlers.js`)
  and in the SPA, or remove the pipeline controls from the UI entirely.
- Add status read routes for the `start`, `stop` and `download` actions, or
  document that those controls are unavailable.
- Backfill the 2026 cohort's structured fields. Implementation belongs to the
  plan that owns the extraction scripts, not to this ADR.
- Land `crawler.py` and `pipeline.sh` themselves (operator action — see
  `scripts/crawler/README.md`).

**Re-decision checkpoint:**

Revisit this ADR if any of these become true: the residential egress path
stops working; the VPS is lost or its operator becomes unavailable; the
weekly crawl exceeds a maintenance budget the operator is willing to pay; or
a Cloudflare-side answer to AustLII's datacentre-IP blocking appears. Until
one of those happens, do not re-litigate.

## Notes

- `CRAWLER_WRITE_TOKEN` is a shared secret. It is referenced by name only; its
  value must never appear in this repository, in logs, or in an ADR. If it is
  ever exposed, rotate it before doing anything else.
- The operational description of the VPS lives in `.claude/STATE.md`, a
  running handoff/operations log rather than a durable architecture
  reference. `scripts/crawler/README.md` is now the durable copy.
