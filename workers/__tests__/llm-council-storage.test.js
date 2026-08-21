/**
 * llm-council-storage.test.js
 *
 * Vitest unit tests for workers/llm-council/storage.js (post plan §1.3-§1.5
 * rewrite — tenant-aware, JWT-claims-bound, with lifecycle helpers).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTxFn = vi.fn();
function makeTx() {
  const tx = (...args) => mockTxFn(...args);
  tx.json = (val) => ({ __json: val });
  return tx;
}

const mockCloudflareStores = vi.fn();
const mockCouncilSessionStub = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...a) => mockCloudflareStores(...a),
}));

vi.mock("../llm-council/session_namespace.js", () => ({
  getCouncilSessionStub: (...a) => mockCouncilSessionStub(...a),
}));

vi.mock("postgres", () => {
  const sqlFn = vi.fn();
  sqlFn.json = (val) => ({ __json: val });
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  const postgresFactory = vi.fn(() => sqlFn);
  return { default: postgresFactory };
});

import {
  getSql,
  getSqlFresh,
  withSql,
  withSqlAsUser,
  withSqlFreshAsUser,
  createSession,
  addTurn,
  getSession,
  getSessionByCode,
  listSessions,
  deleteSession,
  loadHistory,
  LIST_SESSION_COLUMNS,
  generateRetrieveCode,
} from "../llm-council/storage.js";

const ENV = {
  HYPERDRIVE: { connectionString: "postgres://test/test" },
  HYPERDRIVE_NO_CACHE: { connectionString: "postgres://fresh/test" },
};

const CLAIMS = {
  sub: "11111111-2222-3333-4444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
  role: "member",
  kid: "v1",
};

function sqlOf(callArgs) {
  return callArgs[0].join("?").trim();
}

function txYields(...rowsPerCall) {
  mockTxFn.mockReset();
  for (const rows of rowsPerCall) mockTxFn.mockResolvedValueOnce(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTxFn.mockReset();
  mockCloudflareStores.mockReset();
  mockCouncilSessionStub.mockReset();
});

describe("generateRetrieveCode", () => {
  it("returns a 6-character base32 code from the safe alphabet", () => {
    const code = generateRetrieveCode();
    expect(code).toHaveLength(6);
    expect(/^[2-9A-HJ-NP-Z]{6}$/.test(code)).toBe(true);
  });
});

describe("LIST_SESSION_COLUMNS whitelist", () => {
  it("contains only the 7 safe columns plan §1.3 specifies", () => {
    expect([...LIST_SESSION_COLUMNS]).toEqual([
      "session_id", "case_id", "title", "status",
      "total_turns", "created_at", "updated_at",
    ]);
  });

  it("explicitly excludes hmac_sig / session_token / retrieve_code", () => {
    expect(LIST_SESSION_COLUMNS).not.toContain("hmac_sig");
    expect(LIST_SESSION_COLUMNS).not.toContain("session_token");
    expect(LIST_SESSION_COLUMNS).not.toContain("retrieve_code");
  });
});


describe("Cloudflare Council storage mode", () => {
  const CLOUD_ENV = { IMMI_STORAGE_MODE: "cloudflare" };

  function configureStores(overrides = {}) {
    const context = {
      userId: "11111111-2222-4333-8444-555555555555",
      tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      role: "member",
    };
    const stores = {
      identityStore: {
        assertMembership: vi.fn(async () => context),
        listCouncilSessions: vi.fn(async () => []),
      },
      councilStore: {
        createSession: vi.fn(async () => ({ session_id: "s1", retrieve_code: "ABCDEF" })),
        getSessionByCode: vi.fn(async () => null),
        getSessionMetadata: vi.fn(async () => null),
      },
      objectStore: { getVerifiedJson: vi.fn(async () => ({})) },
      ...overrides,
    };
    mockCloudflareStores.mockReturnValue(stores);
    return stores;
  }

  it("creates a D1 session only through the identity/council stores", async () => {
    const stores = configureStores();
    const row = await createSession({
      env: CLOUD_ENV, claims: CLAIMS, sessionId: "session-1", caseId: null,
      title: "Title", hmacSig: "never-stored-in-d1", retrieveCode: "ABCDEF",
    });
    expect(row).toEqual({ session_id: "s1", retrieve_code: "ABCDEF" });
    expect(stores.identityStore.assertMembership).toHaveBeenCalledWith(CLAIMS);
    expect(stores.councilStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
      expect.objectContaining({ sessionId: "session-1", retrieveCode: "ABCDEF" }),
    );
    expect(mockTxFn).not.toHaveBeenCalled();
  });

  it("delegates append ordering to the deterministic Council Durable Object", async () => {
    configureStores();
    const appendTurn = vi.fn(async () => ({ turnIndex: 0, replayed: false }));
    mockCouncilSessionStub.mockReturnValue({ appendTurn });
    const row = await addTurn({
      env: CLOUD_ENV, claims: CLAIMS, sessionId: "session-1", turnId: "turn-1", turnIndex: 99,
      userMessage: "Question", userCaseContext: "Context",
      payload: { moderator: { composed_answer: "Answer" } }, retrievedCases: ["case-1"],
      totalTokens: 12, totalLatencyMs: 34,
    });
    expect(row.turn_index).toBe(0);
    expect(mockCouncilSessionStub).toHaveBeenCalledWith(CLOUD_ENV, "session-1");
    expect(appendTurn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sessionId: "session-1", turnId: "turn-1", role: "user" }),
    );
    expect(appendTurn.mock.calls[0][1].payload).toMatchObject({
      user_message: "Question",
      payload: { moderator: { composed_answer: "Answer" } },
    });
  });

  it("hydrates Council payloads from verified R2 pointers", async () => {
    const stores = configureStores({
      councilStore: {
        getSessionMetadata: vi.fn(async () => ({
          session: { session_id: "session-1", total_turns: 1 },
          turns: [{
            turn_id: "turn-1", session_id: "session-1", turn_index: 0,
            payload_key: "council/tenant/session-1/turn-1.json",
            payload_sha256: "a".repeat(64), payload_size: 99,
            payload_content_type: "application/json", created_at: "2026-08-10T00:00:00Z",
          }],
        })),
      },
      objectStore: {
        getVerifiedJson: vi.fn(async () => ({
          user_message: "Question", user_case_context: "Context",
          payload: { moderator: { composed_answer: "Answer" } },
          retrieved_cases: [], total_tokens: 1, total_latency_ms: 2,
        })),
      },
    });
    const result = await getSession({ env: CLOUD_ENV, claims: CLAIMS, sessionId: "session-1" });
    expect(result.turns[0]).toMatchObject({
      turn_index: 0, user_message: "Question", payload: { moderator: { composed_answer: "Answer" } },
    });
    expect(stores.objectStore.getVerifiedJson).toHaveBeenCalledWith(
      expect.objectContaining({ key: "council/tenant/session-1/turn-1.json" }),
    );
  });

  it("keeps reads available and rejects every mutation in freeze mode", async () => {
    await expect(createSession({
      env: { IMMI_STORAGE_MODE: "freeze" }, claims: CLAIMS, sessionId: "s1", caseId: null,
      title: "T", hmacSig: "hmac",
    })).rejects.toMatchObject({ code: "cutover_write_freeze", status: 503 });
    await expect(addTurn({
      env: { IMMI_STORAGE_MODE: "freeze" }, claims: CLAIMS, sessionId: "s1", turnId: "t1", turnIndex: 0,
      userMessage: "Q", userCaseContext: null, payload: {}, retrievedCases: null,
      totalTokens: null, totalLatencyMs: null,
    })).rejects.toMatchObject({ code: "cutover_write_freeze", status: 503 });
  });
});
