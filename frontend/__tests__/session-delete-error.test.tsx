import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock useNavigate ─────────────────────────────────────────────────────────

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

// ─── Mock hooks ───────────────────────────────────────────────────────────────

const mockUseLlmCouncilSessions = vi.fn();
const mockUseDeleteSession = vi.fn();

vi.mock("@/hooks/use-llm-council-sessions", () => ({
  useLlmCouncilSessions: (...args: unknown[]) =>
    mockUseLlmCouncilSessions(...args),
  useDeleteSession: (...args: unknown[]) => mockUseDeleteSession(...args),
  useLlmCouncilSession: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateSession: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAddTurn: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { LlmCouncilSessionsPage } from "@/pages/LlmCouncilSessionsPage";
import { toast } from "sonner";
import type { LlmCouncilSessionListItem } from "@/lib/api-llm-council";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<LlmCouncilSessionListItem> = {},
): LlmCouncilSessionListItem {
  return {
    session_id: "abc123def456",
    case_id: null,
    title: "Can procedural fairness be waived in visa cancellation?",
    status: "active",
    total_turns: 3,
    created_at: "2026-04-28T04:00:00.000Z",
    updated_at: "2026-04-28T04:00:00.000Z",
    ...overrides,
  };
}

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function idleDelete(overrides = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined as string | undefined,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/llm-council/sessions"]}>
        <Routes>
          <Route
            path="/llm-council/sessions"
            element={<LlmCouncilSessionsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LlmCouncilSessionsPage session-delete error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [makeSession()] },
      isLoading: false,
      isError: false,
    });
  });

  it("calls mutate with an onError callback", async () => {
    const mockMutate = vi.fn();
    mockUseDeleteSession.mockReturnValue(idleDelete({ mutate: mockMutate }));

    renderPage();
    fireEvent.click(screen.getByTestId("session-delete-btn"));
    const confirmBtn = await screen.findByTestId("confirm-modal-confirm-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        "abc123def456",
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    });
  });

  it("shows translated toast copy on error and never leaks the raw D1 message", () => {
    const mockMutate = vi.fn();
    mockUseDeleteSession.mockReturnValue(idleDelete({ mutate: mockMutate }));

    renderPage();
    fireEvent.click(screen.getByTestId("session-delete-btn"));
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    const onError = mockMutate.mock.calls[0][1].onError as (
      err: unknown,
    ) => void;
    onError(new Error("D1_ERROR: no such table"));

    expect(toast.error).toHaveBeenCalledWith(
      "Could not delete this session. Please try again.",
    );
    expect(
      vi.mocked(toast.error).mock.calls.flat().join(" "),
    ).not.toContain("D1_ERROR");
  });

  it("still sends the raw error to console.error for diagnosis", () => {
    const mockMutate = vi.fn();
    mockUseDeleteSession.mockReturnValue(idleDelete({ mutate: mockMutate }));

    renderPage();
    fireEvent.click(screen.getByTestId("session-delete-btn"));
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    const rawError = new Error("D1_ERROR: no such table");
    const onError = mockMutate.mock.calls[0][1].onError as (
      err: unknown,
    ) => void;
    onError(rawError);

    expect(console.error).toHaveBeenCalledWith(
      "[llm-council] session delete failed",
      rawError,
    );
  });

  it("shows the same translated copy even when the error message is empty", () => {
    const mockMutate = vi.fn();
    mockUseDeleteSession.mockReturnValue(idleDelete({ mutate: mockMutate }));

    renderPage();
    fireEvent.click(screen.getByTestId("session-delete-btn"));
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    const onError = mockMutate.mock.calls[0][1].onError as (
      err: unknown,
    ) => void;
    onError(new Error(""));

    expect(toast.error).toHaveBeenCalledWith(
      "Could not delete this session. Please try again.",
    );
  });
});
