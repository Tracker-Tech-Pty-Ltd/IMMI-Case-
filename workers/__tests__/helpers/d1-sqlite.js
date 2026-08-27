/**
 * Test-only D1 binding shim backed by node:sqlite.
 *
 * It applies the checked-in `migrations/d1/**` schema to an in-memory SQLite
 * database and exposes the subset of the D1 API that `workers/storage/
 * cloudflare.js` actually uses: prepare/bind/all/first/run and a transactional
 * batch(). Production SQL therefore runs against the production schema, so a
 * renamed column or a dropped table fails the suite instead of shipping.
 *
 * Not for production use — no Worker source may import this file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Vite cannot resolve the `node:sqlite` builtin (it postdates the bundler's
// builtin list), so it is loaded through CommonJS require at runtime instead.
// Requires Node >= 22.13; an older runtime fails loudly here by design.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// The migrations root is overridable so a mutation drill can point the shim at
// a THROWAWAY COPY of migrations/d1 instead of editing the real files. Nothing
// in normal use sets it.
const MIGRATIONS_ROOT =
  process.env.IMMI_TEST_D1_MIGRATIONS_DIR ||
  fileURLToPath(new URL("../../../migrations/d1/", import.meta.url));

export const DATABASES = Object.freeze(["catalog", "account", "ops"]);

/**
 * Every `*.sql` in the database's directory, in filename order.
 *
 * Discovered from disk rather than hardcoded, on purpose: a hardcoded list
 * silently ignores a newly added migration, and if no test happens to query
 * the new tables the whole suite stays green against a stale schema. Reading
 * the directory means a new migration enters the tests the moment it is
 * committed. Wrangler orders migrations by the `NNNN_` filename prefix, so a
 * plain lexicographic sort matches how they are applied in production.
 */
export function migrationFiles(database) {
  const dir = join(MIGRATIONS_ROOT, database);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`No migrations found for '${database}' in ${dir}`);
  return files.map((name) => join(dir, name));
}

function isReadStatement(sql) {
  return /^\s*(SELECT|WITH|PRAGMA)/i.test(sql);
}

class SqliteD1Statement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { rows_read: results.length } };
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row === undefined ? null : row;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

/** Build one migrated in-memory D1 binding: "catalog" | "account" | "ops". */
export function createSqliteD1(database) {
  if (!DATABASES.includes(database)) throw new Error(`Unknown D1 database '${database}'`);
  const db = new DatabaseSync(":memory:");
  for (const file of migrationFiles(database)) db.exec(readFileSync(file, "utf8"));
  return {
    /** Test-only escape hatch for seeding fixture rows directly. */
    exec(sql) { db.exec(sql); },
    prepare(sql) { return new SqliteD1Statement(db, sql, []); },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(isReadStatement(statement.sql) ? await statement.all() : await statement.run());
        }
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
