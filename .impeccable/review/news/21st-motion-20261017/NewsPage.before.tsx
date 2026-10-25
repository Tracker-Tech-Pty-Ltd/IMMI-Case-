import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronDown, Info } from "lucide-react";
import { NewsPagination } from "@/components/shared/NewsPagination";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import { filterNews, formatNewsDate, getNewsPage, NEWS_CATEGORIES, NEWS_PAGE_SIZE, NEWS_REVIEWED_AT, NEWS_SOURCES, parseNewsFilters } from "@/lib/news";
import type { NewsItem, NewsLanguage } from "@/lib/news";
import { CodexSticker } from "@/components/shared/CodexSticker";
import type { CodexStickerId } from "@/lib/codex-stickers";

const CATEGORY_STICKERS: Readonly<Record<string, CodexStickerId>> = { government: "government", tribunal: "tribunal", courts: "court-update" };

function NewsEntry({ item, featured = false }: { item: NewsItem; featured?: boolean }) {
  const { t, i18n } = useTranslation();
  const language: NewsLanguage = i18n.language.startsWith("zh") ? "zh-TW" : "en";
  const copy = item.content[language];
  const source = NEWS_SOURCES.find((entry) => entry.id === item.source)!;
  const heading = featured ? (
    <h2 className="text-balance font-heading text-3xl font-semibold leading-tight text-foreground">{copy.title}</h2>
  ) : (
    <h3 className="text-balance font-heading text-xl font-semibold leading-tight text-foreground">{copy.title}</h3>
  );

  return (
    <article className={cn("news-entry min-w-0", featured ? "news-feature relative rounded-md border border-border-light bg-card p-4 sm:p-5" : "news-list-entry grid gap-2 py-2 sm:grid-cols-[calc(var(--spacing-8)*3)_minmax(0,1fr)] sm:gap-4")} aria-labelledby={item.id + "-heading"}>
      {!featured && <span className="inline-flex h-fit w-fit items-center gap-1 rounded-sm bg-accent-muted px-2 py-1 font-data text-xs font-medium text-accent"><CodexSticker id={CATEGORY_STICKERS[item.category] ?? "document"} className="h-4 w-4" />{t(`news.category.${item.category}`, { defaultValue: item.category })}</span>}
      <div className="min-w-0">
        <div className="flex items-start gap-4">
          <div className={cn("min-w-0 flex-1", featured && "news-feature-heading")}>
          {featured && <p className="mb-1 font-data text-sm font-medium text-accent">{t("news.featured", { defaultValue: "Selected update" })}</p>}
          <div id={item.id + "-heading"}>{heading}</div>
          {featured && <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-sm bg-accent-muted px-2 py-1 font-data text-xs font-medium text-accent"><CodexSticker id={CATEGORY_STICKERS[item.category] ?? "document"} className="h-4 w-4" />{t(`news.category.${item.category}`, { defaultValue: item.category })}</span>}
          </div>
          {featured && <CodexSticker id="document" className="news-document h-16 w-16" />}
        </div>
      <p className={cn("news-summary text-sm leading-relaxed text-secondary-text", featured ? "mt-2" : "mt-1")}>{copy.summary}</p>
      <div className={cn("news-entry-meta grid grid-cols-2 items-center gap-x-2 font-data sm:grid-cols-[minmax(0,1fr)_auto_auto]", featured ? "mt-2 text-sm" : "mt-1 text-xs")}>
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-relaxed text-muted-text sm:col-span-1">
          <span title={source.name[language]}>{source.name[language].replace(/\s*[（(][^）)]*[）)]$/u, "")}</span>
          <span>{t("news.published", { defaultValue: "Published" })} <time dateTime={item.publishedAt}>{formatNewsDate(item.publishedAt, language)}</time></span>
        </div>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="codex-control inline-flex shrink-0 items-center gap-1 rounded-sm font-medium text-accent underline-offset-4 hover:underline" aria-label={t("news.original_named", { defaultValue: "Open original: {{title}} (new tab)", title: copy.title })}>
          {t("news.original", { defaultValue: "View original" })}<CodexSticker id="original" className="h-4 w-4" />
        </a>
        <details className="group min-w-0 text-right open:col-span-2 sm:open:col-span-3">
          <summary className="codex-control inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-accent underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            <CodexSticker id="summary" className="h-4 w-4" />{t("news.read_summary", { defaultValue: "Read summary" })}<span className="sr-only">: {copy.title}</span><ChevronDown className="h-4 w-4 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 space-y-2 border-t border-border-light pt-3 text-left text-sm leading-relaxed text-secondary-text">
            <p>{copy.details}</p>
            <p className="font-data text-xs text-muted-text">{t("news.verified", { defaultValue: "Source checked" })} <time dateTime={item.verifiedAt}>{formatNewsDate(item.verifiedAt, language)}</time></p>
          </div>
        </details>
      </div>
      </div>
    </article>
  );
}

function NewsReadingTools() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    if (!window.matchMedia) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const update = (event: MediaQueryListEvent) => setOpen(event.matches);
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, []);

  return <aside className="min-w-0 space-y-3" aria-label={t("news.reading_tools", { defaultValue: "Reading and research" })}>
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="news-tools group rounded-md border border-border-light bg-card p-4 sm:p-5">
      <summary className="codex-control flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm [&::-webkit-details-marker]:hidden">
        <h2 className="font-heading text-xl font-semibold text-foreground"><span className="lg:hidden">{t("news.tools_title", { defaultValue: "Source checks and research" })}</span><span className="hidden lg:inline">{t("news.verify_title", { defaultValue: "Check the original source" })}</span></h2>
        <ChevronDown className="h-4 w-4 shrink-0 text-accent group-open:rotate-180 lg:hidden" aria-hidden="true" />
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-secondary-text">{t("news.verify_intro", { defaultValue: "After reading a summary, open the original to check its date and scope." })}</p>
      <ol className="news-checks mt-4 space-y-2 font-data text-sm text-secondary-text">
        {([
          ["calendar", t("news.check_date", { defaultValue: "Confirm the publication date" })],
          ["original", t("news.check_source", { defaultValue: "Read the original source" })],
          ["scope", t("news.check_scope", { defaultValue: "Distinguish announcements from case outcomes" })],
        ] as const).map(([id, text], index) => <li key={id} className="flex items-center gap-2"><span className="news-step inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface font-heading text-base text-foreground" aria-hidden="true">{index + 1}</span><span className="flex-1">{text}</span></li>)}
      </ol>
      <div className="news-research mt-5 border-t border-border-light pt-4">
        <h2 className="flex items-center gap-2 font-heading text-xl font-semibold text-foreground"><CodexSticker id="research" className="h-6 w-6" />{t("news.research", { defaultValue: "Continue your research" })}</h2>
        <div className="mt-3 flex flex-col gap-1 font-data text-sm">
          <Link to="/cases" className="codex-control inline-flex items-center justify-between gap-2 rounded-sm font-medium text-accent underline-offset-4 hover:underline">{t("news.cases_link", { defaultValue: "Return to case database" })}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
          <Link to="/analytics" className="codex-control inline-flex items-center justify-between gap-2 rounded-sm font-medium text-accent underline-offset-4 hover:underline">{t("news.analytics_link", { defaultValue: "View historical data" })}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
        </div>
      </div>
    </details>
    <details className="news-editorial group rounded-sm bg-surface p-3 text-xs leading-relaxed text-muted-text">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm [&::-webkit-details-marker]:hidden"><Info className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">{t("news.editorial_summary", { defaultValue: "Manually curated · Reading notes" })}</span><ChevronDown className="h-3 w-3 shrink-0 group-open:rotate-180" aria-hidden="true" /></summary>
      <p className="mt-2">{t("news.editorial_note", { defaultValue: "This is a manually checked selection, not a live or exhaustive news feed. Summaries are independently written; the original announcement controls. News does not predict individual case outcomes." })}</p>
      <CodexSticker id="scope" className="mt-2 h-6 w-6" />
    </details>
  </aside>;
}

export function NewsPage() {
  const { t, i18n } = useTranslation();
  const language: NewsLanguage = i18n.language.startsWith("zh") ? "zh-TW" : "en";
  const [params, setParams] = useSearchParams();
  const filters = parseNewsFilters(params);
  const matches = filterNews(filters);
  const result = getNewsPage(matches, params.get("page"));
  const hasFilters = !!(params.get("q") || filters.category || filters.source || filters.from || filters.to);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "from" && value && filters.to && value > filters.to) next.set("to", value);
    if (key === "to" && value && filters.from && value < filters.from) next.set("from", value);
    next.delete("page");
    setParams(next, { replace: true });
  }

  return (
    <div className="codex-news space-y-4" lang={language === "zh-TW" ? "zh-Hant" : "en"}>
      <header className="news-header grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 lg:gap-y-1">
          <h1 className="font-heading text-4xl font-semibold leading-tight text-foreground">{t("news.title", { defaultValue: "News updates" })}</h1>
          <span className="inline-flex shrink-0 items-center gap-1 justify-self-end rounded-sm border border-border-light bg-card px-2 py-1 font-data text-xs text-secondary-text"><CodexSticker id="source-check" className="h-4 w-4" />{t("news.official", { defaultValue: "Official sources" })}</span>
        <p className="col-span-2 text-sm leading-relaxed text-secondary-text lg:col-span-1">{t("news.subtitle", { defaultValue: "Follow Australian migration announcements, Tribunal news and court updates." })}</p>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-data text-xs text-muted-text lg:col-span-1 lg:col-start-2 lg:row-start-2 lg:justify-end"><p>{t("news.curated", { defaultValue: "Curated selection · Last source check" })} <time dateTime={NEWS_REVIEWED_AT}>{formatNewsDate(NEWS_REVIEWED_AT, language)}</time></p><p role="status" aria-live="polite">{t("news.results_count", { defaultValue: "{{count}} updates", count: matches.length })}</p></div>
      </header>

      <section className="news-filters space-y-3 font-data lg:space-y-2" aria-label={t("news.filters", { defaultValue: "Filter news" })}>
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="news-search relative min-w-0 lg:w-2/5">
            <CodexSticker id="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2" />
            <input type="search" value={params.get("q") ?? ""} onChange={(event) => updateFilter("q", event.target.value)} aria-label={t("news.search", { defaultValue: "Search news titles or sources" })} placeholder={t("news.search", { defaultValue: "Search news titles or sources" })} className="codex-control w-full rounded-sm border border-border bg-card pl-11 pr-3 text-sm text-foreground" />
          </div>
          <div className="news-categories flex min-w-0 flex-wrap gap-2" role="group" aria-label={t("news.categories", { defaultValue: "News categories" })}>
            <button type="button" aria-pressed={!filters.category} onClick={() => updateFilter("category", "")} className={cn("codex-control rounded-sm border px-4 text-sm", !filters.category ? "border-accent bg-accent font-medium text-on-solid" : "border-border bg-card text-secondary-text hover:bg-surface")}>{t("news.all", { defaultValue: "All" })}</button>
            {NEWS_CATEGORIES.map((category) => <button key={category} type="button" aria-pressed={filters.category === category} onClick={() => updateFilter("category", category)} className={cn("codex-control rounded-sm border px-4 text-sm", filters.category === category ? "border-accent bg-accent font-medium text-on-solid" : "border-border bg-card text-secondary-text hover:bg-surface")}>{t(`news.category.${category}`, { defaultValue: category })}</button>)}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:items-center sm:gap-0 sm:rounded-sm sm:border sm:border-border sm:bg-card">
          <span className="hidden items-center gap-1 px-3 text-xs text-secondary-text sm:inline-flex"><CodexSticker id="calendar" className="h-4 w-4" />{t("news.date_range", { defaultValue: "Publication date" })}</span>
          <label className="min-w-0 space-y-1 text-xs text-secondary-text sm:space-y-0">
            <span className="sm:sr-only">{t("news.date_from", { defaultValue: "Published from" })}</span>
            <input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className="codex-control block min-w-0 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground sm:w-[calc(var(--spacing-8)*4)] sm:border-0 sm:bg-transparent sm:px-2" />
          </label>
          <span className="hidden text-xs text-muted-text sm:inline" aria-hidden="true">–</span>
          <label className="min-w-0 space-y-1 text-xs text-secondary-text sm:space-y-0">
            <span className="sm:sr-only">{t("news.date_to", { defaultValue: "Published through" })}</span>
            <input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className="codex-control block min-w-0 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground sm:w-[calc(var(--spacing-8)*4)] sm:border-0 sm:bg-transparent sm:px-2" />
          </label>
          </div>
          <label className="news-source w-full min-w-0 space-y-1 text-xs text-secondary-text sm:w-[calc(var(--spacing-8)*8)] sm:space-y-0">
            <span className="sm:sr-only">{t("news.source", { defaultValue: "Source" })}</span>
            <div className="relative"><CodexSticker id="filter" className="pointer-events-none absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2" /><select value={filters.source} onChange={(event) => updateFilter("source", event.target.value)} className="codex-control block min-w-0 w-full rounded-sm border border-border bg-card pl-8 pr-3 text-sm text-foreground">
              <option value="">{t("news.all_sources", { defaultValue: "All sources" })}</option>
              {NEWS_SOURCES.map((source) => <option key={source.id} value={source.id}>{source.name[language]}</option>)}
            </select></div>
          </label>
          {hasFilters && <button type="button" onClick={() => setParams({}, { replace: true })} className="codex-control inline-flex items-center gap-1 rounded-sm px-2 text-sm text-accent hover:bg-accent-muted"><CodexSticker id="clear" className="h-5 w-5" />{t("news.clear", { defaultValue: "Clear filters" })}</button>}
        </div>
      </section>

      <div className="news-columns grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          {result.featured ? <NewsEntry key={result.featured.id} item={result.featured} featured /> : <div className="rounded-md border border-border-light bg-card p-5"><CodexSticker id="empty" className="mx-auto block h-24 w-24" /><EmptyState title={t("news.no_results", { defaultValue: "No updates match these filters" })} description={t("news.no_results_hint", { defaultValue: "Try another keyword, a wider date range or clear the filters." })} contained={false} /><button type="button" onClick={() => setParams({}, { replace: true })} className="codex-control mt-3 rounded-sm bg-accent px-4 font-data text-sm text-on-solid hover:bg-accent-hover">{t("news.clear", { defaultValue: "Clear filters" })}</button></div>}

          {result.items.length > 0 && <section aria-labelledby="news-latest-heading">
            <h2 id="news-latest-heading" className="border-b border-border-light pb-2 font-heading text-xl font-semibold text-foreground">{t("news.latest", { defaultValue: "Latest updates" })}</h2>
            <div className="divide-y divide-border-light">
              {result.items.map((item) => <NewsEntry key={item.id} item={item} />)}
            </div>
            <NewsPagination page={result.page} totalPages={result.totalPages} totalItems={result.totalItems} pageSize={NEWS_PAGE_SIZE} onPageChange={(page) => { const next = new URLSearchParams(params); next.set("page", String(page)); setParams(next); }} />
          </section>}
        </div>

        <NewsReadingTools />
      </div>
    </div>
  );
}
