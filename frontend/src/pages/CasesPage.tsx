import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { List, LayoutGrid, FileText } from "lucide-react";
import { useCases, useFilterOptions, useBatchCases } from "@/hooks/use-cases";
import { isCaseMutationsDisabledError } from "@/lib/api";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { FilterPill } from "@/components/shared/FilterPill";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { CaseMutationsDisabledNotice } from "@/components/shared/CaseMutationsDisabledNotice";
import { TagInputModal } from "@/components/shared/TagInputModal";
import { SaveSearchModal } from "@/components/saved-searches/SaveSearchModal";
import { SavedSearchPanel } from "@/components/saved-searches/SavedSearchPanel";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoader } from "@/components/shared/PageLoader";
import { CasesFilters } from "@/components/cases/CasesFilters";
import { CasesTable } from "@/components/cases/CasesTable";
import { CasesBulkActions } from "@/components/cases/CasesBulkActions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CaseFilters, ImmigrationCase } from "@/types/case";

export function CasesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    try {
      const stored = localStorage.getItem("cases-view-mode");
      return stored === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [mutationsDisabled, setMutationsDisabled] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);

  const filters: CaseFilters = useMemo(
    () => ({
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
    }),
    [searchParams],
  );

  const {
    data,
    isLoading,
    isError: isCasesError,
    error: casesError,
    refetch: refetchCases,
  } = useCases(filters);
  const {
    data: filterOpts,
    isError: isFilterOptionsError,
    error: filterOptionsError,
    refetch: refetchFilterOptions,
  } = useFilterOptions();
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

  const runBatch = useCallback(
    async (action: string, tag?: string) => {
      setMutationsDisabled(false);
      try {
        const result = await batchMutation.mutateAsync({
          action,
          ids: Array.from(selected),
          tag,
        });
        toast.success(t("cases.batch_updated", { count: result.affected }));
        setSelected(new Set());
        setDeleteConfirm(false);
      } catch (e) {
        if (isCaseMutationsDisabledError(e)) {
          setDeleteConfirm(false);
          setMutationsDisabled(true);
          return;
        }
        toast.error((e as Error).message);
      }
    },
    [selected, batchMutation, t],
  );

  const handleTagConfirm = useCallback(
    (tag: string) => {
      setTagModalOpen(false);
      runBatch("tag", tag);
    },
    [runBatch],
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
  }, [data, t]);

  const handleSaveSearch = useCallback(
    (name: string, searchFilters: CaseFilters) => {
      try {
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
      } catch (error) {
        // Show validation error to user
        toast.error(
          error instanceof Error ? error.message : "Failed to save search",
        );
      }
    },
    [editingSearchId, saveSearch, updateSearch, t],
  );

  const handleExecuteSavedSearch = useCallback(
    (savedFilters: CaseFilters) => {
      const params = new URLSearchParams();
      if (savedFilters.court) params.set("court", savedFilters.court);
      if (savedFilters.year) params.set("year", String(savedFilters.year));
      if (savedFilters.visa_type)
        params.set("visa_type", savedFilters.visa_type);
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
    [setSearchParams, t],
  );

  const handleEditSearch = useCallback((searchId: string) => {
    setEditingSearchId(searchId);
    setShowSaveModal(true);
  }, []);

  // Global keyboard shortcuts on cases page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        keywordInputRef.current?.focus();
        keywordInputRef.current?.select();
      }

      if (e.key === "a") {
        e.preventDefault();
        navigate("/cases/add");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate]);

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
      } else if (e.key.toLowerCase() === "x" && focusedIdx >= 0) {
        e.preventDefault();
        const c = data?.cases[focusedIdx];
        if (c) toggleSelect(c.case_id);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [viewMode, data?.cases, focusedIdx, navigate, toggleSelect]);

  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const currentPage = filters.page ?? 1;

  const clampedFocusedIdx = useMemo(() => {
    if (!cases.length) return -1;
    return Math.min(focusedIdx, cases.length - 1);
  }, [cases.length, focusedIdx]);

  // Scroll focused row into view
  useEffect(() => {
    if (clampedFocusedIdx < 0 || !tableRef.current) return;
    const row = tableRef.current.children[clampedFocusedIdx] as HTMLElement;
    row?.scrollIntoView({ block: "nearest" });
  }, [clampedFocusedIdx]);

  // Active filter pills — memoised to prevent new array on every render
  const activeFilters = useMemo(() => {
    const result: Array<{ key: string; label: string; value: string }> = [];
    if (filters.court)
      result.push({
        key: "court",
        label: t("filters.court"),
        value: filters.court,
      });
    if (filters.year)
      result.push({
        key: "year",
        label: t("units.year"),
        value: String(filters.year),
      });
    if (filters.nature)
      result.push({
        key: "nature",
        label: t("cases.nature"),
        value: filters.nature,
      });
    if (filters.visa_type)
      result.push({
        key: "visa_type",
        label: t("cases.visa_subclass"),
        value: filters.visa_type,
      });
    if (filters.source)
      result.push({
        key: "source",
        label: t("cases.source") || "Source",
        value: filters.source,
      });
    if (filters.tag)
      result.push({
        key: "tag",
        label: t("common.tags") || "Tags",
        value: filters.tag,
      });
    if (filters.keyword)
      result.push({
        key: "keyword",
        label: t("common.search"),
        value: filters.keyword,
      });
    return result;
  }, [filters, t]);

  const hasActiveFilterSet = activeFilters.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title={t("cases.title")}
        description={t("cases.page_subtitle", {
          defaultValue:
            "Review, compare, and manage immigration case records from one workspace.",
        })}
        meta={
          <span>
            {total.toLocaleString()} {t("units.cases")}
          </span>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setViewMode("table");
                try {
                  localStorage.setItem("cases-view-mode", "table");
                } catch {
                  /* ignore */
                }
              }}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "table"
                  ? "bg-accent-muted text-accent"
                  : "text-muted-text hover:text-foreground",
              )}
              aria-label={t("cases.table_view", { defaultValue: "Table view" })}
              title={t("cases.table_view", { defaultValue: "Table view" })}
              aria-pressed={viewMode === "table"}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("cards");
                try {
                  localStorage.setItem("cases-view-mode", "cards");
                } catch {
                  /* ignore */
                }
              }}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "cards"
                  ? "bg-accent-muted text-accent"
                  : "text-muted-text hover:text-foreground",
              )}
              aria-label={t("cases.card_view", { defaultValue: "Card view" })}
              title={t("cases.card_view", { defaultValue: "Card view" })}
              aria-pressed={viewMode === "cards"}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/cases/add")}
              aria-keyshortcuts="A"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-light"
            >
              {t("buttons.add_case")}
            </button>
          </>
        }
      />

      {/* Filters */}
      <CasesFilters
        filters={filters}
        filterOpts={filterOpts}
        showAdvanced={showAdvanced}
        onUpdateFilter={updateFilter}
        onToggleAdvanced={() => setShowAdvanced((v) => !v)}
        onSaveSearch={() => setShowSaveModal(true)}
        keywordInputRef={keywordInputRef}
      />

      {isFilterOptionsError && (
        <ApiErrorState
          title={t("errors.failed_to_load", {
            name: t("filters.filter"),
          })}
          message={
            filterOptionsError instanceof Error
              ? filterOptionsError.message
              : t("errors.unable_to_load_message")
          }
          onRetry={() => {
            void refetchFilterOptions();
          }}
        />
      )}

      {!isLoading &&
        !isCasesError &&
        cases.length > 0 &&
        viewMode === "table" && (
          <div className="rounded-md border border-border-light bg-surface px-3 py-2 text-xs text-muted-text">
            {t("cases.keyboard_shortcuts")}
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
            type="button"
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
        compactEmptyState
      />

      {/* Batch bar */}
      <CasesBulkActions
        selected={selected}
        onBatchTag={() => setTagModalOpen(true)}
        onExportCsv={exportCsv}
        onDeleteRequest={() => setDeleteConfirm(true)}
        onClearSelection={() => setSelected(new Set())}
      />

      {mutationsDisabled && <CaseMutationsDisabledNotice />}

      {/* Data load error */}
      {isCasesError && !data && (
        <ApiErrorState
          title={t("errors.failed_to_load", { name: t("cases.title") })}
          message={
            casesError instanceof Error
              ? casesError.message
              : t("errors.unable_to_load_message")
          }
          onRetry={() => {
            void refetchCases();
          }}
        />
      )}

      {/* Loading */}
      {isLoading && !isCasesError && <PageLoader />}

      {/* Empty state */}
      {!isLoading && !isCasesError && cases.length === 0 && (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t("cases.empty_state_title")}
          description={
            activeFilters.length > 0
              ? t("cases.empty_state_filtered_description")
              : t("empty_states.no_cases_description")
          }
          action={
            hasActiveFilterSet ? (
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
                >
                  {t("filters.clear_filters")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/saved-searches")}
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                >
                  {t("saved_searches.title")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/guided-search")}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
              >
                {t("nav.guided_search")}
              </button>
            )
          }
        />
      )}

      {/* Table / Cards view */}
      {!isLoading && cases.length > 0 && (
        <CasesTable
          cases={cases}
          viewMode={viewMode}
          selected={selected}
          clampedFocusedIdx={clampedFocusedIdx}
          tableRef={tableRef}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
          onSetFocusedIdx={setFocusedIdx}
        />
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
        title={t("modals.confirm_delete")}
        message={t("modals.confirm_delete_message", {
          name: `${selected.size}`,
        })}
        confirmLabel={t("common.delete")}
        variant="danger"
        onConfirm={() => runBatch("delete")}
        onCancel={() => setDeleteConfirm(false)}
      />

      {/* Tag input modal */}
      <TagInputModal
        key={String(tagModalOpen)}
        open={tagModalOpen}
        count={selected.size}
        onConfirm={handleTagConfirm}
        onCancel={() => setTagModalOpen(false)}
      />

      {/* Save Search modal */}
      <SaveSearchModal
        open={showSaveModal}
        filters={
          editingSearchId
            ? (getSearchById(editingSearchId)?.filters ?? filters)
            : filters
        }
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
