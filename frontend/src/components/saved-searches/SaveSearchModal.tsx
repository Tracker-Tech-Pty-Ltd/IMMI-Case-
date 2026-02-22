import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import type { CaseFilters } from "@/types/case";

interface SaveSearchModalProps {
  open: boolean;
  filters: CaseFilters;
  existingNames?: string[];
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function SaveSearchModal({
  open,
  filters,
  existingNames = [],
  onSave,
  onCancel,
}: SaveSearchModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

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
      setError("Search name cannot be empty");
      return;
    }

    if (trimmedName.length > 50) {
      setError("Search name must be 50 characters or less");
      return;
    }

    if (existingNames.includes(trimmedName)) {
      setError("A search with this name already exists");
      return;
    }

    onSave(trimmedName);
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
              <Bookmark className="h-5 w-5 text-accent" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">
                {t("common.save")} Search
              </h3>
              <p className="mt-1 text-sm text-muted-text">
                Save current search configuration for quick access later
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor="search-name"
              className="block text-sm font-medium text-foreground"
            >
              Search Name
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
              placeholder="e.g., FCA Visa 500 Cases"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {error && (
              <p className="mt-1 text-sm text-danger">{error}</p>
            )}
          </div>

          {filterSummary && (
            <div className="mt-4 rounded-md bg-surface p-3">
              <p className="text-xs font-medium text-muted-text">
                Current Filters:
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
              {t("common.save")} Search
            </button>
          </div>
        </form>
      </div>
    </div>
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

  return parts.length > 0 ? parts.join(" • ") : "No filters applied";
}
