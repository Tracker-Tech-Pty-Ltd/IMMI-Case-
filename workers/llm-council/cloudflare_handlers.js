/**
 * Standalone, Cloudflare-native LLM Council API handlers.
 *
 * This file has no legacy storage import: it uses the Account D1/R2/DO store
 * boundary directly. The legacy handler module remains in place for the old
 * Worker until cutover evidence permits retirement.
 */

import { mintToken, nanoid21 } from "./auth.js";
import { runCouncil, runExpert, streamCouncil } from "./runner.js";
import { buildCaseContextFromQuestion } from "./retrieval.js";
import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../auth/request_auth.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { StorageBoundaryError } from "../storage/contracts.js";
import { getCouncilSessionStub } from "./session_namespace.js";

const MAX_MESSAGE_LENGTH = 8000;
const MAX_TURNS = 15;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{21}$/;
const CASE_ID_RE = /^[0-9a-f]{12}$/;
const RETRIEVE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error, status = 400, code = undefined) {
  return jsonResponse(code ? { error, code } : { error }, status);
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() || "unknown";
}

async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) {
    return { success: false, reason: "rate_limiter_unconfigured" };
  }
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}

function generateRetrieveCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => RETRIEVE_CODE_ALPHABET[byte % RETRIEVE_CODE_ALPHABET.length]).join("");
}

async function requireSessionAuth(request, env) {
  return requireAuth(request, env, verifyJwt);
}

function validateBodyMessage(body, key = "message") {
  const message = typeof body?.[key] === "string" ? body[key].trim() : "";
  if (!message) return { error: `${key} is required` };
  if (message.length > MAX_MESSAGE_LENGTH) return { error: `${key} must be ${MAX_MESSAGE_LENGTH} characters or fewer` };
  if (body.case_id !== undefined && body.case_id !== null && body.case_id !== "" &&
    (typeof body.case_id !== "string" || !CASE_ID_RE.test(body.case_id))) {
    return { error: "case_id must be a 12-character lowercase hex string" };
  }
  return null;
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

async function councilStoresForClaims(env, claims) {
  const stores = createCloudflareStores(env);
  const auth = await stores.identityStore.assertMembership(claims);
  return { stores, auth };
}

async function createSessionWithRetrieveCode(stores, auth, values, preferredRetrieveCode = null) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const retrieveCode = attempt === 0 && preferredRetrieveCode
      ? preferredRetrieveCode : generateRetrieveCode();
    try {
      const session = await stores.councilStore.createSession(auth, { ...values, retrieveCode });
      return { session, retrieveCode };
    } catch (err) {
      lastError = err;
      if (!String(err?.message || "").includes("retrieve_code")) throw err;
    }
  }
  throw lastError;
}

async function persistTurn({ env, auth, sessionId, turnId, message, caseContext, councilResult }) {
  const result = await getCouncilSessionStub(env, sessionId).appendTurn(auth, {
    sessionId,
    turnId,
    role: "user",
    payload: {
      user_message: message,
      user_case_context: caseContext || null,
      payload: councilResult,
      retrieved_cases: councilResult.retrieved_cases || null,
      total_tokens: null,
      total_latency_ms: null,
    },
  });
  return {
    turn_id: turnId,
    turn_index: result.turnIndex,
    user_message: message,
    user_case_context: caseContext || null,
    payload: councilResult,
    retrieved_cases: councilResult.retrieved_cases || null,
    total_tokens: null,
    total_latency_ms: null,
    created_at: new Date().toISOString(),
    replayed: result.replayed,
  };
}

async function readSession(stores, auth, sessionId) {
  const metadata = await stores.councilStore.getSessionMetadata(auth, sessionId);
  if (!metadata) return null;
  const turns = await Promise.all(metadata.turns.map(async (turn) => {
    const object = await stores.objectStore.getVerifiedJson({
      key: turn.payload_key,
      sha256: turn.payload_sha256,
      size: turn.payload_size,
      contentType: turn.payload_content_type,
    });
    return {
      turn_id: turn.turn_id,
      session_id: turn.session_id,
      turn_index: turn.turn_index,
      user_message: object?.user_message || "",
      user_case_context: object?.user_case_context || null,
      payload: object?.payload || {},
      retrieved_cases: object?.retrieved_cases || null,
      total_tokens: object?.total_tokens || null,
      total_latency_ms: object?.total_latency_ms || null,
      created_at: turn.created_at,
    };
  }));
  return { session: metadata.session, turns };
}

function normalizeSessionResponse(sessionData) {
  const session = { ...sessionData.session };
  delete session.retrieve_code;
  return {
    session,
    turns: sessionData.turns.map((turn) => ({
      turn_id: turn.turn_id,
      turn_index: turn.turn_index,
      user_message: turn.user_message,
      case_context: turn.user_case_context || "",
      retrieved_cases: turn.retrieved_cases || null,
      created_at: turn.created_at,
      ...(turn.payload || {}),
    })),
  };
}

async function handleCreateSession(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
  const body = await readBody(request);
  if (!body) return errorResponse("Request body must be a JSON object");
  const invalid = validateBodyMessage(body);
  if (invalid) return errorResponse(invalid.error);

  const message = body.message.trim();
  const caseContext = typeof body.case_context === "string" ? body.case_context : "";
  // Confirm live D1 membership before consuming any paid Council model call.
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  let councilResult;
  try {
    const retrieval = await buildCaseContextFromQuestion(env, message);
    councilResult = await runCouncil({ env, question: message, caseContext, retrievedContext: retrieval.contextString, retrievedCases: retrieval.retrievedCases, prevTurns: [] });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err?.message || "unavailable"}`, 503);
  }
  const sessionId = nanoid21();
  const turnId = nanoid21();
  const sessionToken = await mintToken(env, sessionId);
  const { session: created, retrieveCode } = await createSessionWithRetrieveCode(stores, auth, {
    sessionId, caseId: body.case_id || null, title: message.slice(0, 80),
  });
  const turn = await persistTurn({ env, auth, sessionId, turnId, message, caseContext, councilResult });
  return jsonResponse({
    session_id: sessionId,
    session_token: sessionToken,
    retrieve_code: created?.retrieve_code || retrieveCode,
    turn: { turn_id: turnId, turn_index: turn.turn_index, user_message: message, ...councilResult },
    total_turns: turn.turn_index + 1,
  });
}

async function handleAddTurn(request, env, sessionId) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  if (!SESSION_ID_RE.test(sessionId)) return errorResponse("session_id missing from path", 400);
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
  const body = await readBody(request);
  if (!body) return errorResponse("Request body must be a JSON object");
  const invalid = validateBodyMessage(body);
  if (invalid) return errorResponse(invalid.error);
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  const current = await readSession(stores, auth, sessionId);
  if (!current) return errorResponse("Session not found", 404);
  if (current.session.total_turns >= MAX_TURNS) return errorResponse("Session has reached the maximum of 15 turns", 409);
  const message = body.message.trim();
  let councilResult;
  try {
    const retrieval = await buildCaseContextFromQuestion(env, message);
    councilResult = await runCouncil({
      env,
      question: message,
      caseContext: "",
      retrievedContext: retrieval.contextString,
      retrievedCases: retrieval.retrievedCases,
      prevTurns: current.turns.slice(0, MAX_TURNS).map((turn) => ({
        user_message: turn.user_message,
        payload: { moderator: { composed_answer: turn.payload?.moderator?.composed_answer || "" } },
      })),
    });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err?.message || "unavailable"}`, 503);
  }
  const turnId = nanoid21();
  const turn = await persistTurn({ env, auth, sessionId, turnId, message, caseContext: "", councilResult });
  return jsonResponse({
    turn: { turn_id: turnId, turn_index: turn.turn_index, user_message: message, ...councilResult },
    total_turns: turn.turn_index + 1,
  });
}

async function handleGetSession(request, env, sessionId) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  if (!SESSION_ID_RE.test(sessionId)) return errorResponse("session_id missing from path", 400);
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  const session = await readSession(stores, auth, sessionId);
  return session ? jsonResponse(normalizeSessionResponse(session)) : errorResponse("Session not found", 404);
}

async function handleGetTurns(request, env, sessionId) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  if (!SESSION_ID_RE.test(sessionId)) return errorResponse("session_id missing from path", 400);
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  const session = await readSession(stores, auth, sessionId);
  return session ? jsonResponse({ turns: session.turns }) : errorResponse("Session not found", 404);
}

async function handleListSessions(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(1, Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20), 100);
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  const sessions = await stores.identityStore.listCouncilSessions(auth, {
    limit, before: url.searchParams.get("before") || null,
  });
  return jsonResponse({ sessions });
}

async function handleDeleteSession(request, env, sessionId) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  if (!SESSION_ID_RE.test(sessionId)) return errorResponse("session_id missing from path", 400);
  const { auth } = await councilStoresForClaims(env, authResult.claims);
  try {
    await getCouncilSessionStub(env, sessionId).deleteSession(auth, { sessionId });
    return jsonResponse({ deleted: true });
  } catch (err) {
    if (err?.code === "council_session_not_found") return errorResponse("Session not found", 404);
    throw err;
  }
}

async function handleRestoreByCode(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
  const body = await readBody(request);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code)) return errorResponse("code contains invalid characters", 400);
  const { stores, auth } = await councilStoresForClaims(env, authResult.claims);
  const session = await stores.councilStore.getSessionByCode(auth, code);
  if (!session) return errorResponse("Code not found", 404);
  return jsonResponse({
    session_id: session.session_id,
    session_token: await mintToken(env, session.session_id),
    retrieve_code: session.retrieve_code,
  });
}

async function handleLegacyRun(request, env) {
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
  const body = await readBody(request);
  if (!body) return errorResponse("Request body must be a JSON object");
  const invalid = validateBodyMessage(body, "question");
  if (invalid) return errorResponse(invalid.error);
  try {
    const question = body.question.trim();
    const retrieval = await buildCaseContextFromQuestion(env, question);
    const result = await runCouncil({
      env, question, caseContext: typeof body.context === "string" ? body.context : "",
      retrievedContext: retrieval.contextString, retrievedCases: retrieval.retrievedCases, prevTurns: [],
    });
    return jsonResponse({
      question: result.question, case_context: result.case_context, models: result.models,
      opinions: result.opinions, moderator: result.moderator,
      retrieved_cases: result.retrieved_cases, retrieval_status: retrieval.status,
    });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err?.message || "unavailable"}`, 503);
  }
}

async function handleStream(request, env, ctx) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const limited = await applyRateLimit(request, env);
  if (!limited.success) return errorResponse("Rate limit exceeded — try again shortly", 429);
  const body = await readBody(request);
  if (!body) return errorResponse("Request body must be a JSON object");
  const invalid = validateBodyMessage(body);
  if (invalid) return errorResponse(invalid.error);
  const message = body.message.trim();
  const caseContext = typeof body.case_context === "string" ? body.case_context : "";
  const retrieval = await buildCaseContextFromQuestion(env, message);
  const sessionId = nanoid21();
  const turnId = nanoid21();
  const sessionToken = await mintToken(env, sessionId);
  // Fail an inactive membership before opening a paid long-lived SSE stream.
  await councilStoresForClaims(env, authResult.claims);
  const retrieveCode = generateRetrieveCode();
  let stream;
  try {
    stream = streamCouncil({
      env, question: message, caseContext, retrievedContext: retrieval.contextString, retrieval, prevTurns: [],
      sessionMeta: { session_id: sessionId, session_token: sessionToken, retrieve_code: retrieveCode },
    });
  } catch (err) {
    return errorResponse(`LLM Council stream error: ${err?.message || "unavailable"}`, 503);
  }
  const persist = stream.work.then(async (result) => {
    // Recheck at write time: membership could have been revoked while the
    // response streamed, and D1 itself has no transaction-local RLS claims.
    const current = await councilStoresForClaims(env, authResult.claims);
    await createSessionWithRetrieveCode(current.stores, current.auth, {
      sessionId, caseId: body.case_id || null, title: message.slice(0, 80),
    }, retrieveCode);
    await persistTurn({ env, auth: current.auth, sessionId, turnId, message, caseContext, councilResult: result });
  }).catch((err) => console.error(JSON.stringify({ event: "council.stream.persist_error", error: err?.message })));
  if (ctx?.waitUntil) ctx.waitUntil(persist);
  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleHealth(request, env) {
  const url = new URL(request.url);
  const live = ["1", "true", "yes", "on"].includes(String(url.searchParams.get("live") || "").toLowerCase());
  const providers = ["openai", "gemini_pro", "anthropic", "gemini_flash"];
  if (live) {
    const authResult = await requireAuth(request, env, verifyJwt);
    if (authResult instanceof Response) return authResult;
  }
  if (!live || !env.CF_AIG_TOKEN) {
    return jsonResponse({
      live_probe: live,
      gateway: { url: env.CF_GATEWAY_URL || "", cf_aig_token_present: Boolean(env.CF_AIG_TOKEN) },
      providers: Object.fromEntries(providers.map((provider) => [provider, { configured: true }])),
      errors: env.CF_AIG_TOKEN ? [] : ["Missing CF_AIG_TOKEN (Unified Billing token required)"],
      ok: Boolean(env.CF_AIG_TOKEN),
    });
  }
  const probe = await runExpert({
    env, providerKey: "openai", providerLabel: "OpenAI", modelRaw: "openai/gpt-5-mini-2025-08-07",
    defaultPrefix: "openai", systemPrompt: "Reply with the single word: OK", question: "OK",
    caseContext: "", maxTokens: 16, rawPrompt: true,
  });
  return jsonResponse({ live_probe: true, probe_results: { openai: probe }, ok: probe.success });
}

/** Return null only for an unknown route; standalone entrypoint then fails closed. */
export async function dispatchCloudflareCouncil(request, env, path, method, ctx) {
  try {
    if (path === "/api/v1/llm-council/health" && method === "GET") return handleHealth(request, env);
    if (path === "/api/v1/llm-council/sessions" && method === "POST") return handleCreateSession(request, env);
    if (path === "/api/v1/llm-council/sessions" && method === "GET") return handleListSessions(request, env);
    if (path === "/api/v1/llm-council/run" && method === "POST") return handleLegacyRun(request, env);
    if (path === "/api/v1/llm-council/stream" && method === "POST") return handleStream(request, env, ctx);
    if (path === "/api/v1/llm-council/sessions/restore" && method === "POST") return handleRestoreByCode(request, env);
    const turn = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})\/turns$/);
    if (turn && method === "POST") return handleAddTurn(request, env, turn[1]);
    if (turn && method === "GET") return handleGetTurns(request, env, turn[1]);
    const session = path.match(/^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})$/);
    if (session && method === "GET") return handleGetSession(request, env, session[1]);
    if (session && method === "DELETE") return handleDeleteSession(request, env, session[1]);
    return null;
  } catch (err) {
    if (err instanceof StorageBoundaryError) return errorResponse(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "council.cloudflare.handler_error", error: err?.message }));
    return errorResponse("LLM Council unavailable", 503, "council_unavailable");
  }
}
