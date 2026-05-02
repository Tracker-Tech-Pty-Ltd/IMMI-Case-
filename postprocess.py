#!/usr/bin/env python3
"""Post-processing script for immigration case data.

Run this after the download process completes to:
1. Generate stable case_id (SHA-256) for all records
2. Generate text_snippet from full text files
3. Extract catchwords from full text where missing
4. Fix full_text_path references
5. Report data quality statistics
"""

import csv
import hashlib
import os
import re
import sys
from pathlib import Path

DATA_DIR = "downloaded_cases"
CSV_PATH = os.path.join(DATA_DIR, "immigration_cases.csv")
TEXT_DIR = os.path.join(DATA_DIR, "case_texts")


def load_csv() -> list[dict]:
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_csv(rows: list[dict]):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def generate_case_ids(rows: list[dict]) -> int:
    """Generate SHA-256 case_id for records missing one."""
    count = 0
    for row in rows:
        if not row.get("case_id", "").strip():
            key = row.get("citation") or row.get("url") or row.get("title", "")
            row["case_id"] = hashlib.sha256(key.encode()).hexdigest()[:12]
            count += 1
    return count


def find_text_file(row: dict) -> str | None:
    """Find the text file for a case by matching citation or title."""
    citation = row.get("citation", "").strip()
    title = row.get("title", "").strip()

    if citation:
        safe_name = "".join(
            c if c.isalnum() or c in " -_[]" else "_" for c in citation
        ).strip()[:100]
        path = os.path.join(TEXT_DIR, f"{safe_name}.txt")
        if os.path.exists(path):
            return path

    if title:
        safe_name = "".join(
            c if c.isalnum() or c in " -_[]" else "_" for c in title
        ).strip()[:100]
        path = os.path.join(TEXT_DIR, f"{safe_name}.txt")
        if os.path.exists(path):
            return path

    return None


def fix_text_paths(rows: list[dict]) -> tuple[int, int]:
    """Fix full_text_path: verify existing, find missing."""
    fixed = 0
    found_new = 0
    for row in rows:
        path = row.get("full_text_path", "").strip()
        if path and os.path.exists(path):
            continue

        # Try to find the file
        text_path = find_text_file(row)
        if text_path:
            if not path:
                found_new += 1
            else:
                fixed += 1
            row["full_text_path"] = text_path

    return fixed, found_new


def read_case_text(path: str) -> str | None:
    """Read full text from a case file, skipping the header."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        # Skip the metadata header (Title:, Citation:, Court:, Date:, URL:, ===...)
        sep_idx = content.find("=" * 40)
        if sep_idx != -1:
            content = content[sep_idx:].lstrip("=").strip()
        return content
    except Exception:
        return None


def generate_text_snippets(rows: list[dict]) -> int:
    """Generate text_snippet from full text for records missing one."""
    count = 0
    for row in rows:
        if row.get("text_snippet", "").strip():
            continue

        path = row.get("full_text_path", "").strip()
        if not path or not os.path.exists(path):
            continue

        text = read_case_text(path)
        if not text:
            continue

        # Clean up text: remove navigation remnants
        lines = text.split("\n")
        content_lines = []
        skip_patterns = [
            "All Databases", "Cases & Legislation", "Journals & Scholarship",
            "Law Reform", "Treaties", "Libraries", "Communities", "LawCite",
            "Australia", "CTH", "ACT", "NSW", "NT", "QLD", "SA", "TAS",
            "VIC", "WA", "New Zealand", "Specific Year", "Any",
            "Print", "Print (pretty)", "Print (eco-friendly)", "Download",
            "RTF format", "Signed PDF", "Cited By", "LawCite records",
            "NoteUp references", "Join the discussion", "Tweet this page",
            "Follow @AustLII",
        ]
        for line in lines:
            line_stripped = line.strip()
            if line_stripped and line_stripped not in skip_patterns and len(line_stripped) > 3:
                content_lines.append(line_stripped)

        # Take first ~500 chars of meaningful content
        snippet = " ".join(content_lines)[:500].strip()
        if snippet:
            row["text_snippet"] = snippet
            count += 1

    return count


_JUDGE_PROSE_STOPWORDS = (
    " the ", " that ", " which ", " of the ", " was ", " were ",
    " when ", " where ", " applicant ", " tribunal ", " department ",
    " decision ", " hearing ", " evidence ", " visa ", " review ",
)
_JUDGE_BAD_TOKENS = {"date", "judge", "judges", "member", "members", "justice", "tribunal"}


def _looks_like_judge_name(s: str) -> bool:
    """Sanity-check an extracted judge name before storing.

    Rejects sentence-fragment garbage from greedy regex captures (the bug that
    let ~10% of `judges` rows fill with judgment prose). See
    docs/JUDGE_DATA_QUALITY.md for context.
    """
    if not s:
        return False
    s = s.strip()
    if not s or len(s) > 60:
        return False
    if not s[0].isupper():
        return False
    low = s.lower().strip(" .,;:")
    if low in _JUDGE_BAD_TOKENS:
        return False
    padded = " " + s.lower() + " "
    if any(stop in padded for stop in _JUDGE_PROSE_STOPWORDS):
        return False
    if any(ch in s for ch in "([–—"):  # en/em-dash, parens, brackets
        return False
    return True


def extract_metadata(rows: list[dict]) -> dict[str, int]:
    """Extract date, judges, outcome, visa_type, legislation from full text."""
    counts = {"date": 0, "judges": 0, "outcome": 0, "visa_type": 0, "legislation": 0}

    # Constrained patterns: capture only proper-noun-shaped candidates with
    # word boundaries. Old greedy `[^\n]+` form was rejected — see
    # docs/JUDGE_DATA_QUALITY.md.
    judge_patterns = [
        r"(?:Judge\(s\)|JUDGES?|JUSTICE|TRIBUNAL\s+MEMBERS?)\b\s*[:\-]\s*"
        r"([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,4}(?:\s+J)?)\b",
        r"(?:Before|Coram)\b\s*[:\-]\s*"
        r"([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,4}(?:\s+J)?)\b",
    ]
    date_patterns = [
        r"(?:Date of (?:decision|hearing|judgment|order))[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
        r"(?:Decision date|Judgment date|Date of judgment)[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
        r"DATE[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
        r"(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    ]
    outcome_patterns = [
        # AATA: "DECISION:\nThe Tribunal remits/affirms/sets aside/does not have..."
        r"DECISION:\s*\n?\s*(The Tribunal[^\n]*(?:\n[^\n]*){0,3})",
        # AATA: "The decision under review is affirmed/set aside/remitted"
        r"(The decision under review is \w+[^\n]*)",
        # AATA: "decision affirmed/set aside"
        r"(decision\s+(?:affirmed|set aside|remitted|varied)[^\n]*)",
        # AATA: "affirm the decision" / "set aside the decision"
        r"((?:affirm|set aside|remit|vary)\s+the\s+decision[^\n]*)",
        # FCA/FCCA: "ORDERS" with numbered items (1) (2)...
        r"ORDERS?\s*\n((?:\(\d+\)[^\n]*\n?){1,6})",
        # FCA/FCCA: "ORDER/ORDERS/THE COURT ORDERS" block
        r"(?:ORDERS?|THE COURT ORDERS)[:\s]*\n?(.*?)(?:\n\s*\n)",
        # Inline tribunal/court decisions
        r"(The Tribunal\s+(?:affirms|remits|sets aside|does not have jurisdiction)[^\n]*)",
        r"(The (?:Tribunal|Court)\s+(?:dismisses|allows|refuses|grants)[^\n]*)",
        # FCA/FCCA dismissal/allowance
        r"((?:The )?[Aa]ppeal\s+(?:is|be)\s+(?:dismissed|allowed)[^\n]*)",
        r"((?:The )?[Aa]pplication[^\n]*(?:is|be|must be)\s+(?:dismissed|refused|allowed|granted)[^\n]*)",
        # "accordingly, dismissed/refused/allowed" (FedCFamC2G end of judgment)
        r"(accordingly[,.]?\s*(?:dismissed|refused|allowed|granted|remitted)[^\n]*)",
        # "I would dismiss/allow" (HCA/FCA)
        r"(I would (?:dismiss|allow|grant|refuse)[^\n]*)",
        r"(I (?:dismiss|allow|grant|refuse) the[^\n]*)",
        # "must be dismissed/refused"
        r"([^\n]*must be (?:dismissed|refused|allowed|granted)[^\n]*)",
        # Writ patterns (HCA)
        r"((?:writs?|relief)\s+(?:of\s+)?\w+\s+(?:issue|refused|granted)[^\n]*)",
    ]
    visa_pattern = (
        r"((?:protection|skilled|partner|student|visitor|bridging|"
        r"temporary|permanent|subclass\s+\d+|class\s+[A-Z]{2})\s*"
        r"(?:\([^)]*\)\s*)?visa)"
    )
    # Subclass NNN (Name) format
    visa_pattern_subclass = r"[Ss]ubclass\s+(\d+)\s*\(?([A-Za-z][A-Za-z ]*?)\)?"
    # Class XX with description: "Business Entry (Class UC)"
    visa_pattern_class = r"(\w[\w ]+?)\s*\(Class\s+([A-Z]{2})\)\s*visas?"
    # Citizenship cases (from title)
    citizenship_pattern = r"\(Citizenship\)"
    # Character cancellation s.501
    character_pattern = r"(?:s\.?\s*501|section\s*501|character (?:test|cancellation|ground))"
    legislation_patterns = [
        r"(Migration Act 1958[^.\n]*)",
        r"(Migration Regulations 1994[^.\n]*)",
        r"(Citizenship Act 2007[^.\n]*)",
        r"(Migration Amendment[^.\n]*Act[^.\n]*)",
    ]

    for row in rows:
        path = row.get("full_text_path", "").strip()
        if not path or not os.path.exists(path):
            continue

        # Skip if all fields already filled
        needs = [f for f in counts if not row.get(f, "").strip()]
        if not needs:
            continue

        text = read_case_text(path)
        if not text:
            continue

        # Extract judges (with sanity check — rejects sentence-fragment garbage)
        if not row.get("judges", "").strip():
            for pattern in judge_patterns:
                # Find all matches in text, accept first one passing validation
                accepted = None
                for m in re.finditer(pattern, text, re.IGNORECASE):
                    candidate = m.group(1).strip()
                    if _looks_like_judge_name(candidate):
                        accepted = candidate
                        break
                if accepted:
                    row["judges"] = accepted
                    counts["judges"] += 1
                    break

        # Extract date
        if not row.get("date", "").strip():
            for pattern in date_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    row["date"] = match.group(1).strip()
                    counts["date"] += 1
                    break

        # Extract outcome
        if not row.get("outcome", "").strip():
            for pattern in outcome_patterns:
                match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
                if match:
                    outcome_text = match.group(0).strip()[:300]
                    # Filter out false positives (header lines, etc.)
                    if len(outcome_text) > 10:
                        row["outcome"] = outcome_text
                        counts["outcome"] += 1
                        break
            # Last resort: check last 1500 chars for "review should be affirmed/dismissed"
            if not row.get("outcome", "").strip():
                tail = text[-1500:]
                m = re.search(
                    r"((?:review|appeal|application)\s+(?:should be|is hereby|is|be)\s+"
                    r"(?:affirmed|dismissed|allowed|refused|remitted|set aside|upheld)[^\n]*)",
                    tail, re.IGNORECASE
                )
                if m:
                    row["outcome"] = m.group(1).strip()[:300]
                    counts["outcome"] += 1

        # Extract visa type
        if not row.get("visa_type", "").strip():
            title = row.get("title", "")
            match = re.search(visa_pattern, text, re.IGNORECASE)
            if match:
                row["visa_type"] = match.group(1).strip()
                counts["visa_type"] += 1
            else:
                # Try Subclass NNN (Name) pattern
                match = re.search(visa_pattern_subclass, text)
                if match:
                    row["visa_type"] = f"Subclass {match.group(1)} ({match.group(2).strip()})"
                    counts["visa_type"] += 1
                else:
                    # Try Class XX with description
                    match = re.search(visa_pattern_class, text, re.IGNORECASE)
                    if match:
                        row["visa_type"] = f"{match.group(1).strip()} (Class {match.group(2)})"
                        counts["visa_type"] += 1
                    elif re.search(citizenship_pattern, title):
                        row["visa_type"] = "Citizenship"
                        counts["visa_type"] += 1
                    elif re.search(character_pattern, text, re.IGNORECASE):
                        row["visa_type"] = "Character cancellation (s.501)"
                        counts["visa_type"] += 1
                    else:
                        # Try "refuse to grant ... (Class XX)" or "grant ... visa"
                        m = re.search(r"(?:grant|refuse)[^\n]{0,60}((?:Class\s+[A-Z]{2})[^\n]{0,30})", text, re.IGNORECASE)
                        if m:
                            row["visa_type"] = m.group(1).strip()[:80]
                            counts["visa_type"] += 1
                        elif "(Migration)" in title:
                            row["visa_type"] = "Migration (general)"
                            counts["visa_type"] += 1
                        elif "(Refugee)" in title:
                            row["visa_type"] = "Refugee/Protection"
                            counts["visa_type"] += 1
                        elif re.search(r"refug|protection claim|complementary protection", text, re.IGNORECASE):
                            row["visa_type"] = "Refugee/Protection"
                            counts["visa_type"] += 1
                        elif re.search(r"judicial review|migration review tribunal|refugee review tribunal", text, re.IGNORECASE):
                            row["visa_type"] = "Judicial review (migration)"
                            counts["visa_type"] += 1

        # Extract legislation
        if not row.get("legislation", "").strip():
            leg_refs = []
            for pattern in legislation_patterns:
                matches = re.findall(pattern, text, re.IGNORECASE)
                leg_refs.extend(matches[:2])
            if leg_refs:
                row["legislation"] = "; ".join(leg_refs)[:300]
                counts["legislation"] += 1

    return counts


def extract_catchwords(rows: list[dict]) -> int:
    """Extract catchwords from full text for records missing them."""
    count = 0
    patterns = [
        r"CATCHWORDS[:\s]*\n?(.*?)(?=\n\s*\n|\nLEGISLATION|\nCASES|\nORDER|\nAPPLICANT)",
        r"Catchwords[:\s]*\n?(.*?)(?=\n\s*\n|\nLegislation|\nCases|\nOrder)",
        r"KEY WORDS?[:\s]*\n?(.*?)(?=\n\s*\n)",
        # AATA DECISION RECORD: extract from DIVISION line
        r"DIVISION:\s*\n?\s*(Migration[^\n]*)",
    ]

    for row in rows:
        if row.get("catchwords", "").strip():
            continue

        path = row.get("full_text_path", "").strip()
        if not path or not os.path.exists(path):
            continue

        text = read_case_text(path)
        if not text:
            continue

        # Check for explicit "No Catchwords"
        if re.search(r"(?:Category|Catchwords)[:\s]*\n?\s*No Catchwords", text, re.IGNORECASE):
            row["catchwords"] = "No Catchwords"
            count += 1
            continue

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
            if match:
                catchwords = match.group(1).strip()
                if catchwords and len(catchwords) > 5:
                    row["catchwords"] = catchwords[:500]
                    count += 1
                    break

    return count


def report_stats(rows: list[dict]):
    """Print data quality statistics."""
    total = len(rows)
    fields = [
        "case_id", "citation", "title", "court", "court_code", "date",
        "year", "url", "judges", "catchwords", "outcome", "visa_type",
        "legislation", "text_snippet", "full_text_path", "source",
    ]

    print(f"\n{'='*60}")
    print(f"DATA QUALITY REPORT — {total} total records")
    print(f"{'='*60}")
    print(f"{'Field':<20} {'Filled':>8} {'%':>8}")
    print(f"{'-'*36}")

    for field in fields:
        filled = sum(1 for r in rows if r.get(field, "").strip())
        pct = (filled / total * 100) if total else 0
        marker = " ***" if pct < 50 else ""
        print(f"{field:<20} {filled:>8} {pct:>7.1f}%{marker}")

    # Count text files
    with_text = sum(
        1 for r in rows
        if r.get("full_text_path", "").strip()
        and os.path.exists(r.get("full_text_path", ""))
    )
    print(f"\nFull text files verified: {with_text}/{total} ({with_text/total*100:.1f}%)")

    # Year distribution
    by_year: dict[int, int] = {}
    for r in rows:
        try:
            y = int(r.get("year", 0))
            if y:
                by_year[y] = by_year.get(y, 0) + 1
        except (ValueError, TypeError):
            pass

    print(f"\nYear Distribution:")
    for y in sorted(by_year):
        bar = "#" * (by_year[y] // 50)
        print(f"  {y}: {by_year[y]:>5}  {bar}")


def main():
    print("Loading CSV data...")
    rows = load_csv()
    print(f"Loaded {len(rows)} records")

    print("\n[1/5] Generating case_id...")
    n = generate_case_ids(rows)
    print(f"  Generated {n} new case_ids")

    print("\n[2/5] Fixing full_text_path references...")
    fixed, found = fix_text_paths(rows)
    print(f"  Fixed {fixed} broken paths, found {found} new paths")

    print("\n[3/5] Generating text_snippet from full text...")
    n = generate_text_snippets(rows)
    print(f"  Generated {n} new text snippets")

    print("\n[4/6] Extracting catchwords from full text...")
    n = extract_catchwords(rows)
    print(f"  Extracted {n} new catchwords")

    print("\n[5/6] Extracting metadata (date, judges, outcome, visa_type, legislation)...")
    meta_counts = extract_metadata(rows)
    for field, count in meta_counts.items():
        print(f"  {field}: {count} new")

    print("\n[6/6] Saving updated data...")
    save_csv(rows)
    print(f"  Saved to {CSV_PATH}")

    # Also update JSON
    import json
    json_path = os.path.join(DATA_DIR, "immigration_cases.json")
    data = {
        "total_cases": len(rows),
        "courts": sorted({r.get("court", "") for r in rows if r.get("court")}),
        "year_range": {
            "min": min((int(r["year"]) for r in rows if r.get("year") and str(r["year"]) != "0"), default=0),
            "max": max((int(r["year"]) for r in rows if r.get("year") and str(r["year"]) != "0"), default=0),
        },
        "cases": rows,
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved to {json_path}")

    report_stats(rows)


if __name__ == "__main__":
    main()
