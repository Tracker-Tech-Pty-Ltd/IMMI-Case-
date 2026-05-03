/**
 * auth-telegram.test.js
 *
 * Vitest tests for workers/auth/telegram.js — HMAC-SHA256 hash verification,
 * replay-protection (auth_date window), field-sort correctness, and
 * constant-time comparison via XOR.
 *
 * Test environment: Node (vitest.config.js `environment: "node"`).
 * Web Crypto is available natively in Node 18+.
 */

import { describe, it, expect } from "vitest";
import { verifyTelegramAuth } from "../auth/telegram.js";

// ---------------------------------------------------------------------------
// Test helper — compute the correct Telegram hash
// ---------------------------------------------------------------------------

/**
 * Compute the expected Telegram HMAC-SHA256 hash for a given data object
 * and bot token. Mirrors the algorithm in telegram.js exactly.
 *
 * Algorithm:
 *   secret_key = SHA-256(raw bot_token bytes)
 *   check_string = sorted key=value pairs (excluding hash) joined by \n
 *   expected_hash = hex(HMAC-SHA256(check_string, secret_key))
 *
 * @param {Record<string, string>} data   fields including placeholder hash
 * @param {string} botToken
 * @returns {Promise<string>} hex-encoded HMAC
 */
async function computeTestHash(data, botToken) {
  const enc = new TextEncoder();

  const secretKey = await crypto.subtle.digest("SHA-256", enc.encode(botToken));

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const { hash: _hash, ...fields } = data;
  const checkStr = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const sig = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(checkStr));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOT_TOKEN = "1234567890:ABCDefGhIJKlmnOPqrSTUvwXYZ_test_token";
const MOCK_ENV = { TELEGRAM_BOT_TOKEN: BOT_TOKEN };

/** Build fresh auth data with a valid recent auth_date. */
function freshAuthData(overrides = {}) {
  return {
    id: "987654321",
    first_name: "Jane",
    last_name: "Smith",
    username: "janesmith",
    photo_url: "https://t.me/i/userpic/320/janesmith.jpg",
    auth_date: String(Math.floor(Date.now() / 1000) - 60), // 1 minute ago
    hash: "placeholder",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — valid data", () => {
  it("accepts valid recent Telegram auth data", async () => {
    const data = freshAuthData();
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts auth data without optional fields (username, photo_url, last_name)", async () => {
    const data = {
      id: "111222333",
      first_name: "Bob",
      auth_date: String(Math.floor(Date.now() / 1000) - 30),
      hash: "placeholder",
    };
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(true);
  });

  it("accepts auth data at the boundary: 3599s ago", async () => {
    const data = freshAuthData({
      auth_date: String(Math.floor(Date.now() / 1000) - 3599),
    });
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Expired auth_date (> 3600s)
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — expired auth_date", () => {
  it("rejects auth_date older than 3600 seconds", async () => {
    const data = freshAuthData({
      auth_date: String(Math.floor(Date.now() / 1000) - 3601),
    });
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects auth_date of '0' (sentinel for missing)", async () => {
    const data = freshAuthData({ auth_date: "0" });
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects when auth_date field is absent from data", async () => {
    const data = freshAuthData();
    delete data.auth_date;
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });
});

// ---------------------------------------------------------------------------
// Tampered hash
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — tampered hash", () => {
  it("rejects a hash with one hex digit changed", async () => {
    const data = freshAuthData();
    const correctHash = await computeTestHash(data, BOT_TOKEN);
    const flipped = (parseInt(correctHash[0], 16) ^ 0xf).toString(16);
    data.hash = flipped + correctHash.slice(1);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });

  it("rejects a completely fabricated hash", async () => {
    const data = freshAuthData({
      hash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });

  it("rejects when hash has wrong length", async () => {
    const data = freshAuthData({ hash: "abc123" }); // too short

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });

  it("rejects when a payload field is modified after hashing (field tampering)", async () => {
    const data = freshAuthData();
    data.hash = await computeTestHash(data, BOT_TOKEN);
    data.first_name = "Hacker"; // mutate after signing

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });

  it("rejects a hash signed with a different bot token", async () => {
    const data = freshAuthData();
    data.hash = await computeTestHash(data, "999999999:wrong_bot_token_xxxxxx");

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });
});

// ---------------------------------------------------------------------------
// Missing hash field
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — missing hash field", () => {
  it("returns valid=false with reason='missing_hash' when hash is absent", async () => {
    const data = freshAuthData();
    delete data.hash;

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_hash");
  });

  it("returns valid=false with reason='missing_hash' when hash is empty string", async () => {
    const data = freshAuthData({ hash: "" });

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_hash");
  });

  it("returns valid=false with reason='missing_hash' when data is null", async () => {
    const result = await verifyTelegramAuth(null, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_hash");
  });
});

// ---------------------------------------------------------------------------
// Missing TELEGRAM_BOT_TOKEN in env
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — missing TELEGRAM_BOT_TOKEN", () => {
  it("returns valid=false when TELEGRAM_BOT_TOKEN is absent from env", async () => {
    const data = freshAuthData();
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });
});

// ---------------------------------------------------------------------------
// Correct alphabetical sort of fields for check string
// ---------------------------------------------------------------------------

describe("verifyTelegramAuth — field sort for check string", () => {
  it("correctly sorts fields alphabetically to build the check string", async () => {
    // Provide fields in deliberately non-alphabetical order in the object
    const data = {
      username: "sortuser",
      photo_url: "https://t.me/photo.jpg",
      last_name: "Doe",
      id: "555666777",
      first_name: "Alice",
      auth_date: String(Math.floor(Date.now() / 1000) - 10),
      hash: "placeholder",
    };
    // computeTestHash sorts alphabetically: auth_date, first_name, id, last_name, photo_url, username
    data.hash = await computeTestHash(data, BOT_TOKEN);

    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(true);
  });

  it("rejects hash computed with wrong sort order (reverse vs alphabetical)", async () => {
    const data = freshAuthData();
    // Build a hash using REVERSE sort — wrong order
    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.digest("SHA-256", enc.encode(BOT_TOKEN));
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      secretKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const { hash: _, ...fields } = data;
    const keys = Object.keys(fields).sort().reverse(); // wrong: reversed
    const wrongCheckStr = keys.map((k) => `${k}=${fields[k]}`).join("\n");
    const sig = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(wrongCheckStr));
    data.hash = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // With >1 field whose sort differs from reverse-sort, this must be invalid.
    // freshAuthData has 6 fields: auth_date, first_name, id, last_name, photo_url, username
    // sorted !== reverse-sorted → hash mismatch → invalid
    const result = await verifyTelegramAuth(data, MOCK_ENV);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_hash");
  });
});
