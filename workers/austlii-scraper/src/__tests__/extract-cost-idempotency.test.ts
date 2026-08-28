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
vi.mock("../alerts", () => ({ sendPipelineAlert: vi.fn(async () => undefined) }));

import { handleExtractBatch } from "../extract";
import { CostCapDO } from "../cost-cap-do";

const CASE_ID = "abcdef123456";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const SCRAPE_KEY = "runs/source.json";

/** In-memory R2 double. Stateful on purpose: the redelivery tests below are
 *  meaningless unless what one delivery wrote is visible to the next. */
function fakeR2() {
  const objects = new Map<string, string>();
  const decoder = new TextDecoder();
  const store = {
    objects,
    get: vi.fn(async (key: string) => {
      if (!objects.has(key)) return null;
      const raw = objects.get(key)!;
      return { json: async () => JSON.parse(raw), text: async () => raw };
    }),
    put: vi.fn(async (key: string, body: unknown) => {
      const raw = typeof body === "string" ? body : decoder.decode(body as Uint8Array);
      objects.set(key, raw);
      return undefined;
    }),
  };
  objects.set(SCRAPE_KEY, JSON.stringify({ success: true, full_text: "scraped source text", date: "2026-01-01" }));
  return store;
}

/** DurableObjectState double backed by a Map, so one ledger keeps its balance
 *  across every request a test makes. */
function fakeState() {
  const map = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => map.get(key),
      put: async (key: string, value: unknown) => { map.set(key, value); },
      delete: async (key: string) => { map.delete(key); },
    },
  };
}

/**
 * A COST_CAP_DO namespace backed by the REAL CostCapDO. Using the real object
 * rather than a hand-rolled stub is the point: the assertions below are about
 * whether the cap can actually refuse, and a stub that always says yes would
 * prove nothing.
 */
function fakeCostCapNamespace(options: { onSettle?: () => void } = {}) {
  const instances = new Map<string, CostCapDO>();
  const calls: Array<{ ledger: string; path: string; body: Record<string, unknown> | null }> = [];
  return {
    calls,
    instances,
    namespace: {
      idFromName: (name: string) => name,
      get: (ledger: string) => ({
        fetch: async (input: string | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const path = new URL(request.url).pathname;
          const raw = init?.body ? String(init.body) : null;
          calls.push({ ledger, path, body: raw ? JSON.parse(raw) : null });
          if (path === "/settle" && options.onSettle) options.onSettle();
          if (!instances.has(ledger)) instances.set(ledger, new CostCapDO(fakeState() as never));
          return instances.get(ledger)!.fetch(new Request(request.url, init));
        },
      }),
    },
  };
}

function backendResponding(costUsd: number, counter: { calls: number }) {
  return {
    fetch: vi.fn(async () => {
      counter.calls += 1;
      return Response.json({
        extracted: [{
          case_id: CASE_ID,
          base: { title: "Example", citation: "[2026] FCA 1", full_text: "canonical source text" },
          fields: { case_nature: { value: "Protection", confidence: 0.9, source: "llm" } },
        }],
        llm_calls: 1,
        cost_usd: costUsd,
      });
    }),
  };
}

function message(ack = vi.fn(), retry = vi.fn(), caseId = CASE_ID, r2Key = SCRAPE_KEY) {
  return {
    body: { phase: "extract", run_id: RUN_ID, case_id: caseId, court_code: "FCA", r2_key: r2Key, scraped_at: "2026-01-01T00:00:00.000Z" },
    ack,
    retry,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stageOutbox.mockResolvedValue("pending");
});

describe("the extraction cost cap refuses before the money is spent", () => {
  // The shipped guard treated ANY remaining > 0 as permission. With $0.01 left
  // and a batch that costs $0.10, it called the paid container anyway and only
  // then told the ledger. A cap that cannot refuse is not a cap.
  it("does not call the paid backend when the batch cannot fit in the remaining budget", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      PIPELINE_RUN_COST_CAP_USD: "0.01",
      PIPELINE_MONTHLY_HARD_CAP_USD: "10",
      CASE_RESULTS: fakeR2(),
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    };
    const ack = vi.fn();
    await handleExtractBatch({ messages: [message(ack)] } as never, env as never);

    expect(counter.calls).toBe(0);
    expect(env.EXTRACTION_BACKEND.fetch).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(env, RUN_ID, expect.objectContaining({
      status: "aborted",
      abortReason: "cost_cap_hit",
    }));
    expect(ack).toHaveBeenCalledOnce();
  });

  it("proceeds when the batch does fit, and settles the actual cost", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      PIPELINE_RUN_COST_CAP_USD: "5",
      PIPELINE_MONTHLY_HARD_CAP_USD: "10",
      CASE_RESULTS: fakeR2(),
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    };
    const ack = vi.fn();
    await handleExtractBatch({ messages: [message(ack)] } as never, env as never);

    expect(counter.calls).toBe(1);
    expect(ack).toHaveBeenCalledOnce();

    // Both ledgers hold the real figure, and nothing stays stranded.
    for (const ledger of [`run:${RUN_ID}`, `month:${new Date().toISOString().slice(0, 7)}`]) {
      const view = await (await cost.instances.get(ledger)!
        .fetch(new Request("https://cost/remaining?cap=5"))).json<{ spent_usd: number; held_usd: number }>();
      expect(view.spent_usd).toBeCloseTo(0.1, 6);
      expect(view.held_usd).toBeCloseTo(0, 6);
    }
  });

  // Reserve-then-settle is only worth anything if the reserve happens FIRST.
  it("reserves against both ledgers before it calls the backend", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      CASE_RESULTS: fakeR2(),
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: {
        fetch: vi.fn(async () => {
          // At the moment the paid call happens, both holds must already exist.
          const reserved = cost.calls.filter((call) => call.path === "/reserve").map((call) => call.ledger);
          expect(reserved).toContain(`run:${RUN_ID}`);
          expect(reserved).toContain(`month:${new Date().toISOString().slice(0, 7)}`);
          expect(cost.calls.filter((call) => call.path === "/settle")).toHaveLength(0);
          counter.calls += 1;
          return Response.json({ extracted: [], llm_calls: 0, cost_usd: 0.05 });
        }),
      },
      COST_CAP_DO: cost.namespace,
    };
    await handleExtractBatch({ messages: [message()] } as never, env as never);
    expect(counter.calls).toBe(1);
  });

  it("releases the hold when the backend call fails, so a blip does not eat the budget", async () => {
    const cost = fakeCostCapNamespace();
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      CASE_RESULTS: fakeR2(),
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: { fetch: vi.fn(async () => new Response("nope", { status: 503 })) },
      COST_CAP_DO: cost.namespace,
    };
    const retry = vi.fn();
    await handleExtractBatch({ messages: [message(vi.fn(), retry)] } as never, env as never);

    expect(retry).toHaveBeenCalledOnce();
    const view = await (await cost.instances.get(`run:${RUN_ID}`)!
      .fetch(new Request("https://cost/remaining?cap=5"))).json<{ held_usd: number; spent_usd: number }>();
    expect(view.held_usd).toBeCloseTo(0, 6);
    expect(view.spent_usd).toBeCloseTo(0, 6);
  });

  // The durable-debt property: an unreconciled spend must stop the next batch,
  // not be logged and walked past.
  it("leaves the hold in place when the settle fails, blocking further paid work", async () => {
    const counter = { calls: 0 };
    let failSettle = true;
    const cost = fakeCostCapNamespace({
      onSettle: () => { if (failSettle) throw new Error("ledger unreachable"); },
    });
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      PIPELINE_RUN_COST_CAP_USD: "5",
      PIPELINE_MONTHLY_HARD_CAP_USD: "10",
      CASE_RESULTS: fakeR2(),
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    };
    await handleExtractBatch({ messages: [message()] } as never, env as never);
    failSettle = false;

    const view = await (await cost.instances.get(`run:${RUN_ID}`)!
      .fetch(new Request("https://cost/remaining?cap=5"))).json<{ held_usd: number; remaining_usd: number }>();
    expect(view.held_usd).toBeGreaterThan(0);
    expect(view.remaining_usd).toBeLessThan(5);
  });
});

describe("a redelivered extraction does not buy the same result twice", () => {
  // The shipped code charged, then staged; a staging failure retried the WHOLE
  // message, and the next delivery re-entered at the top and called the paid
  // backend again. The outbox de-duplication sat far too late to help.
  it("reuses the persisted backend response instead of calling it again", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const r2 = fakeR2();
    const failingQueue = { send: vi.fn(async () => { throw new Error("queue down"); }) };
    const healthyQueue = { send: vi.fn(async () => undefined) };
    const base = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      PIPELINE_RUN_COST_CAP_USD: "5",
      PIPELINE_MONTHLY_HARD_CAP_USD: "10",
      CASE_RESULTS: r2,
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    };

    // Delivery 1 — staging fails, so the message is retried.
    const retry1 = vi.fn();
    await handleExtractBatch(
      { messages: [message(vi.fn(), retry1)] } as never,
      { ...base, NATIVE_CASE_QUEUE: failingQueue } as never,
    );
    expect(retry1).toHaveBeenCalledOnce();
    expect(counter.calls).toBe(1);

    // Delivery 2 — the platform redelivers the identical message.
    const ack2 = vi.fn();
    await handleExtractBatch(
      { messages: [message(ack2)] } as never,
      { ...base, NATIVE_CASE_QUEUE: healthyQueue } as never,
    );

    expect(ack2).toHaveBeenCalledOnce();
    // THE ASSERTION THAT MATTERS: still one paid call across both deliveries.
    expect(counter.calls).toBe(1);

    // ...and still one charge. Settling twice would bill the run twice.
    const view = await (await cost.instances.get(`run:${RUN_ID}`)!
      .fetch(new Request("https://cost/remaining?cap=5"))).json<{ spent_usd: number; held_usd: number }>();
    expect(view.spent_usd).toBeCloseTo(0.1, 6);
    expect(view.held_usd).toBeCloseTo(0, 6);
  });

  it("persists the backend response under a run- and batch-scoped key", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const r2 = fakeR2();
    await handleExtractBatch({ messages: [message()] } as never, {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      CASE_RESULTS: r2,
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    } as never);

    const keys = [...r2.objects.keys()].filter((key) => key.includes("/_batches/"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^pipeline/${RUN_ID}/_batches/[0-9a-f]{64}\\.json$`));
  });

  // A different set of cases in the same run must NOT collide with the cached
  // batch above, or the second batch would silently reuse the first's results.
  it("keys the cache by the case set, so a different batch is not served a stale result", async () => {
    const counter = { calls: 0 };
    const cost = fakeCostCapNamespace();
    const r2 = fakeR2();
    r2.objects.set("runs/source2.json", JSON.stringify({ success: true, full_text: "other text", date: "2026-02-02" }));
    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      EXTRACTION_SHARED_SECRET: "test-extraction-secret",
      CASE_RESULTS: r2,
      NATIVE_CASE_QUEUE: { send: vi.fn(async () => undefined) },
      EXTRACTION_BACKEND: backendResponding(0.1, counter),
      COST_CAP_DO: cost.namespace,
    };
    await handleExtractBatch({ messages: [message()] } as never, env as never);
    await handleExtractBatch(
      { messages: [message(vi.fn(), vi.fn(), "abcdef654321", "runs/source2.json")] } as never,
      env as never,
    );

    expect(counter.calls).toBe(2);
    expect([...r2.objects.keys()].filter((key) => key.includes("/_batches/"))).toHaveLength(2);
  });
});
