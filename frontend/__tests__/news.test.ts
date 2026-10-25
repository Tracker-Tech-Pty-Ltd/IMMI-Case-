import { describe, it, expect } from "vitest";
import { filterNews, getNewsPage, NEWS_CATEGORIES, NEWS_ITEMS, NEWS_SOURCES, NEWS_REVIEWED_AT, parseNewsFilters, formatNewsDate } from "@/lib/news";

const all = parseNewsFilters(new URLSearchParams());

describe("curated official news", () => {
  it("has distinct entries with real official URLs and checkable dates", () => {
    expect(new Set(NEWS_ITEMS.map((item) => item.id)).size).toBe(NEWS_ITEMS.length);
    const hosts = { "home-affairs": "minister.homeaffairs.gov.au", art: "www.art.gov.au", fcfcoa: "www.fcfcoa.gov.au" };
    for (const item of NEWS_ITEMS) {
      expect(NEWS_CATEGORIES).toContain(item.category);
      expect(NEWS_SOURCES.some((source) => source.id === item.source)).toBe(true);
      expect(new URL(item.url).protocol).toBe("https:");
      expect(new URL(item.url).hostname).toBe(hosts[item.source as keyof typeof hosts]);
      expect(item.url).not.toMatch(/example|placeholder/);
      expect(item.publishedAt <= item.verifiedAt && item.verifiedAt <= NEWS_REVIEWED_AT).toBe(true);
      expect(new Date(item.publishedAt + "T00:00:00Z").toISOString().slice(0, 10)).toBe(item.publishedAt);
      for (const copy of Object.values(item.content)) {
        expect(copy.title.trim()).not.toBe("");
        expect(copy.summary.length).toBeGreaterThan(15);
        expect(copy.details.length).toBeGreaterThan(copy.summary.length);
      }
    }
  });

  it("searches both languages and publisher names", () => {
    expect(filterNews({ ...all, query: "學生簽證" }).map((item) => item.id)).toContain("student-visa-reforms-2026");
    expect(filterNews({ ...all, query: "TRANSCRIPT" }).map((item) => item.id)).toEqual(["fcfcoa-transcripts-june-2026"]);
    expect(filterNews({ ...all, query: "審裁處" }).every((item) => item.source === "art")).toBe(true);
  });

  it("combines category, source and inclusive publication boundaries", () => {
    const result = filterNews({ ...all, category: "tribunal", source: "art", from: "2026-06-01", to: "2026-07-01" });
    expect(result.map((item) => item.id)).toEqual(["art-fees-july-2026", "art-student-reviews-june-2026"]);
    expect(filterNews({ ...all, category: "tribunal", source: "fcfcoa" })).toEqual([]);
  });

  it("normalizes reversed valid dates and rejects invalid URL filters", () => {
    expect(parseNewsFilters(new URLSearchParams("from=2026-08-01&to=2026-06-01"))).toMatchObject({ from: "2026-06-01", to: "2026-08-01" });
    expect(parseNewsFilters(new URLSearchParams("from=2026-02-31&to=no&category=script&source=unknown"))).toMatchObject({ from: "", to: "", category: "", source: "" });
  });

  it("sorts chronologically without mutating the catalog", () => {
    const original = NEWS_ITEMS.map((item) => item.id);
    const result = filterNews(all, Object.freeze([...NEWS_ITEMS].reverse()));
    expect(result[0].id).toBe("fcfcoa-language-access-2026");
    expect(NEWS_ITEMS.map((item) => item.id)).toEqual(original);
  });

  it("paginates the list without repeating the selected feature", () => {
    const matches = filterNews(all);
    const first = getNewsPage(matches, "1");
    const ids = [first.featured!.id];
    for (let page = 1; page <= first.totalPages; page++) ids.push(...getNewsPage(matches, String(page)).items.map((item) => item.id));
    expect(new Set(ids).size).toBe(matches.length);
    expect(ids.length).toBe(matches.length);
    expect(first.featured!.id).toBe("student-visa-reforms-2026");
  });

  it("clamps out-of-range pages and handles empty results", () => {
    expect(getNewsPage(NEWS_ITEMS, "999").page).toBe(getNewsPage(NEWS_ITEMS, "1").totalPages);
    expect(getNewsPage(NEWS_ITEMS, "-3").page).toBe(1);
    expect(getNewsPage(NEWS_ITEMS, "999999999999999999999").page).toBe(1);
    expect(getNewsPage([], "9")).toMatchObject({ featured: undefined, items: [], page: 1, totalPages: 1 });
  });

  it("formats publication dates in UTC without shifting the day", () => {
    expect(formatNewsDate("2026-10-02", "en")).toContain("2 Oct 2026");
    expect(formatNewsDate("2026-10-02", "zh-TW")).toContain("2026");
  });
});
