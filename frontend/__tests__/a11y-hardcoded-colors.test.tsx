/**
 * a11y-hardcoded-colors.test.tsx
 *
 * Repo-wide guard: no raw hex colour literals in application source.
 *
 * Every spacing/shadow/radius/colour value must come from
 * src/tokens/tokens.json, so that both themes and the WCAG contrast matrix in
 * __tests__/css-tokens.test.ts actually govern what ships. A raw `#2d7d46` in
 * a component is invisible to that matrix and does not flip in dark mode.
 *
 * __tests__/analytics-charts-tokens.test.tsx guards five specific analytics
 * components in more depth; this file guards the whole tree, shallowly.
 *
 * Measured against the live tree per plans/024 Step 4. The list is enforced
 * in both directions:
 *   * a file NOT on the list must have no hex   → no new debt
 *   * a file ON the list must still have hex    → no stale entries
 * When you migrate a file to tokens, DELETE its entry — the second test tells
 * you which ones to delete.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(FRONTEND_ROOT, "src");

/** Six-digit hex only, matching the convention in analytics-charts-tokens.test.tsx. */
const HEX_RE = /#[0-9a-fA-F]{6}\b/;

/** Permanent exemptions: these files ARE the palette. */
const EXEMPT_PREFIXES = ["src/tokens/"] as const;
const EXEMPT_FILES = ["src/hooks/use-theme-preset.ts"] as const;

/** Debt baseline, measured against the live tree per plans/024 Step 4. Shrink it; never grow it. */
const KNOWN_HEX_FILES: readonly string[] = [
  "src/components/analytics/ConceptCourtBreakdown.tsx",
  "src/components/analytics/ConceptTrendChart.tsx",
  "src/components/analytics/FlowSankeyChart.tsx",
  "src/components/analytics/MonthlyTrendsChart.tsx",
  "src/components/analytics/OutcomeByCourtChart.tsx",
  "src/components/analytics/OutcomeBySubclassChart.tsx",
  "src/components/analytics/VisaFamiliesSection.tsx",
  "src/components/dashboard/CourtChart.tsx",
  "src/components/dashboard/CourtSparklineGrid.tsx",
  "src/components/judges/CountryOriginChart.tsx",
  "src/components/judges/JudgeCompareCard.tsx",
  "src/components/judges/NatureBreakdownChart.tsx",
  "src/components/judges/VisaBreakdownChart.tsx",
  "src/components/lineage/CourtVolumeTable.tsx",
  "src/components/lineage/LineageExplainer.tsx",
  "src/components/lineage/LineageFilters.tsx",
  "src/components/lineage/TimelineChart.tsx",
  "src/components/llm-council/AchievementToast.tsx",
  "src/components/llm-council/StreamingCouncilView.tsx",
  "src/lib/council-celebrations.ts",
  "src/lib/court-events.ts",
  "src/pages/CourtLineagePage.tsx",
  "src/pages/DesignTokensPage.tsx",
  "src/pages/LlmCouncilPage.tsx",
];

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(absolute, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(path.relative(FRONTEND_ROOT, absolute).split(path.sep).join("/"));
    }
  }
  return acc;
}

/** Same comment-stripping as analytics-charts-tokens.test.tsx:58. */
function stripComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasHardcodedHex(relativePath: string): boolean {
  const source = fs.readFileSync(path.join(FRONTEND_ROOT, relativePath), "utf-8");
  return HEX_RE.test(stripComments(source));
}

function isExempt(relativePath: string): boolean {
  return (
    EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) ||
    EXEMPT_FILES.includes(relativePath as (typeof EXEMPT_FILES)[number])
  );
}

const sourceFiles = listSourceFiles(SRC_DIR).toSorted();

describe("Hardcoded colour scan – src/ tree", () => {
  it("walks the whole source tree", () => {
    // A broken walker would make the next two tests pass vacuously.
    expect(sourceFiles.length).toBeGreaterThanOrEqual(150);
    for (const exempt of EXEMPT_FILES) {
      expect(sourceFiles, `${exempt} is exempt but was not found`).toContain(
        exempt,
      );
    }
  });

  it("no unlisted source file contains a raw hex colour", () => {
    const offenders = sourceFiles.filter(
      (file) =>
        !isExempt(file) &&
        !KNOWN_HEX_FILES.includes(file) &&
        hasHardcodedHex(file),
    );
    expect(
      offenders,
      `Raw hex colour literal(s) found. Use a token from src/tokens/tokens.json (import from "@/tokens/tokens" or a CSS var such as var(--color-chart-2)) instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every KNOWN_HEX_FILES entry still contains hex (no stale entries)", () => {
    const stale = KNOWN_HEX_FILES.filter(
      (file) => !sourceFiles.includes(file) || !hasHardcodedHex(file),
    );
    expect(
      stale,
      `Delete these entries from KNOWN_HEX_FILES — they are clean now (or gone):\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});
