import { describe, expect, it, vi } from "vitest";
import { CloudflareCouncilStore } from "../storage/cloudflare.js";

const AUTH = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function d1({ allRows = [], firstRow = null, changes = 1 } = {}) {
  const calls = [];
  const binding = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; calls.push(this); return this; },
        all: vi.fn(async () => ({ results: allRows })),
        first: vi.fn(async () => firstRow),
        run: vi.fn(async () => ({ meta: { changes } })),
      };
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes } }))),
  };
  return binding;
}

describe("CloudflareCouncilStore.createSession retrieve-code conflict", () => {
  it("raises a typed retrieve_code_conflict when the insert changes no rows", async () => {
    const db = d1({ changes: 0 });
    const store = new CloudflareCouncilStore({ IMMI_ACCOUNT_DB: db });
    await expect(store.createSession(AUTH, { sessionId: "s1", retrieveCode: "ABCDEF" }))
      .rejects.toMatchObject({ code: "retrieve_code_conflict", status: 409 });
    const insertCall = db.calls.find((call) => call.sql.includes("INSERT INTO council_sessions"));
    expect(insertCall.sql).toContain("ON CONFLICT(retrieve_code) DO NOTHING");
  });

  it("inserts a null retrieve code without tripping the conflict branch", async () => {
    const db = d1({ changes: 1, firstRow: { session_id: "s1", retrieve_code: null } });
    const store = new CloudflareCouncilStore({ IMMI_ACCOUNT_DB: db });
    await expect(store.createSession(AUTH, { sessionId: "s1" })).resolves.toMatchObject({ session_id: "s1" });
  });
});
