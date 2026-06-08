"""Bootstrap per-court biweekly discovery baselines for the Cloudflare pipeline.

Computes p90 historical biweekly case counts from ``public.immigration_cases``
over the last N months and emits ``baseline:<court>:p90`` values. By default the
script writes JSON only; pass ``--write-kv --namespace-id ...`` to push values to
Workers KV with wrangler.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg2
from dotenv import load_dotenv


COURTS = ("AATA", "ARTA", "FCA", "FMCA", "FCCA", "FedCFamC2G", "HCA", "RRTA", "MRTA")
SECONDS_PER_BIWEEK = 14 * 24 * 60 * 60


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None, help="Postgres URL. Defaults to env DATABASE_URL/SUPABASE_DB_URL/HYPERDRIVE_SERVICE_URL.")
    parser.add_argument("--months", type=int, default=24, help="Historical window in months. Default: 24.")
    parser.add_argument("--output", default="workers/austlii-scraper/pipeline-baselines.json", help="JSON output path.")
    parser.add_argument("--write-kv", action="store_true", help="Write values to Cloudflare Workers KV via wrangler.")
    parser.add_argument("--namespace-id", default=None, help="KV namespace id required when --write-kv is set.")
    parser.add_argument("--worker-dir", default="workers/austlii-scraper", help="Directory where wrangler should run.")
    return parser.parse_args()


def db_url_from_env(args: argparse.Namespace) -> str:
    load_dotenv()
    url = (
        args.db_url
        or os.environ.get("DATABASE_URL")
        or os.environ.get("SUPABASE_DB_URL")
        or os.environ.get("HYPERDRIVE_SERVICE_URL")
    )
    if not url:
        raise SystemExit("Missing DB URL. Set DATABASE_URL, SUPABASE_DB_URL, HYPERDRIVE_SERVICE_URL, or pass --db-url.")
    return url


def bucket_of(day: date) -> int:
    epoch_seconds = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp())
    return math.floor(epoch_seconds / SECONDS_PER_BIWEEK)


def percentile_90(values: list[int]) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    idx = max(0, math.ceil(len(ordered) * 0.9) - 1)
    return ordered[idx]


def fetch_counts(db_url: str, start_day: date, end_day: date) -> dict[str, dict[int, int]]:
    start_sort = int(start_day.strftime("%Y%m%d"))
    end_sort = int(end_day.strftime("%Y%m%d"))
    sql = """
        SELECT
          court_code,
          floor(
            extract(epoch from (
              make_date(date_sort / 10000, (date_sort / 100) % 100, date_sort % 100)::timestamp
              - timestamp '1970-01-01 00:00:00'
            )) / %s
          )::int AS bucket,
          count(*)::int AS count
        FROM public.immigration_cases
        WHERE court_code = ANY(%s)
          AND date_sort BETWEEN %s AND %s
          AND date_sort > 19000000
        GROUP BY court_code, bucket
    """
    counts: dict[str, dict[int, int]] = defaultdict(dict)
    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(sql, (SECONDS_PER_BIWEEK, list(COURTS), start_sort, end_sort))
        for court, bucket, count in cur.fetchall():
            counts[str(court)][int(bucket)] = int(count)
    return counts


def build_baselines(counts: dict[str, dict[int, int]], start_day: date, end_day: date) -> dict[str, Any]:
    start_bucket = bucket_of(start_day)
    end_bucket = bucket_of(end_day)
    buckets = list(range(start_bucket, end_bucket + 1))
    baselines: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "window": {
            "start": start_day.isoformat(),
            "end": end_day.isoformat(),
            "bucket_count": len(buckets),
        },
        "courts": {},
    }
    for court in COURTS:
        series = [counts.get(court, {}).get(bucket, 0) for bucket in buckets]
        baselines["courts"][court] = {
            "p90": percentile_90(series),
            "max": max(series) if series else 0,
            "total": sum(series),
        }
    return baselines


def write_kv(namespace_id: str, worker_dir: Path, baselines: dict[str, Any]) -> None:
    for court, metrics in baselines["courts"].items():
        key = f"baseline:{court}:p90"
        value = str(metrics["p90"])
        subprocess.run(
            ["npx", "wrangler", "kv", "key", "put", key, value, "--namespace-id", namespace_id],
            cwd=worker_dir,
            check=True,
        )


def main() -> None:
    args = parse_args()
    if args.write_kv and not args.namespace_id:
        raise SystemExit("--namespace-id is required with --write-kv")

    end_day = datetime.now(UTC).date()
    start_day = end_day - timedelta(days=args.months * 31)
    baselines = build_baselines(fetch_counts(db_url_from_env(args), start_day, end_day), start_day, end_day)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(baselines, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {output}")

    if args.write_kv:
        write_kv(args.namespace_id, Path(args.worker_dir), baselines)


if __name__ == "__main__":
    main()
