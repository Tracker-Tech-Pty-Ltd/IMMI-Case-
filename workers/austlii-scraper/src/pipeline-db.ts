import postgres from "postgres";
import type { CourtCode } from "./pipeline-config";
import { isAllowedTargetTable } from "./pipeline-config";
import type { Env, ExtractedCase, ExtractionField } from "./types";

type Sql = ReturnType<typeof postgres>;

export interface PipelineRunPatch {
  discovered?: number;
  errors?: number;
  errorsJson?: unknown;
  status?: "running" | "ok" | "aborted" | "failed";
  abortReason?: string | null;
}

export interface PipelineRunMetricDelta {
  scraped?: number;
  extracted?: number;
  upserted?: number;
  llmCalls?: number;
  costUsd?: number;
  errors?: number;
}

const UPSERT_FIELDS = [
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
] as const;

type UpsertField = typeof UPSERT_FIELDS[number];

interface CaseRow {
  case_id: string;
  citation: string;
  title: string;
  court: string;
  court_code: string;
  date: string;
  year: number;
  url: string;
  judges: string;
  catchwords: string;
  outcome: string;
  visa_type: string;
  legislation: string;
  text_snippet: string;
  full_text_path: string;
  source: string;
  case_nature: string;
  legal_concepts: string;
  visa_subclass: string;
  applicant_name: string;
  respondent: string;
  country_of_origin: string;
  visa_subclass_number: string;
  hearing_date: string;
  is_represented: string;
  representative: string;
  visa_outcome_reason: string;
  legal_test_applied: string;
  last_extraction_run_id: string;
  extraction_confidence: Record<string, { confidence: number; source: string }>;
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

export async function addPipelineRunMetrics(
  env: Env,
  runId: string,
  delta: PipelineRunMetricDelta,
): Promise<void> {
  await withSql(env, async (sql) => {
    await sql`
      UPDATE pipeline_runs
      SET
        scraped = scraped + ${delta.scraped ?? 0},
        extracted = extracted + ${delta.extracted ?? 0},
        upserted = upserted + ${delta.upserted ?? 0},
        llm_calls = llm_calls + ${delta.llmCalls ?? 0},
        cost_usd = cost_usd + ${delta.costUsd ?? 0},
        errors = errors + ${delta.errors ?? 0}
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

export async function upsertExtractedCase(
  env: Env,
  runId: string,
  extracted: ExtractedCase,
): Promise<"inserted" | "updated" | "skipped"> {
  const table = discoveryTargetTable(env);
  const insertOnly = env.PIPELINE_INSERT_ONLY !== "false";
  const row = buildCaseRow(runId, extracted);
  const auditFields = buildAuditFields(extracted.fields);

  return withSql(env, async (sql) => {
    const previousRows = insertOnly
      ? []
      : await sql<(Record<UpsertField, string | null>)[]>`
          SELECT
            applicant_name, respondent, country_of_origin, visa_subclass_number,
            hearing_date, is_represented, representative, visa_outcome_reason,
            legal_test_applied, case_nature, legal_concepts
          FROM ${sql(table)}
          WHERE case_id = ${row.case_id}
          LIMIT 1
        `;
    const previous = previousRows[0] ?? null;

    const rows = await sql<{ case_id: string }[]>`
      INSERT INTO ${sql(table)} (
        case_id, citation, title, court, court_code, date, year, url,
        judges, catchwords, outcome, visa_type, legislation, text_snippet,
        full_text_path, source, case_nature, legal_concepts, visa_subclass,
        applicant_name, respondent, country_of_origin, visa_subclass_number,
        hearing_date, is_represented, representative, visa_outcome_reason,
        legal_test_applied, last_extraction_run_id, extraction_confidence
      )
      VALUES (
        ${row.case_id}, ${row.citation}, ${row.title}, ${row.court},
        ${row.court_code}, ${row.date}, ${row.year}, ${row.url},
        ${row.judges}, ${row.catchwords}, ${row.outcome}, ${row.visa_type},
        ${row.legislation}, ${row.text_snippet}, ${row.full_text_path},
        ${row.source}, ${row.case_nature}, ${row.legal_concepts},
        ${row.visa_subclass}, ${row.applicant_name}, ${row.respondent},
        ${row.country_of_origin}, ${row.visa_subclass_number},
        ${row.hearing_date}, ${row.is_represented}, ${row.representative},
        ${row.visa_outcome_reason}, ${row.legal_test_applied}, ${runId},
        ${JSON.stringify(row.extraction_confidence)}::jsonb
      )
      ON CONFLICT (case_id) DO ${insertOnly
        ? sql`NOTHING`
        : sql`UPDATE SET
            citation = COALESCE(NULLIF(EXCLUDED.citation, ''), ${sql(table)}.citation),
            title = COALESCE(NULLIF(EXCLUDED.title, ''), ${sql(table)}.title),
            court = COALESCE(NULLIF(EXCLUDED.court, ''), ${sql(table)}.court),
            court_code = COALESCE(NULLIF(EXCLUDED.court_code, ''), ${sql(table)}.court_code),
            date = COALESCE(NULLIF(EXCLUDED.date, ''), ${sql(table)}.date),
            year = CASE WHEN EXCLUDED.year > 0 THEN EXCLUDED.year ELSE ${sql(table)}.year END,
            url = COALESCE(NULLIF(EXCLUDED.url, ''), ${sql(table)}.url),
            judges = COALESCE(NULLIF(EXCLUDED.judges, ''), ${sql(table)}.judges),
            catchwords = COALESCE(NULLIF(EXCLUDED.catchwords, ''), ${sql(table)}.catchwords),
            outcome = COALESCE(NULLIF(EXCLUDED.outcome, ''), ${sql(table)}.outcome),
            visa_type = COALESCE(NULLIF(EXCLUDED.visa_type, ''), ${sql(table)}.visa_type),
            legislation = COALESCE(NULLIF(EXCLUDED.legislation, ''), ${sql(table)}.legislation),
            text_snippet = COALESCE(NULLIF(EXCLUDED.text_snippet, ''), ${sql(table)}.text_snippet),
            full_text_path = COALESCE(NULLIF(EXCLUDED.full_text_path, ''), ${sql(table)}.full_text_path),
            source = COALESCE(NULLIF(EXCLUDED.source, ''), ${sql(table)}.source),
            case_nature = COALESCE(NULLIF(EXCLUDED.case_nature, ''), ${sql(table)}.case_nature),
            legal_concepts = COALESCE(NULLIF(EXCLUDED.legal_concepts, ''), ${sql(table)}.legal_concepts),
            visa_subclass = COALESCE(NULLIF(EXCLUDED.visa_subclass, ''), ${sql(table)}.visa_subclass),
            applicant_name = COALESCE(NULLIF(EXCLUDED.applicant_name, ''), ${sql(table)}.applicant_name),
            respondent = COALESCE(NULLIF(EXCLUDED.respondent, ''), ${sql(table)}.respondent),
            country_of_origin = COALESCE(NULLIF(EXCLUDED.country_of_origin, ''), ${sql(table)}.country_of_origin),
            visa_subclass_number = COALESCE(NULLIF(EXCLUDED.visa_subclass_number, ''), ${sql(table)}.visa_subclass_number),
            hearing_date = COALESCE(NULLIF(EXCLUDED.hearing_date, ''), ${sql(table)}.hearing_date),
            is_represented = COALESCE(NULLIF(EXCLUDED.is_represented, ''), ${sql(table)}.is_represented),
            representative = COALESCE(NULLIF(EXCLUDED.representative, ''), ${sql(table)}.representative),
            visa_outcome_reason = COALESCE(NULLIF(EXCLUDED.visa_outcome_reason, ''), ${sql(table)}.visa_outcome_reason),
            legal_test_applied = COALESCE(NULLIF(EXCLUDED.legal_test_applied, ''), ${sql(table)}.legal_test_applied),
            last_extraction_run_id = EXCLUDED.last_extraction_run_id,
            extraction_confidence = EXCLUDED.extraction_confidence,
            updated_at = now()`}
      RETURNING case_id
    `;

    if (rows.length === 0) return "skipped";

    for (const field of auditFields.filter((item) => item.newValue !== "")) {
      const oldValue = previous ? String(previous[field.name] ?? "") || null : null;
      await sql`
        INSERT INTO extraction_audit (
          run_id, case_id, field, old_value, new_value, source, confidence
        )
        VALUES (
          ${runId}, ${row.case_id}, ${field.name}, ${oldValue}, ${field.newValue},
          ${field.source}, ${field.confidence}
        )
      `;
    }

    return previous ? "updated" : "inserted";
  });
}

function buildCaseRow(runId: string, extracted: ExtractedCase): CaseRow {
  const base = extracted.base ?? {};
  const fields = extracted.fields ?? {};
  const visaSubclassNumber = textValue(fields.visa_subclass_number) || textBase(base.visa_subclass_number);
  const fullText = textBase(base.full_text);
  const textSnippet = textBase(base.text_snippet) || fullText.slice(0, 500);

  return {
    case_id: extracted.case_id,
    citation: textBase(base.citation),
    title: textBase(base.title),
    court: textBase(base.court) || textBase(base.court_code),
    court_code: textBase(base.court_code),
    date: textBase(base.date),
    year: numberBase(base.year),
    url: textBase(base.url),
    judges: textBase(base.judges),
    catchwords: textBase(base.catchwords),
    outcome: textBase(base.outcome),
    visa_type: textBase(base.visa_type),
    legislation: textBase(base.legislation),
    text_snippet: textSnippet,
    full_text_path: extracted.r2_key ? `r2://austlii-case-results/${extracted.r2_key}` : "",
    source: "austlii-pipeline",
    case_nature: textValue(fields.case_nature),
    legal_concepts: textValue(fields.legal_concepts),
    visa_subclass: textBase(base.visa_subclass) || visaSubclassNumber,
    applicant_name: textValue(fields.applicant_name),
    respondent: textValue(fields.respondent),
    country_of_origin: textValue(fields.country_of_origin),
    visa_subclass_number: visaSubclassNumber,
    hearing_date: textValue(fields.hearing_date),
    is_represented: textValue(fields.is_represented),
    representative: textValue(fields.representative),
    visa_outcome_reason: textValue(fields.visa_outcome_reason),
    legal_test_applied: textValue(fields.legal_test_applied),
    last_extraction_run_id: runId,
    extraction_confidence: Object.fromEntries(
      Object.entries(fields).map(([field, envelope]) => [
        field,
        { confidence: envelope.confidence, source: envelope.source },
      ]),
    ),
  };
}

function buildAuditFields(fields: Record<string, ExtractionField>) {
  return UPSERT_FIELDS
    .filter((name) => fields[name])
    .map((name) => ({
      name,
      newValue: textValue(fields[name]),
      source: fields[name].source,
      confidence: fields[name].confidence,
    }));
}

function textValue(field: ExtractionField | undefined): string {
  if (!field || field.value === null || field.value === undefined) return "";
  return String(field.value).trim();
}

function textBase(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function numberBase(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
