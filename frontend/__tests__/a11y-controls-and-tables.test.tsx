/**
 * Plan 023 — accessibility semantics.
 *
 * FilterPill's remove button used to have no accessible name at all;
 * CourtBadge's full court name was reachable only via `title`; Pagination
 * overflowed at 320px and its summary was not a live region; the
 * comparison matrices marked their row-header column as <td>. This
 * asserts the fixes, plus a source-text hygiene check (each of the six
 * table files from Step 8 has as many `scope=` attributes as `<th`
 * elements, and contains a `<caption`) in the style of
 * `frontend/__tests__/i18n-hardcoded.test.ts`.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilterPill } from "@/components/shared/FilterPill";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { Pagination } from "@/components/shared/Pagination";
import { ComparisonTable } from "@/components/judges/ComparisonTable";

describe("a11y — FilterPill", () => {
  it("gives each pill a distinct, type=button remove control", () => {
    render(
      <>
        <FilterPill label="Court" value="FCA" onRemove={() => {}} />
        <FilterPill label="Nature" value="Migration" onRemove={() => {}} />
      </>,
    );

    const courtButton = screen.getByRole("button", {
      name: "Remove filter: Court: FCA",
    });
    const natureButton = screen.getByRole("button", {
      name: "Remove filter: Nature: Migration",
    });

    expect(courtButton).toBeInTheDocument();
    expect(natureButton).toBeInTheDocument();
    expect(courtButton).toHaveAttribute("type", "button");
  });
});

describe("a11y — CourtBadge", () => {
  it("exposes the full court name while the badge text stays the code", () => {
    render(<CourtBadge court="FedCFamC2G" />);
    expect(
      screen.getByText(
        "Federal Circuit and Family Court of Australia (Division 2)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("FedCFamC2G")).toBeInTheDocument();
  });
});

describe("a11y — Pagination", () => {
  it("exposes a status live region and a flex-wrap container", () => {
    const { container } = render(
      <Pagination
        currentPage={2}
        totalPages={10}
        totalItems={200}
        pageSize={20}
        onPageChange={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector("div.flex-wrap")).not.toBeNull();
  });
});

describe("a11y — ComparisonTable row headers", () => {
  it("gives each body row a <th scope=row> and the table a caption", () => {
    const { container } = render(
      <ComparisonTable
        judge1Name="Judge A"
        judge2Name="Judge B"
        rows={[
          { metric: "Win rate", judge1Value: 0.5, judge2Value: 0.6 },
          { metric: "Total cases", judge1Value: 100, judge2Value: 120 },
        ]}
      />,
    );
    expect(
      container.querySelectorAll('tbody th[scope="row"]').length,
    ).toBe(2);
    expect(container.querySelector("caption")?.textContent).toBe(
      "Judge comparison metrics",
    );
  });
});

describe("a11y — table hygiene (source-text checks)", () => {
  const files = [
    "../src/components/cases/CasesTable.tsx",
    "../src/components/judges/ComparisonTable.tsx",
    "../src/components/judges/ConceptEffectivenessTable.tsx",
    "../src/components/analytics/ConceptComboTable.tsx",
    "../src/components/lineage/CourtVolumeTable.tsx",
    "../src/pages/CaseComparePage.tsx",
  ];

  for (const relPath of files) {
    it(`${relPath} has as many scope= attributes as <th elements, and a <caption`, () => {
      const content = readFileSync(join(__dirname, relPath), "utf8");
      const thCount = (content.match(/<th\b/g) ?? []).length;
      const scopeCount = (content.match(/scope=/g) ?? []).length;
      expect(scopeCount).toBe(thCount);
      expect(content).toContain("<caption");
    });
  }
});
