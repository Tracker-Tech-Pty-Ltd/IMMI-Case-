import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCouncilStream } from "@/components/llm-council/StreamingCouncilView";
import { apiFetch, clearCsrfToken, exportCollection } from "@/lib/api";
import { addTurn, getSession } from "@/lib/api-llm-council";
import { fetchAuthJson } from "@/lib/auth-cookie-coordination";

describe("local demo request credentials", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", true);
    clearCsrfToken();
    localStorage.setItem("llm-council-token-fake-session", "dummy-token");
  });

  afterEach(() => {
    localStorage.removeItem("llm-council-token-fake-session");
    clearCsrfToken();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    { demo: true, expected: "omit" },
    { demo: false, expected: "include" },
  ])("sets credentials correctly in demo=$demo for auth, Council, CSRF and generic API requests", async ({ demo, expected }) => {
    vi.stubEnv("VITE_COUNCIL_DEMO", demo ? "true" : "false");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/csrf-token")) return Response.json({ csrf_token: "fake-csrf" });
      if (url.endsWith("/collections/export")) return new Response("<p>Example</p>");
      if (url.endsWith("/llm-council/stream")) {
        return new Response('event: council.done\ndata: {}\n\n', { headers: { "Content-Type": "text/event-stream" } });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAuthJson("/api/v1/auth/refresh", { credentials: "include" });
    await getSession("fake-session");
    await addTurn("fake-session", { message: "Example" });
    await apiFetch("/api/v1/example", { method: "POST", credentials: "include" });
    await exportCollection({ collection_id: "demo", collection_name: "Example", case_ids: [], case_notes: {} });
    const hook = renderHook(() => useCouncilStream());
    await act(async () => { await hook.result.current.start({ message: "Example" }); });
    hook.unmount();

    const requests = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), credentials: init?.credentials }));
    for (const path of ["/auth/refresh", "/sessions/fake-session", "/sessions/fake-session/turns", "/csrf-token", "/example", "/llm-council/stream"]) {
      expect(requests.find((request) => request.url.endsWith(path))?.credentials).toBe(expected);
    }
    // Export previously relied on fetch's default same-origin credentials.
    expect(requests.find((request) => request.url.endsWith("/collections/export"))?.credentials).toBe(demo ? "omit" : undefined);
  });

  it("does not activate the demo credential override in a production build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_COUNCIL_DEMO", "true");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    await fetchAuthJson("/api/v1/auth/me", { credentials: "include" });
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
  });
});
