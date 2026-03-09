import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { SavedSearchPanel } from "@/components/saved-searches/SavedSearchPanel";
import { SaveSearchModal } from "@/components/saved-searches/SaveSearchModal";
import { PageHeader } from "@/components/shared/PageHeader";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import type { CaseFilters } from "@/types/case";

function buildSearchParams(savedFilters: CaseFilters): URLSearchParams {
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
  return params;
}

export function SavedSearchesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { savedSearches, updateSearch, getSearchById } = useSavedSearches();
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const editingSearch = useMemo(
    () => (editingSearchId ? getSearchById(editingSearchId) : null),
    [editingSearchId, getSearchById],
  );

  const handleExecuteSavedSearch = useCallback(
    (savedFilters: CaseFilters) => {
      const params = buildSearchParams(savedFilters);
      navigate(`/cases?${params.toString()}`);
      toast.success(t("saved_searches.toast_applied"));
    },
    [navigate, t],
  );

  const handleEditSearch = useCallback((searchId: string) => {
    setEditingSearchId(searchId);
    setShowEditModal(true);
  }, []);

  const handleSave = useCallback(
    (name: string, filters: CaseFilters) => {
      if (!editingSearchId) return;
      try {
        const updated = updateSearch(editingSearchId, { name, filters });
        if (updated) {
          toast.success(t("saved_searches.toast_updated", { name }));
        }
        setShowEditModal(false);
        setEditingSearchId(null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("errors.something_went_wrong"),
        );
      }
    },
    [editingSearchId, t, updateSearch],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("saved_searches.title")}
        description={t("saved_searches.page_subtitle", {
          defaultValue:
            "Run, share, and manage saved case filters in one place.",
        })}
        actions={
          <button
            type="button"
            onClick={() => navigate("/cases")}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-surface"
          >
            <Bookmark className="h-4 w-4" />
            {t("saved_searches.manage_in_cases", {
              defaultValue: "Go to Cases to create new searches",
            })}
            <ArrowRight className="h-4 w-4" />
          </button>
        }
      />

      <SavedSearchPanel
        onExecute={handleExecuteSavedSearch}
        onEdit={handleEditSearch}
      />

      <SaveSearchModal
        open={showEditModal}
        filters={editingSearch?.filters ?? {}}
        existingNames={savedSearches.map((s) => s.name)}
        editingSearch={editingSearch}
        onSave={handleSave}
        onCancel={() => {
          setShowEditModal(false);
          setEditingSearchId(null);
        }}
      />
    </div>
  );
}
