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
  if (env.NATIVE_PIPELINE_ENABLED === "true" && !env.NATIVE_CASE_QUEUE) {
    retryAll(messages, "missing_native_case_queue");
    return;
  }
  if (env.NATIVE_PIPELINE_ENABLED !== "true") {
    retryAll(messages, "native_pipeline_required");
    return;
  }

  const remaining = await getRemainingCostUsd(env, runId);
  if (remaining <= 0) {
    await updatePipelineRun(env, runId, {
      status: "aborted",
      abortReason: "cost_cap_hit",
    }).catch(() => undefined);
    for (const message of messages) message.ack();
    console.warn(JSON.stringify({ event: "extract.aborted.cost_cap_hit", run_id: runId }));
    await sendPipelineAlert(env, "cost cap hit", { run_id: runId, remaining_usd: remaining });
    return;
  }

  let payloadBatch;
  try {
    payloadBatch = await Promise.all(messages.map((message) => buildInternalExtractItem(env, message.body)));
  } catch (err) {
    retryAll(messages, err instanceof Error ? err.message : String(err));
    return;
  }

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
  console.log(JSON.stringify({
    event: "extract.batch.ok",
    run_id: runId,
    extracted: response.extracted.length,
    upserted,
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

async function enqueueNativeExtractedResults(
  env: Env,
  runId: string,
  extracted: ExtractedCase[],
): Promise<number> {
  if (!env.NATIVE_CASE_QUEUE) throw new Error("NATIVE_CASE_QUEUE is required for native extraction");
  let count = 0;
  for (const item of extracted) {
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
  }
  return count;
}

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
