"""Command-line interface for the immigration case downloader."""

import argparse
import logging
import sys

from .config import AUSTLII_DATABASES, START_YEAR, END_YEAR, OUTPUT_DIR
from .sources.austlii import AustLIIScraper
from .sources.federal_court import FederalCourtScraper
from .storage import (
    ensure_output_dirs,
    load_all_cases,
    save_cases_csv,
    save_cases_json,
    save_case_text,
    generate_summary_report,
)

logger = logging.getLogger(__name__)


def setup_logging(verbose: bool = False):
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def cmd_search(args):
    """Search for immigration cases and save metadata."""
    ensure_output_dirs(args.output)
    all_cases = []

    # Search AustLII databases
    if "austlii" in args.sources or "all" in args.sources:
        austlii = AustLIIScraper(delay=args.delay)

        databases = args.databases
        if not databases or "all" in databases:
            databases = list(AUSTLII_DATABASES.keys())

        print(f"Searching AustLII databases: {', '.join(databases)}")
        print(f"Year range: {args.start_year} - {args.end_year}")
        print(f"Max results per database: {args.max_results}")
        print()

        cases = austlii.search_cases(
            databases=databases,
            start_year=args.start_year,
            end_year=args.end_year,
            max_results_per_db=args.max_results,
        )
        all_cases.extend(cases)
        print(f"Found {len(cases)} cases on AustLII")

    # Federal Court direct search is unavailable: search2.fedcourt.gov.au does
    # not resolve (see CLAUDE.md, "Federal Court DNS"). FCA judgments are
    # collected through AustLII instead. An explicit --sources fedcourt is a
    # hard error rather than a silent empty success, so automation notices.
    if "fedcourt" in args.sources:
        raise SystemExit(
            "Source 'fedcourt' is unavailable: search2.fedcourt.gov.au does not "
            "resolve. Federal Court judgments are available via AustLII — use "
            "--sources austlii --databases FCA."
        )

    if not all_cases:
        print("No cases found. Try adjusting search parameters.")
        return

    # Assign IDs to new cases
    for case in all_cases:
        case.ensure_id()

    # Merge with existing data (never overwrite)
    existing = load_all_cases(args.output)
    existing_urls = {c.url for c in existing}
    added = 0
    for case in all_cases:
        if case.url not in existing_urls:
            existing.append(case)
            existing_urls.add(case.url)
            added += 1

    # Save merged results
    csv_path = save_cases_csv(existing, args.output)
    json_path = save_cases_json(existing, args.output)
    report_path = generate_summary_report(existing, args.output)

    print(f"\nSearch found: {len(all_cases)} cases")
    print(f"New cases added: {added}")
    print(f"Already existed: {len(all_cases) - added}")
    print(f"Total in database: {len(existing)}")
    print(f"CSV saved to: {csv_path}")
    print(f"JSON saved to: {json_path}")
    print(f"Summary report: {report_path}")


def cmd_download(args):
    """Download full text of cases (requires prior search)."""
    from .storage import load_cases_csv
    from .models import ImmigrationCase

    ensure_output_dirs(args.output)

    # Load ALL cases (kept intact for saving back)
    case_records = load_cases_csv(args.output)
    if not case_records:
        print("No cases found. Run 'search' first to find cases.")
        return

    all_cases = [ImmigrationCase.from_dict(record) for record in case_records]

    # Select subset to download
    targets = list(all_cases)
    if args.courts:
        targets = [c for c in targets if c.court_code in args.courts]

    # Skip cases that already have full text on disk
    import os
    before_skip = len(targets)
    targets = [c for c in targets if not (c.full_text_path and os.path.exists(c.full_text_path))]
    skipped = before_skip - len(targets)
    if skipped:
        print(f"Skipping {skipped} cases that already have full text.")

    if args.limit:
        targets = targets[: args.limit]

    print(f"Downloading full text for {len(targets)} cases...")

    austlii = AustLIIScraper(delay=args.delay)
    fedcourt = FederalCourtScraper(delay=args.delay)

    downloaded = 0
    failed = 0

    for i, case in enumerate(targets):
        print(f"  [{i+1}/{len(targets)}] {case.citation or case.title[:60]}...", end=" ")

        try:
            if case.source == "Federal Court":
                text = fedcourt.download_case_detail(case)
            else:
                text = austlii.download_case_detail(case)

            if text:
                save_case_text(case, text, args.output)
                downloaded += 1
                print("OK")
            else:
                failed += 1
                print("FAILED (no content)")
        except Exception as e:
            failed += 1
            print(f"FAILED ({e})")
            logger.exception(f"Failed to download {case.url}")

    # Merge updated metadata from downloaded targets back into all_cases
    target_map = {c.case_id: c for c in targets}
    for c in all_cases:
        if c.case_id in target_map:
            t = target_map[c.case_id]
            for field in ("date", "judges", "catchwords", "outcome",
                          "visa_type", "legislation", "full_text_path"):
                val = getattr(t, field, "")
                if val:
                    setattr(c, field, val)

    # Save ALL cases (not just the downloaded subset)
    save_cases_csv(all_cases, args.output)
    save_cases_json(all_cases, args.output)

    print(f"\nDownloaded: {downloaded}, Failed: {failed}")


def cmd_list_databases(args):
    """List available court/tribunal databases."""
    print("Available AustLII Court/Tribunal Databases:")
    print("=" * 60)
    for code, info in AUSTLII_DATABASES.items():
        print(f"  {code:15s} {info['name']}")
        print(f"  {'':15s} {info['description']}")
        print()

    print("Other Sources:")
    print("=" * 60)
    print("  fedcourt       Federal Court of Australia Judgment Search")
    print("                 search2.fedcourt.gov.au — UNAVAILABLE (host does not")
    print("                 resolve); use AustLII database FCA instead")


def main():
    parser = argparse.ArgumentParser(
        description="Download and extract Australian immigration court and tribunal cases.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Search all sources for immigration cases (last 10 years)
  python -m immi_case_downloader search

  # Search only AAT and Federal Court
  python -m immi_case_downloader search --databases AATA FCA

  # Search with custom year range
  python -m immi_case_downloader search --start-year 2020 --end-year 2025

  # Download full case texts after searching
  python -m immi_case_downloader download

  # Download only Federal Court cases, limit to 50
  python -m immi_case_downloader download --courts FCA --limit 50

  # List available databases
  python -m immi_case_downloader list-databases
        """,
    )

    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable verbose logging"
    )
    parser.add_argument(
        "-o",
        "--output",
        default=OUTPUT_DIR,
        help=f"Output directory (default: {OUTPUT_DIR})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay between requests in seconds (default: 1.0)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Search command
    search_parser = subparsers.add_parser(
        "search", help="Search for immigration cases"
    )
    search_parser.add_argument(
        "--sources",
        nargs="+",
        default=["austlii"],
        choices=["all", "austlii", "fedcourt"],
        help="Sources to search (default: austlii). 'all' means AustLII only — "
             "'fedcourt' is unavailable (search2.fedcourt.gov.au does not resolve).",
    )
    search_parser.add_argument(
        "--databases",
        nargs="+",
        default=["all"],
        choices=["all"] + list(AUSTLII_DATABASES.keys()),
        help="AustLII databases to search (default: all)",
    )
    search_parser.add_argument(
        "--start-year",
        type=int,
        default=START_YEAR,
        help=f"Start year (default: {START_YEAR})",
    )
    search_parser.add_argument(
        "--end-year",
        type=int,
        default=END_YEAR,
        help=f"End year (default: {END_YEAR})",
    )
    search_parser.add_argument(
        "--max-results",
        type=int,
        default=500,
        help="Max results per database (default: 500)",
    )
    search_parser.set_defaults(func=cmd_search)

    # Download command
    download_parser = subparsers.add_parser(
        "download", help="Download full case texts"
    )
    download_parser.add_argument(
        "--courts",
        nargs="+",
        choices=list(AUSTLII_DATABASES.keys()),
        help="Filter by court code",
    )
    download_parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of cases to download",
    )
    download_parser.set_defaults(func=cmd_download)

    # List databases command
    list_parser = subparsers.add_parser(
        "list-databases", help="List available databases"
    )
    list_parser.set_defaults(func=cmd_list_databases)

    args = parser.parse_args()
    setup_logging(args.verbose)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
