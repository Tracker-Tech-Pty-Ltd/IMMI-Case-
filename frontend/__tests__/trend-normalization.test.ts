import { describe, expect, it } from "vitest";
import { hasRenderableTrendSeries, normalizeTrendEntries } from "@/lib/trends";

describe("normalizeTrendEntries", () => {
  it("normalizes pivot rows unchanged", () => {
    const result = normalizeTrendEntries([
      { year: 2023, ARTA: 10, FCA: 2 },
      { year: 2024, ARTA: 12, FCA: 4 },
    ]);

    expect(result).toEqual([
      { year: 2023, ARTA: 10, FCA: 2 },
      { year: 2024, ARTA: 12, FCA: 4 },
    ]);
    expect(hasRenderableTrendSeries(result)).toBe(true);
  });

  it("normalizes row format to pivot format", () => {
    const result = normalizeTrendEntries([
      { year: 2023, court_code: "ARTA", case_count: 8 },
      { year: 2023, court_code: "FCA", case_count: 2 },
      { year: 2024, court_code: "ARTA", case_count: 11 },
      { year: 2024, court_code: "FCA", case_count: 5 },
    ]);

    expect(result).toEqual([
      { year: 2023, ARTA: 8, FCA: 2 },
      { year: 2024, ARTA: 11, FCA: 5 },
    ]);
    expect(hasRenderableTrendSeries(result)).toBe(true);
  });

  it("returns no renderable series for empty/invalid rows", () => {
    const result = normalizeTrendEntries([
      { year: 2024, court_code: "", case_count: 0 },
      { year: "bad-year", ARTA: 10 },
    ]);

    expect(result).toEqual([]);
    expect(hasRenderableTrendSeries(result)).toBe(false);
  });
});

