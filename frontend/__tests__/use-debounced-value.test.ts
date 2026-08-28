import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value synchronously on first render", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDebouncedValue("initial", 200));

    expect(result.current).toBe("initial");
  });

  it("does not update before delayMs has elapsed", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(199);
    });

    expect(result.current).toBe("a");
  });

  it("collapses rapid changes into one update — only the last value survives", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 200),
      { initialProps: { value: "m" } },
    );

    rerender({ value: "mi" });
    rerender({ value: "mig" });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe("mig");
  });
});
