"""One offline entry point for evidence review, approved apply, and recovery."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from immi_case_downloader.repair_workflow import (  # noqa: E402
    apply_approved, import_source_attempts, recover, review_catalogue,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("review", "apply", "recover"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--prior-status", type=Path)
    parser.add_argument("--source-queue", type=Path)
    parser.add_argument("--approvals", type=Path)
    parser.add_argument("--jev-cache", type=Path, help="Read-only existing Jev cache; makes no API calls")
    args = parser.parse_args()
    ledger = args.ledger or args.root / "downloaded_cases/.case-field-review.sqlite3"
    if args.source_queue:
        import_source_attempts(ledger, json.loads(args.source_queue.read_text(encoding="utf-8")))
    if args.command == "review":
        result = review_catalogue(args.root, args.output, ledger=ledger, prior_status=args.prior_status, jev_cache=args.jev_cache)
    elif args.command == "apply":
        if not args.approvals:
            parser.error("apply requires --approvals (independently checked source evidence)")
        result = apply_approved(args.root, args.output, json.loads(args.approvals.read_text(encoding="utf-8")))
    else:
        result = recover(args.root)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
