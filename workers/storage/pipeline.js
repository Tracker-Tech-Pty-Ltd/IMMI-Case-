import {
  assertCaseId,
  assertSha256,
  clampLimit,
  StorageBoundaryError,
  utcNow,
} from "./contracts.js";
import { changeCount, requireD1, rows } from "./cloudflare_shared.js";

export class CloudflarePipelineStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_OPS_DB, "IMMI_OPS_DB");
  }

  async claimEvent(eventId, { runId = null, kind, payloadSha256 }) {
    assertSha256(payloadSha256);
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128 || typeof kind !== "string" || kind.length === 0) {
      throw new StorageBoundaryError("Pipeline event is invalid", { code: "invalid_pipeline_event", status: 400 });
    }
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO idempotency_keys (event_id, run_id, event_kind, payload_sha256, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(eventId, runId, kind, payloadSha256, utcNow()).run();
    if (changeCount(result) === 1) return true;
    const existing = await this.db.prepare(`
      SELECT payload_sha256 FROM idempotency_keys WHERE event_id = ? LIMIT 1
    `).bind(eventId).first();
    if (!existing || existing.payload_sha256 !== payloadSha256) {
      throw new StorageBoundaryError("Pipeline event id was reused with a different payload", {
        code: "idempotency_payload_mismatch",
        status: 409,
      });
    }
    return false;
  }

  async ensurePipelineRun({ runId, trigger = "queue", phase = "extract" }) {
    if (typeof runId !== "string" || runId.length === 0 || runId.length > 128) {
      throw new StorageBoundaryError("Pipeline run id is invalid", { code: "invalid_pipeline_run", status: 400 });
    }
    await this.db.prepare(`
      INSERT OR IGNORE INTO pipeline_runs (run_id, trigger, phase, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `).bind(runId, trigger, phase, utcNow()).run();
  }

  async listRuns(limit = 30) {
    const size = clampLimit(limit, { fallback: 30, max: 100 });
    const [runRows, summary] = await Promise.all([
      this.db.prepare(`
        SELECT run_id, started_at, finished_at, trigger, court, phase, status,
               discovered, scraped, extracted, upserted, llm_calls, cost_usd,
               errors, abort_reason, detail_json
        FROM pipeline_runs
        ORDER BY started_at DESC LIMIT ?
      `).bind(size).all(),
      this.db.prepare(`
        SELECT COUNT(*) AS total_runs,
               SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
               SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_runs,
               COALESCE(SUM(discovered), 0) AS discovered,
               COALESCE(SUM(scraped), 0) AS scraped,
               COALESCE(SUM(extracted), 0) AS extracted,
               COALESCE(SUM(upserted), 0) AS upserted,
               COALESCE(SUM(llm_calls), 0) AS llm_calls,
               COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM pipeline_runs
      `).first(),
    ]);
    return { runs: rows(runRows), summary: summary || {} };
  }

  async latestControlCommand(action) {
    if (!["start", "stop", "download", "legislation_update"].includes(action)) {
      throw new StorageBoundaryError("Pipeline command action is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    return this.db.prepare(`
      SELECT command_id, action, payload_json, status, run_id, error, created_at, updated_at, completed_at
      FROM pipeline_control_commands
      WHERE action = ? ORDER BY created_at DESC LIMIT 1
    `).bind(action).first();
  }

  async recordControlCommand({ commandId, action, payload, runId = null }) {
    if (typeof commandId !== "string" || commandId.length < 8 || commandId.length > 128) {
      throw new StorageBoundaryError("Pipeline command id is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    if (!["start", "stop", "download", "legislation_update"].includes(action)) {
      throw new StorageBoundaryError("Pipeline command action is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const encoded = JSON.stringify(payload && typeof payload === "object" ? payload : {});
    const now = utcNow();
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO pipeline_control_commands
        (command_id, action, payload_json, status, run_id, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).bind(commandId, action, encoded, runId, now, now).run();
    return changeCount(result) === 1;
  }

  async updateControlCommand(commandId, patch = {}) {
    if (typeof commandId !== "string" || commandId.length < 8 || commandId.length > 128) {
      throw new StorageBoundaryError("Pipeline command id is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const allowed = new Set(["queued", "running", "completed", "failed"]);
    const status = patch.status === undefined ? null : String(patch.status);
    if (status !== null && !allowed.has(status)) {
      throw new StorageBoundaryError("Pipeline command status is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const completedAt = status === "completed" || status === "failed" ? utcNow() : null;
    await this.db.prepare(`
      UPDATE pipeline_control_commands SET
        status = COALESCE(?, status),
        run_id = COALESCE(?, run_id),
        error = COALESCE(?, error),
        updated_at = ?,
        completed_at = COALESCE(?, completed_at)
      WHERE command_id = ?
    `).bind(status, patch.runId ?? null, patch.error ?? null, utcNow(), completedAt, commandId).run();
  }

  async checkpoint({ runId, eventId, step, status, detail = null }) {
    await this.db.prepare(`
      INSERT INTO import_checkpoints (run_id, event_id, step, status, detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, event_id, step) DO UPDATE SET
        status=excluded.status, detail_json=excluded.detail_json, updated_at=excluded.updated_at
    `).bind(runId, eventId, step, status, detail === null ? null : JSON.stringify(detail), utcNow()).run();
  }

  async pipelineCheckpoint({ runId, eventId, step, status, detail = null }) {
    await this.db.prepare(`
      INSERT INTO pipeline_checkpoints (run_id, event_id, step, status, detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, event_id, step) DO UPDATE SET
        status=excluded.status, detail_json=excluded.detail_json, updated_at=excluded.updated_at
    `).bind(runId, eventId, step, status, detail === null ? null : JSON.stringify(detail), utcNow()).run();
  }

  async isEventComplete(eventId) {
    const record = await this.db.prepare(`
      SELECT completed_at FROM idempotency_keys WHERE event_id = ? LIMIT 1
    `).bind(eventId).first();
    return Boolean(record?.completed_at);
  }

  async completeEvent(eventId) {
    await this.db.prepare(`
      UPDATE idempotency_keys SET completed_at = ? WHERE event_id = ?
    `).bind(utcNow(), eventId).run();
  }

  async recordDeadLetter({ eventId, outboxEventId = null, reason, payloadPointer }) {
    const linked = outboxEventId
      ? await this.db.prepare("SELECT event_id FROM outbox_events WHERE event_id = ? LIMIT 1")
        .bind(outboxEventId).first()
      : null;
    await this.db.prepare(`
      INSERT OR IGNORE INTO dead_letter_events (
        event_id, outbox_event_id, reason, payload_key, payload_sha256, failed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      eventId, linked?.event_id || null, reason, payloadPointer.key,
      payloadPointer.sha256, utcNow(),
    ).run();
  }

  async recordExtractionAudit({ auditId = null, runId, caseId, fieldName, oldValue = null, newValue, source, confidence = null }) {
    await this.db.prepare(`
      INSERT OR IGNORE INTO extraction_audit (
        audit_id, run_id, case_id, field_name, old_value, new_value, source, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      auditId || crypto.randomUUID(), runId, assertCaseId(caseId), fieldName, oldValue,
      newValue, source, confidence, utcNow(),
    ).run();
  }
}
