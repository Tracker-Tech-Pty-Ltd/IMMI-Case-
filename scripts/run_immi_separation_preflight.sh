#!/usr/bin/env bash
# Run the deterministic IMMI separation verifier twice and compare the reports.
#
# This wrapper is local/read-only by default. Set IMMI_PREFLIGHT_LIVE=1 to add
# the verifier's read-only Cloudflare Hyperdrive check. The wrapper preserves
# the verifier's contract: 0=ready, 1=blocked, 2=error.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${TMPDIR:-/tmp}/immi-separation-preflight}"
VERIFIER="$ROOT/scripts/verify_immi_separation.py"

mkdir -p "$OUT_DIR"

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

run_report() {
  local output="$1"
  shift
  local log="${output}.stdout"
  local rc=0
  python3 "$VERIFIER" --json --output "$output" "$@" >"$log" 2>&1 || rc=$?
  printf 'report=%s rc=%s sha256=%s\n' "$output" "$rc" "$(hash_file "$output")"
  return "$rc"
}

standard_one="$OUT_DIR/standard-1.json"
standard_two="$OUT_DIR/standard-2.json"

set +e
run_report "$standard_one"
rc_one=$?
run_report "$standard_two"
rc_two=$?
set -e

if ! cmp -s "$standard_one" "$standard_two"; then
  echo "ERROR: consecutive standard reports differ" >&2
  exit 2
fi

if [[ "$rc_one" -ne "$rc_two" || ( "$rc_one" -ne 0 && "$rc_one" -ne 1 ) ]]; then
  printf 'ERROR: unexpected standard verifier exit codes rc1=%s rc2=%s\n' "$rc_one" "$rc_two" >&2
  exit 2
fi

if [[ "${IMMI_PREFLIGHT_LIVE:-0}" == "1" ]]; then
  live="$OUT_DIR/live.json"
  set +e
  run_report "$live" --live
  live_rc=$?
  set -e
  if [[ "$live_rc" -eq 2 ]]; then
    echo "ERROR: live verifier returned an internal error" >&2
    exit 2
  fi
  printf 'live_rc=%s\n' "$live_rc"
fi

printf 'standard_reports_identical=true\nstandard_rc=%s\n' "$rc_one"
exit "$rc_one"
