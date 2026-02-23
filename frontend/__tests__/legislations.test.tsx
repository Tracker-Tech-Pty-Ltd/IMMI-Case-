import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import {
  mockPaginatedLegislations,
  mockSearchLegislations,
  mockEmptyPaginatedLegislations,
  mockEmptySearchLegislations,
} from "@/__mocks__/legislations";

// Define mocks at module level using hoisted
const { mockUseLegislations, mockUseLegislationSearch } = vi.hoisted(() => {
  return {
    mockUseLegislations: vi.fn(),
    mockUseLegislationSearch: vi.fn(),
  };
});

vi.mock("@/hooks/use-legislations", () => ({
  useLegislations: mockUseLegislations,
  useLegislationSearch: mockUseLegislationSearch,
  useLegislationUpdateStatus: vi.fn(() => ({ data: null, isLoading: false })),
  useStartLegislationUpdate: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

import { LegislationsPage } from "@/pages/LegislationsPage";

// Helper to render with providers
const renderWithProviders = (
  component: React.ReactElement,
  initialRoute = "/",
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  // Set the initial route before rendering
  window.history.pushState({}, "", initialRoute);

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{component}</BrowserRouter>
    </QueryClientProvider>,
  );
};

describe("LegislationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the URL to clean state
    window.history.pushState({}, "", "/legislations");
  });

  // Test 1: Initial render with loading state
  it("應顯示載入狀態直到數據加載完成", async () => {
    mockUseLegislations.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      status: "pending",
      isPending: true,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: true,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // Test 2: Display legislations after loading
  it("應在數據加載後顯示法律列表", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    expect(screen.getByText("Migration Act 1958")).toBeInTheDocument();
    expect(screen.getByText("Migration Regulations 1994")).toBeInTheDocument();
  });

  // Test 3: Search functionality
  it("應支持搜尋法律", async () => {
    const user = userEvent.setup();

    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: mockSearchLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeInTheDocument();

    await user.type(searchInput, "migration");

    await waitFor(() => {
      expect(mockUseLegislationSearch).toHaveBeenCalled();
    });
  });

  // Test 4: Display empty state when no results
  it("應在無搜尋結果時顯示空狀態", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockEmptyPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: mockEmptySearchLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    // Check for empty state by finding heading (multiple elements have "no" text)
    const headings = screen.getAllByText(/no legislations/i);
    expect(headings.length).toBeGreaterThan(0);
  });

  // Test 5: Pagination control visibility
  it("應在有結果時顯示分頁控件", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    const paginationContainer = screen.queryByRole("navigation");
    expect(paginationContainer).toBeInTheDocument();
  });

  // Test 6: No pagination during search
  it("應在搜尋時隱藏分頁控件", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: mockSearchLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    // Start with search query already set
    renderWithProviders(<LegislationsPage />, "/legislations?q=migration");

    // When search is active, pagination text with "Showing" should not be visible
    // The pagination component shows "Showing X of Y results" text
    const paginationText = screen.queryByText(/^Showing/);
    expect(paginationText).not.toBeInTheDocument();
  });

  // Test 7: Legislation item metadata display
  it("應正確顯示法律項目的元數據", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    // Check for legislation title and metadata
    const results = screen.getByText("Migration Act 1958");
    expect(results).toBeInTheDocument();
    // Check for jurisdictions (there are multiple, so getAllByText is more appropriate)
    const commonwealthElements = screen.getAllByText("Commonwealth");
    expect(commonwealthElements.length).toBeGreaterThan(0);
  });

  // Test 8: Shortcode badge display
  it("應在有簡稱時顯示簡稱徽章", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    expect(screen.getByText("MA")).toBeInTheDocument();
    expect(screen.getByText("MR")).toBeInTheDocument();
  });

  // Test 9: Description truncation
  it("應正確顯示法律描述（限制行數）", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    // Check for partial description text
    expect(screen.getByText(/governing immigration/i)).toBeInTheDocument();
  });

  // Test 10: Date formatting
  it("應正確格式化更新日期", async () => {
    mockUseLegislations.mockReturnValue({
      data: mockPaginatedLegislations,
      isLoading: false,
      error: null,
      status: "success",
      isPending: false,
      isSuccess: true,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    mockUseLegislationSearch.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      status: "pending",
      isPending: false,
      isSuccess: false,
      failureCount: 0,
      failureReason: null,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationsPage />, "/legislations");

    expect(screen.getByText(/15 Jan 2024/)).toBeInTheDocument();
  });
});
