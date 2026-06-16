/**
 * AustLII Case Scraper — Cloudflare Worker
 *
 * Producer: HTTP POST /enqueue → pushes ScrapeJob messages to Queue
 * Consumer: Queue handler → fetches AustLII pages, parses, stores in R2
 *
 * Architecture:
 *   enqueue_urls.py → POST /enqueue → Queue → Consumer → R2
 *   sync_results.py ← R2 (via S3-compatible API)
 */

import { extractFullText, extractMetadata } from "./parser";
import { discoverCourt, runDiscoveryAndEnqueue } from "./discover";
import { handleExtractBatch } from "./extract";
import { sendPipelineAlert } from "./alerts";
import { COURT_CODES, COURT_MATRIX, isBiweeklyTick } from "./pipeline-config";
import type { CourtCode } from "./pipeline-config";
import {
  addPipelineRunMetrics,
  assertSchemaConsistent,
  startPipelineRun,
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
} from "./types";

type QueueJob = ScrapeJob | ExtractJob;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_BATCH_ENQUEUE = 500;

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

    // Enqueue endpoint
    if (url.pathname === "/enqueue" && request.method === "POST") {
      return handleEnqueue(request, env);
    }

    // Progress check
    if (url.pathname === "/progress") {
      return handleProgress(env);
    }

    // Direct scrape: bypasses Queue, processes synchronously
    if (url.pathname === "/scrape" && request.method === "POST") {
      return handleDirectScrape(request, env);
    }

    // Discovery diff dry-run: protected acceptance endpoint, no queue writes.
    if (url.pathname === "/admin/discovery-diff" && request.method === "GET") {
      return handleDiscoveryDiff(request, env);
    }

    // List R2 keys for sync
    if (url.pathname === "/list") {
      return handleList(request, env);
    }

    // Batch-get R2 objects for sync
    if (url.pathname === "/batch-get" && request.method === "POST") {
      return handleBatchGet(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  // ─── Queue Consumer ──────────────────────────────────────────────────────

  async queue(
    batch: MessageBatch<QueueJob>,
    env: Env,
  ): Promise<void> {
    if (batch.messages.every((message) => isExtractJob(message.body))) {
      return handleExtractBatch(batch as MessageBatch<ExtractJob>, env);
    }

    for (const message of batch.messages) {
      const job = message.body as ScrapeJob;

      try {
        if (job.run_id && env.PIPELINE_ENABLED !== "true") {
          console.log(JSON.stringify({
            event: "queue.skipped.pipeline_disabled",
            run_id: job.run_id,
            case_id: job.case_id,
          }));
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
    if (env.PIPELINE_ENABLED !== "true") {
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

    await assertSchemaConsistent(env).catch((err) => {
      console.log(JSON.stringify({
        event: "schema.drift.detected",
        error: err instanceof Error ? err.message : String(err),
      }));
    });

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

// ─── Enqueue Handler ──────────────────────────────────────────────────────────

async function handleEnqueue(
  request: Request,
  env: Env,
): Promise<Response> {
  // Auth check
  const token = request.headers.get("X-Auth-Token");
  if (!token || token !== env.AUTH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as EnqueueRequest;
  if (!body.jobs || !Array.isArray(body.jobs)) {
    return Response.json(
      { error: "Request body must have a 'jobs' array" },
      { status: 400 },
    );
  }

  if (body.jobs.length > MAX_BATCH_ENQUEUE) {
    return Response.json(
      { error: `Max ${MAX_BATCH_ENQUEUE} jobs per request` },
      { status: 400 },
    );
  }

  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Send in batches of 25 (smaller to avoid Queue backpressure)
  const chunks = chunkArray(body.jobs, 25);
  for (const chunk of chunks) {
    const messages = chunk
      .filter((job) => {
        if (!job.case_id || !job.url) {
          errors.push(`Missing case_id or url: ${JSON.stringify(job)}`);
          return false;
        }
        return true;
      })
      .map((job) => ({ body: job }));

    if (messages.length > 0) {
      try {
        await env.SCRAPE_QUEUE.sendBatch(messages);
        queued += messages.length;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`sendBatch failed (${messages.length} msgs): ${errMsg}`);
      }
    }
    skipped += chunk.length - messages.length;
  }

  const response: EnqueueResponse = { queued, skipped, errors };
  return Response.json(response);
}

// ─── Direct Scrape Handler ────────────────────────────────────────────────────

async function handleDirectScrape(
  request: Request,
  env: Env,
): Promise<Response> {
  // Auth check
  const token = request.headers.get("X-Auth-Token");
  if (!token || token !== env.AUTH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = (await request.json()) as ScrapeJob;
  if (!job.case_id || !job.url) {
    return Response.json(
      { error: "Missing case_id or url" },
      { status: 400 },
    );
  }

  // Check if already processed
  const existing = await env.CASE_RESULTS.head(`results/${job.case_id}.json`);
  if (existing) {
    return Response.json({ case_id: job.case_id, skipped: true });
  }

  try {
    await processJob(job, env);
    return Response.json({ case_id: job.case_id, success: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json(
      { case_id: job.case_id, success: false, error },
      { status: 502 },
    );
  }
}

// ─── Progress Handler ─────────────────────────────────────────────────────────

async function handleProgress(env: Env): Promise<Response> {
  // Count results and errors in R2
  let resultCount = 0;
  let errorCount = 0;

  // List results/ prefix
  let cursor: string | undefined;
  do {
    const listed = await env.CASE_RESULTS.list({
      prefix: "results/",
      cursor,
      limit: 1000,
    });
    resultCount += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // List errors/ prefix
  cursor = undefined;
  do {
    const listed = await env.CASE_RESULTS.list({
      prefix: "errors/",
      cursor,
      limit: 1000,
    });
    errorCount += listed.objects.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return Response.json({
    results: resultCount,
    errors: errorCount,
    total: resultCount + errorCount,
    timestamp: new Date().toISOString(),
  });
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

// ─── List Handler (for sync) ──────────────────────────────────────────────────

async function handleList(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = request.headers.get("X-Auth-Token");
  if (!token || token !== env.AUTH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") || "results/";
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000"), 1000);

  const listed = await env.CASE_RESULTS.list({ prefix, cursor, limit });

  return Response.json({
    keys: listed.objects.map((obj) => obj.key),
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : null,
  });
}

// ─── Batch Get Handler (for sync) ────────────────────────────────────────────

async function handleBatchGet(
  request: Request,
  env: Env,
): Promise<Response> {
  const token = request.headers.get("X-Auth-Token");
  if (!token || token !== env.AUTH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { keys: string[] };
  if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
    return Response.json(
      { error: "Request body must have a non-empty 'keys' array" },
      { status: 400 },
    );
  }

  if (body.keys.length > 50) {
    return Response.json(
      { error: "Max 50 keys per request" },
      { status: 400 },
    );
  }

  const results: Record<string, unknown> = {};

  await Promise.all(
    body.keys.map(async (key) => {
      try {
        const obj = await env.CASE_RESULTS.get(key);
        if (obj) {
          const text = await obj.text();
          results[key] = JSON.parse(text);
        }
      } catch {
        // Skip individual failures silently
      }
    }),
  );

  return Response.json({ results });
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

async function handleDiscoveryDiff(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get("X-Auth-Token");
  if (!token || token !== env.AUTH_TOKEN) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const courts = parseCourtList(url.searchParams.get("courts"));
  const scheduledTime = parseScheduledTime(url.searchParams.get("scheduled_time"));
  const runId = `dry-run-${crypto.randomUUID()}`;
  const results = [];

  for (const court of courts) {
    const result = await discoverCourt(env, court, runId, scheduledTime);
    results.push({
      court,
      candidates: result.candidate_urls.length,
      new_cases: result.new_case_urls.length,
      skipped_reason: result.skipped_reason ?? null,
      errors: result.errors,
      sample_new_cases: result.new_cases.slice(0, 10).map((item) => ({
        case_id: item.case_id,
        citation: item.citation,
        title: item.title,
        url: item.url,
        year: item.year,
      })),
    });
  }

  return Response.json({
    run_id: runId,
    dry_run: true,
    target_table: env.PIPELINE_TARGET_TABLE || "immigration_cases_staging",
    scheduled_time: new Date(scheduledTime).toISOString(),
    courts,
    totals: {
      candidates: results.reduce((sum, item) => sum + item.candidates, 0),
      new_cases: results.reduce((sum, item) => sum + item.new_cases, 0),
      errors: results.reduce((sum, item) => sum + item.errors.length, 0),
    },
    results,
  });
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
