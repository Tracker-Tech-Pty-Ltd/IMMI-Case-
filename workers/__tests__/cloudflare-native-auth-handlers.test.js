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
  handleAuthRefresh,
  handleAuthSwitchTenant,
  handleBootstrapLogin,
  handleTelegramLogin,
} from "../auth/cloudflare_handlers.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const JTI = "99999999-2222-4333-8444-555555555555";
const SNAPSHOT = {
  user: { id: USER_ID, telegram_id: 123456, role: "owner" },
  tenant: { id: TENANT_ID, kind: "individual", name: "Ada" },
  tenants: [TENANT_ID],
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
    expect(store.loadRefreshAuthSnapshot).toHaveBeenCalledWith({ userId: USER_ID, jti: JTI });
    expect(store.rotateRefreshSession).toHaveBeenCalledWith({ userId: USER_ID, jti: JTI }, expect.objectContaining({ userId: USER_ID }));
  });

  it("uses live Account D1 membership for tenant switching", async () => {
    const store = mockCreateIdentity();
    const response = await handleAuthSwitchTenant(request("POST", "/api/v1/auth/switch-tenant", {
      tenant_id: TENANT_ID,
    }), { IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(store.getAuthSnapshot).toHaveBeenCalledWith(USER_ID, TENANT_ID);
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
