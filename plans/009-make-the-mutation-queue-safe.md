# Plan 009: Per-message acks, dead-lettering and atomic aggregate rebuilds

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists; if it does not exist, do **not** create
> it (a reviewer maintains the index).
>
> **Drift check (run first)**:
> ```
> git diff --stat 42826a3..HEAD -- workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-storage-contracts.test.js
> ```
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> Note: `plans/008-add-security-response-headers.md` also edits
> `workers/cloudflare-native.js`, but only inside its `fetch()` / asset-response
> path. If 008 has already landed you will see a security-header helper in that
> file — that is expected and is **not** drift. The queue functions quoted below
> must still match verbatim.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-*.md` (the verification-gate plan — this plan's
  Done criteria lean on `cd workers && npx vitest run` and `make test-py`, and
  those gates must be trustworthy first). If `plans/001-*.md` does not exist in
  this repo, proceed anyway: every command in this plan is self-contained and
  its expected output is stated below.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`https://immi.trackit.today` is served by a single Cloudflare Worker, and every
durable write to the case catalog lands through one queue consumer,
`handleCaseMutationQueue` in `workers/cloudflare-native.js`. That consumer has
three defects that all bite the same production surface:

1. **A message with an unrecognised `kind` is acknowledged and destroyed** with
   no log line and no dead-letter hop. A producer/consumer version skew, or a
   `case.reindex` event carrying a non-string `case_id`, silently vanishes. The
   case never gets embedded, and months later `/api/v1/cases/:id/similar`
   returns nothing with zero evidence anywhere of why.
2. **One failing message forces the entire batch back through the consumer**
   (`max_batch_size = 20`), because the whole loop sits inside one `try` and the
   `catch` calls `retry()` on all twenty messages.
3. **`rebuildAggregates()` truncates 17 analytics tables in its first D1 batch
   and repopulates them across the next two.** D1 is transactional per
   `batch()` call only, so a failure after batch 1 commits the `DELETE`s and
   leaves the analytics tables *empty*. `/api/v1/analytics/*` then serves zeros
   behind `Cache-Control: public, max-age=600`, and `/api/v1/stats` +
   `/api/v1/filter-options` serve zeros behind `max-age=300`, until a retry
   attempt succeeds — or permanently once the batch exhausts `max_retries = 5`
   and dead-letters.

The primary user of this product is a self-representing immigration applicant
reading tribunal statistics to decide how to argue their own case. A dashboard
that confidently reports zero cases is worse than one that is briefly slow.

After this plan: each message acks, retries or dead-letters on its own merits;
an unknown `kind` is logged and reaches `immi-case-mutation-dlq`; a failed
aggregate rebuild leaves the previous (stale but truthful) numbers in place; and
a case import can no longer be observed with zero full-text search chunks.

## Current state

### Files

- `workers/cloudflare-native.js` — the production Worker entrypoint. Its
  `queue()` export (lines 192–198) routes `immi-case-mutation-dlq` batches to
  `handleDeadLetterQueue` and everything else to `handleCaseMutationQueue`
  (lines 104–129). This is the file to fix for findings 1 and 2.
- `workers/storage/cloudflare.js` — the D1 + R2 + Vectorize access layer.
  Contains `rebuildAggregates()` (line 990), `updateCaseFields()` (line 878) and
  `putImportedCase()` (line 1144).
- `workers/__tests__/cloudflare-native-queue.test.js` — the only test file for
  the queue consumer. 6 tests, every one of them a single-message batch.
- `workers/__tests__/cloudflare-storage-contracts.test.js` — **read-only for
  this plan**, but one of its assertions constrains your Step 3 edit; see the
  warning below.
- `wrangler.toml` lines 72–83 — the queue consumer config, quoted below.

### The queue consumer as it exists today

`workers/cloudflare-native.js:104-129` (verbatim):

```js
async function handleCaseMutationQueue(batch, env) {
  const messages = batch?.messages || [];
  const stores = createCloudflareStores(env);
  try {
    let changed = false;
    for (const message of messages) {
      if (await processCaseExtracted(message, env)) {
        changed = true;
      } else if (await processCaseReindex(message, stores)) {
        changed = true;
      } else if (await processCaseSourceDelete(message, stores)) {
        changed = true;
      } else if (await processAggregateRebuild(message)) {
        changed = true;
      }
    }
    if (changed) await stores.caseStore.rebuildAggregates();
    for (const message of messages) if (typeof message?.ack === "function") message.ack();
  } catch (error) {
    console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
    for (const message of messages) {
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
      else throw error;
    }
  }
}
```

There is no terminal `else` branch: a message whose `kind` matches none of the
four processors leaves `changed` untouched and falls straight through to the
unconditional `ack()` on line 121.

Each processor returns `false` on a shape mismatch. `workers/cloudflare-native.js:34-38`
(verbatim) — note that a **non-string `case_id`** takes the same silent exit as
a wrong `kind`:

```js
async function processCaseReindex(message, stores) {
  const event = message?.body;
  if (!event || event.kind !== "case.reindex" || typeof event.case_id !== "string") {
    return false;
  }
```

The four recognised kinds are `case.extracted` (line 84), `case.reindex`
(line 36), `case.source.delete` (line 72) and `catalog.rebuild` (line 66).

### The dead-letter consumer (do not change its behaviour)

`workers/cloudflare-native.js:151-156` (verbatim) — already per-message, already
correct; it is only missing a test:

```js
      if (typeof message?.ack === "function") message.ack();
    } catch (error) {
      console.error(JSON.stringify({ event: "cloudflare.dlq_record_error", error: error?.message }));
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
      else throw error;
    }
```

### Queue configuration

`wrangler.toml:72-83` (verbatim):

```toml
[[queues.consumers]]
queue = "immi-case-mutation-queue"
max_batch_size = 20
max_batch_timeout = 5
max_retries = 5
dead_letter_queue = "immi-case-mutation-dlq"

[[queues.consumers]]
queue = "immi-case-mutation-dlq"
max_batch_size = 20
max_batch_timeout = 5
max_retries = 3
```

A dead-letter queue **exists**. Today's silent-ack path is the only route by
which a message can be lost without reaching it.

### The non-atomic aggregate rebuild

`workers/storage/cloudflare.js:985-999` (verbatim):

```js
  /**
   * Rebuild queue-maintained analytics outside the request path. A mutation
   * queue batch calls this once after its D1/R2/Vectorize work, so dashboard
   * reads remain aggregate-only and never scan the corpus.
   */
  async rebuildAggregates() {
    const now = utcNow();
    const statements = [];
    for (const table of [
      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
```

…then 24 `INSERT` statements are pushed (17 in the `statements.push(...)` call
spanning lines 1000–1059, plus 7 built by the `filter_options` loop at lines
1060–1064), and finally `workers/storage/cloudflare.js:1065-1066` (verbatim):

```js
    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
    return { rebuilt_at: now };
```

41 statements, chunked 20 at a time → 3 D1 batches. **All 17 `DELETE`s land in
batch 1.** D1 wraps each `batch()` call in one implicit transaction and nothing
wider — the codebase already relies on exactly that property in `deleteCase()`
(`workers/storage/cloudflare.js:938-943`, a 4-statement all-or-nothing delete).
So a failure in batch 2 or 3 commits the truncation and leaves analytics empty.

### The non-atomic case writes

`workers/storage/cloudflare.js:900-908` — the case row is written on its own…

```js
    const now = utcNow();
    assignments.push("semantic_ready = 0", "vector_mutation_id = NULL", "updated_at = ?");
    params.push(now, id);
    const result = await this.db.prepare(`
      UPDATE cases SET ${assignments.join(", ")} WHERE case_id = ?
    `).bind(...params).run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
```

…and its judges/concepts in a *second*, separate transaction 24 lines later,
`workers/storage/cloudflare.js:932-933`:

```js
    if (relationStatements.length) await this.db.batch(relationStatements);
    return this.getCase(id);
```

`putImportedCase` is worse — `workers/storage/cloudflare.js:1269-1282` (verbatim):

```js
    await this.db.batch(judgeStatements);
    await this.db.batch(conceptStatements);
    // A repeatable import must remove stale tail chunks before adding the new
    // canonical text. The FTS delete trigger keeps case_text_fts in lockstep.
    await this.db.prepare(`DELETE FROM case_text_chunks WHERE case_id = ?`).bind(caseId).run();
    for (let offset = 0; offset < chunks.length; offset += 20) {
      const batch = chunks.slice(offset, offset + 20).map((chunk, index) => bindAll(this.db, `
        INSERT INTO case_text_chunks (case_id, chunk_index, content, content_sha256, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_id, chunk_index) DO UPDATE SET
          content=excluded.content, content_sha256=excluded.content_sha256, created_at=excluded.created_at
      `, [caseId, offset + index, chunk.content, chunk.sha256, now]));
      await this.db.batch(batch);
    }
  }
```

Line 1273 commits a delete of **every** full-text chunk for the case before any
replacement exists. Between that commit and the first insert batch, the case is
live in D1 with zero FTS chunks.

### ⚠️ Constraint you must respect in Step 3

`workers/__tests__/cloudflare-storage-contracts.test.js:202-203` (verbatim) is
**out of scope — do not edit it**, and it pins the SQL text and bound params of
that chunk delete:

```js
    const staleChunks = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("DELETE FROM case_text_chunks"));
    expect(staleChunks.params).toEqual(["0123456789ab"]);
```

So the fix must keep the statement as `DELETE FROM case_text_chunks WHERE
case_id = ?` bound with the case id alone. Do **not** change it to a tail-only
delete with an extra bound parameter — move *when* it commits, not what it says.

### Conventions this plan must match

- **Structured logs** (`CLAUDE.md`): "mutation and auth handlers
  `console.log(JSON.stringify({event, ...}))`; pipe to Cloudflare Logpush". Every
  log line you add is a single `console.error(JSON.stringify({ event: "...", ... }))`
  with a dotted event name — match `cloudflare.dlq_record_error` on line 153.
- **D1, not Postgres** (`CLAUDE.md`): "`env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB`
  / `IMMI_OPS_DB` are D1 bindings, not Postgres connections — there is no
  per-request client to construct and no Hyperdrive pooler in this stack."
  Tenant isolation is app-layer via `CloudflareIdentityStore.assertMembership()`;
  there is no RLS backstop.
- **Storage-boundary test** (`workers/__tests__/cloudflare-storage-contracts.test.js:94-100`):
  no file outside `workers/storage/` may reference `env.IMMI_CATALOG_DB`,
  `env.IMMI_ACCOUNT_DB`, `env.IMMI_OPS_DB`, `env.IMMI_CONTENT`,
  `env.CASE_VECTORS` or `env.AI`. Your `cloudflare-native.js` edits must not
  touch those bindings directly — go through `stores` as the current code does.
- **Forbidden markers**: `scripts/check_native_effective_references.py` scans
  `workers/cloudflare-native.js` (comments stripped) and fails on any live
  reference matching `supabase`, `postgres`, `pgvector` or `hyperdrive`. Do not
  introduce those words.
- **No magic numbers**: the literal `20` appears three times in
  `workers/storage/cloudflare.js` (lines 1065, 1274, and the same chunking idea
  again). Step 2 introduces one named constant for it.
- **Immutability / no in-place mutation** is the house style; build new arrays
  rather than splicing existing ones.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker unit tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0; **baseline before this plan: 25 files, 345 passed** |
| One worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-queue.test.js` | exit 0, all pass |
| Worker bundle closure | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` | exit 0, prints `Cloudflare-native bundle closure passed (…bytes)` |
| Native boundary gates | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_native_effective_references.py tests/test_native_pipeline_boundary.py -q` | `6 passed` |
| Full Python suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | `1141 passed, 3 failed, 7 skipped` — the 3 failures are pre-existing and environmental (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`). They are **not** yours; the count must not get worse. |
| Python lint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` | `All checks passed!` |
| Scope check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the four in-scope paths listed below |

There is no ESLint/tsc gate for `workers/` — `make lint` is Ruff over Python
only, and `make typecheck` is the frontend. The bundle-closure script is your
syntax gate for the Worker.

## Scope

**In scope** (the only files you may modify or create):

- `workers/cloudflare-native.js` — the queue consumer functions only.
- `workers/storage/cloudflare.js` — `rebuildAggregates()`, `updateCaseFields()`,
  `putImportedCase()`, plus one new module-level constant.
- `workers/__tests__/cloudflare-native-queue.test.js` — add tests.
- `workers/__tests__/cloudflare-storage-atomicity.test.js` — **create**.

**Out of scope** (do NOT touch, even though they look related):

- `workers/__tests__/cloudflare-storage-contracts.test.js` — its assertion at
  lines 202–203 is a *constraint on your fix*, not something to relax.
- `wrangler.toml` — `max_retries = 5` and the DLQ wiring are already correct,
  and the placeholder resource IDs in this file are deliberate (real IDs are
  operator-supplied secrets injected only inside the gated `workflow_dispatch`
  of `.github/workflows/deploy-worker.yml`). Changing them would defeat a
  fail-closed design.
- `workers/case-api/cloudflare_mutations.js` — the HTTP mutation path. It is
  fail-closed in production (`IMMI_CASE_MUTATIONS_ENABLED` defaults to `"false"`
  in the checked-in `wrangler.toml`), and this plan deliberately does not add a
  compensating-cleanup path there; see "Maintenance notes".
- `workers/storage/pipeline_coordinator.js` — its idempotency claim
  (`claimEvent` + `isEventComplete`, lines 120–127) is what makes a replayed
  `case.extracted` cheap. Leave it exactly as is.
- `workers/storage/contracts.js` — no new shared constant there; keep the batch
  limit module-local to `storage/cloudflare.js`.
- `workers/austlii-scraper/**` — a separate, cron-only Worker.
- Anything under `immi_case_downloader/` — the Flask app is local-dev only and
  is not in the production request path.

## Git workflow

- Branch: `git checkout -b advisor/009-make-the-mutation-queue-safe` from `main`.
- One commit per step is fine; suggested messages:
  - Step 1 → `fix: ack, retry and dead-letter queue messages individually`
  - Step 2 → `fix: rebuild each aggregate table inside one D1 transaction`
  - Step 3 → `fix: write a case row and its relations in one transaction`
  - Step 4 → `test: cover poison, unknown-kind and DLQ queue paths`
  - Step 5 → `test: pin D1 batch grouping for aggregate and case writes`
- Commit type prefixes are `feat|fix|refactor|docs|test|chore|perf|ci`
  (example from `git log`: `fix: install root node_modules in make install`).
- No AI attribution / `Co-Authored-By` lines.
- **Do NOT push, do NOT open a PR, do NOT merge.** Stop after the final
  verification and report.

## Steps

### Step 1: Ack, retry and dead-letter each queue message on its own merits

In `workers/cloudflare-native.js`, replace the whole of `handleCaseMutationQueue`
(lines 104–129) with the shape below, and add the three helpers immediately
above it. Do not change `processCaseExtracted`, `processCaseReindex`,
`processCaseSourceDelete`, `processAggregateRebuild`, `handleDeadLetterQueue`,
`queue()` or anything in `fetch()`.

```js
function queueLogFields(message, batch) {
  const body = message?.body;
  return {
    queue: typeof batch?.queue === "string" ? batch.queue : null,
    kind: typeof body?.kind === "string" ? body.kind : null,
    event_id: typeof body?.event_id === "string" ? body.event_id : null,
  };
}

function retryQueueMessage(message, error) {
  if (typeof message?.retry === "function") {
    message.retry({ delaySeconds: 30 });
    return;
  }
  throw error || new Error("Queue message cannot be retried");
}

async function processMutationMessage(message, env, stores) {
  if (await processCaseExtracted(message, env)) return true;
  if (await processCaseReindex(message, stores)) return true;
  if (await processCaseSourceDelete(message, stores)) return true;
  if (await processAggregateRebuild(message)) return true;
  return false;
}

async function handleCaseMutationQueue(batch, env) {
  const messages = batch?.messages || [];
  const stores = createCloudflareStores(env);
  const handled = [];
  for (const message of messages) {
    try {
      if (await processMutationMessage(message, env, stores)) {
        handled.push(message);
        continue;
      }
      // An unrecognised kind is never silently dropped: retrying lets the
      // consumer's max_retries carry it into immi-case-mutation-dlq, and the
      // log line names the kind that no processor claimed.
      console.error(JSON.stringify({
        event: "cloudflare.queue.unhandled_message",
        ...queueLogFields(message, batch),
      }));
      retryQueueMessage(message);
    } catch (error) {
      console.error(JSON.stringify({
        event: "cloudflare.case_reindex_error",
        ...queueLogFields(message, batch),
        error: error?.message,
      }));
      retryQueueMessage(message, error);
    }
  }
  if (handled.length === 0) return;
  try {
    await stores.caseStore.rebuildAggregates();
  } catch (error) {
    // Analytics is only safe to publish once the rebuild committed. Leave the
    // contributing messages un-acked so the queue retries the rebuild.
    console.error(JSON.stringify({
      event: "cloudflare.aggregate_rebuild_error",
      queue: typeof batch?.queue === "string" ? batch.queue : null,
      error: error?.message,
    }));
    for (const message of handled) retryQueueMessage(message, error);
    return;
  }
  for (const message of handled) if (typeof message?.ack === "function") message.ack();
}
```

Three details that matter:

- Keep the event name `cloudflare.case_reindex_error` **unchanged** for the
  per-message failure. It is imprecise (it covers all four kinds) but it is the
  string any existing Logpush alert matches on; renaming it is an
  operator-visible change and is not this plan's job.
- `retryQueueMessage` preserves today's `else throw error` escape hatch for a
  message object with no `retry` function.
- `processMutationMessage` keeps the original try-order, so a `case.extracted`
  message is still claimed by `processCaseExtracted` first.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ bundle line printed, then `Test Files 25 passed (25)` / `Tests 345 passed (345)`.
All six pre-existing queue tests must still pass unchanged.

### Step 2: Rebuild each aggregate table inside a single D1 transaction

In `workers/storage/cloudflare.js`:

**2a.** Add a module-level constant directly below the `bindAll` helper (i.e.
after line 62, before `function safeCaseFilters`):

```js
/** D1 wraps one batch() call in one transaction; keep batches modest. */
const D1_BATCH_STATEMENT_LIMIT = 20;
```

**2b.** Rewrite `rebuildAggregates()` (lines 990–1067) so the statements are
grouped **by target table**, then packed into batches without ever splitting a
group. Copy every `INSERT` statement **verbatim** from the current code — the
SQL text, the `.bind(now)` calls and the column lists must not change. Only the
grouping changes.

The 17 groups, in the order they currently appear, with the source lines to move:

| Group (table) | INSERT statement(s) currently at |
|---|---|
| `aggregate_court_year_outcome` | 1001–1002 |
| `aggregate_source` | 1003–1004 |
| `catalog_summary` | 1005–1006 **and** 1007–1008 (two inserts) |
| `aggregate_judge_court` | 1009–1012 |
| `aggregate_nature_outcome` | 1013–1014 |
| `aggregate_concept` | 1015–1017 |
| `aggregate_country` | 1018–1019 |
| `aggregate_judge` | 1020–1022 |
| `aggregate_visa` | 1023–1025 |
| `aggregate_scope` | 1026–1033 |
| `aggregate_court_nature_outcome` | 1034–1036 |
| `aggregate_concept_scope` | 1037–1040 |
| `aggregate_concept_pair` | 1041–1046 |
| `aggregate_judge_outcome` | 1047–1050 |
| `aggregate_judge_year` | 1051–1054 |
| `aggregate_judge_visa` | 1055–1058 |
| `filter_options` | the 7 statements built by the loop at 1060–1064 |

Target shape:

```js
  async rebuildAggregates() {
    const now = utcNow();
    const filterOptions = [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]
      .map(([filterName, column]) => this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
    // One entry per table: its DELETE and the INSERT(s) that repopulate it ride
    // the same D1 transaction, so a mid-rebuild failure leaves that table's
    // previous rows in place instead of publishing an empty analytics table.
    const groups = [
      ["aggregate_court_year_outcome", [ /* verbatim statement from 1001-1002 */ ]],
      ["aggregate_source", [ /* 1003-1004 */ ]],
      ["catalog_summary", [ /* 1005-1006 */, /* 1007-1008 */ ]],
      // …one entry per row of the table above, in the same order…
      ["filter_options", filterOptions],
    ];
    const batches = [];
    let current = [];
    for (const [table, inserts] of groups) {
      const group = [this.db.prepare(`DELETE FROM ${table}`), ...inserts];
      if (current.length > 0 && current.length + group.length > D1_BATCH_STATEMENT_LIMIT) {
        batches.push(current);
        current = [];
      }
      current = [...current, ...group];
    }
    if (current.length > 0) batches.push(current);
    for (const statements of batches) await this.db.batch(statements);
    return { rebuilt_at: now };
  }
```

Invariants to preserve, and check by eye before running anything:

- Exactly 17 groups and exactly 24 INSERT statements total: 15 tables with one
  INSERT each, plus `catalog_summary` × 2, plus `filter_options` × 7
  (15 + 2 + 7 = 24).
- Every group's table name matches the table its INSERTs write to.
- `now` is still bound into the **7** statements that currently call
  `.bind(now)` — at lines 1002, 1004, 1006, 1008, 1019, 1022 and 1025, i.e.
  `aggregate_court_year_outcome`, `aggregate_source`, both `catalog_summary`
  inserts, `aggregate_country`, `aggregate_judge` and `aggregate_visa`. Copy the
  `.bind(now)` along with each statement; do not add or drop any. The other 17
  INSERTs take no bound parameter, and the 7 `filter_options` statements bind
  `filterName` instead.
- The largest group is `filter_options` at 8 statements, comfortably under
  `D1_BATCH_STATEMENT_LIMIT`; the packing loop still emits an oversized future
  group as its own batch rather than splitting it.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ bundle line printed, then `Tests 345 passed (345)`.
(The existing suite barely exercises this method — Step 5 is the real gate for
this change, and it is not optional.)

### Step 3: Write a case row and its relations in one transaction

Still in `workers/storage/cloudflare.js`.

**3a. `updateCaseFields` (lines 878–934).** Build the `UPDATE` statement instead
of running it, move the relation-statement construction (currently lines
909–931, unchanged) *above* the write, then dispatch. Replace lines 903–908 and
line 932 so the tail of the method reads:

```js
    const caseUpdate = this.db.prepare(`
      UPDATE cases SET ${assignments.join(", ")} WHERE case_id = ?
    `).bind(...params);
    const relationStatements = [];
    // …lines 910-931 move here verbatim: the judges block, then the
    //   legal_concepts block. Both already use `now` and `id`, which are
    //   defined above, so nothing else changes.
    const statements = [caseUpdate, ...relationStatements];
    // A normal edit is a handful of statements, so the row and its judges /
    // concepts commit together. An edit carrying dozens of relation labels
    // exceeds one D1 transaction and keeps the previous two-phase behaviour.
    const oneTransaction = statements.length <= D1_BATCH_STATEMENT_LIMIT;
    const result = oneTransaction
      ? (await this.db.batch(statements))[0]
      : await caseUpdate.run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
    if (!oneTransaction && relationStatements.length) await this.db.batch(relationStatements);
    return this.getCase(id);
```

Behaviour notes: in the merged branch the relation deletes now execute before
the `changeCount` check, so an update against a non-existent `case_id` will run
`DELETE FROM case_judges WHERE case_id = ?` for that id — a no-op against a
consistent database. The 404 `StorageBoundaryError` (code `case_not_found`,
status 404) is still raised in both branches; that is asserted in Step 5.

**3b. `putImportedCase` (lines 1271–1282).** Put the chunk delete in the same
batch as its replacement inserts. Replace those lines with:

```js
    // A repeatable import must remove stale tail chunks before adding the new
    // canonical text. The delete rides the first batch with its replacement
    // inserts, so the case is never observable with zero chunks. The FTS delete
    // trigger keeps case_text_fts in lockstep.
    const chunkStatements = [this.db.prepare(`DELETE FROM case_text_chunks WHERE case_id = ?`).bind(caseId)];
    chunks.forEach((chunk, index) => {
      chunkStatements.push(bindAll(this.db, `
        INSERT INTO case_text_chunks (case_id, chunk_index, content, content_sha256, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_id, chunk_index) DO UPDATE SET
          content=excluded.content, content_sha256=excluded.content_sha256, created_at=excluded.created_at
      `, [caseId, index, chunk.content, chunk.sha256, now]));
    });
    for (let offset = 0; offset < chunkStatements.length; offset += D1_BATCH_STATEMENT_LIMIT) {
      await this.db.batch(chunkStatements.slice(offset, offset + D1_BATCH_STATEMENT_LIMIT));
    }
```

The `chunk_index` value is now the flat `index`, which equals the old
`offset + index` — the on-disk numbering is unchanged. The DELETE statement text
and its single bound parameter are unchanged, which is what keeps
`cloudflare-storage-contracts.test.js:202-203` passing.

**3c.** Replace the two remaining bare `20` literals in this file's batching
loops with `D1_BATCH_STATEMENT_LIMIT` (the `rebuildAggregates` one is already
gone after Step 2; the `putImportedCase` one is handled by 3b). Do not touch the
unrelated `slice(0, 20)` at line 845 or any `LIMIT 20` in SQL.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ bundle line printed, then `Tests 345 passed (345)`. In particular
`__tests__/cloudflare-storage-contracts.test.js › projects normalised judges and
concepts back to the legacy case API shape` must still pass.

### Step 4: Cover the poison, unknown-kind and DLQ-failure queue paths

Append five tests to `workers/__tests__/cloudflare-native-queue.test.js`, inside
the existing `describe("Cloudflare case mutation queue")` block. Reuse the
file's existing `stores()` factory and `mockCreateStores` mock exactly as the
current tests do — do not restructure the file.

Add a helper at the top of the new tests (or reuse inline) for building a
message:

```js
  function queueMessage(body) {
    return { body, ack: vi.fn(), retry: vi.fn() };
  }
```

1. **`isolates a poison message from the rest of its batch`** — build three
   messages: two valid `case.reindex` messages (`case_id: "0123456789ab"` and
   `"0123456789ac"`, same `content_key`/`content_sha256`/`content_size`/
   `content_type` shape as the existing test at lines 71–77) and, second in the
   array, one whose processing throws. Make it throw by having
   `current.objectStore.getVerifiedText` reject only for that message's key:
   `mockImplementation(async ({ key }) => { if (key === "poison") throw new Error("checksum mismatch"); return "canonical case text"; })`.
   Assert: messages 1 and 3 `ack` once each and never `retry`; message 2
   `retry`s with `{ delaySeconds: 30 }` and never `ack`s;
   `current.caseStore.rebuildAggregates` called once.
2. **`dead-letters a message whose kind no processor claims`** — body
   `{ kind: "case.unknown_v2", event_id: "case.unknown_v2:abc" }`. Spy with
   `const logs = vi.spyOn(console, "error").mockImplementation(() => {})` and
   restore it at the end of the test. Assert: `message.retry` called with
   `{ delaySeconds: 30 }`, `message.ack` never called,
   `rebuildAggregates` never called, and at least one `console.error` argument
   parses as JSON with `event === "cloudflare.queue.unhandled_message"` and
   `kind === "case.unknown_v2"`.
3. **`dead-letters a case.reindex event whose case_id is not a string`** — body
   `{ kind: "case.reindex", event_id: "case.reindex:bad", case_id: 12345 }`.
   Same assertions as test 2 but `kind === "case.reindex"`. This is the
   regression guard for the malformed-id silent drop.
4. **`keeps messages un-acked when the aggregate rebuild fails`** —
   `current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 batch failed"))`,
   one valid `case.reindex` message. Assert `retry` called with
   `{ delaySeconds: 30 }` and `ack` never called.
5. **`retries a dead-letter message when the DLQ recorder fails`** —
   `current.pipelineStore.recordDeadLetter.mockRejectedValue(new Error("ops D1 down"))`,
   dispatched with `{ queue: "immi-case-mutation-dlq", messages: [message] }`.
   Assert `retry` called with `{ delaySeconds: 30 }` and `ack` never called.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-queue.test.js`
→ `Tests 11 passed (11)` (6 pre-existing + 5 new).

### Step 5: Pin the D1 batch grouping for aggregate and case writes

Create `workers/__tests__/cloudflare-storage-atomicity.test.js`. This file must
import the **real** `../storage/cloudflare.js` (no `vi.mock` of it) and drive it
with a D1 mock that records how statements were grouped into `batch()` calls.

Scaffold:

```js
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareStores } from "../storage/cloudflare.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";

function d1({ changes = 1 } = {}) {
  const batches = [];
  const ran = [];
  return {
    batches,
    ran,
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => { statement.params = params; return statement; };
      statement.all = vi.fn(async () => ({ results: [] }));
      statement.first = vi.fn(async () => null);
      statement.run = vi.fn(async () => { ran.push(statement); return { meta: { changes } }; });
      return statement;
    },
    batch: vi.fn(async (statements) => {
      batches.push(statements);
      return statements.map(() => ({ meta: { changes } }));
    }),
  };
}

function env(catalog) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: catalog,
    IMMI_ACCOUNT_DB: d1(),
    IMMI_OPS_DB: d1(),
    IMMI_CONTENT: {
      put: vi.fn(async (key, bytes) => ({ key, size: bytes.byteLength })),
      head: vi.fn(async () => ({ size: 5, customMetadata: { sha256: "" } })),
      get: vi.fn(async () => null),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })),
      query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "mutation-1" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
  };
}

const SOURCE_POINTER = {
  key: `cases/0123456789ab/source/${"a".repeat(64)}.txt`,
  sha256: "a".repeat(64),
  size: 12,
  contentType: "text/plain; charset=utf-8",
};
```

Tests to write:

1. **`rebuilds every aggregate table inside the transaction that truncates it`**
   — call `stores.caseStore.rebuildAggregates()`, then for every recorded batch:
   assert `statements.length <= 20`, and for every statement whose `sql` matches
   `/^DELETE FROM (\w+)$/`, assert some statement in the *same* batch matches
   `new RegExp("INSERT INTO " + table + "\\b")`. (`\b` is safe here: `_` is a
   word character, so `aggregate_judge\b` does not match inside
   `aggregate_judge_court`.)
2. **`truncates each aggregate table exactly once`** — collect every
   `DELETE FROM <table>` across all batches; assert there are 17 of them and
   that they are all distinct (`new Set(tables).size === 17`).
3. **`never leaves an imported case without full-text chunks`** — call
   `stores.caseStore.putImportedCase({ case: { case_id: "0123456789ab", citation: "[2026] FCA 1", title: "Example v Minister", court_code: "FCA", year: 2026 }, sourcePointer: SOURCE_POINTER, textChunks: ["first chunk", "second chunk"] })`.
   Assert: the batch containing `DELETE FROM case_text_chunks` also contains
   `INSERT INTO case_text_chunks`; `catalog.ran` contains **no** statement whose
   sql includes `DELETE FROM case_text_chunks` (proving it is no longer a
   standalone `run()`); and the two chunk inserts carry `chunk_index` `0` and
   `1` in their `params[1]`.
4. **`writes a case row and its relations in one transaction`** — call
   `stores.caseStore.updateCaseFields("0123456789ab", { title: "Updated", judges: ["Perram J"], legal_concepts: ["procedural fairness"] })`.
   Assert exactly one `batch()` call was made, and that this single batch
   contains a statement whose sql includes `UPDATE cases SET`, one including
   `DELETE FROM case_judges`, and one including `DELETE FROM case_concepts`.
5. **`still reports a missing case as a 404`** — build the catalog with
   `d1({ changes: 0 })` and assert
   `await expect(stores.caseStore.updateCaseFields("0123456789ab", { title: "Updated" })).rejects.toMatchObject({ code: "case_not_found", status: 404 })`.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-atomicity.test.js`
→ `Test Files 1 passed (1)`, `Tests 5 passed (5)`.

Then the whole suite:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ `Test Files 26 passed (26)`, `Tests 355 passed (355)` (345 baseline + 5 + 5).

## Test plan

New tests, all under `workers/__tests__/`:

- `cloudflare-native-queue.test.js` (+5, model them on the six existing tests in
  that file — same `stores()` factory, same `worker.queue({ messages: [...] }, { IMMI_STORAGE_MODE: "cloudflare" })`
  call shape):
  - poison message isolated inside a 3-message batch (the JSCORR-05 regression);
  - unknown `kind` retried, logged as `cloudflare.queue.unhandled_message`, not
    acked (the JSCORR-23 regression);
  - `case.reindex` with a non-string `case_id` treated the same way;
  - `rebuildAggregates` rejection leaves contributing messages un-acked;
  - dead-letter recorder rejection retries instead of acking (the untested DLQ
    failure path).
- `cloudflare-storage-atomicity.test.js` (new file, +5): aggregate
  DELETE/INSERT co-location, one truncation per table, chunk-delete co-location
  and flat `chunk_index`, single-transaction case edit, preserved 404.

Structural pattern for the new file's D1 mock: `workers/__tests__/cloudflare-storage-contracts.test.js:22-60`
(its `d1()` / `env()` helpers) — the version in this plan extends that idea with
per-`batch()` recording.

Regression safety net: the full Worker suite (345 pre-existing assertions) plus
`node scripts/check_cloudflare_native_bundle.mjs`, plus the two Python boundary
tests that read `workers/cloudflare-native.js`.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` exits 0
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with `Test Files 26 passed (26)` and `Tests 355 passed (355)`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_native_effective_references.py tests/test_native_pipeline_boundary.py -q` reports `6 passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` reports `1141 passed, 3 failed, 7 skipped` (no new failures)
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` prints `All checks passed!`
- [ ] `grep -n "for (const message of messages) if (typeof message?.ack === \"function\") message.ack();" workers/cloudflare-native.js` returns **no match** (the unconditional whole-batch ack is gone)
- [ ] `grep -c "cloudflare.queue.unhandled_message" workers/cloudflare-native.js` returns `1`
- [ ] `grep -c "D1_BATCH_STATEMENT_LIMIT" workers/storage/cloudflare.js` returns `4` or more (declaration + rebuildAggregates + updateCaseFields + putImportedCase)
- [ ] `grep -n "await this.db.prepare(\`DELETE FROM case_text_chunks WHERE case_id = ?\`).bind(caseId).run()" workers/storage/cloudflare.js` returns **no match**
- [ ] `git status --short` lists only: `workers/cloudflare-native.js`, `workers/storage/cloudflare.js`, `workers/__tests__/cloudflare-native-queue.test.js`, `workers/__tests__/cloudflare-storage-atomicity.test.js`, and this plan file if you updated its status row
- [ ] Nothing was pushed and no PR was opened

## STOP conditions

Stop and report back (do not improvise) if:

- The `handleCaseMutationQueue` body at `workers/cloudflare-native.js:104-129`
  does not match the excerpt in "Current state" — someone has already reworked
  the consumer and this plan's premise is stale.
- `rebuildAggregates()` no longer opens with the 17-table `DELETE` loop, or the
  INSERT statements no longer map one-to-one onto the group table in the Step 2
  table — regrouping the wrong statement under the wrong table would silently
  publish an empty analytics table, which is exactly the bug being fixed.
- Your Step 2 regrouping produces anything other than 17 groups / 24 INSERT
  statements, or you cannot find one of the listed source lines.
- `workers/__tests__/cloudflare-storage-contracts.test.js › projects normalised
  judges and concepts back to the legacy case API shape` fails. That means your
  Step 3b edit changed the chunk-delete SQL or its bound parameters. Fix your
  edit — do **not** edit that test; it is out of scope.
- Any of `supabase`, `postgres`, `pgvector` or `hyperdrive` appears in your diff
  to `workers/cloudflare-native.js`, or
  `tests/test_native_effective_references.py` starts failing.
- `workers/__tests__/cloudflare-storage-contracts.test.js › keeps Cloudflare
  data bindings inside the storage boundary` fails — you referenced an
  `env.IMMI_*` / `env.CASE_VECTORS` / `env.AI` binding from outside
  `workers/storage/`.
- The worker suite count drops below the 345 baseline at any point, or a
  step's verification fails twice after a reasonable fix attempt.
- You conclude the fix needs `wrangler.toml`, `workers/case-api/cloudflare_mutations.js`
  or `workers/storage/pipeline_coordinator.js`. It does not; those are
  deliberately out of scope.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise**: (a) the Step 2 regrouping — every
  `DELETE FROM x` must sit with the INSERT(s) that write `x`, and the seven
  `.bind(now)` calls must have survived the move intact; (b) that
  `updateCaseFields` still throws `case_not_found` in *both* the merged and the
  fallback branch; (c) that no message can now be acked without either being
  processed or surviving a successful `rebuildAggregates()`.
- **Deliberately deferred**: a fully transactional per-case write. `putImportedCase`
  still issues the case upsert, the judge batch, the concept batch and the chunk
  batches as separate D1 transactions. `normaliseRelationLabels` caps at 100
  labels (`workers/storage/cloudflare.js:232`), so judge + concept statements can
  reach ~400 — far past what one D1 batch should carry — and collapsing them
  needs a chunked-with-repair design, not a bigger batch. The exposure is
  bounded today: the queue path self-heals because
  `coordinateExtractedCase` only calls `completeEvent` at the very end
  (`workers/storage/pipeline_coordinator.js:178`), so a retry re-runs the whole
  upsert; and the synchronous HTTP path is fail-closed
  (`IMMI_CASE_MUTATIONS_ENABLED` defaults to `"false"`). **If that flag is ever
  flipped to `"true"` in production, revisit this**: `handleCreate`
  (`workers/case-api/cloudflare_mutations.js:195-211`) returns `201` at line 210
  with no compensating cleanup, so a mid-write failure there stays broken.
- **Interactions with future work**: adding a fifth message `kind` means adding
  a processor to `processMutationMessage` — forget it and the new kind now
  dead-letters loudly (which is the point) instead of vanishing. Adding a new
  aggregate table means adding a group to `rebuildAggregates`, and the Step 5
  test `truncates each aggregate table exactly once` will need its expected
  count of 17 bumped.
- **Log names**: `cloudflare.case_reindex_error` is retained despite covering
  all four kinds, for continuity with any existing Logpush alert. Two new event
  names ship here: `cloudflare.queue.unhandled_message` and
  `cloudflare.aggregate_rebuild_error`. Both are worth alerting on — the first
  means producer/consumer skew, the second means analytics is stale.
- **Unknown-kind cost**: a message with an unrecognised `kind` now burns 5
  retries before dead-lettering. That is intentional (visibility over silence),
  but it does mean a mass producer/consumer skew produces 5× the log volume.

## Findings reconsidered

Nothing was dropped; four cited details were wrong or overstated and are
corrected above rather than repeated:

- **Cache TTL in the JSCORR-05 impact claim.** The claim was "a 10-minute public
  cache" across `/api/v1/stats`, `/api/v1/analytics/*` and
  `/api/v1/filter-options`. Verified: only the analytics handlers use
  `public, max-age=600` (e.g. `workers/case-api/cloudflare.js:455`, `:519`,
  `:542`). `/api/v1/stats` (`:344`, `:353`) and `/api/v1/filter-options`
  (`:295`) are `public, max-age=300, stale-while-revalidate=60` — 5 minutes, not
  10. Corrected in "Why this matters".
- **"Permanently if the batch dead-letters".** A retried batch re-enters the same
  handler with `changed` still true, so `rebuildAggregates()` re-runs on each of
  the up-to-5 retries. The empty-analytics window is the retry window; it only
  becomes permanent once `max_retries = 5` is exhausted and the batch
  dead-letters. Stated that way in "Why this matters".
- **`workers/storage/cloudflare.js:993` cited as `rebuildAggregates`.** Line 993
  is the first line of the table list; the method opens at line 990 and the
  `DELETE` loop spans 993–999. Corrected in "Current state".
- **`workers/case-api/cloudflare_mutations.js:203` cited as "returns 201".**
  Line 203 is the `await stores.caseStore.putImportedCase({...})` call; the
  `201` is returned at line 210. Corrected in "Maintenance notes".

One framing note carried forward rather than acted on: whole-batch retry on a
mid-batch throw is standard at-least-once queue semantics, and the processors
here are largely idempotent (`INSERT OR IGNORE`, Vectorize upsert,
pointer-verified R2 ops, and the `claimEvent`/`isEventComplete` short-circuit at
`workers/storage/pipeline_coordinator.js:120-127`, which makes a replayed
`case.extracted` skip R2/D1/Vectorize and the Workers AI embedding entirely). So
the replay itself is cheap for `case.extracted`. The un-guarded replay cost is
limited to `case.reindex`, which has no idempotency claim and re-runs a Workers
AI embedding on every retry. Step 1 is still worth doing — it is what stops one
poison message from dragging 19 healthy ones toward the DLQ with it — but the
sharper defects it fixes are the silent ack (JSCORR-23) and the un-retried
rebuild.
