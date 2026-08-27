# Plan 011: Stop double-billing extraction and dropping cases on transient failures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists; if it does not exist, do **not** create
> it (a reviewer maintains the index).
>
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff sees
> only what is committed, so on a dirty tree it gives a false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="workers/austlii-scraper/src workers/austlii-scraper/wrangler.toml workers/austlii-scraper/tsconfig.json workers/extraction-container.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> If any in-scope path appears in **any** of the three diffs, or in
> `git status --short`, treat it as a STOP condition: compare the "Current state"
> excerpts against the live code and report before editing. Do **not** run
> `git checkout --` or `git clean` — the operator may have work in progress.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none. Every command in this plan is self-contained and its
  expected output is stated below. (This plan does not touch the frontend, so
  the frontend compile-gate plans are irrelevant to it.)
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

### Parallelism

This plan owns `workers/austlii-scraper/**` and `workers/extraction-container.js`
and nothing else. It shares **no file** with the five plans queued serially on
`workers/storage/cloudflare.js` / `workers/case-api/cloudflare.js`
(009 → 010 → 013 → 014 → 012), so it can run fully in parallel with all of them.

One consequence you must respect: because those five are landing tests into the
main Worker suite concurrently, **this plan must not assert an absolute main-Worker
test total.** It asserts only that the main-Worker suite has zero failures and
that its total did not *drop* below the baseline you record in Step 0.

One ordering note in the other direction: Step 5 adds a new query against
`pipeline_control_commands`. `plans/013-*.md` Step 2 originally asked its
executor to confirm "exactly six lines" match a repo-wide grep for that table —
a count this plan legitimately increases to seven. That check has been rewritten
in 013 to analyse predicates instead of counting lines, so the two plans no
longer conflict; no ordering constraint follows from it. If you are looking at an
older copy of 013 that still counts lines, tell the integrator rather than
skipping this step.

## Why this matters

`workers/austlii-scraper/` is the Cloudflare Worker that spends real money: it
calls a paid LLM extraction container once per batch of scraped Australian
immigration cases. Today one malformed item in a batch throws **after** the paid
call and **before** the cost is recorded, so the whole batch is redelivered by
the platform (`max_retries = 2`) and the LLM extraction is re-billed up to two
more times while the `$5`-per-run ledger still reads as untouched — the cap can
be blown by 2–3× without the ledger ever knowing. On top of that, the
advertised `$10` monthly cap is configured but read by no code at all, and the
per-run cap silently becomes *unlimited* whenever the `COST_CAP_DO` binding is
missing or the ledger returns an unexpected body.

The same Worker also silently drops cases: an AustLII `5xx` or a truncated page
is recorded as an error and acked, even though the queue has three retries and a
dead-letter queue configured for exactly that case. And its per-court rate limit
is a read-modify-write against eventually-consistent Workers KV shared by up to
**20 concurrent consumers**, so the 1500 ms spacing that exists to avoid a
multi-hour AustLII IP block does not actually hold.

After this plan: cost is charged before any work that can fail, a failed item
retries alone instead of re-billing its whole batch, both the per-run and the
monthly ceiling are enforced and fail **closed**, transient upstream failures
retry into the DLQ instead of vanishing, AustLII is contacted by one consumer at
a time, a redelivered operator command reuses its original run instead of
forking a phantom one, and a discovery run with one bad court-year no longer
reports the whole run as failed.

## Current state

### Files in play

- `workers/austlii-scraper/src/extract.ts` — extract-queue consumer; calls the
  paid extraction container, stages results to R2 + the coordinator queue, and
  talks to the cost-cap Durable Object.
- `workers/austlii-scraper/src/index.ts` — Worker entrypoint: `fetch`,
  `queue` (scrape + control + DLQ routing), `scheduled` (cron discovery),
  `processJob` (the AustLII fetch), and the KV rate limiter.
- `workers/austlii-scraper/src/discover.ts` — court/year listing discovery and
  scrape-job enqueue; owns the run's final `status`.
- `workers/austlii-scraper/src/pipeline-db.ts` — the only D1 boundary
  (`IMMI_CATALOG_DB` read, `IMMI_OPS_DB` write). Contains `startPipelineRun`,
  `updateControlCommand`, the outbox helpers, and private `ops()` / `catalog()`
  / `rows()` helpers.
- `workers/austlii-scraper/src/types.ts` — the `Env` interface and job/message
  types.
- `workers/austlii-scraper/src/cost-cap-do.ts` — `CostCapDO`, a Durable Object
  with `/remaining?cap=N`, `/charge` (POST `{usd}`) and `/reset`.
- `workers/austlii-scraper/wrangler.toml` — queue consumer settings and `[vars]`.
- `workers/austlii-scraper/tsconfig.json` — scraper typecheck config.
- `workers/extraction-container.js` — the Durable Object bridge in front of the
  extraction Container. **It is the `main` of a real (operator-deployed) Worker**:
  `config/wrangler-extraction-container.toml.example:4` reads
  `main = "workers/extraction-container.js"` with a matching
  `class_name = "ExtractionBackend"`.

### JSCORR-08 — cost charged after the failure-prone work (`extract.ts:78-101`)

```ts
  const response = await callInternalExtract(env, runId, payloadBatch);
  if (!response) {
    retryAll(messages, "internal_extract_unavailable");
    return;
  }

  const upserted = await enqueueNativeExtractedResults(env, runId, response.extracted);
  await chargeCostUsd(env, runId, response.cost_usd);
  await addPipelineRunMetrics(env, runId, {
    extracted: response.extracted.length,
    upserted,
    llmCalls: response.llm_calls,
    costUsd: response.cost_usd,
  }).catch(() => undefined);

  for (const message of messages) message.ack();
```

`callInternalExtract` on line 78 is the paid call. `enqueueNativeExtractedResults`
on line 84 has **no** try/catch — unlike the payload build at lines 70–76, which
is wrapped and calls `retryAll` — and it can throw mid-loop at several points
(`extract.ts:186` missing queue, `:192` `Missing canonical text`, `:205` R2 put,
`:218`/`:226`/`:228` D1 outbox, `:227` queue send). `index.ts:188-190` dispatches
`return handleExtractBatch(...)` from `queue()` with no try/catch, so the throw
escapes to the platform and the entire batch is redelivered.

The per-item loop body it can throw from, verbatim (`extract.ts:186-232`):

```ts
  if (!env.NATIVE_CASE_QUEUE) throw new Error("NATIVE_CASE_QUEUE is required for native extraction");
  let count = 0;
  for (const item of extracted) {
    const fields = Object.fromEntries(Object.entries(item.fields || {}).map(([name, envelope]) => [name, envelope.value]));
    const record = { ...(item.base || {}), ...fields, case_id: item.case_id };
    const canonicalText = String(item.base?.full_text || item.base?.text_snippet || `${record.title || ""} ${record.citation || ""}`).trim();
    if (!canonicalText) throw new Error(`Missing canonical text for ${item.case_id}`);
```

Re-publishing is already idempotent: `stageNativeOutboxEvent` returns
`"published"` for an event that already went out (`pipeline-db.ts:44-59`), and
`extract.ts:225` skips the queue send in that case. Per-item retry is therefore
safe.

### JSCORR-14 — cost caps fail open; the monthly cap is dead config

`workers/austlii-scraper/src/extract.ts:235-251`, verbatim:

```ts
async function getRemainingCostUsd(env: Env, runId: string): Promise<number> {
  if (!env.COST_CAP_DO) return Number.POSITIVE_INFINITY;
  const cap = positiveNumber(env.PIPELINE_RUN_COST_CAP_USD, 5);
  const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(`run:${runId}`));
  const response = await stub.fetch(`https://cost/remaining?cap=${encodeURIComponent(String(cap))}`);
  const body = await response.json<{ remaining_usd?: number }>();
  return positiveNumber(body.remaining_usd, cap);
}

async function chargeCostUsd(env: Env, runId: string, usd: number): Promise<void> {
  if (!env.COST_CAP_DO || usd <= 0) return;
  const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(`run:${runId}`));
  await stub.fetch("https://cost/charge", {
    method: "POST",
    body: JSON.stringify({ usd }),
  }).catch(() => undefined);
}
```

Line 236 returns `Number.POSITIVE_INFINITY` when the binding is absent (cap
disabled), and line 241 falls back to the **full** cap when the DO body is
malformed (cap reset). Line 238 addresses the DO per run, so no cross-run
accumulator exists.

`workers/austlii-scraper/wrangler.toml:106-115`, verbatim:

```toml
[vars]
PIPELINE_ENABLED = "false"
NATIVE_PIPELINE_ENABLED = "false"
PIPELINE_BIWEEKLY_GATE = "true"
PIPELINE_RUN_COST_CAP_USD = "5"
PIPELINE_MONTHLY_HARD_CAP_USD = "10"
PIPELINE_DISCOVERY_LOOKBACK_YEARS = "2"
PIPELINE_PER_COURT_RATE_LIMIT_MS = "1500"
PIPELINE_CONTAINER_EXTRACT_TIMEOUT_MS = "300000"
FIRECRAWL_ENABLED = "false"
```

`PIPELINE_MONTHLY_HARD_CAP_USD` is on **line 111** (the auditor cited 110, which
is `PIPELINE_RUN_COST_CAP_USD` — corrected). A repo-wide grep for it returns
only that line and three plan-document mentions: **zero code readers**. It is
also absent from the `Env` interface (`types.ts:91-113` declares its siblings
`PIPELINE_RUN_COST_CAP_USD` on line 97 and `PIPELINE_PER_COURT_RATE_LIMIT_MS` on
line 95, but not this one).

`scripts/check_cloudflare_native_target.py:161-195` (`_validate_pipeline`)
requires the D1/R2/KV/queue/`MYBROWSER`/`AI`/`EXTRACTION_BACKEND` bindings but
**never** requires `COST_CAP_DO`, so a config missing the binding passes the
deploy gate and silently disables the cap.

The DO itself is correct and already supports what is needed
(`cost-cap-do.ts:10-23`):

```ts
    if (url.pathname === "/remaining") {
      const cap = positiveNumber(url.searchParams.get("cap"), 5);
      const spent = await this.readSpent();
      return Response.json({ spent_usd: spent, cap_usd: cap, remaining_usd: Math.max(0, cap - spent) });
    }

    if (url.pathname === "/charge" && request.method === "POST") {
```

### JSCORR-10 — every AustLII 5xx drops the case for the run

`workers/austlii-scraper/src/index.ts:333-356`, verbatim:

```ts
  if (response.status === 429) {
    // Rate limited — throw to trigger Queue retry
    throw new Error(`Rate limited (429) for ${job.url}`);
  }

  if (response.status === 404) {
    // Page not found — record as error, don't retry
    await putScrapeError(job, env, "Page not found", 404);
    return { success: false };
  }

  if (!response.ok) {
    await putScrapeError(job, env, `HTTP ${response.status}: ${response.statusText}`, response.status);
    return { success: false };
  }

  const html = await response.text();

  // Extract full text
  const fullText = extractFullText(html);
  if (!fullText || fullText.length < 50) {
    await putScrapeError(job, env, "No content extracted from page", 0);
    return { success: false };
  }
```

Back in the consumer loop, `message.ack()` at `index.ts:226` runs unconditionally
once `processJob` returns, so the job is consumed. Note the loss is **per-run,
not permanent**: `putScrapeError` writes to `errorJsonKey` (`…​.error.json`,
`index.ts:421-424`), not to the `resultJsonKey` that the resume check at
`index.ts:213` `head()`s, so a later run re-scrapes the case.

The catch block that will receive the new throws (`index.ts:227-238`):

```ts
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`Failed to process ${job.case_id}: ${error}`);

        await putScrapeError(job, env, error, 0);
        if (job.run_id) {
          await addPipelineRunMetrics(env, job.run_id, { errors: 1 }).catch(() => undefined);
        }

        // Retry: don't ack so Queue retries (up to max_retries)
        message.retry();
      }
```

### JSCORR-09 — the per-court throttle is a KV check-then-act across 20 consumers

`workers/austlii-scraper/src/index.ts:489-504`, verbatim:

```ts
async function rateLimitPipelineScrape(job: ScrapeJob, env: Env): Promise<void> {
  if (!job.run_id || job.phase !== "scrape" || !env.PIPELINE_KV) return;
  const delayMs = Number(env.PIPELINE_PER_COURT_RATE_LIMIT_MS ?? "1500");
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;

  const key = `ratelimit:${job.court_code}`;
  const now = Date.now();
  const previous = Number(await env.PIPELINE_KV.get(key));
  if (Number.isFinite(previous)) {
    const waitMs = previous + delayMs - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  await env.PIPELINE_KV.put(key, String(Date.now()), { expirationTtl: 60 });
}
```

It is the only throttle before the AustLII fetch (called at `index.ts:220`).
Workers KV reads are eventually consistent with up to a 60 s edge cache, so
concurrent consumers can all read a stale or absent value. `Number(null)` is `0`,
which is finite, so the "no previous value" branch computes a hugely negative
`waitMs` and skips the sleep — the right outcome by accident, not by intent.

`workers/austlii-scraper/wrangler.toml:56-62`, verbatim:

```toml
[[queues.consumers]]
queue = "immi-scrape-queue"
max_batch_size = 5
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "immi-scrape-dlq"
max_concurrency = 20
```

`max_concurrency = 20` is on **line 62** (the auditor cited 61, which is the
`dead_letter_queue` line — corrected). For contrast, the extract queue already
runs at `max_concurrency = 1` (`wrangler.toml:76`).

### JSCORR-15 — control messages are not idempotent

`workers/austlii-scraper/src/index.ts:94-116`, verbatim:

```ts
  for (const message of batch.messages) {
    const control = message.body;
    try {
      if (!nativePipelineReady(env)) throw new Error("native pipeline is disabled");
      await updateControlCommand(env, control.command_id, { status: "running" });
      if (control.action === "stop") {
        const runId = await latestRunningPipelineRun(env);
        if (runId) await requestPipelineStop(env, runId);
        await updateControlCommand(env, control.command_id, { status: "completed", runId: runId ?? undefined });
      } else if (control.action === "download") {
        const runId = await startPipelineRun(env, {
          trigger: "manual",
          courts: controlCourts(control.courts),
          phase: "download",
        });
        await updateControlCommand(env, control.command_id, { status: "running", runId });
        const targets = await findCasesMissingContent(env, controlCourts(control.courts), control.limit ?? 50);
        const jobs = targets.map((job) => ({ body: { ...job, run_id: runId } }));
        for (let index = 0; index < jobs.length; index += 25) {
          await env.SCRAPE_QUEUE.sendBatch(jobs.slice(index, index + 25));
        }
```

`startPipelineRun` mints an unconditional new id (`pipeline-db.ts:222`:
`const runId = crypto.randomUUID();`). A `sendBatch` failure inside the chunk
loop at line 113 reaches `message.retry()` at `index.ts:146`, and
`immi-pipeline-control-queue` is configured `max_retries = 3`
(`wrangler.toml:47`) — so one operator click can produce up to four
`pipeline_runs` rows. `control.command_id` is used only for status bookkeeping
(lines 98/109/116), never as an idempotency key.

The state needed for the fix already exists —
`migrations/d1/ops/0002_pipeline_control.sql:3-13`:

```sql
CREATE TABLE IF NOT EXISTS pipeline_control_commands (
  command_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('start', 'stop', 'download', 'legislation_update')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  run_id TEXT,
```

and `updateControlCommand` already writes `run_id` with
`run_id = COALESCE(?, run_id)` (`pipeline-db.ts:119-127`), so the first
attempt's run id survives a retry. Duplicate scrape jobs are additionally
bounded by the R2 `head(resultKey)` resume check at `index.ts:213`.

### JSCORR-26 — one bad court-year marks the whole discovery run failed

`workers/austlii-scraper/src/discover.ts:180-232`, the relevant lines verbatim:

```ts
  let discovered = 0;
  const errors: string[] = [];

  for (const court of courts) {
```

```ts
    const result = await discoverCourt(env, court, runId, scheduledTime);
    discovered += result.new_cases.length;
    errors.push(...result.errors);

    if (result.skipped_reason) {
      errors.push(`${court}: skipped (${result.skipped_reason})`);
      continue;
    }
```

```ts
  await updatePipelineRun(env, runId, {
    discovered,
    errors: errors.length,
    errorsJson: errors.length ? errors : undefined,
    status: errors.length ? "failed" : "ok",
  });
```

`errors` is run-wide and is appended per court-year at `discover.ts:133`
(`errors.push(\`${court}/${year}: …\`)`) and per skipped court at
`discover.ts:193`, while `discovered` still accumulates normally at
`discover.ts:189`. One transient listing failure therefore flags a productive
run as `failed`.

The read side is **out of scope for this plan** but explains the cost:
`workers/pipeline/cloudflare_handlers.js:19` computes
`const finished = ["ok", "completed"].includes(String(run.status || "").toLowerCase());`
and drives `phases_completed: []` (line 37) and `overall_progress` 0
(`progressFor`, lines 19–23) off it. Do not edit that file in this plan.

Note the weak part of the original report: `discover.ts:116-118` pre-filters
years through `shouldScanCourtYear`, so out-of-range 404s largely never fire.
The real trigger is a genuine transient listing fetch/parse failure.

### JSCORR-13 — `extraction-container.js` cannot even load

`workers/extraction-container.js:1-8` and `:28-45`, verbatim:

```js
/**
 * Cloudflare Container bridge for the CPU/LLM-only extraction service.
 *
 * The bridge forwards only bounded extraction requests and passes no database
 * or object-store credentials into the Container.
 */

export class ExtractionBackend extends DurableObject {
```

```js
  async fetch(request) {
    const url = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search}`;
    let lastError;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const port = this.ctx.container.getTcpPort(8080);
        return await port.fetch(new Request(containerUrl, request));
      } catch (error) {
        lastError = error;
        const message = error?.message || "";
        if (!message.includes("not listening") && !message.includes("not running")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return Response.json({ error: "Extraction container unavailable", detail: lastError?.message || "timeout" }, { status: 503 });
  }
```

The file has **zero** import statements, yet line 8 extends `DurableObject`.
`DurableObject` is an export of `cloudflare:workers`, not a runtime global —
this repo's other SQLite DO gets it right:
`workers/llm-council/session_do.js:9` does
`import { DurableObject } from "cloudflare:workers";`. As written the module
throws `ReferenceError` on evaluation, so every extraction batch 5xx's to the
DLQ.

Two corrections to the original report, established by reading the file:
1. It is **not** an unreferenced decoy —
   `config/wrangler-extraction-container.toml.example:4` is
   `main = "workers/extraction-container.js"` (`name = "immi-extraction"`; the
   scraper binds `service = "immi-extraction-replace"`).
2. The retry loop does **not** run 120 × 500 ms for a POST:
   `new Request(containerUrl, request)` disturbs the original request's body, so
   attempt 2 throws `Body has already been used`, whose message matches neither
   `"not listening"` nor `"not running"`, and line 39 rethrows. A POST gets at
   most one real attempt.

### JSCORR-19 — the page is parsed twice for identical output

`workers/austlii-scraper/src/index.ts:351-360`, verbatim:

```ts
  // Extract full text
  const fullText = extractFullText(html);
  if (!fullText || fullText.length < 50) {
    await putScrapeError(job, env, "No content extracted from page", 0);
    return { success: false };
  }

  // Extract metadata from the full page text (not just the content div)
  const pageText = extractFullText(html);
  const metadata = extractMetadata(pageText);
```

Lines 352 and 359 are byte-identical calls, so `pageText === fullText`. The
comment on line 358 is wrong: `extractFullText` prefers the content div —
`parser.ts:30-45` tries `#page-main`, then `#cases_doc`, then `.document`, and
only falls back to `<body>`.

Correction to the original report: `extractMetadata` returns only
`judges, date, catchwords, outcome, visa_type, legislation, citation_extracted`
(`ParsedCase`, `parser.ts:11-20`). It never produces `country_of_origin`,
`is_represented` or `representative`, so it cannot affect those fill rates —
those come from the Python `extract_structured_fields.py` path. This is a
cosmetic cleanup, not a data-quality fix.

### JSCORR-27 — dead code left by the HTTP-trigger removal

Confirmed by grep across `workers/austlii-scraper/src` — each of these appears
exactly once, at its own definition or import site:

- `workers/austlii-scraper/src/index.ts:399` — `function chunkArray<T>(arr: T[], size: number): T[][]`
  (`discover.ts` has its own copy at line 592 and uses that one at line 210)
- `workers/austlii-scraper/src/index.ts:458` — `function parseCourtList(raw: string | null): CourtCode[]`
- `workers/austlii-scraper/src/index.ts:471` — `function parseScheduledTime(raw: string | null): number`
- `workers/austlii-scraper/src/index.ts:73` — `const MAX_BATCH_ENQUEUE = 500;`
- `workers/austlii-scraper/src/index.ts:13` — the `discoverCourt` half of
  `import { discoverCourt, runDiscoveryAndEnqueue } from "./discover";`
  (`runDiscoveryAndEnqueue` **is** used; `discoverCourt` is not)
- `workers/austlii-scraper/src/index.ts:38-39` — the `EnqueueRequest` /
  `EnqueueResponse` type imports (their declarations live at `types.ts:138` and
  `types.ts:143` and have no other reader)

There is also a routing asymmetry — `index.ts:185-190`, verbatim:

```ts
    if (batch.messages.length > 0 && batch.messages.every((message) => isPipelineControl(message.body))) {
      return handlePipelineControlBatch(batch as unknown as MessageBatch<PipelineControlMessage>, env);
    }
    if (batch.messages.every((message) => isExtractJob(message.body))) {
      return handleExtractBatch(batch as MessageBatch<ExtractJob>, env);
    }
```

Line 185 guards `batch.messages.length > 0`; line 188 does not, so `[].every(...)`
=== `true` routes an empty batch to `handleExtractBatch`. It is a harmless no-op
today (`groupByRun` yields nothing), but the asymmetry is what let the dead
symbols survive: `workers/austlii-scraper/tsconfig.json` has no `noUnusedLocals`
/ `noUnusedParameters`, verbatim:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

Running `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` on the tree at
`42826a3` reports exactly eight findings — the six above plus
`src/index.ts(38,3)`/`(39,3)` counted separately, plus one more you must handle:

```
src/index.ts(154,33): error TS6133: 'env' is declared but its value is never read.
```

That is the `env` parameter of the `fetch` handler
(`async fetch(request: Request, env: Env): Promise<Response> {`). It must stay in
the signature; rename it `_env` (TypeScript ignores leading-underscore
parameters under `noUnusedParameters`).

### Conventions this plan must match

- **Structured logs**: every notable event is a single
  `console.log/warn/error(JSON.stringify({ event: "<dotted.name>", ... }))`.
  Exemplars: `extract.ts:37`, `extract.ts:94-101`, `index.ts:145`,
  `discover.ts:216-224`. Match that shape for every log line you add.
- **Env vars are strings** and are parsed through the local `positiveInt` /
  `positiveNumber` helpers (`extract.ts:282-290`) or
  `parsePositiveInt` from `pipeline-config` (used in `discover.ts:114-115`).
- **Immutability** (`~/.claude/rules/coding-style.md`): create new objects, do
  not mutate inputs. Accumulator counters inside a single function are fine;
  the existing `discovered` / `errors` locals in `discover.ts` are the pattern.
- **The scraper has no PostgreSQL/Hyperdrive/Supabase anything.** Two checked-in
  gates enforce it by scanning `workers/austlii-scraper/src/*.ts` for those
  markers: `tests/test_native_pipeline_boundary.py:8-13` and
  `scripts/check_native_effective_references.py`. Do not introduce the strings
  `postgres`, `hyperdrive` or `supabase` anywhere in your new code or comments.
- **`D1` access only through `pipeline-db.ts`.** `ops()` / `catalog()` are
  private helpers in that file (`pipeline-db.ts:188-198`); new queries go in
  `pipeline-db.ts` and are imported, never inlined into `index.ts`.
- **Tests are typechecked.** `tsconfig.json`'s `"include": ["src/**/*.ts"]`
  covers `src/__tests__/`, so unused locals in a new test will fail
  `npx tsc --noEmit` once step 1 lands.
- **`vi.mock("../pipeline-db", …)` factories are exhaustive objects**, not
  partial spies (see `pipeline-control.test.ts:19-30`). Any new export you
  import from `pipeline-db` must be added to every mock factory that mocks that
  module, or the import resolves to `undefined` at runtime.

### Deliberate design constraints — do NOT "fix" these

- `wrangler.toml` carries **placeholder** D1/KV/R2 IDs by design; real IDs are
  operator-supplied secrets. `scripts/check_cloudflare_native_target.py`
  therefore *fails* on a clean checkout — that is expected, not a regression.
  Do not run it as a gate and do not edit the placeholder IDs.
- `PIPELINE_ENABLED = "false"` and `NATIVE_PIPELINE_ENABLED = "false"` are
  fail-closed defaults. Leave them `"false"`;
  `tests/test_native_pipeline_boundary.py:37-39` asserts it.
- `workers/austlii-scraper/scripts/rollback_run.ts` targets the retired legacy
  stack on purpose. Do not touch it.

## Commands you will need

Run everything from the repository root
`/Users/d/Developer/Active Projects/IMMI-Case-` unless the command `cd`s itself.

**Record your baselines first (Step 0).** The main Worker suite is being grown
concurrently by five other plans, so no absolute total for it is valid:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_MAIN=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_MAIN=$BEFORE_MAIN"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper"
BEFORE_SCRAPER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+'); echo "BEFORE_SCRAPER=$BEFORE_SCRAPER"  # 28 at 42826a3
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short > /tmp/immi-011-dirty-before.txt
```

The scraper suite is owned solely by this plan, so its per-file and per-suite
counts are stable and are used directly.

| Purpose | Command | Expected on success |
|---|---|---|
| Scraper tests (primary gate) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx vitest run` | exit 0. Baseline at `42826a3`: `Test Files 7 passed (7)`, `Tests 28 passed (28)`. After this plan: 7 files, **49** tests (`BEFORE_SCRAPER + 21`) |
| Scraper typecheck | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit` | exit 0, **no output** |
| Unused-symbol probe (step 1 only) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | after step 1: exit 0, no output |
| Main Worker tests (regression) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | zero failures, and the total is **`BEFORE_MAIN` or higher** — higher is expected and fine if a sibling plan landed while you worked. A total **below** `BEFORE_MAIN` means something was deleted; stop. Do not assert an absolute number here. |
| Python config gates (regression) | `.venv/bin/python -m pytest tests/test_native_pipeline_boundary.py tests/test_effective_native_ci.py -q` | `7 passed` (per-file count, stable) |
| Full Python suite (final check) | `make test-py` | zero *new* failures. The only failures allowed are **exactly the three environmental ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`, by name** (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import). Confirm by name: `make test-py 2>&1 \| grep -E '^(FAILED\|ERROR)' \| sort -u` must list nothing outside that file. |
| Container bridge syntax | `node --check workers/extraction-container.js` | exit 0, no output. **This is a parse check only** — it proves nothing about whether the bridge works at runtime; see Step 7 and Step 9. |
| Diff review | `git diff --stat`, `git diff --cached --stat`, `git status --short` | only in-scope files, plus whatever `/tmp/immi-011-dirty-before.txt` already listed |

Never use global `pip`/`python`; the venv is at
`/Users/d/Developer/Active Projects/IMMI-Case-/.venv`.

## Scope

**In scope** (the only files you may modify):

- `workers/austlii-scraper/src/extract.ts`
- `workers/austlii-scraper/src/index.ts`
- `workers/austlii-scraper/src/discover.ts`
- `workers/austlii-scraper/src/pipeline-db.ts`
- `workers/austlii-scraper/src/types.ts`
- `workers/austlii-scraper/tsconfig.json`
- `workers/austlii-scraper/wrangler.toml`
- `workers/austlii-scraper/src/__tests__/extract-native.test.ts`
- `workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts`
- `workers/austlii-scraper/src/__tests__/pipeline-control.test.ts`
- `workers/austlii-scraper/src/__tests__/discover.test.ts`
- `workers/extraction-container.js`

**Out of scope** (do NOT touch, even though they look related):

- `workers/pipeline/cloudflare_handlers.js` — the read side that turns
  `status: "failed"` into a zeroed dashboard. Step 6 fixes the *producer* of that
  status; changing the consumer as well would double-count the fix and collide
  with other work in that directory.
- `workers/cloudflare-native.js`, `workers/case-api/**`, `workers/storage/**`,
  `workers/auth/**`, `workers/llm-council/**` — the main production Worker. This
  plan does not change any of its behaviour; `cd workers && npx vitest run` must
  stay at 345 passing.
- `workers/__tests__/**` — the main Worker's test directory.
- `workers/austlii-scraper/src/cost-cap-do.ts` — `CostCapDO` already exposes
  everything the monthly ledger needs (`/remaining?cap=N`, `/charge`, `/reset`)
  and is keyed by DO name, so a `month:YYYY-MM` id is a different ledger with
  zero code change. Editing it would need a new `[[migrations]]` tag.
- `workers/austlii-scraper/scripts/rollback_run.ts` — deliberate legacy
  break-glass script.
- `config/wrangler-extraction-container.toml.example` — operator template; its
  `main` already points at the file you are fixing.
- `scripts/check_cloudflare_native_target.py` and any other deploy gate.
- `CLAUDE.md`, `.claude/STATE.md`, any `docs/**`.
- Anything under `immi_case_downloader/`, `frontend/`, `tests/`.

## Git workflow

- Branch: `advisor/011-fix-scraper-cost-caps-and-retries`
  (`git checkout -b advisor/011-fix-scraper-cost-caps-and-retries`).
- One commit per step, message style `<type>: <description>` where `<type>` is
  one of `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from
  `git log`: `fix: install root node_modules in make install`.
  Suggested messages are given at the end of each step.
- **No AI attribution / co-author trailers.**
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Delete the dead symbols, remove the duplicate parse, and make the compiler catch the next one

Addresses JSCORR-27 and JSCORR-19. Pure deletion plus a compiler flag — no
behaviour change.

1. In `workers/austlii-scraper/src/index.ts`:
   - Line 13: change
     `import { discoverCourt, runDiscoveryAndEnqueue } from "./discover";`
     to `import { runDiscoveryAndEnqueue } from "./discover";`
   - Lines 38–39: delete the `EnqueueRequest,` and `EnqueueResponse,` entries
     from the `import type { … } from "./types";` list. Leave `Env`,
     `ExtractJob`, `ScrapeJob`, `ScrapeResult`, `ScrapeError` and
     `PipelineControlMessage`.
   - Line 73: delete `const MAX_BATCH_ENQUEUE = 500;` (and the blank line that
     leaves a double gap).
   - Line 154: rename the unused handler parameter — the signature becomes
     `async fetch(request: Request, _env: Env): Promise<Response> {`.
   - Lines 399–405: delete the whole `function chunkArray<T>(…)` block.
   - Lines 458–469: delete the whole `function parseCourtList(…)` block.
   - Lines 471–475: delete the whole `function parseScheduledTime(…)` block.
   - Line 188: add the same emptiness guard the control branch has, so the two
     read alike:
     ```ts
     if (batch.messages.length > 0 && batch.messages.every((message) => isExtractJob(message.body))) {
     ```
   - Lines 358–360: delete the redundant second parse and fix the wrong comment.
     Replace
     ```ts
       // Extract metadata from the full page text (not just the content div)
       const pageText = extractFullText(html);
       const metadata = extractMetadata(pageText);
     ```
     with
     ```ts
       // extractFullText prefers the case content div (#page-main / #cases_doc /
       // .document) and only falls back to <body>; metadata is read from that
       // same text, so parse once and reuse it.
       const metadata = extractMetadata(fullText);
     ```
2. In `workers/austlii-scraper/src/types.ts`: delete the now-unreferenced
   `EnqueueRequest` (lines 137–140) and `EnqueueResponse` (lines 142–147)
   interfaces, including their `/** … */` comment lines.
3. In `workers/austlii-scraper/tsconfig.json`: add two options inside
   `compilerOptions`, after `"strict": true,`:
   ```json
    "noUnusedLocals": true,
    "noUnusedParameters": true,
   ```

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ prints `TSC_OK`, then `Test Files  7 passed (7)` and `Tests  28 passed (28)`.

Commit: `refactor: drop dead scraper symbols and enable unused-symbol checks`

### Step 2: Retry transient AustLII failures instead of dropping the case, and serialise the scrape queue

Addresses JSCORR-10 and JSCORR-09. All edits in
`workers/austlii-scraper/src/index.ts` and
`workers/austlii-scraper/wrangler.toml`.

1. Add a small error type just above `async function processJob(` (around the
   `// ─── Job Processor ───` banner at `index.ts:316`):
   ```ts
   /**
    * A scrape failure that is worth another delivery. The queue has
    * max_retries = 3 and a dead-letter queue, so retryable failures have a
    * bounded home; non-retryable ones (404, other 4xx) are recorded and acked.
    */
   class RetryableScrapeError extends Error {
     readonly statusCode: number;

     constructor(message: string, statusCode: number) {
       super(message);
       this.name = "RetryableScrapeError";
       this.statusCode = statusCode;
     }
   }
   ```
2. Rewrite the status handling inside `processJob` (currently `index.ts:333-356`)
   to this exact ordering — note 429 and 5xx now throw the typed error, 404 and
   other 4xx keep the record-and-ack path, and short content becomes retryable:
   ```ts
     if (response.status === 429) {
       throw new RetryableScrapeError(`Rate limited (429) for ${job.url}`, 429);
     }

     if (response.status === 404) {
       // Page not found — record as error, don't retry
       await putScrapeError(job, env, "Page not found", 404);
       return { success: false };
     }

     if (response.status >= 500) {
       // Upstream outage — retry rather than dropping the case for this run.
       throw new RetryableScrapeError(
         `HTTP ${response.status}: ${response.statusText} for ${job.url}`,
         response.status,
       );
     }

     if (!response.ok) {
       await putScrapeError(job, env, `HTTP ${response.status}: ${response.statusText}`, response.status);
       return { success: false };
     }

     const html = await response.text();

     // Extract full text
     const fullText = extractFullText(html);
     if (!fullText || fullText.length < 50) {
       // A truncated or challenge page is usually transient — retry it.
       throw new RetryableScrapeError(`No content extracted from ${job.url}`, 0);
     }
   ```
3. In the consumer catch block (`index.ts:227-238`), preserve the status code
   when the thrown error carries one. Replace `await putScrapeError(job, env, error, 0);`
   with:
   ```ts
         const statusCode = err instanceof RetryableScrapeError ? err.statusCode : 0;
         await putScrapeError(job, env, error, statusCode);
   ```
   (declare `statusCode` immediately after the existing
   `const error = err instanceof Error ? err.message : String(err);` line).
4. Harden `rateLimitPipelineScrape` (`index.ts:489-504`) so the "no previous
   value" case is explicit and a corrupt future timestamp cannot stall a
   consumer. Replace the body between the `const key = …` line and the final
   `await env.PIPELINE_KV.put(…)` with:
   ```ts
     const key = `ratelimit:${job.court_code}`;
     const raw = await env.PIPELINE_KV.get(key);
     const previous = raw === null ? Number.NaN : Number.parseInt(raw, 10);
     if (Number.isFinite(previous)) {
       // Clamp to one delay window so a corrupt/future timestamp cannot stall
       // the consumer. Correctness of the spacing depends on the scrape queue
       // running at max_concurrency = 1 — see workers/austlii-scraper/wrangler.toml.
       const waitMs = Math.min(previous + delayMs - Date.now(), delayMs);
       if (waitMs > 0) {
         await new Promise((resolve) => setTimeout(resolve, waitMs));
       }
     }
     await env.PIPELINE_KV.put(key, String(Date.now()), { expirationTtl: 60 });
   ```
   Delete the now-unused `const now = Date.now();` line.
5. In `workers/austlii-scraper/wrangler.toml`, change the `immi-scrape-queue`
   consumer block (lines 56–62) to:
   ```toml
   # max_concurrency MUST stay 1: the per-court AustLII spacing in
   # rateLimitPipelineScrape() is a KV read-modify-write and gives no real
   # spacing across parallel consumers. Raising this risks the multi-hour
   # AustLII IP block the delay exists to prevent.
   [[queues.consumers]]
   queue = "immi-scrape-queue"
   max_batch_size = 5
   max_batch_timeout = 30
   max_retries = 3
   dead_letter_queue = "immi-scrape-dlq"
   max_concurrency = 1
   ```
   Change nothing else in this file in this step.
6. Add three cases to `workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts`
   inside the existing `describe("pipeline scrape queue", …)`. Model them on the
   existing first test (same `env` object shape, same `worker.queue({ queue,
   messages: [{ body: job, ack, retry }] })` call). Use a `retry = vi.fn()` you
   can assert on, and a `puts` map to read back the error JSON:
   - `"retries a case when AustLII returns 5xx instead of dropping it"` —
     `vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503, statusText: "Service Unavailable" })))`;
     assert `retry` called once, `ack` **not** called, and that the value stored
     under `runs/<run>/FCA/<case>.error.json` parses to an object with
     `error_code: 503`.
   - `"records and acks a 404 without retrying"` — `status: 404`; assert `ack`
     called once and `retry` not called.
   - `"retries a page that yields too little text"` — return
     `new Response("<html><body>hi</body></html>", { status: 200 })`; assert
     `retry` called once and `ack` not called.
   The `env` for these tests needs `CASE_RESULTS.head` returning `null` and
   `CASE_RESULTS.put` capturing into a map, exactly like the existing test, and
   no `EXTRACT_QUEUE` is required for the failure paths.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ `TSC_OK`, then `Test Files  7 passed (7)` and `Tests  31 passed (31)`.

Then confirm the config change and that no gate broke:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "max_concurrency" workers/austlii-scraper/wrangler.toml && .venv/bin/python -m pytest tests/test_native_pipeline_boundary.py tests/test_effective_native_ci.py -q 2>&1 | tail -3
```
→ two `max_concurrency = 1` lines (scrape queue and extract queue), and
`7 passed`.

Commit: `fix: retry transient AustLII failures and serialise the scrape queue`

### Step 3: Make both cost caps real, fail closed, and distinguish "broke" from "spent"

Addresses JSCORR-14. All edits in `workers/austlii-scraper/src/extract.ts`,
`workers/austlii-scraper/src/types.ts` and the extract test file.

**Two things this step is NOT, stated up front so the commit message and your
report stay honest:**

1. **These are not hard caps.** The flow is still check → pay → charge. A batch
   that starts with `$0.01` of headroom may cost `$3`, and nothing can stop it
   once `callInternalExtract` is in flight. The bound this step actually
   delivers is: **overspend is limited to at most one batch beyond the ceiling,
   per ledger, per concurrent consumer** — and `immi-extract-queue` runs at
   `max_concurrency = 1` (`workers/austlii-scraper/wrangler.toml:76`), so that
   is one batch. Before this step, the overspend was unbounded because the
   charge never happened when staging threw. Call it "a bounded ceiling", never
   "a hard cap".
2. **The run and month ledgers are two separate Durable Objects**, so a check
   against both and a charge to both are not one atomic operation. A crash
   between the two `/charge` calls leaves the ledgers disagreeing. A true fix is
   a reservation/settlement protocol with a stable attempt id against a single
   coordinating ledger; that is a larger change to `CostCapDO` (which this plan
   holds out of scope because a new DO shape needs a `[[migrations]]` tag) and is
   recorded in "Maintenance notes".

What this step *does* fix, completely: the ceiling is no longer silently
disabled by a missing binding; the advertised monthly ceiling is actually read;
a malformed ledger body no longer resets the budget to full; and — new in this
revision — an *unreachable* ledger is no longer misreported as an *exhausted*
one.

1. `types.ts`: add one field to `Env`, directly after
   `PIPELINE_RUN_COST_CAP_USD?: string;` (line 97):
   ```ts
     PIPELINE_MONTHLY_HARD_CAP_USD?: string;
   ```
2. `extract.ts`: add two constants next to `DEFAULT_CONTAINER_TIMEOUT_MS`
   (line 18):
   ```ts
   const DEFAULT_RUN_COST_CAP_USD = 5;
   const DEFAULT_MONTHLY_COST_CAP_USD = 10;
   ```
3. `extract.ts`: add a binding guard in `handleRunExtractMessages`, immediately
   after the `EXTRACTION_SHARED_SECRET` guard (currently lines 45–48) and before
   the `NATIVE_CASE_QUEUE` guard. It matches the existing guard idiom exactly:
   ```ts
     if (!env.COST_CAP_DO) {
       retryAll(messages, "missing_cost_cap_do");
       await sendPipelineAlert(env, "cost cap binding missing", { run_id: runId });
       return;
     }
   ```
   This is the fail-closed replacement for `return Number.POSITIVE_INFINITY`: a
   missing binding is a configuration fault, so it retries into the DLQ where an
   operator can see it, rather than quietly disabling the ceiling.
4. `extract.ts`: replace `getRemainingCostUsd` and `chargeCostUsd`
   (lines 235–251) wholesale with the block below. The two structural changes
   against the first draft of this plan are: the budget check returns a
   **tri-state** (`available` / `exhausted` / `unavailable`) instead of a bare
   number, and the ledger names are computed **once** and passed to the charge,
   so a batch that straddles a UTC month boundary charges the same month it
   checked.
   ```ts
   /** Ledger names. `run:` is per pipeline run; `month:` accumulates across runs. */
   function costLedgerNames(runId: string, now: number = Date.now()): readonly [string, string] {
     return [`run:${runId}`, `month:${new Date(now).toISOString().slice(0, 7)}`] as const;
   }

   type LedgerState = "available" | "exhausted" | "unavailable";

   interface LedgerReading {
     state: LedgerState;
     remaining: number;
   }

   /**
    * Read one ledger. Three outcomes, deliberately distinct:
    *   available   — the ledger answered and has budget left
    *   exhausted   — the ledger answered and the budget is gone
    *   unavailable — the ledger did not answer, or answered with a body we
    *                 cannot trust
    * `unavailable` must NEVER be collapsed into `exhausted`: aborting a run and
    * acking its messages on an infrastructure blip destroys work that a retry
    * would have completed, and reports a false "budget spent" to the operator.
    */
   async function readLedger(env: Env, ledger: string, cap: number): Promise<LedgerReading> {
     if (!env.COST_CAP_DO) return { state: "unavailable", remaining: 0 };
     try {
       const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(ledger));
       const response = await stub.fetch(`https://cost/remaining?cap=${encodeURIComponent(String(cap))}`);
       if (!response.ok) throw new Error(`ledger responded ${response.status}`);
       const body = await response.json<{ remaining_usd?: number }>();
       const remaining = Number(body?.remaining_usd);
       if (!Number.isFinite(remaining) || remaining < 0) throw new Error("ledger returned a malformed remaining_usd");
       return { state: remaining > 0 ? "available" : "exhausted", remaining };
     } catch (err) {
       console.error(JSON.stringify({
         event: "extract.cost_cap.unavailable",
         ledger,
         error: err instanceof Error ? err.message : String(err),
       }));
       return { state: "unavailable", remaining: 0 };
     }
   }

   interface CostBudget {
     state: LedgerState;
     remaining: number;
     ledgers: readonly [string, string];
   }

   /**
    * Check both ceilings. `unavailable` wins over `exhausted` wins over
    * `available`, because the two failure modes need opposite handling and
    * "we do not know" must never be reported as "we are out of money".
    * The ledger names are returned so the caller charges exactly the ledgers it
    * checked, even if the batch crosses a UTC month boundary mid-flight.
    */
   async function checkCostBudget(env: Env, runId: string): Promise<CostBudget> {
     const ledgers = costLedgerNames(runId);
     const [runReading, monthReading] = await Promise.all([
       readLedger(env, ledgers[0], positiveNumber(env.PIPELINE_RUN_COST_CAP_USD, DEFAULT_RUN_COST_CAP_USD)),
       readLedger(env, ledgers[1], positiveNumber(env.PIPELINE_MONTHLY_HARD_CAP_USD, DEFAULT_MONTHLY_COST_CAP_USD)),
     ]);
     const readings = [runReading, monthReading];
     const state: LedgerState = readings.some((reading) => reading.state === "unavailable")
       ? "unavailable"
       : readings.some((reading) => reading.state === "exhausted")
         ? "exhausted"
         : "available";
     return { state, remaining: Math.min(runReading.remaining, monthReading.remaining), ledgers };
   }

   /**
    * Charge both ledgers. A charge failure is loud but never triggers a retry:
    * the money is already spent, so re-running the batch would spend more.
    * Takes the ledger names the caller checked, so the check and the charge
    * cannot land in different months.
    */
   async function chargeCostUsd(
     env: Env,
     ledgers: readonly [string, string],
     runId: string,
     usd: number,
   ): Promise<void> {
     if (!env.COST_CAP_DO || usd <= 0) return;
     for (const ledger of ledgers) {
       try {
         const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(ledger));
         const response = await stub.fetch("https://cost/charge", {
           method: "POST",
           body: JSON.stringify({ usd }),
         });
         if (!response.ok) throw new Error(`charge rejected with ${response.status}`);
       } catch (err) {
         console.error(JSON.stringify({
           event: "extract.cost_cap.charge_failed",
           ledger,
           run_id: runId,
           usd,
           error: err instanceof Error ? err.message : String(err),
         }));
         await sendPipelineAlert(env, "cost ledger charge failed", { run_id: runId, ledger, usd });
       }
     }
   }
   ```
5. `extract.ts`: replace the cap-hit block at lines 57–68 so the two failure
   modes are handled differently. **Do not leave it unchanged** — that is what
   turns a ledger outage into a false "budget exhausted, run aborted, messages
   acked, work lost":
   ```ts
     const budget = await checkCostBudget(env, runId);
     if (budget.state === "unavailable") {
       // A ledger we cannot read is an infrastructure fault, not a spent budget.
       // Retry (max_retries then DLQ) so the work survives and an operator sees it.
       retryAll(messages, "cost_ledger_unavailable");
       await sendPipelineAlert(env, "cost ledger unavailable", { run_id: runId });
       return;
     }
     if (budget.state === "exhausted") {
       await updatePipelineRun(env, runId, {
         status: "aborted",
         abortReason: "cost_cap_hit",
       }).catch(() => undefined);
       for (const message of messages) message.ack();
       console.warn(JSON.stringify({ event: "extract.aborted.cost_cap_hit", run_id: runId }));
       await sendPipelineAlert(env, "cost cap hit", { run_id: runId, remaining_usd: budget.remaining });
       return;
     }
   ```
   Then thread `budget.ledgers` through to the charge in Step 4:
   `await chargeCostUsd(env, budget.ledgers, runId, response.cost_usd);`
6. Delete the now-unused `getRemainingCostUsd`. With `noUnusedLocals` enabled in
   Step 1, leaving it behind fails `npx tsc --noEmit`, which is the check that
   catches this for you.
7. `wrangler.toml`: no change needed —
   `PIPELINE_MONTHLY_HARD_CAP_USD = "10"` on line 111 is now read by code.
8. Update `workers/austlii-scraper/src/__tests__/extract-native.test.ts`. The new
   binding guard means the existing `baseEnv()` (which has no `COST_CAP_DO`)
   would now retry instead of ack, so add a stub to `baseEnv` that also records
   what was charged. Add these locals inside `baseEnv` next to `nativeMessages`:
   ```ts
     const costCalls: Array<{ ledger: string; url: string; usd: number | null }> = [];
   ```
   add to the returned `env` object (before `...overrides`):
   ```ts
       COST_CAP_DO: {
         idFromName: (name: string) => name,
         get: (ledger: string) => ({
           fetch: vi.fn(async (input: string, init?: RequestInit) => {
             const usd = init?.body ? Number(JSON.parse(String(init.body)).usd) : null;
             costCalls.push({ ledger, url: input, usd });
             if (input.includes("/remaining")) return Response.json({ remaining_usd: 5 });
             return Response.json({ spent_usd: usd ?? 0 });
           }),
         }),
       },
   ```
   and add `costCalls` to the object `baseEnv` returns (alongside
   `nativeMessages` and `ack`). Then add **five** cases:
   - `"charges both the run and the month ledger"` — run the happy-path batch and
     assert `current.costCalls.filter((call) => call.url.includes("/charge")).map((call) => call.ledger)`
     equals `[\`run:${RUN_ID}\`, \`month:${new Date().toISOString().slice(0, 7)}\`]`.
   - `"aborts the run when a ledger reports zero remaining"` — override
     `COST_CAP_DO` so `/remaining` returns `Response.json({ remaining_usd: 0 })`;
     assert `updateRun` was called with
     `expect.objectContaining({ status: "aborted", abortReason: "cost_cap_hit" })`,
     that `EXTRACTION_BACKEND.fetch` was **not** called, and that `ack` was
     called once. (This is the *real* exhausted case.)
   - `"retries instead of aborting when a cost ledger returns a malformed body"` —
     override `COST_CAP_DO` so `/remaining` returns `Response.json({})`, with a
     `retry = vi.fn()`. Assert `retry` called once, `ack` **not** called,
     `EXTRACTION_BACKEND.fetch` **not** called, and `updateRun` **not** called
     with `abortReason: "cost_cap_hit"`. This is the tri-state fix: a ledger that
     cannot be trusted must not be reported as a spent budget, and the batch must
     survive. Against the first draft of this plan (which mapped malformed → 0 →
     `cost_cap_hit`) this test fails.
   - `"retries when the cost ledger throws"` — `COST_CAP_DO.get` returns a stub
     whose `fetch` rejects. Same assertions as the previous case.
   - `"fails closed when the cost cap binding is absent"` — `baseEnv({ COST_CAP_DO: undefined })`
     with a `retry = vi.fn()`; assert `retry` called once and
     `EXTRACTION_BACKEND.fetch` not called.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ `TSC_OK`, `Test Files  7 passed (7)`, `Tests  36 passed (36)`
(`BEFORE_SCRAPER + 3` from Step 2, `+ 5` here).

Then confirm the tri-state is genuinely wired, not just present in the file — a
grep for `"unavailable"` would also match the log-event string, so assert on
behaviour by name instead:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx vitest run src/__tests__/extract-native.test.ts -t "retries instead of aborting when a cost ledger returns a malformed body" 2>&1 | tail -4
```
→ `Tests 1 passed`.

Then prove the monthly cap is no longer dead config:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "PIPELINE_MONTHLY_HARD_CAP_USD" workers/austlii-scraper/
```
→ three lines: `wrangler.toml:111`, one in `src/types.ts`, one in
`src/extract.ts`.

Commit: `fix: enforce the run and monthly LLM cost caps and fail closed`

### Step 4: Charge before the enqueue and retry only the item that failed

Addresses JSCORR-08. All edits in `workers/austlii-scraper/src/extract.ts` and
its test file. Do this **after** step 3 — it depends on the `chargeCostUsd`
shape introduced there.

**The ack rule must be positive, not negative.** Acking "everything not in
`failedCaseIds`" silently destroys any input case the extraction backend did not
return. That is a live risk, not a theoretical one: `callInternalExtract`
validates only `Array.isArray(body.extracted)`
(`workers/austlii-scraper/src/extract.ts:159`), and `normalizeExtracted`
(`:269-275`) only defaults `fields`/`base` — **nothing checks that the returned
case ids match the ids that were sent**. A backend that drops one case from a
five-case batch, or returns a duplicate, or returns an id nobody asked for,
currently produces a batch where the dropped input is acked and lost forever.

So: ack an input **only if** exactly one output claimed it *and* that output
staged successfully. Everything else retries.

1. Add an outcome type next to the other local types in `extract.ts` (just above
   `async function enqueueNativeExtractedResults`):
   ```ts
   interface EnqueueOutcome {
     upserted: number;
     /** Input case ids that reached D1/R2/queue successfully. Ack ONLY these. */
     stagedCaseIds: Set<string>;
     failedCaseIds: Set<string>;
   }
   ```
2. Change `enqueueNativeExtractedResults` (lines 181–233) to return
   `Promise<EnqueueOutcome>` and wrap the per-item body in try/catch. Keep the
   existing body exactly as it is; only the signature, the loop wrapper and the
   return change:
   ```ts
   async function enqueueNativeExtractedResults(
     env: Env,
     runId: string,
     extracted: ExtractedCase[],
     inputCaseIds: ReadonlySet<string>,
   ): Promise<EnqueueOutcome> {
     if (!env.NATIVE_CASE_QUEUE) throw new Error("NATIVE_CASE_QUEUE is required for native extraction");
     let count = 0;
     const stagedCaseIds = new Set<string>();
     const failedCaseIds = new Set<string>();
     const seen = new Set<string>();
     for (const item of extracted) {
       // The backend is not trusted to echo the batch back faithfully. An id we
       // did not send, or a second copy of one we did, is a protocol violation:
       // log it and stage nothing, so the corresponding input (if any) stays
       // un-acked and is retried rather than being marked done by a stray row.
       if (!inputCaseIds.has(item.case_id) || seen.has(item.case_id)) {
         console.error(JSON.stringify({
           event: "extract.enqueue.unexpected_case",
           run_id: runId,
           case_id: item.case_id,
           reason: seen.has(item.case_id) ? "duplicate" : "not_in_batch",
         }));
         failedCaseIds.add(item.case_id);
         continue;
       }
       seen.add(item.case_id);
       try {
         // …existing body, unchanged, ending with:
         count += 1;
         stagedCaseIds.add(item.case_id);
       } catch (err) {
         failedCaseIds.add(item.case_id);
         console.error(JSON.stringify({
           event: "extract.enqueue.item_failed",
           run_id: runId,
           case_id: item.case_id,
           error: err instanceof Error ? err.message : String(err),
         }));
       }
     }
     // An input the backend never mentioned is the dangerous case: it is in
     // neither set, so a "not failed => ack" rule would drop it silently.
     for (const caseId of inputCaseIds) {
       if (!stagedCaseIds.has(caseId) && !failedCaseIds.has(caseId)) {
         console.error(JSON.stringify({
           event: "extract.enqueue.missing_case",
           run_id: runId,
           case_id: caseId,
         }));
       }
     }
     return { upserted: count, stagedCaseIds, failedCaseIds };
   }
   ```
   Build `inputCaseIds` at the call site from the messages, not from the
   response: `const inputCaseIds = new Set(messages.map((message) => message.body.case_id));`
3. Replace the block at `extract.ts:84-101` with this — cost first, enqueue
   guarded, per-item ack/retry:
   ```ts
     // Charge before any work that can fail. A throw between the paid container
     // call and this line would let the platform redeliver the whole batch and
     // re-bill the extraction against a ledger that never saw the first call.
     // `budget.ledgers` (Step 3) are the ledgers this batch was checked against,
     // so a batch that crosses a UTC month boundary charges the month it read.
     await chargeCostUsd(env, budget.ledgers, runId, response.cost_usd);

     const inputCaseIds = new Set(messages.map((message) => message.body.case_id));
     let outcome: EnqueueOutcome;
     try {
       outcome = await enqueueNativeExtractedResults(env, runId, response.extracted, inputCaseIds);
     } catch (err) {
       console.error(JSON.stringify({
         event: "extract.enqueue.batch_failed",
         run_id: runId,
         error: err instanceof Error ? err.message : String(err),
       }));
       retryAll(messages, "native_enqueue_failed");
       return;
     }

     await addPipelineRunMetrics(env, runId, {
       extracted: response.extracted.length,
       upserted: outcome.upserted,
       llmCalls: response.llm_calls,
       costUsd: response.cost_usd,
     }).catch(() => undefined);

     // Positive ack rule: a message is done ONLY if its case staged
     // successfully. Anything else — failed, dropped by the backend, or
     // returned twice — is retried. Re-publishing is idempotent
     // (stageNativeOutboxEvent returns "published" for an event already sent),
     // so a retry is cheap and cannot double-write.
     let retried = 0;
     for (const message of messages) {
       if (outcome.stagedCaseIds.has(message.body.case_id)) message.ack();
       else { message.retry(); retried += 1; }
     }
     console.log(JSON.stringify({
       event: "extract.batch.ok",
       run_id: runId,
       requested: messages.length,
       extracted: response.extracted.length,
       upserted: outcome.upserted,
       staged: outcome.stagedCaseIds.size,
       retried,
       llm_calls: response.llm_calls,
       cost_usd: response.cost_usd,
     }));
   ```
   `requested` and `staged` are new fields on an existing log event. They are the
   only way an operator can see a backend that is quietly returning fewer cases
   than it was given: `requested > staged + retried` is impossible by
   construction, but a persistently high `retried` with a low `extracted` means
   the backend is dropping cases and the DLQ is about to fill.
4. Add **five** cases to `extract-native.test.ts`:
   - `"charges the batch cost before staging results"` — make
     `NATIVE_CASE_QUEUE.send` reject (`vi.fn(async () => { throw new Error("queue down"); })`)
     and assert that `current.costCalls.some((call) => call.url.includes("/charge") && call.usd === 0.1)`
     is `true`.
   - `"retries only the case whose staging failed"` — build a two-message batch
     (`case_id` `"abcdef123456"` and `"abcdef654321"`) with an
     `EXTRACTION_BACKEND.fetch` that returns both cases, but make the second
     one's `base.full_text` an empty string and its `base.text_snippet`,
     `title` and `citation` empty too so the `Missing canonical text` throw at
     `extract.ts:192` fires for it only. Assert the first message's `ack` was
     called and its `retry` was not, and the second message's `retry` was called
     and its `ack` was not. (Give each message its own `ack`/`retry` spies.)
   - `"retries an input case the backend did not return"` — the partial-response
     regression guard. Two-message batch, but `EXTRACTION_BACKEND.fetch` returns
     `extracted` containing **only** the first case. Assert message 1 acked and
     message 2 **retried, not acked**. Against a `failedCaseIds`-only ack rule
     this test fails, because the missing case is in neither set.
   - `"ignores a case the backend returned that was not in the batch"` —
     single-message batch, backend returns that case plus a stray
     `case_id: "ffffffffffff"`. Assert the real message is acked, that
     `NATIVE_CASE_QUEUE.send` was called **once** (the stray was not staged), and
     that a `console.error` line parses as JSON with
     `event === "extract.enqueue.unexpected_case"` and `reason === "not_in_batch"`.
   - `"stages a duplicated case only once"` — single-message batch, backend
     returns the same case twice. Assert `NATIVE_CASE_QUEUE.send` called once and
     the message acked once.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ `TSC_OK`, `Test Files  7 passed (7)`, `Tests  41 passed (41)`.

Confirm the partial-response guard is real rather than incidentally passing:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx vitest run src/__tests__/extract-native.test.ts -t "retries an input case the backend did not return" 2>&1 | tail -4
```
→ `Tests 1 passed`, and none of `0 passed` / `No test files`.

Also confirm the ordering is right in the source:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && grep -n "chargeCostUsd(env, runId, response.cost_usd)\|enqueueNativeExtractedResults(env, runId, response.extracted)" src/extract.ts
```
→ the `chargeCostUsd` line number is **lower** than the
`enqueueNativeExtractedResults` line number.

Commit: `fix: charge extraction cost before staging and retry per item`

### Step 5: Make operator control commands idempotent

Addresses JSCORR-15. Edits in `workers/austlii-scraper/src/pipeline-db.ts`,
`workers/austlii-scraper/src/index.ts` and the control test file.

**Reading the command back is not sufficient on its own.** The sequence
`readControlCommand → startPipelineRun → updateControlCommand(runId)` still has a
crash window: if the process dies (or the Worker is evicted, or `sendBatch`
throws and the retry arrives) *after* the run row exists but *before* `run_id`
is written back to the command, the redelivery reads `run_id: null` and mints a
second run. Two concurrent deliveries of the same command hit the same window.

So the run id must be **derived from the command id**, not minted randomly, and
the insert must be idempotent. Then a redelivery converges on the same row
whether or not the write-back happened. The read-back stays as a fast path and
as the source of the `completed` short-circuit.

1. `pipeline-db.ts`: add a read helper immediately above
   `export async function updateControlCommand(` (line 112):
   ```ts
   export interface ControlCommandState {
     status: string;
     run_id: string | null;
   }

   /**
    * Read a control command's persisted state so a queue redelivery can reuse
    * the run it already started instead of forking a phantom one.
    */
   export async function readControlCommand(
     env: Env,
     commandId: string,
   ): Promise<ControlCommandState | null> {
     const row = await ops(env).prepare(
       "SELECT status, run_id FROM pipeline_control_commands WHERE command_id = ? LIMIT 1",
     ).bind(commandId).first<ControlCommandState>();
     return row ?? null;
   }
   ```
1b. `pipeline-db.ts`: make `startPipelineRun` able to take a caller-supplied,
   deterministic id and make the insert idempotent. `pipeline_runs.run_id` is
   `TEXT PRIMARY KEY` (`migrations/d1/ops/0001_ops.sql:4-22`), so
   `INSERT OR IGNORE` collapses a redelivery onto the row that already exists.
   Change the function (currently `workers/austlii-scraper/src/pipeline-db.ts:218-228`,
   whose body opens `const runId = crypto.randomUUID();`) to:
   ```ts
   export async function startPipelineRun(
     env: Env,
     options: {
       trigger: "cron" | "manual" | "webhook";
       courts: CourtCode[];
       phase: string;
       /**
        * Deterministic id for a run that must survive queue redelivery. Derived
        * from the control command id so a redelivery — including one that
        * crashed before the command row learned its run_id — converges on the
        * same pipeline_runs row instead of forking a phantom one.
        */
       runId?: string;
     },
   ): Promise<string> {
     const runId = options.runId ?? crypto.randomUUID();
     await ops(env).prepare(`
       INSERT OR IGNORE INTO pipeline_runs (run_id, trigger, court, phase, status, started_at)
       VALUES (?, ?, ?, ?, 'running', ?)
     `).bind(runId, options.trigger, options.courts.join(","), options.phase, new Date().toISOString()).run();
     return runId;
   }
   ```
   `INSERT OR IGNORE` changes cron behaviour not at all — a random UUID never
   collides — so this is safe for the existing callers that pass no `runId`.
1c. `pipeline-db.ts`: add the derivation helper next to it, so the same rule is
   used by every caller and is testable on its own:
   ```ts
   /** Stable pipeline-run id for a control command. Same command => same run. */
   export function controlRunId(commandId: string): string {
     return `cmd-${commandId}`;
   }
   ```
   A prefixed command id is used rather than a hash because `run_id` is a plain
   `TEXT` column with no format constraint anywhere in
   `migrations/d1/ops/0001_ops.sql`, and a readable id makes an operator's job
   easier when they are correlating a dashboard row with the command that caused
   it. Confirm before relying on it:
   `grep -rn "run_id" migrations/d1/ops/*.sql` — no CHECK constraint, no length
   limit.
2. `index.ts`: add `readControlCommand,` and `controlRunId,` to the existing
   `import { … } from "./pipeline-db";` list (lines 19–30), keeping it in the
   current alphabetical-ish order — put `readControlCommand` right after
   `latestRunningPipelineRun,`.
3. `index.ts`: in `handlePipelineControlBatch`, insert the claim between the
   `nativePipelineReady` check and the first `updateControlCommand` call
   (currently lines 97–98):
   ```ts
         if (!nativePipelineReady(env)) throw new Error("native pipeline is disabled");
         const prior = await readControlCommand(env, control.command_id);
         if (prior?.status === "completed") {
           console.log(JSON.stringify({
             event: "pipeline.control.duplicate_ignored",
             command_id: control.command_id,
             run_id: prior.run_id,
           }));
           message.ack();
           continue;
         }
         const priorRunId = prior?.run_id ?? null;
         await updateControlCommand(env, control.command_id, { status: "running" });
   ```
4. `index.ts`: in the two branches that mint a run, pass the deterministic id.
   `priorRunId` alone is not enough — it is `null` in exactly the crash window
   this step exists to close. In the `download` branch (line 104) replace
   ```ts
         const runId = await startPipelineRun(env, {
           trigger: "manual",
           courts: controlCourts(control.courts),
           phase: "download",
         });
   ```
   with
   ```ts
         // Deterministic id + INSERT OR IGNORE: a redelivery converges on the
         // same run row whether or not the previous attempt got as far as
         // writing run_id back onto the command. priorRunId is preferred when
         // present so a run started before this change is still honoured.
         const runId = priorRunId ?? await startPipelineRun(env, {
           trigger: "manual",
           courts: controlCourts(control.courts),
           phase: "download",
           runId: controlRunId(control.command_id),
         });
   ```
   and make the same change in the final `else` (discovery) branch at line 132,
   keeping that branch's own `trigger`/`phase` values. Leave the `stop` and
   `legislation_update` branches alone — neither starts a run.
5. `pipeline-control.test.ts`: the module mock is exhaustive, so add the new
   export or every control test breaks. Add to the `vi.hoisted` object
   (lines 3–13):
   ```ts
     readControlCommand: vi.fn(async () => null),
   ```
   add `readControlCommand: mocks.readControlCommand,` to the
   `vi.mock("../pipeline-db", …)` factory (lines 19–30), and add
   `mocks.readControlCommand.mockResolvedValue(null);` to the `beforeEach`.
   You must also add `controlRunId` to the same mock factory — but mock it with
   the **real** implementation (`controlRunId: (id: string) => \`cmd-${id}\``),
   not `vi.fn()`, because tests assert on the derived value.
   Then add **four** cases:
   - `"reuses the run a redelivered download command already started"` —
     `mocks.readControlCommand.mockResolvedValue({ status: "running", run_id: RUN_ID })`,
     dispatch the same `cmd-download` message; assert
     `mocks.startPipelineRun` was **not** called and that `sendBatch` still
     received jobs carrying `run_id: RUN_ID`.
   - `"acks a control command that already completed without redoing work"` —
     `mocks.readControlCommand.mockResolvedValue({ status: "completed", run_id: RUN_ID })`;
     assert `ack` called once, and `mocks.startPipelineRun`,
     `mocks.runDiscoveryAndEnqueue` and `mocks.updateControlCommand` were **not**
     called.
   - `"derives the same run id when the command row never learned it"` — the
     crash-window guard. Leave `mocks.readControlCommand` returning
     `{ status: "running", run_id: null }` (i.e. the previous attempt started a
     run but died before the write-back). Dispatch the `download` command
     **twice**. Assert `mocks.startPipelineRun` was called twice, and that
     **both** calls received `expect.objectContaining({ runId: \`cmd-${COMMAND_ID}\` })`
     — the same id — so `INSERT OR IGNORE` collapses them onto one row.
     Against the first draft of this plan (`priorRunId ?? startPipelineRun(...)`
     with a random UUID inside) the two calls carry no `runId` at all and this
     test fails.
   - `"passes the deterministic run id on a first delivery"` —
     `mocks.readControlCommand.mockResolvedValue(null)`; assert the single
     `startPipelineRun` call carries `runId: \`cmd-${COMMAND_ID}\``.

   The mocked `startPipelineRun` cannot prove `INSERT OR IGNORE` actually
   de-duplicates — it never touches D1. Prove that half separately, against real
   SQLite, so the claim is not resting on a mock:
   ```bash
   cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 - <<'PY'
   import sqlite3
   c = sqlite3.connect(":memory:")
   c.executescript(open("migrations/d1/ops/0001_ops.sql").read())
   for _ in range(2):
       c.execute("INSERT OR IGNORE INTO pipeline_runs (run_id, trigger, court, phase, status, started_at)"
                 " VALUES (?, 'manual', 'FCA', 'download', 'running', '2026-01-01T00:00:00Z')", ("cmd-abc",))
   print(c.execute("SELECT COUNT(*) FROM pipeline_runs").fetchone()[0])
   PY
   ```
   → prints `1`. If it prints `2`, `run_id` is not the primary key on this
   schema and the whole idempotency argument is wrong — STOP and report.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ `TSC_OK`, `Test Files  7 passed (7)`, `Tests  45 passed (45)`.

Commit: `fix: make pipeline control commands idempotent across redeliveries`

### Step 6: Report a partly-successful discovery run as ok

Addresses JSCORR-26. Edits in `workers/austlii-scraper/src/discover.ts` and its
test file.

**Do not infer success from `candidate_urls.length > 0 || errors.length === 0`.**
That heuristic is wrong in a case that occurs regularly in this corpus: a court
whose 2026 listing fetches and parses fine but legitimately contains **zero**
cases so far, while its 2025 listing 5xx's. `candidate_urls` is then empty and
`errors` is non-empty, so the court reads as unproductive — and if it is the only
court in the run, the run is marked `failed` even though discovery worked. The
`ARTA` court is exactly this shape early in a calendar year.

Record what actually happened per year instead. `discoverCourt`
(`workers/austlii-scraper/src/discover.ts:108-172`) already loops years with a
`try`/`catch` at `:122-135`, so both counters are one line each.

1. Extend `DiscoveryResult` (`workers/austlii-scraper/src/discover.ts:50-57`)
   with two counters. Both are required (not optional) so the compiler finds
   every construction site for you — there are three (`:155-162`, `:165-171`, and
   any early return you find on a fresh read):
   ```ts
   export interface DiscoveryResult {
     court: CourtCode;
     candidate_urls: string[];
     new_case_urls: string[];
     new_cases: DiscoveryCandidate[];
     skipped_reason?: "rate_anomaly" | "paused" | "court_disabled";
     errors: string[];
     /** Court-years this run tried to fetch. */
     attempted_years: number;
     /** Court-years whose listing fetched AND parsed without throwing. A year
      *  that parsed to zero cases counts as successful — an empty listing is a
      *  real answer, not a failure. */
     successful_years: number;
   }
   ```
2. In `discoverCourt`, track them across the year loop. Declare
   `let successfulYears = 0;` next to `const errors: string[] = [];` (line 118),
   add `successfulYears += 1;` as the last statement inside the `try` at
   `:123-129` (after the `for (const item of parsed)` loop, so a parse throw does
   not count), and put
   `attempted_years: years.length, successful_years: successfulYears` into every
   returned object — including the `skipped_reason: "rate_anomaly"` early return
   at `:155-162`, which has already done its fetching.
3. Replace the productivity test with one that reads those counters:
   ```ts
   /**
    * A court counts as productive when it was not skipped and at least one of
    * its court-years fetched and parsed. A year that parsed to zero cases is a
    * success: an empty listing is a real answer. A run is only "failed" when no
    * court in it was productive; a single transient court-year failure stays
    * visible in errors/errorsJson without zeroing the operator dashboard.
    */
   function courtWasProductive(result: DiscoveryResult): boolean {
     if (result.skipped_reason) return false;
     return result.successful_years > 0;
   }
   ```
4. In `runDiscoveryAndEnqueue`, add a counter next to `let discovered = 0;`
   (line 180):
   ```ts
     let productiveCourts = 0;
   ```
   and increment it right after `errors.push(...result.errors);` (line 190) —
   **before** the `if (result.skipped_reason) continue;` at `:192`, so a skipped
   court is still evaluated by `courtWasProductive` (which returns `false` for
   it) rather than being silently excluded:
   ```ts
     if (courtWasProductive(result)) productiveCourts += 1;
   ```
5. Replace the final `updatePipelineRun` call (lines 227–232) with:
   ```ts
     await updatePipelineRun(env, runId, {
       discovered,
       errors: errors.length,
       errorsJson: errors.length ? errors : undefined,
       status: courts.length === 0 || productiveCourts > 0 ? "ok" : "failed",
     });
   ```
6. `discover.test.ts`: the existing `vi.mock("../pipeline-db", …)` factory
   (lines 5–9) does **not** export `isPipelineStopRequested`, which
   `runDiscoveryAndEnqueue` imports. Add
   `isPipelineStopRequested: vi.fn(async () => false),` to that factory, and
   import `updatePipelineRun` from `../pipeline-db` in the test so you can
   assert on it (`import { updatePipelineRun } from "../pipeline-db";` — under
   `vi.mock` this resolves to the mock). Add `runDiscoveryAndEnqueue` to the
   `import … from "../discover";` line. Then add two cases in a new
   `describe("discovery run status", …)`:
   - `"reports ok when one court fails but another produced listings"` — stub
     global `fetch` so the `ARTA` listing URLs return a 200 page containing one
     `/au/cases/cth/ARTA/2026/12.html` anchor and every other URL returns
     `new Response("boom", { status: 500 })`; call
     `await runDiscoveryAndEnqueue(env, "run-partial", ["ARTA", "HCA"], Date.UTC(2026, 0, 1))`
     with an env carrying `PIPELINE_DISCOVERY_LOOKBACK_YEARS: "1"`,
     `PIPELINE_PER_COURT_RATE_LIMIT_MS: "0"` and
     `SCRAPE_QUEUE: { sendBatch: vi.fn(async () => undefined) }`; assert the last
     `updatePipelineRun` call matches
     `expect.objectContaining({ status: "ok" })` and that its `errors` value is
     greater than 0.
   - `"reports failed when every court errored"` — stub global `fetch` to always
     return `new Response("boom", { status: 500 })`; assert the last
     `updatePipelineRun` call matches
     `expect.objectContaining({ status: "failed" })`.
   - `"reports ok when one year is empty and another fails"` — the case the old
     `candidate_urls.length > 0` heuristic got wrong, and the reason this step
     was rewritten. One court (`ARTA`), `PIPELINE_DISCOVERY_LOOKBACK_YEARS: "2"`,
     and a `fetch` stub that returns a **valid listing page containing zero case
     anchors** for the newer year and `new Response("boom", { status: 500 })` for
     the older one. Assert the final `updatePipelineRun` patch matches
     `expect.objectContaining({ status: "ok" })` and that its `errors` is `1`.
     Against `candidate_urls.length > 0 || errors.length === 0` this test fails
     with `status: "failed"` — run it against the old helper once to confirm that
     before you move on.
   - `"counts a year that parses to zero cases as successful"` — call
     `discoverCourt(env, "ARTA", "run-x", Date.UTC(2026, 0, 1))` directly with a
     `fetch` stub returning an empty-but-valid listing for every year, and assert
     the returned `DiscoveryResult` has `successful_years === attempted_years`
     and `attempted_years > 0`. This pins the semantics of the new counters at
     their source, where the run-level test cannot see them.
   Use `vi.mocked(updatePipelineRun).mock.calls.at(-1)?.[2]` to read the patch
   argument, and `vi.clearAllMocks()` in a `beforeEach` so the cases do not
   see each other's calls.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -6
```
→ `TSC_OK`, `Test Files  7 passed (7)`, `Tests  49 passed (49)`
(`BEFORE_SCRAPER + 21`).

Commit: `fix: report a partly successful discovery run as ok`

### Step 7: Make the extraction container bridge loadable and its retry loop correct

Addresses JSCORR-13. Single file: `workers/extraction-container.js`.

1. Add the missing import as the first statement after the file's leading
   comment block, matching `workers/llm-council/session_do.js:9`:
   ```js
   import { DurableObject } from "cloudflare:workers";
   ```
2. Add named constants above the class:
   ```js
   const CONTAINER_PORT = 8080;
   const START_RETRY_DELAY_MS = 500;
   // 60 × 500ms = 30s of container boot budget. The caller's own ceiling is
   // PIPELINE_CONTAINER_EXTRACT_TIMEOUT_MS (300000) in the scraper Worker.
   const MAX_START_ATTEMPTS = 60;
   ```
3. Replace the whole `async fetch(request) { … }` method with a version that
   buffers the body **once** before the loop, so every attempt gets a fresh
   `Request` instead of reusing a consumed one:
   ```js
     async fetch(request) {
       const url = new URL(request.url);
       const containerUrl = `http://container${url.pathname}${url.search}`;
       const method = request.method;
       const headers = new Headers(request.headers);
       // Buffer once: `new Request(url, request)` disturbs the original body,
       // so a second attempt on a POST would throw "Body has already been used"
       // and be rethrown as an unrelated failure.
       const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
       let lastError;
       for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt += 1) {
         try {
           const port = this.ctx.container.getTcpPort(CONTAINER_PORT);
           return await port.fetch(new Request(containerUrl, { method, headers, body }));
         } catch (error) {
           lastError = error;
           const message = error?.message || "";
           if (!message.includes("not listening") && !message.includes("not running")) throw error;
           await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
         }
       }
       return Response.json({ error: "Extraction container unavailable", detail: lastError?.message || "timeout" }, { status: 503 });
     }
   ```
   Leave the constructor and its `blockConcurrencyWhile` container start
   untouched.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/extraction-container.js && echo SYNTAX_OK && grep -c 'import { DurableObject } from "cloudflare:workers";' workers/extraction-container.js && grep -c 'new Request(containerUrl, request)' workers/extraction-container.js
```
→ `SYNTAX_OK`, then `1`, then `0`.

Note: this file is deployed as a **separate** operator Worker
(`config/wrangler-extraction-container.toml.example`) and has no unit-test
harness in this repo, so the checks above are static only. Runtime confirmation
requires an operator deploy and is explicitly out of scope — say so in your
completion report.

Commit: `fix: load the extraction container bridge and reuse a buffered body`

### Step 8: Full regression sweep

No code changes. Run every gate and confirm nothing outside the scraper moved.

**Verify**:
```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit && npx vitest run 2>&1 | tail -6
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -4
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | tail -4
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat && git diff --cached --stat
```
→ scraper: `Test Files 7 passed (7)`, `Tests 49 passed (49)`, tsc silent;
main Worker: zero failures and a total ≥ `BEFORE_MAIN` (a sibling plan may have
landed tests while you worked; a total *below* `BEFORE_MAIN` is a STOP
condition); Python: failures only inside
`tests/test_backfill_judge_overrides_from_pdf.py`, still exactly the three
`pyexpat`/`pypdf` ImportErrors by name; the three git commands list only files
from the In-scope list plus whatever `/tmp/immi-011-dirty-before.txt` already
contained.

### Step 9: Write the activation runbook (no code — this is a deliverable)

Everything above is inert until an operator deploys it, and two of the changes
are actively unsafe to activate without ordering. Produce the runbook below as
part of your completion report. **Do not run any of it** — you have no
credentials and this plan explicitly forbids `wrangler deploy`.

The runbook must state, in this order:

1. **The `COST_CAP_DO` binding is now mandatory.** After Step 3, an extraction
   Worker deployed without it retries every batch into the DLQ with
   `missing_cost_cap_do`. `scripts/check_cloudflare_native_target.py`'s
   `_validate_pipeline` (lines 161–195) requires the D1/R2/KV/queue/`MYBROWSER`/
   `AI`/`EXTRACTION_BACKEND` bindings but **not** `COST_CAP_DO`, so a config
   missing it passes the deploy gate. That script is owned by another plan and is
   out of scope here, so this is a **manual pre-deploy check**, and it must be in
   the runbook as a blocking step:
   ```bash
   grep -A2 'COST_CAP_DO' <operator-wrangler.toml>   # must show a durable_objects binding
   grep -n 'PIPELINE_MONTHLY_HARD_CAP_USD' <operator-wrangler.toml>
   ```
   Also record the follow-up: add `COST_CAP_DO` and
   `PIPELINE_MONTHLY_HARD_CAP_USD` to `_validate_pipeline` so this stops being
   manual. Name it as a required change to that file's owning plan.
2. **Deploy the extraction Container Worker first, and smoke it.**
   `workers/extraction-container.js` could not even be evaluated before Step 7
   (`ReferenceError: DurableObject is not defined`), so its `/health` has never
   been observed to answer. It deploys separately, from
   `config/wrangler-extraction-container.toml.example`
   (`name = "immi-extraction"`, `main = "workers/extraction-container.js"`,
   `class_name = "ExtractionBackend"`). The smoke test must be:
   - an authenticated `GET /health` returning 200 — this is the first evidence
     that the `cloudflare:workers` import fix works at runtime, which
     `node --check` cannot tell you;
   - one bounded `POST /internal/extract` with a **single** case and a
     deliberately small budget, then read the `run:`/`month:` ledgers via the DO
     and confirm the charge landed on both;
   - a redelivery of that same message, confirming the outbox short-circuit
     (`stageNativeOutboxEvent` → `"published"`) means no second queue send and no
     second charge.
3. **Only then enable the pipeline**: flip `PIPELINE_ENABLED` /
   `NATIVE_PIPELINE_ENABLED` to `"true"` on the scraper Worker. The checked-in
   defaults stay `"false"`; `tests/test_native_pipeline_boundary.py:37-39`
   asserts that and must not be changed.
4. **Rollback**, stated concretely rather than as "revert": redeploy the previous
   Worker **version id** for both `immi-extraction` and the scraper
   (`wrangler deployments list` → `wrangler rollback <version-id>`), and set
   `PIPELINE_ENABLED="false"` first so no new batches start while the rollback
   runs. Note explicitly that a rollback does **not** unwind the ledgers: money
   already charged stays charged, and a `month:` ledger can be reset only with
   `POST https://cost/reset` to that DO.
5. **What to watch for the first run**, by log event name:
   `extract.cost_cap.unavailable` (ledger outage — expect retries, not aborts),
   `extract.cost_cap.charge_failed` (page-worthy: spend is being under-counted),
   `extract.enqueue.missing_case` / `extract.enqueue.unexpected_case` (the
   backend is not echoing the batch faithfully),
   `pipeline.control.duplicate_ignored` (idempotency working as intended).

**Verify**: the runbook exists in your completion report and names, for each of
the five points, the exact command or log event. There is nothing to execute
here — say so plainly rather than implying the deploy was validated.

## Test plan

All new tests go in the four existing scraper test files. Model every new case
on the file it lives in — those files already establish the harness shape
(`vi.hoisted` + `vi.mock` for `pipeline-db`, plain object literals cast with
`as unknown as Env`, `vi.stubGlobal("fetch", …)` for network).

`workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts` (+3, step 2) —
model after the existing `"writes pipeline scrape results under the run prefix
and forwards to extract"`:
1. AustLII `503` → `message.retry()` called, `ack` not called, stored
   `…​.error.json` carries `error_code: 503`.
2. AustLII `404` → `ack` called, `retry` not called (the non-retryable path must
   not regress).
3. 200 with a body under 50 characters → `retry` called, `ack` not called.

`workers/austlii-scraper/src/__tests__/extract-native.test.ts` (+10, steps 3–4) —
model after `"writes an R2 payload and sends only a pointer event to the
coordinator Queue"`:
4. Happy path charges both `run:<id>` and `month:<YYYY-MM>` ledgers, in that
   order.
5. `/remaining` returning `{ remaining_usd: 0 }` → run aborted with
   `abortReason: "cost_cap_hit"`, container never called, message acked.
6. `/remaining` returning `{}` (malformed) → **retried**, not aborted, container
   never called. The tri-state guard.
7. `/remaining` throwing → same as 6.
8. `COST_CAP_DO` absent → `retry` called, container never called.
9. Staging failure still charges the cost (`/charge` seen with `usd === 0.1`).
10. Two-message batch where only the second item throws `Missing canonical text`
    → first message acked, second message retried.
11. Backend returns only one of two input cases → the unreturned message is
    **retried**, not acked. The partial-response guard.
12. Backend returns a case id that was not in the batch → ignored, one queue
    send, `extract.enqueue.unexpected_case` logged.
13. Backend returns the same case twice → staged once, acked once.

`workers/austlii-scraper/src/__tests__/pipeline-control.test.ts` (+4, step 5) —
model after `"queues only catalog cases without a native content pointer for
download"`:
14. Redelivered `download` command whose row already carries a `run_id` reuses it
    (`startPipelineRun` not called, jobs still carry that `run_id`).
15. A command whose row is already `completed` is acked with no work at all.
16. Command row exists with `run_id: null` (the crash window) and is delivered
    twice → both `startPipelineRun` calls carry the same
    `runId: cmd-<command_id>`.
17. First delivery passes `runId: cmd-<command_id>`.

`workers/austlii-scraper/src/__tests__/discover.test.ts` (+4, step 6) — model
after `"uses Firecrawl as an opt-in listing fallback…"` for the `fetch` stub and
env shape:
18. One court's listings succeed, another's fail → final `updatePipelineRun`
    patch has `status: "ok"` and `errors > 0`.
19. Every court fails → final patch has `status: "failed"`.
20. One year parses to **zero cases** and another 5xx's → `status: "ok"`,
    `errors: 1`. The case the old heuristic got wrong.
21. `discoverCourt` with an empty-but-valid listing every year →
    `successful_years === attempted_years`, both > 0.

Two checks that no Vitest run can perform, and that are therefore specified as
explicit commands in their steps rather than left implied:

- **`INSERT OR IGNORE` really de-duplicates on this schema** — the mocked
  `startPipelineRun` never touches D1. Step 5 runs the two-insert probe against
  real SQLite loaded from `migrations/d1/ops/0001_ops.sql` and expects `1`.
- **The container bridge actually loads.** `node --check` proves the file
  parses, not that `import { DurableObject } from "cloudflare:workers"` resolves
  at runtime — that resolution only exists inside workerd. Step 9's runbook makes
  an authenticated `GET /health` against the deployed Worker the acceptance
  evidence, and the plan does not claim JSCORR-13 is verified until an operator
  reports it.

Final counts: the scraper suite goes from **28** to **49** tests across the same
7 files (`BEFORE_SCRAPER + 21`). The main Worker suite must have zero failures
and a total ≥ `BEFORE_MAIN`; `make test-py` must show no failure outside
`tests/test_backfill_judge_overrides_from_pdf.py`.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit` exits 0 with no output
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx tsc --noEmit --noUnusedLocals --noUnusedParameters` exits 0 with no output
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npx vitest run` reports `Test Files  7 passed (7)` and `Tests  49 passed (49)` (`BEFORE_SCRAPER + 21`)
- [ ] Each of the twenty-one new tests reports `Tests 1 passed` when run with `-t "<title>"` — none reports `0 passed` or `No test files`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` reports zero failures and a total **≥ `BEFORE_MAIN`** (this plan changes no main-Worker file; a higher total means a sibling plan landed, which is fine)
- [ ] `.venv/bin/python -m pytest tests/test_native_pipeline_boundary.py tests/test_effective_native_ci.py -q` reports `7 passed`
- [ ] `make test-py 2>&1 | grep -E '^(FAILED|ERROR)' | sort -u` lists nothing outside `tests/test_backfill_judge_overrides_from_pdf.py`, and what it lists there is still exactly the three `pypdf`/`pyexpat` ImportErrors, by name
- [ ] The `INSERT OR IGNORE` SQLite probe in Step 5 printed `1`
- [ ] `node --check workers/extraction-container.js` exits 0 — recorded as a **parse** check, not as evidence the bridge runs
- [ ] `grep -c 'import { DurableObject } from "cloudflare:workers";' workers/extraction-container.js` prints `1`
- [ ] `grep -c 'new Request(containerUrl, request)' workers/extraction-container.js` prints `0`
- [ ] `grep -rn "PIPELINE_MONTHLY_HARD_CAP_USD" workers/austlii-scraper/` returns exactly 3 lines (`wrangler.toml`, `src/types.ts`, `src/extract.ts`)
- [ ] `grep -n "max_concurrency" workers/austlii-scraper/wrangler.toml` shows no value greater than `1`
- [ ] `grep -c "Number.POSITIVE_INFINITY" workers/austlii-scraper/src/extract.ts` prints `0`
- [ ] `grep -c "getRemainingCostUsd" workers/austlii-scraper/src/extract.ts` prints `0` (replaced by `checkCostBudget`)
- [ ] `grep -c "successful_years" workers/austlii-scraper/src/discover.ts` is ≥ `4` (the interface field, the increment, and one per construction site)
- [ ] `grep -c "controlRunId" workers/austlii-scraper/src/index.ts` prints `3` (the import plus both run-starting branches)
- [ ] The Step 9 activation runbook is written out in the completion report, and the report states plainly that no deploy or runtime verification was performed
- [ ] `grep -n "chunkArray\|parseCourtList\|parseScheduledTime\|MAX_BATCH_ENQUEUE\|EnqueueRequest\|EnqueueResponse" workers/austlii-scraper/src/index.ts workers/austlii-scraper/src/types.ts` returns no matches
- [ ] `grep -c "extractFullText(html)" workers/austlii-scraper/src/index.ts` prints `1`
- [ ] `grep -n 'PIPELINE_ENABLED = "false"' workers/austlii-scraper/wrangler.toml` still matches (fail-closed default preserved)
- [ ] `grep -rniE "postgres|hyperdrive|supabase" workers/austlii-scraper/src/ workers/extraction-container.js` returns no matches
- [ ] `git status --short` lists only files from the In-scope list
- [ ] `plans/README.md` row updated **only if that file already exists** (do not create it)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows any in-scope file changed since `42826a3`, or a
  "Current state" excerpt does not match the live code — in particular
  `extract.ts:84-85` (the `enqueueNativeExtractedResults` / `chargeCostUsd`
  ordering), `extract.ts:236` (`return Number.POSITIVE_INFINITY`),
  `index.ts:344` (`if (!response.ok)`), `wrangler.toml:62`
  (`max_concurrency = 20`) or `wrangler.toml:111`
  (`PIPELINE_MONTHLY_HARD_CAP_USD = "10"`).
- `cd workers && npx vitest run` drops **below `BEFORE_MAIN`**, or reports any
  failure. This plan must not change the main production Worker at all; a drop
  means you edited an out-of-scope file. A *rise* is expected while sibling
  plans land and is not a problem — do not "correct" it.
- `make test-py` shows any failure other than the three known
  `tests/test_backfill_judge_overrides_from_pdf.py` `pypdf`/`pyexpat` import
  errors. In particular `tests/test_native_pipeline_boundary.py` or
  `tests/test_effective_native_ci.py` failing means your `wrangler.toml` edit
  broke a deploy gate — revert that edit and report.
- Enabling `noUnusedLocals` in step 1 surfaces an unused symbol that is **not**
  one of the eight listed in "Current state". That means the tree drifted;
  report the extra symbol rather than deleting something this plan did not
  authorise.
- Step 3's fail-closed guard makes more than the named `extract-native`
  tests fail. Only `baseEnv()`-based tests should need the new `COST_CAP_DO`
  stub; broader breakage means the guard landed in the wrong place.
- The `INSERT OR IGNORE` probe in Step 5 prints `2` instead of `1`. That means
  `pipeline_runs.run_id` is not a primary key on the live schema and the whole
  deterministic-id argument collapses — report it, do not work around it.
- Extending `DiscoveryResult` with two required fields in Step 6 surfaces more
  than three construction sites. This plan located three
  (`discover.ts:155-162`, `:165-171`, and the year loop's own return); a fourth
  means the file drifted and you should re-read it before adding counters that
  might be wrong for that path.
- Step 5's `readControlCommand` import makes control tests throw
  `readControlCommand is not a function` — that means a `vi.mock` factory is
  missing the new export. Fix the mock; do not remove the import.
- You find yourself wanting to change `workers/pipeline/cloudflare_handlers.js`,
  `scripts/check_cloudflare_native_target.py`, `wrangler.toml`'s
  `PIPELINE_ENABLED`/`NATIVE_PIPELINE_ENABLED` values, or the placeholder
  resource IDs. All four are deliberate; the fix does not require them.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this Worker next:

- **The monthly ledger never resets by code.** It is a `CostCapDO` addressed by
  `month:YYYY-MM`, so a new calendar month is a fresh Durable Object with zero
  spend. If a month is exhausted early and the operator needs to raise it, the
  levers are `PIPELINE_MONTHLY_HARD_CAP_USD` in `wrangler.toml` or a
  `POST https://cost/reset` to that DO. There is no admin route for it — add one
  deliberately if the operator asks; do not weaken the fail-closed reads.
- **The ceilings are bounded, not hard.** Check → pay → charge means a batch can
  still exceed a ceiling by its own cost. With `immi-extract-queue` at
  `max_concurrency = 1` the overspend is bounded to one batch per ledger. The
  design that would make it a true hard cap: a *reservation* protocol — the
  consumer POSTs `/reserve {attempt_id, usd_estimate}` to a single coordinating
  ledger that holds run and month budgets together, the DO either grants or
  refuses atomically, the consumer does the paid call, then POSTs
  `/settle {attempt_id, usd_actual}`; an unsettled reservation expires. The
  stable `attempt_id` also lets a redelivery reuse the earlier reservation
  instead of double-reserving, and caching the paid result against that id would
  remove the re-billing risk entirely. That needs a new `CostCapDO` shape and
  therefore a new `[[migrations]]` tag, which is why it is not in this plan.
- **The run and month ledgers are not updated atomically.** They are two DOs. A
  crash between the two `/charge` calls leaves them disagreeing, always in the
  direction of the month ledger under-counting. `extract.cost_cap.charge_failed`
  is the signal; the single-coordinating-ledger design above is the fix.
- **`COST_CAP_DO` is now required for extraction to run at all.** The deploy
  gate `scripts/check_cloudflare_native_target.py:_validate_pipeline`
  (lines 161–195) still does **not** require the binding, so a config missing it
  deploys clean and every extract batch DLQs with `missing_cost_cap_do`. Adding
  `COST_CAP_DO` **and** `PIPELINE_MONTHLY_HARD_CAP_USD` to that gate is a
  required follow-up on the plan that owns that file; until it lands, the manual
  pre-deploy grep in Step 9's runbook is the only thing standing between an
  operator and a fully DLQ'd pipeline.
- **`workers/extraction-container.js` has no test harness in this repo and is
  deployed as a separate Worker.** Step 7's fix is verified statically only.
  JSCORR-13 is not closed until an operator reports a 200 from the deployed
  bridge's `/health`; say so rather than implying otherwise.
- **A charge failure is logged and alerted but never retried.** That is a
  deliberate trade: the LLM money is already spent when `chargeCostUsd` runs, so
  retrying would spend more. The consequence is that a persistently broken
  ledger under-counts spend — watch for `extract.cost_cap.charge_failed` in
  Logpush and treat it as a page, not a warning.
- **`max_concurrency = 1` on `immi-scrape-queue` is load-bearing.** The KV token
  bucket in `rateLimitPipelineScrape` gives no real spacing across parallel
  consumers. If throughput ever needs to go up, move the bucket into a per-court
  Durable Object first (the `CostCapDO` pattern in
  `workers/austlii-scraper/src/cost-cap-do.ts` is the template — note a new DO
  class needs a new `[[migrations]]` tag in `wrangler.toml`), then raise
  concurrency and verify by logging inter-request deltas per court across one
  real run.
- **Retryable scrape failures now increment the run's `errors` counter once per
  delivery**, so a case that fails four times contributes 4. That was already
  true for `429`s; it is now true for `5xx` and short pages too. If the operator
  dashboard's error count starts reading high, de-duplicating by `case_id`
  before `addPipelineRunMetrics` is the fix — explicitly deferred here to keep
  this plan's blast radius small.
- **What a reviewer should scrutinise**: (a) that `chargeCostUsd` really is
  called before `enqueueNativeExtractedResults` in `extract.ts` and nothing was
  reordered back, and that it receives `budget.ledgers` rather than recomputing
  the month; (b) that `readLedger` returns `unavailable` — never `exhausted` —
  for every non-answer, and that the caller retries on `unavailable`; (c) that
  `processJob`'s 404 branch still records-and-acks rather than joining the retry
  path; (d) that the ack rule in step 4 is **positive**
  (`stagedCaseIds.has(...)` → ack, everything else → retry) and has not been
  flipped back to "not in `failedCaseIds`"; (e) that `courtWasProductive` reads
  `successful_years` and not `candidate_urls.length`.
- **Explicitly deferred**: making `extractMetadata` read whole-page text (the
  wrong comment at `index.ts:358` claimed it already did). Step 1 fixes the
  comment to match reality rather than changing extraction behaviour — a real
  change there would need fill-rate validation against a sample of known cases
  before and after, which is a separate piece of work.

## Findings reconsidered

- **JSCORR-19's stated impact was wrong and has been narrowed, not dropped.**
  The duplicate parse is real (`index.ts:352` and `:359` are byte-identical
  calls) and step 1 removes it. But `extractMetadata` returns only
  `judges, date, catchwords, outcome, visa_type, legislation,
  citation_extracted` (`parser.ts:11-20`) — it never produces
  `country_of_origin`, `is_represented` or `representative`, so it cannot be a
  contributor to the fill rates quoted in `CLAUDE.md`; those come from the Python
  `extract_structured_fields.py` path. The finding is therefore treated as a
  cosmetic cleanup plus a comment correction, not a data-quality fix, and the
  "make metadata read whole-page text" option is deferred (see Maintenance
  notes).
- **JSCORR-10's "permanently dropped" framing was corrected to "dropped for this
  run".** `putScrapeError` writes to `errorJsonKey` (`…​.error.json`,
  `index.ts:421-424`), not to the `resultJsonKey` the resume check at
  `index.ts:213` `head()`s, so a later discovery or download run re-scrapes the
  case. The fix still lands — losing the case for the current run is a real
  defect — but the severity is per-run, not permanent.
- **JSCORR-13's "broken decoy, consider deleting" option was rejected.**
  `config/wrangler-extraction-container.toml.example:4` really does set
  `main = "workers/extraction-container.js"` with a matching
  `class_name = "ExtractionBackend"`, so this file is the intended source of the
  operator-deployed container Worker. Deleting it would remove a live
  entrypoint; step 7 fixes it instead. The report's "120 × 500 ms = 60 s of
  blocking retries" claim was also wrong — `new Request(containerUrl, request)`
  disturbs the body, so attempt 2 throws `Body has already been used`, which
  matches neither retry substring and is rethrown at line 39. The retry-budget
  reduction is kept anyway, as defence for the GET/bodyless case.
- **Two cited line numbers were off by one and are corrected in this plan.**
  `PIPELINE_MONTHLY_HARD_CAP_USD` is `wrangler.toml:111`, not `:110` (line 110 is
  `PIPELINE_RUN_COST_CAP_USD`). `max_concurrency = 20` is `wrangler.toml:62`, not
  `:61` (line 61 is `dead_letter_queue`).
- **JSCORR-09's "move the bucket into a per-court Durable Object" option was
  deferred in favour of `max_concurrency = 1`.** A new DO class requires a new
  `[[migrations]]` tag and an operator deploy step, and the biweekly cron
  pipeline with a `$5`/run ceiling is not throughput-bound. Serialising the
  consumer makes the existing bucket correct today, at a throughput cost the
  workload can absorb. The DO route is recorded in Maintenance notes as the
  upgrade path if throughput ever becomes the constraint.
- **JSCORR-14's "or delete the unused var" option was rejected.** The `$10`
  monthly ceiling is a safety property the operator config advertises; deleting
  it would resolve the inconsistency in the wrong direction. Step 3 implements
  it against the existing `CostCapDO` with a `month:YYYY-MM` id, which needs no
  change to the DO itself.
