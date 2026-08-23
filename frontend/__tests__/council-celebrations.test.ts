/**
 * frontend/__tests__/council-celebrations.test.ts
 *
 * Slice H (Mobile/iOS optimisations) — unit tests for playHaptic().
 *
 * navigator.vibrate is unavailable on iOS Safari (jsdom mirrors that by
 * simply not defining it), and even where it exists some browsers throw
 * when it's called outside a user gesture or under a permissions policy.
 * playHaptic() must feature-detect AND try-catch so callers (recall-code
 * copy button, restore-by-code flow) never see an exception bubble up.
 *
 * NOTE: placed at frontend/__tests__/ (not frontend/src/lib/__tests__/)
 * because vitest.config.ts's `include` glob ("__tests__/**\/*.{test,spec}.*")
 * only resolves relative to the project root — a src/lib/__tests__ file
 * is silently never collected. See frontend/src/lib/__tests__/saved-searches.test.ts
 * for a pre-existing instance of this same dead-test-file bug (out of
 * scope for this Slice H change; not touched here).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { playHaptic } from "@/lib/council-celebrations";

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

describe("playHaptic", () => {
  afterEach(() => {
    // jsdom does not define navigator.vibrate or window.matchMedia by
    // default — restore that clean slate between tests so each test's
    // feature-detection assertions start from the same baseline.
    // @ts-expect-error - removing a DOM property that tests define per-case
    delete navigator.vibrate;
    // @ts-expect-error - removing a DOM property that tests define per-case
    delete window.matchMedia;
  });

  it("no-ops silently when navigator.vibrate is not present (iOS Safari baseline)", () => {
    mockMatchMedia(false);
    expect(navigator.vibrate).toBeUndefined();
    expect(() => playHaptic()).not.toThrow();
  });

  it("no-ops silently when navigator.vibrate throws", () => {
    mockMatchMedia(false);
    const vibrateSpy = vi.fn(() => {
      throw new DOMException("vibrate blocked", "NotAllowedError");
    });
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });

    expect(() => playHaptic()).not.toThrow();
    expect(vibrateSpy).toHaveBeenCalled();
  });

  it("calls navigator.vibrate with the default 20ms pulse when supported", () => {
    mockMatchMedia(false);
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });

    playHaptic();

    expect(vibrateSpy).toHaveBeenCalledWith(20);
  });

  it("forwards a custom pattern through to navigator.vibrate", () => {
    mockMatchMedia(false);
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });

    playHaptic([10, 20, 10]);

    expect(vibrateSpy).toHaveBeenCalledWith([10, 20, 10]);
  });

  it("does not vibrate when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    const vibrateSpy = vi.fn();
    Object.defineProperty(navigator, "vibrate", {
      value: vibrateSpy,
      configurable: true,
      writable: true,
    });

    playHaptic();

    expect(vibrateSpy).not.toHaveBeenCalled();
  });
});
