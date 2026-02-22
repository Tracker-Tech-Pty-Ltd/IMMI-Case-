import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  List,
  LayoutGrid,
  Trash2,
  Tag,
  Download,
  GitCompare,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
  Bookmark,
} from "lucide-react";
import { useCases, useFilterOptions, useBatchCases } from "@/hooks/use-cases";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { CaseCard } from "@/components/cases/CaseCard";
import { FilterPill } from "@/components/shared/FilterPill";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { SaveSearchModal } from "@/components/saved-searches/SaveSearchModal";
import { SavedSearchPanel } from "@/components/saved-searches/SavedSearchPanel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CaseFilters, ImmigrationCase } from "@/types/case";

function formatDateCompact(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CasesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    const stored = localStorage.getItem("cases-view-mode");
    return stored === "cards" ? "cards" : "table";
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const filters: CaseFilters = {
    court: searchParams.get("court") ?? "",
    year: searchParams.get("year")
      ? Number(searchParams.get("year"))
      : undefined,
    visa_type: searchParams.get("visa_type") ?? "",
    nature: searchParams.get("nature") ?? "",
    source: searchParams.get("source") ?? "",
    tag: searchParams.get("tag") ?? "",
    keyword: searchParams.get("keyword") ?? "",
    sort_by: searchParams.get("sort_by") ?? "date",
    sort_dir: (searchParams.get("sort_dir") as "asc" | "desc") ?? "desc",
    page: Number(searchParams.get("page") ?? 1),
    page_size: 100,
  };

  const { data, isLoading } = useCases(filters);
  const { data: filterOpts } = useFilterOptions();
  const batchMutation = useBatchCases();
  const { savedSearches, saveSearch, updateSearch, getSearchById } =
    useSavedSearches();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key !== "page") params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!data) return;
    if (selected.size === data.cases.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.cases.map((c) => c.case_id)));
    }
  }, [data, selected.size]);

  const handleBatch = useCallback(
    async (action: string) => {
      if (selected.size === 0) return;
      const tag =
        action === "tag"
          ? prompt(t("cases.add_tag") || "Enter tag:")
          : undefined;
      if (action === "tag" && !tag) return;
      try {
        const result = await batchMutation.mutateAsync({
          action,
          ids: Array.from(selected),
          tag: tag ?? undefined,
        });
        toast.success(t("cases.batch_updated", { count: result.affected }));
        setSelected(new Set());
        setDeleteConfirm(false);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [selected, batchMutation],
  );

  const exportCsv = useCallback(() => {
    if (!data?.cases.length) return;
    const headers = [
      "citation",
      "title",
      "court_code",
      "date",
      "year",
      "judges",
      "outcome",
      "visa_type",
      "case_nature",
    ];
    const rows = data.cases.map((c) =>
      headers.map((h) => {
        const val = String(c[h as keyof ImmigrationCase] ?? "");
        return val.includes(",") || val.includes('"')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }),
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cases-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("cases.exported", { count: data.cases.length }));
  }, [data]);

  const handleSaveSearch = useCallback(
    (name: string, searchFilters: CaseFilters) => {
      if (editingSearchId) {
        // Update existing search
        const updated = updateSearch(editingSearchId, {
          name,
          filters: searchFilters,
        });
        if (updated) {
          toast.success(t("saved_searches.toast_updated", { name }));
        }
        setEditingSearchId(null);
      } else {
        // Create new search
        saveSearch(name, searchFilters);
        toast.success(t("saved_searches.toast_saved", { name }));
      }
      setShowSaveModal(false);
    },
    [editingSearchId, saveSearch, updateSearch],
  );

  const handleExecuteSavedSearch = useCallback(
    (savedFilters: CaseFilters) => {
      const params = new URLSearchParams();
      if (savedFilters.court) params.set("court", savedFilters.court);
      if (savedFilters.year) params.set("year", String(savedFilters.year));
      if (savedFilters.visa_type) params.set("visa_type", savedFilters.visa_type);
      if (savedFilters.nature) params.set("nature", savedFilters.nature);
      if (savedFilters.source) params.set("source", savedFilters.source);
      if (savedFilters.tag) params.set("tag", savedFilters.tag);
      if (savedFilters.keyword) params.set("keyword", savedFilters.keyword);
      if (savedFilters.sort_by) params.set("sort_by", savedFilters.sort_by);
      if (savedFilters.sort_dir) params.set("sort_dir", savedFilters.sort_dir);
      params.set("page", "1");
      setSearchParams(params);
      toast.success(t("saved_searches.toast_applied"));
    },
    [setSearchParams],
  );

  const handleEditSearch = useCallback(
    (searchId: string) => {
      setEditingSearchId(searchId);
      setShowSaveModal(true);
    },
    [],
  );

  // Keyboard navigation
  useEffect(() => {
    if (viewMode !== "table") return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      )
        return;

      const count = data?.cases.length ?? 0;
      if (count === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.min(prev + 1, count - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setFocusedIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusedIdx >= 0) {
        e.preventDefault();
        const c = data?.cases[focusedIdx];
        if (c) navigate(`/cases/${c.case_id}`);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [viewMode, data, focusedIdx, navigate]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIdx < 0 || !tableRef.current) return;
    const row = tableRef.current.children[focusedIdx] as HTMLElement;
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const currentPage = filters.page ?? 1;

  // Active filter pills
  const activeFilters: Array<{ key: string; label: string; value: string }> =
    [];
  if (filters.court)
    activeFilters.push({
      key: "court",
      label: t("filters.court"),
      value: filters.court,
    });
  if (filters.year)
    activeFilters.push({
      key: "year",
      label: t("units.year"),
      value: String(filters.year),
    });
  if (filters.nature)
    activeFilters.push({
      key: "nature",
      label: t("cases.nature"),
      value: filters.nature,
    });
  if (filters.visa_type)
    activeFilters.push({
      key: "visa_type",
      label: t("cases.visa_subclass"),
      value: filters.visa_type,
    });
  if (filters.source)
    activeFilters.push({
      key: "source",
      label: t("cases.source") || "Source",
      value: filters.source,
    });
  if (filters.tag)
    activeFilters.push({
      key: "tag",
      label: t("common.tags") || "Tags",
      value: filters.tag,
    });
  if (filters.keyword)
    activeFilters.push({
      key: "keyword",
      label: t("common.search"),
      value: filters.keyword,
    });

  const sortLabel =
    filters.sort_by === "date"
      ? t("filters.date") || "Date"
      : filters.sort_by === "year"
        ? t("units.year")
        : filters.sort_by === "title"
          ? t("cases.title")
          : t("filters.court");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("cases.title")}
          </h1>
          <p className="text-sm text-muted-text">
            {total.toLocaleString()} {t("units.cases")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setViewMode("table");
              localStorage.setItem("cases-view-mode", "table");
            }}
            className={cn(
              "rounded-md p-1.5",
              viewMode === "table"
                ? "bg-accent-muted text-accent"
                : "text-muted-text hover:text-foreground",
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setViewMode("cards");
              localStorage.setItem("cases-view-mode", "cards");
            }}
            className={cn(
              "rounded-md p-1.5",
              viewMode === "cards"
                ? "bg-accent-muted text-accent"
                : "text-muted-text hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate("/cases/add")}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-light"
          >
            {t("buttons.add_case")}
          </button>
        </div>
      </div>

      {/* Primary Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.court ?? ""}
          onChange={(e) => updateFilter("court", e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("filters.all_courts")}</option>
          {filterOpts?.courts?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.year?.toString() ?? ""}
          onChange={(e) => updateFilter("year", e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("filters.year_from")}</option>
          {filterOpts?.years?.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={filters.nature ?? ""}
          onChange={(e) => updateFilter("nature", e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("filters.all_natures")}</option>
          {filterOpts?.natures?.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-text" />
          <input
            type="text"
            placeholder={t("common.search_placeholder")}
            defaultValue={filters.keyword}
            onBlur={(e) => updateFilter("keyword", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                updateFilter("keyword", e.currentTarget.value);
            }}
            className="rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-text"
          />
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-text hover:text-foreground"
        >
          {t("filters.filter")}
          {showAdvanced ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-text hover:text-foreground"
          title="Save current search for quick access later"
        >
          <Bookmark className="h-3.5 w-3.5" />
          {t("saved_searches.save_button")}
        </button>

        {/* Sort */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-text">
            {t("judges.sort_label")}:
          </span>
          <select
            value={filters.sort_by ?? "date"}
            onChange={(e) => updateFilter("sort_by", e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          >
            <option value="date">{t("cases.date")}</option>
            <option value="year">{t("units.year")}</option>
            <option value="title">{t("cases.title")}</option>
            <option value="court">{t("filters.court")}</option>
          </select>
          <button
            onClick={() =>
              updateFilter(
                "sort_dir",
                filters.sort_dir === "asc" ? "desc" : "asc",
              )
            }
            className="rounded-md border border-border p-1.5 text-muted-text hover:text-foreground"
            title={`${t("cases.sorted")} ${sortLabel} ${filters.sort_dir === "asc" ? t("cases.ascending") : t("cases.descending")}`}
          >
            {filters.sort_dir === "asc" ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-2 rounded-md border border-border-light bg-surface p-3">
          <select
            value={filters.visa_type ?? ""}
            onChange={(e) => updateFilter("visa_type", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("filters.all_visa_types")}</option>
            {filterOpts?.visa_types?.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={filters.source ?? ""}
            onChange={(e) => updateFilter("source", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("filters.all_sources")}</option>
            {filterOpts?.sources?.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.tag ?? ""}
            onChange={(e) => updateFilter("tag", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("filters.all_tags")}</option>
            {filterOpts?.tags?.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filter Pills */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <FilterPill
              key={f.key}
              label={f.label}
              value={f.value}
              onRemove={() => updateFilter(f.key, "")}
            />
          ))}
          <button
            onClick={clearAllFilters}
            className="ml-1 text-xs text-muted-text hover:text-foreground"
          >
            {t("filters.clear_filters")}
          </button>
        </div>
      )}

      {/* Saved Searches Panel */}
      <SavedSearchPanel
        onExecute={handleExecuteSavedSearch}
        onEdit={handleEditSearch}
      />

      {/* Batch bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-accent-muted px-4 py-2 text-sm">
          <span className="font-medium text-accent">
            {selected.size} {t("cases.selected") || "selected"}
          </span>
          <button
            onClick={() => handleBatch("tag")}
            className="flex items-center gap-1 text-accent hover:text-accent-light"
          >
            <Tag className="h-3.5 w-3.5" /> {t("case_detail.tags")}
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 text-accent hover:text-accent-light"
          >
            <Download className="h-3.5 w-3.5" /> {t("buttons.export_csv")}
          </button>
          {selected.size >= 2 && selected.size <= 5 && (
            <button
              onClick={() => {
                const ids = Array.from(selected);
                const params = new URLSearchParams();
                ids.forEach((id) => params.append("ids", id));
                navigate(`/cases/compare?${params}`);
              }}
              className="flex items-center gap-1 text-accent hover:text-accent-light"
            >
              <GitCompare className="h-3.5 w-3.5" /> Compare
            </button>
          )}
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1 text-danger hover:text-danger/80"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-muted-text hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex h-32 items-center justify-center text-muted-text">
          Loading cases...
        </div>
      )}

      {/* Empty state */}
      {!isLoading && cases.length === 0 && (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No cases found"
          description={
            activeFilters.length > 0
              ? "Try adjusting your filters or clearing them."
              : "Get started by searching or downloading cases."
          }
          action={
            activeFilters.length > 0 ? (
              <button
                onClick={clearAllFilters}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
              >
                Clear Filters
              </button>
            ) : (
              <button
                onClick={() => navigate("/pipeline")}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
              >
                Run Pipeline
              </button>
            )
          }
        />
      )}

      {/* Table view */}
      {!isLoading && cases.length > 0 && viewMode === "table" && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="w-10 px-2 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === cases.length && cases.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-2 py-2.5 text-left font-medium text-secondary-text">
                  Title
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Citation
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Court
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Date
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Country
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Outcome
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-secondary-text">
                  Nature
                </th>
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {cases.map((c, i) => (
                <tr
                  key={c.case_id}
                  className={cn(
                    "border-b border-border-light transition-colors cursor-pointer",
                    focusedIdx === i
                      ? "bg-accent-muted"
                      : "hover:bg-surface/50",
                    selected.has(c.case_id) && "bg-accent-muted/50",
                  )}
                  onClick={() => navigate(`/cases/${c.case_id}`)}
                >
                  <td
                    className="w-10 px-2 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.case_id)}
                      onChange={() => toggleSelect(c.case_id)}
                      className="rounded"
                    />
                  </td>
                  <td className="max-w-xs px-2 py-2">
                    <span
                      className="block truncate font-medium text-foreground"
                      title={c.title || c.citation}
                    >
                      {c.title || c.citation}
                    </span>
                    {(c.applicant_name || c.judges) && (
                      <span
                        className="block truncate text-xs text-muted-text"
                        title={c.applicant_name || c.judges}
                      >
                        {c.applicant_name
                          ? `Applicant: ${c.applicant_name}`
                          : c.judges}
                      </span>
                    )}
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-2 text-xs text-muted-text"
                    title={c.citation}
                  >
                    {c.citation}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <CourtBadge court={c.court_code} />
                  </td>
                  <td
                    className="whitespace-nowrap px-2 py-2 text-xs text-muted-text"
                    title={c.date}
                  >
                    {formatDateCompact(c.date)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-text">
                    {c.country_of_origin || ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <OutcomeBadge outcome={c.outcome} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <NatureBadge nature={c.case_nature} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cards view */}
      {!isLoading && cases.length > 0 && viewMode === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <CaseCard
              key={c.case_id}
              case_={c}
              onClick={() => navigate(`/cases/${c.case_id}`)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={total}
        pageSize={filters.page_size ?? 100}
        onPageChange={(p) => updateFilter("page", String(p))}
      />

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={deleteConfirm}
        title="Delete Cases"
        message={`Are you sure you want to delete ${selected.size} selected case${selected.size > 1 ? "s" : ""}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => handleBatch("delete")}
        onCancel={() => setDeleteConfirm(false)}
      />

      {/* Save Search modal */}
      <SaveSearchModal
        open={showSaveModal}
        filters={editingSearchId ? getSearchById(editingSearchId)?.filters ?? filters : filters}
        existingNames={savedSearches.map((s) => s.name)}
        editingSearch={editingSearchId ? getSearchById(editingSearchId) : null}
        onSave={handleSaveSearch}
        onCancel={() => {
          setShowSaveModal(false);
          setEditingSearchId(null);
        }}
      />
    </div>
  );
}
