import { describe, expect, it } from "vitest";
import { resolveRouterBasename } from "@/lib/router";

describe("resolveRouterBasename", () => {
  it("uses the root basename for the primary entrypoint", () => {
    expect(resolveRouterBasename("/")).toBe("/");
    expect(resolveRouterBasename("/cases")).toBe("/");
    expect(resolveRouterBasename("/analytics")).toBe("/");
  });

  it("uses the legacy /app basename for backward-compatible routes", () => {
    expect(resolveRouterBasename("/app")).toBe("/app");
    expect(resolveRouterBasename("/app/")).toBe("/app");
    expect(resolveRouterBasename("/app/cases")).toBe("/app");
  });

  it("does not treat unrelated prefixes as the legacy app route", () => {
    expect(resolveRouterBasename("/application")).toBe("/");
    expect(resolveRouterBasename("/app-shell")).toBe("/");
  });
});
