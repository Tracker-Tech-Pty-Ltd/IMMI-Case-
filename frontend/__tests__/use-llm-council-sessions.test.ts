/**
 * frontend/__tests__/use-llm-council-sessions.test.ts
 *
 * Vitest unit tests for use-llm-council-sessions.ts hooks.
 *
 * Mock strategy: vi.mock('@/lib/api-llm-council') — all 5 fetcher functions
 * replaced with vi.fn() returning controlled Promises.
 *
 * Wrapper: custom QueryClientProvider with fresh QueryClient per test to
 * prevent cache bleed between tests.
 *
 * renderHook from @testing-library/react provides stable React context.
 */

import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useLlmCouncilSession,
  useLlmCouncilSessions,
  useCreateSession,
  useAddTurn,
  useDeleteSession,
} from "@/hooks/use-llm-council-sessions";
import * as api from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Mock the entire api-llm-council module
// ---------------------------------------------------------------------------

vi.mock("@/lib/api-llm-council", () => ({
  createSession: vi.fn(),
  addTurn: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
}));

// Typed references so tests can set mock implementations easily
const mockCreateSession = vi.mocked(api.createSession);
const mockAddTurn = vi.mocked(api.addTurn);
const mockGetSession = vi.mocked(api.getSession);
const mockListSessions = vi.mocked(api.listSessions);
const mockDeleteSession = vi.mocked(api.deleteSession);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "abc123def456";
const SESSION_TOKEN = "hmac-token-value";

const MOCK_TURN: api.LlmCouncilTurn = {
  turn_id: "turn-001",
  turn_index: 0,
  user_message: "What are my review grounds?",
  opinions: [],
  moderator: {
    success: true,
    composed_answer: "The grounds include...",
    consensus: "",
    disagreements: "",
    outcome_likelihood_percent: 60,
    outcome_likelihood_label: "medium",
    outcome_likelihood_reason: "",
    law_sections: [],
    mock_judgment: "",
    follow_up_questions: [],
    ranking: [],
    model_critiques: [],
    vote_summary: null,
    agreement_points: [],
    conflict_points: [],
    provider_law_sections: {},
    shared_law_sections: [],
    shared_law_sections_confidence_percent: 0,
    shared_law_sections_confidence_reason: "",
    raw_text: "",
    error: "",
    latency_ms: 1200,
  },
  created_at: "2026-04-28T04:00:00.000Z",
};

const MOCK_SESSION: api.LlmCouncilSession = {
  session_id: SESSION_ID,
  case_id: null,
  title: "What are my review grounds?",
  status: "active",
  total_turns: 1,
  created_at: "2026-04-28T04:00:00.000Z",
  updated_at: "2026-04-28T04:00:00.000Z",
};

const MOCK_SESSION_LIST: api.LlmCouncilSessionList = {
  sessions: [
    {
      session_id: SESSION_ID,
      case_id: null,
      title: "What are my review grounds?",
      status: "active",
      total_turns: 1,
      created_at: "2026-04-28T04:00:00.000Z",
      updated_at: "2026-04-28T04:00:00.000Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// Per-test QueryClient wrapper
// ---------------------------------------------------------------------------

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("use-llm-council-sessions hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // useLlmCouncilSession
  // -------------------------------------------------------------------------

  describe("useLlmCouncilSession", () => {
    it("is disabled when sessionId is undefined", () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSession(undefined),
        { wrapper: Wrapper },
      );

      // query should not even be in loading state — it is disabled
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("is disabled when sessionId is empty string", () => {
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSession(""),
        { wrapper: Wrapper },
      );

      expect(result.current.fetchStatus).toBe("idle");
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("fetches session data when sessionId is provided", async () => {
      mockGetSession.mockResolvedValue({
        session: MOCK_SESSION,
        turns: [MOCK_TURN],
      });

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSession(SESSION_ID),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockGetSession).toHaveBeenCalledWith(SESSION_ID);
      expect(result.current.data?.session.session_id).toBe(SESSION_ID);
      expect(result.current.data?.turns).toHaveLength(1);
    });

    it("transitions to error state when getSession rejects", async () => {
      mockGetSession.mockRejectedValue(new Error("Session not found"));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSession(SESSION_ID),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe("Session not found");
    });

    it("stores result under queryKey ['council-session', sessionId]", async () => {
      mockGetSession.mockResolvedValue({
        session: MOCK_SESSION,
        turns: [],
      });

      const { qc, Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSession(SESSION_ID),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // data must be accessible via the exact queryKey
      const cached = qc.getQueryData(["council-session", SESSION_ID]);
      expect(cached).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // useLlmCouncilSessions
  // -------------------------------------------------------------------------

  describe("useLlmCouncilSessions", () => {
    it("fetches session list with no params", async () => {
      mockListSessions.mockResolvedValue(MOCK_SESSION_LIST);

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSessions(),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockListSessions).toHaveBeenCalledWith(undefined);
      expect(result.current.data?.sessions).toHaveLength(1);
      expect(result.current.data?.sessions[0].session_id).toBe(SESSION_ID);
    });

    it("passes limit and before params to listSessions", async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      const params = { limit: 5, before: "2026-04-28T00:00:00.000Z" };
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSessions(params),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockListSessions).toHaveBeenCalledWith(params);
    });

    it("transitions to error state when listSessions rejects", async () => {
      mockListSessions.mockRejectedValue(new Error("Network error"));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(
        () => useLlmCouncilSessions(),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe("Network error");
    });
  });

  // -------------------------------------------------------------------------
  // useCreateSession
  // -------------------------------------------------------------------------

  describe("useCreateSession", () => {
    it("calls createSession with mutation variables", async () => {
      mockCreateSession.mockResolvedValue({
        session_id: SESSION_ID,
        session_token: SESSION_TOKEN,
        turn: MOCK_TURN,
        total_turns: 1,
      });

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCreateSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "What are my review grounds?" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockCreateSession).toHaveBeenCalledWith({
        message: "What are my review grounds?",
      });
    });

    it("seeds ['council-session', session_id] cache on success", async () => {
      mockCreateSession.mockResolvedValue({
        session_id: SESSION_ID,
        session_token: SESSION_TOKEN,
        turn: MOCK_TURN,
        total_turns: 1,
      });

      const { qc, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCreateSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "What are my review grounds?" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const cached = qc.getQueryData(["council-session", SESSION_ID]) as
        | { session: api.LlmCouncilSession; turns: api.LlmCouncilTurn[] }
        | undefined;
      expect(cached).toBeDefined();
      expect(cached?.session.session_id).toBe(SESSION_ID);
      expect(cached?.turns).toHaveLength(1);
    });

    it("invalidates ['council-sessions'] on success", async () => {
      mockCreateSession.mockResolvedValue({
        session_id: SESSION_ID,
        session_token: SESSION_TOKEN,
        turn: MOCK_TURN,
        total_turns: 1,
      });

      const { qc, Wrapper } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "What are my review grounds?" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["council-sessions"] }),
      );
    });

    it("seeds cache with case_id from variables (not null)", async () => {
      const CASE_ID = "abc123def456";

      mockCreateSession.mockResolvedValue({
        session_id: SESSION_ID,
        session_token: SESSION_TOKEN,
        turn: MOCK_TURN,
        total_turns: 1,
      });

      const { qc, Wrapper } = makeWrapper();
      const { result } = renderHook(() => useCreateSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({
          message: "What are my review grounds?",
          case_id: CASE_ID,
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const cached = qc.getQueryData(["council-session", SESSION_ID]) as
        | { session: api.LlmCouncilSession; turns: api.LlmCouncilTurn[] }
        | undefined;
      // Bug fix: seeded entry's case_id must equal variables.case_id, not null
      expect(cached?.session.case_id).toBe(CASE_ID);
    });
  });

  // -------------------------------------------------------------------------
  // useAddTurn
  // -------------------------------------------------------------------------

  describe("useAddTurn", () => {
    it("calls addTurn with sessionId and message on mutation", async () => {
      mockAddTurn.mockResolvedValue({
        turn: { ...MOCK_TURN, turn_index: 1 },
        total_turns: 2,
      });

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useAddTurn(SESSION_ID), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "Follow-up question" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockAddTurn).toHaveBeenCalledWith(SESSION_ID, {
        message: "Follow-up question",
      });
    });

    it("invalidates ['council-session', sessionId] on success", async () => {
      mockAddTurn.mockResolvedValue({
        turn: { ...MOCK_TURN, turn_index: 1 },
        total_turns: 2,
      });

      const { qc, Wrapper } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useAddTurn(SESSION_ID), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "Follow-up question" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["council-session", SESSION_ID] }),
      );
    });

    it("invalidates ['council-sessions'] on success", async () => {
      mockAddTurn.mockResolvedValue({
        turn: { ...MOCK_TURN, turn_index: 1 },
        total_turns: 2,
      });

      const { qc, Wrapper } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useAddTurn(SESSION_ID), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "Follow-up question" });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["council-sessions"] }),
      );
    });

    it("transitions to error state when addTurn rejects", async () => {
      mockAddTurn.mockRejectedValue(new Error("Token missing"));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useAddTurn(SESSION_ID), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate({ message: "Follow-up" });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe("Token missing");
    });
  });

  // -------------------------------------------------------------------------
  // useDeleteSession
  // -------------------------------------------------------------------------

  describe("useDeleteSession", () => {
    it("calls deleteSession with sessionId on mutation", async () => {
      mockDeleteSession.mockResolvedValue({ deleted: true });

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useDeleteSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate(SESSION_ID);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockDeleteSession).toHaveBeenCalledWith(SESSION_ID);
    });

    it("removes ['council-session', deletedId] from cache on success", async () => {
      mockDeleteSession.mockResolvedValue({ deleted: true });

      const { qc, Wrapper } = makeWrapper();
      // pre-seed the cache entry that should be removed
      qc.setQueryData(["council-session", SESSION_ID], {
        session: MOCK_SESSION,
        turns: [MOCK_TURN],
      });

      const removeSpy = vi.spyOn(qc, "removeQueries");

      const { result } = renderHook(() => useDeleteSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate(SESSION_ID);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(removeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["council-session", SESSION_ID],
        }),
      );
    });

    it("optimistically removes the deleted session from ['council-sessions'] cache on success", async () => {
      mockDeleteSession.mockResolvedValue({ deleted: true });

      const { qc, Wrapper } = makeWrapper();
      // Seed cache with two sessions so we can observe filtering.
      qc.setQueryData(["council-sessions", undefined], {
        sessions: [
          { session_id: SESSION_ID, title: "to delete" },
          { session_id: "OTHER_ID", title: "keep" },
        ],
      });

      const { result } = renderHook(() => useDeleteSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate(SESSION_ID);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Hyperdrive caches list SELECTs for ~5-10s, so an immediate
      // invalidate would refetch and overwrite our optimistic remove
      // with stale data still containing the deleted row. Use
      // setQueriesData to filter the deleted row out of every cached
      // ['council-sessions', ...] query.
      const cached = qc.getQueryData<{ sessions: { session_id: string }[] }>([
        "council-sessions",
        undefined,
      ]);
      expect(cached?.sessions.map((s) => s.session_id)).toEqual(["OTHER_ID"]);
    });

    it("schedules a delayed invalidate (~10s) for eventual reconciliation", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockDeleteSession.mockResolvedValue({ deleted: true });

      const { qc, Wrapper } = makeWrapper();
      const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

      const { result } = renderHook(() => useDeleteSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate(SESSION_ID);
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["council-sessions"] }),
      );

      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["council-sessions"] }),
      );

      vi.useRealTimers();
    });

    it("transitions to error state when deleteSession rejects", async () => {
      mockDeleteSession.mockRejectedValue(new Error("Not authorized"));

      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useDeleteSession(), {
        wrapper: Wrapper,
      });

      await act(async () => {
        result.current.mutate(SESSION_ID);
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe("Not authorized");
    });
  });
});
