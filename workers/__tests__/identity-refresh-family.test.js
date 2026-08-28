import { describe, expect, it, vi } from "vitest";
import { createCloudflareIdentityStore } from "../storage/cloudflare.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const JTI = "22222222-2222-4333-8444-555555555555";
const NEXT_JTI = "33333333-2222-4333-8444-555555555555";
const FAMILY_ID = "44444444-2222-4333-8444-555555555555";

function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

function isoFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

/** SQL-dispatching fake D1 that records every run() call for assertion. */
function accountDb({ session, casChanges = [1, 1] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => {
          if (sql.includes("FROM immi_refresh_sessions")) return session;
          return null;
        }),
        run: vi.fn(async () => {
          calls.push({ sql, params: statement.params });
          return { meta: { changes: 1 } };
        }),
      };
      return statement;
    },
    batch: vi.fn(async (statements) => {
      for (const statement of statements) calls.push({ sql: statement.sql, params: statement.params });
      return casChanges.map((changes) => ({ meta: { changes } }));
    }),
  };
}

function env(accountDbInstance) {
  return { IMMI_STORAGE_MODE: "cloudflare", IMMI_ACCOUNT_DB: accountDbInstance };
}

function familyRevokeCall(calls) {
  return calls.find(
    (call) => /UPDATE immi_refresh_sessions/.test(call.sql) && /WHERE family_id = \? AND user_id = \?/.test(call.sql),
  );
}

describe("CloudflareIdentityStore refresh-family revocation", () => {
  it("revokes the family when a rotated token is reused", async () => {
    const db = accountDb({
      session: {
        jti: JTI,
        user_id: USER_ID,
        family_id: FAMILY_ID,
        expires_at: isoFromNow(600_000),
        revoked_at: isoAgo(60_000),
        revoked_reason: "rotated",
      },
    });
    const store = createCloudflareIdentityStore(env(db));
    await expect(store.loadRefreshAuthSnapshot({ jti: JTI, userId: USER_ID })).rejects.toMatchObject({
      code: "revoked_refresh_token",
    });
    const revoke = familyRevokeCall(db.calls);
    expect(revoke).toBeDefined();
    expect(revoke.params).toContain("reuse_detected");
  });

  it("revokes the family even one second after rotation — no grace window", async () => {
    const db = accountDb({
      session: {
        jti: JTI,
        user_id: USER_ID,
        family_id: FAMILY_ID,
        expires_at: isoFromNow(600_000),
        revoked_at: isoAgo(1_000),
        revoked_reason: "rotated",
      },
    });
    const store = createCloudflareIdentityStore(env(db));
    await expect(store.loadRefreshAuthSnapshot({ jti: JTI, userId: USER_ID })).rejects.toMatchObject({
      code: "revoked_refresh_token",
    });
    expect(familyRevokeCall(db.calls)).toBeDefined();
  });

  it("revokes the family for a logout-revoked token too", async () => {
    const db = accountDb({
      session: {
        jti: JTI,
        user_id: USER_ID,
        family_id: FAMILY_ID,
        expires_at: isoFromNow(600_000),
        revoked_at: isoAgo(1_000),
        revoked_reason: "logout",
      },
    });
    const store = createCloudflareIdentityStore(env(db));
    await expect(store.loadRefreshAuthSnapshot({ jti: JTI, userId: USER_ID })).rejects.toMatchObject({
      code: "revoked_refresh_token",
    });
    expect(familyRevokeCall(db.calls)).toBeDefined();
  });

  it("does not revoke the family on the compare-and-swap backstop", async () => {
    const db = accountDb({ casChanges: [0, 0] });
    const store = createCloudflareIdentityStore(env(db));
    await expect(
      store.rotateRefreshSession(
        { jti: JTI, userId: USER_ID },
        { jti: NEXT_JTI, userId: USER_ID, familyId: FAMILY_ID, expiresAt: isoFromNow(600_000) },
      ),
    ).rejects.toMatchObject({ code: "revoked_refresh_token" });
    expect(familyRevokeCall(db.calls)).toBeUndefined();
  });

  it("validates the familyId passed to revokeRefreshFamily", async () => {
    const db = accountDb({});
    const store = createCloudflareIdentityStore(env(db));
    await expect(
      store.revokeRefreshFamily({ familyId: "not-a-uuid", userId: USER_ID }),
    ).rejects.toMatchObject({ code: "invalid_identifier" });
  });
});
