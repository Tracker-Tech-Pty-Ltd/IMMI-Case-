import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

// -------------------------------------------------------------------
// Hoisted mock factories — mirrors case-detail-page.test.tsx
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

vi.mock("@/hooks/use-similar-cases", () => ({
  useSimilarCases: vi.fn(() => ({
    data: { similar: [], available: false },
    isLoading: false,
    isError: false,
    error: null,
  })),
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
describe("CaseDetailPage — Ask the Council link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: "abc123456789" });
    mockUseNavigate.mockReturnValue(vi.fn());
    mockUseDeleteCase.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseRelatedCases.mockReturnValue(emptyRelated());
    mockUseCase.mockReturnValue(successResult());
  });

  it("renders an 'Ask the Council' link pointing at the council with the case id", () => {
    renderPage();
    const link = screen.getByRole("link", {
      name: /Ask the Council about this case/i,
    });
    expect(link).toHaveAttribute("href", "/llm-council?case_id=abc123456789");
  });

  it("discloses that the Council sees metadata, not the full judgment", () => {
    renderPage();
    const link = screen.getByRole("link", {
      name: /Ask the Council about this case/i,
    });
    expect(link).toHaveAttribute(
      "title",
      expect.stringContaining("not the full judgment text"),
    );
  });

  it("keeps the existing header actions alongside the new one", () => {
    renderPage();
    const editLink = screen.getByRole("link", { name: /Edit/i });
    expect(editLink).toHaveAttribute("href", "/cases/abc123456789/edit");
  });
});
