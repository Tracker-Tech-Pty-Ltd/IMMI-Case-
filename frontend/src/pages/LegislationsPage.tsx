import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Search,
  ChevronRight,
  Scale,
  Globe,
  Calendar,
  BookOpen,
  Hash,
} from "lucide-react";
import {
  useLegislations,
  useLegislationSearch,
  useLegislationUpdateStatus,
  useStartLegislationUpdate,
} from "@/hooks/use-legislations";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import type { Legislation } from "@/lib/api";

export function LegislationsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Extract query params
  const searchQuery = searchParams.get("q") ?? "";
  const page = Number(searchParams.get("page") ?? 1);
  const limit = 20;

  // State for search input with debounce
  const [inputValue, setInputValue] = useState(searchQuery);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Use appropriate hook based on whether we're searching
  const updateStatus = useLegislationUpdateStatus();
  const startUpdate = useStartLegislationUpdate();
  const job = updateStatus.data?.status;

  const { data: paginatedData, isLoading: paginatedLoading } = useLegislations(
    searchQuery ? 1 : page,
    limit,
  );
  const { data: searchData, isLoading: searchLoading } = useLegislationSearch(
    searchQuery,
    limit,
  );

  // Combine results
  const data = searchQuery ? searchData : paginatedData;
  const isLoading = searchQuery ? searchLoading : paginatedLoading;

  const legislations = useMemo((): Legislation[] => {
    if (!data) return [];
    return data.data ?? [];
  }, [data]);

  const totalItems = useMemo(() => {
    if (searchQuery) {
      return searchData?.meta.total_results ?? 0;
    }
    return paginatedData?.meta.total ?? 0;
  }, [paginatedData, searchData, searchQuery]);

  const totalPages = useMemo(() => {
    if (searchQuery) return 1;
    return paginatedData?.meta.pages ?? 1;
  }, [paginatedData, searchQuery]);

  // Handle search input change with debounce
  const handleSearchChange = useCallback(
    (value: string) => {
      setInputValue(value);

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer
      const timer = setTimeout(() => {
        const params = new URLSearchParams();
        if (value) {
          params.set("q", value);
          params.set("page", "1");
        } else {
          params.delete("q");
          params.set("page", "1");
        }
        setSearchParams(params);
      }, 300);

      // Store timer in ref for cleanup
      debounceTimerRef.current = timer;
    },
    [setSearchParams],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", String(newPage));
      setSearchParams(params);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [searchParams, setSearchParams],
  );

  const handleLegislationClick = useCallback(
    (id: string) => {
      navigate(`/legislations/${id}`);
    },
    [navigate],
  );

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: t("common.dashboard"), href: "/" },
          { label: t("legislations.title", { defaultValue: "Legislations" }) },
        ]}
      />

      {/* Header + Search (combined) */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-accent/10 p-2">
              <Scale className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-semibold text-foreground">
                {t("legislations.title", { defaultValue: "Legislations" })}
              </h1>
              <p className="mt-0.5 text-sm text-secondary-text">
                {t("legislations.description", {
                  defaultValue:
                    "Browse and search legislation relevant to immigration law",
                })}
              </p>
            </div>
          </div>
          <button
            onClick={() => startUpdate.mutate(undefined)}
            disabled={job?.running || startUpdate.isPending}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium",
              "text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", job?.running && "animate-spin")}
            />
            {job?.running
              ? t("legislations.updating", { defaultValue: "Updating..." })
              : t("legislations.update_laws", { defaultValue: "Update Laws" })}
          </button>
        </div>

        {/* Integrated search bar */}
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text" />
          <input
            type="text"
            placeholder={t("legislations.search_placeholder")}
            value={inputValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            className={cn(
              "w-full rounded-md border border-border bg-surface px-3 py-2 pl-10 text-sm",
              "text-foreground placeholder:text-muted-text",
              "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50",
            )}
          />
        </div>

        {/* Scrape progress bar */}
        {job?.running && job.total > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-muted-text">
              <span className="truncate font-mono">{job.section_id}</span>
              <span>
                {job.current}/{job.total}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{
                  width: `${Math.round((job.current / job.total) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-text">
              {t("legislations.scraping_law", { defaultValue: "Downloading" })}{" "}
              <span className="font-medium text-foreground">{job.law_id}</span>
            </p>
          </div>
        )}

        {/* Completion summary */}
        {!job?.running && (job?.completed_laws?.length ?? 0) > 0 && (
          <p className="mt-3 text-xs text-success">
            {t("legislations.update_complete", {
              defaultValue: "Updated {{count}} law(s)",
              count: job!.completed_laws.length,
            })}
            {(job?.failed_laws?.length ?? 0) > 0 && (
              <span className="ml-2 text-danger">
                · {job!.failed_laws.length} failed
              </span>
            )}
          </p>
        )}
      </div>

      {/* Legislations List */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-text">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">{t("common.loading_ellipsis")}</span>
        </div>
      ) : legislations.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title={t("legislations.empty_title", {
            defaultValue: "No Legislations",
          })}
          description={t("legislations.empty_description", {
            defaultValue: "No legislation found matching your criteria.",
          })}
        />
      ) : (
        <div className="space-y-2">
          {legislations.map((leg: Legislation) => (
            <button
              key={leg.id}
              onClick={() => handleLegislationClick(leg.id)}
              className={cn(
                "group w-full rounded-lg border border-border bg-card p-4 text-left",
                "cursor-pointer transition-all hover:border-accent/50 hover:bg-surface hover:shadow-sm",
              )}
            >
              <div className="flex items-start gap-3">
                {/* Icon anchor */}
                <div className="mt-0.5 shrink-0 rounded bg-surface p-1.5 transition-colors group-hover:bg-accent/10">
                  <BookOpen className="h-4 w-4 text-muted-text transition-colors group-hover:text-accent" />
                </div>

                <div className="min-w-0 flex-1">
                  {/* Title row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-heading text-sm font-semibold text-foreground">
                      {leg.title}
                    </h3>
                    {leg.shortcode && (
                      <span className="inline-flex items-center gap-1 rounded border border-accent/30 bg-accent/8 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                        <Hash className="h-2.5 w-2.5" />
                        {leg.shortcode}
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  {leg.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-secondary-text">
                      {leg.description}
                    </p>
                  )}

                  {/* Badge row */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {leg.type && (
                      <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-secondary-text">
                        {leg.type}
                      </span>
                    )}
                    {leg.jurisdiction && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-muted-text">
                        <Globe className="h-2.5 w-2.5" />
                        {leg.jurisdiction}
                      </span>
                    )}
                    {leg.sections_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/8 px-2 py-0.5 text-[10px] font-medium text-accent">
                        <BookOpen className="h-2.5 w-2.5" />
                        {leg.sections_count}{" "}
                        {t("legislations.sections", {
                          defaultValue: "sections",
                        })}
                      </span>
                    )}
                    {leg.last_amended && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-text">
                        <Calendar className="h-2.5 w-2.5" />
                        {t("legislations.last_amended", {
                          defaultValue: "Amended",
                        })}{" "}
                        {leg.last_amended}
                      </span>
                    )}
                  </div>
                </div>

                {/* Chevron — fixed: added group class to parent */}
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-text transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!searchQuery && legislations.length > 0 && (
        <div className="flex justify-center pt-4">
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={limit}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
