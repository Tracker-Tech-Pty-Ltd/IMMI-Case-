// Capture the exact SQL + params the rebuild/dirty/decision helpers issue, so
// they can be executed against a real SQLite database with the real schema.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCloudflareStores } from "../../workers/storage/cloudflare.js";

const recorded = [];
let phase = "init";
function d1(responder = () => []) {
  return {
    prepare(sql) {
      const statement = {
        sql,
        phase,
        params: [],
        bind(...params) { this.params = params; return this; },
        all: async () => ({ results: responder(sql) }),
        first: async () => responder(sql)[0] ?? null,
        run: async () => ({ meta: { changes: 1 } }),
      };
      recorded.push(statement);
      return statement;
    },
    batch: async (statements) => statements.map(() => ({ meta: { changes: 1 } })),
  };
}

const value = {
  IMMI_STORAGE_MODE: "cloudflare",
  IMMI_CATALOG_DB: d1((sql) => (sql.includes("rebuild_dirty") && sql.includes("SELECT") ? [] : [])),
  IMMI_ACCOUNT_DB: d1(),
  IMMI_OPS_DB: d1(),
  IMMI_CONTENT: { put() {}, head() {}, get() {} },
  CASE_VECTORS: { queryById() {}, query() {}, upsert() {} },
  AI: { run() {} },
};

const stores = createCloudflareStores(value);
await stores.caseStore.rebuildAggregates();
phase = "mark_dirty";
await stores.caseStore.markAggregatesDirty();
await stores.caseStore.markAggregatesDirty();
phase = "consume_budget";
await stores.caseStore.consumeRebuildBudget({ dailyBudget: 48 });
await stores.caseStore.consumeRebuildBudget({ dailyBudget: 48 });
phase = "decision";
await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds: 300 });
phase = "lease_claim";
const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds: 600 });
phase = "lease_renew";
await stores.caseStore.renewRebuildLease({ token: lease?.token ?? 1, leaseSeconds: 600 });
phase = "lease_release";
await stores.caseStore.releaseRebuildLease({ token: lease?.token ?? 1 });

const out = recorded.map((statement) => ({
  phase: statement.phase,
  sql: statement.sql,
  params: statement.params.map((p) => (typeof p === "number" ? p : String(p))),
}));
const target = process.env.CAPTURE_OUT
  || fileURLToPath(new URL("../../work/rebuild-statements.json", import.meta.url));
const payload = { captured_at: Math.floor(Date.now() / 1000), statements: out };
writeFileSync(target, JSON.stringify(payload, null, 1));
console.log(JSON.stringify({ statements: out.length, captured_at: payload.captured_at, out: target }));
