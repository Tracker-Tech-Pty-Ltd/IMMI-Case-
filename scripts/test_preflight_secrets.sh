#!/usr/bin/env bash
# scripts/test_preflight_secrets.sh
#
# Smoke test for scripts/preflight_secrets.sh — exercises the three exit
# code paths without contacting the real Cloudflare API. Mocks
# `npx wrangler secret list` via a fake `npx` on PATH so the script's
# behaviour can be deterministically driven from fixture text.
#
# Why this exists:
#   - LOW #3 reviewer concern from US-015 sprint: exit-1 path
#     (named-missing list) was never locally exercised — only exit-0
#     (CI happy-path) and exit-2 (FATAL) had real evidence.
#
# Usage:
#   bash scripts/test_preflight_secrets.sh
#
# Exits non-zero on any test failure.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"
SCRIPT="$REPO_ROOT/scripts/preflight_secrets.sh"

if [[ ! -x "$SCRIPT" ]]; then
  echo "FAIL: $SCRIPT not executable" >&2
  exit 1
fi

# Workspace for the fake npx and its fixture.
TMP_DIR="$(mktemp -d -t preflight-test.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_NPX="$TMP_DIR/npx"
FIXTURE="$TMP_DIR/secrets.json"

cat >"$FAKE_NPX" <<'EOF'
#!/usr/bin/env bash
# Fake `npx wrangler secret list ... --format=json` shim.
# Reads the JSON to print from PREFLIGHT_TEST_FIXTURE.
exec cat "$PREFLIGHT_TEST_FIXTURE"
EOF
chmod +x "$FAKE_NPX"

FAIL=0

run_case() {
  local name="$1"
  local fixture_json="$2"
  local expected_exit="$3"
  local expected_stderr_contains="${4:-}"

  printf '%s' "$fixture_json" >"$FIXTURE"

  set +e
  output="$(
    PATH="$TMP_DIR:$PATH" \
    PREFLIGHT_TEST_FIXTURE="$FIXTURE" \
    WORKER_NAME=test-worker \
    bash "$SCRIPT" 2>&1
  )"
  actual_exit=$?
  set -e

  if [[ "$actual_exit" -ne "$expected_exit" ]]; then
    echo "FAIL [$name] expected exit=$expected_exit got=$actual_exit" >&2
    echo "----- output -----" >&2
    echo "$output" >&2
    echo "------------------" >&2
    FAIL=1
    return
  fi

  if [[ -n "$expected_stderr_contains" ]]; then
    if ! grep -Fq "$expected_stderr_contains" <<<"$output"; then
      echo "FAIL [$name] expected output to contain '$expected_stderr_contains'" >&2
      echo "----- output -----" >&2
      echo "$output" >&2
      echo "------------------" >&2
      FAIL=1
      return
    fi
  fi

  echo "PASS [$name] exit=$actual_exit"
}

run_case "exit-0 happy path" \
  '[{"name":"CSRF_SECRET","type":"secret_text"},{"name":"CF_AIG_TOKEN","type":"secret_text"},{"name":"OTHER","type":"secret_text"}]' \
  0

run_case "exit-1 named-missing" \
  '[{"name":"CSRF_SECRET","type":"secret_text"}]' \
  1 \
  "CF_AIG_TOKEN"

run_case "exit-1 all-missing" \
  '[]' \
  1 \
  "CSRF_SECRET"

run_case "exit-0 wrangler banner tolerated" \
  '⚠ wrangler warning text
[{"name":"CSRF_SECRET","type":"secret_text"},{"name":"CF_AIG_TOKEN","type":"secret_text"}]' \
  0

if (( FAIL == 0 )); then
  echo
  echo "ALL PREFLIGHT TESTS PASSED"
  exit 0
else
  echo
  echo "PREFLIGHT TESTS FAILED" >&2
  exit 1
fi
