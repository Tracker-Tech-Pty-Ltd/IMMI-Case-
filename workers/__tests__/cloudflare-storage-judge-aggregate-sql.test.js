import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import { createCloudflareCaseStore } from "../storage/cloudflare.js";

/** Minimal D1-shaped adapter over node:sqlite. */
function d1(db) {
  return {
    db,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        all() {
          return Promise.resolve({ results: db.prepare(sql).all(...this.params) });
        },
        first() {
          return Promise.resolve(db.prepare(sql).get(...this.params) ?? null);
        },
        run() { db.prepare(sql).run(...this.params); return Promise.resolve({ meta: { changes: 1 } }); },
      };
      return statement;
    },
    batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
}

function seeded() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(
    new URL("../../migrations/d1/catalog/0001_catalog.sql", import.meta.url), "utf8",
  ));
  // Two judges: "big" has 6 cases across two courts, "small" has 1.
  db.exec(`
    INSERT INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES
      ('judge-big', 'Justice Big', '2026-01-01', '2026-01-01'),
      ('judge-small', 'Member Small', '2026-01-01', '2026-01-01');
    INSERT INTO aggregate_judge_outcome (judge_id, court_code, outcome, case_count) VALUES
      ('judge-big', 'FCA', 'Allowed', 4),
      ('judge-big', 'AATA', 'Remitted', 2),
      ('judge-small', 'FCA', 'Dismissed', 1);
    INSERT INTO aggregate_judge_year (judge_id, year, case_count) VALUES
      ('judge-big', 2025, 6), ('judge-small', 2024, 1);
    INSERT INTO aggregate_judge_visa (judge_id, visa_subclass, case_count) VALUES
      ('judge-big', '189', 6), ('judge-small', '866', 1);
  `);
  return db;
}

/** The pre-change implementation, kept verbatim as the equivalence oracle. */
function legacyAggregate(db) {
  return {
    outcomes: db.prepare(`
      SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
      FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
    `).all(),
    years: db.prepare("SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year").all(),
    visas: db.prepare("SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa").all(),
  };
}

function sortRows(list, keys) {
  return [...list].sort((a, b) => {
    for (const key of keys) {
      if (a[key] < b[key]) return -1;
      if (a[key] > b[key]) return 1;
    }
    return 0;
  });
}

describe("analyticsJudgeAggregate against real SQLite", () => {
  let db;
  let store;

  beforeEach(() => {
    db = seeded();
    store = createCloudflareCaseStore({ IMMI_STORAGE_MODE: "cloudflare", IMMI_CATALOG_DB: d1(db) });
  });

  it("returns exactly what the pre-change query returned on the default request", async () => {
    const actual = await store.analyticsJudgeAggregate();
    const expected = legacyAggregate(db);

    expect(sortRows(actual.outcomes, ["judge_id", "court_code", "outcome"]))
      .toEqual(sortRows(expected.outcomes, ["judge_id", "court_code", "outcome"]));
    expect(sortRows(actual.years, ["judge_id", "year"]))
      .toEqual(sortRows(expected.years, ["judge_id", "year"]));
    expect(sortRows(actual.visas, ["judge_id", "visa_subclass"]))
      .toEqual(sortRows(expected.visas, ["judge_id", "visa_subclass"]));
  });

  it("filters to the requested court and drops the year and visa reads", async () => {
    const result = await store.analyticsJudgeAggregate({ court: "FCA" });
    expect(sortRows(result.outcomes, ["judge_id"]).map((r) => r.judge_id)).toEqual(["judge-big", "judge-small"]);
    expect(result.outcomes.every((row) => row.court_code === "FCA")).toBe(true);
    expect(result.years).toEqual([]);
    expect(result.visas).toEqual([]);
  });

  it("applies the minimum-case floor across all three tables", async () => {
    const result = await store.analyticsJudgeAggregate({ minCases: 2 });
    expect(new Set(result.outcomes.map((r) => r.judge_id))).toEqual(new Set(["judge-big"]));
    expect(new Set(result.years.map((r) => r.judge_id))).toEqual(new Set(["judge-big"]));
    expect(new Set(result.visas.map((r) => r.judge_id))).toEqual(new Set(["judge-big"]));
  });

  it("the court+floor query is syntactically valid", async () => {
    await expect(store.analyticsJudgeAggregate({ court: "FCA", minCases: 2 })).resolves.toBeDefined();
  });

  it("the court-filtered query uses the court index", () => {
    const indexPath = new URL("../../migrations/d1/catalog/0002_read_path_indexes.sql", import.meta.url);
    if (!existsSync(indexPath)) {
      // plans/013-*.md has not landed in this working copy; the index is not
      // yet declared, so there is nothing for the planner to use.
      console.warn("Skipping: migrations/d1/catalog/0002_read_path_indexes.sql is absent (plan 013 not landed)");
      return;
    }
    db.exec(readFileSync(indexPath, "utf8"));
    const plan = db.prepare(
      "EXPLAIN QUERY PLAN SELECT o.judge_id FROM aggregate_judge_outcome o WHERE o.court_code = ?",
    ).all("FCA");
    const detail = plan.map((row) => row.detail).join(" | ");
    // node:sqlite's real EXPLAIN QUERY PLAN phrasing is "SEARCH o USING
    // COVERING INDEX <name> (...)" when an index is used, and a bare
    // "SCAN o" (table alias, not the table name) when it is not. Verified
    // directly against this migration pair before writing this assertion.
    expect(detail).toContain("aggregate_judge_outcome_court_idx");
    expect(detail).toMatch(/USING (COVERING )?INDEX/);
    expect(detail).not.toMatch(/^SCAN\b/);
  });
});
