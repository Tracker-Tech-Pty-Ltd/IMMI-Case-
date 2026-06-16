import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import type { Env, ScrapeJob } from "../types";

describe("pipeline scrape queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes pipeline scrape results under the run prefix and forwards to extract", async () => {
    const puts = new Map<string, string>();
    const extractMessages: unknown[] = [];
    const ack = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><body>
        <h1>Applicant v Minister [2026] FCA 42</h1>
        <p>CATCHWORDS: MIGRATION - protection visa - Subclass 866</p>
        <p>The applicant is a citizen of India. The applicant was represented by Mr Smith.</p>
        <p>This body is intentionally longer than fifty characters so extraction succeeds.</p>
      </body></html>
    `, { status: 200 })));

    const env = {
      PIPELINE_ENABLED: "true",
      CASE_RESULTS: {
        head: vi.fn(async () => null),
        put: vi.fn(async (key: string, value: string) => {
          puts.set(key, value);
          return null;
        }),
      },
      EXTRACT_QUEUE: {
        send: vi.fn(async (message: unknown) => {
          extractMessages.push(message);
          return { metadata: { metrics: { messages: 1 } } };
        }),
      },
    } as unknown as Env;

    const job: ScrapeJob = {
      phase: "scrape",
      run_id: "11111111-1111-4111-8111-111111111111",
      case_id: "abcdef123456",
      url: "https://www.austlii.edu.au/au/cases/cth/FCA/2026/42.html",
      citation: "[2026] FCA 42",
      court_code: "FCA",
      title: "Applicant v Minister [2026] FCA 42",
    };

    await worker.queue({
      queue: "austlii-scrape-queue",
      messages: [{ body: job, ack, retry: vi.fn() }],
    } as never, env);

    const jsonKey = "runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.json";
    expect(puts.has(jsonKey)).toBe(true);
    expect(puts.has("runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.html")).toBe(true);
    expect(extractMessages).toEqual([
      expect.objectContaining({
        phase: "extract",
        run_id: job.run_id,
        case_id: job.case_id,
        court_code: "FCA",
        r2_key: jsonKey,
      }),
    ]);
    expect(ack).toHaveBeenCalledOnce();
  });
});
