import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudflareStores, CloudflareIdentityStore } from "../storage/cloudflare.js";
import { VECTOR_DIMENSIONS } from "../storage/contracts.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TENANT_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const AUTH = { sub: USER_ID, tenant_id: TENANT_ID, tenants: [TENANT_ID] };

function schemaEnv() {
  return {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: {
      put: vi.fn(async () => ({})),
      get: vi.fn(async () => null),
      head: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    },
    CASE_VECTORS: {
      queryById: vi.fn(async () => ({ matches: [] })),
      query: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async () => ({ mutationId: "mutation-1" })),
      deleteByIds: vi.fn(async () => ({ mutationId: "mutation-2" })),
    },
    AI: { run: vi.fn(async () => ({ data: [Array(VECTOR_DIMENSIONS).fill(0)] })) },
  };
}

function caseFixture(overrides) {
  return {
    citation: "[2026] FCA 1", title: "Alpha v Minister", court: "Federal Court of Australia",
    court_code: "FCA", year: 2026, decision_date: "2026-01-15", outcome: "allowed",
    visa_type: "student", visa_subclass: "500", source: "AustLII",
    case_nature: "judicial review", country_of_origin: "India",
    judges: ["Smith J"], legal_concepts: ["procedural fairness"], ...overrides,
  };
}

async function seedCase(stores, caseId, overrides = {}, chunk = "The applicant sought review of a visa refusal decision.") {
  await stores.caseStore.putImportedCase({
    case: caseFixture({ case_id: caseId, ...overrides }),
    sourcePointer: {
      key: `cases/${caseId}/source/${"a".repeat(64)}.txt`,
      sha256: "a".repeat(64), size: 12, contentType: "text/plain; charset=utf-8",
    },
    textChunks: [chunk],
  });
}

let env;
let stores;

beforeEach(() => {
  env = schemaEnv();
  stores = createCloudflareStores(env);
});

describe("D1 read path against the shipped catalog schema", () => {
  it("paginates, filters and projects relations exactly as the schema allows", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", {
      citation: "[2025] AATA 2", title: "Beta v Minister", court: "Administrative Appeals Tribunal",
      court_code: "AATA", year: 2025, decision_date: "2025-06-01", outcome: "affirmed",
      visa_subclass: "820", case_nature: "merits review", country_of_origin: "China",
      judges: ["Smith J"], legal_concepts: ["credibility"],
    }, "The tribunal affirmed the visa refusal on credibility grounds.");

    const all = await stores.caseStore.listPage({ sortBy: "date", sortDir: "desc", page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.cases.map((row) => row.case_id)).toEqual(["0123456789ab", "0123456789ac"]);
    expect(all.cases[0].date).toBe("2026-01-15");
    expect(all.cases[0].judges).toBe("Smith J");
    expect(all.cases[0].legal_concepts).toBe("procedural fairness");

    // listPage uses compatCaseFilters: the key is `court`, not `court_code`.
    const filtered = await stores.caseStore.listPage({ filters: { court: "AATA" }, pageSize: 10 });
    expect(filtered.total).toBe(1);
    expect(filtered.cases[0].case_id).toBe("0123456789ac");

    expect(await stores.caseStore.countCompat({ court: "FCA" })).toBe(1);
    expect(await stores.caseStore.exportCases({ limit: 10 })).toHaveLength(2);
  });

  it("returns bm25-ranked distinct cases from the FTS5 index", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", { court_code: "AATA" }, "Wholly unrelated tribunal text about tax.");
    const hits = await stores.caseStore.searchLexical({ query: "visa refusal", limit: 10 });
    expect(hits.map((row) => row.case_id)).toEqual(["0123456789ab"]);
    expect(typeof hits[0].rank).toBe("number");
  });

  it("rebuilds every aggregate table the analytics reads depend on", async () => {
    await seedCase(stores, "0123456789ab");
    await seedCase(stores, "0123456789ac", {
      court_code: "AATA", year: 2025, outcome: "affirmed", visa_subclass: "820",
      case_nature: "merits review", country_of_origin: "China", legal_concepts: ["credibility"],
    }, "The tribunal affirmed the visa refusal on credibility grounds.");

    const result = await stores.caseStore.rebuildAggregates();
    expect(result.rebuilt_at).toEqual(expect.any(String));

    const stats = await stores.caseStore.getStats({});
    expect(stats.total_cases).toBe(2);
    expect(stats.courts).toMatchObject({ FCA: 1, AATA: 1 });

    const options = await stores.caseStore.analyticsFilterOptions({});
    expect(options.total).toBe(2);
    expect(options.outcomes.map((row) => row.value).sort()).toEqual(["affirmed", "allowed"]);

    expect(await stores.caseStore.getFilterOptions()).not.toHaveLength(0);
    const courtYear = await stores.caseStore.analyticsCourtYearOutcomes();
    const subclass = await stores.caseStore.analyticsVisaOutcomes();
    expect(courtYear).not.toHaveLength(0);
    expect(subclass).not.toHaveLength(0);
  });
});

describe("tenant isolation against the shipped account schema", () => {
  function identity() {
    return new CloudflareIdentityStore(env);
  }
  function seedTenancy() {
    const now = "2026-08-27T00:00:00.000Z";
    env.IMMI_ACCOUNT_DB.exec(`
      INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at)
      VALUES ('${TENANT_ID}','individual','Workspace','${now}','${now}'),
             ('${OTHER_TENANT_ID}','organisation','Other','${now}','${now}');
      INSERT INTO users (user_id,telegram_id,created_at,updated_at)
      VALUES ('${USER_ID}','42','${now}','${now}');
    `);
    return now;
  }

  it("denies when the tenant has no membership row at all", async () => {
    seedTenancy();
    await expect(identity().assertMembership(AUTH)).rejects.toMatchObject({
      code: "tenant_membership_denied", status: 403,
    });
  });

  it("propagates the stored role for a live membership", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','admin','${now}')`);
    await expect(identity().assertMembership(AUTH)).resolves.toEqual({
      userId: USER_ID, tenantId: TENANT_ID, role: "admin",
    });
  });

  it("denies after the membership is revoked", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','owner','${now}')`);
    await expect(identity().assertMembership(AUTH)).resolves.toMatchObject({ role: "owner" });
    env.IMMI_ACCOUNT_DB.exec(`UPDATE memberships SET revoked_at = '${now}' WHERE tenant_id = '${TENANT_ID}' AND user_id = '${USER_ID}'`);
    await expect(identity().assertMembership(AUTH)).rejects.toMatchObject({
      code: "tenant_membership_denied", status: 403,
    });
  });

  it("denies a tenant the user is not a member of", async () => {
    const now = seedTenancy();
    env.IMMI_ACCOUNT_DB.exec(`INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES ('${TENANT_ID}','${USER_ID}','owner','${now}')`);
    await expect(identity().assertMembership({
      sub: USER_ID, tenant_id: OTHER_TENANT_ID, tenants: [OTHER_TENANT_ID],
    })).rejects.toMatchObject({ code: "tenant_membership_denied", status: 403 });
  });
});
