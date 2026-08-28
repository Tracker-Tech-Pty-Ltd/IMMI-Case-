import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// -------------------------------------------------------------------
// Hoisted mock factories — same shape as __tests__/system-pages.test.tsx
// -------------------------------------------------------------------
const { mockUseStats, mockFetchJobStatus, mockFetchPipelineStatus } =
  vi.hoisted(() => ({
    mockUseStats: vi.fn(),
    mockFetchJobStatus: vi.fn(),
    mockFetchPipelineStatus: vi.fn(),
  }));

vi.mock("@/hooks/use-stats", () => ({
  useStats: mockUseStats,
}));

// Exactly two exports — do not add a third here; DataToolsPage.tsx does not
// import anything new from @/lib/api, so this mock does not need to either.
vi.mock("@/lib/api", () => ({
  fetchJobStatus: mockFetchJobStatus,
  fetchPipelineStatus: mockFetchPipelineStatus,
}));

vi.mock("@/components/dashboard/StatCard", () => ({
  StatCard: ({ title, value }: { title: string; value: number | string }) => (
    <div data-testid="stat-card">
      <span data-testid="stat-title">{title}</span>
      <span data-testid="stat-value">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  ),
}));

// -------------------------------------------------------------------
// Import DataToolsPage AFTER mocks
// -------------------------------------------------------------------
import { DataToolsPage } from "@/pages/DataToolsPage";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeStats(overrides: Partial<{ total_cases: number; with_full_text: number; courts: Record<string, number> }> = {}) {
  return {
    total_cases: 10000,
    with_full_text: 9500,
    courts: { ARTA: 2000, FCA: 3000 },
    years: {},
    ...overrides,
  };
}

function defaultStatsResult() {
  return {
    data: makeStats(),
    isLoading: false,
    isFetching: false,
    isError: false,
  };
}

const idleJobStatus = {
  running: false,
  type: "",
  total: 0,
  completed: 0,
  errors: [],
  results: [],
};

const idlePipelineStatus = {
  running: false,
  log: [],
  errors: [],
};

describe("DataToolsPage poll errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStats.mockReturnValue(defaultStatsResult());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the pipeline error card when the first load fails, and suppresses the fabricated idle card", async () => {
    mockFetchPipelineStatus.mockRejectedValue(
      new Error("HTTP 503: cloudflare_route_unavailable"),
    );
    mockFetchJobStatus.mockResolvedValue(idleJobStatus);

    renderWithProviders(<DataToolsPage />);

    expect(await screen.findByTestId("pipeline-status-error")).toBeInTheDocument();
    expect(
      screen.queryByText("data_tools.pipeline_idle_title"),
    ).toBeNull();
  });

  it("still shows the idle card on the healthy path (regression guard)", async () => {
    mockFetchPipelineStatus.mockResolvedValue(idlePipelineStatus);
    mockFetchJobStatus.mockResolvedValue(idleJobStatus);

    renderWithProviders(<DataToolsPage />);

    expect(
      await screen.findByText("data_tools.pipeline_idle_title"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-status-error")).toBeNull();
  });

  it("does NOT blank a running pipeline when a background refetch fails — shows a stale banner instead", async () => {
    vi.useFakeTimers();
    mockFetchPipelineStatus
      .mockResolvedValueOnce({
        running: true,
        phase: "crawl",
        overall_progress: 42,
        log: ["started"],
        errors: [],
        phases_completed: [],
      })
      .mockRejectedValue(new Error("boom"));
    mockFetchJobStatus.mockResolvedValue(idleJobStatus);

    renderWithProviders(<DataToolsPage />);

    // Flush the initial resolved fetch. TanStack Query's internal scheduling
    // uses a zero-delay timer as well as microtasks, so advance a hair of
    // fake-clock time too rather than relying on Promise.resolve() alone.
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("pipeline.live_monitor")).toBeInTheDocument();

    // The running-state refetchInterval is 2000ms; the next poll rejects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(screen.queryByTestId("pipeline-status-error")).toBeNull();
    expect(screen.getByText("pipeline.live_monitor")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-status-stale")).toBeInTheDocument();
  });

  it("shows the job error card when the job poll fails", async () => {
    mockFetchPipelineStatus.mockResolvedValue(idlePipelineStatus);
    mockFetchJobStatus.mockRejectedValue(new Error("boom"));

    renderWithProviders(<DataToolsPage />);

    expect(await screen.findByTestId("job-status-error")).toBeInTheDocument();
    expect(screen.queryByText("data_tools.no_recent_job")).toBeNull();
  });

  it("announces the first-load pipeline error via role=alert", async () => {
    mockFetchPipelineStatus.mockRejectedValue(new Error("boom"));
    mockFetchJobStatus.mockResolvedValue(idleJobStatus);

    renderWithProviders(<DataToolsPage />);

    await screen.findByTestId("pipeline-status-error");
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
