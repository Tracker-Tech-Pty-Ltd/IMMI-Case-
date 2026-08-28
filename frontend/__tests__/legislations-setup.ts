import { vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock ResizeObserver (not available in jsdom)
globalThis.ResizeObserver = class ResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    // Fire callback once with a mock entry
    this.cb(
      [{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
};

// Mock IntersectionObserver (not available in jsdom)
globalThis.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorageFailures.getItem = false;
  localStorageFailures.setItem = false;
  localStorageFailures.removeItem = false;
  localStorageMock.clear();
});

// Mock window.scrollTo
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

// Mock localStorage.
// `failures` lets a test simulate private-mode / quota-exceeded errors, which
// real browsers throw and which the app's try-catch wrappers are supposed to
// absorb. Flags are per-operation on purpose: some callers (e.g.
// src/lib/saved-searches.ts loadSavedSearches) call removeItem from inside the
// catch handler for getItem, so a single global "throw on everything" switch
// would cascade instead of exercising the recovery path.
export const localStorageFailures = {
  getItem: false,
  setItem: false,
  removeItem: false,
};

function storageError(op: string): Error {
  const err = new Error(
    `localStorage.${op} failed (simulated private-mode / quota error)`,
  );
  err.name = "QuotaExceededError";
  return err;
}

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => {
      if (localStorageFailures.getItem) throw storageError("getItem");
      return store[key] || null;
    },
    setItem: (key: string, value: string) => {
      if (localStorageFailures.setItem) throw storageError("setItem");
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      if (localStorageFailures.removeItem) throw storageError("removeItem");
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Secondary access path, so a test can reach the switch without importing this
// setup module. Cast to Record<string, unknown> rather than augmenting the
// global type, since this is a test-only escape hatch, not a typed contract.
(globalThis as Record<string, unknown>).__localStorageFailures =
  localStorageFailures;

// Mock useTranslation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (
        options &&
        typeof options === "object" &&
        "defaultValue" in options &&
        typeof (options as { defaultValue?: unknown }).defaultValue === "string"
      ) {
        return (options as { defaultValue: string }).defaultValue;
      }
      return key;
    },
    i18n: {
      changeLanguage: vi.fn(),
      language: "en",
    },
  }),
}));
