/**
 * frontend/src/hooks/use-llm-council-sessions.ts
 *
 * TanStack Query v5 hooks for the LLM Council sessions API.
 *
 * Query key convention:
 *   ['council-sessions', params?] — list of sessions
 *   ['council-session', sessionId] — single session + turns
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createSession,
  addTurn,
  getSession,
  listSessions,
  deleteSession,
} from "@/lib/api-llm-council";
import type {
  LlmCouncilSession,
  LlmCouncilTurn,
} from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * Fetch a single session (+ its turns) by ID.
 * Disabled when sessionId is undefined or empty.
 */
export function useLlmCouncilSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["council-session", sessionId] as const,
    queryFn: () => getSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 30_000,
  });
}

/**
 * Fetch the paginated list of sessions.
 */
export function useLlmCouncilSessions(
  params?: { limit?: number; before?: string },
) {
  return useQuery({
    queryKey: ["council-sessions", params] as const,
    queryFn: () => listSessions(params),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new session (fires the first council turn).
 *
 * onSuccess:
 *   - optimistically PREPENDS the new session to every cached
 *     ['council-sessions', …] list. Hyperdrive caches list SELECTs
 *     for ~5-10s so an immediate invalidate refetches and gets a
 *     pre-create snapshot that does not contain the just-created row.
 *   - seeds ['council-session', new_session_id] cache with the response
 *   - schedules a delayed invalidate (~10s) for cross-tab reconciliation
 *     once Hyperdrive cache TTL has expired.
 */
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      message: string;
      case_id?: string;
      case_context?: string;
    }) => createSession(params),
    onSuccess: (data, variables) => {
      const nowIso = data.turn.created_at ?? new Date().toISOString();
      const newSession = {
        session_id: data.session_id,
        case_id: variables.case_id ?? null,
        title: data.turn.user_message,
        status: "active",
        total_turns: data.total_turns,
        created_at: nowIso,
        updated_at: nowIso,
      } satisfies LlmCouncilSession;

      // setQueriesData updates EXISTING entries that match the prefix.
      // setQueryData explicitly seeds/replaces the no-params entry so the
      // sessions sidebar shows the new session even when its first mount
      // is AFTER createSession (user is on /llm-council during create,
      // then navigates to /llm-council/sessions). Without this seed, the
      // first mount of useLlmCouncilSessions hits the network and gets a
      // Hyperdrive-cached pre-create snapshot.
      qc.setQueriesData<{ sessions: LlmCouncilSession[] }>(
        { queryKey: ["council-sessions"] },
        (old) => {
          if (!old?.sessions) return old;
          const without = old.sessions.filter(
            (s) => s.session_id !== newSession.session_id,
          );
          return { ...old, sessions: [newSession, ...without] };
        },
      );
      qc.setQueryData<{ sessions: LlmCouncilSession[] }>(
        ["council-sessions", undefined],
        (old) => {
          if (!old?.sessions) return { sessions: [newSession] };
          const without = old.sessions.filter(
            (s) => s.session_id !== newSession.session_id,
          );
          return { ...old, sessions: [newSession, ...without] };
        },
      );

      qc.setQueryData(["council-session", data.session_id], {
        session: newSession,
        turns: [data.turn] satisfies LlmCouncilTurn[],
      });

      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["council-sessions"] });
      }, 10_000);
    },
  });
}

/**
 * Add a follow-up turn to an existing session.
 *
 * onSuccess:
 *   - invalidates ['council-session', sessionId] so the detail re-fetches
 *   - invalidates ['council-sessions'] (updated_at changed)
 */
export function useAddTurn(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { message: string }) => addTurn(sessionId, params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["council-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["council-sessions"] });
    },
  });
}

/**
 * Delete a session by ID.
 *
 * onSuccess:
 *   - optimistically removes the deleted row from EVERY cached
 *     ['council-sessions', …] query — without an immediate invalidate.
 *     Hyperdrive caches list SELECTs for ~5-10s, so an immediate
 *     invalidate refetches and overwrites the optimistic remove with
 *     stale data that still contains the deleted row.
 *   - removes ['council-session', deletedId] from the cache
 *   - schedules a delayed invalidate (~10s) so the list eventually
 *     reconciles with server state after Hyperdrive TTL expires
 *     (catches the case where another tab created/deleted concurrently).
 */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: (_data, sessionId) => {
      qc.setQueriesData<{ sessions: { session_id: string }[] }>(
        { queryKey: ["council-sessions"] },
        (old) => {
          if (!old?.sessions) return old;
          return {
            ...old,
            sessions: old.sessions.filter(
              (s) => s.session_id !== sessionId,
            ),
          };
        },
      );
      qc.removeQueries({ queryKey: ["council-session", sessionId] });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["council-sessions"] });
      }, 10_000);
    },
  });
}
