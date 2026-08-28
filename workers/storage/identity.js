import {
  assertAuthContext,
  assertUuid,
  clampLimit,
  StorageBoundaryError,
  utcNow,
} from "./contracts.js";
import { changeCount, requireD1, rows } from "./cloudflare_shared.js";

function assertTelegramId(value) {
  const id = String(value ?? "");
  if (!/^[1-9][0-9]{0,19}$/.test(id)) {
    throw new StorageBoundaryError("Telegram user id is invalid", {
      code: "invalid_telegram_id",
      status: 400,
    });
  }
  return id;
}

function asJwtTelegramId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : String(value);
}

function refreshSessionError(message, code) {
  return new StorageBoundaryError(message, { code, status: 401 });
}

function refreshDraftValues(draft) {
  const jti = assertUuid(draft?.jti, "refresh.jti");
  const userId = assertUuid(draft?.userId, "refresh.userId");
  const familyId = assertUuid(draft?.familyId, "refresh.familyId");
  const expiresAt = new Date(draft?.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new StorageBoundaryError("Refresh session expiry is invalid", {
      code: "invalid_refresh_session",
      status: 400,
    });
  }
  return { jti, userId, familyId, expiresAt: expiresAt.toISOString() };
}

/** Parse the operator break-glass allowlist: comma/space separated user UUIDs. */
function parseOperatorAllowlist(value) {
  if (typeof value !== "string" || !value.trim()) return new Set();
  return new Set(
    value
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export class CloudflareIdentityStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
    // Break-glass operator grant. Operator-supplied Worker var, absent from
    // the checked-in wrangler.toml by design (same policy as the resource IDs
    // and JWT secrets). Unset => nobody is a platform operator.
    this.platformOperatorIds = parseOperatorAllowlist(env?.IMMI_PLATFORM_OPERATOR_IDS);
  }

  async assertMembership(auth) {
    const context = assertAuthContext(auth);
    const membership = await this.db.prepare(`
      SELECT role FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1
    `).bind(context.tenantId, context.userId).first();
    if (!membership) {
      throw new StorageBoundaryError("Tenant membership not found", {
        code: "tenant_membership_denied",
        status: 403,
      });
    }
    return { ...context, role: membership.role };
  }

  /**
   * Assert *platform* authority, which is deliberately NOT the tenant role.
   *
   * `memberships.role` is self-granted — upsertTelegramUser() inserts
   * role='owner' for the personal tenant it creates on first Telegram login —
   * so it can only ever authorize tenant-scoped resources. Global surfaces
   * (pipeline controls, platform admin reads, shared-catalog writes) must call
   * this instead.
   *
   * Two grant sources, both defaulting to "nobody":
   *   1. `users.platform_admin = 1` (migration 0002) — the durable grant.
   *   2. `IMMI_PLATFORM_OPERATOR_IDS` — an operator-supplied Worker var with a
   *      comma-separated list of user UUIDs. Break-glass, and the only way to
   *      grant the first operator before migration 0002 has been applied.
   *
   * Fails closed: any D1 error while reading the column (for example when
   * migration 0002 has not been applied yet) denies rather than throwing.
   */
  async assertPlatformOperator(auth) {
    const context = await this.assertMembership(auth);
    if (this.platformOperatorIds.has(context.userId)) {
      return { ...context, platformOperator: true, grant: "allowlist" };
    }
    let row = null;
    try {
      row = await this.db.prepare(`
        SELECT platform_admin FROM users WHERE user_id = ? LIMIT 1
      `).bind(context.userId).first();
    } catch (error) {
      console.error(JSON.stringify({
        event: "auth.platform_operator.lookup_failed",
        user_id: context.userId,
        error: error?.message,
      }));
      row = null;
    }
    if (Number(row?.platform_admin) === 1) {
      return { ...context, platformOperator: true, grant: "platform_admin" };
    }
    throw new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    });
  }

  /**
   * Atomically upsert the Telegram profile and create exactly one personal
   * tenant if this user has no active membership. D1 batch is transactional,
   * preventing two concurrent first logins from attaching two workspaces.
   */
  async upsertTelegramUser(tgData) {
    const telegramId = assertTelegramId(tgData?.id);
    const userId = crypto.randomUUID();
    const prospectiveTenantId = crypto.randomUUID();
    const now = utcNow();
    const firstName = typeof tgData?.first_name === "string" ? tgData.first_name : null;
    const lastName = typeof tgData?.last_name === "string" ? tgData.last_name : null;
    const username = typeof tgData?.username === "string" ? tgData.username : null;
    const photoUrl = typeof tgData?.photo_url === "string" ? tgData.photo_url : null;
    const tenantName = firstName || "My Workspace";

    await this.db.batch([
      this.db.prepare(`
        INSERT INTO users (
          user_id, telegram_id, first_name, last_name, username, photo_url,
          last_login_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          first_name=excluded.first_name, last_name=excluded.last_name,
          username=excluded.username, photo_url=excluded.photo_url,
          last_login_at=excluded.last_login_at, updated_at=excluded.updated_at
      `).bind(userId, telegramId, firstName, lastName, username, photoUrl, now, now, now),
      this.db.prepare(`
        INSERT INTO tenants (tenant_id, kind, name, created_at, updated_at)
        SELECT ?, 'individual', ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM memberships m
          JOIN users u ON u.user_id = m.user_id
          WHERE u.telegram_id = ? AND m.revoked_at IS NULL
        )
      `).bind(prospectiveTenantId, tenantName, now, now, telegramId),
      this.db.prepare(`
        INSERT OR IGNORE INTO memberships (tenant_id, user_id, role, created_at)
        SELECT ?, u.user_id, 'owner', ?
        FROM users u
        WHERE u.telegram_id = ?
          AND EXISTS (SELECT 1 FROM tenants WHERE tenant_id = ?)
      `).bind(prospectiveTenantId, now, telegramId, prospectiveTenantId),
    ]);

    const user = await this.db.prepare(`
      SELECT user_id, telegram_id FROM users WHERE telegram_id = ? LIMIT 1
    `).bind(telegramId).first();
    if (!user) {
      throw new StorageBoundaryError("Telegram user upsert did not return a user", {
        code: "identity_write_failed",
        status: 503,
      });
    }
    return this.getAuthSnapshot(user.user_id);
  }

  /** Return a current, tenant-scoped token profile; never rely on stale JWT membership. */
  async getAuthSnapshot(userId, activeTenantId = null) {
    const checkedUserId = assertUuid(userId, "user_id");
    const checkedTenantId = activeTenantId === null ? null : assertUuid(activeTenantId, "tenant_id");
    const user = await this.db.prepare(`
      SELECT user_id, telegram_id FROM users WHERE user_id = ? LIMIT 1
    `).bind(checkedUserId).first();
    if (!user) throw refreshSessionError("User not found", "user_not_found");
    const memberships = rows(await this.db.prepare(`
      SELECT t.tenant_id, t.kind, t.name, m.role
      FROM memberships m
      JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.revoked_at IS NULL
      ORDER BY m.created_at ASC, t.tenant_id ASC
    `).bind(checkedUserId).all());
    if (memberships.length === 0) {
      throw refreshSessionError("Tenant membership not found", "tenant_membership_denied");
    }
    const selected = checkedTenantId
      ? memberships.find((membership) => membership.tenant_id === checkedTenantId)
      : memberships[0];
    if (!selected) {
      throw new StorageBoundaryError("Not a member of that tenant", {
        code: "forbidden",
        status: 403,
      });
    }
    return {
      user: {
        id: user.user_id,
        telegram_id: asJwtTelegramId(user.telegram_id),
        role: selected.role || "member",
      },
      tenant: { id: selected.tenant_id, kind: selected.kind, name: selected.name },
      tenants: memberships.map((membership) => membership.tenant_id),
    };
  }

  async createRefreshSession(draft, previousRefreshClaims = null, previousRefreshReason = "login_replaced") {
    const next = refreshDraftValues(draft);
    const now = utcNow();
    const statements = [this.db.prepare(`
      INSERT INTO immi_refresh_sessions (
        jti, user_id, family_id, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(next.jti, next.userId, next.familyId, next.expiresAt, now)];
    if (previousRefreshClaims?.jti && previousRefreshClaims?.userId === next.userId) {
      statements.push(this.db.prepare(`
        UPDATE immi_refresh_sessions
        SET revoked_at = COALESCE(revoked_at, ?),
            revoked_reason = COALESCE(revoked_reason, ?),
            replaced_by_jti = COALESCE(replaced_by_jti, ?),
            last_used_at = COALESCE(last_used_at, ?)
        WHERE jti = ? AND user_id = ?
      `).bind(
        now, previousRefreshReason, next.jti, now,
        assertUuid(previousRefreshClaims.jti, "refresh.jti"), next.userId,
      ));
    }
    const result = await this.db.batch(statements);
    if (changeCount(result[0]) !== 1) {
      throw new StorageBoundaryError("Unable to create refresh session", {
        code: "identity_write_failed",
        status: 503,
      });
    }
  }

  async revokeRefreshSession({ jti, userId, reason, replacedByJti = null }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const checkedReplacement = replacedByJti === null ? null : assertUuid(replacedByJti, "refresh.replacedByJti");
    const now = utcNow();
    await this.db.prepare(`
      UPDATE immi_refresh_sessions
      SET revoked_at = COALESCE(revoked_at, ?),
          revoked_reason = COALESCE(revoked_reason, ?),
          replaced_by_jti = COALESCE(replaced_by_jti, ?),
          last_used_at = COALESCE(last_used_at, ?)
      WHERE jti = ? AND user_id = ?
    `).bind(now, reason, checkedReplacement, now, checkedJti, checkedUserId).run();
  }

  /**
   * Revoke every live session in a refresh-token family.
   *
   * COALESCE keeps the original revocation metadata on rows that were already
   * rotated, so this is idempotent and does not rewrite history.
   */
  async revokeRefreshFamily({ familyId, userId, reason = "reuse_detected" }) {
    const checkedFamilyId = assertUuid(familyId, "refresh.familyId");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const now = utcNow();
    const result = await this.db.prepare(`
      UPDATE immi_refresh_sessions
      SET revoked_at = COALESCE(revoked_at, ?),
          revoked_reason = COALESCE(revoked_reason, ?),
          last_used_at = COALESCE(last_used_at, ?)
      WHERE family_id = ? AND user_id = ?
    `).bind(now, reason, now, checkedFamilyId, checkedUserId).run();
    return changeCount(result);
  }

  async loadRefreshAuthSnapshot({ jti, userId }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const session = await this.db.prepare(`
      SELECT jti, user_id, family_id, expires_at, revoked_at, revoked_reason
      FROM immi_refresh_sessions WHERE jti = ? AND user_id = ? LIMIT 1
    `).bind(checkedJti, checkedUserId).first();
    if (!session) throw refreshSessionError("Refresh session not found", "refresh_session_not_found");
    if (session.revoked_at) {
      // Primary reuse-detection point: handleAuthRefresh calls this BEFORE
      // rotateRefreshSession, so an already-rotated token lands here, not in
      // the CAS backstop. A stolen refresh cookie redeemed after the victim's
      // next refresh must kill the whole lineage, not just the presented jti.
      //
      // No time-based exemption, deliberately. A grace window would let an
      // attacker who rotated first keep a live successor family whenever the
      // victim's replay happens to land inside it, and a background tab's
      // proactive-refresh timer lands inside any window worth having. Benign
      // simultaneity is handled by the CAS branch in rotateRefreshSession,
      // where the loser never held a revoked token.
      await this.revokeRefreshFamily({
        familyId: session.family_id,
        userId: checkedUserId,
        reason: "reuse_detected",
      });
      console.log(JSON.stringify({
        event: "auth.refresh.reuse_detected",
        user_id: checkedUserId,
        family_id: session.family_id,
        revoked_reason: session.revoked_reason || null,
      }));
      throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    }
    const expiresAt = new Date(session.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await this.revokeRefreshSession({ jti: checkedJti, userId: checkedUserId, reason: "expired" });
      throw refreshSessionError("Refresh token expired", "expired_refresh_token");
    }
    const snapshot = await this.getAuthSnapshot(checkedUserId);
    return { session, ...snapshot };
  }

  /**
   * Conditional insert is the compare-and-swap: only the one request that
   * still sees the old active jti creates a successor. A replay never gets a
   * usable replacement session.
   */
  async rotateRefreshSession(previousClaims, draft) {
    const previousJti = assertUuid(previousClaims?.jti, "refresh.jti");
    const previousUserId = assertUuid(previousClaims?.userId, "refresh.userId");
    const next = refreshDraftValues(draft);
    if (next.userId !== previousUserId) {
      throw refreshSessionError("Refresh token user mismatch", "invalid_refresh_token");
    }
    const now = utcNow();
    const result = await this.db.batch([
      this.db.prepare(`
        INSERT INTO immi_refresh_sessions (jti, user_id, family_id, expires_at, created_at)
        SELECT ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM immi_refresh_sessions
          WHERE jti = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
        )
      `).bind(next.jti, next.userId, next.familyId, next.expiresAt, now, previousJti, previousUserId, now),
      this.db.prepare(`
        UPDATE immi_refresh_sessions
        SET revoked_at = ?, revoked_reason = 'rotated', replaced_by_jti = ?, last_used_at = ?
        WHERE jti = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
      `).bind(now, next.jti, now, previousJti, previousUserId, now),
    ]);
    if (changeCount(result[0]) !== 1 || changeCount(result[1]) !== 1) {
      throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    }
  }

  async listCouncilSessions(auth, { limit, before = null } = {}) {
    const context = await this.assertMembership(auth);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    const beforeClause = before ? "AND updated_at < ?" : "";
    const params = before ? [context.tenantId, before, size] : [context.tenantId, size];
    return rows(await this.db.prepare(`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      WHERE tenant_id = ? AND deleted_at IS NULL ${beforeClause}
      ORDER BY updated_at DESC, session_id DESC
      LIMIT ?
    `).bind(...params).all());
  }
}
