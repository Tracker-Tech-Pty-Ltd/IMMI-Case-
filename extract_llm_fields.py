#!/usr/bin/env python3
"""Extract case_nature and legal_concepts using Claude Sonnet API.

Processes cases in batches of 20 with parallel workers.
Checkpoints every 500 cases to prevent data loss.
"""

import csv
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import anthropic

# ── Config ──────────────────────────────────────────────────────────────
CSV_PATH = "downloaded_cases/immigration_cases.csv"
MODEL = "claude-sonnet-4-5-20250929"
BATCH_SIZE = 20       # cases per API call
MAX_WORKERS = 10      # parallel API calls
CHECKPOINT_EVERY = 500  # save every N processed cases
MAX_RETRIES = 3       # retries per batch on API error

SYSTEM_PROMPT = """You are an Australian immigration law expert. For each case, extract:

1. case_nature: Brief classification of the case type (under 100 chars).
   Examples: "Protection visa refusal - refugee claims", "Skilled worker visa cancellation",
   "Character ground deportation s.501", "Student visa breach", "Partner visa refusal",
   "Bridging visa refusal", "Judicial review of AATA decision", "Citizenship application refusal"

2. legal_concepts: Key legal concepts/issues separated by semicolons (under 200 chars).
   Examples: "well-founded fear of persecution; complementary protection; credibility",
   "character test s.501; ministerial direction 99; national interest",
   "procedural fairness; jurisdictional error; unreasonableness"

Respond ONLY with a JSON array. Each element must have "idx", "case_nature", "legal_concepts".
If insufficient information, use "Unknown" for case_nature and "" for legal_concepts."""


# ── Helpers ─────────────────────────────────────────────────────────────

def load_csv():
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_csv(rows):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    # Write to temp file first, then rename (atomic save)
    tmp_path = CSV_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp_path, CSV_PATH)


def get_pending_cases(rows):
    """Find cases needing case_nature/legal_concepts with available text."""
    pending = []
    for i, row in enumerate(rows):
        cn = row.get("case_nature", "").strip()
        lc = row.get("legal_concepts", "").strip()
        if cn and lc:
            continue
        snippet = row.get("text_snippet", "").strip()
        catchwords = row.get("catchwords", "").strip()
        if len(snippet) > 5 or len(catchwords) > 5:
            pending.append(i)
    return pending


def build_prompt(rows, indices):
    """Build prompt for a batch of case indices."""
    parts = []
    for idx in indices:
        row = rows[idx]
        title = row.get("title", "").strip()[:120]
        court = row.get("court_code", "").strip()
        visa = row.get("visa_type", "").strip()[:80]
        catchwords = row.get("catchwords", "").strip()[:250]
        outcome = row.get("outcome", "").strip()[:200]
        snippet = row.get("text_snippet", "").strip()[:400]

        case_text = f"Case idx={idx}:\n"
        case_text += f"  Title: {title}\n"
        case_text += f"  Court: {court}\n"
        if visa:
            case_text += f"  Visa: {visa}\n"
        if catchwords:
            case_text += f"  Catchwords: {catchwords}\n"
        if outcome:
            case_text += f"  Outcome: {outcome}\n"
        if snippet:
            case_text += f"  Snippet: {snippet}\n"
        parts.append(case_text)

    return "\n".join(parts)


def process_batch(client, rows, indices):
    """Send one batch to Sonnet, return list of {idx, case_nature, legal_concepts}."""
    prompt = build_prompt(rows, indices)
    user_msg = (
        f"Extract case_nature and legal_concepts for these {len(indices)} cases. "
        f"Return JSON array with idx, case_nature, legal_concepts.\n\n{prompt}"
    )

    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = response.content[0].text

            # Extract JSON array from response
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                results = json.loads(text[start:end])
                return results
            return []

        except anthropic.RateLimitError:
            wait = 2 ** (attempt + 1)
            time.sleep(wait)
        except anthropic.APIError as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2)
            else:
                print(f"  API error after {MAX_RETRIES} retries: {e}")
                return []
        except json.JSONDecodeError:
            # Try to salvage partial JSON
            return []
        except Exception as e:
            print(f"  Unexpected error: {e}")
            return []

    return []


# ── Main ────────────────────────────────────────────────────────────────

def main():
    start_time = time.time()
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Loading CSV...")
    rows = load_csv()
    print(f"  Loaded {len(rows)} records")

    # Ensure columns exist
    for row in rows:
        row.setdefault("case_nature", "")
        row.setdefault("legal_concepts", "")

    pending = get_pending_cases(rows)
    print(f"  Pending extraction: {len(pending)} cases")

    if not pending:
        print("Nothing to process!")
        return

    # Split into batches
    batches = [pending[i:i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    total_batches = len(batches)
    print(f"  Batches: {total_batches} (batch size={BATCH_SIZE}, workers={MAX_WORKERS})")

    # Estimate cost
    est_input = total_batches * 4000 / 1_000_000
    est_output = total_batches * 800 / 1_000_000
    est_cost = est_input * 3 + est_output * 15
    print(f"  Estimated cost: ~${est_cost:.1f} (Sonnet 4.5)")
    print()

    client = anthropic.Anthropic()

    processed = 0
    extracted = 0
    errors = 0
    lock = threading.Lock()
    last_checkpoint = 0

    def handle_batch(batch_idx, indices):
        nonlocal processed, extracted, errors, last_checkpoint
        results = process_batch(client, rows, indices)

        with lock:
            for item in results:
                idx = item.get("idx")
                if idx is None:
                    continue
                idx = int(idx)
                if 0 <= idx < len(rows):
                    cn = item.get("case_nature", "").strip()
                    lc = item.get("legal_concepts", "").strip()
                    if cn:
                        rows[idx]["case_nature"] = cn
                    if lc:
                        rows[idx]["legal_concepts"] = lc
                    if cn or lc:
                        extracted += 1

            processed += len(indices)

            # Checkpoint
            if processed - last_checkpoint >= CHECKPOINT_EVERY:
                save_csv(rows)
                last_checkpoint = processed
                elapsed = time.time() - start_time
                rate = processed / elapsed if elapsed > 0 else 0
                remaining = (len(pending) - processed) / rate if rate > 0 else 0
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"Progress: {processed}/{len(pending)} "
                    f"(extracted: {extracted}, errors: {errors}) | "
                    f"{rate:.1f} cases/s | ETA: {remaining/60:.0f}m | "
                    f"[Checkpoint saved]"
                )

    # Process batches with thread pool
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Starting extraction...")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {}
        for batch_idx, indices in enumerate(batches):
            future = executor.submit(handle_batch, batch_idx, indices)
            futures[future] = batch_idx

        for future in as_completed(futures):
            batch_idx = futures[future]
            try:
                future.result()
            except Exception as e:
                print(f"  Batch {batch_idx} exception: {e}")
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
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Final save...")
    save_csv(rows)

    elapsed = time.time() - start_time
    print(f"\nDONE in {elapsed/60:.1f} minutes")
    print(f"  Processed: {processed}")
    print(f"  Extracted: {extracted}")
    print(f"  Errors: {errors}")

    # Stats
    filled_cn = sum(1 for r in rows if r.get("case_nature", "").strip())
    filled_lc = sum(1 for r in rows if r.get("legal_concepts", "").strip())
    print(f"  case_nature coverage: {filled_cn}/{len(rows)} ({filled_cn*100/len(rows):.1f}%)")
    print(f"  legal_concepts coverage: {filled_lc}/{len(rows)} ({filled_lc*100/len(rows):.1f}%)")


if __name__ == "__main__":
    main()
