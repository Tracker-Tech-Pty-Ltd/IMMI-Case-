import postgres from "postgres";
import type { CourtCode } from "./pipeline-config";
import { isAllowedTargetTable } from "./pipeline-config";
import type { Env } from "./types";

type Sql = ReturnType<typeof postgres>;

export interface PipelineRunPatch {
  discovered?: number;
  errors?: number;
  errorsJson?: unknown;
  status?: "running" | "ok" | "aborted" | "failed";
  abortReason?: string | null;
}

function connectionString(env: Env): string {
  if (env.HYPERDRIVE_SERVICE?.connectionString) {
    return env.HYPERDRIVE_SERVICE.connectionString;
  }
  if (env.HYPERDRIVE_SERVICE_URL) {
    return env.HYPERDRIVE_SERVICE_URL;
  }
  throw new Error("Missing HYPERDRIVE_SERVICE binding or HYPERDRIVE_SERVICE_URL secret");
}

export function discoveryTargetTable(env: Env): "immigration_cases" | "immigration_cases_staging" {
  const table = env.PIPELINE_TARGET_TABLE || "immigration_cases_staging";
  if (!isAllowedTargetTable(table)) {
    throw new Error(`Unsupported PIPELINE_TARGET_TABLE: ${table}`);
  }
  return table;
}

export async function withSql<T>(
  env: Env,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(connectionString(env), {
    max: 1,
    idle_timeout: 5,
  });

  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

export async function assertSchemaConsistent(env: Env): Promise<void> {
  await withSql(env, async (sql) => {
    const rows = await sql<{ pipeline_runs: string | null; target_table: string | null }[]>`
      SELECT
        to_regclass('public.pipeline_runs')::text AS pipeline_runs,
        to_regclass(${`public.${discoveryTargetTable(env)}`})::text AS target_table
    `;
    const row = rows[0];
    if (!row?.pipeline_runs || !row.target_table) {
      throw new Error(
        `Pipeline schema missing: pipeline_runs=${row?.pipeline_runs ?? "null"} target_table=${row?.target_table ?? "null"}`,
      );
    }
  });
}

export async function startPipelineRun(
  env: Env,
  options: { trigger: "cron" | "manual" | "webhook"; courts: CourtCode[]; phase: string },
): Promise<string> {
  return withSql(env, async (sql) => {
    const rows = await sql<{ run_id: string }[]>`
      INSERT INTO pipeline_runs (trigger, court, phase, status)
      VALUES (${options.trigger}, ${options.courts.join(",")}, ${options.phase}, 'running')
      RETURNING run_id::text
    `;
    return rows[0].run_id;
  });
}

export async function updatePipelineRun(
  env: Env,
  runId: string,
  patch: PipelineRunPatch,
): Promise<void> {
  const errorsJson = patch.errorsJson === undefined ? null : JSON.stringify(patch.errorsJson);
  await withSql(env, async (sql) => {
    await sql`
      UPDATE pipeline_runs
      SET
        discovered = COALESCE(${patch.discovered ?? null}, discovered),
        errors = COALESCE(${patch.errors ?? null}, errors),
        errors_json = COALESCE(${errorsJson}::jsonb, errors_json),
        status = COALESCE(${patch.status ?? null}, status),
        abort_reason = COALESCE(${patch.abortReason ?? null}, abort_reason),
        finished_at = CASE
          WHEN ${patch.status ?? null} IN ('ok', 'aborted', 'failed') THEN now()
          ELSE finished_at
        END
      WHERE run_id = ${runId}
    `;
  });
}

export async function findExistingCases(
  env: Env,
  table: "immigration_cases" | "immigration_cases_staging",
  court: CourtCode,
  caseIds: string[],
  urls: string[],
): Promise<Set<string>> {
  if (caseIds.length === 0 && urls.length === 0) return new Set();

  return withSql(env, async (sql) => {
    const rows = await sql<{ case_id: string | null; url: string | null }[]>`
      SELECT case_id, url
      FROM ${sql(table)}
      WHERE (court_code = ${court} AND case_id = ANY(${caseIds}))
        OR url = ANY(${urls})
    `;
    const existing = new Set<string>();
    for (const row of rows) {
      if (row.case_id) existing.add(row.case_id);
      if (row.url) existing.add(row.url);
    }
    return existing;
  });
}
