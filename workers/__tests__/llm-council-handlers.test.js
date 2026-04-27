/**
 * llm-council-handlers.test.js
 *
 * Vitest integration tests for workers/llm-council/handlers.js
 *
 * WHY MOCKING IS REQUIRED:
 *   - storage.js opens real Postgres connections via Hyperdrive (no DB in test env)
 *   - runner.js calls the live Cloudflare AI Gateway (requires production secrets)
 *   - auth.js uses Web Crypto which IS available in Node 18+ — NOT mocked;
 *     real mintToken/verifyToken so token round-trips are genuine HMAC operations.
 *
 * MOCK SCOPE:
 *   vi.mock("../llm-council/storage.js")  — all 6 storage functions
 *   vi.mock("../llm-council/runner.js")   — runCouncil only
 *
 * TEST INTEGRITY (plan §4):
 *   Every assertion below was subjected to a red-green cycle:
 *     1. Expected value flipped → test went RED
 *     2. Expected value restored → test went GREEN
 *   Evidence in the US-006 completion report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock storage — all functions are vi.fn() returning configurable values
// ---------------------------------------------------------------------------

const mockCreateSession = vi.fn();
const mockAddTurn = vi.fn();
const mockGetSession = vi.fn();
const mockListSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockLoadHistory = vi.fn();

vi.mock("../llm-council/storage.js", () => ({
  createSession: (...a) => mockCreateSession(...a),
  addTurn: (...a) => mockAddTurn(...a),
  getSession: (...a) => mockGetSession(...a),
  listSessions: (...a) => mockListSessions(...a),
  deleteSession: (...a) => mockDeleteSession(...a),
  loadHistory: (...a) => mockLoadHistory(...a),
}));

// ---------------------------------------------------------------------------
// Mock runner — runCouncil returns a predictable council result
// ---------------------------------------------------------------------------

const mockRunCouncil = vi.fn();

vi.mock("../llm-council/runner.js", () => ({
  runCouncil: (...a) => mockRunCouncil(...a),
}));

// Import AFTER mocks are set up
import {
  handleCreateSession,
  handleAddTurn,
  handleGetSession,
  handleListSessions,
  handleDeleteSession,
  handleLegacyRun,
} from "../llm-council/handlers.js";

import { mintToken } from "../llm-council/auth.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fake CSRF_SECRET — stable across mint + verify in the same test. */
const FAKE_SECRET = "test-csrf-secret-handlers-9f8e7d6c";

/**
 * Minimal env with CSRF_SECRET and a mock RL_COUNCIL_TURN binding.
 * RL binding is configured per-test via rlSuccess flag.
 */
function makeEnv({ rlSuccess = true } = {}) {
  return {
    CSRF_SECRET: FAKE_SECRET,
    RL_COUNCIL_TURN: {
      limit: vi.fn().mockResolvedValue({ success: rlSuccess }),
    },
  };
}

/** Build a fake council result matching runCouncil's return shape. */
function makeFakeCouncil(question = "What are visa grounds?") {
  return {
    question,
    case_context: "",
    gateway: { url: "https://gateway.example.com" },
    models: {
      openai: { provider: "OpenAI", model: "openai/gpt-5-mini", system_prompt: "..." },
      gemini_pro: { provider: "Google", model: "gemini-pro", system_prompt: "..." },
      anthropic: { provider: "Anthropic", model: "claude-sonnet", system_prompt: "..." },
      gemini_flash: { provider: "Google", model: "gemini-flash", system_prompt: "..." },
    },
    opinions: [
      { provider_key: "openai", success: true, answer: "OpenAI answer", sources: [], latency_ms: 100 },
      { provider_key: "gemini_pro", success: true, answer: "Gemini answer", sources: [], latency_ms: 120 },
      { provider_key: "anthropic", success: true, answer: "Anthropic answer", sources: [], latency_ms: 110 },
    ],
    moderator: {
      model: "gemini-flash",
      success: true,
      composed_answer: "Moderated synthesis of all opinions.",
      ranking: [],
      model_critiques: [],
      consensus_points: [],
      dissent_points: [],
      key_authorities: [],
      research_checklist: [],
      latency_ms: 200,
    },
  };
}

/**
 * Build a Request-like object.
 * @param {string} method
 * @param {string} url
 * @param {object|null} body
 * @param {object} [headers]
 */
function makeRequest(method, url, body = null, headers = {}) {
  const hdrs = new Headers({
    "Content-Type": "application/json",
    ...headers,
  });
  return new Request(url, {
    method,
    headers: hdrs,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
}

/** Parse a Response as JSON. */
async function parseJson(response) {
  return response.json();
}

// ---------------------------------------------------------------------------
// beforeEach: reset all mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default storage returns
  mockCreateSession.mockResolvedValue({ session_id: "fake-session-id", total_turns: 0 });
  mockAddTurn.mockResolvedValue({ turn_id: "fake-turn-id", turn_index: 0 });
  mockGetSession.mockResolvedValue({
    session: { session_id: "fake-session-id", total_turns: 2, status: "active" },
    turns: [],
  });
  mockListSessions.mockResolvedValue([]);
  mockDeleteSession.mockResolvedValue(true);
  mockLoadHistory.mockResolvedValue([]);

  // Default runner returns a valid council result
  mockRunCouncil.mockResolvedValue(makeFakeCouncil());
});

// ===========================================================================
// handleCreateSession
// ===========================================================================

describe("handleCreateSession", () => {
  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with {session_id, session_token, turn, total_turns: 1} on valid body", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/api/v1/llm-council/sessions", {
      message: "What are the visa grounds?",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    expect(typeof json.session_id).toBe("string");
    expect(json.session_id.length).toBe(21);
    expect(typeof json.session_token).toBe("string");
    expect(json.session_token.length).toBeGreaterThan(0);
    expect(json.total_turns).toBe(1);
    expect(json.turn).toBeDefined();
    expect(json.turn.user_message).toBe("What are the visa grounds?");
    expect(json.turn.turn_index).toBe(0);
  });

  it("calls createSession and addTurn in storage", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "Test message",
    });

    await handleCreateSession(req, env);

    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockAddTurn).toHaveBeenCalledOnce();

    const addTurnCall = mockAddTurn.mock.calls[0][0];
    expect(addTurnCall.turnIndex).toBe(0);
    expect(addTurnCall.userMessage).toBe("Test message");
  });

  it("calls runCouncil with the message and empty prevTurns", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "Council question",
    });

    await handleCreateSession(req, env);

    expect(mockRunCouncil).toHaveBeenCalledOnce();
    const callArgs = mockRunCouncil.mock.calls[0][0];
    expect(callArgs.question).toBe("Council question");
    expect(callArgs.prevTurns).toEqual([]);
  });

  // ── 400 validation ──────────────────────────────────────────────────────

  it("returns 400 when message is missing", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      case_id: "abc123def456",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("message");
  });

  it("returns 400 when message exceeds 5000 characters", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "x".repeat(5001),
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("5000");
  });

  it("accepts a message of exactly 5000 characters", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "x".repeat(5000),
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(200);
  });

  it("returns 400 when case_id is not a 12-hex string", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "Valid message",
      case_id: "INVALID-CASE",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("case_id");
  });

  it("accepts a valid 12-hex case_id", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "Valid message",
      case_id: "abc123def456",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(200);
  });

  it("returns 400 on invalid JSON body", async () => {
    const env = makeEnv();
    const req = new Request("https://example.com/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(400);
  });

  // ── 429 rate limit ──────────────────────────────────────────────────────

  it("returns 429 when RL_COUNCIL_TURN.limit returns {success: false}", async () => {
    const env = makeEnv({ rlSuccess: false });
    const req = makeRequest("POST", "https://example.com/sessions", {
      message: "Rate limited question",
    });

    const res = await handleCreateSession(req, env);
    expect(res.status).toBe(429);

    const json = await parseJson(res);
    expect(json.error).toContain("Rate limit");
  });
});

// ===========================================================================
// handleAddTurn
// ===========================================================================

describe("handleAddTurn", () => {
  const SESSION_ID = "abcdefghijk12";

  /** Helper: mint a real token for SESSION_ID using FAKE_SECRET. */
  async function mintFakeToken(sessionId = SESSION_ID) {
    return mintToken({ CSRF_SECRET: FAKE_SECRET }, sessionId);
  }

  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with {turn, total_turns} on valid request", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [],
    });

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Follow-up question" },
      { "X-Session-Token": token },
    );

    const pathname = `/sessions/${SESSION_ID}/turns`;
    const res = await handleAddTurn(req, env, pathname);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    expect(json.turn).toBeDefined();
    expect(json.turn.user_message).toBe("Follow-up question");
    expect(json.total_turns).toBe(2);
  });

  it("calls runCouncil with history from loadHistory", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [],
    });
    mockLoadHistory.mockResolvedValue([
      { user_message: "First question", assistant_message: "Prior answer" },
    ]);

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Second question" },
      { "X-Session-Token": token },
    );

    await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);

    expect(mockRunCouncil).toHaveBeenCalledOnce();
    const callArgs = mockRunCouncil.mock.calls[0][0];
    expect(callArgs.prevTurns).toHaveLength(1);
    expect(callArgs.prevTurns[0].user_message).toBe("First question");
  });

  // ── 400 bad body ────────────────────────────────────────────────────────

  it("returns 400 when message is missing", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [],
    });

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      {},
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("message");
  });

  it("returns 400 when message exceeds 5000 characters", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [],
    });

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "y".repeat(5001) },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(400);
  });

  // ── 403 auth ────────────────────────────────────────────────────────────

  it("returns 403 when X-Session-Token header is missing", async () => {
    const env = makeEnv();
    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Test" },
      // No X-Session-Token header
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(403);

    const json = await parseJson(res);
    expect(json.error).toContain("Session-Token");
  });

  it("returns 403 when X-Session-Token is tampered (1 char changed)", async () => {
    const env = makeEnv();
    const realToken = await mintFakeToken();
    // Tamper: flip the first character
    const tamperedToken =
      realToken[0] === "A" ? "B" + realToken.slice(1) : "A" + realToken.slice(1);

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Test" },
      { "X-Session-Token": tamperedToken },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when token is for a different session_id", async () => {
    const env = makeEnv();
    // Mint token for a DIFFERENT session ID
    const wrongToken = await mintToken({ CSRF_SECRET: FAKE_SECRET }, "differentSessionXyz");

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Test" },
      { "X-Session-Token": wrongToken },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(403);
  });

  // ── 404 not found ───────────────────────────────────────────────────────

  it("returns 404 when session does not exist", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue(null);

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Test" },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(404);

    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });

  // ── 409 at cap ──────────────────────────────────────────────────────────

  it("returns 409 when total_turns is exactly 15", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 15, status: "active" },
      turns: [],
    });

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "One more" },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(409);

    const json = await parseJson(res);
    expect(json.error).toContain("15");
  });

  it("does NOT return 409 when total_turns is 14 (cap not yet reached)", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 14, status: "active" },
      turns: [],
    });

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Turn 15" },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(200);
  });

  // ── 409 race condition ──────────────────────────────────────────────────

  it("returns 409 when addTurn returns null (concurrent duplicate turn)", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [],
    });
    mockAddTurn.mockResolvedValue(null); // simulate race conflict

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Concurrent turn" },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(409);

    const json = await parseJson(res);
    expect(json.error).toContain("conflict");
  });

  // ── 429 rate limit ──────────────────────────────────────────────────────

  it("returns 429 when rate limit is exceeded", async () => {
    const env = makeEnv({ rlSuccess: false });
    const token = await mintFakeToken();

    const req = makeRequest(
      "POST",
      `https://example.com/sessions/${SESSION_ID}/turns`,
      { message: "Rate limited" },
      { "X-Session-Token": token },
    );

    const res = await handleAddTurn(req, env, `/sessions/${SESSION_ID}/turns`);
    expect(res.status).toBe(429);
  });
});

// ===========================================================================
// handleGetSession
// ===========================================================================

describe("handleGetSession", () => {
  const SESSION_ID = "getsession12345";

  async function mintFakeToken(sid = SESSION_ID) {
    return mintToken({ CSRF_SECRET: FAKE_SECRET }, sid);
  }

  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with {session, turns} on valid token", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 3, status: "active" },
      turns: [{ turn_index: 0 }, { turn_index: 1 }, { turn_index: 2 }],
    });

    const req = makeRequest(
      "GET",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": token },
    );

    const res = await handleGetSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    expect(json.session).toBeDefined();
    expect(json.session.session_id).toBe(SESSION_ID);
    expect(json.turns).toHaveLength(3);
  });

  // ── 403 ─────────────────────────────────────────────────────────────────

  it("returns 403 when X-Session-Token is missing", async () => {
    const env = makeEnv();
    const req = makeRequest("GET", `https://example.com/sessions/${SESSION_ID}`, null);

    const res = await handleGetSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when X-Session-Token is invalid", async () => {
    const env = makeEnv();
    const req = makeRequest(
      "GET",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": "totally-invalid-token" },
    );

    const res = await handleGetSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(403);
  });

  // ── 404 ─────────────────────────────────────────────────────────────────

  it("returns 404 when session does not exist", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockGetSession.mockResolvedValue(null);

    const req = makeRequest(
      "GET",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": token },
    );

    const res = await handleGetSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);

    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });

  // ── shape normalization (regression: production reload-after-create crash) ─

  it("normalizes turn shape: spreads payload onto turn (parity with create/add)", async () => {
    // Production bug discovered via e2e (US-012): handleCreateSession spread
    // councilResult onto turn, but handleGetSession returned raw DB rows where
    // opinions/moderator are nested under turn.payload. Frontend TurnCard read
    // turn.opinions.length → "Cannot read properties of undefined" after reload.
    // This test pins the contract that GET response normalizes to the same flat
    // shape as POST.
    const env = makeEnv();
    const token = await mintFakeToken();
    const council = makeFakeCouncil("What grounds for review?");

    // Simulate raw DB row shape from storage.getSession (payload nested)
    mockGetSession.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, status: "active" },
      turns: [
        {
          turn_id: "turn-001",
          session_id: SESSION_ID,
          turn_index: 0,
          user_message: "What grounds for review?",
          user_case_context: null,
          payload: council,
          retrieved_cases: null,
          total_tokens: null,
          total_latency_ms: null,
          created_at: "2026-04-28T07:30:00Z",
        },
      ],
    });

    const req = makeRequest(
      "GET",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": token },
    );

    const res = await handleGetSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);
    const json = await parseJson(res);

    expect(json.turns).toHaveLength(1);
    const t = json.turns[0];

    // Top-level metadata preserved
    expect(t.turn_id).toBe("turn-001");
    expect(t.turn_index).toBe(0);
    expect(t.user_message).toBe("What grounds for review?");

    // CRITICAL: opinions and moderator are flat at top level, NOT nested
    expect(Array.isArray(t.opinions)).toBe(true);
    expect(t.opinions).toHaveLength(3);
    expect(t.moderator).toBeDefined();
    expect(t.moderator.composed_answer).toBe("Moderated synthesis of all opinions.");
    expect(t.models).toBeDefined();
    expect(t.models.openai).toBeDefined();

    // The payload key itself MUST NOT be present (would defeat the spread purpose)
    expect(t.payload).toBeUndefined();
  });
});

// ===========================================================================
// handleListSessions
// ===========================================================================

describe("handleListSessions", () => {
  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with {sessions: [...]} on default params", async () => {
    const env = makeEnv();
    mockListSessions.mockResolvedValue([
      { session_id: "s1", total_turns: 2 },
      { session_id: "s2", total_turns: 5 },
    ]);

    const req = makeRequest("GET", "https://example.com/sessions", null);
    const res = await handleListSessions(req, env);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    expect(json.sessions).toHaveLength(2);
    expect(json.sessions[0].session_id).toBe("s1");
    expect(json.sessions[1].session_id).toBe("s2");
  });

  it("passes limit and before params to storage.listSessions", async () => {
    const env = makeEnv();
    mockListSessions.mockResolvedValue([]);

    const req = makeRequest(
      "GET",
      "https://example.com/sessions?limit=5&before=2026-01-01T00:00:00Z",
      null,
    );
    await handleListSessions(req, env);

    expect(mockListSessions).toHaveBeenCalledOnce();
    const args = mockListSessions.mock.calls[0][0];
    expect(args.limit).toBe(5);
    expect(args.before).toBe("2026-01-01T00:00:00Z");
  });

  it("returns empty sessions array when no sessions exist", async () => {
    const env = makeEnv();
    mockListSessions.mockResolvedValue([]);

    const req = makeRequest("GET", "https://example.com/sessions", null);
    const res = await handleListSessions(req, env);
    const json = await parseJson(res);
    expect(json.sessions).toEqual([]);
  });
});

// ===========================================================================
// handleDeleteSession
// ===========================================================================

describe("handleDeleteSession", () => {
  const SESSION_ID = "deleteme123456";

  async function mintFakeToken(sid = SESSION_ID) {
    return mintToken({ CSRF_SECRET: FAKE_SECRET }, sid);
  }

  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with {deleted: true} when session exists", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockDeleteSession.mockResolvedValue(true);

    const req = makeRequest(
      "DELETE",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": token },
    );

    const res = await handleDeleteSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    expect(json.deleted).toBe(true);
  });

  // ── 403 ─────────────────────────────────────────────────────────────────

  it("returns 403 when X-Session-Token is missing", async () => {
    const env = makeEnv();
    const req = makeRequest("DELETE", `https://example.com/sessions/${SESSION_ID}`, null);

    const res = await handleDeleteSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when X-Session-Token is for the wrong session", async () => {
    const env = makeEnv();
    const wrongToken = await mintToken({ CSRF_SECRET: FAKE_SECRET }, "wrong-session-zzz");

    const req = makeRequest(
      "DELETE",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": wrongToken },
    );

    const res = await handleDeleteSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(403);
  });

  // ── 404 ─────────────────────────────────────────────────────────────────

  it("returns 404 when session does not exist", async () => {
    const env = makeEnv();
    const token = await mintFakeToken();
    mockDeleteSession.mockResolvedValue(false);

    const req = makeRequest(
      "DELETE",
      `https://example.com/sessions/${SESSION_ID}`,
      null,
      { "X-Session-Token": token },
    );

    const res = await handleDeleteSession(req, env, `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(404);

    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });
});

// ===========================================================================
// handleLegacyRun
// ===========================================================================

describe("handleLegacyRun", () => {
  // ── happy path ──────────────────────────────────────────────────────────

  it("returns 200 with Flask-compatible shape {question, case_context, models, opinions, moderator, retrieved_cases}", async () => {
    const env = makeEnv();
    const councilResult = makeFakeCouncil("Legacy question");
    mockRunCouncil.mockResolvedValue(councilResult);

    const req = makeRequest("POST", "https://example.com/run", {
      question: "Legacy question",
    });

    const res = await handleLegacyRun(req, env);
    expect(res.status).toBe(200);

    const json = await parseJson(res);
    // Must match Flask /llm-council/run shape
    expect(json.question).toBe("Legacy question");
    expect(json.case_context).toBeDefined();
    expect(json.models).toBeDefined();
    expect(Array.isArray(json.opinions)).toBe(true);
    expect(json.moderator).toBeDefined();
    expect(Array.isArray(json.retrieved_cases)).toBe(true);
  });

  it("does NOT call createSession or addTurn (ephemeral, no DB write)", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/run", {
      question: "Ephemeral question",
    });

    await handleLegacyRun(req, env);

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAddTurn).not.toHaveBeenCalled();
  });

  it("passes context field to runCouncil as caseContext", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/run", {
      question: "Question with context",
      context: "Some case context",
    });

    await handleLegacyRun(req, env);

    expect(mockRunCouncil).toHaveBeenCalledOnce();
    const callArgs = mockRunCouncil.mock.calls[0][0];
    expect(callArgs.caseContext).toBe("Some case context");
  });

  // ── 400 validation ──────────────────────────────────────────────────────

  it("returns 400 when question is missing", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/run", {
      context: "Some context",
    });

    const res = await handleLegacyRun(req, env);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("question");
  });

  it("returns 400 when question exceeds 5000 characters", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/run", {
      question: "z".repeat(5001),
    });

    const res = await handleLegacyRun(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when case_id has wrong format", async () => {
    const env = makeEnv();
    const req = makeRequest("POST", "https://example.com/run", {
      question: "Valid question",
      case_id: "NOTVALID",
    });

    const res = await handleLegacyRun(req, env);
    expect(res.status).toBe(400);

    const json = await parseJson(res);
    expect(json.error).toContain("case_id");
  });

  // ── 429 rate limit ──────────────────────────────────────────────────────

  it("returns 429 when rate limit is exceeded", async () => {
    const env = makeEnv({ rlSuccess: false });
    const req = makeRequest("POST", "https://example.com/run", {
      question: "Rate limited",
    });

    const res = await handleLegacyRun(req, env);
    expect(res.status).toBe(429);
  });
});
