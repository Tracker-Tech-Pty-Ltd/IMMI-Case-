import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AdminPipelineRunsPage } from "@/pages/AdminPipelineRunsPage";

const { mockUseAuth, mockFetchPipelineRuns } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockFetchPipelineRuns: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchPipelineRuns: (...args: unknown[]) => mockFetchPipelineRuns(...args),
  };
});

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <AdminPipelineRunsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminPipelineRunsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: "u1", telegram_id: 1, role: "owner" },
      isAuthenticated: true,
      isLoading: false,
    });
    mockFetchPipelineRuns.mockResolvedValue({
      summary: {
        total_runs: 1,
        running_runs: 0,
        failed_runs: 0,
        aborted_runs: 0,
        discovered: 2,
        scraped: 1,
        extracted: 1,
        upserted: 1,
        llm_calls: 0,
        cost_usd: 0,
      },
      runs: [
        {
          run_id: "11111111-1111-4111-8111-111111111111",
          started_at: "2026-06-08T02:00:00.000Z",
          finished_at: "2026-06-08T02:01:00.000Z",
          trigger: "cron",
          court: "FCA",
          phase: "discovery",
          discovered: 2,
          scraped: 1,
          extracted: 1,
          upserted: 1,
          llm_calls: 0,
          cost_usd: 0,
          errors: 0,
          errors_json: null,
          status: "ok",
          abort_reason: null,
          duration_seconds: 60,
        },
      ],
    });
  });

  it("renders recent Cloudflare pipeline runs for owner users", async () => {
    renderPage();

    expect(await screen.findByText("Recent runs")).toBeInTheDocument();
    expect(await screen.findByText("FCA")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(mockFetchPipelineRuns).toHaveBeenCalledWith(30);
  });

  it("does not fetch pipeline runs for non-admin users", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u2", telegram_id: 2, role: "member" },
      isAuthenticated: true,
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
    expect(mockFetchPipelineRuns).not.toHaveBeenCalled();
  });
});
