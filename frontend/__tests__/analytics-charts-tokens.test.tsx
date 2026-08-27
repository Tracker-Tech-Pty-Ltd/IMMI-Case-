/**
 * analytics-charts-tokens.test.tsx
 *
 * TDD test — written BEFORE the fixes. Verifies:
 * 1. No hardcoded hex colors remain in analytics chart component source files
 * 2. Tooltip components all include color: "var(--color-text)"
 * 3. Chart components render without crashing
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OutcomeTrendChart } from "@/components/analytics/OutcomeTrendChart";
import { ConceptEffectivenessChart } from "@/components/analytics/ConceptEffectivenessChart";
import { FlowSankeyChart } from "@/components/analytics/FlowSankeyChart";
import { LegalConceptsChart } from "@/components/analytics/LegalConceptsChart";
import type { ConceptEffectivenessData } from "@/types/case";

const ANALYTICS_DIR = path.resolve(
  __dirname,
  "../src/components/analytics",
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function readComponent(filename: string): string {
  return fs.readFileSync(path.join(ANALYTICS_DIR, filename), "utf-8");
}

/** Finds all hardcoded hex color literals in JSX attribute context, e.g. fill="#2d7d46" */
function findHardcodedHexInJSX(source: string): string[] {
  // Match hex literals appearing as prop values or in object literals inside JSX
  const hexRe = /(?:fill|stroke|stopColor|color)\s*[=:]\s*["']?(#[0-9a-fA-F]{3,8})["']?/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(source)) !== null) {
    matches.push(m[0]);
  }
  return matches;
}

// ── Group 1: Source-level checks (no JSDOM required) ─────────────────────────

describe("Group 1 – No hardcoded hex colors in analytics chart sources", () => {
  it("OutcomeTrendChart.tsx has no hardcoded hex in fill/stroke/stopColor", () => {
    const src = readComponent("OutcomeTrendChart.tsx");
    const hits = findHardcodedHexInJSX(src);
    expect(hits, `Found hardcoded hex colors: ${JSON.stringify(hits)}`).toHaveLength(0);
  });

  it("ConceptEffectivenessChart.tsx has no hardcoded hex in Cell fill", () => {
    const src = readComponent("ConceptEffectivenessChart.tsx");
    // Cell fill values should use CSS vars, not hex literals
    const hardcodedCellFill = /#[0-9a-fA-F]{6}/g;
    // Extract only string literals (not in comments)
    const stringsOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const hexHits = stringsOnly.match(hardcodedCellFill) ?? [];
    expect(hexHits, `Found hardcoded hex: ${JSON.stringify(hexHits)}`).toHaveLength(0);
  });

  it("LegalConceptsChart.tsx getConceptColor has no hardcoded hex returns", () => {
    const src = readComponent("LegalConceptsChart.tsx");
    const stringsOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const hexHits = stringsOnly.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(hexHits, `Found hardcoded hex: ${JSON.stringify(hexHits)}`).toHaveLength(0);
  });
});

// ── Group 2: Tooltip contentStyle checks ─────────────────────────────────────

describe("Group 2 – Tooltip components include color: var(--color-text)", () => {
  it("FlowSankeyChart.tsx Tooltip has contentStyle with color var", () => {
    const src = readComponent("FlowSankeyChart.tsx");
    // The Tooltip must NOT be a bare <Tooltip /> — it must have contentStyle
    expect(src).not.toMatch(/<Tooltip\s*\/>/);
    expect(src).toContain("contentStyle");
    expect(src).toContain("--color-text");
  });

  it("OutcomeTrendChart.tsx Tooltip has color: var(--color-text)", () => {
    const src = readComponent("OutcomeTrendChart.tsx");
    expect(src).toContain('color: "var(--color-text)"');
  });

  it("ConceptEffectivenessChart.tsx Tooltip has color: var(--color-text)", () => {
    const src = readComponent("ConceptEffectivenessChart.tsx");
    expect(src).toContain('color: "var(--color-text)"');
  });
});

// ── Group 3: CartesianGrid present in BarCharts ───────────────────────────────

describe("Group 3 – BarChart components include CartesianGrid", () => {
  it("ConceptEffectivenessChart.tsx includes CartesianGrid", () => {
    const src = readComponent("ConceptEffectivenessChart.tsx");
    expect(src).toContain("CartesianGrid");
  });

  it("TopJudgesChart.tsx includes CartesianGrid", () => {
    const src = readComponent("TopJudgesChart.tsx");
    expect(src).toContain("CartesianGrid");
  });

  it("LegalConceptsChart.tsx includes CartesianGrid", () => {
    const src = readComponent("LegalConceptsChart.tsx");
    expect(src).toContain("CartesianGrid");
  });
});

// ── Group 4: Render-level smoke tests ────────────────────────────────────────

describe("Group 4 – Chart components render without crashing", () => {
  const trendData: Record<string, Record<string, number>> = {
    "2020": { Affirmed: 500, "Set Aside": 200, Remitted: 50 },
    "2021": { Affirmed: 520, "Set Aside": 210, Remitted: 55 },
    "2022": { Affirmed: 480, "Set Aside": 190, Remitted: 60 },
  };

  it("OutcomeTrendChart renders with data", () => {
    const { container } = render(
      <MemoryRouter>
        <OutcomeTrendChart data={trendData} />
      </MemoryRouter>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("OutcomeTrendChart rendered output contains no hardcoded hex color strings", () => {
    const { container } = render(
      <MemoryRouter>
        <OutcomeTrendChart data={trendData} />
      </MemoryRouter>,
    );
    // Check inline style attributes in rendered DOM do not embed hardcoded hex values
    // for the two problematic colors (#2d7d46, #2a6496)
    const html = container.innerHTML;
    expect(html).not.toContain("#2d7d46");
    expect(html).not.toContain("#2a6496");
  });

  const effectivenessData: ConceptEffectivenessData = {
    concepts: [
      { name: "Procedural Fairness", win_rate: 65, total: 200, lift: 1.3, by_court: {} },
      { name: "Natural Justice", win_rate: 38, total: 150, lift: 0.9, by_court: {} },
      { name: "Jurisdictional Error", win_rate: 55, total: 100, lift: 1.1, by_court: {} },
    ],
    baseline_rate: 50,
  };

  it("ConceptEffectivenessChart renders with data", () => {
    const { container } = render(
      <MemoryRouter>
        <ConceptEffectivenessChart data={effectivenessData} />
      </MemoryRouter>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("ConceptEffectivenessChart rendered output contains no hardcoded hex for cell fills", () => {
    const { container } = render(
      <MemoryRouter>
        <ConceptEffectivenessChart data={effectivenessData} />
      </MemoryRouter>,
    );
    const html = container.innerHTML;
    expect(html).not.toContain("#1f8a4d");
    expect(html).not.toContain("#b64040");
  });

  it("FlowSankeyChart renders empty state without crashing", () => {
    const { container } = render(
      <MemoryRouter>
        <FlowSankeyChart data={{ nodes: [], links: [] }} />
      </MemoryRouter>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("LegalConceptsChart renders with data", () => {
    const { container } = render(
      <MemoryRouter>
        <LegalConceptsChart
          data={[
            { name: "Migration Act", count: 1200, win_rate: 62 } as Parameters<typeof LegalConceptsChart>[0]["data"][number],
            { name: "Procedural Fairness", count: 900, win_rate: 38 } as Parameters<typeof LegalConceptsChart>[0]["data"][number],
          ]}
        />
      </MemoryRouter>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("LegalConceptsChart rendered output contains no hardcoded hex from getConceptColor", () => {
    const { container } = render(
      <MemoryRouter>
        <LegalConceptsChart
          data={[
            { name: "Migration Act", count: 1200, win_rate: 62 } as Parameters<typeof LegalConceptsChart>[0]["data"][number],
            { name: "Procedural Fairness", count: 900, win_rate: 38 } as Parameters<typeof LegalConceptsChart>[0]["data"][number],
          ]}
        />
      </MemoryRouter>,
    );
    const html = container.innerHTML;
    // Old hardcoded colors from getConceptColor
    expect(html).not.toContain("#1f8a4d");
    expect(html).not.toContain("#b9770e");
    expect(html).not.toContain("#a93226");
  });
});
