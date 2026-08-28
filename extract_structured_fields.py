#!/usr/bin/env python3
"""
Extract structured fields from immigration case text files.

Extracts: applicant_name, respondent, country_of_origin,
visa_subclass_number, hearing_date, is_represented, representative,
visa_outcome_reason, legal_test_applied

Usage:
    python extract_structured_fields.py                    # process all
    python extract_structured_fields.py --dry-run          # preview without saving
    python extract_structured_fields.py --sample 100       # process 100 random
    python extract_structured_fields.py --court ARTA       # only ARTA cases
    python extract_structured_fields.py --overwrite        # re-extract already-filled fields
"""

import argparse
import csv
import os
import re
import shutil
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

from immi_case_downloader.extraction.batch_runner import catalog_lock
from immi_case_downloader.extraction.patterns import (
    RE_AATA_APPLICANT,
    RE_AATA_REPRESENTATIVE,
    extract_country,
    extract_from_title,
    extract_hearing_date,
    extract_legal_test,
    extract_representation,
    extract_visa_outcome_reason,
    extract_visa_subclass_number,
)
# Re-exported for tests/test_extraction_structured_fields.py, which imports
# these private helpers directly (characterization tests predating this
# move). Not used by this module itself.
from immi_case_downloader.extraction.patterns import (  # noqa: F401
    _clean_country_value,
    _demonym_to_country,
    _normalise_country,
)

# ── Constants ────────────────────────────────────────────────────────────

CASES_DIR = Path("downloaded_cases/case_texts")
CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

# Rows between on-disk checkpoints during a long extraction run.
CHECKPOINT_EVERY = 5000


# Reserved result key: process_case() reports a swallowed worker exception
# through it, because a worker runs in another process and cannot increment
# a counter in the parent. main() pops it before merging fields into the row.
EXTRACTION_ERROR_KEY = "__extraction_error__"


def process_case(case_row: dict) -> dict:
    """Worker entry point. Never raises.

    ProcessPoolExecutor.map re-raises a worker exception when the result is
    consumed and then cancels every remaining future, so one unparseable row
    would throw away a 149k-row run that is 11 minutes in. Swallow per row,
    loudly, and keep going — but report the failure back to the parent so it
    can be counted and listed, rather than only writing to a stderr stream
    that interleaves across workers and scrolls away.
    """
    try:
        return _extract_case_fields(case_row)
    except Exception as exc:  # noqa: BLE001 - one bad row must not abort the run
        identifier = case_row.get("case_id") or case_row.get("citation") or "?"
        print(f"  warn: extraction failed for {identifier}: {exc}", file=sys.stderr)
        return {EXTRACTION_ERROR_KEY: f"{type(exc).__name__}: {exc}"}


def _extract_case_fields(case_row: dict) -> dict:
    """Process a single case and extract all structured fields."""
    # csv.DictReader fills a short row's missing cells with None, so `or ""`
    # rather than a get() default is what actually guarantees a str here.
    title = case_row.get("title") or ""
    citation = case_row.get("citation") or ""
    visa_subclass = case_row.get("visa_subclass") or ""
    visa_type = case_row.get("visa_type") or ""

    # Extract from title
    applicant_name, respondent = extract_from_title(title)

    # Read full text file if available
    text = ""
    text_path = case_row.get("full_text_path") or ""
    if text_path and os.path.exists(text_path):
        try:
            with open(text_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except (OSError, IOError):
            pass

    # Also try constructing path from citation
    if not text and citation:
        constructed_path = CASES_DIR / f"{citation}.txt"
        if constructed_path.exists():
            try:
                text = constructed_path.read_text(encoding="utf-8", errors="replace")
            except (OSError, IOError):
                pass

    # Extract from text
    country = extract_country(text) if text else ""
    visa_num = extract_visa_subclass_number(text, visa_subclass, visa_type)
    hearing_date = extract_hearing_date(text) if text else ""
    is_represented, representative = extract_representation(text) if text else ("", "")
    visa_outcome_reason = extract_visa_outcome_reason(text) if text else ""
    legal_test_applied = extract_legal_test(text) if text else ""

    # If no applicant from title, try structured fields in text
    if not applicant_name and text:
        preamble = text[:3000]
        # Try MRTA structured "REVIEW APPLICANT: Name" format (same-line or next-line)
        m = re.search(r"REVIEW\s+APPLICANT\s*:\s*\n?\s*([^\n]{2,80}?)(?:\n|$)", preamble, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            name = re.sub(r"\s*(?:CASE\s*NUMBER|FILE\s*NUMBER|DIBP\s*REF|PRESIDING|TRIBUNAL|MRT).*$", "", name, flags=re.IGNORECASE).strip()
            if name and not name.replace(" ", "").isdigit() and len(name) > 1:
                applicant_name = name
        # Try AATA structured "APPLICANT:\n\nName CASE NUMBER:" format
        m = RE_AATA_APPLICANT.search(preamble)
        if m and not applicant_name:
            name = m.group(1).strip()
            # Clean trailing "CASE NUMBER:" fragment
            name = re.sub(r"\s*CASE\s*NUMBER.*$", "", name, flags=re.IGNORECASE).strip()
            if name and not name.replace(" ", "").isdigit():
                applicant_name = name
        # Fallback: inline "Applicant: Name" on same line
        if not applicant_name:
            m = re.search(r"Applicant/?s?\s*:\s*(.+?)(?:\n|$)", preamble, re.IGNORECASE)
            if m:
                name = m.group(1).strip()
                # Clean trailing "CASE NUMBER:" or "File Number:" fragment
                name = re.sub(r"\s*(?:CASE\s*NUMBER|FILE\s*NUMBER|DIBP\s*REF).*$", "", name, flags=re.IGNORECASE).strip()
                # Skip if it's just a label fragment
                if name and len(name) > 2 and not name.replace(" ", "").isdigit():
                    applicant_name = name

    # If no respondent from title, try "Respondent:" field in text
    if not respondent and text:
        m = re.search(r"Respondent\s*:\s*(.+?)(?:\n|$)", text[:3000], re.IGNORECASE)
        if m:
            respondent = m.group(1).strip()

    # If no representative found, try AATA structured representative field
    if not representative and text:
        m = RE_AATA_REPRESENTATIVE.search(text[:5000])
        if m:
            rep_name = m.group(1).strip()
            if rep_name and not re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
                is_represented = "Yes"
                representative = rep_name
            elif re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
                is_represented = "No"

    return {
        "applicant_name": applicant_name,
        "respondent": respondent,
        "country_of_origin": country,
        "visa_subclass_number": visa_num,
        "hearing_date": hearing_date,
        "is_represented": is_represented,
        "representative": representative,
        "visa_outcome_reason": visa_outcome_reason,
        "legal_test_applied": legal_test_applied,
    }


# ── Main ─────────────────────────────────────────────────────────────────


def load_csv() -> list[dict]:
    """Load the immigration cases CSV."""
    if not CSV_PATH.exists():
        print(f"Error: {CSV_PATH} not found")
        sys.exit(1)

    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def backup_csv() -> Path | None:
    """Take one timestamped snapshot before a run's first write.

    The old fixed backup filename meant a second run's copy destroyed the
    first run's backup — the only surviving copy of a corpus that is
    gitignored and lives on one machine. A seconds-resolution stamp has the
    same failure in miniature: two runs started in the same second collide.
    Create the file exclusively (O_EXCL) so the name is proven free rather
    than assumed free.
    """
    if not CSV_PATH.exists():
        return None

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    for attempt in range(100):
        suffix = f".{attempt}" if attempt else ""
        backup_path = CSV_PATH.with_name(f"{CSV_PATH.name}.bak-{stamp}{suffix}")
        try:
            fd = os.open(str(backup_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        os.close(fd)
        shutil.copy2(CSV_PATH, backup_path)
        print(f"Backup saved to {backup_path}")
        return backup_path
    raise RuntimeError(f"could not find a free backup name for {CSV_PATH}")


def _union_fieldnames(rows: list[dict]) -> list[str]:
    """Header covering every key any row carries, in first-seen order.

    Raises if any row carries the csv.DictReader None restkey — see
    _assert_no_overflow_cells for why that is a hard stop rather than a
    dropped column.
    """
    names: list[str] = []
    seen: set = set()
    for row in rows:
        for key in row:
            if key is None:
                raise ValueError(
                    "row carries csv.DictReader's None restkey (overflow "
                    "cells); refusing to build a header that would discard it"
                )
            if key in seen:
                continue
            seen.add(key)
            names.append(key)
    return names


def _assert_no_overflow_cells(rows: list[dict]) -> None:
    """Fail before writing if any row has more cells than the header.

    csv.DictReader parks a long row's overflow cells under the None restkey.
    Dropping that key and writing with extrasaction="ignore" would delete
    those cells and then os.replace() the result over the master CSV — a
    loud, recoverable "this CSV is malformed" turned into silent data loss
    in a file that is gitignored and exists only on this machine. Refuse
    instead, and name the rows so the operator can look at them.
    """
    bad = [
        (index, row.get("case_id") or "?")
        for index, row in enumerate(rows)
        if None in row
    ]
    if not bad:
        return
    preview = ", ".join(f"row {i} (case_id={cid})" for i, cid in bad[:10])
    raise ValueError(
        f"{len(bad)} row(s) in {CSV_PATH} have more cells than the header — "
        f"{preview}{' …' if len(bad) > 10 else ''}. The source CSV is "
        f"malformed; nothing has been written. Fix or quarantine those rows "
        f"before re-running."
    )


def save_csv(rows: list[dict]):
    """Save rows back to CSV with an atomic replace.

    Deliberately does not back up: call backup_csv() once before the first
    save of a run, so periodic checkpoints do not litter the directory with
    one snapshot each.
    """
    if not rows:
        return

    _assert_no_overflow_cells(rows)
    fieldnames = _union_fieldnames(rows)

    # Per-process temp name: other writers of this file (storage.save_cases_csv,
    # download_fulltext.py) use "<path>.tmp" too, and two writers sharing one
    # temp path interleave into it before one of them replaces the master.
    tmp_path = CSV_PATH.with_name(f"{CSV_PATH.name}.tmp.{os.getpid()}")
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    os.replace(str(tmp_path), str(CSV_PATH))
    print(f"Saved {len(rows)} rows to {CSV_PATH}")


def _write_failure_manifest(case_ids: list[str]) -> Path | None:
    """List the rows whose extraction raised, so the run can be repeated.

    Without this, a swallowed worker exception exists only as one line on an
    interleaved stderr stream — which is not a record you can act on after a
    12-minute run over 149k rows.
    """
    if not case_ids:
        return None
    path = CSV_PATH.with_name(f"{CSV_PATH.name}.extraction-failures.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(case_ids) + "\n")
    print(f"{len(case_ids)} row(s) failed extraction; ids written to {path}")
    return path


def main():
    with catalog_lock(Path(CSV_PATH), "structured_fields"):
        parser = argparse.ArgumentParser(description="Extract structured fields from case texts")
        parser.add_argument("--dry-run", action="store_true", help="Preview without saving")
        parser.add_argument("--sample", type=int, default=0, help="Process N random cases")
        parser.add_argument("--court", type=str, default="", help="Filter by court code")
        parser.add_argument("--workers", type=int, default=8, help="Number of parallel workers")
        parser.add_argument(
            "--overwrite",
            action="store_true",
            help="Re-extract even if field already has a value (useful for fixing garbage values)",
        )
        args = parser.parse_args()

        all_rows = load_csv()
        print(f"Loaded {len(all_rows)} cases from CSV")
        _assert_no_overflow_cells(all_rows)

        # Determine which rows to process vs. save
        rows = all_rows

        # Filter
        if args.court:
            rows = [r for r in rows if (r.get("court_code") or "") == args.court]
            print(f"Filtered to {len(rows)} {args.court} cases")

        # Sample (only affects which rows to process, not what gets saved)
        if args.sample > 0:
            import random
            rows = random.sample(rows, min(args.sample, len(rows)))
            print(f"Sampled {len(rows)} cases")

        # Ensure new columns exist in ALL rows
        new_fields = [
            "applicant_name", "respondent", "country_of_origin",
            "visa_subclass_number", "hearing_date", "is_represented", "representative",
            "visa_outcome_reason", "legal_test_applied",
        ]
        for row in all_rows:
            for field in new_fields:
                if field not in row:
                    row[field] = ""
        # Also ensure in the working subset
        for row in rows:
            for field in new_fields:
                if field not in row:
                    row[field] = ""

        # Process cases
        stats = Counter()
        total = len(rows)

        print(f"Processing {total} cases with {args.workers} workers...")
        if args.overwrite:
            print("  (--overwrite: will re-extract all fields, including already-filled)")

        if not args.dry_run:
            backup_csv()

        failed_case_ids: list[str] = []

        with ProcessPoolExecutor(max_workers=args.workers) as executor:
            for completed, (row, extracted) in enumerate(
                zip(rows, executor.map(process_case, rows, chunksize=500))
            ):
                error = extracted.pop(EXTRACTION_ERROR_KEY, "")
                if error:
                    failed_case_ids.append(row.get("case_id") or "?")
                    stats["extraction_failures"] += 1

                for field, value in extracted.items():
                    if value:
                        if args.overwrite or not row.get(field):
                            row[field] = value
                            stats[f"{field}_extracted"] += 1
                        else:
                            stats["skipped_existing"] += 1

                if (completed + 1) % CHECKPOINT_EVERY == 0:
                    print(f"  Processed {completed + 1}/{total}...")
                    if not args.dry_run:
                        # `rows` holds the same dict objects as `all_rows` (the
                        # filter and random.sample both keep references, they do
                        # not copy), so writing all_rows persists everything the
                        # loop has mutated so far.
                        save_csv(all_rows)
                        _write_failure_manifest(failed_case_ids)
                        print(f"  Checkpoint written at {completed + 1}/{total}")

        # Summary
        print(f"\n{'='*60}")
        print("Extraction Summary")
        print(f"{'='*60}")
        print(f"Total processed: {total}")
        print(f"Skipped (existing): {stats.get('skipped_existing', 0)}")
        print(f"Extraction failures: {stats.get('extraction_failures', 0)}")
        print()
        for field in new_fields:
            key = f"{field}_extracted"
            count = stats.get(key, 0)
            pct = (count / total * 100) if total > 0 else 0
            print(f"  {field:25s}: {count:>6,} ({pct:5.1f}%)")

        # Fill rate summary (after extraction)
        print(f"\n{'='*60}")
        print("Fill Rates (processed rows after extraction)")
        print(f"{'='*60}")
        for field in new_fields:
            filled = sum(1 for r in rows if (r.get(field) or "").strip())
            pct = (filled / total * 100) if total > 0 else 0
            print(f"  {field:25s}: {filled:>7,} / {total:,} = {pct:5.1f}%")

        if args.dry_run:
            print("\nDry run — no changes saved.")
            # Show some samples
            print("\nSample extractions:")
            samples = [r for r in rows if r.get("applicant_name")][:5]
            for s in samples:
                print(
                    f"  {s.get('citation') or '?':30s} | "
                    f"{s.get('applicant_name') or '':20s} | "
                    f"{s.get('country_of_origin') or '':20s} | "
                    f"SC{s.get('visa_subclass_number') or '':>3s} | "
                    f"{s.get('is_represented') or ''}"
                )
        else:
            # Reload full CSV to merge (in case we filtered/sampled)
            if args.court or args.sample:
                all_rows = load_csv()
                # Ensure new columns in all rows
                for row in all_rows:
                    for f in new_fields:
                        if f not in row:
                            row[f] = ""
                # Build lookup by case_id
                extracted_map = {r["case_id"]: r for r in rows if r.get("case_id")}
                for row in all_rows:
                    cid = row.get("case_id") or ""
                    if cid in extracted_map:
                        src = extracted_map[cid]
                        for f in new_fields:
                            if src.get(f) and (args.overwrite or not row.get(f)):
                                row[f] = src[f]
                save_csv(all_rows)
                _write_failure_manifest(failed_case_ids)
            else:
                save_csv(rows)
                _write_failure_manifest(failed_case_ids)


if __name__ == "__main__":
    main()
