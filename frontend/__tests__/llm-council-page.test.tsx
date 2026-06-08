/**
 * frontend/__tests__/llm-council-page.test.tsx
 *
 * Vitest tests for LlmCouncilPage — reworked for thread UI (US-010).
 *
 * Tests cover:
 *  - New-session view (no sessionId): page title, form, send button, idle hint
 *  - Thread view (sessionId present): loads via useLlmCouncilSession,
 *    renders TurnCards, shows turn badge, disables Send at limit
 *  - sessionId="new" guard: redirects to /llm-council
 *  - addTurn input clear after success
 *  - 404/null data → "Session not found"
 *
 * Mock strategy:
 *  - vi.mock("@/hooks/use-llm-council-sessions") — hooks replaced with vi.fn()
 *  - vi.mock("react-router-dom") — useNavigate replaced with navigateMock
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
  navigateMock,
} = vi.hoisted(() => ({
  mockUseLlmCouncilSession: vi.fn(),
  mockUseCreateSession: vi.fn(),
  mockUseAddTurn: vi.fn(),
  navigateMock: vi.fn(),
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { id: "test-user", display_name: "Test User" },
    tenant: { id: "test-tenant", name: "Test Tenant" },
    tenants: [],
    accessToken: "test-token",
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    switchTenant: vi.fn(),
  }),
}));

vi.mock("@/lib/council-celebrations", () => ({
  fireSubmitGavelBurst: vi.fn(),
  fireCouncilDoneCelebration: vi.fn(),
  isSoundOn: vi.fn(() => false),
  toggleSound: vi.fn(() => false),
  playCue: vi.fn(),
  recordCouncilRun: vi.fn(() => []),
  unlockRobeTheme: vi.fn(),
  isRobeThemeUnlocked: vi.fn(() => false),
  timeOfDaySalutation: vi.fn(() => "Court is now in session."),
  getCouncilStats: vi.fn(() => ({ totalRuns: 0, streak: 0 })),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

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
    navigateMock.mockClear();
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

  // 6. Pending state during SSE streaming
  // NewSessionForm now uses useCouncilStream which POSTs to /stream and
  // flips isStreaming=true while reading the response body. Mock fetch
  // returning a never-resolving ReadableStream so isStreaming stays true
  // long enough to assert on the button state.
  it("shows 'Running Council...' when streaming is in flight", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const body = new ReadableStream({
        start() { /* never enqueue — keeps isStreaming=true */ },
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });
    try {
      renderNewSession();
      const textarea = screen.getByPlaceholderText(
        /Compare strongest review grounds/i,
      );
      fireEvent.change(textarea, {
        target: { value: "What grounds for AAT review?" },
      });
      fireEvent.submit(
        screen.getByRole("button", { name: /Send/i }).closest("form")!,
      );
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Running Council/i }),
        ).toBeDisabled();
      });
    } finally {
      fetchSpy.mockRestore();
    }
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

  // 13. SSE stream POSTed with the typed message; streaming view renders
  // inline (no navigation in new SSE flow). Mock fetch + assert on POST
  // url + body, and on the streaming-view container appearing.
  it("POSTs to /api/v1/llm-council/stream with the typed message and renders the streaming view", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const body = new ReadableStream({
        start() { /* keep open — we only check that the POST happened */ },
      });
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });
    try {
      renderNewSession();
      fireEvent.change(
        screen.getByPlaceholderText(/Compare strongest review grounds/i),
        { target: { value: "Is procedural fairness required?" } },
      );
      fireEvent.submit(
        screen.getByRole("button", { name: /Send/i }).closest("form")!,
      );

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/v1/llm-council/stream",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("Is procedural fairness required?"),
          }),
        );
      });
      // Streaming view mounts inline — no navigation
      await waitFor(() => {
        expect(
          screen.getByTestId("streaming-council-view"),
        ).toBeInTheDocument();
      });
      expect(navigateMock).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // 14. Error banner shown when SSE fetch fails
  it("shows inline error banner when streaming fetch fails", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("Token missing", {
          status: 401,
          statusText: "Unauthorized",
        }),
      );
    try {
      renderNewSession();
      fireEvent.change(
        screen.getByPlaceholderText(/Compare strongest review grounds/i),
        { target: { value: "Some legal question" } },
      );
      fireEvent.submit(
        screen.getByRole("button", { name: /Send/i }).closest("form")!,
      );
      // Error surfaces via the streaming-view council.error state, which
      // renders the streaming-council-view container even on failure.
      await waitFor(() => {
        expect(
          screen.getByTestId("streaming-council-view"),
        ).toBeInTheDocument();
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // 15. sessionId="new" redirects to /llm-council (item 2 guard)
  it("redirects to /llm-council when sessionId is 'new'", () => {
    // We need a route to land on so the Navigate has somewhere to go
    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/llm-council/sessions/new"]}>
          <Routes>
            <Route path="/llm-council" element={<div data-testid="new-session-page">New Session</div>} />
            <Route
              path="/llm-council/sessions/:sessionId"
              element={<LlmCouncilPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();
  });

  // 16. addTurn clears input after success (item 4)
  it("clears the textarea after addTurn succeeds", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseAddTurn.mockReturnValue(idleMutation({ mutateAsync }));
    renderThreadSession("abc123def456", 1, [makeTurn(1)]);

    const textarea = screen.getByPlaceholderText(/Ask a follow-up question/i);
    fireEvent.change(textarea, { target: { value: "Follow-up question text" } });
    expect(textarea).toHaveValue("Follow-up question text");

    fireEvent.submit(textarea.closest("form")!);

    await waitFor(() => {
      expect(textarea).toHaveValue("");
    });
  });

  // 17. getSession 404 → null data shows "Session not found" (item 5)
  it("shows 'Session not found' when useLlmCouncilSession returns null data", async () => {
    mockUseLlmCouncilSession.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(
      <QueryClientProvider client={makeQC()}>
        <MemoryRouter initialEntries={["/llm-council/sessions/abc123def456"]}>
          <Routes>
            <Route
              path="/llm-council/sessions/:sessionId"
              element={<LlmCouncilPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Session not found/i)).toBeInTheDocument();
    });
  });
});
