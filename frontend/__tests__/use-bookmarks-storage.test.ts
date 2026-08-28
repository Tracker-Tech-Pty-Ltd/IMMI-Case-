/**
 * frontend/__tests__/use-bookmarks-storage.test.ts
 *
 * `immi-bookmarks` is user-writable storage read at module-import time and
 * dereferenced unconditionally by every consumer, so a malformed blob must
 * degrade to an empty bookmark list rather than crash the app.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOKMARKS_QUARANTINE_KEY,
  readBookmarksFromStorage,
} from "@/hooks/use-bookmarks";
import type { BookmarkEntry, Collection } from "@/types/bookmarks";

const STORAGE_KEY = "immi-bookmarks";

const VALID_BOOKMARK: BookmarkEntry = {
  case_id: "a1b2c3d4e5f6",
  case_title: "Applicant v Minister for Immigration",
  case_citation: "[2024] FCA 123",
  court_code: "FCA",
  date: "2024-03-11",
  note: "",
  bookmarked_at: "2026-08-01T00:00:00.000Z",
};

const VALID_COLLECTION: Collection = {
  id: "col-1",
  name: "Protection visa refusals",
  description: "",
  tags: [],
  case_order: ["a1b2c3d4e5f6"],
  case_notes: { a1b2c3d4e5f6: "leading case" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  color: "amber",
};

function seed(raw: string): void {
  window.localStorage.setItem(STORAGE_KEY, raw);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("readBookmarksFromStorage", () => {
  it("returns the empty state when nothing is stored", () => {
    expect(readBookmarksFromStorage()).toEqual({
      bookmarks: [],
      collections: [],
    });
  });

  it("round-trips a well-formed payload unchanged", () => {
    seed(
      JSON.stringify({
        bookmarks: [VALID_BOOKMARK],
        collections: [VALID_COLLECTION],
      }),
    );
    expect(readBookmarksFromStorage()).toEqual({
      bookmarks: [VALID_BOOKMARK],
      collections: [VALID_COLLECTION],
    });
  });

  it.each([
    ["invalid JSON", "not json at all"],
    ["a truncated write", '{"bookmarks":[{"case_id":"a"'],
    ["a JSON null", "null"],
    ["a bare array", "[]"],
    ["a bare number", "42"],
    ["a bare string", '"text"'],
    ["a missing collections key", '{"bookmarks":[]}'],
    ["a missing bookmarks key", '{"collections":[]}'],
    ["non-array bookmarks", '{"bookmarks":{},"collections":[]}'],
  ])(
    "returns the empty state and quarantines rather than deletes for %s",
    (_label, raw) => {
      seed(raw);
      expect(readBookmarksFromStorage()).toEqual({
        bookmarks: [],
        collections: [],
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      // The blob must be recoverable, not gone.
      const quarantined = window.localStorage.getItem(
        BOOKMARKS_QUARANTINE_KEY,
      );
      expect(quarantined).not.toBeNull();
      expect(JSON.parse(quarantined as string).raw).toBe(raw);
    },
  );

  it("keeps entries whose identity is intact and defaults the rest", () => {
    // A legacy payload: identity present, later-added fields absent. Older
    // builds of this app are NOT proven to have written today's exact field
    // set, and this store has no server copy — so a missing string must not
    // cost the user a bookmark.
    seed(
      JSON.stringify({
        bookmarks: [
          VALID_BOOKMARK,
          { case_id: "legacy00001", case_title: "Older entry" },
          { case_id: 123 },
          null,
          "nope",
        ],
        collections: [
          VALID_COLLECTION,
          { id: "legacy-col", name: "Older collection" },
          { name: "no id at all" },
        ],
      }),
    );
    const state = readBookmarksFromStorage();
    expect(state.bookmarks).toEqual([
      VALID_BOOKMARK,
      {
        case_id: "legacy00001",
        case_title: "Older entry",
        case_citation: "",
        court_code: "",
        date: "",
        note: "",
        bookmarked_at: "",
      },
    ]);
    expect(state.collections).toEqual([
      VALID_COLLECTION,
      {
        id: "legacy-col",
        name: "Older collection",
        description: "",
        tags: [],
        case_order: [],
        case_notes: {},
        created_at: "",
        updated_at: "",
      },
    ]);
  });

  it("drops only the members it cannot type, not the whole record", () => {
    seed(
      JSON.stringify({
        bookmarks: [],
        collections: [
          { ...VALID_COLLECTION, case_order: ["ok", 1, 2], tags: ["a", 5] },
        ],
      }),
    );
    const [col] = readBookmarksFromStorage().collections;
    expect(col.case_order).toEqual(["ok"]);
    expect(col.tags).toEqual(["a"]);
    expect(col.id).toBe(VALID_COLLECTION.id);
  });

  it("drops an unknown colour but keeps the collection and its notes", () => {
    seed(
      JSON.stringify({
        bookmarks: [],
        collections: [{ ...VALID_COLLECTION, color: "chartreuse" }],
      }),
    );
    const [col] = readBookmarksFromStorage().collections;
    expect(col).toBeDefined();
    expect(col.color).toBeUndefined();
    expect(col.case_notes).toEqual(VALID_COLLECTION.case_notes);
  });
});
