import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { mockLegislationDetail } from "@/__mocks__/legislations";

// Define mocks at module level using hoisted
const { mockUseLegislationDetail } = vi.hoisted(() => {
  return {
    mockUseLegislationDetail: vi.fn(),
  };
});

vi.mock("@/hooks/use-legislations", () => ({
  useLegislationDetail: mockUseLegislationDetail,
}));

// Mock LegislationTextViewer component
vi.mock("@/components/legislation/LegislationTextViewer", () => ({
  LegislationTextViewer: ({ sections }: any) => (
    <div data-testid="case-text-viewer">
      {sections?.map((s: any) => (
        <div key={s.id}>{s.title}</div>
      ))}
    </div>
  ),
}));

import { LegislationDetailPage } from "@/pages/LegislationDetailPage";

// Helper to render with router and providers
const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<div>Root</div>} />
          <Route path="/legislations/:id" element={component} />
          <Route path="/legislations" element={<div>Legislations List</div>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
};

describe("LegislationDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up the initial URL path
    window.history.replaceState({}, "", "/legislations/migration-act-1958");
  });

  // Test 1: Initial loading state
  it("應在加載時顯示載入消息", async () => {
    mockUseLegislationDetail.mockReturnValue({
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

    const { history } = window;
    history.pushState({}, "", "/legislations/migration-act-1958");

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  // Test 2: Display legislation details after loading
  it("應在加載後顯示法律詳細信息", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    // The element should be present immediately since data is ready
    // Get all instances and check that at least one exists
    const titleElements = screen.getAllByText("Migration Act 1958");
    expect(titleElements.length).toBeGreaterThan(0);
  });

  // Test 3: Display legislation information section
  it("應顯示法律信息部分", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Legislation Information/i)).toBeInTheDocument();
    });
  });

  // Test 4: Display shortcode badge
  it("應顯示簡稱徽章", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      const shortcodeBadges = screen.getAllByText("MA");
      expect(shortcodeBadges.length).toBeGreaterThan(0);
    });
  });

  // Test 5: Display jurisdiction
  it("應正確顯示管轄權", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Commonwealth")).toBeInTheDocument();
    });
  });

  // Test 6: Display type
  it("應正確顯示法律類型", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Act")).toBeInTheDocument();
    });
  });

  // Test 7: Display sections count
  it("應正確顯示條款數", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("500")).toBeInTheDocument();
    });
  });

  // Test 8: Display updated date
  it("應正確顯示更新日期", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/15 Jan 2024/)).toBeInTheDocument();
    });
  });

  // Test 9: Display full text using CaseTextViewer
  it("應使用 CaseTextViewer 顯示完整條文", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId("case-text-viewer")).toBeInTheDocument();
    });
  });

  // Test 10: Display back button
  it("應顯示返回按鈕", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      const backButtons = screen.getAllByText(/back/i);
      expect(backButtons.length).toBeGreaterThan(0);
    });
  });

  // Test 11: Display not found error
  it("應在法律不存在時顯示 404 錯誤", async () => {
    // Set URL for 404 case
    window.history.replaceState({}, "", "/legislations/non-existent");

    const notFoundError = new Error("Not found");
    mockUseLegislationDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: notFoundError,
      status: "error",
      isPending: false,
      isSuccess: false,
      failureCount: 1,
      failureReason: notFoundError,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationDetailPage />);

    // The error message should be displayed immediately
    // Look for the error description text instead
    expect(screen.getByText(/could not be found/i)).toBeInTheDocument();
  });

  // Test 12: Not found error has return link
  it("應在 404 頁面提供返回鏈接", async () => {
    // Set URL for 404 case
    window.history.replaceState({}, "", "/legislations/non-existent");

    const notFoundError = new Error("Not found");
    mockUseLegislationDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: notFoundError,
      status: "error",
      isPending: false,
      isSuccess: false,
      failureCount: 1,
      failureReason: notFoundError,
      isFetching: false,
      isStale: false,
      dataUpdatedAt: 0,
      remove: vi.fn(),
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      const backButtons = screen.getAllByText(/back/i);
      expect(backButtons.length).toBeGreaterThan(0);
    });
  });

  // Test 13: Display last amended date
  it("應正確顯示最後修訂日期", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/1 Dec 2023/)).toBeInTheDocument();
    });
  });

  // Test 14: Display breadcrumb
  it("應正確顯示麵包屑導航", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Legislation/i).length).toBeGreaterThan(0);
    });
  });

  // Test 15: Display description in hero section
  it("應在英雄部分顯示法律描述", async () => {
    mockUseLegislationDetail.mockReturnValue({
      data: mockLegislationDetail,
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

    renderWithProviders(<LegislationDetailPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/primary legislation governing immigration/i),
      ).toBeInTheDocument();
    });
  });
});
