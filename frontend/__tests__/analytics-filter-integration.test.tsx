import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
const { mockUseAnalyticsFilterOptions } = vi.hoisted(() => ({
  mockUseAnalyticsFilterOptions: vi.fn(),
}));

// Mock all analytics hooks – child section components depend on them
vi.mock("@/hooks/use-analytics", () => ({
  useOutcomes: vi.fn(() => ({ data: null, isLoading: false })),
  useJudges: vi.fn(() => ({ data: null, isLoading: false })),
  useLegalConcepts: vi.fn(() => ({ data: null, isLoading: false })),
  useNatureOutcome: vi.fn(() => ({ data: null, isLoading: false })),
  useSuccessRate: vi.fn(() => ({ data: null, isLoading: false })),
  useConceptEffectiveness: vi.fn(() => ({ data: null, isLoading: false })),
  useConceptCooccurrence: vi.fn(() => ({ data: null, isLoading: false })),
  useConceptTrends: vi.fn(() => ({ data: null, isLoading: false })),
  useFlowMatrix: vi.fn(() => ({ data: null, isLoading: false })),
  useMonthlyTrends: vi.fn(() => ({ data: null, isLoading: false })),
  useVisaFamilies: vi.fn(() => ({ data: null, isLoading: false })),
  useAnalyticsFilterOptions: mockUseAnalyticsFilterOptions,
}));

// Mock AnalyticsFilters (top-level court + year controls) – not under test here
vi.mock("@/components/shared/AnalyticsFilters", () => ({
  AnalyticsFilters: ({
    court,
    onCourtChange,
  }: {
    court: string;
    yearFrom: number;
    yearTo: number;
    onCourtChange: (v: string) => void;
    onYearRangeChange: (f: number, t: number) => void;
  }) => (
    <div data-testid="analytics-filters-stub">
      <input
        data-testid="court-input"
        value={court}
        onChange={(e) => onCourtChange(e.target.value)}
        placeholder="Court"
      />
    </div>
  ),
}));

// Stub heavy child sections so we only test AnalyticsPage + AdvancedFilterPanel wiring
vi.mock("@/components/analytics/SuccessRateCalculator", () => ({
  SuccessRateCalculator: ({ filters }: { filters: unknown }) => (
    <div
      data-testid="success-rate-calculator"
      data-filters={JSON.stringify(filters)}
    />
  ),
}));
vi.mock("@/components/analytics/OutcomeAnalysisSection", () => ({
  OutcomeAnalysisSection: ({ filters }: { filters: unknown }) => (
    <div
      data-testid="outcome-analysis"
      data-filters={JSON.stringify(filters)}
    />
  ),
}));
vi.mock("@/components/analytics/FlowTrendsSection", () => ({
  FlowTrendsSection: ({ filters }: { filters: unknown }) => (
    <div data-testid="flow-trends" data-filters={JSON.stringify(filters)} />
  ),
}));
vi.mock("@/components/analytics/ConceptIntelligenceSection", () => ({
  ConceptIntelligenceSection: ({ filters }: { filters: unknown }) => (
    <div
      data-testid="concept-intelligence"
      data-filters={JSON.stringify(filters)}
    />
  ),
}));
vi.mock("@/components/analytics/VisaFamiliesSection", () => ({
  VisaFamiliesSection: ({ filters }: { filters: unknown }) => (
    <div data-testid="visa-families" data-filters={JSON.stringify(filters)} />
  ),
}));

import { AnalyticsPage } from "@/pages/AnalyticsPage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <AnalyticsPage />
    </QueryClientProvider>,
  );
}

const DEFAULT_FILTER_OPTIONS = {
  query: { total_matching: 100 },
  case_natures: [
    { value: "Visa Refusal", count: 50 },
    { value: "Protection Visa", count: 30 },
  ],
  visa_subclasses: [
    { value: "866", count: 30 },
    { value: "457", count: 20 },
  ],
  outcome_types: [
    { value: "Affirmed", count: 40 },
    { value: "Set Aside", count: 15 },
  ],
};

function idleFilterOptions(overrides: object = {}) {
  return {
    data: DEFAULT_FILTER_OPTIONS,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AnalyticsPage – filter integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAnalyticsFilterOptions.mockReturnValue(idleFilterOptions());
  });

  // 1. Page renders the filter scope section
  it("renders the filter scope section with page title", () => {
    renderPage();
    const scopeSection = screen.getByTestId("analytics-filter-scope");
    expect(scopeSection).toBeInTheDocument();
    // i18n mock returns defaultValue — key "analytics.title" has no defaultValue so returns key
    // The h1 renders whatever t("analytics.title") returns
    expect(scopeSection.querySelector("h1")).toBeInTheDocument();
  });

  // 2. AdvancedFilterPanel is rendered inside the page
  it("renders the AdvancedFilterPanel inside the scope section", () => {
    renderPage();
    // The panel starts collapsed; the toggle button is always rendered
    expect(
      screen.getByRole("button", { name: /Advanced Filters/i }),
    ).toBeInTheDocument();
  });

  // 3. Expanding the panel reveals the filter lists with data from the hook
  it("shows filter options from useAnalyticsFilterOptions when panel is expanded", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));

    expect(
      screen.getByRole("button", { name: /Visa Refusal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Protection Visa/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^866/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Affirmed/i }),
    ).toBeInTheDocument();
  });

  // 4. Selecting a case nature filter updates the active-count badge
  it("shows active-filter count badge when a case nature is selected", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /Visa Refusal/i }));

    // Badge should now show "1"
    expect(screen.getByTestId("active-filter-count")).toHaveTextContent("1");
  });

  // 5. Selecting multiple filters across categories accumulates the badge count
  it("accumulates active-filter count across nature and outcome selections", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /Visa Refusal/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Affirmed/i }));

    expect(screen.getByTestId("active-filter-count")).toHaveTextContent("2");
  });

  // 6. Selected filters propagate to child section stubs via the filters prop
  it("passes selected case nature to SuccessRateCalculator via filters prop", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Visa Refusal/i }));
    });

    await waitFor(() => {
      const stub = screen.getByTestId("success-rate-calculator");
      const filters = JSON.parse(stub.getAttribute("data-filters") ?? "{}");
      expect(filters.caseNatures).toContain("Visa Refusal");
    });
  });

  // 7. Clearing all advanced filters resets the badge
  it("clears all advanced filters when Clear filters button is clicked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /Visa Refusal/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Affirmed/i }));

    // Verify badge is 2 first
    expect(screen.getByTestId("active-filter-count")).toHaveTextContent("2");

    // Now clear all
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(screen.queryByTestId("active-filter-count")).not.toBeInTheDocument();
  });

  // 8. Reset all filters button appears and resets state including year/court
  it("shows the reset-all button when a court filter is applied, and hides it after reset", async () => {
    renderPage();

    // Apply a court filter via the stubbed input
    const courtInput = screen.getByTestId("court-input");
    fireEvent.change(courtInput, { target: { value: "AATA" } });

    // The button text is the i18n key because t() without defaultValue returns the key
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /analytics\.reset_all_filters/i }),
      ).toBeInTheDocument();
    });

    // Click reset — button should disappear
    fireEvent.click(
      screen.getByRole("button", { name: /analytics\.reset_all_filters/i }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /analytics\.reset_all_filters/i }),
      ).not.toBeInTheDocument();
    });
  });

  // 9. Error state renders when useAnalyticsFilterOptions returns an error
  it("shows ApiErrorState when filter options request fails", () => {
    mockUseAnalyticsFilterOptions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });
    renderPage();

    // ApiErrorState should render with the error
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  // 10. Panel collapse hides filter content
  it("hides filter lists again when the panel is collapsed after being expanded", () => {
    renderPage();
    const toggleBtn = screen.getByRole("button", { name: /Advanced Filters/i });

    // Expand
    fireEvent.click(toggleBtn);
    expect(
      screen.getByRole("button", { name: /Visa Refusal/i }),
    ).toBeInTheDocument();

    // Collapse
    fireEvent.click(toggleBtn);
    expect(
      screen.queryByRole("button", { name: /Visa Refusal/i }),
    ).not.toBeInTheDocument();
  });
});
