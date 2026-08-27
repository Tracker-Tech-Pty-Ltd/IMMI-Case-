/**
 * auth.js — HMAC-signed session token mint for LLM Council sessions.
 *
 * Token shape:  base64url(HMAC-SHA256(importCouncilTokenKey(env.CSRF_SECRET), sessionId))
 *
 * AUTHORITY: this token is NOT an authentication credential. Access to every
 * Council route is gated by JWT + CloudflareIdentityStore.assertMembership()
 * (see workers/llm-council/cloudflare_handlers.js requireSessionAuth). The
 * token is an opaque per-session handle the SPA stores in localStorage and
 * echoes back as X-Session-Token; the Worker does not read it. Do not
 * reintroduce a verifier without first changing that documented auth model.
 *
 * NOTE: never log token values.
 */

// ---------------------------------------------------------------------------
// base64url encode (Worker-safe; mirrors proxy.js helpers)
// ---------------------------------------------------------------------------

/**
 * Encode a Uint8Array / ArrayBuffer to base64url (no padding).
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...u8))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// HMAC key import (lazy; one per call — Workers prohibit cross-request keys)
// ---------------------------------------------------------------------------

// Purpose separation: the Council session token and the double-submit CSRF
// token both derive from CSRF_SECRET, but must never share raw key material —
// otherwise a compromise or rotation of one protocol silently couples to the
// other. HMAC with a fixed label is a KDF here, not an authentication step.
const COUNCIL_TOKEN_LABEL = "immi-council-session-token/v1";

/**
 * Derive the Council-session signing key from the base secret.
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
async function importCouncilTokenKey(secret) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    base,
    new TextEncoder().encode(COUNCIL_TOKEN_LABEL),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// ---------------------------------------------------------------------------
// nanoid21 — 21-char URL-safe random ID
// ---------------------------------------------------------------------------

const NANOID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
// 64 chars → exactly 6 bits per output char → use mask 0b00111111 (63).
// Since 64 divides 256 evenly, every random byte yields a uniformly-distributed
// alphabet index when masked — no rejection sampling needed.
const NANOID_MASK = 63;
const NANOID_LENGTH = 21;

/**
 * Generate a 21-character URL-safe random identifier.
 *
 * Alphabet: [A-Za-z0-9_-] (64 chars). Cryptographically random via
 * `crypto.getRandomValues`. Equivalent in entropy to nanoid v3 default
 * (~126 bits over 21 chars).
 *
 * @returns {string}
 */
export function nanoid21() {
  const bytes = new Uint8Array(NANOID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < NANOID_LENGTH; i++) {
    id += NANOID_ALPHABET[bytes[i] & NANOID_MASK];
  }
  return id;
}

// ---------------------------------------------------------------------------
// mintToken
// ---------------------------------------------------------------------------

/**
 * Compute base64url(HMAC-SHA256(importCouncilTokenKey(env.CSRF_SECRET), sessionId)).
 *
 * @param {{CSRF_SECRET?: string}} env
 * @param {string} sessionId
 * @returns {Promise<string>}
 * @throws {Error} when env.CSRF_SECRET is missing or sessionId is empty.
 */
export async function mintToken(env, sessionId) {
  if (!env || !env.CSRF_SECRET) {
    throw new Error("CSRF_SECRET not configured");
  }
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId required");
  }
  const key = await importCouncilTokenKey(env.CSRF_SECRET);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sessionId),
  );
  return b64urlEncode(sig);
}
