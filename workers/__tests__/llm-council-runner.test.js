/**
 * llm-council-runner.test.js
 *
 * Vitest unit tests for workers/llm-council/runner.js
 *
 * Mock strategy: vi.spyOn(globalThis, "fetch") intercepts every outbound
 * fetch call. Each test configures its own mock implementation so tests are
 * isolated and assertions target actual outgoing request payloads.
 *
 * Why mocking is required: gatewayChatCompletion calls the live Cloudflare
 * AI Gateway — real network calls would be slow, non-deterministic, and
 * require production secrets in CI. Mocking fetch lets us assert the exact
 * JSON body shape sent to each provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildHistoryMessages,
  gatewayChatCompletion,
  runCouncil,
  DEFAULT_OPENAI_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
} from "../llm-council/runner.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-like object that fetch returns.
 * @param {object|string} body
 * @param {number} status
 */
function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** Build a standard ChatCompletions response with the given text content. */
function chatResponse(content) {
  return makeResponse({ choices: [{ message: { content } }] });
}

/** Minimal env with CF_AIG_TOKEN and CF_GATEWAY_URL set. */
const mockEnv = {
  CF_AIG_TOKEN: "test-token-abc",
  CF_GATEWAY_URL: "https://gateway.example.com/v1/chat",
};

/** A valid moderator JSON response (minimal shape — all required fields). */
const moderatorJsonObj = {
  ranking: [
    { provider_key: "openai", score: 90, reason: "Thorough analysis." },
    { provider_key: "gemini_pro", score: 80, reason: "Good grounding." },
    { provider_key: "anthropic", score: 85, reason: "Strong adversarial." },
  ],
  model_critiques: [
    {
      provider_key: "openai",
      score: 90,
      vote: "support",
      strengths: "Clear",
      weaknesses: "None",
      critique: "Best overall.",
    },
    {
      provider_key: "gemini_pro",
      score: 80,
      vote: "neutral",
      strengths: "Sources",
      weaknesses: "Verbose",
      critique: "Good.",
    },
    {
      provider_key: "anthropic",
      score: 85,
      vote: "neutral",
      strengths: "Adversarial",
      weaknesses: "Pessimistic",
      critique: "Fine.",
    },
  ],
  vote_summary: {
    winner_provider_key: "openai",
    winner_reason: "Highest score.",
    support_count: 1,
    neutral_count: 2,
    oppose_count: 0,
  },
  agreement_points: ["Both cite s.36"],
  conflict_points: ["Differ on s.424A"],
  provider_law_sections: {
    openai: ["Migration Act 1958 (Cth) s 36"],
    gemini_pro: ["Migration Act 1958 (Cth) s 36"],
    anthropic: ["Migration Act 1958 (Cth) s 36"],
  },
  shared_law_sections: ["Migration Act 1958 (Cth) s 36"],
  consensus: "All agree on primary ground.",
  disagreements: "Differ on remedy.",
  outcome_likelihood_percent: 65,
  outcome_likelihood_label: "medium",
  outcome_likelihood_reason: "Reasonable chance.",
  law_sections: ["Migration Act 1958 (Cth) s 36"],
  mock_judgment: "Applicant succeeds.",
  composed_answer: "The council finds that the applicant has strong grounds.",
  follow_up_questions: ["What evidence supports primary ground?"],
};
const moderatorJson = JSON.stringify(moderatorJsonObj);

// ---------------------------------------------------------------------------
// buildHistoryMessages
// ---------------------------------------------------------------------------

describe("buildHistoryMessages", () => {
  it("returns empty array for empty prevTurns", () => {
    expect(buildHistoryMessages([])).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(buildHistoryMessages(undefined)).toEqual([]);
  });

  it("converts 2 prior turns into 4 messages [user, assistant, user, assistant]", () => {
    const prevTurns = [
      {
        user_message: "What is s.36?",
        payload: { moderator: { composed_answer: "s.36 is the protection visa criterion." } },
      },
      {
        user_message: "What about s.424A?",
        payload: { moderator: { composed_answer: "s.424A requires notice of adverse info." } },
      },
    ];
    const msgs = buildHistoryMessages(prevTurns);
    expect(msgs).toHaveLength(4);
    expect(msgs[0]).toEqual({ role: "user", content: "What is s.36?" });
    expect(msgs[1]).toEqual({
      role: "assistant",
      content: "s.36 is the protection visa criterion.",
    });
    expect(msgs[2]).toEqual({ role: "user", content: "What about s.424A?" });
    expect(msgs[3]).toEqual({
      role: "assistant",
      content: "s.424A requires notice of adverse info.",
    });
  });

  it("uses placeholder when composed_answer is absent", () => {
    const prevTurns = [{ user_message: "Question", payload: {} }];
    const msgs = buildHistoryMessages(prevTurns);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toBe("(No summary available for this turn.)");
  });

  it("skips turns with blank user_message", () => {
    const prevTurns = [
      { user_message: "   ", payload: { moderator: { composed_answer: "ignored" } } },
      {
        user_message: "Real question",
        payload: { moderator: { composed_answer: "Real answer" } },
      },
    ];
    const msgs = buildHistoryMessages(prevTurns);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("Real question");
  });
});

// ---------------------------------------------------------------------------
// gatewayChatCompletion — gpt-5 param remap
// ---------------------------------------------------------------------------

describe("gatewayChatCompletion — gpt-5 param remap", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends max_completion_tokens and temperature=1 for gpt-5 model, NOT max_tokens", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("GPT-5 answer"));

    await gatewayChatCompletion({
      env: mockEnv,
      model: "openai/gpt-5-mini-2025-08-07",
      systemPrompt: "You are an expert.",
      userPrompt: "What is s.36?",
      maxTokens: 2048,
      temperature: 0.2,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body.temperature).toBe(1);
  });

  it("sends max_tokens and caller temperature for non-gpt-5 model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatResponse("Gemini answer"));

    await gatewayChatCompletion({
      env: mockEnv,
      model: "google-ai-studio/gemini-2.5-flash",
      systemPrompt: "Sys",
      userPrompt: "User",
      maxTokens: 4096,
      temperature: 0.2,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(body.temperature).toBe(0.2);
  });

  it("includes cf-aig-authorization: Bearer <token> header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatResponse("OK"));

    await gatewayChatCompletion({
      env: mockEnv,
      model: "anthropic/claude-sonnet-4-6",
      systemPrompt: "Sys",
      userPrompt: "User",
    });

    const headers = vi.mocked(fetch).mock.calls[0][1].headers;
    expect(headers["cf-aig-authorization"]).toBe("Bearer test-token-abc");
  });

  it("builds [system, ...history, user] message array with history injected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(chatResponse("OK"));

    const history = [
      { role: "user", content: "Prior question" },
      { role: "assistant", content: "Prior answer" },
    ];

    await gatewayChatCompletion({
      env: mockEnv,
      model: "anthropic/claude-sonnet-4-6",
      systemPrompt: "System prompt",
      userPrompt: "Current question",
      history,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body);
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0]).toEqual({ role: "system", content: "System prompt" });
    expect(body.messages[1]).toEqual({ role: "user", content: "Prior question" });
    expect(body.messages[2]).toEqual({ role: "assistant", content: "Prior answer" });
    expect(body.messages[3]).toEqual({ role: "user", content: "Current question" });
  });
});

// ---------------------------------------------------------------------------
// runCouncil — happy path, no history (2 messages per expert)
// ---------------------------------------------------------------------------

describe("runCouncil — happy path, no history", () => {
  afterEach(() => vi.restoreAllMocks());

  it("each expert receives exactly [system, user] (2 messages) when no history", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer on s.36"))
      .mockResolvedValueOnce(chatResponse("Gemini Pro answer on s.36"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer on s.36"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    await runCouncil({
      env: mockEnv,
      question: "What is the s.36 protection visa criterion?",
    });

    // Calls 0..2 are the 3 expert calls (Promise.all — order may vary).
    // Call 3 is the moderator (sequential after experts complete).
    // We pick the 3 expert calls by excluding the moderator's flash model.
    const expertCalls = fetchSpy.mock.calls
      .map(([, opts]) => JSON.parse(opts.body))
      .filter((b) => !b.model.includes("gemini-2.5-flash"));

    expect(expertCalls).toHaveLength(3);
    for (const body of expertCalls) {
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
    }
  });

  it("result has opinions (3 items) and moderator with models shape", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer"))
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const result = await runCouncil({ env: mockEnv, question: "s.36 question" });

    expect(result.opinions).toHaveLength(3);
    expect(result.moderator).toBeDefined();
    expect(result.models).toHaveProperty("openai");
    expect(result.models).toHaveProperty("gemini_pro");
    expect(result.models).toHaveProperty("anthropic");
    expect(result.models).toHaveProperty("gemini_flash");
  });
});

// ---------------------------------------------------------------------------
// shared_law_sections_confidence_percent — moderator success path
// ---------------------------------------------------------------------------

describe("runCouncil — shared_law_sections_confidence_percent (moderator success path)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scores 100 with a full-overlap reason when all 3 providers cite the same section", async () => {
    // moderatorJsonObj has all 3 providers citing "Migration Act 1958 (Cth) s 36"
    // in both provider_law_sections and shared_law_sections — full agreement.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer"))
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const result = await runCouncil({ env: mockEnv, question: "Confidence full agreement" });

    expect(result.moderator.shared_law_sections_confidence_percent).toBe(100);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "Shared-all overlap: 1/1 unique sections; mean pairwise citation overlap: 100.0%."
    );
    // Regression guard: the old hardcoded placeholder must be gone.
    expect(result.moderator.shared_law_sections_confidence_reason).not.toContain(
      "not implemented"
    );
  });

  it("scores 0 with an honest per-provider reason when one provider cites nothing", async () => {
    const moderatorObjNoOverlap = {
      ...moderatorJsonObj,
      provider_law_sections: {
        openai: ["Migration Act 1958 (Cth) s 36"],
        gemini_pro: [],
        anthropic: ["Migration Act 1958 (Cth) s 36"],
      },
      shared_law_sections: [],
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer"))
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse(JSON.stringify(moderatorObjNoOverlap)));

    const result = await runCouncil({ env: mockEnv, question: "Confidence missing provider" });

    expect(result.moderator.shared_law_sections_confidence_percent).toBe(0);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "gemini_pro has no identifiable statutory/regulatory section citation for consistency scoring."
    );
  });

  // Regression tests: the moderator's own `provider_law_sections` and
  // `shared_law_sections` claims are unverified LLM output. The main
  // success path must merge `provider_law_sections` with citations
  // extracted from each expert's raw answer text, then RECOMPUTE
  // `shared_law_sections` from that merged data — never trust the
  // moderator's own `shared_law_sections` claim directly. Expected values
  // below were captured directly from the Python reference
  // (_build_provider_law_sections + _compute_shared_law_sections +
  // _compute_shared_law_sections_confidence in
  // immi_case_downloader/llm_council.py) via a one-off REPL check against
  // these exact scenarios.

  it("discards a moderator-hallucinated shared section absent from every provider list and every answer text (must not score 100)", async () => {
    const noCitationAnswer =
      "The tribunal considered the primary claim without any statutory citation.";
    const moderatorObjHallucinatedShared = {
      ...moderatorJsonObj,
      provider_law_sections: {
        openai: ["Migration Act 1958 (Cth) s 36"],
        gemini_pro: ["Migration Act 1958 (Cth) s 424A"],
        anthropic: ["Migration Act 1958 (Cth) s 500"],
      },
      // Moderator claims all 3 real per-provider citations PLUS a 4th
      // ("s 91") that no provider declared and no answer text mentions —
      // a pure hallucination. Trusting this directly makes the
      // intersection ratio 4/3 > 1, which clamps to a false 100%.
      shared_law_sections: [
        "Migration Act 1958 (Cth) s 36",
        "Migration Act 1958 (Cth) s 424A",
        "Migration Act 1958 (Cth) s 500",
        "Migration Act 1958 (Cth) s 91",
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse(noCitationAnswer))
      .mockResolvedValueOnce(chatResponse(noCitationAnswer))
      .mockResolvedValueOnce(chatResponse(noCitationAnswer))
      .mockResolvedValueOnce(
        chatResponse(JSON.stringify(moderatorObjHallucinatedShared))
      );

    const result = await runCouncil({
      env: mockEnv,
      question: "Hallucinated shared section test",
    });

    // The 3 providers' real citations are pairwise-disjoint, so the
    // recomputed shared set must be empty — the hallucinated section
    // is discarded, not carried through.
    expect(result.moderator.shared_law_sections).toEqual([]);
    expect(result.moderator.shared_law_sections_confidence_percent).not.toBe(100);
    expect(result.moderator.shared_law_sections_confidence_percent).toBe(0);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "Shared-all overlap: 0/3 unique sections; mean pairwise citation overlap: 0.0%."
    );
  });

  it("scores > 0 from expert answer text when the moderator declares no provider_law_sections at all", async () => {
    const moderatorObjNoDeclaredCitations = {
      ...moderatorJsonObj,
      provider_law_sections: {},
      shared_law_sections: [],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        chatResponse("Migration Act 1958 (Cth) s 36 is the key criterion for this case.")
      )
      .mockResolvedValueOnce(
        chatResponse("Migration Act 1958 (Cth) s 36 applies squarely here.")
      )
      .mockResolvedValueOnce(
        chatResponse("Migration Act 1958 (Cth) s 36 is directly on point.")
      )
      .mockResolvedValueOnce(
        chatResponse(JSON.stringify(moderatorObjNoDeclaredCitations))
      );

    const result = await runCouncil({
      env: mockEnv,
      question: "Moderator omits provider_law_sections test",
    });

    // provider_law_sections must be built from answer text even though the
    // moderator declared none.
    expect(result.moderator.provider_law_sections).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: ["Migration Act 1958 (Cth) s 36"],
      anthropic: ["Migration Act 1958 (Cth) s 36"],
    });
    expect(result.moderator.shared_law_sections).toEqual([
      "Migration Act 1958 (Cth) s 36",
    ]);
    expect(result.moderator.shared_law_sections_confidence_percent).toBeGreaterThan(0);
    expect(result.moderator.shared_law_sections_confidence_percent).toBe(100);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "Shared-all overlap: 1/1 unique sections; mean pairwise citation overlap: 100.0%."
    );
  });
});

// ---------------------------------------------------------------------------
// shared_law_sections_confidence_percent — fallback-moderator path
// ---------------------------------------------------------------------------

describe("runCouncil — shared_law_sections_confidence_percent (fallback-moderator path)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("computes a real confidence score from expert answer text when the moderator call fails", async () => {
    // All 3 experts succeed and each cites the same law section inline in
    // their answer text; the moderator's own call fails (HTTP 500 exhausts
    // retries), forcing the fallback-moderator path. Since expert citation
    // data IS available (the raw answer text), the fallback path must
    // extract it and report a real score — not a blanket placeholder.
    // Each answer opens directly with the citation (nothing capitalized
    // precedes it) so the citation regex captures a clean, identical
    // string per provider instead of sweeping up differing lead-in prose.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        chatResponse("Migration Act 1958 (Cth) s 36 is the key criterion for this case.")
      )
      .mockResolvedValueOnce(chatResponse("Migration Act 1958 (Cth) s 36 applies squarely here."))
      .mockResolvedValueOnce(chatResponse("Migration Act 1958 (Cth) s 36 is directly on point."))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500));

    const result = await runCouncil({ env: mockEnv, question: "Fallback confidence test" });

    expect(result.moderator.success).toBe(true);
    expect(result.moderator.shared_law_sections_confidence_percent).toBe(100);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "Shared-all overlap: 1/1 unique sections; mean pairwise citation overlap: 100.0%."
    );
    expect(result.moderator.shared_law_sections_confidence_reason).not.toContain(
      "not implemented"
    );
    expect(result.moderator.shared_law_sections_confidence_reason).not.toContain(
      "no citation cross-check performed"
    );
  });

  it("gives an honest reason (not a placeholder) when zero experts succeed", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500));

    const result = await runCouncil({ env: mockEnv, question: "Fallback all-fail test" });

    expect(result.moderator.success).toBe(false);
    expect(result.moderator.shared_law_sections_confidence_percent).toBe(0);
    expect(result.moderator.shared_law_sections_confidence_reason).toBe(
      "No successful expert outputs are available for consistency scoring."
    );
  });
});

// ---------------------------------------------------------------------------
// runCouncil — multi-turn (2 prior turns → 6 messages per expert)
// ---------------------------------------------------------------------------

describe("runCouncil — multi-turn with 2 prior turns", () => {
  afterEach(() => vi.restoreAllMocks());

  it("each expert receives [system, u1, a1, u2, a2, user_current] (6 messages)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI turn3"))
      .mockResolvedValueOnce(chatResponse("Gemini turn3"))
      .mockResolvedValueOnce(chatResponse("Anthropic turn3"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const prevTurns = [
      {
        user_message: "What is s.36?",
        payload: { moderator: { composed_answer: "s.36 is the protection visa test." } },
      },
      {
        user_message: "How does complementary protection work?",
        payload: {
          moderator: { composed_answer: "Complementary protection is in s.36(2)(aa)." },
        },
      },
    ];

    await runCouncil({
      env: mockEnv,
      question: "What are the strongest grounds for judicial review?",
      prevTurns,
    });

    // Pick expert calls (3 in parallel, then moderator runs sequential)
    // by excluding the moderator's flash model from fetch.mock.calls.
    const expertBodies = fetchSpy.mock.calls
      .map(([, opts]) => JSON.parse(opts.body))
      .filter((b) => !b.model.includes("gemini-2.5-flash"));

    expect(expertBodies).toHaveLength(3);
    for (const body of expertBodies) {
      expect(body.messages).toHaveLength(6);
    }

    for (const body of expertBodies) {
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1]).toEqual({ role: "user", content: "What is s.36?" });
      expect(body.messages[2]).toEqual({
        role: "assistant",
        content: "s.36 is the protection visa test.",
      });
      expect(body.messages[3]).toEqual({
        role: "user",
        content: "How does complementary protection work?",
      });
      expect(body.messages[4]).toEqual({
        role: "assistant",
        content: "Complementary protection is in s.36(2)(aa).",
      });
      expect(body.messages[5].role).toBe("user");
      expect(body.messages[5].content).toContain(
        "What are the strongest grounds for judicial review?"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Promise.all parallelism
// ---------------------------------------------------------------------------

describe("runCouncil — Promise.all parallelism", () => {
  afterEach(() => vi.restoreAllMocks());

  it("all 3 expert fetches start before any resolves (maxInFlight reaches 3)", async () => {
    let inFlightCount = 0;
    let maxInFlight = 0;
    let callCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        // Expert call — 20ms delay so all 3 start before any resolves
        inFlightCount++;
        maxInFlight = Math.max(maxInFlight, inFlightCount);
        return new Promise((resolve) => {
          setTimeout(() => {
            inFlightCount--;
            resolve(chatResponse("Expert answer"));
          }, 20);
        });
      }
      // 4th call = moderator — immediate
      return Promise.resolve(chatResponse(moderatorJson));
    });

    await runCouncil({ env: mockEnv, question: "Parallelism test" });

    // All 3 experts were in-flight simultaneously before any resolved
    expect(maxInFlight).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Moderator JSON shape — fenced ```json response
// ---------------------------------------------------------------------------

describe("runCouncil — moderator JSON shape from fenced response", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses fenced ```json moderator response and returns populated ranking array", async () => {
    const fenced = "```json\n" + moderatorJson + "\n```";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer"))
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse(fenced));

    const result = await runCouncil({ env: mockEnv, question: "Fenced moderator test" });

    expect(Array.isArray(result.moderator.ranking)).toBe(true);
    expect(result.moderator.ranking.length).toBeGreaterThan(0);

    const first = result.moderator.ranking[0];
    expect(first).toHaveProperty("provider_key");
    expect(first).toHaveProperty("score");
    expect(first).toHaveProperty("rank", 1);
  });

  it("moderator composed_answer is extracted from parsed JSON", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI answer"))
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const result = await runCouncil({ env: mockEnv, question: "Composed answer test" });

    expect(result.moderator.composed_answer).toBe(
      "The council finds that the applicant has strong grounds."
    );
  });
});

// ---------------------------------------------------------------------------
// History feed-through to moderator (4th call)
// ---------------------------------------------------------------------------

describe("runCouncil — history feed-through to moderator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moderator call (4th fetch) includes prior turn history messages", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponse("OpenAI"))
      .mockResolvedValueOnce(chatResponse("Gemini"))
      .mockResolvedValueOnce(chatResponse("Anthropic"))
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const prevTurns = [
      {
        user_message: "Prior question",
        payload: { moderator: { composed_answer: "Prior composed answer" } },
      },
    ];

    await runCouncil({ env: mockEnv, question: "Current question", prevTurns });

    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Moderator call is the one whose user prompt contains the JSON "opinions" field
    const allBodies = fetchSpy.mock.calls.map(([, opts]) => JSON.parse(opts.body));
    const moderatorBody = allBodies.find((b) =>
      b.messages.some((m) => m.role === "user" && m.content.includes('"opinions"'))
    );
    expect(moderatorBody).toBeDefined();

    // History turns appear in moderator messages too
    const historyUserMsg = moderatorBody.messages.find(
      (m) => m.role === "user" && m.content === "Prior question"
    );
    expect(historyUserMsg).toBeDefined();

    const historyAssistantMsg = moderatorBody.messages.find(
      (m) => m.role === "assistant" && m.content === "Prior composed answer"
    );
    expect(historyAssistantMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling — 1 expert fails
// ---------------------------------------------------------------------------

describe("runCouncil — error handling when 1 expert fails", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 2 successful + 1 failed opinion when OpenAI exhausts retries on HTTP 500", async () => {
    // Sprint 1 P1: runExpert retries server_error once. So OpenAI failing
    // requires 2× HTTP 500 to exhaust the retry budget. Gemini + Anthropic
    // succeed first try; moderator succeeds first try.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse({ error: "Server error" }, 500)) // openai attempt 1
      .mockResolvedValueOnce(chatResponse("Gemini answer on jurisdiction"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer on jurisdiction"))
      .mockResolvedValueOnce(makeResponse({ error: "Server error" }, 500)) // openai retry attempt 2
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const result = await runCouncil({
      env: mockEnv,
      question: "What grounds exist for jurisdictional error?",
    });

    expect(result.opinions).toHaveLength(3);

    const openaiOp = result.opinions.find((o) => o.provider_key === "openai");
    const geminiOp = result.opinions.find((o) => o.provider_key === "gemini_pro");
    const anthropicOp = result.opinions.find((o) => o.provider_key === "anthropic");

    expect(openaiOp.success).toBe(false);
    expect(openaiOp.error).toBeTruthy();

    expect(geminiOp.success).toBe(true);
    expect(geminiOp.answer).toBe("Gemini answer on jurisdiction");

    expect(anthropicOp.success).toBe(true);
    expect(anthropicOp.answer).toBe("Anthropic answer on jurisdiction");

    // moderator still ran and returned ranking — graceful degradation works.
    expect(result.moderator).toHaveProperty("ranking");
  });

  it("recovers from transient HTTP 500 via retry (Sprint 1 P1 new behavior)", async () => {
    // Documents the retry-recovery path: first attempt 500, retry succeeds.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse({ error: "transient" }, 500)) // openai attempt 1
      .mockResolvedValueOnce(chatResponse("Gemini answer"))
      .mockResolvedValueOnce(chatResponse("Anthropic answer"))
      .mockResolvedValueOnce(chatResponse("OpenAI answer (recovered)")) // openai attempt 2
      .mockResolvedValueOnce(chatResponse(moderatorJson));

    const result = await runCouncil({
      env: mockEnv,
      question: "Retry recovery test",
    });

    const openaiOp = result.opinions.find((o) => o.provider_key === "openai");
    expect(openaiOp.success).toBe(true);
    expect(openaiOp.answer).toBe("OpenAI answer (recovered)");
  });

  it("moderator uses fallback path when all 3 experts fail", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500))
      .mockResolvedValueOnce(makeResponse({ error: "fail" }, 500));

    const result = await runCouncil({ env: mockEnv, question: "All experts fail test" });

    expect(result.opinions.every((o) => !o.success)).toBe(true);
    expect(result.moderator.success).toBe(false);
    expect(result.moderator.composed_answer).toBe("No model produced a usable answer.");
  });
});

// ---------------------------------------------------------------------------
// System prompt constants — exported verbatim from Python source
// ---------------------------------------------------------------------------

describe("exported system prompt constants", () => {
  it("DEFAULT_OPENAI_SYSTEM_PROMPT contains 'Senior legal research counsel'", () => {
    expect(DEFAULT_OPENAI_SYSTEM_PROMPT).toContain("Senior legal research counsel");
  });

  it("DEFAULT_GEMINI_PRO_SYSTEM_PROMPT contains 'grounded-source verification'", () => {
    expect(DEFAULT_GEMINI_PRO_SYSTEM_PROMPT).toContain("grounded-source verification");
  });

  it("DEFAULT_ANTHROPIC_SYSTEM_PROMPT contains 'adversarial legal analyst'", () => {
    expect(DEFAULT_ANTHROPIC_SYSTEM_PROMPT).toContain("adversarial legal analyst");
  });

  it("DEFAULT_MODERATOR_SYSTEM_PROMPT contains 'Presiding legal moderator'", () => {
    expect(DEFAULT_MODERATOR_SYSTEM_PROMPT).toContain("Presiding legal moderator");
  });
});
