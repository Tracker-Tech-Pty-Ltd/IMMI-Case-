/**
 * auth-utils.test.ts
 *
 * Vitest tests for frontend/src/lib/auth.ts — JWT payload parsing,
 * expiry detection (with 30s buffer), and cookie extraction.
 *
 * Test environment: jsdom (frontend/vitest.config.ts `environment: "jsdom"`).
 * No real JWTs needed — we construct synthetic base64url-encoded payloads.
 * Signature segments are dummies; parseJwtPayload / isTokenExpired never verify them.
 */

import { describe, it, expect } from "vitest";
import { parseJwtPayload, isTokenExpired } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Helpers — build synthetic JWTs without real HMAC signing
// ---------------------------------------------------------------------------

/** Encode a JS object as a base64url string (no padding). */
function encodeB64url(obj: object): string {
  const json = JSON.stringify(obj);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Build a synthetic JWT: <header>.<payload>.<fakesig> */
function makeToken(payload: object): string {
  const header = encodeB64url({ alg: "HS256", typ: "JWT" });
  const pay = encodeB64url(payload);
  return `${header}.${pay}.fakesignature`;
}

// ---------------------------------------------------------------------------
// parseJwtPayload
// ---------------------------------------------------------------------------

describe("parseJwtPayload", () => {
  it("decodes a valid JWT payload object", () => {
    const token = makeToken({ sub: "user-123", role: "owner", exp: 9999999999 });
    const payload = parseJwtPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.role).toBe("owner");
    expect(payload!.exp).toBe(9999999999);
  });

  it("returns null for a token with only one segment (no dots)", () => {
    expect(parseJwtPayload("notavalidtoken")).toBeNull();
  });

  it("returns null for a token with only two segments", () => {
    expect(parseJwtPayload("header.payload")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJwtPayload("")).toBeNull();
  });

  it("returns null when the payload segment is not valid base64", () => {
    expect(parseJwtPayload("header.!!!invalid!!!.sig")).toBeNull();
  });

  it("returns null when the payload segment decodes to non-JSON", () => {
    const notJson = btoa("this is not json")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(parseJwtPayload(`header.${notJson}.sig`)).toBeNull();
  });

  it("handles numeric, array, and boolean payload fields", () => {
    const token = makeToken({
      sub: "u1",
      tenants: ["t1", "t2"],
      tg_id: 123456789,
      active: true,
    });
    const payload = parseJwtPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.tenants).toEqual(["t1", "t2"]);
    expect(payload!.tg_id).toBe(123456789);
    expect(payload!.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe("isTokenExpired", () => {
  it("returns true for a token whose exp is in the past", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    const token = makeToken({ sub: "u1", exp: pastExp });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns false for a token expiring well in the future (beyond 30s buffer)", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 600;
    const token = makeToken({ sub: "u1", exp: futureExp });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("returns true for a token expiring within the 30s buffer (20s from now)", () => {
    const nearExp = Math.floor(Date.now() / 1000) + 20;
    const token = makeToken({ sub: "u1", exp: nearExp });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns false for a token expiring exactly 31s from now (just outside buffer)", () => {
    const justOutside = Math.floor(Date.now() / 1000) + 31;
    const token = makeToken({ sub: "u1", exp: justOutside });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("returns true when exp field is missing from payload", () => {
    const token = makeToken({ sub: "u1" });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true when exp is not a number (string value)", () => {
    const token = makeToken({ sub: "u1", exp: "not-a-number" });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true for a malformed token (only three segments, invalid payload)", () => {
    expect(isTokenExpired("not.a.jwt")).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isTokenExpired("")).toBe(true);
  });
});

