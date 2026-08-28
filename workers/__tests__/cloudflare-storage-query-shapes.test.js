import { describe, expect, it, vi } from "vitest";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createCloudflareStores } from "../storage/cloudflare.js";

/** Same fake D1 as cloudflare-storage-contracts.test.js: a statement lands in
 * `calls` only when `.bind()` is called, and `all()`/`first()` ignore the SQL
 * -- every statement on a binding returns the same `allRows` / `firstRow`. */
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

/**
 * A fake D1 whose `.all()` result depends on which SQL fragment `prepare(sql)`
 * was called with -- the standard `d1()` fake above returns the same `allRows`
 * for every statement, which cannot express "the case_nature candidate page
 * returns one row and the court_code candidate page returns a different one".
 * `rules` is checked in order; the first fragment found in `sql` wins.
 * `.first()` still returns one fixed `firstRow` regardless of SQL, matching
 * relatedCompat's single anchor lookup.
 */
function d1BySql(rules, { firstRow = null, changes = 1 } = {}) {
  const calls = [];
  const binding = {
    calls,
    prepare(sql) {
      const matched = rules.find(([fragment]) => sql.includes(fragment));
      const allRows = matched ? matched[1] : [];
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

function env(catalogDb) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: catalogDb,
    IMMI_ACCOUNT_DB: d1(),
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

function stores(catalogDb) {
  return createCloudflareStores(env(catalogDb)).caseStore;
}

describe("D1 read-path query shapes", () => {
  it("listPage still counts exactly, and does not read the aggregate", async () => {
    const catalog = d1({ firstRow: { total: 7, value_int: 149016 }, allRows: [{ case_id: "0123456789ab" }] });
    const caseStore = stores(catalog);
    const result = await caseStore.listPage({});
    expect(result.total).toBe(7);
    const countStatement = catalog.calls.find((statement) => statement.sql.includes("COUNT(*) AS total"));
    expect(countStatement).toBeDefined();
  });

  it("listPage runs the count and the page concurrently", async () => {
    const catalog = d1({ firstRow: { total: 7, value_int: 149016 }, allRows: [{ case_id: "0123456789ab" }] });
    const caseStore = stores(catalog);
    const result = await caseStore.listPage({});
    const countStatement = catalog.calls.find((statement) => statement.sql.includes("COUNT(*) AS total"));
    const pageStatement = catalog.calls.find((statement) => statement.sql.includes("LIMIT ? OFFSET ?"));
    expect(countStatement).toBeDefined();
    expect(pageStatement).toBeDefined();
    expect(result.total_pages).toBe(Math.max(1, Math.ceil(7 / 100)));
  });

  it("listPage with a filter counts with the filter's params", async () => {
    const catalog = d1({ firstRow: { total: 3 }, allRows: [{ case_id: "0123456789ab" }] });
    const caseStore = stores(catalog);
    const result = await caseStore.listPage({ filters: { court: "FCA" } });
    expect(result.total).toBe(3);
    const countStatement = catalog.calls.find((statement) => statement.sql.includes("COUNT(*) AS total"));
    expect(countStatement.params).toContain("FCA");
  });

  it("listPage accepts sort_by=year", async () => {
    const catalog = d1({ firstRow: { total: 1 }, allRows: [{ case_id: "0123456789ab" }] });
    const caseStore = stores(catalog);
    await expect(caseStore.listPage({ sortBy: "year", sortDir: "asc" })).resolves.toBeDefined();
    const pageStatement = catalog.calls.find((statement) => statement.sql.includes("LIMIT ? OFFSET ?"));
    expect(pageStatement.sql).toContain("ORDER BY c.year ASC");
    await expect(caseStore.listPage({ sortBy: "nonsense" })).rejects.toThrow(/Invalid sort_by/);
  });

  it("countCompat counts exactly", async () => {
    const catalog = d1({ firstRow: { total: 42, value_int: 149016 } });
    const caseStore = stores(catalog);
    const result = await caseStore.countCompat({});
    expect(result).toBe(42);
    const countStatement = catalog.calls.find((statement) => statement.sql.includes("COUNT(*) AS total"));
    expect(countStatement).toBeDefined();
  });

  it("guidedPrecedents is the one caller that may use the aggregate", async () => {
    const aggregatePresent = d1({ firstRow: { value_int: 149016 }, allRows: [{ case_id: "0123456789ab" }] });
    const withAggregate = stores(aggregatePresent);
    const resultWithAggregate = await withAggregate.guidedPrecedents({});
    expect(resultWithAggregate.total).toBe(149016);

    const aggregateAbsent = d1({ firstRow: { total: 5 }, allRows: [{ case_id: "0123456789ab" }] });
    const withoutAggregate = stores(aggregateAbsent);
    const resultWithoutAggregate = await withoutAggregate.guidedPrecedents({});
    expect(resultWithoutAggregate.total).toBe(5);
  });

  it("relatedCompat issues one narrow lookup per non-empty dimension", async () => {
    const catalog = d1({
      firstRow: { case_nature: "protection", visa_type: "", court_code: "AATA" },
      allRows: [{ case_id: "0123456789ab" }],
    });
    const caseStore = stores(catalog);
    await caseStore.relatedCompat("0123456789ab");
    const candidateStatements = catalog.calls.filter((statement) => statement.sql.includes("SELECT case_id FROM cases"));
    expect(candidateStatements).toHaveLength(2);
    expect(catalog.calls.some((statement) => statement.sql.includes("related_score"))).toBe(false);
  });

  it("relatedCompat scores from the candidate's own columns, not from which page it appeared in", async () => {
    const catalog = d1BySql(
      [
        ["WHERE case_nature = ? AND case_id <> ?", [{ case_id: "aaaaaaaaaaaa" }]],
        ["WHERE court_code = ? AND case_id <> ?", [{ case_id: "bbbbbbbbbbbb" }]],
        ["c.case_nature, c.visa_type, c.court_code, c.year", [
          { case_id: "aaaaaaaaaaaa", case_nature: "protection", visa_type: "", court_code: "AATA", year: 2020 },
          { case_id: "bbbbbbbbbbbb", case_nature: "other", visa_type: "", court_code: "AATA", year: 2026 },
        ]],
        ["c.citation", [
          { case_id: "aaaaaaaaaaaa" },
          { case_id: "bbbbbbbbbbbb" },
        ]],
      ],
      { firstRow: { case_nature: "protection", visa_type: "", court_code: "AATA" } },
    );
    const caseStore = stores(catalog);
    const result = await caseStore.relatedCompat("cccccccccccc");
    expect(result).toHaveLength(2);
    expect(result[0].case_id).toBe("aaaaaaaaaaaa");
    expect(result[0].related_score).toBe(5);
    expect(result[1].case_id).toBe("bbbbbbbbbbbb");
    expect(result[1].related_score).toBe(1);
  });

  it("relatedCompat returns null for an unknown anchor", async () => {
    const catalog = d1({ firstRow: null });
    const caseStore = stores(catalog);
    const result = await caseStore.relatedCompat("0123456789ab");
    expect(result).toBeNull();
  });

  it("searchLexical makes exactly one FTS query", async () => {
    const catalog = d1({ allRows: [{ case_id: "0123456789ab", rank: -1.1 }] });
    const caseStore = stores(catalog);
    await caseStore.searchLexical({ query: "visa", limit: 100 });
    const ftsStatements = catalog.calls.filter((statement) => statement.sql.includes("case_text_fts MATCH ?"));
    expect(ftsStatements).toHaveLength(1);
    expect(ftsStatements[0].params).toEqual(['"visa"', 500]);
  });
});
