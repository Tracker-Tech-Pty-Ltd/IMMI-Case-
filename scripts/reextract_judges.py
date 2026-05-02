#!/usr/bin/env python3
"""Re-extract real judge names for empty `judges` rows by reading local
case_texts/*.txt files and applying the new sanity-checked regex from
postprocess.py.

Workflow:
  1. SELECT case_id, full_text_path FROM immigration_cases WHERE judges = ''
  2. For each row, translate the DB-stored absolute path to the local
     worktree path (path bases differ between worktrees: this script uses
     basename + the worktree's downloaded_cases/case_texts/)
  3. Run new judge regex + _looks_like_judge_name sanity check
  4. If found, queue an UPDATE; otherwise leave empty

Usage:
  scripts/reextract_judges.py                       # dry-run, sample 100
  scripts/reextract_judges.py --limit 500           # bigger dry-run sample
  scripts/reextract_judges.py --apply --limit 1000  # write 1000 rows
  scripts/reextract_judges.py --apply --limit 0     # ALL empty rows (~19,657)
                                                    # estimate: 30+ minutes

Pre-req: `supabase` CLI installed + `supabase link --project-ref <ref>` done.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Mirror postprocess.py regex + sanity
# ---------------------------------------------------------------------------

JUDGE_PATTERNS = [
    re.compile(
        r"(?:Judge\(s\)|JUDGES?|JUSTICE|TRIBUNAL\s+MEMBERS?)\b[ \t]*[:\-][ \t]*"
        r"([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){0,4}(?:[ \t]+J)?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:Before|Coram)\b[ \t]*[:\-][ \t]*"
        r"([A-Z][A-Za-z'\-]+(?:[ \t]+[A-Z][A-Za-z'\-]+){0,4}(?:[ \t]+J)?)\b",
        re.IGNORECASE,
    ),
]

_PROSE_STOPWORDS = (
    " the ", " that ", " which ", " of the ", " was ", " were ",
    " when ", " where ", " applicant ", " tribunal ", " department ",
    " decision ", " hearing ", " evidence ", " visa ", " review ",
)
_BAD_TOKENS = {"date", "judge", "judges", "member", "members", "justice", "tribunal"}


def looks_like_judge(s: str) -> bool:
    if not s:
        return False
    s = s.strip()
    if not s or len(s) > 60:
        return False
    if not s[0].isupper():
        return False
    low = s.lower().strip(" .,;:")
    if low in _BAD_TOKENS:
        return False
    padded = " " + s.lower() + " "
    if any(stop in padded for stop in _PROSE_STOPWORDS):
        return False
    if any(ch in s for ch in "([–—"):
        return False
    if any(ch in s for ch in "\n\r\t"):  # multi-line capture (column collision)
        return False
    return True


def extract_from_text(text: str) -> str | None:
    for pat in JUDGE_PATTERNS:
        for m in pat.finditer(text):
            cand = m.group(1).strip()
            if looks_like_judge(cand):
                return cand
    return None


# ---------------------------------------------------------------------------
# Supabase CLI helpers
# ---------------------------------------------------------------------------

LOCAL_CASE_TEXTS = (Path(__file__).parent.parent / "downloaded_cases" / "case_texts").resolve()


def supabase_query(sql: str, timeout: int = 60) -> list[dict]:
    """Run SQL via supabase CLI; return rows (or [] on parse failure)."""
    result = subprocess.run(
        ["supabase", "db", "query", "--linked", sql],
        capture_output=True, text=True, timeout=timeout,
    )
    out = (result.stdout or "") + (result.stderr or "")
    try:
        idx = out.index("{")
        return json.loads(out[idx:]).get("rows", [])
    except (ValueError, KeyError, json.JSONDecodeError):
        if result.returncode != 0:
            print(f"  WARNING: supabase CLI returned {result.returncode}: {out[:200]}", file=sys.stderr)
        return []


def chunked(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="Actually write UPDATEs (default: dry-run)")
    p.add_argument("--limit", type=int, default=100,
                   help="Max empty rows to examine (0 = all empty rows, ~19,657)")
    p.add_argument("--batch-size", type=int, default=50,
                   help="UPDATE batch size (CASE WHEN per batch)")
    p.add_argument("--max-text-bytes", type=int, default=8000,
                   help="Read only the first N bytes of each case_text (judges block usually in header)")
    args = p.parse_args()

    print("=== reextract_judges.py ===")
    print(f"Mode:        {'APPLY (will write)' if args.apply else 'DRY-RUN (read-only)'}")
    print(f"Limit:       {args.limit if args.limit else 'ALL'}")
    print(f"Batch size:  {args.batch_size}")
    print(f"Max bytes:   {args.max_text_bytes} per file")
    print(f"Local root:  {LOCAL_CASE_TEXTS}")
    print()

    if not LOCAL_CASE_TEXTS.exists():
        print(f"ERROR: local case_texts dir not found: {LOCAL_CASE_TEXTS}", file=sys.stderr)
        return 2

    # 1. Fetch empty rows in pages of 1000 (Supabase row limit per CLI call)
    if args.limit and args.limit <= 1000:
        rows = supabase_query(f"""
          SELECT case_id, full_text_path FROM public.immigration_cases
          WHERE judges = ''
          ORDER BY case_id
          LIMIT {args.limit}
        """)
    else:
        rows = []
        offset = 0
        page = 1000
        target = args.limit if args.limit else 999999
        while len(rows) < target:
            page_size = min(page, target - len(rows))
            page_rows = supabase_query(f"""
              SELECT case_id, full_text_path FROM public.immigration_cases
              WHERE judges = ''
              ORDER BY case_id
              LIMIT {page_size} OFFSET {offset}
            """)
            if not page_rows:
                break
            rows.extend(page_rows)
            offset += page_size
            print(f"  fetched {len(rows)} rows so far...")

    print(f"Fetched {len(rows)} candidate empty rows.\n")

    # 2. Local extraction
    found, not_found, missing_file, read_error = 0, 0, 0, 0
    updates: list[tuple[str, str]] = []

    for row in rows:
        case_id = row["case_id"]
        db_path = row.get("full_text_path", "") or ""
        if not db_path:
            missing_file += 1
            continue
        local_path = LOCAL_CASE_TEXTS / Path(db_path).name
        if not local_path.exists():
            missing_file += 1
            continue
        try:
            with local_path.open("rb") as f:
                raw = f.read(args.max_text_bytes)
            text = raw.decode("utf-8", errors="ignore")
        except Exception:
            read_error += 1
            continue
        cand = extract_from_text(text)
        if cand:
            found += 1
            updates.append((case_id, cand))
            if found <= 15:
                print(f"  + {case_id}: {cand!r}  <- {local_path.name}")
        else:
            not_found += 1

    print()
    print("=== Extraction summary ===")
    print(f"  found_judge:    {found}     ({found / max(len(rows), 1):.1%})")
    print(f"  no_match:       {not_found}")
    print(f"  missing_file:   {missing_file}")
    print(f"  read_error:     {read_error}")
    print(f"  total_examined: {len(rows)}")
    print()

    if not args.apply:
        print("Dry-run only. Re-run with --apply to write.")
        return 0

    # 3. Apply via CASE WHEN UPDATEs
    if not updates:
        print("No updates to apply.")
        return 0

    print(f"Writing {len(updates)} UPDATEs in batches of {args.batch_size}...")
    written = 0
    for batch_idx, batch in enumerate(chunked(updates, args.batch_size), start=1):
        # Escape single quotes for SQL string literals
        cases_sql = " ".join(
            f"WHEN '{cid}' THEN '{name.replace(chr(39), chr(39) * 2)}'"
            for cid, name in batch
        )
        ids_sql = ",".join(f"'{cid}'" for cid, _ in batch)
        sql = f"""
          UPDATE public.immigration_cases
          SET judges = CASE case_id {cases_sql} END
          WHERE case_id IN ({ids_sql})
        """
        supabase_query(sql, timeout=120)
        written += len(batch)
        total_batches = (len(updates) + args.batch_size - 1) // args.batch_size
        print(f"  batch {batch_idx}/{total_batches}: wrote {len(batch)} (cumulative {written})")
        time.sleep(0.3)

    print(f"\nDone. Re-extracted and wrote {written} judges fields.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
