import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DualMetricChart } from "@/components/judges/DualMetricChart";

const data = [
  { name: "FCA", value1: 85, value2: 120, label1: "Win Rate", label2: "Cases" },
  { name: "AATA", value1: 42, value2: 340, label1: "Win Rate", label2: "Cases" },
];

describe("DualMetricChart", () => {
  it("renders without error", () => {
    const { container } = render(
      <DualMetricChart data={data} label1="Win Rate" label2="Cases" />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders horizontal layout without error", () => {
    const { container } = render(
      <DualMetricChart
        data={data}
        label1="Win Rate"
        label2="Cases"
        layout="horizontal"
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders vertical layout without error", () => {
    const { container } = render(
      <DualMetricChart
        data={data}
        label1="Win Rate"
        label2="Cases"
        layout="vertical"
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("shows no-data state when data is empty", () => {
    render(<DualMetricChart data={[]} label1="Win Rate" label2="Cases" />);
    expect(screen.getByText("common.no_data")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(
      <DualMetricChart
        data={data}
        label1="Win Rate"
        label2="Cases"
        title="Judge Performance"
      />,
    );
    expect(screen.getByText("Judge Performance")).toBeInTheDocument();
  });

  it("has role='img' wrapper", () => {
    render(<DualMetricChart data={data} label1="Win Rate" label2="Cases" />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("renders default layout (vertical) without layout prop", () => {
    const { container } = render(
      <DualMetricChart data={data} label1="Win Rate" label2="Cases" />,
    );
    // Should render without crashing - default is vertical
    expect(container.querySelector(".w-full")).toBeInTheDocument();
  });
});
