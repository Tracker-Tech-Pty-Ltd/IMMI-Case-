/** Cloudflare-native read-only pipeline/job status contracts. */

import { createCloudflareStores } from "../storage/cloudflare.js";
import { StorageBoundaryError } from "../storage/contracts.js";

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestRun(result) {
  return Array.isArray(result?.runs) ? result.runs[0] || null : null;
}

function progressFor(run) {
  if (!run) return { total: 0, completed: 0, overall: 0 };
  const total = Math.max(number(run.discovered), number(run.scraped), number(run.extracted), number(run.upserted));
  const completed = Math.min(total, Math.max(number(run.upserted), number(run.extracted), number(run.scraped)));
  const finished = ["ok", "completed"].includes(String(run.status || "").toLowerCase());
  return {
    total,
    completed,
    overall: total > 0 ? Math.round((completed / total) * 100) : finished ? 100 : 0,
  };
}

function pipelinePayload(result) {
  const run = latestRun(result);
  const progress = progressFor(run);
  const running = run?.status === "running";
  const finished = ["ok", "completed"].includes(String(run?.status || "").toLowerCase());
  const errors = number(run?.errors);
  return {
    running,
    phase: run?.phase || "idle",
    overall_progress: progress.overall,
    phases_completed: finished ? ["discovery", "scrape", "extract", "store"] : [],
    stats: {
      crawl: { total_found: number(run?.discovered), new_added: number(run?.discovered) },
      clean: { dupes_removed: 0, validated: number(run?.extracted) },
      download: { downloaded: number(run?.scraped), failed: errors },
    },
    log: [],
    errors: errors > 0 ? [`${errors} pipeline error(s)`] : [],
    last_run: run,
    native: true,
  };
}

function jobPayload(result) {
  const run = latestRun(result);
  const progress = progressFor(run);
  const running = run?.status === "running";
  return {
    running,
    type: run ? "native-pipeline" : "",
    progress: running ? `${progress.completed} / ${progress.total}` : "",
    total: progress.total,
    completed: progress.completed,
    errors: number(run?.errors) > 0 ? [`${number(run.errors)} pipeline error(s)`] : [],
    results: [],
    native: true,
  };
}

async function readStatus(env, payload) {
  try {
    const result = await createCloudflareStores(env).pipelineStore.listRuns(30);
    return Response.json(payload(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StorageBoundaryError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(JSON.stringify({ event: "pipeline.cloudflare.status_error", error: error?.message }));
    return Response.json({ error: "Pipeline service unavailable", code: "pipeline_store_unavailable" }, { status: 503 });
  }
}

export function handlePipelineStatus(env) {
  return readStatus(env, pipelinePayload);
}

export function handleJobStatus(env) {
  return readStatus(env, jobPayload);
}
