"""
Reformat AustLII case text files for better readability.

Rules (preserves all original words):
1. Rejoin lines broken mid-sentence into flowing paragraphs
2. Add blank lines before section headings (INTRODUCTION, BACKGROUND, etc.)
3. Add blank lines before paragraph numbers [1], [2], etc.
4. Keep the metadata header (first 6 lines) intact
5. Separate the AustLII navigation boilerplate from case content

Pass 2 — fix_artifacts (--fix-artifacts flag):
6. Fix Last Updated line merged with content
7. Merge orphan punctuation back to preceding line
8. Merge citation semicolons (parallel citations)
9. Rejoin section/subsection number splits
10. Merge jurisdiction fragments like (Cth), (NSW) on their own line
11. Fix bold-inside-parentheses artifacts like (\\n\\nCCO\\n\\n)
12. Fix inline bold artifacts (mid-sentence bold words isolated by blank lines)
13. Fix split citations [YYYY]\\n\\nCOURT NNN
14. Fix parallel citation page numbers NNN CLR\\n\\nNNN

Usage:
    python reformat_case_text.py --batch 0 --total-batches 10
    python reformat_case_text.py --single path/to/file.txt
    python reformat_case_text.py --fix-artifacts --single path/to/file.txt
    python reformat_case_text.py --fix-artifacts --batch 0 --total-batches 10
"""

import argparse
import json
import os
import re
import sys

# Section headings commonly found in AustLII decisions
SECTION_HEADINGS = {
    "INTRODUCTION", "BACKGROUND", "FACTS", "FINDINGS", "CONSIDERATION",
    "DECISION", "REASONS", "REASONS FOR DECISION", "ORDER", "ORDERS",
    "THE ISSUES", "THE ISSUE", "LEGISLATION", "STATUTORY FRAMEWORK",
    "JURISDICTION", "EVIDENCE", "SUBMISSIONS", "SUBMISSION",
    "APPLICANT'S CASE", "APPLICANT'S CLAIMS", "APPLICANT'S SUBMISSIONS",
    "RESPONDENT'S CASE", "RESPONDENT'S SUBMISSIONS",
    "CONCLUSION", "CONCLUSIONS", "SUMMARY", "COSTS", "RELIEF",
    "CATCHWORDS", "GROUNDS OF REVIEW", "GROUND OF REVIEW",
    "STATEMENT OF REASONS", "VISA SUBCLASS", "COUNTRY INFORMATION",
    "CLAIMS AND EVIDENCE", "PROTECTION CLAIMS", "COMPLEMENTARY PROTECTION",
    "MINISTERIAL DIRECTION", "DISCUSSION", "ANALYSIS", "ASSESSMENT",
    "PRIMARY CONSIDERATIONS", "OTHER CONSIDERATIONS",
    "BEST INTERESTS OF MINOR CHILDREN", "EXPECTATIONS OF THE AUSTRALIAN COMMUNITY",
    "LEGAL FRAMEWORK", "APPLICABLE LAW", "THE TRIBUNAL'S TASK",
    "THE MINISTER'S CASE", "THE APPLICANT'S EVIDENCE",
    "NATURE AND SERIOUSNESS OF THE CONDUCT", "PROTECTION OF THE AUSTRALIAN COMMUNITY",
    "FINDINGS AND REASONS", "THE DECISION UNDER REVIEW",
    "TRIBUNAL HEARING", "PRELIMINARY MATTERS", "PROCEDURAL HISTORY",
    "FIRST GROUND", "SECOND GROUND", "THIRD GROUND", "FOURTH GROUND",
    "GROUND 1", "GROUND 2", "GROUND 3", "GROUND 4", "GROUND 5",
    "SECONDARY MATERIALS", "CASES", "PREVIOUS DECISIONS",
}

# Structural labels that look like headings but appear inline after bold extraction
# Used by fix_inline_bold to avoid merging genuine headings
STRUCTURAL_LABELS = SECTION_HEADINGS | {
    "APPLICANT", "RESPONDENT", "REPRESENTATIVE", "MEMBER", "DATE",
    "DIVISION", "CASE NUMBER", "PLACE OF DECISION", "DECISION",
    "DECISION RECORD", "STATEMENT OF DECISION AND REASONS",
    "HOME AFFAIRS REFERENCE(S)", "TRIBUNAL", "PLACE", "FILE NUMBER",
    "HEARING DATE", "JUDGMENT", "JUDGMENT OF", "JUDGE", "JUDGES",
    "BETWEEN", "AND", "FIRST RESPONDENT", "SECOND RESPONDENT",
    "FEDERAL COURT OF AUSTRALIA", "FEDERAL CIRCUIT COURT OF AUSTRALIA",
    "ADMINISTRATIVE APPEALS TRIBUNAL", "ADMINISTRATIVE REVIEW TRIBUNAL",
    "APPLICATION FOR REVIEW", "APPLICATION FOR",
}

# AustLII navigation boilerplate lines to detect
AUSTLII_NAV = {
    "All Databases", "Cases & Legislation", "Journals & Scholarship",
    "Law Reform", "Treaties", "Libraries", "Communities", "LawCite",
    "Australia", "CTH", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA",
    "New Zealand", "Specific Year", "Any",
}


# ─── Pass 2: HTML artifact fixers ───────────────────────────────────────────


def _split_header_body(text):
    """Split text into header (first 6 lines incl separator) and body."""
    lines = text.split("\n")
    header_end = 0
    for i, line in enumerate(lines[:10]):
        if line.strip().startswith("=" * 10):
            header_end = i + 1
            break
    if header_end == 0:
        header_end = 6
    return "\n".join(lines[:header_end]), "\n".join(lines[header_end:])


def fix_last_updated(text):
    """Fix 1: Split 'Last Updated: DD Mon YYYY Content...' into two lines.

    BeautifulSoup merges the Last Updated metadata with the first content line
    because they were adjacent in HTML without block-level separation.
    """
    return re.sub(
        r'^(Last Updated:\s+\d{1,2}\s+\w+\s+\d{4})\s+(\S)',
        r'\1\n\2',
        text,
        flags=re.MULTILINE,
    )


def fix_orphan_punctuation(text):
    """Fix 2: Merge orphan punctuation lines back to the preceding line.

    Bold/italic tags cause punctuation like ; , ) to end up on their own line.
    Pattern: non-empty line, then a line containing only punctuation.
    Also handles cases with a blank line between content and orphan punctuation.
    """
    # With blank line between: text\n\n,\n → text,\n
    text = re.sub(
        r'(\S[^\n]*)\n\n([;,\)\.])\n',
        r'\1\2\n',
        text,
    )
    # Direct adjacency: text\n,\n → text,\n
    text = re.sub(
        r'(\S[^\n]*)\n([;,\)\.])\n',
        r'\1\2\n',
        text,
    )
    # Run again to catch cascading orphans (e.g., after first merge exposes new ones)
    text = re.sub(
        r'(\S[^\n]*)\n\n([;,\)\.])\n',
        r'\1\2\n',
        text,
    )
    text = re.sub(
        r'(\S[^\n]*)\n([;,\)\.])\n',
        r'\1\2\n',
        text,
    )
    return text


def fix_citation_semicolons(text):
    """Fix 3: Merge citation semicolons separating parallel citations.

    Pattern: [YYYY] COURT NNN\\n;\\n(YYYY) or [YYYY] COURT NNN\\n;\\nNNN
    or: [YYYY] COURT NNN\\n\\n;\\n\\nNNN  (with blank lines around semicolon)
    """
    # With blank lines: [2017] FCAFC 169\n\n;\n\n253 FCR 448
    text = re.sub(
        r'(\[\d{4}\]\s+[A-Z]+(?:\s+\d+)?)\n\n;\n\n',
        r'\1; ',
        text,
    )
    # Without blank lines: [2017] FCAFC 169\n;\n253 FCR 448
    text = re.sub(
        r'(\[\d{4}\]\s+[A-Z]+(?:\s+\d+)?)\n;\n',
        r'\1; ',
        text,
    )
    return text


def fix_section_splits(text):
    """Fix 4: Rejoin section/subsection references split across lines.

    Bold tags in HTML cause 'section\\n501(3A)' or 's\\n36(2)' patterns.
    Also handles 'Subsection\\n\\n501(3A)\\n\\n' with blank lines.
    """
    # With blank lines: section\n\n501(3A)\n\n  or  s\n\n36(2)(a)\n\n
    text = re.sub(
        r'\b((?:[Ss]ection|[Ss]ubsection|[Ss]s?|[Rr]eg(?:ulation)?|[Rr]r?|[Pp]aragraph|[Cc]lause|[Dd]ivision|[Pp]art|[Ii]tem|[Ss]chedule))\n\n(\d+\w*(?:\([^)]*\))*)',
        r'\1 \2',
        text,
    )
    # Without blank lines: section\n501(3A)
    text = re.sub(
        r'\b((?:[Ss]ection|[Ss]ubsection|[Ss]s?|[Rr]eg(?:ulation)?|[Rr]r?|[Pp]aragraph|[Cc]lause|[Dd]ivision|[Pp]art|[Ii]tem|[Ss]chedule))\n(\d+\w*(?:\([^)]*\))*)',
        r'\1 \2',
        text,
    )
    return text


def fix_jurisdiction_fragments(text):
    """Fix 5: Merge jurisdiction abbreviations on their own line back to preceding.

    Pattern: 'Migration Act 1958\\n(Cth)' or 'Some Act 2007\\n\\n(NSW)\\n'
    """
    # With blank lines: ...Act 1958\n\n(Cth)\n\n  →  ...Act 1958 (Cth)
    text = re.sub(
        r'([^\n])\n\n(\((?:Cth|NSW|Vic|Qld|SA|WA|Tas|NT|ACT)\))\s*\n',
        r'\1 \2\n',
        text,
    )
    # Without blank lines: ...Act 1958\n(Cth)
    text = re.sub(
        r'([^\n])\n(\((?:Cth|NSW|Vic|Qld|SA|WA|Tas|NT|ACT)\))\s*\n',
        r'\1 \2\n',
        text,
    )
    return text


def fix_paren_bold(text):
    """Fix 6: Fix bold-inside-parentheses artifacts.

    BeautifulSoup turns '<b>(CCO)</b>' into '(\\n\\nCCO\\n\\n)' because the bold
    tag wraps the content inside parens. Result: parenthesised abbreviation on
    three separate lines with blanks.

    Pattern: (\\n\\nWORD\\n\\n) where WORD is short uppercase text.
    """
    # (\n\nCCO\n\n) — with surrounding blank lines
    text = re.sub(
        r'\(\n\n([A-Z][A-Za-z0-9 ]{0,30})\n\n\)',
        r'(\1)',
        text,
    )
    # (\nCCO\n) — without blank lines
    text = re.sub(
        r'\(\n([A-Z][A-Za-z0-9 ]{0,30})\n\)',
        r'(\1)',
        text,
    )
    return text


def _fix_inline_bold_pass(text):
    """Single pass of inline bold artifact fixing."""
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        # Need at least 4 more lines: prev, blank, bold, blank, next
        if (i + 4 < len(lines)
            and lines[i].strip()  # prev line non-empty
            and lines[i + 1].strip() == ""  # blank
            and lines[i + 2].strip()  # bold word
            and lines[i + 3].strip() == ""  # blank
            and lines[i + 4].strip()  # next line non-empty
        ):
            prev = lines[i].strip()
            bold = lines[i + 2].strip()
            nxt = lines[i + 4].strip()

            # Skip if the isolated word is a heading or structural label
            if bold.upper() in STRUCTURAL_LABELS:
                result.append(lines[i])
                i += 1
                continue

            # Skip if bold is too long (likely a real paragraph, not a bold artifact)
            if len(bold) > 40:
                result.append(lines[i])
                i += 1
                continue

            # === Continuation heuristics ===

            # prev_continues: does the previous line suggest continuation?
            prev_continues = (
                prev[-1:].islower()
                or prev.endswith((",", "(", "–", "-", "/", "&"))
                or prev[-1:] in ("]", ")")
                or prev.endswith(("the", "a", "an", "of", "in", "to", "for",
                                   "and", "or", "by", "with", "at", "on",
                                   "section", "subsection", "s", "ss"))
            )

            # Heading fragment: both prev and bold are short uppercase
            # e.g., "OF AUSTRALIA" + "AT" + "MELBOURNE"
            heading_fragment = (
                prev.isupper() and bold.isupper()
                and len(prev) < 50 and len(bold) <= 10
            )

            # next_continues: does the next line suggest continuation?
            next_continues = (
                nxt[0:1].islower()
                or nxt[0:1] in ("(", "–", ",", ";")
                or (nxt[0:1].isdigit() and prev[-1:] == ",")
            )

            # For short bold artifacts (≤10 chars), also allow uppercase next
            # when prev clearly continues (e.g., "...expressed by\n\nFYBR\n\nv Minister")
            if len(bold) <= 10 and (prev_continues or heading_fragment):
                next_continues = next_continues or (
                    nxt[0:1].isupper() and not nxt.isupper()
                )

            # For heading fragments, uppercase next is ok
            if heading_fragment:
                next_continues = next_continues or nxt[0:1].isupper()
                prev_continues = True

            should_merge = prev_continues and next_continues

            if should_merge:
                merged = prev + " " + bold + " " + nxt
                result.append(merged)
                i += 5
                continue
            elif prev_continues and not next_continues:
                merged = prev + " " + bold
                result.append(merged)
                result.append("")
                i += 4
                continue

        result.append(lines[i])
        i += 1

    return "\n".join(result)


def fix_inline_bold(text):
    """Fix 7: Fix mid-sentence bold words isolated by blank lines.

    HTML bold tags cause patterns like:
    '...the Act requires the Minister to cancel a\\n\\nvis a\\n\\nif...'
    where a bold word sits between two blank lines mid-sentence.

    Runs multiple passes until stable, since merging one artifact may
    expose the next one in the correct 5-line pattern.

    Excludes STRUCTURAL_LABELS and SECTION_HEADINGS to avoid merging real headings.
    """
    for _ in range(5):  # max 5 passes, typically converges in 2-3
        new_text = _fix_inline_bold_pass(text)
        if new_text == text:
            break
        text = new_text
    return text


def fix_split_citations(text):
    """Fix 8: Rejoin citations split across blank lines.

    Pattern: [YYYY]\\n\\nCOURT NNN  →  [YYYY] COURT NNN
    Also: [YYYY]\\nCOURT NNN  (without blank lines)
    """
    # With blank line: [2024]\n\nFCA 1003
    text = re.sub(
        r'\[(\d{4})\]\n\n([A-Z]{2,10}\s+\d+)',
        r'[\1] \2',
        text,
    )
    # Without blank line: [2024]\nFCA 1003
    text = re.sub(
        r'\[(\d{4})\]\n([A-Z]{2,10}\s+\d+)',
        r'[\1] \2',
        text,
    )
    return text


def fix_parallel_citations(text):
    """Fix 9: Rejoin parallel citation page numbers split across blank lines.

    Pattern A: 253 FCR\\n\\n448  →  253 FCR 448  (reporter then page)
    Pattern B: 100\\n\\nALD 118  →  100 ALD 118  (volume then reporter+page)
    Handles CLR, ALR, FLR, ALJR, ALD, LGERA etc.
    """
    reporters = r'(?:FCR|CLR|ALR|FLR|ALJR|ALD|LGERA|ACSR|IR|AILR|IPR|SR\(WA\))'

    # Pattern A with blank line: 253 FCR\n\n448
    text = re.sub(
        r'(\d+\s+' + reporters + r')\n\n(\d+)',
        r'\1 \2',
        text,
    )
    # Pattern A without blank line
    text = re.sub(
        r'(\d+\s+' + reporters + r')\n(\d+)',
        r'\1 \2',
        text,
    )
    # Pattern B with blank line: 100\n\nALD 118 (volume split from reporter)
    text = re.sub(
        r'(\d+)\n\n(' + reporters + r'\s+\d+)',
        r'\1 \2',
        text,
    )
    # Pattern B without blank line
    text = re.sub(
        r'(\d+)\n(' + reporters + r'\s+\d+)',
        r'\1 \2',
        text,
    )
    return text


def fix_artifacts(text):
    """Pass 2 main entry: apply all HTML artifact fixes to case text.

    Operates on the body only (preserves header). Each fix is an independent
    regex substitution; order matters slightly (orphan punct before citations).
    """
    header, body = _split_header_body(text)

    # Phase 1 — zero-risk fixes
    body = fix_last_updated(body)
    body = fix_orphan_punctuation(body)
    body = fix_citation_semicolons(body)
    body = fix_section_splits(body)
    body = fix_jurisdiction_fragments(body)

    # Phase 2 — moderate-risk fixes
    body = fix_paren_bold(body)
    body = fix_inline_bold(body)
    body = fix_split_citations(body)
    body = fix_parallel_citations(body)

    # Clean up: collapse runs of 3+ blank lines to 2
    body = re.sub(r'\n{4,}', '\n\n\n', body)

    return header + "\n" + body


def is_section_heading(line):
    """Check if a line is a section heading."""
    stripped = line.strip()
    # Exact match
    if stripped.upper() in SECTION_HEADINGS:
        return True
    # ALL CAPS line that's short enough to be a heading
    if stripped.isupper() and 3 <= len(stripped) <= 80 and not stripped.startswith("["):
        return True
    # Numbered headings like "1. INTRODUCTION" or "A. BACKGROUND"
    if re.match(r'^[A-Z0-9]+[\.\)]\s+[A-Z]', stripped) and stripped.upper() == stripped:
        return True
    return False


def is_paragraph_number(line):
    """Check if a line starts with a paragraph number like [1], [23], etc."""
    return bool(re.match(r'^\s*\[\d+\]\s', line))


def is_nav_line(line):
    """Check if a line is part of AustLII navigation boilerplate."""
    return line.strip() in AUSTLII_NAV


def should_join_with_prev(prev_line, curr_line):
    """Determine if current line should be joined with previous line."""
    prev = prev_line.rstrip()
    curr = curr_line.strip()

    if not prev or not curr:
        return False

    # Don't join if current line is a section heading
    if is_section_heading(curr_line):
        return False

    # Don't join if current line starts with paragraph number
    if is_paragraph_number(curr_line):
        return False

    # Don't join if current line is nav boilerplate
    if is_nav_line(curr_line):
        return False

    # Don't join if prev line ends with the separator
    if prev.endswith("=" * 10):
        return False

    # Don't join metadata lines (Key:\tValue format)
    if "\t" in curr_line and re.match(r'^[A-Z][a-z]+.*:\t', curr_line):
        return False
    # Don't join if prev line has tab-separated metadata
    if "\t" in prev_line:
        return False

    # Don't join if current line looks like a metadata label
    if re.match(r'^(Last Updated|Applicant|Respondent|Tribunal|Place|Date|Decision|Catchwords|Legislation|Cases|Secondary|Citation|Court|Judge|Member|Hearing)\s*:', curr):
        return False

    # Don't join citation lines [YYYY] COURT NNN
    if re.match(r'^\[\d{4}\]\s+[A-Z]', curr):
        return False

    # Don't join if current line starts with common list markers
    if re.match(r'^\s*[\-\•\*]\s', curr):
        return False

    # Don't join dotted lines (signatures)
    if re.match(r'^\.{5,}', curr):
        return False

    # Don't join if prev line looks like a complete citation
    if re.search(r'\[\d{4}\]\s+[A-Z]+\s+\d+', prev):
        return False

    # Join if previous line doesn't end with sentence-ending punctuation
    # and current line starts with lowercase or continues a sentence
    if prev[-1] not in ".!?:;\"')":
        if curr[0].islower() or curr[0] in "('\"":
            return True
        # Also join if prev ends mid-word (hyphenation)
        if prev[-1] == "-":
            return True
        # Short non-heading prev line likely got broken mid-sentence
        if len(prev) < 40 and not is_section_heading(prev_line):
            return True

    # Join if previous line ends with common continuation patterns
    if re.search(r'(the|a|an|of|in|to|for|and|or|by|with|at|on|is|was|were|are|be|that|which|who|this|from|as|not|but|if|its|their|his|her|our|your|no|any|all|each|every|into|upon|than|such|under|over|between|through|during|before|after|without|within|until|unless|whether|because|although|since|while|where|when|how|section|subsection|paragraph|pursuant|accordance|regard|respect|relation|reference|contrary|notwithstanding)\s*$', prev, re.IGNORECASE):
        return True

    # Join if current line appears to continue a sentence
    if re.match(r'^(and|or|but|the|a|an|of|in|to|for|by|with|at|on|is|was|that|which|who|not|its|their|his|her|our|section|subsection|paragraph)', curr, re.IGNORECASE):
        if prev[-1] not in ".!?":
            return True

    # Short current line (closing parens, short fragments) joins with prev
    if len(curr) < 15 and re.match(r'^[\)\]\}]|^(Cth\)|NSW\)|Vic\))', curr):
        return True

    return False


def reformat_text(text):
    """Reformat case text for better readability."""
    lines = text.split("\n")

    if len(lines) < 7:
        return text  # Too short to reformat

    # Keep header (first 6 lines: Title, Citation, Court, Date, URL, separator)
    header_end = 0
    for i, line in enumerate(lines[:10]):
        if line.strip().startswith("=" * 10):
            header_end = i + 1
            break

    if header_end == 0:
        header_end = 6  # Default

    header = lines[:header_end]
    body = lines[header_end:]

    # Process body: rejoin broken lines and add section spacing
    result = []
    prev_line = ""
    in_nav = False
    nav_block = []

    for i, line in enumerate(body):
        stripped = line.strip()

        # Detect and group AustLII navigation block
        if is_nav_line(line) or (in_nav and stripped in ("", "Any") or re.match(r'^\d{4}$', stripped)):
            if not in_nav and is_nav_line(line):
                in_nav = True
                nav_block = []
            if in_nav:
                nav_block.append(stripped)
                continue

        # End nav block
        if in_nav:
            in_nav = False
            if nav_block:
                # Keep nav as a compact single-line block
                result.append("  ".join(nav_block))
                result.append("")

        # Empty line = paragraph break
        if not stripped:
            if prev_line:
                result.append(prev_line)
                prev_line = ""
            result.append("")
            continue

        # Section heading: add blank line before
        if is_section_heading(line):
            if prev_line:
                result.append(prev_line)
                prev_line = ""
            result.append("")
            result.append(stripped)
            result.append("")
            continue

        # Paragraph number: start new paragraph
        if is_paragraph_number(line):
            if prev_line:
                result.append(prev_line)
                prev_line = ""
            result.append("")
            prev_line = stripped
            continue

        # Try to join with previous line
        if prev_line and should_join_with_prev(prev_line, line):
            # Join: add space between (or no space if hyphenated)
            if prev_line.endswith("-"):
                prev_line = prev_line[:-1] + stripped
            else:
                prev_line = prev_line + " " + stripped
        else:
            if prev_line:
                result.append(prev_line)
            prev_line = stripped

    # Flush last line
    if prev_line:
        result.append(prev_line)

    # Clean up: collapse multiple blank lines into max 2
    final = []
    blank_count = 0
    for line in header + [""] + result:
        if line.strip() == "":
            blank_count += 1
            if blank_count <= 2:
                final.append("")
        else:
            blank_count = 0
            final.append(line)

    return "\n".join(final)


def process_file(filepath, mode="reformat"):
    """Process a single case text file in-place.

    Args:
        filepath: Path to the text file.
        mode: "reformat" (pass 1), "fix-artifacts" (pass 2), or "both".
    """
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            original = f.read()

        if mode == "reformat":
            result = reformat_text(original)
        elif mode == "fix-artifacts":
            result = fix_artifacts(original)
        else:  # both
            result = fix_artifacts(reformat_text(original))

        # Verify content preservation: only whitespace/newline changes allowed
        orig_chars = re.sub(r'\s+', '', original)
        new_chars = re.sub(r'\s+', '', result)
        if orig_chars != new_chars:
            return False, "Content mismatch: non-whitespace characters changed"

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(result)

        return True, None
    except Exception as e:
        return False, str(e)


def main():
    parser = argparse.ArgumentParser(
        description="Reformat AustLII case text files. "
        "Pass 1 (default): rejoin broken lines. "
        "Pass 2 (--fix-artifacts): fix HTML conversion artifacts."
    )
    parser.add_argument("--batch", type=int, help="Batch index (0-based)")
    parser.add_argument("--total-batches", type=int, help="Total number of batches")
    parser.add_argument("--single", type=str, help="Process a single file")
    parser.add_argument("--dry-run", action="store_true", help="Don't write files")
    parser.add_argument(
        "--fix-artifacts", action="store_true",
        help="Run pass 2 only (fix HTML artifacts, skip pass 1 reformat)"
    )
    args = parser.parse_args()

    mode = "fix-artifacts" if args.fix_artifacts else "reformat"

    if args.single:
        if args.dry_run:
            with open(args.single, "r", encoding="utf-8", errors="replace") as f:
                original = f.read()
            if mode == "fix-artifacts":
                result = fix_artifacts(original)
            else:
                result = reformat_text(original)
            print(result)
        else:
            ok, err = process_file(args.single, mode=mode)
            if ok:
                print(f"OK: {args.single}")
            else:
                print(f"FAIL: {args.single}: {err}")
        return

    # Load sorted paths (latest first)
    paths_file = "/tmp/case_text_paths_sorted.json"
    if not os.path.exists(paths_file):
        print("Error: Run the path generation script first")
        sys.exit(1)

    with open(paths_file) as f:
        all_paths = json.load(f)

    # Split into batches
    batch_size = len(all_paths) // args.total_batches + 1
    start = args.batch * batch_size
    end = min(start + batch_size, len(all_paths))
    my_paths = all_paths[start:end]

    print(f"Batch {args.batch} ({mode}): processing {len(my_paths):,} files (index {start}-{end})")

    success = 0
    fail = 0
    for i, path in enumerate(my_paths):
        full_path = os.path.join("/Users/d/Developer/IMMI-Case-", path)
        if not os.path.exists(full_path):
            fail += 1
            continue

        if args.dry_run:
            success += 1
        else:
            ok, err = process_file(full_path, mode=mode)
            if ok:
                success += 1
            else:
                fail += 1
                if fail <= 5:
                    print(f"  FAIL: {path}: {err}")

        if (i + 1) % 1000 == 0:
            print(f"  Progress: {i+1}/{len(my_paths)} ({success} ok, {fail} fail)")

    print(f"Batch {args.batch} done: {success:,} ok, {fail:,} fail")


if __name__ == "__main__":
    main()
