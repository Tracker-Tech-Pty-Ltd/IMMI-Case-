/**
 * frontend/__tests__/api-llm-council.test.ts
 *
 * Vitest unit tests for api-llm-council.ts.
 *
 * Mock strategy: vi.spyOn(globalThis, "fetch") — intercepts all fetch calls.
 * localStorage: jsdom provides a real in-memory implementation; cleared in
 * beforeEach so tests are fully isolated.
 *
 * Why mock fetch: the fetcher functions call the real Worker API at runtime;
 * in tests we need deterministic responses without a live server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  addTurn,
  getSession,
  listSessions,
  deleteSession,
} from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION_ID = "abc123def456ghi";
const SESSION_TOKEN = "hmac-sig-base64url-value";
const TOKEN_KEY = `llm-council-token-${SESSION_ID}`;

const MOCK_TURN = {
  turn_id: "turn-id-001",
  turn_index: 0,
  user_message: "What are the grounds for review?",
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
    latency_ms: 1500,
  },
};

const MOCK_SESSION = {
  session_id: SESSION_ID,
  case_id: null,
  title: "What are the grounds for review?",
  status: "active" as const,
  total_turns: 1,
  created_at: "2026-04-28T04:00:00.000Z",
  updated_at: "2026-04-28T04:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("api-llm-council", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------

  describe("createSession", () => {
    it("persists session_token to localStorage on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({
          session_id: SESSION_ID,
          session_token: SESSION_TOKEN,
          turn: MOCK_TURN,
          total_turns: 1,
        }),
      );

      await createSession({ message: "What are the grounds for review?" });

      expect(localStorage.getItem(TOKEN_KEY)).toBe(SESSION_TOKEN);
    });

    it("returns session_id, session_token, turn, total_turns from response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({
          session_id: SESSION_ID,
          session_token: SESSION_TOKEN,
          turn: MOCK_TURN,
          total_turns: 1,
        }),
      );

      const result = await createSession({
        message: "What are the grounds for review?",
        case_id: "abc123def456",
        case_context: "some context",
      });

      expect(result.session_id).toBe(SESSION_ID);
      expect(result.session_token).toBe(SESSION_TOKEN);
      expect(result.total_turns).toBe(1);
      expect(result.turn.turn_index).toBe(0);
    });

    it("sends POST to /api/v1/llm-council/sessions with message in body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({
          session_id: SESSION_ID,
          session_token: SESSION_TOKEN,
          turn: MOCK_TURN,
          total_turns: 1,
        }),
      );

      await createSession({ message: "What are the grounds for review?" });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe("/api/v1/llm-council/sessions");
      expect((opts as RequestInit).method).toBe("POST");
      expect(JSON.parse((opts as RequestInit).body as string)).toMatchObject({
        message: "What are the grounds for review?",
      });
    });
  });

  // -------------------------------------------------------------------------
  // addTurn
  // -------------------------------------------------------------------------

  describe("addTurn", () => {
    it("sends X-Session-Token header read from localStorage", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ turn: MOCK_TURN, total_turns: 2 }),
      );

      await addTurn(SESSION_ID, { message: "Follow-up question" });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe(
        `/api/v1/llm-council/sessions/${SESSION_ID}/turns`,
      );
      expect(
        (opts as RequestInit & { headers: Record<string, string> }).headers[
          "X-Session-Token"
        ],
      ).toBe(SESSION_TOKEN);
    });

    it("throws when localStorage has no token for sessionId", async () => {
      // localStorage is clear — no token set for SESSION_ID
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ turn: MOCK_TURN, total_turns: 2 }),
      );

      await expect(
        addTurn(SESSION_ID, { message: "Follow-up" }),
      ).rejects.toThrow(`No session token found for session ${SESSION_ID}`);
    });

    it("returns turn and total_turns from response", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ turn: { ...MOCK_TURN, turn_index: 1 }, total_turns: 2 }),
      );

      const result = await addTurn(SESSION_ID, { message: "Follow-up" });

      expect(result.total_turns).toBe(2);
      expect(result.turn.turn_index).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------

  describe("getSession", () => {
    it("returns null on 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ error: "Session not found" }, 404),
      );

      const result = await getSession(SESSION_ID);

      expect(result).toBeNull();
    });

    it("returns parsed body on 200", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ session: MOCK_SESSION, turns: [MOCK_TURN] }),
      );

      const result = await getSession(SESSION_ID);

      expect(result).not.toBeNull();
      expect(result!.session.session_id).toBe(SESSION_ID);
      expect(result!.turns).toHaveLength(1);
      expect(result!.turns[0].turn_index).toBe(0);
    });

    it("sends X-Session-Token header when token is in localStorage", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ session: MOCK_SESSION, turns: [] }),
      );

      await getSession(SESSION_ID);

      const [, opts] = fetchSpy.mock.calls[0];
      expect(
        (opts as RequestInit & { headers: Record<string, string> }).headers[
          "X-Session-Token"
        ],
      ).toBe(SESSION_TOKEN);
    });
  });

  // -------------------------------------------------------------------------
  // listSessions
  // -------------------------------------------------------------------------

  describe("listSessions", () => {
    it("builds correct ?limit&before query string", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ sessions: [] }),
      );

      await listSessions({ limit: 10, before: "2026-04-28T00:00:00.000Z" });

      const [url] = fetchSpy.mock.calls[0];
      const parsed = new URL(String(url), "http://localhost");
      expect(parsed.searchParams.get("limit")).toBe("10");
      expect(parsed.searchParams.get("before")).toBe(
        "2026-04-28T00:00:00.000Z",
      );
    });

    it("omits query string when no params given", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ sessions: [] }),
      );

      await listSessions();

      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe("/api/v1/llm-council/sessions");
    });

    it("returns sessions array from response", async () => {
      const mockSessions = [
        {
          session_id: SESSION_ID,
          case_id: null,
          title: "Test",
          status: "active",
          total_turns: 3,
          created_at: "2026-04-28T04:00:00.000Z",
          updated_at: "2026-04-28T04:05:00.000Z",
        },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ sessions: mockSessions }),
      );

      const result = await listSessions({ limit: 5 });

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].session_id).toBe(SESSION_ID);
    });
  });

  // -------------------------------------------------------------------------
  // deleteSession
  // -------------------------------------------------------------------------

  describe("deleteSession", () => {
    it("removes localStorage token entry on success", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ deleted: true }),
      );

      await deleteSession(SESSION_ID);

      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it("sends DELETE to correct URL with X-Session-Token header", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ deleted: true }),
      );

      await deleteSession(SESSION_ID);

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe(
        `/api/v1/llm-council/sessions/${SESSION_ID}`,
      );
      expect((opts as RequestInit).method).toBe("DELETE");
      expect(
        (opts as RequestInit & { headers: Record<string, string> }).headers[
          "X-Session-Token"
        ],
      ).toBe(SESSION_TOKEN);
    });

    it("returns {deleted: true} from response", async () => {
      localStorage.setItem(TOKEN_KEY, SESSION_TOKEN);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        jsonRes({ deleted: true }),
      );

      const result = await deleteSession(SESSION_ID);

      expect(result.deleted).toBe(true);
    });
  });
});
