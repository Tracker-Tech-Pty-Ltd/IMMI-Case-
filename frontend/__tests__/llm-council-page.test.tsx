import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Hoist mocks so they are available before any import ────────────────────
const { mockUseLlmCouncil, mockUseLlmCouncilHealthCheck } = vi.hoisted(() => ({
  mockUseLlmCouncil: vi.fn(),
  mockUseLlmCouncilHealthCheck: vi.fn(),
}));

vi.mock("@/hooks/use-llm-council", () => ({
  useLlmCouncil: mockUseLlmCouncil,
  useLlmCouncilHealthCheck: mockUseLlmCouncilHealthCheck,
}));

// Sonner toast — stub so we don't need a Toaster in the tree
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { LlmCouncilPage } from "@/pages/LlmCouncilPage";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <LlmCouncilPage />
    </QueryClientProvider>,
  );
}

/** Default idle mutation stub */
function idleMutation(overrides: object = {}) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
    ...overrides,
  };
}

// ─── Mock data ──────────────────────────────────────────────────────────────

const MOCK_COUNCIL_RESULT = {
  question: "Is procedural fairness required?",
  case_context: "",
  models: {
    openai: {
      provider: "OpenAI",
      model: "chatgpt-5.2",
      reasoning: "medium",
      web_search: true,
    },
    gemini_pro: {
      provider: "Google",
      model: "gemini-3.0-pro",
      reasoning_budget: 1024,
    },
    anthropic: {
      provider: "Anthropic",
      model: "claude-sonnet-4-6",
      reasoning_budget: 4096,
    },
    gemini_flash: {
      provider: "Google",
      model: "gemini-3.0-flash",
      role: "judge_rank_vote_and_composer",
    },
  },
  opinions: [
    {
      provider_key: "openai",
      provider_label: "OpenAI",
      model: "chatgpt-5.2",
      success: true,
      answer: "Yes, procedural fairness is required under the Migration Act.",
      error: "",
      sources: [],
      latency_ms: 1200,
    },
    {
      provider_key: "gemini_pro",
      provider_label: "Gemini Pro",
      model: "gemini-3.0-pro",
      success: true,
      answer: "Procedural fairness obligations apply per Kioa v West.",
      error: "",
      sources: [],
      latency_ms: 900,
    },
    {
      provider_key: "anthropic",
      provider_label: "Anthropic",
      model: "claude-sonnet-4-6",
      success: true,
      answer: "Yes — s.499 duty to accord procedural fairness.",
      error: "",
      sources: [],
      latency_ms: 1500,
    },
  ],
  moderator: {
    success: true,
    ranking: [
      {
        rank: 1,
        provider_key: "anthropic",
        provider_label: "Anthropic",
        score: 9,
        reason: "Most thorough.",
      },
    ],
    model_critiques: [],
    vote_summary: {
      winner_provider_key: "anthropic",
      winner_provider_label: "Anthropic",
      winner_reason: "Best legal citations",
      support_count: 2,
      neutral_count: 1,
      oppose_count: 0,
    },
    agreement_points: ["Procedural fairness required"],
    conflict_points: [],
    provider_law_sections: {},
    shared_law_sections: ["Migration Act s.499"],
    shared_law_sections_confidence_percent: 85,
    shared_law_sections_confidence_reason: "All providers cited same section.",
    consensus: "All providers agree",
    disagreements: "None",
    outcome_likelihood_percent: 72,
    outcome_likelihood_label: "high",
    outcome_likelihood_reason: "Strong precedents in applicant's favour.",
    law_sections: ["Migration Act s.499"],
    mock_judgment:
      "IN THE ADMINISTRATIVE APPEALS TRIBUNAL\nThe applicant succeeds.",
    composed_answer: "Council agrees procedural fairness is required.",
    follow_up_questions: [],
    raw_text: "",
    error: "",
    latency_ms: 2000,
  },
  retrieved_cases: [],
};

const MOCK_HEALTH_RESULT = {
  ok: true,
  live_probe: false,
  errors: [],
  providers: {
    openai: {
      model: "chatgpt-5.2",
      api_key_present: true,
      system_prompt_preview: "You are...",
    },
    gemini_pro: {
      model: "gemini-3.0-pro",
      api_key_present: true,
      system_prompt_preview: "Legal expert...",
    },
    anthropic: {
      model: "claude-sonnet-4-6",
      api_key_present: true,
      system_prompt_preview: "Analyse...",
    },
    gemini_flash: {
      model: "gemini-3.0-flash",
      api_key_present: true,
      system_prompt_preview: "Judge...",
    },
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LlmCouncilPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLlmCouncil.mockReturnValue(idleMutation());
    mockUseLlmCouncilHealthCheck.mockReturnValue(idleMutation());
  });

  // 1. Basic structure renders
  it("renders the page title and subtitle", () => {
    renderPage();
    expect(screen.getByText("LLM IMMI Council")).toBeInTheDocument();
    // Subtitle text (via defaultValue)
    expect(
      screen.getByText(/Direct multi-provider council/i),
    ).toBeInTheDocument();
  });

  // 2. Form inputs are present
  it("renders the question textarea and submit button", () => {
    renderPage();
    expect(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run LLM Council/i }),
    ).toBeInTheDocument();
  });

  // 3. Workflow steps section renders
  it("renders four workflow step cards", () => {
    renderPage();
    expect(screen.getByText("Input Legal Issue")).toBeInTheDocument();
    expect(screen.getByText("Find Closest Precedents")).toBeInTheDocument();
    expect(screen.getByText("3-Model Council Debate")).toBeInTheDocument();
    expect(screen.getByText("Compose Mock Judgment")).toBeInTheDocument();
  });

  // 4. Loading state: submit button shows spinner when mutation is pending
  it("shows 'Running Council...' label while mutation is pending", () => {
    mockUseLlmCouncil.mockReturnValue(idleMutation({ isPending: true }));
    renderPage();
    expect(
      screen.getByRole("button", { name: /Running Council/i }),
    ).toBeDisabled();
  });

  // 5. Advanced panel is collapsed by default and expands on click
  it("advanced controls panel is collapsed by default and expands when toggled", () => {
    renderPage();
    // Before clicking — the Advanced Controls heading exists but model cards are hidden
    const toggleBtn = screen.getByRole("button", {
      name: /Advanced Controls/i,
    });
    expect(toggleBtn).toBeInTheDocument();
    // The "Model Council Setup" heading is only visible after expanding
    expect(screen.queryByText(/Model Council Setup/i)).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);

    expect(screen.getByText(/Model Council Setup/i)).toBeInTheDocument();
  });

  // 6. After expanding advanced panel, provider model cards are shown with model names
  it("shows all four provider model cards when advanced panel is expanded", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Controls/i }));

    // DEFAULT_MODELS contains these model names
    expect(screen.getByText("chatgpt-5.2")).toBeInTheDocument();
    expect(screen.getByText("gemini-3.0-pro")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("gemini-3.0-flash")).toBeInTheDocument();
  });

  // 7. Health check button is present inside advanced panel
  it("shows Health Check button inside the advanced panel", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Controls/i }));
    expect(
      screen.getByRole("button", { name: /Health Check/i }),
    ).toBeInTheDocument();
  });

  // 8. Health check shows pending state
  it("disables Health Check button while health mutation is pending", () => {
    mockUseLlmCouncilHealthCheck.mockReturnValue(
      idleMutation({ isPending: true }),
    );
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Controls/i }));
    expect(screen.getByRole("button", { name: /Checking/i })).toBeDisabled();
  });

  // 9. Moderator result section renders after a successful council run
  it("renders council moderator results when result data is available", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(MOCK_COUNCIL_RESULT);
    mockUseLlmCouncil.mockReturnValue(idleMutation({ mutateAsync }));
    renderPage();

    // Type a question and submit the form
    fireEvent.change(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
      { target: { value: "Is procedural fairness required?" } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /Run LLM Council/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(screen.getByText(/Gemini Flash Ranking/i)).toBeInTheDocument();
    });

    // Moderator composed answer
    expect(
      screen.getByText("Council agrees procedural fairness is required."),
    ).toBeInTheDocument();
  });

  // 10. Outcome likelihood percentage is displayed
  it("renders outcome likelihood percentage from moderator result", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(MOCK_COUNCIL_RESULT);
    mockUseLlmCouncil.mockReturnValue(idleMutation({ mutateAsync }));
    renderPage();

    fireEvent.change(
      screen.getByPlaceholderText(/Compare strongest review grounds/i),
      { target: { value: "Is procedural fairness required?" } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: /Run LLM Council/i }).closest("form")!,
    );

    await waitFor(() => {
      expect(screen.getByText("72%")).toBeInTheDocument();
    });
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  // 11. Health results display after health check
  it("renders provider health result cards when health check is run", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(MOCK_HEALTH_RESULT);
    mockUseLlmCouncilHealthCheck.mockReturnValue(idleMutation({ mutateAsync }));
    renderPage();

    // Expand advanced panel
    fireEvent.click(screen.getByRole("button", { name: /Advanced Controls/i }));

    // Click health check button
    fireEvent.click(screen.getByRole("button", { name: /^Health Check/i }));

    await waitFor(() => {
      // All four providers render "API key: present" — use getAllByText
      const presentLabels = screen.getAllByText(/API key: present/i);
      expect(presentLabels.length).toBeGreaterThanOrEqual(1);
    });
    // Verify provider model names are shown
    expect(screen.getAllByText("chatgpt-5.2").length).toBeGreaterThanOrEqual(1);
  });

  // 12. Validation: submitting empty question shows error via toast
  it("does not call mutateAsync when question is empty on submit", async () => {
    const mutateAsync = vi.fn();
    mockUseLlmCouncil.mockReturnValue(idleMutation({ mutateAsync }));
    renderPage();

    // Submit without filling in a question
    const form = screen
      .getByRole("button", { name: /Run LLM Council/i })
      .closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });
});
