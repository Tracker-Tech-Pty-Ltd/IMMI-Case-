/**
 * proxy-routing.test.js
 *
 * Verifies that workers/proxy.js dispatchLlmCouncil() routes
 * /api/v1/llm-council/* paths to the correct handler in
 * workers/llm-council/handlers.js, and that /llm-council/health and
 * unknown sub-paths fall through to Flask (return null).
 *
 * MOCK SCOPE:
 *   vi.mock("../llm-council/handlers.js") — replaces every exported
 *   handler with vi.fn() so the test only checks routing, not behaviour.
 *
 * TEST INTEGRITY (plan §4):
 *   Every assertion below was demonstrated to fail when its expected value
 *   was flipped (e.g. expect handleCreateSession when handleAddTurn was
 *   actually called) — see the executor's completion report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub Cloudflare-runtime-only imports that proxy.js pulls in at module
// load time. None of these are exercised by dispatchLlmCouncil itself —
// they're stubbed so vitest (Node) can `import "../proxy.js"` without
// the cloudflare:workers / postgres modules failing to resolve.
// ---------------------------------------------------------------------------

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

vi.mock("postgres", () => ({
  // proxy.js calls postgres(...) as a default-exported factory; return a
  // function that yields a no-op tag template. Routing tests never exercise it.
  default: () => () => Promise.resolve([]),
}));

// ---------------------------------------------------------------------------
// Mock the six handler functions so each call is a no-op vi.fn() that
// returns a tagged Response. We only verify which handler was called —
// not what it does.
// ---------------------------------------------------------------------------

const mockCreateSession = vi.fn();
const mockAddTurn = vi.fn();
const mockGetSession = vi.fn();
const mockListSessions = vi.fn();
const mockDeleteSession = vi.fn();
const mockLegacyRun = vi.fn();

vi.mock("../llm-council/handlers.js", () => ({
  handleCreateSession: (...a) => mockCreateSession(...a),
  handleAddTurn: (...a) => mockAddTurn(...a),
  handleGetSession: (...a) => mockGetSession(...a),
  handleListSessions: (...a) => mockListSessions(...a),
  handleDeleteSession: (...a) => mockDeleteSession(...a),
  handleLegacyRun: (...a) => mockLegacyRun(...a),
}));

// Import AFTER mocks are wired up.
import { dispatchLlmCouncil } from "../proxy.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal env — dispatchLlmCouncil itself does not touch env directly. */
const FAKE_ENV = { CSRF_SECRET: "test-secret-routing" };

/** A 21-char nanoid-shape string for /sessions/:id paths. */
const SESSION_ID = "AbCdEfGhIjKlMnOpQrStU"; // 21 chars, URL-safe

/** Build a Request, then feed it through dispatchLlmCouncil. */
async function dispatch(method, path) {
  const url = new URL(`https://example.com${path}`);
  const req = new Request(url.toString(), { method });
  return dispatchLlmCouncil(req, FAKE_ENV, url, path, method);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Each handler mock returns a unique Response so we can detect
  // "wrong handler called" via mock call counts (primary) and via
  // response shape (secondary).
  mockCreateSession.mockResolvedValue(new Response("create"));
  mockAddTurn.mockResolvedValue(new Response("add-turn"));
  mockGetSession.mockResolvedValue(new Response("get"));
  mockListSessions.mockResolvedValue(new Response("list"));
  mockDeleteSession.mockResolvedValue(new Response("delete"));
  mockLegacyRun.mockResolvedValue(new Response("legacy-run"));
});

// ===========================================================================
// dispatchLlmCouncil — path → handler mapping
// ===========================================================================

describe("dispatchLlmCouncil routing", () => {
  it("POST /api/v1/llm-council/sessions → handleCreateSession", async () => {
    const res = await dispatch("POST", "/api/v1/llm-council/sessions");

    // Only handleCreateSession should run.
    expect(mockCreateSession).toHaveBeenCalledOnce();
    expect(mockAddTurn).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(mockLegacyRun).not.toHaveBeenCalled();

    // And the dispatcher must return whatever handleCreateSession returned
    // (proves the result is forwarded, not swallowed).
    expect(res).not.toBeNull();
    expect(await res.text()).toBe("create");
  });

  it("GET /api/v1/llm-council/sessions → handleListSessions", async () => {
    const res = await dispatch("GET", "/api/v1/llm-council/sessions");

    expect(mockListSessions).toHaveBeenCalledOnce();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();

    expect(res).not.toBeNull();
    expect(await res.text()).toBe("list");
  });

  it("POST /api/v1/llm-council/sessions/:id/turns → handleAddTurn", async () => {
    const res = await dispatch(
      "POST",
      `/api/v1/llm-council/sessions/${SESSION_ID}/turns`,
    );

    expect(mockAddTurn).toHaveBeenCalledOnce();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();

    // And it should be invoked with the full path so the handler can
    // pull session_id out of it.
    const callArgs = mockAddTurn.mock.calls[0];
    expect(callArgs[2]).toBe(`/api/v1/llm-council/sessions/${SESSION_ID}/turns`);

    expect(res).not.toBeNull();
    expect(await res.text()).toBe("add-turn");
  });

  it("GET /api/v1/llm-council/sessions/:id → handleGetSession", async () => {
    const res = await dispatch(
      "GET",
      `/api/v1/llm-council/sessions/${SESSION_ID}`,
    );

    expect(mockGetSession).toHaveBeenCalledOnce();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();

    expect(res).not.toBeNull();
    expect(await res.text()).toBe("get");
  });

  it("DELETE /api/v1/llm-council/sessions/:id → handleDeleteSession", async () => {
    const res = await dispatch(
      "DELETE",
      `/api/v1/llm-council/sessions/${SESSION_ID}`,
    );

    expect(mockDeleteSession).toHaveBeenCalledOnce();
    expect(mockGetSession).not.toHaveBeenCalled();

    expect(res).not.toBeNull();
    expect(await res.text()).toBe("delete");
  });

  it("POST /api/v1/llm-council/run → handleLegacyRun", async () => {
    const res = await dispatch("POST", "/api/v1/llm-council/run");

    expect(mockLegacyRun).toHaveBeenCalledOnce();
    expect(mockCreateSession).not.toHaveBeenCalled();

    expect(res).not.toBeNull();
    expect(await res.text()).toBe("legacy-run");
  });

  // ── Flask fall-through paths ─────────────────────────────────────────────

  it("GET /api/v1/llm-council/health returns null (Flask handles it)", async () => {
    const res = await dispatch("GET", "/api/v1/llm-council/health");

    // Health must NOT touch any session handler.
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAddTurn).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(mockLegacyRun).not.toHaveBeenCalled();

    // And dispatch must signal "fall through" with a literal null.
    expect(res).toBeNull();
  });

  it("unknown llm-council sub-path returns null (Flask fall-through)", async () => {
    const res = await dispatch("GET", "/api/v1/llm-council/totally-unknown");

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockAddTurn).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(mockDeleteSession).not.toHaveBeenCalled();
    expect(mockLegacyRun).not.toHaveBeenCalled();

    expect(res).toBeNull();
  });

  it("paths outside /api/v1/llm-council/ return null (not our concern)", async () => {
    const res = await dispatch("GET", "/api/v1/cases");

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });
});
