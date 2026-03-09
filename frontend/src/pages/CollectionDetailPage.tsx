import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Download, Edit, Trash2, BookmarkCheck } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { CollectionEditor } from "@/components/collections/CollectionEditor";
import { SortableCaseItem } from "@/components/collections/SortableCaseItem";
import {
  useBookmarks,
  updateCollection,
  deleteCollection,
  reorderCollection,
  removeCaseFromCollection,
  setCollectionCaseNote,
} from "@/hooks/use-bookmarks";
import { exportCollection } from "@/lib/api";
import type { CollectionColor } from "@/types/bookmarks";

export function CollectionDetailPage() {
  const { t } = useTranslation();
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { collections, bookmarks } = useBookmarks();

  const collection = collections.find((c) => c.id === collectionId);

  const [localOrder, setLocalOrder] = useState<string[]>(
    collection?.case_order ?? [],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Sync localOrder when external store changes
  useEffect(() => {
    setLocalOrder(collection?.case_order ?? []);
  }, [collection?.case_order]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !collectionId) return;

      const oldIdx = localOrder.indexOf(String(active.id));
      const newIdx = localOrder.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return;

      const newOrder = arrayMove(localOrder, oldIdx, newIdx);
      setLocalOrder(newOrder);
      reorderCollection(collectionId, newOrder);
    },
    [localOrder, collectionId],
  );

  async function handleExport() {
    if (!collection || !collectionId) return;
    setExporting(true);
    try {
      const html = await exportCollection({
        collection_id: collectionId,
        collection_name: collection.name,
        case_ids: collection.case_order,
        case_notes: collection.case_notes,
      });
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${collection.name.replace(/[^a-z0-9]/gi, "_")}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("bookmarks.export_success", "Report downloaded"));
    } catch (err) {
      toast.error(t("bookmarks.export_failed", "Export failed"));
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  function handleEdit(
    name: string,
    description: string,
    tags: string[],
    color?: CollectionColor,
  ) {
    if (!collectionId) return;
    updateCollection(collectionId, { name, description, tags, color });
    setEditorOpen(false);
    toast.success(t("bookmarks.collection_updated", "Collection updated"));
  }

  function handleDelete() {
    if (!collectionId) return;
    deleteCollection(collectionId);
    toast.success(t("bookmarks.collection_deleted", "Collection deleted"));
    navigate("/collections");
  }

  if (!collection) {
    return (
      <div className="space-y-4">
        <Breadcrumb
          items={[
            {
              label: t("bookmarks.collections", "Collections"),
              href: "/collections",
            },
            { label: t("common.not_found", "Not Found") },
          ]}
        />
        <EmptyState
          icon={<BookmarkCheck className="h-8 w-8" />}
          title={t("common.not_found", "Not Found")}
          description={t(
            "bookmarks.collection_not_found_description",
            "This collection could not be found. It may have been deleted or renamed.",
          )}
          action={
            <button
              type="button"
              onClick={() => navigate("/collections")}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              {t("bookmarks.collections", "Collections")}
            </button>
          }
        />
      </div>
    );
  }

  // Build ordered bookmarks
  const bookmarkMap = new Map(bookmarks.map((b) => [b.case_id, b]));
  const orderedBookmarks = localOrder
    .map((id) => bookmarkMap.get(id))
    .filter(Boolean) as (typeof bookmarks)[number][];

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          {
            label: t("bookmarks.collections", "Collections"),
            href: "/collections",
          },
          { label: collection.name },
        ]}
      />

      <div className="rounded-lg border border-border bg-card p-5">
        <PageHeader
          title={collection.name}
          description={collection.description}
          icon={<BookmarkCheck className="h-5 w-5" />}
          meta={
            <span>
              {orderedBookmarks.length === 1
                ? t("bookmarks.cases_count_one", "1 case")
                : t("bookmarks.cases_count_other", "{{count}} cases", {
                    count: orderedBookmarks.length,
                  })}
            </span>
          }
          actions={
            <>
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting || collection.case_order.length === 0}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting
                  ? t("common.loading_ellipsis", "Loading...")
                  : t("bookmarks.export_html", "Export as HTML")}
              </button>
              <button
                type="button"
                onClick={() => setEditorOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface"
              >
                <Edit className="h-3.5 w-3.5" />
                {t("common.edit", "Edit")}
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-danger/30 px-3 py-1.5 text-sm text-danger hover:bg-danger/5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common.delete", "Delete")}
              </button>
            </>
          }
        />
        {collection.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {collection.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-muted-text"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sortable case list */}
      {orderedBookmarks.length === 0 ? (
        <EmptyState
          icon={<BookmarkCheck className="h-8 w-8" />}
          title={t(
            "bookmarks.collection_detail_empty",
            "No cases in this collection yet.",
          )}
          description={t(
            "bookmarks.collection_detail_empty_desc",
            "Add cases from the case list or detail view.",
          )}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={localOrder}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {orderedBookmarks.map((bookmark) => (
                <SortableCaseItem
                  key={bookmark.case_id}
                  bookmark={bookmark}
                  note={collection.case_notes[bookmark.case_id] ?? ""}
                  onNoteChange={(note) =>
                    collectionId &&
                    setCollectionCaseNote(collectionId, bookmark.case_id, note)
                  }
                  onRemove={() =>
                    collectionId &&
                    removeCaseFromCollection(collectionId, bookmark.case_id)
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Editor modal */}
      <CollectionEditor
        open={editorOpen}
        collection={collection}
        onSave={handleEdit}
        onCancel={() => setEditorOpen(false)}
      />

      {/* Delete confirmation */}
      <ConfirmModal
        open={deleteOpen}
        title={t("bookmarks.confirm_delete_collection", "Delete this collection?")}
        message={t(
          "bookmarks.confirm_delete_collection_message",
          'This will delete "{{name}}". Bookmarked cases will not be affected.',
          { name: collection.name },
        )}
        confirmLabel={t("common.delete", "Delete")}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
