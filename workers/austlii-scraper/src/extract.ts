import {
  addPipelineRunMetrics,
  markNativeOutboxAttempt,
  markNativeOutboxPublished,
  stageNativeOutboxEvent,
  updatePipelineRun,
} from "./pipeline-db";
import { sendPipelineAlert } from "./alerts";
import type {
  Env,
  ExtractJob,
  ExtractedCase,
  InternalExtractResponse,
  NativeCaseEvent,
  ScrapeResult,
} from "./types";

const DEFAULT_CONTAINER_TIMEOUT_MS = 300_000;
const DEFAULT_RUN_COST_CAP_USD = 5;
const DEFAULT_MONTHLY_COST_CAP_USD = 10;

/**
 * Upper-bound cost assumed per case when reserving budget, before the container
 * reports what it actually spent.
 *
 * A reservation has to be made BEFORE the paid call, and the true price is not
 * known until after it — so some estimate is unavoidable. Over-estimating is the
 * safe direction: the settle immediately returns whatever was not used, so the
 * only cost of a high estimate is that the last batch before the cap may be
 * refused slightly early. Under-estimating would reintroduce the overspend this
 * machinery exists to prevent. Override with PIPELINE_ESTIMATED_CASE_COST_USD
 * once real per-case figures are in the run metrics.
 */
const DEFAULT_ESTIMATED_CASE_COST_USD = 0.1;

export async function handleExtractBatch(
  batch: MessageBatch<ExtractJob>,
  env: Env,
): Promise<void> {
  const groups = groupByRun(batch.messages);
  for (const [runId, messages] of groups) {
    await handleRunExtractMessages(runId, messages, env);
  }
}

async function handleRunExtractMessages(
  runId: string,
  messages: readonly Message<ExtractJob>[],
  env: Env,
): Promise<void> {
  if (env.PIPELINE_ENABLED !== "true") {
    for (const message of messages) message.ack();
    console.log(JSON.stringify({ event: "extract.skipped.pipeline_disabled", run_id: runId, count: messages.length }));
    return;
  }

  if (!env.EXTRACTION_BACKEND) {
    retryAll(messages, "missing_extraction_backend");
    return;
  }
  if (!env.EXTRACTION_SHARED_SECRET) {
    retryAll(messages, "missing_extraction_shared_secret");
    return;
  }
  if (!env.COST_CAP_DO) {
    retryAll(messages, "missing_cost_cap_do");
    await sendPipelineAlert(env, "cost cap binding missing", { run_id: runId });
    return;
  }
  if (env.NATIVE_PIPELINE_ENABLED === "true" && !env.NATIVE_CASE_QUEUE) {
    retryAll(messages, "missing_native_case_queue");
    return;
  }
  if (env.NATIVE_PIPELINE_ENABLED !== "true") {
    retryAll(messages, "native_pipeline_required");
    return;
  }

  // IDEMPOTENCY KEY for the whole paid step. Derived from the run and the exact
  // set of cases in this batch, so a redelivery of the same message computes the
  // same key and finds the result the first delivery already bought. Sorted, so
  // the platform is free to reorder messages within a batch.
  const ledgers = costLedgerNames(runId);
  const batchDigest = await sha256Hex(`${runId}\n${messages.map((m) => m.body.case_id).slice().sort().join(",")}`);
  const batchKey = `pipeline/${runId}/_batches/${batchDigest}.json`;
  const reservationId = `extract:${runId}:${batchDigest}`;

  // Was this exact batch already extracted? The backend response is persisted
  // BEFORE the ledger is settled, so a crash anywhere after the paid call still
  // leaves the result recoverable. Previously the only de-duplication was the
  // outbox check inside the staging loop — far too late, because the container
  // had already been called and billed by the time it ran.
  let response = await readCachedBatchResponse(env, batchKey, runId);

  if (!response) {
    const budget = await checkCostBudget(env, runId);
    if (budget.state === "unavailable") {
      // A ledger we cannot read is an infrastructure fault, not a spent budget.
      // Retry (max_retries then DLQ) so the work survives and an operator sees it.
      retryAll(messages, "cost_ledger_unavailable");
      await sendPipelineAlert(env, "cost ledger unavailable", { run_id: runId });
      return;
    }
    if (budget.state === "exhausted") {
      await abortRunForCostCap(env, runId, messages, budget.remaining);
      return;
    }

    // Built before the reservation on purpose: a missing or malformed R2 scrape
    // result must not leave budget held while the message retries.
    let payloadBatch;
    try {
      payloadBatch = await Promise.all(messages.map((message) => buildInternalExtractItem(env, message.body)));
    } catch (err) {
      retryAll(messages, err instanceof Error ? err.message : String(err));
      return;
    }

    // RESERVE BEFORE SPENDING. `remaining > 0` is not permission to spend an
    // unknown amount: a run with $0.01 left must not start a batch that will
    // cost $0.10. The reservation is the only point at which the cap can still
    // refuse, because after this line the money is committed.
    const estimateUsd = estimateBatchCostUsd(env, messages.length);
    const reservation = await reserveCostUsd(env, ledgers, runId, reservationId, estimateUsd);
    if (reservation === "refused") {
      await abortRunForCostCap(env, runId, messages, estimateUsd);
      return;
    }
    if (reservation === "unavailable") {
      retryAll(messages, "cost_ledger_unavailable");
      await sendPipelineAlert(env, "cost ledger unavailable", { run_id: runId });
      return;
    }

    response = await callInternalExtract(env, runId, payloadBatch);
    if (!response) {
      // Nothing was billed, so give the headroom straight back rather than
      // letting a transient 503 shrink the run's budget.
      await releaseCostReservation(env, ledgers, runId, reservationId);
      retryAll(messages, "internal_extract_unavailable");
      return;
    }

    // Durable BEFORE the settle, and before anything else that can fail. This
    // is what makes the redelivery above cheap instead of a second purchase.
    if (!await persistBatchResponse(env, batchKey, response, runId)) {
      // We cannot prove the result is recoverable, so treat the spend as
      // unreconciled: leave the reservation held (it blocks further paid work)
      // and retry. Better to stall the run than to buy this batch repeatedly.
      retryAll(messages, "batch_result_not_persisted");
      await sendPipelineAlert(env, "extraction result could not be persisted", { run_id: runId, batch_key: batchKey });
      return;
    }
  }

  // Settle with the ACTUAL cost. Idempotent by reservation id, so the cached
  // path above may re-enter here safely: a settle whose reservation is already
  // gone is a no-op, never a second charge. A settle that fails leaves the hold
  // in place, which is deliberate — unreconciled spend must block new paid work
  // rather than be logged and walked past.
  await settleCostUsd(env, ledgers, runId, reservationId, response.cost_usd);

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
}

async function buildInternalExtractItem(env: Env, job: ExtractJob) {
  const object = await env.CASE_RESULTS.get(job.r2_key);
  if (!object) {
    throw new Error(`Missing R2 scrape result: ${job.r2_key}`);
  }
  const result = await object.json<ScrapeResult>();
  if (!result.success || !result.full_text) {
    throw new Error(`Invalid scrape result for ${job.case_id}`);
  }

  return {
    case_id: job.case_id,
    r2_key: job.r2_key,
    base: {
      ...result,
      full_text: result.full_text,
      text_snippet: result.full_text.slice(0, 500),
      year: yearFromText(result.date),
    },
  };
}

async function callInternalExtract(
  env: Env,
  runId: string,
  batch: unknown[],
): Promise<InternalExtractResponse | null> {
  const timeoutMs = positiveInt(env.PIPELINE_CONTAINER_EXTRACT_TIMEOUT_MS, DEFAULT_CONTAINER_TIMEOUT_MS);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  try {
    const response = await env.EXTRACTION_BACKEND!.fetch("https://internal/internal/extract", {
      method: "POST",
      headers: {
        "X-Internal-Route": "worker",
        "X-Internal-Route-Subtype": "cron-extract",
        "Content-Type": "application/json",
        ...(env.EXTRACTION_SHARED_SECRET ? { "X-Extraction-Token": env.EXTRACTION_SHARED_SECRET } : {}),
      },
      body: JSON.stringify({ run_id: runId, batch }),
      signal: ctl.signal,
    });

    if (!response.ok) {
      console.warn(JSON.stringify({
        event: "extract.internal.failed",
        run_id: runId,
        status: response.status,
      }));
      await sendPipelineAlert(env, "internal extract failed", { run_id: runId, status: response.status });
      return null;
    }

    const body = await response.json<InternalExtractResponse>();
    if (!Array.isArray(body.extracted)) return null;
    return {
      extracted: body.extracted.map((item) => normalizeExtracted(item)),
      llm_calls: positiveNumber(body.llm_calls, 0),
      cost_usd: positiveNumber(body.cost_usd, 0),
    };
  } catch (err) {
    console.warn(JSON.stringify({
      event: "extract.internal.error",
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    }));
    await sendPipelineAlert(env, "internal extract error", {
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface EnqueueOutcome {
  upserted: number;
  /** Input case ids that reached D1/R2/queue successfully. Ack ONLY these. */
  stagedCaseIds: Set<string>;
  failedCaseIds: Set<string>;
}

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
      const fields = Object.fromEntries(Object.entries(item.fields || {}).map(([name, envelope]) => [name, envelope.value]));
      const record = { ...(item.base || {}), ...fields, case_id: item.case_id };
      const canonicalText = String(item.base?.full_text || item.base?.text_snippet || `${record.title || ""} ${record.citation || ""}`).trim();
      if (!canonicalText) throw new Error(`Missing canonical text for ${item.case_id}`);
      const audit = Object.entries(item.fields || {}).map(([fieldName, envelope]) => ({
        fieldName,
        oldValue: null,
        newValue: String(envelope.value ?? ""),
        source: envelope.source,
        confidence: envelope.confidence,
      })).filter((entry) => entry.newValue !== "");
      const payload = JSON.stringify({ record, canonicalText, audit });
      const bytes = new TextEncoder().encode(payload);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const payloadKey = `pipeline/${runId}/${item.case_id}.json`;
      await env.CASE_RESULTS.put(payloadKey, bytes, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { sha256, bytes: String(bytes.byteLength) },
      });
      const event: NativeCaseEvent = {
        kind: "case.extracted",
        event_id: `case.extracted:${runId}:${item.case_id}`,
        run_id: runId,
        payload_key: payloadKey,
        payload_sha256: sha256,
        payload_size: bytes.byteLength,
        payload_content_type: "application/json",
      };
      const outboxState = await stageNativeOutboxEvent(env, {
        eventId: event.event_id,
        runId,
        eventKind: event.kind,
        payloadKey,
        payloadSha256: sha256,
      });
      if (outboxState !== "published") {
        await markNativeOutboxAttempt(env, event.event_id);
        await env.NATIVE_CASE_QUEUE.send(event);
        await markNativeOutboxPublished(env, event.event_id);
      }
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

function ledgerCap(env: Env, ledger: string): number {
  return ledger.startsWith("month:")
    ? positiveNumber(env.PIPELINE_MONTHLY_HARD_CAP_USD, DEFAULT_MONTHLY_COST_CAP_USD)
    : positiveNumber(env.PIPELINE_RUN_COST_CAP_USD, DEFAULT_RUN_COST_CAP_USD);
}

/** Upper bound this batch is allowed to cost. See DEFAULT_ESTIMATED_CASE_COST_USD. */
function estimateBatchCostUsd(env: Env, caseCount: number): number {
  const perCase = positiveNumber(env.PIPELINE_ESTIMATED_CASE_COST_USD, DEFAULT_ESTIMATED_CASE_COST_USD);
  return Math.max(perCase, perCase * Math.max(1, caseCount));
}

type ReservationOutcome = "granted" | "refused" | "unavailable";

/**
 * Hold `usd` on BOTH ledgers, or hold on neither.
 *
 * The two ledgers are separate Durable Objects, so there is no single atomic
 * operation across them. The compensating release below is what keeps a partial
 * reservation from stranding the run ledger's budget when the month ledger is
 * the one that refuses.
 */
async function reserveCostUsd(
  env: Env,
  ledgers: readonly [string, string],
  runId: string,
  reservationId: string,
  usd: number,
): Promise<ReservationOutcome> {
  if (!env.COST_CAP_DO) return "unavailable";
  const granted: string[] = [];
  for (const ledger of ledgers) {
    let outcome: ReservationOutcome;
    try {
      const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(ledger));
      const response = await stub.fetch("https://cost/reserve", {
        method: "POST",
        body: JSON.stringify({ reservation_id: reservationId, usd, cap: ledgerCap(env, ledger) }),
      });
      const body = await response.json<{ ok?: boolean }>();
      outcome = body?.ok === true ? "granted" : "refused";
    } catch (err) {
      console.error(JSON.stringify({
        event: "extract.cost_cap.reserve_unavailable",
        ledger,
        run_id: runId,
        error: err instanceof Error ? err.message : String(err),
      }));
      outcome = "unavailable";
    }
    if (outcome !== "granted") {
      for (const held of granted) await releaseOne(env, held, runId, reservationId);
      if (outcome === "refused") {
        console.warn(JSON.stringify({
          event: "extract.cost_cap.reserve_refused", ledger, run_id: runId, requested_usd: usd,
        }));
      }
      return outcome;
    }
    granted.push(ledger);
  }
  return "granted";
}

/**
 * Convert both holds into recorded spend at the real price.
 *
 * A failure here is loud and still never triggers a retry of the paid call —
 * the money is gone, so re-running the batch would spend more. What it DOES do
 * is leave the reservation in place, so the unreconciled amount keeps counting
 * against the cap and the next batch is refused until an operator looks. The
 * previous implementation logged the failure and let the run continue against a
 * ledger that had no idea the money had been spent.
 */
async function settleCostUsd(
  env: Env,
  ledgers: readonly [string, string],
  runId: string,
  reservationId: string,
  usd: number,
): Promise<void> {
  if (!env.COST_CAP_DO) return;
  for (const ledger of ledgers) {
    try {
      const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(ledger));
      const response = await stub.fetch("https://cost/settle", {
        method: "POST",
        body: JSON.stringify({ reservation_id: reservationId, usd }),
      });
      if (!response.ok) throw new Error(`settle rejected with ${response.status}`);
    } catch (err) {
      console.error(JSON.stringify({
        event: "extract.cost_cap.settle_failed",
        ledger,
        run_id: runId,
        reservation_id: reservationId,
        usd,
        error: err instanceof Error ? err.message : String(err),
      }));
      await sendPipelineAlert(env, "cost ledger settle failed — reservation left held", {
        run_id: runId, ledger, usd, reservation_id: reservationId,
      });
    }
  }
}

async function releaseCostReservation(
  env: Env,
  ledgers: readonly [string, string],
  runId: string,
  reservationId: string,
): Promise<void> {
  for (const ledger of ledgers) await releaseOne(env, ledger, runId, reservationId);
}

async function releaseOne(env: Env, ledger: string, runId: string, reservationId: string): Promise<void> {
  if (!env.COST_CAP_DO) return;
  try {
    const stub = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(ledger));
    await stub.fetch("https://cost/release", {
      method: "POST",
      body: JSON.stringify({ reservation_id: reservationId }),
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: "extract.cost_cap.release_failed",
      ledger,
      run_id: runId,
      reservation_id: reservationId,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

async function abortRunForCostCap(
  env: Env,
  runId: string,
  messages: readonly Message<ExtractJob>[],
  remainingOrRequested: number,
): Promise<void> {
  await updatePipelineRun(env, runId, {
    status: "aborted",
    abortReason: "cost_cap_hit",
  }).catch(() => undefined);
  for (const message of messages) message.ack();
  console.warn(JSON.stringify({ event: "extract.aborted.cost_cap_hit", run_id: runId }));
  await sendPipelineAlert(env, "cost cap hit", { run_id: runId, remaining_usd: remainingOrRequested });
}

/** Hex SHA-256, used to key a batch by its exact case set. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Read back a previously purchased extraction result. A miss — including a
 * corrupt or unreadable object — returns null and the batch is bought again;
 * that is the safe direction, since the alternative is staging garbage.
 */
async function readCachedBatchResponse(
  env: Env,
  batchKey: string,
  runId: string,
): Promise<InternalExtractResponse | null> {
  try {
    const object = await env.CASE_RESULTS.get(batchKey);
    if (!object) return null;
    const body = await object.json<InternalExtractResponse>();
    if (!body || !Array.isArray(body.extracted)) return null;
    console.log(JSON.stringify({
      event: "extract.batch.replayed_from_cache",
      run_id: runId,
      batch_key: batchKey,
      extracted: body.extracted.length,
    }));
    return {
      extracted: body.extracted.map((item) => normalizeExtracted(item)),
      llm_calls: positiveNumber(body.llm_calls, 0),
      cost_usd: positiveNumber(body.cost_usd, 0),
    };
  } catch (err) {
    console.warn(JSON.stringify({
      event: "extract.batch.cache_read_failed",
      run_id: runId,
      batch_key: batchKey,
      error: err instanceof Error ? err.message : String(err),
    }));
    return null;
  }
}

/** Returns false if the result could not be made durable; the caller must then
 *  treat the spend as unreconciled rather than pretend the batch is safe. */
async function persistBatchResponse(
  env: Env,
  batchKey: string,
  response: InternalExtractResponse,
  runId: string,
): Promise<boolean> {
  try {
    await env.CASE_RESULTS.put(batchKey, JSON.stringify(response), {
      httpMetadata: { contentType: "application/json" },
    });
    return true;
  } catch (err) {
    console.error(JSON.stringify({
      event: "extract.batch.persist_failed",
      run_id: runId,
      batch_key: batchKey,
      error: err instanceof Error ? err.message : String(err),
    }));
    return false;
  }
}

function groupByRun(messages: readonly Message<ExtractJob>[]): Map<string, Message<ExtractJob>[]> {
  const groups = new Map<string, Message<ExtractJob>[]>();
  for (const message of messages) {
    const runId = message.body.run_id;
    const list = groups.get(runId) ?? [];
    list.push(message);
    groups.set(runId, list);
  }
  return groups;
}

function retryAll(messages: readonly Message<ExtractJob>[], reason: string): void {
  for (const message of messages) message.retry();
  console.warn(JSON.stringify({ event: "extract.batch.retry", reason, count: messages.length }));
}

function normalizeExtracted(item: ExtractedCase): ExtractedCase {
  return {
    ...item,
    fields: item.fields ?? {},
    base: item.base ?? {},
  };
}

function yearFromText(value: string): number {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
