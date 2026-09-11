import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCreateStores = vi.fn();
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
  // The scheduled handler deliberately uses the D1-only factory so the cron
  // cannot fail because R2/Vectorize/AI are unavailable.
  createCloudflareCaseStore: () => mockCreateStores().caseStore,
}));
vi.mock("../storage/pipeline_coordinator.js", () => ({
  coordinateExtractedCase: vi.fn(async () => ({ status: "completed" })),
  splitFtsChunks: (text) => [text],
}));

import worker from "../cloudflare-native.js";

function stores(decision = { due: true, reason: "dirty" }) {
  return {
    caseStore: {
      aggregatesNeedRebuild: vi.fn(async () => decision),
      // The post-lease re-check: default to "work still pending" so the usual
      // tests exercise the rebuild; the TOCTOU test overrides it.
      aggregatesStillPending: vi.fn(async () => ({ pending_generation: 1, applied_generation: 0, pending: true })),
      rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
      markAggregatesDirty: vi.fn(async () => true),
      claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
      releaseRebuildLease: vi.fn(async () => true),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("Cloudflare-native scheduled aggregate rebuild", () => {
  it("rebuilds once when the aggregates are dirty", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({ cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 900 });
    expect(current.caseStore.rebuildAggregates).toHaveBeenCalledWith({ lease: { token: "cron-lease", leaseSeconds: 900 } });
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
    expect(result).toMatchObject({ due: true, rebuilt_at: "2026-09-10T00:00:00.000Z" });
  });

  it("does not rebuild while the interval is still debouncing", async () => {
    const current = stores({ due: false, reason: "debounced", seconds_until_due: 120 });
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: false, reason: "debounced" });
  });

  it("does not rebuild when nothing changed", async () => {
    const current = stores({ due: false, reason: "clean" });
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
  });

  it("honours the configured lease length", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_LEASE_SECONDS: "1800" });

    expect(current.caseStore.claimRebuildLease).toHaveBeenCalledWith({ leaseSeconds: 1800 });
  });

  it("honours the configured minimum interval", async () => {
    const current = stores({ due: false, reason: "debounced", seconds_until_due: 30 });
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: "600" });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 600, quietSeconds: 300, maxStalenessSeconds: 21600 });
  });

  it("falls back to the default interval when the variable is missing or invalid", async () => {
    for (const value of [undefined, "", "not-a-number", "0", "-5"]) {
      const current = stores({ due: false, reason: "debounced" });
      mockCreateStores.mockReturnValue(current);
      await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare", AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS: value });
      expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });
    }
  });

  it("skips the rebuild when another invocation holds the lease", async () => {
    const current = stores();
    current.caseStore.claimRebuildLease.mockResolvedValue(null);
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(current.caseStore.releaseRebuildLease).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: "lease_held" });
  });

  it("releases the lease even when the rebuild fails", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
    expect(current.caseStore.releaseRebuildLease).toHaveBeenCalledWith({ token: "cron-lease" });
  });

  it("reads the quiet window and staleness bound from the environment", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);

    await worker.scheduled({}, {
      IMMI_STORAGE_MODE: "cloudflare",
      AGGREGATE_REBUILD_QUIET_SECONDS: "120",
      AGGREGATE_REBUILD_MAX_STALENESS_SECONDS: "7200",
    });

    expect(current.caseStore.aggregatesNeedRebuild).toHaveBeenCalledWith({
      minIntervalSeconds: 300, quietSeconds: 120, maxStalenessSeconds: 7200,
    });
  });

  it("reports a quiet-window deferral instead of rebuilding", async () => {
    const current = stores({ due: false, reason: "awaiting-quiet", seconds_until_quiet: 42 });
    mockCreateStores.mockReturnValue(current);

    const result = await worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" });

    expect(current.caseStore.rebuildAggregates).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: false, reason: "awaiting-quiet" });
  });

  it("surfaces a failed rebuild to the runtime so the cron is retried", async () => {
    const current = stores();
    current.caseStore.rebuildAggregates.mockRejectedValue(new Error("D1 unavailable"));
    mockCreateStores.mockReturnValue(current);

    await expect(worker.scheduled({}, { IMMI_STORAGE_MODE: "cloudflare" })).rejects.toThrow(/D1 unavailable/);
  });

  it("skips the rebuild when another invocation already applied the work", async () => {
    // The TOCTOU case: a decision computed before another invocation finished is
    // stale, and 20 in-flight queue batches each rebuilt (measured) without this.
    mockCreateStores.mockReturnValue({
      caseStore: {
        aggregatesNeedRebuild: vi.fn(async () => ({ due: true, reason: "dirty" })),
        aggregatesStillPending: vi.fn(async () => ({ pending_generation: 4, applied_generation: 4, pending: false })),
        rebuildAggregates: vi.fn(async () => ({ rebuilt_at: "2026-09-10T00:00:00.000Z" })),
        claimRebuildLease: vi.fn(async () => ({ token: "cron-lease", leaseSeconds: 900 })),
        releaseRebuildLease: vi.fn(async () => true),
      },
    });

    await worker.scheduled({ scheduledTime: 1, cron: "*/5 * * * *" }, { IMMI_STORAGE_MODE: "cloudflare" });

    const store = mockCreateStores.mock.results.at(-1).value.caseStore;
    expect(store.rebuildAggregates).not.toHaveBeenCalled();
    expect(store.releaseRebuildLease).toHaveBeenCalled();
  });
});
