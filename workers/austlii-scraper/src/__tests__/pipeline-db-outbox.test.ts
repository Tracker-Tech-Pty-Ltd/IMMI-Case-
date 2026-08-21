import { describe, expect, it } from "vitest";
import {
  markNativeOutboxAttempt,
  markNativeOutboxPublished,
  stageNativeOutboxEvent,
} from "../pipeline-db";

const EVENT = {
  eventId: "case.extracted:run-1:abcdef123456",
  runId: "run-1",
  eventKind: "case.extracted",
  payloadKey: "pipeline/run-1/abcdef123456.json",
  payloadSha256: "a".repeat(64),
};

function fakeEnv(existingStatus: string | null = null) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            first: async <T>() => (existingStatus ? { status: existingStatus } as T : null),
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
  return { env: { IMMI_OPS_DB: db } as never, statements };
}

describe("native pipeline outbox", () => {
  it("stages a pointer before publishing and preserves the event identity", async () => {
    const current = fakeEnv();
    await expect(stageNativeOutboxEvent(current.env, EVENT)).resolves.toBe("pending");
    expect(current.statements).toHaveLength(2);
    expect(current.statements[0].sql).toContain("SELECT status FROM outbox_events");
    expect(current.statements[1].sql).toContain("INSERT OR IGNORE INTO outbox_events");
    expect(current.statements[1].params).toEqual(expect.arrayContaining([
      EVENT.eventId, EVENT.runId, EVENT.eventKind, EVENT.payloadKey, EVENT.payloadSha256,
    ]));
  });

  it("skips a Queue send when the outbox already records publication", async () => {
    const current = fakeEnv("published");
    await expect(stageNativeOutboxEvent(current.env, EVENT)).resolves.toBe("published");
    expect(current.statements).toHaveLength(1);
  });

  it("records attempts and publication status in Ops D1", async () => {
    const current = fakeEnv();
    await markNativeOutboxAttempt(current.env, EVENT.eventId);
    await markNativeOutboxPublished(current.env, EVENT.eventId);
    expect(current.statements).toHaveLength(2);
    expect(current.statements[0].sql).toContain("attempts = attempts + 1");
    expect(current.statements[1].sql).toContain("status = 'published'");
  });
});
