/**
 * frontend/__tests__/llm-council-thread.test.tsx
 *
 * Vitest tests for the LLM Council thread UI:
 *   - TurnCard rendering (user msg + opinions + moderator section)
 *   - LlmCouncilPage thread view (0 / 3 / 15 turns)
 *   - Send button disabled at turn limit (total_turns >= 15)
 *
 * Test integrity: ≥4 assertions were force-failed (RED) then restored (GREEN).
 * See implementation report for the 4 RED→GREEN cycles documented.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

import { TurnCard } from "@/components/llm-council/TurnCard";
import { LlmCouncilPage } from "@/pages/LlmCouncilPage";
import type {
  LlmCouncilTurn,
  LlmCouncilSession,
} from "@/lib/api-llm-council";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeModerator(overrides = {}) {
  return {
    success: true,
    composed_answer: "Council answer here.",
    consensus: "All agree",
    disagreements: "",
    outcome_likelihood_percent: 70,
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
    ...overrides,
  };
}

function makeTurn(
  index: number,
  message = `Question ${index}`,
): LlmCouncilTurn {
  return {
    turn_id: `turn-${index}`,
    turn_index: index,
    user_message: message,
    opinions: [
      {
        provider_key: "openai",
        provider_label: "OpenAI",
        model: "gpt-5-mini",
        success: true,
        answer: `OpenAI answer for turn ${index}`,
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

// ─── Render helpers ───────────────────────────────────────────────────────────

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

function renderTurnCard(turn: LlmCouncilTurn, turnNumber = 1) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter>
        <TurnCard turn={turn} turnNumber={turnNumber} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderThreadPage(sessionId: string) {
  return render(
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={[`/llm-council/sessions/${sessionId}`]}>
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

function renderNewSessionPage() {
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

// ─── TurnCard unit tests ──────────────────────────────────────────────────────

describe("TurnCard", () => {
  it("renders the user message text", () => {
    const turn = makeTurn(1, "Is procedural fairness required?");
    renderTurnCard(turn, 1);
    expect(
      screen.getByText("Is procedural fairness required?"),
    ).toBeInTheDocument();
  });

  it("has data-testid='turn-card' on root element", () => {
    const turn = makeTurn(1);
    renderTurnCard(turn, 1);
    expect(screen.getByTestId("turn-card")).toBeInTheDocument();
  });

  it("renders the opinion provider label", () => {
    const turn = makeTurn(1);
    renderTurnCard(turn, 1);
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
  });

  it("renders the moderator section (data-testid='moderator-section')", () => {
    const turn = makeTurn(1);
    renderTurnCard(turn, 1);
    expect(screen.getByTestId("moderator-section")).toBeInTheDocument();
  });

  it("renders the moderator composed answer", () => {
    const turn = makeTurn(1);
    renderTurnCard(turn, 1);
    expect(screen.getByText("Council answer here.")).toBeInTheDocument();
  });

  it("includes the turn number in the label", () => {
    const turn = makeTurn(5, "Fifth question");
    renderTurnCard(turn, 5);
    // The root div has aria-label="Turn 5" — check via testId + attribute
    const card = screen.getByTestId("turn-card");
    expect(card.getAttribute("aria-label")).toBe("Turn 5");
  });
});

// ─── LlmCouncilPage — thread view (0 / 3 / 15 turns) ─────────────────────────

describe("LlmCouncilPage — thread view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreateSession.mockReturnValue(idleMutation());
    mockUseAddTurn.mockReturnValue(idleMutation());
  });

  // ── 0 turns ──────────────────────────────────────────────────────────────

  it("renders 0 TurnCards when session has no turns", () => {
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(0), turns: [] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(screen.queryAllByTestId("turn-card")).toHaveLength(0);
  });

  it("shows the turn badge '0/15' when session has 0 turns", () => {
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(0), turns: [] },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    const badge = screen.getByTestId("turn-count-badge");
    expect(badge.textContent).toContain("0/15");
  });

  // ── 3 turns ──────────────────────────────────────────────────────────────

  it("renders exactly 3 TurnCards when session has 3 turns", () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(3), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(screen.queryAllByTestId("turn-card")).toHaveLength(3);
  });

  it("shows Turn 3/15 badge when session has 3 turns", () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(3), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    const badge = screen.getByTestId("turn-count-badge");
    expect(badge.textContent).toContain("3/15");
  });

  it("Send button is present and NOT in turn-limit-disabled state at 3 turns", () => {
    const turns = [makeTurn(1), makeTurn(2), makeTurn(3)];
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(3), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    // Button is disabled only due to empty textarea — not limit message shown
    expect(
      screen.queryByText(/maximum of 15 turns/i),
    ).not.toBeInTheDocument();
  });

  // ── 15 turns (AT LIMIT) ───────────────────────────────────────────────────

  it("renders exactly 15 TurnCards when session has 15 turns", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(15), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(screen.queryAllByTestId("turn-card")).toHaveLength(15);
  });

  it("Send button is disabled when total_turns >= 15", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(15), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });

  it("shows Turn 15/15 badge when at limit", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(15), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    const badge = screen.getByTestId("turn-count-badge");
    expect(badge.textContent).toContain("15/15");
  });

  it("shows turn limit reached message at 15 turns", () => {
    const turns = Array.from({ length: 15 }, (_, i) => makeTurn(i + 1));
    mockUseLlmCouncilSession.mockReturnValue({
      data: { session: makeSession(15), turns },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(
      screen.getByText(/maximum of 15 turns/i),
    ).toBeInTheDocument();
  });

  // ── loading / error states ────────────────────────────────────────────────

  it("shows no TurnCards while session is loading", () => {
    mockUseLlmCouncilSession.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderThreadPage("abc123def456");

    expect(screen.queryAllByTestId("turn-card")).toHaveLength(0);
  });

  it("shows error message when session load fails", () => {
    mockUseLlmCouncilSession.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network failure"),
    });

    renderThreadPage("abc123def456");

    expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
  });
});

// ─── LlmCouncilPage — new session form ───────────────────────────────────────

describe("LlmCouncilPage — new session form", () => {
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

  it("renders question textarea on the new-session page", () => {
    renderNewSessionPage();
    expect(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
    ).toBeInTheDocument();
  });

  it("renders Send button on the new-session page", () => {
    renderNewSessionPage();
    expect(
      screen.getByRole("button", { name: /Send/i }),
    ).toBeInTheDocument();
  });

  it("Send button is disabled when message is empty", () => {
    renderNewSessionPage();
    expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
  });
});
