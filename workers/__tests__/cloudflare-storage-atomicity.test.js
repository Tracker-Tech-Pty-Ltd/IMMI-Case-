import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareStores } from "../storage/cloudflare.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";

/**
 * A D1 stand-in that records batch grouping AND models D1's per-batch
 * transaction: a batch either applies every statement's effect on `tables` or
 * none of them. `failOnBatch` injects a rejection at a chosen 0-based index.
 */
function d1({ changes = 1, failOnBatch = null } = {}) {
  const batches = [];
  const ran = [];
  // table name -> array of {sql, params} rows currently "in" that table.
  const tables = new Map();
  const seed = (table, rows) => tables.set(table, [...rows]);
  const effectsOf = (statement) => {
    const del = /^\s*DELETE FROM (\w+)\b/.exec(statement.sql || "");
    if (del) return { table: del[1], kind: "delete" };
    const ins = /INSERT (?:OR IGNORE )?INTO (\w+)\b/.exec(statement.sql || "");
    if (ins) return { table: ins[1], kind: "insert" };
    return null;
  };
  return {
    batches,
    ran,
    tables,
    seed,
    rowsIn: (table) => tables.get(table) || [],
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => { statement.params = params; return statement; };
      statement.all = vi.fn(async () => ({ results: [] }));
      statement.first = vi.fn(async () => null);
      statement.run = vi.fn(async () => { ran.push(statement); return { meta: { changes } }; });
      return statement;
    },
    batch: vi.fn(async (statements) => {
      const index = batches.length;
      batches.push(statements);
      if (failOnBatch !== null && index === failOnBatch) {
        // Nothing is applied: this models D1 rolling the whole batch back.
        throw new Error(`injected D1 batch failure at index ${index}`);
      }
      for (const statement of statements) {
        const effect = effectsOf(statement);
        if (!effect) continue;
        if (effect.kind === "delete") tables.set(effect.table, []);
        else tables.set(effect.table, [...(tables.get(effect.table) || []), { sql: statement.sql, params: statement.params }]);
      }
      return statements.map(() => ({ meta: { changes } }));
    }),
  };
}

function env(catalog) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: catalog,
    IMMI_ACCOUNT_DB: d1(),
    IMMI_OPS_DB: d1(),
    IMMI_CONTENT: {
      put: vi.fn(async (key, bytes) => ({ key, size: bytes.byteLength })),
      head: vi.fn(async () => ({ size: 5, customMetadata: { sha256: "" } })),
      get: vi.fn(async () => null),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })),
      query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "mutation-1" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
  };
}

const SOURCE_POINTER = {
  key: `cases/0123456789ab/source/${"a".repeat(64)}.txt`,
  sha256: "a".repeat(64),
  size: 12,
  contentType: "text/plain; charset=utf-8",
};

const IMPORT_CASE = {
  case_id: "0123456789ab",
  citation: "[2026] FCA 1",
  title: "Example v Minister",
  court_code: "FCA",
  year: 2026,
};

const AGGREGATE_TABLES = [
  "aggregate_court_year_outcome", "aggregate_source", "catalog_summary",
  "aggregate_judge_court", "aggregate_nature_outcome", "aggregate_concept",
  "aggregate_country", "aggregate_judge", "aggregate_visa", "aggregate_scope",
  "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
  "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
];

describe("Cloudflare storage atomicity", () => {
  it("rebuilds every aggregate table inside the transaction that truncates it", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.rebuildAggregates();
    for (const statements of catalog.batches) {
      expect(statements.length).toBeLessThanOrEqual(20);
      for (const statement of statements) {
        const match = /^DELETE FROM (\w+)(?: WHERE summary_key NOT IN \(.*\))?$/.exec(statement.sql);
        if (!match) continue;
        const table = match[1];
        const hasInsert = statements.some((other) => new RegExp("INSERT INTO " + table + "\\b").test(other.sql));
        expect(hasInsert).toBe(true);
      }
    }
  });

  it("truncates each aggregate table exactly once", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.rebuildAggregates();
    const deletedTables = catalog.batches
      .flat()
      .map((statement) => /^DELETE FROM (\w+)(?: WHERE summary_key NOT IN \(.*\))?$/.exec(statement.sql)?.[1])
      .filter(Boolean);
    expect(deletedTables.length).toBe(17);
    expect(new Set(deletedTables).size).toBe(17);
  });

  it("writes every chunk of an imported case in one transaction", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.putImportedCase({
      case: IMPORT_CASE,
      sourcePointer: SOURCE_POINTER,
      textChunks: ["first chunk", "second chunk"],
    });
    const chunkBatches = catalog.batches.filter((statements) => statements.some((s) => s.sql.includes("case_text_chunks")));
    expect(chunkBatches.length).toBe(1);
    const [chunkBatch] = chunkBatches;
    expect(chunkBatch.some((s) => s.sql.includes("DELETE FROM case_text_chunks"))).toBe(true);
    const inserts = chunkBatch.filter((s) => s.sql.includes("INSERT INTO case_text_chunks"));
    expect(inserts.length).toBe(2);
    expect(catalog.ran.some((s) => s.sql.includes("DELETE FROM case_text_chunks"))).toBe(false);
    const indices = inserts.map((s) => s.params[1]).sort();
    expect(indices).toEqual([0, 1]);
  });

  it("stores no chunks for a case that has no full text", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.putImportedCase({
      case: IMPORT_CASE,
      sourcePointer: SOURCE_POINTER,
      textChunks: [],
    });
    const chunkBatches = catalog.batches.filter((statements) => statements.some((s) => s.sql.includes("case_text_chunks")));
    expect(chunkBatches.length).toBe(1);
    const [chunkBatch] = chunkBatches;
    expect(chunkBatch.some((s) => s.sql.includes("DELETE FROM case_text_chunks"))).toBe(true);
    expect(chunkBatch.some((s) => s.sql.includes("INSERT INTO case_text_chunks"))).toBe(false);
    expect(catalog.rowsIn("case_text_chunks")).toEqual([]);
  });

  it("writes a case row and its relations in one transaction", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.updateCaseFields("0123456789ab", {
      title: "Updated",
      judges: ["Perram J"],
      legal_concepts: ["procedural fairness"],
    });
    expect(catalog.batch).toHaveBeenCalledOnce();
    const [statements] = catalog.batches;
    expect(statements.some((s) => s.sql.includes("UPDATE cases SET"))).toBe(true);
    expect(statements.some((s) => s.sql.includes("DELETE FROM case_judges"))).toBe(true);
    expect(statements.some((s) => s.sql.includes("DELETE FROM case_concepts"))).toBe(true);
  });

  it("keeps a case edit in one transaction at the relation-label cap", async () => {
    const catalog = d1();
    const stores = createCloudflareStores(env(catalog));
    await stores.caseStore.updateCaseFields("0123456789ab", {
      judges: Array.from({ length: 100 }, (_, i) => `Judge ${i}`),
      legal_concepts: Array.from({ length: 100 }, (_, i) => `Concept ${i}`),
    });
    expect(catalog.batch).toHaveBeenCalledOnce();
    const [statements] = catalog.batches;
    expect(statements.length).toBe(7);
  });

  it("leaves no aggregate table empty when a later rebuild batch fails", async () => {
    const catalog = d1({ failOnBatch: 1 });
    for (const table of AGGREGATE_TABLES) catalog.seed(table, [{ sql: "seed", params: [] }]);
    const stores = createCloudflareStores(env(catalog));
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(stores.caseStore.rebuildAggregates()).rejects.toThrow(/injected D1 batch failure/);
    for (const table of AGGREGATE_TABLES) {
      expect(catalog.rowsIn(table).length).toBeGreaterThan(0);
    }
    // The cost guard must not mark pending work applied after a partial rebuild.
    expect(catalog.batches.flat().some((statement) => statement.sql.includes("SELECT 'rebuild_applied_generation'"))).toBe(false);
    const partial = logs.mock.calls
      .map(([arg]) => { try { return JSON.parse(arg); } catch { return null; } })
      .find((entry) => entry?.event === "cloudflare.aggregate_rebuild_partial");
    expect(partial).toBeTruthy();
    const changedTables = AGGREGATE_TABLES.filter((table) => {
      const rows = catalog.rowsIn(table);
      return !(rows.length === 1 && rows[0]?.sql === "seed");
    });
    expect(new Set(partial.committed_tables)).toEqual(new Set(changedTables));
    logs.mockRestore();
  });

  it("stops before table writes when the rebuild lease was superseded", async () => {
    const catalog = d1({ changes: 0 });
    for (const table of AGGREGATE_TABLES) catalog.seed(table, [{ sql: "seed", params: [] }]);
    const stores = createCloudflareStores(env(catalog));
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(stores.caseStore.rebuildAggregates({ lease: { token: "expired", leaseSeconds: 900 } }))
        .rejects.toMatchObject({ code: "rebuild_lease_lost" });
      expect(catalog.batch).not.toHaveBeenCalled();
      for (const table of AGGREGATE_TABLES) expect(catalog.rowsIn(table)).toEqual([{ sql: "seed", params: [] }]);
    } finally {
      logs.mockRestore();
    }
  });

  it("leaves the previous chunks intact when the chunk transaction fails", async () => {
    const probe = d1();
    const probeStores = createCloudflareStores(env(probe));
    await probeStores.caseStore.putImportedCase({
      case: IMPORT_CASE,
      sourcePointer: SOURCE_POINTER,
      textChunks: ["first chunk", "second chunk"],
    });
    const chunkBatchIndex = probe.batches.findIndex((statements) => statements.some((s) => s.sql.includes("case_text_chunks")));
    expect(chunkBatchIndex).toBeGreaterThanOrEqual(0);

    const catalog = d1({ failOnBatch: chunkBatchIndex });
    catalog.seed("case_text_chunks", [{ sql: "seed-0", params: [] }, { sql: "seed-1", params: [] }]);
    const stores = createCloudflareStores(env(catalog));
    await expect(stores.caseStore.putImportedCase({
      case: IMPORT_CASE,
      sourcePointer: SOURCE_POINTER,
      textChunks: ["first chunk", "second chunk"],
    })).rejects.toThrow(/injected D1 batch failure/);
    expect(catalog.rowsIn("case_text_chunks")).toEqual([{ sql: "seed-0", params: [] }, { sql: "seed-1", params: [] }]);
  });

  it("still reports a missing case as a 404", async () => {
    const catalog = d1({ changes: 0 });
    const stores = createCloudflareStores(env(catalog));
    await expect(stores.caseStore.updateCaseFields("0123456789ab", { title: "Updated" }))
      .rejects.toMatchObject({ code: "case_not_found", status: 404 });
  });
});
