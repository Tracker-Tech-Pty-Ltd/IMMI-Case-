/**
 * Cloudflare Worker: thin proxy between edge and Flask Container.
 *
 * Routes:
 *   /api/*      -> Flask Container (backend API)
 *   /app/*      -> Flask Container (React SPA served by Flask)
 *   /health     -> health check
 *   *           -> pass through (Cloudflare Pages handles static)
 */

export class FlaskBackend {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return await fetch(request);
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
      const container = env.FlaskBackend.get(
        env.FlaskBackend.idFromName("flask-singleton")
      );
      return container.fetch(request);
    }

    // Everything else: pass through (handled by Pages or 404)
    return new Response("Not Found", { status: 404 });
  },
};
