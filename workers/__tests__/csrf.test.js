import { describe, expect, it } from "vitest";
import { getCsrfToken, verifyCsrf } from "../auth/csrf.js";

describe("native CSRF double-submit boundary", () => {
  it("issues a cookie/header token and verifies the same token", async () => {
    const response = await getCsrfToken({ CSRF_SECRET: "test-secret" });
    expect(response.status).toBe(200);
    const token = (await response.json()).csrf_token;
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const request = new Request("https://immi.example/api/v1/write", {
      headers: { "X-CSRFToken": token, Cookie: cookie },
    });
    expect(await verifyCsrf(request, { CSRF_SECRET: "test-secret" })).toBeNull();
  });

  it("rejects a mismatched cookie/header", async () => {
    const response = await verifyCsrf(new Request("https://immi.example/api/v1/write", {
      headers: { "X-CSRFToken": "header", Cookie: "__Host-csrf=cookie" },
    }), { CSRF_SECRET: "test-secret" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "csrf" });
  });
});
