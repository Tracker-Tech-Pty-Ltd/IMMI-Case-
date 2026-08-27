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
      NATIVE_PIPELINE_ENABLED: "true",
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

  it("retries a case when AustLII returns 5xx instead of dropping it", async () => {
    const puts = new Map<string, string>();
    const ack = vi.fn();
    const retry = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503, statusText: "Service Unavailable" })));

    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      CASE_RESULTS: {
        head: vi.fn(async () => null),
        put: vi.fn(async (key: string, value: string) => {
          puts.set(key, value);
          return null;
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
      messages: [{ body: job, ack, retry }],
    } as never, env);

    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
    const errorJson = puts.get("runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.error.json");
    expect(errorJson).toBeDefined();
    expect(JSON.parse(errorJson as string)).toMatchObject({ error_code: 503 });
  });

  it("records and acks a 404 without retrying", async () => {
    const puts = new Map<string, string>();
    const ack = vi.fn();
    const retry = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })));

    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      CASE_RESULTS: {
        head: vi.fn(async () => null),
        put: vi.fn(async (key: string, value: string) => {
          puts.set(key, value);
          return null;
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
      messages: [{ body: job, ack, retry }],
    } as never, env);

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries a page that yields too little text", async () => {
    const puts = new Map<string, string>();
    const ack = vi.fn();
    const retry = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html><body>hi</body></html>", { status: 200 })));

    const env = {
      PIPELINE_ENABLED: "true",
      NATIVE_PIPELINE_ENABLED: "true",
      CASE_RESULTS: {
        head: vi.fn(async () => null),
        put: vi.fn(async (key: string, value: string) => {
          puts.set(key, value);
          return null;
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
      messages: [{ body: job, ack, retry }],
    } as never, env);

    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });

  it.each(["/enqueue", "/scrape", "/progress", "/list", "/batch-get"]) (
    "returns 404 for HTTP trigger endpoint %s (cron-triggered only)",
    async (path) => {
      const response = await worker.fetch(
        new Request(`https://example.com${path}`, { method: "POST" }),
        { PIPELINE_ENABLED: "true", NATIVE_PIPELINE_ENABLED: "true" } as unknown as Env,
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "cron_only" });
    },
  );
});
