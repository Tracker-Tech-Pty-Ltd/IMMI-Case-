/**
 * Cloudflare-native repository implementations — public entry point.
 *
 * This module owns all D1/R2/Vectorize/Workers AI binding access. Council
 * storage activates only under the explicit `cloudflare` mode; all other
 * public API paths remain legacy until their contract, reconciliation and
 * rollback gates pass.
 *
 * The six store classes now live in their own per-store modules
 * (object.js, case.js, identity.js, council.js, pipeline.js, semantic.js).
 * This file re-exports them so existing importers keep their import path,
 * and holds the three factory functions that construct them.
 */

import { assertCloudflareBindings, assertCloudflareRuntimeMode } from "./contracts.js";
import { requireD1 } from "./cloudflare_shared.js";
import { CloudflareObjectStore } from "./object.js";
import { CloudflareCaseStore } from "./case.js";
import { CloudflareIdentityStore } from "./identity.js";
import { CloudflareCouncilStore } from "./council.js";
import { CloudflarePipelineStore } from "./pipeline.js";
import { CloudflareSemanticIndex } from "./semantic.js";

export {
  CloudflareObjectStore,
  CloudflareCaseStore,
  CloudflareIdentityStore,
  CloudflareCouncilStore,
  CloudflarePipelineStore,
  CloudflareSemanticIndex,
};

/**
 * The sole factory exposed to handlers/DOs. It makes direct platform-binding
 * access mechanically unnecessary outside this directory.
 */
export function createCloudflareStores(env) {
  assertCloudflareRuntimeMode(env);
  assertCloudflareBindings(env);
  return Object.freeze({
    caseStore: new CloudflareCaseStore(env),
    identityStore: new CloudflareIdentityStore(env),
    councilStore: new CloudflareCouncilStore(env),
    pipelineStore: new CloudflarePipelineStore(env),
    semanticIndex: new CloudflareSemanticIndex(env),
    objectStore: new CloudflareObjectStore(env),
  });
}

/**
 * D1-only store factory for the council retrieval path. Unlike
 * createCloudflareStores it does not require Vectorize/AI/R2 bindings, so the
 * lexical retrieval can run even when the semantic index is unavailable.
 */
export function createCloudflareCaseStore(env) {
  assertCloudflareRuntimeMode(env);
  requireD1(env?.IMMI_CATALOG_DB, "IMMI_CATALOG_DB");
  return new CloudflareCaseStore(env);
}

/** The auth boundary needs only Account D1; no handler receives its binding. */
export function createCloudflareIdentityStore(env) {
  assertCloudflareRuntimeMode(env);
  requireD1(env?.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
  return new CloudflareIdentityStore(env);
}
