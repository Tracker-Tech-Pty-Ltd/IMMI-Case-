import { beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------
// Mock scaffolding — modeled on cloudflare-council-handlers.test.js, with
// two differences documented in plans/048-wire-council-to-the-case-reader.md
// Step 3:
//   1. The stores() fixture below adds a `caseStore.getCase` spy that the
//      anchor tests control directly, so buildCaseAnchor()'s behaviour is
//      exercised deterministically rather than through a real D1 lookup.
//   2. `buildCaseContextFromQuestion` is mocked directly (default: empty
//      retrieval) rather than forced down its own catch branch, so
//      `retrievedContext` in tests 1-8 contains ONLY the anchor block —
//      that is what makes those assertions exact. `renderRetrievedContext`
//      and `sanitizeText` are left real (imported via importOriginal) so
//      the actual renderer's fencing/budget logic is what is under test in
//      every case, including tests 9-10.
// -----------------------------------------------------------------------

const mockRequireAuth = vi.fn();
const mockRunCouncil = vi.fn();
const mockRunExpert = vi.fn();
const mockStreamCouncil = vi.fn();
const mockCreateStores = vi.fn();
const mockNanoid = vi.fn();
const mockBuildCaseContext = vi.fn();
const mockStub = { appendTurn: vi.fn() };

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
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));
vi.mock("../llm-council/session_namespace.js", () => ({ getCouncilSessionStub: () => mockStub }));
// Partial mock: keep the real renderRetrievedContext/sanitizeText (the
// fencing + budget logic under test) but replace buildCaseContextFromQuestion
// so its return value is fully controlled by each test.
vi.mock("../llm-council/retrieval.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildCaseContextFromQuestion: (...args) => mockBuildCaseContext(...args),
  };
});

import { dispatchCloudflareCouncil } from "../llm-council/cloudflare_handlers.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};
const AUTH = { userId: CLAIMS.sub, tenantId: CLAIMS.tenant_id, role: "member" };
const SESSION_ID = "AbCdEfGhIjKlMnOpQrStU";

// Exercises sanitization (the <script> tag must be stripped) and the
// catchwords-preferred snippet (text_snippet must NOT appear in the prompt).
const CASE_ROW = {
  case_id: "0123456789ab",
  citation: "[2024] AATA 1234",
  title: "Smith v Minister for Immigration <script>alert(1)</script>",
  court_code: "AATA",
  year: 2024,
  case_nature: "Review",
  visa_subclass: "866",
  catchwords: "protection visa; credibility; s 36(2)(a)",
  text_snippet: "unused when catchwords are present",
  url: "https://www.austlii.edu.au/au/cases/cth/AATA/2024/1234.html",
};

const EMPTY_RETRIEVAL = { retrievedCases: [], contextString: "", status: { state: "empty", candidates: 0, injected: 0, latency_ms: 0 } };

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
    identityStore: { assertMembership: vi.fn(async () => AUTH) },
    councilStore: {
      createSession: vi.fn(async (_auth, value) => ({ ...value, retrieve_code: value.retrieveCode, total_turns: 0 })),
      getSessionMetadata: vi.fn(async () => ({
        session: { session_id: SESSION_ID, total_turns: 1, case_id: null },
        turns: [],
      })),
    },
    caseStore: { getCase: vi.fn(async () => CASE_ROW) },
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
  mockBuildCaseContext.mockResolvedValue(EMPTY_RETRIEVAL);
  mockStub.appendTurn.mockResolvedValue({ turnIndex: 0, replayed: false });
});

describe("Council case anchoring", () => {
  it("1. POST /sessions with case_id anchors the prompt", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    expect(current.caseStore.getCase).toHaveBeenCalledWith("0123456789ab");
    const runArgs = mockRunCouncil.mock.calls[0][0];
    expect(runArgs.retrievedContext).toContain("Anchor case");
    expect(runArgs.retrievedContext).toContain("<retrieved_cases>");
    expect(runArgs.retrievedContext).toContain("case_id: 0123456789ab");
    expect(runArgs.retrievedCases[0].case_id).toBe("0123456789ab");
  });

  it("2. POST /stream with case_id anchors caseContext", async () => {
    mockStreamCouncil.mockReturnValue({
      readable: new ReadableStream({ start(controller) { controller.close(); } }),
      work: Promise.resolve({ opinions: [], moderator: {}, models: {}, retrieved_cases: [] }),
    });
    const pending = [];
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    expect(response.status).toBe(200);
    const streamArgs = mockStreamCouncil.mock.calls[0][0];
    expect(streamArgs.caseContext).toContain("Anchor case");
    expect(streamArgs.caseContext).toContain("case_id: 0123456789ab");
  });

  it("3. a follow-up turn anchors from the session's stored case_id", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, case_id: "0123456789ab" },
      turns: [],
    });
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "What evidence is missing?" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "POST",
    );
    expect(response.status).toBe(200);
    expect(current.caseStore.getCase).toHaveBeenCalledWith("0123456789ab");
    const runArgs = mockRunCouncil.mock.calls[0][0];
    expect(runArgs.retrievedContext).toContain("case_id: 0123456789ab");
    const body = await response.json();
    expect(body.anchor).toEqual({ status: "ok", source: "catalog_metadata" });
  });

  it("4. an unknown explicit case_id is refused before any model call", async () => {
    const current = stores();
    current.caseStore.getCase.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("case_not_found");
    expect(mockRunCouncil).not.toHaveBeenCalled();
  });

  it("5. a D1 failure on an explicit case_id is a retryable 503, not an answer", async () => {
    const current = stores();
    current.caseStore.getCase.mockRejectedValue(new Error("D1_ERROR"));
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("anchor_unavailable");
    expect(mockRunCouncil).not.toHaveBeenCalled();
  });

  it("6. the stream path refuses an unknown case_id before opening the stream", async () => {
    const current = stores();
    current.caseStore.getCase.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/stream", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/stream", "POST", { waitUntil: (p) => p },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("case_not_found");
    expect(mockStreamCouncil).not.toHaveBeenCalled();
  });

  it("7. a follow-up turn whose stored anchor is gone still runs, and says so", async () => {
    const current = stores();
    current.councilStore.getSessionMetadata.mockResolvedValue({
      session: { session_id: SESSION_ID, total_turns: 1, case_id: "0123456789ab" },
      turns: [],
    });
    current.caseStore.getCase.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCouncil(
      request("POST", `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, { message: "What evidence is missing?" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`, "POST",
    );
    expect(response.status).toBe(200);
    expect(mockRunCouncil).toHaveBeenCalled();
    const runArgs = mockRunCouncil.mock.calls[0][0];
    expect(runArgs.retrievedContext).not.toContain("Anchor case");
    const body = await response.json();
    expect(body.anchor.status).toBe("not_found");
  });

  it("8. untrusted case text is sanitized", async () => {
    const current = mockCreateStores();
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    void current;
    const runArgs = mockRunCouncil.mock.calls[0][0];
    expect(runArgs.retrievedContext).not.toContain("<script");
    expect(runArgs.retrievedContext).toContain("snippet: protection visa; credibility; s 36(2)(a)");
  });

  it("9. the anchor is not duplicated when it is also an FTS hit", async () => {
    mockBuildCaseContext.mockResolvedValue({
      retrievedCases: [
        { case_id: "0123456789ab", citation: "[2024] AATA 1234", court_code: "AATA", year: 2024, title: "Smith v Minister", case_nature: "Review", visa_subclass: "866", relevance_score: 5, snippet: "fts hit on the anchor case", source_url: "https://example" },
        { case_id: "other000001", citation: "[2023] FCA 5", court_code: "FCA", year: 2023, title: "Jones v Minister", case_nature: "Review", visa_subclass: "500", relevance_score: 4, snippet: "an unrelated case", source_url: "https://example" },
      ],
      contextString: "unused-by-merge",
      status: { state: "ok", candidates: 2, injected: 2, latency_ms: 1 },
    });
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    const runArgs = mockRunCouncil.mock.calls[0][0];
    const anchorHits = runArgs.retrievedCases.filter((c) => c.case_id === "0123456789ab");
    expect(anchorHits).toHaveLength(1);
    expect(runArgs.retrievedCases[0].case_id).toBe("0123456789ab");
    expect(runArgs.retrievedContext.match(/case_id: 0123456789ab/g)).toHaveLength(1);
  });

  it("10. the combined prompt stays inside one context budget", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      case_id: `synthetic${String(i).padStart(2, "0")}`,
      citation: `[2024] AATA ${i}`,
      court_code: "AATA",
      year: 2024,
      title: `Synthetic case ${i}`,
      case_nature: "Review",
      visa_subclass: "866",
      relevance_score: 1,
      snippet: "x".repeat(600),
      source_url: "https://example",
    }));
    mockBuildCaseContext.mockResolvedValue({
      retrievedCases: many,
      contextString: "unused-by-merge",
      status: { state: "ok", candidates: 30, injected: 30, latency_ms: 1 },
    });
    const response = await dispatchCloudflareCouncil(
      request("POST", "/api/v1/llm-council/sessions", { message: "Assess the visa cancellation risk", case_id: "0123456789ab" }),
      { IMMI_STORAGE_MODE: "cloudflare", RL_COUNCIL_TURN: rateLimiter() },
      "/api/v1/llm-council/sessions", "POST",
    );
    expect(response.status).toBe(200);
    const runArgs = mockRunCouncil.mock.calls[0][0];
    expect(runArgs.retrievedContext.length).toBeLessThanOrEqual(12400);
    expect(runArgs.retrievedContext).toContain("case_id: 0123456789ab");
  });
});
