#!/usr/bin/env bash
# scripts/preflight_secrets.sh
#
# US-015: fail fast in CI if any required Cloudflare Worker secret is missing
# BEFORE `npx wrangler deploy` runs. Iteration 12 shipped without CSRF_SECRET
# bound on the Worker, causing /api/v1/csrf-token + write endpoints to 500
# with "csrf_secret_not_configured" until the secret was set post-deploy via
# manual `wrangler secret put`. This script makes that failure mode unreachable.
#
# Required env (CI): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#
# Required secrets list (kept in sync with wrangler.toml comment block):
#   CSRF_SECRET                — HMAC key for double-submit CSRF token
#   ANTHROPIC_API_KEY          — Claude moderator + expert
#   GEMINI_API_KEY             — Gemini Pro / Flash expert + moderator fallback
#   OPENAI_API_KEY             — gpt-5-mini expert
#   CF_AIG_TOKEN               — Cloudflare AI Gateway routing token
#   HYPERDRIVE_DATABASE_URL    — fallback DB URL when env.HYPERDRIVE binding misses
#
# Exit codes:
#   0 — all required secrets present
#   1 — at least one required secret missing (CI must NOT proceed to deploy)
#   2 — wrangler call failed (auth, network, or CLI not installed)

set -euo pipefail

REQUIRED_SECRETS=(
  CSRF_SECRET
  ANTHROPIC_API_KEY
  GEMINI_API_KEY
  OPENAI_API_KEY
  CF_AIG_TOKEN
  HYPERDRIVE_DATABASE_URL
)

WORKER_NAME="${WORKER_NAME:-immi-case}"

echo "[preflight] checking secrets bound on Worker '$WORKER_NAME'..."

if ! command -v npx >/dev/null 2>&1; then
  echo "[preflight] FATAL: npx not on PATH. Install Node.js + npm." >&2
  exit 2
fi

# `wrangler secret list` JSON shape: [{ "name": "FOO", "type": "secret_text" }, ...]
secrets_json="$(npx --yes wrangler secret list --name "$WORKER_NAME" --format=json 2>&1)" || {
  echo "[preflight] FATAL: wrangler secret list failed:" >&2
  printf '%s\n' "$secrets_json" >&2
  exit 2
}

# Extract names. Tolerate either pure JSON or wrangler's banner+JSON output.
present_names="$(printf '%s' "$secrets_json" \
  | python3 -c 'import json,sys,re
raw = sys.stdin.read()
m = re.search(r"\[\s*{.*}\s*\]", raw, re.S)
if not m:
    sys.exit(0)
try:
    arr = json.loads(m.group(0))
except Exception:
    sys.exit(0)
for item in arr:
    if isinstance(item, dict) and "name" in item:
        print(item["name"])
')"

missing=()
for name in "${REQUIRED_SECRETS[@]}"; do
  if ! printf '%s\n' "$present_names" | grep -Fxq "$name"; then
    missing+=("$name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "[preflight] FAIL: ${#missing[@]} required secret(s) missing on Worker '$WORKER_NAME':" >&2
  for name in "${missing[@]}"; do
    echo "  - $name" >&2
  done
  echo "" >&2
  echo "Set missing secrets via:" >&2
  echo "  npx wrangler secret put <NAME> --name $WORKER_NAME" >&2
  echo "Then re-run this preflight before redeploying." >&2
  exit 1
fi

echo "[preflight] OK: all ${#REQUIRED_SECRETS[@]} required secrets present."
exit 0
