/**
 * llm-council-runner-helpers.test.js
 *
 * Vitest unit tests for workers/llm-council/runner-helpers.js
 * Mirrors test cases from tests/test_llm_council_module.py.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeGatewayModel,
  extractChatCompletionText,
  stripReasoningArtifacts,
  repairTruncatedJson,
  extractFirstJsonObject,
  isGpt5ReasoningModel,
  normalizeLawSection,
  lawSectionKey,
  dedupeLawSections,
  extractLawSectionsFromText,
  buildProviderLawSections,
  computeSharedLawSections,
  computeSharedLawSectionsConfidence,
} from "../llm-council/runner-helpers.js";

// ---------------------------------------------------------------------------
// normalizeGatewayModel
// ---------------------------------------------------------------------------

describe("normalizeGatewayModel", () => {
  it("passes through model that already has a provider prefix", () => {
    expect(normalizeGatewayModel("openai/gpt-5-mini", "openai")).toBe(
      "openai/gpt-5-mini"
    );
  });

  it("prepends defaultPrefix to a bare model name", () => {
    expect(normalizeGatewayModel("claude-sonnet-4-6", "anthropic")).toBe(
      "anthropic/claude-sonnet-4-6"
    );
  });

  it("returns empty string unchanged when model is empty", () => {
    expect(normalizeGatewayModel("", "anthropic")).toBe("");
  });

  it("trims whitespace and prepends prefix to bare model", () => {
    expect(normalizeGatewayModel("  gemini-flash  ", "google-ai-studio")).toBe(
      "google-ai-studio/gemini-flash"
    );
  });
});

// ---------------------------------------------------------------------------
// extractChatCompletionText
// ---------------------------------------------------------------------------

describe("extractChatCompletionText", () => {
  it("extracts and trims string content from choices[0].message.content", () => {
    const payload = {
      choices: [{ message: { content: "  Hello world  " } }],
    };
    expect(extractChatCompletionText(payload)).toBe("Hello world");
  });

  it("joins list-of-parts content with double newlines", () => {
    const payload = {
      choices: [
        {
          message: {
            content: [
              { text: "Part one" },
              { content: "Part two" },
              "Part three",
            ],
          },
        },
      ],
    };
    expect(extractChatCompletionText(payload)).toBe(
      "Part one\n\nPart two\n\nPart three"
    );
  });

  it("returns empty string when choices is empty array", () => {
    expect(extractChatCompletionText({ choices: [] })).toBe("");
  });

  it("returns empty string when payload has no choices key", () => {
    expect(extractChatCompletionText({})).toBe("");
  });

  it("returns empty string when message.content is null", () => {
    const payload = { choices: [{ message: { content: null } }] };
    expect(extractChatCompletionText(payload)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// stripReasoningArtifacts
// ---------------------------------------------------------------------------

describe("stripReasoningArtifacts", () => {
  it("removes properly fenced <think>...</think> block and returns the answer", () => {
    const fenced = "<think>internal chain of thought</think>The answer is 42.";
    expect(stripReasoningArtifacts(fenced)).toBe("The answer is 42.");
  });

  it("handles QwQ-style: no opening tag, just trailing </think>", () => {
    const qwq = "Okay, let me think about this... </think>\n\nFinal answer: 42.";
    expect(stripReasoningArtifacts(qwq)).toBe("Final answer: 42.");
  });

  it("passes through plain text unchanged (only strips outer whitespace)", () => {
    expect(stripReasoningArtifacts("  Just a regular answer.  ")).toBe(
      "Just a regular answer."
    );
  });

  it("strips multiple fenced think blocks", () => {
    const multi = "<think>step1</think>Hello <think>step2</think>world.";
    expect(stripReasoningArtifacts(multi)).toBe("Hello world.");
  });

  it("returns empty string for empty input", () => {
    expect(stripReasoningArtifacts("")).toBe("");
  });

  it("is case-insensitive on think tags", () => {
    expect(stripReasoningArtifacts("<THINK>ignored</THINK>answer")).toBe(
      "answer"
    );
  });
});

// ---------------------------------------------------------------------------
// repairTruncatedJson
// ---------------------------------------------------------------------------

describe("repairTruncatedJson", () => {
  it("recovers mid-string truncation — incomplete field is dropped", () => {
    const truncated = '{"a":1,"b":"hello';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    expect(parsed).toEqual({ a: 1 });
  });

  it("recovers array truncated mid-string item — complete items kept, partial dropped", () => {
    const truncated = '{"items":["one","two","incompl';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    // Tight assertion — repaired array MUST be exactly two complete items;
    // a third (truncated) item leaking through is a regression we want to
    // catch immediately.
    expect(parsed.items).toEqual(["one", "two"]);
  });

  it("recovers nested objects truncated at deepest level", () => {
    const truncated = '{"outer":{"inner":{"k":"v","x":';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    expect(parsed.outer.inner).toEqual({ k: "v" });
  });

  it("returns complete JSON with correct semantics unchanged", () => {
    const complete = '{"a":1}';
    const parsed = JSON.parse(repairTruncatedJson(complete));
    expect(parsed).toEqual({ a: 1 });
  });

  it("returns original text when no opening brace found", () => {
    expect(repairTruncatedJson("no json here")).toBe("no json here");
  });
});

// ---------------------------------------------------------------------------
// extractFirstJsonObject
// ---------------------------------------------------------------------------

describe("extractFirstJsonObject", () => {
  it("parses plain JSON directly", () => {
    expect(extractFirstJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown ```json fence before parsing", () => {
    expect(
      extractFirstJsonObject('```json\n{"a":1,"b":[2,3]}\n```')
    ).toEqual({ a: 1, b: [2, 3] });
  });

  it("strips lowercase ``` fence", () => {
    expect(extractFirstJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extracts JSON followed by trailing prose via brace-balance walk", () => {
    expect(
      extractFirstJsonObject('{"a":1}\n\nNote: my reasoning above.')
    ).toEqual({ a: 1 });
  });

  it("handles strings with escaped quotes and braces inside", () => {
    expect(
      extractFirstJsonObject('{"a":"hello {world} \\"quoted\\""}')
    ).toEqual({ a: 'hello {world} "quoted"' });
  });

  it("recovers truncated moderator output — realistic Gemini Flash shape", () => {
    const truncated =
      "```json\n{\n" +
      '  "ranking": [{"provider_key":"openai","score":90,"reason":"good"}],\n' +
      '  "outcome_likelihood_percent": 65,\n' +
      '  "outcome_likelihood_label": "medium",\n' +
      '  "law_sections": ["Migration Act 1958 (Cth) s 36"],\n' +
      '  "follow_up_questions": ["What was the precise content';
    const parsed = extractFirstJsonObject(truncated);
    expect(parsed).not.toBeNull();
    expect(parsed.outcome_likelihood_percent).toBe(65);
    expect(parsed.outcome_likelihood_label).toBe("medium");
    expect(parsed.law_sections).toEqual(["Migration Act 1958 (Cth) s 36"]);
    expect(parsed.ranking[0].provider_key).toBe("openai");
  });

  it("returns null for empty string", () => {
    expect(extractFirstJsonObject("")).toBeNull();
  });

  it("returns null for pure prose with no JSON", () => {
    expect(extractFirstJsonObject("just prose")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isGpt5ReasoningModel
// ---------------------------------------------------------------------------

describe("isGpt5ReasoningModel", () => {
  it("returns true for openai/gpt-5 prefix", () => {
    expect(isGpt5ReasoningModel("openai/gpt-5")).toBe(true);
  });

  it("returns true for openai/gpt-5-mini-2025-08-07", () => {
    expect(isGpt5ReasoningModel("openai/gpt-5-mini-2025-08-07")).toBe(true);
  });

  it("returns false for openai/gpt-4o", () => {
    expect(isGpt5ReasoningModel("openai/gpt-4o")).toBe(false);
  });

  it("returns false for anthropic/claude-sonnet-4-6", () => {
    expect(isGpt5ReasoningModel("anthropic/claude-sonnet-4-6")).toBe(false);
  });

  it("returns false for google-ai-studio/gemini-flash", () => {
    expect(isGpt5ReasoningModel("google-ai-studio/gemini-flash")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGpt5ReasoningModel("")).toBe(false);
  });

  it("is case-insensitive — openai/GPT-5 matches", () => {
    expect(isGpt5ReasoningModel("openai/GPT-5-mini")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeLawSection / lawSectionKey
//
// Parity values below were captured directly from the Python reference
// (_normalize_law_section / _law_section_key in immi_case_downloader/llm_council.py)
// via a one-off REPL check against these exact inputs.
// ---------------------------------------------------------------------------

describe("lawSectionKey", () => {
  it("normalizes an already-abbreviated citation", () => {
    expect(lawSectionKey("Migration Act 1958 (Cth) s 36")).toBe(
      "migrationact1958cths36"
    );
  });

  it("collapses 'section' to 's' so it matches the abbreviated form", () => {
    expect(lawSectionKey("migration act 1958 (Cth) section 36")).toBe(
      "migrationact1958cths36"
    );
  });

  it("collapses 'ss' to 's' so it matches the abbreviated form", () => {
    expect(lawSectionKey("Migration Act 1958 (Cth) ss 36")).toBe(
      "migrationact1958cths36"
    );
  });

  it("is case- and punctuation-insensitive ('S.' vs 's')", () => {
    expect(lawSectionKey("MIGRATION ACT 1958 (Cth) S. 36")).toBe(
      "migrationact1958cths36"
    );
  });

  it("returns empty string for empty input", () => {
    expect(lawSectionKey("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(lawSectionKey("   ")).toBe("");
  });
});

describe("normalizeLawSection", () => {
  it("preserves original casing/spacing of an already-abbreviated citation", () => {
    expect(normalizeLawSection("Migration Act 1958 (Cth) s 36")).toBe(
      "Migration Act 1958 (Cth) s 36"
    );
  });

  it("collapses 'regulation' to 'reg'", () => {
    expect(normalizeLawSection("Migration Regulation 1994 (Cth) reg 2.03")).toBe(
      "Migration reg 1994 (Cth) reg 2.03"
    );
  });

  it("strips surrounding punctuation and collapses internal whitespace", () => {
    expect(normalizeLawSection("  Migration Act 1958 (Cth)   s 36 ; ")).toBe(
      "Migration Act 1958 (Cth) s 36"
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeLawSection("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// dedupeLawSections
// ---------------------------------------------------------------------------

describe("dedupeLawSections", () => {
  it("drops later items whose normalized key repeats an earlier one", () => {
    expect(
      dedupeLawSections([
        "Migration Act 1958 (Cth) s 36",
        "migration act 1958 (Cth) section 36",
      ])
    ).toEqual(["Migration Act 1958 (Cth) s 36"]);
  });

  it("keeps distinct sections in input order", () => {
    expect(
      dedupeLawSections([
        "Migration Act 1958 (Cth) s 36",
        "Migration Act 1958 (Cth) s 424A",
      ])
    ).toEqual(["Migration Act 1958 (Cth) s 36", "Migration Act 1958 (Cth) s 424A"]);
  });

  it("truncates at maxItems", () => {
    expect(dedupeLawSections(["a s 1", "b s 2", "c s 3"], 2)).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(dedupeLawSections([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractLawSectionsFromText
// ---------------------------------------------------------------------------

describe("extractLawSectionsFromText", () => {
  it("returns empty array for empty text", () => {
    expect(extractLawSectionsFromText("")).toEqual([]);
  });

  it("returns empty array when no citation-shaped text is present", () => {
    expect(
      extractLawSectionsFromText("No relevant statutes cited here, just discussion of facts.")
    ).toEqual([]);
  });

  it("extracts a clean inline citation", () => {
    expect(
      extractLawSectionsFromText("Cites Migration Act 1958 (Cth) s 36 only, nothing else.")
    ).toEqual(["Cites Migration Act 1958 (Cth) s 36"]);
  });
});

// ---------------------------------------------------------------------------
// buildProviderLawSections
//
// Parity values below were captured directly from the Python reference
// (_build_provider_law_sections in immi_case_downloader/llm_council.py) via
// a one-off REPL check against these exact raw/opinions/allowedProviderKeys
// inputs.
// ---------------------------------------------------------------------------

describe("buildProviderLawSections", () => {
  const op = (providerKey, answer) => ({ provider_key: providerKey, answer });

  it("merges a moderator-declared raw citation with a distinct text-extracted one", () => {
    const raw = { openai: ["Migration Act 1958 (Cth) s 36"] };
    const opinions = [
      op("openai", "Migration Act 1958 (Cth) s 424A also applies to this case."),
    ];
    expect(buildProviderLawSections(raw, opinions, ["openai"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36", "Migration Act 1958 (Cth) s 424A"],
    });
  });

  it("dedupes when the raw claim and the answer text cite the same section differently worded", () => {
    const raw = { openai: ["Migration Act 1958 (Cth) s 36"] };
    const opinions = [
      op("openai", "Migration Act 1958 (Cth) section 36 governs this outcome."),
    ];
    expect(buildProviderLawSections(raw, opinions, ["openai"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
    });
  });

  it("keeps the raw-declared citation when the answer text has none", () => {
    const raw = { openai: ["Migration Act 1958 (Cth) s 36"] };
    const opinions = [op("openai", "No citation here at all.")];
    expect(buildProviderLawSections(raw, opinions, ["openai"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
    });
  });

  it("falls back to text-extracted citations when raw is empty for that provider (raw={} case)", () => {
    const opinions = [op("openai", "Migration Act 1958 (Cth) s 36 applies.")];
    expect(buildProviderLawSections({}, opinions, ["openai"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
    });
  });

  it("omits a provider entirely when it has zero citations in both raw and text", () => {
    const opinions = [op("openai", "No citation here at all.")];
    expect(buildProviderLawSections({}, opinions, ["openai"])).toEqual({});
  });

  it("sorts provider keys alphabetically regardless of allowedProviderKeys order", () => {
    const raw = {
      zeta: ["Migration Act 1958 (Cth) s 36"],
      alpha: ["Migration Act 1958 (Cth) s 424A"],
    };
    const opinions = [op("zeta", ""), op("alpha", "")];
    const result = buildProviderLawSections(raw, opinions, ["zeta", "alpha"]);
    expect(Object.keys(result)).toEqual(["alpha", "zeta"]);
  });

  it("treats a null/non-object raw argument as no declared citations (fallback-moderator's raw={} case)", () => {
    const opinions = [op("openai", "Migration Act 1958 (Cth) s 36 applies.")];
    expect(buildProviderLawSections(null, opinions, ["openai"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
    });
  });

  it("does not let a raw-declared citation for one provider leak into another", () => {
    const raw = { openai: ["Migration Act 1958 (Cth) s 36"] };
    const opinions = [op("openai", ""), op("gemini_pro", "")];
    expect(buildProviderLawSections(raw, opinions, ["openai", "gemini_pro"])).toEqual({
      openai: ["Migration Act 1958 (Cth) s 36"],
    });
  });
});

// ---------------------------------------------------------------------------
// computeSharedLawSections
// ---------------------------------------------------------------------------

describe("computeSharedLawSections", () => {
  it("returns the common section when all providers cite exactly the same one", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: ["Migration Act 1958 (Cth) s 36"],
      anthropic: ["Migration Act 1958 (Cth) s 36"],
    };
    expect(
      computeSharedLawSections({
        providerLawSections,
        providerOrder: ["openai", "gemini_pro", "anthropic"],
      })
    ).toEqual(["Migration Act 1958 (Cth) s 36"]);
  });

  it("returns empty array when any provider has zero citations", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      anthropic: ["Migration Act 1958 (Cth) s 36"],
    };
    expect(
      computeSharedLawSections({
        providerLawSections,
        providerOrder: ["openai", "gemini_pro", "anthropic"],
      })
    ).toEqual([]);
  });

  it("returns empty array for empty providerOrder", () => {
    expect(computeSharedLawSections({ providerLawSections: {}, providerOrder: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeSharedLawSectionsConfidence
//
// Expected (percent, reason) pairs were captured directly from the Python
// reference (_compute_shared_law_sections_confidence) via a one-off REPL
// check against these exact provider_law_sections/provider_order/
// shared_law_sections inputs, so these assertions are a parity check.
// ---------------------------------------------------------------------------

describe("computeSharedLawSectionsConfidence", () => {
  it("full agreement across 3 providers scores 100 with a 100.0% pairwise reason", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: ["Migration Act 1958 (Cth) s 36"],
      anthropic: ["Migration Act 1958 (Cth) s 36"],
    };
    const sharedLawSections = ["Migration Act 1958 (Cth) s 36"];
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections,
    });
    expect(result.percent).toBe(100);
    expect(result.reason).toBe(
      "Shared-all overlap: 1/1 unique sections; mean pairwise citation overlap: 100.0%."
    );
  });

  it("partial overlap across 3 providers scores 36 with a 44.4% pairwise reason", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36", "Migration Act 1958 (Cth) s 424A"],
      gemini_pro: ["Migration Act 1958 (Cth) s 36"],
      anthropic: ["Migration Act 1958 (Cth) s 36", "Migration Act 1958 (Cth) s 500"],
    };
    const sharedLawSections = ["Migration Act 1958 (Cth) s 36"];
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections,
    });
    expect(result.percent).toBe(36);
    expect(result.reason).toBe(
      "Shared-all overlap: 1/3 unique sections; mean pairwise citation overlap: 44.4%."
    );
  });

  it("zero overlap across 3 providers scores 0 with a 0.0% pairwise reason", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: ["Migration Act 1958 (Cth) s 424A"],
      anthropic: ["Migration Act 1958 (Cth) s 500"],
    };
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections: [],
    });
    expect(result.percent).toBe(0);
    expect(result.reason).toBe(
      "Shared-all overlap: 0/3 unique sections; mean pairwise citation overlap: 0.0%."
    );
  });

  it("names the provider with missing/empty citations when one of 3 has none", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: [],
      anthropic: ["Migration Act 1958 (Cth) s 36"],
    };
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections: [],
    });
    expect(result.percent).toBe(0);
    expect(result.reason).toBe(
      "gemini_pro has no identifiable statutory/regulatory section citation for consistency scoring."
    );
  });

  it("requires 3 successful providers — fewer than 3 scores 0 with an honest reason", () => {
    const providerLawSections = {
      openai: ["Migration Act 1958 (Cth) s 36"],
      gemini_pro: ["Migration Act 1958 (Cth) s 36"],
    };
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro"],
      sharedLawSections: ["Migration Act 1958 (Cth) s 36"],
    });
    expect(result.percent).toBe(0);
    expect(result.reason).toBe(
      "Three successful expert model outputs are required for three-model citation consistency scoring."
    );
  });

  it("scores 0 for empty providerOrder", () => {
    const result = computeSharedLawSectionsConfidence({
      providerLawSections: {},
      providerOrder: [],
      sharedLawSections: [],
    });
    expect(result.percent).toBe(0);
  });

  it("is insensitive to case/format differences between providers' citation strings", () => {
    const providerLawSections = {
      openai: ["migration act 1958 (Cth) section 36"],
      gemini_pro: ["Migration Act 1958 (Cth) ss 36"],
      anthropic: ["MIGRATION ACT 1958 (Cth) S. 36"],
    };
    const sharedLawSections = ["migration act 1958 (Cth) section 36"];
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections,
    });
    expect(result.percent).toBe(100);
    expect(result.reason).toBe(
      "Shared-all overlap: 1/1 unique sections; mean pairwise citation overlap: 100.0%."
    );
  });

  it("clamps into [0, 100] and never returns a value outside that range", () => {
    const providerLawSections = {
      openai: ["s 1", "s 2", "s 3"],
      gemini_pro: ["s 1", "s 2", "s 3"],
      anthropic: ["s 1", "s 2", "s 3"],
    };
    const result = computeSharedLawSectionsConfidence({
      providerLawSections,
      providerOrder: ["openai", "gemini_pro", "anthropic"],
      sharedLawSections: ["s 1", "s 2", "s 3"],
    });
    expect(result.percent).toBeGreaterThanOrEqual(0);
    expect(result.percent).toBeLessThanOrEqual(100);
    expect(result.percent).toBe(100);
  });
});
