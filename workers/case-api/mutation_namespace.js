import { assertCaseId, StorageBoundaryError } from "../storage/contracts.js";

/** Every vector write for a case must reach the same coordinator instance. */
export function getCaseMutationStub(env, caseId) {
  const checked = assertCaseId(caseId);
  if (!env?.CASE_MUTATION_COORDINATOR || typeof env.CASE_MUTATION_COORDINATOR.getByName !== "function") {
    throw new StorageBoundaryError("Case mutation coordinator binding is unavailable", {
      code: "case_mutation_coordinator_unavailable", status: 503,
    });
  }
  return env.CASE_MUTATION_COORDINATOR.getByName(`case:${checked}`);
}
