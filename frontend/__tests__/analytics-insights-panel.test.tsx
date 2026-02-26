import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsInsightsPanel } from "@/components/analytics/AnalyticsInsightsPanel";
import type { AnalyticsAdvancedFilterOptions } from "@/types/case";

const sampleData: AnalyticsAdvancedFilterOptions = {
  query: {
    court: null,
    year_from: 2000,
    year_to: 2026,
    total_matching: 42000,
  },
  case_natures: [
    { value: "Judicial Review", count: 18000 },
    { value: "Protection Visa", count: 12000 },
    { value: "Visa Refusal", count: 9000 },
  ],
  visa_subclasses: [
    { value: "866", count: 8000 },
    { value: "189", count: 5000 },
  ],
  outcome_types: [
    { value: "Affirmed", count: 20000 },
    { value: "Dismissed", count: 8000 },
    { value: "Set Aside", count: 6000 },
  ],
};

const sampleDataNoTops: AnalyticsAdvancedFilterOptions = {
  query: { court: null, year_from: 2020, year_to: 2024, total_matching: 100 },
  case_natures: [],
  visa_subclasses: [],
  outcome_types: [],
};

describe("AnalyticsInsightsPanel", () => {
  it("renders nothing when data is undefined and not loading", () => {
    const { container } = render(
      <AnalyticsInsightsPanel data={undefined} isLoading={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 4 skeleton chips while loading", () => {
    const { container } = render(
      <AnalyticsInsightsPanel data={undefined} isLoading={true} />,
    );
    const panel = container.querySelector(
      "[data-testid='analytics-insights-panel']",
    );
    expect(panel).toBeInTheDocument();
    const pulseItems = container.querySelectorAll(".animate-pulse");
    expect(pulseItems.length).toBe(4);
  });

  it("shows total matching cases count", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    expect(screen.getByTestId("insight-chip-total")).toBeInTheDocument();
    expect(screen.getByText("42,000")).toBeInTheDocument();
  });

  it("shows top outcome name", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    expect(screen.getByTestId("insight-chip-outcome")).toBeInTheDocument();
    expect(screen.getByText("Affirmed")).toBeInTheDocument();
  });

  it("shows top outcome share percentage", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    // 20000 / 42000 = 47.6% → rounded to 48%
    expect(screen.getByTestId("insight-chip-outcome").textContent).toMatch(
      /48%/,
    );
  });

  it("shows top case nature", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    expect(screen.getByTestId("insight-chip-nature")).toBeInTheDocument();
    expect(screen.getByText("Judicial Review")).toBeInTheDocument();
  });

  it("shows top visa subclass prefixed with 'SV'", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    expect(screen.getByTestId("insight-chip-visa")).toBeInTheDocument();
    expect(screen.getByText("SV 866")).toBeInTheDocument();
  });

  it("does not render outcome/nature/visa chips when lists are empty", () => {
    render(
      <AnalyticsInsightsPanel data={sampleDataNoTops} isLoading={false} />,
    );
    // Total chip always renders
    expect(screen.getByTestId("insight-chip-total")).toBeInTheDocument();
    // Optional chips absent
    expect(
      screen.queryByTestId("insight-chip-outcome"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("insight-chip-nature")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insight-chip-visa")).not.toBeInTheDocument();
  });

  it("renders the accessible panel container", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    expect(
      screen.getByTestId("analytics-insights-panel"),
    ).toBeInTheDocument();
  });

  it("correctly calculates nature share percentage", () => {
    render(<AnalyticsInsightsPanel data={sampleData} isLoading={false} />);
    // 18000 / 42000 = 42.8% → rounded to 43%
    expect(screen.getByTestId("insight-chip-nature").textContent).toMatch(
      /43%/,
    );
  });
});
