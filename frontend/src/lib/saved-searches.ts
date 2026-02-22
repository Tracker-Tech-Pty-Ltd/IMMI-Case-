import type { SavedSearch, CaseFilters } from "@/types/case";

const STORAGE_KEY = "saved-searches";

/**
 * Load all saved searches from localStorage
 */
export function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save all searches to localStorage
 */
export function saveSavedSearches(searches: SavedSearch[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
}

/**
 * Add a new saved search
 */
export function addSavedSearch(
  name: string,
  filters: CaseFilters
): SavedSearch {
  const searches = loadSavedSearches();
  const newSearch: SavedSearch = {
    id: generateSearchId(),
    name: name.trim(),
    filters,
    createdAt: new Date().toISOString(),
  };
  const updated = [...searches, newSearch];
  saveSavedSearches(updated);
  return newSearch;
}

/**
 * Update an existing saved search
 */
export function updateSavedSearch(
  id: string,
  updates: Partial<Omit<SavedSearch, "id" | "createdAt">>
): SavedSearch | null {
  const searches = loadSavedSearches();
  const index = searches.findIndex((s) => s.id === id);
  if (index === -1) return null;

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
  resultCount: number
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
