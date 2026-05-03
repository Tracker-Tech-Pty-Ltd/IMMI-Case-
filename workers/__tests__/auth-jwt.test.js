/**
 * auth-jwt.test.js
 *
 * Vitest tests for workers/auth/jwt.js — HS256 sign/verify cycle,
 * key rotation (current → previous), expiry checks, and token factories.
 *
 * Test environment: Node (vitest.config.js `environment: "node"`).
 * Web Crypto is available natively in Node 18+; no polyfill needed.
 */

import { describe, it, expect } from "vitest";
import {
  signJwt,
  verifyJwt,
  makeAccessToken,
  makeRefreshToken,
} from "../auth/jwt.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockEnv = {
  JWT_SECRET_CURRENT: "test-secret-current-32-bytes-long-xx",
  JWT_SECRET_PREVIOUS: "test-secret-previous-32-bytes-longxx",
  JWT_KID_CURRENT: "v1",
  JWT_KID_PREVIOUS: "v0",
};

const previousKeyEnv = {
  // After rotation: old current becomes previous, new secret is different
  JWT_SECRET_CURRENT: "new-secret-after-rotation-32-bytes-x",
  JWT_SECRET_PREVIOUS: "test-secret-current-32-bytes-long-xx",
  JWT_KID_CURRENT: "v2",
};

const mockClaims = {
  sub: "550e8400-e29b-41d4-a716-446655440000",
  tenant_id: "660e8400-e29b-41d4-a716-446655440001",
  tenants: ["660e8400-e29b-41d4-a716-446655440001"],
  role: "owner",
  tg_id: 123456789,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flip one character in a base64url string at position idx. */
function tamperBase64url(str, idx = 0) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const c = str[idx];
  const replacement = alphabet[(alphabet.indexOf(c) + 1) % alphabet.length];
  return str.slice(0, idx) + replacement + str.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// signJwt + verifyJwt — round-trip
// ---------------------------------------------------------------------------

describe("signJwt + verifyJwt — round-trip with current key", () => {
  it("produces a valid JWT that verifies successfully", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ ...mockClaims, exp: now + 300 }, mockEnv);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("");
    expect(result.payload).not.toBeNull();
    expect(result.payload.sub).toBe(mockClaims.sub);
    expect(result.payload.role).toBe(mockClaims.role);
  });

  it("includes iat automatically (injected by signJwt)", async () => {
    const before = Math.floor(Date.now() / 1000);
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ ...mockClaims, exp: now + 300 }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.iat).toBeGreaterThanOrEqual(before);
    expect(result.payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });

  it("embeds kid from JWT_KID_CURRENT in header", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);
    // Decode header (first segment) without verification
    const headerB64 = token.split(".")[0];
    const padded = headerB64.replace(/-/g, "+").replace(/_/g, "/") + "==";
    const headerJson = JSON.parse(Buffer.from(padded, "base64").toString());
    expect(headerJson.kid).toBe(mockEnv.JWT_KID_CURRENT);
    expect(headerJson.alg).toBe("HS256");
    expect(headerJson.typ).toBe("JWT");
  });
});

// ---------------------------------------------------------------------------
// Key rotation — verify with previous key
// ---------------------------------------------------------------------------

describe("verifyJwt — key rotation window", () => {
  it("accepts a token signed with the old current key (now JWT_SECRET_PREVIOUS)", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Sign with the original current key
    const token = await signJwt({ ...mockClaims, exp: now + 300 }, mockEnv);

    // After rotation previousKeyEnv.JWT_SECRET_PREVIOUS === mockEnv.JWT_SECRET_CURRENT
    const result = await verifyJwt(token, previousKeyEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe(mockClaims.sub);
  });

  it("rejects a token when neither current nor previous key matches", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);

    const wrongEnv = {
      JWT_SECRET_CURRENT: "completely-different-secret-xxxxxxxx",
      JWT_SECRET_PREVIOUS: "also-completely-different-xxxxxxxxxx",
      JWT_KID_CURRENT: "v1",
    };
    const result = await verifyJwt(token, wrongEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe("verifyJwt — expiry", () => {
  it("rejects an expired token with reason='expired'", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ ...mockClaims, exp: now - 60 }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.payload).toBeNull();
  });

  it("accepts a token with exp in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 3600 }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
  });

  it("accepts a token with no exp field (no expiry enforced)", async () => {
    const token = await signJwt({ sub: "no-exp-user" }, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tampered tokens
// ---------------------------------------------------------------------------

describe("verifyJwt — tampered tokens", () => {
  it("rejects a token with a tampered signature segment", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);
    const parts = token.split(".");
    parts[2] = tamperBase64url(parts[2]);
    const result = await verifyJwt(parts.join("."), mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("rejects a token with a tampered payload segment (role escalation attempt)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ role: "member", exp: now + 300 }, mockEnv);
    const parts = token.split(".");
    const escalated = Buffer.from(
      JSON.stringify({ role: "admin", exp: now + 300, iat: now }),
    ).toString("base64url");
    parts[1] = escalated;
    const result = await verifyJwt(parts.join("."), mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("rejects a token with non-base64url characters in signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);
    const parts = token.split(".");
    parts[2] = "!!!invalid***sig";
    const result = await verifyJwt(parts.join("."), mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// Invalid input guards
// ---------------------------------------------------------------------------

describe("verifyJwt — invalid inputs", () => {
  it("returns valid=false with reason='missing' for null token", async () => {
    const result = await verifyJwt(null, mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("returns valid=false with reason='missing' for undefined token", async () => {
    const result = await verifyJwt(undefined, mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("returns valid=false with reason='missing' for empty string", async () => {
    const result = await verifyJwt("", mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("returns valid=false for token with wrong segment count", async () => {
    const result = await verifyJwt("only.two", mockEnv);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("returns valid=false when JWT_SECRET_CURRENT is missing from env", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);
    const result = await verifyJwt(token, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid");
  });

  it("returns valid=false when env is null", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ exp: now + 300 }, mockEnv);
    const result = await verifyJwt(token, null);
    expect(result.valid).toBe(false);
  });
});

describe("signJwt — invalid input guards", () => {
  it("throws when JWT_SECRET_CURRENT is missing from env", async () => {
    await expect(signJwt({ sub: "x" }, {})).rejects.toThrow(/JWT_SECRET_CURRENT/);
  });

  it("throws when JWT_KID_CURRENT is missing from env", async () => {
    await expect(
      signJwt({ sub: "x" }, { JWT_SECRET_CURRENT: "some-secret" }),
    ).rejects.toThrow(/JWT_KID_CURRENT/);
  });

  it("throws when env is null", async () => {
    await expect(signJwt({ sub: "x" }, null)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// makeAccessToken
// ---------------------------------------------------------------------------

describe("makeAccessToken", () => {
  const mockUser = {
    id: mockClaims.sub,
    telegram_id: mockClaims.tg_id,
    role: "owner",
  };
  const mockTenant = {
    id: mockClaims.tenant_id,
    kind: "individual",
    name: "Test Tenant",
  };
  const mockTenants = [mockClaims.tenant_id];

  it("returns a valid JWT string", async () => {
    const token = await makeAccessToken(mockUser, mockTenant, mockTenants, mockEnv);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("sets exp 5 minutes (300s) from now", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await makeAccessToken(mockUser, mockTenant, mockTenants, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    const { exp } = result.payload;
    // Allow 2s clock skew
    expect(exp).toBeGreaterThanOrEqual(before + 298);
    expect(exp).toBeLessThanOrEqual(before + 302);
  });

  it("includes sub, tenant_id, tenants, role, tg_id in payload", async () => {
    const token = await makeAccessToken(mockUser, mockTenant, mockTenants, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe(mockUser.id);
    expect(result.payload.tenant_id).toBe(mockTenant.id);
    expect(result.payload.tenants).toEqual(mockTenants);
    expect(result.payload.role).toBe("owner");
    expect(result.payload.tg_id).toBe(mockUser.telegram_id);
  });

  it("defaults role to 'member' when user.role is undefined", async () => {
    const userNoRole = { id: mockUser.id, telegram_id: mockUser.telegram_id };
    const token = await makeAccessToken(userNoRole, mockTenant, mockTenants, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.role).toBe("member");
  });
});

// ---------------------------------------------------------------------------
// makeRefreshToken
// ---------------------------------------------------------------------------

describe("makeRefreshToken", () => {
  it("returns a valid JWT string", async () => {
    const token = await makeRefreshToken(mockClaims.sub, mockEnv);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("sets exp 7 days (604800s) from now", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await makeRefreshToken(mockClaims.sub, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    const { exp } = result.payload;
    // Allow 2s clock skew
    expect(exp).toBeGreaterThanOrEqual(before + 604798);
    expect(exp).toBeLessThanOrEqual(before + 604802);
  });

  it("includes sub and type='refresh' in payload", async () => {
    const token = await makeRefreshToken(mockClaims.sub, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.sub).toBe(mockClaims.sub);
    expect(result.payload.type).toBe("refresh");
  });

  it("does not include tenant_id or role (minimal claims)", async () => {
    const token = await makeRefreshToken(mockClaims.sub, mockEnv);
    const result = await verifyJwt(token, mockEnv);
    expect(result.valid).toBe(true);
    expect(result.payload.tenant_id).toBeUndefined();
    expect(result.payload.role).toBeUndefined();
  });
});
