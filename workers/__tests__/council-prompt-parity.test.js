/**
 * council-prompt-parity.test.js
 *
 * Guards against the exact defect Plan 034 fixes: the Worker's Gemini prompt
 * told the model "you have google_search grounding enabled" while no live
 * Gemini path attaches that tool. Constant-equality tests alone cannot catch
 * this — they only prove the JS mirror and the canonical JSON agree with each
 * other, not that the right string reaches the right provider on the wire.
 * So this file has five constant tests plus two request-body tests; the
 * request-body tests are the ones that actually guard the fix.
 *
 * Wire-level tests drive the real, unstubbed streamAnthropicNative and
 * streamGatewayChatCompletion exports directly (mocking only global fetch)
 * rather than the private pickStreamGenerator closure inside streamCouncil,
 * which is not exported and whose full orchestration also touches D1/
 * Vectorize retrieval and moderator streaming. pickStreamGenerator's
 * anthropic branch does nothing but call streamAnthropicNative with
 * ANTHROPIC_GROUNDED_SYSTEM_PROMPT (see runner.js); its other branches call
 * streamGatewayChatCompletion with the DEFAULT_* prompt unchanged. Testing
 * those two exported functions directly therefore exercises the exact
 * request bodies pickStreamGenerator produces, without stubbing the
 * substitution itself or the prompt constants.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_GROUNDED_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
  DEFAULT_OPENAI_SYSTEM_PROMPT,
} from "../llm-council/prompts.js";
import {
  gatewayChatCompletion,
  streamAnthropicNative,
  streamGatewayChatCompletion,
} from "../llm-council/runner.js";

const canonical = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../immi_case_downloader/data/council_prompts.json", import.meta.url)),
    "utf8",
  ),
);

const mockEnv = {
  CF_AIG_TOKEN: "test-token-abc",
  CF_GATEWAY_URL: "https://gateway.example.com/v1/chat",
};

/** A Response-like object whose body stream is immediately exhausted. */
function makeEmptyStreamResponse() {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
      }),
    },
  };
}

/** A Response-like object for the non-streaming gatewayChatCompletion. */
function makeChatResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe("council prompt parity with the canonical JSON", () => {
  it("openai matches byte-for-byte", () => {
    expect(DEFAULT_OPENAI_SYSTEM_PROMPT).toBe(canonical.base.openai);
  });
  it("gemini_pro matches byte-for-byte", () => {
    expect(DEFAULT_GEMINI_PRO_SYSTEM_PROMPT).toBe(canonical.base.gemini_pro);
  });
  it("anthropic matches byte-for-byte", () => {
    expect(DEFAULT_ANTHROPIC_SYSTEM_PROMPT).toBe(canonical.base.anthropic);
  });
  it("moderator matches byte-for-byte", () => {
    expect(DEFAULT_MODERATOR_SYSTEM_PROMPT).toBe(canonical.base.moderator);
  });
  it("claims a search tool only in the grounded anthropic variant", () => {
    for (const prompt of [
      DEFAULT_OPENAI_SYSTEM_PROMPT,
      DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
      DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
      DEFAULT_MODERATOR_SYSTEM_PROMPT,
    ]) {
      expect(prompt).not.toMatch(/google_search|web_search/);
    }
    expect(ANTHROPIC_GROUNDED_SYSTEM_PROMPT).toBe(canonical.grounded.anthropic);
    expect(ANTHROPIC_GROUNDED_SYSTEM_PROMPT).toContain("web_search");
  });
});

describe("the grounded variant reaches only the path that sends a tool", () => {
  // Every test in this block installs a vi.spyOn(globalThis, "fetch"). In
  // vitest 4, spying on an already-spied global returns the EXISTING spy
  // (with its accumulated call history) instead of a fresh one, so a spy
  // left installed at the end of one test silently pollutes the next
  // test's fetchSpy.mock.calls. Restore after every test so each one starts
  // from a clean, unspied globalThis.fetch — matching the convention used
  // throughout llm-council-runner.test.js.
  afterEach(() => vi.restoreAllMocks());

  it("streamAnthropicNative posts the grounded prompt AND a web_search tool block", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeEmptyStreamResponse());

    // This is exactly how pickStreamGenerator's anthropic branch calls it:
    // the grounded constant substituted in place of whatever systemPrompt
    // runStreamExpert passed down.
    const gen = streamAnthropicNative({
      env: mockEnv,
      model: "anthropic/claude-sonnet-4-6",
      systemPrompt: ANTHROPIC_GROUNDED_SYSTEM_PROMPT,
      userPrompt: "What is s.36 of the Migration Act?",
    });
    await gen.next(); // drives the function body up to and past the fetch() call

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.system).toBe(ANTHROPIC_GROUNDED_SYSTEM_PROMPT);
    expect(body.tools.some((t) => t.name === "web_search")).toBe(true);
  });

  it("the OpenAI-compat gateway path posts the BASE prompt and no tools", async () => {
    // Non-streaming compat call (runCouncil / runExpert), one per expert.
    const compatCases = [
      { model: "openai/gpt-5-mini", systemPrompt: DEFAULT_OPENAI_SYSTEM_PROMPT },
      { model: "google-ai-studio/gemini-2.5-pro", systemPrompt: DEFAULT_GEMINI_PRO_SYSTEM_PROMPT },
      { model: "anthropic/claude-sonnet-4-6", systemPrompt: DEFAULT_ANTHROPIC_SYSTEM_PROMPT },
    ];
    for (const { model, systemPrompt } of compatCases) {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeChatResponse("answer"));
      await gatewayChatCompletion({ env: mockEnv, model, systemPrompt, userPrompt: "question" });
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: systemPrompt });
      expect(body).not.toHaveProperty("tools");
      fetchSpy.mockRestore();
    }

    // Streaming compat call — this is the actual live path pickStreamGenerator
    // uses for the gemini_pro branch since 2026-05-11 (see runner.js), and the
    // one that regressed: before this plan it sent a prompt claiming
    // google_search grounding over a path that attaches no tools at all.
    const streamFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeEmptyStreamResponse());
    const streamGen = streamGatewayChatCompletion({
      env: mockEnv,
      model: "google-ai-studio/gemini-2.5-pro",
      systemPrompt: DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
      userPrompt: "question",
    });
    await streamGen.next();
    expect(streamFetchSpy).toHaveBeenCalledOnce();
    const streamBody = JSON.parse(streamFetchSpy.mock.calls[0][1].body);
    expect(streamBody.messages[0]).toEqual({ role: "system", content: DEFAULT_GEMINI_PRO_SYSTEM_PROMPT });
    expect(streamBody).not.toHaveProperty("tools");
  });
});
