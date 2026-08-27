import { D1_MAX_BOUND_PARAMETERS, StorageBoundaryError } from "./contracts.js";

export function requireD1(binding, name) {
  if (!binding || typeof binding.prepare !== "function") {
    throw new StorageBoundaryError(`${name} D1 binding is unavailable`, {
      code: "missing_cloudflare_binding",
      status: 503,
    });
  }
  return binding;
}

export function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function changeCount(result) {
  return Number(result?.meta?.changes || 0);
}

export function bindAll(database, sql, params) {
  if (params.length > D1_MAX_BOUND_PARAMETERS) {
    throw new StorageBoundaryError("D1 statement exceeds the 100-parameter limit", {
      code: "d1_parameter_limit",
      status: 500,
    });
  }
  return database.prepare(sql).bind(...params);
}
