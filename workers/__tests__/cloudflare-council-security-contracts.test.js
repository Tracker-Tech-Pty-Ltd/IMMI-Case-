/**
 * workers/__tests__/cloudflare-council-security-contracts.test.js
 *
 * Security/auth contracts asserted against the LIVE Cloudflare-native Council
 * handlers (workers/llm-council/cloudflare_handlers.js) — never against the
 * pre-cutover legacy Council handler module, which plan 030 deletes because
 * nothing production loads can reach it any more.
 *
 * These contracts were previously (and only) asserted against that dead
 * module by its own now-deleted test file. Porting them here closes the
 * coverage gap left by that deletion.
 *
 * Note on the "list responses strip retrieve_code" contract: the live
 * `handleListSessions` does NOT run its result through
 * `normalizeSessionResponse()` — that stripping only applies to the single
 * get-session route (`handleGetSession`). The list route's retrieve_code
 * exclusion is enforced one layer down, by the explicit column SELECT in
 * `workers/storage/identity.js`'s `listCouncilSessions()` (no `retrieve_code`
 * column is ever selected). That store method is mocked wholesale in this
 * harness, so a mock-level assertion here cannot exercise that SQL-level
 * guarantee without re-implementing it. Only the get-session half of the
 * contract is ported below; see the plan-030 handoff for the full note.
 */
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

function unauthenticatedResponse() {
  // A fresh Response per call — bodies are single-use, and this factory
  // backs every route dispatch in the 401 test below.
  return new Response(
    JSON.stringify({ error: "Authentication required", code: "auth_required" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function rateLimiter() {
  return { limit: vi.fn(async () => ({ success: true })) };
}

function request(method, path, body = undefined, headers = {}) {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer valid", ...headers },
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

describe("Cloudflare-native Council security contracts", () => {
  it("returns 401 with no valid Bearer token on every Council route", async () => {
    mockRequireAuth.mockImplementation(async () => unauthenticatedResponse());
    const env = { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() };
    const routes = [
      ["POST", "/api/v1/llm-council/sessions", { message: "x" }],
      ["GET", "/api/v1/llm-council/sessions", undefined],
      ["POST", "/api/v1/llm-council/sessions/restore", { code: "ABCDEF" }],
      ["POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "x" }],
      ["GET", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, undefined],
      ["GET", `/api/v1/llm-council/sessions/${SESSION_ID}`, undefined],
      ["DELETE", `/api/v1/llm-council/sessions/${SESSION_ID}`, undefined],
      ["POST", "/api/v1/llm-council/stream", { message: "x" }],
      ["POST", "/api/v1/llm-council/run", { question: "x" }],
    ];
    for (const [method, path, body] of routes) {
      const response = await dispatchCloudflareCouncil(request(method, path, body), env, path, method);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect((await response.json()).code, `${method} ${path}`).toBe("auth_required");
    }
  });

  it("returns 400 when message is missing on session creation", async () => {
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", {}),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("message is required");
  });

  it("returns 400 for a malformed retrieve code on restore", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions/restore", { code: "ABC" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions/restore", "POST",
    );
    expect(response.status).toBe(400);
    expect(current.councilStore.getSessionByCode).not.toHaveBeenCalled();
  });

  it("returns 404 when adding a turn to an unknown session", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "What evidence is missing?" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "POST",
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Session not found");
    expect(mockRunCouncil).not.toHaveBeenCalled();
  });

  it("returns 409 when a session has already reached the 15-turn cap", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 15 },
      turns: [],
    });
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "One more question" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "POST",
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Session has reached the maximum of 15 turns");
    expect(mockRunCouncil).not.toHaveBeenCalled();
  });

  it("strips the retrieve code from a get-session response", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, retrieve_code: "LEAKME" },
      turns: [],
    });
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("GET", `/api/v1/llm-council/sessions/${SESSION_ID}`),
      { IMMI_STORAGE_MODE: "cloudflare" },
      `/api/v1/llm-council/sessions/${SESSION_ID}`, "GET",
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("LEAKME");
    expect(text).not.toContain("retrieve_code");
  });
});
