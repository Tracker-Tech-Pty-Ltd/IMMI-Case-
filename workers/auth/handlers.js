/**
 * auth/handlers.js — Route handlers for /api/v1/auth/* endpoints.
 *
 * POST /api/v1/auth/telegram      — Telegram Login Widget verification → JWT pair
 * GET  /api/v1/auth/telegram/callback — Telegram Login Widget redirect flow
 * GET  /api/v1/auth/me            — Decode access token → current user info
 * POST /api/v1/auth/logout        — Clear auth cookies
 * POST /api/v1/auth/refresh       — Refresh access token using refresh token
 * POST /api/v1/auth/switch-tenant — Switch active tenant in access token
 *
 * Cookie design:
 *   immi_access  = access JWT  (HttpOnly; Secure; SameSite=Lax; Max-Age=300)
 *   immi_refresh = refresh JWT (HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/api/v1/auth)
 *
 * Bearer tokens are also accepted via Authorization header for API clients.
 */

import { verifyTelegramAuth } from "./telegram.js";
import { makeAccessToken, makeRefreshToken, verifyJwt } from "./jwt.js";
import { requireAuth, extractToken } from "../db/getSqlAsUser.js";
import { checkNonce } from "./nonce_do.js";
import {
  extractRefreshToken,
  generateRefreshSessionDraft,
  insertRefreshSessionTx,
  isRefreshSessionError,
  loadActiveRefreshSessionForUpdateTx,
  RefreshSessionError,
  revokeRefreshSessionTx,
  validateRefreshPayload,
} from "./refresh_sessions.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_MAX_AGE  = 300;    // 5 minutes
const REFRESH_MAX_AGE = 604800; // 7 days

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonOk(body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function jsonErr(msg, status = 400, code = "error") {
  return new Response(JSON.stringify({ error: msg, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildAuthResponse(body, accessToken, refreshToken, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`,
  );
  headers.append(
    "Set-Cookie",
    `immi_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE}`,
  );
  return new Response(JSON.stringify(body), { status, headers });
}

function clearCookiesResponse(body, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", `immi_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  headers.append("Set-Cookie", `immi_refresh=; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  return new Response(JSON.stringify(body), { status, headers });
}

function buildAuthRedirect(next, accessToken, refreshToken) {
  const headers = new Headers({ Location: next });
  headers.append(
    "Set-Cookie",
    `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`,
  );
  headers.append(
    "Set-Cookie",
    `immi_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE}`,
  );
  return new Response(null, { status: 302, headers });
}

function safeRedirectTarget(rawNext) {
  if (!rawNext || typeof rawNext !== "string") return "/app/";
  if (!rawNext.startsWith("/")) return "/app/";
  if (rawNext.startsWith("//")) return "/app/";
  return rawNext;
}

function refreshSessionErr(err) {
  return jsonErr(
    err.message || "Invalid refresh token",
    err.status || 401,
    err.code || "invalid_refresh_token",
  );
}

async function readOptionalRefreshClaims(request, env) {
  const token = extractRefreshToken(request);
  if (!token) return null;
  const result = await verifyJwt(token, env);
  if (!result.valid) return null;
  try {
    return validateRefreshPayload(result.payload);
  } catch {
    return null;
  }
}

async function persistIssuedRefreshSession({
  env,
  getSql,
  draft,
  previousRefreshClaims = null,
  previousRefreshReason = "login_replaced",
}) {
  const sql = getSql(env);
  try {
    await sql.begin(async (tx) => {
      await insertRefreshSessionTx(tx, draft);
      if (previousRefreshClaims) {
        await revokeRefreshSessionTx(tx, {
          jti: previousRefreshClaims.jti,
          userId: previousRefreshClaims.userId,
          reason: previousRefreshReason,
          replacedByJti: draft.jti,
        });
      }
    });
  } finally {
    await sql.end();
  }
}

async function issueLoginTokenPair({ request, env, getSql, user, tenant, tenants }) {
  const previousRefreshClaims = await readOptionalRefreshClaims(request, env);
  const refreshDraft = generateRefreshSessionDraft(user.id);
  let accessToken, refreshToken;
  try {
    [accessToken, refreshToken] = await Promise.all([
      makeAccessToken(user, tenant, tenants, env),
      makeRefreshToken(user.id, refreshDraft.jti, env),
    ]);
  } catch (err) {
    err.phase = "jwt";
    throw err;
  }

  try {
    await persistIssuedRefreshSession({
      env,
      getSql,
      draft: refreshDraft,
      previousRefreshClaims,
    });
  } catch (err) {
    err.phase = "db";
    throw err;
  }

  return { accessToken, refreshToken };
}

// ---------------------------------------------------------------------------
// DB helper — upsert Telegram user + tenant
// ---------------------------------------------------------------------------

async function upsertTelegramUser(tgData, getSql, env) {
  const sql = getSql(env);
  try {
    return await sql.begin(async (tx) => {
      // Upsert immi_user — last_login_at is the correct column (no updated_at on immi_users)
      const [user] = await tx`
        INSERT INTO immi_users (telegram_id, first_name, last_name, username, photo_url, last_login_at)
        VALUES (
          ${Number(tgData.id)},
          ${tgData.first_name ?? null},
          ${tgData.last_name  ?? null},
          ${tgData.username   ?? null},
          ${tgData.photo_url  ?? null},
          NOW()
        )
        ON CONFLICT (telegram_id) DO UPDATE SET
          first_name    = EXCLUDED.first_name,
          last_name     = EXCLUDED.last_name,
          username      = EXCLUDED.username,
          photo_url     = EXCLUDED.photo_url,
          last_login_at = EXCLUDED.last_login_at
        RETURNING id, telegram_id
      `;

      // Fetch memberships including role for JWT claim — joined_at is the correct column
      let memberships = await tx`
        SELECT tm.tenant_id AS id, t.kind, t.name, tm.role
        FROM immi_tenant_members tm
        JOIN immi_tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = ${user.id}
        ORDER BY tm.joined_at
      `;

      // First login — create personal tenant (immi_tenants: id, kind, name, created_at)
      if (memberships.length === 0) {
        const [newTenant] = await tx`
          INSERT INTO immi_tenants (kind, name)
          VALUES ('individual', ${tgData.first_name ?? "My Workspace"})
          RETURNING id, kind, name
        `;
        await tx`
          INSERT INTO immi_tenant_members (user_id, tenant_id, role)
          VALUES (${user.id}, ${newTenant.id}, 'owner')
        `;
        memberships = [{ ...newTenant, role: "owner" }];
      }

      const tenant   = memberships[0];
      const tenants  = memberships.map((r) => r.id);
      const userRole = memberships[0].role ?? "member";
      return { user: { ...user, role: userRole }, tenant, tenants };
    });
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/telegram
// ---------------------------------------------------------------------------

export async function handleTelegramLogin(request, env, getSql) {
  let data;
  try { data = await request.json(); } catch {
    return jsonErr("Invalid JSON body", 400, "bad_request");
  }
  if (!data || typeof data !== "object") {
    return jsonErr("Missing body", 400, "bad_request");
  }

  const tgResult = await verifyTelegramAuth(data, env);
  if (!tgResult.valid) {
    console.log(JSON.stringify({ event: "auth.telegram.fail", reason: tgResult.reason }));
    return jsonErr("Telegram auth verification failed", 401, tgResult.reason ?? "invalid_hash");
  }

  const fresh = await checkNonce(env, data.hash);
  if (!fresh) {
    console.log(JSON.stringify({ event: "auth.telegram.replay", hash: String(data.hash).slice(0, 8) }));
    return jsonErr("Auth replay detected", 401, "replay");
  }

  if (!env.HYPERDRIVE) {
    return jsonErr("Database unavailable", 503, "db_unavailable");
  }

  let user, tenant, tenants;
  try {
    ({ user, tenant, tenants } = await upsertTelegramUser(data, getSql, env));
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.telegram.db_error", error: err?.message }));
    return jsonErr("Authentication service error", 503, "db_error");
  }

  let accessToken, refreshToken;
  try {
    ({ accessToken, refreshToken } = await issueLoginTokenPair({
      request,
      env,
      getSql,
      user,
      tenant,
      tenants,
    }));
  } catch (err) {
    const event = err?.phase === "db" ? "auth.telegram.refresh_session_error" : "auth.telegram.jwt_error";
    const code = err?.phase === "db" ? "db_error" : "jwt_error";
    const message = err?.phase === "db" ? "Authentication service error" : "Token issuance failed";
    console.error(JSON.stringify({ event, error: err?.message }));
    return jsonErr(message, 503, code);
  }

  return buildAuthResponse(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_MAX_AGE,
      user: {
        id:         user.id,
        telegram_id: user.telegram_id,
        first_name: data.first_name  ?? null,
        username:   data.username    ?? null,
        photo_url:  data.photo_url   ?? null,
        role:       user.role        ?? "member",
      },
      tenant:  { id: tenant.id, kind: tenant.kind, name: tenant.name },
      tenants,
    },
    accessToken,
    refreshToken,
  );
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/telegram/callback
// ---------------------------------------------------------------------------

export async function handleTelegramCallback(request, env, getSql) {
  const url = new URL(request.url);
  const next = safeRedirectTarget(url.searchParams.get("next"));
  const data = Object.fromEntries(url.searchParams.entries());
  delete data.next;

  if (!data || !data.hash) {
    return Response.redirect(`${url.origin}/app/login?auth_error=missing_telegram_payload`, 302);
  }

  const tgResult = await verifyTelegramAuth(data, env);
  if (!tgResult.valid) {
    console.log(JSON.stringify({ event: "auth.telegram.callback_fail", reason: tgResult.reason }));
    return Response.redirect(`${url.origin}/app/login?auth_error=${encodeURIComponent(tgResult.reason ?? "invalid_hash")}`, 302);
  }

  const fresh = await checkNonce(env, data.hash);
  if (!fresh) {
    console.log(JSON.stringify({ event: "auth.telegram.callback_replay", hash: String(data.hash).slice(0, 8) }));
    return Response.redirect(`${url.origin}/app/login?auth_error=replay`, 302);
  }

  if (!env.HYPERDRIVE) {
    return Response.redirect(`${url.origin}/app/login?auth_error=db_unavailable`, 302);
  }

  let user, tenant, tenants;
  try {
    ({ user, tenant, tenants } = await upsertTelegramUser(data, getSql, env));
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.telegram.callback_db_error", error: err?.message }));
    return Response.redirect(`${url.origin}/app/login?auth_error=db_error`, 302);
  }

  let accessToken, refreshToken;
  try {
    ({ accessToken, refreshToken } = await issueLoginTokenPair({
      request,
      env,
      getSql,
      user,
      tenant,
      tenants,
    }));
  } catch (err) {
    const event = err?.phase === "db"
      ? "auth.telegram.callback_refresh_session_error"
      : "auth.telegram.callback_jwt_error";
    const authError = err?.phase === "db" ? "db_error" : "jwt_error";
    console.error(JSON.stringify({ event, error: err?.message }));
    return Response.redirect(`${url.origin}/app/login?auth_error=${authError}`, 302);
  }

  return buildAuthRedirect(next, accessToken, refreshToken);
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------

export async function handleAuthMe(request, env) {
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;
  const token = extractToken(request);

  return jsonOk({
    user: {
      id:    claims.sub,
      role:  claims.role  ?? "member",
      tg_id: claims.tg_id ?? null,
    },
    tenant: {
      id:   claims.tenant_id,
      kind: claims.tenant_kind ?? "individual",
      name: claims.tenant_name ?? "",
    },
    tenants: claims.tenants ?? [],
    access_token: token,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------

export async function handleAuthLogout(request, env, getSql) {
  const refreshToken = extractRefreshToken(request);
  if (!refreshToken || !env.HYPERDRIVE) {
    return clearCookiesResponse({ ok: true });
  }

  const result = await verifyJwt(refreshToken, env);
  if (!result.valid) {
    return clearCookiesResponse({ ok: true });
  }

  let refreshClaims;
  try {
    refreshClaims = validateRefreshPayload(result.payload);
  } catch {
    return clearCookiesResponse({ ok: true });
  }

  try {
    const sql = getSql(env);
    try {
      await sql.begin(async (tx) => {
        await revokeRefreshSessionTx(tx, {
          jti: refreshClaims.jti,
          userId: refreshClaims.userId,
          reason: "logout",
        });
      });
    } finally {
      await sql.end();
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.logout.revoke_error", error: err?.message }));
    return clearCookiesResponse(
      { ok: false, error: "Logout revoke failed", code: "db_error" },
      503,
    );
  }

  return clearCookiesResponse({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------

export async function handleAuthRefresh(request, env, getSql) {
  const refreshToken = extractRefreshToken(request);

  if (!refreshToken) {
    return jsonErr("No refresh token", 401, "missing_refresh_token");
  }

  const result = await verifyJwt(refreshToken, env);
  if (!result.valid || result.payload?.type !== "refresh") {
    return jsonErr("Invalid or expired refresh token", 401, result.reason || "invalid_refresh_token");
  }

  let refreshClaims;
  try {
    refreshClaims = validateRefreshPayload(result.payload);
  } catch (err) {
    return refreshSessionErr(err);
  }

  if (!env.HYPERDRIVE) {
    return jsonErr("Database unavailable", 503, "db_unavailable");
  }

  let user, tenant, tenants, newAccessToken, newRefreshToken;
  try {
    const sql = getSql(env);
    try {
      await sql.begin(async (tx) => {
        const activeSession = await loadActiveRefreshSessionForUpdateTx(tx, refreshClaims);
        const newRefreshDraft = generateRefreshSessionDraft(
          refreshClaims.userId,
          activeSession.family_id,
        );

        const rows = await tx`
          SELECT
            u.id, u.telegram_id,
            tm.role         AS user_role,
            tm.tenant_id,
            t.kind          AS tenant_kind,
            t.name          AS tenant_name,
            ARRAY_AGG(tm2.tenant_id ORDER BY tm2.joined_at) AS all_tenants
          FROM immi_users u
          JOIN immi_tenant_members tm  ON tm.user_id  = u.id
          JOIN immi_tenants t          ON t.id         = tm.tenant_id
          JOIN immi_tenant_members tm2 ON tm2.user_id  = u.id
          WHERE u.id = ${refreshClaims.userId}::uuid
          GROUP BY u.id, u.telegram_id, tm.role, tm.tenant_id, t.kind, t.name
          ORDER BY tm.joined_at
          LIMIT 1
        `;
        if (rows.length === 0) {
          throw new RefreshSessionError("User not found", 401, "user_not_found");
        }

        const row = rows[0];
        user    = { id: row.id, telegram_id: row.telegram_id, role: row.user_role ?? "member" };
        tenant  = { id: row.tenant_id, kind: row.tenant_kind, name: row.tenant_name };
        tenants = row.all_tenants;

        try {
          [newAccessToken, newRefreshToken] = await Promise.all([
            makeAccessToken(user, tenant, tenants, env),
            makeRefreshToken(user.id, newRefreshDraft.jti, env),
          ]);
        } catch (err) {
          err.phase = "jwt";
          throw err;
        }

        await insertRefreshSessionTx(tx, newRefreshDraft);
        await revokeRefreshSessionTx(tx, {
          jti: refreshClaims.jti,
          userId: refreshClaims.userId,
          reason: "rotated",
          replacedByJti: newRefreshDraft.jti,
        });
      });
    } finally {
      await sql.end();
    }
  } catch (err) {
    if (isRefreshSessionError(err)) {
      return refreshSessionErr(err);
    }
    if (err?.phase === "jwt") {
      console.error(JSON.stringify({ event: "auth.refresh.jwt_error", error: err?.message }));
      return jsonErr("Token issuance failed", 503, "jwt_error");
    }
    console.error(JSON.stringify({ event: "auth.refresh.db_error", error: err?.message }));
    return jsonErr("Authentication service error", 503, "db_error");
  }

  return buildAuthResponse(
    { access_token: newAccessToken, token_type: "Bearer", expires_in: ACCESS_MAX_AGE },
    newAccessToken,
    newRefreshToken,
  );
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/switch-tenant
// ---------------------------------------------------------------------------

export async function handleAuthSwitchTenant(request, env, getSql) {
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;

  let body;
  try { body = await request.json(); } catch {
    return jsonErr("Invalid JSON body", 400, "bad_request");
  }

  const targetTenantId = body?.tenant_id;
  if (!targetTenantId || typeof targetTenantId !== "string") {
    return jsonErr("tenant_id required", 400, "missing_tenant_id");
  }

  const allTenants = claims.tenants ?? [];
  if (!allTenants.includes(targetTenantId)) {
    return jsonErr("Not a member of that tenant", 403, "forbidden");
  }

  if (!env.HYPERDRIVE) {
    return jsonErr("Database unavailable", 503, "db_unavailable");
  }

  let tenant;
  try {
    const sql = getSql(env);
    try {
      // Live membership check — JWT claims can be up to 5 min stale
      const [row] = await sql`
        SELECT t.id, t.kind, t.name
        FROM immi_tenants t
        JOIN immi_tenant_members tm ON tm.tenant_id = t.id
        WHERE t.id = ${targetTenantId}::uuid
          AND tm.user_id = ${claims.sub}::uuid
      `;
      if (!row) return jsonErr("Not a member of that tenant", 403, "forbidden");
      tenant = row;
    } finally {
      await sql.end();
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.switch_tenant.db_error", error: err?.message }));
    return jsonErr("Authentication service error", 503, "db_error");
  }

  const user = { id: claims.sub, telegram_id: claims.tg_id, role: claims.role };
  let newAccessToken;
  try {
    newAccessToken = await makeAccessToken(user, tenant, allTenants, env);
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.switch_tenant.jwt_error", error: err?.message }));
    return jsonErr("Token issuance failed", 503, "jwt_error");
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `immi_access=${newAccessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`,
  );

  return new Response(
    JSON.stringify({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: ACCESS_MAX_AGE,
      tenant: { id: tenant.id, kind: tenant.kind, name: tenant.name },
    }),
    { status: 200, headers },
  );
}
