#!/usr/bin/env python3
"""
Validate extraction quality for structured fields.

Shows fill rates by field and court, checks for garbage values,
and samples examples for spot-checking.

Usage:
    python validate_extraction.py
    python validate_extraction.py --court AATA
    python validate_extraction.py --field country_of_origin
    python validate_extraction.py --compare-to baseline.csv
"""

import argparse
import csv
import re
from collections import Counter
from pathlib import Path

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

STRUCTURED_FIELDS = [
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
    "visa_outcome_reason",
    "legal_test_applied",
]

# Known garbage patterns for country_of_origin
COUNTRY_GARBAGE_PATTERNS = [
    re.compile(r"MEMBER\s*:", re.IGNORECASE),
    re.compile(r"CASE\s+NUMBER\s*:", re.IGNORECASE),
    re.compile(r"HOME\s+AFFAIRS\s*:", re.IGNORECASE),
    re.compile(r"TRIBUNAL\s+MEMBER\s*:", re.IGNORECASE),
    re.compile(r":\s*$"),
]


def load_csv(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def is_garbage_country(val: str) -> bool:
    if not val:
        return False
    for pat in COUNTRY_GARBAGE_PATTERNS:
        if pat.search(val):
            return True
    if len(val) > 60:
        return True
    return False


def print_fill_rates(rows: list[dict], court_filter: str = "", label: str = ""):
    total = len(rows)
    if court_filter:
        rows = [r for r in rows if (r.get("court_code") or "") == court_filter]
        total = len(rows)

    if not rows:
        print(f"\n{'='*70}")
        print(f"No rows match{' court ' + court_filter if court_filter else ''}")
        print(f"{'='*70}")
        return

    title = f"Fill Rates{' — ' + label if label else ''}{' (' + court_filter + ')' if court_filter else ''}"
    print(f"\n{'='*70}")
    print(title)
    print(f"{'='*70}")
    print(f"Total cases: {total:,}")
    print()

    for field in STRUCTURED_FIELDS:
        if field not in rows[0]:
            print(f"  {field:30s}: (field not in CSV)")
            continue
        filled = sum(1 for r in rows if (r.get(field) or "").strip())
        pct = filled / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        print(f"  {field:30s}: {filled:>8,} / {total:,} = {pct:5.1f}% {bar}")


def print_court_breakdown(rows: list[dict]):
    courts = sorted(set(r.get("court_code") or "?" for r in rows))
    print(f"\n{'='*70}")
    print("Fill Rates by Court")
    print(f"{'='*70}")
    header = f"{'Court':<15} {'Total':>7} {'Country':>8} {'IsRep':>8} {'Rep':>8} {'Outcome':>8} {'LTest':>8}"
    print(header)
    print("-" * 70)

    for court in courts:
        court_rows = [r for r in rows if (r.get("court_code") or "") == court]
        total = len(court_rows)
        if total == 0:
            continue

        def pct(field: str) -> str:
            n = sum(1 for r in court_rows if (r.get(field) or "").strip())
            return f"{n/total*100:.0f}%"

        print(
            f"{court:<15} {total:>7,} {pct('country_of_origin'):>8} "
            f"{pct('is_represented'):>8} {pct('representative'):>8} "
            f"{pct('visa_outcome_reason'):>8} {pct('legal_test_applied'):>8}"
        )


def check_garbage_values(rows: list[dict]):
    print(f"\n{'='*70}")
    print("Garbage Value Check")
    print(f"{'='*70}")

    # Country garbage
    garbage_country = [r for r in rows if is_garbage_country(r.get("country_of_origin") or "")]
    print(f"\ncountry_of_origin garbage values: {len(garbage_country)}")
    if garbage_country:
        for r in garbage_country[:5]:
            print(f"  [{r.get('citation','')}]: {repr(r.get('country_of_origin','')[:60])}")

    # is_represented non-standard values
    rep_values = Counter(r.get("is_represented", "") for r in rows)
    non_standard = {k: v for k, v in rep_values.items() if k not in ("Yes", "No", "")}
    if non_standard:
        print(f"\nis_represented non-standard values: {non_standard}")
    else:
        valid_rep = {k: v for k, v in rep_values.items()}
        print(f"\nis_represented values: {dict(sorted(valid_rep.items()))}")

    # Country value lengths
    long_countries = [r for r in rows if len(r.get("country_of_origin") or "") > 50]
    if long_countries:
        print(f"\nLong country values (>50 chars): {len(long_countries)}")
        for r in long_countries[:3]:
            print(f"  {repr(r.get('country_of_origin','')[:80])}")


def sample_values(rows: list[dict], field: str, n: int = 15):
    print(f"\n{'='*70}")
    print(f"Sample values: {field}")
    print(f"{'='*70}")

    filled = [r for r in rows if (r.get(field) or "").strip()]
    if not filled:
        print("  (no values)")
        return

    import random
    random.seed(42)
    sample = random.sample(filled, min(n, len(filled)))

    for r in sample:
        print(f"  [{r.get('court_code','?')}] {r.get('citation','?'):35s} → {repr(r.get(field,'')[:80])}")


def compare_to_baseline(current: list[dict], baseline_path: Path) -> bool:
    """Compare ``current`` against a baseline CSV. Returns False on data loss.

    Fails closed on rows that vanished. The per-field loop below can only see
    a case_id that is present in *both* files, so a row deleted outright — the
    worst outcome an extraction run can produce, and the one a bulk UPDATE
    accident actually causes — contributed nothing to the regression count and
    printed "Total regressions: 0" while tens of thousands of cases were gone.
    """
    baseline = load_csv(baseline_path)
    baseline_map = {r["case_id"]: r for r in baseline if r.get("case_id")}

    if not current:
        print("No current rows to compare.")
        # An empty current file against a non-empty baseline is total loss,
        # not "nothing to say".
        return not baseline_map

    print(f"\n{'='*70}")
    print(f"Comparison: Current vs {baseline_path.name}")
    print(f"{'='*70}")

    current_ids = [r.get("case_id") or "" for r in current]
    current_id_set = {cid for cid in current_ids if cid}
    removed = sorted(baseline_map.keys() - current_id_set)
    added = sorted(current_id_set - baseline_map.keys())
    duplicates = sorted(
        cid for cid, n in Counter(cid for cid in current_ids if cid).items() if n > 1
    )
    blank_ids = sum(1 for cid in current_ids if not cid)

    print(f"\n  rows: {len(baseline):,} baseline → {len(current):,} current")
    print(f"  case_ids removed : {len(removed):,}")
    print(f"  case_ids added   : {len(added):,}")
    print(f"  duplicate ids    : {len(duplicates):,}")
    print(f"  blank ids        : {blank_ids:,}")
    for cid in removed[:5]:
        row = baseline_map[cid]
        print(f"    - removed {cid} [{row.get('citation', '')}]")
    if len(removed) > 5:
        print(f"    - ...and {len(removed) - 5:,} more")

    regressions = 0
    improvements = 0

    for field in STRUCTURED_FIELDS:
        if field not in current[0]:
            continue

        prev_filled = sum(
            1 for r in current
            if (baseline_map.get(r.get("case_id") or "", {}).get(field) or "").strip()
        )
        curr_filled = sum(1 for r in current if (r.get(field) or "").strip())

        # Check regressions (field was filled in baseline but empty now)
        reg = 0
        imp = 0
        for r in current:
            cid = r.get("case_id") or ""
            baseline_val = baseline_map.get(cid, {}).get(field) or ""
            curr_val = r.get(field) or ""
            if baseline_val.strip() and not curr_val.strip():
                reg += 1
            elif not baseline_val.strip() and curr_val.strip():
                imp += 1

        regressions += reg
        improvements += imp

        delta = curr_filled - prev_filled
        sign = "+" if delta >= 0 else ""
        print(f"  {field:30s}: {prev_filled:>7,} → {curr_filled:>7,} ({sign}{delta:,}) | reg:{reg} imp:{imp}")

    # A removed row lost every field it had filled. Counting those alongside
    # the field-level regressions keeps a deletion from reading as an
    # improvement just because the surviving rows got better.
    removed_field_losses = sum(
        1
        for cid in removed
        for field in STRUCTURED_FIELDS
        if (baseline_map[cid].get(field) or "").strip()
    )
    regressions += removed_field_losses

    print(
        f"\nTotal regressions: {regressions} "
        f"({removed_field_losses} from {len(removed):,} removed rows), "
        f"improvements: {improvements}"
    )

    if removed or duplicates or blank_ids:
        print(
            "\nFAIL: the current CSV is not a superset of the baseline "
            f"({len(removed):,} removed, {len(duplicates):,} duplicate, "
            f"{blank_ids:,} blank ids)."
        )
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="Validate extraction quality")
    parser.add_argument("--court", type=str, default="", help="Filter by court code")
    parser.add_argument("--field", type=str, default="", help="Sample values for specific field")
    parser.add_argument("--compare-to", type=str, default="", help="Compare to baseline CSV")
    args = parser.parse_args()

    rows = load_csv(CSV_PATH)
    print(f"Loaded {len(rows):,} cases from {CSV_PATH}")

    print_fill_rates(rows, court_filter=args.court)

    if not args.court:
        print_court_breakdown(rows)
        check_garbage_values(rows)

    if args.field:
        sample_values(rows, args.field)
    else:
        # Sample key fields
        for field in ["country_of_origin", "is_represented", "visa_outcome_reason", "legal_test_applied"]:
            if rows and field in rows[0]:
                sample_values(rows, field, n=8)

    if args.compare_to:
        if not compare_to_baseline(rows, Path(args.compare_to)):
            # Exit non-zero so a caller that pipes this into a release gate
            # actually stops. Printing the loss and exiting 0 is how a
            # validator becomes decorative.
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
