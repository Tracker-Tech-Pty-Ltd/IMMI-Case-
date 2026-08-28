#!/usr/bin/env python3
"""
LLM-assisted extraction of structured fields for cases where regex failed.

Targets fields: country_of_origin, is_represented, representative,
visa_outcome_reason, legal_test_applied

Uses Claude Sonnet in batches of 20 cases. Reads only the most relevant
portions of each case text to keep token usage efficient.

Usage:
    python extract_structured_fields_llm.py                    # process all pending
    python extract_structured_fields_llm.py --sample 500       # test on 500 cases
    python extract_structured_fields_llm.py --fields country   # only extract country
    python extract_structured_fields_llm.py --dry-run          # preview only
    python extract_structured_fields_llm.py --court AATA       # only AATA cases
    python extract_structured_fields_llm.py --workers 8        # parallel API calls
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import anthropic

from immi_case_downloader.extraction.batch_runner import (
    atomic_write_rows,
    catalog_lock,
    load_project_env,
)

load_project_env()

# ── Config ───────────────────────────────────────────────────────────────

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")
RESULTS_DIR = Path("downloaded_cases/llm_structured_results")
MODEL = "claude-sonnet-4-6"
BATCH_SIZE = 20         # cases per API call
MAX_WORKERS = 8         # parallel API threads
CHECKPOINT_EVERY = 500  # save to CSV every N processed cases
MAX_RETRIES = 3
RETRY_DELAY = 5.0       # seconds between retries
API_RATE_DELAY = 0.5    # seconds between batch API calls per worker

# Text portions to send per field (chars)
TEXT_HEADER_CHARS = 3000    # DECISION RECORD + preamble
TEXT_CATCHWORDS_CHARS = 800  # CATCHWORDS section
TEXT_BODY_CHARS = 2000       # intro body paragraphs

# ── System prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert in Australian immigration law. Analyze each immigration case excerpt and extract structured fields accurately.

For each case, extract the following fields:

1. **country_of_origin**: The applicant's country of citizenship/nationality.
   - Look for explicit statements: "citizen of X", "national of X", "born in X", "from X"
   - Infer from context: country mentioned in persecution/protection claims
   - Use country names (e.g., "China", "India", "Iran") not demonyms
   - Leave empty ("") if genuinely unknown (e.g., business visa with no country clue)
   - Do NOT guess from applicant names alone

2. **is_represented**: Whether the applicant had legal representation ("Yes"/"No"/"").
   - "Yes" if: counsel/solicitor/migration agent appeared or submitted for applicant
   - "No" if: applicant appeared in person, unrepresented, or self-represented
   - "" if: cannot determine from text

3. **representative**: Name of the legal representative (if represented).
   - Extract full name of solicitor/barrister/migration agent
   - Leave empty if unrepresented or unknown
   - Do NOT include firm name unless it's integral (e.g., "Mr Smith of Jones Legal")

4. **visa_outcome_reason**: Primary reason for visa refusal/grant/remittal (under 150 chars).
   - Focus on the decisive criterion or legal issue
   - Examples: "genuine temporary entrant not satisfied", "character test not met s.501",
     "refugee test not satisfied", "not genuine student", "balance of family test failed"
   - Leave empty if outcome is not a visa decision (e.g., procedural orders)

5. **legal_test_applied**: Primary legal test or section applied (under 80 chars).
   - Examples: "s.36 refugee test", "s.501 character test", "genuine temporary entrant test",
     "balance of family test", "complementary protection s.36(2)(aa)"
   - Leave empty if no specific legal test is central

Respond ONLY with a valid JSON array. Each element must have exactly these keys:
"idx", "country_of_origin", "is_represented", "representative", "visa_outcome_reason", "legal_test_applied"

If a field cannot be determined, use "" (empty string). Never use null or None."""


# ── Helpers ──────────────────────────────────────────────────────────────

def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_csv() -> list[dict]:
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_csv(rows: list[dict]):
    atomic_write_rows(
        CSV_PATH,
        rows,
        job_name="structured_fields_llm",
        backup_suffix=".csv.bak_llm_structured",
        backup_once=True,
    )


def read_case_text(full_text_path: str) -> str:
    """Read the most relevant portions of a case text file."""
    if not full_text_path or not os.path.exists(full_text_path):
        return ""
    try:
        with open(full_text_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except (OSError, IOError):
        return ""

    # 1. Header section (DECISION RECORD + preamble)
    header = text[:TEXT_HEADER_CHARS]

    # 2. CATCHWORDS section
    catchwords = ""
    m = re.search(
        r"CATCHWORDS?\s*[:\n]+\s*(.+?)(?=\n\s*(?:LEGISLATION|STATEMENT\s+OF|DECISION\s+AND|$))",
        text[:8000], re.IGNORECASE | re.DOTALL
    )
    if m:
        catchwords = m.group(1)[:TEXT_CATCHWORDS_CHARS]

    # 3. First body paragraphs (after the separator)
    sep_pos = text.find("=" * 10)
    if sep_pos > 0:
        body_start = sep_pos + 80
    else:
        body_start = min(1500, len(text))
    body = text[body_start:body_start + TEXT_BODY_CHARS]

    # 4. DECISION section (for outcome)
    decision = ""
    m2 = re.search(r"DECISION\s*:\s*\n?\s*(.+?)(?:\n{2,}|STATEMENT\s+OF)", text[:5000], re.IGNORECASE | re.DOTALL)
    if m2:
        decision = m2.group(1)[:300]

    parts = [header]
    if catchwords:
        parts.append(f"\n[CATCHWORDS]: {catchwords}")
    if decision:
        parts.append(f"\n[DECISION]: {decision}")
    if body and body not in header:
        parts.append(f"\n[BODY EXCERPT]: {body}")

    combined = "\n".join(parts)
    # Limit total tokens
    return combined[:6000]


def get_pending_cases(rows: list[dict], target_fields: list[str], court_filter: str = "") -> list[int]:
    """Find cases that need LLM extraction for at least one target field."""
    pending = []
    for i, row in enumerate(rows):
        if court_filter and row.get("court_code", "") != court_filter:
            continue
        # Check if any target field is empty
        needs_extraction = any(not row.get(f, "").strip() for f in target_fields)
        if not needs_extraction:
            continue
        # Only process cases with text files available
        path = row.get("full_text_path", "")
        if path and not path.startswith("/"):
            path = str(Path("/Users/d/Developer/IMMI-Case-") / path)
        if path and os.path.exists(path):
            pending.append(i)
        elif not path:
            # Try constructing path from citation
            citation = row.get("citation", "")
            if citation:
                constructed = Path("downloaded_cases/case_texts") / f"{citation}.txt"
                if constructed.exists():
                    pending.append(i)
    return pending


def build_prompt(rows: list[dict], indices: list[int]) -> str:
    """Build a prompt for a batch of case indices."""
    cases_text = []
    for batch_idx, row_idx in enumerate(indices):
        row = rows[row_idx]
        citation = row.get("citation", "?")
        title = row.get("title", "")
        court = row.get("court_code", "")

        # Get full text
        path = row.get("full_text_path", "")
        if path and not path.startswith("/"):
            path = str(Path("/Users/d/Developer/IMMI-Case-") / path)
        text_excerpt = read_case_text(path)
        if not text_excerpt:
            citation_path = Path("downloaded_cases/case_texts") / f"{citation}.txt"
            text_excerpt = read_case_text(str(citation_path))

        # Show which fields are needed
        needed = [f for f in ["country_of_origin", "is_represented", "representative",
                               "visa_outcome_reason", "legal_test_applied"]
                  if not row.get(f, "").strip()]

        cases_text.append(
            f"=== Case {batch_idx} (idx={batch_idx}) ===\n"
            f"Citation: {citation}\nCourt: {court}\nTitle: {title}\n"
            f"Fields needed: {', '.join(needed)}\n"
            f"Text:\n{text_excerpt}\n"
        )

    return "\n".join(cases_text)


def parse_llm_response(response_text: str) -> list[dict]:
    """Parse the JSON response from Claude."""
    # Try to extract JSON array from response
    text = response_text.strip()
    # Find JSON array
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        return []
    json_str = text[start:end]
    try:
        results = json.loads(json_str)
        if not isinstance(results, list):
            return []
        return results
    except json.JSONDecodeError:
        return []


def process_batch(
    client: anthropic.Anthropic,
    rows: list[dict],
    batch_indices: list[int],
    target_fields: list[str],
) -> list[dict]:
    """Process a batch of cases through Claude and return extracted fields."""
    prompt = build_prompt(rows, batch_indices)

    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model=MODEL,
                max_tokens=2000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            response_text = next(
                (b.text for b in response.content if b.type == "text"), ""  # type: ignore[union-attr]
            )
            results = parse_llm_response(response_text)

            # Map results back to row indices
            extracted = []
            for result in results:
                batch_idx = result.get("idx", -1)
                if not isinstance(batch_idx, int) or batch_idx < 0 or batch_idx >= len(batch_indices):
                    continue
                row_idx = batch_indices[batch_idx]
                fields = {
                    f: str(result.get(f, "")).strip()
                    for f in target_fields
                    if f in result
                }
                extracted.append({"row_idx": row_idx, "fields": fields})
            return extracted

        except anthropic.RateLimitError:
            wait = RETRY_DELAY * (2 ** attempt)
            log(f"Rate limit hit, waiting {wait:.0f}s...")
            time.sleep(wait)
        except anthropic.APIError as e:
            if attempt < MAX_RETRIES - 1:
                log(f"API error (attempt {attempt+1}): {e}, retrying...")
                time.sleep(RETRY_DELAY)
            else:
                log(f"Batch failed after {MAX_RETRIES} attempts: {e}")
                return []
        except Exception as e:
            log(f"Unexpected error: {e}")
            return []

    return []


# ── Main ─────────────────────────────────────────────────────────────────


def main():
    with catalog_lock(Path(CSV_PATH), "structured_fields_llm"):
        parser = argparse.ArgumentParser(description="LLM extraction of structured fields")
        parser.add_argument("--dry-run", action="store_true", help="Preview without saving")
        parser.add_argument("--sample", type=int, default=0, help="Process N random cases")
        parser.add_argument("--court", type=str, default="", help="Filter by court code")
        parser.add_argument("--workers", type=int, default=MAX_WORKERS, help="Parallel API workers")
        parser.add_argument(
            "--fields",
            nargs="+",
            default=["country_of_origin", "is_represented", "representative",
                     "visa_outcome_reason", "legal_test_applied"],
            help="Which fields to extract",
        )
        args = parser.parse_args()

        # Validate fields
        valid_fields = {"country_of_origin", "is_represented", "representative",
                        "visa_outcome_reason", "legal_test_applied"}
        target_fields = [f for f in args.fields if f in valid_fields]
        if not target_fields:
            print(f"No valid fields specified. Valid options: {sorted(valid_fields)}")
            sys.exit(1)

        log(f"Starting LLM extraction for fields: {target_fields}")
        log(f"Model: {MODEL}, batch_size={BATCH_SIZE}, workers={args.workers}")

        # Load CSV
        rows = load_csv()
        log(f"Loaded {len(rows)} cases")

        # Ensure new columns exist
        for row in rows:
            for f in target_fields:
                if f not in row:
                    row[f] = ""

        # Find pending cases
        pending = get_pending_cases(rows, target_fields, args.court)
        log(f"Found {len(pending)} cases needing LLM extraction")

        if args.sample > 0:
            import random
            random.seed(42)
            pending = random.sample(pending, min(args.sample, len(pending)))
            log(f"Sampled {len(pending)} cases")

        if not pending:
            log("No cases to process. Done!")
            return

        # Create results dir
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)

        # Initialize Anthropic client
        client = anthropic.Anthropic()

        # Split into batches
        batches = [pending[i:i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
        log(f"Created {len(batches)} batches of up to {BATCH_SIZE} cases each")

        # Processing state
        processed_count = 0
        extraction_counts = {f: 0 for f in target_fields}
        lock = threading.Lock()

        def worker_task(batch_idx: int, batch: list[int]) -> list[dict]:
            time.sleep(API_RATE_DELAY * (batch_idx % args.workers))
            return process_batch(client, rows, batch, target_fields)

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(worker_task, i, batch): (i, batch)
                for i, batch in enumerate(batches)
            }

            for future in as_completed(futures):
                batch_num, batch = futures[future]
                try:
                    results = future.result()
                except Exception as e:
                    log(f"Batch {batch_num} error: {e}")
                    results = []

                with lock:
                    for item in results:
                        row_idx = item["row_idx"]
                        for field, value in item["fields"].items():
                            if value and not rows[row_idx].get(field):
                                rows[row_idx][field] = value
                                extraction_counts[field] += 1

                    processed_count += len(batch)

                    # Checkpoint save
                    if not args.dry_run and processed_count % CHECKPOINT_EVERY < BATCH_SIZE:
                        log(f"Checkpoint: {processed_count}/{len(pending)} cases processed")
                        save_csv(rows)

                    if processed_count % 100 == 0 or processed_count == len(pending):
                        log(f"Progress: {processed_count}/{len(pending)} cases")
                        for f, cnt in extraction_counts.items():
                            print(f"  {f}: +{cnt} new values")

        # Final summary
        print(f"\n{'='*60}")
        print("LLM Extraction Complete")
        print(f"{'='*60}")
        print(f"Cases processed: {len(pending)}")
        for f, cnt in extraction_counts.items():
            pct = cnt / max(len(pending), 1) * 100
            print(f"  {f}: +{cnt} new values ({pct:.1f}%)")

        # Fill rate after
        print(f"\nFill rates (all {len(rows)} cases):")
        for f in target_fields:
            filled = sum(1 for r in rows if r.get(f, "").strip())
            pct = filled / len(rows) * 100
            print(f"  {f:30s}: {filled:>7,} / {len(rows):,} = {pct:5.1f}%")

        if args.dry_run:
            log("Dry run — no changes saved.")
        else:
            log("Saving final CSV...")
            save_csv(rows)
            log("Done!")


if __name__ == "__main__":
    main()
