/**
 * Regression test for the upstream-error redaction contract.
 *
 * Before this contract existed, a provider 4xx/5xx body (model names, routing,
 * quota state) was embedded in opinions[].error and returned to the browser
 * inside an ordinary 200 Council response. The body must now reach the logs
 * and nothing else.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { runCouncil, gatewayChatCompletion } from "../llm-council/runner.js";

const SECRET_MARKER = "quota-exhausted-for-account-acct_1234567890";

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const mockEnv = {
  CF_AIG_TOKEN: "test-token-abc",
  CF_GATEWAY_URL: "https://gateway.example.com/v1/chat",
};

function upstream429() {
  return makeResponse({ error: { message: SECRET_MARKER, type: "insufficient_quota" } }, 429);
}

describe("upstream gateway errors are redacted before they reach a client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the upstream body out of the thrown Error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    let caught;
    try {
      await gatewayChatCompletion({
        env: mockEnv,
        model: "openai/gpt-5-mini",
        systemPrompt: "system",
        userPrompt: "user",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe("HTTP 429");
    expect(String(caught)).not.toContain(SECRET_MARKER);
    // A redacted projection survives on the Error for operators, never the
    // raw body, and never in the message.
    expect(caught.upstreamStatus).toBe(429);
    expect(caught.upstreamDetail).toEqual({
      detail_fields: { type: "insufficient_quota", message: SECRET_MARKER },
    });
  });

  it("keeps non-allow-listed body fields out of the log and the Error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse(
        {
          error: { message: "over quota", type: "insufficient_quota" },
          echoed_prompt: "APPLICANT-PII-SHOULD-NEVER-BE-LOGGED",
        },
        429,
      ),
    );

    await gatewayChatCompletion({
      env: mockEnv,
      model: "openai/gpt-5-mini",
      systemPrompt: "system",
      userPrompt: "user",
    }).catch(() => {});

    const logged = logSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).not.toContain("APPLICANT-PII-SHOULD-NEVER-BE-LOGGED");
    expect(logged).toContain("insufficient_quota");
  });

  it("truncates a long provider message before it reaches the log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const long = "z".repeat(5000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      makeResponse({ error: { message: long, type: "server_error" } }, 500),
    );

    let caught;
    try {
      await gatewayChatCompletion({
        env: mockEnv,
        model: "openai/gpt-5-mini",
        systemPrompt: "system",
        userPrompt: "user",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught.upstreamDetail.detail_fields.message).toHaveLength(400);
    const entry = logSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .find((e) => e && e.event === "council.upstream_error");
    expect(entry.detail_fields.message).toHaveLength(400);
  });

  it("keeps the upstream body out of the 200 runCouncil response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    const result = await runCouncil({ env: mockEnv, question: "Redaction check" });

    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    expect(result.opinions).toHaveLength(3);
    for (const opinion of result.opinions) {
      expect(opinion.success).toBe(false);
      expect(opinion.error).toContain("HTTP 429");
      expect(opinion.error).not.toContain(SECRET_MARKER);
    }
  });

  it("still logs the allow-listed upstream fields so operators do not lose the signal", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    await runCouncil({ env: mockEnv, question: "Redaction logging check" });

    const events = logSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((entry) => entry && entry.event === "council.upstream_error");

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].status).toBe(429);
    expect(events[0].detail_fields.type).toBe("insufficient_quota");
    // The provider's `message` IS allow-listed (it is what an operator triages
    // on) — the marker is a quota string here, not user content. The
    // non-allow-listed-field case is covered by its own test above.
    expect(events[0].detail_fields.message).toBe(SECRET_MARKER);
  });

  it("still classifies a redacted 429 as a non-retryable client error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream429());

    await runCouncil({ env: mockEnv, question: "Retry policy check" });

    // 3 experts + 1 moderator, each attempted exactly once: a 4xx is not
    // retried, which only holds if classifyError still sees "http 4".
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
