import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyTelegramAuth = vi.fn();
const mockCheckNonce = vi.fn();
const mockMakeAccessToken = vi.fn();
const mockMakeRefreshToken = vi.fn();
const mockVerifyJwt = vi.fn();
const mockRequireAuth = vi.fn();
const mockCreateIdentityStore = vi.fn();

vi.mock("../auth/telegram.js", () => ({
  verifyTelegramAuth: (...args) => mockVerifyTelegramAuth(...args),
}));
vi.mock("../auth/nonce_do.js", () => ({
  checkNonce: (...args) => mockCheckNonce(...args),
}));
vi.mock("../auth/jwt.js", () => ({
  makeAccessToken: (...args) => mockMakeAccessToken(...args),
  makeRefreshToken: (...args) => mockMakeRefreshToken(...args),
  verifyJwt: (...args) => mockVerifyJwt(...args),
}));
vi.mock("../auth/request_auth.js", () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
  extractToken: () => "access-token",
}));
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareIdentityStore: (...args) => mockCreateIdentityStore(...args),
}));

import {
  handleAuthLogout,
  handleAuthRefresh,
  handleAuthSwitchTenant,
  handleTelegramLogin,
} from "../auth/handlers.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const JTI = "99999999-2222-4333-8444-555555555555";
const FAMILY_ID = "88888888-2222-4333-8444-555555555555";
const SNAPSHOT = {
  user: { id: USER_ID, telegram_id: 123456, role: "owner" },
  tenant: { id: TENANT_ID, kind: "individual", name: "Ada" },
  tenants: [TENANT_ID],
};

function env(mode = "cloudflare") {
  return {
    IMMI_STORAGE_MODE: mode,
    JWT_SECRET_CURRENT: "test-secret-current-32-bytes-long-xx",
    JWT_KID_CURRENT: "v1",
  };
}

function request(method, path, { body, headers } = {}) {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyTelegramAuth.mockResolvedValue({ valid: true });
  mockCheckNonce.mockResolvedValue(true);
  mockMakeAccessToken.mockResolvedValue("access-token");
  mockMakeRefreshToken.mockResolvedValue("refresh-token");
  mockVerifyJwt.mockResolvedValue({
    valid: true,
    payload: { type: "refresh", sub: USER_ID, jti: JTI },
    reason: "",
  });
  mockRequireAuth.mockResolvedValue({
    claims: { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID], tg_id: 123456, role: "owner" },
  });
  mockCreateIdentityStore.mockReturnValue({
    upsertTelegramUser: vi.fn().mockResolvedValue(SNAPSHOT),
    createRefreshSession: vi.fn().mockResolvedValue(undefined),
    loadRefreshAuthSnapshot: vi.fn().mockResolvedValue({ ...SNAPSHOT, session: { family_id: FAMILY_ID } }),
    rotateRefreshSession: vi.fn().mockResolvedValue(undefined),
    revokeRefreshSession: vi.fn().mockResolvedValue(undefined),
    getAuthSnapshot: vi.fn().mockResolvedValue(SNAPSHOT),
  });
});

describe("Cloudflare Account D1 auth boundary", () => {
  it("logs in through IdentityStore without requiring Hyperdrive", async () => {
    const getSql = vi.fn(() => { throw new Error("legacy SQL must not run"); });
    const response = await handleTelegramLogin(request("POST", "/api/v1/auth/telegram", {
      body: { id: 123456, first_name: "Ada", hash: "valid-hash" },
    }), env(), getSql);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: "access-token",
      tenant: SNAPSHOT.tenant,
      tenants: [TENANT_ID],
    });
    expect(mockCreateIdentityStore).toHaveBeenCalledTimes(2);
    expect(getSql).not.toHaveBeenCalled();
  });

  it("rotates a refresh token through the conditional D1 session operation", async () => {
    const store = mockCreateIdentityStore();
    const response = await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", {
      headers: { Cookie: "immi_refresh=old-refresh" },
    }), env(), vi.fn());

    expect(response.status).toBe(200);
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith({ jti: JTI, userId: USER_ID });
    expect(store.rotateRefreshSession).toHaveBeenCalledWith(
      { jti: JTI, userId: USER_ID },
      expect.objectContaining({ userId: USER_ID, familyId: FAMILY_ID }),
    );
  });

  it("uses a live Account D1 membership lookup for tenant switch", async () => {
    const store = mockCreateIdentityStore();
    const response = await handleAuthSwitchTenant(request("POST", "/api/v1/auth/switch-tenant", {
      body: { tenant_id: TENANT_ID },
    }), env(), vi.fn());

    expect(response.status).toBe(200);
    expect(store.getAuthSnapshot).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    expect(await response.json()).toMatchObject({ tenant: SNAPSHOT.tenant });
  });

  it("revokes a Cloudflare refresh session on logout without legacy SQL", async () => {
    const store = mockCreateIdentityStore();
    const getSql = vi.fn(() => { throw new Error("legacy SQL must not run"); });
    const response = await handleAuthLogout(request("POST", "/api/v1/auth/logout", {
      headers: { Cookie: "immi_refresh=old-refresh" },
    }), env(), getSql);

    expect(response.status).toBe(200);
    expect(store.revokeRefreshSession).toHaveBeenCalledWith({
      jti: JTI, userId: USER_ID, reason: "logout",
    });
    expect(getSql).not.toHaveBeenCalled();
  });

  it("rejects write endpoints during explicit freeze mode", async () => {
    const response = await handleTelegramLogin(request("POST", "/api/v1/auth/telegram", {
      body: { id: 123456, hash: "valid-hash" },
    }), env("freeze"), vi.fn());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cutover_write_freeze" });
    expect(mockVerifyTelegramAuth).not.toHaveBeenCalled();
  });

  it("preserves the legacy unavailable-database response outside Cloudflare mode", async () => {
    const response = await handleTelegramLogin(request("POST", "/api/v1/auth/telegram", {
      body: { id: 123456, hash: "valid-hash" },
    }), env("legacy"), vi.fn());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "db_unavailable" });
    expect(mockCreateIdentityStore).not.toHaveBeenCalled();
  });
});
