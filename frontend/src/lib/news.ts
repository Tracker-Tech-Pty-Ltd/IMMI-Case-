import catalog from "@/data/news.json";

export type NewsCategory = "government" | "tribunal" | "courts";
export type NewsLanguage = "en" | "zh-TW";
export interface NewsCopy { title: string; summary: string; details: string }
export interface NewsItem {
  id: string;
  category: NewsCategory;
  source: string;
  publishedAt: string;
  verifiedAt: string;
  url: string;
  featured?: boolean;
  content: Record<NewsLanguage, NewsCopy>;
}
export interface NewsFilters {
  query: string;
  category: NewsCategory | "";
  source: string;
  from: string;
  to: string;
}
export const NEWS_CATEGORIES: readonly NewsCategory[] = ["government", "tribunal", "courts"];
export const NEWS_SOURCES = catalog.sources;
export const NEWS_ITEMS = catalog.items as readonly NewsItem[];
export const NEWS_REVIEWED_AT = catalog.reviewedAt;
export const NEWS_PAGE_SIZE = 3;

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

/** Only supported filters reach the catalog; unknown URL values are harmless. */
export function parseNewsFilters(params: URLSearchParams): NewsFilters {
  const category = params.get("category") ?? "";
  const source = params.get("source") ?? "";
  const from = validDate(params.get("from") ?? "");
  const to = validDate(params.get("to") ?? "");
  return {
    query: (params.get("q") ?? "").trim(),
    category: NEWS_CATEGORIES.includes(category as NewsCategory) ? category as NewsCategory : "",
    source: NEWS_SOURCES.some((entry) => entry.id === source) ? source : "",
    from: from && to && from > to ? to : from,
    to: from && to && from > to ? from : to,
  };
}

/** Search both languages and publishers, regardless of the active UI language. */
export function filterNews(filters: NewsFilters, items: readonly NewsItem[] = NEWS_ITEMS): NewsItem[] {
  const query = filters.query.normalize("NFKC").toLocaleLowerCase("en");
  return items.filter((item) => {
    const source = NEWS_SOURCES.find((entry) => entry.id === item.source);
    const searchable = [item.id, ...Object.values(item.content).flatMap((copy) => [copy.title, copy.summary, copy.details]), ...Object.values(source?.name ?? {})].join(" ").normalize("NFKC").toLocaleLowerCase("en");
    return (!filters.category || item.category === filters.category)
      && (!filters.source || item.source === filters.source)
      && (!filters.from || item.publishedAt >= filters.from)
      && (!filters.to || item.publishedAt <= filters.to)
      && (!query || searchable.includes(query));
  }).toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

/** Keep the selected feature separate from the chronological paginated list. */
export function getNewsPage(items: readonly NewsItem[], pageValue: string | null) {
  const featured = items.find((item) => item.featured) ?? items[0];
  const remaining = items.filter((item) => item.id !== featured?.id);
  const totalPages = Math.max(1, Math.ceil(remaining.length / NEWS_PAGE_SIZE));
  const requested = pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : 1;
  const page = Number.isSafeInteger(requested) ? Math.min(totalPages, Math.max(1, requested)) : 1;
  return { featured, items: remaining.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE), page, totalPages, totalItems: remaining.length };
}

export function formatNewsDate(value: string, language: NewsLanguage): string {
  return new Intl.DateTimeFormat(language === "zh-TW" ? "zh-TW" : "en-AU", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));
}
