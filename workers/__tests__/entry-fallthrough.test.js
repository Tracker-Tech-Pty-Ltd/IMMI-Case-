import { describe, expect, it, vi } from "vitest";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const ctx = { waitUntil() {}, passThroughOnException() {} };

function env(overrides = {}) {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: { put: vi.fn(), get: vi.fn(async () => null), head: vi.fn(async () => null), delete: vi.fn() },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(), deleteByIds: vi.fn(),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })) },
    ...overrides,
  };
}

describe("entrypoint fall-through behaviour", () => {
  it("takes every auth route out of service when AUTH_ENABLED is false", async () => {
    const value = env({ AUTH_ENABLED: "false" });
    const response = await worker.fetch(new Request("https://immi.example/api/v1/auth/me"), value, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
  });

  it("keeps auth routes in service when AUTH_ENABLED is not disabled", async () => {
    const response = await worker.fetch(new Request("https://immi.example/api/v1/auth/me"), env(), ctx);
    const body = await response.json();
    expect(body.code).not.toBe("cloudflare_route_unavailable");
  });

  it("fails closed on an unmatched /api path instead of reaching the SPA", async () => {
    const value = env();
    const response = await worker.fetch(new Request("https://immi.example/api/v1/definitely-not-a-route"), value, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
    expect(value.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("hands a non-API path to the static asset binding", async () => {
    const value = env();
    const response = await worker.fetch(new Request("https://immi.example/app/cases"), value, ctx);
    expect(response.status).toBe(200);
    expect(value.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed when the ASSETS binding is missing", async () => {
    const response = await worker.fetch(new Request("https://immi.example/app/cases"), env({ ASSETS: undefined }), ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
  });
});
