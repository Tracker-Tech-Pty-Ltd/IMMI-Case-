import { afterEach, describe, expect, it, vi } from "vitest";
import { scrapeLegislation } from "../legislation";
import type { Env } from "../types";

describe("native legislation importer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches the TOC and sections, then writes a checksum-addressed R2 object", async () => {
    const responses = [
      new Response('<a href="s1.html">1 Short title</a><a href="s2.html">2 Commencement</a>'),
      new Response("<div>MIGRATION ACT 1958 - SECT 1 Short title</div>"),
      new Response("<div>MIGRATION ACT 1958 - SECT 2 Commencement</div>"),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift() as Response));
    let written: Uint8Array | null = null;
    let metadata: Record<string, string> | undefined;
    const env = {
      CASE_RESULTS: {
        put: vi.fn(async (_key: string, value: Uint8Array, options: { customMetadata: Record<string, string> }) => {
          written = value;
          metadata = options.customMetadata;
        }),
        head: vi.fn(async () => ({ size: written?.byteLength, customMetadata: metadata })),
      },
    } as unknown as Env;
    await scrapeLegislation(env, "migration-act-1958");
    expect(written).not.toBeNull();
    expect(metadata?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.parse(new TextDecoder().decode(written as unknown as Uint8Array));
    expect(payload).toMatchObject({ id: "migration-act-1958", sections_count: 2 });
    expect(payload.sections[0].text).toContain("Short title");
  });
});
