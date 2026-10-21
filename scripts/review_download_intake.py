"""Export automatic local download reviews; no network, model call, or fact write."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from immi_case_downloader.ingestion import intake_schema, ledger_path  # noqa: E402
from immi_case_downloader.repair_workflow import open_ledger, write_json  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-dir", type=Path, default=Path("downloaded_cases"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records, fields = [], []
    with open_ledger(ledger_path(args.base_dir)) as conn:
        intake_schema(conn)
        for row in conn.execute("SELECT record FROM intake_reviews ORDER BY case_id"):
            record = json.loads(row[0])
            records.append(record)
            for field in record["fields"]:
                fields.append({**{k: record[k] for k in ("case_id", "citation", "url", "source_path", "source_sha256")}, **field})
    summary = {"cases": len(records), "missing_fields": len(fields),
               "counts": dict(Counter(row["fact_status"] for row in fields)),
               "network_requests": 0, "paid_model_calls": 0, "new_provider_usd": 0}
    write_json(args.output / "intake-review.json", records)
    write_json(args.output / "summary.json", summary)
    with (args.output / "remaining-fields.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        columns = ["case_id", "citation", "field", "fact_status", "reason_code", "reason", "prior_reason", "url", "source_path", "source_sha256"]
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(fields)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
