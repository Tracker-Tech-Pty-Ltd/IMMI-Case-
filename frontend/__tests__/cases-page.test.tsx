import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import React from "react";

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

// -------------------------------------------------------------------
// Module-level mocks
// -------------------------------------------------------------------
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

// Mock CaseCard to avoid deep rendering complexity
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

// Mock SavedSearchPanel to avoid localStorage complexity in rendering
vi.mock("@/components/saved-searches/SavedSearchPanel", () => ({
  SavedSearchPanel: () => <div data-testid="saved-search-panel" />,
}));

// Mock SaveSearchModal to avoid heavy rendering
vi.mock("@/components/saved-searches/SaveSearchModal", () => ({
  SaveSearchModal: () => null,
}));

// -------------------------------------------------------------------
// Import page AFTER mocks
// -------------------------------------------------------------------
import { CasesPage } from "@/pages/CasesPage";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
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

/** Minimal ImmigrationCase fixture */
function makeCase(
  overrides: Partial<{
    case_id: string;
    citation: string;
    title: string;
    court_code: string;
    date: string;
    outcome: string;
    case_nature: string;
    country_of_origin: string;
    applicant_name: string;
    judges: string;
    hearing_date: string;
    year: number;
    court: string;
    url: string;
    judges_count: number;
    visa_type: string;
    source: string;
    tags: string;
    user_notes: string;
    legislation: string;
    catchwords: string;
    text_snippet: string;
    full_text_path: string;
    legal_concepts: string;
    visa_subclass: string;
    visa_class_code: string;
    visa_subclass_number: string;
    is_represented: string;
    representative: string;
    respondent: string;
  }> = {},
) {
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

/** Paginated cases response */
function makePaginatedData(
  cases: ReturnType<typeof makeCase>[] = [],
  total = cases.length,
) {
  return {
    cases,
    total,
    page: 1,
    page_size: 100,
    total_pages: Math.max(1, Math.ceil(total / 100)),
  };
}

/** Successful filter options */
function makeFilterOptions() {
  return {
    courts: ["AATA", "FCA"],
    years: [2024, 2023, 2022],
    visa_types: ["Protection", "Skilled"],
    sources: ["AustLII"],
    tags: [],
    natures: ["Review", "Appeal"],
  };
}

/** Loading hook result */
function loadingResult() {
  return {
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Successful cases hook result */
function successResult(data = makePaginatedData()) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Filter options success result */
function filterOptionsSuccess() {
  return {
    data: makeFilterOptions(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Filter options loading result */
function filterOptionsLoading() {
  return {
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------
describe("CasesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBatchCases.mockReturnValue({ mutateAsync: vi.fn() });
  });

  // Test 1: Renders search input
  it("渲染搜尋輸入框", () => {
    mockUseCases.mockReturnValue(loadingResult());
    mockUseFilterOptions.mockReturnValue(filterOptionsLoading());

    const { container } = renderPage();

    // The search input has type="text" and an aria-label attribute
    const input = container.querySelector<HTMLInputElement>(
      'input[type="text"][aria-label="common.search_cases"]',
    );
    expect(input).not.toBeNull();
  });

  // Test 2: Page header text
  it("渲染頁面標題", () => {
    mockUseCases.mockReturnValue(loadingResult());
    mockUseFilterOptions.mockReturnValue(filterOptionsLoading());

    renderPage();

    // h1 renders t("cases.title") → key returned; also appears in sort dropdown option
    // Find specifically the heading element
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("cases.title");
  });

  // Test 3: Shows loading indicator
  it("顯示載入狀態", () => {
    mockUseCases.mockReturnValue(loadingResult());
    mockUseFilterOptions.mockReturnValue(filterOptionsLoading());

    renderPage();

    // Loading branch renders t("common.loading_ellipsis") → key
    expect(screen.getByText("common.loading_ellipsis")).toBeInTheDocument();
  });

  // Test 4: Shows case cards in card view
  it("在卡片模式顯示案件卡片", () => {
    // Pre-set localStorage so viewMode starts as "cards"
    window.localStorage.setItem("cases-view-mode", "cards");

    mockUseCases.mockReturnValue(
      successResult(
        makePaginatedData([
          makeCase({ case_id: "aaa000000001", citation: "[2024] AATA 0001" }),
          makeCase({ case_id: "aaa000000002", citation: "[2024] AATA 0002" }),
        ]),
      ),
    );
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    renderPage();

    const cards = screen.getAllByTestId("case-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("[2024] AATA 0001");
    expect(cards[1]).toHaveTextContent("[2024] AATA 0002");
  });

  // Test 5: Shows empty state when no cases match
  it("顯示空狀態當無案件符合篩選", () => {
    mockUseCases.mockReturnValue(successResult(makePaginatedData([])));
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    renderPage();

    // EmptyState title = t("cases.empty_state_title") → key
    expect(screen.getByText("cases.empty_state_title")).toBeInTheDocument();
  });

  // Test 6: Table view shows case rows (desktop table)
  it("在表格模式顯示案件列（預設）", () => {
    window.localStorage.removeItem("cases-view-mode");

    mockUseCases.mockReturnValue(
      successResult(
        makePaginatedData([
          makeCase({
            case_id: "bbb000000001",
            citation: "[2024] FCA 100",
            title: "Jones v Minister",
          }),
        ]),
      ),
    );
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    renderPage();

    // Table renders citation text (may appear in mobile card + desktop table)
    const citationElements = screen.getAllByText("[2024] FCA 100");
    expect(citationElements.length).toBeGreaterThan(0);
  });

  // Test 7: Case count displayed
  it("顯示案件總數", () => {
    mockUseCases.mockReturnValue(
      successResult(makePaginatedData([makeCase()], 999)),
    );
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    renderPage();

    // Header <p> shows `{total} {t("units.cases")}` — 999 and "units.cases" are
    // in separate text nodes; use a partial regex on the containing paragraph
    const totalParagraph = screen.getByText((_, el) => {
      return el?.tagName === "P" && el.textContent?.includes("999") === true;
    });
    expect(totalParagraph).toBeInTheDocument();
  });

  // Test 8: Error state renders when cases fail to load
  it("顯示錯誤狀態當案件載入失敗", () => {
    mockUseCases.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Server error"),
      refetch: vi.fn(),
    });
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    renderPage();

    // ApiErrorState shows the error message text
    expect(screen.getByText("Server error")).toBeInTheDocument();
  });

  // Test 9: Court dropdown renders options from filter options
  it("顯示法院篩選下拉選單", () => {
    mockUseCases.mockReturnValue(successResult(makePaginatedData([])));
    mockUseFilterOptions.mockReturnValue(filterOptionsSuccess());

    const { container } = renderPage();

    // Court select has aria-label t("filters.court") → key
    const courtSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="filters.court"]',
    );
    expect(courtSelect).not.toBeNull();
  });

  // Test 10: Add case button renders (by button text content)
  it("顯示新增案件按鈕", () => {
    mockUseCases.mockReturnValue(loadingResult());
    mockUseFilterOptions.mockReturnValue(filterOptionsLoading());

    renderPage();

    // Button text = t("buttons.add_case") → key returned by i18n mock
    const addBtn = screen.getByText("buttons.add_case");
    expect(addBtn).toBeInTheDocument();
  });
});
