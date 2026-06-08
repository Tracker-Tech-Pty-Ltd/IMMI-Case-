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
import { runDiscoveryAndEnqueue } from "./discover";
import { COURT_MATRIX, isBiweeklyTick } from "./pipeline-config";
import { assertSchemaConsistent, startPipelineRun, updatePipelineRun } from "./pipeline-db";
import type {
  Env,
  ScrapeJob,
  ScrapeResult,
  ScrapeError,
  EnqueueRequest,
  EnqueueResponse,
} from "./types";

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
    batch: MessageBatch<ScrapeJob>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;

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
        const existing = await env.CASE_RESULTS.head(`results/${job.case_id}.json`);
        if (existing) {
          message.ack();
          continue;
        }

        await processJob(job, env);
        message.ack();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`Failed to process ${job.case_id}: ${error}`);

        // Store error to R2 so we can track failures
        const errorResult: ScrapeError = {
          case_id: job.case_id,
          url: job.url,
          citation: job.citation,
          court_code: job.court_code,
          title: job.title,
          success: false,
          error,
          error_code: 0,
          scraped_at: new Date().toISOString(),
        };

        await env.CASE_RESULTS.put(
          `errors/${job.case_id}.json`,
          JSON.stringify(errorResult),
          { httpMetadata: { contentType: "application/json" } },
        );

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

async function processJob(job: ScrapeJob, env: Env): Promise<void> {
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
    const errorResult: ScrapeError = {
      case_id: job.case_id,
      url: job.url,
      citation: job.citation,
      court_code: job.court_code,
      title: job.title,
      success: false,
      error: "Page not found",
      error_code: 404,
      scraped_at: new Date().toISOString(),
    };
    await env.CASE_RESULTS.put(
      `errors/${job.case_id}.json`,
      JSON.stringify(errorResult),
      { httpMetadata: { contentType: "application/json" } },
    );
    return;
  }

  if (!response.ok) {
    const errorResult: ScrapeError = {
      case_id: job.case_id,
      url: job.url,
      citation: job.citation,
      court_code: job.court_code,
      title: job.title,
      success: false,
      error: `HTTP ${response.status}: ${response.statusText}`,
      error_code: response.status,
      scraped_at: new Date().toISOString(),
    };
    await env.CASE_RESULTS.put(
      `errors/${job.case_id}.json`,
      JSON.stringify(errorResult),
      { httpMetadata: { contentType: "application/json" } },
    );
    return;
  }

  const html = await response.text();

  // Extract full text
  const fullText = extractFullText(html);
  if (!fullText || fullText.length < 50) {
    const errorResult: ScrapeError = {
      case_id: job.case_id,
      url: job.url,
      citation: job.citation,
      court_code: job.court_code,
      title: job.title,
      success: false,
      error: "No content extracted from page",
      error_code: 0,
      scraped_at: new Date().toISOString(),
    };
    await env.CASE_RESULTS.put(
      `errors/${job.case_id}.json`,
      JSON.stringify(errorResult),
      { httpMetadata: { contentType: "application/json" } },
    );
    return;
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
  await env.CASE_RESULTS.put(
    `results/${job.case_id}.json`,
    JSON.stringify(result),
    { httpMetadata: { contentType: "application/json" } },
  );
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
