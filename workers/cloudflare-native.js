/**
 * Standalone IMMI Cloudflare-native Worker entrypoint.
 *
 * It intentionally does not import the legacy proxy, Flask container, or
 * postgres.js. This entrypoint cannot be deployed until the route-manifest,
 * import reconciliation, privacy, shadow, and rollback gates are all green.
 */

import { dispatchCloudflareCaseRead } from "./case-api/cloudflare.js";
import { dispatchCloudflareCouncil } from "./llm-council/cloudflare_handlers.js";
import {
  handleTelegramLogin,
  handleTelegramCallback,
  handleBootstrapLogin,
  handleAuthMe,
  handleAuthLogout,
  handleAuthRefresh,
  handleAuthSwitchTenant,
} from "./auth/cloudflare_handlers.js";
import { getStorageMode } from "./storage/contracts.js";
import { handleAdminPipelineRuns } from "./admin/cloudflare_handlers.js";
import { getCsrfToken } from "./auth/csrf.js";
import { dispatchCloudflareCaseAction } from "./case-api/cloudflare_actions.js";
import { dispatchCloudflareCaseMutation } from "./case-api/cloudflare_mutations.js";
import { createCloudflareStores } from "./storage/cloudflare.js";
import { sha256Hex, VECTOR_DIMENSIONS, StorageBoundaryError } from "./storage/contracts.js";
import { coordinateExtractedCase } from "./storage/pipeline_coordinator.js";
import { handleJobStatus, handlePipelineStatus } from "./pipeline/cloudflare_handlers.js";
import { dispatchCloudflarePipelineControl } from "./pipeline/control_handlers.js";

export { AuthNonce } from "./auth/nonce_do.js";
export { CouncilSessionDO } from "./llm-council/session_do.js";

async function processCaseReindex(message, stores) {
  const event = message?.body;
  if (!event || event.kind !== "case.reindex" || typeof event.case_id !== "string") {
    return false;
  }
  const current = await stores.caseStore.getCase(event.case_id);
  if (!current) {
    await stores.semanticIndex.deleteCase(event.case_id);
    return true;
  }
  const text = await stores.objectStore.getVerifiedText({
    key: event.content_key,
    sha256: event.content_sha256,
    size: event.content_size,
    contentType: event.content_type || "text/plain; charset=utf-8",
  });
  const embedding = await stores.semanticIndex.embed(text || `${current.title} ${current.citation}`.trim());
  if (!Array.isArray(embedding) || embedding.length !== VECTOR_DIMENSIONS) {
    throw new StorageBoundaryError("Reindex embedding dimensions are invalid", { code: "embedding_shape_invalid", status: 503 });
  }
  const mutation = await stores.semanticIndex.upsertCase(event.case_id, embedding, {
    court_code: String(current.court_code || ""),
    ...(Number.isInteger(current.year) ? { year: current.year } : {}),
    source: String(current.source || ""),
    visa_subclass: String(current.visa_subclass || ""),
  });
  await stores.caseStore.markSemanticReady(event.case_id, mutation?.mutationId || null);
  return true;
}

async function processAggregateRebuild(message) {
  const event = message?.body;
  if (!event || event.kind !== "catalog.rebuild") return false;
  return true;
}

async function processCaseSourceDelete(message, stores) {
  const event = message?.body;
  if (!event || event.kind !== "case.source.delete") return false;
  await stores.objectStore.deleteVerified({
    key: event.content_key,
    sha256: event.content_sha256,
    size: event.content_size,
    contentType: event.content_type || "text/plain; charset=utf-8",
  }, { prefix: "cases" });
  return true;
}

async function processCaseExtracted(message, env) {
  const event = message?.body;
  if (!event || event.kind !== "case.extracted") return false;
  const stores = createCloudflareStores(env);
  const payload = await stores.objectStore.getVerifiedJson({
    key: event.payload_key,
    sha256: event.payload_sha256,
    size: event.payload_size,
    contentType: event.payload_content_type || "application/json",
  }, { prefix: "pipeline", maxBytes: 16 * 1024 * 1024, label: "Pipeline extraction payload" });
  if (!payload || typeof payload !== "object") throw new StorageBoundaryError("Pipeline extraction payload is invalid", { code: "pipeline_payload_invalid", status: 503 });
  await coordinateExtractedCase({
    env,
    eventId: event.event_id,
    runId: event.run_id,
    record: payload.record,
    canonicalText: payload.canonicalText,
    audit: payload.audit,
  });
  return true;
}

async function handleCaseMutationQueue(batch, env) {
  const messages = batch?.messages || [];
  const stores = createCloudflareStores(env);
  try {
    let changed = false;
    for (const message of messages) {
      if (await processCaseExtracted(message, env)) {
        changed = true;
      } else if (await processCaseReindex(message, stores)) {
        changed = true;
      } else if (await processCaseSourceDelete(message, stores)) {
        changed = true;
      } else if (await processAggregateRebuild(message)) {
        changed = true;
      }
    }
    if (changed) await stores.caseStore.rebuildAggregates();
    for (const message of messages) if (typeof message?.ack === "function") message.ack();
  } catch (error) {
    console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
    for (const message of messages) {
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
      else throw error;
    }
  }
}

async function handleDeadLetterQueue(batch, env) {
  const stores = createCloudflareStores(env);
  for (const message of batch?.messages || []) {
    try {
      const body = message?.body ?? null;
      const encoded = JSON.stringify(body);
      const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
      const pointer = await stores.objectStore.putVerified({
        key: `imports/dlq/${batch.queue}/${hex}.json`,
        body: encoded,
        contentType: "application/json",
      });
      const eventId = typeof body?.event_id === "string" && body.event_id
        ? body.event_id : `dlq:${batch.queue}:${hex}`;
      await stores.pipelineStore.recordDeadLetter({
        eventId,
        outboxEventId: typeof body?.event_id === "string" ? body.event_id : null,
        reason: `queue:${batch.queue}`,
        payloadPointer: pointer,
      });
      if (typeof message?.ack === "function") message.ack();
    } catch (error) {
      console.error(JSON.stringify({ event: "cloudflare.dlq_record_error", error: error?.message }));
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
      else throw error;
    }
  }
}

function unavailable(error, code = "cloudflare_route_unavailable") {
  return Response.json({ error, code }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "0" },
  });
}

async function dispatchAuth(request, env, path, method) {
  if (env.AUTH_ENABLED === "false") return null;
  if (path === "/api/v1/auth/telegram" && method === "POST") {
    return handleTelegramLogin(request, env);
  }
  if (path === "/api/v1/auth/bootstrap" && method === "POST") {
    return handleBootstrapLogin(request, env);
  }
  if (path === "/api/v1/auth/telegram/callback" && method === "GET") {
    return handleTelegramCallback(request, env);
  }
  if (path === "/api/v1/auth/me" && method === "GET") return handleAuthMe(request, env);
  if (path === "/api/v1/auth/logout" && method === "POST") {
    return handleAuthLogout(request, env);
  }
  if (path === "/api/v1/auth/refresh" && method === "POST") {
    return handleAuthRefresh(request, env);
  }
  if (path === "/api/v1/auth/switch-tenant" && method === "POST") {
    return handleAuthSwitchTenant(request, env);
  }
  return null;
}

export default {
  async queue(batch, env) {
    if (batch?.queue === "immi-case-mutation-dlq") {
      await handleDeadLetterQueue(batch, env);
      return;
    }
    await handleCaseMutationQueue(batch, env);
  },
  async fetch(request, env, ctx) {
    let mode;
    try {
      mode = getStorageMode(env);
    } catch (err) {
      return unavailable("Cloudflare-native runtime is misconfigured", "invalid_storage_mode");
    }
    if (mode !== "cloudflare") {
      return unavailable("Cloudflare-native runtime requires IMMI_STORAGE_MODE=cloudflare", "cloudflare_mode_required");
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      return Response.json({ status: "ok", worker: "immi-case", layer: "edge+cloudflare-native" });
    }
    if (path === "/api/v1/csrf-token" && request.method === "GET") return getCsrfToken(env);
    const auth = await dispatchAuth(request, env, path, request.method);
    if (auth !== null) return auth;
    const action = await dispatchCloudflareCaseAction(request, path, env);
    if (action !== null) return action;
    const pipelineControl = await dispatchCloudflarePipelineControl(request, path, env);
    if (pipelineControl !== null) return pipelineControl;
    const mutation = await dispatchCloudflareCaseMutation(request, path, env);
    if (mutation !== null) return mutation;
    if (path === "/api/v1/admin/pipeline-runs" && request.method === "GET") {
      return handleAdminPipelineRuns(request, env, url);
    }
    if (path === "/api/v1/job-status" && request.method === "GET") return handleJobStatus(env);
    if (path === "/api/v1/pipeline-status" && request.method === "GET") return handlePipelineStatus(env);
    const council = await dispatchCloudflareCouncil(request, env, path, request.method, ctx);
    if (council !== null) return council;
    if (request.method === "GET") {
      const response = await dispatchCloudflareCaseRead(url, path, env);
      if (response !== null) return response;
    }
    if (path.startsWith("/api/")) {
      return unavailable("This API route is not yet available in the Cloudflare-native runtime");
    }
    if (env.ASSETS) {
      try {
        return await env.ASSETS.fetch(request);
      } catch (err) {
        // fall through to unavailable when the ASSETS binding is misconfigured
      }
    }
    return unavailable("This API route is not yet available in the Cloudflare-native runtime");
  },
};
