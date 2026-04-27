/**
 * frontend/__tests__/llm-council-page.test.tsx
 *
 * Vitest tests for LlmCouncilPage — reworked for thread UI (US-010).
 *
 * Tests cover:
 *  - New-session view (no sessionId): page title, form, send button, idle hint
 *  - Thread view (sessionId present): loads via useLlmCouncilSession,
 *    renders TurnCards, shows turn badge, disables Send at limit
 *
 * Mock strategy:
 *  - vi.mock("@/hooks/use-llm-council-sessions") — hooks replaced with vi.fn()
 *  - Wrapped in QueryClientProvider + MemoryRouter (useParams needs Router)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const {
  mockUseLlmCouncilSession,
  mockUseCreateSession,
  mockUseAddTurn,
} = vi.hoisted(() => ({
  mockUseLlmCouncilSession: vi.fn(),
  mockUseCreateSession: vi.fn(),
  mockUseAddTurn: vi.fn(),
}));

vi.mock("@/hooks/use-llm-council-sessions", () => ({
  useLlmCouncilSession: mockUseLlmCouncilSession,
  useLlmCouncilSessions: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
  }),
  useCreateSession: mockUseCreateSession,
  useAddTurn: mockUseAddTurn,
  useDeleteSession: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { LlmCouncilPage } from "@/pages/LlmCouncilPage";
import type {
  LlmCouncilTurn,
  LlmCouncilSession,
} from "@/lib/api-llm-council";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeModerator() {
  return {
    success: true,
    composed_answer: "The answer is yes.",
    consensus: "Agreement",
    disagreements: "",
    outcome_likelihood_percent: 72,
    outcome_likelihood_label: "high",
    outcome_likelihood_reason: "Strong precedents.",
    law_sections: [],
    mock_judgment: "",
    follow_up_questions: [],
    ranking: [],
    model_critiques: [],
    vote_summary: null,
    agreement_points: [],
    conflict_points: [],
    provider_law_sections: {},
    shared_law_sections: [],
    shared_law_sections_confidence_percent: 0,
    shared_law_sections_confidence_reason: "",
    raw_text: "",
    error: "",
    latency_ms: 1000,
  };
}

function makeTurn(index: number): LlmCouncilTurn {
  return {
    turn_id: `turn-${index}`,
    turn_index: index,
    user_message: `Question ${index}`,
    opinions: [
      {
        provider_key: "openai",
        provider_label: "OpenAI",
        model: "gpt-5-mini",
        success: true,
        answer: `Answer for turn ${index}`,
        error: "",
        sources: [],
        latency_ms: 500,
      },
    ],
    moderator: makeModerator(),
    created_at: "2026-04-28T04:00:00.000Z",
  };
}

function makeSession(totalTurns: number): LlmCouncilSession {
  return {
    session_id: "abc123def456",
    case_id: null,
    title: "Test session",
    status: "active",
    total_turns: totalTurns,
    created_at: "2026-04-28T04:00:00.000Z",
    updated_at: "2026-04-28T04:00:00.000Z",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function idleMutation(overrides = {}) {
  return {
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    ...overrides,
  };
}

/** Render at /llm-council (new session form — no sessionId) */
function renderNewSession() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/llm-council"]}>
        <Routes>
          <Route path="/llm-council" element={<LlmCouncilPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Render at /llm-council/sessions/:id (thread view) */
function renderThreadSession(
  sessionId: string,
  totalTurns: number,
  turns: LlmCouncilTurn[],
) {
  mockUseLlmCouncilSession.mockReturnValue({
    data: { session: makeSession(totalTurns), turns },
    isLoading: false,
    isError: false,
    error: null,
  });

  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter
        initialEntries={[`/llm-council/sessions/${sessionId}`]}
      >
        <Routes>
          <Route
            path="/llm-council/sessions/:sessionId"
            element={<LlmCouncilPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LlmCouncilPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreateSession.mockReturnValue(idleMutation());
    mockUseAddTurn.mockReturnValue(idleMutation());
    mockUseLlmCouncilSession.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  // 1. Page title always present
  it("renders the page title 'LLM IMMI Council'", () => {
    renderNewSession();
    expect(screen.getByText("LLM IMMI Council")).toBeInTheDocument();
  });

  // 2. New-session form: question textarea
  it("renders the question textarea on new-session view", () => {
    renderNewSession();
    expect(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
    ).toBeInTheDocument();
  });

  // 3. New-session form: Send button present
  it("renders Send button on new-session view", () => {
    renderNewSession();
    expect(
      screen.getByRole("button", { name: /Send/i }),
    ).toBeInTheDocument();
  });

  // 4. Send disabled when message is empty
  it("Send button is disabled when message textarea is empty", () => {
    renderNewSession();
    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });

  // 5. Idle hint on new-session view
  it("shows idle hint on new-session view", () => {
    renderNewSession();
    expect(
      screen.getByText(/Submit a question to start a new council session/i),
    ).toBeInTheDocument();
  });

  // 6. Pending state on createSession
  it("shows 'Running Council...' when createSession is pending", () => {
    mockUseCreateSession.mockReturnValue(
      idleMutation({ isPending: true }),
    );
    renderNewSession();
    expect(
      screen.getByRole("button", { name: /Running Council/i }),
    ).toBeDisabled();
  });

  // 7. Thread: 0 turns → 0 TurnCards
  it("renders 0 TurnCards when session has no turns", () => {
    renderThreadSession("abc123def456", 0, []);
    expect(screen.queryAllByTestId("turn-card")).toHaveLength(0);
  });

  // 8. Thread: 3 turns → 3 TurnCards
  it("renders 3 TurnCards when session has 3 turns", () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    renderThreadSession("abc123def456", 3, turns);
    expect(screen.queryAllByTestId("turn-card")).toHaveLength(3);
  });

  // 9. Thread: 15 turns → 15 TurnCards
  it("renders 15 TurnCards when session is at turn limit", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    renderThreadSession("abc123def456", 15, turns);
    expect(screen.queryAllByTestId("turn-card")).toHaveLength(15);
  });

  // 10. Send disabled at limit
  it("Send button is disabled when total_turns >= 15", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    renderThreadSession("abc123def456", 15, turns);
    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });

  // 11. Turn badge
  it("shows Turn 3/15 badge in thread view", () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    renderThreadSession("abc123def456", 3, turns);
    const badge = screen.getByTestId("turn-count-badge");
    expect(badge.textContent).toContain("3/15");
  });

  // 12. Limit-reached message
  it("shows limit-reached message when turns = 15", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    renderThreadSession("abc123def456", 15, turns);
    expect(
      screen.getByText(/maximum of 15 turns/i),
    ).toBeInTheDocument();
  });

  // 13. createSession called with the typed message
  it("calls createSession.mutateAsync on form submit with message text", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      session_id: "new-session-123",
    });
    mockUseCreateSession.mockReturnValue(idleMutation({ mutateAsync }));
    renderNewSession();

    fireEvent.change(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
      { target: { value: "Is procedural fairness required?" } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /Send/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Is procedural fairness required?",
        }),
      );
    });
  });

  // 14. Error banner shown on createSession failure
  it("shows inline error banner when createSession throws", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Token missing"));
    mockUseCreateSession.mockReturnValue(idleMutation({ mutateAsync }));
    renderNewSession();

    fireEvent.change(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
      { target: { value: "Some legal question" } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /Send/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Token missing/i)).toBeInTheDocument();
    });
  });
});
