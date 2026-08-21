import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { coordinateExtractedCase, splitFtsChunks } from "../storage/pipeline_coordinator.js";
import { FTS_CHUNK_MAX_BYTES } from "../storage/contracts.js";

const CASE_ID = "0123456789ab";
const RUN_ID = "run-20260810";
const EVENT_ID = "event-20260810-0001";

function stores(log, { claimed = true, completed = false } = {}) {
  return {
    pipelineStore: {
      ensurePipelineRun: vi.fn(async () => log.push("ensure-run")),
      claimEvent: vi.fn(async () => { log.push("claim"); return claimed; }),
      isEventComplete: vi.fn(async () => { log.push("check-complete"); return completed; }),
      recordExtractionAudit: vi.fn(async () => log.push("audit")),
      pipelineCheckpoint: vi.fn(async ({ step }) => log.push(`${step}-checkpoint`)),
      completeEvent: vi.fn(async () => log.push("complete-event")),
    },
    objectStore: {
      putCaseSource: vi.fn(async () => {
        log.push("r2");
        return {
          key: `cases/${CASE_ID}/source/${"a".repeat(64)}.txt`,
          sha256: "a".repeat(64), size: 20, contentType: "text/plain; charset=utf-8",
        };
      }),
    },
    caseStore: {
      putImportedCase: vi.fn(async () => log.push("catalog")),
      markSemanticReady: vi.fn(async () => log.push("semantic-ready")),
    },
    semanticIndex: {
      embed: vi.fn(async () => { log.push("embed"); return Array(1024).fill(0); }),
      upsertCase: vi.fn(async () => { log.push("vectorize"); return { mutationId: "mutation-1" }; }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Cloudflare pipeline storage coordinator", () => {
  it("writes extracted data in the fixed R2 → Catalog → Vectorize → Ops order", async () => {
    const log = [];
    const current = stores(log);
    mockCreateStores.mockReturnValue(current);
    const result = await coordinateExtractedCase({
      env: { IMMI_STORAGE_MODE: "cloudflare" },
      eventId: EVENT_ID,
      runId: RUN_ID,
      record: { case_id: CASE_ID, court_code: "FCA", year: 2026, visa_subclass: "482" },
      canonicalText: "Canonical legal case text",
      audit: [{ fieldName: "case_nature", newValue: "review", source: "llm", confidence: 0.9 }],
    });

    expect(result).toMatchObject({ status: "completed", eventId: EVENT_ID, caseId: CASE_ID });
    expect(log).toEqual([
      "ensure-run", "claim", "r2", "r2-checkpoint", "catalog", "catalog-checkpoint",
      "embed", "vectorize", "semantic-ready", "vectorize-checkpoint", "audit",
      "ops-checkpoint", "complete-event",
    ]);
    expect(current.semanticIndex.upsertCase).toHaveBeenCalledWith(
      CASE_ID,
      expect.any(Array),
      { court_code: "FCA", year: 2026, source: "austlii-pipeline", visa_subclass: "482" },
    );
    expect(current.pipelineStore.recordExtractionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: `${EVENT_ID}:case_nature` }),
    );
  });

  it("does not rewrite data when the same completed event is replayed", async () => {
    const log = [];
    const current = stores(log, { claimed: false, completed: true });
    mockCreateStores.mockReturnValue(current);
    const result = await coordinateExtractedCase({
      env: { IMMI_STORAGE_MODE: "cloudflare" },
      eventId: EVENT_ID,
      runId: RUN_ID,
      record: { case_id: CASE_ID },
      canonicalText: "Canonical legal case text",
    });

    expect(result).toEqual({ status: "replayed", eventId: EVENT_ID, caseId: CASE_ID });
    expect(current.objectStore.putCaseSource).not.toHaveBeenCalled();
    expect(log).toEqual(["ensure-run", "claim", "check-complete"]);
  });

  it("replays an incomplete claim through deterministic writes", async () => {
    const log = [];
    const current = stores(log, { claimed: false, completed: false });
    mockCreateStores.mockReturnValue(current);
    const result = await coordinateExtractedCase({
      env: { IMMI_STORAGE_MODE: "cloudflare" },
      eventId: EVENT_ID,
      runId: RUN_ID,
      record: { case_id: CASE_ID },
      canonicalText: "Canonical legal case text",
      audit: [{ fieldName: "outcome", newValue: "allowed", source: "regex" }],
    });
    expect(result.status).toBe("completed");
    expect(current.pipelineStore.recordExtractionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ auditId: `${EVENT_ID}:outcome` }),
    );
    expect(log).toContain("complete-event");
  });

  it("splits canonical text under the D1 FTS byte guard", () => {
    const chunks = splitFtsChunks("x".repeat(FTS_CHUNK_MAX_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(new TextEncoder().encode(chunks[0]).byteLength).toBeLessThanOrEqual(FTS_CHUNK_MAX_BYTES);
    expect(new TextEncoder().encode(chunks[1]).byteLength).toBeLessThanOrEqual(FTS_CHUNK_MAX_BYTES);
  });
});
