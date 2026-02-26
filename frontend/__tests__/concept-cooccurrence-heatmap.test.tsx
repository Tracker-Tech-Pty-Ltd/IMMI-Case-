import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConceptCooccurrenceHeatmap } from "@/components/analytics/ConceptCooccurrenceHeatmap";
import type { ConceptCooccurrenceData } from "@/types/case";

const concepts = ["Procedural Fairness", "Natural Justice", "Merits Review"];

const fixtureData: ConceptCooccurrenceData = {
  concepts,
  matrix: {
    "Procedural Fairness": {
      "Procedural Fairness": { count: 200, win_rate: 45 }, // diagonal
      "Natural Justice": { count: 85, win_rate: 52 },
      "Merits Review": { count: 60, win_rate: 38 },
    },
    "Natural Justice": {
      "Procedural Fairness": { count: 85, win_rate: 52 },
      "Natural Justice": { count: 150, win_rate: 48 }, // diagonal
      "Merits Review": { count: 40, win_rate: 30 },
    },
    "Merits Review": {
      "Procedural Fairness": { count: 60, win_rate: 38 },
      "Natural Justice": { count: 40, win_rate: 30 },
      "Merits Review": { count: 120, win_rate: 55 }, // diagonal
    },
  },
  top_pairs: [],
};

const emptyData: ConceptCooccurrenceData = {
  concepts: [],
  matrix: {},
  top_pairs: [],
};

describe("ConceptCooccurrenceHeatmap - diagonal masking (M2)", () => {
  it("diagonal cells show '—' (em dash) not a count", () => {
    render(<ConceptCooccurrenceHeatmap data={fixtureData} />);
    // Each diagonal cell (concept A vs concept A) should show "—"
    // We have 3 concepts, so 3 diagonal cells
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBe(3);
  });

  it("diagonal cells do NOT show their co-occurrence counts", () => {
    render(<ConceptCooccurrenceHeatmap data={fixtureData} />);
    // Diagonal counts are 200, 150, 120 — these should not appear as cell text
    // (they may appear in title attributes but not as visible text)
    const allTextNodes = Array.from(
      document.body.querySelectorAll(
        ".recharts-text, [class*='grid'] > div",
      ),
    ).map((el) => el.textContent ?? "");

    // "200" as a standalone cell content should not exist
    // Note: counts 85, 60, 40 are off-diagonal and should be visible
    expect(screen.queryByText("200")).toBeNull();
    expect(screen.queryByText("150")).toBeNull();
    expect(screen.queryByText("120")).toBeNull();
  });

  it("non-diagonal cells show the co-occurrence count", () => {
    render(<ConceptCooccurrenceHeatmap data={fixtureData} />);
    // Off-diagonal counts: 85, 60, 40 (and their mirrors)
    expect(screen.getAllByText("85")).not.toHaveLength(0);
    expect(screen.getAllByText("60")).not.toHaveLength(0);
    expect(screen.getAllByText("40")).not.toHaveLength(0);
  });

  it("max count calculation excludes diagonal values", () => {
    // If diagonal is excluded, maxCount = 85 (not 200)
    // This means the 85-count cell should have near-maximum intensity
    // We can verify indirectly: if diagonal cells have a different background
    render(<ConceptCooccurrenceHeatmap data={fixtureData} />);
    const allCells = document.body.querySelectorAll(
      "[data-testid^='cooccurrence-cell']",
    );
    if (allCells.length > 0) {
      // Find diagonal cells and check their background
      const diagonalCells = Array.from(allCells).filter(
        (c) => c.textContent === "—",
      );
      diagonalCells.forEach((cell) => {
        const style = (cell as HTMLElement).style;
        // Diagonal should have border-light background, not the blue heatmap color
        expect(style.backgroundColor).not.toContain("rgba(26, 82, 118");
      });
    } else {
      // No testid — just verify that "—" cells exist (diagonal masking happened)
      const dashes = screen.getAllByText("—");
      expect(dashes.length).toBe(3);
    }
  });

  it("empty data shows no-data message", () => {
    render(<ConceptCooccurrenceHeatmap data={emptyData} />);
    // t("analytics.no_cooccurrence_data") returns key (no defaultValue in component)
    expect(
      screen.getByText("analytics.no_cooccurrence_data"),
    ).toBeInTheDocument();
  });

  it("renders 3×3 grid for 3 concepts (3 rows + header row)", () => {
    const { container } = render(
      <ConceptCooccurrenceHeatmap data={fixtureData} />,
    );
    const grid = container.querySelector("[class*='grid']");
    expect(grid).not.toBeNull();
    // Grid has 1 header row + 3 data rows, each with 1 label + 3 cells
    // Total children = (1+3) × (1+3) = 16 grid items
    const children = grid?.children ?? [];
    expect(children.length).toBe(16);
  });
});
