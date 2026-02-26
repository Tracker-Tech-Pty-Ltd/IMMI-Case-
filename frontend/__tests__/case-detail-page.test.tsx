import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import React from "react";

// -------------------------------------------------------------------
// Hoisted mock factories
// -------------------------------------------------------------------
const {
  mockUseCase,
  mockUseRelatedCases,
  mockUseDeleteCase,
  mockUseParams,
  mockUseNavigate,
} = vi.hoisted(() => ({
  mockUseCase: vi.fn(),
  mockUseRelatedCases: vi.fn(),
  mockUseDeleteCase: vi.fn(),
  mockUseParams: vi.fn(),
  mockUseNavigate: vi.fn(),
}));

// -------------------------------------------------------------------
// Module-level mocks
// -------------------------------------------------------------------
vi.mock("@/hooks/use-cases", () => ({
  useCase: mockUseCase,
  useRelatedCases: mockUseRelatedCases,
  useDeleteCase: mockUseDeleteCase,
}));

vi.mock("@/hooks/use-bookmarks", () => ({
  useBookmarks: vi.fn(() => ({
    bookmarks: [],
    collections: [],
    recentBookmarks: [],
    isBookmarked: vi.fn(() => false),
    addBookmark: vi.fn(),
    removeBookmark: vi.fn(),
    createCollection: vi.fn(),
    addCaseToCollection: vi.fn(),
  })),
  addBookmark: vi.fn(),
  createCollection: vi.fn(() => ({
    id: "col-1",
    name: "Test",
    case_order: [],
  })),
  addCaseToCollection: vi.fn(),
}));

// Mock react-router-dom — keep BrowserRouter but override hooks
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useParams: mockUseParams,
    useNavigate: mockUseNavigate,
  };
});

// Mock complex sub-components that rely on canvas / scroll
vi.mock("@/components/cases/CaseTextViewer", () => ({
  CaseTextViewer: ({ text }: { text: string }) => (
    <div data-testid="case-text-viewer">{text.slice(0, 30)}</div>
  ),
}));

vi.mock("@/components/shared/BookmarkButton", () => ({
  BookmarkButton: () => <button data-testid="bookmark-button">Bookmark</button>,
}));

// -------------------------------------------------------------------
// Import page AFTER mocks are registered
// -------------------------------------------------------------------
import { CaseDetailPage } from "@/pages/CaseDetailPage";

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
        <CaseDetailPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

/** Minimal ImmigrationCase fixture */
function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "abc123456789",
    citation: "[2024] AATA 1234",
    title: "Smith v Minister for Immigration",
    court: "Administrative Appeals Tribunal",
    court_code: "AATA",
    date: "2024-01-15",
    year: 2024,
    url: "https://www.austlii.edu.au/case/abc123",
    judges: "Senior Member Jones",
    catchwords: "visa; refugee; protection",
    outcome: "Dismissed",
    visa_type: "Protection",
    legislation: "Migration Act 1958",
    text_snippet: "",
    full_text_path: "",
    source: "AustLII",
    user_notes: "",
    tags: "",
    case_nature: "Review",
    legal_concepts: "Natural justice; Credibility",
    visa_subclass: "866",
    visa_class_code: "XA",
    applicant_name: "John Smith",
    respondent: "Minister for Immigration",
    country_of_origin: "Afghanistan",
    visa_subclass_number: "866",
    hearing_date: "2023-12-01",
    is_represented: "Y",
    representative: "Legal Aid",
    ...overrides,
  };
}

/** Loading query state */
function loadingResult() {
  return {
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
  };
}

/** Successful case query result */
function successResult(caseData = makeCase(), fullText = "") {
  return {
    data: { case: caseData, full_text: fullText },
    isLoading: false,
    isError: false,
    error: null,
  };
}

/** Empty related cases result */
function emptyRelated() {
  return {
    data: { cases: [] },
    isLoading: false,
    isError: false,
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------
describe("CaseDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: valid case ID in URL
    mockUseParams.mockReturnValue({ id: "abc123456789" });
    mockUseNavigate.mockReturnValue(vi.fn());
    mockUseDeleteCase.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseRelatedCases.mockReturnValue(emptyRelated());
  });

  // Test 1: loading state
  it("顯示載入文字當資料尚未載入", () => {
    mockUseCase.mockReturnValue(loadingResult());

    renderPage();

    // Loading branch returns t("common.loading_ellipsis") — returns key via i18n mock
    expect(screen.getByText("common.loading_ellipsis")).toBeInTheDocument();
  });

  // Test 2: citation and title
  it("顯示案件引用和標題當資料載入", () => {
    mockUseCase.mockReturnValue(successResult());

    renderPage();

    // h1 and breadcrumb and MetaField all contain the citation — use getAllByText
    const citationElements = screen.getAllByText("[2024] AATA 1234");
    expect(citationElements.length).toBeGreaterThan(0);
    // The case title (distinct from citation) appears in a <p> tag
    expect(
      screen.getByText("Smith v Minister for Immigration"),
    ).toBeInTheDocument();
  });

  // Test 3: metadata fields rendered
  it("顯示案件元資料（法院、日期、判決）", () => {
    mockUseCase.mockReturnValue(successResult());

    renderPage();

    // CourtBadge and MetaField both render court_code — use getAllByText
    const aataElements = screen.getAllByText("AATA");
    expect(aataElements.length).toBeGreaterThan(0);
    // outcome appears in OutcomeBadge and MetaField — use getAllByText
    const dismissedElements = screen.getAllByText("Dismissed");
    expect(dismissedElements.length).toBeGreaterThan(0);
    // date value appears in MetaField
    expect(screen.getByText("2024-01-15")).toBeInTheDocument();
  });

  // Test 4: legal concepts shown as links
  it("顯示法律概念標籤", () => {
    mockUseCase.mockReturnValue(successResult());

    renderPage();

    expect(screen.getByText("Natural justice")).toBeInTheDocument();
    expect(screen.getByText("Credibility")).toBeInTheDocument();
  });

  // Test 5: full text viewer renders when full_text provided
  it("顯示全文檢視器當全文存在", () => {
    mockUseCase.mockReturnValue(
      successResult(
        makeCase(),
        "DECISION\nThis is the full text of the decision.",
      ),
    );

    renderPage();

    expect(screen.getByTestId("case-text-viewer")).toBeInTheDocument();
  });

  // Test 6: no full text viewer when full_text is empty
  it("不顯示全文檢視器當全文不存在", () => {
    mockUseCase.mockReturnValue(successResult(makeCase(), ""));

    renderPage();

    expect(screen.queryByTestId("case-text-viewer")).not.toBeInTheDocument();
  });

  // Test 7: no ID → Navigate redirect (renders nothing meaningful in BrowserRouter)
  it("當沒有 ID 時不崩潰", () => {
    mockUseParams.mockReturnValue({ id: undefined });
    mockUseCase.mockReturnValue(loadingResult());

    // Should redirect to /cases without throwing
    expect(() => renderPage()).not.toThrow();
  });

  // Test 8: applicant name shown in metadata
  it("顯示申請人姓名", () => {
    mockUseCase.mockReturnValue(successResult());

    renderPage();

    expect(screen.getByText("John Smith")).toBeInTheDocument();
  });

  // Test 9: catchwords section shown when present
  it("顯示 catchwords 當存在", () => {
    mockUseCase.mockReturnValue(
      successResult(makeCase({ catchwords: "visa; refugee; protection" })),
    );

    renderPage();

    expect(screen.getByText("visa; refugee; protection")).toBeInTheDocument();
  });

  // Test 10: related cases section shown when data present
  it("顯示相關案件當有相關案件資料", () => {
    mockUseCase.mockReturnValue(successResult());
    mockUseRelatedCases.mockReturnValue({
      data: {
        cases: [
          {
            case_id: "rel111111111",
            citation: "[2023] AATA 999",
            title: "Jones v Minister",
            court_code: "AATA",
            date: "2023-05-01",
          },
        ],
      },
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("[2023] AATA 999")).toBeInTheDocument();
  });
});
