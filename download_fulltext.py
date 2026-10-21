"""
Bulk download full text for cases missing full_text_path.
Also retries AATA 2025-2026 crawling.

Usage: python download_fulltext.py
Progress saved every 200 cases. Safe to interrupt and resume.
"""

import sys
import os
import shutil
import time
from pathlib import Path
import pandas as pd
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from immi_case_downloader.sources.austlii import AustLIIScraper
from immi_case_downloader.config import AUSTLII_DATABASES, IMMIGRATION_KEYWORDS
from immi_case_downloader.csv_write_lock import csv_write_lock
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import save_case_text

CSV_PATH = "downloaded_cases/immigration_cases.csv"
DELAY = 0.5
SAVE_EVERY = 200  # Save CSV every N downloads
LOG_FILE = "downloaded_cases/download_progress.log"


def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


_backup_taken = False


def _new_backup_path() -> str:
    """A backup path nothing else can be holding.

    A plain seconds-resolution stamp is not enough: two runs started in the
    same second write the same name and the second silently destroys the
    first's copy of a 149k-row corpus that exists only on this machine. Create
    the file exclusively (O_EXCL) and bump a suffix on collision, so the name
    is proven free rather than assumed free.
    """
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    for attempt in range(100):
        candidate = f"{CSV_PATH}.bak-{stamp}" + (f".{attempt}" if attempt else "")
        try:
            fd = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        os.close(fd)
        return candidate
    raise RuntimeError(f"could not find a free backup name for {CSV_PATH}")


def _write_csv_atomic(df):
    """Write *df* over the master CSV atomically, after a one-time run backup.

    The module docstring promises this script is safe to interrupt, but the
    three writes it performs used to land straight on the 149k-row master file.
    Matches the tmp-then-os.replace pattern in
    immi_case_downloader/storage.save_cases_csv.
    """
    global _backup_taken
    if not _backup_taken and os.path.exists(CSV_PATH):
        backup = _new_backup_path()
        shutil.copy2(CSV_PATH, backup)
        log(f"  Backup: {backup}")
        _backup_taken = True
    # Per-process temp name: storage.save_cases_csv writes
    # "<CSV_PATH>.tmp" too, and two writers sharing one temp path interleave
    # into the same file and then os.replace() the mixture over the master.
    tmp = f"{CSV_PATH}.tmp.{os.getpid()}"
    with csv_write_lock(CSV_PATH):
        df.to_csv(tmp, index=False)
        os.replace(tmp, CSV_PATH)


def retry_recent_crawl(scraper, df_existing):
    """Retry crawling AATA 2025-2026 and ARTA 2024-2026."""
    log("=" * 60)
    log("PHASE 0: Retry ARTA + recent court year crawling")
    log("=" * 60)

    existing_urls = set(df_existing["url"].dropna().astype(str).tolist())
    new_cases = []

    targets = [
        ("ARTA", [2024, 2025, 2026]),
        ("FCA", [2025, 2026]),
        ("FedCFamC2G", [2025, 2026]),
        ("HCA", [2025, 2026]),
    ]

    for db_code, years in targets:
        if db_code not in AUSTLII_DATABASES:
            log(f"  {db_code} not in config, skipping")
            continue
        for year in years:
            try:
                log(f"  Trying {db_code} {year}...")
                cases = scraper._browse_year(
                    db_code, AUSTLII_DATABASES[db_code], year, IMMIGRATION_KEYWORDS
                )
                fresh = [c for c in cases if c.url not in existing_urls]
                for c in fresh:
                    c.ensure_id()
                    existing_urls.add(c.url)
                new_cases.extend(fresh)
                log(f"  {db_code} {year}: {len(cases)} found, {len(fresh)} new")
            except Exception as e:
                log(f"  {db_code} {year}: ERROR - {e}")

    if new_cases:
        from immi_case_downloader.ingestion import append_discovered_cases
        added = append_discovered_cases(new_cases, Path(CSV_PATH).parent)
        df_merged = pd.read_csv(CSV_PATH, encoding="utf-8-sig",
                                dtype={"visa_subclass": str, "visa_subclass_number": str}, low_memory=False)
        log(f"  Added {added} new cases. Total: {len(df_merged)}")
        return df_merged
    else:
        log("  No new cases found")
        return df_existing


def download_missing_fulltext(scraper, df):
    """Download full text for all cases missing full_text_path."""
    log("=" * 60)
    log("PHASE 1: Download full text for cases without full_text_path")
    log("=" * 60)

    # Find cases needing download
    from immi_case_downloader.csv_repository import CsvRepository
    from immi_case_downloader.ingestion import persist_downloads, record_case_evidence
    from immi_case_downloader.extraction.grounded import assess_case
    base = str(Path(CSV_PATH).parent)
    scraper.source_cache_dir = base
    repo = CsvRepository(base)
    originals = {str(row["case_id"]): ImmigrationCase.from_dict(row.to_dict()).to_dict() for _, row in df.iterrows()}
    completed = []
    mask = ~df["full_text_path"].apply(lambda value: isinstance(value, str) and bool(value.strip()) and os.path.isfile(value))
    indices = df.index[mask].tolist()
    total = len(indices)
    log(f"Cases needing full text download: {total}")

    if total == 0:
        log("Nothing to download!")
        return

    downloaded = 0
    failed = 0
    skipped = 0
    start_time = time.time()

    for batch_num, idx in enumerate(indices):
        row = df.loc[idx]
        case = ImmigrationCase.from_dict(row.to_dict())

        # Skip if file already exists on disk (resume support)
        if case.full_text_path and os.path.exists(case.full_text_path):
            skipped += 1
            continue

        # Also check if a file with this citation already exists
        if case.citation:
            filename = "".join(
                c if c.isalnum() or c in " -_[]" else "_" for c in case.citation
            )
            filename = filename.strip()[:100] + ".txt"
            candidate = os.path.join(base, "case_texts", filename)
            if os.path.exists(candidate):
                raw = Path(candidate).read_text(encoding="utf-8-sig")
                decision = assess_case(raw, citation=case.citation, title=case.title, url=case.url)
                from immi_case_downloader.ingestion import reusable_source
                if reusable_source(raw, decision):
                    case.full_text_path = candidate
                    record_case_evidence(case, base)
                    df.at[idx, "full_text_path"] = candidate
                    completed.append(case)
                    skipped += 1
                    if len(completed) >= SAVE_EVERY:
                        persist_downloads(repo, completed, originals, base)
                        completed.clear()
                    continue

        try:
            text = scraper.download_case_detail(case)

            if text:
                filepath = save_case_text(case, text, base)
                completed.append(case)
                df.at[idx, "full_text_path"] = filepath

                # Also update extracted metadata
                for field in ("date", "judges", "catchwords", "outcome",
                              "visa_type", "legislation", "citation"):
                    val = getattr(case, field, "")
                    if val and str(val) != "nan":
                        df.at[idx, field] = val

                downloaded += 1
            else:
                failed += 1

        except Exception as e:
            failed += 1
            if (downloaded + failed) % 50 == 0:
                log(f"  Error on {case.url}: {e}")

        # Progress reporting
        done = downloaded + failed + skipped
        if done % 100 == 0 and done > 0:
            elapsed = time.time() - start_time
            rate = (downloaded + failed) / elapsed if elapsed > 0 else 0
            eta_seconds = (total - done) / rate if rate > 0 else 0
            eta_hours = eta_seconds / 3600
            log(
                f"  Progress: {done}/{total} "
                f"(DL: {downloaded}, fail: {failed}, skip: {skipped}) "
                f"| {rate:.1f}/s | ETA: {eta_hours:.1f}h"
            )

        # Periodic save
        if (downloaded + failed) > 0 and (downloaded + failed) % SAVE_EVERY == 0:
            persist_downloads(repo, completed, originals, base)
            completed.clear()
            log(f"  [Checkpoint saved at {downloaded + failed} downloads]")

    # Final save
    persist_downloads(repo, completed, originals, base)

    elapsed = time.time() - start_time
    log(f"\nDONE! Downloaded: {downloaded}, Failed: {failed}, Skipped: {skipped}")
    log(f"Total time: {elapsed/3600:.1f} hours")


def main():
    log("=" * 60)
    log("IMMI-Case Full Text Downloader")
    log(f"Started at {datetime.now()}")
    log("=" * 60)

    # Load CSV
    df = pd.read_csv(
        CSV_PATH,
        encoding="utf-8-sig",
        dtype={"visa_subclass": str, "visa_subclass_number": str},
        low_memory=False,
    )
    log(f"Loaded {len(df)} records from CSV")

    # Create scraper
    scraper = AustLIIScraper(delay=DELAY)
    log(f"Scraper initialized with delay={DELAY}s")

    # Phase 0: Retry AATA 2025-2026 + ARTA 2024-2026
    df = retry_recent_crawl(scraper, df)

    # Phase 1: Download missing full text
    download_missing_fulltext(scraper, df)

    log(f"\nAll done at {datetime.now()}")


if __name__ == "__main__":
    main()
