import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { handleAuthRefresh } from "../auth/cloudflare_handlers.js";
import { makeRefreshToken, verifyJwt } from "../auth/jwt.js";
import { createCloudflareIdentityStore } from "../storage/cloudflare.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const JTI = "22222222-2222-4333-8444-555555555555";
const FAMILY_ID = "44444444-2222-4333-8444-555555555555";
const ROTATION_ID = "12345678-1234-4234-8234-123456789abc";

async function fixture() {
  const db = createSqliteD1("account");
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (user_id, telegram_id, created_at, updated_at) VALUES (?, '123456', ?, ?)").bind(USER_ID, now, now).run();
  await db.prepare("INSERT INTO tenants (tenant_id, kind, name, created_at, updated_at) VALUES (?, 'individual', 'Offline', ?, ?)").bind(TENANT_ID, now, now).run();
  await db.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(TENANT_ID, USER_ID, now).run();
  const env = { IMMI_STORAGE_MODE: "cloudflare", IMMI_ACCOUNT_DB: db, JWT_SECRET_CURRENT: "offline-test-signing-secret", JWT_KID_CURRENT: "test" };
  await createCloudflareIdentityStore(env).createRefreshSession({
    jti: JTI, userId: USER_ID, familyId: FAMILY_ID, expiresAt: new Date(Date.now() + 600_000),
  });
  const token = await makeRefreshToken(USER_ID, JTI, env);

  // Force both handlers to observe the active parent before either CAS runs.
  // This models a client timeout while the first server request is still live.
  let observed = 0;
  let release;
  const bothRead = new Promise((resolve) => { release = resolve; });
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...params) => {
      const bound = bind(...params);
      if (sql.includes("revoked_reason, replaced_by_jti") && params[0] === JTI) {
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          if (observed < 2) {
            observed += 1;
            if (observed === 2) release();
            await bothRead;
          }
          return row;
        };
      }
      return bound;
    };
    return statement;
  };
  // Real D1 batches are serialized transactions; the SQLite test shim yields
  // between statements and therefore needs the same scheduling explicitly.
  const batch = db.batch.bind(db);
  let pending = Promise.resolve();
  db.batch = (statements) => {
    const result = pending.then(() => batch(statements));
    pending = result.catch(() => {});
    return result;
  };
  const request = (rotationId) => new Request("https://immi.example/api/v1/auth/refresh", {
    method: "POST", headers: { Cookie: `immi_refresh=${token}`, "X-Refresh-Rotation-Id": rotationId },
  });
  return { db, env, request };
}

describe("overlapping refresh rotations against Account D1", () => {
  it("keeps one live successor when the same rotation retries before the first request finishes", async () => {
    const { db, env, request } = await fixture();
    const responses = await Promise.all([
      handleAuthRefresh(request(ROTATION_ID), env),
      handleAuthRefresh(request(ROTATION_ID), env),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const live = await db.prepare("SELECT jti FROM immi_refresh_sessions WHERE family_id = ? AND revoked_at IS NULL").bind(FAMILY_ID).all();
    expect(live.results).toHaveLength(1);
    for (const response of responses) {
      const cookie = response.headers.getSetCookie().find((value) => value.startsWith("immi_refresh="));
      const verified = await verifyJwt(cookie.split(";")[0].slice("immi_refresh=".length), env);
      expect(verified.valid).toBe(true);
      expect(verified.payload.jti).toBe(live.results[0].jti);
    }
  });

  it("still revokes the whole family when overlapping rotations have different proofs", async () => {
    const { db, env, request } = await fixture();
    const responses = await Promise.all([
      handleAuthRefresh(request(ROTATION_ID), env),
      handleAuthRefresh(request("87654321-1234-4234-8234-123456789abc"), env),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const live = await db.prepare("SELECT COUNT(*) AS count FROM immi_refresh_sessions WHERE family_id = ? AND revoked_at IS NULL").bind(FAMILY_ID).first();
    expect(live.count).toBe(0);
  });

  it.each(["expired", "logout", "rotated"])("refuses the same proof when its successor is already %s", async (state) => {
    const { db, env, request } = await fixture();
    await Promise.all([
      handleAuthRefresh(request(ROTATION_ID), env),
      handleAuthRefresh(request(ROTATION_ID), env),
    ]);
    const successor = await db.prepare("SELECT jti FROM immi_refresh_sessions WHERE family_id = ? AND revoked_at IS NULL").bind(FAMILY_ID).first();
    if (state === "expired") {
      await db.prepare("UPDATE immi_refresh_sessions SET expires_at = ? WHERE jti = ?").bind(new Date(Date.now() - 1000).toISOString(), successor.jti).run();
    } else {
      await db.prepare("UPDATE immi_refresh_sessions SET revoked_at = ?, revoked_reason = ? WHERE jti = ?").bind(new Date().toISOString(), state, successor.jti).run();
    }
    await expect(createCloudflareIdentityStore(env).rotateRefreshSession(
      { jti: JTI, userId: USER_ID },
      { jti: successor.jti, userId: USER_ID, familyId: FAMILY_ID, expiresAt: new Date(Date.now() + 600_000) },
    )).rejects.toMatchObject({ code: "revoked_refresh_token" });
    const live = await db.prepare("SELECT COUNT(*) AS count FROM immi_refresh_sessions WHERE family_id = ? AND revoked_at IS NULL").bind(FAMILY_ID).first();
    expect(live.count).toBe(0);
  });
});
