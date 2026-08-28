import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyTelegram = vi.fn();
const mockNonce = vi.fn();
const mockMakeAccess = vi.fn();
const mockMakeRefresh = vi.fn();
const mockVerifyJwt = vi.fn();
const mockRequireAuth = vi.fn();
const mockCreateIdentity = vi.fn();

vi.mock("../auth/telegram.js", () => ({ verifyTelegramAuth: (...args) => mockVerifyTelegram(...args) }));
vi.mock("../auth/nonce_do.js", () => ({ checkNonce: (...args) => mockNonce(...args) }));
vi.mock("../auth/jwt.js", () => ({
  makeAccessToken: (...args) => mockMakeAccess(...args),
  makeRefreshToken: (...args) => mockMakeRefresh(...args),
  verifyJwt: (...args) => mockVerifyJwt(...args),
}));
vi.mock("../auth/request_auth.js", () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
  extractToken: () => "access-token",
}));
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareIdentityStore: (...args) => mockCreateIdentity(...args),
}));

import {
  handleAuthLogout,
  handleAuthRefresh,
  handleAuthSwitchTenant,
  handleBootstrapLogin,
  handleTelegramLogin,
  safeRedirectTarget,
} from "../auth/cloudflare_handlers.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const JTI = "99999999-2222-4333-8444-555555555555";
const OTHER_TENANT_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const TENANTS = [
  { id: TENANT_ID, kind: "individual", name: "Ada" },
  { id: OTHER_TENANT_ID, kind: "organization", name: "Team" },
];
const SNAPSHOT = {
  user: { id: USER_ID, telegram_id: 123456, role: "owner" },
  tenant: { id: TENANT_ID, kind: "individual", name: "Ada" },
  // Two shapes on purpose: `tenants` is the AuthTenant[] the SPA renders,
  // `tenantIds` is the bare-id JWT claim assertAuthContext() string-matches.
  tenants: TENANTS,
  tenantIds: [TENANT_ID, OTHER_TENANT_ID],
};

function request(method, path, body, headers = {}) {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyTelegram.mockResolvedValue({ valid: true });
  mockNonce.mockResolvedValue(true);
  mockMakeAccess.mockResolvedValue("access-token");
  mockMakeRefresh.mockResolvedValue("refresh-token");
  mockVerifyJwt.mockResolvedValue({ valid: true, payload: { type: "refresh", sub: USER_ID, jti: JTI }, reason: "" });
  mockRequireAuth.mockResolvedValue({ claims: { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] } });
  mockCreateIdentity.mockReturnValue({
    upsertTelegramUser: vi.fn(async () => SNAPSHOT),
    createRefreshSession: vi.fn(async () => undefined),
    loadRefreshAuthSnapshot: vi.fn(async () => ({ ...SNAPSHOT, session: { family_id: JTI } })),
    rotateRefreshSession: vi.fn(async () => undefined),
    getAuthSnapshot: vi.fn(async () => SNAPSHOT),
  });
});

describe("standalone native auth handlers", () => {
  it("authenticates Telegram through Account D1 without a Hyperdrive path", async () => {
    const store = mockCreateIdentity();
    const response = await handleTelegramLogin(request("POST", "/api/v1/auth/telegram", {
      id: 123456, first_name: "Ada", hash: "valid-hash",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(store.upsertTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 123456 }));
    expect(store.createRefreshSession).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ tenant: SNAPSHOT.tenant, access_token: "access-token" });
  });

  it("rotates refresh state using the Account D1 compare-and-swap store", async () => {
    const store = mockCreateIdentity();
    const response = await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, jti: JTI }),
    );
    expect(store.rotateRefreshSession).toHaveBeenCalledWith({ userId: USER_ID, jti: JTI }, expect.objectContaining({ userId: USER_ID }));
  });

  it("mints the access token from tenant ids, never from tenant objects", async () => {
    // makeAccessToken's `tenants` claim is what assertAuthContext() string-
    // matches against. Handing it the AuthTenant[] the SPA renders would
    // stringify to "[object Object]" and fail every tenant check.
    await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(mockMakeAccess).toHaveBeenCalledWith(
      SNAPSHOT.user, SNAPSHOT.tenant, SNAPSHOT.tenantIds, expect.anything(),
    );
  });

  it("returns the identity on refresh so a recovering client is not user-less", async () => {
    const response = await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(await response.json()).toMatchObject({
      access_token: "access-token",
      user: SNAPSHOT.user,
      tenant: SNAPSHOT.tenant,
      tenants: TENANTS,
    });
  });

  it("carries the UI's active tenant into the refresh so a switch survives it", async () => {
    const store = mockCreateIdentity();
    await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
      "X-Active-Tenant-Id": OTHER_TENANT_ID,
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ activeTenantId: OTHER_TENANT_ID }),
    );
  });

  it("ignores a malformed active-tenant header rather than trusting it", async () => {
    const store = mockCreateIdentity();
    await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
      "X-Active-Tenant-Id": "'; DROP TABLE memberships;--",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ activeTenantId: null }),
    );
  });

  it("does not rotate again when replaying its own committed rotation", async () => {
    // The lost-response retry. Rotating here would consume the live successor
    // the first attempt already created.
    const store = mockCreateIdentity();
    store.loadRefreshAuthSnapshot = vi.fn(async () => ({
      ...SNAPSHOT,
      session: { jti: "77777777-2222-4333-8444-555555555555", family_id: JTI },
      replayed: true,
    }));
    const response = await handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
      "X-Refresh-Rotation-Id": "12345678-1234-4234-8234-123456789abc",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(store.rotateRefreshSession).not.toHaveBeenCalled();
    expect(mockMakeRefresh).toHaveBeenCalledWith(
      USER_ID, "77777777-2222-4333-8444-555555555555", expect.anything(),
    );
  });

  it("derives the successor jti from the rotation id so a retry is idempotent", async () => {
    const store = mockCreateIdentity();
    const rotationId = "12345678-1234-4234-8234-123456789abc";
    const refreshWithRotationId = () => handleAuthRefresh(
      request("POST", "/api/v1/auth/refresh", undefined, {
        Cookie: "immi_refresh=refresh",
        "X-Refresh-Rotation-Id": rotationId,
      }),
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    await refreshWithRotationId();
    await refreshWithRotationId();
    const [first, second] = store.rotateRefreshSession.mock.calls;
    // Same rotation id ⇒ same successor, which is exactly what lets the store
    // recognise a retry as its own rather than as reuse.
    expect(second[1].jti).toBe(first[1].jti);
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSuccessorJti: first[1].jti }),
    );
    // And it must not simply echo the client's key back as the primary key.
    expect(first[1].jti).not.toBe(rotationId);
  });

  it("uses a fresh successor when no rotation id is supplied", async () => {
    const store = mockCreateIdentity();
    const bare = () => handleAuthRefresh(request("POST", "/api/v1/auth/refresh", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    await bare();
    await bare();
    const [first, second] = store.rotateRefreshSession.mock.calls;
    expect(second[1].jti).not.toBe(first[1].jti);
  });

  it("uses live Account D1 membership for tenant switching", async () => {
    const store = mockCreateIdentity();
    const response = await handleAuthSwitchTenant(request("POST", "/api/v1/auth/switch-tenant", {
      tenant_id: TENANT_ID,
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(store.getAuthSnapshot).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    // The switcher renders t.id/t.kind/t.name, so the response must carry
    // objects — bare ids produced undefined option values.
    expect(await response.json()).toMatchObject({ tenants: TENANTS });
  });

  it("keeps the refresh cookie when logout revocation fails", async () => {
    // Expiring it here would destroy the only credential that can retry the
    // revocation — JS cannot read an HttpOnly cookie back — leaving a stolen
    // copy refreshable for the remaining 7 days with no way to kill it.
    const store = mockCreateIdentity();
    store.revokeRefreshSession = vi.fn(async () => { throw new Error("D1 unavailable"); });
    const response = await handleAuthLogout(request("POST", "/api/v1/auth/logout", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(503);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("immi_access=;"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("immi_refresh="))).toBe(false);
  });

  it("clears both cookies when logout revocation succeeds", async () => {
    const store = mockCreateIdentity();
    store.revokeRefreshSession = vi.fn(async () => undefined);
    const response = await handleAuthLogout(request("POST", "/api/v1/auth/logout", undefined, {
      Cookie: "immi_refresh=refresh",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("immi_access=;"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("immi_refresh=;"))).toBe(true);
  });

  it("returns renderable tenant objects on login, not bare ids", async () => {
    const response = await handleTelegramLogin(request("POST", "/api/v1/auth/telegram", {
      id: 123456, first_name: "Ada", hash: "valid-hash",
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    const body = await response.json();
    expect(body.tenants).toEqual(TENANTS);
    for (const tenant of body.tenants) {
      expect(typeof tenant).toBe("object");
      expect(tenant.id).toEqual(expect.any(String));
      expect(tenant.name).toEqual(expect.any(String));
    }
  });
});

describe("Cloudflare-native Bootstrap login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMakeAccess.mockResolvedValue("access-token");
    mockMakeRefresh.mockResolvedValue("refresh-token");
    mockCreateIdentity.mockReturnValue({
      getAuthSnapshot: vi.fn(async () => SNAPSHOT),
      createRefreshSession: vi.fn(async () => ({})),
    });
  });

  it("returns 503 when bootstrap is not configured", async () => {
    const response = await handleBootstrapLogin(
      request("POST", "/api/v1/auth/bootstrap", { secret: "anything" }),
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(503);
  });

  it("returns 401 on wrong bootstrap secret", async () => {
    const response = await handleBootstrapLogin(
      request("POST", "/api/v1/auth/bootstrap", { secret: "wrong" }),
      { IMMI_STORAGE_MODE: "cloudflare", BOOTSTRAP_ADMIN_SECRET: "correct", BOOTSTRAP_ADMIN_USER_ID: USER_ID },
    );
    expect(response.status).toBe(401);
  });

  it("mints an access+refresh pair on valid bootstrap secret", async () => {
    const store = mockCreateIdentity();
    const response = await handleBootstrapLogin(
      request("POST", "/api/v1/auth/bootstrap", { secret: "correct" }),
      { IMMI_STORAGE_MODE: "cloudflare", BOOTSTRAP_ADMIN_SECRET: "correct", BOOTSTRAP_ADMIN_USER_ID: USER_ID },
    );
    expect(response.status).toBe(200);
    expect(store.getAuthSnapshot).toHaveBeenCalledWith(USER_ID);
    const body = await response.json();
    expect(body.access_token).toBe("access-token");
    const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    expect(cookies.some((c) => c.startsWith("immi_refresh=refresh-token"))).toBe(true);
  });
});


describe("safeRedirectTarget", () => {
  const ORIGIN = "https://immi.example";

  it("accepts a same-origin path", () => {
    expect(safeRedirectTarget("/cases/abc", ORIGIN)).toBe("/cases/abc");
  });

  it("accepts a same-origin path with query and hash", () => {
    expect(safeRedirectTarget("/cases?year=2024#top", ORIGIN)).toBe("/cases?year=2024#top");
  });

  it("rejects a backslash-prefixed target (WHATWG special-authority-ignore-slashes)", () => {
    expect(safeRedirectTarget("/\\evil.example", ORIGIN)).toBe("/app/");
  });

  it("rejects a protocol-relative target", () => {
    expect(safeRedirectTarget("//evil.example", ORIGIN)).toBe("/app/");
  });

  it("rejects an absolute URL to another origin", () => {
    expect(safeRedirectTarget("https://evil.example", ORIGIN)).toBe("/app/");
  });

  it("rejects a slash-backslash-slash target", () => {
    expect(safeRedirectTarget("/\\/evil.example", ORIGIN)).toBe("/app/");
  });

  it("rejects a target containing a NUL byte", () => {
    expect(safeRedirectTarget("/cases\u0000evil", ORIGIN)).toBe("/app/");
  });

  it("falls back to the default for null", () => {
    expect(safeRedirectTarget(null, ORIGIN)).toBe("/app/");
  });

  it("falls back to the default for an empty string", () => {
    expect(safeRedirectTarget("", ORIGIN)).toBe("/app/");
  });
});
