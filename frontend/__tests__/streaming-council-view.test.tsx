import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import {
  StreamingCouncilView,
  useCouncilStream,
  type CouncilStreamState,
} from "@/components/llm-council/StreamingCouncilView";

function doneStateWithCode(code: string): CouncilStreamState {
  const expert = { text: "", status: "done" as const };
  return {
    openai: expert,
    gemini_pro: expert,
    anthropic: expert,
    moderator: { status: "complete" },
    council: { status: "done" },
    session: { sessionId: "s-1", sessionToken: "t-1", retrieveCode: code },
    startedAt: Date.now(),
  };
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("RecallCodeCard clipboard", () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it("confirms the copy only after writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(writeText).toHaveBeenCalledWith("ABC123");
    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copied",
    );
    expect(screen.queryByTestId("recall-code-copy-failed")).toBeNull();
  });

  it("reports failure when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copy failed",
    );
    expect(screen.getByTestId("recall-code-copy-failed")).toBeTruthy();
    // The code itself must stay on screen so it can be copied by hand.
    expect(screen.getByTestId("recall-code-value").textContent).toBe("ABC123");
  });

  it("reports failure when the Clipboard API is absent entirely", async () => {
    setClipboard(undefined);

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copy failed",
    );
  });
});

describe("useCouncilStream re-entrancy", () => {
  const signals: AbortSignal[] = [];
  const rejecters: Array<(reason: unknown) => void> = [];

  beforeEach(() => {
    signals.length = 0;
    rejecters.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init: { signal: AbortSignal }) => {
        signals.push(init.signal);
        // The mock MUST honour the signal. A promise that only ever settles
        // when the test calls rejecters[i] does not model the browser: an
        // abort the test never explicitly rejects (an unmount, a second
        // start() the test does not tear down) would leave the promise
        // pending forever, so the hook's finally/catch never runs, the
        // watchdog interval is never cleared, and the "assertion" passes
        // because the code under test never executed. Reject on abort.
        return new Promise((_resolve, reject) => {
          rejecters.push(reject);
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function startTwoRuns() {
    const hook = renderHook(() => useCouncilStream());
    await act(async () => {
      void hook.result.current.start({ message: "first" });
    });
    await act(async () => {
      void hook.result.current.start({ message: "second" });
    });
    // The abort listener above already rejected run A's promise; flush the
    // microtasks so its catch/finally runs after the successor installed its
    // own controller. (rejecters[0] is left in place as a belt-and-braces
    // escape hatch; calling it a second time is a no-op on a settled promise.)
    await flush();
    return hook;
  }

  /**
   * Every test in this block MUST settle its runs before finishing. A hook
   * left mid-stream keeps a 5s watchdog interval alive into the next test.
   * Use this in place of a bare `unmount()`.
   */
  async function unmountAndSettle(hook: { unmount: () => void }) {
    hook.unmount();
    await flush();
  }

  it("aborts the previous run and opens a second request", async () => {
    const hook = await startTwoRuns();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await unmountAndSettle(hook);
  });

  it("keeps isStreaming true when the superseded run tears down", async () => {
    const hook = await startTwoRuns();
    expect(hook.result.current.isStreaming).toBe(true);
    await unmountAndSettle(hook);
  });

  it("leaves the successor's AbortController reachable by abort()", async () => {
    const hook = await startTwoRuns();

    await act(async () => {
      hook.result.current.abort();
    });
    await flush();

    expect(signals[1].aborted).toBe(true);
    expect(hook.result.current.isStreaming).toBe(false);
    await unmountAndSettle(hook);
  });

  it("still clears isStreaming when the only run fails", async () => {
    const hook = renderHook(() => useCouncilStream());
    let startPromise!: ReturnType<typeof hook.result.current.start>;
    await act(async () => {
      startPromise = hook.result.current.start({ message: "only" });
      // FECORR-02 makes a pre-stream failure reject start(). Attach a
      // handler in the same tick the promise is created so Node/Vitest
      // never flags it as unhandled — the `.rejects` assertion below is
      // the real handler; this just prevents a spurious report before we
      // get there through the awaits above.
      startPromise.catch(() => {});
    });
    await act(async () => {
      rejecters[0](new Error("boom"));
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.current.isStreaming).toBe(false);
    expect(hook.result.current.state.council.status).toBe("error");
    // The fetch never resolved to a Response, so streamOpened stayed false
    // and start() must reject with the original error rather than swallow
    // it — this is the contract LlmCouncilPage's try/catch now depends on.
    await expect(startPromise).rejects.toThrow("boom");

    await unmountAndSettle(hook);
  });

  it("touches no state when the component unmounts mid-stream", async () => {
    // The guard added in Step 8 is gen-based, and unmount does not bump the
    // generation on its own — hence the cleanup change. Without it, React
    // logs a setState-after-unmount warning here and the hook's teardown runs
    // against a dead component.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useCouncilStream());
    await act(async () => {
      void hook.result.current.start({ message: "only" });
    });
    expect(hook.result.current.isStreaming).toBe(true);

    await unmountAndSettle(hook);

    // The abort listener in the fetch mock has rejected by now; if the hook
    // did not bump genRef, its finally/catch ran against the unmounted tree.
    const messages = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).not.toMatch(/unmounted|not wrapped in act/i);
    errorSpy.mockRestore();
  });

  it("leaves no live watchdog interval behind after unmount", async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useCouncilStream());
      await act(async () => {
        void hook.result.current.start({ message: "only" });
      });
      const during = vi.getTimerCount();
      await unmountAndSettle(hook);
      // Compare against the count while the run was live — an absolute
      // "0 timers" assertion is not safe under jsdom, but the delta is.
      expect(vi.getTimerCount()).toBeLessThan(during);
    } finally {
      vi.useRealTimers();
    }
  });
});
