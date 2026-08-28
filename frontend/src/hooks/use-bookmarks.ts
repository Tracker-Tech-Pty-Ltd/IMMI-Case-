import { useCallback, useSyncExternalStore } from "react";
import type {
  BookmarksState,
  BookmarkEntry,
  Collection,
  CollectionColor,
} from "@/types/bookmarks";

const STORAGE_KEY = "immi-bookmarks";

// ── Read ──────────────────────────────────────────────────────────
const COLLECTION_COLORS: readonly string[] = [
  "blue",
  "green",
  "amber",
  "rose",
  "purple",
  "slate",
];

function emptyState(): BookmarksState {
  return { bookmarks: [], collections: [] };
}

/**
 * NORMALISE, do not reject.
 *
 * The claim that "the app itself can never write a bad shape" is only true of
 * the code as it stands *today* — it is unverified for every version a user's
 * browser may have run since `immi-bookmarks` was introduced, and this store is
 * the user's own curated work (bookmarked cases, hand-written notes, collection
 * ordering) with no server copy to restore from. A predicate that drops any
 * entry missing one string is a silent data-loss machine the first time an older
 * or newer field set shows up. Require only the identity field; supply defaults
 * for the rest. That is strictly safer and still produces a value that satisfies
 * the declared type.
 */
function normalizeBookmarkEntry(value: unknown): BookmarkEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (typeof b.case_id !== "string" || b.case_id.length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    case_id: b.case_id,
    case_title: str(b.case_title),
    case_citation: str(b.case_citation),
    court_code: str(b.court_code),
    date: str(b.date),
    note: str(b.note),
    bookmarked_at: str(b.bookmarked_at),
  };
}

function normalizeCollection(value: unknown): Collection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const notes: Record<string, string> = {};
  if (c.case_notes && typeof c.case_notes === "object" && !Array.isArray(c.case_notes)) {
    for (const [k, v] of Object.entries(c.case_notes as Record<string, unknown>)) {
      if (typeof v === "string") notes[k] = v;
    }
  }
  const color =
    typeof c.color === "string" && COLLECTION_COLORS.includes(c.color)
      ? (c.color as CollectionColor)
      : undefined; // an unknown colour drops to the default, it does not
                   // discard the collection and the notes inside it
  return {
    id: c.id,
    name: str(c.name),
    description: str(c.description),
    tags: strArray(c.tags),
    case_order: strArray(c.case_order),
    case_notes: notes,
    created_at: str(c.created_at),
    updated_at: str(c.updated_at),
    ...(color ? { color } : {}),
  };
}

/**
 * Read the persisted bookmark state, tolerating anything.
 *
 * The app itself can only ever write a well-formed `BookmarksState`, but the
 * value is user-writable storage: extensions, hand edits, quota-truncated
 * writes and future schema changes can all leave garbage behind. This module
 * reads at import time and every consumer dereferences `bookmarks` /
 * `collections` unconditionally, so an unvalidated parse turns one bad blob
 * into a permanent white screen. Mirrors `loadSavedSearches`
 * (`src/lib/saved-searches.ts`).
 *
 * Exported so it can be unit-tested without reloading the module graph.
 */
export const BOOKMARKS_QUARANTINE_KEY = "immi-bookmarks:unreadable";

/**
 * Move an unreadable blob aside instead of deleting it.
 *
 * `localStorage.removeItem(STORAGE_KEY)` on its own is irreversible: the user's
 * bookmarks and hand-written notes are gone with no server copy and no undo. If
 * the shape guard here turns out to be wrong about some past or future payload,
 * the quarantine copy is what lets an operator recover it — and it is one line.
 * Best effort only: storage can be full or unavailable, in which case we still
 * proceed rather than blocking startup.
 */
function quarantine(raw: string): void {
  try {
    localStorage.setItem(
      BOOKMARKS_QUARANTINE_KEY,
      JSON.stringify({ quarantined_at: new Date().toISOString(), raw }),
    );
  } catch {
    // Quota or private mode — nothing more we can do; continue.
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

export function readBookmarksFromStorage(): BookmarksState {
  if (typeof window === "undefined") return emptyState();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as { bookmarks?: unknown }).bookmarks) ||
      !Array.isArray((parsed as { collections?: unknown }).collections)
    ) {
      quarantine(raw);
      return emptyState();
    }

    const candidate = parsed as {
      bookmarks: unknown[];
      collections: unknown[];
    };
    return {
      bookmarks: candidate.bookmarks
        .map(normalizeBookmarkEntry)
        .filter((b): b is BookmarkEntry => b !== null),
      collections: candidate.collections
        .map(normalizeCollection)
        .filter((c): c is Collection => c !== null),
    };
  } catch {
    if (raw !== null) quarantine(raw);
    return emptyState();
  }
}

// ── External Store ────────────────────────────────────────────────
let _state: BookmarksState = readBookmarksFromStorage();
const _listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function getSnapshot(): BookmarksState {
  return _state;
}

function setState(next: BookmarksState): void {
  _state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
  _listeners.forEach((fn) => fn());
}

// ── Mutations (module-level, referentially stable) ─────────────────
export function addBookmark(
  entry: Omit<BookmarkEntry, "bookmarked_at" | "note">,
): void {
  const cur = getSnapshot();
  if (cur.bookmarks.some((b) => b.case_id === entry.case_id)) return;
  setState({
    ...cur,
    bookmarks: [
      { ...entry, note: "", bookmarked_at: new Date().toISOString() },
      ...cur.bookmarks,
    ],
  });
}

export function removeBookmark(case_id: string): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    bookmarks: cur.bookmarks.filter((b) => b.case_id !== case_id),
    collections: cur.collections.map((col) => ({
      ...col,
      case_order: col.case_order.filter((id) => id !== case_id),
    })),
  });
}

export function updateBookmarkNote(case_id: string, note: string): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    bookmarks: cur.bookmarks.map((b) =>
      b.case_id === case_id ? { ...b, note } : b,
    ),
  });
}

export function createCollection(
  name: string,
  description = "",
  color?: CollectionColor,
): Collection {
  const col: Collection = {
    id: crypto.randomUUID(),
    name,
    description,
    tags: [],
    case_order: [],
    case_notes: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    color,
  };
  const cur = getSnapshot();
  setState({ ...cur, collections: [...cur.collections, col] });
  return col;
}

export function updateCollection(
  id: string,
  patch: Partial<Omit<Collection, "id" | "created_at">>,
): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.map((col) =>
      col.id === id
        ? { ...col, ...patch, updated_at: new Date().toISOString() }
        : col,
    ),
  });
}

export function deleteCollection(id: string): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.filter((c) => c.id !== id),
  });
}

export function addCaseToCollection(
  collection_id: string,
  case_id: string,
): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.map((col) => {
      if (col.id !== collection_id || col.case_order.includes(case_id))
        return col;
      return {
        ...col,
        case_order: [...col.case_order, case_id],
        updated_at: new Date().toISOString(),
      };
    }),
  });
}

export function removeCaseFromCollection(
  collection_id: string,
  case_id: string,
): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.map((col) => {
      if (col.id !== collection_id) return col;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [case_id]: _removed, ...restNotes } = col.case_notes;
      return {
        ...col,
        case_order: col.case_order.filter((id) => id !== case_id),
        case_notes: restNotes,
        updated_at: new Date().toISOString(),
      };
    }),
  });
}

export function reorderCollection(
  collection_id: string,
  newOrder: string[],
): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.map((col) =>
      col.id === collection_id
        ? { ...col, case_order: newOrder, updated_at: new Date().toISOString() }
        : col,
    ),
  });
}

export function setCollectionCaseNote(
  collection_id: string,
  case_id: string,
  note: string,
): void {
  const cur = getSnapshot();
  setState({
    ...cur,
    collections: cur.collections.map((col) =>
      col.id === collection_id
        ? {
            ...col,
            case_notes: { ...col.case_notes, [case_id]: note },
            updated_at: new Date().toISOString(),
          }
        : col,
    ),
  });
}

// ── Hook ──────────────────────────────────────────────────────────
export function useBookmarks() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isBookmarked = useCallback(
    (case_id: string) => state.bookmarks.some((b) => b.case_id === case_id),
    [state.bookmarks],
  );

  return {
    bookmarks: state.bookmarks,
    collections: state.collections,
    recentBookmarks: state.bookmarks.slice(0, 5),
    isBookmarked,
    addBookmark,
    removeBookmark,
    updateBookmarkNote,
    createCollection,
    updateCollection,
    deleteCollection,
    addCaseToCollection,
    removeCaseFromCollection,
    reorderCollection,
    setCollectionCaseNote,
  } as const;
}
