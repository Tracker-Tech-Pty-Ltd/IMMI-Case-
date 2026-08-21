"""
LLM-based extraction of outcome and legal_concepts using Claude Sonnet.

Processes cases in batches, reading only the relevant portions of full text
(last 3000 chars for outcome, first 2000 for legal concepts).

Usage:
    python extract_with_llm.py --batch 0 --total-batches 10
    python extract_with_llm.py --batch 1 --total-batches 10
    ...
"""

import argparse
import json
import os
import time
from datetime import datetime

import anthropic
import pandas as pd

CSV_PATH = "downloaded_cases/immigration_cases.csv"
RESULTS_DIR = "downloaded_cases/llm_extraction_results"
MODEL = "claude-sonnet-4-5-20250929"
MAX_TOKENS = 200
BATCH_SIZE = 20  # Cases per API call (batched in prompt)
RATE_LIMIT_DELAY = 1.0  # Seconds between API calls


def log(batch_id, msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [batch-{batch_id}] {msg}", flush=True)


EXTRACTION_PROMPT = """Analyze these Australian immigration court/tribunal cases and extract:
1. **outcome**: The final decision/order (one of: Affirmed, Dismissed, Set aside, Remitted, Allowed, Granted, Refused, Quashed, Withdrawn, No jurisdiction, or a short description)
2. **legal_concepts**: Key legal concepts separated by semicolons (e.g., "Jurisdictional error; Procedural fairness; Credibility assessment")

For each case, respond with a JSON object. Output ONLY a JSON array, no other text.

Cases:
{cases_text}

Respond with a JSON array like:
[
  {{"case_id": "abc123", "outcome": "Dismissed", "legal_concepts": "Jurisdictional error; Procedural fairness"}},
  ...
]"""


def extract_text_portions(full_text_path, need_outcome, need_legal_concepts):
    """Read only the relevant portions of a case's full text."""
    if not full_text_path or str(full_text_path) == "nan" or not os.path.exists(full_text_path):
        return ""

    try:
        with open(full_text_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception:
        return ""

    parts = []
    if need_outcome:
        # Orders/decisions are usually at the end
        parts.append("=== LAST SECTION ===\n" + text[-3000:])
    if need_legal_concepts:
        # Legal concepts from catchwords/beginning
        parts.append("=== FIRST SECTION ===\n" + text[:2000])

    return "\n\n".join(parts)


def call_api(client, cases_text):
    """Call Claude Sonnet API with retry logic."""
    for attempt in range(3):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS * BATCH_SIZE,
                messages=[
                    {"role": "user", "content": EXTRACTION_PROMPT.format(cases_text=cases_text)}
                ],
            )
            text = response.content[0].text.strip()
            # Extract JSON from response
            if text.startswith("["):
                return json.loads(text)
            # Try to find JSON array in response
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            return None
        except anthropic.RateLimitError:
            wait = (attempt + 1) * 10
            log("?", f"Rate limited, waiting {wait}s...")
            time.sleep(wait)
        except json.JSONDecodeError as e:
            log("?", f"JSON parse error: {e}")
            return None
        except Exception as e:
            log("?", f"API error: {e}")
            if attempt < 2:
                time.sleep(5)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, required=True, help="Batch index (0-based)")
    parser.add_argument("--total-batches", type=int, required=True, help="Total number of batches")
    parser.add_argument("--target", default="both", choices=["outcome", "legal_concepts", "both"])
    args = parser.parse_args()

    batch_id = args.batch
    total_batches = args.total_batches

    df = pd.read_csv(CSV_PATH, low_memory=False)

    # Build target list
    targets = []
    for idx, row in df.iterrows():
        need_outcome = (str(row.get("outcome", "")) == "Unknown")
        need_lc = (pd.isna(row.get("legal_concepts")) or
                   str(row.get("legal_concepts", "")).strip() in ("", "nan"))

        if args.target == "outcome" and not need_outcome:
            continue
        elif args.target == "legal_concepts" and not need_lc:
            continue
        elif args.target == "both" and not (need_outcome or need_lc):
            continue

        targets.append({
            "idx": idx,
            "case_id": row["case_id"],
            "title": str(row.get("title", ""))[:80],
            "full_text_path": str(row.get("full_text_path", "")),
            "catchwords": str(row.get("catchwords", ""))[:500],
            "need_outcome": need_outcome,
            "need_lc": need_lc,
        })

    # Split into batches
    batch_size = len(targets) // total_batches + 1
    start = batch_id * batch_size
    end = min(start + batch_size, len(targets))
    my_targets = targets[start:end]

    log(batch_id, f"Total targets: {len(targets):,}, my batch: {len(my_targets):,} (idx {start}-{end})")

    if not my_targets:
        log(batch_id, "No targets for this batch.")
        return

    os.makedirs(RESULTS_DIR, exist_ok=True)
    client = anthropic.Anthropic()
    results = []
    processed = 0

    # Process in sub-batches
    for i in range(0, len(my_targets), BATCH_SIZE):
        sub_batch = my_targets[i:i + BATCH_SIZE]

        # Build cases text for prompt
        cases_parts = []
        for t in sub_batch:
            text_portion = extract_text_portions(
                t["full_text_path"], t["need_outcome"], t["need_lc"]
            )
            if not text_portion:
                text_portion = t["catchwords"]

            entry = f"--- Case {t['case_id']} ---\nTitle: {t['title']}\n"
            if t["need_outcome"]:
                entry += "[EXTRACT OUTCOME]\n"
            if t["need_lc"]:
                entry += "[EXTRACT LEGAL CONCEPTS]\n"
            entry += f"Catchwords: {t['catchwords'][:300]}\n"
            entry += f"Text:\n{text_portion[:2500]}\n"
            cases_parts.append(entry)

        cases_text = "\n".join(cases_parts)

        # Call API
        api_results = call_api(client, cases_text)
        if api_results:
            for r in api_results:
                results.append(r)

        processed += len(sub_batch)
        log(batch_id, f"Processed {processed}/{len(my_targets)} ({processed*100//len(my_targets)}%)")

        time.sleep(RATE_LIMIT_DELAY)

        # Checkpoint save every 200 cases
        if processed % 200 == 0 and results:
            checkpoint_path = os.path.join(RESULTS_DIR, f"batch_{batch_id}_checkpoint.json")
            with open(checkpoint_path, "w") as f:
                json.dump(results, f, indent=2)

    # Final save
    output_path = os.path.join(RESULTS_DIR, f"batch_{batch_id}_results.json")
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    log(batch_id, f"Done! {len(results)} results saved to {output_path}")


if __name__ == "__main__":
    main()
