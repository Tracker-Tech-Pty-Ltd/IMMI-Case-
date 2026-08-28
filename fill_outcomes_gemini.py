#!/usr/bin/env python3
"""
fill_outcomes_gemini.py

Fill empty 'outcome' fields using Gemini 2.5 Flash.
Reads from SQLite, writes back to SQLite, optionally syncs to Supabase.

Usage:
    python fill_outcomes_gemini.py                     # process all 8,691 pending
    python fill_outcomes_gemini.py --sample 100        # test on 100 cases
    python fill_outcomes_gemini.py --court FCA         # only FCA cases
    python fill_outcomes_gemini.py --dry-run           # preview prompts, no API calls
    python fill_outcomes_gemini.py --thinking          # enable Gemini thinking mode (~$1.91)
    python fill_outcomes_gemini.py --workers 4         # parallel API threads
    python fill_outcomes_gemini.py --no-supabase       # skip Supabase sync at end

Requirements:
    GOOGLE_API_KEY in .env  (or GEMINI_API_KEY)
    pip install google-generativeai   # current (0.8.6, deprecated — works)
    # OR: pip install -U google-genai  # new SDK (required for --thinking mode)
"""

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from immi_case_downloader.extraction.batch_runner import load_project_env

# ── Load .env ──────────────────────────────────────────────────────────────

load_project_env()

# ── Config ─────────────────────────────────────────────────────────────────

DB_PATH        = Path("downloaded_cases/cases.db")
CHECKPOINT_FILE = Path("downloaded_cases/fill_outcomes_progress.json")
MODEL          = "gemini-2.5-flash-lite"  # "Flash Light" — cheaper, still excellent for classification
BATCH_SIZE     = 20
MAX_WORKERS    = 4
CHECKPOINT_EVERY = 200   # commit to SQLite every N processed cases
MAX_RETRIES    = 3
RETRY_DELAY    = 5.0
API_RATE_DELAY = 0.3

# Valid outcome values (from DB audit — in descending frequency order)
VALID_OUTCOMES = [
    "Affirmed",
    "Remitted",
    "Dismissed",
    "Set aside",
    "Refused",
    "No jurisdiction",
    "Granted",
    "Allowed",
    "Cancelled",
    "Quashed",
    "Withdrawn",
    "Varied",      # tribunal varies (modifies) the original decision
]

SYSTEM_PROMPT = f"""You are an expert legal analyst specialising in Australian immigration law.

Your task: classify the OUTCOME of each immigration tribunal/court case from its catchwords and text snippet.

Valid outcomes (use EXACTLY one of these — case-sensitive):
{chr(10).join(f"- {v}" for v in VALID_OUTCOMES)}

Definitions:
- Affirmed: original decision upheld by tribunal/court
- Remitted: matter sent back to original decision-maker to reconsider
- Dismissed: application/appeal dismissed, applicant loses without merit decision
- Set aside: original decision overturned/reversed
- Refused: application or visa refused by tribunal/court
- No jurisdiction: tribunal/court had no power to hear the matter
- Granted: application/visa granted, applicant wins
- Allowed: appeal allowed (use for court appeals where decision is in applicant's favour)
- Cancelled: visa or decision cancelled
- Quashed: decision quashed by judicial review
- Withdrawn: proceedings withdrawn by applicant

Return ONLY a valid JSON array, one object per case, in the same order as input:
[{{"case_id": "...", "outcome": "..."}}]

If the outcome genuinely cannot be determined, use "Dismissed" as the safest fallback for tribunal cases, or leave as "" for court cases where outcome is unclear. Never use null."""


# ── Logging ────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Database helpers ───────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def load_pending_cases(court: str | None = None, sample: int | None = None) -> list[dict]:
    """Return cases with empty outcome, ordered by court then case_id."""
    conn = get_connection()
    try:
        where = "(outcome IS NULL OR outcome = '')"
        params: list = []
        if court:
            where += " AND court_code = ?"
            params.append(court)
        limit_clause = f"LIMIT {sample}" if sample else ""
        rows = conn.execute(
            f"SELECT case_id, title, court_code, catchwords, text_snippet "
            f"FROM cases WHERE {where} ORDER BY court_code, case_id {limit_clause}",
            params,
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


_db_lock = threading.Lock()

def update_outcomes_batch(updates: list[tuple[str, str]]) -> int:
    """Write (outcome, case_id) pairs to SQLite. Returns count updated."""
    if not updates:
        return 0
    with _db_lock:
        conn = get_connection()
        try:
            conn.executemany(
                "UPDATE cases SET outcome = ? WHERE case_id = ?",
                updates,
            )
            conn.commit()
            return len(updates)
        finally:
            conn.close()


# ── Gemini API ─────────────────────────────────────────────────────────────

def build_gemini_model(thinking: bool):
    """Create and return a configured Gemini GenerativeModel.

    Thinking mode requires the newer 'google-genai' SDK (pip install google-genai).
    The currently installed 'google-generativeai' 0.8.6 does not support ThinkingConfig.
    Run with --thinking only after: pip install -U google-genai
    """
    try:
        import google.generativeai as genai
    except ImportError:
        logger.error("google-generativeai not installed. Run: pip install google-generativeai")
        sys.exit(1)

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY (or GEMINI_API_KEY) not found in environment / .env")
        sys.exit(1)

    genai.configure(api_key=api_key)

    if thinking:
        logger.warning(
            "--thinking requires 'google-genai' >= 1.0 (pip install -U google-genai). "
            "Current SDK (google-generativeai 0.8.6) does not support ThinkingConfig. "
            "Falling back to standard mode."
        )

    generation_config = genai.GenerationConfig(
        temperature=0,
        response_mime_type="application/json",
    )

    model = genai.GenerativeModel(
        model_name=MODEL,
        system_instruction=SYSTEM_PROMPT,
        generation_config=generation_config,
    )
    return model


def classify_batch(model, cases: list[dict]) -> list[tuple[str, str]]:
    """
    Call Gemini to classify outcomes for a batch of cases.
    Returns list of (case_id, outcome) pairs for successfully classified cases.
    """
    # Build user message with compact per-case blocks
    parts = []
    for i, c in enumerate(cases):
        catchwords = (c.get("catchwords") or "").strip()[:400]
        snippet    = (c.get("text_snippet") or "").strip()[:600]
        parts.append(
            f"[{i}] case_id={c['case_id']} court={c['court_code']}\n"
            f"Title: {(c.get('title') or '')[:120]}\n"
            f"Catchwords: {catchwords}\n"
            f"Snippet: {snippet}"
        )
    user_message = "\n\n---\n\n".join(parts)

    for attempt in range(MAX_RETRIES):
        try:
            response = model.generate_content(user_message)
            raw = response.text.strip()

            # Strip markdown code fences if present
            raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"\s*```$", "", raw)

            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                raise ValueError(f"Expected list, got {type(parsed)}")

            results = []
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                case_id = item.get("case_id", "").strip()
                outcome = item.get("outcome", "").strip()
                if case_id and outcome in VALID_OUTCOMES:
                    results.append((outcome, case_id))  # (value, key) for executemany UPDATE
                elif case_id and outcome == "":
                    # Accepted: LLM chose to leave empty
                    pass
                elif case_id and outcome:
                    # Try case-insensitive match
                    matched = next(
                        (v for v in VALID_OUTCOMES if v.lower() == outcome.lower()), None
                    )
                    if matched:
                        results.append((matched, case_id))
                    else:
                        logger.warning("Unknown outcome %r for %s — skipping", outcome, case_id)
            return results

        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Parse error on attempt %d/%d: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = RETRY_DELAY * (2 ** attempt)
                logger.warning("Rate limit on attempt %d/%d, waiting %.0fs", attempt + 1, MAX_RETRIES, wait)
                time.sleep(wait)
            else:
                logger.error("API error on attempt %d/%d: %s", attempt + 1, MAX_RETRIES, e)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    raise

    return []


# ── Progress tracking ──────────────────────────────────────────────────────

_counter_lock = threading.Lock()
_processed   = 0
_filled      = 0
_start_time  = time.time()


def log_progress(total: int):
    elapsed = time.time() - _start_time
    rate = _processed / elapsed if elapsed > 0 else 0
    remaining = (total - _processed) / rate if rate > 0 else 0
    logger.info(
        "Progress: %d/%d (%.1f%%) | filled=%d | %.1f cases/s | ETA=%.0fm",
        _processed, total, 100 * _processed / total if total else 0,
        _filled, rate, remaining / 60,
    )


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    global _processed, _filled

    parser = argparse.ArgumentParser(description="Fill empty outcome fields with Gemini")
    parser.add_argument("--sample",     type=int,   help="Process only N cases (for testing)")
    parser.add_argument("--court",      type=str,   help="Filter by court_code (e.g. FCA)")
    parser.add_argument("--dry-run",    action="store_true", help="Build prompts but skip API")
    parser.add_argument("--thinking",   action="store_true", help="Enable Gemini thinking mode")
    parser.add_argument("--workers",    type=int,   default=MAX_WORKERS)
    parser.add_argument("--no-supabase", action="store_true", help="Skip Supabase sync reminder")
    args = parser.parse_args()

    if not DB_PATH.exists():
        logger.error("Database not found: %s", DB_PATH)
        sys.exit(1)

    # Load pending cases
    logger.info("Loading pending cases from SQLite…")
    cases = load_pending_cases(court=args.court, sample=args.sample)
    total = len(cases)

    if total == 0:
        logger.info("No pending cases found — nothing to do.")
        return

    from collections import Counter
    court_counts = Counter(c["court_code"] for c in cases)
    logger.info(
        "Found %d cases with empty outcome across %d courts",
        total, len(court_counts),
    )
    for court, n in court_counts.most_common():
        logger.info("  %-20s %d cases", court, n)

    if args.dry_run:
        # Show first batch prompt
        batch = cases[:min(3, total)]
        logger.info("\n--- DRY RUN: sample prompt (first 3 cases) ---")
        parts = []
        for i, c in enumerate(batch):
            catchwords = (c.get("catchwords") or "")[:400]
            snippet    = (c.get("text_snippet") or "")[:600]
            parts.append(
                f"[{i}] case_id={c['case_id']} court={c['court_code']}\n"
                f"Title: {(c.get('title') or '')[:120]}\n"
                f"Catchwords: {catchwords}\n"
                f"Snippet: {snippet}"
            )
        print("\n".join(parts))
        logger.info("--- DRY RUN complete (no API calls made) ---")
        return

    # Build model
    model = build_gemini_model(thinking=args.thinking)
    mode_label = "thinking" if args.thinking else "standard"
    logger.info("Using Gemini %s (%s mode) with %d workers", MODEL, mode_label, args.workers)

    # Batch processing
    batches = [cases[i:i + BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]
    logger.info("Processing %d batches of up to %d cases…", len(batches), BATCH_SIZE)

    pending_updates: list[tuple[str, str]] = []

    def process_batch(batch: list[dict]) -> list[tuple[str, str]]:
        time.sleep(API_RATE_DELAY)
        return classify_batch(model, batch)

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_batch, b): b for b in batches}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                updates = future.result()
            except Exception as e:
                logger.error("Batch failed: %s", e)
                updates = []

            with _counter_lock:
                _processed += len(batch)
                _filled    += len(updates)
                pending_updates.extend(updates)

                # Checkpoint: flush to SQLite
                if len(pending_updates) >= CHECKPOINT_EVERY or _processed >= total:
                    n = update_outcomes_batch(pending_updates)
                    logger.info("Checkpointed %d outcomes to SQLite", n)
                    pending_updates.clear()

            if _processed % (CHECKPOINT_EVERY * 2) == 0 or _processed >= total:
                log_progress(total)

    # Final flush
    if pending_updates:
        n = update_outcomes_batch(pending_updates)
        logger.info("Final flush: %d outcomes", n)

    elapsed = time.time() - _start_time
    fill_rate = 100 * _filled / total if total else 0
    logger.info(
        "\n✓ Done in %.1fm | %d/%d filled (%.1f%%) | %d left empty",
        elapsed / 60, _filled, total, fill_rate, total - _filled,
    )

    if not args.no_supabase and _filled > 0:
        logger.info(
            "\nNext step: sync outcomes to Supabase:\n"
            "  python migrate_csv_to_supabase.py\n"
            "Or update Supabase directly via supabase_repository.\n"
            "Note: SQLite is the source of truth — run the sync after verification."
        )


if __name__ == "__main__":
    _start_time = time.time()
    main()
