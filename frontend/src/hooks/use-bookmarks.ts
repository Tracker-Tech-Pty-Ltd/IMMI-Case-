import { useCallback, useSyncExternalStore } from "react";
import type {
  BookmarksState,
  BookmarkEntry,
  Collection,
  CollectionColor,
} from "@/types/bookmarks";

const STORAGE_KEY = "immi-bookmarks";

// ── Read ──────────────────────────────────────────────────────────
function readFromStorage(): BookmarksState {
  if (typeof window === "undefined") return { bookmarks: [], collections: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { bookmarks: [], collections: [] };
  } catch {
    return { bookmarks: [], collections: [] };
  }
}

// ── External Store ────────────────────────────────────────────────
let _state: BookmarksState = readFromStorage();
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
