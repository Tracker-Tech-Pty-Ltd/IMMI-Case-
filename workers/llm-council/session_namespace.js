/** Deterministic routing helper shared by handlers/storage and CouncilSessionDO. */

import { StorageBoundaryError } from "../storage/contracts.js";

function assertSessionIdentifier(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f/]/.test(value)) {
    throw new StorageBoundaryError(`${name} is invalid`, { code: "invalid_council_identifier", status: 400 });
  }
  return value;
}

export function getCouncilSessionStub(env, sessionId) {
  const checked = assertSessionIdentifier(sessionId, "sessionId");
  if (!env?.COUNCIL_SESSION || typeof env.COUNCIL_SESSION.getByName !== "function") {
    throw new StorageBoundaryError("COUNCIL_SESSION Durable Object binding is unavailable", {
      code: "missing_cloudflare_binding",
      status: 503,
    });
  }
  return env.COUNCIL_SESSION.getByName(`session:${checked}`);
}
