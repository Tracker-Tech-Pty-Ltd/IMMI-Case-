import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CourtSparklineGrid } from "@/components/dashboard/CourtSparklineGrid";
import type { TrendEntry } from "@/types/case";

const sampleTrendData: TrendEntry[] = [
  { year: 2020, AATA: 4000, FCA: 1500, MRTA: 5200 },
  { year: 2021, AATA: 4200, FCA: 1600, MRTA: 4800 },
  { year: 2022, AATA: 3800, FCA: 1700, MRTA: 4500 },
  { year: 2023, AATA: 3500, FCA: 1800, MRTA: 4200 },
];

function renderGrid(data: TrendEntry[] = sampleTrendData) {
  return render(
    <MemoryRouter>
      <CourtSparklineGrid data={data} />
    </MemoryRouter>,
  );
}

describe("CourtSparklineGrid (C1: small multiples)", () => {
  it("renders the grid container", () => {
    renderGrid();
    expect(
      screen.getByTestId("court-sparkline-grid"),
    ).toBeInTheDocument();
  });

  it("renders one sparkline card per court", () => {
    renderGrid();
    // Should have 3 courts: AATA, FCA, MRTA
    expect(screen.getByTestId("court-sparkline-AATA")).toBeInTheDocument();
    expect(screen.getByTestId("court-sparkline-FCA")).toBeInTheDocument();
    expect(screen.getByTestId("court-sparkline-MRTA")).toBeInTheDocument();
  });

  it("each card shows the court name as text", () => {
    renderGrid();
    expect(screen.getByText("AATA")).toBeInTheDocument();
    expect(screen.getByText("FCA")).toBeInTheDocument();
    expect(screen.getByText("MRTA")).toBeInTheDocument();
  });

  it("each card has role='img'", () => {
    renderGrid();
    const cards = screen.getAllByRole("img");
    // Should have at least 3 cards (one per court)
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it("aria-label for each card contains court name and total", () => {
    renderGrid();
    const aataCard = screen.getByTestId("court-sparkline-AATA");
    const label = aataCard.getAttribute("aria-label") ?? "";
    expect(label).toContain("AATA");
    // Total for AATA: 4000+4200+3800+3500 = 15500
    expect(label).toContain("15,500");
  });

  it("returns null when data array is empty", () => {
    const { container } = renderGrid([]);
    expect(
      container.querySelector('[data-testid="court-sparkline-grid"]'),
    ).not.toBeInTheDocument();
  });

  it("returns null when data has no court columns", () => {
    const dataWithNoCourts: TrendEntry[] = [{ year: 2020 }];
    const { container } = renderGrid(dataWithNoCourts);
    expect(
      container.querySelector('[data-testid="court-sparkline-grid"]'),
    ).not.toBeInTheDocument();
  });

  it("sorts courts by total volume descending (MRTA first)", () => {
    renderGrid();
    const grid = screen.getByTestId("court-sparkline-grid");
    const cards = grid.querySelectorAll("[data-testid^='court-sparkline-']");
    // First card should be MRTA (highest total: 5200+4800+4500+4200 = 18700)
    expect(cards[0].getAttribute("data-testid")).toBe("court-sparkline-MRTA");
  });

  it("shows peak year information per card", () => {
    renderGrid();
    // AATA peak is 2021 (4200), MRTA peak is 2020 (5200)
    // The peak year text contains "Peak:" prefix
    const peakTexts = screen.getAllByText(/Peak:/);
    expect(peakTexts.length).toBeGreaterThan(0);
  });

  it("shows total case count per court", () => {
    renderGrid();
    // MRTA total: 18,700 cases
    expect(screen.getByText(/18,700/)).toBeInTheDocument();
  });

  it("renders recharts line charts for each court", () => {
    const { container } = renderGrid();
    // recharts renders .recharts-line elements
    const lineElements = container.querySelectorAll(".recharts-line");
    expect(lineElements.length).toBeGreaterThan(0);
  });
});
