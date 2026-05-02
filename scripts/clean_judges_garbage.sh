#!/usr/bin/env bash
# Clean garbage values from public.immigration_cases.judges via small-batch
# UPDATEs to stay under Supabase statement_timeout. Each batch picks at most
# BATCH_SIZE rows by case_id (PK lookup) so the UPDATE is fast.
#
# Usage:
#   scripts/clean_judges_garbage.sh                # dry-run (default; SELECT only)
#   scripts/clean_judges_garbage.sh --apply        # actually write
#   scripts/clean_judges_garbage.sh --apply --batch-size 500
#
# Pre-req: `supabase` CLI installed + `supabase link --project-ref <ref>` done.
# Run from repo root.
set -euo pipefail

DRY_RUN=true
BATCH_SIZE=1000
MAX_ROUNDS=50  # safety stop — 14K / 1000 = 14 rounds expected

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) DRY_RUN=false; shift ;;
    --batch-size) BATCH_SIZE="$2"; shift 2 ;;
    --help) sed -n '/^# Usage:/,/^$/p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

PATTERNS=(
  "lowercase_start|judges ~ '^[a-z]'"
  "long_fragment|LENGTH(judges) > 60"
  "bracket_dash|judges ~ '[(\\[–—]'"
  "prose_stopword|judges ILIKE '% the %' OR judges ILIKE '% that %' OR judges ILIKE '% which %' OR judges ILIKE '% of the %'"
)

count_remaining() {
  local pattern_sql="$1"
  supabase db query --linked \
    "SELECT COUNT(*) AS n FROM public.immigration_cases WHERE $pattern_sql" \
    2>/dev/null \
  | python3 -c "import sys, json
try:
    raw = sys.stdin.read()
    d = json.loads(raw[raw.index('{'):])
    print(d['rows'][0]['n'] if d.get('rows') else 0)
except Exception:
    print('0')"
}

clear_one_round() {
  local pattern_sql="$1"
  local size="$2"
  supabase db query --linked \
    "WITH ids AS (
       SELECT case_id FROM public.immigration_cases
       WHERE $pattern_sql LIMIT $size
     )
     UPDATE public.immigration_cases SET judges = ''
     WHERE case_id IN (SELECT case_id FROM ids)
     RETURNING 1" \
    2>&1 \
  | python3 -c "import sys, json
try:
    raw = sys.stdin.read()
    d = json.loads(raw[raw.index('{'):])
    print(len(d.get('rows', [])))
except Exception:
    print('0')"
}

echo '=== clean_judges_garbage.sh ==='
if [ "$DRY_RUN" = true ]; then
  echo 'Mode:       DRY-RUN (no writes)'
else
  echo 'Mode:       APPLY (writing to Supabase)'
fi
echo "Batch size: $BATCH_SIZE"
echo "Max rounds: $MAX_ROUNDS per pattern"
echo ""

TOTAL_CLEARED=0
for entry in "${PATTERNS[@]}"; do
  name="${entry%%|*}"
  sql="${entry#*|}"
  echo "--- Pattern: $name ---"
  before=$(count_remaining "$sql")
  echo "  matching rows: $before"

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY] would clear up to $BATCH_SIZE rows per round (estimated $(( (before + BATCH_SIZE - 1) / BATCH_SIZE )) rounds)"
    echo ""
    continue
  fi

  round=0
  cleared_this_pattern=0
  while [ "$round" -lt "$MAX_ROUNDS" ]; do
    round=$((round + 1))
    cleared=$(clear_one_round "$sql" "$BATCH_SIZE")
    if [ "$cleared" -lt 1 ]; then
      echo "  [round $round] 0 rows — pattern exhausted"
      break
    fi
    cleared_this_pattern=$((cleared_this_pattern + cleared))
    TOTAL_CLEARED=$((TOTAL_CLEARED + cleared))
    echo "  [round $round] cleared $cleared (pattern total $cleared_this_pattern, grand total $TOTAL_CLEARED)"
    sleep 0.3
  done

  after=$(count_remaining "$sql")
  echo "  remaining after sweep: $after"
  echo ""
done

echo '=== Summary ==='
if [ "$DRY_RUN" = true ]; then
  echo 'Dry-run only. Re-run with --apply to actually write.'
else
  echo "Total cleared this run: $TOTAL_CLEARED"
fi
