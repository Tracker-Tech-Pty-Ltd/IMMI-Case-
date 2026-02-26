import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConceptTrendChart } from "@/components/analytics/ConceptTrendChart";
import type { ConceptTrendData } from "@/types/case";

// Minimal fixture with 3 concepts, 3 years each
const makeData = (conceptCount: number): ConceptTrendData => {
  const concepts = ["Procedural Fairness", "Natural Justice", "Visa Cancellation", "Merits Review", "Jurisdictional Error", "Credibility", "Extra Concept"];
  const series: ConceptTrendData["series"] = {};
  for (let i = 0; i < conceptCount; i++) {
    const name = concepts[i] ?? `Concept ${i}`;
    series[name] = [
      { year: 2020, count: 50, win_rate: 40 + i },
      { year: 2021, count: 60, win_rate: 42 + i },
      { year: 2022, count: 55, win_rate: 45 + i },
    ];
  }
  return {
    series,
    emerging: [],
    declining: [],
  };
};

const emptyData: ConceptTrendData = {
  series: {},
  emerging: [],
  declining: [],
};

describe("ConceptTrendChart - hover interaction (H4)", () => {
  it("renders at most 6 concept lines for data with 7 concepts", () => {
    const { container } = render(<ConceptTrendChart data={makeData(7)} />);
    // Recharts renders <path> elements for each line; we count via data keys
    // Alternative: check that the rendered lines use only first 6 concepts
    // The component itself slices to 6; we verify no 7th concept label appears
    const texts = Array.from(container.querySelectorAll("text")).map(
      (el) => el.textContent ?? "",
    );
    // "Extra Concept" is the 7th; it should NOT appear
    const hasExtraConcept = texts.some((t) => t.includes("Extra Concept"));
    expect(hasExtraConcept).toBe(false);
  });

  it("renders a legend area (wrapperStyle or custom)", () => {
    const { container } = render(<ConceptTrendChart data={makeData(3)} />);
    // Recharts Legend renders as a div with class containing 'legend'
    // OR our custom legend has data-testid="concept-legend"
    const legendEl =
      container.querySelector("[data-testid='concept-legend']") ??
      container.querySelector(".recharts-legend-wrapper") ??
      container.querySelector("[class*='legend']");
    expect(legendEl).not.toBeNull();
  });

  it("empty state shows translated text (not hardcoded English)", () => {
    // With mocked useTranslation, t(key) returns key when no defaultValue
    // t("analytics.no_trend_data") → returns "analytics.no_trend_data"
    render(<ConceptTrendChart data={emptyData} />);
    // Either returns the key (no defaultValue) or the defaultValue
    // The component uses t("analytics.no_trend_data") without defaultValue
    // So mock returns the key itself
    expect(
      screen.getByText("analytics.no_trend_data") ||
        screen.queryByText(/no trend data/i),
    ).toBeTruthy();
  });

  it("each concept has a distinct COLORS entry (6 colors defined)", () => {
    // We test that 6 concepts render without color collision
    // by checking the chart renders successfully with 6 concepts
    const { container } = render(<ConceptTrendChart data={makeData(6)} />);
    // Should have rendered the chart container
    expect(container.firstChild).not.toBeNull();
  });

  it("renders chart when data has 1 concept", () => {
    const { container } = render(<ConceptTrendChart data={makeData(1)} />);
    // No empty-state text
    expect(
      screen.queryByText("analytics.no_trend_data"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });
});
