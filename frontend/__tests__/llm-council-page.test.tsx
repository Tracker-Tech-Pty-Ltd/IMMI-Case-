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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// playHaptic is left as the REAL implementation (not stubbed) so the Slice H
// haptic-on-submit test below can assert against navigator.vibrate directly,
// the same way frontend/__tests__/council-celebrations.test.ts does. It is a
// safe no-op in every other test here: jsdom defines neither
// navigator.vibrate nor window.matchMedia by default, so playHaptic's
// feature-detect returns early without touching either.
vi.mock("@/lib/council-celebrations", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/council-celebrations")
  >("@/lib/council-celebrations");
  return {
    fireSubmitGavelBurst: vi.fn(),
    fireCouncilDoneCelebration: vi.fn(),
    isSoundOn: vi.fn(() => false),
    toggleSound: vi.fn(() => false),
    playCue: vi.fn(),
    playHaptic: actual.playHaptic,
    recordCouncilRun: vi.fn(() => []),
    unlockRobeTheme: vi.fn(),
    isRobeThemeUnlocked: vi.fn(() => false),
    timeOfDaySalutation: vi.fn(() => "Court is now in session."),
    getCouncilStats: vi.fn(() => ({ totalRuns: 0, streak: 0 })),
  };
});

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

// ─── Slice H — Mobile/iOS optimisations (MessageInput additions) ─────────────
//
// MessageInput is a local, unexported component inside LlmCouncilPage.tsx
// (the ralplan-pending-work-2026-05-10.md spec names a standalone
// frontend/src/components/llm-council/MessageInput.tsx, which does not
// exist in current code — MessageInput has always lived inline in this
// page file. Following current code per task instructions: these tests
// exercise it through the rendered LlmCouncilPage, same as the rest of
// this file).
//
// navigator.userAgent / navigator.maxTouchPoints are read once per mount
// via isIosDevice(), so each test stubs them with Object.defineProperty
// (configurable so afterEach in this suite's beforeEach reset works) before
// rendering.
describe("LlmCouncilPage — Slice H mobile/iOS input additions", () => {
  const originalUserAgent = navigator.userAgent;
  const originalMaxTouchPoints = navigator.maxTouchPoints;

  function stubUserAgent(ua: string, maxTouchPoints = 0) {
    Object.defineProperty(navigator, "userAgent", {
      value: ua,
      configurable: true,
    });
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: maxTouchPoints,
      configurable: true,
    });
  }

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

  afterEach(() => {
    stubUserAgent(originalUserAgent, originalMaxTouchPoints);
  });

  // Hint rendering condition — non-iOS shows the Cmd+Enter kbd hint.
  it("shows the Cmd+Enter hint (not the iOS hint) on a desktop user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      0,
    );
    renderNewSession();
    expect(screen.getByText("Cmd")).toBeInTheDocument();
    expect(screen.getByText("Enter")).toBeInTheDocument();
    expect(screen.queryByTestId("ios-send-hint")).not.toBeInTheDocument();
  });

  // Hint rendering condition — iPhone user agent shows the iOS fallback hint.
  it("shows the iOS fallback hint on an iPhone user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      5,
    );
    renderNewSession();
    expect(screen.getByTestId("ios-send-hint")).toHaveTextContent(
      /no cmd\+enter on ios/i,
    );
    expect(screen.queryByText("Cmd")).not.toBeInTheDocument();
  });

  // Hint rendering condition — iPadOS 13+ reports as "Macintosh" but is
  // touch-driven (maxTouchPoints > 1); must still be detected as iOS.
  it("shows the iOS fallback hint on an iPadOS-13+ user agent (desktop UA + touch)", () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15",
      5,
    );
    renderNewSession();
    expect(screen.getByTestId("ios-send-hint")).toBeInTheDocument();
  });

  // Hint rendering condition — a real Mac (no touch points) is NOT
  // misdetected as an iPad just because it shares the "Macintosh" token.
  it("does not show the iOS hint on a real Mac with no touch points", () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      0,
    );
    renderNewSession();
    expect(screen.queryByTestId("ios-send-hint")).not.toBeInTheDocument();
  });

  // Swipe handle rendering condition — hidden for short/empty messages.
  it("does not render the swipe-to-send handle when the message is 5 chars or fewer", () => {
    renderNewSession();
    const textarea = screen.getByPlaceholderText(
      /Compare strongest review grounds/i,
    );
    fireEvent.change(textarea, { target: { value: "short" } }); // exactly 5 chars
    expect(
      screen.queryByTestId("swipe-to-send-handle"),
    ).not.toBeInTheDocument();
  });

  // Swipe handle rendering condition — appears once the message exceeds
  // 5 chars, per the plan's threshold.
  it("renders the swipe-to-send handle once the message exceeds 5 chars", () => {
    renderNewSession();
    const textarea = screen.getByPlaceholderText(
      /Compare strongest review grounds/i,
    );
    fireEvent.change(textarea, { target: { value: "six chars+" } });
    expect(screen.getByTestId("swipe-to-send-handle")).toBeInTheDocument();
  });

  // Swipe handler wiring — a rightward drag past the threshold submits,
  // same as clicking Send. Assert on the SSE POST the same way the
  // existing "POSTs to ... stream" test above does.
  it("submits via a rightward swipe past the threshold on the swipe handle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const body = new ReadableStream({
        start() {
          /* keep open — we only check that the POST happened */
        },
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
        target: { value: "Is procedural fairness required here?" },
      });
      const handle = screen.getByTestId("swipe-to-send-handle");

      fireEvent.touchStart(handle, { touches: [{ clientX: 0 }] });
      fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 80 }] });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/v1/llm-council/stream",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining(
              "Is procedural fairness required here?",
            ),
          }),
        );
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Swipe handler wiring — a short drag below the threshold must NOT submit
  // (distinguishes a deliberate swipe from touch-scroll wobble).
  it("does not submit when the swipe distance is below the threshold", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      renderNewSession();
      const textarea = screen.getByPlaceholderText(
        /Compare strongest review grounds/i,
      );
      fireEvent.change(textarea, {
        target: { value: "Is procedural fairness required here?" },
      });
      const handle = screen.getByTestId("swipe-to-send-handle");

      fireEvent.touchStart(handle, { touches: [{ clientX: 0 }] });
      fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 10 }] }); // well under the 48px threshold

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Haptic wiring — Send button click (item 1 of the plan's 3 haptic
  // touchpoints) routes through the shared handleSend, which now calls
  // playHaptic() right alongside the existing fireSubmitGavelBurst()/
  // playCue("gavel") submit ritual. playHaptic is NOT stubbed by the module
  // mock above, so this exercises the real implementation end-to-end and
  // asserts on navigator.vibrate directly — the same technique
  // council-celebrations.test.ts uses.
  it("vibrates on Send button click via the shared submit handler", async () => {
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const body = new ReadableStream({
        start() { /* keep open — only the haptic call matters here */ },
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
        { target: { value: "Does the haptic fire on send?" } },
      );
      fireEvent.submit(
        screen.getByRole("button", { name: /Send/i }).closest("form")!,
      );
      await waitFor(() => {
        expect(vibrateSpy).toHaveBeenCalledWith(20);
      });
    } finally {
      fetchSpy.mockRestore();
      // @ts-expect-error - removing a DOM property defined per-test
      delete navigator.vibrate;
    }
  });

  // Swipe handler wiring — a leftward drag must NOT submit either.
  it("does not submit on a leftward swipe", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      renderNewSession();
      const textarea = screen.getByPlaceholderText(
        /Compare strongest review grounds/i,
      );
      fireEvent.change(textarea, {
        target: { value: "Is procedural fairness required here?" },
      });
      const handle = screen.getByTestId("swipe-to-send-handle");

      fireEvent.touchStart(handle, { touches: [{ clientX: 80 }] });
      fireEvent.touchEnd(handle, { changedTouches: [{ clientX: 0 }] });

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
