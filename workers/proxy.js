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
    // Boot the container on first instantiation; blockConcurrencyWhile
    // ensures no requests are handled until the container is ready.
    this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.container.start();
    });
  }

  async fetch(request) {
    // Forward request to Flask running on port 8080 inside the container.
    // Reconstruct URL so it targets the container host, preserving path + query.
    const url = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search}`;
    return this.ctx.container.getTcpPort(8080).fetch(
      new Request(containerUrl, request)
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check at edge (no container needed)
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", worker: "immi-case-proxy" });
    }

    // Proxy API and SPA routes to Flask container
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/app/")) {
      const id = env.FlaskBackend.idFromName("flask-singleton");
      const container = env.FlaskBackend.get(id);

      // Inject Hyperdrive connection string so Flask can use direct PostgreSQL.
      // Containers can't access bindings directly; Worker injects it as a header.
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
