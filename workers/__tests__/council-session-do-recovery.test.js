import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(ctx, env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const createCloudflareStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => createCloudflareStores(...args),
}));

import { StorageBoundaryError } from "../storage/contracts.js";
import { CouncilSessionDO } from "../llm-council/session_do.js";

const AUTH = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function makeState({ ledgerInsertReturnsNothing = false } = {}) {
  let tables = new Set();
  let sequenceSeeded = false;
  let nextTurn = -1;
  const ledger = new Map();
  const sql = {
    exec(statement, ...params) {
      if (statement.includes("CREATE TABLE IF NOT EXISTS council_turn_ledger")) { tables.add("ledger"); return []; }
      if (statement.includes("CREATE TABLE IF NOT EXISTS council_turn_sequence")) { tables.add("sequence"); return []; }
      if (statement.includes("INSERT OR IGNORE INTO council_turn_sequence")) {
        if (!tables.has("sequence")) throw new Error("no such table: council_turn_sequence");
        if (!sequenceSeeded) { sequenceSeeded = true; nextTurn = -1; }
        return [];
      }
      if (statement.includes("SELECT turn_index, completed FROM council_turn_ledger")) {
        if (!tables.has("ledger")) throw new Error("no such table: council_turn_ledger");
        const row = ledger.get(params[0]);
        return row ? [row] : [];
      }
      if (statement.includes("INSERT INTO council_turn_ledger")) {
        if (!tables.has("ledger") || !sequenceSeeded || ledgerInsertReturnsNothing) return [];
        const row = { turn_index: nextTurn + 1, completed: 0 };
        ledger.set(params[0], row);
        return [row];
      }
      if (statement.includes("UPDATE council_turn_sequence")) { nextTurn = params[0]; return []; }
      if (statement.includes("SET completed = 1")) { const row = ledger.get(params[0]); if (row) row.completed = 1; return []; }
      return [];
    },
  };
  return {
    blockConcurrencyWhile: async (callback) => callback(),
    storage: {
      sql,
      deleteAll: vi.fn(async () => { tables = new Set(); sequenceSeeded = false; nextTurn = -1; ledger.clear(); }),
    },
  };
}

function stores() {
  let deleted = false;
  return {
    councilStore: {
      getSessionMetadata: vi.fn(async () => (deleted
        ? null                                   // soft-deleted: deleted_at IS NOT NULL
        : { session: { session_id: "session-1", total_turns: 0 }, turns: [] })),
      deleteSession: vi.fn(async () => { deleted = true; }),
      appendTurnMetadata: vi.fn(async () => {
        // Mirrors the real store: the INSERT is guarded by
        // `WHERE EXISTS (... deleted_at IS NULL)`, so a soft-deleted session
        // changes zero rows and raises. A double that always succeeds would
        // certify the exact bug this step exists to prevent.
        if (deleted) {
          throw new StorageBoundaryError("Council session not found", {
            code: "council_session_not_found",
            status: 404,
          });
        }
      }),
    },
    objectStore: {
      putCouncilPayload: vi.fn(async () => ({ key: "council/s1/t1.json", sha256: "a".repeat(64), size: 2, contentType: "application/json" })),
      deleteVerified: vi.fn(async () => undefined),
    },
  };
}

describe("CouncilSessionDO recovery", () => {
  it("refuses a turn append that races a completed deleteSession, without writing R2", async () => {
    const state = makeState();
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    await object.deleteSession(AUTH, { sessionId: "session-1" });
    await expect(object.appendTurn(AUTH, {
      sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hi" },
    })).rejects.toMatchObject({ code: "council_session_not_found", status: 404 });
    expect(currentStores.objectStore.putCouncilPayload).not.toHaveBeenCalled();
  });

  it("appends normally when the session is still live", async () => {
    const state = makeState();
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    const result = await object.appendTurn(AUTH, {
      sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hi" },
    });
    expect(result).toMatchObject({ turnIndex: 0, replayed: false });
    expect(currentStores.objectStore.putCouncilPayload).toHaveBeenCalledOnce();
  });

  it("re-seeds its schema so a post-delete append fails typed rather than on missing tables", async () => {
    const state = makeState();
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    await object.deleteSession(AUTH, { sessionId: "session-1" });
    let rejection;
    try {
      await object.appendTurn(AUTH, {
        sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hi" },
      });
    } catch (err) {
      rejection = err;
    }
    expect(rejection.code).toBe("council_session_not_found");
    expect(rejection.message).not.toMatch(/no such table/);
  });

  it("throws a typed 404 when the turn sequence allocates no row", async () => {
    const state = makeState({ ledgerInsertReturnsNothing: true });
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    await expect(object.appendTurn(AUTH, {
      sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hi" },
    })).rejects.toMatchObject({ code: "council_session_not_found", status: 404 });
  });
});
