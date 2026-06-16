import type { CourtCode } from "./pipeline-config";
import {
  COURT_INFO,
  IMMIGRATION_KEYWORDS,
  getDiscoveryYears,
  normalizeForCaseId,
  parsePositiveInt,
} from "./pipeline-config";
import {
  discoveryTargetTable,
  findExistingCases,
  updatePipelineRun,
} from "./pipeline-db";
import type { Env, ScrapeJob } from "./types";

const AUSTLII_BASE = "https://www.austlii.edu.au";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev/v2";

type FirecrawlProxy = "basic" | "enhanced" | "auto";

interface ListingFetchResult {
  html: string | null;
  errors: string[];
}

interface FirecrawlScrapePayload {
  success?: boolean;
  data?: {
    rawHtml?: string;
    html?: string;
    markdown?: string;
  };
  error?: string;
  details?: unknown;
}

export interface DiscoveryCandidate {
  case_id: string;
  url: string;
  citation: string;
  court_code: CourtCode;
  title: string;
  year: number;
}

export interface DiscoveryResult {
  court: CourtCode;
  candidate_urls: string[];
  new_case_urls: string[];
  new_cases: DiscoveryCandidate[];
  skipped_reason?: "rate_anomaly" | "paused" | "court_disabled";
  errors: string[];
}

export async function caseIdOf(citation: string, url: string): Promise<string> {
  const payload = `${normalizeForCaseId(citation)}||${normalizeForCaseId(url)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

export function parseAustliiListing(
  html: string,
  court: CourtCode,
  year: number,
): Array<Omit<DiscoveryCandidate, "case_id">> {
  const info = COURT_INFO[court];
  const links: Array<Omit<DiscoveryCandidate, "case_id">> = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\s+[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const rawHref = decodeHtml(match[2]).trim();
    const title = stripHtml(match[3]);
    if (!rawHref || !title) continue;

    if (!isCaseHref(rawHref, court, year)) continue;

    const context = enclosingBlockText(html, match.index, anchorPattern.lastIndex).toLowerCase();
    if (!info.immigrationOnly && !IMMIGRATION_KEYWORDS.some((keyword) => context.includes(keyword))) {
      continue;
    }

    const url = absoluteAustliiUrl(rawHref).replace(/[.]+$/g, "");
    if (seen.has(url)) continue;
    seen.add(url);

    const citation = extractCitation(title, court, year);
    links.push({
      url,
      citation,
      court_code: court,
      title,
      year,
    });
  }

  return links;
}

export async function discoverCourt(
  env: Env,
  court: CourtCode,
  runId: string,
  scheduledTime = Date.now(),
): Promise<DiscoveryResult> {
  const lookbackYears = parsePositiveInt(env.PIPELINE_DISCOVERY_LOOKBACK_YEARS, 2, 1, 10);
  const rateLimitMs = parsePositiveInt(env.PIPELINE_PER_COURT_RATE_LIMIT_MS, 1500, 0, 60_000);
  const years = getDiscoveryYears(scheduledTime, lookbackYears).filter((year) =>
    shouldScanCourtYear(court, year)
  );
  const errors: string[] = [];
  const candidates: DiscoveryCandidate[] = [];

  for (const year of years) {
    try {
      const html = await fetchListing(env, court, year, runId);
      const parsed = parseAustliiListing(html, court, year);
      for (const item of parsed) {
        candidates.push({
          ...item,
          case_id: await caseIdOf(item.citation, item.url),
        });
      }
    } catch (err) {
      errors.push(`${court}/${year}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  const table = discoveryTargetTable(env);
  const existing = await findExistingCases(
    env,
    table,
    court,
    candidates.map((candidate) => candidate.case_id),
    candidates.map((candidate) => candidate.url),
  );
  const newCases = candidates.filter(
    (candidate) => !existing.has(candidate.case_id) && !existing.has(candidate.url),
  );

  const p90 = await loadCourtP90(env, court);
  if (p90 !== null && p90 > 0 && newCases.length > p90 * 3) {
    return {
      court,
      candidate_urls: candidates.map((candidate) => candidate.url),
      new_case_urls: [],
      new_cases: [],
      skipped_reason: "rate_anomaly",
      errors,
    };
  }

  return {
    court,
    candidate_urls: candidates.map((candidate) => candidate.url),
    new_case_urls: newCases.map((candidate) => candidate.url),
    new_cases: newCases,
    errors,
  };
}

export async function runDiscoveryAndEnqueue(
  env: Env,
  runId: string,
  courts: CourtCode[],
  scheduledTime = Date.now(),
): Promise<void> {
  let discovered = 0;
  const errors: string[] = [];

  for (const court of courts) {
    const result = await discoverCourt(env, court, runId, scheduledTime);
    discovered += result.new_cases.length;
    errors.push(...result.errors);

    if (result.skipped_reason) {
      errors.push(`${court}: skipped (${result.skipped_reason})`);
      continue;
    }

    const jobs = result.new_cases.map((candidate): { body: ScrapeJob } => ({
      body: {
        case_id: candidate.case_id,
        url: candidate.url,
        citation: candidate.citation,
        court_code: candidate.court_code,
        title: candidate.title,
        run_id: runId,
        phase: "scrape",
        discovered_at: new Date(scheduledTime).toISOString(),
      },
    }));

    for (const chunk of chunkArray(jobs, 25)) {
      if (chunk.length > 0) {
        await env.SCRAPE_QUEUE.sendBatch(chunk);
      }
    }

    console.log(JSON.stringify({
      event: "cron.discover.court_complete",
      run_id: runId,
      court,
      candidates: result.candidate_urls.length,
      new_cases: result.new_cases.length,
      skipped_reason: result.skipped_reason ?? null,
      errors: result.errors.length,
    }));
  }

  await updatePipelineRun(env, runId, {
    discovered,
    errors: errors.length,
    errorsJson: errors.length ? errors : undefined,
    status: errors.length ? "failed" : "ok",
  });
}

async function fetchListing(env: Env, court: CourtCode, year: number, runId: string): Promise<string> {
  const primaryUrl = `${AUSTLII_BASE}/au/cases/cth/${court}/${year}/`;
  const fallbackUrl = `${AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/${court}/?year=${year}`;
  const direct = await fetchListingDirect([primaryUrl, fallbackUrl]);
  if (direct.html) return direct.html;

  const browser = await fetchListingWithBrowser(env, [primaryUrl, fallbackUrl]);
  if (browser.html) return browser.html;

  const firecrawl = await fetchListingWithFirecrawl(env, [primaryUrl, fallbackUrl], runId);
  if (firecrawl.html) return firecrawl.html;

  const directSuffix = direct.errors.length ? direct.errors.join("; ") : "no direct response";
  const browserSuffix = browser.errors.length ? `; browser fallback: ${browser.errors.join("; ")}` : "";
  const firecrawlSuffix = firecrawl.errors.length
    ? `; firecrawl fallback: ${firecrawl.errors.join("; ")}`
    : "";
  throw new Error(`listing fetch failed: ${directSuffix}${browserSuffix}${firecrawlSuffix}`);
}

async function fetchListingDirect(urls: string[]): Promise<ListingFetchResult> {
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: discoveryHeaders(), redirect: "follow" });
      if (!response.ok) {
        errors.push(`${url}: ${response.status}`);
        continue;
      }

      const html = await response.text();
      if (!html.trim()) {
        errors.push(`${url}: ${response.status} empty response`);
        continue;
      }

      if (isCloudflareChallenge(html)) {
        errors.push(`${url}: ${response.status} Cloudflare challenge`);
        continue;
      }

      return { html, errors };
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { html: null, errors };
}

async function fetchListingWithFirecrawl(
  env: Env,
  urls: string[],
  runId: string,
): Promise<ListingFetchResult> {
  if (env.FIRECRAWL_ENABLED !== "true") return { html: null, errors: [] };
  if (!env.FIRECRAWL_API_KEY) return { html: null, errors: ["FIRECRAWL_API_KEY unavailable"] };

  const errors: string[] = [];
  const endpoint = `${firecrawlBaseUrl(env)}/scrape`;
  for (const url of urls) {
    try {
      const budget = await reserveFirecrawlCredits(env, runId);
      if (!budget.ok) {
        errors.push(`${url}: ${budget.reason}`);
        continue;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildFirecrawlScrapeBody(env, url)),
      });

      const payload = await readFirecrawlPayload(response);
      if (!response.ok) {
        errors.push(formatFirecrawlError(url, response, payload));
        continue;
      }

      const html = payload.data?.rawHtml ?? payload.data?.html ?? payload.data?.markdown ?? "";
      if (payload.success && html.trim()) {
        if (isCloudflareChallenge(html)) {
          errors.push(`${url}: firecrawl received Cloudflare challenge`);
          continue;
        }
        console.log(JSON.stringify({
          event: "discovery.firecrawl_fallback.success",
          url,
          proxy: firecrawlProxy(env),
        }));
        return { html, errors };
      }

      errors.push(`${url}: firecrawl empty result`);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.log(JSON.stringify({ event: "discovery.firecrawl_fallback.failed", errors }));
  }
  return { html: null, errors };
}

async function fetchListingWithBrowser(
  env: Env,
  urls: string[],
): Promise<ListingFetchResult> {
  if (!env.MYBROWSER) return { html: null, errors: ["MYBROWSER binding unavailable"] };

  const errors: string[] = [];
  for (const url of urls) {
    try {
      const response = await env.MYBROWSER.quickAction("content", {
        url,
        userAgent: USER_AGENT,
        setExtraHTTPHeaders: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-AU,en;q=0.9",
        },
        gotoOptions: {
          timeout: 60_000,
          waitUntil: "networkidle0",
        },
        waitForTimeout: 8_000,
        actionTimeout: 45_000,
        bestAttempt: true,
      });

      if (!response.ok) {
        errors.push(`${url}: browser ${response.status}`);
        continue;
      }

      const payload = (await response.json()) as { success?: boolean; result?: string; meta?: { status?: number } };
      if (payload.success && typeof payload.result === "string" && payload.result.trim()) {
        if (isCloudflareChallenge(payload.result)) {
          errors.push(`${url}: browser received Cloudflare challenge`);
          continue;
        }
        return { html: payload.result, errors };
      }

      errors.push(`${url}: browser empty result`);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.log(JSON.stringify({ event: "discovery.browser_fallback.failed", errors }));
  }
  return { html: null, errors };
}

function buildFirecrawlScrapeBody(env: Env, url: string): Record<string, unknown> {
  const timeout = parsePositiveInt(env.FIRECRAWL_TIMEOUT_MS, 60_000, 1_000, 300_000);
  const waitFor = parsePositiveInt(env.FIRECRAWL_WAIT_FOR_MS, 0, 0, 30_000);
  const body: Record<string, unknown> = {
    url,
    formats: ["rawHtml", "html"],
    onlyMainContent: false,
    timeout,
    waitFor,
    headers: discoveryHeaders(),
    location: {
      country: "AU",
      languages: ["en-AU", "en"],
    },
    removeBase64Images: true,
    blockAds: true,
    maxAge: 0,
    proxy: firecrawlProxy(env),
    storeInCache: env.FIRECRAWL_STORE_IN_CACHE === "true",
  };

  if (env.FIRECRAWL_ZERO_DATA_RETENTION === "true") {
    body.zeroDataRetention = true;
  }

  return body;
}

async function readFirecrawlPayload(response: Response): Promise<FirecrawlScrapePayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as FirecrawlScrapePayload;
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function formatFirecrawlError(
  url: string,
  response: Response,
  payload: FirecrawlScrapePayload,
): string {
  const retryAfter = response.headers.get("Retry-After");
  const retrySuffix = retryAfter ? ` retry_after=${retryAfter}s` : "";
  const message = payload.error ? ` ${payload.error}` : "";
  return `${url}: firecrawl ${response.status}${retrySuffix}${message}`.trim();
}

function firecrawlBaseUrl(env: Env): string {
  return (env.FIRECRAWL_API_BASE_URL || FIRECRAWL_DEFAULT_BASE_URL).replace(/\/+$/g, "");
}

function firecrawlProxy(env: Env): FirecrawlProxy {
  const raw = env.FIRECRAWL_PROXY;
  if (raw === "basic" || raw === "enhanced" || raw === "auto") return raw;
  return "auto";
}

async function reserveFirecrawlCredits(
  env: Env,
  runId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!env.PIPELINE_KV) return { ok: true };

  const estimate = estimateFirecrawlCredits(env);
  const runCap = parsePositiveInt(env.FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_RUN, 25, 1, 100_000);
  const monthCap = parsePositiveInt(
    env.FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_MONTH,
    1000,
    1,
    1_000_000,
  );
  const month = new Date().toISOString().slice(0, 7);
  const runKey = `firecrawl:run:${runId}:estimated_credits`;
  const monthKey = `firecrawl:month:${month}:estimated_credits`;
  const [runUsed, monthUsed] = await Promise.all([
    readKvNumber(env, runKey),
    readKvNumber(env, monthKey),
  ]);

  if (runUsed + estimate > runCap) {
    return {
      ok: false,
      reason: `firecrawl run credit cap exceeded (${runUsed}+${estimate}>${runCap})`,
    };
  }

  if (monthUsed + estimate > monthCap) {
    return {
      ok: false,
      reason: `firecrawl monthly credit cap exceeded (${monthUsed}+${estimate}>${monthCap})`,
    };
  }

  await Promise.all([
    env.PIPELINE_KV.put(runKey, String(runUsed + estimate), { expirationTtl: 7 * 24 * 60 * 60 }),
    env.PIPELINE_KV.put(monthKey, String(monthUsed + estimate), { expirationTtl: 45 * 24 * 60 * 60 }),
  ]);
  return { ok: true };
}

async function readKvNumber(env: Env, key: string): Promise<number> {
  const raw = await env.PIPELINE_KV?.get(key);
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function estimateFirecrawlCredits(env: Env): number {
  return firecrawlProxy(env) === "basic" ? 1 : 5;
}

function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("cf-mitigated") ||
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("challenge-platform") ||
    lower.includes("just a moment")
  );
}

function discoveryHeaders(): HeadersInit {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
  };
}

function shouldScanCourtYear(court: CourtCode, year: number): boolean {
  // AATA ended in 2024; ARTA covers 2025+ and is scanned separately in the same cron group.
  if (court === "AATA" && year >= 2025) return false;
  return true;
}

function isCaseHref(href: string, court: CourtCode, year: number): boolean {
  const path = decodeHtml(href);
  if (!path.includes(`/au/cases/cth/${court}/${year}/`)) return false;
  return /\/\d+\.html(?:[#?].*)?$/i.test(path);
}

function extractCitation(title: string, court: CourtCode, year: number): string {
  const citation = title.match(new RegExp(`\\[${year}\\]\\s+${court}\\s+\\d+`, "i"));
  return citation?.[0] ?? title;
}

function absoluteAustliiUrl(href: string): string {
  return new URL(href, AUSTLII_BASE).toString();
}

function stripHtml(html: string): string {
  return decodeHtml(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function enclosingBlockText(html: string, start: number, end: number): string {
  for (const tag of ["p", "li", "tr", "div"]) {
    const open = html.toLowerCase().lastIndexOf(`<${tag}`, start);
    const closeBefore = html.toLowerCase().lastIndexOf(`</${tag}>`, start);
    if (open !== -1 && open > closeBefore) {
      const close = html.toLowerCase().indexOf(`</${tag}>`, end);
      if (close !== -1) {
        return stripHtml(html.slice(open, close + tag.length + 3));
      }
    }
  }
  return stripHtml(html.slice(start, end));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

async function loadCourtP90(env: Env, court: CourtCode): Promise<number | null> {
  const raw = await env.PIPELINE_KV?.get(`baseline:${court}:p90`);
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
