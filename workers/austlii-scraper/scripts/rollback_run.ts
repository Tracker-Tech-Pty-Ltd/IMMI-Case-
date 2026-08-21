#!/usr/bin/env tsx
import postgres from "postgres";
import { isAllowedTargetTable } from "../src/pipeline-config";

const RESTORABLE_FIELDS = new Set([
  "applicant_name",
  "respondent",
  "country_of_origin",
  "visa_subclass_number",
  "hearing_date",
  "is_represented",
  "representative",
  "visa_outcome_reason",
  "legal_test_applied",
  "case_nature",
  "legal_concepts",
]);

async function main() {
  const args = process.argv.slice(2);
  const runId = args.find((arg) => !arg.startsWith("--"));
  const apply = args.includes("--apply");
  const tableArg = valueAfter(args, "--target-table") || process.env.PIPELINE_TARGET_TABLE || "immigration_cases_staging";
  const dbUrl = process.env.HYPERDRIVE_SERVICE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!runId) {
    throw new Error("Usage: npx tsx scripts/rollback_run.ts <run_id> [--apply] [--target-table immigration_cases_staging]");
  }
  if (!isAllowedTargetTable(tableArg)) {
    throw new Error(`Unsupported target table: ${tableArg}`);
  }
  if (!dbUrl) {
    throw new Error("Set HYPERDRIVE_SERVICE_URL, DATABASE_URL, or SUPABASE_DB_URL.");
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    const rows = await sql<{
      case_id: string;
      field: string;
      old_value: string | null;
      created_at: string;
    }[]>`
      SELECT DISTINCT ON (case_id, field)
        case_id, field, old_value, created_at
      FROM extraction_audit
      WHERE run_id = ${runId}
      ORDER BY case_id, field, created_at ASC
    `;

    let restorable = 0;
    for (const row of rows) {
      if (!RESTORABLE_FIELDS.has(row.field)) continue;
      restorable += 1;
      const nextValue = row.old_value ?? "";
      if (!apply) {
        console.log(JSON.stringify({
          event: "rollback.dry_run",
          table: tableArg,
          run_id: runId,
          case_id: row.case_id,
          field: row.field,
          restore_to: nextValue,
        }));
        continue;
      }

      await sql`
        UPDATE ${sql(tableArg)}
        SET ${sql(row.field)} = ${nextValue}
        WHERE case_id = ${row.case_id}
      `;
      await sql`
        INSERT INTO extraction_audit (
          run_id, case_id, field, old_value, new_value, source, confidence
        )
        VALUES (${runId}, ${row.case_id}, ${row.field}, NULL, ${nextValue}, 'rollback', NULL)
      `;
    }

    console.log(JSON.stringify({
      event: apply ? "rollback.applied" : "rollback.ready",
      table: tableArg,
      run_id: runId,
      rows_seen: rows.length,
      restorable,
    }));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

function valueAfter(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
