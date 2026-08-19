/**
 * llm-council-handlers.test.js
 *
 * Vitest integration tests for workers/llm-council/handlers.js (post plan
 * §1.3-§1.4 rewrite — every persistence-touching endpoint requires a verified
 * JWT and writes/reads under tenant context).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateSession = vi.fn();
const mockAddTurn = vi.fn();
const mockGetSession = vi.fn();
const mockGetSessionByCode = vi.fn();
const mockListSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockLoadHistory = vi.fn();
const mockGenerateRetrieveCode = vi.fn(() => "TEST00");

vi.mock("../llm-council/storage.js", () => ({
  createSession: (...a) => mockCreateSession(...a),
  addTurn: (...a) => mockAddTurn(...a),
  getSession: (...a) => mockGetSession(...a),
  getSessionByCode: (...a) => mockGetSessionByCode(...a),
  listSessions: (...a) => mockListSessions(...a),
  deleteSession: (...a) => mockDeleteSession(...a),
  loadHistory: (...a) => mockLoadHistory(...a),
  generateRetrieveCode: () => mockGenerateRetrieveCode(),
}));

const mockRunCouncil = vi.fn();
vi.mock("../llm-council/runner.js", () => ({
  runCouncil: (...a) => mockRunCouncil(...a),
  streamCouncil: vi.fn(),
}));

const mockVerifyJwt = vi.fn();
vi.mock("../auth/jwt.js", () => ({
  verifyJwt: (...a) => mockVerifyJwt(...a),
}));

import {
  handleCreateSession,
  handleAddTurn,
  handleGetSession,
  handleListSessions,
  handleDeleteSession,
  handleRestoreByCode,
  handleLegacyRun,
} from "../llm-council/handlers.js";

const VALID_CLAIMS = {
  sub: "11111111-2222-3333-4444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
  role: "member",
  kid: "v1",
  exp: 4070908800,
};

const VALID_TOKEN = "valid.jwt.token";
const BEARER_HEADERS = { Authorization: `Bearer ${VALID_TOKEN}` };

function makeEnv({ rlSuccess = true } = {}) {
  return {
    CSRF_SECRET: "fake-csrf-secret",
    HYPERDRIVE: { connectionString: "postgres://test/test" },
    JWT_SECRET_CURRENT: "fake-jwt-secret",
    JWT_KID_CURRENT: "v1",
    RL_COUNCIL_TURN: {
      limit: vi.fn().mockResolvedValue({ success: rlSuccess }),
    },
  };
}

function makeFakeCouncil(question = "Q") {
  return {
    question,
    case_context: "",
    gateway: { url: "" },
    models: { openai: {}, gemini_pro: {}, anthropic: {}, gemini_flash: {} },
    opinions: [{ provider_key: "openai", success: true, answer: "x" }],
    moderator: { composed_answer: "synthesised", success: true },
  };
}

function makeRequest(method, url, body = null, headers = {}) {
  return new Request(url, {
    method,
    headers: new Headers({ "Content-Type": "application/json", ...headers }),
    body: body !== null ? JSON.stringify(body) : undefined,
  });
}

const parseJson = (response) => response.json();

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyJwt.mockResolvedValue({ valid: true, payload: VALID_CLAIMS, reason: "" });
  mockCreateSession.mockResolvedValue({
    session_id: "fake-session-id",
    total_turns: 0,
    retrieve_code: "TEST00",
  });
  mockAddTurn.mockResolvedValue({ turn_id: "fake-turn-id", turn_index: 0 });
  mockGetSession.mockResolvedValue({
    session: { session_id: "fake-session-id", total_turns: 2, status: "active" },
    turns: [],
  });
  mockListSessions.mockResolvedValue([]);
  mockDeleteSession.mockResolvedValue(true);
  mockLoadHistory.mockResolvedValue([]);
  mockGetSessionByCode.mockResolvedValue(null);
  mockRunCouncil.mockResolvedValue(makeFakeCouncil());
});

describe("AUTH gate — plan §1.3+§1.4", () => {
  const SESSION_PATH = "/api/v1/llm-council/sessions/abc123def456ghi789jkl";

  async function expect401(handler, request, pathname) {
    const res = pathname
      ? await handler(request, makeEnv(), pathname)
      : await handler(request, makeEnv());
    expect(res.status).toBe(401);
    const json = await parseJson(res);
    expect(json.code).toMatch(/auth_required|auth_invalid|missing/);
  }

  it("handleCreateSession returns 401 without Bearer token", async () => {
    const req = makeRequest("POST", "https://x/sessions", { message: "hi" });
    await expect401(handleCreateSession, req);
  });

  it("handleAddTurn returns 401 without Bearer token", async () => {
    const req = makeRequest("POST", `https://x${SESSION_PATH}/turns`,
      { message: "hi" });
    await expect401(handleAddTurn, req, `${SESSION_PATH}/turns`);
  });

  it("handleGetSession returns 401 without Bearer token", async () => {
    const req = makeRequest("GET", `https://x${SESSION_PATH}`);
    await expect401(handleGetSession, req, SESSION_PATH);
  });

  it("handleListSessions returns 401 without Bearer token (plan §1.3 explicit)", async () => {
    const req = makeRequest("GET", "https://x/sessions");
    await expect401(handleListSessions, req);
  });

  it("handleDeleteSession returns 401 without Bearer token", async () => {
    const req = makeRequest("DELETE", `https://x${SESSION_PATH}`);
    await expect401(handleDeleteSession, req, SESSION_PATH);
  });

  it("handleRestoreByCode returns 401 without Bearer token", async () => {
    const req = makeRequest("POST", "https://x/sessions/restore", { code: "ABCDEF" });
    await expect401(handleRestoreByCode, req);
  });

  it("returns 401 when JWT is invalid (signature mismatch)", async () => {
    mockVerifyJwt.mockResolvedValue({ valid: false, payload: null, reason: "invalid" });
    const req = makeRequest("GET", "https://x/sessions", null, BEARER_HEADERS);
    const res = await handleListSessions(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT is expired", async () => {
    mockVerifyJwt.mockResolvedValue({ valid: false, payload: null, reason: "expired" });
    const req = makeRequest("GET", "https://x/sessions", null, BEARER_HEADERS);
    const res = await handleListSessions(req, makeEnv());
    expect(res.status).toBe(401);
    const json = await parseJson(res);
    expect(json.code).toBe("expired");
  });
});

describe("handleCreateSession (authenticated)", () => {
  it("returns 200 with session_id + retrieve_code (mint-time disclosure allowed)", async () => {
    const req = makeRequest("POST", "https://x/sessions",
      { message: "Q" }, BEARER_HEADERS);
    const res = await handleCreateSession(req, makeEnv());
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(typeof json.session_id).toBe("string");
    expect(json.session_id).toHaveLength(21);
    expect(typeof json.session_token).toBe("string");
    expect(json.total_turns).toBe(1);
    expect(typeof json.retrieve_code).toBe("string");
  });

  it("passes claims to createSession (storage writes tenant_id + created_by)", async () => {
    const req = makeRequest("POST", "https://x/sessions",
      { message: "Q" }, BEARER_HEADERS);
    await handleCreateSession(req, makeEnv());
    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockCreateSession.mock.calls[0][0].claims).toEqual(VALID_CLAIMS);
  });

  it("passes claims to addTurn", async () => {
    const req = makeRequest("POST", "https://x/sessions",
      { message: "Q" }, BEARER_HEADERS);
    await handleCreateSession(req, makeEnv());
    expect(mockAddTurn).toHaveBeenCalledOnce();
    expect(mockAddTurn.mock.calls[0][0].claims).toEqual(VALID_CLAIMS);
  });

  it("returns the Durable Object-assigned initial turn index", async () => {
    mockAddTurn.mockResolvedValue({ turn_id: "fake-turn-id", turn_index: 0 });
    const req = makeRequest("POST", "https://x/sessions", { message: "Q" }, BEARER_HEADERS);
    const res = await handleCreateSession(req, makeEnv());
    expect((await parseJson(res)).turn.turn_index).toBe(0);
  });

  it("returns 400 when message is missing", async () => {
    const req = makeRequest("POST", "https://x/sessions", {}, BEARER_HEADERS);
    const res = await handleCreateSession(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate-limited", async () => {
    const req = makeRequest("POST", "https://x/sessions",
      { message: "Q" }, BEARER_HEADERS);
    const res = await handleCreateSession(req, makeEnv({ rlSuccess: false }));
    expect(res.status).toBe(429);
  });
});

describe("handleListSessions — privacy + tenant scoping", () => {
  it("returns 200 with sessions array on authenticated GET", async () => {
    mockListSessions.mockResolvedValue([
      { session_id: "s1", total_turns: 2 },
      { session_id: "s2", total_turns: 5 },
    ]);
    const req = makeRequest("GET", "https://x/sessions", null, BEARER_HEADERS);
    const res = await handleListSessions(req, makeEnv());
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.sessions).toHaveLength(2);
  });

  it("passes claims to listSessions (tenant filtering via RLS)", async () => {
    const req = makeRequest("GET", "https://x/sessions", null, BEARER_HEADERS);
    await handleListSessions(req, makeEnv());
    expect(mockListSessions).toHaveBeenCalledOnce();
    expect(mockListSessions.mock.calls[0][0].claims).toEqual(VALID_CLAIMS);
  });

  it("never returns hmac_sig / session_token / retrieve_code in the response body", async () => {
    mockListSessions.mockResolvedValue([
      { session_id: "s1", title: "T", status: "active",
        total_turns: 0, created_at: "2026-01-01", updated_at: "2026-01-01" },
    ]);
    const req = makeRequest("GET", "https://x/sessions", null, BEARER_HEADERS);
    const res = await handleListSessions(req, makeEnv());
    const text = await res.text();
    expect(text).not.toContain("hmac_sig");
    expect(text).not.toContain("session_token");
    expect(text).not.toContain("retrieve_code");
  });
});

describe("handleGetSession — secret stripping", () => {
  const SID = "abcdefghijk123456789m";
  const PATH = `/api/v1/llm-council/sessions/${SID}`;

  it("strips hmac_sig + retrieve_code from the session row before responding", async () => {
    mockGetSession.mockResolvedValue({
      session: {
        session_id: SID, title: "T", status: "active", total_turns: 1,
        hmac_sig: "SECRET_HMAC_DO_NOT_LEAK",
        retrieve_code: "SECRET_CODE",
      },
      turns: [],
    });
    const req = makeRequest("GET", `https://x${PATH}`, null, BEARER_HEADERS);
    const res = await handleGetSession(req, makeEnv(), PATH);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET_HMAC_DO_NOT_LEAK");
    expect(text).not.toContain("SECRET_CODE");
    expect(text).not.toContain("hmac_sig");
    expect(text).not.toContain("retrieve_code");
  });

  it("returns 404 when getSession returns null (RLS hidden / not found)", async () => {
    mockGetSession.mockResolvedValue(null);
    const req = makeRequest("GET", `https://x${PATH}`, null, BEARER_HEADERS);
    const res = await handleGetSession(req, makeEnv(), PATH);
    expect(res.status).toBe(404);
  });

  it("passes claims to getSession", async () => {
    const req = makeRequest("GET", `https://x${PATH}`, null, BEARER_HEADERS);
    await handleGetSession(req, makeEnv(), PATH);
    expect(mockGetSession.mock.calls[0][0].claims).toEqual(VALID_CLAIMS);
  });

  it("normalises turn shape (opinions/moderator flat at top level)", async () => {
    const council = makeFakeCouncil("Q");
    mockGetSession.mockResolvedValue({
      session: { session_id: SID, total_turns: 1, status: "active" },
      turns: [{
        turn_id: "t1", session_id: SID, turn_index: 0,
        user_message: "Q", user_case_context: null,
        payload: council, retrieved_cases: null,
        total_tokens: null, total_latency_ms: null,
        created_at: "2026-01-01T00:00:00Z",
      }],
    });
    const req = makeRequest("GET", `https://x${PATH}`, null, BEARER_HEADERS);
    const res = await handleGetSession(req, makeEnv(), PATH);
    const json = await parseJson(res);
    const t = json.turns[0];
    expect(Array.isArray(t.opinions)).toBe(true);
    expect(t.moderator).toBeDefined();
    expect(t.payload).toBeUndefined();
  });
});

describe("handleAddTurn (authenticated)", () => {
  const SID = "abcdefghijk123456789m";
  const PATH = `/api/v1/llm-council/sessions/${SID}/turns`;

  it("returns 200 with turn + total_turns on valid request", async () => {
    mockGetSession.mockResolvedValue({
      session: { session_id: SID, total_turns: 1, status: "active" },
      turns: [],
    });
    mockAddTurn.mockResolvedValue({ turn_id: "fake-turn-id", turn_index: 1 });
    const req = makeRequest("POST", `https://x${PATH}`,
      { message: "Follow up" }, BEARER_HEADERS);
    const res = await handleAddTurn(req, makeEnv(), PATH);
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.turn).toBeDefined();
    expect(json.total_turns).toBe(2);
  });

  it("returns 404 when session is RLS-hidden / missing", async () => {
    mockGetSession.mockResolvedValue(null);
    const req = makeRequest("POST", `https://x${PATH}`,
      { message: "Q" }, BEARER_HEADERS);
    const res = await handleAddTurn(req, makeEnv(), PATH);
    expect(res.status).toBe(404);
  });

  it("returns 409 when total_turns has reached the cap", async () => {
    mockGetSession.mockResolvedValue({
      session: { session_id: SID, total_turns: 15, status: "active" },
      turns: [],
    });
    const req = makeRequest("POST", `https://x${PATH}`,
      { message: "Q" }, BEARER_HEADERS);
    const res = await handleAddTurn(req, makeEnv(), PATH);
    expect(res.status).toBe(409);
  });

  it("returns 409 when addTurn returns null (concurrent race)", async () => {
    mockGetSession.mockResolvedValue({
      session: { session_id: SID, total_turns: 1, status: "active" },
      turns: [],
    });
    mockAddTurn.mockResolvedValue(null);
    const req = makeRequest("POST", `https://x${PATH}`,
      { message: "Q" }, BEARER_HEADERS);
    const res = await handleAddTurn(req, makeEnv(), PATH);
    expect(res.status).toBe(409);
  });

  it("uses the Durable Object-assigned index in its response", async () => {
    mockGetSession.mockResolvedValue({
      session: { session_id: SID, total_turns: 1, status: "active" },
      turns: [],
    });
    mockAddTurn.mockResolvedValue({ turn_id: "fake-turn-id", turn_index: 2 });
    const req = makeRequest("POST", `https://x${PATH}`, { message: "Follow up" }, BEARER_HEADERS);
    const json = await parseJson(await handleAddTurn(req, makeEnv(), PATH));
    expect(json.turn.turn_index).toBe(2);
    expect(json.total_turns).toBe(3);
  });
});

describe("handleDeleteSession", () => {
  const SID = "abcdefghijk123456789m";
  const PATH = `/api/v1/llm-council/sessions/${SID}`;

  it("returns 200 + {deleted:true} on successful delete", async () => {
    const req = makeRequest("DELETE", `https://x${PATH}`, null, BEARER_HEADERS);
    const res = await handleDeleteSession(req, makeEnv(), PATH);
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.deleted).toBe(true);
  });

  it("returns 404 when RLS hides the row / not found", async () => {
    mockDeleteSession.mockResolvedValue(false);
    const req = makeRequest("DELETE", `https://x${PATH}`, null, BEARER_HEADERS);
    const res = await handleDeleteSession(req, makeEnv(), PATH);
    expect(res.status).toBe(404);
  });

  it("passes claims to deleteSession", async () => {
    const req = makeRequest("DELETE", `https://x${PATH}`, null, BEARER_HEADERS);
    await handleDeleteSession(req, makeEnv(), PATH);
    expect(mockDeleteSession.mock.calls[0][0].claims).toEqual(VALID_CLAIMS);
  });
});

describe("handleRestoreByCode", () => {
  it("returns 404 when getSessionByCode finds nothing", async () => {
    mockGetSessionByCode.mockResolvedValue(null);
    const req = makeRequest("POST", "https://x/sessions/restore",
      { code: "ABCDEF" }, BEARER_HEADERS);
    const res = await handleRestoreByCode(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 200 with {session_id, session_token, retrieve_code} on match", async () => {
    mockGetSessionByCode.mockResolvedValue({
      session_id: "sess-id", retrieve_code: "ABCDEF",
    });
    const req = makeRequest("POST", "https://x/sessions/restore",
      { code: "ABCDEF" }, BEARER_HEADERS);
    const res = await handleRestoreByCode(req, makeEnv());
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.session_id).toBe("sess-id");
    expect(json.retrieve_code).toBe("ABCDEF");
    expect(typeof json.session_token).toBe("string");
  });

  it("rejects malformed codes (length != 6) with 400 — does not hit storage", async () => {
    const req = makeRequest("POST", "https://x/sessions/restore",
      { code: "xyz" }, BEARER_HEADERS);
    const res = await handleRestoreByCode(req, makeEnv());
    expect(res.status).toBe(400);
    expect(mockGetSessionByCode).not.toHaveBeenCalled();
  });
});

describe("handleLegacyRun (ephemeral)", () => {
  it("returns 200 without an Authorization header (no auth required)", async () => {
    const req = makeRequest("POST", "https://x/run", { question: "Q" });
    const res = await handleLegacyRun(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it("does NOT touch createSession or addTurn", async () => {
    const req = makeRequest("POST", "https://x/run", { question: "Q" });
    await handleLegacyRun(req, makeEnv());
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAddTurn).not.toHaveBeenCalled();
  });

  it("returns 400 when question is missing", async () => {
    const req = makeRequest("POST", "https://x/run", {});
    const res = await handleLegacyRun(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate-limited", async () => {
    const req = makeRequest("POST", "https://x/run", { question: "Q" });
    const res = await handleLegacyRun(req, makeEnv({ rlSuccess: false }));
    expect(res.status).toBe(429);
  });
});
