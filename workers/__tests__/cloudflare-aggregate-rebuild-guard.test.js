import { describe, expect, it, vi } from "vitest";
import { createCloudflareStores } from "../storage/cloudflare.js";

const REBUILD_TABLES = [
  "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
  "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
  "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
];
const BOOKKEEPING_KEYS = ["rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
  "rebuild_last_mutation_at", "rebuild_dirty_since", "rebuild_lease_until"];

function d1({ responder = () => [], changes = 1, changesFor } = {}) {
  const prepared = [];
  const binding = {
    prepared,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        all: async () => ({ results: responder(sql) }),
        first: async () => responder(sql)[0] ?? null,
        run: async () => ({ meta: { changes: changesFor ? changesFor(sql) : changes } }),
      };
      prepared.push(statement);
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
  return binding;
}

function env(options) {
  const catalog = d1(options);
  return {
    catalog,
    value: {
      IMMI_STORAGE_MODE: "cloudflare",
      IMMI_CATALOG_DB: catalog,
      IMMI_ACCOUNT_DB: d1(),
      IMMI_OPS_DB: d1(),
      IMMI_CONTENT: { put: vi.fn(), head: vi.fn(), get: vi.fn() },
      CASE_VECTORS: { queryById: vi.fn(), query: vi.fn(), upsert: vi.fn() },
      AI: { run: vi.fn() },
    },
  };
}

/** Build the bookkeeping rows the decision query reads. */
function state({ pending, applied, lastAt, attemptAt, leaseUntil, leaseToken, mutationAt, dirtySince } = {}) {
  const rows = [];
  if (pending !== undefined) rows.push({ summary_key: "rebuild_generation", value_int: pending });
  if (applied !== undefined) rows.push({ summary_key: "rebuild_applied_generation", value_int: applied });
  if (lastAt !== undefined) rows.push({ summary_key: "rebuild_last_at", value_int: lastAt });
  if (attemptAt !== undefined) rows.push({ summary_key: "rebuild_last_attempt_at", value_int: attemptAt });
  if (leaseUntil !== undefined) rows.push({ summary_key: "rebuild_lease_until", value_int: leaseUntil });
  if (leaseToken !== undefined) rows.push({ summary_key: "rebuild_lease_token", value_int: leaseToken });
  if (mutationAt !== undefined) rows.push({ summary_key: "rebuild_last_mutation_at", value_int: mutationAt });
  if (dirtySince !== undefined) rows.push({ summary_key: "rebuild_dirty_since", value_int: dirtySince });
  return rows;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("Catalog aggregate rebuild guard", () => {
  it("records staleness as a monotonic generation, not a boolean", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    // Three control rows committed as one transaction: the generation counter,
    // the mutation timestamp and the staleness clock (armed only when zero).
    expect(catalog.prepared).toHaveLength(3);
    expect(catalog.batch).toHaveBeenCalledTimes(1);
    expect(catalog.batch.mock.calls[0][0]).toHaveLength(3);
    const statement = catalog.prepared[0];
    expect(statement.sql).toMatch(/INSERT INTO catalog_summary/);
    expect(statement.sql).toMatch(/rebuild_generation/);
    expect(statement.sql).toMatch(/ON CONFLICT\(summary_key\) DO UPDATE SET value_int = catalog_summary\.value_int \+ 1/);
    expect(statement.params).toHaveLength(1);
  });

  it("stamps the mutation time and arms the staleness clock", async () => {
    const { catalog, value } = env();
    const before = nowSeconds();

    await createCloudflareStores(value).caseStore.markAggregatesDirty();

    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
    const dirtySince = catalog.prepared.find((s) => s.sql.includes("'rebuild_dirty_since'"));
    expect(mutation).toBeDefined();
    expect(Number(mutation.params[0])).toBeGreaterThanOrEqual(before);
    expect(dirtySince).toBeDefined();
    // The staleness clock only arms when it is currently zero.
    expect(dirtySince.sql).toMatch(/CASE WHEN catalog_summary\.value_int = 0/);
  });

  it("never iterates the corpus when marking dirty", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.markAggregatesDirty();

    // The only batch is the three control rows - no aggregate DELETE/INSERT.
    const batched = catalog.batch.mock.calls.flatMap((call) => call[0]);
    expect(batched).toHaveLength(3);
    expect(batched.every((s) => s.sql.includes("catalog_summary"))).toBe(true);
    expect(catalog.prepared.some((s) => /DELETE FROM|INSERT INTO aggregate_/i.test(s.sql))).toBe(false);
  });

  it("updates the mutation timestamp monotonically so clocks cannot rewind the quiet window", async () => {
    const { catalog, value } = env();

    await createCloudflareStores(value).caseStore.markAggregatesDirty();

    const mutation = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_mutation_at'"));
    expect(mutation.sql).toMatch(/value_int = MAX\(catalog_summary\.value_int, excluded\.value_int\)/);
  });

  it("reports clean when nothing is pending", async () => {
    const { value } = env({ responder: () => state({ pending: 4, applied: 4, lastAt: nowSeconds() - 3600 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toEqual({ due: false, reason: "clean" });
  });

  it("stays dirty when a mutation arrives after the applied generation", async () => {
    const { value } = env({ responder: () => state({ pending: 6, applied: 5, lastAt: nowSeconds() - 400 }) });
    const stores = createCloudflareStores(value);

    // This is the race the boolean flag could not express: the rebuild applied
    // generation 5, and generation 6 arrived while it was running.
    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty", pending_generation: 6, applied_generation: 5 });
  });

  it("debounces a pending generation inside the interval", async () => {
    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 100 }) });
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("debounced");
    expect(decision.seconds_until_due).toBeGreaterThan(0);
    expect(decision.seconds_until_due).toBeLessThanOrEqual(200);
  });

  it("rebuilds when the pending generation is older than the interval", async () => {
    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("rebuilds on the first pending generation when no rebuild timestamp exists", async () => {
    const { value } = env({ responder: () => state({ pending: 1 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("falls back to the default interval for invalid input", async () => {
    const { value } = env({ responder: () => state({ pending: 2, applied: 1, lastAt: nowSeconds() - 60 }) });
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: Number.NaN });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("debounced");
  });

  it("lets the staleness bound win over a just-stamped attempt", async () => {
    // A failed rebuild stamps an attempt; the interval must not postpone work
    // that has already exceeded the staleness bound.
    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000,
      attemptAt: nowSeconds() - 10, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
      .resolves.toMatchObject({ due: true, reason: "max-staleness" });
  });

  it("waits for a quiet window before rebuilding", async () => {
    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 30, dirtySince: nowSeconds() - 600 }) });
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("awaiting-quiet");
    expect(decision.seconds_until_quiet).toBeGreaterThan(0);
    expect(decision.seconds_until_quiet).toBeLessThanOrEqual(270);
  });

  it("rebuilds once mutations have been quiet long enough", async () => {
    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 400, dirtySince: nowSeconds() - 900 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("forces a rebuild when the staleness bound is exceeded even while mutations continue", async () => {
    const { value } = env({ responder: () => state({ pending: 9, applied: 2, lastAt: nowSeconds() - 4000, mutationAt: nowSeconds() - 5, dirtySince: nowSeconds() - 25000 }) });
    const stores = createCloudflareStores(value);

    const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300, quietSeconds: 300, maxStalenessSeconds: 21600 });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe("max-staleness");
    expect(decision.seconds_since_first_pending).toBeGreaterThanOrEqual(21600);
  });

  it("keeps the legacy behaviour when no quiet window is configured", async () => {
    const { value } = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 400, mutationAt: nowSeconds() - 1 }) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("claims the rebuild lease only when the previous lease has expired", async () => {
    const held = env({ changes: 0 });
    await expect(createCloudflareStores(held.value).caseStore.claimRebuildLease({ leaseSeconds: 600 }))
      .resolves.toBeNull();

    const free = env({ changes: 1 });
    const lease = await createCloudflareStores(free.value).caseStore.claimRebuildLease({ leaseSeconds: 600 });
    expect(lease).toMatchObject({ leaseSeconds: 600 });
    expect(typeof lease.token).toBe("string");
    expect(lease.token.length).toBeGreaterThan(7);

    // Expiry and fencing token are written by the SAME statement, so the lease
    // can never be observed in a torn state by an expiring holder.
    const statement = free.catalog.prepared[0];
    expect(statement.sql).toMatch(/rebuild_lease_until/);
    expect(statement.sql).toMatch(/WHERE catalog_summary\.value_int < \?/);
    expect(statement.params).toHaveLength(3);
    expect(statement.params[0]).toBeGreaterThan(nowSeconds());
    expect(statement.params[1]).toBe(lease.token);
  });

  it("rotates the token when a new owner claims the lease", async () => {
    const { value } = env({ changes: 1 });
    const stores = createCloudflareStores(value);

    const first = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });
    const second = await stores.caseStore.claimRebuildLease({ leaseSeconds: 900 });

    expect(first.token).not.toBe(second.token);
  });

  it("stamps the attempt time when the lease is taken", async () => {
    const { catalog, value } = env();

    const lease = await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 900 });

    const attempt = catalog.prepared.find((s) => s.sql.includes("'rebuild_last_attempt_at'"));
    expect(attempt).toBeDefined();
    expect(Number(attempt.params[0])).toBeLessThanOrEqual(nowSeconds());
    // Two statements only: the lease itself (expiry + token) and the attempt
    // stamp. There is no third write that could leave the token out of sync.
    expect(catalog.prepared).toHaveLength(2);
    expect(catalog.prepared[0].params[1]).toBe(lease.token);
  });

  it("enforces a floor on the lease length", async () => {
    const { catalog, value } = env();
    const before = nowSeconds();

    await createCloudflareStores(value).caseStore.claimRebuildLease({ leaseSeconds: 1 });

    expect(catalog.prepared[0].params[0]).toBeGreaterThanOrEqual(before + 60);
  });

  it("renews only while this caller still owns the lease", async () => {
    const owned = env({ changes: 1 });
    await expect(createCloudflareStores(owned.value).caseStore.renewRebuildLease({ token: "owner-token", leaseSeconds: 900 }))
      .resolves.toBe(true);
    const renew = owned.catalog.prepared[0];
    expect(renew.sql).toMatch(/WHERE summary_key = 'rebuild_lease_until' AND updated_at = \?/);
    expect(renew.params).toEqual([expect.any(Number), "owner-token", "owner-token"]);

    const lost = env({ changes: 0 });
    await expect(createCloudflareStores(lost.value).caseStore.renewRebuildLease({ token: "stale-token", leaseSeconds: 900 }))
      .resolves.toBe(false);
  });

  it("releases the lease only when the token still matches", async () => {
    const { catalog, value } = env();

    await createCloudflareStores(value).caseStore.releaseRebuildLease({ token: "owner-token" });

    expect(catalog.prepared[0].sql).toMatch(/UPDATE catalog_summary SET value_int = 0/);
    expect(catalog.prepared[0].sql).toMatch(/AND updated_at = \?/);
    expect(catalog.prepared[0].params).toEqual([expect.any(String), "owner-token"]);
  });

  it("refuses a release without a token", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.releaseRebuildLease()).resolves.toBe(false);
    await expect(stores.caseStore.releaseRebuildLease({ token: "" })).resolves.toBe(false);
    expect(catalog.prepared).toHaveLength(0);
  });

  it("aborts the rebuild when the lease is lost mid-run", async () => {
    // The renewal update matches no row, so this invocation no longer owns the
    // lease and must stop instead of interleaving its DELETEs with the new owner.
    const { value } = env({ changesFor: (sql) => (sql.includes("UPDATE catalog_summary SET value_int") ? 0 : 1) });
    const stores = createCloudflareStores(value);

    await expect(stores.caseStore.rebuildAggregates({ lease: { token: "owner-token", leaseSeconds: 900 } }))
      .rejects.toThrow(/lease lost/);
  });

  it("does not consult the lease when the rebuild runs without one", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();

    // The only UPDATE is the conditional dirty_since disarm, never a lease renewal.
    const updates = catalog.prepared.filter((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int"));
    expect(updates.every((s) => s.sql.includes("'rebuild_dirty_since'"))).toBe(true);
    expect(updates.some((s) => s.sql.includes("'rebuild_lease_until'"))).toBe(false);
  });

  it("throttles a retry after a failed rebuild", async () => {
    // A failed rebuild releases its lease without stamping rebuild_last_at, so
    // the decision must also consider the attempt stamp.
    const recentAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 30 }) });
    await expect(createCloudflareStores(recentAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: false, reason: "debounced" });

    const oldAttempt = env({ responder: () => state({ pending: 3, applied: 2, lastAt: nowSeconds() - 4000, attemptAt: nowSeconds() - 900 }) });
    await expect(createCloudflareStores(oldAttempt.value).caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 }))
      .resolves.toMatchObject({ due: true, reason: "dirty" });
  });

  it("clears and rewrites exactly the documented summary tables", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();

    const deleted = catalog.prepared
      .filter((s) => /^DELETE FROM /.test(s.sql))
      .map((s) => s.sql.replace("DELETE FROM ", "").split(" ")[0]);
    expect(deleted.sort()).toEqual([...REBUILD_TABLES].sort());
    // 1 state read + 17 DELETEs + 17 INSERT ... SELECT + 7 filter_option inserts
    // + 3 bookkeeping statements (applied generation, last rebuild, conditional
    // dirty_since disarm).
    expect(catalog.prepared.length).toBe(1 + REBUILD_TABLES.length * 2 + 7 + 3);
  });

  it("keeps the bookkeeping keys alive across the rebuild delete", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();

    const summaryDelete = catalog.prepared.find((s) => s.sql.startsWith("DELETE FROM catalog_summary"));
    expect(summaryDelete).toBeDefined();
    expect(summaryDelete.sql).toMatch(/summary_key NOT IN \(/);
    for (const key of BOOKKEEPING_KEYS) expect(summaryDelete.sql).toContain(`'${key}'`);
  });

  it("records the generation observed before the scan, not a bare clean flag", async () => {
    const { catalog, value } = env({ responder: () => state({ pending: 7, applied: 6, lastAt: nowSeconds() - 400 }) });
    const stores = createCloudflareStores(value);

    const before = nowSeconds();
    await stores.caseStore.rebuildAggregates();
    const after = nowSeconds();

    const applied = catalog.prepared
      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_applied_generation'"));
    const stamp = catalog.prepared
      .find((s) => s.sql.startsWith("INSERT OR REPLACE") && s.sql.includes("'rebuild_last_at'"));
    const resetDirtySince = catalog.prepared
      .find((s) => s.sql.startsWith("UPDATE catalog_summary SET value_int = 0"));
    expect(applied.sql).toMatch(/INSERT OR REPLACE INTO catalog_summary/);
    expect(Number(applied.params[0])).toBe(7);
    expect(Number(stamp.params[0])).toBeGreaterThanOrEqual(before);
    expect(Number(stamp.params[0])).toBeLessThanOrEqual(after);
    // The disarm is conditional on no mutation arriving mid-scan, so continuous
    // writes can never reset the staleness clock on every rebuild.
    expect(resetDirtySince).toBeDefined();
    expect(resetDirtySince.sql).toMatch(/WHERE summary_key = 'rebuild_dirty_since'/);
    expect(resetDirtySince.sql).toMatch(/COALESCE\(\(SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'\), 0\) <= \?/);
    expect(Number(resetDirtySince.params[1])).toBe(7);
    expect(catalog.prepared.some((s) => s.sql.includes("'rebuild_dirty'"))).toBe(false);
  });

  it("batches the rebuild statements in bounded chunks", async () => {
    const { catalog, value } = env();
    const stores = createCloudflareStores(value);

    await stores.caseStore.rebuildAggregates();

    for (const call of catalog.batch.mock.calls) expect(call[0].length).toBeLessThanOrEqual(20);
    expect(catalog.batch.mock.calls.length).toBeGreaterThan(1);
  });
});
