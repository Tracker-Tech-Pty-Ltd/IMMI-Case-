import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

// -------------------------------------------------------------------
// Hoisted mock factories
// -------------------------------------------------------------------
const { mockUseCases, mockUseFilterOptions, mockUseBatchCases } = vi.hoisted(
  () => ({
    mockUseCases: vi.fn(),
    mockUseFilterOptions: vi.fn(),
    mockUseBatchCases: vi.fn(),
  }),
);

vi.mock("@/hooks/use-cases", () => ({
  useCases: mockUseCases,
  useFilterOptions: mockUseFilterOptions,
  useBatchCases: mockUseBatchCases,
}));

vi.mock("@/hooks/use-saved-searches", () => ({
  useSavedSearches: vi.fn(() => ({
    savedSearches: [],
    saveSearch: vi.fn(),
    updateSearch: vi.fn(),
    deleteSearch: vi.fn(),
    executeSearch: vi.fn(),
    getSearchById: vi.fn(),
  })),
}));

vi.mock("@/components/cases/CaseCard", () => ({
  CaseCard: ({
    case_,
  }: {
    case_: { citation: string; case_id: string };
    onClick: () => void;
    className?: string;
  }) => (
    <div data-testid="case-card" data-case-id={case_.case_id}>
      {case_.citation || case_.case_id}
    </div>
  ),
}));

vi.mock("@/components/saved-searches/SavedSearchPanel", () => ({
  SavedSearchPanel: () => <div data-testid="saved-search-panel" />,
}));

vi.mock("@/components/saved-searches/SaveSearchModal", () => ({
  SaveSearchModal: () => null,
}));

import { CasesPage } from "@/pages/CasesPage";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <CasesPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

function makeCase(overrides: Partial<{ case_id: string; citation: string }> = {}) {
  return {
    case_id: "aaa000000001",
    citation: "[2024] AATA 0001",
    title: "Test Case One",
    court_code: "AATA",
    court: "Administrative Appeals Tribunal",
    date: "2024-01-10",
    year: 2024,
    url: "https://www.austlii.edu.au/cases/aaa1",
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
    ...overrides,
  };
}

function makePaginatedData(cases: ReturnType<typeof makeCase>[] = []) {
  return {
    cases,
    total: cases.length,
    page: 1,
    page_size: 100,
    total_pages: 1,
  };
}

function makeFilterOptions() {
  return {
    courts: ["AATA", "FCA"],
    years: [2024, 2023],
    visa_types: ["Protection"],
    sources: ["AustLII"],
    tags: [],
    natures: ["Review"],
  };
}

describe("CasesPage - data font on list rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("cases-view-mode");
    mockUseBatchCases.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseFilterOptions.mockReturnValue({
      data: makeFilterOptions(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("table rows use font-[var(--font-data)] class for dense list readability", () => {
    mockUseCases.mockReturnValue({
      data: makePaginatedData([makeCase({ case_id: "aaa000000001" })]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const row = screen.getByTestId("cases-row");
    expect(row.className).toContain("font-[var(--font-data)]");
  });

  it("all visible case rows have the data font class applied", () => {
    mockUseCases.mockReturnValue({
      data: makePaginatedData([
        makeCase({ case_id: "aaa000000001", citation: "[2024] AATA 0001" }),
        makeCase({ case_id: "aaa000000002", citation: "[2024] AATA 0002" }),
        makeCase({ case_id: "aaa000000003", citation: "[2024] AATA 0003" }),
      ]),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const rows = screen.getAllByTestId("cases-row");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.className).toContain("font-[var(--font-data)]");
    }
  });
});
