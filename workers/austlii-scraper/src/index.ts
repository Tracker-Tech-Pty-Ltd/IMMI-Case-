/**
 * AustLII Case Scraper — Cloudflare Worker
 *
 * Cron-triggered only: the scheduled handler discovers and enqueues scrape
 * jobs; queue consumers fetch AustLII pages, parse, and store in R2.
 *
 * Architecture:
 *   cron (scheduled) → discovery → Queue → Consumer → R2
 *   sync_results.py ← R2 (via S3-compatible API)
 */

import { extractFullText, extractMetadata } from "./parser";
import { discoverCourt, runDiscoveryAndEnqueue } from "./discover";
import { handleExtractBatch } from "./extract";
import { scrapeLegislation } from "./legislation";
import { sendPipelineAlert } from "./alerts";
import { COURT_CODES, COURT_MATRIX, isBiweeklyTick } from "./pipeline-config";
import type { CourtCode } from "./pipeline-config";
import {
  addPipelineRunMetrics,
  assertSchemaConsistent,
  findCasesMissingContent,
  isPipelineStopRequested,
  latestRunningPipelineRun,
  requestPipelineStop,
  recordPipelineDeadLetter,
  startPipelineRun,
  updateControlCommand,
  updatePipelineRun,
} from "./pipeline-db";
export { CostCapDO } from "./cost-cap-do";
import type {
  Env,
  ExtractJob,
  ScrapeJob,
  ScrapeResult,
  ScrapeError,
  EnqueueRequest,
  EnqueueResponse,
  PipelineControlMessage,
} from "./types";

type QueueJob = ScrapeJob | ExtractJob;

function isDeadLetterQueue(queue: string | undefined): boolean {
  return typeof queue === "string" && queue.endsWith("-dlq");
}

async function handleDeadLetterBatch(
  batch: MessageBatch<QueueJob>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const messageId = "id" in message ? String((message as { id?: unknown }).id || "") : undefined;
      await recordPipelineDeadLetter(env, batch.queue, messageId, message.body);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: "pipeline.dlq_record_error",
        queue: batch.queue,
        error: error instanceof Error ? error.message : String(error),
      }));
      message.retry();
    }
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_BATCH_ENQUEUE = 500;

function isPipelineControl(value: unknown): value is PipelineControlMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PipelineControlMessage>;
  return item.kind === "pipeline.control"
    && typeof item.command_id === "string"
    && ["start", "stop", "download", "legislation_update"].includes(String(item.action));
}

function controlCourts(value: unknown): CourtCode[] {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set<string>(COURT_CODES);
  const courts = source.map(String).map((item) => item.toUpperCase()).filter((item): item is CourtCode => allowed.has(item));
  return courts.length ? [...new Set(courts)] : [...COURT_CODES];
}

async function handlePipelineControlBatch(
  batch: MessageBatch<PipelineControlMessage>,
  env: Env,
): Promise<void> {
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
        await updatePipelineRun(env, runId, { discovered: targets.length });
        await updateControlCommand(env, control.command_id, { status: "completed", runId });
      } else if (control.action === "legislation_update") {
        const lawIds = Array.isArray(control.law_ids) ? control.law_ids : [];
        if (!lawIds.length) throw new Error("No legislation ids were supplied");
        await updateControlCommand(env, control.command_id, { status: "running" });
        const failures: string[] = [];
        for (const lawId of lawIds) {
          try {
            await scrapeLegislation(env, lawId);
          } catch (error) {
            failures.push(`${lawId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (failures.length) throw new Error(failures.join("; "));
        await updateControlCommand(env, control.command_id, { status: "completed" });
      } else {
        const runId = await startPipelineRun(env, {
          trigger: "manual",
          courts: controlCourts(control.courts),
          phase: "discovery",
        });
        await updateControlCommand(env, control.command_id, { status: "running", runId });
        await runDiscoveryAndEnqueue(env, runId, controlCourts(control.courts));
        await updateControlCommand(env, control.command_id, { status: "completed", runId });
      }
      message.ack();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await updateControlCommand(env, control.command_id, { status: "failed", error: reason }).catch(() => undefined);
      console.error(JSON.stringify({ event: "pipeline.control.failed", command_id: control.command_id, error: reason }));
      message.retry();
    }
  }
}

// ─── HTTP Handler (Producer) ─────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "austlii-scraper",
        timestamp: new Date().toISOString(),
      });
    }

    // Cron-triggered only: the pipeline is driven exclusively by the scheduled
    // handler and queue consumers. No HTTP trigger endpoints are exposed, so
    // no AUTH_TOKEN secret is required.
    return Response.json(
      { error: "Cron-triggered only", code: "cron_only" },
      { status: 404 },
    );
  },

  // ─── Queue Consumer ──────────────────────────────────────────────────────

  async queue(
    batch: MessageBatch<QueueJob>,
    env: Env,
  ): Promise<void> {
    if (isDeadLetterQueue(batch.queue)) {
      await handleDeadLetterBatch(batch, env);
      return;
    }
    if (batch.messages.length > 0 && batch.messages.every((message) => isPipelineControl(message.body))) {
      return handlePipelineControlBatch(batch as unknown as MessageBatch<PipelineControlMessage>, env);
    }
    if (batch.messages.every((message) => isExtractJob(message.body))) {
      return handleExtractBatch(batch as MessageBatch<ExtractJob>, env);
    }

    for (const message of batch.messages) {
      const job = message.body as ScrapeJob;

      try {
        if (job.run_id && !nativePipelineReady(env)) {
          console.log(JSON.stringify({
            event: "queue.skipped.pipeline_disabled",
            run_id: job.run_id,
            case_id: job.case_id,
          }));
          message.ack();
          continue;
        }
        if (job.run_id && await isPipelineStopRequested(env, job.run_id)) {
          console.log(JSON.stringify({ event: "queue.skipped.operator_stop", run_id: job.run_id, case_id: job.case_id }));
          message.ack();
          continue;
        }

        // Resume support: skip if result already exists in R2
        const resultKey = resultJsonKey(job);
        const existing = await env.CASE_RESULTS.head(resultKey);
        if (existing) {
          await forwardToExtract(job, env, resultKey);
          message.ack();
          continue;
        }

        await rateLimitPipelineScrape(job, env);
        const result = await processJob(job, env);
        if (result.success && job.run_id) {
          await addPipelineRunMetrics(env, job.run_id, { scraped: 1 }).catch(() => undefined);
          await forwardToExtract(job, env, result.r2Key);
        }
        message.ack();
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
    }
  },

  // ─── Cron Discovery Producer ─────────────────────────────────────────────

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!nativePipelineReady(env)) {
      console.log(JSON.stringify({ event: "cron.skipped.disabled", cron: event.cron }));
      return;
    }

    if (env.PIPELINE_BIWEEKLY_GATE === "true" && !isBiweeklyTick(event.scheduledTime)) {
      console.log(JSON.stringify({
        event: "cron.skipped.off_week",
        cron: event.cron,
        scheduled_time: event.scheduledTime,
      }));
      return;
    }

    try {
      await assertSchemaConsistent(env);
    } catch (err) {
      console.log(JSON.stringify({
        event: "schema.drift.detected",
        error: err instanceof Error ? err.message : String(err),
      }));
      return;
    }

    const hour = new Date(event.scheduledTime).getUTCHours();
    const courts = COURT_MATRIX.groupForHour(hour);
    if (!courts) {
      console.log(JSON.stringify({ event: "cron.skipped.no_court_group", hour }));
      return;
    }

    let runId: string | null = null;
    try {
      runId = await startPipelineRun(env, {
        trigger: "cron",
        courts,
        phase: "discovery",
      });
    } catch (err) {
      console.error(JSON.stringify({
        event: "cron.discover.start_failed",
        error: err instanceof Error ? err.message : String(err),
      }));
      return;
    }

    ctx.waitUntil(
      runDiscoveryAndEnqueue(env, runId, courts, event.scheduledTime).catch(async (err) => {
        const error = err instanceof Error ? err.message : String(err);
        console.error(JSON.stringify({ event: "cron.discover.failed", run_id: runId, error }));
        if (runId) {
          await updatePipelineRun(env, runId, {
            errors: 1,
            errorsJson: [error],
            status: "failed",
          }).catch(() => undefined);
        }
        await sendPipelineAlert(env, "discovery failed", { run_id: runId, error });
      }),
    );
  },
};

function nativePipelineReady(env: Env): boolean {
  return env.PIPELINE_ENABLED === "true" && env.NATIVE_PIPELINE_ENABLED === "true";
}

// ─── Job Processor ────────────────────────────────────────────────────────────

async function processJob(
  job: ScrapeJob,
  env: Env,
): Promise<{ success: true; r2Key: string } | { success: false; r2Key?: string }> {
  // Fetch the AustLII page
  const response = await fetch(job.url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9",
    },
    redirect: "follow",
  });

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

  // Extract metadata from the full page text (not just the content div)
  const pageText = extractFullText(html);
  const metadata = extractMetadata(pageText);

  // Build success result
  const result: ScrapeResult = {
    case_id: job.case_id,
    url: job.url,
    citation: metadata.citation_extracted || job.citation,
    court_code: job.court_code,
    title: job.title,
    success: true,
    full_text: fullText,
    judges: metadata.judges,
    date: metadata.date,
    catchwords: metadata.catchwords,
    outcome: metadata.outcome,
    visa_type: metadata.visa_type,
    legislation: metadata.legislation,
    scraped_at: new Date().toISOString(),
  };

  // Store in R2
  const jsonKey = resultJsonKey(job);
  await env.CASE_RESULTS.put(
    jsonKey,
    JSON.stringify(result),
    { httpMetadata: { contentType: "application/json" } },
  );
  if (job.run_id) {
    await env.CASE_RESULTS.put(
      resultHtmlKey(job),
      html,
      { httpMetadata: { contentType: "text/html; charset=utf-8" } },
    );
  }
  return { success: true, r2Key: jsonKey };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function isExtractJob(job: QueueJob): job is ExtractJob {
  return job.phase === "extract" || "r2_key" in job;
}

function resultJsonKey(job: ScrapeJob): string {
  const base = pipelineRunBaseKey(job);
  return base ? `${base}.json` : `results/${job.case_id}.json`;
}

function resultHtmlKey(job: ScrapeJob): string {
  const base = pipelineRunBaseKey(job);
  return base ? `${base}.html` : `results/${job.case_id}.html`;
}

function errorJsonKey(job: ScrapeJob): string {
  const base = pipelineRunBaseKey(job);
  return base ? `${base}.error.json` : `errors/${job.case_id}.json`;
}

function pipelineRunBaseKey(job: ScrapeJob): string | null {
  if (!job.run_id) return null;
  const court = job.court_code.replace(/[^A-Za-z0-9]/g, "");
  const caseId = job.case_id.replace(/[^a-f0-9]/gi, "");
  return `runs/${job.run_id}/${court}/${caseId}`;
}

async function putScrapeError(
  job: ScrapeJob,
  env: Env,
  error: string,
  errorCode: number,
): Promise<void> {
  const errorResult: ScrapeError = {
    case_id: job.case_id,
    url: job.url,
    citation: job.citation,
    court_code: job.court_code,
    title: job.title,
    success: false,
    error,
    error_code: errorCode,
    scraped_at: new Date().toISOString(),
  };

  await env.CASE_RESULTS.put(
    errorJsonKey(job),
    JSON.stringify(errorResult),
    { httpMetadata: { contentType: "application/json" } },
  );
}

function parseCourtList(raw: string | null): CourtCode[] {
  if (!raw || raw.trim() === "" || raw.trim().toLowerCase() === "all") {
    return [...COURT_CODES];
  }

  const allowed = new Set<string>(COURT_CODES);
  const courts = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is CourtCode => allowed.has(item));
  return courts.length > 0 ? courts : [...COURT_CODES];
}

function parseScheduledTime(raw: string | null): number {
  if (!raw) return Date.now();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function forwardToExtract(job: ScrapeJob, env: Env, r2Key: string): Promise<void> {
  if (!job.run_id || !env.EXTRACT_QUEUE) return;
  await env.EXTRACT_QUEUE.send({
    phase: "extract",
    run_id: job.run_id,
    case_id: job.case_id,
    court_code: job.court_code,
    r2_key: r2Key,
    scraped_at: new Date().toISOString(),
  });
}

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
