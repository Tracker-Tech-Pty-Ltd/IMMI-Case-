"""
Sync scrape results from Cloudflare R2 to local files and CSV.

Downloads R2 JSON results via Worker HTTP API → saves .txt files → updates CSV.
Compatible with storage.py's save_case_text() format (5-line header).

Usage:
    python scripts/sync_results.py                # sync all results
    python scripts/sync_results.py --limit 100     # sync first 100 only
    python scripts/sync_results.py --errors         # show error summary
    python scripts/sync_results.py --court ARTA     # sync only ARTA results
"""

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.cloudflare_config import (
    WORKER_URL,
    WORKER_AUTH_TOKEN,
    CSV_PATH,
    JSON_PATH,
    TEXT_DIR,
)


HEADERS = {
    "Content-Type": "application/json",
    "X-Auth-Token": WORKER_AUTH_TOKEN,
}


def save_text_file(result: dict, text_dir: Path) -> str:
    """Save full text to a .txt file matching storage.py format.

    Format (5-line header):
        Title: ...
        Citation: ...
        Court: ...
        Date: ...
        URL: ...
        ================================================================================

        <full text>
    """
    text_dir.mkdir(parents=True, exist_ok=True)

    citation = result.get("citation", "")
    case_id = result.get("case_id", "")
    title = result.get("title", "")

    # Build filename from citation (matching storage.py logic)
    filename_base = citation or case_id or title
    filename = "".join(
        c if c.isalnum() or c in " -_[]" else "_" for c in filename_base
    )
    filename = filename.strip()[:100]
    if not filename:
        filename = f"case_{hash(result.get('url', '')) % 100000}"
    filename = f"{filename}.txt"

    filepath = text_dir / filename

    # Don't overwrite existing files
    if filepath.exists():
        return str(filepath)

    court_code = result.get("court_code", "")
    date = result.get("date", "")
    url = result.get("url", "")
    full_text = result.get("full_text", "")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {title}\n")
        f.write(f"Citation: {citation}\n")
        f.write(f"Court: {court_code}\n")
        f.write(f"Date: {date}\n")
        f.write(f"URL: {url}\n")
        f.write(f"{'=' * 80}\n\n")
        f.write(full_text)

    return str(filepath)


async def list_all_keys(prefix: str = "results/") -> list[str]:
    """List all R2 keys with the given prefix using the Worker /list endpoint."""
    import aiohttp

    all_keys: list[str] = []
    cursor: str | None = None

    async with aiohttp.ClientSession() as session:
        while True:
            params = {"prefix": prefix, "limit": "1000"}
            if cursor:
                params["cursor"] = cursor

            async with session.get(
                f"{WORKER_URL}/list",
                headers=HEADERS,
                params=params,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()

            all_keys.extend(data.get("keys", []))

            if data.get("truncated") and data.get("cursor"):
                cursor = data["cursor"]
            else:
                break

            if len(all_keys) % 10000 == 0:
                print(f"    Listed {len(all_keys):,} keys...")

    return all_keys


async def download_batch(
    keys: list[str],
    concurrency: int = 10,
) -> list[dict]:
    """Download results from R2 via Worker /batch-get endpoint."""
    import aiohttp

    results: list[dict] = []
    semaphore = asyncio.Semaphore(concurrency)
    total = len(keys)
    processed = 0
    start_time = time.time()

    async def fetch_batch(session: aiohttp.ClientSession, batch_keys: list[str]):
        nonlocal processed
        async with semaphore:
            try:
                async with session.post(
                    f"{WORKER_URL}/batch-get",
                    json={"keys": batch_keys},
                    headers=HEADERS,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status != 200:
                        print(f"    WARNING: batch-get returned {resp.status}")
                        return

                    data = await resp.json()
                    for key, result in data.get("results", {}).items():
                        if result and result.get("success"):
                            results.append(result)
            except Exception as e:
                print(f"    WARNING: batch-get failed: {e}")

            processed += len(batch_keys)
            if processed % 5000 < 50:
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                eta = (total - processed) / rate if rate > 0 else 0
                print(
                    f"    Downloaded {processed:,}/{total:,} "
                    f"({processed * 100 // total}%) "
                    f"| {rate:.0f}/s | ETA: {eta / 60:.1f}m"
                )

    # Split into batches of 50 (Worker limit)
    batches = [keys[i : i + 50] for i in range(0, len(keys), 50)]

    connector = aiohttp.TCPConnector(limit=concurrency + 5)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [fetch_batch(session, batch) for batch in batches]
        await asyncio.gather(*tasks)

    return results


def update_csv(synced: list[dict], csv_path: Path):
    """Update CSV with synced data from R2."""
    if not csv_path.exists():
        print(f"  CSV not found: {csv_path}")
        return

    df = pd.read_csv(csv_path, encoding="utf-8-sig", dtype=str, low_memory=False)
    print(f"  CSV loaded: {len(df)} records")

    # Build lookup by URL for fast matching
    url_to_data = {r["url"]: r for r in synced}

    updated = 0
    for idx, row in df.iterrows():
        url = str(row.get("url", "")).strip()
        if url not in url_to_data:
            continue

        data = url_to_data[url]

        # Update full_text_path
        current_path = str(row.get("full_text_path", ""))
        if current_path in ("", "nan") or not os.path.exists(current_path):
            df.at[idx, "full_text_path"] = data["full_text_path"]
            updated += 1

        # Update metadata fields if empty
        metadata_fields = [
            "judges", "date", "catchwords", "outcome",
            "visa_type", "legislation", "citation",
        ]
        for field in metadata_fields:
            current_val = str(row.get(field, ""))
            new_val = data.get(field, "")
            if current_val in ("", "nan") and new_val:
                df.at[idx, field] = new_val

    # Save CSV atomically
    tmp_path = str(csv_path) + ".tmp"
    df.to_csv(tmp_path, index=False)
    os.replace(tmp_path, str(csv_path))

    print(f"  Updated {updated} records with full_text_path")
    print(f"  CSV saved: {csv_path}")


def update_json(synced: list[dict], json_path: Path):
    """Update JSON with full_text_path and metadata from synced results."""
    if not json_path.exists():
        print(f"  JSON not found: {json_path}")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    raw = data["cases"] if isinstance(data, dict) and "cases" in data else data

    # Build lookup by URL
    url_to_data = {r["url"]: r for r in synced}

    updated = 0
    for item in raw:
        url = item.get("url", "").strip()
        if url not in url_to_data:
            continue

        r = url_to_data[url]
        changed = False

        if not item.get("full_text_path") and r.get("full_text_path"):
            item["full_text_path"] = r["full_text_path"]
            changed = True

        for field in ["judges", "date", "catchwords", "outcome", "visa_type", "legislation"]:
            if not item.get(field) and r.get(field):
                item[field] = r[field]
                changed = True

        if changed:
            updated += 1

    # Save JSON atomically
    tmp_path = str(json_path) + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, str(json_path))

    print(f"  Updated {updated} JSON records")
    print(f"  JSON saved: {json_path}")


async def show_error_summary():
    """Show summary of errors from R2."""
    print("\nListing error keys...")
    error_keys = await list_all_keys(prefix="errors/")
    print(f"  Total error keys: {len(error_keys)}")

    if not error_keys:
        return

    results = await download_batch(error_keys, concurrency=5)

    error_codes: dict[int, int] = {}
    error_courts: dict[str, int] = {}
    error_msgs: dict[str, int] = {}

    for r in results:
        code = r.get("error_code", 0)
        court = r.get("court_code", "?")
        msg = r.get("error", "unknown")
        error_codes[code] = error_codes.get(code, 0) + 1
        error_courts[court] = error_courts.get(court, 0) + 1
        error_msgs[msg] = error_msgs.get(msg, 0) + 1

    print(f"\nTotal errors: {len(results)}")
    print("\nBy HTTP status:")
    for code, count in sorted(error_codes.items()):
        label = {0: "Parse/Other", 404: "Not Found", 429: "Rate Limited", 500: "Server Error"}.get(code, str(code))
        print(f"  {code} ({label}): {count}")

    print("\nBy court:")
    for court, count in sorted(error_courts.items(), key=lambda x: -x[1]):
        print(f"  {court}: {count}")

    print("\nBy error message:")
    for msg, count in sorted(error_msgs.items(), key=lambda x: -x[1])[:10]:
        print(f"  {msg}: {count}")


def main():
    parser = argparse.ArgumentParser(description="Sync R2 results to local files + CSV/JSON")
    parser.add_argument("--limit", type=int, help="Max results to sync")
    parser.add_argument("--court", type=str, help="Filter by court code")
    parser.add_argument("--errors", action="store_true", help="Show error summary")
    parser.add_argument(
        "-j", "--concurrency",
        type=int,
        default=10,
        help="Concurrent download connections (default: 10)",
    )
    parser.add_argument(
        "--skip-csv", action="store_true", help="Skip CSV update"
    )
    parser.add_argument(
        "--skip-json", action="store_true", help="Skip JSON update"
    )
    args = parser.parse_args()

    if args.errors:
        asyncio.run(show_error_summary())
        return

    print("=" * 60)
    print("AustLII Scraper — Sync R2 Results via Worker API")
    print(f"Started at {datetime.now()}")
    print("=" * 60)

    # Step 1: List all result keys
    print("\nStep 1: Listing R2 result keys...")
    keys = asyncio.run(list_all_keys(prefix="results/"))
    print(f"  Found {len(keys):,} results in R2")

    if args.limit:
        keys = keys[: args.limit]
        print(f"  Limited to {len(keys):,}")

    if not keys:
        print("  No results to sync!")
        return

    # Step 2: Download results in batches
    print(f"\nStep 2: Downloading {len(keys):,} results (concurrency={args.concurrency})...")
    results = asyncio.run(download_batch(keys, concurrency=args.concurrency))
    print(f"  Downloaded {len(results):,} successful results")

    # Apply court filter
    if args.court:
        results = [r for r in results if r.get("court_code") == args.court]
        print(f"  Filtered to {len(results):,} {args.court} results")

    if not results:
        print("  No results after filtering!")
        return

    # Step 3: Save text files
    print(f"\nStep 3: Saving .txt files to {TEXT_DIR}...")
    synced: list[dict] = []

    for i, result in enumerate(results):
        filepath = save_text_file(result, TEXT_DIR)

        synced.append({
            "case_id": result.get("case_id", ""),
            "full_text_path": filepath,
            "url": result.get("url", ""),
            "judges": result.get("judges", ""),
            "date": result.get("date", ""),
            "catchwords": result.get("catchwords", ""),
            "outcome": result.get("outcome", ""),
            "visa_type": result.get("visa_type", ""),
            "legislation": result.get("legislation", ""),
            "citation": result.get("citation", ""),
        })

        if (i + 1) % 10000 == 0:
            print(f"    Saved {i + 1:,}/{len(results):,} files...")

    # Court breakdown
    court_counts: dict[str, int] = {}
    for r in synced:
        code = r.get("citation", "").split("]")[-1].strip().split()[0] if "]" in r.get("citation", "") else "?"
        court_counts[code] = court_counts.get(code, 0) + 1

    print(f"  Total files processed: {len(synced):,}")
    print("  By court:")
    for code, count in sorted(court_counts.items(), key=lambda x: -x[1]):
        print(f"    {code}: {count:,}")

    # Step 4: Update CSV
    if not args.skip_csv and CSV_PATH.exists():
        print(f"\nStep 4: Updating CSV at {CSV_PATH}...")
        update_csv(synced, CSV_PATH)
    else:
        print("\nStep 4: CSV update skipped")

    # Step 5: Update JSON
    if not args.skip_json and JSON_PATH.exists():
        print(f"\nStep 5: Updating JSON at {JSON_PATH}...")
        update_json(synced, JSON_PATH)
    else:
        print("\nStep 5: JSON update skipped")

    print(f"\nDone at {datetime.now()}")


if __name__ == "__main__":
    main()
