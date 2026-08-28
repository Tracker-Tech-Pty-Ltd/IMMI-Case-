import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createCloudflareStores: (...args) => mockCreateStores(...args) };
});

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
import { createCloudflareCaseStore } from "../storage/cloudflare.js";

const ENV = { IMMI_STORAGE_MODE: "cloudflare" };

function url(path) {
  return new URL(`https://immi.example${path}`);
}

function request(path) {
  return new Request(`https://immi.example${path}`);
}

// One corpus, expressed in both aggregate tables.
// AATA is a tribunal: only Remitted/Set Aside/Granted/Quashed count as a win,
// so its 10 "Allowed" cases are losses. FCA is a court: only
// Allowed/Set Aside/Granted/Quashed count, so its 3 "Remitted" cases are losses.
// Total 25 cases, 12 wins => 48.0%. Treating court_code as "" would score all
// 25 as wins (100%), which is the bug this file guards.
const COURT_YEAR_ROWS = [
  { court_code: "AATA", year_key: 2024, outcome: "Allowed", cnt: 10 },
  { court_code: "AATA", year_key: 2024, outcome: "Remitted", cnt: 5 },
  { court_code: "FCA", year_key: 2024, outcome: "Allowed", cnt: 7 },
  { court_code: "FCA", year_key: 2024, outcome: "Remitted", cnt: 3 },
];

const SCOPE_ROWS = [
  { court_code: "AATA", year: 2024, outcome: "Allowed", has_full_text: 1, cnt: 10 },
  { court_code: "AATA", year: 2024, outcome: "Remitted", has_full_text: 1, cnt: 5 },
  { court_code: "FCA", year: 2024, outcome: "Allowed", has_full_text: 1, cnt: 7 },
  { court_code: "FCA", year: 2024, outcome: "Remitted", has_full_text: 1, cnt: 3 },
];

function stores({ conceptTruncated = false } = {}) {
  return {
    caseStore: {
      analyticsCourtYearOutcomes: vi.fn(async () => COURT_YEAR_ROWS),
      analyticsVisaOutcomes: vi.fn(async () => [
        { visa_subclass: "866", court_code: "AATA", outcome: "Allowed", cnt: 10 },
      ]),
      analyticsRateRows: vi.fn(async () => SCOPE_ROWS),
      analyticsConceptScope: vi.fn(async () => ({
        rows: [{ concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2024, outcome: "Allowed", cnt: 4 }],
        truncated: conceptTruncated,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateStores.mockReturnValue(stores());
});

async function get(path) {
  return dispatchCloudflareCaseRead(request(path), url(path), path.split("?")[0], ENV);
}

describe("analytics win rate", () => {
  it("scores monthly trends with the per-court win set, not the union", async () => {
    const response = await get("/api/v1/analytics/monthly-trends");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toEqual({ month: "2024-01", total: 25, wins: 12, win_rate: 48 });
  });

  it("reconciles monthly-trends win totals with analytics/success-rate", async () => {
    const monthly = await (await get("/api/v1/analytics/monthly-trends")).json();
    const rate = await (await get("/api/v1/analytics/success-rate")).json();
    const monthlyWins = monthly.series.reduce((sum, point) => sum + point.wins, 0);
    const monthlyTotal = monthly.series.reduce((sum, point) => sum + point.total, 0);
    expect(monthlyWins).toBe(rate.success_rate.win_count);
    expect(monthlyTotal).toBe(rate.query.total_matching);
    expect(monthly.series[0].win_rate).toBe(rate.success_rate.overall);
  });

  it("reads only the aggregate each analytics endpoint actually uses", async () => {
    const current = mockCreateStores();
    await get("/api/v1/analytics/monthly-trends");
    expect(current.caseStore.analyticsCourtYearOutcomes).toHaveBeenCalledTimes(1);
    expect(current.caseStore.analyticsVisaOutcomes).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await get("/api/v1/analytics/visa-families");
    expect(current.caseStore.analyticsVisaOutcomes).toHaveBeenCalledTimes(1);
    expect(current.caseStore.analyticsCourtYearOutcomes).not.toHaveBeenCalled();
  });

  it("flags a truncated concept sample on concept-trends", async () => {
    mockCreateStores.mockReturnValue(stores({ conceptTruncated: true }));
    const body = await (await get("/api/v1/analytics/concept-trends")).json();
    expect(body.truncated).toBe(true);

    mockCreateStores.mockReturnValue(stores({ conceptTruncated: false }));
    expect((await (await get("/api/v1/analytics/concept-trends")).json()).truncated).toBe(false);
  });

  it("projects court_code in the court/year aggregate query", async () => {
    const prepared = [];
    const store = createCloudflareCaseStore({
      IMMI_STORAGE_MODE: "cloudflare",
      IMMI_CATALOG_DB: {
        prepare(sql) {
          prepared.push(sql);
          return { all: async () => ({ results: [] }) };
        },
      },
    });
    await store.analyticsCourtYearOutcomes();
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toContain("FROM aggregate_court_year_outcome");
    expect(prepared[0]).toContain("court_code");
    expect(prepared[0]).toContain("year AS year_key");
  });

  it("reports truncation only when more rows exist than the cap", async () => {
    function conceptStore(rowCount) {
      const results = Array.from({ length: rowCount }, (_, index) => ({
        concept_id: `c${index}`, concept: "x", court_code: "FCA", year: 2024, outcome: "Allowed", cnt: 1,
      }));
      return createCloudflareCaseStore({
        IMMI_STORAGE_MODE: "cloudflare",
        IMMI_CATALOG_DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }) },
      });
    }

    const under = await conceptStore(9999).analyticsConceptScope();
    expect(under.truncated).toBe(false);
    expect(under.rows).toHaveLength(9999);

    const exact = await conceptStore(10000).analyticsConceptScope();
    expect(exact.truncated).toBe(false);
    expect(exact.rows).toHaveLength(10000);

    const over = await conceptStore(10001).analyticsConceptScope();
    expect(over.truncated).toBe(true);
    expect(over.rows).toHaveLength(10000);
  });

  it("flags a truncated concept sample on concept-effectiveness", async () => {
    mockCreateStores.mockReturnValue(stores({ conceptTruncated: true }));
    const truncatedBody = await (await get("/api/v1/analytics/concept-effectiveness")).json();
    expect(truncatedBody.truncated).toBe(true);

    mockCreateStores.mockReturnValue(stores({ conceptTruncated: false }));
    const clearBody = await (await get("/api/v1/analytics/concept-effectiveness")).json();
    expect(clearBody.truncated).toBe(false);
  });

  it("flags a truncated concept sample on success-rate", async () => {
    mockCreateStores.mockReturnValue(stores({ conceptTruncated: true }));
    const truncatedBody = await (await get("/api/v1/analytics/success-rate")).json();
    expect(truncatedBody.concepts_truncated).toBe(true);

    mockCreateStores.mockReturnValue(stores({ conceptTruncated: false }));
    const clearBody = await (await get("/api/v1/analytics/success-rate")).json();
    expect(clearBody.concepts_truncated).toBe(false);

    expect(clearBody.success_rate.overall).toBe(truncatedBody.success_rate.overall);
  });
});
