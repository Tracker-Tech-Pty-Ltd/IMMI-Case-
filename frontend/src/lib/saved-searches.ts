import type { SavedSearch, CaseFilters } from "@/types/case";

const STORAGE_KEY = "saved-searches";
const MAX_SAVED_SEARCHES = 50;

/**
 * Validation error messages
 */
export const VALIDATION_ERRORS = {
  EMPTY_NAME: "Search name cannot be empty",
  DUPLICATE_NAME: "A search with this name already exists",
  LIMIT_REACHED:
    "Cannot save more than 50 searches. Delete some to create new ones.",
  NO_FILTERS: "Cannot save a search with no filters applied",
  CORRUPTED_DATA: "Saved searches data is corrupted and has been reset",
} as const;

/**
 * Validate a SavedSearch object structure
 */
function isValidSavedSearch(obj: unknown): obj is SavedSearch {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;

  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.name === "string" &&
    s.name.length > 0 &&
    typeof s.filters === "object" &&
    s.filters !== null &&
    typeof s.createdAt === "string" &&
    (s.lastExecutedAt === undefined || typeof s.lastExecutedAt === "string") &&
    (s.resultCount === undefined || typeof s.resultCount === "number")
  );
}

/**
 * Check if filters object has at least one meaningful filter
 */
function hasActiveFilters(filters: CaseFilters): boolean {
  return Boolean(
    filters.court ||
    filters.year ||
    filters.visa_type ||
    filters.nature ||
    filters.source ||
    filters.tag ||
    filters.keyword,
  );
}

/**
 * Load all saved searches from localStorage
 * Returns empty array if data is corrupted or invalid
 */
export function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      console.warn(VALIDATION_ERRORS.CORRUPTED_DATA);
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    // Filter out invalid entries and limit to MAX_SAVED_SEARCHES
    const valid = parsed
      .filter(isValidSavedSearch)
      .slice(0, MAX_SAVED_SEARCHES);

    // If we had to remove invalid entries, save the cleaned data
    if (valid.length !== parsed.length) {
      console.warn(
        `Removed ${parsed.length - valid.length} invalid saved search entries`,
      );
      saveSavedSearches(valid);
    }

    return valid;
  } catch (error) {
    console.error("Failed to load saved searches:", error);
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

/**
 * Save all searches to localStorage
 */
export function saveSavedSearches(searches: SavedSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
}

/**
 * Add a new saved search with validation
 * @throws Error if validation fails
 */
export function addSavedSearch(
  name: string,
  filters: CaseFilters,
): SavedSearch {
  const searches = loadSavedSearches();
  const trimmedName = name.trim();

  // Validate name is not empty
  if (!trimmedName) {
    throw new Error(VALIDATION_ERRORS.EMPTY_NAME);
  }

  // Validate filters are not empty
  if (!hasActiveFilters(filters)) {
    throw new Error(VALIDATION_ERRORS.NO_FILTERS);
  }

  // Check for duplicate names (case-insensitive)
  const lowerName = trimmedName.toLowerCase();
  if (searches.some((s) => s.name.toLowerCase() === lowerName)) {
    throw new Error(VALIDATION_ERRORS.DUPLICATE_NAME);
  }

  // Check limit
  if (searches.length >= MAX_SAVED_SEARCHES) {
    throw new Error(VALIDATION_ERRORS.LIMIT_REACHED);
  }

  const newSearch: SavedSearch = {
    id: generateSearchId(),
    name: trimmedName,
    filters,
    createdAt: new Date().toISOString(),
  };
  const updated = [...searches, newSearch];
  saveSavedSearches(updated);
  return newSearch;
}

/**
 * Update an existing saved search with validation
 * @throws Error if validation fails
 */
export function updateSavedSearch(
  id: string,
  updates: Partial<Omit<SavedSearch, "id" | "createdAt">>,
): SavedSearch | null {
  const searches = loadSavedSearches();
  const index = searches.findIndex((s) => s.id === id);
  if (index === -1) return null;

  // Validate name if being updated
  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName) {
      throw new Error(VALIDATION_ERRORS.EMPTY_NAME);
    }

    // Check for duplicate names (case-insensitive), excluding current search
    const lowerName = trimmedName.toLowerCase();
    if (
      searches.some((s) => s.id !== id && s.name.toLowerCase() === lowerName)
    ) {
      throw new Error(VALIDATION_ERRORS.DUPLICATE_NAME);
    }

    updates.name = trimmedName;
  }

  // Validate filters if being updated
  if (updates.filters !== undefined && !hasActiveFilters(updates.filters)) {
    throw new Error(VALIDATION_ERRORS.NO_FILTERS);
  }

  const updated = { ...searches[index], ...updates };
  searches[index] = updated;
  saveSavedSearches(searches);
  return updated;
}

/**
 * Delete a saved search by ID
 */
export function deleteSavedSearch(id: string): boolean {
  const searches = loadSavedSearches();
  const filtered = searches.filter((s) => s.id !== id);
  if (filtered.length === searches.length) return false;

  saveSavedSearches(filtered);
  return true;
}

/**
 * Get a single saved search by ID
 */
export function getSavedSearchById(id: string): SavedSearch | null {
  const searches = loadSavedSearches();
  return searches.find((s) => s.id === id) || null;
}

/**
 * Update the last executed timestamp and result count
 */
export function markSearchExecuted(
  id: string,
  resultCount: number,
): SavedSearch | null {
  return updateSavedSearch(id, {
    lastExecutedAt: new Date().toISOString(),
    resultCount,
  });
}

/**
 * Generate a unique ID for a saved search
 */
function generateSearchId(): string {
  return `search_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Encode filters to URL search params
 */
export function encodeFiltersToUrl(filters: CaseFilters): string {
  const params = new URLSearchParams();

  if (filters.court) params.set("court", filters.court);
  if (filters.year) params.set("year", String(filters.year));
  if (filters.visa_type) params.set("visa_type", filters.visa_type);
  if (filters.nature) params.set("nature", filters.nature);
  if (filters.source) params.set("source", filters.source);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.keyword) params.set("keyword", filters.keyword);
  if (filters.sort_by) params.set("sort_by", filters.sort_by);
  if (filters.sort_dir) params.set("sort_dir", filters.sort_dir);

  // Always start at page 1 for shared searches
  params.set("page", "1");

  return params.toString();
}

/**
 * Decode URL search params to filters with validation
 * Handles invalid or missing params gracefully
 */
export function decodeUrlToFilters(searchParams: URLSearchParams): CaseFilters {
  // Parse year with validation
  const yearStr = searchParams.get("year");
  let year: number | undefined;
  if (yearStr) {
    const parsed = Number(yearStr);
    // Validate year is a reasonable value (1900-2100)
    if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2100) {
      year = parsed;
    }
  }

  // Parse page with validation
  const pageStr = searchParams.get("page");
  let page = 1;
  if (pageStr) {
    const parsed = Number(pageStr);
    // Ensure page is a positive integer
    if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
      page = parsed;
    }
  }

  // Validate sort_dir
  const sortDir = searchParams.get("sort_dir");
  const validSortDir =
    sortDir === "asc" || sortDir === "desc" ? sortDir : "desc";

  const filters: CaseFilters = {
    court: searchParams.get("court") ?? "",
    year,
    visa_type: searchParams.get("visa_type") ?? "",
    nature: searchParams.get("nature") ?? "",
    source: searchParams.get("source") ?? "",
    tag: searchParams.get("tag") ?? "",
    keyword: searchParams.get("keyword") ?? "",
    sort_by: searchParams.get("sort_by") ?? "date",
    sort_dir: validSortDir,
    page,
    page_size: 100,
  };

  return filters;
}

/**
 * Generate a shareable URL for a saved search
 */
export function generateShareableUrl(filters: CaseFilters): string {
  const params = encodeFiltersToUrl(filters);
  const baseUrl = `${window.location.origin}/cases`;
  return params ? `${baseUrl}?${params}` : baseUrl;
}
