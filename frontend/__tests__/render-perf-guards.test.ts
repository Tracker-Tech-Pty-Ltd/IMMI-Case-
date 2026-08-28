import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Source-scanning guards in the style of __tests__/no-as-any.test.tsx.
//
// These prove a shape exists in the source, not that render work went down —
// that is what render-perf-measured.test.tsx is for. Do not present these as
// evidence for the performance claim; they are only an anti-drift net around
// it (plan 020, FEPERF-03/07/08/09).

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../src", relPath), "utf-8");
}

describe("Render-performance guards (anti-drift only)", () => {
  it("SuccessRateCalculator shares the default-limit legal-concepts query (FEPERF-08)", () => {
    const source = readSrc("components/analytics/SuccessRateCalculator.tsx");
    expect(source).toContain("useLegalConcepts(filters)");
    expect(source).not.toMatch(/useLegalConcepts\(\s*filters\s*,/);
  });

  it("DashboardPage memoises its chart distributions (FEPERF-07)", () => {
    const source = readSrc("pages/DashboardPage.tsx");
    expect(source).not.toContain(
      "const courtDistribution = toRenderableDistribution(",
    );
    expect(source).toContain("const sortedCourts = useMemo(");
  });

  it("GlobalSearch debounces the query via the shared hook (FEPERF-02)", () => {
    const source = readSrc("components/shared/GlobalSearch.tsx");
    expect(source).toContain("useDebouncedValue(query, 250)");
  });

  it("CaseTextViewer debounces and caps the in-text search (FEPERF-03)", () => {
    const source = readSrc("components/cases/CaseTextViewer.tsx");
    expect(source).toContain("useDebouncedValue(searchTerm, 200)");
    expect(source).toContain("MAX_HIGHLIGHTED_MATCHES");
  });

  it("CasesTable uses a media-query store and keeps the E2E-required table wrapper (FEPERF-09)", () => {
    const source = readSrc("components/cases/CasesTable.tsx");
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain("overflow-x-auto");
  });
});
