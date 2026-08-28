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

function queueLogFields(message, batch) {
  const body = message?.body;
  return {
    queue: typeof batch?.queue === "string" ? batch.queue : null,
    kind: typeof body?.kind === "string" ? body.kind : null,
    event_id: typeof body?.event_id === "string" ? body.event_id : null,
  };
}

function retryQueueMessage(message, error) {
  if (typeof message?.retry === "function") {
    message.retry({ delaySeconds: 30 });
    return;
  }
  throw error || new Error("Queue message cannot be retried");
}

async function processMutationMessage(message, env, stores) {
  if (await processCaseExtracted(message, env)) return true;
  if (await processCaseReindex(message, stores)) return true;
  if (await processCaseSourceDelete(message, stores)) return true;
  if (await processAggregateRebuild(message)) return true;
  return false;
}

async function handleCaseMutationQueue(batch, env) {
  const messages = batch?.messages || [];
  const stores = createCloudflareStores(env);
  const handled = [];
  for (const message of messages) {
    try {
      if (await processMutationMessage(message, env, stores)) {
        handled.push(message);
        continue;
      }
      // An unrecognised kind is never silently dropped: retrying lets the
      // consumer's max_retries carry it into immi-case-mutation-dlq, and the
      // log line names the kind that no processor claimed.
      console.error(JSON.stringify({
        event: "cloudflare.queue.unhandled_message",
        ...queueLogFields(message, batch),
      }));
      retryQueueMessage(message);
    } catch (error) {
      console.error(JSON.stringify({
        event: "cloudflare.case_reindex_error",
        ...queueLogFields(message, batch),
        error: error?.message,
      }));
      retryQueueMessage(message, error);
    }
  }
  if (handled.length === 0) return;
  try {
    await stores.caseStore.rebuildAggregates();
  } catch (error) {
    // Analytics is only safe to publish once the rebuild committed. Leave the
    // contributing messages un-acked so the queue retries the rebuild.
    console.error(JSON.stringify({
      event: "cloudflare.aggregate_rebuild_error",
      queue: typeof batch?.queue === "string" ? batch.queue : null,
      error: error?.message,
    }));
    for (const message of handled) retryQueueMessage(message, error);
    return;
  }
  for (const message of handled) if (typeof message?.ack === "function") message.ack();
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

// Browser-side hardening for the SPA shell and every static asset this Worker
// serves. Assets are the only responses a browser treats as a document, so the
// framing, script-source and transport rules belong here rather than on the
// JSON API. Kept deliberately in lockstep with
// `immi_case_downloader/web/security.py::SPA_CONTENT_SECURITY_POLICY`, which
// applies the identical policy to the local-dev Flask server;
// `tests/test_security_headers_parity.py` fails if the two drift apart.
//
// Inline script execution is deliberately not permitted: the Vite build emits a
// single external module script and no inline <script>. Inline *styles* are the
// one exception, because React and Recharts set style attributes throughout.
const SPA_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "script-src 'self' https://static.cloudflareinsights.com https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://telegram.org https://t.me",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-src 'self' https://oauth.telegram.org https://telegram.org",
  "worker-src 'self' blob:",
].join("; ");

const SPA_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": SPA_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
});

// Transport hardening is separate from document hardening, and is applied to
// EVERY response (see withTransportSecurity below), not only to assets: a
// browser that lands directly on /api/v1/auth/telegram/callback or on an API
// route would otherwise never receive an HSTS header at all.
//
// STAGED ROLLOUT — read Step 5 before changing this value.
//   Stage 1 (this step):  max-age=300               (5 minutes, no subdomains)
//   Stage 2 (+1 week):    max-age=86400             (1 day)
//   Stage 3 (+1 week):    max-age=2592000           (30 days)
//   Stage 4 (operator):   max-age=31536000; includeSubDomains
// A cached HSTS entry cannot be recalled — a browser that saw a one-year
// header enforces HTTPS for a year whatever we serve next. A 5-minute TTL
// makes a mistake recoverable in 5 minutes. `includeSubDomains` is a separate,
// operator-approved decision because it binds every sibling host under the
// apex, including ones this Worker knows nothing about.
const STRICT_TRANSPORT_SECURITY = "max-age=300";

function withSpaSecurityHeaders(response) {
  // Responses handed back by the ASSETS binding have immutable headers.
  // Re-wrapping is the supported way to add our own without buffering the body.
  const hardened = new Response(response.body, response);
  for (const [name, value] of Object.entries(SPA_SECURITY_HEADERS)) {
    hardened.headers.set(name, value);
  }
  return hardened;
}

/**
 * Attach HSTS to any response, on HTTPS only.
 *
 * Browsers ignore Strict-Transport-Security on a plain-HTTP response, so
 * emitting it there is noise; more importantly, skipping it keeps local
 * `http://localhost` development from pinning itself to HTTPS.
 */
function withTransportSecurity(request, response) {
  if (new URL(request.url).protocol !== "https:") return response;
  if (response.headers.get("Strict-Transport-Security")) return response;
  const hardened = new Response(response.body, response);
  hardened.headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  return hardened;
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

async function route(request, env, ctx) {
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
    const response = await dispatchCloudflareCaseRead(request, url, path, env);
    if (response !== null) return response;
  }
  if (path.startsWith("/api/")) {
    return unavailable("This API route is not yet available in the Cloudflare-native runtime");
  }
  if (env.ASSETS) {
    try {
      return withSpaSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (err) {
      // fall through to unavailable when the ASSETS binding is misconfigured
    }
  }
  return unavailable("This API route is not yet available in the Cloudflare-native runtime");
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
    return withTransportSecurity(request, await route(request, env, ctx));
  },
};
