import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareCaseStore } from "../storage/cloudflare.js";

function d1(resultsBySqlFragment = {}) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      const statement = { sql, params: [] };
      statement.bind = (...params) => { statement.params = params; return statement; };
      statement.all = vi.fn(async () => {
        const hit = Object.entries(resultsBySqlFragment).find(([fragment]) => sql.includes(fragment));
        return { results: hit ? hit[1] : [] };
      });
      statement.first = vi.fn(async () => null);
      statement.run = vi.fn(async () => ({ meta: { changes: 1 } }));
      prepared.push(statement);
      return statement;
    },
    batch: vi.fn(async (statements) => statements.map(() => ({ meta: { changes: 1 } }))),
  };
}

function storeWith(catalog) {
  return createCloudflareCaseStore({ IMMI_STORAGE_MODE: "cloudflare", IMMI_CATALOG_DB: catalog });
}

const sqlOf = (catalog) => catalog.prepared.map((statement) => statement.sql);
const mentioning = (catalog, table) => catalog.prepared.filter((statement) => statement.sql.includes(table));

describe("analyticsJudgeAggregate query pushdown", () => {
  it("issues no filter machinery on the default request", async () => {
    const catalog = d1();
    await storeWith(catalog).analyticsJudgeAggregate();

    const outcomeStatements = mentioning(catalog, "aggregate_judge_outcome");
    expect(outcomeStatements).toHaveLength(1);
    expect(outcomeStatements[0].params).toEqual([]);
    expect(outcomeStatements[0].sql).not.toContain("OVER (PARTITION BY");
    expect(outcomeStatements[0].sql).not.toContain("judge_total");

    const yearStatements = mentioning(catalog, "aggregate_judge_year");
    expect(yearStatements).toHaveLength(1);
    expect(yearStatements[0].params).toEqual([]);
    expect(yearStatements[0].sql).not.toContain("HAVING SUM(case_count)");

    const visaStatements = mentioning(catalog, "aggregate_judge_visa");
    expect(visaStatements).toHaveLength(1);
    expect(visaStatements[0].params).toEqual([]);
    expect(visaStatements[0].sql).not.toContain("HAVING SUM(case_count)");
  });

  it("pushes the court code into SQL without a floor", async () => {
    const catalog = d1();
    await storeWith(catalog).analyticsJudgeAggregate({ court: "FCA" });

    const outcomeStatements = mentioning(catalog, "aggregate_judge_outcome");
    expect(outcomeStatements[0].params).toEqual(["FCA"]);
    expect(outcomeStatements[0].sql).toContain("WHERE o.court_code = ?");
    expect(outcomeStatements[0].sql).not.toContain("OVER (PARTITION BY");
  });

  it("pushes the court code and the minimum-case floor into SQL", async () => {
    const catalog = d1();
    await storeWith(catalog).analyticsJudgeAggregate({ court: "FCA", minCases: 5 });

    const outcomeStatements = mentioning(catalog, "aggregate_judge_outcome");
    expect(outcomeStatements[0].params).toEqual(["FCA", 5]);
    expect(outcomeStatements[0].sql).toContain("SUM(o.case_count) OVER (PARTITION BY o.judge_id)");
    expect(outcomeStatements[0].sql).toContain("judge_total >= ?");
  });

  it("does not read the year or visa tables when a court filter is set", async () => {
    const catalog = d1();
    const result = await storeWith(catalog).analyticsJudgeAggregate({ court: "FCA" });

    expect(sqlOf(catalog).some((sql) => sql.includes("aggregate_judge_year"))).toBe(false);
    expect(sqlOf(catalog).some((sql) => sql.includes("aggregate_judge_visa"))).toBe(false);
    expect(result.years).toEqual([]);
    expect(result.visas).toEqual([]);
  });

  it("reads all three aggregate tables when no court filter is set", async () => {
    const catalog = d1({ aggregate_judge_year: [{ judge_id: "judge-a", year: 2025, cnt: 7 }] });
    const result = await storeWith(catalog).analyticsJudgeAggregate();

    expect(mentioning(catalog, "aggregate_judge_year")).toHaveLength(1);
    expect(mentioning(catalog, "aggregate_judge_visa")).toHaveLength(1);
    expect(result.years).toEqual([{ judge_id: "judge-a", year: 2025, cnt: 7 }]);
  });

  it("restricts the year and visa reads to judges above the floor", async () => {
    const catalog = d1();
    await storeWith(catalog).analyticsJudgeAggregate({ minCases: 5 });

    const yearStatements = mentioning(catalog, "aggregate_judge_year");
    expect(yearStatements[0].params).toEqual([5]);
    expect(yearStatements[0].sql).toContain("HAVING SUM(case_count) >= ?");

    const visaStatements = mentioning(catalog, "aggregate_judge_visa");
    expect(visaStatements[0].params).toEqual([5]);
    expect(visaStatements[0].sql).toContain("HAVING SUM(case_count) >= ?");
  });

  it("clamps a nonsense floor to one and issues no filter machinery", async () => {
    for (const minCases of ["abc", 0]) {
      const catalog = d1();
      await storeWith(catalog).analyticsJudgeAggregate({ minCases });

      const outcomeStatements = mentioning(catalog, "aggregate_judge_outcome");
      expect(outcomeStatements[0].params).toEqual([]);
      expect(outcomeStatements[0].sql).not.toContain("OVER (PARTITION BY");
      expect(outcomeStatements[0].sql).not.toContain("judge_total");

      const yearStatements = mentioning(catalog, "aggregate_judge_year");
      expect(yearStatements[0].params).toEqual([]);
      expect(yearStatements[0].sql).not.toContain("HAVING SUM(case_count)");

      const visaStatements = mentioning(catalog, "aggregate_judge_visa");
      expect(visaStatements[0].params).toEqual([]);
      expect(visaStatements[0].sql).not.toContain("HAVING SUM(case_count)");
    }
  });
});
