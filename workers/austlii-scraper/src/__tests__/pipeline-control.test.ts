import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startPipelineRun: vi.fn(async () => "11111111-1111-4111-8111-111111111111"),
  runDiscoveryAndEnqueue: vi.fn(async () => undefined),
  updateControlCommand: vi.fn(async () => undefined),
  latestRunningPipelineRun: vi.fn(async () => "11111111-1111-4111-8111-111111111111"),
  findCasesMissingContent: vi.fn(async () => [{ case_id: "abcdef123456", url: "https://example.com/case", citation: "[2026] FCA 1", court_code: "FCA", title: "Case", phase: "scrape" }]),
  requestPipelineStop: vi.fn(async () => undefined),
  recordPipelineDeadLetter: vi.fn(async () => undefined),
  isPipelineStopRequested: vi.fn(async () => false),
  scrapeLegislation: vi.fn(async () => undefined),
}));

vi.mock("../discover", () => ({
  discoverCourt: vi.fn(),
  runDiscoveryAndEnqueue: mocks.runDiscoveryAndEnqueue,
}));
vi.mock("../pipeline-db", () => ({
  addPipelineRunMetrics: vi.fn(),
  assertSchemaConsistent: vi.fn(),
  findCasesMissingContent: mocks.findCasesMissingContent,
  isPipelineStopRequested: mocks.isPipelineStopRequested,
  latestRunningPipelineRun: mocks.latestRunningPipelineRun,
  requestPipelineStop: mocks.requestPipelineStop,
  recordPipelineDeadLetter: mocks.recordPipelineDeadLetter,
  startPipelineRun: mocks.startPipelineRun,
  updateControlCommand: mocks.updateControlCommand,
  updatePipelineRun: vi.fn(),
}));
vi.mock("../legislation", () => ({ scrapeLegislation: mocks.scrapeLegislation }));

import worker from "../index";
import type { Env } from "../types";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function env(): Env {
  return {
    PIPELINE_ENABLED: "true",
    NATIVE_PIPELINE_ENABLED: "true",
    CASE_RESULTS: {} as R2Bucket,
  } as unknown as Env;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startPipelineRun.mockResolvedValue(RUN_ID);
  mocks.latestRunningPipelineRun.mockResolvedValue(RUN_ID);
  mocks.runDiscoveryAndEnqueue.mockResolvedValue(undefined);
  mocks.isPipelineStopRequested.mockResolvedValue(false);
  mocks.findCasesMissingContent.mockResolvedValue([{ case_id: "abcdef123456", url: "https://example.com/case", citation: "[2026] FCA 1", court_code: "FCA", title: "Case", phase: "scrape" }]);
  mocks.scrapeLegislation.mockResolvedValue(undefined);
});

describe("native pipeline control queue", () => {
  it("records and acknowledges a pipeline dead-letter message", async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    await worker.queue({
      queue: "immi-extract-dlq",
      messages: [{ body: { kind: "case.extracted", event_id: "event-1" }, ack, retry }],
    } as never, env());
    expect(mocks.recordPipelineDeadLetter).toHaveBeenCalledWith(
      expect.anything(), "immi-extract-dlq", undefined, { kind: "case.extracted", event_id: "event-1" },
    );
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("starts a manual discovery run and completes its command", async () => {
    const ack = vi.fn();
    await worker.queue({
      queue: "immi-pipeline-control-queue",
      messages: [{ body: { kind: "pipeline.control", command_id: "cmd-start", action: "start", courts: ["FCA"] }, ack, retry: vi.fn() }],
    } as never, env());
    expect(mocks.startPipelineRun).toHaveBeenCalledWith(expect.anything(), { trigger: "manual", courts: ["FCA"], phase: "discovery" });
    expect(mocks.runDiscoveryAndEnqueue).toHaveBeenCalledWith(expect.anything(), RUN_ID, ["FCA"]);
    expect(mocks.updateControlCommand).toHaveBeenCalledWith(expect.anything(), "cmd-start", { status: "completed", runId: RUN_ID });
    expect(ack).toHaveBeenCalledOnce();
  });

  it("sets an operator stop marker for the latest running run", async () => {
    const ack = vi.fn();
    await worker.queue({
      queue: "immi-pipeline-control-queue",
      messages: [{ body: { kind: "pipeline.control", command_id: "cmd-stop", action: "stop" }, ack, retry: vi.fn() }],
    } as never, env());
    expect(mocks.requestPipelineStop).toHaveBeenCalledWith(expect.anything(), RUN_ID);
    expect(mocks.updateControlCommand).toHaveBeenCalledWith(expect.anything(), "cmd-stop", { status: "completed", runId: RUN_ID });
    expect(ack).toHaveBeenCalledOnce();
  });

  it("queues only catalog cases without a native content pointer for download", async () => {
    const ack = vi.fn();
    const sendBatch = vi.fn(async () => undefined);
    const current = env();
    current.SCRAPE_QUEUE = { sendBatch } as never;
    await worker.queue({
      queue: "immi-pipeline-control-queue",
      messages: [{ body: { kind: "pipeline.control", command_id: "cmd-download", action: "download", courts: ["FCA"], limit: 1 }, ack, retry: vi.fn() }],
    } as never, current);
    expect(mocks.findCasesMissingContent).toHaveBeenCalledWith(expect.anything(), ["FCA"], 1);
    expect(sendBatch).toHaveBeenCalledWith([expect.objectContaining({ body: expect.objectContaining({ run_id: RUN_ID, phase: "scrape" }) })]);
    expect(ack).toHaveBeenCalledOnce();
  });

  it("runs a validated legislation update through the native R2 importer", async () => {
    const ack = vi.fn();
    await worker.queue({
      queue: "immi-pipeline-control-queue",
      messages: [{ body: { kind: "pipeline.control", command_id: "cmd-law", action: "legislation_update", law_ids: ["migration-act-1958"] }, ack, retry: vi.fn() }],
    } as never, env());
    expect(mocks.scrapeLegislation).toHaveBeenCalledWith(expect.anything(), "migration-act-1958");
    expect(mocks.updateControlCommand).toHaveBeenCalledWith(expect.anything(), "cmd-law", { status: "completed" });
    expect(ack).toHaveBeenCalledOnce();
  });
});
