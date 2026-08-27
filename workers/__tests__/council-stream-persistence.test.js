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

import { StorageBoundaryError } from "../storage/contracts.js";
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
  mockNanoid.mockReturnValueOnce(SESSION_ID).mockReturnValueOnce("TuSrQpOnMlKjIhGfEdCbA");
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockRunCouncil.mockResolvedValue({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] });
  mockRunExpert.mockResolvedValue({ success: true });
  mockCreateStores.mockReturnValue(stores());
  mockStub.appendTurn.mockResolvedValue({ turnIndex: 0, replayed: false });
  mockStub.deleteSession.mockResolvedValue(undefined);
});

describe("Council stream persistence", () => {
  it("does not create a session row when the stream resolves with no result", async () => {
    const current = mockCreateStores();
    mockStreamCouncil.mockReturnValue({
      readable: new ReadableStream({ start(controller) { controller.close(); } }),
      work: Promise.resolve(null),
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const pending = [];
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Stream my case" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(current.councilStore.createSession).not.toHaveBeenCalled();
    expect(mockStub.appendTurn).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("council.stream.skipped_persist"))).toBe(true);
    logSpy.mockRestore();
  });

  it("still persists the session and turn when the stream resolves with a result", async () => {
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
    expect(current.councilStore.createSession).toHaveBeenCalledOnce();
    expect(mockStub.appendTurn).toHaveBeenCalledOnce();
  });

  it("retries a typed retrieve-code collision and then succeeds", async () => {
    const current = mockCreateStores();
    current.councilStore.createSession
      .mockRejectedValueOnce(new StorageBoundaryError("Retrieve code already in use", { code: "retrieve_code_conflict", status: 409 }))
      .mockRejectedValueOnce(new StorageBoundaryError("Retrieve code already in use", { code: "retrieve_code_conflict", status: 409 }))
      .mockResolvedValueOnce({ session_id: SESSION_ID, retrieve_code: "ABCDEF", total_turns: 0 });
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa issue" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    expect(current.councilStore.createSession).toHaveBeenCalledTimes(3);
  });

  it("still retries a legacy message-shaped collision during a rolling deploy", async () => {
    const current = mockCreateStores();
    current.councilStore.createSession
      .mockRejectedValueOnce(new Error("D1_ERROR: UNIQUE constraint failed: council_sessions.retrieve_code: SQLITE_CONSTRAINT"))
      .mockRejectedValueOnce(new Error("D1_ERROR: UNIQUE constraint failed: council_sessions.retrieve_code: SQLITE_CONSTRAINT"))
      .mockResolvedValueOnce({ session_id: SESSION_ID, retrieve_code: "ABCDEF", total_turns: 0 });
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa issue" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    expect(current.councilStore.createSession).toHaveBeenCalledTimes(3);
  });

  it("surfaces a typed retrieve_code_conflict when every attempt collides", async () => {
    const current = mockCreateStores();
    current.councilStore.createSession.mockRejectedValue(
      new StorageBoundaryError("Retrieve code already in use", { code: "retrieve_code_conflict", status: 409 }),
    );
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa issue" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "retrieve_code_conflict" });
    expect(current.councilStore.createSession).toHaveBeenCalledTimes(3);
  });

  it("rethrows an unrelated error that merely mentions retrieve_code", async () => {
    const current = mockCreateStores();
    current.councilStore.createSession.mockRejectedValue(new Error("D1_ERROR: no such column: retrieve_code_v2"));
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa issue" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "council_unavailable" });
    expect(current.councilStore.createSession).toHaveBeenCalledTimes(1);
  });

  it("logs a reissue when the advertised retrieve code collides on the stream path", async () => {
    const current = mockCreateStores();
    mockStreamCouncil.mockReturnValue({
      readable: new ReadableStream({ start(controller) { controller.close(); } }),
      work: Promise.resolve({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] }),
    });
    current.councilStore.createSession
      .mockRejectedValueOnce(new Error("D1_ERROR: UNIQUE constraint failed: council_sessions.retrieve_code: SQLITE_CONSTRAINT"))
      .mockResolvedValueOnce({ session_id: SESSION_ID, retrieve_code: "ZZZZZZ", total_turns: 0 });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = [];
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Stream my case" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(errSpy.mock.calls.some((call) => String(call[0]).includes("council.stream.retrieve_code_reissued"))).toBe(true);
    errSpy.mockRestore();
  });

  it("rejects biased random bytes when minting a retrieve code", async () => {
    mockCreateStores();
    mockStreamCouncil.mockReturnValue({
      readable: new ReadableStream({ start(controller) { controller.close(); } }),
      work: Promise.resolve({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] }),
    });
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementationOnce((array) => { array.fill(255); return array; })
      .mockImplementation((array) => { array.fill(0); return array; });
    const pending = [];
    await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Stream my case" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    expect(mockStreamCouncil.mock.calls[0][0].sessionMeta.retrieve_code).toBe("222222");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
