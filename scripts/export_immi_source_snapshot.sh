#!/usr/bin/env bash
# Read-only refresh of the IMMI-owned source snapshot.
#
# This script deliberately has no DROP/ALTER/INSERT path. It refuses a host
# other than the current shared source and takes the database password only
# from the caller's environment. Never put the password in this file, a URL in
# shell history, or a committed artifact.

set -euo pipefail

SOURCE_REF="urntbuqczarkuoaosjxd"
SOURCE_HOST="db.${SOURCE_REF}.supabase.co"
OUT_DIR="${1:-}"

if [[ -z "$OUT_DIR" ]]; then
  echo "Usage: SUPABASE_DB_PASSWORD='<out-of-band>' $0 <output-dir>" >&2
  exit 2
fi
if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "Refusing export: set SUPABASE_DB_PASSWORD in the environment (do not paste it here)." >&2
  exit 2
fi
if [[ "${IMMI_SOURCE_HOST:-$SOURCE_HOST}" != "$SOURCE_HOST" ]]; then
  echo "Refusing export: source host is not the authoritative shared IMMI source." >&2
  exit 2
fi
if [[ "$OUT_DIR" == *"urntbuqczarkuoaosjxd"* ]]; then
  echo "Refusing export: output path must not contain the shared project ref." >&2
  exit 2
fi

mkdir -p "$OUT_DIR"

PG_ARGS=(
  --host "$SOURCE_HOST"
  --port 5432
  --username postgres
  --dbname postgres
  --no-owner
  --no-privileges
  --sslmode require
)

TABLE_ARGS=(
  --table=public.council_sessions
  --table=public.council_turns
  --table=public.immi_users
  --table=public.immi_tenants
  --table=public.immi_tenant_members
  --table=public.immi_tenant_invites
  --table=public.immi_collections
  --table=public.immi_saved_searches
  --table=public.immigration_cases
  --table=public.immigration_cases_staging
  --table=public.judge_bios
  --table=public.pipeline_runs
  --table=public.extraction_audit
)

ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/immi-pg-env.XXXXXX")"
chmod 600 "$ENV_FILE"
printf 'PGPASSWORD=%s\n' "$SUPABASE_DB_PASSWORD" > "$ENV_FILE"
trap 'rm -f "$ENV_FILE"; unset SUPABASE_DB_PASSWORD' EXIT

# A single pg_dump connection provides one repeatable-read snapshot across all
# listed IMMI tables. Do not split the data export into separately timed runs.
docker run --rm \
  --env-file "$ENV_FILE" \
  --volume "$PWD/$OUT_DIR:/out" \
  postgres:17 \
  pg_dump "${PG_ARGS[@]}" --format=custom --verbose "${TABLE_ARGS[@]}" --file=/out/immi_tables_data.dump

docker run --rm \
  --env-file "$ENV_FILE" \
  --volume "$PWD/$OUT_DIR:/out" \
  postgres:17 \
  pg_dump "${PG_ARGS[@]}" --schema-only --verbose \
  --function=public.immi_auth_jwt_claims \
  --function=public.immi_auth_tenant_id \
  --function=public.immi_auth_user_id \
  --file=/out/immi_dependencies.sql

docker run --rm --volume "$PWD/$OUT_DIR:/out:ro" postgres:17 \
  pg_restore --list /out/immi_tables_data.dump > "$OUT_DIR/immi_tables_data.restore-list.txt"

python3 - "$OUT_DIR/snapshot-manifest.json" <<'PY'
import json
import sys
from datetime import datetime, timezone

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(
        {
            "source": "authoritative-shared-immi",
            "snapshot_taken_at": datetime.now(timezone.utc).isoformat(),
            "format": "pg_dump-custom",
            "consistency": "single-pg_dump-connection",
        },
        handle,
        sort_keys=True,
    )
    handle.write("\n")
PY

shasum -a 256 \
  "$OUT_DIR/immi_tables_data.dump" \
  "$OUT_DIR/immi_dependencies.sql" \
  "$OUT_DIR/immi_tables_data.restore-list.txt" \
  "$OUT_DIR/snapshot-manifest.json" \
  > "$OUT_DIR/checksums.sha256"

echo "Read-only IMMI source snapshot written to $OUT_DIR"
echo "No shared database mutation was attempted."
