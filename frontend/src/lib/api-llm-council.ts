/**
 * frontend/src/lib/api-llm-council.ts
 *
 * TypeScript types + fetcher functions for the LLM Council Worker sessions API.
 *
 * localStorage key per session: `llm-council-token-${session_id}`
 * — createSession persists the session_token here.
 * — addTurn / getSession / deleteSession read it back.
 */

// ---------------------------------------------------------------------------
// Types — mirror handlers.js JSON shapes
// ---------------------------------------------------------------------------

export interface LlmCouncilOpinion {
  provider_key: string;
  provider_label: string;
  model: string;
  success: boolean;
  answer: string;
  error: string;
  sources: string[];
  latency_ms: number;
}

export interface LlmCouncilModerator {
  success: boolean;
  composed_answer: string;
  consensus: string;
  disagreements: string;
  outcome_likelihood_percent: number;
  outcome_likelihood_label: string;
  outcome_likelihood_reason: string;
  law_sections: string[];
  mock_judgment: string;
  follow_up_questions: string[];
  ranking: unknown[];
  model_critiques: unknown[];
  vote_summary: unknown;
  agreement_points: string[];
  conflict_points: string[];
  provider_law_sections: Record<string, string[]>;
  shared_law_sections: string[];
  shared_law_sections_confidence_percent: number;
  shared_law_sections_confidence_reason: string;
  raw_text: string;
  error: string;
  latency_ms: number;
}

export interface LlmCouncilTurn {
  turn_id: string;
  turn_index: number;
  user_message: string;
  opinions: LlmCouncilOpinion[];
  moderator: LlmCouncilModerator;
  models?: Record<string, unknown>;
  question?: string;
  case_context?: string;
  created_at?: string;
}

export interface LlmCouncilSession {
  session_id: string;
  case_id: string | null;
  title: string;
  status: "active" | "complete" | "abandoned";
  total_turns: number;
  created_at: string;
  updated_at: string;
}

export interface LlmCouncilSessionListItem {
  session_id: string;
  case_id: string | null;
  title: string;
  status: string;
  total_turns: number;
  created_at: string;
  updated_at: string;
}

export interface LlmCouncilSessionList {
  sessions: LlmCouncilSessionListItem[];
}

// ---------------------------------------------------------------------------
// localStorage helpers (try-catch: incognito / quota safe)
// ---------------------------------------------------------------------------

const TOKEN_KEY = (sessionId: string) => `llm-council-token-${sessionId}`;

function persistToken(sessionId: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY(sessionId), token);
  } catch {
    // no-op — quota or incognito
  }
}

function loadToken(sessionId: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY(sessionId));
  } catch {
    return null;
  }
}

function removeToken(sessionId: string): void {
  try {
    localStorage.removeItem(TOKEN_KEY(sessionId));
  } catch {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Core fetch helper (no CSRF — Worker uses HMAC token auth, not Flask CSRF)
// ---------------------------------------------------------------------------

const LLM_COUNCIL_TIMEOUT_MS = 180_000; // LLM calls can take up to 3 min

interface FetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function councilFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = LLM_COUNCIL_TIMEOUT_MS,
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timeoutHandle = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    return res;
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      timedOut
    ) {
      throw new Error(`Request timeout after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
  }
}

async function councilFetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const res = await councilFetch(url, options);
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Fetcher functions
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/llm-council/sessions
 *
 * Creates a new session and fires the first council turn.
 * Persists session_token to localStorage under `llm-council-token-${session_id}`.
 *
 * Returns {session_id, session_token, turn, total_turns: 1}
 */
export async function createSession(params: {
  message: string;
  case_id?: string;
  case_context?: string;
}): Promise<{
  session_id: string;
  session_token: string;
  turn: LlmCouncilTurn;
  total_turns: number;
}> {
  const result = await councilFetchJson<{
    session_id: string;
    session_token: string;
    turn: LlmCouncilTurn;
    total_turns: number;
  }>("/api/v1/llm-council/sessions", {
    method: "POST",
    body: JSON.stringify(params),
  });

  persistToken(result.session_id, result.session_token);
  return result;
}

/**
 * POST /api/v1/llm-council/sessions/:id/turns
 *
 * Adds a turn to an existing session.
 * Reads X-Session-Token from localStorage; throws if missing.
 *
 * Returns {turn, total_turns}
 */
export async function addTurn(
  sessionId: string,
  params: { message: string },
): Promise<{ turn: LlmCouncilTurn; total_turns: number }> {
  const token = loadToken(sessionId);
  if (!token) {
    throw new Error(`No session token found for session ${sessionId}`);
  }

  return councilFetchJson<{ turn: LlmCouncilTurn; total_turns: number }>(
    `/api/v1/llm-council/sessions/${sessionId}/turns`,
    {
      method: "POST",
      body: JSON.stringify(params),
      headers: { "X-Session-Token": token },
    },
  );
}

/**
 * GET /api/v1/llm-council/sessions/:id
 *
 * Returns {session, turns} or null on 404.
 */
export async function getSession(
  sessionId: string,
): Promise<{ session: LlmCouncilSession; turns: LlmCouncilTurn[] } | null> {
  const token = loadToken(sessionId);
  const headers: Record<string, string> = token
    ? { "X-Session-Token": token }
    : {};

  const res = await councilFetch(
    `/api/v1/llm-council/sessions/${sessionId}`,
    { headers },
  );

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `API error: ${res.status}`);
  }

  return res.json() as Promise<{
    session: LlmCouncilSession;
    turns: LlmCouncilTurn[];
  }>;
}

/**
 * GET /api/v1/llm-council/sessions?limit=&before=
 *
 * Lists sessions (no auth required).
 */
export async function listSessions(
  params: { limit?: number; before?: string } = {},
): Promise<LlmCouncilSessionList> {
  const qs = new URLSearchParams();
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (params.before) qs.set("before", params.before);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  return councilFetchJson<LlmCouncilSessionList>(
    `/api/v1/llm-council/sessions${suffix}`,
  );
}

/**
 * DELETE /api/v1/llm-council/sessions/:id
 *
 * Deletes a session. Removes the localStorage token on success.
 */
export async function deleteSession(
  sessionId: string,
): Promise<{ deleted: true }> {
  const token = loadToken(sessionId);
  const headers: Record<string, string> = token
    ? { "X-Session-Token": token }
    : {};

  const result = await councilFetchJson<{ deleted: true }>(
    `/api/v1/llm-council/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers,
    },
  );

  removeToken(sessionId);
  return result;
}
