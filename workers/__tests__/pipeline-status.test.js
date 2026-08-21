import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { handleJobStatus, handlePipelineStatus } from "../pipeline/cloudflare_handlers.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateStores.mockReturnValue({
    pipelineStore: {
      listRuns: vi.fn(async () => ({
        runs: [{
          run_id: "run-1",
          status: "running",
          phase: "extract",
          discovered: 10,
          scraped: 8,
          extracted: 6,
          upserted: 0,
          errors: 1,
        }],
        summary: {},
      })),
    },
  });
});

describe("Cloudflare-native pipeline status contracts", () => {
  it("maps an Ops D1 run into the legacy pipeline status shape", async () => {
    const response = await handlePipelineStatus({ IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      running: true,
      phase: "extract",
      overall_progress: 80,
      native: true,
      stats: { download: { downloaded: 8, failed: 1 } },
    });
  });

  it("maps the same run into the job status shape", async () => {
    const response = await handleJobStatus({ IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      running: true,
      type: "native-pipeline",
      total: 10,
      completed: 8,
      native: true,
    });
  });

  it("fails closed when the Ops D1 boundary is unavailable", async () => {
    mockCreateStores.mockReturnValue({ pipelineStore: { listRuns: vi.fn(async () => { throw new Error("D1 down"); }) } });
    const response = await handlePipelineStatus({ IMMI_STORAGE_MODE: "cloudflare" });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "pipeline_store_unavailable" });
  });

  it("treats the native scraper's ok status as a completed run", async () => {
    mockCreateStores.mockReturnValue({
      pipelineStore: {
        listRuns: vi.fn(async () => ({ runs: [{ status: "ok", discovered: 10, scraped: 10, extracted: 10, upserted: 10 }] })),
      },
    });
    const response = await handlePipelineStatus({ IMMI_STORAGE_MODE: "cloudflare" });
    expect(await response.json()).toMatchObject({
      running: false,
      overall_progress: 100,
      phases_completed: ["discovery", "scrape", "extract", "store"],
    });
  });
});
