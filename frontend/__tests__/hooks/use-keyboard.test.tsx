/**
 * use-keyboard — behavioural tests for the global keydown listener.
 *
 * Events are dispatched on document.body with bubbles:true so they reach the
 * window-level listener the hook installs, and so e.target has a real tagName
 * (window does not), which is what the INPUT/TEXTAREA guard reads.
 *
 * React.ReactNode below resolves via @types/react's ambient global namespace
 * (see __tests__/success-rate-deep-modal.test.tsx for the same convention);
 * no explicit React import is needed under the "react-jsx" transform, and one
 * used only as a type would fail noUnusedLocals / verbatimModuleSyntax.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useKeyboard } from "@/hooks/use-keyboard";

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function pressKey(key: string, target: EventTarget = document.body) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("useKeyboard", () => {
  it("calls onSearch when '/' is pressed", () => {
    const onSearch = vi.fn();
    renderHook(() => useKeyboard({ onSearch }), { wrapper });

    pressKey("/");

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("ignores keystrokes originating in an input field", () => {
    const onSearch = vi.fn();
    renderHook(() => useKeyboard({ onSearch }), { wrapper });

    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey("/", input);
    input.remove();

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("removes its keydown listener on unmount", () => {
    const onSearch = vi.fn();
    const { unmount } = renderHook(() => useKeyboard({ onSearch }), {
      wrapper,
    });

    pressKey("/");
    expect(onSearch).toHaveBeenCalledTimes(1);

    unmount();
    pressKey("/");

    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
