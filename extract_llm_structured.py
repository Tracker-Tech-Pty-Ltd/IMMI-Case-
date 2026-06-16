#!/usr/bin/env python3
"""Extract structured fields using Claude Sonnet API.

Fills: country_of_origin, is_represented, representative, respondent,
visa_subclass_number (only when missing from regex extraction).

Also supports --verify mode to spot-check existing data accuracy.

Usage:
    python extract_llm_structured.py                    # extract missing fields
    python extract_llm_structured.py --verify 5000      # verify 5000 random cases
    python extract_llm_structured.py --court AATA       # only AATA cases
    python extract_llm_structured.py --model haiku       # use Haiku (cheaper)
    python extract_llm_structured.py --dry-run --sample 20  # preview
"""

import argparse
import csv
import json
import os
import random
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import anthropic

# ── Config ──────────────────────────────────────────────────────────────
CSV_PATH = Path("downloaded_cases/immigration_cases.csv")
CASES_DIR = Path("downloaded_cases/case_texts")
RESULTS_DIR = Path("downloaded_cases/llm_structured_results")

MODELS = {
    "sonnet": "claude-sonnet-4-5-20250929",
    "haiku": "claude-haiku-4-5-20251001",
}
DEFAULT_MODEL = "sonnet"

BATCH_SIZE = 10        # cases per API call
MAX_WORKERS = 10       # parallel API calls
CHECKPOINT_EVERY = 500 # save checkpoint every N cases
MAX_RETRIES = 3        # retries per batch on API error
TEXT_LIMIT = 2500      # chars of case text to send (country info is in preamble)

TARGET_FIELDS = [
    "country_of_origin", "is_represented", "representative",
    "respondent", "visa_subclass_number",
]

SYSTEM_PROMPT = """You are an Australian immigration law expert analyzing court/tribunal case documents.

For each case, extract the following fields from the case text:

1. **country_of_origin**: The applicant's country of origin/nationality. Look for:
   - "citizen of [Country]", "national of [Country]", "born in [Country]"
   - "[Demonym] citizen/national" (e.g., "Indian national", "Chinese citizen")
   - "from [Country]", "arrived from [Country]", "fled [Country]"
   - Country mentioned in context of applicant's background
   - If applicant has an ethnically identifiable name (e.g., "Wang" → China, "Singh" → India, "Nguyen" → Vietnam), only use the name as a LAST RESORT if no other evidence exists
   - Do NOT guess — only extract if explicitly stated or strongly implied in text

2. **is_represented**: Whether the applicant had legal representation.
   - "Yes" if represented by a lawyer/agent/migration agent
   - "No" if self-represented, unrepresented, appeared in person
   - Leave empty if unclear

3. **representative**: Name of the representative (lawyer, migration agent, etc.).
   - Only fill if is_represented is "Yes"
   - Include firm name if mentioned

4. **respondent**: The other party in the case (usually Minister/Department).
   - Common: "Minister for Immigration and Border Protection", "Minister for Home Affairs"
   - For AATA/ARTA: usually "Minister for Immigration..."

5. **visa_subclass_number**: The 3-digit visa subclass number.
   - e.g., "866" for Protection visa, "457" for Temporary Work, "500" for Student
   - Look for "subclass NNN" or "class NNN" patterns
   - Do NOT extract section numbers (e.g., s.501 is a Migration Act section, NOT a visa subclass)

Respond ONLY with a JSON array. Each element must have:
- "idx": the case index number
- "country_of_origin": string (country name or "")
- "is_represented": "Yes", "No", or ""
- "representative": string or ""
- "respondent": string or ""
- "visa_subclass_number": 3-digit string or ""

If a field cannot be determined, use empty string "". Never guess."""

VERIFY_SYSTEM_PROMPT = """You are an Australian immigration law expert verifying extracted case data.

For each case, you are given:
- The case text (first portion)
- Previously extracted field values

Your task: verify each field and flag any errors.

Respond ONLY with a JSON array. Each element must have:
- "idx": the case index number
- "corrections": object with only the fields that need correction, e.g.:
  {"country_of_origin": "India"}  — if the current value is wrong
  {} — if all fields are correct
- "confidence": "high", "medium", or "low"
- "notes": brief explanation of any corrections (or "" if all correct)

Only flag genuine errors. Minor formatting differences (e.g., "Sri Lanka" vs "SriLanka") are not errors."""


def load_csv() -> list[dict]:
    """Load the immigration cases CSV."""
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_results(results: list[dict], batch_num: int):
    """Save batch results to JSON file."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"result_{batch_num:05d}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def get_case_text(row: dict) -> str:
    """Get case text from file, limited to TEXT_LIMIT chars."""
    citation = row.get("citation", "")
    if not citation:
        return ""

    path = CASES_DIR / f"{citation}.txt"
    if not path.exists():
        return ""

    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        return text[:TEXT_LIMIT]
    except (OSError, IOError):
        return ""


def get_pending_cases(rows: list[dict], mode: str = "extract", fields: str = "all") -> list[int]:
    """Find case indices needing extraction or verification.

    fields: 'all' = any missing target field, 'country' = only missing country,
            'representation' = only missing is_represented/representative
    """
    pending = []

    for i, row in enumerate(rows):
        if mode == "extract":
            needs_work = False
            if fields == "country":
                needs_work = not row.get("country_of_origin", "").strip()
            elif fields == "representation":
                needs_work = (
                    not row.get("is_represented", "").strip()
                    or not row.get("representative", "").strip()
                )
            else:  # "all"
                needs_work = any(
                    not row.get(f, "").strip()
                    for f in TARGET_FIELDS
                )

            if needs_work:
                citation = row.get("citation", "")
                if citation:
                    path = CASES_DIR / f"{citation}.txt"
                    if path.exists():
                        pending.append(i)
        elif mode == "verify":
            # For verification, pick cases that HAVE data to verify
            country = row.get("country_of_origin", "").strip()
            if country and country != "Not disclosed":
                pending.append(i)

    return pending


def build_extract_prompt(rows: list[dict], indices: list[int]) -> str:
    """Build extraction prompt for a batch of cases."""
    parts = []
    for idx in indices:
        row = rows[idx]
        title = row.get("title", "").strip()[:120]
        court = row.get("court_code", "").strip()
        visa_type = row.get("visa_type", "").strip()[:80]
        text = get_case_text(row)

        case_block = f"Case idx={idx}:\n"
        case_block += f"  Title: {title}\n"
        case_block += f"  Court: {court}\n"
        if visa_type:
            case_block += f"  Visa Type: {visa_type}\n"

        # Show which fields are already filled (so LLM can skip them)
        filled = []
        for field in TARGET_FIELDS:
            val = row.get(field, "").strip()
            if val:
                filled.append(f"{field}={val}")
        if filled:
            case_block += f"  Already extracted: {'; '.join(filled)}\n"

        if text:
            # Skip the metadata header (already have title/citation/etc)
            # Find the separator line and start after it
            sep_idx = text.find("=" * 20)
            if sep_idx > 0:
                text_body = text[sep_idx:].strip()
            else:
                text_body = text
            case_block += f"  Text:\n{text_body[:2000]}\n"

        parts.append(case_block)

    return "\n---\n".join(parts)


def build_verify_prompt(rows: list[dict], indices: list[int]) -> str:
    """Build verification prompt for a batch of cases."""
    parts = []
    for idx in indices:
        row = rows[idx]
        title = row.get("title", "").strip()[:120]
        court = row.get("court_code", "").strip()
        text = get_case_text(row)

        case_block = f"Case idx={idx}:\n"
        case_block += f"  Title: {title}\n"
        case_block += f"  Court: {court}\n"

        # Show current field values
        for field in TARGET_FIELDS + ["applicant_name", "hearing_date"]:
            val = row.get(field, "").strip()
            if val:
                case_block += f"  {field}: {val}\n"

        if text:
            sep_idx = text.find("=" * 20)
            text_body = text[sep_idx:].strip() if sep_idx > 0 else text
            case_block += f"  Text:\n{text_body[:1500]}\n"

        parts.append(case_block)

    return "\n---\n".join(parts)


def process_batch(
    client: anthropic.Anthropic,
    rows: list[dict],
    indices: list[int],
    mode: str,
    model: str,
) -> list[dict]:
    """Send one batch to Claude, return list of results."""
    if mode == "extract":
        prompt = build_extract_prompt(rows, indices)
        system = SYSTEM_PROMPT
        user_msg = (
            f"Extract the structured fields for these {len(indices)} immigration cases. "
            f"Focus especially on country_of_origin. "
            f"Return a JSON array with idx and the field values.\n\n{prompt}"
        )
    else:
        prompt = build_verify_prompt(rows, indices)
        system = VERIFY_SYSTEM_PROMPT
        user_msg = (
            f"Verify the extracted data for these {len(indices)} cases. "
            f"Flag any incorrect values.\n\n{prompt}"
        )

    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text

            # Extract JSON array from response
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            return []

        except anthropic.RateLimitError:
            wait = 2 ** (attempt + 1)
            print(f"  Rate limited, waiting {wait}s...")
            time.sleep(wait)
        except anthropic.APIError as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2)
            else:
                print(f"  API error after {MAX_RETRIES} retries: {e}")
                return []
        except json.JSONDecodeError as e:
            print(f"  JSON parse error: {e}")
            return []
        except Exception as e:
            print(f"  Unexpected error: {e}")
            return []

    return []


def main():
    parser = argparse.ArgumentParser(description="Extract structured fields using Claude LLM")
    parser.add_argument("--model", choices=["sonnet", "haiku"], default=DEFAULT_MODEL,
                        help="Model to use (default: sonnet)")
    parser.add_argument("--verify", type=int, default=0,
                        help="Verify N random cases instead of extracting")
    parser.add_argument("--court", type=str, default="",
                        help="Filter by court code (e.g., AATA)")
    parser.add_argument("--sample", type=int, default=0,
                        help="Process only N random cases")
    parser.add_argument("--fields", type=str, default="all",
                        help="Which missing fields to target: 'all', 'country', 'representation' (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview without making API calls")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE,
                        help=f"Cases per API call (default: {BATCH_SIZE})")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS,
                        help=f"Parallel workers (default: {MAX_WORKERS})")
    args = parser.parse_args()

    model_id = MODELS[args.model]
    mode = "verify" if args.verify > 0 else "extract"

    start_time = time.time()
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Loading CSV...")
    rows = load_csv()
    print(f"  Loaded {len(rows)} records")

    # Filter by court if specified
    if args.court:
        court_indices = {i for i, r in enumerate(rows) if r.get("court_code", "") == args.court}
        print(f"  Filtered to {len(court_indices)} {args.court} cases")
    else:
        court_indices = None

    # Get pending cases
    field_filter = args.fields if hasattr(args, 'fields') else "all"
    pending = get_pending_cases(rows, mode, field_filter)
    if court_indices is not None:
        pending = [i for i in pending if i in court_indices]

    print(f"  Pending {mode} (fields={field_filter}): {len(pending)} cases")

    # Sample or limit for verify mode
    if args.verify > 0:
        random.shuffle(pending)
        pending = pending[:args.verify]
        print(f"  Verification sample: {len(pending)} cases")
    elif args.sample > 0:
        random.shuffle(pending)
        pending = pending[:args.sample]
        print(f"  Sample: {len(pending)} cases")

    if not pending:
        print("Nothing to process!")
        return

    # Split into batches
    batch_size = args.batch_size
    batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
    total_batches = len(batches)
    print(f"  Batches: {total_batches} (size={batch_size}, workers={args.workers})")

    # Estimate cost
    avg_input_tokens = batch_size * 800 + 500  # ~800 tokens per case + prompt
    avg_output_tokens = batch_size * 50        # ~50 tokens per case output
    if args.model == "sonnet":
        cost_per_batch = (avg_input_tokens / 1_000_000 * 3) + (avg_output_tokens / 1_000_000 * 15)
    else:
        cost_per_batch = (avg_input_tokens / 1_000_000 * 0.80) + (avg_output_tokens / 1_000_000 * 4)
    est_cost = total_batches * cost_per_batch
    print(f"  Estimated cost: ~${est_cost:.1f} ({args.model})")
    print()

    if args.dry_run:
        # Show sample prompt
        sample_batch = batches[0][:3]
        if mode == "extract":
            prompt = build_extract_prompt(rows, sample_batch)
        else:
            prompt = build_verify_prompt(rows, sample_batch)
        print("=== Sample Prompt (first 3 cases) ===")
        print(prompt[:3000])
        print("...")
        print("\nDry run — no API calls made.")
        return

    # Confirm cost
    if est_cost > 5:
        print(f"Estimated cost: ${est_cost:.1f}. Proceed? [y/N] ", end="", flush=True)
        response = input().strip().lower()
        if response != "y":
            print("Aborted.")
            return

    client = anthropic.Anthropic()

    # Clear old results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    processed = 0
    extracted = 0
    errors = 0
    all_results = []
    lock = threading.Lock()
    last_checkpoint = 0
    batch_num = [0]  # mutable counter for result files

    def handle_batch(b_idx: int, indices: list[int]):
        nonlocal processed, extracted, errors, last_checkpoint
        results = process_batch(client, rows, indices, mode, model_id)

        with lock:
            for item in results:
                idx = item.get("idx")
                if idx is None:
                    continue
                idx = int(idx)
                if idx < 0 or idx >= len(rows):
                    continue

                if mode == "extract":
                    for field in TARGET_FIELDS:
                        new_val = item.get(field, "").strip()
                        if new_val and not rows[idx].get(field, "").strip():
                            rows[idx][field] = new_val
                            extracted += 1
                else:
                    # Verify mode — collect corrections
                    corrections = item.get("corrections", {})
                    if corrections:
                        all_results.append({
                            "idx": idx,
                            "citation": rows[idx].get("citation", ""),
                            "corrections": corrections,
                            "confidence": item.get("confidence", ""),
                            "notes": item.get("notes", ""),
                        })
                        extracted += 1

            processed += len(indices)

            # Save results periodically
            batch_num[0] += 1
            if results:
                save_results(results, batch_num[0])

            # Checkpoint (save CSV)
            if mode == "extract" and processed - last_checkpoint >= CHECKPOINT_EVERY:
                _save_csv_checkpoint(rows)
                last_checkpoint = processed
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                remaining = (len(pending) - processed) / rate if rate > 0 else 0
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"Progress: {processed}/{len(pending)} "
                    f"(extracted: {extracted}, errors: {errors}) | "
                    f"{rate:.1f}/s | ETA: {remaining/60:.0f}m | "
                    f"[Checkpoint]"
                )

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting {mode} with {args.model}...")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for b_idx, indices in enumerate(batches):
            future = executor.submit(handle_batch, b_idx, indices)
            futures[future] = b_idx

        for future in as_completed(futures):
            b_idx = futures[future]
            try:
                future.result()
            except Exception as e:
                print(f"  Batch {b_idx} exception: {e}")
                errors += 1

            # Progress (every 50 batches)
            done_count = sum(1 for f in futures if f.done())
            if done_count % 50 == 0 or done_count == total_batches:
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                remaining = (len(pending) - processed) / rate if rate > 0 else 0
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"Batches: {done_count}/{total_batches} | "
                    f"Cases: {processed}/{len(pending)} | "
                    f"Extracted: {extracted} | "
                    f"{rate:.1f}/s | ETA: {remaining/60:.0f}m"
                )

    # Final save
    elapsed = time.time() - start_time
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Finished in {elapsed/60:.1f} minutes")
    print(f"  Processed: {processed}")
    print(f"  {'Extracted' if mode == 'extract' else 'Corrections'}: {extracted}")
    print(f"  Errors: {errors}")

    if mode == "extract":
        print("\nSaving final CSV...")
        _save_csv_checkpoint(rows)

        # Coverage report
        print("\nCoverage after LLM extraction:")
        total = len(rows)
        for field in TARGET_FIELDS + ["applicant_name", "hearing_date"]:
            filled = sum(1 for r in rows if r.get(field, "").strip())
            print(f"  {field:25s}: {filled:>6,}/{total} ({filled*100/total:.1f}%)")
    else:
        # Save verification report
        report_path = RESULTS_DIR / "verification_report.json"
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=2)
        print(f"\nVerification report: {report_path}")
        print(f"  Corrections found: {len(all_results)}")
        if all_results:
            print("\nSample corrections:")
            for item in all_results[:10]:
                print(f"  {item['citation']}: {item['corrections']} ({item['notes']})")


def _save_csv_checkpoint(rows: list[dict]):
    """Save current state to CSV (atomic write)."""
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    tmp_path = CSV_PATH.with_suffix(".csv.tmp")
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(str(tmp_path), str(CSV_PATH))


if __name__ == "__main__":
    main()
