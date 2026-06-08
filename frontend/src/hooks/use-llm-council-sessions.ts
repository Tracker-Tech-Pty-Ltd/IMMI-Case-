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
 *   - seeds ['council-session', new_session_id] cache with the response
 *   - invalidates ['council-sessions']; the Worker list endpoint uses the
 *     fresh Hyperdrive binding when available, so immediate refetch is safe.
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
        retrieve_code: data.retrieve_code ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      } satisfies LlmCouncilSession;

      qc.setQueryData(["council-session", data.session_id], {
        session: newSession,
        turns: [data.turn] satisfies LlmCouncilTurn[],
      });

      qc.invalidateQueries({ queryKey: ["council-sessions"] });
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
 *   - removes ['council-session', deletedId] from the cache
 *   - invalidates ['council-sessions']; the Worker list endpoint uses the
 *     fresh Hyperdrive binding when available, so immediate refetch is safe.
 */
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: (_data, sessionId) => {
      qc.removeQueries({ queryKey: ["council-session", sessionId] });
      qc.invalidateQueries({ queryKey: ["council-sessions"] });
    },
  });
}
