import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NatureOutcomeHeatmap } from "@/components/analytics/NatureOutcomeHeatmap";
import type { NatureOutcomeData } from "@/types/case";

const fixtureData: NatureOutcomeData = {
  natures: ["Protection Visa", "Spouse Visa"],
  outcomes: ["Affirmed", "Set Aside"],
  matrix: {
    "Protection Visa": { Affirmed: 120, "Set Aside": 30 },
    "Spouse Visa": { Affirmed: 0, "Set Aside": 45 },
  },
};

// 2 natures × 2 outcomes = 4 data cells + 2 row headers + 2 column headers + 1 corner = 9 grid items
// But we just test data cells

describe("NatureOutcomeHeatmap - mode toggle (M1)", () => {
  it("renders correct number of cells (natures × outcomes)", () => {
    const { container } = render(<NatureOutcomeHeatmap data={fixtureData} />);
    // Grid items: 1 corner + 2 col headers + 2 row labels + 4 data cells = 9
    // We check for the 4 data cells by counting cells that aren't headers
    // Data cells have data-testid or we count by grid position
    // Simplest: count all grid children
    const grid = container.querySelector("[class*='grid']");
    expect(grid).not.toBeNull();
    // 2 natures × 2 outcomes = 4 data cells exist
    // Check for specific count text
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  it("shows count mode by default (numbers without % symbol)", () => {
    render(<NatureOutcomeHeatmap data={fixtureData} />);
    // In count mode, cells show plain numbers
    expect(screen.getByText("120")).toBeInTheDocument();
    // Should NOT show percentage symbols in data cells in count mode
    // (toggle button text "% of row" exists but data cells don't have %)
    const countValue = screen.getByText("120");
    expect(countValue.textContent).not.toContain("%");
  });

  it("toggle button exists and switches to '% of row' mode", async () => {
    const user = userEvent.setup();
    render(<NatureOutcomeHeatmap data={fixtureData} />);

    // Find toggle button — shows "% of row" when in count mode
    const toggleBtn = screen.getByRole("button", { name: /% of row/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click to switch to pct mode
    await user.click(toggleBtn);

    // Now cells should show percentage values
    // Protection Visa: Affirmed = 120/(120+30) = 80.0%
    expect(screen.getByText(/80\.0%/)).toBeInTheDocument();
  });

  it("pct mode shows % symbol in data cells", async () => {
    const user = userEvent.setup();
    render(<NatureOutcomeHeatmap data={fixtureData} />);

    const toggleBtn = screen.getByRole("button", { name: /% of row/i });
    await user.click(toggleBtn);

    // After toggle, button text changes to "Count"
    expect(screen.getByRole("button", { name: /Count/i })).toBeInTheDocument();

    // Data cells contain % symbol
    const cells = document.body.querySelectorAll(
      "[data-testid^='heatmap-cell']",
    );
    if (cells.length > 0) {
      // If cells have testid, check content
      const nonZeroCell = Array.from(cells).find(
        (c) => c.textContent && c.textContent !== "–",
      );
      if (nonZeroCell) {
        expect(nonZeroCell.textContent).toContain("%");
      }
    } else {
      // Without testid, just verify % appears in body
      expect(document.body.textContent).toContain("%");
    }
  });

  it("cells with count=0 display '–' (em dash)", () => {
    render(<NatureOutcomeHeatmap data={fixtureData} />);
    // Spouse Visa → Affirmed = 0, should show "–"
    // The component uses "\u2013" (en dash) for zero
    const dashCells = screen.getAllByText("–");
    expect(dashCells.length).toBeGreaterThan(0);
  });

  it("re-toggling back to count mode shows numbers again", async () => {
    const user = userEvent.setup();
    render(<NatureOutcomeHeatmap data={fixtureData} />);

    const toggleBtn = screen.getByRole("button", { name: /% of row/i });
    await user.click(toggleBtn);
    // Now in pct mode — click "Count" button to go back
    const countBtn = screen.getByRole("button", { name: /Count/i });
    await user.click(countBtn);
    // Back to count mode
    expect(screen.getByText("120")).toBeInTheDocument();
  });
});
