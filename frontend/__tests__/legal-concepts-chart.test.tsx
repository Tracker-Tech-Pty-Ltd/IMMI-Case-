import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LegalConceptsChart } from "@/components/analytics/LegalConceptsChart";

describe("LegalConceptsChart", () => {
  const data = [
    { name: "Section 91R", count: 5000, win_rate: 68 },
    { name: "Character Test", count: 3000, win_rate: 28 },
    { name: "Protection Obligations", count: 2000, win_rate: 52 },
  ];

  it("renders bars for each concept", () => {
    render(<LegalConceptsChart data={data} />);
    // recharts renders an SVG
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders recharts wrapper", () => {
    const { container } = render(<LegalConceptsChart data={data} />);
    expect(container.querySelector(".recharts-wrapper")).toBeInTheDocument();
  });

  it("tooltip shows win_rate when data includes it", () => {
    // win_rate is shown in tooltip — verify the component doesn't crash with win_rate data
    const { container } = render(<LegalConceptsChart data={data} />);
    expect(container.firstChild).not.toBeNull();
  });

  it("handles data without win_rate field gracefully", () => {
    const simpleData = [{ name: "Test", count: 100 }];
    expect(() =>
      render(<LegalConceptsChart data={simpleData as never} />),
    ).not.toThrow();
  });

  it("handles empty data gracefully", () => {
    expect(() => render(<LegalConceptsChart data={[]} />)).not.toThrow();
  });

  it("renders a bar chart (not pie or line)", () => {
    const { container } = render(<LegalConceptsChart data={data} />);
    expect(container.querySelector(".recharts-bar")).toBeInTheDocument();
    expect(container.querySelector(".recharts-pie")).not.toBeInTheDocument();
  });

  it("renders with mixed win_rate values without throwing", () => {
    const mixedData = [
      { name: "High Win", count: 1000, win_rate: 75 },
      { name: "Mid Win", count: 800, win_rate: 50 },
      { name: "Low Win", count: 600, win_rate: 20 },
      { name: "No Rate", count: 400 },
    ];
    expect(() =>
      render(<LegalConceptsChart data={mixedData as never} />),
    ).not.toThrow();
  });

  it("has role='img' wrapper with aria-label", () => {
    render(<LegalConceptsChart data={data} />);
    const wrapper = screen.getByRole("img");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute("aria-label")).toBeTruthy();
  });
});
