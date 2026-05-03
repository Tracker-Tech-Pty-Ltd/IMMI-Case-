/**
 * telegram.js — Telegram Login Widget hash verification.
 *
 * Algorithm (per Telegram docs):
 *   secret_key = SHA-256(bot_token) as raw bytes
 *   data_check_string = sorted key=value pairs (excl. hash) joined by \n
 *   expected_hash = hex(HMAC-SHA256(data_check_string, secret_key))
 *
 * Replay protection:
 *   auth_date must be within 3600 seconds of now.
 *
 * Constant-time comparison:
 *   We XOR all bytes and check diff===0 rather than early-exit ===.
 *
 * No npm packages — Web Crypto only.
 */

const enc = new TextEncoder();

/**
 * Verify Telegram Login Widget auth data.
 *
 * @param {Record<string, string>} data  raw fields from Telegram widget
 *   Expected fields: id, first_name, last_name?, username?, photo_url?,
 *                    auth_date (Unix timestamp string), hash (hex string)
 * @param {{TELEGRAM_BOT_TOKEN: string}} env
 * @returns {Promise<{valid: boolean, reason?: 'missing_hash'|'expired'|'invalid_hash'}>}
 */
export async function verifyTelegramAuth(data, env) {
  if (!data?.hash) {
    return { valid: false, reason: "missing_hash" };
  }

  if (!env?.TELEGRAM_BOT_TOKEN) {
    console.error(JSON.stringify({ event: "auth.fail.config", reason: "TELEGRAM_BOT_TOKEN missing" }));
    return { valid: false, reason: "invalid_hash" };
  }

  // Reject stale auth_date (older than 1 hour)
  const authDate = parseInt(data.auth_date ?? "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > 3600) {
    return { valid: false, reason: "expired" };
  }

  // secret_key = SHA-256(raw bot token bytes)
  const secretKeyBuf = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(env.TELEGRAM_BOT_TOKEN),
  );

  // Import secret_key as HMAC-SHA256 signing key
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // Build data-check-string: exclude hash, sort remaining keys alphabetically
  const { hash, ...fields } = data;
  const checkStr = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  // Compute HMAC and hex-encode
  const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(checkStr));
  const hexSig = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison — XOR all bytes, never short-circuit
  if (hexSig.length !== hash.length) {
    return { valid: false, reason: "invalid_hash" };
  }
  const aBytes = enc.encode(hexSig);
  const bBytes = enc.encode(hash);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];

  return diff === 0
    ? { valid: true }
    : { valid: false, reason: "invalid_hash" };
}
