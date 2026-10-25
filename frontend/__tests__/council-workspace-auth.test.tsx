import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setApiAccessToken } from "@/lib/api";
import { listSessions } from "@/lib/api-llm-council";
import { useCouncilStream } from "@/components/llm-council/StreamingCouncilView";

afterEach(() => { setApiAccessToken(null); vi.unstubAllGlobals(); });

describe("Council workspace credentials", () => {
  it("lists sessions with the current tab token even if another tab changed the cookie", async () => {
    setApiAccessToken("tenant-a-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await listSessions();
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer tenant-a-token");
  });

  it("starts a streamed question with the current tab token", async () => {
    setApiAccessToken("tenant-a-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.close(); } })));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useCouncilStream());
    await act(async () => { await hook.result.current.start({ message: "Private question for workspace A" }); });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer tenant-a-token");
  });
});
