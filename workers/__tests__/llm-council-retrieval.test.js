import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareCaseStore: vi.fn(),
}));

import { createCloudflareCaseStore } from "../storage/cloudflare.js";
import {
  buildCaseContextFromQuestion,
  buildFtsQuery,
  renderRetrievedContext,
  sanitizeText,
} from "../llm-council/retrieval.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sanitizeText", () => {
  it("strips HTML tags and control characters", () => {
    expect(sanitizeText("<b>hello</b>\u0000world\u001f!")).toBe("helloworld!");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeText("  a\n\t  b  ")).toBe("a b");
  });

  it("returns empty string for null/undefined", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
  });
});

describe("renderRetrievedContext", () => {
  const c = {
    case_id: "a659e9a31d5c",
    citation: "[2019] AATA 1234",
    court_code: "AATA",
    year: 2019,
    title: "Test v Minister",
    case_nature: "Protection visa",
    visa_subclass: "866",
    relevance_score: 0.9,
    snippet: "snippet",
    source_url: "https://example.com/case",
  };

  it("returns empty string for no cases", () => {
    expect(renderRetrievedContext([])).toBe("");
  });

  it("wraps each case in retrieved_case delimiters", () => {
    const out = renderRetrievedContext([c]);
    expect(out).toContain("<retrieved_case>");
    expect(out).toContain("</retrieved_case>");
    expect(out).toContain("case_id: a659e9a31d5c");
    expect(out).toContain("citation: [2019] AATA 1234");
  });
});

describe("buildFtsQuery", () => {
  it("returns empty string for empty or stopword-only input", () => {
    expect(buildFtsQuery("")).toBe("");
    expect(buildFtsQuery("   ")).toBe("");
    expect(buildFtsQuery("the and of to in for")).toBe("");
  });

  it("removes stopwords, duplicates and short tokens, keeps phrases", () => {
    expect(buildFtsQuery("persecution religion pakistan complementary protection")).toBe(
      '"complementary protection" OR "persecution" OR "religion" OR "pakistan"',
    );
  });

  it("dedupes repeated terms", () => {
    expect(buildFtsQuery("the persecution the persecution religion religion")).toBe(
      '"persecution" OR "religion"',
    );
  });
});

describe("buildCaseContextFromQuestion", () => {
  it("maps rank to relevance_score, dedupes by citation, keeps top-K", async () => {
    createCloudflareCaseStore.mockReturnValue({
      searchLexical: vi.fn().mockResolvedValue([
        { case_id: "aaaaaaaaaaaa", citation: "Case A", court_code: "FCA", year: 2020, title: "T A", case_nature: "Appeal", visa_subclass: "", text_snippet: "sA", url: "http://a", rank: -5.5 },
        { case_id: "bbbbbbbbbbbb", citation: "Case B", court_code: "FCA", year: 2021, title: "T B", case_nature: "Appeal", visa_subclass: "", text_snippet: "sB", url: "http://b", rank: -3.2 },
        { case_id: "cccccccccccc", citation: "Case A", court_code: "FCA", year: 2020, title: "T A dup", case_nature: "Appeal", visa_subclass: "", text_snippet: "sD", url: "http://d", rank: -2.0 },
      ]),
    });

    const result = await buildCaseContextFromQuestion({}, "persecution religion", { recall: 10, topK: 2 });

    expect(result.retrievedCases.map((x) => x.case_id)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(result.retrievedCases[0].relevance_score).toBe(5.5);
    expect(result.retrievedCases[0].bm25_rank).toBe(-5.5);
    expect(result.status).toMatchObject({ state: "ok", candidates: 3, injected: 2 });
    expect(result.contextString).toContain("<retrieved_cases>");
  });

  it("returns empty state without calling searchLexical when the query is empty", async () => {
    const searchLexical = vi.fn();
    createCloudflareCaseStore.mockReturnValue({ searchLexical });

    const result = await buildCaseContextFromQuestion({}, "the and of");

    expect(searchLexical).not.toHaveBeenCalled();
    expect(result.retrievedCases).toEqual([]);
    expect(result.status.state).toBe("empty");
  });

  it("degrades gracefully when searchLexical throws", async () => {
    createCloudflareCaseStore.mockReturnValue({
      searchLexical: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await buildCaseContextFromQuestion({}, "persecution");

    expect(result.retrievedCases).toEqual([]);
    expect(result.contextString).toBe("");
    expect(result.status.state).toBe("degraded");
    expect(result.status.error).toContain("boom");
  });

  it("degrades gracefully when store construction throws (missing D1)", async () => {
    createCloudflareCaseStore.mockImplementation(() => {
      throw new Error("missing IMMI_CATALOG_DB");
    });

    const result = await buildCaseContextFromQuestion({}, "persecution");

    expect(result.retrievedCases).toEqual([]);
    expect(result.status.state).toBe("degraded");
  });
});
