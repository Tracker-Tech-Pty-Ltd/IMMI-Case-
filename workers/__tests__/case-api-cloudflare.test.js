import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";

const CASE_ID = "0123456789ab";
const OTHER_CASE_ID = "abcdef012345";

function url(path) {
  return new URL(`https://immi.example${path}`);
}

function stores() {
  return {
    caseStore: {
      listPage: vi.fn(async () => ({
        cases: [{ case_id: CASE_ID, title: "Case", content_key: "cases/hidden" }],
        total: 1,
        page: 1,
        page_size: 100,
        total_pages: 1,
        next_cursor: null,
      })),
      countCompat: vi.fn(async () => 7),
      getCase: vi.fn(async () => ({
        case_id: CASE_ID,
        title: "Anchor",
        citation: "[2026] FCA 1",
        outcome: "Allowed",
        semantic_ready: 1,
        content_key: "cases/hidden",
      })),
      findByIds: vi.fn(async (ids) => ids.map((id) => ({
        case_id: id,
        citation: `[2026] ${id}`,
        title: `Case ${id}`,
        outcome: "Allowed",
        content_key: "cases/hidden",
      }))),
      relatedCompat: vi.fn(async () => []),
      searchLexical: vi.fn(async () => [{ case_id: CASE_ID, title: "Lexical", rank: -4 }]),
      findJudgeBio: vi.fn(async () => ({
        bio_key: "judges/example/bio/abc.json",
        bio_sha256: "a".repeat(64),
        bio_size: 42,
        bio_content_type: "application/json",
      })),
      getFilterOptions: vi.fn(async () => [
        { filter_name: "court", option_value: "FCA", sort_order: 0 },
        { filter_name: "year", option_value: "2025", sort_order: 0 },
        { filter_name: "visa_type", option_value: "Protection", sort_order: 0 },
      ]),
      getCourtYearTrends: vi.fn(async () => [
        { year: 2025, court_code: "FCA", cnt: 7 },
        { year: 2025, court_code: "AATA", cnt: 3 },
      ]),
      countVisaSubclasses: vi.fn(async () => new Map([["189", 12]])),
      exportCases: vi.fn(async () => [{
        case_id: CASE_ID, citation: "[2025] FCA 1", title: "Export Case", court: "Federal Court",
        court_code: "FCA", date: "2025-01-01", year: 2025, outcome: "Allowed", visa_type: "Skilled",
        source: "austlii", content_key: "cases/0123456789ab/source/abc.txt", visa_outcome_reason: "",
      }]),
      listCountries: vi.fn(async () => [{ country: "India", case_count: 33 }]),
      autocompleteJudges: vi.fn(async () => [{ name: "Justice Example", case_count: 7 }]),
      analyticsOutcomes: vi.fn(async () => ({
        court: [{ court_code: "FCA", outcome: "Allowed", cnt: 4 }],
        year: [{ year_key: 2025, outcome: "Allowed", cnt: 4 }],
        subclass: [{ visa_subclass: "189", outcome: "Allowed", cnt: 4 }],
      })),
      analyticsJudges: vi.fn(async () => [{ name: "Justice Example", count: 7, courts_json: '["FCA"]' }]),
      analyticsConcepts: vi.fn(async () => [{ concept: "procedural fairness", cnt: 6 }]),
      analyticsNatureOutcome: vi.fn(async () => [{ case_nature: "Protection visa refusal", outcome: "Allowed", cnt: 5 }]),
      analyticsScope: vi.fn(async () => [
        { court_code: "FCA", year: 2025, outcome: "Allowed", visa_subclass: "189", case_nature: "Protection visa refusal", cnt: 7 },
        { court_code: "AATA", year: 2024, outcome: "Dismissed", visa_subclass: "866", case_nature: "Character", cnt: 3 },
      ]),
      analyticsRateRows: vi.fn(async () => [
        { court_code: "FCA", year: 2025, outcome: "Allowed", has_full_text: 1, cnt: 7 },
        { court_code: "AATA", year: 2024, outcome: "Dismissed", has_full_text: 1, cnt: 3 },
      ]),
      analyticsFilterOptions: vi.fn(async () => ({
        natures: [{ value: "Protection visa refusal", cnt: 7 }],
        subclasses: [{ value: "189", cnt: 7 }],
        outcomes: [{ value: "Allowed", cnt: 7 }],
        total: 10,
      })),
      analyticsFlowRows: vi.fn(async () => [
        { court_code: "FCA", case_nature: "Protection visa refusal", outcome: "Allowed", cnt: 7 },
        { court_code: "AATA", case_nature: "Character", outcome: "Dismissed", cnt: 3 },
      ]),
      analyticsConceptScope: vi.fn(async () => [
        { concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2025, outcome: "Allowed", cnt: 4 },
        { concept_id: "concept-a", concept: "procedural fairness", court_code: "FCA", year: 2024, outcome: "Dismissed", cnt: 2 },
      ]),
      analyticsConceptPairs: vi.fn(async () => [{
        concept_id_a: "concept-a", concept_a: "procedural fairness",
        concept_id_b: "concept-b", concept_b: "evidence",
        court_code: "FCA", year: 2025, outcome: "Allowed", cnt: 4,
      }]),
      analyticsJudgeAggregate: vi.fn(async () => ({
        outcomes: [
          { judge_id: "judge-a", name: "Justice Example", court_code: "FCA", outcome: "Allowed", cnt: 7 },
          { judge_id: "judge-b", name: "Member Other", court_code: "AATA", outcome: "Dismissed", cnt: 3 },
        ],
        years: [{ judge_id: "judge-a", year: 2025, cnt: 7 }],
        visas: [{ judge_id: "judge-a", visa_subclass: "189", cnt: 7 }],
      })),
      getJudgeCases: vi.fn(async () => [{
        case_id: CASE_ID, citation: "[2025] FCA 1", title: "Example v Minister", court_code: "FCA",
        date: "2025-01-01", year: 2025, outcome: "Allowed", visa_subclass: "189",
        case_nature: "Protection", country_of_origin: "India", is_represented: 1,
        legal_concepts: "procedural fairness; evidence",
      }]),
      getJudgeCourtBaselines: vi.fn(async () => [{ court_code: "FCA", outcome: "Allowed", cnt: 10 }]),
      getStats: vi.fn(async () => ({
        total_cases: 149016,
        with_full_text: 142966,
        courts: { AATA: 90 },
        years: { "2025": 90 },
        natures: { "Protection visa refusal": 90 },
        visa_subclasses: { "189": 12 },
        visa_families: {},
        sources: { AustLII: 90 },
        recent_cases: [{ case_id: CASE_ID, title: "Recent", citation: "[2025] FCA 1", court_code: "FCA", date: "2025-01-01", outcome: "Allowed" }],
      })),
    },
    objectStore: {
      getVerifiedJson: vi.fn(async () => ({ full_name: "Justice Example", found: false, role: "Judge" })),
      getVerifiedText: vi.fn(async () => "Full case text"),
      getJudgePhoto: vi.fn(async () => null),
      getLegislation: vi.fn(async () => null),
    },
    semanticIndex: {
      relatedById: vi.fn(async () => ({ matches: [{ id: OTHER_CASE_ID, score: 0.91 }] })),
      searchText: vi.fn(async () => ({ matches: [{ id: OTHER_CASE_ID, score: 0.88 }] })),
    },
    pipelineStore: {
      latestControlCommand: vi.fn(async () => null),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateStores.mockReturnValue(stores());
});

describe("Cloudflare case read router", () => {
  it("is inert outside explicit cloudflare mode", async () => {
    const result = await dispatchCloudflareCaseRead(url("/api/v1/cases"), "/api/v1/cases", {
      IMMI_STORAGE_MODE: "legacy",
    });
    expect(result).toBeNull();
    expect(mockCreateStores).not.toHaveBeenCalled();
  });

  it("keeps the paginated case response shape and hides R2 pointers", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/cases?court=FCA&page_size=20&sort_by=title&sort_dir=asc"),
      "/api/v1/cases",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ total: 1, page: 1, page_size: 100, count_mode: "exact" });
    expect(body.cases[0]).not.toHaveProperty("content_key");
    expect(body.cases[0]).toHaveProperty("full_text_path", "cases/hidden");
    expect(current.caseStore.listPage).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ court: "FCA" }), sortBy: "title", sortDir: "asc", pageSize: "20",
    }));
  });

  it("loads checksum-verified R2 text while preserving the detail response shape", async () => {
    const current = mockCreateStores();
    current.caseStore.getCase.mockResolvedValueOnce({
      case_id: CASE_ID,
      title: "Anchor",
      content_key: `cases/${CASE_ID}/source/${"a".repeat(64)}.txt`,
      content_sha256: "a".repeat(64),
      content_size: 15,
    });
    const result = await dispatchCloudflareCaseRead(
      url(`/api/v1/cases/${CASE_ID}`), `/api/v1/cases/${CASE_ID}`,
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      case: { case_id: CASE_ID, full_text_path: `cases/${CASE_ID}/source/${"a".repeat(64)}.txt` },
      full_text: "Full case text",
    });
    expect(current.objectStore.getVerifiedText).toHaveBeenCalledWith(expect.objectContaining({
      key: `cases/${CASE_ID}/source/${"a".repeat(64)}.txt`,
      sha256: "a".repeat(64),
      size: 15,
    }), expect.objectContaining({ prefix: "cases", maxBytes: 16 * 1024 * 1024 }));
  });

  it("uses Vectorize queryById for related semantic cases and preserves the legacy response", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url(`/api/v1/cases/${CASE_ID}/similar?limit=10`),
      `/api/v1/cases/${CASE_ID}/similar`,
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(current.semanticIndex.relatedById).toHaveBeenCalledWith(CASE_ID, { limit: 11 });
    expect(await result.json()).toEqual({
      similar: [{
        case_id: OTHER_CASE_ID,
        citation: `[2026] ${OTHER_CASE_ID}`,
        title: `Case ${OTHER_CASE_ID}`,
        outcome: "Allowed",
        similarity_score: 0.91,
      }],
      available: true,
    });
  });

  it("uses Workers AI semantic candidates for hybrid search rather than a legacy fallback", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/search?q=protection+visa&mode=hybrid"),
      "/api/v1/search",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(current.semanticIndex.searchText).toHaveBeenCalledWith("protection visa", {
      filters: {}, limit: 100,
    });
    expect(current.caseStore.searchLexical).toHaveBeenCalledOnce();
    const body = await result.json();
    expect(body.mode).toBe("hybrid");
    expect(body.cases).toHaveLength(2);
  });

  it("preserves the dedicated semantic-search response while using Vectorize", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/search/semantic?q=procedural+fairness&limit=5"),
      "/api/v1/search/semantic",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(current.semanticIndex.searchText).toHaveBeenCalledWith("procedural fairness", {
      filters: {}, limit: 25,
    });
    expect(await result.json()).toEqual({
      results: [{
        case_id: OTHER_CASE_ID,
        citation: `[2026] ${OTHER_CASE_ID}`,
        title: `Case ${OTHER_CASE_ID}`,
        outcome: "Allowed",
        similarity_score: 0.88,
      }],
      available: true,
      query: "procedural fairness",
      provider: "cloudflare-workers-ai",
      model: "@cf/qwen/qwen3-embedding-0.6b",
    });
  });

  it("keeps judge-bio lookup in D1/R2 while preserving found semantics", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-bio?name=Justice+Example"),
      "/api/v1/analytics/judge-bio",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(current.caseStore.findJudgeBio).toHaveBeenCalledWith("Justice Example");
    expect(current.objectStore.getVerifiedJson).toHaveBeenCalledWith(expect.objectContaining({
      key: "judges/example/bio/abc.json",
    }), expect.objectContaining({ prefix: "judges" }));
    expect(await result.json()).toEqual({ full_name: "Justice Example", found: true, role: "Judge" });
  });

  it("keeps the missing-name and absent-bio contracts", async () => {
    const missingName = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-bio"), "/api/v1/analytics/judge-bio", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(missingName.status).toBe(400);
    const current = mockCreateStores();
    current.caseStore.findJudgeBio.mockResolvedValueOnce(null);
    const absent = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-bio?name=Nobody"), "/api/v1/analytics/judge-bio", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(await absent.json()).toEqual({ found: false });
  });

  it("serves validated judge portraits from the native R2 object boundary", async () => {
    const current = mockCreateStores();
    current.objectStore.getJudgePhoto.mockResolvedValueOnce({
      body: new Blob(["photo-bytes"], { type: "image/jpeg" }),
      headers: new Headers({ "Content-Type": "image/jpeg" }),
      etag: '"photo-etag"',
    });
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/judge-photo/example.jpg"),
      "/api/v1/judge-photo/example.jpg",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toBe("image/jpeg");
    expect(result.headers.get("Cache-Control")).toContain("max-age=86400");
    expect(result.headers.get("ETag")).toBe('"photo-etag"');
    expect(await result.text()).toBe("photo-bytes");
    expect(current.objectStore.getJudgePhoto).toHaveBeenCalledWith("example.jpg");
  });

  it("keeps missing or unsafe judge portraits as a 404", async () => {
    const missing = await dispatchCloudflareCaseRead(
      url("/api/v1/judge-photo/missing.jpg"),
      "/api/v1/judge-photo/missing.jpg",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(missing.status).toBe(404);
    const unsafe = await dispatchCloudflareCaseRead(
      url("/api/v1/judge-photo/../secret.jpg"),
      "/api/v1/judge-photo/../secret.jpg",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(unsafe).toBeNull();
  });

  it("serves legislation detail metadata with an explicit not-scraped section list", async () => {
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/migration-act-1958"),
      "/api/v1/legislations/migration-act-1958",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ success: true, data: { id: "migration-act-1958", sections: [] } });
  });

  it("prefers a checksum-verified native legislation payload when imported", async () => {
    const current = mockCreateStores();
    current.objectStore.getLegislation.mockResolvedValueOnce({ id: "migration-act-1958", sections: [{ id: "s1", text: "Short title" }] });
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/migration-act-1958"),
      "/api/v1/legislations/migration-act-1958",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true, data: { id: "migration-act-1958", sections: [{ id: "s1" }] } });
    expect(current.objectStore.getLegislation).toHaveBeenCalledWith("migration-act-1958");
  });

  it("serves a native idle legislation update status without starting a job", async () => {
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/update/status"),
      "/api/v1/legislations/update/status",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true, native: true, status: { running: false } });
  });

  it("serves native filter options and court/year trends from aggregates", async () => {
    const current = mockCreateStores();
    const filters = await dispatchCloudflareCaseRead(
      url("/api/v1/filter-options"), "/api/v1/filter-options", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(await filters.json()).toEqual({
      courts: ["FCA"], years: [2025], natures: [], visa_types: ["Protection"], sources: [], outcomes: [], tags: [],
    });
    const trends = await dispatchCloudflareCaseRead(
      url("/api/v1/stats/trends?court=FCA&year_from=2020"), "/api/v1/stats/trends", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(current.caseStore.getCourtYearTrends).toHaveBeenCalledWith({ court: "FCA", yearFrom: 2020, yearTo: 0 });
    expect(await trends.json()).toEqual({ trends: [{ year: 2025, FCA: 7, AATA: 3 }] });
  });

  it("serves the canonical legal-concept taxonomy from aggregate counts", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/taxonomy/legal-concepts"),
      "/api/v1/taxonomy/legal-concepts",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ success: true, meta: { total_concepts: 34 } });
    expect(body.concepts[0]).toMatchObject({ name: "Procedural Fairness", case_count: 6 });
    expect(current.caseStore.analyticsConcepts).toHaveBeenCalledWith(100);
  });

  it("serves unfiltered dashboard stats from catalog aggregates", async () => {
    const current = mockCreateStores();
    const result = await dispatchCloudflareCaseRead(
      url("/api/v1/stats"), "/api/v1/stats", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(result.status).toBe(200);
    expect(current.caseStore.getStats).toHaveBeenCalledOnce();
    expect(await result.json()).toMatchObject({
      total_cases: 149016,
      with_full_text: 142966,
      visa_families: { Skilled: 12 },
    });
  });

  it("exports JSON and CSV from the native catalog boundary", async () => {
    const current = mockCreateStores();
    const json = await dispatchCloudflareCaseRead(
      url("/api/v1/export/json?limit=1"), "/api/v1/export/json", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(json.status).toBe(200);
    expect((await json.json()).cases[0]).toMatchObject({ case_id: CASE_ID, full_text_path: "cases/0123456789ab/source/abc.txt" });
    const csv = await dispatchCloudflareCaseRead(
      url("/api/v1/export/csv?limit=1"), "/api/v1/export/csv", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("case_id,citation,title");
    expect(current.caseStore.exportCases).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });

  it("serves analytics filter, flow, rate and concept contracts from aggregates", async () => {
    const current = mockCreateStores();
    const filterOptions = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/filter-options?court=FCA&year_from=2020"),
      "/api/v1/analytics/filter-options", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await filterOptions.json()).query.total_matching).toBe(10);
    expect(current.caseStore.analyticsFilterOptions).toHaveBeenCalledWith({ court: "FCA", yearFrom: 2020, yearTo: 0 });

    const flow = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/flow-matrix?top_n=3"), "/api/v1/analytics/flow-matrix", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await flow.json()).links.length).toBeGreaterThan(0);

    const rate = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/success-rate?court=FCA"), "/api/v1/analytics/success-rate", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await rate.json()).success_rate).toMatchObject({ overall: 70, win_count: 7 });

    const effectiveness = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/concept-effectiveness?limit=5"), "/api/v1/analytics/concept-effectiveness", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await effectiveness.json()).concepts[0]).toMatchObject({ name: "Procedural Fairness" });

    const cooccurrence = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/concept-cooccurrence?min_count=1"), "/api/v1/analytics/concept-cooccurrence", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await cooccurrence.json()).top_pairs[0]).toMatchObject({ a: "Evidence", b: "Procedural Fairness" });

    const trends = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/concept-trends?limit=5"), "/api/v1/analytics/concept-trends", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await trends.json()).series["Procedural Fairness"]).toHaveLength(2);
  });

  it("serves judge leaderboard, profile and compare from normalized aggregates", async () => {
    const current = mockCreateStores();
    const leaderboard = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-leaderboard?limit=1"), "/api/v1/analytics/judge-leaderboard", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await leaderboard.json()).judges[0]).toMatchObject({ name: "Justice Example", total_cases: 7 });
    const profile = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-profile?name=Justice%20Example"), "/api/v1/analytics/judge-profile", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await profile.json()).judge).toMatchObject({ name: "Justice Example", total_cases: 1 });
    const compare = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judge-compare?names=Justice%20Example,Member%20Other"), "/api/v1/analytics/judge-compare", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await compare.json()).judges).toHaveLength(2);
    expect(current.caseStore.getJudgeCases).toHaveBeenCalled();
  });

  it("serves static dictionary, visa registry and legislation contracts without legacy imports", async () => {
    const current = mockCreateStores();
    const dictionary = await dispatchCloudflareCaseRead(
      url("/api/v1/data-dictionary"), "/api/v1/data-dictionary", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await dictionary.json()).fields.length).toBeGreaterThan(20);
    const registry = await dispatchCloudflareCaseRead(
      url("/api/v1/visa-registry"), "/api/v1/visa-registry", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await registry.json()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ subclass: "189", family: "Skilled" }),
    ]));
    const list = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations?limit=2"), "/api/v1/legislations", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(await list.json()).toMatchObject({ success: true, meta: { total: 5, limit: 2, pages: 3 } });
    const search = await dispatchCloudflareCaseRead(
      url("/api/v1/legislations/search?q=migration"), "/api/v1/legislations/search", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await search.json()).data.length).toBeGreaterThan(0);
    const lookup = await dispatchCloudflareCaseRead(
      url("/api/v1/taxonomy/visa-lookup?q=189"), "/api/v1/taxonomy/visa-lookup", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(current.caseStore.countVisaSubclasses).toHaveBeenCalledWith(["189"]);
    expect((await lookup.json()).data[0]).toMatchObject({ subclass: "189", case_count: 12 });
    const countries = await dispatchCloudflareCaseRead(
      url("/api/v1/taxonomy/countries?limit=10"), "/api/v1/taxonomy/countries", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(current.caseStore.listCountries).toHaveBeenCalledWith(10);
    expect((await countries.json()).countries[0]).toEqual({ country: "India", name: "India", case_count: 33 });
    const judges = await dispatchCloudflareCaseRead(
      url("/api/v1/taxonomy/judges/autocomplete?q=justice"), "/api/v1/taxonomy/judges/autocomplete", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await judges.json()).judges[0]).toEqual({ name: "Justice Example", case_count: 7 });
    const lineage = await dispatchCloudflareCaseRead(
      url("/api/v1/court-lineage"), "/api/v1/court-lineage", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(current.caseStore.getCourtYearTrends).toHaveBeenCalledWith();
    expect((await lineage.json()).lineages).toHaveLength(2);
    const outcomes = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/outcomes"), "/api/v1/analytics/outcomes", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await outcomes.json()).by_court.FCA.Allowed).toBe(4);
    const judgeAnalytics = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/judges?limit=5"), "/api/v1/analytics/judges", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await judgeAnalytics.json()).judges[0]).toMatchObject({ name: "Justice Example", courts: ["FCA"] });
    const concepts = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/legal-concepts?limit=5"), "/api/v1/analytics/legal-concepts", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await concepts.json()).concepts[0]).toEqual({ name: "Procedural Fairness", count: 6 });
    const nature = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/nature-outcome"), "/api/v1/analytics/nature-outcome", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await nature.json()).matrix["Protection visa refusal"].Allowed).toBe(5);
    const families = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/visa-families"), "/api/v1/analytics/visa-families", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await families.json()).families[0]).toMatchObject({ family: "Skilled", total: 4, win_count: 4, win_rate: 100 });
    const monthly = await dispatchCloudflareCaseRead(
      url("/api/v1/analytics/monthly-trends"), "/api/v1/analytics/monthly-trends", { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect((await monthly.json()).series[0]).toMatchObject({ month: "2025-01", total: 4, wins: 4, win_rate: 100 });
  });
});
