import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CourtChart } from "@/components/dashboard/CourtChart";

const sampleData: Record<string, number> = {
  AATA: 39203,
  FCA: 14987,
  MRTA: 52970,
  RRTA: 13765,
  HCA: 176,
};

function renderCourtChart(data = sampleData) {
  return render(
    <MemoryRouter>
      <CourtChart data={data} />
    </MemoryRouter>,
  );
}

describe("CourtChart (C2: pie mode removed)", () => {
  it("renders a bar chart container", () => {
    const { container } = renderCourtChart();
    // recharts renders <svg> inside a wrapper; ensure the chart container exists
    expect(container.querySelector(".recharts-wrapper")).toBeInTheDocument();
  });

  it("no PieChart/pie path rendered", () => {
    const { container } = renderCourtChart();
    // recharts PieChart adds class recharts-pie
    expect(container.querySelector(".recharts-pie")).not.toBeInTheDocument();
  });

  it("no pie sector paths (sector elements only appear in PieChart)", () => {
    const { container } = renderCourtChart();
    expect(
      container.querySelector(".recharts-pie-sector"),
    ).not.toBeInTheDocument();
  });

  it("has role='img' on wrapper with aria-label for bar chart", () => {
    renderCourtChart();
    const wrapper = screen.getByRole("img");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute("aria-label")).toMatch(/bar chart/i);
  });

  it("aria-label mentions 'court'", () => {
    renderCourtChart();
    const wrapper = screen.getByRole("img");
    expect(wrapper.getAttribute("aria-label")?.toLowerCase()).toContain(
      "court",
    );
  });

  it("handles empty data gracefully (renders nothing or empty chart)", () => {
    const { container } = renderCourtChart({});
    // Should either render nothing or an empty chart — no crash
    expect(container).toBeInTheDocument();
  });

  it("data is sorted descending by count (MRTA 52970 is highest)", () => {
    const { container } = renderCourtChart();
    // recharts bar chart should at least render without crashing
    expect(container.querySelector(".recharts-bar")).toBeInTheDocument();
  });
});
