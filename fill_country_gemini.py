#!/usr/bin/env python3
"""
fill_country_gemini.py

Fill empty 'country_of_origin' fields using Gemini 2.5 Flash Lite.
Reads from SQLite, writes back to SQLite.

Usage:
    python fill_country_gemini.py                     # all 47,905 pending
    python fill_country_gemini.py --sample 200        # test run
    python fill_country_gemini.py --court MRTA        # single court
    python fill_country_gemini.py --dry-run           # preview prompt only
    python fill_country_gemini.py --workers 4

Requirements:
    GOOGLE_API_KEY in .env
    pip install google-generativeai
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
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv


def _find_and_load_env():
    p = Path(__file__).parent
    for _ in range(8):
        candidate = p / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=True)
            return
        p = p.parent

_find_and_load_env()

# ── Config ─────────────────────────────────────────────────────────────────

DB_PATH        = Path("downloaded_cases/cases.db")
MODEL          = "gemini-2.5-flash-lite"
BATCH_SIZE     = 20
MAX_WORKERS    = 4
CHECKPOINT_EVERY = 200
MAX_RETRIES    = 3
RETRY_DELAY    = 5.0
API_RATE_DELAY = 0.3

# Known non-immigration courts where country is rarely relevant
COUNTRY_OPTIONAL_COURTS = {"HCA"}  # High Court — mostly procedural, rarely country-specific

SYSTEM_PROMPT = """You are an expert in Australian immigration law.

Your task: identify the applicant's COUNTRY OF ORIGIN (nationality/citizenship) from each immigration case excerpt.

Rules:
1. Return the standard English country name (e.g. "China", "India", "Iran", "Afghanistan", "Sri Lanka")
2. Use country names, not adjectives ("China" not "Chinese")
3. Look for explicit statements: "citizen of X", "national of X", "born in X", "from X"
4. For protection/refugee visa cases: infer from country of claimed persecution if nationality is not stated
5. Return "" (empty) when:
   - No country is relevant (e.g. employer-sponsored skills visa with no country mentioned)
   - The case is purely procedural (costs orders, jurisdictional rulings with no substantive nationality issue)
   - You genuinely cannot determine nationality from the available text — do NOT guess from applicant names
6. Do NOT use demonyms or adjectives as country names

Return ONLY a valid JSON array, one object per case, same order as input:
[{"case_id": "...", "country": "..."}]

Never use null."""


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── DB helpers ─────────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def load_pending(court: str | None, sample: int | None) -> list[dict]:
    conn = get_connection()
    try:
        where = "(country_of_origin IS NULL OR country_of_origin = '')"
        params: list = []
        if court:
            where += " AND court_code = ?"
            params.append(court)
        limit = f"LIMIT {sample}" if sample else ""
        rows = conn.execute(
            f"SELECT case_id, title, court_code, catchwords, text_snippet "
            f"FROM cases WHERE {where} ORDER BY court_code, case_id {limit}",
            params,
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


_db_lock = threading.Lock()

def write_countries(updates: list[tuple[str, str]]) -> int:
    """Write (country, case_id) pairs to SQLite."""
    if not updates:
        return 0
    with _db_lock:
        conn = get_connection()
        try:
            conn.executemany(
                "UPDATE cases SET country_of_origin = ? WHERE case_id = ?",
                updates,
            )
            conn.commit()
            return len(updates)
        finally:
            conn.close()


# ── Gemini ─────────────────────────────────────────────────────────────────

def build_model():
    try:
        import google.generativeai as genai
    except ImportError:
        logger.error("pip install google-generativeai")
        sys.exit(1)

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GOOGLE_API_KEY not found in .env")
        sys.exit(1)

    genai.configure(api_key=api_key)
    # Note: system_instruction= param is unreliable with google-generativeai 0.8.6.
    # We prepend the system prompt directly into each user message instead.
    return genai.GenerativeModel(
        model_name=MODEL,
        generation_config=genai.GenerationConfig(temperature=0),
    )


def classify_batch(model, cases: list[dict]) -> list[tuple[str, str]]:
    """Returns list of (country, case_id) — only where country is non-empty."""
    parts = []
    for i, c in enumerate(cases):
        catchwords = (c.get("catchwords") or "").strip()[:500]
        snippet    = (c.get("text_snippet") or "").strip()[:700]
        parts.append(
            f"[{i}] case_id={c['case_id']} court={c['court_code']}\n"
            f"Title: {(c.get('title') or '')[:120]}\n"
            f"Catchwords: {catchwords}\n"
            f"Snippet: {snippet}"
        )
    # Prepend system prompt — system_instruction param unreliable in SDK 0.8.6
    user_msg = SYSTEM_PROMPT + "\n\n" + "\n\n---\n\n".join(parts)

    for attempt in range(MAX_RETRIES):
        try:
            response = model.generate_content(user_msg)
            raw = response.text.strip()
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
                country = item.get("country", "").strip()
                # Skip empty/null — these cases get no update
                if case_id and country:
                    results.append((country, case_id))
            return results

        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("Parse error attempt %d/%d: %s", attempt + 1, MAX_RETRIES, e)
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = RETRY_DELAY * (2 ** attempt)
                logger.warning("Rate limit, waiting %.0fs", wait)
                time.sleep(wait)
            else:
                logger.error("API error: %s", e)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    raise
    return []


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample",  type=int)
    parser.add_argument("--court",   type=str)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS)
    args = parser.parse_args()

    if not DB_PATH.exists():
        logger.error("DB not found: %s", DB_PATH)
        sys.exit(1)

    logger.info("Loading pending cases…")
    cases = load_pending(court=args.court, sample=args.sample)
    total = len(cases)

    if total == 0:
        logger.info("No pending cases — done.")
        return

    court_counts = Counter(c["court_code"] for c in cases)
    logger.info("Found %d cases with empty country_of_origin", total)
    for court, n in court_counts.most_common():
        logger.info("  %-20s %d", court, n)

    if args.dry_run:
        batch = cases[:3]
        for i, c in enumerate(batch):
            print(f"\n[{i}] {c['case_id']} {c['court_code']}")
            print(f"Title: {(c.get('title') or '')[:100]}")
            print(f"Catchwords: {(c.get('catchwords') or '')[:300]}")
        logger.info("Dry run complete.")
        return

    model = build_model()
    logger.info("Using %s, %d workers", MODEL, args.workers)

    batches = [cases[i:i + BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]
    logger.info("Processing %d batches…", len(batches))

    processed = 0
    filled     = 0
    pending: list[tuple[str, str]] = []
    lock = threading.Lock()
    start = time.time()

    def process(batch):
        time.sleep(API_RATE_DELAY)
        return classify_batch(model, batch)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(process, b): b for b in batches}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                updates = future.result()
            except Exception as e:
                logger.error("Batch failed: %s", e)
                updates = []

            with lock:
                processed += len(batch)
                filled    += len(updates)
                pending.extend(updates)

                if len(pending) >= CHECKPOINT_EVERY or processed >= total:
                    n = write_countries(pending)
                    logger.info("Checkpointed %d countries to SQLite", n)
                    pending.clear()

            if processed % (CHECKPOINT_EVERY * 5) == 0 or processed >= total:
                elapsed = time.time() - start
                rate = processed / elapsed if elapsed > 0 else 0
                eta  = (total - processed) / rate if rate > 0 else 0
                logger.info(
                    "Progress: %d/%d (%.1f%%) | filled=%d | %.1f/s | ETA=%.0fm",
                    processed, total, 100*processed/total, filled, rate, eta/60,
                )

    if pending:
        write_countries(pending)

    elapsed = time.time() - start
    logger.info(
        "\n✓ Done in %.1fm | %d/%d filled (%.1f%%) | %d left empty",
        elapsed/60, filled, total, 100*filled/total if total else 0, total-filled,
    )
    if filled > 0:
        logger.info("Next: python sync_country_supabase.py  (or adapt sync_outcomes_supabase.py)")


if __name__ == "__main__":
    main()
