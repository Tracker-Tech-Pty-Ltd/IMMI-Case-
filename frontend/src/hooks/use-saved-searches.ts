import { useCallback, useSyncExternalStore } from "react";
import type { SavedSearch, CaseFilters } from "@/types/case";
import {
  loadSavedSearches,
  saveSavedSearches,
  addSavedSearch as addSearchToStorage,
  updateSavedSearch as updateSearchInStorage,
  deleteSavedSearch as deleteSearchFromStorage,
  markSearchExecuted as markExecutedInStorage,
  getSavedSearchById,
} from "@/lib/saved-searches";

// Custom event for cross-tab synchronization
const SAVED_SEARCHES_CHANGE_EVENT = "saved-searches-change";

// Notify all subscribers of changes
function notifySubscribers() {
  window.dispatchEvent(new Event(SAVED_SEARCHES_CHANGE_EVENT));
}

// Subscribe to localStorage changes (both same-tab and cross-tab)
function subscribe(callback: () => void) {
  // Listen for same-tab changes
  window.addEventListener(SAVED_SEARCHES_CHANGE_EVENT, callback);
  // Listen for cross-tab storage changes
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(SAVED_SEARCHES_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// Get current snapshot of saved searches
function getSnapshot(): SavedSearch[] {
  return loadSavedSearches();
}

// Server snapshot (for SSR compatibility)
function getServerSnapshot(): SavedSearch[] {
  return [];
}

/**
 * React hook for managing saved searches with localStorage persistence
 *
 * Provides reactive access to saved searches with automatic synchronization
 * across browser tabs using useSyncExternalStore.
 *
 * @example
 * ```tsx
 * const {
 *   savedSearches,
 *   saveSearch,
 *   updateSearch,
 *   deleteSearch,
 *   executeSearch,
 *   getSearchById,
 * } = useSavedSearches();
 *
 * // Save current filters
 * saveSearch("FCA 2020-2025", currentFilters);
 *
 * // Execute a saved search
 * executeSearch(searchId, (filters) => applyFilters(filters));
 * ```
 */
export function useSavedSearches() {
  // Subscribe to localStorage changes
  const savedSearches = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  /**
   * Save a new search with the given name and filters
   * @throws Error if name is empty, duplicate, limit reached, or no filters applied
   */
  const saveSearch = useCallback((name: string, filters: CaseFilters): SavedSearch => {
    const search = addSearchToStorage(name, filters);
    notifySubscribers();
    return search;
  }, []);

  /**
   * Update an existing saved search
   * @throws Error if name is empty, duplicate, or filters are invalid
   */
  const updateSearch = useCallback(
    (
      id: string,
      updates: Partial<Omit<SavedSearch, "id" | "createdAt">>
    ): SavedSearch | null => {
      const updated = updateSearchInStorage(id, updates);
      if (updated) {
        notifySubscribers();
      }
      return updated;
    },
    []
  );

  /**
   * Delete a saved search by ID
   */
  const deleteSearch = useCallback((id: string): boolean => {
    const deleted = deleteSearchFromStorage(id);
    if (deleted) {
      notifySubscribers();
    }
    return deleted;
  }, []);

  /**
   * Execute a saved search by applying its filters
   * @param id - The saved search ID
   * @param onExecute - Callback to apply the filters
   * @param resultCount - Optional result count to track
   */
  const executeSearch = useCallback(
    (
      id: string,
      onExecute: (filters: CaseFilters) => void,
      resultCount?: number
    ): void => {
      const search = getSavedSearchById(id);
      if (!search) return;

      // Apply the filters
      onExecute(search.filters);

      // Update last executed timestamp and result count
      if (resultCount !== undefined) {
        markExecutedInStorage(id, resultCount);
        notifySubscribers();
      }
    },
    []
  );

  /**
   * Get a saved search by ID
   */
  const getSearchById = useCallback((id: string): SavedSearch | null => {
    return getSavedSearchById(id);
  }, []);

  /**
   * Rename a saved search
   * @throws Error if name is empty or duplicate
   */
  const renameSearch = useCallback((id: string, newName: string): SavedSearch | null => {
    return updateSearch(id, { name: newName.trim() });
  }, [updateSearch]);

  /**
   * Check if a search name already exists
   */
  const searchNameExists = useCallback(
    (name: string, excludeId?: string): boolean => {
      const trimmedName = name.trim().toLowerCase();
      return savedSearches.some(
        (s) => s.name.toLowerCase() === trimmedName && s.id !== excludeId
      );
    },
    [savedSearches]
  );

  /**
   * Get the count of saved searches
   */
  const count = savedSearches.length;

  /**
   * Check if the 50 search limit has been reached
   */
  const limitReached = count >= 50;

  /**
   * Clear all saved searches (use with caution)
   */
  const clearAll = useCallback((): void => {
    saveSavedSearches([]);
    notifySubscribers();
  }, []);

  return {
    savedSearches,
    saveSearch,
    updateSearch,
    deleteSearch,
    executeSearch,
    getSearchById,
    renameSearch,
    searchNameExists,
    count,
    limitReached,
    clearAll,
  };
}
