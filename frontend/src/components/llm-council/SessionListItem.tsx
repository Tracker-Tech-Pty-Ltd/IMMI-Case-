/**
 * frontend/src/components/llm-council/SessionListItem.tsx
 *
 * Single session card for the sessions sidebar list.
 * Uses Link for accessible navigation.
 * Delete button appears on hover, triggers ConfirmModal.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import type { LlmCouncilSessionListItem } from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Relative-time helper (no date-fns dep required)
// ---------------------------------------------------------------------------

export function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionListItemProps {
  session: LlmCouncilSessionListItem;
  /** Called after the user confirms deletion (mutation is caller's responsibility). */
  onDelete: (sessionId: string) => void;
  isDeleting?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionListItem({
  session,
  onDelete,
  isDeleting = false,
}: SessionListItemProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    onDelete(session.session_id);
  }

  const truncatedTitle =
    session.title.length > 50
      ? session.title.slice(0, 50) + "…"
      : session.title;

  return (
    <>
      <Link
        to={`/llm-council/sessions/${session.session_id}`}
        data-testid="session-list-item"
        className="group relative flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-3 text-left text-sm transition-colors hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* Title */}
        <span
          className="line-clamp-2 font-medium text-foreground"
          title={session.title}
        >
          {truncatedTitle}
        </span>

        {/* Meta row: turns badge + relative time */}
        <div className="flex items-center gap-2 text-xs text-muted-text">
          <span
            data-testid="session-turns-badge"
            className="rounded-full bg-surface px-2 py-0.5 font-semibold text-foreground"
          >
            {session.total_turns}{" "}
            {session.total_turns === 1 ? "turn" : "turns"}
          </span>
          <span data-testid="session-relative-time">
            {relativeTime(session.updated_at)}
          </span>
        </div>

        {/* Delete button — hover-only */}
        <button
          type="button"
          aria-label="Delete session"
          data-testid="session-delete-btn"
          disabled={isDeleting}
          onClick={handleDeleteClick}
          className="absolute right-2 top-2 rounded p-1 text-muted-text opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Link>

      <ConfirmModal
        open={confirmOpen}
        variant="danger"
        title="Delete session"
        message={`Delete "${truncatedTitle}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
