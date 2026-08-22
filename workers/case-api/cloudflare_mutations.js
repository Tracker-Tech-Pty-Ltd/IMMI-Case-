/**
 * Cloudflare-native case mutations.
 *
 * The durable order is R2 source pointer -> Catalog D1 metadata/relations ->
 * Vectorize delete when applicable. New or edited cases remain
 * `semantic_ready=0` until the queue coordinator re-embeds them; callers can
 * still use lexical search while the asynchronous semantic job is pending.
 */

import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../auth/request_auth.js";
import { verifyCsrf } from "../auth/csrf.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { getStorageMode, StorageBoundaryError, sha256Hex } from "../storage/contracts.js";
import { splitFtsChunks } from "../storage/pipeline_coordinator.js";

const CASE_ID_RE = /^[0-9a-f]{12}$/;

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error, status = 400, code = "error") {
  return json({ error, code }, status);
}

function clientError(error) {
  return error instanceof StorageBoundaryError && error.status >= 400 && error.status < 500;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || "0");
  // 1 MiB ceiling: case full text can exceed 128 KiB (e.g. AATA 2 ≈ 170 KiB),
  // so the original 128 KiB cap silently rejected legitimate large cases.
  if (Number.isFinite(length) && length > 1024 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function timingSafeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function requireWriter(request, env, stores) {
  // Service-to-service: the VPS AustLII crawler is a cron job with no login.
  // It presents a shared secret (CRAWLER_WRITE_TOKEN) in the Authorization
  // header. Compared in constant time; only honored when the secret is set.
  if (env.CRAWLER_WRITE_TOKEN) {
    const header = request.headers.get("Authorization") || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer && timingSafeEqualString(bearer, env.CRAWLER_WRITE_TOKEN)) {
      return { auth: { service: "crawler", subject: "austlii-crawler" } };
    }
  }

  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    const auth = await stores.identityStore.assertMembership(authResult.claims);
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}

function publicCase(row) {
  if (!row) return row;
  const { content_key, content_sha256, content_size, vector_mutation_id, ...response } = row;
  return response;
}

function caseRecord(data, caseId) {
  const year = data.year === "" || data.year === null || data.year === undefined ? null : Number(data.year);
  return {
    case_id: caseId,
    citation: data.citation,
    title: data.title,
    court: data.court,
    court_code: data.court_code,
    decision_date: data.date ?? data.decision_date,
    year: Number.isInteger(year) ? year : null,
    outcome: data.outcome,
    visa_type: data.visa_type,
    visa_subclass: data.visa_subclass,
    visa_class_code: data.visa_class_code,
    visa_subclass_number: data.visa_subclass_number,
    applicant_name: data.applicant_name,
    respondent: data.respondent,
    country_of_origin: data.country_of_origin,
    hearing_date: data.hearing_date,
    is_represented: data.is_represented,
    representative: data.representative,
    source: data.source,
    case_nature: data.case_nature,
    url: data.url,
    catchwords: data.catchwords,
    legislation: data.legislation,
    text_snippet: data.text_snippet,
    tags: data.tags,
    user_notes: data.user_notes,
    visa_outcome_reason: data.visa_outcome_reason,
    legal_test_applied: data.legal_test_applied,
    last_extraction_run_id: data.last_extraction_run_id,
    extraction_confidence_json: data.extraction_confidence_json,
    judges: data.judges,
    legal_concepts: data.legal_concepts,
  };
}

function canonicalText(data) {
  return String(data.full_text ?? data.text ?? data.text_snippet ?? [data.title, data.citation, data.catchwords].filter(Boolean).join(" ")).trim();
}

async function caseIdFor(data) {
  const key = data.citation || data.url || data.title;
  return (await sha256Hex(String(key))).hex.slice(0, 12);
}

async function enqueueSemanticMutation(env, record, sourcePointer) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `case:${record.case_id}:${sourcePointer.sha256}`,
    kind: "case.reindex",
    case_id: record.case_id,
    content_key: sourcePointer.key,
    content_sha256: sourcePointer.sha256,
    content_size: sourcePointer.size,
    content_type: sourcePointer.contentType,
  });
  return true;
}

async function enqueueAggregateRefresh(env, reason) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  const digest = (await sha256Hex(String(reason))).hex.slice(0, 32);
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `catalog.rebuild:${digest}`,
    kind: "catalog.rebuild",
    reason: String(reason).slice(0, 256),
  });
  return true;
}

function sourcePointerFromCase(row) {
  if (!row || typeof row.content_key !== "string" || !/^[0-9a-f]{64}$/.test(String(row.content_sha256 || ""))) {
    return null;
  }
  const size = Number(row.content_size);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return {
    key: row.content_key,
    sha256: row.content_sha256,
    size,
    contentType: "text/plain; charset=utf-8",
  };
}

async function enqueueCaseSourceCleanup(env, row) {
  const sourcePointer = sourcePointerFromCase(row);
  if (!sourcePointer || typeof row?.case_id !== "string") return false;
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") return false;
  await env.CASE_MUTATION_QUEUE.send({
    event_id: `case.source.delete:${row.case_id}:${sourcePointer.sha256}`,
    kind: "case.source.delete",
    case_id: row.case_id,
    content_key: sourcePointer.key,
    content_sha256: sourcePointer.sha256,
    content_size: sourcePointer.size,
    content_type: sourcePointer.contentType,
  });
  return true;
}

function requireMutationQueue(env) {
  if (!env.CASE_MUTATION_QUEUE || typeof env.CASE_MUTATION_QUEUE.send !== "function") {
    throw new StorageBoundaryError("Native case mutation queue is unavailable", {
      code: "case_mutation_queue_unavailable",
      status: 503,
    });
  }
}

async function handleCreate(request, env, stores) {
  const data = await readJson(request);
  if (!data) return errorResponse("invalid json");
  if (!data.title && !data.citation) return errorResponse("Title or citation is required");
  const caseId = await caseIdFor(data);
  const record = caseRecord(data, caseId);
  const text = canonicalText(data);
  const sourcePointer = await stores.objectStore.putCaseSource({ caseId, body: text });
  await stores.caseStore.putImportedCase({
    case: record,
    sourcePointer,
    textChunks: text ? splitFtsChunks(text) : [],
  });
  const queued = await enqueueSemanticMutation(env, record, sourcePointer);
  const result = await stores.caseStore.getCase(caseId);
  return json({ case: publicCase(result), semantic_ready: Boolean(result?.semantic_ready), semantic_queued: queued }, 201);
}

async function handleUpdate(caseId, request, env, stores) {
  if (!CASE_ID_RE.test(caseId)) return errorResponse("Invalid case ID");
  const data = await readJson(request);
  if (!data) return errorResponse("invalid json");
  const existing = await stores.caseStore.getCase(caseId);
  if (!existing) return errorResponse("Case not found", 404, "case_not_found");
  const hasTextReplacement = Object.prototype.hasOwnProperty.call(data, "full_text") || Object.prototype.hasOwnProperty.call(data, "text");
  let result;
  let semanticQueued = false;
  if (hasTextReplacement) {
    const record = caseRecord({ ...existing, ...data, date: data.date ?? existing.date }, caseId);
    const text = canonicalText(data);
    const sourcePointer = await stores.objectStore.putCaseSource({ caseId, body: text });
    await stores.caseStore.putImportedCase({ case: record, sourcePointer, textChunks: text ? splitFtsChunks(text) : [] });
    semanticQueued = await enqueueSemanticMutation(env, record, sourcePointer);
    result = await stores.caseStore.getCase(caseId);
  } else {
    result = await stores.caseStore.updateCaseFields(caseId, data);
    // Metadata-only edits invalidate the embedding too. Reuse the existing
    // checksum-verified R2 pointer so the queue consumer can deterministically
    // re-embed the canonical source without loading payload bytes here.
    const sourcePointer = sourcePointerFromCase(existing);
    if (sourcePointer) semanticQueued = await enqueueSemanticMutation(env, { case_id: caseId }, sourcePointer);
  }
  return json({
    case: publicCase(result),
    semantic_ready: Boolean(result?.semantic_ready),
    semantic_queued: semanticQueued,
  });
}

async function handleDelete(caseId, env, stores) {
  if (!CASE_ID_RE.test(caseId)) return errorResponse("Invalid case ID");
  const existing = await stores.caseStore.getCase(caseId);
  await stores.caseStore.deleteCase(caseId);
  await stores.semanticIndex.deleteCase(caseId);
  if (existing) {
    await enqueueCaseSourceCleanup(env, { ...existing, case_id: caseId });
    await enqueueAggregateRefresh(env, `delete:${caseId}:${existing.updated_at || ""}`);
  }
  return json({ success: true });
}

async function handleBatch(request, env, stores) {
  const data = await readJson(request);
  if (!data) return errorResponse("invalid json");
  const ids = Array.isArray(data.case_ids) ? [...new Set(data.case_ids.filter((id) => typeof id === "string" && CASE_ID_RE.test(id)))] : [];
  if (!ids.length) return errorResponse("No valid case IDs provided");
  if (ids.length > 200) return errorResponse("Batch limited to 200 cases");
  const action = String(data.action || "");
  if (action === "delete") {
    const current = typeof stores.caseStore.findByIds === "function"
      ? await stores.caseStore.findByIds(ids)
      : [];
    const affected = await stores.caseStore.batchDeleteCases(ids);
    if (affected) await Promise.all(ids.map((id) => stores.semanticIndex.deleteCase(id)));
    if (affected) {
      await Promise.all(current.map((row) => enqueueCaseSourceCleanup(env, row)));
      await enqueueAggregateRefresh(env, `batch-delete:${[...ids].sort().join(",")}`);
    }
    return json({ affected });
  }
  if (action === "tag") {
    const current = typeof stores.caseStore.findByIds === "function"
      ? await stores.caseStore.findByIds(ids)
      : [];
    const affected = await stores.caseStore.batchAddTag(ids, String(data.tag || ""));
    await Promise.all(current.map(async (row) => {
      const sourcePointer = sourcePointerFromCase(row);
      if (sourcePointer) await enqueueSemanticMutation(env, { case_id: row.case_id }, sourcePointer);
    }));
    return json({ affected });
  }
  return errorResponse(`Unknown action: ${action}`);
}

/** Return a native response for case mutations, or null for an unsupported path. */
export async function dispatchCloudflareCaseMutation(request, path, env) {
  if (getStorageMode(env) !== "cloudflare") return null;
  const isCreate = path === "/api/v1/cases" && request.method === "POST";
  const isBatch = path === "/api/v1/cases/batch" && request.method === "POST";
  const idMatch = path.match(/^\/api\/v1\/cases\/([^/]+)$/);
  const isUpdate = Boolean(idMatch) && request.method === "PUT";
  const isDelete = Boolean(idMatch) && request.method === "DELETE";
  if (!isCreate && !isBatch && !isUpdate && !isDelete) return null;
  // Freeze is an explicit public contract during migration: callers receive a
  // typed 503 instead of falling through to the legacy router or a generic
  // catch-all response. The route is therefore observable and reversible while
  // the queue/outbox rehearsal gate remains closed.
  if (env.IMMI_CASE_MUTATIONS_ENABLED !== "true") {
    return errorResponse("Case mutations are disabled during migration freeze", 503, "case_mutations_disabled");
  }
  try {
    requireMutationQueue(env);
    const stores = createCloudflareStores(env);
    const writer = await requireWriter(request, env, stores);
    if (writer instanceof Response) return writer;
    if (isCreate) return handleCreate(request, env, stores);
    if (isBatch) return handleBatch(request, env, stores);
    if (isUpdate) return handleUpdate(idMatch[1], request, env, stores);
    return handleDelete(idMatch[1], env, stores);
  } catch (error) {
    if (error instanceof StorageBoundaryError) return errorResponse(error.message, error.status, error.code);
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    console.error(JSON.stringify({ event: "cloudflare.case_mutation_error", path, error: error?.message }));
    return errorResponse("Cloudflare case mutation unavailable", 503, "cloudflare_case_mutation_unavailable");
  }
}
