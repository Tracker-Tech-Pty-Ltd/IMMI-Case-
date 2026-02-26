import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskGauge } from "@/components/analytics/RiskGauge";

describe("RiskGauge baseline prop", () => {
  it("renders baseline marker when baseline prop is provided", () => {
    render(<RiskGauge score={60} label="Good" baseline={42} />);
    expect(screen.getByTestId("risk-gauge-baseline")).toBeInTheDocument();
  });

  it("shows 'vs avg' text with baseline value", () => {
    render(<RiskGauge score={60} label="Good" baseline={42} />);
    // The baseline element should contain the baseline value
    expect(screen.getByTestId("risk-gauge-baseline").textContent).toContain(
      "42",
    );
  });

  it("does not render baseline when prop not provided", () => {
    render(<RiskGauge score={60} label="Good" />);
    expect(screen.queryByTestId("risk-gauge-baseline")).toBeNull();
  });

  it("does not render baseline when prop is undefined", () => {
    render(<RiskGauge score={60} label="Good" baseline={undefined} />);
    expect(screen.queryByTestId("risk-gauge-baseline")).toBeNull();
  });

  it("baseline element contains 'vs avg' text", () => {
    render(<RiskGauge score={75} label="High" baseline={55} />);
    const baseline = screen.getByTestId("risk-gauge-baseline");
    expect(baseline.textContent).toMatch(/vs avg/i);
    expect(baseline.textContent).toContain("55");
  });

  it("existing tests still pass with baseline prop: score is displayed", () => {
    render(<RiskGauge score={72} label="Favourable" baseline={50} />);
    expect(screen.getByText("72")).toBeInTheDocument();
  });

  it("existing tests still pass with baseline prop: label is displayed", () => {
    render(<RiskGauge score={30} label="Unfavourable" baseline={50} />);
    expect(screen.getByText("Unfavourable")).toBeInTheDocument();
  });
});
