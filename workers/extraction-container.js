/**
 * Cloudflare Container bridge for the CPU/LLM-only extraction service.
 *
 * The bridge forwards only bounded extraction requests and passes no database
 * or object-store credentials into the Container.
 */

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
    let lastError;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const port = this.ctx.container.getTcpPort(8080);
        return await port.fetch(new Request(containerUrl, request));
      } catch (error) {
        lastError = error;
        const message = error?.message || "";
        if (!message.includes("not listening") && !message.includes("not running")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return Response.json({ error: "Extraction container unavailable", detail: lastError?.message || "timeout" }, { status: 503 });
  }
}
