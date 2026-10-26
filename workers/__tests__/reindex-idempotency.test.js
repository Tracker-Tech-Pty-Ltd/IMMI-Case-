import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockCreateStores(...args) }));
vi.mock("../storage/pipeline_coordinator.js", () => ({
  coordinateExtractedCase: vi.fn(async () => ({ status: "completed" })),
  splitFtsChunks: (text) => [text],
}));

import worker, { CaseMutationDO } from "../cloudflare-native.js";

const CASE_ID = "0123456789ab";
const SHA = "a".repeat(64);
const coordinators = new Map();
const ENV = {
  IMMI_STORAGE_MODE: "cloudflare",
  CASE_MUTATION_COORDINATOR: {
    getByName(name) {
      if (!coordinators.has(name)) coordinators.set(name, new CaseMutationDO({}, ENV));
      return coordinators.get(name);
    },
  },
};

/**
 * Stores whose caseStore actually remembers markSemanticReady(), so a second
 * queue delivery observes what the first one wrote. Without that, a "redelivery"
 * test is just the same first delivery run twice and cannot detect re-billing.
 */
function statefulStores({ semanticReady = 0, contentSha = SHA } = {}) {
  const row = {
    case_id: CASE_ID,
    title: "Example",
    citation: "[2026] FCA 1",
    court_code: "FCA",
    year: 2026,
    source: "austlii",
    visa_subclass: "482",
    content_sha256: contentSha,
    content_key: `cases/${CASE_ID}/source/${contentSha}.txt`, content_size: 20,
    vector_mutation_id: "pending:version-1",
    semantic_ready: semanticReady,
  };
  return {
    row,
    objectStore: {
      getVerifiedText: vi.fn(async () => "canonical case text"),
      deleteVerified: vi.fn(async () => undefined),
      putVerified: vi.fn(async () => ({ key: "k", sha256: "b".repeat(64), size: 1, contentType: "application/json" })),
    },
    caseStore: {
      getCase: vi.fn(async () => ({ ...row })),
      markSemanticReady: vi.fn(async (_id, mutation) => {
        row.semantic_ready = 1;
        row.vector_mutation_id = mutation;
        return true;
      }),
      markAggregatesDirty: vi.fn(async () => true),
      aggregatesNeedRebuild: vi.fn(async () => ({ due: false, reason: "debounced" })),
      rebuildAggregates: vi.fn(async () => undefined),
    },
    semanticIndex: {
      // The paid pair: Workers AI inference, then a Vectorize write.
      embed: vi.fn(async () => Array(1024).fill(0)),
      upsertCase: vi.fn(async () => ({ mutationId: "mutation-1" })),
      deleteCase: vi.fn(async () => undefined),
    },
    pipelineStore: { recordDeadLetter: vi.fn(async () => undefined) },
  };
}

function reindexMessage() {
  return {
    body: {
      kind: "case.reindex",
      case_id: CASE_ID,
      content_key: `cases/${CASE_ID}/source/${SHA}.txt`,
      content_sha256: SHA,
      content_size: 20,
      content_type: "text/plain; charset=utf-8",
    },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

beforeEach(() => { vi.clearAllMocks(); coordinators.clear(); });

describe("case.reindex does not re-buy an embedding it already has", () => {
  // The defect: handleCaseMutationQueue runs every message, then durably marks analytics dirty. If that handoff throws, EVERY handled
  // message is retried — including reindexes that fully succeeded. Redelivery
  // then repeats the Workers AI embed and the Vectorize upsert, and after
  // max_retries the message lands in the DLQ because of an analytics fault that
  // had nothing to do with it.
  it("skips embedding when the vector already matches this exact content", async () => {
    const stores = statefulStores({ semanticReady: 1 });
    mockCreateStores.mockReturnValue(stores);
    const message = reindexMessage();

    await worker.queue({ messages: [message] }, ENV);

    expect(stores.semanticIndex.embed).not.toHaveBeenCalled();
    expect(stores.semanticIndex.upsertCase).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("keeps a completed current vector when a historical event has a different hash", async () => {
    const stores = statefulStores({ semanticReady: 1, contentSha: "b".repeat(64) });
    mockCreateStores.mockReturnValue(stores);

    await worker.queue({ messages: [reindexMessage()] }, ENV);

    // The event is obsolete. Only the live row decides what needs indexing.
    expect(stores.semanticIndex.embed).not.toHaveBeenCalled();
    expect(stores.semanticIndex.upsertCase).not.toHaveBeenCalled();
  });

  it("re-embeds when the case is not marked semantic-ready", async () => {
    const stores = statefulStores({ semanticReady: 0 });
    mockCreateStores.mockReturnValue(stores);

    await worker.queue({ messages: [reindexMessage()] }, ENV);

    expect(stores.semanticIndex.embed).toHaveBeenCalledOnce();
    expect(stores.caseStore.markSemanticReady).toHaveBeenCalledWith(CASE_ID, "mutation-1", expect.objectContaining({ vector_mutation_id: "pending:version-1" }));
  });

  it("does not re-buy a completed current version when an event omits its old hash", async () => {
    const stores = statefulStores({ semanticReady: 1 });
    mockCreateStores.mockReturnValue(stores);
    const message = reindexMessage();
    delete message.body.content_sha256;

    await worker.queue({ messages: [message] }, ENV);

    expect(stores.semanticIndex.embed).not.toHaveBeenCalled();
  });

  // The scenario the review named, played out across two real deliveries.
  it("does not repeat the paid work when persisting the aggregate dirty mark fails and the message is redelivered", async () => {
    const stores = statefulStores({ semanticReady: 0 });
    stores.caseStore.markAggregatesDirty.mockRejectedValueOnce(new Error("D1 aggregate query failed"));
    mockCreateStores.mockReturnValue(stores);

    const first = reindexMessage();
    await worker.queue({ messages: [first] }, ENV);

    // Delivery 1: the embedding succeeded, then the unrelated dirty handoff failed,
    // so the platform will redeliver.
    expect(stores.semanticIndex.embed).toHaveBeenCalledOnce();
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(first.ack).not.toHaveBeenCalled();

    const second = reindexMessage();
    await worker.queue({ messages: [second] }, ENV);

    // Delivery 2: the durable dirty handoff is retried (which is the point of the
    // redelivery) but the embedding is NOT bought a second time.
    expect(stores.semanticIndex.embed).toHaveBeenCalledOnce();
    expect(stores.semanticIndex.upsertCase).toHaveBeenCalledOnce();
    expect(stores.caseStore.markAggregatesDirty).toHaveBeenCalledTimes(2);
    expect(stores.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(second.ack).toHaveBeenCalledOnce();
  });

  it("still deletes the vector for a case that no longer exists", async () => {
    const stores = statefulStores();
    stores.caseStore.getCase.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(stores);
    const message = reindexMessage();

    await worker.queue({ messages: [message] }, ENV);

    expect(stores.semanticIndex.deleteCase).toHaveBeenCalledWith(CASE_ID);
    expect(stores.semanticIndex.embed).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
  });
});
