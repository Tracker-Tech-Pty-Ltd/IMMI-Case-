/**
 * jwt.js — HS256 JWT implementation using Web Crypto API.
 *
 * No npm packages — Web Crypto only (Workers-compatible).
 *
 * Key rotation: signJwt uses JWT_SECRET_CURRENT; verifyJwt tries
 * JWT_SECRET_CURRENT first then JWT_SECRET_PREVIOUS (zero-downtime rotation).
 *
 * Constant-time comparison: signature bytes are compared via
 * crypto.subtle.verify("HMAC", ...) — constant-time by Web Crypto spec.
 * We never use === on token bytes.
 *
 * NOTE: never log full token values. Use token.slice(0,8)+"…" for breadcrumbs.
 */

// ---------------------------------------------------------------------------
// base64url helpers (mirrors llm-council/auth.js pattern)
// ---------------------------------------------------------------------------

/**
 * Encode ArrayBuffer | Uint8Array to base64url (no padding).
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode base64url string to Uint8Array. Throws on malformed input.
 * Callers MUST wrap in try/catch when handling untrusted tokens.
 * @param {string} s
 * @returns {Uint8Array}
 */
function b64urlDecode(s) {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str); // throws on invalid characters
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// HMAC key import
// ---------------------------------------------------------------------------

/**
 * Import a secret string as a raw HMAC-SHA256 CryptoKey.
 * Workers prohibit cross-request key reuse — always create per-request.
 * @param {string} secret
 * @param {string[]} usages  e.g. ['sign'] or ['sign', 'verify']
 * @returns {Promise<CryptoKey>}
 */
async function importHmacKey(secret, usages = ["sign", "verify"]) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

// ---------------------------------------------------------------------------
// Low-level JWT builder
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

/**
 * Build and sign a JWT with HS256.
 * @param {object} header  e.g. {alg:'HS256', typ:'JWT', kid:'v1'}
 * @param {object} payload
 * @param {string} secret
 * @returns {Promise<string>}
 */
async function buildJwt(header, payload, secret) {
  const headerB64 = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importHmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Sign a JWT payload with the current secret and kid.
 * Automatically injects iat. Caller must set exp.
 *
 * @param {object} payload
 * @param {{JWT_SECRET_CURRENT: string, JWT_KID_CURRENT: string}} env
 * @returns {Promise<string>}
 */
export async function signJwt(payload, env) {
  if (!env?.JWT_SECRET_CURRENT) throw new Error("JWT_SECRET_CURRENT not configured");
  if (!env?.JWT_KID_CURRENT) throw new Error("JWT_KID_CURRENT not configured");

  const header = { alg: "HS256", typ: "JWT", kid: env.JWT_KID_CURRENT };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { iat: now, ...payload };
  return buildJwt(header, fullPayload, env.JWT_SECRET_CURRENT);
}

/**
 * Verify a JWT. Tries JWT_SECRET_CURRENT first, then JWT_SECRET_PREVIOUS.
 * Uses crypto.subtle.verify for constant-time HMAC comparison.
 *
 * @param {string} token
 * @param {{JWT_SECRET_CURRENT: string, JWT_SECRET_PREVIOUS?: string}} env
 * @returns {Promise<{valid: boolean, payload: object|null, reason: 'expired'|'invalid'|'missing'|''}>}
 */
export async function verifyJwt(token, env) {
  if (!token || typeof token !== "string") {
    return { valid: false, payload: null, reason: "missing" };
  }
  if (!env?.JWT_SECRET_CURRENT) {
    return { valid: false, payload: null, reason: "invalid" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, payload: null, reason: "invalid" };
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  // Decode signature bytes — bail on malformed base64url
  let sigBytes;
  try {
    sigBytes = b64urlDecode(sigB64);
  } catch {
    return { valid: false, payload: null, reason: "invalid" };
  }

  // HMAC-SHA256 is always 32 bytes; length is not secret
  if (sigBytes.byteLength !== 32) {
    return { valid: false, payload: null, reason: "invalid" };
  }

  // Try secrets in rotation order: current → previous
  const secrets = [env.JWT_SECRET_CURRENT];
  if (env.JWT_SECRET_PREVIOUS) secrets.push(env.JWT_SECRET_PREVIOUS);

  let signatureValid = false;
  for (const secret of secrets) {
    try {
      const key = await importHmacKey(secret, ["verify"]);
      const ok = await crypto.subtle.verify(
        "HMAC",
        key,
        sigBytes,
        enc.encode(signingInput),
      );
      if (ok) { signatureValid = true; break; }
    } catch {
      // malformed secret — try next
    }
  }

  if (!signatureValid) {
    return { valid: false, payload: null, reason: "invalid" };
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { valid: false, payload: null, reason: "invalid" };
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    return { valid: false, payload: null, reason: "expired" };
  }

  return { valid: true, payload, reason: "" };
}

/**
 * Issue a 5-minute access token.
 *
 * JWT claims: { sub, kid, tenant_id, tenants, role, tg_id, exp, iat }
 *
 * @param {{id: string, telegram_id: number, role?: string}} user
 * @param {{id: string, kind: string, name: string}} tenant  primary tenant
 * @param {string[]} tenants  all tenant UUIDs this user belongs to
 * @param {object} env
 * @returns {Promise<string>}
 */
export async function makeAccessToken(user, tenant, tenants, env) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: user.id,
      tenant_id: tenant.id,
      tenant_kind: tenant.kind,
      tenant_name: tenant.name,
      tenants,
      role: user.role ?? "member",
      tg_id: user.telegram_id,
      exp: now + 300, // 5 minutes
    },
    env,
  );
}

/**
 * Issue a 7-day refresh token with minimal claims.
 *
 * JWT claims: { sub, kid, type:'refresh', exp, iat }
 *
 * @param {string} userId
 * @param {object} env
 * @returns {Promise<string>}
 */
export async function makeRefreshToken(userId, env) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: userId,
      type: "refresh",
      exp: now + 604800, // 7 days
    },
    env,
  );
}
