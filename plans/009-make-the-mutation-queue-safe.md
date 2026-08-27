# Plan 009: Per-message acks, dead-lettering and atomic aggregate rebuilds

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists; if it does not exist, do **not** create
> it (a reviewer maintains the index).
>
> **Drift check (run first)** — all four commands, because a committed-only
> diff cannot see a dirty working tree:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="workers/cloudflare-native.js workers/storage/cloudflare.js workers/__tests__/cloudflare-native-queue.test.js workers/__tests__/cloudflare-storage-contracts.test.js"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P     # landed since this plan was written
> git diff --stat -- $P                   # unstaged
> git diff --cached --stat -- $P          # staged
> ```
> If any of those four in-scope paths appears in **any** of the three diffs, or
> in `git status --short`, treat it as a STOP condition: compare the "Current
> state" excerpts against the live code and report before editing. Do **not**
> run `git checkout --` or `git clean` to "clean up" — the operator may have
> work in progress there.
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

### Integration order (this plan is FIRST in its lane)

Five plans edit `workers/storage/cloudflare.js` and/or
`workers/case-api/cloudflare.js`. They must be integrated **serially, in this
order**, each rebased on the previous one's HEAD:

```
009 (this plan)  →  010  →  013  →  014  →  012
```

009 is first because it rewrites `rebuildAggregates()`, `updateCaseFields()` and
`putImportedCase()` wholesale; every later plan in the chain re-locates its
target symbols against the post-009 file rather than against `42826a3` line
numbers. `plans/011-*.md` touches only `workers/austlii-scraper/**` plus
`workers/extraction-container.js` and can run in parallel with all of them.

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
an unknown `kind` is logged and reaches `immi-case-mutation-dlq`; **no analytics
table is ever observably empty** because its `DELETE` and its `INSERT`s ride one
D1 transaction; and a case that *has* full text is never observable with zero
full-text search chunks, because its chunk delete and all of its chunk inserts
ride one D1 transaction too.

**What this plan does NOT achieve — read this before you write the commit
message.** Grouping per table makes each table individually atomic; it does
**not** make the 17-table rebuild atomic as a whole. The 41 statements still
span more than one `db.batch()` call, so a failure part-way through leaves a
*mixed generation*: some tables refreshed, the rest carrying the previous
rebuild's rows. That is strictly better than today (today the same failure
publishes **empty** tables and a dashboard that reports zero cases), but it is
not "the previous numbers are preserved". Cross-table skew between
e.g. `catalog_summary.total_cases` and `aggregate_court_year_outcome` remains
possible for the duration of the retry window. Step 2 adds a structured log so
the skew is observable; a genuinely atomic rebuild needs shadow tables plus a
generation pointer and is named as a required follow-up in "Maintenance notes".
Do not claim full atomicity anywhere in your report.

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

**Sizing fact you need for Step 3b** (verified, do not re-derive): chunks are
128 KiB each — `FTS_CHUNK_MAX_BYTES = 128 * 1024`
(`workers/storage/contracts.js:15`) and `splitFtsChunks`
(`workers/storage/pipeline_coordinator.js:38-68`) fills each chunk to that byte
ceiling before starting the next. So a case needs >2.4 MB of canonical text
before it produces 20 chunks; the overwhelming majority of AustLII judgments
produce exactly one. That is what makes "delete + every insert in one batch"
practical rather than aspirational — but it is a *typical* bound, not a
guaranteed one, so Step 3b adds an explicit ceiling that fails loudly instead of
silently splitting the transaction.

**And a case with no full text legitimately has zero chunks.**
`splitFtsChunks` throws `canonicalText is required` on empty input
(`pipeline_coordinator.js:30-34`, reached from `:38`), so the only way
`textChunks` is `[]` is `workers/case-api/cloudflare_mutations.js:206` / `:226`
(`textChunks: text ? splitFtsChunks(text) : []`) — a case created or updated
with no full text at all. Deleting its stale chunks with nothing to replace them
is the *correct* end state, not a violated invariant. State the invariant
precisely: **a case that has full text is never observable with zero chunks.**

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

**Record your own baseline first.** Absolute suite totals are not used anywhere
in this plan: four sibling plans add tests to the same Worker suite, so any fixed
number is wrong the moment one of them lands. Before you change anything, run
and write down:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
BEFORE_WORKER=$(npx vitest run 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
echo "BEFORE_WORKER=$BEFORE_WORKER"
BEFORE_QUEUE=$(npx vitest run __tests__/cloudflare-native-queue.test.js 2>&1 | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+')
echo "BEFORE_QUEUE=$BEFORE_QUEUE"   # 6 at 42826a3
```

Every later check in this plan is expressed as a **delta** against those two
numbers, or as a named-test assertion.

| Purpose | Command | Expected on success |
|---|---|---|
| Worker unit tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | exit 0, **zero failures**; final total must equal `BEFORE_WORKER + 14` |
| One worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-queue.test.js` | exit 0; final total `BEFORE_QUEUE + 5` (i.e. `11 passed` if you started from the `42826a3` baseline of 6) |
| New atomicity file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-atomicity.test.js` | exit 0, `Tests 9 passed (9)` — a per-file count, stable regardless of sibling plans |
| Worker bundle closure | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` | exit 0, prints `Cloudflare-native bundle closure passed (…bytes)` |
| Native boundary gates | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_native_effective_references.py tests/test_native_pipeline_boundary.py -q` | `6 passed` (per-file count, stable) |
| Full Python suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | zero *new* failures. The only failures allowed are **exactly the three environmental ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`, by name** (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import). Confirm by name, not by count: `make test-py 2>&1 \| grep -E '^(FAILED\|ERROR)' \| sort -u` must list only paths inside that one file. |
| Python lint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` | `All checks passed!` |
| Scope check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only the four in-scope paths listed below, plus anything that was already dirty before you started (record that list at Step 0) |

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
→ bundle line printed, then **zero failures and a total equal to
`BEFORE_WORKER`** (this step adds no tests). All pre-existing queue tests in
`__tests__/cloudflare-native-queue.test.js` must still pass unchanged; check
that file on its own too:
`npx vitest run __tests__/cloudflare-native-queue.test.js` → `BEFORE_QUEUE`
passed, 0 failed.

### Step 2: Rebuild each aggregate table inside a single D1 transaction

**Scope of the guarantee (say this out loud before you start).** This step buys
*per-table* atomicity: no analytics table is ever observably empty. It does not
buy *whole-rebuild* atomicity — see "Why this matters". Do not describe it as
"the rebuild is now atomic" in the commit message or your report. The commit
message stays `fix: rebuild each aggregate table inside one D1 transaction`.

**Why not just put all 41 statements in one `batch()`?** Because nothing in this
repo or in Cloudflare's published D1 limits establishes that a single
transaction carrying 17 whole-corpus `DELETE`s plus 24 whole-corpus aggregating
`INSERT ... SELECT`s over ~149K rows completes inside D1's per-query and
per-transaction ceilings, and there is no environment reachable from this
working copy in which that could be measured (the local Miniflare D1 is empty).
Shipping an unverified single mega-transaction would trade a known,
now-mitigated failure mode for an unknown one. The grouped design below is
provably better than today and provably safe; the fully atomic design
(shadow tables + a generation pointer) is a separate, larger plan, recorded in
"Maintenance notes".

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

**2c. Make a partial rebuild observable.** The packing loop above must carry the
table names alongside the statements, because a real D1 `D1PreparedStatement`
does **not** expose the SQL text — you cannot recover the table name from the
statement object at runtime, only from the group you built it from. So track
both in the accumulator:

```js
    const batches = [];
    let current = { tables: [], statements: [] };
    for (const [table, inserts] of groups) {
      const group = [this.db.prepare(`DELETE FROM ${table}`), ...inserts];
      if (current.statements.length > 0
        && current.statements.length + group.length > D1_BATCH_STATEMENT_LIMIT) {
        batches.push(current);
        current = { tables: [], statements: [] };
      }
      current = {
        tables: [...current.tables, table],
        statements: [...current.statements, ...group],
      };
    }
    if (current.statements.length > 0) batches.push(current);
    // A rebuild spans more than one transaction, so a failure part-way through
    // leaves a mixed generation: `committed_tables` names the tables that
    // already hold the new rows. Log it so the skew is observable in Logpush
    // instead of being inferred from a dashboard that looks slightly wrong.
    const committed = [];
    for (const [index, batch] of batches.entries()) {
      try {
        await this.db.batch(batch.statements);
      } catch (error) {
        console.error(JSON.stringify({
          event: "cloudflare.aggregate_rebuild_partial",
          batch_index: index,
          batches: batches.length,
          committed_tables: committed,
          error: error?.message,
        }));
        throw error;
      }
      committed.push(...batch.tables);
    }
    return { rebuilt_at: now, rebuilt_tables: committed };
```

Two notes:

- `rebuildAggregates()` gains a `rebuilt_tables` key. Verify nothing depends on
  the old shape before you rely on that being additive:
  `grep -rn "rebuildAggregates" workers/ | grep -v __tests__` → the only
  production call sites are `handleCaseMutationQueue` and
  `processAggregateRebuild` in `workers/cloudflare-native.js`, and neither reads
  the return value. If that grep shows a third caller that *does* read it, stop.
- `cloudflare.aggregate_rebuild_partial` is a third new event name (alongside the
  two in Step 1) and is worth alerting on: it means analytics is internally
  inconsistent until a retry succeeds.

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
→ bundle line printed, then zero failures and a total still equal to
`BEFORE_WORKER`.
(The existing suite barely exercises this method, and `node --check` / the bundle
script only prove the file parses — neither can tell a correct regrouping from a
wrong one. Step 5's failure-injection test is the real gate for this change, and
it is not optional.)

### Step 3: Write a case row and its relations in one transaction

Still in `workers/storage/cloudflare.js`.

**3a. `updateCaseFields` (lines 878–934).** The statement count must become
**fixed**, not "small in the common case". Today the method emits
`1 UPDATE + (1 DELETE + 2×J INSERT) + (1 DELETE + 2×C INSERT)` statements, where
J and C are the judge and concept label counts. `normaliseRelationLabels` caps
each at 100 (`workers/storage/cloudflare.js:232`, verbatim:
`return [...new Set(labels)].slice(0, 100);`), so the range is 1 … 403
statements — and a mere **nine** labels total already produces
`1 + 1 + 10 + 1 + 8 = 21`, i.e. past a 20-statement batch. A design that falls
back to two-phase writes above a threshold therefore does not fix the defect for
any realistic multi-judge edit; it just moves the cliff.

Emit the labels as **JSON** and let SQLite expand them with `json_each`, so the
statement count is 7 regardless of how many labels there are. SQLite's JSON1
functions (`json_each`, `json_extract`) are built into D1 — the codebase already
relies on `json_each` in `findByIds` (`workers/storage/cloudflare.js:817-827`)
and on `json_valid()` in `migrations/d1/ops/0002_pipeline_control.sql:6`. Use
`json_extract(value, '$.x')` rather than the `->>` operator, which needs SQLite
3.38+ and is not exercised anywhere in this repo.

Replace lines 903–933 (from `const result = await this.db.prepare(` through
`if (relationStatements.length) await this.db.batch(relationStatements);`) so
the tail of the method reads:

```js
    const caseUpdate = this.db.prepare(`
      UPDATE cases SET ${assignments.join(", ")} WHERE case_id = ?
    `).bind(...params);

    // Relations are expanded inside SQLite from one JSON parameter each, so the
    // whole edit is always 1–7 statements and always fits in one D1
    // transaction — no matter how many labels the caller sent. The previous
    // per-label statement loop reached 403 statements at the 100-label cap in
    // normaliseRelationLabels().
    const relationStatements = [];
    if (Object.prototype.hasOwnProperty.call(updates, "judges")) {
      const labels = normaliseRelationLabels(updates.judges, "judge");
      const entries = await Promise.all(labels.map(async (label) => ({
        id: (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32),
        label,
      })));
      relationStatements.push(this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id));
      if (entries.length > 0) {
        const payload = JSON.stringify(entries);
        relationStatements.push(
          this.db.prepare(`
            INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), ?, ?
            FROM json_each(?)
          `).bind(now, now, payload),
          this.db.prepare(`
            INSERT OR IGNORE INTO case_judges (case_id, judge_id)
            SELECT ?, json_extract(value, '$.id') FROM json_each(?)
          `).bind(id, payload),
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "legal_concepts")) {
      const labels = normaliseRelationLabels(updates.legal_concepts, "legal concept");
      const entries = await Promise.all(labels.map(async (label) => ({
        id: (await sha256Hex(`concept:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32),
        label,
      })));
      relationStatements.push(this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id));
      if (entries.length > 0) {
        const payload = JSON.stringify(entries);
        relationStatements.push(
          this.db.prepare(`
            INSERT OR IGNORE INTO concepts (concept_id, label)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.label') FROM json_each(?)
          `).bind(payload),
          this.db.prepare(`
            INSERT OR IGNORE INTO case_concepts (case_id, concept_id)
            SELECT ?, json_extract(value, '$.id') FROM json_each(?)
          `).bind(id, payload),
        );
      }
    }

    const statements = [caseUpdate, ...relationStatements];
    // At most 7 statements — assert it rather than branching on it, so a future
    // edit that reintroduces a per-label loop fails loudly here instead of
    // silently splitting the write across two transactions again.
    if (statements.length > D1_BATCH_STATEMENT_LIMIT) {
      throw new StorageBoundaryError("Case update exceeds one D1 transaction", {
        code: "case_update_too_large",
        status: 500,
      });
    }
    const result = (await this.db.batch(statements))[0];
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
    return this.getCase(id);
```

Four behaviour notes, all of which Step 5 asserts:

- **Semantics are unchanged.** `json_each` over an array yields one row per
  element in array order; `INSERT OR IGNORE` still de-duplicates against existing
  rows exactly as the per-label loop did. `normaliseRelationLabels` already
  de-duplicated within the batch (`[...new Set(labels)]`), so no two elements
  share an `id`.
- **Bound-parameter budget is safe.** The largest new statement binds three
  parameters (`now, now, payload`). The 100-parameter ceiling enforced by
  `bindAll` / `D1_MAX_BOUND_PARAMETERS` (`workers/storage/contracts.js:13`) is
  nowhere near. That is the whole point of the JSON payload: label count no
  longer scales the parameter count.
- **There is no longer a two-phase fallback**, so the "relation deletes execute
  before the `changeCount` check" note still applies: an update against a
  non-existent `case_id` runs `DELETE FROM case_judges WHERE case_id = ?` for
  that id inside the same transaction, a no-op against a consistent database,
  and the 404 `StorageBoundaryError` (code `case_not_found`, status 404) is then
  raised — which rolls nothing back, because D1 already committed the batch.
  That is acceptable and unchanged in kind from today (today the `UPDATE` also
  commits before the 404 is raised); it is asserted in Step 5.
- **`case_update_too_large` is a new error code.** It is unreachable by
  construction — reaching it means someone reintroduced per-label statements —
  so no caller needs to handle it beyond the existing `StorageBoundaryError`
  path in `workers/case-api/cloudflare_mutations.js`.

**3b. `putImportedCase` (lines 1271–1282).** Put the chunk delete and **every**
replacement insert in **one** batch — not "the delete plus the first 19 inserts".
Chunking the statements as the original plan draft did would still split a
21-chunk case across two transactions, and a failure in the second one leaves the
case holding only a prefix of its new text, which is a *worse* observable state
than the stale-full-text one it replaced. Since the transaction is now
unbounded-by-construction, add an explicit ceiling that refuses rather than
splits.

First add a second module-level constant next to `D1_BATCH_STATEMENT_LIMIT`
(from Step 2a):

```js
/**
 * Statement ceiling for the one-shot chunk write. A chunk holds up to
 * FTS_CHUNK_MAX_BYTES (128 KiB, workers/storage/contracts.js:15), so 40
 * statements is ~5 MB of canonical text — far past any AustLII judgment. Past
 * this the import fails loudly instead of silently splitting the transaction
 * and leaving a prefix of the new text behind.
 */
const D1_CHUNK_TRANSACTION_STATEMENT_LIMIT = 40;
```

Then replace lines 1271–1282 with:

```js
    // A repeatable import must remove stale tail chunks before adding the new
    // canonical text. The delete and ALL replacement inserts ride one D1
    // transaction, so a case that has full text is never observable with zero
    // chunks and never with only a prefix of the new text. The FTS delete
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
    if (chunkStatements.length > D1_CHUNK_TRANSACTION_STATEMENT_LIMIT) {
      throw new StorageBoundaryError("Canonical text produces too many chunks for one transaction", {
        code: "fts_chunk_count_too_large",
        status: 400,
      });
    }
    await this.db.batch(chunkStatements);
```

Three things this preserves and one it changes:

- The `chunk_index` value is now the flat `index`, which equals the old
  `offset + index` — the on-disk numbering is unchanged.
- The DELETE statement text and its single bound parameter are unchanged, which
  is what keeps `cloudflare-storage-contracts.test.js:202-203` passing. Do **not**
  turn it into a tail-only delete with an extra bound parameter: that test is out
  of scope and pins `params` to `["0123456789ab"]`.
- `textChunks: []` still produces a delete-only batch. That is **correct**, not a
  regression: the only caller that passes `[]` is
  `workers/case-api/cloudflare_mutations.js:206`/`:226`
  (`textChunks: text ? splitFtsChunks(text) : []`), i.e. a case with no full
  text, whose correct chunk count is zero. Step 5 asserts this explicitly so
  nobody "fixes" it later.
- **Changed**: a >40-chunk import now throws `fts_chunk_count_too_large` (400)
  where it previously succeeded across three transactions. That path needs ~5 MB
  of canonical text. `handleCreate`/`handleUpdate` already surface
  `StorageBoundaryError` as a typed 4xx, and the queue path retries and then
  dead-letters it — both loud, neither silent.

**3c.** Replace any remaining bare `20` literal in this file's batching loops
with the appropriate named constant (`rebuildAggregates`'s is gone after Step 2;
`putImportedCase`'s loop is gone entirely after 3b). Do not touch the unrelated
`slice(0, 20)` at line 845 or any `LIMIT 20` in SQL.

**3d — NOT in this plan, and deliberately so.** `putImportedCase` still writes
its judge batch, its concept batch and its chunk batch as three separate
transactions, and its judge/concept batches still carry per-label statements
(up to ~403 at the 100-label cap). The `json_each` shape from Step 3a would fix
that too, but folding it in here would put three more SQL rewrites inside a plan
whose changes are otherwise verifiable by the tests written in Step 5, on the
one method whose statement text is pinned by an out-of-scope contract test. It
is recorded as the top follow-up in "Maintenance notes" with the exact recipe.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs && cd workers && npx vitest run`
→ bundle line printed, then zero failures and a total still equal to
`BEFORE_WORKER`. In particular this named test must still pass:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-contracts.test.js -t "projects normalised judges and concepts back to the legacy case API shape"
```
→ `Tests 1 passed`, `0 failed`.

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
→ zero failures and a total of `BEFORE_QUEUE + 5` (`11 passed` if you started
from the `42826a3` baseline of 6). Also confirm each new test by name, so a typo
in an `it(...)` title cannot be mistaken for a passing suite:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers"
for t in "isolates a poison message from the rest of its batch" \
         "dead-letters a message whose kind no processor claims" \
         "dead-letters a case.reindex event whose case_id is not a string" \
         "keeps messages un-acked when the aggregate rebuild fails" \
         "retries a dead-letter message when the DLQ recorder fails"; do
  npx vitest run __tests__/cloudflare-native-queue.test.js -t "$t" 2>&1 | grep -E 'Tests +[0-9]+ passed|No test files|0 passed'
done
```
→ each line reports `Tests 1 passed`; none reports `0 passed`.

### Step 5: Pin the D1 batch grouping, and prove it under an injected failure

Create `workers/__tests__/cloudflare-storage-atomicity.test.js`. This file must
import the **real** `../storage/cloudflare.js` (no `vi.mock` of it) and drive it
with a D1 mock that records how statements were grouped into `batch()` calls.

**A recording mock alone is not enough** — it can show that statements were
grouped, but it cannot show what a database would *contain* after a mid-rebuild
failure, which is the property this plan actually claims. So the mock below
also maintains a tiny transactional table-state map: `batch()` applies a whole
group's `DELETE`/`INSERT` effects or none of them, exactly as D1 does. Tests 6–8
then inject a failure into a chosen batch and read the resulting state back.

This is a *model* of D1, not D1. It is honest about what it proves: that your
statement **grouping** cannot leave a table empty or a case text truncated. It
does not execute SQL, so it cannot catch a wrong `GROUP BY` or a misspelled
column. `plans/038-test-the-production-sql-layer.md` builds a real-schema SQLite
harness; when that lands, these three tests should be ported onto it. Do **not**
add a dependency on 038 — this plan must be executable on its own.

Scaffold:

```js
import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareStores } from "../storage/cloudflare.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";

/**
 * A D1 stand-in that records batch grouping AND models D1's per-batch
 * transaction: a batch either applies every statement's effect on `tables` or
 * none of them. `failOnBatch` injects a rejection at a chosen 0-based index.
 */
function d1({ changes = 1, failOnBatch = null } = {}) {
  const batches = [];
  const ran = [];
  // table name -> array of {sql, params} rows currently "in" that table.
  const tables = new Map();
  const seed = (table, rows) => tables.set(table, [...rows]);
  const effectsOf = (statement) => {
    const del = /^\s*DELETE FROM (\w+)\b/.exec(statement.sql || "");
    if (del) return { table: del[1], kind: "delete" };
    const ins = /INSERT (?:OR IGNORE )?INTO (\w+)\b/.exec(statement.sql || "");
    if (ins) return { table: ins[1], kind: "insert" };
    return null;
  };
  return {
    batches,
    ran,
    tables,
    seed,
    rowsIn: (table) => tables.get(table) || [],
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => { statement.params = params; return statement; };
      statement.all = vi.fn(async () => ({ results: [] }));
      statement.first = vi.fn(async () => null);
      statement.run = vi.fn(async () => { ran.push(statement); return { meta: { changes } }; });
      return statement;
    },
    batch: vi.fn(async (statements) => {
      const index = batches.length;
      batches.push(statements);
      if (failOnBatch !== null && index === failOnBatch) {
        // Nothing is applied: this models D1 rolling the whole batch back.
        throw new Error(`injected D1 batch failure at index ${index}`);
      }
      for (const statement of statements) {
        const effect = effectsOf(statement);
        if (!effect) continue;
        if (effect.kind === "delete") tables.set(effect.table, []);
        else tables.set(effect.table, [...(tables.get(effect.table) || []), { sql: statement.sql, params: statement.params }]);
      }
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
3. **`writes every chunk of an imported case in one transaction`** — call
   `stores.caseStore.putImportedCase({ case: { case_id: "0123456789ab", citation: "[2026] FCA 1", title: "Example v Minister", court_code: "FCA", year: 2026 }, sourcePointer: SOURCE_POINTER, textChunks: ["first chunk", "second chunk"] })`.
   Assert: **exactly one** batch contains any `case_text_chunks` statement, and
   it contains both the `DELETE FROM case_text_chunks` and both
   `INSERT INTO case_text_chunks` statements; `catalog.ran` contains **no**
   statement whose sql includes `DELETE FROM case_text_chunks` (proving it is no
   longer a standalone `run()`); and the two chunk inserts carry `chunk_index`
   `0` and `1` in their `params[1]`.
4. **`stores no chunks for a case that has no full text`** — same call with
   `textChunks: []`. Assert the chunk batch contains the `DELETE` and **no**
   `INSERT INTO case_text_chunks`, and that `catalog.rowsIn("case_text_chunks")`
   is `[]`. This pins the correct semantics for a text-less case so nobody
   "restores" chunks that should not exist. (It is the counter-example to the
   invariant: the guarantee is "a case that *has* text is never observable with
   zero chunks", not "no case ever has zero chunks".)
5. **`writes a case row and its relations in one transaction`** — call
   `stores.caseStore.updateCaseFields("0123456789ab", { title: "Updated", judges: ["Perram J"], legal_concepts: ["procedural fairness"] })`.
   Assert exactly one `batch()` call was made, and that this single batch
   contains a statement whose sql includes `UPDATE cases SET`, one including
   `DELETE FROM case_judges`, and one including `DELETE FROM case_concepts`.
6. **`keeps a case edit in one transaction at the relation-label cap`** — the
   regression guard for the defect the `json_each` rewrite fixes. Call
   `updateCaseFields` with `judges: Array.from({ length: 100 }, (_, i) => \`Judge ${i}\`)`
   and `legal_concepts: Array.from({ length: 100 }, (_, i) => \`Concept ${i}\`)`.
   Assert `catalog.batch` was called exactly **once** and that the single batch
   has **7** statements. On the pre-`json_each` code this batch would have had
   403 statements, or been split — either way this test fails.
7. **`leaves no aggregate table empty when a later rebuild batch fails`** — build
   the catalog with `d1({ failOnBatch: 1 })`, seed every one of the 17 aggregate
   tables with one placeholder row via `catalog.seed(table, [{ sql: "seed", params: [] }])`,
   then
   `await expect(stores.caseStore.rebuildAggregates()).rejects.toThrow(/injected D1 batch failure/)`.
   Then assert, for **all 17** table names: `catalog.rowsIn(table).length > 0`.
   This is the property the plan claims — no table is ever observably empty —
   and it fails on today's code, where batch 0 is 20 `DELETE`s and would leave
   20 tables at zero rows. Also assert that the tables named in the
   `cloudflare.aggregate_rebuild_partial` log line (spy on `console.error` and
   parse the JSON) are exactly the tables whose rows changed from the seeded
   placeholder, i.e. that the log does not over- or under-report what committed.
8. **`leaves the previous chunks intact when the chunk transaction fails`** —
   build the catalog with `failOnBatch` set to the index of the chunk batch
   (find it by running the same import once against a non-failing binding and
   recording `batches.findIndex((statements) => statements.some((s) => s.sql.includes("case_text_chunks")))`),
   seed `case_text_chunks` with two placeholder rows, and assert the import
   rejects and `catalog.rowsIn("case_text_chunks")` still has those two rows.
9. **`still reports a missing case as a 404`** — build the catalog with
   `d1({ changes: 0 })` and assert
   `await expect(stores.caseStore.updateCaseFields("0123456789ab", { title: "Updated" })).rejects.toMatchObject({ code: "case_not_found", status: 404 })`.

That is **9** tests in this file (the two originally-planned grouping tests, the
chunk tests, the two relation tests, the two failure-injection tests, and the
404). If you write fewer, say which and why in your report.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-atomicity.test.js`
→ `Test Files 1 passed (1)`, `Tests 9 passed (9)`. A per-file count is used here
deliberately: it is stable no matter what the sibling plans do to the suite
total.

**Prove tests 6 and 7 are real regression guards, not tautologies.** Both must
fail against the pre-change code:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git stash push -- workers/storage/cloudflare.js
cd workers && npx vitest run __tests__/cloudflare-storage-atomicity.test.js -t "leaves no aggregate table empty when a later rebuild batch fails"
npx vitest run __tests__/cloudflare-storage-atomicity.test.js -t "keeps a case edit in one transaction at the relation-label cap"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git stash pop
```
→ both runs report `1 failed` while stashed, and pass again after `stash pop`.
If either **passes** while stashed, the test is not testing what it claims —
fix the test, do not proceed.

Then the whole suite:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run`
→ zero failures, total equal to `BEFORE_WORKER + 14` (5 queue tests + 9 here).

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
- `cloudflare-storage-atomicity.test.js` (new file, +9): aggregate
  DELETE/INSERT co-location, one truncation per table, single-transaction chunk
  write and flat `chunk_index`, the zero-chunk-for-text-less-case case,
  single-transaction case edit, the 100+100-label edit staying at 7 statements,
  **the two failure-injection tests** (no aggregate table left empty; previous
  chunks intact), and the preserved 404.

Structural pattern for the new file's D1 mock: `workers/__tests__/cloudflare-storage-contracts.test.js:22-60`
(its `d1()` / `env()` helpers) — the version in this plan extends that idea with
per-`batch()` recording **and** a transactional table-state model, which is what
lets tests 7 and 8 assert on resulting state rather than on grouping alone.

Regression safety net: the full Worker suite (record `BEFORE_WORKER` first; it
must end at `BEFORE_WORKER + 14` with zero failures) plus
`node scripts/check_cloudflare_native_bundle.mjs`, plus the two Python boundary
tests that read `workers/cloudflare-native.js`.

**Known gap, stated rather than papered over**: no test in this repo executes any
of this SQL against a schema, so nothing here can catch a wrong column list or a
broken `json_each` projection. The `json_each` statements in Step 3a are the
riskiest text in this plan for exactly that reason. Before reporting done, run
them once by hand against a scratch SQLite to prove the projection works:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && python3 - <<'PY'
import sqlite3, json
c = sqlite3.connect(":memory:")
c.executescript(open("migrations/d1/catalog/0001_catalog.sql").read())
payload = json.dumps([{"id": "a"*32, "label": "Perram J"}, {"id": "b"*32, "label": "Mortimer CJ"}])
c.execute("""INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at)
             SELECT json_extract(value,'$.id'), json_extract(value,'$.label'), ?, ? FROM json_each(?)""",
          ("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", payload))
print(sorted(r[1] for r in c.execute("SELECT judge_id, canonical_name FROM judges")))
PY
```
→ prints `['Mortimer CJ', 'Perram J']`. If it errors, the SQL in Step 3a is wrong
and must be fixed before you commit — a green Vitest run would not have told you.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node scripts/check_cloudflare_native_bundle.mjs` exits 0
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` exits 0 with **zero failures**, and its `Tests … passed` total equals `BEFORE_WORKER + 14`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-storage-atomicity.test.js` reports `Tests 9 passed (9)`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run __tests__/cloudflare-native-queue.test.js` reports `BEFORE_QUEUE + 5` passed, 0 failed
- [ ] The five named queue tests and the nine named atomicity tests each report `Tests 1 passed` when run with `-t "<title>"` (no `0 passed`, no `No test files`)
- [ ] The stash check in Step 5 showed both regression guards **failing** against the unmodified `workers/storage/cloudflare.js`
- [ ] The hand-run `json_each` SQLite probe in "Test plan" printed `['Mortimer CJ', 'Perram J']`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_native_effective_references.py tests/test_native_pipeline_boundary.py -q` reports `6 passed`
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` shows failures **only** in `tests/test_backfill_judge_overrides_from_pdf.py`, and they are still exactly the three `pyexpat`/`pypdf` ImportErrors, by name: `make test-py 2>&1 | grep -E '^(FAILED|ERROR)' | sort -u` lists nothing outside that file
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` prints `All checks passed!`
- [ ] `grep -n "for (const message of messages) if (typeof message?.ack === \"function\") message.ack();" workers/cloudflare-native.js` returns **no match** (the unconditional whole-batch ack is gone)
- [ ] `grep -c "cloudflare.queue.unhandled_message" workers/cloudflare-native.js` returns `1`
- [ ] `grep -c "cloudflare.aggregate_rebuild_partial" workers/storage/cloudflare.js` returns `1`
- [ ] `grep -c "D1_BATCH_STATEMENT_LIMIT" workers/storage/cloudflare.js` returns `3` or more (declaration + the `rebuildAggregates` packer + the `updateCaseFields` assertion), and `grep -c "D1_CHUNK_TRANSACTION_STATEMENT_LIMIT" workers/storage/cloudflare.js` returns `2`
- [ ] `grep -n "await this.db.prepare(\`DELETE FROM case_text_chunks WHERE case_id = ?\`).bind(caseId).run()" workers/storage/cloudflare.js` returns **no match**
- [ ] `grep -c "json_each" workers/storage/cloudflare.js` returns `5` (the pre-existing `findByIds` use plus the four new relation statements)
- [ ] `git status --short` lists only: `workers/cloudflare-native.js`, `workers/storage/cloudflare.js`, `workers/__tests__/cloudflare-native-queue.test.js`, `workers/__tests__/cloudflare-storage-atomicity.test.js`, this plan file if you updated its status row, and anything you recorded as already-dirty at Step 0
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
- The worker suite total drops below `BEFORE_WORKER` at any point (that means a
  pre-existing test was deleted or skipped — report the delta, do not adjust the
  expectation), or a step's verification fails twice after a reasonable fix
  attempt.
- The `json_each` SQLite probe in "Test plan" errors. Do not guess at the SQL
  dialect; report the error.
- Either stash check in Step 5 shows a "regression guard" passing against the
  unmodified source. The test is then proving nothing and must be fixed before
  the step counts as done.
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
- **Required follow-up #1 — a genuinely atomic aggregate rebuild.** This plan
  gives per-table atomicity only; a failure between batches still leaves a mixed
  generation across the 17 tables. The design that fixes it properly:
  (a) add a `generation` INTEGER column to each aggregate table, or write into
  shadow tables named `<table>__next`; (b) populate the new generation without
  touching the live rows; (c) flip a single `catalog_summary` pointer row (or
  `ALTER TABLE ... RENAME`) in one final small transaction; (d) delete the
  superseded generation lazily. That needs a catalog migration, a change to every
  aggregate reader in `workers/case-api/cloudflare.js`, and a backfill — i.e. its
  own plan, not a step here. Until it exists, treat
  `cloudflare.aggregate_rebuild_partial` in Logpush as the signal that analytics
  is internally inconsistent, and re-drive a `catalog.rebuild` message to repair
  it.
- **Required follow-up #2 — bound the rebuild itself.** `rebuildAggregates()`
  still re-derives all 17 tables from full corpus scans on **every** changed
  queue batch (`max_batch_size = 20`), so a bulk import of 10,000 cases triggers
  ~500 whole-corpus rebuilds. Coalescing them needs a durable dirty flag plus a
  debounce (a cron trigger or a delayed queue message), retention for the
  aggregate history, and a rollback path. `plans/014-*.md` carries a partial
  recipe in its Maintenance notes; neither that recipe nor this note is an
  executable plan, and one should be written.
- **Required follow-up #3 — `putImportedCase` relation batching.** It still
  issues the case upsert, the judge batch, the concept batch and the chunk batch
  as four separate D1 transactions, and the judge/concept batches still emit
  per-label statements up to ~403 at the `normaliseRelationLabels` cap of 100
  (`workers/storage/cloudflare.js:232`). The fix is mechanical now that Step 3a
  exists: replace both loops with the same `json_each` shape (4 statements
  instead of up to 402), then fold the case upsert, both relation groups and the
  chunk group into one `db.batch()` — at most `1 + 3 + 3 + 1 + chunks.length`
  statements, which the Step 3b ceiling already covers. It was left out of this
  plan only because it is the one method whose statement text is pinned by an
  out-of-scope contract test. The exposure is bounded today: the queue path
  self-heals because
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
  tests `truncates each aggregate table exactly once` and `leaves no aggregate
  table empty when a later rebuild batch fails` will both need their expected
  count of 17 bumped.
- **The Step 5 D1 fake is a model, not a database.** It proves grouping and
  transaction boundaries; it executes no SQL. When
  `plans/038-test-the-production-sql-layer.md` lands its real-schema SQLite
  harness, port tests 1, 2, 7 and 8 onto it — they are the ones whose value
  would go up an order of magnitude with a real engine underneath.
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

## Review points not applied

One sub-claim from the review was checked against the code and does not hold.
Everything else the reviewer raised about this plan is applied above.

- **"`textChunks=[]` is still delete-only, so the 'never zero chunks' guarantee
  does not hold."** The observation is factually right and the *wording* of the
  guarantee was indeed sloppy (fixed above), but the behaviour is not a defect
  and must not be "fixed". `splitFtsChunks` refuses empty input —
  `workers/storage/pipeline_coordinator.js:38` calls
  `requiredText(text, "canonicalText")`, which throws
  `canonicalText is required` at `:30-34` — so the pipeline path can never
  deliver `[]`. The only producers of `[]` are
  `workers/case-api/cloudflare_mutations.js:206` and `:226`, both of which read
  `textChunks: text ? splitFtsChunks(text) : []`: a case created or updated with
  no full text at all. For such a case, zero rows in `case_text_chunks` is the
  correct end state, and deleting stale rows with nothing to replace them is the
  intended behaviour. Making the delete conditional on a non-empty chunk list
  would instead strand a previous import's chunks under a case that no longer
  has that text — a real correctness bug introduced to satisfy a mis-stated
  invariant. The plan now states the invariant precisely ("a case that *has*
  full text is never observable with zero chunks") and Step 5 test 4 pins the
  empty case so the distinction survives.

- **Partially applied, recorded for honesty**: the reviewer's preferred remedies
  for the rebuild ("confirm 41 statements fit one D1 batch, else shadow
  tables/generations") and for the chunks ("versioned chunks, or upsert-all then
  delete the stale tail") are both rejected *as steps of this plan*, with
  reasons stated inline: the first cannot be verified from this working copy
  (empty local D1, no published D1 statement-count limit) and shipping an
  unverified mega-transaction trades a known failure mode for an unknown one;
  the second is blocked by `workers/__tests__/cloudflare-storage-contracts.test.js:202-203`,
  which pins `DELETE FROM case_text_chunks WHERE case_id = ?` to exactly one
  bound parameter and is out of scope for this plan. The underlying concerns are
  addressed differently — per-table atomicity plus a partial-rebuild log for the
  first, a single unbounded-then-ceilinged chunk transaction for the second —
  and the reviewer's designs are carried into "Maintenance notes" as required
  follow-ups rather than dropped.
