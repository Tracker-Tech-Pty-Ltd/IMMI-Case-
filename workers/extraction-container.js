/**
 * Cloudflare Container bridge for the CPU/LLM-only extraction service.
 *
 * The bridge forwards only bounded extraction requests and passes no database
 * or object-store credentials into the Container.
 */

import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 8080;
const START_RETRY_DELAY_MS = 500;
// 60 × 500ms = 30s of container boot budget. The caller's own ceiling is
// PIPELINE_CONTAINER_EXTRACT_TIMEOUT_MS (300000) in the scraper Worker.
const MAX_START_ATTEMPTS = 60;

export class ExtractionBackend extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      if (!this.ctx.container.running) {
        await this.ctx.container.start({
          env: {
            EXTRACTION_SHARED_SECRET: env.EXTRACTION_SHARED_SECRET,
            CF_AIG_TOKEN: env.CF_AIG_TOKEN,
            LLM_EXTRACT_CF_GATEWAY_URL: env.LLM_EXTRACT_CF_GATEWAY_URL,
            LLM_GEMMA_MODEL: env.LLM_GEMMA_MODEL,
            LLM_MAX_OUTPUT_TOKENS: env.LLM_MAX_OUTPUT_TOKENS,
            PIPELINE_RUN_COST_CAP_USD: env.PIPELINE_RUN_COST_CAP_USD,
            PIPELINE_LLM_CALL_TIMEOUT_MS: env.PIPELINE_LLM_CALL_TIMEOUT_MS,
          },
        });
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search}`;
    const method = request.method;
    const headers = new Headers(request.headers);
    // Buffer once: `new Request(url, request)` disturbs the original body,
    // so a second attempt on a POST would throw "Body has already been used"
    // and be rethrown as an unrelated failure.
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    let lastError;
    for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt += 1) {
      try {
        const port = this.ctx.container.getTcpPort(CONTAINER_PORT);
        return await port.fetch(new Request(containerUrl, { method, headers, body }));
      } catch (error) {
        lastError = error;
        const message = error?.message || "";
        if (!message.includes("not listening") && !message.includes("not running")) throw error;
        await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
      }
    }
    return Response.json({ error: "Extraction container unavailable", detail: lastError?.message || "timeout" }, { status: 503 });
  }
}
