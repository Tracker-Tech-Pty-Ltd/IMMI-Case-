import { beforeEach, vi } from "vitest";

// jsdom has no Web Locks implementation. Model its exclusive queue instead
// of letting auth tests silently run without the browser-wide mutex.
beforeEach(() => {
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn((_name: string, _options: unknown, callback: () => Promise<unknown>) => {
        const result = tail.then(callback);
        tail = result.then(() => undefined, () => undefined);
        return result;
      }),
    },
  });
});
