/**
 * workers/llm-council/handlers.js
 *
 * Endpoint handler functions for the LLM Council Worker.
 *
 * AUTH MODEL (plan §1.3 + §1.4):
 *   Every persistence-touching endpoint requires a verified JWT. Tenant
 *   isolation is enforced server-side via RLS using `auth_tenant_id()` —
 *   handlers MUST pass `claims` into every storage call so the postgres
 *   transaction wrapper sets `SET LOCAL request.jwt.claims` before any DML
 *   runs. The legacy X-Session-Token HMAC is no longer accepted as a
 *   standalone auth — JWT is the sole gate.
 *
 *   Endpoint-by-endpoint:
 *     POST   /sessions          → JWT required (mints session token; writes tenant_id)
 *     POST   /sessions/:id/turns→ JWT required (RLS verifies session ownership)
 *     GET    /sessions/:id      → JWT required (RLS hides foreign sessions)
 *     GET    /sessions          → JWT required (RLS filters by tenant)
 *     DELETE /sessions/:id      → JWT required
 *     POST   /sessions/restore  → JWT required (RLS filters by tenant)
 *     POST   /stream            → JWT required (persists via ctx.waitUntil)
 *     POST   /run               → rate-limit only (ephemeral, no DB)
 */

import { mintToken, nanoid21 } from "./auth.js";
import {
  createSession,
  addTurn,
  getSession,
  getSessionByCode,
  listSessions,
  deleteSession,
  loadHistory,
  generateRetrieveCode,
} from "./storage.js";
import {
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
  DEFAULT_OPENAI_SYSTEM_PROMPT,
  runCouncil,
  runExpert,
  streamCouncil,
} from "./runner.js";
import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../db/getSqlAsUser.js";

const MAX_MESSAGE_LENGTH = 8000;
const VALID_CASE_ID_RE = /^[0-9a-f]{12}$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown"
  );
}

async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) return { success: true };
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}

function extractSessionId(pathname) {
  const m = pathname.match(/\/sessions\/([^/]+)/);
  return m ? m[1] : "";
}

function validateMessageBody(body, messageKey = "message") {
  const message = typeof body[messageKey] === "string" ? body[messageKey].trim() : "";
  if (!message) {
    return { error: `${messageKey} is required` };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `${messageKey} must be ${MAX_MESSAGE_LENGTH} characters or fewer` };
  }
  const caseId = body.case_id;
  if (caseId !== undefined && caseId !== null && caseId !== "") {
    if (typeof caseId !== "string" || !VALID_CASE_ID_RE.test(caseId)) {
      return { error: "case_id must be a 12-character lowercase hex string" };
    }
  }
  return null;
}

async function requireSessionAuth(request, env) {
  return requireAuth(request, env, verifyJwt);
}

function envModel(env, key, fallback) {
  return String(env[key] || fallback).trim() || fallback;
}

function councilProviderConfig(env) {
  return {
    openai: {
      model: envModel(env, "LLM_COUNCIL_OPENAI_MODEL", "openai/gpt-5-mini-2025-08-07"),
      cf_aig_token_present: Boolean(env.CF_AIG_TOKEN),
      system_prompt_preview: DEFAULT_OPENAI_SYSTEM_PROMPT.slice(0, 140),
    },
    gemini_pro: {
      model: envModel(env, "LLM_COUNCIL_GEMINI_PRO_MODEL", "google-ai-studio/gemini-2.5-pro"),
      cf_aig_token_present: Boolean(env.CF_AIG_TOKEN),
      system_prompt_preview: DEFAULT_GEMINI_PRO_SYSTEM_PROMPT.slice(0, 140),
    },
    anthropic: {
      model: envModel(env, "LLM_COUNCIL_ANTHROPIC_MODEL", "anthropic/claude-sonnet-4-6"),
      cf_aig_token_present: Boolean(env.CF_AIG_TOKEN),
      system_prompt_preview: DEFAULT_ANTHROPIC_SYSTEM_PROMPT.slice(0, 140),
    },
    gemini_flash: {
      model: envModel(env, "LLM_COUNCIL_GEMINI_FLASH_MODEL", "google-ai-studio/gemini-2.5-flash"),
      cf_aig_token_present: Boolean(env.CF_AIG_TOKEN),
      system_prompt_preview: DEFAULT_MODERATOR_SYSTEM_PROMPT.slice(0, 140),
    },
  };
}

// ---------------------------------------------------------------------------
// handleHealth (Worker-native, no auth)
// ---------------------------------------------------------------------------

export async function handleHealth(request, env) {
  const url = new URL(request.url);
  const live = ["1", "true", "yes", "on"].includes(
    String(url.searchParams.get("live") || "").toLowerCase(),
  );
  const providers = councilProviderConfig(env);
  const errors = [];
  if (!env.CF_AIG_TOKEN) errors.push("Missing CF_AIG_TOKEN (Unified Billing token required)");
  const payload = {
    live_probe: live,
    gateway: {
      url: env.CF_GATEWAY_URL || "https://gateway.ai.cloudflare.com/v1/30ffcfbf8c4103048bc38a5398b7ec99/immi-council/compat/chat/completions",
      cf_aig_token_present: Boolean(env.CF_AIG_TOKEN),
    },
    providers,
    errors,
  };

  if (!live || errors.length > 0) {
    return jsonResponse({ ...payload, ok: errors.length === 0 });
  }

  const probeSystem = "You are a connectivity probe. Reply with the single word: OK";
  const probeQuestion = "OK";
  const probeResults = await Promise.all([
    runExpert({
      env,
      providerKey: "openai",
      providerLabel: "OpenAI",
      modelRaw: providers.openai.model,
      defaultPrefix: "openai",
      systemPrompt: probeSystem,
      question: probeQuestion,
      caseContext: "",
      maxTokens: 256,
      rawPrompt: true,
    }),
    runExpert({
      env,
      providerKey: "gemini_pro",
      providerLabel: "Google Gemini Pro",
      modelRaw: providers.gemini_pro.model,
      defaultPrefix: "google-ai-studio",
      systemPrompt: probeSystem,
      question: probeQuestion,
      caseContext: "",
      maxTokens: 256,
      rawPrompt: true,
    }),
    runExpert({
      env,
      providerKey: "anthropic",
      providerLabel: "Anthropic",
      modelRaw: providers.anthropic.model,
      defaultPrefix: "anthropic",
      systemPrompt: probeSystem,
      question: probeQuestion,
      caseContext: "",
      maxTokens: 256,
      rawPrompt: true,
    }),
    runExpert({
      env,
      providerKey: "gemini_flash",
      providerLabel: "Council Chairman",
      modelRaw: providers.gemini_flash.model,
      defaultPrefix: "google-ai-studio",
      systemPrompt: probeSystem,
      question: probeQuestion,
      caseContext: "",
      maxTokens: 256,
      rawPrompt: true,
      isModerator: true,
    }),
  ]);

  const probe_results = Object.fromEntries(
    probeResults.map((result) => [result.provider_key, result]),
  );
  return jsonResponse({
    ...payload,
    probe_results,
    ok: probeResults.every((result) => result.success),
  });
}

// ---------------------------------------------------------------------------
// handleCreateSession
// ---------------------------------------------------------------------------

export async function handleCreateSession(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const validationError = validateMessageBody(body, "message");
  if (validationError) {
    return errorResponse(validationError.error);
  }

  const message = body.message.trim();
  const caseId = body.case_id || null;
  const caseContext = typeof body.case_context === "string" ? body.case_context : "";

  const sessionId = nanoid21();
  const turnId = nanoid21();
  const sessionToken = await mintToken(env, sessionId);
  const retrieveCode = generateRetrieveCode();

  let councilResult;
  try {
    councilResult = await runCouncil({
      env,
      question: message,
      caseContext,
      prevTurns: [],
    });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err.message}`, 503);
  }

  const title = message.slice(0, 80);

  let createdSession;
  let codeUsed = retrieveCode;
  try {
    createdSession = await createSession({
      env,
      claims,
      sessionId,
      caseId,
      title,
      hmacSig: sessionToken,
      retrieveCode: codeUsed,
    });
  } catch (err) {
    if (String(err?.message || "").includes("retrieve_code")) {
      codeUsed = generateRetrieveCode();
      createdSession = await createSession({
        env,
        claims,
        sessionId,
        caseId,
        title,
        hmacSig: sessionToken,
        retrieveCode: codeUsed,
      });
    } else {
      throw err;
    }
  }

  await addTurn({
    env,
    claims,
    sessionId,
    turnId,
    turnIndex: 0,
    userMessage: message,
    userCaseContext: caseContext || null,
    payload: councilResult,
    retrievedCases: councilResult.retrieved_cases || null,
    totalTokens: null,
    totalLatencyMs: null,
  });

  return jsonResponse({
    session_id: sessionId,
    session_token: sessionToken,
    retrieve_code: createdSession?.retrieve_code ?? codeUsed,
    turn: {
      turn_id: turnId,
      turn_index: 0,
      user_message: message,
      ...councilResult,
    },
    total_turns: 1,
  });
}

// ---------------------------------------------------------------------------
// handleAddTurn
// ---------------------------------------------------------------------------

export async function handleAddTurn(request, env, pathname) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const validationError = validateMessageBody(body, "message");
  if (validationError) {
    return errorResponse(validationError.error);
  }

  const message = body.message.trim();

  const sessionData = await getSession({ env, claims, sessionId });
  if (!sessionData) {
    return errorResponse("Session not found", 404);
  }

  if (sessionData.session.total_turns >= 15) {
    return errorResponse("Session has reached the maximum of 15 turns", 409);
  }

  const history = await loadHistory({ env, claims, sessionId });

  let councilResult;
  try {
    councilResult = await runCouncil({
      env,
      question: message,
      caseContext: "",
      prevTurns: history.map((h) => ({
        user_message: h.user_message,
        payload: { moderator: { composed_answer: h.assistant_message } },
      })),
    });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err.message}`, 503);
  }

  const turnIndex = sessionData.session.total_turns;
  const turnId = nanoid21();

  const turnRow = await addTurn({
    env,
    claims,
    sessionId,
    turnId,
    turnIndex,
    userMessage: message,
    userCaseContext: null,
    payload: councilResult,
    retrievedCases: null,
    totalTokens: null,
    totalLatencyMs: null,
  });

  if (turnRow === null) {
    return errorResponse(
      "Turn conflict — a turn at this index already exists (concurrent request)",
      409,
    );
  }

  return jsonResponse({
    turn: {
      turn_id: turnId,
      turn_index: turnIndex,
      user_message: message,
      ...councilResult,
    },
    total_turns: turnIndex + 1,
  });
}

// ---------------------------------------------------------------------------
// handleGetSession
// ---------------------------------------------------------------------------

export async function handleGetSession(request, env, pathname) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  const sessionData = await getSession({ env, claims, sessionId });
  if (!sessionData) {
    return errorResponse("Session not found", 404);
  }

  // Plan §1.3 — strip secrets from response.
  const session = { ...sessionData.session };
  delete session.hmac_sig;
  delete session.retrieve_code;

  const normalizedTurns = sessionData.turns.map((t) => ({
    turn_id: t.turn_id,
    turn_index: t.turn_index,
    user_message: t.user_message,
    case_context: t.user_case_context ?? "",
    retrieved_cases: t.retrieved_cases ?? null,
    created_at: t.created_at,
    ...(t.payload ?? {}),
  }));

  return jsonResponse({
    session,
    turns: normalizedTurns,
  });
}

// ---------------------------------------------------------------------------
// handleListSessions
// ---------------------------------------------------------------------------

export async function handleListSessions(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
  const before = url.searchParams.get("before") || null;

  const sessions = await listSessions({ env, claims, limit, before });

  return jsonResponse({ sessions });
}

// ---------------------------------------------------------------------------
// handleDeleteSession
// ---------------------------------------------------------------------------

export async function handleDeleteSession(request, env, pathname) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  const deleted = await deleteSession({ env, claims, sessionId });
  if (!deleted) {
    return errorResponse("Session not found", 404);
  }

  return jsonResponse({ deleted: true });
}

// ---------------------------------------------------------------------------
// handleLegacyRun (ephemeral — no auth, no DB)
// ---------------------------------------------------------------------------

export async function handleLegacyRun(request, env) {
  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON");
  }
  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const validationError = validateMessageBody(body, "question");
  if (validationError) {
    return errorResponse(validationError.error);
  }

  const question = body.question.trim();
  const caseContext = typeof body.context === "string" ? body.context : "";

  let councilResult;
  try {
    councilResult = await runCouncil({
      env,
      question,
      caseContext,
      prevTurns: [],
    });
  } catch (err) {
    return errorResponse(`LLM Council error: ${err.message}`, 503);
  }

  return jsonResponse({
    question: councilResult.question,
    case_context: councilResult.case_context,
    models: councilResult.models,
    opinions: councilResult.opinions,
    moderator: councilResult.moderator,
    retrieved_cases: [],
  });
}

// ---------------------------------------------------------------------------
// handleStreamCouncil
// ---------------------------------------------------------------------------

export async function handleStreamCouncil(request, env, _path, ctx) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  let body;
  try { body = await request.json(); }
  catch { return errorResponse("Request body must be valid JSON"); }
  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const validationError = validateMessageBody(body, "message");
  if (validationError) return errorResponse(validationError.error);

  const message = body.message.trim();
  const caseContext = typeof body.case_context === "string" ? body.case_context : "";
  const caseId = body.case_id || null;

  const sessionId = nanoid21();
  const sessionToken = await mintToken(env, sessionId);
  const retrieveCode = generateRetrieveCode();
  const turnId = nanoid21();
  const title = message.slice(0, 80);

  let result;
  try {
    result = streamCouncil({
      env,
      question: message,
      caseContext,
      prevTurns: [],
      sessionMeta: {
        session_id: sessionId,
        session_token: sessionToken,
        retrieve_code: retrieveCode,
      },
    });
  } catch (err) {
    return errorResponse(`LLM Council stream error: ${err.message}`, 503);
  }

  const persistTask = result.work.then(async (councilResult) => {
    if (!councilResult || typeof councilResult !== "object") return;
    try {
      let codeUsed = retrieveCode;
      try {
        await createSession({
          env, claims, sessionId, caseId, title,
          hmacSig: sessionToken, retrieveCode: codeUsed,
        });
      } catch (err) {
        if (String(err?.message || "").includes("retrieve_code")) {
          codeUsed = generateRetrieveCode();
          await createSession({
            env, claims, sessionId, caseId, title,
            hmacSig: sessionToken, retrieveCode: codeUsed,
          });
        } else { throw err; }
      }
      await addTurn({
        env,
        claims,
        sessionId,
        turnId,
        turnIndex: 0,
        userMessage: message,
        userCaseContext: caseContext || null,
        payload: councilResult,
        retrievedCases: councilResult.retrieved_cases || null,
        totalTokens: null,
        totalLatencyMs: null,
      });
    } catch (err) {
      console.error("[stream-persist] failed:", err?.message || err);
    }
  });

  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(persistTask);
  }

  return new Response(result.readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// handleRestoreByCode
// ---------------------------------------------------------------------------

export async function handleRestoreByCode(request, env) {
  const authResult = await requireSessionAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  let body;
  try { body = await request.json(); }
  catch { return errorResponse("Request body must be valid JSON"); }
  if (!body || typeof body !== "object") {
    return errorResponse("Request body must be a JSON object");
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code || code.length !== 6) {
    return errorResponse("code must be a 6-character string", 400);
  }
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code)) {
    return errorResponse("code contains invalid characters", 400);
  }

  const session = await getSessionByCode({ env, claims, code });
  if (!session) {
    return errorResponse("Code not found", 404);
  }

  const sessionToken = await mintToken(env, session.session_id);

  return jsonResponse({
    session_id: session.session_id,
    session_token: sessionToken,
    retrieve_code: session.retrieve_code,
  });
}
