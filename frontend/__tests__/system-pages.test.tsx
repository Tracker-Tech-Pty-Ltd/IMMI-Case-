import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// -------------------------------------------------------------------
// Hoisted mock factories
// -------------------------------------------------------------------
const { mockUseStats, mockFetchJobStatus, mockFetchPipelineStatus } =
  vi.hoisted(() => ({
    mockUseStats: vi.fn(),
    mockFetchJobStatus: vi.fn(),
    mockFetchPipelineStatus: vi.fn(),
  }));

// -------------------------------------------------------------------
// Module-level mocks
// -------------------------------------------------------------------
vi.mock("@/hooks/use-stats", () => ({
  useStats: mockUseStats,
}));

vi.mock("@/lib/api", () => ({
  fetchJobStatus: mockFetchJobStatus,
  fetchPipelineStatus: mockFetchPipelineStatus,
}));

// Mock StatCard — render title and value as text for assertions
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
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Minimal stats payload */
function makeStats(
  overrides: Partial<{
    total_cases: number;
    with_full_text: number;
    courts: Record<string, number>;
  }> = {},
) {
  return {
    total_cases: 10000,
    with_full_text: 9500,
    courts: { ARTA: 2000, FCA: 3000 },
    years: {},
    ...overrides,
  };
}

function defaultStatsResult(
  overrides: Partial<{
    total_cases: number;
    with_full_text: number;
    courts: Record<string, number>;
  }> = {},
) {
  return {
    data: makeStats(overrides),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

// -------------------------------------------------------------------
// Tests: DataToolsPage
// -------------------------------------------------------------------
describe("DataToolsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPipelineStatus.mockResolvedValue({
      running: false,
      log: [],
      errors: [],
    });
    mockFetchJobStatus.mockResolvedValue({
      running: false,
      type: "",
      total: 0,
      completed: 0,
      errors: [],
      results: [],
    });
    mockUseStats.mockReturnValue(defaultStatsResult());
  });

  it("renders page heading", () => {
    renderWithProviders(<DataToolsPage />);
    expect(screen.getByText("data_tools.title")).toBeInTheDocument();
  });

  it("renders snapshot section with 4 stat cards", () => {
    renderWithProviders(<DataToolsPage />);
    expect(screen.getAllByTestId("stat-card")).toHaveLength(4);
  });

  it("shows pipeline idle state when pipeline is not running", () => {
    renderWithProviders(<DataToolsPage />);
    expect(
      screen.getByText("data_tools.pipeline_idle_title"),
    ).toBeInTheDocument();
  });

  it("shows no recent job label when no job is active", () => {
    renderWithProviders(<DataToolsPage />);
    expect(screen.getByText("data_tools.no_recent_job")).toBeInTheDocument();
  });

  it("renders pipeline logs section heading", () => {
    renderWithProviders(<DataToolsPage />);
    expect(
      screen.getByText("data_tools.logs_section_title"),
    ).toBeInTheDocument();
  });

  it("shows no logs message when log list is empty", () => {
    renderWithProviders(<DataToolsPage />);
    expect(screen.getByText("pipeline.no_logs_yet")).toBeInTheDocument();
  });

  it("renders how pipeline works section", () => {
    renderWithProviders(<DataToolsPage />);
    expect(
      screen.getByText("pipeline.how_pipeline_works"),
    ).toBeInTheDocument();
  });

  it("shows running pipeline state when pipeline is active", async () => {
    mockFetchPipelineStatus.mockResolvedValue({
      running: true,
      phase: "crawl",
      overall_progress: 45,
      phases_completed: [],
      log: [],
      errors: [],
    });
    renderWithProviders(<DataToolsPage />);
    expect(
      await screen.findByText("pipeline.live_monitor"),
    ).toBeInTheDocument();
  });

  it("shows job running state when a background job is active", async () => {
    mockFetchJobStatus.mockResolvedValue({
      running: true,
      type: "download",
      total: 1000,
      completed: 300,
      errors: [],
      results: [],
    });
    renderWithProviders(<DataToolsPage />);
    expect(
      await screen.findByText("pages.job_status.job_running"),
    ).toBeInTheDocument();
  });

  it("collapses the pipeline logs panel when the toggle button is clicked", () => {
    renderWithProviders(<DataToolsPage />);
    // Log panel starts expanded (logExpanded initialises to true)
    expect(screen.getByText("pipeline.no_logs_yet")).toBeInTheDocument();
    // Click the toggle button to collapse
    const toggleBtn = screen.getByRole("button", {
      name: "pipeline.pipeline_logs",
    });
    fireEvent.click(toggleBtn);
    expect(
      screen.queryByText("pipeline.no_logs_yet"),
    ).not.toBeInTheDocument();
  });
});
