/**
 * Per-session Durable Object for Council write coordination.
 *
 * A session ID deterministically selects one object. The DO stores only the
 * idempotency/turn-order ledger; conversation payloads remain in R2 and the
 * durable metadata remains in Account D1 through CloudflareCouncilStore.
 */

import { DurableObject } from "cloudflare:workers";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { assertAuthContext, StorageBoundaryError } from "../storage/contracts.js";
import { getCouncilSessionStub } from "./session_namespace.js";

export { getCouncilSessionStub } from "./session_namespace.js";

function assertSessionIdentifier(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f/]/.test(value)) {
    throw new StorageBoundaryError(`${name} is invalid`, { code: "invalid_council_identifier", status: 400 });
  }
  return value;
}

function first(cursor) {
  for (const row of cursor) return row;
  return null;
}

export class CouncilSessionDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS council_turn_ledger (
          turn_id TEXT PRIMARY KEY,
          turn_index INTEGER NOT NULL UNIQUE,
          completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS council_turn_sequence (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          next_turn INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO council_turn_sequence (singleton, next_turn) VALUES (1, -1)",
      );
    });
  }

  /**
   * The DO serializes allocation. The sequence stays pending until R2 upload
   * and Account D1 metadata both succeed, allowing a Queue retry to resume the
   * same turn index rather than double-count the conversation.
   */
  async appendTurn(auth, { sessionId, turnId, role, payload }) {
    const context = assertAuthContext(auth);
    const checkedSessionId = assertSessionIdentifier(sessionId, "sessionId");
    const checkedTurnId = assertSessionIdentifier(turnId, "turnId");
    if (typeof role !== "string" || role.length === 0 || role.length > 32) {
      throw new StorageBoundaryError("Council turn role is invalid", { code: "invalid_council_role", status: 400 });
    }

    let ledger = first(this.ctx.storage.sql.exec(
      "SELECT turn_index, completed FROM council_turn_ledger WHERE turn_id = ?",
      checkedTurnId,
    ));
    if (!ledger) {
      const allocated = first(this.ctx.storage.sql.exec(`
        INSERT INTO council_turn_ledger (turn_id, turn_index, completed)
        SELECT ?, next_turn + 1, 0 FROM council_turn_sequence WHERE singleton = 1
        RETURNING turn_index, completed
      `, checkedTurnId));
      this.ctx.storage.sql.exec(
        "UPDATE council_turn_sequence SET next_turn = ? WHERE singleton = 1",
        allocated.turn_index,
      );
      ledger = allocated;
    }
    if (ledger.completed === 1) {
      return { turnIndex: ledger.turn_index, replayed: true };
    }

    const stores = createCloudflareStores(this.env);
    const payloadPointer = await stores.objectStore.putCouncilPayload({
      auth: context,
      sessionId: checkedSessionId,
      turnId: checkedTurnId,
      payload,
    });
    await stores.councilStore.appendTurnMetadata(context, {
      sessionId: checkedSessionId,
      turnId: checkedTurnId,
      turnIndex: ledger.turn_index,
      role,
      payloadPointer,
    });
    this.ctx.storage.sql.exec(
      "UPDATE council_turn_ledger SET completed = 1 WHERE turn_id = ?",
      checkedTurnId,
    );
    return { turnIndex: ledger.turn_index, replayed: false, payloadPointer };
  }

  async deleteSession(auth, { sessionId }) {
    const context = assertAuthContext(auth);
    const checkedSessionId = assertSessionIdentifier(sessionId, "sessionId");
    const stores = createCloudflareStores(this.env);
    // Delete verified R2 payloads before soft-deleting the Account D1
    // metadata. If an object delete fails, the metadata remains available for
    // a safe retry instead of leaving an untracked Council payload behind.
    const metadata = await stores.councilStore.getSessionMetadata(context, checkedSessionId);
    if (!metadata) {
      throw new StorageBoundaryError("Council session not found", {
        code: "council_session_not_found",
        status: 404,
      });
    }
    await Promise.all((metadata.turns || []).map((turn) => stores.objectStore.deleteVerified({
      key: turn.payload_key,
      sha256: turn.payload_sha256,
      size: turn.payload_size,
      contentType: turn.payload_content_type,
    }, { prefix: "council" })));
    await stores.councilStore.deleteSession(context, checkedSessionId);
    await this.ctx.storage.deleteAll();
  }
}
