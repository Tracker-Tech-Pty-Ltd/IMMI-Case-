/**
 * Cloudflare-native POST actions that do not mutate the case corpus.
 *
 * These handlers still require a live Account D1 membership and the native
 * double-submit CSRF token. They receive storage boundaries, never raw D1/R2
 * bindings, and deliberately leave case create/update/delete/batch to the
 * later aggregate/outbox mutation wave.
 */

import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../auth/request_auth.js";
import { verifyCsrf } from "../auth/csrf.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { getStorageMode, StorageBoundaryError } from "../storage/contracts.js";

const CASE_ID_RE = /^[0-9a-f]{12}$/;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

function errorResponse(error, status = 400, code = "error") {
  return json({ error, code }, status);
}

function clientError(error) {
  return error instanceof StorageBoundaryError && error.status >= 400 && error.status < 500;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 32 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function requireWriter(request, env, stores) {
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

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function htmlField(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<tr><td class="label">${htmlEscape(label)}</td><td>${htmlEscape(value)}</td></tr>`;
}

function renderCollectionHtml(name, cases, notes) {
  const title = htmlEscape(name || "Collection");
  const blocks = cases.map((item) => {
    const note = notes[item.case_id] || "";
    return `<article class="case-block">
      <header><span class="court">${htmlEscape(item.court_code)}</span><strong>${htmlEscape(item.citation || item.title)}</strong></header>
      <table>${htmlField("Citation", item.citation)}${htmlField("Court", item.court)}${htmlField("Date", item.date)}${htmlField("Outcome", item.outcome)}${htmlField("Judge(s)", item.judges)}${htmlField("Case nature", item.case_nature)}${htmlField("Visa type", item.visa_type)}${htmlField("URL", item.url)}</table>
      ${note ? `<p class="note"><strong>Note:</strong> ${htmlEscape(note)}</p>` : ""}
    </article>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — IMMI-Case Report</title><style>
    *{box-sizing:border-box}body{font-family:system-ui,sans-serif;color:#1a1a2e;max-width:860px;margin:0 auto;padding:32px;font-size:13px}.subtitle{color:#64748b;margin:4px 0 24px}.case-block{border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:0 0 16px;break-inside:avoid}header{display:flex;gap:10px;align-items:center;margin-bottom:10px}.court{background:#e8f0fe;color:#1a56db;border-radius:4px;padding:2px 8px;font-size:11px;text-transform:uppercase}table{width:100%;border-collapse:collapse}td{padding:2px 4px;vertical-align:top}.label{width:120px;color:#64748b;font-weight:500;white-space:nowrap}.note{margin-top:10px;padding:8px 12px;background:#fffbeb;border-left:3px solid #f59e0b}
  </style></head><body><h1>${title}</h1><p class="subtitle">IMMI-Case Export · ${cases.length} case(s) · Generated ${new Date().toISOString().slice(0, 10)}</p>${blocks}</body></html>`;
}

async function handleCacheInvalidate() {
  return json({ invalidated: true, timestamp: Date.now() / 1000 }, 200, {
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
  });
}

async function handleCollectionExport(request, stores) {
  const body = await readJson(request);
  if (!body) return errorResponse("invalid json");
  const ids = Array.isArray(body.case_ids)
    ? [...new Set(body.case_ids.filter((id) => typeof id === "string" && CASE_ID_RE.test(id)))]
    : [];
  if (!ids.length) return errorResponse("case_ids is required");
  if (ids.length > 200) return errorResponse("Maximum 200 cases per export");
  const name = String(body.collection_name || "Collection").slice(0, 200);
  const notes = body.case_notes && typeof body.case_notes === "object" && !Array.isArray(body.case_notes)
    ? body.case_notes : {};
  const cases = await stores.caseStore.findByIds(ids);
  if (!cases.length) return errorResponse("No valid cases found", 404, "not_found");
  return new Response(renderCollectionHtml(name, cases, notes), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_") || "Collection"}.html"`,
      "Cache-Control": "no-store",
    },
  });
}

async function handleGuidedSearch(request, stores) {
  const body = await readJson(request);
  if (!body) return errorResponse("invalid json");
  const flow = String(body.flow || "");
  if (!(["find-precedents", "assess-judge"].includes(flow))) return errorResponse("Invalid flow type");
  if (flow === "find-precedents") {
    const visaSubclass = String(body.visa_subclass || "").trim();
    const country = String(body.country || "").trim();
    const legalConcepts = Array.isArray(body.legal_concepts)
      ? body.legal_concepts.map(String).map((value) => value.trim()).filter(Boolean)
      : body.legal_concepts ? [String(body.legal_concepts).trim()] : [];
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(body.limit || "50"), 10) || 50));
    const result = await stores.caseStore.guidedPrecedents({ visaSubclass, country, legalConcepts, limit });
    return json({
      success: true,
      flow,
      results: result.results,
      meta: {
        total_results: result.total,
        returned_results: result.results.length,
        filters_applied: { visa_subclass: visaSubclass, country, legal_concepts: legalConcepts },
        limit,
      },
    });
  }
  const judgeName = String(body.judge_name || "").trim();
  if (!judgeName) return errorResponse("Judge name is required for assess-judge flow");
  const judge = await stores.caseStore.guidedJudge(judgeName);
  if (!judge) return errorResponse("Invalid judge name");
  return json({
    success: true,
    flow,
    judge_name: judge.name,
    canonical_name: judge.name,
    profile_url: `/judge-profiles/${encodeURIComponent(judge.name)}`,
    meta: { total_cases: Number(judge.case_count || 0) },
  });
}

/** Return a native response for the three safe POST actions, or null. */
export async function dispatchCloudflareCaseAction(request, path, env) {
  if (getStorageMode(env) !== "cloudflare" || request.method !== "POST") return null;
  if (!["/api/v1/cache/invalidate", "/api/v1/taxonomy/guided-search", "/api/v1/collections/export"].includes(path)) return null;
  try {
    const stores = createCloudflareStores(env);
    const writer = await requireWriter(request, env, stores);
    if (writer instanceof Response) return writer;
    if (path === "/api/v1/cache/invalidate") return handleCacheInvalidate();
    if (path === "/api/v1/taxonomy/guided-search") return handleGuidedSearch(request, stores);
    return handleCollectionExport(request, stores);
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    console.error(JSON.stringify({ event: "cloudflare.action_error", path, error: error?.message }));
    return errorResponse("Cloudflare action unavailable", 503, "cloudflare_action_unavailable");
  }
}

