import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

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

// Similar cases — stub with available=false so SimilarCasesPanel hides entirely
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// -------------------------------------------------------------------
// Import page AFTER mocks are registered
// -------------------------------------------------------------------
import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { ApiError } from "@/lib/api";
import { toast } from "sonner";

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
    refetch: vi.fn(),
  };
}

function emptyRelated() {
  return {
    data: { cases: [] },
    isLoading: false,
    isError: false,
  };
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------
describe("CaseDetailPage error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: "abc123456789" });
    mockUseNavigate.mockReturnValue(vi.fn());
    mockUseDeleteCase.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseRelatedCases.mockReturnValue(emptyRelated());
  });

  afterEach(() => {
    setClipboard(undefined);
  });

  it("shows the generic error panel on a non-404 failure", () => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(
        "cloudflare_route_unavailable",
        503,
        "cloudflare_route_unavailable",
      ),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("case-detail-error")).toBeInTheDocument();
    expect(screen.getByText(/cloudflare_route_unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId("case-detail-not-found")).toBeNull();
  });

  it("shows the not-found panel for a real 404 ApiError, not the generic error", () => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("Case not found", 404, "not_found"),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("case-detail-not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("case-detail-error")).toBeNull();
  });

  it("calls refetch when Retry is clicked on the error panel", () => {
    const refetch = vi.fn();
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(
        "cloudflare_route_unavailable",
        503,
        "cloudflare_route_unavailable",
      ),
      refetch,
    });

    renderPage();
    fireEvent.click(screen.getByText("common.retry"));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("announces the error panel via role=alert", () => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(
        "cloudflare_route_unavailable",
        503,
        "cloudflare_route_unavailable",
      ),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("treats a 2xx empty body as not-found, not an infinite spinner", () => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId("case-detail-not-found")).toBeInTheDocument();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("confirms the citation copy only after writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    mockUseCase.mockReturnValue(successResult());

    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTitle("case_detail.copy_citation"));
    });

    expect(writeText).toHaveBeenCalledWith("[2024] AATA 1234");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts an error when writeText rejects and does not enter the copied state", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });
    mockUseCase.mockReturnValue(successResult());

    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTitle("case_detail.copy_citation"));
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
