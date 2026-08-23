/**
 * Case mutation write-freeze error detection.
 *
 * Production gates POST/PUT/DELETE /api/v1/cases* behind
 * IMMI_CASE_MUTATIONS_ENABLED. When it's off, the Worker returns a typed
 * 503 `{ error, code: "case_mutations_disabled" }`
 * (see workers/case-api/cloudflare_mutations.js). `apiFetch` must surface
 * that `code` on the thrown error so callers can distinguish it from any
 * other failure, and `isCaseMutationsDisabledError` must recognize it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  apiFetch,
  ApiError,
  isCaseMutationsDisabledError,
  CASE_MUTATIONS_DISABLED_CODE,
} from "@/lib/api";

function jsonResponse(
  data: unknown,
  init: { ok: boolean; status: number; statusText?: string },
): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? "",
    json: async () => data,
  } as Response;
}

describe("isCaseMutationsDisabledError", () => {
  it("returns true for an ApiError carrying the case_mutations_disabled code", () => {
    const err = new ApiError(
      "Case mutations are disabled during migration freeze",
      503,
      CASE_MUTATIONS_DISABLED_CODE,
    );
    expect(isCaseMutationsDisabledError(err)).toBe(true);
  });

  it("returns false for an ApiError with a different code", () => {
    const err = new ApiError("Not found", 404, "not_found");
    expect(isCaseMutationsDisabledError(err)).toBe(false);
  });

  it("returns false for an ApiError with no code at all", () => {
    const err = new ApiError("Request timeout after 20 seconds", 0);
    expect(isCaseMutationsDisabledError(err)).toBe(false);
  });

  it("returns false for a plain Error (non-ApiError)", () => {
    expect(isCaseMutationsDisabledError(new Error("boom"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isCaseMutationsDisabledError(null)).toBe(false);
    expect(isCaseMutationsDisabledError(undefined)).toBe(false);
    expect(isCaseMutationsDisabledError(CASE_MUTATIONS_DISABLED_CODE)).toBe(
      false,
    );
  });
});

describe("apiFetch — case mutation write freeze", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an ApiError carrying status 503 and code case_mutations_disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: "Case mutations are disabled during migration freeze",
          code: CASE_MUTATIONS_DISABLED_CODE,
        },
        { ok: false, status: 503, statusText: "Service Unavailable" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await apiFetch("/api/v1/cases/abc123456789");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(503);
    expect((caught as ApiError).code).toBe(CASE_MUTATIONS_DISABLED_CODE);
    expect((caught as ApiError).message).toBe(
      "Case mutations are disabled during migration freeze",
    );
    expect(isCaseMutationsDisabledError(caught)).toBe(true);
  });

  it("does not classify an unrelated 503 as the mutation freeze", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        { error: "Cloudflare case mutation unavailable", code: "cloudflare_case_mutation_unavailable" },
        { ok: false, status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await apiFetch("/api/v1/cases/abc123456789");
    } catch (err) {
      caught = err;
    }

    expect(isCaseMutationsDisabledError(caught)).toBe(false);
  });
});
