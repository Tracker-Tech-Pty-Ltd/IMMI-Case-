import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";

// The layer is opt-in, so every test that expects caching must enable it.
const ENV = { IMMI_STORAGE_MODE: "cloudflare", IMMI_EDGE_CACHE_ENABLED: "true" };

/** Minimal stand-in for Cloudflare's per-colo `caches.default`. */
class FakeCache {
  constructor() {
    this.store = new Map();
    this.putCalls = 0;
  }

  async match(request) {
    const stored = this.store.get(request.url);
    // The real Cache API hands back a fresh readable body every time.
    return stored ? stored.clone() : undefined;
  }

  async put(request, response) {
    this.putCalls += 1;
    this.store.set(request.url, response);
  }
}

let cache;

function stores() {
  return {
    caseStore: {
      countCompat: vi.fn(async () => 7),
    },
  };
}

function url(path) {
  return new URL(`https://immi.example${path}`);
}

// dispatchCloudflareCaseRead's live signature is (request, url, path, env, ctx)
// — a `request` parameter was added by a sibling change (commit 49ca446) so
// /api/v1/export/* can authenticate via requireAuth(request, env, verifyJwt).
// None of the routes below are export routes, so a bare Request with no
// headers is sufficient; the cache key and caching decision never read
// `request` at all (see the comment above edgeCache() in cloudflare.js).
function request(path) {
  return new Request(`https://immi.example${path}`);
}

beforeEach(() => {
  cache = new FakeCache();
  globalThis.caches = { default: cache };
  mockCreateStores.mockReset();
  mockCreateStores.mockImplementation(() => stores());
});

afterEach(() => {
  delete globalThis.caches;
});

describe("dispatchCloudflareCaseRead edge cache", () => {
  it("stores a 200 response that declares Cache-Control: public", async () => {
    const response = await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(cache.putCalls).toBe(1);
    expect(cache.store.has("https://immi.example/api/v1/data-dictionary?__v=1")).toBe(true);
    // The returned body must still be readable after the clone was stored.
    await expect(response.json()).resolves.toHaveProperty("fields");
  });

  it("serves the second request from cache without re-running the handler", async () => {
    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );
    expect(mockCreateStores).toHaveBeenCalledTimes(1);

    const second = await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(mockCreateStores).toHaveBeenCalledTimes(1);
    expect(cache.putCalls).toBe(1);
    await expect(second.json()).resolves.toHaveProperty("fields");
  });

  it("does NOT store a response whose Cache-Control is no-cache", async () => {
    const response = await dispatchCloudflareCaseRead(
      request("/api/v1/cases/count"), url("/api/v1/cases/count"), "/api/v1/cases/count", ENV,
    );

    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(cache.putCalls).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it("canonicalises query-parameter order into one cache entry", async () => {
    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary?b=2&a=1"), url("/api/v1/data-dictionary?b=2&a=1"), "/api/v1/data-dictionary", ENV,
    );
    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary?a=1&b=2"), url("/api/v1/data-dictionary?a=1&b=2"), "/api/v1/data-dictionary", ENV,
    );

    expect(cache.store.size).toBe(1);
    expect(mockCreateStores).toHaveBeenCalledTimes(1);
  });

  it("defers the cache write to ctx.waitUntil when a ctx is supplied", async () => {
    const pending = [];
    const ctx = { waitUntil: vi.fn((promise) => pending.push(promise)) };

    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV, ctx,
    );

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(pending);
    expect(cache.putCalls).toBe(1);
  });

  it("is OFF unless IMMI_EDGE_CACHE_ENABLED is exactly \"true\"", async () => {
    // The default: the variable is not set at all.
    const off = { IMMI_STORAGE_MODE: "cloudflare" };

    await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", off);
    await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", off);

    expect(cache.putCalls).toBe(0);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);

    // And an explicit "false", and any other truthy-looking string.
    for (const value of ["false", "1", "yes", "TRUE"]) {
      vi.clearAllMocks();
      cache = new FakeCache();
      globalThis.caches = { default: cache };
      const env = { IMMI_STORAGE_MODE: "cloudflare", IMMI_EDGE_CACHE_ENABLED: value };
      await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", env);
      await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", env);
      expect(cache.putCalls, `IMMI_EDGE_CACHE_ENABLED=${value} must not enable the cache`).toBe(0);
    }
  });

  it("keeps repeated query parameters in their original order", async () => {
    // requestFilters uses searchParams.get(), which returns the FIRST value, so
    // these two URLs produce different responses and must NOT share a key.
    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary?court=FCA&court=AATA"), url("/api/v1/data-dictionary?court=FCA&court=AATA"), "/api/v1/data-dictionary", ENV,
    );
    await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary?court=AATA&court=FCA"), url("/api/v1/data-dictionary?court=AATA&court=FCA"), "/api/v1/data-dictionary", ENV,
    );

    expect(cache.store.size).toBe(2);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
  });

  it("namespaces entries by IMMI_EDGE_CACHE_VERSION", async () => {
    const v1 = { ...ENV, IMMI_EDGE_CACHE_VERSION: "1" };
    const v2 = { ...ENV, IMMI_EDGE_CACHE_VERSION: "2" };

    await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v1);
    expect(mockCreateStores).toHaveBeenCalledTimes(1);

    // Same URL, bumped version: the old entry is unreachable, so the handler runs.
    await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v2);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
    expect(cache.store.size).toBe(2);

    // Back to v1: served from cache, handler not re-run.
    await dispatchCloudflareCaseRead(request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", v1);
    expect(mockCreateStores).toHaveBeenCalledTimes(2);
  });

  it("still serves the response when the cache backend throws", async () => {
    globalThis.caches = {
      default: {
        match: vi.fn(async () => { throw new Error("cache unavailable"); }),
        put: vi.fn(async () => { throw new Error("cache unavailable"); }),
      },
    };

    const response = await dispatchCloudflareCaseRead(
      request("/api/v1/data-dictionary"), url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", ENV,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toHaveProperty("fields");
  });

  it("returns null for an unknown route without touching the cache", async () => {
    const response = await dispatchCloudflareCaseRead(
      request("/api/v1/not-a-route"), url("/api/v1/not-a-route"), "/api/v1/not-a-route", ENV,
    );

    expect(response).toBeNull();
    expect(cache.putCalls).toBe(0);
  });
});
