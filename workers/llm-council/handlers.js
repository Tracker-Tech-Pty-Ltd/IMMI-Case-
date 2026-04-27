/**
 * workers/llm-council/handlers.js
 *
 * Six endpoint handler functions for the LLM Council Worker.
 * Each is a (request, env) → Response function with no router knowledge.
 *
 * Handler list:
 *   handleCreateSession   POST /sessions
 *   handleAddTurn         POST /sessions/:id/turns
 *   handleGetSession      GET  /sessions/:id
 *   handleListSessions    GET  /sessions
 *   handleDeleteSession   DELETE /sessions/:id
 *   handleLegacyRun       POST /run  (backward compat, ephemeral — no DB)
 *
 * Auth flow:
 *   - handleCreateSession: rate-limit only (mints token on success)
 *   - handleAddTurn / handleGetSession / handleDeleteSession: verifyToken from
 *     X-Session-Token header
 *   - handleListSessions: no auth (list is not sensitive; protected by rate limit)
 *   - handleLegacyRun: rate-limit only
 */

import { mintToken, verifyToken, nanoid21 } from "./auth.js";
import {
  createSession,
  addTurn,
  getSession,
  listSessions,
  deleteSession,
  loadHistory,
} from "./storage.js";
import { runCouncil } from "./runner.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 5000;
const VALID_CASE_ID_RE = /^[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return a JSON Response with the given body object and status.
 * @param {object} body
 * @param {number} [status=200]
 * @returns {Response}
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Return a JSON error response.
 * @param {string} message
 * @param {number} [status=400]
 * @returns {Response}
 */
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

/**
 * Extract the client IP from the request for rate-limiting.
 * Prefers CF-Connecting-IP (set by Cloudflare), falls back to X-Forwarded-For,
 * then a static fallback so tests can omit the header.
 * @param {Request} request
 * @returns {string}
 */
function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Apply RL_COUNCIL_TURN rate limit for the given request.
 * Returns {success: true} or {success: false}.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<{success: boolean}>}
 */
async function applyRateLimit(request, env) {
  if (!env.RL_COUNCIL_TURN) return { success: true };
  return env.RL_COUNCIL_TURN.limit({ key: clientIp(request) });
}

/**
 * Extract session_id from a URL path such as /sessions/:id or /sessions/:id/turns.
 * Returns the segment after the last "/sessions/" prefix.
 * @param {string} pathname
 * @returns {string}
 */
function extractSessionId(pathname) {
  const m = pathname.match(/\/sessions\/([^/]+)/);
  return m ? m[1] : "";
}

/**
 * Validate the common message body fields.
 * Returns {error: string} on failure, null on success.
 * @param {object} body - parsed JSON body
 * @param {string} messageKey - key name for message field ("message" or "question")
 * @returns {{error: string}|null}
 */
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

// ---------------------------------------------------------------------------
// handleCreateSession
// ---------------------------------------------------------------------------

/**
 * POST /sessions
 *
 * Body: {message, case_id?, case_context?}
 *
 * Flow:
 *   1. Rate-limit by IP
 *   2. Parse + validate body
 *   3. Generate session_id (nanoid21) + mint token
 *   4. Run runCouncil (turn 0, no history)
 *   5. createSession + addTurn in storage
 *   6. Return {session_id, session_token, turn, total_turns: 1}
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleCreateSession(request, env) {
  // 1. Rate limit
  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  // 2. Parse + validate
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

  // 3. Generate IDs + token
  const sessionId = nanoid21();
  const turnId = nanoid21();
  const sessionToken = await mintToken(env, sessionId);

  // 4. Run council (turn 0, no history)
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

  // Derive a title from the first 80 chars of the message
  const title = message.slice(0, 80);

  // 5. Persist session + turn
  await createSession({
    env,
    sessionId,
    caseId,
    title,
    hmacSig: sessionToken,
  });

  await addTurn({
    env,
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

  // 6. Respond
  return jsonResponse({
    session_id: sessionId,
    session_token: sessionToken,
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

/**
 * POST /sessions/:id/turns
 *
 * Headers: X-Session-Token
 * Body: {message}
 *
 * Flow:
 *   1. Parse session_id from path
 *   2. verifyToken from header → 403 if invalid
 *   3. Rate-limit
 *   4. Parse + validate body
 *   5. getSession → 404 if missing
 *   6. Check total_turns < 15 → 409 if at cap
 *   7. loadHistory
 *   8. runCouncil with history
 *   9. addTurn (race-safe; null → 409)
 *  10. Return {turn, total_turns}
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} pathname - e.g. "/api/v1/llm-council/sessions/abc123/turns"
 * @returns {Promise<Response>}
 */
export async function handleAddTurn(request, env, pathname) {
  // 1. Session ID from path
  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  // 2. Auth
  const token = request.headers.get("X-Session-Token") || "";
  const valid = await verifyToken(env, sessionId, token);
  if (!valid) {
    return errorResponse("Invalid or missing X-Session-Token", 403);
  }

  // 3. Rate limit
  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  // 4. Parse + validate body
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

  // 5. Load session
  const sessionData = await getSession({ env, sessionId });
  if (!sessionData) {
    return errorResponse("Session not found", 404);
  }

  // 6. Turn cap check
  if (sessionData.session.total_turns >= 15) {
    return errorResponse("Session has reached the maximum of 15 turns", 409);
  }

  // 7. Load history
  const history = await loadHistory({ env, sessionId });

  // 8. Run council
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

  // 9. Persist turn (race-safe)
  const turnRow = await addTurn({
    env,
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

  // 10. Respond
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

/**
 * GET /sessions/:id
 *
 * Headers: X-Session-Token
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
export async function handleGetSession(request, env, pathname) {
  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  const token = request.headers.get("X-Session-Token") || "";
  const valid = await verifyToken(env, sessionId, token);
  if (!valid) {
    return errorResponse("Invalid or missing X-Session-Token", 403);
  }

  const sessionData = await getSession({ env, sessionId });
  if (!sessionData) {
    return errorResponse("Session not found", 404);
  }

  // Normalize turn shape to match handleCreateSession / handleAddTurn responses
  // (frontend LlmCouncilTurn type expects opinions/moderator/etc at the top level,
  // not nested under turn.payload). Without this, reload-after-create crashes
  // TurnCard with "Cannot read properties of undefined (reading 'length')".
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
    session: sessionData.session,
    turns: normalizedTurns,
  });
}

// ---------------------------------------------------------------------------
// handleListSessions
// ---------------------------------------------------------------------------

/**
 * GET /sessions
 *
 * Query: ?limit=20&before=<ISO timestamp>
 *
 * No auth required (not sensitive; protected by global rate limit).
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleListSessions(request, env) {
  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 20 : limitRaw;
  const before = url.searchParams.get("before") || null;

  const sessions = await listSessions({ env, limit, before });

  return jsonResponse({ sessions });
}

// ---------------------------------------------------------------------------
// handleDeleteSession
// ---------------------------------------------------------------------------

/**
 * DELETE /sessions/:id
 *
 * Headers: X-Session-Token
 *
 * @param {Request} request
 * @param {object} env
 * @param {string} pathname
 * @returns {Promise<Response>}
 */
export async function handleDeleteSession(request, env, pathname) {
  const sessionId = extractSessionId(pathname || new URL(request.url).pathname);
  if (!sessionId) {
    return errorResponse("session_id missing from path", 400);
  }

  const token = request.headers.get("X-Session-Token") || "";
  const valid = await verifyToken(env, sessionId, token);
  if (!valid) {
    return errorResponse("Invalid or missing X-Session-Token", 403);
  }

  const deleted = await deleteSession({ env, sessionId });
  if (!deleted) {
    return errorResponse("Session not found", 404);
  }

  return jsonResponse({ deleted: true });
}

// ---------------------------------------------------------------------------
// handleLegacyRun
// ---------------------------------------------------------------------------

/**
 * POST /run  (backward compat — matches Flask /llm-council/run shape)
 *
 * Body: {question, case_id?, context?}
 *
 * Ephemeral — no session or turn is created in DB.
 *
 * Returns the same shape as Flask /llm-council/run:
 *   {question, case_context, models, opinions, moderator, retrieved_cases?}
 *
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleLegacyRun(request, env) {
  // Rate limit
  const rl = await applyRateLimit(request, env);
  if (!rl.success) {
    return errorResponse("Rate limit exceeded — try again shortly", 429);
  }

  // Parse + validate
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

  // Run council (no history — single-shot)
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

  // Return Flask-compatible shape:
  // {question, case_context, models, opinions, moderator, retrieved_cases}
  return jsonResponse({
    question: councilResult.question,
    case_context: councilResult.case_context,
    models: councilResult.models,
    opinions: councilResult.opinions,
    moderator: councilResult.moderator,
    retrieved_cases: [],
  });
}
