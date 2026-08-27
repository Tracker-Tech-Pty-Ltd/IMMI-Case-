import { beforeEach, describe, expect, it, vi } from "vitest";

const { addMetrics, markAttempt, markPublished, stageOutbox, updateRun } = vi.hoisted(() => ({
  addMetrics: vi.fn(async () => undefined),
  markAttempt: vi.fn(async () => undefined),
  markPublished: vi.fn(async () => undefined),
  stageOutbox: vi.fn(async () => "pending"),
  updateRun: vi.fn(async () => undefined),
}));
vi.mock("../pipeline-db", () => ({
  addPipelineRunMetrics: addMetrics,
  markNativeOutboxAttempt: markAttempt,
  markNativeOutboxPublished: markPublished,
  stageNativeOutboxEvent: stageOutbox,
  updatePipelineRun: updateRun,
}));

import { handleExtractBatch } from "../extract";

const CASE_ID = "abcdef123456";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

function baseEnv(overrides: Record<string, unknown> = {}) {
  const nativeMessages: unknown[] = [];
  const ack = vi.fn();
  const costCalls: Array<{ ledger: string; url: string; usd: number | null }> = [];
  return {
    env: {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      CASE_RESULTS: {
        get: vi.fn(async () => ({
          json: async () => ({ success: true, full_text: "scraped source text", date: "2026-01-01" }),
        })),
        put: vi.fn(async () => undefined),
      },
      NATIVE_CASE_QUEUE: {
        send: vi.fn(async (message: unknown) => { nativeMessages.push(message); }),
      },
      EXTRACTION_BACKEND: {
        fetch: vi.fn(async () => Response.json({
          extracted: [{
            case_id: CASE_ID,
            base: { title: "Example", citation: "[2026] FCA 1", full_text: "canonical source text" },
            fields: { case_nature: { value: "Protection", confidence: 0.9, source: "llm" } },
          }],
          llm_calls: 1,
          cost_usd: 0.1,
        })),
      },
      COST_CAP_DO: {
        idFromName: (name: string) => name,
        get: (ledger: string) => ({
          fetch: vi.fn(async (input: string, init?: RequestInit) => {
            const usd = init?.body ? Number(JSON.parse(String(init.body)).usd) : null;
            costCalls.push({ ledger, url: input, usd });
            if (input.includes("/remaining")) return Response.json({ remaining_usd: 5 });
            return Response.json({ spent_usd: usd ?? 0 });
          }),
        }),
      },
      ...overrides,
    },
    nativeMessages,
    ack,
    costCalls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("native extraction handoff", () => {
  it("writes an R2 payload and sends only a pointer event to the coordinator Queue", async () => {
    const current = baseEnv();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry: vi.fn() }],
    } as never, current.env as never);
    expect(current.env.CASE_RESULTS.put).toHaveBeenCalledWith(expect.stringMatching(`^pipeline/${RUN_ID}/${CASE_ID}\\.json$`), expect.any(Uint8Array), expect.objectContaining({ customMetadata: expect.objectContaining({ sha256: expect.any(String) }) }));
    expect(current.nativeMessages).toHaveLength(1);
    expect(current.nativeMessages[0]).toMatchObject({ kind: "case.extracted", run_id: RUN_ID, payload_key: `pipeline/${RUN_ID}/${CASE_ID}.json` });
    expect(stageOutbox).toHaveBeenCalledWith(current.env, expect.objectContaining({
      eventId: `case.extracted:${RUN_ID}:${CASE_ID}`,
      payloadKey: `pipeline/${RUN_ID}/${CASE_ID}.json`,
    }));
    expect(markAttempt).toHaveBeenCalledWith(current.env, `case.extracted:${RUN_ID}:${CASE_ID}`);
    expect(markPublished).toHaveBeenCalledWith(current.env, `case.extracted:${RUN_ID}:${CASE_ID}`);
    expect(addMetrics).toHaveBeenCalledWith(current.env, RUN_ID, expect.objectContaining({ upserted: 1 }));
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it("does not duplicate a coordinator event already marked published", async () => {
    stageOutbox.mockResolvedValueOnce("published");
    const current = baseEnv();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry: vi.fn() }],
    } as never, current.env as never);
    expect(stageOutbox).toHaveBeenCalledOnce();
    expect(current.env.NATIVE_CASE_QUEUE.send).not.toHaveBeenCalled();
    expect(markAttempt).not.toHaveBeenCalled();
    expect(markPublished).not.toHaveBeenCalled();
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it("retries extraction rather than falling back to a legacy DB writer", async () => {
    const current = baseEnv({ NATIVE_PIPELINE_ENABLED: "false" });
    const retry = vi.fn();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry }],
    } as never, current.env as never);
    expect(retry).toHaveBeenCalledOnce();
    expect(current.env.NATIVE_CASE_QUEUE.send).not.toHaveBeenCalled();
    expect(current.ack).not.toHaveBeenCalled();
  });

  it("fails closed when the extraction service secret is absent", async () => {
    const current = baseEnv({ EXTRACTION_SHARED_SECRET: undefined });
    const retry = vi.fn();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry }],
    } as never, current.env as never);
    expect(retry).toHaveBeenCalledOnce();
    expect(current.env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
  });

  it("charges both the run and the month ledger", async () => {
    const current = baseEnv();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry: vi.fn() }],
    } as never, current.env as never);
    expect(current.costCalls.filter((call) => call.url.includes("/charge")).map((call) => call.ledger)).toEqual([
      `run:${RUN_ID}`,
      `month:${new Date().toISOString().slice(0, 7)}`,
    ]);
  });

  it("aborts the run when a ledger reports zero remaining", async () => {
    const current = baseEnv({
      COST_CAP_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async (input: string) => {
            if (input.includes("/remaining")) return Response.json({ remaining_usd: 0 });
            return Response.json({ spent_usd: 0 });
          }),
        }),
      },
    });
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry: vi.fn() }],
    } as never, current.env as never);
    expect(updateRun).toHaveBeenCalledWith(current.env, RUN_ID, expect.objectContaining({ status: "aborted", abortReason: "cost_cap_hit" }));
    expect(current.env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
    expect(current.ack).toHaveBeenCalledOnce();
  });

  it("retries instead of aborting when a cost ledger returns a malformed body", async () => {
    const current = baseEnv({
      COST_CAP_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async () => Response.json({})),
        }),
      },
    });
    const retry = vi.fn();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry }],
    } as never, current.env as never);
    expect(retry).toHaveBeenCalledOnce();
    expect(current.ack).not.toHaveBeenCalled();
    expect(current.env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalledWith(current.env, RUN_ID, expect.objectContaining({ abortReason: "cost_cap_hit" }));
  });

  it("retries when the cost ledger throws", async () => {
    const current = baseEnv({
      COST_CAP_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: vi.fn(async () => { throw new Error("ledger unreachable"); }),
        }),
      },
    });
    const retry = vi.fn();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry }],
    } as never, current.env as never);
    expect(retry).toHaveBeenCalledOnce();
    expect(current.ack).not.toHaveBeenCalled();
    expect(current.env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalledWith(current.env, RUN_ID, expect.objectContaining({ abortReason: "cost_cap_hit" }));
  });

  it("fails closed when the cost cap binding is absent", async () => {
    const current = baseEnv({ COST_CAP_DO: undefined });
    const retry = vi.fn();
    await handleExtractBatch({
      messages: [{ body: { phase: "extract", run_id: RUN_ID, case_id: CASE_ID, court_code: "FCA", r2_key: "runs/source.json", scraped_at: new Date().toISOString() }, ack: current.ack, retry }],
    } as never, current.env as never);
    expect(retry).toHaveBeenCalledOnce();
    expect(current.env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
  });
});
