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

import { CouncilSessionDO, getCouncilSessionStub } from "../llm-council/session_do.js";

const AUTH = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function makeState() {
  const ledger = new Map();
  let nextTurn = -1;
  return {
    blockConcurrencyWhile: async (callback) => callback(),
    storage: {
      deleteAll: vi.fn(async () => undefined),
      sql: {
        exec(sql, ...params) {
          if (sql.includes("SELECT turn_index")) {
            const value = ledger.get(params[0]);
            return value ? [value] : [];
          }
          if (sql.includes("INSERT INTO council_turn_ledger")) {
            const value = { turn_index: ++nextTurn, completed: 0 };
            ledger.set(params[0], value);
            return [value];
          }
          if (sql.includes("UPDATE council_turn_sequence")) return [];
          if (sql.includes("SET completed = 1")) {
            ledger.get(params[0]).completed = 1;
            return [];
          }
          return [];
        },
      },
    },
  };
}

function stores() {
  return {
    objectStore: {
      putCouncilPayload: vi.fn(async () => ({
        key: "council/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/session/turn.json",
        sha256: "0".repeat(64),
        size: 300_000,
        contentType: "application/json",
      })),
      deleteVerified: vi.fn(async () => undefined),
    },
    councilStore: {
      appendTurnMetadata: vi.fn(async () => undefined),
      getSessionMetadata: vi.fn(async () => ({
        session: { session_id: "session-1" },
        turns: [{
          payload_key: "council/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/session-1/turn-1.json",
          payload_sha256: "0".repeat(64), payload_size: 300_000,
          payload_content_type: "application/json",
        }],
      })),
      deleteSession: vi.fn(async () => undefined),
    },
  };
}

describe("CouncilSessionDO", () => {
  it("uses a deterministic per-session Durable Object name", () => {
    const getByName = vi.fn(() => "stub");
    expect(getCouncilSessionStub({ COUNCIL_SESSION: { getByName } }, "session-1")).toBe("stub");
    expect(getByName).toHaveBeenCalledWith("session:session-1");
  });

  it("serializes a turn, writes R2 before metadata, then replays idempotently", async () => {
    const state = makeState();
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    const first = await object.appendTurn(AUTH, {
      sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hello" },
    });
    const replay = await object.appendTurn(AUTH, {
      sessionId: "session-1", turnId: "turn-1", role: "user", payload: { text: "hello" },
    });
    expect(first).toMatchObject({ turnIndex: 0, replayed: false });
    expect(replay).toEqual({ turnIndex: 0, replayed: true });
    expect(currentStores.objectStore.putCouncilPayload).toHaveBeenCalledTimes(1);
    expect(currentStores.councilStore.appendTurnMetadata).toHaveBeenCalledTimes(1);
  });

  it("deletes verified Council payloads before Account D1 metadata", async () => {
    const state = makeState();
    const currentStores = stores();
    createCloudflareStores.mockReturnValue(currentStores);
    const object = new CouncilSessionDO(state, { IMMI_STORAGE_MODE: "cloudflare" });
    await object.deleteSession(AUTH, { sessionId: "session-1" });
    expect(currentStores.objectStore.deleteVerified).toHaveBeenCalledWith(expect.objectContaining({
      key: "council/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/session-1/turn-1.json",
    }), { prefix: "council" });
    expect(currentStores.councilStore.deleteSession).toHaveBeenCalledWith(
      { userId: AUTH.sub, tenantId: AUTH.tenant_id, role: "member" },
      "session-1",
    );
    expect(state.storage.deleteAll).toHaveBeenCalledOnce();
  });
});
