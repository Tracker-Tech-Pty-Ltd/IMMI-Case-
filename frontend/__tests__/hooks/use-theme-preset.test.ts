/**
 * use-theme-preset — behavioural tests for the storage-failure paths.
 *
 * The module reads localStorage at IMPORT time and applies the theme before
 * React mounts, so every test arranges storage state first, then resets the
 * module registry, then dynamically imports. window.matchMedia must be stubbed
 * before each import: jsdom does not define it, and readStoredDark() falls
 * through to it whenever localStorage.getItem throws.
 *
 * The app's shipped default preset is "parchment" (the "Legal Codex"
 * direction — see DEFAULT_PRESET in src/hooks/use-theme-preset.ts), not
 * "claude". readStoredPreset() also no longer migrates a stored "parchment"
 * value to "claude" on read (that one-time migration was deleted so a user's
 * deliberate Parchment choice is never silently reverted).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { localStorageFailures } from "../legislations-setup";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function loadHook() {
  vi.resetModules();
  return (await import("@/hooks/use-theme-preset")).useThemePreset;
}

describe("useThemePreset", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    // @ts-expect-error - removing a DOM property this file defines per-test
    delete window.matchMedia;
  });

  it("restores a stored preset and dark flag on module load", async () => {
    localStorage.setItem("theme-preset", "ocean");
    localStorage.setItem("theme-dark", "true");

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("ocean");
    expect(result.current.isDark).toBe(true);
  });

  it("falls back to the parchment preset when localStorage.getItem throws (private mode)", async () => {
    localStorageFailures.getItem = true;

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("parchment");
    expect(result.current.isDark).toBe(false);
    expect(result.current.customVars).toEqual({});
  });

  it("ignores an unknown stored preset name and falls back to parchment", async () => {
    localStorage.setItem("theme-preset", "not-a-real-preset");

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("parchment");
  });

  it("still updates in-memory state when localStorage.setItem throws (quota exceeded)", async () => {
    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    localStorageFailures.setItem = true;

    expect(() => {
      act(() => result.current.setPreset("forest"));
    }).not.toThrow();
    expect(result.current.preset).toBe("forest");
  });
});
