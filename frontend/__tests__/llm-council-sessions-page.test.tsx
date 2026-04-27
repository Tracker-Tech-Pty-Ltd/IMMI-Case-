/**
 * frontend/__tests__/llm-council-sessions-page.test.tsx
 *
 * Vitest tests for LlmCouncilSessionsPage and SessionListItem (US-011).
 *
 * Test integrity (RED→GREEN cycles):
 *   Cycle 1 — sidebar renders N session items
 *   Cycle 2 — clicking a session item link has correct href
 *   Cycle 3 — delete button triggers onDelete with correct sessionId
 *   Cycle 4 — empty state shown when sessions list is empty
 *   Cycle 5 — loading skeleton shown while isLoading=true
 *
 * Mock strategy:
 *   - vi.mock("@/hooks/use-llm-council-sessions") — hooks replaced with vi.fn()
 *   - useNavigate mocked; navigate call assertions included
 *   - Wrapped in QueryClientProvider + MemoryRouter
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
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
import {
  SessionListItem,
  relativeTime,
} from "@/components/llm-council/SessionListItem";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

function renderItem(
  session: LlmCouncilSessionListItem,
  onDelete = vi.fn(),
  isDeleting = false,
) {
  return render(
    <MemoryRouter initialEntries={["/llm-council/sessions"]}>
      <SessionListItem
        session={session}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </MemoryRouter>,
  );
}

// ─── LlmCouncilSessionsPage tests ────────────────────────────────────────────

describe("LlmCouncilSessionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDeleteSession.mockReturnValue(idleDelete());
  });

  // 1. Sidebar renders correct number of session items
  it("renders 3 session items when useLlmCouncilSessions returns 3 sessions", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: {
        sessions: [
          makeSession({ session_id: "id1" }),
          makeSession({ session_id: "id2" }),
          makeSession({ session_id: "id3" }),
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getAllByTestId("session-list-item")).toHaveLength(3);
  });

  it("renders 1 session item when useLlmCouncilSessions returns 1 session", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [makeSession()] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getAllByTestId("session-list-item")).toHaveLength(1);
  });

  // 2. Empty state
  it("shows empty state when sessions list is empty", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByTestId("sessions-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-list")).not.toBeInTheDocument();
  });

  // 3. Loading skeleton
  it("shows loading skeleton when isLoading is true", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    renderPage();
    expect(screen.getByTestId("sessions-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("sessions-list")).not.toBeInTheDocument();
  });

  // 4. Error state
  it("shows error message when isError is true", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderPage();
    expect(screen.getByTestId("sessions-error")).toBeInTheDocument();
  });

  // 5. Sidebar + detail placeholder both rendered
  it("renders both sidebar and detail placeholder", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByTestId("sessions-sidebar")).toBeInTheDocument();
    expect(
      screen.getByTestId("sessions-detail-placeholder"),
    ).toBeInTheDocument();
  });

  // 6. "Past Sessions" heading present
  it("renders 'Past Sessions' heading in sidebar", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    // Use exact text match to avoid matching "No past sessions yet."
    expect(screen.getByText("Past Sessions")).toBeInTheDocument();
  });

  // 7. New Council Session button navigates to /llm-council
  it("clicking 'New Council Session' button calls navigate('/llm-council')", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [] },
      isLoading: false,
      isError: false,
    });
    renderPage();
    fireEvent.click(screen.getByTestId("new-session-btn"));
    expect(navigateMock).toHaveBeenCalledWith("/llm-council");
  });

  // 8. Session item link has correct href
  it("each session item renders a link to /llm-council/sessions/:id", () => {
    mockUseLlmCouncilSessions.mockReturnValue({
      data: {
        sessions: [makeSession({ session_id: "sess-abc-123" })],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    const link = screen.getByTestId("session-list-item");
    expect(link).toHaveAttribute(
      "href",
      "/llm-council/sessions/sess-abc-123",
    );
  });

  // 9. Delete → confirm → calls deleteSession.mutate with sessionId
  it("clicking delete then confirming calls deleteSession.mutate with sessionId", async () => {
    const mutateMock = vi.fn();
    mockUseDeleteSession.mockReturnValue(idleDelete({ mutate: mutateMock }));
    mockUseLlmCouncilSessions.mockReturnValue({
      data: { sessions: [makeSession({ session_id: "to-delete-123" })] },
      isLoading: false,
      isError: false,
    });
    renderPage();

    fireEvent.click(screen.getByTestId("session-delete-btn"));

    // ConfirmModal appears
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();
    });

    // Click the "Delete" confirm button (modal's confirm button)
    const deleteButtons = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith("to-delete-123");
    });
  });
});

// ─── SessionListItem unit tests ───────────────────────────────────────────────

describe("SessionListItem", () => {
  // 10. Title truncated at 50 chars
  it("truncates title longer than 50 characters", () => {
    const longTitle = "A".repeat(60);
    renderItem(makeSession({ title: longTitle }));
    expect(screen.queryByText(longTitle)).not.toBeInTheDocument();
    expect(screen.getByText("A".repeat(50) + "…")).toBeInTheDocument();
  });

  it("shows full title when title is 50 chars or fewer", () => {
    const shortTitle = "Short title";
    renderItem(makeSession({ title: shortTitle }));
    expect(screen.getByText(shortTitle)).toBeInTheDocument();
  });

  // 11. total_turns badge
  it("displays total_turns in the turns badge", () => {
    renderItem(makeSession({ total_turns: 7 }));
    const badge = screen.getByTestId("session-turns-badge");
    expect(badge.textContent).toContain("7");
    expect(badge.textContent).toContain("turns");
  });

  it("uses singular 'turn' when total_turns is 1", () => {
    renderItem(makeSession({ total_turns: 1 }));
    const badge = screen.getByTestId("session-turns-badge");
    expect(badge.textContent).toContain("1");
    expect(badge.textContent).toContain("turn");
    expect(badge.textContent).not.toContain("turns");
  });

  // 12. Relative time shown
  it("shows relative time in the meta row", () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    renderItem(makeSession({ updated_at: old }));
    const timeEl = screen.getByTestId("session-relative-time");
    expect(timeEl.textContent).toMatch(/\d+d ago/);
  });

  // 13. Link points to correct URL
  it("renders a link to /llm-council/sessions/:session_id", () => {
    renderItem(makeSession({ session_id: "myid12345678" }));
    const link = screen.getByTestId("session-list-item");
    expect(link).toHaveAttribute(
      "href",
      "/llm-council/sessions/myid12345678",
    );
  });

  // 14. Delete button opens confirm modal
  it("shows confirm modal when delete button is clicked", async () => {
    renderItem(makeSession());
    fireEvent.click(screen.getByTestId("session-delete-btn"));
    await waitFor(() => {
      expect(
        screen.getByText(/This cannot be undone/i),
      ).toBeInTheDocument();
    });
  });

  // 15. onDelete called after confirmation
  it("calls onDelete with session_id when confirm modal is confirmed", async () => {
    const onDelete = vi.fn();
    renderItem(makeSession({ session_id: "confirm-me-456" }), onDelete);

    fireEvent.click(screen.getByTestId("session-delete-btn"));

    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /^Delete$/i });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith("confirm-me-456");
    });
  });

  // 16. Modal cancelled: onDelete NOT called
  it("does NOT call onDelete when confirm modal is cancelled", async () => {
    const onDelete = vi.fn();
    renderItem(makeSession({ session_id: "cancel-me-789" }), onDelete);

    fireEvent.click(screen.getByTestId("session-delete-btn"));

    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
  });
});

// ─── relativeTime unit tests ──────────────────────────────────────────────────

describe("relativeTime", () => {
  it("returns 'just now' for times within 60 seconds", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(recent)).toBe("just now");
  });

  it("returns 'Nm ago' for times within 60 minutes", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns 'Nh ago' for times within 24 hours", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    expect(relativeTime(twoHoursAgo)).toBe("2h ago");
  });

  it("returns 'Nd ago' for times older than 24 hours", () => {
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60_000,
    ).toISOString();
    expect(relativeTime(threeDaysAgo)).toBe("3d ago");
  });
});
