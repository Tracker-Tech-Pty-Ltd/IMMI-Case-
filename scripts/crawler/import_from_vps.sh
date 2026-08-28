#!/usr/bin/env bash
# Read-only fetch of the AustLII VPS crawler's two source files into version
# control. This script writes nothing to the VPS (no ssh commands, no
# rsync --delete — scp only) and transfers no credentials: it copies into an
# out-of-repository quarantine first, scans there for anything that looks
# like an embedded secret, and only after that scan passes does it require an
# explicit confirmation before moving the files into this directory.
#
# The ordering (quarantine -> scan -> confirm -> move) is deliberate and not
# an implementation detail: fetching straight to the final repo paths would
# mean a failed second copy leaves a half-import in the tree, and a
# credential-bearing file would land inside the repository before anything
# had looked at it — one careless `git add -A` away from being committed.

set -euo pipefail

# Single-dash (unset-only) default, not `:-`: a caller must be able to
# export IMMI_CRAWLER_HOST="" explicitly to get a genuinely empty
# CRAWLER_HOST for local testing (see the SRC composition below), which
# `:-` would silently override back to "hstgr".
CRAWLER_HOST="${IMMI_CRAWLER_HOST-hstgr}"
CRAWLER_PATH="${IMMI_CRAWLER_PATH:-/opt/austlii-crawler}"

# Resolve this script's own directory so it can be run from any cwd.
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Refuse to overwrite an existing import before any network call — an
# already-imported tree costs nothing to re-run against.
if [[ -e "$DEST/crawler.py" || -e "$DEST/pipeline.sh" ]]; then
  echo "Refusing to import: $DEST/crawler.py or $DEST/pipeline.sh already exists. Remove it first, then re-run." >&2
  exit 2
fi

QUARANTINE="$(mktemp -d "${TMPDIR:-/tmp}/immi-crawler-import.XXXXXX")"
chmod 700 "$QUARANTINE"
cleanup() { rm -rf "$QUARANTINE"; }
trap cleanup EXIT INT TERM

# scp accepts a plain local path as a source when no "host:" prefix is
# present, which is what lets this script be exercised locally (a fake
# IMMI_CRAWLER_PATH, empty IMMI_CRAWLER_HOST) without ever touching the VPS.
SRC="${CRAWLER_HOST:+$CRAWLER_HOST:}$CRAWLER_PATH"

# Fetch exactly two files. Nothing else — no .bak files, no venv, no logs, no
# WireGuard config. If either copy fails, set -e aborts and the trap cleans
# up the quarantine; the repository is left untouched.
scp "$SRC/crawler.py" "$QUARANTINE/crawler.py"
scp "$SRC/pipeline.sh" "$QUARANTINE/pipeline.sh"

missing=()
for f in crawler.py pipeline.sh; do
  if [[ ! -s "$QUARANTINE/$f" ]]; then
    missing+=("$f")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Refusing to import: missing or empty after fetch: ${missing[*]}" >&2
  exit 4
fi

# Scan the quarantined files for anything that looks like an embedded
# credential before they are ever visible to `git status`.
if grep -nEi '(token|secret|password|api[_-]?key)[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']{8,}' "$QUARANTINE/crawler.py" "$QUARANTINE/pipeline.sh"; then
  echo "Refusing to import: a literal credential appears above. Rotate CRAWLER_WRITE_TOKEN, change the source to read it from the environment, then re-run. Nothing was written to the repository." >&2
  exit 3
fi

echo "--- $QUARANTINE/crawler.py ---"
cat "$QUARANTINE/crawler.py"
echo "--- $QUARANTINE/pipeline.sh ---"
cat "$QUARANTINE/pipeline.sh"

if [[ "${IMMI_CRAWLER_IMPORT_YES:-}" != "1" ]]; then
  echo "Review the two files above. Re-run with IMMI_CRAWLER_IMPORT_YES=1 to write them into $DEST."
  exit 0
fi

mv "$QUARANTINE/crawler.py" "$DEST/crawler.py"
if ! mv "$QUARANTINE/pipeline.sh" "$DEST/pipeline.sh"; then
  echo "Import partially failed: $DEST/crawler.py was written but pipeline.sh was not. Delete $DEST/crawler.py before retrying." >&2
  exit 5
fi

echo "Imported:"
echo "  $DEST/crawler.py"
echo "  $DEST/pipeline.sh"
echo "Next: review the diff, complete the 'Recovery bundle' checklist in $DEST/README.md, then commit."
