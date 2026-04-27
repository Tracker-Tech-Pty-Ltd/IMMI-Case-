/**
 * frontend/src/pages/LlmCouncilSessionsPage.tsx
 *
 * Sessions list page for the LLM Council feature.
 *
 * Route: /llm-council/sessions
 *
 * Layout:
 *   Left sidebar (~300px)  — "Past Sessions" header + session list
 *   Right content area     — placeholder "Select a session to view it"
 *
 * Clicking a SessionListItem navigates to /llm-council/sessions/:sessionId
 * via the Link inside SessionListItem (no imperative navigate call needed).
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { SessionListItem } from "@/components/llm-council/SessionListItem";
import {
  useLlmCouncilSessions,
  useDeleteSession,
} from "@/hooks/use-llm-council-sessions";

// ---------------------------------------------------------------------------
// Sidebar skeleton while loading
// ---------------------------------------------------------------------------

function SessionsSkeleton() {
  return (
    <div
      data-testid="sessions-skeleton"
      className="flex flex-col gap-2"
      aria-busy="true"
      aria-label="Loading sessions"
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-surface"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LlmCouncilSessionsPage
// ---------------------------------------------------------------------------

export function LlmCouncilSessionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useLlmCouncilSessions();
  const deleteSession = useDeleteSession();

  const sessions = data?.sessions ?? [];

  function handleDelete(sessionId: string) {
    deleteSession.mutate(sessionId);
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
        <PageHeader
          title={t("llm_council.sessions_title", {
            defaultValue: "LLM Council Sessions",
          })}
          description={t("llm_council.sessions_subtitle", {
            defaultValue: "Browse and continue past council sessions.",
          })}
          icon={<Scale className="h-5 w-5" />}
        />
      </section>

      {/* Two-pane layout */}
      <div className="flex gap-6">
        {/* ── Sidebar ── */}
        <aside
          data-testid="sessions-sidebar"
          className="flex w-[300px] shrink-0 flex-col gap-3"
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-text">
              {t("llm_council.past_sessions_heading", {
                defaultValue: "Past Sessions",
              })}
            </h2>
            <button
              type="button"
              data-testid="new-session-btn"
              onClick={() => navigate("/llm-council")}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("llm_council.new_session_btn", {
                defaultValue: "New Council Session",
              })}
            </button>
          </div>

          {/* Session list */}
          {isLoading ? (
            <SessionsSkeleton />
          ) : isError ? (
            <p
              data-testid="sessions-error"
              className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
            >
              {t("llm_council.sessions_load_error", {
                defaultValue: "Failed to load sessions.",
              })}
            </p>
          ) : sessions.length === 0 ? (
            <p
              data-testid="sessions-empty"
              className="rounded-lg border border-border bg-card px-3 py-4 text-center text-sm text-muted-text"
            >
              {t("llm_council.no_sessions_yet", {
                defaultValue: "No past sessions yet.",
              })}
            </p>
          ) : (
            <div
              data-testid="sessions-list"
              className="flex flex-col gap-2"
            >
              {sessions.map((session) => (
                <SessionListItem
                  key={session.session_id}
                  session={session}
                  onDelete={handleDelete}
                  isDeleting={
                    deleteSession.isPending &&
                    deleteSession.variables === session.session_id
                  }
                />
              ))}
            </div>
          )}
        </aside>

        {/* ── Main content area ── */}
        <main
          data-testid="sessions-detail-placeholder"
          className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card p-10 text-sm text-muted-text shadow-sm"
        >
          <p>
            {t("llm_council.select_session_hint", {
              defaultValue: "Select a session to view it.",
            })}
          </p>
        </main>
      </div>
    </div>
  );
}
