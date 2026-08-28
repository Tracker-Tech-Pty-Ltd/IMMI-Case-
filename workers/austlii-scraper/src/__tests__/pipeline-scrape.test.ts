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
      <html><body><div id="page-main">
        <p>Applicant v Minister [2026] FCA 42<br/>
        Coram: Brown J<br/>
        CATCHWORDS: MIGRATION - protection visa - Subclass 866<br/>
        Date of judgment: 3 February 2026<br/>
        The Court orders that the application be dismissed.<br/>
        This body is intentionally longer than fifty characters so extraction succeeds.<br/>
        Migration Act 1958 (Cth) s 476.</p>
      </div></body></html>
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
      citation: "PLACEHOLDER-CITATION",
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
    // Round-trip: the JSON we just wrote to R2 must carry parsed fields, not
    // nulls. Values verified against parser.ts at HEAD (workers/austlii-scraper).
    const stored = JSON.parse(puts.get(jsonKey) as string);
    expect(stored).toMatchObject({
      case_id: "abcdef123456",
      url: job.url,
      citation: "[2026] FCA 42",          // extracted, not job.citation
      court_code: "FCA",
      title: "Applicant v Minister [2026] FCA 42",
      success: true,
      judges: "Brown J",
      date: "3 February 2026",
      catchwords: "MIGRATION - protection visa - Subclass 866",
      outcome: "The Court orders that the application be dismissed.",
      visa_type: "protection visa",
      legislation: "Migration Act 1958 (Cth) s 476",
    });
    expect(stored.full_text).toContain("This body is intentionally longer than fifty characters");
    expect(typeof stored.scraped_at).toBe("string");
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

  // EXPECTED TO FAIL until parser.ts defect D1 is fixed (see plans/040
  // "Maintenance notes"). Real AustLII pages use consecutive block elements and
  // inline <a> links, not <br/>-separated single paragraphs. stripHtmlTags at
  // parser.ts:211 eats everything between a block tag's own '>' and the next
  // '>' anywhere in the document, so this shape loses the citation heading and
  // the outcome sentence before extractMetadata ever sees them.
  it.fails("round-trips realistic block-level AustLII HTML to R2", async () => {
    const puts = new Map<string, string>();
    const extractMessages: unknown[] = [];
    const ack = vi.fn();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><body><div id="page-main">
        <h1>Applicant v Minister [2026] FCA 42</h1>
        <p>Coram: <a href="/j/brown">Brown J</a></p>
        <p>CATCHWORDS: MIGRATION - protection visa - Subclass 866</p>
        <p>Date of judgment: 3 February 2026</p>
        <p>The Court orders that the application be dismissed.</p>
        <p>This body is intentionally longer than fifty characters so extraction succeeds.</p>
        <p>Migration Act 1958 (Cth) s 476.</p>
      </div></body></html>
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
      citation: "PLACEHOLDER-CITATION",
      court_code: "FCA",
      title: "Applicant v Minister [2026] FCA 42",
    };

    await worker.queue({
      queue: "austlii-scrape-queue",
      messages: [{ body: job, ack, retry: vi.fn() }],
    } as never, env);

    const jsonKey = "runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.json";
    const stored = JSON.parse(puts.get(jsonKey) as string);
    expect(stored).toMatchObject({
      citation: "[2026] FCA 42",
      title: "Applicant v Minister [2026] FCA 42",
      judges: "Brown J",
      outcome: "The Court orders that the application be dismissed.",
    });
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
