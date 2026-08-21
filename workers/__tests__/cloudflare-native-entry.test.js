import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const mockCaseRead = vi.fn();
const mockCouncil = vi.fn();
const mockLogin = vi.fn();
const mockCallback = vi.fn();
const mockMe = vi.fn();
const mockLogout = vi.fn();
const mockRefresh = vi.fn();
const mockSwitchTenant = vi.fn();

vi.mock("../case-api/cloudflare.js", () => ({
  dispatchCloudflareCaseRead: (...args) => mockCaseRead(...args),
}));
vi.mock("../llm-council/cloudflare_handlers.js", () => ({
  dispatchCloudflareCouncil: (...args) => mockCouncil(...args),
}));
vi.mock("../auth/cloudflare_handlers.js", () => ({
  handleTelegramLogin: (...args) => mockLogin(...args),
  handleTelegramCallback: (...args) => mockCallback(...args),
  handleAuthMe: (...args) => mockMe(...args),
  handleAuthLogout: (...args) => mockLogout(...args),
  handleAuthRefresh: (...args) => mockRefresh(...args),
  handleAuthSwitchTenant: (...args) => mockSwitchTenant(...args),
}));

import worker from "../cloudflare-native.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockCaseRead.mockResolvedValue(null);
  mockCouncil.mockResolvedValue(null);
});

describe("standalone Cloudflare-native entrypoint", () => {
  it("has no static legacy Postgres, Hyperdrive, or Flask dependency", () => {
    const source = readFileSync(fileURLToPath(new URL("../cloudflare-native.js", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from\s+["']postgres["']/);
    expect(source).not.toContain("HYPERDRIVE");
    expect(source).not.toContain("FlaskBackend");
  });

  it("fails closed unless its explicit runtime mode is cloudflare", async () => {
    const response = await worker.fetch(new Request("https://immi.example/api/v1/cases"), {
      IMMI_STORAGE_MODE: "legacy",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "cloudflare_mode_required" });
    expect(mockCaseRead).not.toHaveBeenCalled();
  });

  it("routes Cloudflare case reads without a legacy adapter", async () => {
    mockCaseRead.mockResolvedValue(new Response("case-data"));
    const response = await worker.fetch(new Request("https://immi.example/api/v1/cases"), {
      IMMI_STORAGE_MODE: "cloudflare",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("case-data");
    expect(mockCaseRead).toHaveBeenCalledOnce();
  });

  it("routes Council requests through the standalone Council dispatcher", async () => {
    mockCouncil.mockResolvedValue(new Response("council-data"));
    const response = await worker.fetch(new Request("https://immi.example/api/v1/llm-council/sessions"), {
      IMMI_STORAGE_MODE: "cloudflare",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("council-data");
    expect(mockCouncil).toHaveBeenCalledOnce();
  });

  it("serves dashboard stats through the native case dispatcher", async () => {
    mockCaseRead.mockResolvedValue(new Response(JSON.stringify({ total_cases: 1 }), {
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(new Request("https://immi.example/api/v1/stats"), {
      IMMI_STORAGE_MODE: "cloudflare",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total_cases: 1 });
    expect(mockCaseRead).toHaveBeenCalledOnce();
  });
});
