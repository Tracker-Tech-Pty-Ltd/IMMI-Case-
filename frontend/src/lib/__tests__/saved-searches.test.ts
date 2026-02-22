import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadSavedSearches,
  addSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getSavedSearchById,
  decodeUrlToFilters,
  VALIDATION_ERRORS,
} from "../saved-searches";
import type { CaseFilters, SavedSearch } from "@/types/case";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("saved-searches edge cases", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("loadSavedSearches - corrupted data handling", () => {
    it("returns empty array for corrupted JSON", () => {
      localStorageMock.setItem("saved-searches", "invalid json{{{");
      const result = loadSavedSearches();
      expect(result).toEqual([]);
    });

    it("returns empty array for non-array data", () => {
      localStorageMock.setItem("saved-searches", JSON.stringify({ foo: "bar" }));
      const result = loadSavedSearches();
      expect(result).toEqual([]);
    });

    it("filters out invalid entries", () => {
      const data = [
        {
          id: "valid-1",
          name: "Valid Search",
          filters: { court: "FCA" },
          createdAt: "2024-01-01",
        },
        { id: "", name: "Invalid - no ID" }, // Invalid
        { id: "no-name", filters: {} }, // Invalid - no name
        null, // Invalid
        "string", // Invalid
        {
          id: "valid-2",
          name: "Another Valid",
          filters: { year: 2020 },
          createdAt: "2024-01-02",
        },
      ];
      localStorageMock.setItem("saved-searches", JSON.stringify(data));
      const result = loadSavedSearches();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("valid-1");
      expect(result[1].id).toBe("valid-2");
    });

    it("limits to 50 searches even if more are stored", () => {
      const data = Array.from({ length: 60 }, (_, i) => ({
        id: `search-${i}`,
        name: `Search ${i}`,
        filters: { court: "FCA" },
        createdAt: new Date().toISOString(),
      }));
      localStorageMock.setItem("saved-searches", JSON.stringify(data));
      const result = loadSavedSearches();
      expect(result).toHaveLength(50);
    });
  });

  describe("addSavedSearch - validation", () => {
    const validFilters: CaseFilters = { court: "FCA", year: 2020 };

    it("throws error for empty name", () => {
      expect(() => addSavedSearch("", validFilters)).toThrow(
        VALIDATION_ERRORS.EMPTY_NAME
      );
      expect(() => addSavedSearch("   ", validFilters)).toThrow(
        VALIDATION_ERRORS.EMPTY_NAME
      );
    });

    it("throws error for duplicate name (case-insensitive)", () => {
      addSavedSearch("Test Search", validFilters);
      expect(() => addSavedSearch("Test Search", validFilters)).toThrow(
        VALIDATION_ERRORS.DUPLICATE_NAME
      );
      expect(() => addSavedSearch("test search", validFilters)).toThrow(
        VALIDATION_ERRORS.DUPLICATE_NAME
      );
      expect(() => addSavedSearch("TEST SEARCH", validFilters)).toThrow(
        VALIDATION_ERRORS.DUPLICATE_NAME
      );
    });

    it("throws error when limit (50) is reached", () => {
      // Add 50 searches
      for (let i = 0; i < 50; i++) {
        addSavedSearch(`Search ${i}`, validFilters);
      }
      expect(() => addSavedSearch("Search 51", validFilters)).toThrow(
        VALIDATION_ERRORS.LIMIT_REACHED
      );
    });

    it("throws error for no active filters", () => {
      expect(() => addSavedSearch("Empty Search", {})).toThrow(
        VALIDATION_ERRORS.NO_FILTERS
      );
      expect(() =>
        addSavedSearch("Empty Search", { sort_by: "date", sort_dir: "desc" })
      ).toThrow(VALIDATION_ERRORS.NO_FILTERS);
    });

    it("trims whitespace from name", () => {
      const search = addSavedSearch("  Test Search  ", validFilters);
      expect(search.name).toBe("Test Search");
    });

    it("successfully saves with at least one filter", () => {
      const cases = [
        { court: "FCA" },
        { year: 2020 },
        { visa_type: "820" },
        { nature: "Appeal" },
        { source: "AustLII" },
        { tag: "important" },
        { keyword: "refugee" },
      ];

      cases.forEach((filters, i) => {
        const search = addSavedSearch(`Search ${i}`, filters);
        expect(search).toBeDefined();
        expect(search.id).toBeDefined();
        expect(search.createdAt).toBeDefined();
      });
    });
  });

  describe("updateSavedSearch - validation", () => {
    let searchId: string;

    beforeEach(() => {
      const search = addSavedSearch("Original", { court: "FCA" });
      searchId = search.id;
    });

    it("throws error for empty name", () => {
      expect(() => updateSavedSearch(searchId, { name: "" })).toThrow(
        VALIDATION_ERRORS.EMPTY_NAME
      );
      expect(() => updateSavedSearch(searchId, { name: "   " })).toThrow(
        VALIDATION_ERRORS.EMPTY_NAME
      );
    });

    it("throws error for duplicate name (case-insensitive)", () => {
      addSavedSearch("Other Search", { court: "AATA" });
      expect(() => updateSavedSearch(searchId, { name: "Other Search" })).toThrow(
        VALIDATION_ERRORS.DUPLICATE_NAME
      );
      expect(() => updateSavedSearch(searchId, { name: "other search" })).toThrow(
        VALIDATION_ERRORS.DUPLICATE_NAME
      );
    });

    it("allows updating to same name (case change)", () => {
      const updated = updateSavedSearch(searchId, { name: "ORIGINAL" });
      expect(updated).toBeDefined();
      expect(updated?.name).toBe("ORIGINAL");
    });

    it("throws error for empty filters", () => {
      expect(() => updateSavedSearch(searchId, { filters: {} })).toThrow(
        VALIDATION_ERRORS.NO_FILTERS
      );
    });

    it("trims whitespace from name", () => {
      const updated = updateSavedSearch(searchId, { name: "  Updated Name  " });
      expect(updated?.name).toBe("Updated Name");
    });

    it("returns null for non-existent search", () => {
      const updated = updateSavedSearch("non-existent", { name: "Test" });
      expect(updated).toBeNull();
    });
  });

  describe("decodeUrlToFilters - invalid params", () => {
    it("handles invalid year gracefully", () => {
      const params = new URLSearchParams();
      params.set("year", "invalid");
      const filters = decodeUrlToFilters(params);
      expect(filters.year).toBeUndefined();
    });

    it("handles year out of range", () => {
      const params1 = new URLSearchParams();
      params1.set("year", "1800");
      const filters1 = decodeUrlToFilters(params1);
      expect(filters1.year).toBeUndefined();

      const params2 = new URLSearchParams();
      params2.set("year", "2200");
      const filters2 = decodeUrlToFilters(params2);
      expect(filters2.year).toBeUndefined();
    });

    it("handles valid year", () => {
      const params = new URLSearchParams();
      params.set("year", "2020");
      const filters = decodeUrlToFilters(params);
      expect(filters.year).toBe(2020);
    });

    it("handles invalid page gracefully", () => {
      const params = new URLSearchParams();
      params.set("page", "invalid");
      const filters = decodeUrlToFilters(params);
      expect(filters.page).toBe(1);
    });

    it("handles negative page", () => {
      const params = new URLSearchParams();
      params.set("page", "-5");
      const filters = decodeUrlToFilters(params);
      expect(filters.page).toBe(1);
    });

    it("handles zero page", () => {
      const params = new URLSearchParams();
      params.set("page", "0");
      const filters = decodeUrlToFilters(params);
      expect(filters.page).toBe(1);
    });

    it("handles decimal page", () => {
      const params = new URLSearchParams();
      params.set("page", "2.5");
      const filters = decodeUrlToFilters(params);
      expect(filters.page).toBe(1);
    });

    it("handles invalid sort_dir", () => {
      const params = new URLSearchParams();
      params.set("sort_dir", "invalid");
      const filters = decodeUrlToFilters(params);
      expect(filters.sort_dir).toBe("desc");
    });

    it("handles missing params gracefully", () => {
      const params = new URLSearchParams();
      const filters = decodeUrlToFilters(params);
      expect(filters).toEqual({
        court: "",
        year: undefined,
        visa_type: "",
        nature: "",
        source: "",
        tag: "",
        keyword: "",
        sort_by: "date",
        sort_dir: "desc",
        page: 1,
        page_size: 100,
      });
    });

    it("handles valid params correctly", () => {
      const params = new URLSearchParams();
      params.set("court", "FCA");
      params.set("year", "2020");
      params.set("visa_type", "820");
      params.set("keyword", "refugee");
      params.set("sort_by", "court");
      params.set("sort_dir", "asc");
      params.set("page", "3");

      const filters = decodeUrlToFilters(params);
      expect(filters).toEqual({
        court: "FCA",
        year: 2020,
        visa_type: "820",
        nature: "",
        source: "",
        tag: "",
        keyword: "refugee",
        sort_by: "court",
        sort_dir: "asc",
        page: 3,
        page_size: 100,
      });
    });
  });

  describe("deleteSavedSearch", () => {
    it("returns false for non-existent search", () => {
      const result = deleteSavedSearch("non-existent");
      expect(result).toBe(false);
    });

    it("successfully deletes existing search", () => {
      const search = addSavedSearch("To Delete", { court: "FCA" });
      const result = deleteSavedSearch(search.id);
      expect(result).toBe(true);
      expect(getSavedSearchById(search.id)).toBeNull();
    });
  });
});
