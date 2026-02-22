import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Edit2 } from "lucide-react";
import type { CaseFilters, SavedSearch } from "@/types/case";

interface SaveSearchModalProps {
  open: boolean;
  filters: CaseFilters;
  existingNames?: string[];
  editingSearch?: SavedSearch | null;
  onSave: (name: string, filters: CaseFilters) => void;
  onCancel: () => void;
}

export function SaveSearchModal({
  open,
  filters,
  existingNames = [],
  editingSearch = null,
  onSave,
  onCancel,
}: SaveSearchModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!editingSearch;

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setName(editingSearch?.name ?? "");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, editingSearch]);

  // Handle escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();

    // Validation
    if (!trimmedName) {
      setError(t("saved_searches.error_empty_name", { defaultValue: "Search name cannot be empty" }));
      return;
    }

    if (trimmedName.length > 50) {
      setError(t("saved_searches.error_name_too_long", { defaultValue: "Name must be 50 characters or less" }));
      return;
    }

    // Check for duplicate names (excluding current search if editing)
    if (
      existingNames.includes(trimmedName) &&
      trimmedName !== editingSearch?.name
    ) {
      setError(t("saved_searches.error_duplicate_name", { defaultValue: "A search with this name already exists" }));
      return;
    }

    // Check that at least one filter is applied
    if (!isEditMode && !hasActiveFilters(filters)) {
      setError(t("saved_searches.error_no_filters", { defaultValue: "Cannot save a search with no filters applied" }));
      return;
    }

    onSave(trimmedName, filters);
  };

  if (!open) return null;

  // Generate filter summary
  const filterSummary = generateFilterSummary(filters);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-accent/10 p-2">
              {isEditMode ? (
                <Edit2 className="h-5 w-5 text-accent" />
              ) : (
                <Bookmark className="h-5 w-5 text-accent" />
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">
                {isEditMode
                  ? t("saved_searches.edit_title")
                  : t("saved_searches.save_title")}
              </h3>
              <p className="mt-1 text-sm text-muted-text">
                {isEditMode
                  ? t("saved_searches.edit_description")
                  : t("saved_searches.save_description")}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor="search-name"
              className="block text-sm font-medium text-foreground"
            >
              {t("saved_searches.search_name_label")}
            </label>
            <input
              ref={inputRef}
              id="search-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t("saved_searches.search_name_placeholder")}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {error && (
              <p className="mt-1 text-sm text-danger">{error}</p>
            )}
          </div>

          {filterSummary && (
            <div className="mt-4 rounded-md bg-surface p-3">
              <p className="text-xs font-medium text-muted-text">
                {t("saved_searches.current_filters_label")}
              </p>
              <p className="mt-1 text-sm text-foreground">{filterSummary}</p>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
            >
              {isEditMode
                ? t("common.update")
                : t("saved_searches.save_button")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Check if filters have at least one meaningful value
 */
function hasActiveFilters(filters: CaseFilters): boolean {
  return Boolean(
    filters.court ||
    filters.year ||
    filters.visa_type ||
    filters.nature ||
    filters.source ||
    filters.tag ||
    filters.keyword
  );
}

/**
 * Generate a human-readable summary of active filters
 */
function generateFilterSummary(filters: CaseFilters): string {
  const parts: string[] = [];

  if (filters.court) {
    parts.push(filters.court);
  }

  if (filters.year) {
    parts.push(`Year ${filters.year}`);
  }

  if (filters.visa_type) {
    parts.push(`Visa ${filters.visa_type}`);
  }

  if (filters.source) {
    parts.push(`Source: ${filters.source}`);
  }

  if (filters.tag) {
    parts.push(`Tag: ${filters.tag}`);
  }

  if (filters.nature) {
    parts.push(`Nature: ${filters.nature}`);
  }

  if (filters.keyword) {
    parts.push(`"${filters.keyword}"`);
  }

  if (filters.sort_by && filters.sort_by !== "date") {
    const dir = filters.sort_dir === "asc" ? "ascending" : "descending";
    parts.push(`Sorted by ${filters.sort_by} (${dir})`);
  }

  return parts.length > 0 ? parts.join(" • ") : "No filters applied"; // Intentionally not translated - used in modal context
}
