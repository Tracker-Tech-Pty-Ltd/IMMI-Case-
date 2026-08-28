/**
 * frontend/__tests__/api-csrf-lifecycle.test.ts
 *
 * The Worker mints a stateless double-submit CSRF token that expires after
 * CSRF_TTL_MS = 1h (workers/auth/csrf.js:1), mirrored into the `__Host-csrf`
 * cookie with a matching Max-Age. The client caches the token for the tab's
 * lifetime, so it must (a) fail loudly when the token endpoint fails and
 * (b) recover from the resulting 403 by re-minting and replaying once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, clearCsrfToken } from "@/lib/api";

function jsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
  } as Response;
}

const CSRF_URL = "/api/v1/csrf-token";
const MUTATION_URL = "/api/v1/cases";

beforeEach(() => {
  vi.restoreAllMocks();
  // The token cache is module-level; reset it so tests cannot bleed.
  clearCsrfToken();
});

describe("fetchCsrfToken", () => {
  it("throws instead of sending an undefined CSRF header when the endpoint fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        return jsonResponse(
          {
            error: "csrf_secret_not_configured",
            code: "csrf_secret_not_configured",
          },
          503,
        );
      }
      throw new Error(`Mutation must not be attempted. Got: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the endpoint returns 200 with no token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) return jsonResponse({});
      throw new Error(`Mutation must not be attempted. Got: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "csrf_token_missing" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch — stale CSRF recovery", () => {
  it("clears the cached token and replays a mutation exactly once after 403 csrf_expired", async () => {
    const tokens = ["token-1", "token-2"];
    let tokenIdx = 0;
    const sentTokens: (string | undefined)[] = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(CSRF_URL)) {
          return jsonResponse({ csrf_token: tokens[tokenIdx++] });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sentTokens.push(headers["X-CSRFToken"]);
        if (sentTokens.length === 1) {
          return jsonResponse({ error: "csrf", code: "csrf_expired" }, 403);
        }
        return jsonResponse({ success: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ success: boolean }>(MUTATION_URL, {
      method: "POST",
      body: "{}",
    });

    expect(result.success).toBe(true);
    expect(sentTokens).toEqual(["token-1", "token-2"]);
    expect(tokenIdx).toBe(2);
  });

  it("retries at most once and then surfaces the error", async () => {
    let posts = 0;
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        tokenRequests += 1;
        return jsonResponse({ csrf_token: `t${tokenRequests}` });
      }
      posts += 1;
      return jsonResponse({ error: "csrf", code: "csrf_expired" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ status: 403, code: "csrf_expired" });
    expect(posts).toBe(2);
    expect(tokenRequests).toBe(2);
  });

  it("does not retry a 403 that is not a CSRF failure", async () => {
    let posts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) return jsonResponse({ csrf_token: "t1" });
      posts += 1;
      return jsonResponse(
        { error: "Admin access required", code: "admin_required" },
        403,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ status: 403, code: "admin_required" });
    expect(posts).toBe(1);
  });

  it("does not retry a GET", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        throw new Error("A GET must not request a CSRF token");
      }
      gets += 1;
      return jsonResponse({ error: "forbidden", code: "forbidden" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch(MUTATION_URL)).rejects.toMatchObject({
      status: 403,
    });
    expect(gets).toBe(1);
  });

  it("mints exactly one token for two concurrent mutations", async () => {
    // Models the Worker's Set-Cookie mirror: the LAST token minted is the one
    // the cookie holds, and only a header matching that cookie is accepted.
    let cookieToken: string | null = null;
    let mints = 0;
    const rejected: string[] = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(CSRF_URL)) {
          mints += 1;
          cookieToken = `t${mints}`;
          // Mints are not instantaneous; give the second caller a chance to
          // observe the empty cache if the single-flight guard is missing.
          await new Promise((r) => setTimeout(r, 0));
          return jsonResponse({ csrf_token: cookieToken });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const sent = headers["X-CSRFToken"];
        if (sent !== cookieToken) {
          rejected.push(String(sent));
          return jsonResponse({ error: "csrf", code: "csrf" }, 403);
        }
        return jsonResponse({ success: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      apiFetch<{ success: boolean }>(MUTATION_URL, {
        method: "POST",
        body: "{}",
      }),
      apiFetch<{ success: boolean }>(MUTATION_URL, {
        method: "POST",
        body: "{}",
      }),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    // The binding assertions: one mint, and no request was ever rejected for
    // holding a token the cookie had already replaced.
    expect(mints).toBe(1);
    expect(rejected).toEqual([]);
  });
});
