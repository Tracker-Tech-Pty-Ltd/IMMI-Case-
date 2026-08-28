import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import {
  StreamingCouncilView,
  useCouncilStream,
  type CouncilStreamState,
  type ExpertStreamState,
} from "@/components/llm-council/StreamingCouncilView";

// ---------------------------------------------------------------------------
// Block A — presentation. StreamingCouncilView takes a plain `state` prop,
// so no hook mocking is required.
// ---------------------------------------------------------------------------

function makeExpert(
  status: ExpertStreamState["status"] = "pending",
): ExpertStreamState {
  return { text: "", status };
}

function makeState(overrides: Partial<CouncilStreamState> = {}): CouncilStreamState {
  return {
    openai: makeExpert(),
    gemini_pro: makeExpert(),
    anthropic: makeExpert(),
    moderator: { status: "pending" },
    council: { status: "running" },
    session: { sessionId: null, sessionToken: null, retrieveCode: null },
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("StreamingCouncilView presentation", () => {
  it("shows the council error strip and hides the deliberating label when the stream failed", () => {
    render(
      <StreamingCouncilView
        state={makeState({
          openai: makeExpert("streaming"),
          gemini_pro: makeExpert("streaming"),
          anthropic: makeExpert("streaming"),
          council: { status: "error", error: "boom" },
        })}
      />,
    );

    const strip = screen.getByTestId("council-stream-error");
    expect(strip.textContent).toContain("boom");
    expect(strip.getAttribute("role")).toBe("alert");
    expect(screen.getByText("Council run failed")).toBeInTheDocument();
    expect(screen.queryByText("Council deliberating")).toBeNull();
  });

  it("keeps spinning and showing no error strip while the council is still running", () => {
    render(
      <StreamingCouncilView
        state={makeState({
          openai: makeExpert("pending"),
          gemini_pro: makeExpert("pending"),
          anthropic: makeExpert("pending"),
          council: { status: "running" },
        })}
      />,
    );

    expect(screen.getByText("Council deliberating")).toBeInTheDocument();
    expect(screen.queryByTestId("council-stream-error")).toBeNull();
  });

  it("shows the finished label with no error strip once everything completed", () => {
    render(
      <StreamingCouncilView
        state={makeState({
          openai: makeExpert("done"),
          gemini_pro: makeExpert("done"),
          anthropic: makeExpert("done"),
          council: { status: "done" },
        })}
      />,
    );

    expect(screen.getByText("Panel finished — synthesising")).toBeInTheDocument();
    expect(screen.queryByTestId("council-stream-error")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Block B — the hook. This is where the Step 2 corrections actually live:
// the watchdog, the unmount generation bump, the superseding-run guard, and
// the pre-stream-vs-mid-stream rethrow split.
// ---------------------------------------------------------------------------

/** A fetch stub that never settles on its own — only when the AbortSignal
 *  fires. Every case below depends on the abort actually rejecting the
 *  underlying promise, the way a real fetch() does. */
function abortableFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: unknown, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    }),
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCouncilStream error surfacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the 90s watchdog is terminal and visible", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const hook = renderHook(() => useCouncilStream());

    await act(async () => {
      void hook.result.current.start({ message: "x" });
    });
    // The watchdog interval ticks every 5s and fires once silence exceeds
    // 90s — this is the only test that executes the `timedOut` branch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    expect(hook.result.current.state.council.status).toBe("error");
    expect(hook.result.current.state.council.error).toMatch(/90 seconds/);
    expect(hook.result.current.isStreaming).toBe(false);
  });

  it("stays silent when the component unmounts mid-stream", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useCouncilStream());

    await act(async () => {
      void hook.result.current.start({ message: "x" });
    });
    const statusBeforeUnmount = hook.result.current.state.council.status;

    hook.unmount();
    await flush();

    // If the generation bump did not happen before the abort, React would
    // log a setState-after-unmount warning here and/or the state snapshot
    // captured just before unmount would already read "error".
    expect(statusBeforeUnmount).not.toBe("error");
    const messages = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).not.toMatch(/unmounted|not wrapped in act/i);
    errorSpy.mockRestore();
  });

  it("does not paint a superseding run red when the old one aborts", async () => {
    vi.stubGlobal("fetch", abortableFetch());
    const hook = renderHook(() => useCouncilStream());

    await act(async () => {
      void hook.result.current.start({ message: "first" });
    });
    await act(async () => {
      void hook.result.current.start({ message: "second" });
    });
    await flush();

    expect(hook.result.current.state.council.status).not.toBe("error");
    expect(hook.result.current.isStreaming).toBe(true);

    hook.unmount();
    await flush();
  });

  it("rejects on a pre-stream HTTP failure so the page's existing catch fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        body: null,
        statusText: "Service Unavailable",
        text: async () => "cloudflare_route_unavailable",
      }),
    );
    const hook = renderHook(() => useCouncilStream());

    await act(async () => {
      await expect(
        hook.result.current.start({ message: "x" }),
      ).rejects.toThrow(/503/);
    });
  });

  it("does NOT reject on a mid-stream failure — the error surfaces in state instead", async () => {
    const encoder = new TextEncoder();
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!pulled) {
          pulled = true;
          controller.enqueue(
            encoder.encode("event: council.start\ndata: {}\n\n"),
          );
          return;
        }
        controller.error(new Error("stream broke"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body }));
    const hook = renderHook(() => useCouncilStream());

    let settled: CouncilStreamState | undefined;
    await act(async () => {
      settled = await hook.result.current.start({ message: "x" });
    });

    expect(settled).toBeDefined();
    expect(hook.result.current.state.council.status).toBe("error");
  });
});
