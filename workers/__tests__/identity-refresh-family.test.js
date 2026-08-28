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

/**
 * Assert the family revocation actually targeted the lineage.
 *
 * The bound parameters are (revoked_at, reason, last_used_at, family_id,
 * user_id) — positional, because a revocation aimed at `session.jti` instead
 * of `session.family_id` still runs SQL of the right *shape* and still binds
 * "reuse_detected". Checking the shape alone let that mutation pass while no
 * successor row was revoked, so pin the identifier itself.
 */
function expectFamilyRevoked(calls, { familyId = FAMILY_ID, userId = USER_ID } = {}) {
  const call = familyRevokeCall(calls);
  expect(call, "expected a family-wide revocation").toBeDefined();
  expect(call.params[1]).toBe("reuse_detected");
  expect(call.params[3]).toBe(familyId);
  expect(call.params[4]).toBe(userId);
  return call;
}

/**
 * A fake D1 that answers per-row, so the successor lookup on the idempotent
 * replay path can be distinguished from the presented-session read.
 */
function rowStoreDb({ sessions = {}, user = { user_id: USER_ID, telegram_id: 4242 }, memberships = [] } = {}) {
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
        all: vi.fn(async () => ({
          results: sql.includes("FROM memberships") ? memberships : [],
        })),
        first: vi.fn(async () => {
          if (sql.includes("FROM immi_refresh_sessions")) return sessions[statement.params[0]] ?? null;
          if (sql.includes("FROM users")) return user;
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
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }),
  };
}

const MEMBERSHIP = {
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  kind: "individual",
  name: "Ada",
  role: "owner",
};

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
    expectFamilyRevoked(db.calls);
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

  it("revokes the family when it loses the compare-and-swap race", async () => {
    // Losing the CAS means another request rotated this jti first. Failing
    // with a bare 401 left the winner's successor alive, so a thief who simply
    // won the race kept a working session while the victim was signed out.
    const db = accountDb({ casChanges: [0, 0] });
    const store = createCloudflareIdentityStore(env(db));
    await expect(
      store.rotateRefreshSession(
        { jti: JTI, userId: USER_ID },
        { jti: NEXT_JTI, userId: USER_ID, familyId: FAMILY_ID, expiresAt: isoFromNow(600_000) },
      ),
    ).rejects.toMatchObject({ code: "revoked_refresh_token" });
    expectFamilyRevoked(db.calls);
  });

  it("replays its own committed rotation instead of revoking the family", async () => {
    // The transient-failure path: the rotation committed, the response never
    // reached the browser, and the client retried with the same rotation id.
    // Re-serving the successor it already created is not reuse.
    const db = rowStoreDb({
      sessions: {
        [JTI]: {
          jti: JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: isoAgo(1_000),
          revoked_reason: "rotated",
          replaced_by_jti: NEXT_JTI,
        },
        [NEXT_JTI]: {
          jti: NEXT_JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: null,
        },
      },
      memberships: [MEMBERSHIP],
    });
    const store = createCloudflareIdentityStore(env(db));
    const result = await store.loadRefreshAuthSnapshot({
      jti: JTI,
      userId: USER_ID,
      expectedSuccessorJti: NEXT_JTI,
    });
    expect(result.replayed).toBe(true);
    expect(result.session.jti).toBe(NEXT_JTI);
    expect(familyRevokeCall(db.calls)).toBeUndefined();
  });

  it("still revokes the family when the replay proof does not match", async () => {
    // A thief holding only the stolen cookie cannot produce the rotation id,
    // so its derived successor never matches replaced_by_jti.
    const db = rowStoreDb({
      sessions: {
        [JTI]: {
          jti: JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: isoAgo(1_000),
          revoked_reason: "rotated",
          replaced_by_jti: NEXT_JTI,
        },
      },
      memberships: [MEMBERSHIP],
    });
    const store = createCloudflareIdentityStore(env(db));
    await expect(store.loadRefreshAuthSnapshot({
      jti: JTI,
      userId: USER_ID,
      expectedSuccessorJti: "88888888-2222-4333-8444-555555555555",
    })).rejects.toMatchObject({ code: "revoked_refresh_token" });
    expectFamilyRevoked(db.calls);
  });

  it("refuses to replay when the successor was itself already rotated", async () => {
    // The successor being gone proves the client did receive it, so replaying
    // its parent is a genuine reuse signal rather than a lost response.
    const db = rowStoreDb({
      sessions: {
        [JTI]: {
          jti: JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: isoAgo(1_000),
          revoked_reason: "rotated",
          replaced_by_jti: NEXT_JTI,
        },
        [NEXT_JTI]: {
          jti: NEXT_JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: isoAgo(500),
          revoked_reason: "rotated",
        },
      },
      memberships: [MEMBERSHIP],
    });
    const store = createCloudflareIdentityStore(env(db));
    await expect(store.loadRefreshAuthSnapshot({
      jti: JTI,
      userId: USER_ID,
      expectedSuccessorJti: NEXT_JTI,
    })).rejects.toMatchObject({ code: "revoked_refresh_token" });
    expectFamilyRevoked(db.calls);
  });

  it("keeps the UI's tenant on refresh instead of reverting to the first membership", async () => {
    const OTHER_TENANT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const db = rowStoreDb({
      sessions: {
        [JTI]: {
          jti: JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: null,
        },
      },
      memberships: [MEMBERSHIP, { ...MEMBERSHIP, tenant_id: OTHER_TENANT, name: "Team", kind: "organization" }],
    });
    const store = createCloudflareIdentityStore(env(db));
    const result = await store.loadRefreshAuthSnapshot({
      jti: JTI,
      userId: USER_ID,
      activeTenantId: OTHER_TENANT,
    });
    expect(result.tenant.id).toBe(OTHER_TENANT);
    expect(result.tenants).toEqual([
      { id: MEMBERSHIP.tenant_id, kind: "individual", name: "Ada" },
      { id: OTHER_TENANT, kind: "organization", name: "Team" },
    ]);
    expect(result.tenantIds).toEqual([MEMBERSHIP.tenant_id, OTHER_TENANT]);
  });

  it("falls back to the default tenant when the UI's preference is stale", async () => {
    // A refresh must never 403 because localStorage still names a workspace
    // the user was removed from — that would end the session outright.
    const db = rowStoreDb({
      sessions: {
        [JTI]: {
          jti: JTI,
          user_id: USER_ID,
          family_id: FAMILY_ID,
          expires_at: isoFromNow(600_000),
          revoked_at: null,
        },
      },
      memberships: [MEMBERSHIP],
    });
    const store = createCloudflareIdentityStore(env(db));
    const result = await store.loadRefreshAuthSnapshot({
      jti: JTI,
      userId: USER_ID,
      activeTenantId: "cccccccc-dddd-4eee-8fff-000000000000",
    });
    expect(result.tenant.id).toBe(MEMBERSHIP.tenant_id);
  });

  it("still 403s an explicit switch to a tenant the user does not belong to", async () => {
    const db = rowStoreDb({ memberships: [MEMBERSHIP] });
    const store = createCloudflareIdentityStore(env(db));
    await expect(
      store.getAuthSnapshot(USER_ID, "cccccccc-dddd-4eee-8fff-000000000000"),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("validates the familyId passed to revokeRefreshFamily", async () => {
    const db = accountDb({});
    const store = createCloudflareIdentityStore(env(db));
    await expect(
      store.revokeRefreshFamily({ familyId: "not-a-uuid", userId: USER_ID }),
    ).rejects.toMatchObject({ code: "invalid_identifier" });
  });
});
