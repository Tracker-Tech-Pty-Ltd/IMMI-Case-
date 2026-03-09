import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BookmarkCheck, Bookmark, Plus } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { CollectionCard } from "@/components/collections/CollectionCard";
import { CollectionEditor } from "@/components/collections/CollectionEditor";
import {
  useBookmarks,
  createCollection,
  updateCollection,
} from "@/hooks/use-bookmarks";
import { toast } from "sonner";
import type { CollectionColor } from "@/types/bookmarks";

export function CollectionsPage() {
  const { t } = useTranslation();
  const { bookmarks, collections } = useBookmarks();
  const [editorOpen, setEditorOpen] = useState(false);

  function handleCreate(
    name: string,
    description: string,
    tags: string[],
    color?: CollectionColor,
  ) {
    const col = createCollection(name, description, color);
    if (tags.length > 0) {
      updateCollection(col.id, { tags });
    }
    setEditorOpen(false);
    toast.success(t("bookmarks.collection_created", "Collection created"));
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[{ label: t("bookmarks.collections", "Collections") }]}
      />

      <PageHeader
        title={t("bookmarks.collections", "Collections")}
        description={t(
          "bookmarks.collections_subtitle",
          "Organise cases into named collections",
        )}
        icon={<BookmarkCheck className="h-5 w-5" />}
        meta={
          <>
            <span>
              {bookmarks.length} {t("units.cases", "cases")}
            </span>
            <span>
              {collections.length} {t("bookmarks.collections", "collections")}
            </span>
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            {t("bookmarks.new_collection", "New Collection")}
          </button>
        }
      />

      {/* Stats */}
      <div className="flex gap-4">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2">
          <Bookmark className="h-4 w-4 text-accent" />
          <span className="text-sm text-foreground">
            <span className="font-semibold">{bookmarks.length}</span>{" "}
            {t("units.cases", "cases")}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2">
          <BookmarkCheck className="h-4 w-4 text-accent" />
          <span className="text-sm text-foreground">
            <span className="font-semibold">{collections.length}</span>{" "}
            {t("bookmarks.collections", "collections")}
          </span>
        </div>
      </div>

      {/* Collections grid */}
      {collections.length === 0 ? (
        <EmptyState
          icon={<BookmarkCheck className="h-8 w-8" />}
          title={t("bookmarks.no_collections", "No collections yet")}
          description={t(
            "bookmarks.no_collections_description",
            "Create a collection to organise your bookmarked cases.",
          )}
          action={
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <Plus className="h-4 w-4" />
              {t("bookmarks.new_collection", "New Collection")}
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map((col) => (
            <CollectionCard key={col.id} collection={col} />
          ))}
        </div>
      )}

      {/* Bookmarks section — quick overview */}
      {bookmarks.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">
            {t("bookmarks.recent", "Recent Bookmarks")}
          </h2>
          <div className="space-y-2">
            {bookmarks.slice(0, 10).map((b) => (
              <div key={b.case_id} className="flex items-center gap-2 text-sm">
                <Bookmark className="h-3 w-3 shrink-0 text-accent" />
                <Link
                  to={`/cases/${b.case_id}`}
                  className="truncate text-foreground hover:text-accent"
                >
                  {b.case_citation || b.case_title}
                </Link>
                {b.date && (
                  <span className="shrink-0 text-xs text-muted-text">
                    {b.date}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor modal */}
      <CollectionEditor
        open={editorOpen}
        onSave={handleCreate}
        onCancel={() => setEditorOpen(false)}
      />
    </div>
  );
}
