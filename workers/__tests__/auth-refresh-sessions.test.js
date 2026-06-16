/**
 * Unit tests for table-backed refresh-token session helpers.
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractRefreshToken,
  generateRefreshSessionDraft,
  insertRefreshSessionTx,
  loadActiveRefreshSessionForUpdateTx,
  RefreshSessionError,
  REFRESH_SESSION_TTL_SECONDS,
  revokeRefreshSessionTx,
  validateRefreshPayload,
} from "../auth/refresh_sessions.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const JTI = "770e8400-e29b-41d4-a716-446655440003";
const FAMILY_ID = "880e8400-e29b-41d4-a716-446655440004";

function makeRequest(cookie) {
  return new Request("https://example.test/api/v1/auth/refresh", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function makeTx(...rowsPerCall) {
  const tx = vi.fn();
  for (const rows of rowsPerCall) tx.mockResolvedValueOnce(rows);
  return tx;
}

function sqlOf(callArgs) {
  return callArgs[0].join("?").trim();
}

describe("refresh session helpers", () => {
  it("extracts the immi_refresh cookie without requiring it to be first", () => {
    const token = extractRefreshToken(makeRequest("a=1; immi_refresh=jwt.value; b=2"));
    expect(token).toBe("jwt.value");
  });

  it("returns null when the refresh cookie is absent", () => {
    expect(extractRefreshToken(makeRequest("a=1"))).toBeNull();
  });

  it("validates refresh claims and returns userId + jti", () => {
    expect(validateRefreshPayload({ type: "refresh", sub: USER_ID, jti: JTI })).toEqual({
      userId: USER_ID,
      jti: JTI,
    });
  });

  it("rejects refresh claims without jti", () => {
    expect(() => validateRefreshPayload({ type: "refresh", sub: USER_ID })).toThrow(
      RefreshSessionError,
    );
  });

  it("generates a UUID jti, UUID family_id, and 7-day expiry", () => {
    const before = Date.now();
    const draft = generateRefreshSessionDraft(USER_ID);
    expect(draft.userId).toBe(USER_ID);
    expect(draft.jti).toMatch(/^[0-9a-f-]{36}$/i);
    expect(draft.familyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(draft.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + REFRESH_SESSION_TTL_SECONDS * 1000 - 10,
    );
  });
});

describe("refresh session SQL helpers", () => {
  it("inserts refresh sessions into immi_refresh_sessions", async () => {
    const tx = makeTx([]);
    await insertRefreshSessionTx(tx, {
      jti: JTI,
      userId: USER_ID,
      familyId: FAMILY_ID,
      expiresAt: new Date("2026-06-18T00:00:00Z"),
    });

    const sql = sqlOf(tx.mock.calls[0]);
    expect(sql).toContain("INSERT INTO immi_refresh_sessions");
    expect(sql).toContain("jti, user_id, family_id, expires_at");
    expect(tx.mock.calls[0].slice(1)).toEqual([
      JTI,
      USER_ID,
      FAMILY_ID,
      new Date("2026-06-18T00:00:00Z"),
    ]);
  });

  it("revokes a specific refresh jti for a specific user", async () => {
    const tx = makeTx([]);
    await revokeRefreshSessionTx(tx, {
      jti: JTI,
      userId: USER_ID,
      reason: "logout",
    });

    const sql = sqlOf(tx.mock.calls[0]);
    expect(sql).toContain("UPDATE immi_refresh_sessions");
    expect(sql).toContain("revoked_at");
    expect(sql).toContain("WHERE jti =");
    expect(sql).toContain("AND user_id =");
    expect(tx.mock.calls[0].slice(1)).toContain("logout");
  });

  it("loads an active session with FOR UPDATE", async () => {
    const future = new Date(Date.now() + 60_000);
    const tx = makeTx([
      { jti: JTI, user_id: USER_ID, family_id: FAMILY_ID, expires_at: future, revoked_at: null },
    ]);

    const session = await loadActiveRefreshSessionForUpdateTx(tx, { jti: JTI, userId: USER_ID });
    expect(session.family_id).toBe(FAMILY_ID);
    expect(sqlOf(tx.mock.calls[0])).toContain("FOR UPDATE");
  });

  it("rejects revoked sessions", async () => {
    const future = new Date(Date.now() + 60_000);
    const tx = makeTx([
      { jti: JTI, user_id: USER_ID, family_id: FAMILY_ID, expires_at: future, revoked_at: future },
    ]);

    await expect(
      loadActiveRefreshSessionForUpdateTx(tx, { jti: JTI, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "revoked_refresh_token" });
  });

  it("marks expired sessions revoked before rejecting them", async () => {
    const past = new Date(Date.now() - 60_000);
    const tx = makeTx([
      { jti: JTI, user_id: USER_ID, family_id: FAMILY_ID, expires_at: past, revoked_at: null },
    ]);

    await expect(
      loadActiveRefreshSessionForUpdateTx(tx, { jti: JTI, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "expired_refresh_token" });
    expect(tx).toHaveBeenCalledTimes(2);
    expect(sqlOf(tx.mock.calls[1])).toContain("UPDATE immi_refresh_sessions");
  });
});
