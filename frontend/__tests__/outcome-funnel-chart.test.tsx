import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutcomeFunnelChart } from "@/components/analytics/OutcomeFunnelChart";

describe("OutcomeFunnelChart - pure CSS rewrite (C5)", () => {
  it("displays win count formatted as localized number", () => {
    render(<OutcomeFunnelChart winCount={12450} lossCount={9000} />);
    // 12,450 formatted
    expect(screen.getByText(/12,450/)).toBeInTheDocument();
  });

  it("displays loss count formatted as localized number", () => {
    render(<OutcomeFunnelChart winCount={12450} lossCount={9000} />);
    expect(screen.getByText(/9,000/)).toBeInTheDocument();
  });

  it("shows correct win percentage in aria-label", () => {
    // winCount=57400, lossCount=42600 → 57.4%
    render(<OutcomeFunnelChart winCount={57400} lossCount={42600} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toContain("57.4");
  });

  it("win section has green color-related class or style", () => {
    render(<OutcomeFunnelChart winCount={60} lossCount={40} />);
    // The label text containing "Wins" should have green styling
    const winsLabel = screen.getByText(/Wins/i);
    // Check either class or inline style contains green
    const hasGreen =
      winsLabel.className.includes("green") ||
      (winsLabel.parentElement?.className ?? "").includes("green");
    expect(hasGreen).toBe(true);
  });

  it("loss section has red color-related class or style", () => {
    render(<OutcomeFunnelChart winCount={60} lossCount={40} />);
    const lossLabel = screen.getByText(/Losses/i);
    const hasRed =
      lossLabel.className.includes("red") ||
      (lossLabel.parentElement?.className ?? "").includes("red");
    expect(hasRed).toBe(true);
  });

  it("handles zero total gracefully - no NaN, no division by zero", () => {
    render(<OutcomeFunnelChart winCount={0} lossCount={0} />);
    // Should show no-data state, not NaN%
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).not.toContain("NaN");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("has role='img' and aria-label", () => {
    render(<OutcomeFunnelChart winCount={100} lossCount={50} />);
    const chart = screen.getByRole("img");
    expect(chart).toBeInTheDocument();
    expect(chart.getAttribute("aria-label")).toBeTruthy();
  });

  it("does NOT render any SVG element (confirms no Recharts)", () => {
    const { container } = render(
      <OutcomeFunnelChart winCount={100} lossCount={50} />,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(0);
  });

  it("shows 'No data' when both counts are zero", () => {
    render(<OutcomeFunnelChart winCount={0} lossCount={0} />);
    expect(screen.getByText(/No data/i)).toBeInTheDocument();
  });

  it("win bar has data-testid='win-bar' when total > 0", () => {
    const { container } = render(
      <OutcomeFunnelChart winCount={75} lossCount={25} />,
    );
    const winBar = container.querySelector("[data-testid='win-bar']");
    expect(winBar).not.toBeNull();
  });

  it("loss bar has data-testid='loss-bar' when total > 0", () => {
    const { container } = render(
      <OutcomeFunnelChart winCount={75} lossCount={25} />,
    );
    const lossBar = container.querySelector("[data-testid='loss-bar']");
    expect(lossBar).not.toBeNull();
  });
});
