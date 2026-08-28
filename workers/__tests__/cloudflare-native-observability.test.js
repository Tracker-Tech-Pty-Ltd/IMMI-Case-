/**
 * Request-correlation contract for the production Worker entrypoint.
 *
 * Cloudflare Trace Events already group one invocation's console lines; what
 * this covers is the part Cloudflare cannot supply — an id echoed back to the
 * caller, and tenant/user attribution derived from a *verified* token.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCaseRead = vi.fn();
const mockCouncil = vi.fn();
const noop = vi.fn();

vi.mock("../case-api/cloudflare.js", () => ({
  dispatchCloudflareCaseRead: (...args) => mockCaseRead(...args),
}));
vi.mock("../llm-council/cloudflare_handlers.js", () => ({
  dispatchCloudflareCouncil: (...args) => mockCouncil(...args),
}));
vi.mock("../auth/cloudflare_handlers.js", () => ({
  handleTelegramLogin: (...args) => noop(...args),
  handleTelegramCallback: (...args) => noop(...args),
  handleBootstrapLogin: (...args) => noop(...args),
  handleAuthMe: (...args) => noop(...args),
  handleAuthLogout: (...args) => noop(...args),
  handleAuthRefresh: (...args) => noop(...args),
  handleAuthSwitchTenant: (...args) => noop(...args),
}));

import worker from "../cloudflare-native.js";
import { signJwt } from "../auth/jwt.js";

const baseEnv = {
  IMMI_STORAGE_MODE: "cloudflare",
  JWT_SECRET_CURRENT: "test-secret-value-for-observability",
  JWT_KID_CURRENT: "kid-test",
};

let logSpy;

beforeEach(() => {
  vi.clearAllMocks();
  mockCaseRead.mockResolvedValue(null);
  mockCouncil.mockResolvedValue(null);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function accessLines() {
  return logSpy.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter((entry) => entry && entry.event === "cloudflare.request");
}

describe("Worker request correlation", () => {
  it("echoes the Cloudflare Ray ID back as X-Request-Id", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    const response = await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "8abc123def456789-SYD" } }),
      baseEnv,
    );
    expect(response.headers.get("X-Request-Id")).toBe("8abc123def456789-SYD");
    expect(await response.text()).toBe("case-data");
  });

  it("generates an id when there is no Ray ID", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    const response = await worker.fetch(new Request("https://immi.example/api/v1/cases"), baseEnv);
    const id = response.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("emits exactly one access line carrying method, path, status and duration", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data", { status: 200 }));
    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "ray-1" } }),
      baseEnv,
    );
    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      request_id: "ray-1",
      method: "GET",
      path: "/api/v1/cases",
      status: 200,
    });
    expect(typeof lines[0].duration_ms).toBe("number");
  });

  it("attributes the access line to the verified token's user and tenant", async () => {
    const token = await signJwt(
      { sub: "user-abc", tenant_id: "tenant-xyz", exp: Math.floor(Date.now() / 1000) + 300 },
      baseEnv,
    );
    mockCaseRead.mockResolvedValue(new Response("case-data"));

    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { Authorization: `Bearer ${token}` } }),
      baseEnv,
    );

    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].user_id).toBe("user-abc");
    expect(lines[0].tenant_id).toBe("tenant-xyz");
  });

  it("does not attribute a forged token", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    await worker.fetch(
      new Request("https://immi.example/api/v1/cases", { headers: { Authorization: "Bearer not.a.jwt" } }),
      baseEnv,
    );
    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].user_id).toBeUndefined();
    expect(lines[0].tenant_id).toBeUndefined();
  });

  it("covers /health but not static assets", async () => {
    await worker.fetch(new Request("https://immi.example/health"), baseEnv);
    expect(accessLines()).toHaveLength(1);

    logSpy.mockClear();
    const assetResponse = await worker.fetch(new Request("https://immi.example/app/cases"), {
      ...baseEnv,
      ASSETS: { fetch: async () => new Response("<html></html>", { status: 200 }) },
    });
    expect(accessLines()).toHaveLength(0);
    expect(assetResponse.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("still logs — and still rethrows — when the handler throws", async () => {
    // The regression this covers: the first draft of the wrapper awaited
    // handlers.fetch() with no catch, so a throwing handler produced NO access
    // line at all — the one case an operator most needs to find.
    const boom = new Error("dispatcher exploded");
    mockCaseRead.mockRejectedValue(boom);

    await expect(
      worker.fetch(
        new Request("https://immi.example/api/v1/cases", { headers: { "cf-ray": "ray-boom" } }),
        baseEnv,
      ),
    ).rejects.toBe(boom); // same object, unwrapped — plans/005 depends on this

    const lines = accessLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      request_id: "ray-boom",
      path: "/api/v1/cases",
      outcome: "handler_threw",
      status: null,
    });
    expect(lines[0].error).toContain("dispatcher exploded");
  });
});
