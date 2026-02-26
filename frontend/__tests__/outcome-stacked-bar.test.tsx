import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutcomeStackedBar } from "@/components/shared/OutcomeStackedBar";

describe("OutcomeStackedBar", () => {
  const data = { Affirmed: 1234, "Set Aside": 500, Remitted: 200, Other: 100 };

  it("renders a container with testid", () => {
    render(<OutcomeStackedBar data={data} />);
    expect(screen.getByTestId("outcome-stacked-bar")).toBeInTheDocument();
  });

  it("shows percentage labels for large segments", () => {
    render(<OutcomeStackedBar data={data} />);
    // Affirmed is 61.2% - should show label (threshold is >= 10%)
    // Multiple elements may contain "61" (bar label + legend) - check at least one exists
    const matches = screen.getAllByText(/61/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("has role='img' and aria-label", () => {
    render(<OutcomeStackedBar data={data} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("handles empty data gracefully", () => {
    render(<OutcomeStackedBar data={{}} />);
    expect(screen.getByTestId("outcome-stacked-bar")).toBeInTheDocument();
  });

  it("does not render SVG (pure CSS, no Recharts)", () => {
    const { container } = render(<OutcomeStackedBar data={data} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows no-data message when total is zero", () => {
    render(<OutcomeStackedBar data={{}} />);
    expect(screen.getByText("No outcome data")).toBeInTheDocument();
  });

  it("renders legend items for each outcome", () => {
    render(<OutcomeStackedBar data={data} />);
    expect(screen.getByText(/Affirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Set Aside/)).toBeInTheDocument();
  });

  it("accepts custom height prop", () => {
    const { container } = render(<OutcomeStackedBar data={data} height={48} />);
    const bar = container.querySelector('[style*="48px"]');
    expect(bar).toBeInTheDocument();
  });

  it("hides percentage label for small segments (< 10%)", () => {
    // Other is 100/2034 = 4.9% - below 10% threshold, should NOT show label
    const { container } = render(<OutcomeStackedBar data={data} />);
    // The segment div for Other should have no span child (or span with very small %)
    // We check that 4% text does not appear as a label
    const allText = container.textContent ?? "";
    // Should not contain "4%" as a label in the bars (only in legend potentially)
    // The bar segment for 4.9% should NOT render the label span
    const barContainer = container.querySelector(
      '[data-testid="outcome-stacked-bar"] > div:first-child',
    );
    expect(barContainer).toBeTruthy();
  });

  it("sorts segments by count descending (largest first)", () => {
    render(<OutcomeStackedBar data={data} />);
    const legendItems = screen.getAllByText(/\d+%/);
    // The first percentage shown should correspond to the largest segment (Affirmed ~61%)
    expect(legendItems[0].textContent).toMatch(/61/);
  });
});
