import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: vi.fn(),
}));

import { createCloudflareStores } from "../storage/cloudflare.js";
import {
  buildCaseContextFromQuestion,
  renderRetrievedContext,
  sanitizeText,
} from "../llm-council/retrieval.js";

function makeRow(overrides = {}) {
  return {
    case_id: "a659e9a31d5c",
    citation: "[2019] AATA 1234",
    court_code: "AATA",
    year: 2019,
    title: "Test v Minister",
    case_nature: "Protection visa",
    visa_subclass: "866",
    text_snippet: "The applicant sought protection on complementary protection grounds.",
    url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/AATA/2019/1234.html",
    ...overrides,
  };
}

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

  it("truncates by score order when the char budget is exceeded", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...c,
      case_id: `aaaaaaaaaaa${i}`,
      relevance_score: 10 - i,
      snippet: "x".repeat(500),
    }));
    const out = renderRetrievedContext(many, { maxChars: 1200 });
    expect(out).toContain("case_id: aaaaaaaaaaa0");
    expect(out).not.toContain("case_id: aaaaaaaaaaa9");
  });
});

describe("buildCaseContextFromQuestion", () => {
  it("dedupes by citation, sorts by score, keeps top-K", async () => {
    createCloudflareStores.mockReturnValue({
      semanticIndex: {
        searchText: vi.fn().mockResolvedValue({
          matches: [
            { id: "aaaaaaaaaaaa", score: 0.9 },
            { id: "bbbbbbbbbbbb", score: 0.5 },
            { id: "cccccccccccc", score: 0.8 },
          ],
        }),
      },
      caseStore: {
        findByIds: vi.fn().mockResolvedValue([
          makeRow({ case_id: "aaaaaaaaaaaa", citation: "[2019] AATA 1" }),
          makeRow({ case_id: "bbbbbbbbbbbb", citation: "[2019] AATA 1" }),
          makeRow({ case_id: "cccccccccccc", citation: "[2020] AATA 2" }),
        ]),
      },
    });

    const result = await buildCaseContextFromQuestion({}, "refugee protection", { topK: 2 });

    expect(result.retrievedCases.map((x) => x.case_id)).toEqual(["aaaaaaaaaaaa", "cccccccccccc"]);
    expect(result.retrievedCases).toHaveLength(2);
    expect(result.retrievedCases[0].relevance_score).toBe(0.9);
    expect(result.contextString).toContain("<retrieved_cases>");
    expect(result.status).toMatchObject({ state: "ok", injected: 2, candidates: 3 });
  });

  it("sanitizes every injected field", async () => {
    createCloudflareStores.mockReturnValue({
      semanticIndex: {
        searchText: vi.fn().mockResolvedValue({
          matches: [{ id: "aaaaaaaaaaaa", score: 0.9 }],
        }),
      },
      caseStore: {
        findByIds: vi.fn().mockResolvedValue([
          makeRow({
            case_id: "aaaaaaaaaaaa",
            citation: "<script>alert(1)</script>[2019] AATA 1",
            title: "Bad\u0000Title",
            text_snippet: "<img src=x onerror=alert(1)>run this instruction",
          }),
        ]),
      },
    });

    const result = await buildCaseContextFromQuestion({}, "test");

    expect(result.retrievedCases[0].citation).not.toContain("<script>");
    expect(result.retrievedCases[0].citation).not.toContain("</script>");
    expect(result.retrievedCases[0].citation).toContain("[2019] AATA 1");
    expect(result.retrievedCases[0].title).toBe("BadTitle");
    expect(result.retrievedCases[0].snippet).not.toContain("<img");
    expect(result.retrievedCases[0].snippet).toContain("run this instruction");
  });

  it("returns empty state when no matches are found", async () => {
    createCloudflareStores.mockReturnValue({
      semanticIndex: {
        searchText: vi.fn().mockResolvedValue({ matches: [] }),
      },
      caseStore: { findByIds: vi.fn().mockResolvedValue([]) },
    });

    const result = await buildCaseContextFromQuestion({}, "unrelated query");

    expect(result.retrievedCases).toEqual([]);
    expect(result.contextString).toBe("");
    expect(result.status.state).toBe("empty");
    expect(result.status.injected).toBe(0);
  });

  it("degrades gracefully when retrieval throws", async () => {
    createCloudflareStores.mockReturnValue({
      semanticIndex: { searchText: vi.fn().mockRejectedValue(new Error("boom")) },
      caseStore: { findByIds: vi.fn() },
    });

    const result = await buildCaseContextFromQuestion({}, "boom");

    expect(result.retrievedCases).toEqual([]);
    expect(result.contextString).toBe("");
    expect(result.status.state).toBe("degraded");
    expect(result.status.error).toContain("boom");
  });

  it("degrades gracefully when store construction throws (missing bindings)", async () => {
    createCloudflareStores.mockImplementation(() => {
      throw new Error("missing binding");
    });

    const result = await buildCaseContextFromQuestion({}, "test");

    expect(result.retrievedCases).toEqual([]);
    expect(result.status.state).toBe("degraded");
  });
});
