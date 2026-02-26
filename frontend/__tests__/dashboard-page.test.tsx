import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import React from "react";

// -------------------------------------------------------------------
// Hoisted mock factories (must be declared before any vi.mock() call)
// -------------------------------------------------------------------
const { mockUseStats, mockUseTrends } = vi.hoisted(() => ({
  mockUseStats: vi.fn(),
  mockUseTrends: vi.fn(),
}));

// -------------------------------------------------------------------
// Module-level mocks
// -------------------------------------------------------------------
vi.mock("@/hooks/use-stats", () => ({
  useStats: mockUseStats,
  useTrends: mockUseTrends,
}));

vi.mock("@/hooks/use-saved-searches", () => ({
  useSavedSearches: vi.fn(() => ({
    savedSearches: [],
    executeSearch: vi.fn(),
    deleteSearch: vi.fn(),
    saveSearch: vi.fn(),
    updateSearch: vi.fn(),
    getSearchById: vi.fn(),
  })),
}));

// Mock chart components that require canvas / ResizeObserver
vi.mock("@/components/dashboard/CourtSparklineGrid", () => ({
  CourtSparklineGrid: () => <div data-testid="court-sparkline-grid" />,
}));
vi.mock("@/components/dashboard/CourtChart", () => ({
  CourtChart: () => <div data-testid="court-chart" />,
}));
vi.mock("@/components/dashboard/NatureChart", () => ({
  NatureChart: () => <div data-testid="nature-chart" />,
}));
vi.mock("@/components/dashboard/SubclassChart", () => ({
  SubclassChart: () => <div data-testid="subclass-chart" />,
}));
vi.mock("@/components/shared/AnalyticsFilters", () => ({
  AnalyticsFilters: () => <div data-testid="analytics-filters" />,
}));

// Mock api (used for export button)
vi.mock("@/lib/api", () => ({
  downloadExportFile: vi.fn(),
  fetchStats: vi.fn(),
  fetchTrends: vi.fn(),
}));

// Mock dashboard-insights with correctly-typed return value
vi.mock("@/lib/dashboard-insights", () => ({
  buildDashboardInsights: vi.fn(() => ({
    dominantCourt: { name: "AATA", count: 5000, sharePct: 40.6 },
    topNature: { name: "Review", count: 6000, sharePct: 48.6 },
    topVisaSubclass: { name: "189", count: 2000, sharePct: 16.2 },
    trendWindow: null,
    latestYear: { year: 2024, count: 2000 },
    fullTextCoveragePct: 90,
    fullTextGap: 345,
    activeYearCount: 10,
    scope: { court: null, yearFrom: 2000, yearTo: 2026 },
  })),
}));
vi.mock("@/lib/trends", () => ({
  normalizeTrendEntries: vi.fn(() => []),
  hasRenderableTrendSeries: vi.fn(() => false),
}));

// -------------------------------------------------------------------
// Import page AFTER mocks are registered
// -------------------------------------------------------------------
import { DashboardPage } from "@/pages/DashboardPage";

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
        <DashboardPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

/** Minimal loading query result */
function loadingResult() {
  return {
    data: undefined,
    isLoading: true,
    isFetching: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Minimal idle/no-data trends result */
function idleTrendsResult() {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

/** Build a minimal DashboardStats object */
function makeStats(
  overrides: Partial<{
    total_cases: number;
    with_full_text: number;
    courts: Record<string, number>;
    years: Record<string, number>;
    sources: Record<string, number>;
    natures: Record<string, number>;
    visa_subclasses: Record<string, number>;
    recent_cases: unknown[];
  }> = {},
) {
  return {
    total_cases: 12345,
    with_full_text: 12000,
    courts: { AATA: 5000, FCA: 3000 },
    years: { "2023": 1500, "2024": 2000 },
    sources: { AustLII: 10000 },
    natures: { Review: 6000, Appeal: 3000 },
    visa_subclasses: { "189": 2000, "187": 1500 },
    recent_cases: [],
    ...overrides,
  };
}

/** Successful stats query result */
function successResult(stats = makeStats()) {
  return {
    data: stats,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------
describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: loading state
  it("顯示載入狀態（spinner 和標題）當 stats 尚未載入", () => {
    mockUseStats.mockReturnValue(loadingResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    // Loading branch renders a heading and the loading message key
    expect(screen.getByText("dashboard.title")).toBeInTheDocument();
    // The loading branch renders one of the titleKey values via t()
    expect(screen.getByText("dashboard.loading_title")).toBeInTheDocument();
  });

  // Test 2: stat card renders total_cases number
  it("顯示案件總數統計當資料載入完成", () => {
    mockUseStats.mockReturnValue(
      successResult(makeStats({ total_cases: 42000 })),
    );
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    // stats.total_cases.toLocaleString() = "42,000" appears in report header
    // and StatCard — use getAllByText since it may appear multiple times
    const totalElements = screen.getAllByText("42,000");
    expect(totalElements.length).toBeGreaterThan(0);
  });

  // Test 3: empty state when total_cases === 0 and not fetching
  it("顯示歡迎空狀態當沒有案件存在", () => {
    mockUseStats.mockReturnValue({
      ...successResult(makeStats({ total_cases: 0 })),
      isFetching: false,
    });
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    // Empty state renders t("dashboard.welcome_title") — returns key since no defaultValue
    expect(screen.getByText("dashboard.welcome_title")).toBeInTheDocument();
  });

  // Test 4: error state shows ApiErrorState
  it("顯示錯誤狀態當 API 呼叫失敗", () => {
    mockUseStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    // The error branch renders dashboard.title heading
    expect(screen.getByText("dashboard.title")).toBeInTheDocument();
    // ApiErrorState receives title with "Dashboard" name
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  // Test 5: dashboard title renders in all branches (data loaded)
  it("顯示 Dashboard 標題當資料成功載入", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    expect(screen.getByText("dashboard.title")).toBeInTheDocument();
  });

  // Test 6: report generated label appears when data is loaded
  it("顯示報告生成日期標籤", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    expect(
      screen.getByText("dashboard.report_generated_label"),
    ).toBeInTheDocument();
  });

  // Test 7: chart section headings render when data is available
  it("渲染圖表區段標題當資料可用", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    // NatureChart is rendered in the nature distribution section
    // when natureDistribution has data (our makeStats includes natures)
    expect(screen.getByTestId("nature-chart")).toBeInTheDocument();
  });

  // Test 8: analytics filters component renders
  it("渲染篩選器元件", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    renderPage();

    expect(screen.getByTestId("analytics-filters")).toBeInTheDocument();
  });
});
