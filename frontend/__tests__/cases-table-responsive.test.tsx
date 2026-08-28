import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import React from "react";
import { CasesTable } from "@/components/cases/CasesTable";
import type { ImmigrationCase } from "@/types/case";

// Mock CaseCard to avoid deep rendering complexity — same pattern as
// __tests__/cases-page.test.tsx:38-48.
vi.mock("@/components/cases/CaseCard", () => ({
  CaseCard: ({ case_ }: { case_: { case_id: string; citation?: string } }) => (
    <div data-testid="case-card" data-case-id={case_.case_id}>
      {case_.citation || case_.case_id}
    </div>
  ),
}));

/** Minimal ImmigrationCase fixture, field set copied from cases-page.test.tsx. */
function makeCase(id: string): ImmigrationCase {
  return {
    case_id: id,
    citation: `[2024] AATA ${id}`,
    title: `Case ${id}`,
    court_code: "AATA",
    court: "Administrative Appeals Tribunal",
    date: "2024-01-10",
    year: 2024,
    url: `https://www.austlii.edu.au/cases/${id}`,
    judges: "Member Smith",
    catchwords: "",
    outcome: "Dismissed",
    visa_type: "Protection",
    legislation: "Migration Act 1958",
    text_snippet: "",
    full_text_path: "",
    source: "AustLII",
    user_notes: "",
    tags: "",
    case_nature: "Review",
    legal_concepts: "",
    visa_subclass: "866",
    visa_class_code: "XA",
    applicant_name: "Alice",
    respondent: "Minister",
    country_of_origin: "Afghanistan",
    visa_subclass_number: "866",
    hearing_date: "",
    is_represented: "Y",
    representative: "",
  } as ImmigrationCase;
}

function renderTable(cases: ImmigrationCase[]) {
  const tableRef = React.createRef<HTMLTableSectionElement>();
  return render(
    <BrowserRouter>
      <CasesTable
        cases={cases}
        viewMode="table"
        selected={new Set()}
        clampedFocusedIdx={-1}
        tableRef={tableRef}
        onToggleSelect={() => {}}
        onToggleAll={() => {}}
        onSetFocusedIdx={() => {}}
      />
    </BrowserRouter>,
  );
}

describe("CasesTable responsive behaviour (FEPERF-09)", () => {
  afterEach(() => {
    // jsdom does not define window.matchMedia by default — restore that
    // clean slate between tests (frontend/__tests__/council-celebrations.test.ts:48).
    // @ts-expect-error - removing a DOM property that tests define per-case
    delete window.matchMedia;
  });

  it("desktop fallback (matchMedia undefined, the jsdom default) renders the table only", () => {
    expect(window.matchMedia).toBeUndefined();
    const cases = [makeCase("aaa000000001"), makeCase("aaa000000002")];

    renderTable(cases);

    expect(screen.getByTestId("cases-table")).toBeInTheDocument();
    expect(screen.queryAllByTestId("case-card")).toHaveLength(0);
  });

  it("mobile viewport (matchMedia reports no match) renders the table and the card grid", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const cases = [makeCase("aaa000000001"), makeCase("aaa000000002")];

    renderTable(cases);

    expect(screen.getByTestId("cases-table")).toBeInTheDocument();
    expect(screen.getAllByTestId("case-card")).toHaveLength(2);
  });
});
