/**
 * refresh_sessions.js - server-side state for refresh-token rotation.
 *
 * Refresh JWTs are bearer secrets. The JWT signature proves who minted a token;
 * this table-backed session state decides whether that specific jti is still
 * active. Access tokens remain stateless and short-lived.
 */

export const REFRESH_SESSION_TTL_SECONDS = 604800; // 7 days

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RefreshSessionError extends Error {
  constructor(message, status = 401, code = "invalid_refresh_token") {
    super(message);
    this.name = "RefreshSessionError";
    this.status = status;
    this.code = code;
  }
}

export function isRefreshSessionError(err) {
  return err instanceof RefreshSessionError;
}

export function generateRefreshSessionDraft(userId, familyId = null) {
  return {
    jti: crypto.randomUUID(),
    userId,
    familyId: familyId ?? crypto.randomUUID(),
    expiresAt: new Date(Date.now() + REFRESH_SESSION_TTL_SECONDS * 1000),
  };
}

export function extractRefreshToken(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)immi_refresh=([^;]+)/);
  return match ? match[1] : null;
}

export function validateRefreshPayload(payload) {
  if (!payload || payload.type !== "refresh") {
    throw new RefreshSessionError("Invalid or expired refresh token", 401, "invalid_refresh_token");
  }
  if (!payload.sub || typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) {
    throw new RefreshSessionError("Malformed refresh token", 401, "invalid_refresh_token");
  }
  if (!payload.jti || typeof payload.jti !== "string" || !UUID_RE.test(payload.jti)) {
    throw new RefreshSessionError("Malformed refresh token", 401, "invalid_refresh_token");
  }
  return { userId: payload.sub, jti: payload.jti };
}

export async function insertRefreshSessionTx(tx, draft) {
  await tx`
    INSERT INTO immi_refresh_sessions (jti, user_id, family_id, expires_at)
    VALUES (${draft.jti}::uuid, ${draft.userId}::uuid, ${draft.familyId}::uuid, ${draft.expiresAt})
  `;
}

export async function revokeRefreshSessionTx(
  tx,
  { jti, userId, reason, replacedByJti = null },
) {
  await tx`
    UPDATE immi_refresh_sessions
    SET revoked_at = COALESCE(revoked_at, NOW()),
        revoked_reason = COALESCE(revoked_reason, ${reason}),
        replaced_by_jti = COALESCE(replaced_by_jti, ${replacedByJti}::uuid),
        last_used_at = COALESCE(last_used_at, NOW())
    WHERE jti = ${jti}::uuid
      AND user_id = ${userId}::uuid
  `;
}

export async function loadActiveRefreshSessionForUpdateTx(tx, { jti, userId }) {
  const [session] = await tx`
    SELECT jti, user_id, family_id, expires_at, revoked_at
    FROM immi_refresh_sessions
    WHERE jti = ${jti}::uuid
      AND user_id = ${userId}::uuid
    FOR UPDATE
  `;

  if (!session) {
    throw new RefreshSessionError("Refresh session not found", 401, "refresh_session_not_found");
  }
  if (session.revoked_at) {
    throw new RefreshSessionError("Refresh token has been revoked", 401, "revoked_refresh_token");
  }

  const expiresAtMs = new Date(session.expires_at).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await revokeRefreshSessionTx(tx, {
      jti,
      userId,
      reason: "expired",
    });
    throw new RefreshSessionError("Refresh token expired", 401, "expired_refresh_token");
  }

  return session;
}
