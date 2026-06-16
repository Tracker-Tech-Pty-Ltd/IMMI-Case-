import {
  addPipelineRunMetrics,
  updatePipelineRun,
  upsertExtractedCase,
} from "./pipeline-db";
import { sendPipelineAlert } from "./alerts";
import type {
  Env,
  ExtractJob,
  ExtractedCase,
  InternalExtractResponse,
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

  if (!env.FLASK_BACKEND) {
    retryAll(messages, "missing_flask_backend");
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

  const upserted = await upsertExtractedResults(env, runId, response.extracted);
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
    const response = await env.FLASK_BACKEND!.fetch("https://internal/internal/extract", {
      method: "POST",
      headers: {
        "X-Internal-Route": "worker",
        "X-Internal-Route-Subtype": "cron-extract",
        "Content-Type": "application/json",
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

async function upsertExtractedResults(
  env: Env,
  runId: string,
  extracted: ExtractedCase[],
): Promise<number> {
  let count = 0;
  for (const item of extracted) {
    const status = await upsertExtractedCase(env, runId, item);
    if (status !== "skipped") count += 1;
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
