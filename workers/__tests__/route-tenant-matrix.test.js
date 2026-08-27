/**
 * Route-level tenant enforcement.
 *
 * d1-schema-contract.test.js proves assertMembership() denies correctly.
 * This file proves a REAL ROUTE reaches it: the request goes through
 * workers/cloudflare-native.js with a genuinely signed JWT, and the four deny
 * cells are asserted by response code, not by inspecting the handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signJwt } from "../auth/jwt.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TENANT_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const ADMIN_PATH = "/api/v1/admin/pipeline-runs";
const ctx = { waitUntil() {}, passThroughOnException() {} };

let env;

function baseEnv() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    JWT_SECRET_CURRENT: "test-secret-not-a-real-credential",
    JWT_KID_CURRENT: "test-kid",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: { put: vi.fn(), get: vi.fn(async () => null), head: vi.fn(async () => null), delete: vi.fn() },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(), deleteByIds: vi.fn(),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("spa", { status: 200 })) },
  };
}

function seedTenancy() {
  const now = "2026-08-27T00:00:00.000Z";
  env.IMMI_ACCOUNT_DB.exec(`
    INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at)
    VALUES ('${TENANT_ID}','individual','Workspace','${now}','${now}'),
           ('${OTHER_TENANT_ID}','organisation','Other','${now}','${now}');
    INSERT INTO users (user_id,telegram_id,created_at,updated_at)
    VALUES ('${USER_ID}','42','${now}','${now}');
  `);
  return now;
}

function grant(role, tenantId = TENANT_ID, revokedAt = null) {
  const now = "2026-08-27T00:00:00.000Z";
  env.IMMI_ACCOUNT_DB.exec(
    `INSERT INTO memberships (tenant_id,user_id,role,created_at,revoked_at) VALUES ` +
    `('${tenantId}','${USER_ID}','${role}','${now}',${revokedAt ? `'${revokedAt}'` : "NULL"})`,
  );
}

async function callAdmin(tenantId = TENANT_ID) {
  const token = await signJwt(
    { sub: USER_ID, tenant_id: tenantId, tenants: [tenantId], exp: Math.floor(Date.now() / 1000) + 300 },
    env,
  );
  const response = await worker.fetch(
    new Request(`https://immi.example${ADMIN_PATH}`, { headers: { Authorization: `Bearer ${token}` } }),
    env,
    ctx,
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeEach(() => {
  env = baseEnv();
  seedTenancy();
});

describe("GET /api/v1/admin/pipeline-runs enforces membership at the route", () => {
  it("401s with no bearer token at all", async () => {
    const response = await worker.fetch(new Request(`https://immi.example${ADMIN_PATH}`), env, ctx);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("auth_required");
  });

  it("403 tenant_membership_denied when the user has no membership row", async () => {
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "tenant_membership_denied" } });
  });

  it("403 tenant_membership_denied after the membership is revoked", async () => {
    grant("owner", TENANT_ID, "2026-08-27T00:00:00.000Z");
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "tenant_membership_denied" } });
  });

  it("403 tenant_membership_denied for a tenant the user is not a member of", async () => {
    grant("owner", TENANT_ID);
    expect(await callAdmin(OTHER_TENANT_ID)).toMatchObject({
      status: 403, body: { code: "tenant_membership_denied" },
    });
  });

  it("403 admin_required for a live membership with an insufficient role", async () => {
    grant("viewer");
    expect(await callAdmin()).toMatchObject({ status: 403, body: { code: "admin_required" } });
  });

  it("serves the route for a live owner membership", async () => {
    grant("owner");
    const result = await callAdmin();
    expect(result.status).toBe(200);
    expect(result.body).not.toBeNull();
  });
});

describe("case mutations stay fail-closed", () => {
  it("returns case_mutations_disabled while IMMI_CASE_MUTATIONS_ENABLED is unset", async () => {
    // wrangler.toml ships this flag as "false" by design; prove the freeze is
    // observable rather than assumed.
    const response = await worker.fetch(
      new Request("https://immi.example/api/v1/cases", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("case_mutations_disabled");
  });
});
