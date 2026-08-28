import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskGauge } from "@/components/analytics/RiskGauge";

describe("RiskGauge", () => {
  it("renders the gauge container", () => {
    render(<RiskGauge score={65} label="Moderate" />);
    expect(screen.getByTestId("risk-gauge")).toBeInTheDocument();
  });

  it("displays the score value", () => {
    render(<RiskGauge score={72} label="Favourable" />);
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("displays the label", () => {
    render(<RiskGauge score={30} label="Unfavourable" />);
    expect(screen.getByText("Unfavourable")).toBeInTheDocument();
  });

  it("clamps score to 0-100 range", () => {
    const { rerender } = render(<RiskGauge score={-10} label="Low" />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<RiskGauge score={150} label="High" />);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("applies color classes based on score thresholds", () => {
    const { rerender } = render(<RiskGauge score={25} label="Poor" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-danger");

    rerender(<RiskGauge score={55} label="Moderate" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-warning");

    rerender(<RiskGauge score={80} label="Good" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-success");
  });

  it("renders SVG arc element", () => {
    render(<RiskGauge score={50} label="Moderate" />);
    const svg = screen.getByTestId("risk-gauge").querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});
