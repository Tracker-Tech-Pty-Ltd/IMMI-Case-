import {
  assertAuthContext,
  assertObjectPointer,
  StorageBoundaryError,
  utcNow,
} from "./contracts.js";
import { changeCount, requireD1, rows } from "./cloudflare_shared.js";

export class CloudflareCouncilStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
  }

  async createSession(auth, { sessionId, caseId = null, title = "", retrieveCode = null }) {
    const context = assertAuthContext(auth);
    const now = utcNow();
    await this.db.prepare(`
      INSERT INTO council_sessions (
        session_id, tenant_id, created_by, case_id, title, status, retrieve_code,
        total_turns, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)
    `).bind(sessionId, context.tenantId, context.userId, caseId, title, retrieveCode, now, now).run();
    return this.db.prepare(`
      SELECT session_id, case_id, title, status, retrieve_code, total_turns, created_at, updated_at
      FROM council_sessions WHERE session_id = ? AND tenant_id = ?
    `).bind(sessionId, context.tenantId).first();
  }

  async getSessionByCode(auth, code) {
    const context = assertAuthContext(auth);
    return this.db.prepare(`
      SELECT session_id, retrieve_code, tenant_id, created_by
      FROM council_sessions
      WHERE retrieve_code = ? AND tenant_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(code, context.tenantId).first();
  }

  async getSessionMetadata(auth, sessionId) {
    const context = assertAuthContext(auth);
    const session = await this.db.prepare(`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(sessionId, context.tenantId).first();
    if (!session) return null;
    const turns = rows(await this.db.prepare(`
      SELECT turn_id, session_id, turn_index, role, payload_key, payload_sha256,
             payload_size, payload_content_type, created_at
      FROM council_turns
      WHERE session_id = ? AND tenant_id = ?
      ORDER BY turn_index ASC
    `).bind(sessionId, context.tenantId).all());
    return { session, turns };
  }

  async appendTurnMetadata(auth, { sessionId, turnId, turnIndex, role, payloadPointer }) {
    const context = assertAuthContext(auth);
    const pointer = assertObjectPointer(payloadPointer, "council");
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      throw new StorageBoundaryError("turnIndex must be a non-negative integer", { code: "invalid_turn_index", status: 400 });
    }
    const now = utcNow();
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT OR IGNORE INTO council_turns (
          turn_id, session_id, tenant_id, turn_index, role, payload_key,
          payload_sha256, payload_size, payload_content_type, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM council_sessions
          WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
        )
      `).bind(
        turnId, sessionId, context.tenantId, turnIndex, role, pointer.key,
        pointer.sha256, pointer.size, pointer.contentType, now,
        sessionId, context.tenantId,
      ),
      this.db.prepare(`
        UPDATE council_sessions
        SET total_turns = (
              SELECT COUNT(*) FROM council_turns WHERE session_id = ? AND tenant_id = ?
            ), updated_at = ?
        WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
      `).bind(sessionId, context.tenantId, now, sessionId, context.tenantId),
    ]);
    if (changeCount(results[0]) === 0 && changeCount(results[1]) === 0) {
      throw new StorageBoundaryError("Council session not found", { code: "council_session_not_found", status: 404 });
    }
  }

  async deleteSession(auth, sessionId) {
    const context = assertAuthContext(auth);
    const result = await this.db.prepare(`
      UPDATE council_sessions
      SET deleted_at = ?, updated_at = ?
      WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).bind(utcNow(), utcNow(), sessionId, context.tenantId).run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Council session not found", { code: "council_session_not_found", status: 404 });
    }
  }
}
