import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAuth = vi.fn();
const mockRunCouncil = vi.fn();
const mockRunExpert = vi.fn();
const mockStreamCouncil = vi.fn();
const mockCreateStores = vi.fn();
const mockNanoid = vi.fn();
const mockStub = { appendTurn: vi.fn(), deleteSession: vi.fn() };

vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));
vi.mock("../llm-council/auth.js", () => ({
  nanoid21: (...args) => mockNanoid(...args),
  mintToken: vi.fn(async () => "session-token"),
}));
vi.mock("../llm-council/runner.js", () => ({
  runCouncil: (...args) => mockRunCouncil(...args),
  runExpert: (...args) => mockRunExpert(...args),
  streamCouncil: (...args) => mockStreamCouncil(...args),
}));
vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
vi.mock("../llm-council/session_namespace.js", () => ({ getCouncilSessionStub: () => mockStub }));

import { dispatchCloudflareCouncil } from "../llm-council/cloudflare_handlers.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};
const AUTH = { userId: CLAIMS.sub, tenantId: CLAIMS.tenant_id, role: "member" };
const SESSION_ID = "AbCdEfGhIjKlMnOpQrStU";


function rateLimiter() {
  return { limit: vi.fn(async () => ({ success: true })) };
}

function request(method, path, body = undefined) {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer valid" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stores() {
  return {
    identityStore: {
      assertMembership: vi.fn(async () => AUTH),
      listCouncilSessions: vi.fn(async () => [{ session_id: SESSION_ID, total_turns: 1 }]),
    },
    councilStore: {
      createSession: vi.fn(async (_auth, value) => ({ ...value, retrieve_code: value.retrieveCode, total_turns: 0 })),
      getSessionMetadata: vi.fn(async () => ({
        session: { session_id: SESSION_ID, total_turns: 1 },
        turns: [],
      })),
      getSessionByCode: vi.fn(async () => ({ session_id: SESSION_ID, retrieve_code: "ABCDEF" })),
    },
    objectStore: { getVerifiedJson: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNanoid.mockReset();
  mockNanoid.mockReturnValueOnce("AbCdEfGhIjKlMnOpQrStU").mockReturnValueOnce("TuSrQpOnMlKjIhGfEdCbA");
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockRunCouncil.mockResolvedValue({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] });
  mockRunExpert.mockResolvedValue({ success: true });
  mockCreateStores.mockReturnValue(stores());
  mockStub.appendTurn.mockResolvedValue({ turnIndex: 0, replayed: false });
  mockStub.deleteSession.mockResolvedValue(undefined);
});

describe("Cloudflare-native Council handlers", () => {
  it("creates a tenant-scoped session and persists its first turn through the session DO", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa issue", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", CSRF_SECRET: "secret", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );

    expect(response.status).toBe(200);
    expect(current.identityStore.assertMembership).toHaveBeenCalledWith(CLAIMS);
    expect(current.councilStore.createSession).toHaveBeenCalledWith(AUTH, expect.objectContaining({
      sessionId: SESSION_ID, caseId: "0123456789ab",
    }));
    expect(mockStub.appendTurn).toHaveBeenCalledWith(AUTH, expect.objectContaining({ sessionId: SESSION_ID }));
    expect(await response.json()).toMatchObject({ session_id: SESSION_ID, total_turns: 1 });
  });

  it("lists sessions only after the live Account D1 membership assertion", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("GET", "/api/v1/llm-council/sessions?limit=10"),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "GET",
    );
    expect(response.status).toBe(200);
    expect(current.identityStore.assertMembership).toHaveBeenCalledWith(CLAIMS);
    expect(current.identityStore.listCouncilSessions).toHaveBeenCalledWith(AUTH, { limit: 10, before: null });
  });

  it("restores a session by tenant-scoped retrieve code", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions/restore", { code: "abcdef" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions/restore", "POST",
    );
    expect(response.status).toBe(200);
    expect(current.councilStore.getSessionByCode).toHaveBeenCalledWith(AUTH, "ABCDEF");
    expect(await response.json()).toMatchObject({ session_id: SESSION_ID, retrieve_code: "ABCDEF" });
  });

  it("hydrates owned history from D1/R2 before appending a follow-up through the DO", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "What evidence is missing?" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "POST",
    );
    expect(response.status).toBe(200);
    expect(current.councilStore.getSessionMetadata).toHaveBeenCalledWith(AUTH, SESSION_ID);
    expect(mockRunCouncil).toHaveBeenCalledWith(expect.objectContaining({
      question: "What evidence is missing?", prevTurns: [],
    }));
    expect(mockStub.appendTurn).toHaveBeenCalledWith(AUTH, expect.objectContaining({ sessionId: SESSION_ID }));
  });

  it("does not expose a cross-tenant session when D1 returns no metadata", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("GET", `/api/v1/llm-council/sessions/${SESSION_ID}`),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}`, "GET",
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Session not found" });
  });

  it("serves tenant-scoped Council turns from verified R2 payloads", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1 },
      turns: [{
        turn_id: "turn-1", session_id: SESSION_ID, turn_index: 0, role: "user",
        payload_key: "council/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/" + SESSION_ID + "/turn-1.json",
        payload_sha256: "a".repeat(64), payload_size: 10,
        payload_content_type: "application/json", created_at: "2026-08-10T00:00:00.000Z",
      }],
    });
    current.objectStore.getVerifiedJson.mockResolvedValue({
      user_message: "Question", user_case_context: null, payload: { moderator: {} },
      retrieved_cases: [], total_tokens: null, total_latency_ms: null,
    });
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("GET", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "GET",
    );
    expect(response.status).toBe(200);
    expect((await response.json()).turns).toHaveLength(1);
    expect(current.objectStore.getVerifiedJson).toHaveBeenCalledOnce();
  });

  it("persists the exact retrieve code advertised by an SSE stream", async () => {
    const current = mockCreateStores();
    mockStreamCouncil.mockReturnValue({
      readable: new ReadableStream({ start(controller) { controller.close(); } }),
      work: Promise.resolve({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] }),
    });
    const pending = [];
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Stream my case" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    const advertised = mockStreamCouncil.mock.calls[0][0].sessionMeta.retrieve_code;
    expect(current.councilStore.createSession).toHaveBeenCalledWith(AUTH, expect.objectContaining({ retrieveCode: advertised }));
  });

  it("fails closed for an unknown Council route", async () => {
    expect(await dispatchCloudflareCouncil(
      request("GET", "/api/v1/llm-council/unknown"),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/unknown", "GET",
    )).toBeNull();
  });
});
