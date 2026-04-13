/**
 * Cloudflare Worker: thin proxy between edge and Flask Container.
 *
 * Routes:
 *   /api/*      -> Flask Container (backend API)
 *   /app/*      -> Flask Container (React SPA served by Flask)
 *   /health     -> health check (edge only, no container)
 *   *           -> 404
 */

import { DurableObject } from "cloudflare:workers";

export class FlaskBackend extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Boot the container only if it is not already running.
    // blockConcurrencyWhile ensures no requests are handled until ready.
    this.ctx.blockConcurrencyWhile(async () => {
      if (!this.ctx.container.running) {
        await this.ctx.container.start({
          env: {
            SECRET_KEY: env.SECRET_KEY,
            SUPABASE_URL: env.SUPABASE_URL,
            SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
            APP_ENV: "production",
            // Inject Hyperdrive connection string so the warmup thread (which
            // runs outside request context) can use psycopg2 directly instead
            // of the slow supabase-py REST pagination over 149K rows.
            HYPERDRIVE_DATABASE_URL: env.HYPERDRIVE ? env.HYPERDRIVE.connectionString : "",
          },
        });
      }
    });
  }

  async fetch(request) {
    // Forward request to Flask running on port 8080 inside the container.
    // Retry until Flask is ready (cold start can take 5-15s for Python imports).
    const url = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search}`;
    const port = this.ctx.container.getTcpPort(8080);

    const MAX_ATTEMPTS = 30;
    const RETRY_DELAY_MS = 500;
    let lastError;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await port.fetch(new Request(containerUrl, request));
      } catch (err) {
        if (err?.message?.includes("not listening")) {
          lastError = err;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check at edge — no container needed
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", worker: "immi-case-proxy" });
    }

    // Proxy API and SPA routes to Flask container
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/app/")) {
      const id = env.FlaskBackend.idFromName("flask-v3");
      const container = env.FlaskBackend.get(id);

      // Inject Hyperdrive connection string so Flask can use direct psycopg2.
      // Containers can't access Worker bindings directly; Worker injects via header.
      if (env.HYPERDRIVE) {
        const headers = new Headers(request.headers);
        headers.set("X-Hyperdrive-Url", env.HYPERDRIVE.connectionString);
        return container.fetch(new Request(request, { headers }));
      }

      return container.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
