/**
 * Type definitions for the AustLII scraper Worker.
 */

/** A single scraping job pushed to the Queue */
export interface ScrapeJob {
  case_id: string;
  url: string;
  citation: string;
  court_code: string;
  title: string;
  run_id?: string;
  phase?: "scrape";
  discovered_at?: string;
}

/** A case ready for the container extraction stage. */
export interface ExtractJob {
  phase: "extract";
  run_id: string;
  case_id: string;
  court_code: string;
  r2_key: string;
  scraped_at: string;
}

/** Successful scrape result stored in R2 */
export interface ScrapeResult {
  case_id: string;
  url: string;
  citation: string;
  court_code: string;
  title: string;
  success: true;
  full_text: string;
  judges: string;
  date: string;
  catchwords: string;
  outcome: string;
  visa_type: string;
  legislation: string;
  scraped_at: string;
}

export interface ExtractionField {
  value: string | number | boolean | null;
  confidence: number;
  source: "regex" | "llm" | "merge" | "timeout";
}

export interface ExtractedCase {
  case_id: string;
  r2_key?: string;
  base: Partial<ScrapeResult> & Record<string, unknown>;
  fields: Record<string, ExtractionField>;
  timeouts?: string[];
}

export interface InternalExtractResponse {
  extracted: ExtractedCase[];
  llm_calls: number;
  cost_usd: number;
}

/** Failed scrape result stored in R2 errors/ prefix */
export interface ScrapeError {
  case_id: string;
  url: string;
  citation: string;
  court_code: string;
  title: string;
  success: false;
  error: string;
  error_code: number;
  scraped_at: string;
}

/** Environment bindings for the Worker */
export interface Env {
  SCRAPE_QUEUE: Queue<ScrapeJob>;
  EXTRACT_QUEUE?: Queue<ExtractJob>;
  CASE_RESULTS: R2Bucket;
  FLASK_BACKEND?: Fetcher;
  COST_CAP_DO?: DurableObjectNamespace;
  MYBROWSER?: BrowserRun;
  AUTH_TOKEN: string;
  HYPERDRIVE_SERVICE?: Hyperdrive;
  HYPERDRIVE_SERVICE_URL?: string;
  PIPELINE_KV?: KVNamespace;
  PIPELINE_ENABLED?: string;
  PIPELINE_BIWEEKLY_GATE?: string;
  PIPELINE_TARGET_TABLE?: string;
  PIPELINE_DISCOVERY_LOOKBACK_YEARS?: string;
  PIPELINE_PER_COURT_RATE_LIMIT_MS?: string;
  PIPELINE_INSERT_ONLY?: string;
  PIPELINE_RUN_COST_CAP_USD?: string;
  PIPELINE_LLM_CALL_TIMEOUT_MS?: string;
  PIPELINE_CONTAINER_EXTRACT_TIMEOUT_MS?: string;
  PIPELINE_EXTRACT_BATCH_SIZE?: string;
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_ENABLED?: string;
  FIRECRAWL_API_BASE_URL?: string;
  FIRECRAWL_PROXY?: string;
  FIRECRAWL_STORE_IN_CACHE?: string;
  FIRECRAWL_ZERO_DATA_RETENTION?: string;
  FIRECRAWL_TIMEOUT_MS?: string;
  FIRECRAWL_WAIT_FOR_MS?: string;
  FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_RUN?: string;
  FIRECRAWL_DISCOVERY_MAX_CREDITS_PER_MONTH?: string;
  ALERT_DISCORD_WEBHOOK_URL?: string;
}

/** Batch enqueue request body */
export interface EnqueueRequest {
  jobs: ScrapeJob[];
}

/** Batch enqueue response */
export interface EnqueueResponse {
  queued: number;
  skipped: number;
  errors: string[];
}
