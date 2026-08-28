import { verifyJwt } from "../auth/jwt.js";
import { requireAuth } from "../auth/request_auth.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { StorageBoundaryError } from "../storage/contracts.js";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleAdminPipelineRuns(request, env, url) {
  if (env.AUTH_ENABLED === "false") return json({ error: "Admin auth is disabled", code: "admin_auth_disabled" }, 403);
  const auth = await requireAuth(request, env, verifyJwt);
  if (auth instanceof Response) return auth;
  try {
    const stores = createCloudflareStores(env);
    // Platform-wide read: gate on the operator grant, not the self-granted
    // tenant role.
    await stores.identityStore.assertPlatformOperator(auth.claims);
    const limit = Number.parseInt(url.searchParams.get("limit") || "30", 10);
    const result = await stores.pipelineStore.listRuns(Number.isFinite(limit) ? limit : 30);
    return json(result);
  } catch (error) {
    if (error instanceof StorageBoundaryError) return json({ error: error.message, code: error.code }, error.status);
    console.error(JSON.stringify({ event: "pipeline.cloudflare.read_error", error: error?.message }));
    return json({ error: "Pipeline service unavailable", code: "pipeline_store_unavailable" }, 503);
  }
}
