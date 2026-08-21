"""
Extract catchwords, case_nature, and legal_concepts using Gemini 2.0 Flash-Lite.

True async concurrency via aiohttp + Gemini REST API.
Batches 10 cases per API request, 15 concurrent requests.
Saves progress incrementally. Fully resumable.

Usage:
    python scripts/extract_gemini.py                    # process all
    python scripts/extract_gemini.py --limit 100        # test with 100
    python scripts/extract_gemini.py --court MRTA       # one court only
    python scripts/extract_gemini.py --concurrency 15   # parallel requests
    python scripts/extract_gemini.py --batch-size 10    # cases per API call
    python scripts/extract_gemini.py --dry-run           # show what would be processed
    python scripts/extract_gemini.py --apply-only        # just apply saved progress to CSV

Cost estimate: ~$8 for 87K cases (truncated to 3000 chars each).
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")
PROGRESS_DIR = Path("downloaded_cases/gemini_progress")

MODEL = "gemini-2.0-flash-lite"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# ──────────────────────────────────────────
# Prompt
# ──────────────────────────────────────────

SYSTEM_PROMPT = """You are an Australian immigration law expert. For each case, extract:

1. **catchwords**: A concise legal summary (1-2 sentences) describing the key legal issues, like AustLII catchwords format. Examples:
   - "MIGRATION – Protection visa – whether well-founded fear of persecution – whether complementary protection criteria met"
   - "MIGRATION – Judicial review – jurisdictional error – failure to consider relevant material – procedural fairness"
   - "MIGRATION – Review of visa refusal – Subclass 801 – Spouse – genuine relationship"

2. **case_nature**: One of these categories:
   Protection visa, Judicial review, Merits review, Visa cancellation, Appeal, Visa refusal, Migration review, Student visa application, Skilled migration, Partner/Family visa, Citizenship, Refugee assessment, Character test, Detention challenge, Bridging visa, Work visa, Visitor visa, Administrative review, Other

3. **legal_concepts**: 1-3 key legal concepts, semicolon-separated. Examples:
   - "Jurisdictional error; Procedural fairness"
   - "Refugee status; well-founded fear; Complementary protection"
   - "s.501 character test; Visa cancellation"
   - "Genuine relationship; Partner visa"

Respond ONLY with a JSON array matching the input order. Each element: {"catchwords": "...", "case_nature": "...", "legal_concepts": "..."}"""


def build_prompt(cases: list[dict]) -> str:
    """Build prompt with multiple cases."""
    parts = []
    for i, case in enumerate(cases):
        text = case["text"][:3000]  # Truncate to save tokens
        parts.append(f"--- Case {i+1} ---\nCitation: {case['citation']}\nCourt: {case['court']}\n\n{text}\n")
    return "\n".join(parts)


# ──────────────────────────────────────────
# Async Gemini API (REST)
# ──────────────────────────────────────────

async def call_gemini_async(
    session, api_key: str, cases: list[dict], semaphore: asyncio.Semaphore,
    max_retries: int = 3, stats: dict = None,
) -> list[dict]:
    """Call Gemini REST API with async retry logic."""
    import aiohttp

    prompt = build_prompt(cases)
    url = f"{API_BASE}/{MODEL}:generateContent?key={api_key}"

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 2048,
        },
    }

    async with semaphore:
        for attempt in range(max_retries):
            try:
                async with session.post(
                    url, json=body,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as resp:
                    if resp.status == 429:
                        wait = 15 * (attempt + 1)
                        if stats:
                            stats["rate_limited"] += 1
                        await asyncio.sleep(wait)
                        continue

                    if resp.status >= 500:
                        wait = 5 * (attempt + 1)
                        await asyncio.sleep(wait)
                        continue

                    if resp.status != 200:
                        text = await resp.text()
                        if attempt < max_retries - 1:
                            await asyncio.sleep(2 ** attempt)
                            continue
                        return []

                    data = await resp.json()

                    # Extract response text
                    try:
                        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                    except (KeyError, IndexError):
                        if attempt < max_retries - 1:
                            await asyncio.sleep(2 ** attempt)
                            continue
                        return []

                    # Parse JSON
                    results = json.loads(text)

                    if isinstance(results, list) and len(results) == len(cases):
                        return results
                    elif isinstance(results, dict) and len(cases) == 1:
                        return [results]
                    elif isinstance(results, list):
                        return results  # partial is better than nothing
                    return []

            except json.JSONDecodeError:
                # Try regex extraction
                try:
                    m = re.search(r'\[.*\]', text, re.DOTALL)
                    if m:
                        results = json.loads(m.group())
                        if isinstance(results, list):
                            return results
                except Exception:
                    pass

                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return []

            except asyncio.TimeoutError:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return []

            except Exception:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return []

    return []


# ──────────────────────────────────────────
# Progress tracking
# ──────────────────────────────────────────

def load_progress() -> dict[str, dict]:
    """Load previously extracted results."""
    progress = {}
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)

    for f in PROGRESS_DIR.glob("batch_*.json"):
        try:
            with open(f) as fh:
                batch = json.load(fh)
            for case_id, result in batch.items():
                progress[case_id] = result
        except Exception:
            pass

    return progress


def save_progress(batch_num: int, results: dict[str, dict]):
    """Save batch results to progress file."""
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    path = PROGRESS_DIR / f"batch_{batch_num:06d}.json"
    with open(path, "w") as f:
        json.dump(results, f, ensure_ascii=False)


def apply_to_csv(progress: dict[str, dict]):
    """Apply all progress results to CSV."""
    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)

    # Build case_id index
    id_to_idx = {}
    for idx, row in df.iterrows():
        cid = str(row["case_id"])
        id_to_idx[cid] = idx

    updated = 0
    for case_id, result in progress.items():
        idx = id_to_idx.get(case_id)
        if idx is None:
            continue

        for field in ["catchwords", "case_nature", "legal_concepts"]:
            val = result.get(field, "")
            if not val:
                continue
            current = str(df.at[idx, field]) if pd.notna(df.at[idx, field]) else ""
            if not current or current == "nan":
                df.at[idx, field] = val
                updated += 1

    # Atomic save
    tmp = str(CSV_PATH) + ".tmp"
    backup = str(CSV_PATH) + ".bak_gemini"
    df.to_csv(tmp, index=False)
    if os.path.exists(backup):
        os.remove(backup)
    os.replace(str(CSV_PATH), backup)
    os.replace(tmp, str(CSV_PATH))
    print(f"Updated {updated} field values in CSV")
    print(f"Backup: {backup}")


# ──────────────────────────────────────────
# Async main loop
# ──────────────────────────────────────────

async def process_all(
    cases_list: list[dict], api_key: str, concurrency: int,
    batch_size: int, progress: dict,
) -> tuple[int, int, int]:
    """Process all cases with true async concurrency."""
    import aiohttp

    semaphore = asyncio.Semaphore(concurrency)
    stats = {"rate_limited": 0}

    batches = [
        cases_list[i:i + batch_size]
        for i in range(0, len(cases_list), batch_size)
    ]

    batch_num_start = len(list(PROGRESS_DIR.glob("batch_*.json"))) if PROGRESS_DIR.exists() else 0

    succeeded = 0
    failed = 0
    processed = 0
    batch_num = batch_num_start
    start_time = time.time()
    total = len(cases_list)

    # Process in chunks to save progress periodically
    chunk_size = concurrency * 3  # e.g. 45 batches = 450 cases per save
    connector = aiohttp.TCPConnector(limit=concurrency + 5, ttl_dns_cache=300)

    async with aiohttp.ClientSession(connector=connector) as session:
        for chunk_start in range(0, len(batches), chunk_size):
            chunk = batches[chunk_start:chunk_start + chunk_size]

            tasks = [
                call_gemini_async(session, api_key, batch, semaphore, stats=stats)
                for batch in chunk
            ]

            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            for batch, result in zip(chunk, results):
                if isinstance(result, BaseException):
                    failed += len(batch)
                elif result:
                    batch_progress = {}
                    for j, case in enumerate(batch):
                        if j < len(result):
                            batch_progress[case["case_id"]] = result[j]
                            progress[case["case_id"]] = result[j]
                            succeeded += 1
                        else:
                            failed += 1

                    batch_num += 1
                    save_progress(batch_num, batch_progress)
                else:
                    failed += len(batch)

                processed += len(batch)

            # Progress report
            elapsed = time.time() - start_time
            rate = processed / elapsed if elapsed > 0 else 0
            eta = (total - processed) / rate if rate > 0 else 0
            pct = processed * 100 // total if total > 0 else 100
            print(
                f"  {processed:,}/{total:,} ({pct}%) "
                f"| OK: {succeeded:,} | Fail: {failed} "
                f"| {rate:.1f}/s | ETA: {eta / 60:.1f}m"
                f"{' | 429s: ' + str(stats['rate_limited']) if stats['rate_limited'] else ''}"
            )

    return succeeded, failed, processed


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Max cases to process")
    parser.add_argument("--court", type=str, help="Filter by court code")
    parser.add_argument("--batch-size", type=int, default=10, help="Cases per API call")
    parser.add_argument("--concurrency", type=int, default=15, help="Parallel API calls")
    parser.add_argument("--dry-run", action="store_true", help="Don't call API")
    parser.add_argument("--apply-only", action="store_true", help="Just apply saved progress to CSV")
    args = parser.parse_args()

    # Apply-only mode
    if args.apply_only:
        progress = load_progress()
        print(f"Loaded {len(progress):,} results from progress files")
        apply_to_csv(progress)
        return

    # Load CSV
    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    total = len(df)
    print(f"Loaded {total:,} records")

    # Find cases needing extraction
    needs_mask = (
        (df["catchwords"].isna() | df["catchwords"].astype(str).str.strip().isin(["", "nan"])) |
        (df["case_nature"].isna() | df["case_nature"].astype(str).str.strip().isin(["", "nan"])) |
        (df["legal_concepts"].isna() | df["legal_concepts"].astype(str).str.strip().isin(["", "nan"]))
    )
    needs = df[needs_mask].copy()

    if args.court:
        needs = needs[needs["court_code"] == args.court]

    print(f"Cases needing extraction: {len(needs):,}")

    # Load progress and skip already-done cases
    progress = load_progress()
    needs = needs[~needs["case_id"].astype(str).isin(progress.keys())]
    print(f"After skipping done: {len(needs):,} remaining")
    print(f"Already completed: {len(progress):,}")

    if args.limit:
        needs = needs.head(args.limit)
        print(f"Limited to: {len(needs):,}")

    if len(needs) == 0:
        print("Nothing to process!")
        if progress:
            print("Applying existing progress to CSV...")
            apply_to_csv(progress)
        return

    if args.dry_run:
        print(f"\n[DRY RUN] Would process {len(needs):,} cases")
        api_calls = len(needs) // args.batch_size + 1
        print(f"  Estimated API calls: {api_calls:,}")
        est_tokens = len(needs) * 750
        cost = (est_tokens / 1e6) * 0.075 + (len(needs) * 100 / 1e6) * 0.30
        print(f"  Estimated cost: ~${cost:.2f}")
        print(f"  Concurrency: {args.concurrency} parallel requests")
        return

    # API key
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable")
        sys.exit(1)

    # Build case list with text
    print("\nLoading case texts...")
    cases_list = []
    skipped = 0
    for _, row in needs.iterrows():
        ftp = str(row["full_text_path"]) if pd.notna(row["full_text_path"]) else ""
        if not ftp or not os.path.exists(ftp):
            skipped += 1
            continue
        try:
            with open(ftp, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except Exception:
            skipped += 1
            continue

        cases_list.append({
            "case_id": str(row["case_id"]),
            "citation": str(row["citation"]) if pd.notna(row["citation"]) else "",
            "court": str(row["court_code"]) if pd.notna(row["court_code"]) else "",
            "text": text,
        })

    if skipped:
        print(f"  Skipped {skipped} cases (no text file)")

    print(f"\nProcessing {len(cases_list):,} cases")
    print(f"  Batch size: {args.batch_size} cases/request")
    print(f"  Concurrency: {args.concurrency} parallel requests")
    print(f"  Estimated API calls: {len(cases_list) // args.batch_size + 1:,}")
    print()

    start_time = time.time()

    # Run async processing
    succeeded, failed, processed = asyncio.run(
        process_all(cases_list, api_key, args.concurrency, args.batch_size, progress)
    )

    elapsed = time.time() - start_time
    print(f"\n{'=' * 60}")
    print(f"DONE in {elapsed / 60:.1f} minutes")
    print(f"  Processed: {processed:,}")
    print(f"  Succeeded: {succeeded:,}")
    print(f"  Failed: {failed:,}")
    print(f"  Total progress: {len(progress):,}")

    # Apply to CSV
    print("\nApplying results to CSV...")
    apply_to_csv(progress)


if __name__ == "__main__":
    main()
