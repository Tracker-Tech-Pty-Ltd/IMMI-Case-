import { afterEach, describe, expect, it, vi } from "vitest";
import { caseIdOf, discoverCourt, parseAustliiListing } from "../discover";
import type { Env } from "../types";

vi.mock("../pipeline-db", () => ({
  discoveryTargetTable: vi.fn(() => "immigration_cases_staging"),
  findExistingCases: vi.fn(async () => new Set<string>()),
  updatePipelineRun: vi.fn(async () => undefined),
}));

describe("discover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("generates stable case ids from citation and url only", async () => {
    const a = await caseIdOf(
      " [2025]  ARTA  12. ",
      " HTTPS://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html. ",
    );
    const b = await caseIdOf(
      "[2025] ARTA 12",
      "https://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html",
    );

    expect(a).toHaveLength(12);
    expect(a).toBe(b);
  });

  it("keeps all dedicated immigration tribunal listings", () => {
    const html = `
      <html><body>
        <a href="/au/cases/cth/ARTA/2025/12.html">Example v Minister [2025] ARTA 12</a>
      </body></html>
    `;

    const cases = parseAustliiListing(html, "ARTA", 2025);
    expect(cases).toEqual([
      {
        url: "https://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html",
        citation: "[2025] ARTA 12",
        court_code: "ARTA",
        title: "Example v Minister [2025] ARTA 12",
        year: 2025,
      },
    ]);
  });

  it("filters non-dedicated courts to immigration context", () => {
    const html = `
      <html><body>
        <p>Migration Act review
          <a href="/au/cases/cth/FCA/2025/7.html">Applicant v Minister [2025] FCA 7</a>
        </p>
        <p>Tax dispute
          <a href="/au/cases/cth/FCA/2025/8.html">Taxpayer v Commissioner [2025] FCA 8</a>
        </p>
      </body></html>
    `;

    const cases = parseAustliiListing(html, "FCA", 2025);
    expect(cases.map((item) => item.citation)).toEqual(["[2025] FCA 7"]);
  });

  it("uses Firecrawl as an opt-in listing fallback after Browser Rendering is unavailable", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });

      if (url === "https://api.firecrawl.dev/v2/scrape") {
        return Response.json({
          success: true,
          data: {
            rawHtml: `
              <html><body>
                <a href="/au/cases/cth/ARTA/2026/12.html">Example v Minister [2026] ARTA 12</a>
              </body></html>
            `,
          },
        });
      }

      return new Response("Forbidden", { status: 403 });
    }));

    const env = {
      FIRECRAWL_ENABLED: "true",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
      FIRECRAWL_PROXY: "auto",
      PIPELINE_DISCOVERY_LOOKBACK_YEARS: "1",
      PIPELINE_PER_COURT_RATE_LIMIT_MS: "0",
    } as unknown as Env;

    const result = await discoverCourt(env, "ARTA", "run-firecrawl", Date.UTC(2026, 0, 1));

    expect(result.errors).toEqual([]);
    expect(result.new_cases).toHaveLength(1);
    expect(result.new_cases[0]).toMatchObject({
      citation: "[2026] ARTA 12",
      court_code: "ARTA",
      url: "https://www.austlii.edu.au/au/cases/cth/ARTA/2026/12.html",
      year: 2026,
    });

    const firecrawlCall = calls.find((call) => call.url === "https://api.firecrawl.dev/v2/scrape");
    expect(firecrawlCall).toBeDefined();
    expect(firecrawlCall?.init?.method).toBe("POST");
    expect((firecrawlCall?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-firecrawl-key",
    );

    const body = JSON.parse(String(firecrawlCall?.init?.body));
    expect(body).toMatchObject({
      url: "https://www.austlii.edu.au/au/cases/cth/ARTA/2026/",
      formats: ["rawHtml", "html"],
      onlyMainContent: false,
      maxAge: 0,
      proxy: "auto",
      storeInCache: false,
      location: {
        country: "AU",
        languages: ["en-AU", "en"],
      },
    });
  });

  it("does not call Firecrawl when the estimated run credit cap is exhausted", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init });
      return new Response("Forbidden", { status: 403 });
    }));

    const kvValues = new Map<string, string>([
      ["firecrawl:run:run-budget:estimated_credits", "25"],
    ]);
    const env = {
      FIRECRAWL_ENABLED: "true",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
      FIRECRAWL_PROXY: "auto",
      FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_RUN: "25",
      FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_MONTH: "1000",
      PIPELINE_DISCOVERY_LOOKBACK_YEARS: "1",
      PIPELINE_PER_COURT_RATE_LIMIT_MS: "0",
      PIPELINE_KV: {
        get: vi.fn(async (key: string) => kvValues.get(key) ?? null),
        put: vi.fn(async () => undefined),
      },
    } as unknown as Env;

    const result = await discoverCourt(env, "ARTA", "run-budget", Date.UTC(2026, 0, 1));

    expect(result.new_cases).toEqual([]);
    expect(result.errors.join(" ")).toContain("firecrawl run credit cap exceeded");
    expect(calls.map((call) => call.url)).not.toContain("https://api.firecrawl.dev/v2/scrape");
    expect(env.PIPELINE_KV?.put).not.toHaveBeenCalled();
  });
});
