/**
 * D1-native pipeline state boundary.
 *
 * Discovery reads Catalog D1 and run/checkpoint metrics write Ops D1. The
 * scraper never receives a PostgreSQL/Hyperdrive binding. Extracted corpus
 * writes are handed to the main Worker's native coordinator Queue; this file
 * intentionally has no case upsert implementation.
 */

import type { CourtCode } from "./pipeline-config";
import { COURT_CODES } from "./pipeline-config";
import type { Env, ExtractedCase, ScrapeJob } from "./types";

export interface PipelineRunPatch {
  discovered?: number;
  errors?: number;
  errorsJson?: unknown;
  status?: "running" | "ok" | "aborted" | "failed";
  abortReason?: string | null;
}

export interface PipelineRunMetricDelta {
  scraped?: number;
  extracted?: number;
  upserted?: number;
  llmCalls?: number;
  costUsd?: number;
  errors?: number;
}

export interface NativeOutboxEvent {
  eventId: string;
  runId: string;
  eventKind: string;
  payloadKey: string;
  payloadSha256: string;
}

/** Persist the pointer before publishing so a Queue send can be retried safely. */
export async function stageNativeOutboxEvent(
  env: Env,
  event: NativeOutboxEvent,
): Promise<"pending" | "published"> {
  const existing = await ops(env).prepare(
    "SELECT status FROM outbox_events WHERE event_id = ? LIMIT 1",
  ).bind(event.eventId).first<{ status: string }>();
  if (existing?.status === "published") return "published";
  const now = new Date().toISOString();
  await ops(env).prepare(`
    INSERT OR IGNORE INTO outbox_events (
      event_id, run_id, event_kind, payload_key, payload_sha256,
      status, attempts, available_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
  `).bind(
    event.eventId, event.runId, event.eventKind, event.payloadKey,
    event.payloadSha256, now, now, now,
  ).run();
  return "pending";
}

export async function markNativeOutboxAttempt(env: Env, eventId: string): Promise<void> {
  await ops(env).prepare(`
    UPDATE outbox_events
    SET attempts = attempts + 1, updated_at = ?
    WHERE event_id = ? AND status = 'pending'
  `).bind(new Date().toISOString(), eventId).run();
}

export async function markNativeOutboxPublished(env: Env, eventId: string): Promise<void> {
  await ops(env).prepare(`
    UPDATE outbox_events
    SET status = 'published', updated_at = ?
    WHERE event_id = ?
  `).bind(new Date().toISOString(), eventId).run();
}

export async function recordPipelineDeadLetter(
  env: Env,
  queueName: string,
  messageId: string | undefined,
  body: unknown,
): Promise<void> {
  const encoded = JSON.stringify(body ?? null);
  const digestBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${queueName}:${messageId ?? ""}:${encoded}`),
  );
  const digest = Array.from(new Uint8Array(digestBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const payloadKey = `imports/dlq/${queueName}/${digest}.json`;
  await env.CASE_RESULTS.put(payloadKey, encoded, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: digest, bytes: String(new TextEncoder().encode(encoded).byteLength) },
  });
  const bodyEventId = body && typeof body === "object" && "event_id" in body
    ? String((body as { event_id?: unknown }).event_id || "") : "";
  const eventId = bodyEventId || `dlq:${queueName}:${digest}`;
  const linked = bodyEventId
    ? await ops(env).prepare("SELECT event_id FROM outbox_events WHERE event_id = ? LIMIT 1")
      .bind(bodyEventId).first<{ event_id: string }>() : null;
  await ops(env).prepare(`
    INSERT OR IGNORE INTO dead_letter_events (
      event_id, outbox_event_id, reason, payload_key, payload_sha256, failed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    eventId, linked?.event_id ?? null, `queue:${queueName}`, payloadKey, digest,
    new Date().toISOString(),
  ).run();
}

export async function updateControlCommand(
  env: Env,
  commandId: string,
  patch: { status: "queued" | "running" | "completed" | "failed"; runId?: string; error?: string },
): Promise<void> {
  const completedAt = patch.status === "completed" || patch.status === "failed"
    ? new Date().toISOString() : null;
  await ops(env).prepare(`
    UPDATE pipeline_control_commands SET
      status = ?, run_id = COALESCE(?, run_id), error = COALESCE(?, error),
      updated_at = ?, completed_at = COALESCE(?, completed_at)
    WHERE command_id = ?
  `).bind(
    patch.status, patch.runId ?? null, patch.error ?? null,
    new Date().toISOString(), completedAt, commandId,
  ).run();
}

export async function requestPipelineStop(env: Env, runId: string): Promise<void> {
  if (env.PIPELINE_KV) {
    await env.PIPELINE_KV.put(`stop:${runId}`, "requested", { expirationTtl: 24 * 60 * 60 });
  }
  await updatePipelineRun(env, runId, { status: "aborted", abortReason: "operator_stop" });
}

export async function isPipelineStopRequested(env: Env, runId: string): Promise<boolean> {
  return (await env.PIPELINE_KV?.get(`stop:${runId}`)) === "requested";
}

export async function latestRunningPipelineRun(env: Env): Promise<string | null> {
  const row = await ops(env).prepare(`
    SELECT run_id FROM pipeline_runs WHERE status = 'running'
    ORDER BY started_at DESC LIMIT 1
  `).first<{ run_id: string }>();
  return row?.run_id ?? null;
}

export async function findCasesMissingContent(
  env: Env,
  courts: CourtCode[],
  limit: number,
): Promise<ScrapeJob[]> {
  const safeLimit = Math.max(1, Math.min(10000, Math.trunc(limit || 50)));
  const selected = [...new Set(courts)].filter((court): court is CourtCode => COURT_CODES.includes(court));
  const clauses = ["(content_key IS NULL OR content_key = '')", "url IS NOT NULL", "url <> ''"];
  const params: unknown[] = [];
  if (selected.length) {
    clauses.push(`court_code IN (${selected.map(() => "?").join(",")})`);
    params.push(...selected);
  }
  const result = await catalog(env).prepare(`
    SELECT case_id, url, citation, court_code, title
    FROM cases
    WHERE ${clauses.join(" AND ")}
    ORDER BY year DESC, case_id ASC
    LIMIT ?
  `).bind(...params, safeLimit).all<{
    case_id: string; url: string; citation: string; court_code: string; title: string;
  }>();
  return rows(result).map((row) => ({
    case_id: row.case_id,
    url: row.url,
    citation: row.citation || "",
    court_code: row.court_code,
    title: row.title || "",
    run_id: undefined,
    phase: "scrape",
  }));
}

function d1(binding: D1Database | undefined, name: string): D1Database {
  if (!binding || typeof binding.prepare !== "function") {
    throw new Error(`${name} D1 binding is unavailable`);
  }
  return binding;
}

function catalog(env: Env): D1Database {
  return d1(env.IMMI_CATALOG_DB, "IMMI_CATALOG_DB");
}

function ops(env: Env): D1Database {
  return d1(env.IMMI_OPS_DB, "IMMI_OPS_DB");
}

function rows<T>(result: D1Result<T>): T[] {
  return Array.isArray(result.results) ? result.results : [];
}

/** The native catalogue is the only discovery target. */
export function discoveryTargetTable(_env: Env): "cases" {
  return "cases";
}

export async function assertSchemaConsistent(env: Env): Promise<void> {
  const [catalogResult, opsResult] = await Promise.all([
    catalog(env).prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = 'cases'").all<{ name: string }>(),
    ops(env).prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pipeline_runs','idempotency_keys','outbox_events','dead_letter_events')").all<{ name: string }>(),
  ]);
  if (rows(catalogResult).length !== 1) throw new Error("Catalog D1 schema missing cases");
  const names = new Set(rows(opsResult).map((row) => row.name));
  if (!names.has("pipeline_runs") || !names.has("idempotency_keys") || !names.has("outbox_events") || !names.has("dead_letter_events")) {
    throw new Error("Ops D1 schema missing pipeline coordination/outbox/DLQ tables");
  }
}

export async function startPipelineRun(
  env: Env,
  options: { trigger: "cron" | "manual" | "webhook"; courts: CourtCode[]; phase: string },
): Promise<string> {
  const runId = crypto.randomUUID();
  await ops(env).prepare(`
    INSERT INTO pipeline_runs (run_id, trigger, court, phase, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).bind(runId, options.trigger, options.courts.join(","), options.phase, new Date().toISOString()).run();
  return runId;
}

export async function updatePipelineRun(env: Env, runId: string, patch: PipelineRunPatch): Promise<void> {
  const finished = patch.status && ["ok", "aborted", "failed"].includes(patch.status)
    ? new Date().toISOString() : null;
  await ops(env).prepare(`
    UPDATE pipeline_runs SET
      discovered = COALESCE(?, discovered),
      errors = COALESCE(?, errors),
      detail_json = COALESCE(?, detail_json),
      status = COALESCE(?, status),
      abort_reason = COALESCE(?, abort_reason),
      finished_at = COALESCE(?, finished_at)
    WHERE run_id = ?
  `).bind(
    patch.discovered ?? null,
    patch.errors ?? null,
    patch.errorsJson === undefined ? null : JSON.stringify(patch.errorsJson),
    patch.status ?? null,
    patch.abortReason ?? null,
    finished,
    runId,
  ).run();
}

export async function addPipelineRunMetrics(env: Env, runId: string, delta: PipelineRunMetricDelta): Promise<void> {
  await ops(env).prepare(`
    UPDATE pipeline_runs SET
      scraped = scraped + ?, extracted = extracted + ?, upserted = upserted + ?,
      llm_calls = llm_calls + ?, cost_usd = cost_usd + ?, errors = errors + ?
    WHERE run_id = ?
  `).bind(
    delta.scraped ?? 0, delta.extracted ?? 0, delta.upserted ?? 0,
    delta.llmCalls ?? 0, delta.costUsd ?? 0, delta.errors ?? 0, runId,
  ).run();
}

export async function findExistingCases(
  env: Env,
  _table: "cases",
  court: CourtCode,
  caseIds: string[],
  urls: string[],
): Promise<Set<string>> {
  if (caseIds.length === 0 && urls.length === 0) return new Set();
  const result = await catalog(env).prepare(`
    SELECT case_id, url FROM cases
    WHERE (court_code = ? AND case_id IN (SELECT value FROM json_each(?)))
       OR url IN (SELECT value FROM json_each(?))
  `).bind(court, JSON.stringify(caseIds), JSON.stringify(urls)).all<{ case_id: string; url: string }>();
  const existing = new Set<string>();
  for (const row of rows(result)) {
    if (row.case_id) existing.add(row.case_id);
    if (row.url) existing.add(row.url);
  }
  return existing;
}

/**
 * Kept as an explicit guard so no caller can accidentally reintroduce direct
 * scraper-to-catalog writes. The coordinator Queue owns extracted upserts.
 */
export async function upsertExtractedCase(
  _env: Env,
  _runId: string,
  _extracted: ExtractedCase,
): Promise<never> {
  throw new Error("Direct scraper case upsert is disabled; send a native coordinator Queue event");
}
