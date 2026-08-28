import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { memo } from "react";

// ===========================================================================
// Group 1 — the dashboard's memoised chart datasets actually stop the
// memo()-wrapped chart components from re-rendering on an unrelated state
// change (FEPERF-07). See "Verify the measured tests actually bite" in
// plan 020 Step 7 — this group was rehearsed against a temporarily unwrapped
// useMemo in DashboardPage.tsx and failed as expected, then restored.
// ===========================================================================

const { mockUseStats, mockUseTrends } = vi.hoisted(() => ({
  mockUseStats: vi.fn(),
  mockUseTrends: vi.fn(),
}));

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

// Counting stubs. NatureChart and SubclassChart each have exactly one call
// site in DashboardPage.tsx (unlike CourtChart, which is reused across
// several sections with different data), so their render counts and data-prop
// identity are unambiguous evidence for the finding.
const renders = vi.hoisted(() => ({ nature: 0, subclass: 0 }));
const lastProps = vi.hoisted(() => ({} as Record<string, unknown>));

// memo() here is load-bearing, not decorative: the real CourtChart /
// NatureChart / SubclassChart / CourtSparklineGrid modules are memo()-wrapped
// (DashboardPage.tsx imports them as such), and it is that wrapper's shallow
// prop comparison that bails out on an unrelated parent re-render. An
// unwrapped stub re-renders on every parent render regardless of prop
// identity and would make this test pass vacuously either way.
vi.mock("@/components/dashboard/NatureChart", () => ({
  NatureChart: memo((props: { data: unknown }) => {
    renders.nature += 1;
    lastProps.nature = props.data;
    return <div data-testid="nature-chart" />;
  }),
}));
vi.mock("@/components/dashboard/SubclassChart", () => ({
  SubclassChart: memo((props: { data: unknown }) => {
    renders.subclass += 1;
    lastProps.subclass = props.data;
    return <div data-testid="subclass-chart" />;
  }),
}));
vi.mock("@/components/dashboard/CourtChart", () => ({
  CourtChart: () => <div data-testid="court-chart" />,
}));
vi.mock("@/components/dashboard/CourtSparklineGrid", () => ({
  CourtSparklineGrid: () => <div data-testid="court-sparkline-grid" />,
}));
vi.mock("@/components/shared/AnalyticsFilters", () => ({
  AnalyticsFilters: () => <div data-testid="analytics-filters" />,
}));
vi.mock("@/lib/api", () => ({
  downloadExportFile: vi.fn(),
  fetchStats: vi.fn(),
  fetchTrends: vi.fn(),
}));
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
  normalizeVisaSubclassKeys: vi.fn((obj: Record<string, number>) => obj),
}));
vi.mock("@/lib/trends", () => ({
  normalizeTrendEntries: vi.fn(() => []),
  hasRenderableTrendSeries: vi.fn(() => false),
}));

// Import AFTER mocks are registered.
import { DashboardPage } from "@/pages/DashboardPage";
import { CaseTextViewer } from "@/components/cases/CaseTextViewer";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function dashboardTree() {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <DashboardPage />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function makeStats(overrides: Partial<Record<string, unknown>> = {}) {
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

describe("DashboardPage chart re-renders (FEPERF-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renders.nature = 0;
    renders.subclass = 0;
    lastProps.nature = undefined;
    lastProps.subclass = undefined;
  });

  it("toggling chart/table view does not re-render the chart components", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    render(dashboardTree());

    // The mocks must actually be wired to the real component tree before any
    // count/identity assertion means anything.
    expect(screen.getByTestId("nature-chart")).toBeInTheDocument();
    expect(screen.getByTestId("subclass-chart")).toBeInTheDocument();
    expect(renders.nature).toBeGreaterThan(0);
    expect(renders.subclass).toBeGreaterThan(0);

    const natureRendersBefore = renders.nature;
    const subclassRendersBefore = renders.subclass;
    const natureDataBefore = lastProps.nature;
    const subclassDataBefore = lastProps.subclass;

    // The court section's chart/table toggle is an unrelated piece of local
    // state — it must not touch nature/subclass at all.
    fireEvent.click(screen.getByRole("button", { name: "Show table view" }));
    fireEvent.click(screen.getByRole("button", { name: "Show chart view" }));

    expect(renders.nature).toBe(natureRendersBefore);
    expect(renders.subclass).toBe(subclassRendersBefore);
    // Identity (toBe, not toEqual) is the whole point: useMemo keeps the same
    // object, so memo() bails out. Without Step 4 this assertion fails — see
    // the rehearsal note at the top of this file.
    expect(lastProps.nature).toBe(natureDataBefore);
    expect(lastProps.subclass).toBe(subclassDataBefore);
  });

  it("changing the underlying stats does re-render the charts with a new identity", () => {
    mockUseStats.mockReturnValue(successResult());
    mockUseTrends.mockReturnValue(idleTrendsResult());

    const { rerender } = render(dashboardTree());

    expect(renders.nature).toBeGreaterThan(0);
    const natureRendersBefore = renders.nature;
    const natureDataBefore = lastProps.nature;

    mockUseStats.mockReturnValue(
      successResult(
        makeStats({ natures: { Review: 1, Appeal: 2, Remitted: 3 } }),
      ),
    );
    rerender(dashboardTree());

    // A memo with an empty dependency array would pass the toggle test above
    // and fail this one — a real dataset change must be visible.
    expect(renders.nature).toBeGreaterThan(natureRendersBefore);
    expect(lastProps.nature).not.toBe(natureDataBefore);
  });
});

// ===========================================================================
// Group 2 — the full-text reader stops rebuilding the judgment tree on every
// keystroke, and the highlight cap holds (FEPERF-03).
// ===========================================================================

function buildLongText(term: string, totalLines = 2000): string {
  const lines: string[] = [];
  const markerLine = Math.floor(totalLines / 2);
  for (let i = 0; i < totalLines; i++) {
    lines.push(
      i === markerLine
        ? `This line contains the search term ${term} once.`
        : `Filler line number ${i} of the judgment text.`,
    );
  }
  return lines.join("\n");
}

function buildRepeatedTermText(term: string, occurrences: number): string {
  return Array.from({ length: occurrences }, () => term).join("\n");
}

describe("CaseTextViewer in-text search (FEPERF-03)", () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView; CaseTextViewer's
    // scroll-active-match-into-view effect (CaseTextViewer.tsx:248) calls it
    // whenever matches.length > 0.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds no search-mode tree before the 200ms debounce elapses", () => {
    vi.useFakeTimers();
    const text = buildLongText("gamma");
    const { container } = render(<CaseTextViewer text={text} />);

    fireEvent.click(
      screen.getByTitle("components.case_text_viewer.search_tooltip"),
    );
    const input = screen.getByPlaceholderText(
      "components.case_text_viewer.search_in_text",
    );

    // Type three characters one at a time without advancing timers.
    fireEvent.change(input, { target: { value: "g" } });
    fireEvent.change(input, { target: { value: "ga" } });
    fireEvent.change(input, { target: { value: "gam" } });

    expect(container.querySelectorAll("mark").length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("caps highlighted matches at 500 and surfaces the true total", () => {
    vi.useFakeTimers();
    const text = buildRepeatedTermText("smith", 600);
    const { container } = render(<CaseTextViewer text={text} />);

    fireEvent.click(
      screen.getByTitle("components.case_text_viewer.search_tooltip"),
    );
    const input = screen.getByPlaceholderText(
      "components.case_text_viewer.search_in_text",
    );
    fireEvent.change(input, { target: { value: "smith" } });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.querySelectorAll("mark").length).toBe(500);
    const counter = container.querySelector(".whitespace-nowrap");
    expect(counter?.textContent).toContain("600");
  });
});

// ===========================================================================
// Group 3 — the desktop case list mounts no CaseCard (FEPERF-09). This is a
// mount count, already covered by __tests__/cases-table-responsive.test.tsx
// ("desktop fallback ... renders the table only" asserts zero CaseCard
// mounts); not duplicated here.
// ===========================================================================
