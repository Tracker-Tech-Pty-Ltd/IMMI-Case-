import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCaseRead = vi.fn();
const mockCouncil = vi.fn();

vi.mock("../case-api/cloudflare.js", () => ({
  dispatchCloudflareCaseRead: (...args) => mockCaseRead(...args),
}));
vi.mock("../llm-council/cloudflare_handlers.js", () => ({
  dispatchCloudflareCouncil: (...args) => mockCouncil(...args),
}));
vi.mock("../auth/cloudflare_handlers.js", () => ({
  handleTelegramLogin: vi.fn(),
  handleTelegramCallback: vi.fn(),
  handleBootstrapLogin: vi.fn(),
  handleAuthMe: vi.fn(),
  handleAuthLogout: vi.fn(),
  handleAuthRefresh: vi.fn(),
  handleAuthSwitchTenant: vi.fn(),
}));

import worker from "../cloudflare-native.js";

const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

function makeEnv() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    ASSETS: {
      fetch: vi.fn(async () => new Response(SHELL, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCaseRead.mockResolvedValue(null);
  mockCouncil.mockResolvedValue(null);
});

describe("SPA static-asset security headers", () => {
  it("hardens the SPA shell against framing, sniffing, referrer leaks and TLS downgrade", async () => {
    const env = makeEnv();
    const response = await worker.fetch(new Request("https://immi.example/"), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=300");
    expect(response.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()",
    );

    // Exact value, not a bag of `toContain` substrings. A substring check
    // cannot detect an EXTRA directive or an extra origin appended to an
    // existing one, which is the drift that actually matters for a CSP.
    expect(response.headers.get("Content-Security-Policy")).toBe([
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "script-src 'self' https://static.cloudflareinsights.com https://telegram.org",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://telegram.org https://t.me",
      "connect-src 'self' https://cloudflareinsights.com",
      "frame-src 'self' https://oauth.telegram.org https://telegram.org",
      "worker-src 'self' blob:",
    ].join("; "));
  });

  it("sends HSTS on an API response too, not only on assets", async () => {
    // A Telegram login lands on /api/v1/auth/telegram/callback, which returns
    // a 302 long before the asset branch. Under an assets-only wrapper that
    // navigation would carry no HSTS at all.
    const env = makeEnv();
    const response = await worker.fetch(
      new Request("https://immi.example/api/v1/definitely-not-a-route"),
      env,
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=300");
    // ...but document-level policy stays off the JSON API.
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("omits HSTS over plain HTTP so localhost is never pinned to TLS", async () => {
    const response = await worker.fetch(new Request("http://localhost:8787/"), makeEnv());
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("gives the built bundle no way to execute inline or eval'd script", async () => {
    const response = await worker.fetch(
      new Request("https://immi.example/cases"),
      makeEnv(),
    );
    const csp = response.headers.get("Content-Security-Policy") || "";
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) || "";

    expect(scriptSrc).not.toBe("");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // The Telegram Login Widget is the only third-party script the SPA loads.
    expect(scriptSrc).toContain("https://telegram.org");
  });

  it("preserves the upstream asset status, content type and cache headers", async () => {
    const env = makeEnv();
    env.ASSETS.fetch = vi.fn(async () => new Response("body{}", {
      status: 200,
      headers: {
        "content-type": "text/css",
        "cache-control": "public, max-age=31536000, immutable",
      },
    }));

    const response = await worker.fetch(
      new Request("https://immi.example/assets/index-CTTHblj6.css"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("still fails closed when the ASSETS binding throws", async () => {
    const env = makeEnv();
    env.ASSETS.fetch = vi.fn(async () => {
      throw new Error("ASSETS binding is misconfigured");
    });

    const response = await worker.fetch(new Request("https://immi.example/"), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_route_unavailable" });
  });
});
