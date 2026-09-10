import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
const mockCoordinate = vi.fn(async () => ({ status: "completed" }));
vi.mock("../storage/pipeline_coordinator.js", () => ({
  coordinateExtractedCase: (...args) => mockCoordinate(...args),
  splitFtsChunks: (text) => [text],
}));

import worker from "../cloudflare-native.js";

function stores() {
  return {
    objectStore: {
      putVerified: vi.fn(async ({ key, body, contentType }) => ({
        key,
        sha256: "b".repeat(64),
        size: new TextEncoder().encode(body).byteLength,
        contentType,
      })),
      getVerifiedText: vi.fn(async () => "canonical case text"),
      deleteVerified: vi.fn(async () => undefined),
    },
    caseStore: {
      getCase: vi.fn(async () => ({ case_id: "0123456789ab", title: "Example", citation: "[2026] FCA 1", court_code: "FCA", year: 2026, source: "austlii", visa_subclass: "482" })),
      markSemanticReady: vi.fn(async () => undefined),
      markAggregatesDirty: vi.fn(async () => true),
      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
      claimRebuildLease: vi.fn(async () => ({ token: "queue-lease", leaseSeconds: 900 })),
      releaseRebuildLease: vi.fn(async () => true),
      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
    },
    semanticIndex: {
      embed: vi.fn(async () => Array(1024).fill(0)),
      upsertCase: vi.fn(async () => ({ mutationId: "mutation-1" })),
      deleteCase: vi.fn(async () => undefined),
    },
    pipelineStore: {
      recordDeadLetter: vi.fn(async () => undefined),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Cloudflare-native case mutation queue", () => {
  it("records a case mutation dead-letter payload in R2 and Ops D1", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: { kind: "case.reindex", event_id: "case.reindex:abc" },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ queue: "immi-case-mutation-dlq", messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.putVerified).toHaveBeenCalledWith(expect.objectContaining({
      key: expect.stringMatching(/^imports\/dlq\/immi-case-mutation-dlq\//),
      contentType: "application/json",
    }));
    expect(current.pipelineStore.recordDeadLetter).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "case.reindex:abc",
      outboxEventId: "case.reindex:abc",
      reason: "queue:immi-case-mutation-dlq",
    }));
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("verifies the R2 pointer before re-embedding and marks semantic-ready", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.reindex", case_id: "0123456789ab", content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
        content_sha256: "a".repeat(64), content_size: 20, content_type: "text/plain; charset=utf-8",
      },
      ack: vi.fn(), retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({ contentType: "text/plain; charset=utf-8" }));
    expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith("0123456789ab", expect.any(Array), expect.objectContaining({ court_code: "FCA", year: 2026 }));
    expect(current.caseStore.markSemanticReady).toHaveBeenCalledWith("0123456789ab", "mutation-1");
    // A queue batch must never pay for a full rebuild; it only flags staleness.
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries when the verified source or embedding fails", async () => {
    const current = stores();
    current.objectStore.getVerifiedText.mockRejectedValue(new Error("checksum mismatch"));
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("hands pointer-addressed extraction payloads to the storage coordinator", async () => {
    const current = stores();
    current.objectStore.getVerifiedJson = vi.fn(async () => ({
      record: { case_id: "0123456789ab", title: "Example" },
      canonicalText: "canonical text",
      audit: [],
    }));
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.extracted", event_id: "case.extracted:run:0123456789ab", run_id: "run",
        payload_key: "pipeline/run/0123456789ab.json", payload_sha256: "a".repeat(64), payload_size: 100,
        payload_content_type: "application/json",
      },
      ack: vi.fn(), retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({ key: message.body.payload_key }), expect.objectContaining({ prefix: "pipeline" }));
    expect(mockCoordinate).toHaveBeenCalledWith(expect.objectContaining({ eventId: message.body.event_id, runId: "run", canonicalText: "canonical text" }));
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("flags catalog aggregates as stale for a mutation-triggered refresh event", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: { kind: "catalog.rebuild", event_id: "catalog.rebuild:abc" },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("uses the fallback rebuild only when the cron path has gone quiet", async () => {
    const current = stores();
    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_FALLBACK_SECONDS: "1800" });

    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 1800 });
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "queue-lease", leaseSeconds: 900 } });
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "queue-lease" });
  });

  it("defaults the fallback window to an hour when unset", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 3600 });
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
  });

  it("does not rebuild from the queue path when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.aggregatesNeedRebuild.mockResolvedValue({ due: true, reason: "dirty" });
    current.caseStore.claimRebuildLease.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);
    const message = { body: { kind: "case.reindex", case_id: "0123456789ab" }, ack: vi.fn(), retry: vi.fn() };

    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("coalesces many mutations in one batch into a single stale flag", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const messages = Array.from({ length: 20 }, (_, index) => ({
      body: { kind: "case.reindex", case_id: "0123456789ab", event_id: `case.reindex:${index}` },
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    await worker.queue({ messages }, { IMMI_STORAGE_MODE: "cloudflare" });
    // 20 mutations used to mean one 584k-row rebuild; now they mean one row.
    expect(current.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(1);
    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    for (const message of messages) expect(message.ack).toHaveBeenCalledOnce();
  });

  it("deletes a case source only through its validated R2 pointer", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const message = {
      body: {
        kind: "case.source.delete",
        case_id: "0123456789ab",
        content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
        content_sha256: "a".repeat(64),
        content_size: 20,
        content_type: "text/plain; charset=utf-8",
      },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await worker.queue({ messages: [message] }, { IMMI_STORAGE_MODE: "cloudflare" });
    expect(current.objectStore.deleteVerified).toHaveBeenCalledWith(
      expect.objectContaining({ key: message.body.content_key, sha256: message.body.content_sha256 }),
      { prefix: "cases" },
    );
    expect(message.ack).toHaveBeenCalledOnce();
  });
});
