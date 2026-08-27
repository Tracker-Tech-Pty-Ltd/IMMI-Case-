/**
 * `config/cloudflare-native-route-manifest.json` claims 72 implemented routes.
 * tests/test_cloudflare_route_manifest.py only checks that file against itself,
 * so a route could exist on paper and 503 in production. This test drives every
 * manifest route through the real entrypoint and fails if it reaches the
 * fail-closed fall-through.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const worker = (await import("../cloudflare-native.js")).default;

const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../config/cloudflare-native-route-manifest.json", import.meta.url)),
  "utf8",
));

// Each placeholder must satisfy the validator the matching handler applies,
// otherwise the route legitimately falls through and the test lies.
const PARAM_VALUES = Object.freeze({
  ":case_id": "0123456789ab",              // assertCaseId: 12 lowercase hex chars
  ":session_id": "V1StGXR8Z5jdHi6BmyT7K",  // SESSION_ID_RE: /^[A-Za-z0-9_-]{21}$/
  ":legislation_id": "migration-act-1958",
  ":filename": "smith-j.jpg",
});

function concretePath(template) {
  let path = template;
  for (const [token, value] of Object.entries(PARAM_VALUES)) path = path.split(token).join(value);
  return path;
}

function env() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    AUTH_ENABLED: "true",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: {
      put: vi.fn(async () => ({})), get: vi.fn(async () => null),
      head: vi.fn(async () => null), delete: vi.fn(async () => undefined),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })), query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "m" })), deleteByIds: vi.fn(async () => ({ mutationId: "m" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
    ASSETS: { fetch: vi.fn(async () => new Response("spa", { status: 200 })) },
  };
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

describe("every manifest route is served by the native entrypoint", () => {
  it.each(manifest.implemented)("%s does not fall through to the 503 handler", async (route) => {
    const [method, template] = route.split(" ", 2);
    const request = new Request(`https://immi.example${concretePath(template)}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify({}),
    });
    let response;
    try {
      response = await worker.fetch(request, env(), ctx);
    } catch (error) {
      throw new Error(`${route} threw instead of returning a Response: ${error?.message}`);
    }
    let body = null;
    try { body = await response.clone().json(); } catch { body = null; }
    expect(body?.code, `${route} reached the fail-closed fall-through`).not.toBe("cloudflare_route_unavailable");
  });

  it("runs against a non-vacuous manifest", () => {
    // Guards against a truncated/empty manifest silently making it.each a no-op.
    expect(manifest.implemented.length).toBeGreaterThan(60);
    expect(manifest.unported_fail_closed).toEqual([]);
  });
});
