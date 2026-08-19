import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  assertAuthContext,
  assertCloudflareBindings,
  getStorageMode,
  sha256Hex,
  StorageBoundaryError,
  toFtsMatch,
  VECTOR_DIMENSIONS,
} from "../storage/contracts.js";
import { createCloudflareStores } from "../storage/cloudflare.js";

const AUTH = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function d1({ allRows = [], firstRow = null, changes = 1 } = {}) {
  const calls = [];
  const binding = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; calls.push(this); return this; },
        all: vi.fn(async () => ({ results: allRows })),
        first: vi.fn(async () => firstRow),
        run: vi.fn(async () => ({ meta: { changes } })),
      };
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes } }))),
  };
  return binding;
}

function env() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: d1({ allRows: [{ case_id: "0123456789ab", rank: -1.1 }] }),
    IMMI_ACCOUNT_DB: d1({ firstRow: { role: "member" }, allRows: [] }),
    IMMI_OPS_DB: d1(),
    IMMI_CONTENT: {
      put: vi.fn(async (key, bytes, options) => ({ key, size: bytes.byteLength, options })),
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

function workerSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return workerSourceFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

describe("Cloudflare storage contracts", () => {
  it("accepts only the explicit four migration modes", () => {
    expect(getStorageMode({})).toBe("legacy");
    expect(() => getStorageMode({ IMMI_STORAGE_MODE: "automatic-fallback" })).toThrow(StorageBoundaryError);
  });

  it("requires a user and active tenant context", () => {
    expect(assertAuthContext(AUTH)).toMatchObject({
      userId: AUTH.sub,
      tenantId: AUTH.tenant_id,
    });
    expect(() => assertAuthContext({ sub: AUTH.sub, tenant_id: AUTH.tenant_id, tenants: [] })).not.toThrow();
    expect(() => assertAuthContext({ ...AUTH, tenants: [] })).not.toThrow();
    expect(() => assertAuthContext({ ...AUTH, tenants: [AUTH.sub] })).toThrow(/membership/i);
  });

  it("treats FTS syntax as data instead of SQL structure", () => {
    expect(toFtsMatch('visa OR "delete"')).toBe('"visa" AND "OR" AND "delete"');
  });

  it("requires every Cloudflare binding before the native store can activate", () => {
    expect(() => assertCloudflareBindings({})).toThrow(/IMMI_CATALOG_DB/);
  });

  it("keeps Cloudflare data bindings inside the storage boundary", () => {
    const bindingPattern = /\benv\.(IMMI_CATALOG_DB|IMMI_ACCOUNT_DB|IMMI_OPS_DB|IMMI_CONTENT|CASE_VECTORS|AI)\b/;
    const leaks = workerSourceFiles(fileURLToPath(new URL("..", import.meta.url)))
      .filter((path) => !path.includes("/__tests__/") && !path.includes("/storage/"))
      .filter((path) => bindingPattern.test(readFileSync(path, "utf8")));
    expect(leaks).toEqual([]);
  });
});

describe("Cloudflare store factory", () => {
  it("does not activate outside IMMI_STORAGE_MODE=cloudflare", () => {
    const value = env();
    value.IMMI_STORAGE_MODE = "shadow";
    expect(() => createCloudflareStores(value)).toThrow(/shadow/);
  });

  it("uses D1 bound values for lexical search and never interpolates query text", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    const result = await stores.caseStore.searchLexical({
      query: 'visa OR "drop table"',
      filters: { court_code: "FCA", year: 2025 },
      limit: 100,
    });
    expect(result).toHaveLength(1);
    const ftsStatement = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("case_text_fts MATCH ?"));
    const metadataStatement = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("json_each(?)"));
    expect(ftsStatement.sql).not.toContain("drop table");
    expect(ftsStatement.params).toEqual(['"visa" AND "OR" AND "drop" AND "table"']);
    expect(metadataStatement.params).toContain("FCA");
    expect(metadataStatement.params).toContain(2025);
  });

  it("requires live tenant membership before a Council list", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    await stores.identityStore.listCouncilSessions(AUTH, { limit: 10 });
    const membershipStatement = value.IMMI_ACCOUNT_DB.calls[0];
    expect(membershipStatement.sql).toContain("tenant_id = ? AND user_id = ?");
    expect(membershipStatement.params).toEqual([AUTH.tenant_id, AUTH.sub]);
  });

  it("writes a valid idempotent pipeline run seed", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    await stores.pipelineStore.ensurePipelineRun({ runId: "run-20260810", trigger: "queue", phase: "extract" });
    const statement = value.IMMI_OPS_DB.calls.find((item) => item.sql.includes("INSERT OR IGNORE INTO pipeline_runs"));
    expect(statement.sql.match(/VALUES \(/g)).toHaveLength(1);
    expect(statement.params).toEqual(["run-20260810", "queue", "extract", expect.any(String)]);
  });

  it("uses queryById with at most 100 semantic candidates", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    await stores.semanticIndex.relatedById("0123456789ab", {
      filters: { court_code: "FCA", year: 2025, ignored: "x" },
      limit: 999,
    });
    expect(value.CASE_VECTORS.queryById).toHaveBeenCalledWith("0123456789ab", {
      topK: 100,
      returnMetadata: "indexed",
      filter: { court_code: "FCA", year: 2025 },
    });
  });

  it("uses the fixed 1024-dimensional Qwen embedding model", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    const vector = await stores.semanticIndex.embed("canonical case text");
    expect(vector).toHaveLength(VECTOR_DIMENSIONS);
    expect(value.AI.run).toHaveBeenCalledWith("@cf/qwen/qwen3-embedding-0.6b", {
      text: ["canonical case text"],
    });
  });

  it("projects normalised judges and concepts back to the legacy case API shape", async () => {
    const value = env();
    const stores = createCloudflareStores(value);
    await stores.caseStore.putImportedCase({
      case: {
        case_id: "0123456789ab",
        citation: "[2026] FCA 1",
        title: "Example v Minister",
        court: "Federal Court of Australia",
        court_code: "FCA",
        year: 2026,
        visa_outcome_reason: "Natural justice denied",
        legal_test_applied: "procedural fairness",
        last_extraction_run_id: "run-20260810",
        extraction_confidence_json: { outcome: 0.95 },
        judges: ["not persisted in the denormalised row"],
        legal_concepts: ["not persisted in the denormalised row"],
      },
      sourcePointer: {
        key: "cases/0123456789ab/source/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        size: 12,
        contentType: "text/plain; charset=utf-8",
      },
      textChunks: ["Example case text"],
    });
    const insert = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("INSERT INTO cases"));
    expect(insert.params).toHaveLength(35);
    expect(insert.params).toContain("Federal Court of Australia");
    expect(insert.params).toContain("Natural justice denied");
    expect(insert.params).toContain("procedural fairness");
    expect(insert.params).toContain("run-20260810");
    expect(insert.params).toContain(JSON.stringify({ outcome: 0.95 }));
    const staleChunks = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("DELETE FROM case_text_chunks"));
    expect(staleChunks.params).toEqual(["0123456789ab"]);

    await stores.caseStore.getCase("0123456789ab");
    const detail = value.IMMI_CATALOG_DB.calls.find((statement) => statement.sql.includes("AS judges"));
    expect(detail.sql).toContain("case_judges");
    expect(detail.sql).toContain("case_concepts");
  });

  it("computes a stable SHA-256 before R2 upload", async () => {
    const digest = await sha256Hex("hello");
    expect(digest.hex).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
