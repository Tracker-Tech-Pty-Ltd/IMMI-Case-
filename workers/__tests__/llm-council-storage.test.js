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

const mockGetSqlAsUser = vi.fn(() => ({
  tx: async (fn) => fn(makeTx()),
}));

vi.mock("../db/getSqlAsUser.js", () => ({
  getSqlAsUser: (...a) => mockGetSqlAsUser(...a),
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
  mockGetSqlAsUser.mockImplementation(() => ({
    tx: async (fn) => fn(makeTx()),
  }));
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

describe("getSql / withSql / withSqlAsUser lifecycle", () => {
  it("getSql calls postgres(connectionString, {max:1, idle_timeout:5})", async () => {
    const { default: postgres } = await import("postgres");
    getSql(ENV);
    expect(postgres).toHaveBeenCalledWith(
      "postgres://test/test",
      expect.objectContaining({ max: 1, idle_timeout: 5 }),
    );
  });

  it("getSql returns a NEW client every call (never singleton)", async () => {
    const { default: postgres } = await import("postgres");
    getSql(ENV); getSql(ENV);
    expect(postgres).toHaveBeenCalledTimes(2);
  });

  it("getSqlFresh uses HYPERDRIVE_NO_CACHE when bound", async () => {
    const { default: postgres } = await import("postgres");
    getSqlFresh(ENV);
    expect(postgres).toHaveBeenCalledWith(
      "postgres://fresh/test",
      expect.objectContaining({ max: 1, idle_timeout: 5 }),
    );
  });

  it("getSqlFresh falls back to HYPERDRIVE when no fresh binding exists", async () => {
    const { default: postgres } = await import("postgres");
    getSqlFresh({ HYPERDRIVE: ENV.HYPERDRIVE });
    expect(postgres).toHaveBeenCalledWith(
      "postgres://test/test",
      expect.objectContaining({ max: 1, idle_timeout: 5 }),
    );
  });

  it("withSql guarantees sql.end() runs even when fn throws", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(ENV.HYPERDRIVE.connectionString, {});
    await expect(
      withSql(ENV, async () => { throw new Error("boom"); }),
    ).rejects.toThrow("boom");
    expect(sql.end).toHaveBeenCalled();
  });

  it("withSqlAsUser delegates to getSqlAsUser(env, claims).tx(fn)", async () => {
    let txArg = null;
    mockGetSqlAsUser.mockImplementation((env, claims) => ({
      tx: async (fn) => {
        txArg = { env, claims };
        return fn(makeTx());
      },
    }));
    await withSqlAsUser(ENV, CLAIMS, async () => "ok");
    expect(txArg).toEqual({ env: ENV, claims: CLAIMS });
  });

  it("withSqlFreshAsUser delegates to getSqlAsUser with the fresh binding", async () => {
    let txArg = null;
    mockGetSqlAsUser.mockImplementation((env, claims, options) => ({
      tx: async (fn) => {
        txArg = { env, claims, options };
        return fn(makeTx());
      },
    }));
    await withSqlFreshAsUser(ENV, CLAIMS, async () => "ok");
    expect(txArg).toEqual({
      env: ENV,
      claims: CLAIMS,
      options: { hyperdrive: ENV.HYPERDRIVE_NO_CACHE },
    });
  });
});

describe("createSession", () => {
  it("throws when claims is missing tenant_id (plan §1.4)", async () => {
    await expect(
      createSession({
        env: ENV,
        claims: { sub: CLAIMS.sub },
        sessionId: "s1", caseId: null, title: null, hmacSig: "sig",
      }),
    ).rejects.toThrow(/tenant_id/);
  });

  it("throws when claims is missing sub", async () => {
    await expect(
      createSession({
        env: ENV,
        claims: { tenant_id: CLAIMS.tenant_id },
        sessionId: "s1", caseId: null, title: null, hmacSig: "sig",
      }),
    ).rejects.toThrow(/sub/);
  });

  it("issues INSERT INTO council_sessions with tenant_id + created_by params", async () => {
    txYields([{ session_id: "s1", tenant_id: CLAIMS.tenant_id }]);

    const row = await createSession({
      env: ENV, claims: CLAIMS,
      sessionId: "s1", caseId: null, title: "T",
      hmacSig: "sig", retrieveCode: "ABCDEF",
    });

    expect(row.session_id).toBe("s1");

    const sql = sqlOf(mockTxFn.mock.calls[0]);
    expect(sql).toContain("INSERT INTO council_sessions");
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("created_by");
    expect(sql).toContain("RETURNING *");

    const params = mockTxFn.mock.calls[0].slice(1);
    expect(params).toContain(CLAIMS.tenant_id);
    expect(params).toContain(CLAIMS.sub);
  });
});

describe("listSessions", () => {
  it("throws without claims (plan §1.3 — no anonymous listing)", async () => {
    await expect(
      listSessions({ env: ENV, limit: 10 }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("SELECTs only whitelist columns — no hmac_sig / session_token / retrieve_code", async () => {
    txYields([]);
    await listSessions({ env: ENV, claims: CLAIMS, limit: 20 });
    const sql = sqlOf(mockTxFn.mock.calls[0]);
    for (const col of ["session_id", "case_id", "title", "status",
                       "total_turns", "created_at", "updated_at"]) {
      expect(sql).toContain(col);
    }
    expect(sql).not.toContain("hmac_sig");
    expect(sql).not.toContain("session_token");
    expect(sql).not.toContain("retrieve_code");
    expect(sql).not.toMatch(/SELECT \*/);
  });

  it("uses the fresh Hyperdrive binding for write-affected list reads", async () => {
    txYields([]);
    await listSessions({ env: ENV, claims: CLAIMS, limit: 20 });
    expect(mockGetSqlAsUser).toHaveBeenCalledWith(
      ENV,
      CLAIMS,
      { hyperdrive: ENV.HYPERDRIVE_NO_CACHE },
    );
  });

  it("clamps limit to 100", async () => {
    txYields([]);
    await listSessions({ env: ENV, claims: CLAIMS, limit: 9999 });
    const params = mockTxFn.mock.calls[0].slice(1);
    expect(params).toContain(100);
  });

  it("issues `before` cursor when provided", async () => {
    txYields([]);
    await listSessions({
      env: ENV, claims: CLAIMS,
      limit: 10, before: "2026-04-01T00:00:00Z",
    });
    const sql = sqlOf(mockTxFn.mock.calls[0]);
    expect(sql).toContain("WHERE updated_at <");
  });
});

describe("getSession", () => {
  it("throws without claims", async () => {
    await expect(
      getSession({ env: ENV, sessionId: "s1" }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("returns null when session is not found", async () => {
    txYields([]);
    const res = await getSession({ env: ENV, claims: CLAIMS, sessionId: "missing" });
    expect(res).toBeNull();
  });

  it("returns {session, turns} when session exists", async () => {
    txYields(
      [{ session_id: "s1", total_turns: 2 }],
      [{ turn_id: "t1" }, { turn_id: "t2" }],
    );
    const res = await getSession({ env: ENV, claims: CLAIMS, sessionId: "s1" });
    expect(res.session.session_id).toBe("s1");
    expect(res.turns).toHaveLength(2);
  });
});

describe("getSessionByCode", () => {
  it("throws without claims", async () => {
    await expect(
      getSessionByCode({ env: ENV, code: "ABCDEF" }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("rejects code lengths other than 6 without DB hit", async () => {
    const out = await getSessionByCode({ env: ENV, claims: CLAIMS, code: "abc" });
    expect(out).toBeNull();
    expect(mockTxFn).not.toHaveBeenCalled();
  });

  it("SELECTs only safe columns (session_id, retrieve_code, tenant_id, created_by)", async () => {
    txYields([{ session_id: "s1", retrieve_code: "ABCDEF" }]);
    await getSessionByCode({ env: ENV, claims: CLAIMS, code: "ABCDEF" });
    const sql = sqlOf(mockTxFn.mock.calls[0]);
    expect(sql).toContain("session_id");
    expect(sql).toContain("retrieve_code");
    expect(sql).not.toContain("hmac_sig");
    expect(sql).not.toMatch(/SELECT \*/);
  });
});

describe("addTurn", () => {
  it("throws without claims", async () => {
    await expect(
      addTurn({
        env: ENV, sessionId: "s1", turnId: "t1", turnIndex: 0,
        userMessage: "x", userCaseContext: null,
        payload: {}, retrievedCases: null,
        totalTokens: null, totalLatencyMs: null,
      }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("inserts with ON CONFLICT DO NOTHING + RETURNING; bumps total_turns on success", async () => {
    txYields([{ turn_id: "t1" }], []);
    const out = await addTurn({
      env: ENV, claims: CLAIMS,
      sessionId: "s1", turnId: "t1", turnIndex: 0,
      userMessage: "hi", userCaseContext: null,
      payload: { moderator: { composed_answer: "x" } },
      retrievedCases: null, totalTokens: null, totalLatencyMs: null,
    });
    expect(out).toEqual({ turn_id: "t1" });
    const insertSql = sqlOf(mockTxFn.mock.calls[0]);
    expect(insertSql).toContain("INSERT INTO council_turns");
    expect(insertSql).toContain("ON CONFLICT (session_id, turn_index) DO NOTHING");
    const updateSql = sqlOf(mockTxFn.mock.calls[1]);
    expect(updateSql).toContain("UPDATE council_sessions");
    expect(updateSql).toContain("total_turns = total_turns + 1");
  });

  it("returns null on conflict + skips the UPDATE", async () => {
    txYields([]);
    const out = await addTurn({
      env: ENV, claims: CLAIMS,
      sessionId: "s1", turnId: "t1", turnIndex: 0,
      userMessage: "hi", userCaseContext: null,
      payload: {}, retrievedCases: null,
      totalTokens: null, totalLatencyMs: null,
    });
    expect(out).toBeNull();
    expect(mockTxFn).toHaveBeenCalledTimes(1);
  });
});

describe("deleteSession", () => {
  it("throws without claims", async () => {
    await expect(
      deleteSession({ env: ENV, sessionId: "s1" }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("returns true when a row is deleted", async () => {
    txYields([{ session_id: "s1" }]);
    const out = await deleteSession({ env: ENV, claims: CLAIMS, sessionId: "s1" });
    expect(out).toBe(true);
  });

  it("returns false when RLS hides the row / no match", async () => {
    txYields([]);
    const out = await deleteSession({ env: ENV, claims: CLAIMS, sessionId: "foreign" });
    expect(out).toBe(false);
  });
});

describe("loadHistory", () => {
  it("throws without claims", async () => {
    await expect(
      loadHistory({ env: ENV, sessionId: "s1" }),
    ).rejects.toThrow(/authenticated claims/);
  });

  it("maps payload.moderator.composed_answer → assistant_message", async () => {
    txYields([
      { user_message: "q1", payload: { moderator: { composed_answer: "a1" } } },
      { user_message: "q2", payload: { moderator: {} } },
      { user_message: "q3", payload: {} },
    ]);
    const history = await loadHistory({ env: ENV, claims: CLAIMS, sessionId: "s1" });
    expect(history).toEqual([
      { user_message: "q1", assistant_message: "a1" },
      { user_message: "q2", assistant_message: "" },
      { user_message: "q3", assistant_message: "" },
    ]);
  });
});
