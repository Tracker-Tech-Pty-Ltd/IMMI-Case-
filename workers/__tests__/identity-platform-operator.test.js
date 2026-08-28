import { describe, expect, it, vi } from "vitest";
import { createCloudflareIdentityStore } from "../storage/cloudflare.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUTH = { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] };

/** Fake D1 that answers per-statement based on the SQL text. */
function accountDb({ membership = { role: "owner" }, user = { platform_admin: 0 }, throwOnUsers = false } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
        first: vi.fn(async () => {
          if (sql.includes("FROM memberships")) return membership;
          if (sql.includes("platform_admin")) {
            if (throwOnUsers) throw new Error("no such column: platform_admin");
            return user;
          }
          return null;
        }),
      };
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
}

function env(overrides = {}) {
  return { IMMI_STORAGE_MODE: "cloudflare", IMMI_ACCOUNT_DB: accountDb(), ...overrides };
}

describe("CloudflareIdentityStore.assertPlatformOperator", () => {
  it("denies a fresh Telegram signup (tenant owner, no platform grant)", async () => {
    const store = createCloudflareIdentityStore(env());
    await expect(store.assertPlatformOperator(AUTH)).rejects.toMatchObject({
      code: "platform_operator_required",
      status: 403,
    });
  });

  it("denies a tenant admin with no platform grant", async () => {
    const store = createCloudflareIdentityStore(
      env({ IMMI_ACCOUNT_DB: accountDb({ membership: { role: "admin" } }) }),
    );
    await expect(store.assertPlatformOperator(AUTH)).rejects.toMatchObject({
      code: "platform_operator_required",
      status: 403,
    });
  });

  it("grants when platform_admin = 1", async () => {
    const store = createCloudflareIdentityStore(
      env({ IMMI_ACCOUNT_DB: accountDb({ user: { platform_admin: 1 } }) }),
    );
    const result = await store.assertPlatformOperator(AUTH);
    expect(result).toMatchObject({ platformOperator: true, grant: "platform_admin" });
  });

  it("grants via IMMI_PLATFORM_OPERATOR_IDS allowlist even when platform_admin is 0", async () => {
    const store = createCloudflareIdentityStore(
      env({ IMMI_PLATFORM_OPERATOR_IDS: USER_ID }),
    );
    const result = await store.assertPlatformOperator(AUTH);
    expect(result).toMatchObject({ platformOperator: true, grant: "allowlist" });
  });

  it("denies when IMMI_PLATFORM_OPERATOR_IDS lists a different user", async () => {
    const store = createCloudflareIdentityStore(
      env({ IMMI_PLATFORM_OPERATOR_IDS: "99999999-2222-4333-8444-555555555555" }),
    );
    await expect(store.assertPlatformOperator(AUTH)).rejects.toMatchObject({
      code: "platform_operator_required",
      status: 403,
    });
  });

  it("fails closed (403, not throw) when the platform_admin column lookup errors", async () => {
    const store = createCloudflareIdentityStore(
      env({ IMMI_ACCOUNT_DB: accountDb({ throwOnUsers: true }) }),
    );
    await expect(store.assertPlatformOperator(AUTH)).rejects.toMatchObject({
      code: "platform_operator_required",
      status: 403,
    });
  });
});
