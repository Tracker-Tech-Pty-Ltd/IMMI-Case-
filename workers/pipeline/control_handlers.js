/** Native operator controls for the scraper pipeline.
 *
 * Requests are authenticated at the Worker edge, recorded in Ops D1, then
 * delivered to the scraper Worker through an at-least-once Queue. No legacy
 * job manager or PostgreSQL path is reachable from these handlers.
 */

import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../auth/request_auth.js";
import { verifyCsrf } from "../auth/csrf.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { getStorageMode, StorageBoundaryError } from "../storage/contracts.js";
import { LEGISLATIONS_META } from "../case-api/static.js";

const COURTS = new Set(["AATA", "ARTA", "FCA", "FCCA", "HCA", "FMCA", "FedCFamC2G"]);
const CONTROL_PATHS = new Set([
  "/api/v1/download/start",
  "/api/v1/pipeline-action",
  "/api/v1/legislations/update",
]);

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
  if (Number.isFinite(length) && length > 32 * 1024) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}

async function requireOperator(request, env, stores) {
  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    const auth = await stores.identityStore.assertMembership(authResult.claims);
    if (!['owner', 'admin'].includes(String(auth.role || "member"))) {
      return errorResponse("Pipeline operator role is required", 403, "operator_role_required");
    }
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}

function courtsFrom(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const courts = [...new Set(values.map((item) => String(item).trim().toUpperCase()).filter((item) => COURTS.has(item)))];
  return courts.length ? courts : ["AATA", "ARTA", "FCA"];
}

function year(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.max(2000, Math.min(2030, parsed)) : fallback;
}

async function enqueueControl(request, env, stores, action, payload) {
  if (!env.PIPELINE_CONTROL_QUEUE || typeof env.PIPELINE_CONTROL_QUEUE.send !== "function") {
    return errorResponse("Native pipeline control queue is unavailable", 503, "pipeline_control_unavailable");
  }
  const commandId = crypto.randomUUID();
  await stores.pipelineStore.recordControlCommand({ commandId, action, payload });
  try {
    await env.PIPELINE_CONTROL_QUEUE.send({
      kind: "pipeline.control",
      command_id: commandId,
      action,
      ...payload,
    });
  } catch (error) {
    await stores.pipelineStore.updateControlCommand(commandId, { status: "failed", error: String(error?.message || error) });
    throw new StorageBoundaryError("Native pipeline control queue rejected the command", {
      code: "pipeline_control_unavailable",
      status: 503,
    });
  }
  if (action === "legislation_update") {
    return json({ success: true, message: "Scrape job started", laws: payload.law_ids, command_id: commandId, native: true }, 202);
  }
  return json({ started: action === "download" || action === "start", ok: true, command_id: commandId, native: true }, 202);
}

export async function dispatchCloudflarePipelineControl(request, path, env) {
  if (getStorageMode(env) !== "cloudflare" || request.method !== "POST" || !CONTROL_PATHS.has(path)) return null;
  try {
    const stores = createCloudflareStores(env);
    const operator = await requireOperator(request, env, stores);
    if (operator instanceof Response) return operator;
    const body = await readJson(request);
    if (!body) return errorResponse("invalid json");
    if (path === "/api/v1/download/start") {
      const limit = Math.max(1, Math.min(10000, Number.parseInt(String(body.limit ?? "50"), 10) || 50));
      return enqueueControl(request, env, stores, "download", {
        courts: courtsFrom(body.court || body.courts),
        limit,
      });
    }
    if (path === "/api/v1/legislations/update") {
      const requested = body.law_id ? [String(body.law_id)] : LEGISLATIONS_META.map((item) => item.id);
      const known = new Set(LEGISLATIONS_META.map((item) => item.id));
      const invalid = requested.find((lawId) => !known.has(lawId));
      if (invalid) return errorResponse(`Unknown law_id: ${invalid}`, 400, "invalid_law_id");
      return enqueueControl(request, env, stores, "legislation_update", { law_ids: requested });
    }
    const action = String(body.action || "").trim().toLowerCase();
    if (!['start', 'stop'].includes(action)) return errorResponse(`Unknown action: ${action}`);
    if (action === "stop") return enqueueControl(request, env, stores, "stop", {});
    return enqueueControl(request, env, stores, "start", {
      courts: courtsFrom(body.databases || body.courts),
      start_year: year(body.start_year, 2000),
      end_year: year(body.end_year, new Date().getUTCFullYear()),
    });
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    console.error(JSON.stringify({ event: "pipeline.cloudflare.control_error", path, error: error?.message }));
    return errorResponse("Native pipeline control unavailable", 503, "pipeline_control_unavailable");
  }
}
