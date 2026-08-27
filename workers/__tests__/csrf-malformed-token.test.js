import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));

import { verifyCsrf } from "../auth/csrf.js";
import { dispatchCloudflareCaseAction } from "../case-api/cloudflare_actions.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockStores.mockReturnValue({
    identityStore: { assertMembership: vi.fn(async () => ({ userId: "u", tenantId: "t", role: "member" })) },
  });
});

describe("CSRF verification against a malformed token", () => {
  it("returns 403 when the payload segment is not base64url", async () => {
    const request = new Request("https://immi.example/api/v1/write", {
      headers: { "X-CSRFToken": "abc!.def!", Cookie: "__Host-csrf=abc!.def!" },
    });
    const response = await verifyCsrf(request, { CSRF_SECRET: "test-secret" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "csrf" });
  });

  it("returns 403 when the signature segment is not base64url", async () => {
    const payload = btoa("aa.9999999999999").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${payload}.@@@@`;
    const request = new Request("https://immi.example/api/v1/write", {
      headers: { "X-CSRFToken": token, Cookie: `__Host-csrf=${token}` },
    });
    const response = await verifyCsrf(request, { CSRF_SECRET: "test-secret" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "csrf" });
  });

  it("maps a crafted malformed token to 403, not a generic 503, through the action dispatcher", async () => {
    const request = new Request("https://immi.example/api/v1/taxonomy/guided-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "abc!.def!", Cookie: "__Host-csrf=abc!.def!" },
      body: JSON.stringify({ flow: "find-precedents", visa_subclass: "866" }),
    });
    const response = await dispatchCloudflareCaseAction(request, "/api/v1/taxonomy/guided-search", {
      IMMI_STORAGE_MODE: "cloudflare", CSRF_SECRET: "test-secret",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "csrf" });
  });
});
