# Plan 047: Spike — pick one of the two AustLII ingestion pipelines and retire the other

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 42826a3..HEAD -- docs/adr scripts/crawler workers/austlii-scraper`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **This is a decision/spike plan.** Most of the output is a written decision
> record. There is exactly one behaviour change (Step 5) and it is small. Do
> not expand the code changes beyond what Steps 5–7 describe.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

This repository pays for two AustLII ingestion pipelines and gets the benefit
of neither in full. A 2,481-line Cloudflare Worker pipeline
(`workers/austlii-scraper/`) is fully built, typechecked and covered by 28
passing tests — and is switched off by two fail-closed flags that have never
been flipped in production. Meanwhile the code that actually ingests
production data is a Python crawler that exists only on one rented VPS and in
a `.bak` file next to it; it is in no git repository anywhere.

The visible cost is a whole year of the corpus. Measured live against
`https://immi.trackit.today` on 2026-08-27: the corpus holds 153,198 cases, of
which 4,381 are from 2026 — and in three separate 100-row samples of the 2026
cohort the `date`, `judges` and `outcome` fields were filled on 0, 0 and 2 rows
respectively, against 100/99/100 for a 2025 sample and 100/95/100 for a 2024
sample. Those ~4,381 cases are therefore invisible to Analytics, judge
profiles, and every structured filter in the SPA. The invisible cost is worse:
the operator UI reports `202 {started: true, ok: true}` for pipeline commands
that provably fail, and for three of the four command actions there is no
endpoint anywhere that can ever tell the operator they failed.

After this plan lands there is a written, evidence-backed decision about which
pipeline owns ingestion, a one-command path to put the VPS crawler under
version control, and the control queue stops silently burying failed operator
commands in a dead-letter queue that nothing reads.

## Current state

### The files that matter

- `workers/austlii-scraper/src/index.ts` — the native pipeline Worker entry
  point: `fetch` (404 only), `queue` (scrape / extract / control / DLQ
  consumers) and `scheduled` (cron discovery). 504 lines.
- `workers/austlii-scraper/wrangler.toml` — its deploy config: four Monday
  crons plus the two fail-closed flags. 117 lines.
- `workers/austlii-scraper/src/__tests__/pipeline-control.test.ts` — the
  existing control-queue test file, 118 lines, 5 tests. This is the structural
  pattern to copy for the new tests.
- `workers/pipeline/control_handlers.js` — the **producer** side that returns
  `202` to the operator. **Out of scope** (see Scope), quoted here only so you
  understand the loop.
- `.omc/plans/biweekly-cloud-extraction-pipeline.md` — the 1,066-line design
  doc for the native pipeline. It is tracked in git and already carries a
  `SUPERSEDED` banner. Read lines 1–21 before writing the ADR.
- `.claude/STATE.md` — operational handoff notes. **Read-only for this plan.**

### The two flags that keep the native pipeline off

`workers/austlii-scraper/wrangler.toml:103-108` (verbatim):

```toml
[triggers]
crons = ["0 2 * * 1", "0 3 * * 1", "0 4 * * 1", "0 5 * * 1"]

[vars]
PIPELINE_ENABLED = "false"
NATIVE_PIPELINE_ENABLED = "false"
```

`workers/austlii-scraper/src/index.ts:312-314` (verbatim):

```ts
function nativePipelineReady(env: Env): boolean {
  return env.PIPELINE_ENABLED === "true" && env.NATIVE_PIPELINE_ENABLED === "true";
}
```

Both flags must be the string `"true"`. Neither is. Every entry point checks
this gate: `index.ts:97` (control queue), `index.ts:196` (scrape queue),
`index.ts:249` (cron). The four Monday crons above therefore fire weekly into
a `scheduled()` handler that logs `cron.skipped.disabled` and returns.

> These fail-closed defaults are **by design** and are NOT a defect. Do not
> change them. The defect is that nothing tells the operator the pipeline is
> off.

### The silent dead-letter loop (this is what Step 5 fixes)

`workers/austlii-scraper/src/index.ts:90-98` (verbatim):

```ts
async function handlePipelineControlBatch(
  batch: MessageBatch<PipelineControlMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const control = message.body;
    try {
      if (!nativePipelineReady(env)) throw new Error("native pipeline is disabled");
      await updateControlCommand(env, control.command_id, { status: "running" });
```

`workers/austlii-scraper/src/index.ts:141-149` (verbatim):

```ts
      message.ack();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await updateControlCommand(env, control.command_id, { status: "failed", error: reason }).catch(() => undefined);
      console.error(JSON.stringify({ event: "pipeline.control.failed", command_id: control.command_id, error: reason }));
      message.retry();
    }
  }
}
```

A closed feature gate is not a transient fault, but it is treated as one. The
queue config guarantees where that ends —
`workers/austlii-scraper/wrangler.toml:43-48` (verbatim):

```toml
[[queues.consumers]]
queue = "immi-pipeline-control-queue"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "immi-pipeline-control-dlq"
```

Three futile retries, then the dead-letter queue.

### The honesty gap on the producer side (context only — do NOT edit)

`workers/pipeline/control_handlers.js:93-96` (verbatim):

```js
  if (action === "legislation_update") {
    return json({ success: true, message: "Scrape job started", laws: payload.law_ids, command_id: commandId, native: true }, 202);
  }
  return json({ started: action === "download" || action === "start", ok: true, command_id: commandId, native: true }, 202);
```

The response is `202` and `started: true` the moment the message is enqueued,
before any consumer has seen it.

There **is** one read path back into the `pipeline_control_commands` table —
`workers/case-api/cloudflare.js:1031-1033` (verbatim):

```js
  if (path === "/api/v1/legislations/update/status") {
    try {
      const command = await createCloudflareStores(env).pipelineStore.latestControlCommand("legislation_update");
```

It only serves the `legislation_update` action. For `start`, `stop` and
`download` there is no read route in `workers/` and no reference to
`command_id` anywhere in `frontend/src/`, so the operator has no surface at all
on which to learn that a command failed.

### The pipeline that actually ingests production data

It is not in this repository. `git ls-files` returns nothing for `crawler.py`
or `pipeline.sh`. The only description of it in the tree is in
`.claude/STATE.md`, and even that is currently **uncommitted working-tree
content** — `git show 42826a3:.claude/STATE.md | grep -c "austlii-crawler"`
returns `0`. The facts recorded there (working tree, section
`## 2026-08-25 Repo Completion Pass + VPS Crawler 修復與首輪 2026 回填 — HANDOFF`,
lines 55–64 and 78–84):

- Host: a Hostinger VPS reachable through the SSH alias `hstgr`.
- Path `/opt/austlii-crawler/` — holds `crawler.py`, `pipeline.sh` and a venv.
- Runs as the unprivileged user `austlii-crawler` (UID 995).
- Egress goes through a WireGuard tunnel (`wg1-home`) to the operator's
  residential IP, because AustLII challenges/blocks datacentre egress.
- Cron `0 14 * * 1` UTC (Tuesday 00:00 AEST); crawls the current year only,
  four courts: ARTA / FCA / FedCFamC2G / HCA.
- Posts to `/api/v1/cases` bearing the `CRAWLER_WRITE_TOKEN` shared secret;
  the Worker upserts idempotently by `case_id`.
- Log: `/var/log/austlii-crawl.log`, unbuffered, heartbeat every 25 records.
- Four patches applied 2026-08-24 (backups `*.bak-20260824` in the same
  directory): 120s cap on the challenge-page wait (an unbounded `while` loop
  once hung ~3h silently); `python -u` in `pipeline.sh` (stdout was fully
  buffered, so the log looked dead); POST timeout 30s → 90s (large-payload
  failure rate 24% → ~2%); `flock` in `pipeline.sh` against re-entry.
- Known gotcha: `pgrep -f` / `pkill -f` match the diagnosing SSH command line
  itself — diagnose with `ps -u austlii-crawler`, kill by exact PID.

### The Worker-side door the VPS crawler comes through

`workers/case-api/cloudflare_mutations.js:53-63` (verbatim):

```js
async function requireWriter(request, env, stores) {
  // Service-to-service: the VPS AustLII crawler is a cron job with no login.
  // It presents a shared secret (CRAWLER_WRITE_TOKEN) in the Authorization
  // header. Compared in constant time; only honored when the secret is set.
  if (env.CRAWLER_WRITE_TOKEN) {
    const header = request.headers.get("Authorization") || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer && timingSafeEqualString(bearer, env.CRAWLER_WRITE_TOKEN)) {
      return { auth: { service: "crawler", subject: "austlii-crawler" } };
    }
  }
```

`CRAWLER_WRITE_TOKEN` is a shared-secret credential. **Never write its value
into any file, log, commit message or the ADR.** Refer to it by name only.

### The prior design doc already admits the native path did not ship

`.omc/plans/biweekly-cloud-extraction-pipeline.md:9-20` (verbatim, abridged to
the first and last sentences of the block — read the whole block yourself):

```
> **SUPERSEDED**: The recommended path, Opt-D (cron discovery → `flask-v22`
> DO container runs `extract_structured_fields_llm.py` → Worker upserts via
> Hyperdrive), did not ship. Production instead: (1) made `workers/austlii-scraper`
> cron-triggered only with its HTTP endpoints removed (commit `d0972db`); (2) case
> ingestion into production now comes from an **external VPS crawler** POSTing
> directly to the main Worker's `/api/v1/cases`, authenticated with a
> `CRAWLER_WRITE_TOKEN` shared secret instead of any Flask/Hyperdrive path (commit
> `abe5b02`), with the mutation body ceiling raised to 1 MiB for large judgements
> (commit `5e1d560`). There is no Flask container in production at all to host the
> Opt-D extraction step (deleted in `f91f45f`). Whether the VPS crawler reproduces
> this plan's 14-field extraction parity, cost caps, and audit-log/rollback
> guarantees has not been verified against this document.
```

All four commits exist and are verified:

| Commit | Date | Subject |
|---|---|---|
| `f91f45f` | 2026-08-21 | `refactor(cloudflare): remove legacy Supabase/Hyperdrive worker code` |
| `d0972db` | 2026-08-22 | `refactor(pipeline): make austlii-scraper cron-triggered only` |
| `abe5b02` | 2026-08-23 | `feat(worker): add CRAWLER_WRITE_TOKEN service-to-service auth for VPS crawler` |
| `5e1d560` | 2026-08-23 | `fix(worker): raise case mutation JSON ceiling 128 KiB -> 1 MiB` |

### Repo conventions you must match

- **Commit messages**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`. **No AI attribution lines.**
- **Shell scripts** live in `scripts/` and open with `#!/usr/bin/env bash`,
  a comment block explaining the safety posture, then `set -euo pipefail`. See
  `scripts/export_immi_source_snapshot.sh:1-30` for the exemplar — note how it
  refuses to run rather than guessing, and takes secrets only from the caller's
  environment.
- **Worker code style**: structured logging is
  `console.log(JSON.stringify({ event: "...", ... }))` — see
  `workers/austlii-scraper/src/index.ts:145` and `:197-201`. Match it.
- **Never re-introduce Postgres/Hyperdrive/Supabase** into the native path.
  `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings.
  Tenant isolation is app-layer via `CloudflareIdentityStore.assertMembership()`
  in `workers/storage/cloudflare.js`; there is no Postgres and no RLS.
- **By design, do not "fix"**: the placeholder resource IDs in any checked-in
  `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` / `PIPELINE_ENABLED` /
  `NATIVE_PIPELINE_ENABLED` defaulting to `"false"`;
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase.

### Where new documents go

There is no `docs/adr/` directory yet — `ls docs/` returns
`ARCHITECTURE.md  HYPERDRIVE_CACHE_RFC.md  JUDGE_DATA_QUALITY.md  ops  plans
screenshots  UPLOAD_JUDGE_PHOTOS.md`. There is no `scripts/crawler/` either.
Neither path is gitignored (`git check-ignore -v docs/adr/0001-x.md
scripts/crawler/README.md` returns nothing). You are creating both.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 42826a3..HEAD -- docs/adr scripts/crawler workers/austlii-scraper` | no output |
| Scraper typecheck | `cd workers/austlii-scraper && npm run typecheck` | exit 0, no output |
| Scraper tests (baseline) | `cd workers/austlii-scraper && npm test` | `Test Files  7 passed (7)` / `Tests  28 passed (28)` |
| Scraper tests (after Step 6) | `cd workers/austlii-scraper && npm test` | `Test Files  7 passed (7)` / `Tests  30 passed (30)` |
| Main Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files |
| Shell syntax check | `bash -n scripts/crawler/import_from_vps.sh` | exit 0, no output |
| Changed-file audit | `git status --short` | only in-scope paths listed |
| Whitespace check | `git diff --check` | no output |

Notes:
- `cd workers && npx vitest run` uses `workers/vitest.config.js`, whose
  `include` is `["__tests__/**/*.test.js"]`. It does **not** run the
  austlii-scraper TypeScript suite. You must run both.
- `make test` is `test-py test-fe test-workers` and likewise does **not**
  include the austlii-scraper suite. CI does run it —
  `.github/workflows/ci.yml:96-106` runs `npm ci --ignore-scripts`,
  `npm run typecheck`, then `npm test` with
  `working-directory: workers/austlii-scraper`.
- `workers/austlii-scraper/node_modules` is already installed. If `npx vitest`
  fails to resolve, run `npm ci --ignore-scripts` in that directory first.

## Scope

**In scope** (the only files you may create or modify):

- `docs/adr/README.md` (create)
- `docs/adr/0001-austlii-ingestion-architecture.md` (create)
- `scripts/crawler/README.md` (create)
- `scripts/crawler/import_from_vps.sh` (create)
- `workers/austlii-scraper/src/index.ts` (modify — Step 5 only)
- `workers/austlii-scraper/src/__tests__/pipeline-control.test.ts` (modify —
  Step 6 only)
- `workers/austlii-scraper/wrangler.toml` (modify — Step 7, comments only)

**Out of scope** (do NOT touch, even though they look related):

- `workers/pipeline/control_handlers.js` — the `202`-instead-of-`503` producer
  bug lives here. Another plan owns this file; changing it here would collide.
  Record it as a follow-up in the ADR instead.
- `workers/admin/cloudflare_handlers.js` and any `frontend/src/**` — surfacing
  DLQ depth and command status in the operator UI is a separate change owned
  elsewhere. Record it as a follow-up in the ADR.
- `workers/case-api/cloudflare_mutations.js` — `requireWriter()` and the
  `CRAWLER_WRITE_TOKEN` path are owned by the auth-hardening plan.
- `.claude/STATE.md` — read it, quote it, do not edit it. It currently has
  uncommitted changes that are not yours.
- `.omc/plans/biweekly-cloud-extraction-pipeline.md` — read-only historical
  record. Do not re-status it.
- `workers/austlii-scraper/wrangler.toml` **values** — you may only add
  comments. Do not change `crons`, do not flip `PIPELINE_ENABLED` or
  `NATIVE_PIPELINE_ENABLED`, do not touch the placeholder resource IDs.
- Deleting any part of `workers/austlii-scraper/`. The ADR's decision is
  *quarantine*, not deletion. Deletion is a one-way door and is explicitly
  deferred.
- Anything on the VPS. You have no access to it and must not attempt to
  connect. Step 4 builds the import mechanism; the operator runs it.

## Git workflow

- Branch: `advisor/047-decide-the-ingestion-architecture`
- Commit per logical unit. Suggested three commits:
  1. `docs: record the AustLII ingestion architecture decision` (Steps 2–3)
  2. `chore: add the VPS crawler import harness` (Step 4)
  3. `fix(pipeline): stop dead-lettering control commands when the pipeline is gated` (Steps 5–7)
- Message format is `<type>: <description>`. No AI attribution lines, no
  `Co-Authored-By` trailers.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Confirm the baseline

Run the drift check and capture the current test baseline before changing
anything.

```bash
git diff --stat 42826a3..HEAD -- docs/adr scripts/crawler workers/austlii-scraper
cd workers/austlii-scraper && npm run typecheck && npm test
```

**Verify**: the drift check prints nothing; typecheck exits 0 with no output;
the test run ends with `Test Files  7 passed (7)` and `Tests  28 passed (28)`.
If the drift check prints any file, stop (see STOP conditions).

### Step 2: Create the ADR index

Create `docs/adr/README.md` with exactly this content:

```markdown
# Architecture Decision Records

One file per decision, named `NNNN-kebab-slug.md`, numbered in the order the
decision was taken. An ADR is append-only history: to change a decision, add a
new ADR that supersedes the old one and edit only the old one's `Status` line
to say so. Never rewrite the body of a landed ADR.

## Status values

| Status | Meaning |
|---|---|
| `Proposed` | Written and argued, awaiting operator sign-off. Not yet binding. |
| `Accepted` | Signed off. Binding on all subsequent work. |
| `Superseded by NNNN` | Replaced. Kept for the historical record. |
| `Rejected` | Considered and declined; kept so it is not re-litigated. |

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-austlii-ingestion-architecture.md) | AustLII ingestion architecture | Proposed |
```

**Verify**: `test -f docs/adr/README.md && grep -c "0001-austlii-ingestion-architecture.md" docs/adr/README.md`
→ prints `1`.

### Step 3: Write the decision record

Create `docs/adr/0001-austlii-ingestion-architecture.md`. Write it yourself
from the material in this plan's "Current state" section — every fact you need
is there. It must contain these sections, in this order, with this substance:

**`# ADR 0001: AustLII ingestion architecture`**

**`## Status`** — exactly:

```
**Proposed** — 2026-08-27. Binding only once an operator changes this line to
`Accepted` and records their name and the date below.

- [ ] Operator sign-off: _name_, _date_
```

**`## Context`** — state, with the `file:line` citations from this plan:

1. Two pipelines exist. The native Cloudflare Worker pipeline
   (`workers/austlii-scraper/`, 2,481 lines of TypeScript across 10 modules,
   28 passing tests, typechecked in CI) is gated off by two flags that have
   never both been `"true"` (`wrangler.toml:107-108`, `src/index.ts:312-314`).
   The external VPS Python crawler (`crawler.py` + `pipeline.sh` on
   `/opt/austlii-crawler/`) is the one that ingests production data and is in
   no version control system.
2. The native pipeline's own design doc,
   `.omc/plans/biweekly-cloud-extraction-pipeline.md:9-20`, is already marked
   `SUPERSEDED` and records that its recommended path never shipped, citing
   commits `d0972db`, `abe5b02`, `f91f45f`, `5e1d560`.
3. Measured against production on 2026-08-27: `GET /api/v1/stats` reports
   153,198 total cases, 4,381 of them for 2026. Three 100-row samples of
   `GET /api/v1/cases?year=2026` returned `date`/`judges`/`outcome` filled on
   0/0/0, 0/0/0 and 2/2/2 rows; the same probe against `year=2025` returned
   100/99/100 and against `year=2024` returned 100/95/100. The 2026 cohort is
   ingested but unextracted, and therefore absent from Analytics, judge
   profiles and every structured filter.
4. AustLII challenges or blocks datacentre egress at volume. The VPS routes
   through a WireGuard tunnel to a residential IP for exactly this reason, and
   even then needed a 120s challenge-page timeout added on 2026-08-24. The
   native pipeline scrapes from Cloudflare egress and has no answer to this.
5. Operator pipeline commands report success that is not real.
   `workers/pipeline/control_handlers.js:96` returns `202 {started: true,
   ok: true}` at enqueue time; the consumer at
   `workers/austlii-scraper/src/index.ts:97` throws when the gate is closed and
   `:146` calls `message.retry()`, so with `max_retries = 3` and
   `dead_letter_queue = "immi-pipeline-control-dlq"`
   (`wrangler.toml:43-48`) the command lands in a DLQ. A status read path
   exists for exactly one of the four actions —
   `workers/case-api/cloudflare.js:1033` serves
   `GET /api/v1/legislations/update/status` from
   `latestControlCommand("legislation_update")`. For `start`, `stop` and
   `download` there is no read route in `workers/` and no `command_id`
   reference anywhere in `frontend/src/`.

**`## Decision drivers`** — list at least: proven production throughput;
egress viability against AustLII; structured-field parity (the Python
extractor already ships 14 fields at documented fill rates; the native
TypeScript extractor was scoped at 8, which the design doc itself calls a
feature regression); recoverability (unversioned code on one box is a
single-disk single point of failure); operator honesty; cost.

**`## Options considered`** — three, each with an honest pro/con list:

- **Option A — native Worker pipeline wins.** Flip both flags, provision the
  extraction Container (`workers/austlii-scraper/wrangler.toml:94-97` still
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
- **Option C — keep both with clear roles.** *Against*: this is the status quo
  and it is what produced a whole unextracted year plus an operator UI that
  lies. Rejected because "both" without an owner means neither is maintained.

**`## Decision`** — Option B, worded as:

> **The VPS crawler is the system of record for AustLII discovery, fetch and
> structured-field extraction.** The native Cloudflare Worker pipeline in
> `workers/austlii-scraper/` is **quarantined, not deleted**: it stays in the
> tree, stays typechecked and tested in CI, and stays fail-closed behind
> `PIPELINE_ENABLED` / `NATIVE_PIPELINE_ENABLED`. It is break-glass, not a
> second production path. Its operator-facing controls must state plainly that
> they are inert until this ADR is superseded.

**`## Consequences`** — split into three lists:

*Immediate, and delivered by the plan that produced this ADR:*
- The VPS crawler gets an import path into version control
  (`scripts/crawler/`) plus a written operational contract, so the code stops
  being recoverable only from one disk.
- The control-queue consumer stops treating a closed feature gate as a
  transient fault: it records a terminal failure in Ops D1 and acks, instead
  of burning three retries into a DLQ nothing reads.
- The inert crons are documented as inert in `wrangler.toml`.

*Required follow-ups, deliberately NOT done here (name the owning file):*
- `workers/pipeline/control_handlers.js:96` must return a typed `503` rather
  than `202 {started: true}` when the consumer's gate is closed.
- Surface DLQ depth and per-command status on
  `GET /api/v1/admin/pipeline-runs` (`workers/admin/cloudflare_handlers.js`)
  and in the SPA, or remove the pipeline controls from the UI entirely.
- Add status read routes for the `start`, `stop` and `download` actions, or
  document that those controls are unavailable.
- Backfill the 2026 cohort's structured fields. Implementation belongs to the
  plan that owns the extraction scripts, not to this ADR.
- Land `crawler.py` and `pipeline.sh` themselves (operator action — see
  `scripts/crawler/README.md`).

*Re-decision checkpoint:*
- Revisit this ADR if any of these become true: the residential egress path
  stops working; the VPS is lost or its operator becomes unavailable; the
  weekly crawl exceeds a maintenance budget the operator is willing to pay; or
  a Cloudflare-side answer to AustLII's datacentre-IP blocking appears. Until
  one of those happens, do not re-litigate.

**`## Notes`** — two lines:
- `CRAWLER_WRITE_TOKEN` is a shared secret. It is referenced by name only; its
  value must never appear in this repository, in logs, or in an ADR. If it is
  ever exposed, rotate it before doing anything else.
- The operational description of the VPS currently lives only in
  `.claude/STATE.md`, which is not a durable home for it. `scripts/crawler/README.md`
  is now the durable copy.

**Verify**:

```bash
test -f docs/adr/0001-austlii-ingestion-architecture.md \
  && grep -c "^## " docs/adr/0001-austlii-ingestion-architecture.md \
  && grep -c "Operator sign-off" docs/adr/0001-austlii-ingestion-architecture.md \
  && grep -c "workers/pipeline/control_handlers.js" docs/adr/0001-austlii-ingestion-architecture.md \
  && ! grep -rniE "cfut_|Bearer [A-Za-z0-9_-]{16,}|[0-9]{1,3}(\.[0-9]{1,3}){3}" docs/adr/ \
  && echo "NO-SECRETS-OK"
```

→ the `grep -c "^## "` count is at least `6`, the sign-off count is `1`, the
follow-up citation count is at least `1`, and the last line prints
`NO-SECRETS-OK`.

The last grep is a deliberate belt-and-braces check. The ADR must contain **no
credential values** and **no IP address** — the operator's residential egress
IP is recorded in `.claude/STATE.md`; describe the tunnel and why it exists,
never the address. If that grep matches, remove the offending text before
continuing.

### Step 4: Create the VPS crawler import harness

This is outcome-independent — it is required under every option in the ADR.
You cannot reach the VPS, so you are building the mechanism and writing the
contract; the operator runs it.

**4a.** Create `scripts/crawler/README.md`. It must contain:

- A one-paragraph statement that this directory is the version-controlled home
  of the AustLII crawler that ingests production cases, and that as of
  2026-08-27 the source files still live only on the VPS.
- An **Operational contract** section reproducing the facts from this plan's
  "The pipeline that actually ingests production data" subsection: host alias,
  path, service user, WireGuard egress and *why* (AustLII blocks datacentre
  IPs), cron schedule in UTC and AEST, the four courts, the target endpoint
  `POST /api/v1/cases`, the auth mechanism named as `CRAWLER_WRITE_TOKEN`
  (never a value), the log path, and idempotent upsert by `case_id`.
- A **Patches applied 2026-08-24** section listing all four patches and the
  symptom each one fixed.
- A **Diagnostics** section carrying the `pgrep -f` / `pkill -f` gotcha:
  those match the diagnosing SSH command line itself, so use
  `ps -u austlii-crawler` to diagnose and kill by exact PID.
- An **Importing the source** section: run
  `scripts/crawler/import_from_vps.sh`, review the diff, confirm no secrets
  are embedded in the fetched files, then commit with
  `chore: import the AustLII VPS crawler into version control`.
- A **Security** section: `crawler.py` / `pipeline.sh` must read
  `CRAWLER_WRITE_TOKEN` from the environment or a `0600` file outside this
  repository — never from a literal in the source. If the imported files
  contain a hard-coded token, do **not** commit them: rotate the token first,
  change the file to read it from the environment, and only then commit.
- **No IP addresses and no credential values anywhere in this README.**
  Describe the WireGuard tunnel and why it exists; never write the operator's
  residential address down (it is recorded in `.claude/STATE.md`, which is not
  where it should be either). `grep -rnE "[0-9]{1,3}(\.[0-9]{1,3}){3}" scripts/crawler/`
  must return nothing.

**4b.** Create `scripts/crawler/import_from_vps.sh`, executable, modelled on
`scripts/export_immi_source_snapshot.sh:1-30`. Required behaviour:

- `#!/usr/bin/env bash`, a comment block stating it is a read-only fetch that
  copies two files and transfers no credentials, then `set -euo pipefail`.
- `CRAWLER_HOST="${IMMI_CRAWLER_HOST:-hstgr}"` and
  `CRAWLER_PATH="${IMMI_CRAWLER_PATH:-/opt/austlii-crawler}"`.
- Resolve its own directory so it works from any cwd:
  `DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`.
- Refuse to overwrite: if `$DEST/crawler.py` or `$DEST/pipeline.sh` already
  exists, print a message telling the caller to remove it first and
  `exit 2`.
- `scp` exactly `"$CRAWLER_HOST:$CRAWLER_PATH/crawler.py"` and
  `"$CRAWLER_HOST:$CRAWLER_PATH/pipeline.sh"` into `$DEST`. Nothing else — no
  `.bak` files, no venv, no logs.
- After the copy, scan the two fetched files for anything that looks like an
  embedded credential and refuse loudly if found, e.g.:
  `if grep -nEi '(token|secret|password|api[_-]?key)[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']{8,}' "$DEST/crawler.py" "$DEST/pipeline.sh"; then` → print
  `"Refusing to finish: a literal credential appears above. Rotate CRAWLER_WRITE_TOKEN, move the value to an environment variable, then re-run."` and `exit 3`.
- On success print the two destination paths and the next step (review, then
  commit).
- No `ssh` command execution on the remote beyond `scp`. No `rsync --delete`.
  No writes to the VPS.

**4c.** `chmod +x scripts/crawler/import_from_vps.sh`.

**Verify**:

```bash
bash -n scripts/crawler/import_from_vps.sh \
  && test -x scripts/crawler/import_from_vps.sh \
  && grep -q "set -euo pipefail" scripts/crawler/import_from_vps.sh \
  && grep -q "IMMI_CRAWLER_HOST" scripts/crawler/import_from_vps.sh \
  && test -f scripts/crawler/README.md \
  && grep -q "CRAWLER_WRITE_TOKEN" scripts/crawler/README.md \
  && grep -q "ps -u austlii-crawler" scripts/crawler/README.md \
  && ! grep -rnE "cfut_|Bearer [A-Za-z0-9_-]{16,}|[0-9]{1,3}(\.[0-9]{1,3}){3}" scripts/crawler/ \
  && echo IMPORT-HARNESS-OK
```

→ prints `IMPORT-HARNESS-OK`.

Then confirm the guard actually fires, using a throwaway fixture **outside the
repo**:

```bash
mkdir -p /tmp/crawlerguard && printf 'TOKEN = "abcdefghijklmnop"\n' > /tmp/crawlerguard/crawler.py
grep -nEi '(token|secret|password|api[_-]?key)[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']{8,}' /tmp/crawlerguard/crawler.py
```

→ prints the matching line (exit 0), proving the pattern matches a hard-coded
credential. Delete `/tmp/crawlerguard` afterwards.

### Step 5: Stop dead-lettering control commands when the pipeline is gated

Edit `workers/austlii-scraper/src/index.ts` only.

**5a.** Above `handlePipelineControlBatch` (i.e. after the `controlCourts`
function that currently ends at line 88), add the reason constant:

```ts
// A closed feature gate is not a transient fault. Retrying it only buries the
// command in immi-pipeline-control-dlq, which no route reads back.
const PIPELINE_DISABLED_REASON =
  'native pipeline is disabled (PIPELINE_ENABLED and NATIVE_PIPELINE_ENABLED must both be "true")';
```

**5b.** Replace the gate check inside the loop. Delete line 97 exactly as it
stands:

```ts
      if (!nativePipelineReady(env)) throw new Error("native pipeline is disabled");
```

and insert this block immediately after `const control = message.body;` and
**before** the `try {`:

```ts
    if (!nativePipelineReady(env)) {
      try {
        await updateControlCommand(env, control.command_id, {
          status: "failed",
          error: PIPELINE_DISABLED_REASON,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "pipeline.control.disabled_record_failed",
          command_id: control.command_id,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry();
        continue;
      }
      console.log(JSON.stringify({
        event: "pipeline.control.rejected_disabled",
        command_id: control.command_id,
        action: control.action,
      }));
      message.ack();
      continue;
    }
```

Ordering matters: the gate check must run **before**
`await updateControlCommand(env, control.command_id, { status: "running" });`,
so a gated command is never briefly marked `running`.

Retrying when the Ops D1 write itself fails is deliberate: a lost message is
worse than a duplicated one, and `updateControlCommand` is an idempotent
`UPDATE ... WHERE command_id = ?`.

Change nothing else in the function. The `catch` block at lines 142–147 keeps
`message.retry()` — genuine runtime failures are still retryable.

**Verify**:

```bash
cd workers/austlii-scraper && npm run typecheck
```

→ exit 0, no output. Then confirm the old `throw` is gone and the new constant
is in place:

```bash
grep -c 'throw new Error("native pipeline is disabled")' workers/austlii-scraper/src/index.ts
grep -c 'PIPELINE_DISABLED_REASON' workers/austlii-scraper/src/index.ts
grep -c 'message.retry();' workers/austlii-scraper/src/index.ts
```

→ prints `0`, then `2` (the declaration plus its one use), then `4` (the
pre-existing three at the DLQ handler, the control `catch`, and the scrape
loop, plus the one you added in the new gate block). Baseline before your edit
is `1`, `0`, `3`.

### Step 6: Test the new behaviour

Edit `workers/austlii-scraper/src/__tests__/pipeline-control.test.ts` only.
Model both tests on the existing ones in that file — same `vi.hoisted` mocks,
same `worker.queue({ queue: "immi-pipeline-control-queue", messages: [...] } as never, env)`
shape, same `ack` / `retry` spies.

Add a helper next to the existing `env()` factory (which returns both flags as
`"true"`):

```ts
function gatedEnv(): Env {
  return { ...env(), NATIVE_PIPELINE_ENABLED: "false" } as Env;
}
```

**Test 1 — `"records a terminal failure and acks when the native pipeline is gated"`**

- Arrange: `const ack = vi.fn(); const retry = vi.fn();`
- Act: dispatch one message
  `{ kind: "pipeline.control", command_id: "cmd-gated", action: "start", courts: ["FCA"] }`
  through `worker.queue(..., gatedEnv())`.
- Assert:
  - `mocks.updateControlCommand` was called with
    `expect.anything(), "cmd-gated", { status: "failed", error: expect.stringContaining("native pipeline is disabled") }`
  - `mocks.updateControlCommand` was called exactly once
    (`toHaveBeenCalledTimes(1)`) — proving it never went through `running`.
  - `mocks.startPipelineRun` was **not** called.
  - `mocks.runDiscoveryAndEnqueue` was **not** called.
  - `ack` was called once; `retry` was not called.

**Test 2 — `"retries a gated control command when the ops record cannot be written"`**

- Arrange: `mocks.updateControlCommand.mockRejectedValueOnce(new Error("d1 down"));`
  plus fresh `ack` / `retry` spies.
- Act: same dispatch, `gatedEnv()`.
- Assert: `retry` called once; `ack` **not** called.

**Verify**:

```bash
cd workers/austlii-scraper && npm run typecheck && npm test
```

→ typecheck exits 0; the test run ends with `Test Files  7 passed (7)` and
`Tests  30 passed (30)` (28 before, 2 new).

### Step 7: Document the inert crons

Edit `workers/austlii-scraper/wrangler.toml`. Add **comments only** — change no
values.

Immediately above `[triggers]` (currently line 103), insert:

```toml
# These crons are inert while PIPELINE_ENABLED / NATIVE_PIPELINE_ENABLED are
# "false": scheduled() checks nativePipelineReady() first and returns after
# logging cron.skipped.disabled. Per docs/adr/0001-austlii-ingestion-architecture.md
# this pipeline is quarantined break-glass, not a production path; production
# ingestion is the external VPS crawler (see scripts/crawler/README.md).
# Do not flip these flags without superseding that ADR.
```

**Verify**:

```bash
git diff 42826a3 -- workers/austlii-scraper/wrangler.toml \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^\+[[:space:]]*#' | wc -l
grep -c "quarantined break-glass" workers/austlii-scraper/wrangler.toml
```

→ the first prints `0` (nothing was removed and every added line is a
comment); the second prints `1` (proving the comment was actually added, so
the first check is not vacuously passing). Then re-run the full gate:

```bash
cd workers/austlii-scraper && npm run typecheck && npm test
```

→ exit 0 and `Tests  30 passed (30)`.

### Step 8: Final audit

Run this **before** you make any commit (after committing, the modified files
move out of `git status` and the audit becomes vacuous):

```bash
git status --porcelain
git diff --check
cd workers && npx vitest run
```

**Verify**: `git status --porcelain` lists exactly these seven entries and
nothing else. Two of them are pre-existing and are not yours —
`.claude/STATE.md` was already modified before you started (leave it alone),
and `plans/` is untracked because this plan file lives there:

```
 M .claude/STATE.md
?? docs/adr/
?? plans/
?? scripts/crawler/
 M workers/austlii-scraper/src/__tests__/pipeline-control.test.ts
 M workers/austlii-scraper/src/index.ts
 M workers/austlii-scraper/wrangler.toml
```

If `git status --porcelain` shows anything outside that list, you edited a file
you do not own — revert it (see STOP conditions).

`git diff --check` prints nothing. `cd workers && npx vitest run` still reports
`345 passed` across 25 files.

## Test plan

- **New tests**: 2, both in
  `workers/austlii-scraper/src/__tests__/pipeline-control.test.ts`:
  1. Gated pipeline → command recorded `failed` once with the disabled reason,
     no run started, message acked, not retried. This is the regression test
     for the DLQ-burial bug.
  2. Gated pipeline **and** Ops D1 write fails → message retried, not acked.
     This guards the escape hatch so a D1 outage cannot silently drop commands.
- **Structural pattern**: copy the existing tests in the same file — the
  `vi.hoisted` mock block at lines 3–13, the `vi.mock("../pipeline-db", ...)`
  block at lines 19–30, and the assertion style of
  `"starts a manual discovery run and completes its command"` at lines 71–81.
- **Not tested here**: the producer's `202` response
  (`workers/pipeline/control_handlers.js`) — out of scope, recorded as an ADR
  follow-up. Its existing tests in `workers/__tests__/pipeline-control.test.js`
  must keep passing untouched, which Step 8 verifies.
- **Verification**: `cd workers/austlii-scraper && npm test` → 30 passed
  (was 28); `cd workers && npx vitest run` → 345 passed, unchanged.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f docs/adr/README.md` exits 0
- [ ] `test -f docs/adr/0001-austlii-ingestion-architecture.md` exits 0
- [ ] `grep -c "Operator sign-off" docs/adr/0001-austlii-ingestion-architecture.md` prints `1`
- [ ] `grep -q "workers/pipeline/control_handlers.js" docs/adr/0001-austlii-ingestion-architecture.md` exits 0 (the 202→503 follow-up is recorded)
- [ ] `test -x scripts/crawler/import_from_vps.sh` exits 0
- [ ] `bash -n scripts/crawler/import_from_vps.sh` exits 0
- [ ] `grep -q "ps -u austlii-crawler" scripts/crawler/README.md` exits 0
- [ ] `grep -c 'throw new Error("native pipeline is disabled")' workers/austlii-scraper/src/index.ts` prints `0`
- [ ] `grep -c 'PIPELINE_DISABLED_REASON' workers/austlii-scraper/src/index.ts` prints `2`
- [ ] `grep -c 'message.retry();' workers/austlii-scraper/src/index.ts` prints `4`
- [ ] `cd workers/austlii-scraper && npm run typecheck` exits 0
- [ ] `cd workers/austlii-scraper && npm test` exits 0 with `Tests  30 passed (30)`
- [ ] `cd workers && npx vitest run` exits 0 with `345 passed`
- [ ] `git diff --check` prints nothing
- [ ] Run before committing: `git status --porcelain` lists exactly the seven entries shown in Step 8 and nothing else
- [ ] `grep -rnE "cfut_|Bearer [A-Za-z0-9_-]{16,}|[0-9]{1,3}(\.[0-9]{1,3}){3}" docs/adr scripts/crawler` returns nothing
- [ ] `git diff 42826a3 -- workers/austlii-scraper/wrangler.toml | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^\+[[:space:]]*#' | wc -l` prints `0`
- [ ] `grep -c "quarantined break-glass" workers/austlii-scraper/wrangler.toml` prints `1`
- [ ] `plans/README.md` status row updated (skip if that file does not exist)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check in Step 1 prints any file. In particular, if
  `workers/austlii-scraper/src/index.ts:97` no longer reads
  `if (!nativePipelineReady(env)) throw new Error("native pipeline is disabled");`
  the gate has already been restructured by someone else and Step 5's edit is
  wrong.
- The baseline in Step 1 is not `28 passed` — someone has already changed this
  suite and your `30 passed` target is wrong.
- You conclude the ADR's recommended decision (Option B) is wrong on the
  evidence. **Write your reasoning into the ADR's `## Options considered`
  section, leave the Status as `Proposed`, and report** — do not silently
  invert the decision, and do not delete any part of
  `workers/austlii-scraper/`.
- Any imported or inspected file contains a literal credential (a
  `CRAWLER_WRITE_TOKEN`, a `cfut_*` AI Gateway token, a Telegram bot token, a
  Supabase service-role key). Do not commit it, do not paste its value into
  any file or into your report — report the `file:line` and the credential
  type only, and state that the credential must be rotated before anything
  else proceeds.
- You find yourself needing to edit `workers/pipeline/control_handlers.js`,
  `workers/admin/cloudflare_handlers.js`, `workers/case-api/cloudflare_mutations.js`
  or anything under `frontend/src/` to finish a step. That means the step was
  mis-scoped; stop rather than crossing the boundary.
- You are tempted to flip `PIPELINE_ENABLED` or `NATIVE_PIPELINE_ENABLED` to
  `"true"`, or to remove the crons, to make something pass. Both are
  out of scope and the fail-closed defaults are deliberate.
- `scripts/crawler/import_from_vps.sh` cannot be written without an actual
  connection to the VPS. It must be writable and syntax-checkable offline; if
  you believe otherwise, stop — do not attempt to SSH anywhere.

## Maintenance notes

For the human or agent who owns this next:

- **The ADR is `Proposed`, not `Accepted`.** Nothing downstream should cite it
  as binding until an operator fills in the sign-off line. A reviewer should
  check that the decision matches what the operator actually intends to
  maintain, because it commits them to keeping one rented VPS and one
  residential line alive as production infrastructure.
- **What a reviewer should scrutinise in the diff**: (a) that Step 5's gate
  check really runs before the `running` write, so a gated command is never
  briefly marked `running`; (b) that the `catch` block at the bottom of
  `handlePipelineControlBatch` still calls `message.retry()` — genuine runtime
  failures must stay retryable; (c) that
  `workers/austlii-scraper/wrangler.toml` gained only comment lines.
- **Deliberately deferred out of this plan**, each needing its own change in a
  file this plan does not own: the `202` → `503` fix in
  `workers/pipeline/control_handlers.js:96`; DLQ depth and command status on
  `GET /api/v1/admin/pipeline-runs`; status read routes for the `start`,
  `stop` and `download` actions; and the actual structured-field backfill of
  the ~4,381 unextracted 2026 cases. The ADR lists all four as required
  follow-ups so they are not lost.
- **The import is only half-done when this plan lands.** `scripts/crawler/`
  will contain a README and an import script but not `crawler.py` or
  `pipeline.sh` — those need one operator run of
  `scripts/crawler/import_from_vps.sh`. Until that happens, the single-disk
  risk is documented but not removed. Chase it.
- **If the crawler's source is imported and read**, check whether it can be
  patched to fill `date` from the case title by regex before POSTing — the
  operational notes record that the hearing/decision date is present in the
  title for the 2026 cohort, which would fix the largest single missing field
  at the source for every future run.

## Findings reconsidered

Nothing in the finding was rejected — the problem is real and, if anything,
worse than reported. Four pieces of cited evidence were wrong or imprecise and
have been corrected above:

- **`.claude/STATE.md:39` does not say what the finding says it says.** At
  commit `42826a3` that line is `| Finding | Status |`, a table header inside
  the 2026-08-11 section. The `P1-3 … 機制待定` text and the `P2-7` crawler
  version-control item are at lines 81 and 83 of the **uncommitted working
  tree**, inside a `## 2026-08-25 …` section that is not in the commit at all
  (`git show 42826a3:.claude/STATE.md | grep -c "austlii-crawler"` → `0`).
  This makes the underlying problem *worse*, not better: the only description
  of the production ingestion path is not merely undocumented code — it is an
  uncommitted note about undocumented code. The plan therefore copies those
  facts into `scripts/crawler/README.md`, a tracked file.
- **"NO route reads `pipeline_control_commands` back" is not quite true.**
  `workers/case-api/cloudflare.js:1033` reads it via
  `latestControlCommand("legislation_update")` to serve
  `GET /api/v1/legislations/update/status`. The gap is real but narrower: it
  covers `start`, `stop` and `download` only. Corrected in "Current state" and
  in the ADR's Context item 5.
- **The 202 body is `{started, ok, command_id, native}`, not
  `{started, ok, native}`** (`workers/pipeline/control_handlers.js:96`) — the
  `command_id` *is* returned to the caller. This does not rescue the finding's
  point, because for three of four actions there is no endpoint that accepts
  that `command_id` back.
- **Impact magnitude re-measured live on 2026-08-27** and revised downward
  from the verifier's 4%: `GET /api/v1/stats` → 153,198 total / 4,381 for
  2026; three 100-row samples of `year=2026` gave `date`/`judges`/`outcome`
  filled on 0/0/0, 0/0/0 and 2/2/2 rows, versus 100/99/100 for `year=2025` and
  100/95/100 for `year=2024`.

Two parts of the finding's fix sketch are addressed by *recording* rather than
*doing*, because they live outside this plan's file territory: the
`202` → `503` change in `workers/pipeline/control_handlers.js` and surfacing
DLQ depth on the `/api/v1/admin/pipeline-runs` page. Both are written into the
ADR's Consequences as named, file-scoped follow-ups so no one has to re-audit
them.

One part of the fix sketch was deliberately softened. The sketch says
"whichever loses, delete or explicitly quarantine it". The plan chooses
quarantine and forbids deletion, because the two pipelines are not
interchangeable: the VPS crawler's advantage is entirely in *egress* (a
residential IP AustLII does not challenge), while the native pipeline's
remaining value is its *extraction* half — cost caps, DLQ, audit trail, R2
idempotency — and extraction is exactly the stage where production is
currently broken. Deleting 2,481 lines with 28 passing tests is a one-way
door; the ADR sets named conditions for re-opening the question instead.
