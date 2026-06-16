#!/usr/bin/env python3
"""Generate batched audit files for Gemini metadata quality validation.

Randomly samples 5% of cases, pairs metadata with full text, and writes
JSON batch files sized for Gemini's context window (~25 cases per batch).

Usage:
    python scripts/generate_audit_batches.py
    python scripts/generate_audit_batches.py --pct 1 --batch-size 10  # smaller test run
"""

import argparse
import csv
import json
import os
import random
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(PROJECT_ROOT, "downloaded_cases", "immigration_cases.csv")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "downloaded_cases", "audit_batches")

# ─── The audit prompt ──────────────────────────────────────────────────────────

AUDIT_PROMPT = r"""
# Metadata Extraction Quality Audit — IMMI-Case Database

## Your Role

You are an expert legal data quality auditor specializing in Australian immigration law.
You will be given a batch of immigration court/tribunal cases, each consisting of:

1. **Extracted metadata** (structured fields from our extraction pipeline)
2. **Full text** of the original decision

Your task: **read the full text of each case** and independently verify whether the
extracted metadata is accurate. Produce a structured JSON audit report.

---

## Database Context

- 149,016 Australian immigration court/tribunal decisions (2000–2026)
- Source: AustLII (Australian Legal Information Institute)
- Courts/Tribunals: AATA, ARTA, FCA, FCCA, FMCA, FedCFamC2G, HCA, RRTA, MRTA
- Extraction pipeline: Regex → Claude Sonnet LLM sub-agents → fallback inference

---

## Fields to Audit (9 fields, ranked by importance)

### 1. `outcome` ⚠️ CRITICAL
The final decision/disposition. Valid values:
- Affirmed, Set aside, Remitted, Dismissed, Allowed, Granted, Refused,
  No jurisdiction, Cancelled, Quashed, Withdrawn

**Verify by**: Find the ORDER / DECISION section (usually at the end). Look for operative
language: "The Tribunal affirms the decision under review" → Affirmed;
"The appeal is dismissed" → Dismissed.

**Pitfalls**:
- A case discussing a "refusal" may actually be *affirming* that refusal (outcome = Affirmed)
- "Set aside and remitted" → primary action is **Set aside**
- Tribunals use Affirmed / Set aside; Courts use Dismissed / Allowed / Remitted

### 2. `case_nature` ⚠️ CRITICAL
The type of immigration matter. Common values: Protection visa, Visa refusal,
Visa cancellation, Judicial review, Merits review, Skilled migration, Student visa,
Partner/Family visa, Appeal, Work visa, Visitor visa, Bridging visa, Other

**Verify by**: Read CATCHWORDS + opening paragraphs. The visa type and nature of
proceedings determine this.

### 3. `judges`
Decision-maker name(s). Surname or "Initial. Surname" format.
**Verify by**: Header, APPEARANCES section, or signature block.

### 4. `visa_type`
Full visa name (e.g. "Protection (Class XA) visa", "Skilled Independent (subclass 189)").
**Verify by**: First paragraphs or CATCHWORDS for visa name mentions.

### 5. `visa_subclass`
3-digit visa subclass number (e.g. "866", "189", "457").
**Verify by**: "subclass XXX" patterns in text.

### 6. `visa_class_code`
2-letter visa class code (e.g. "XA", "EN", "TN").
**Verify by**: "Class XX" patterns, often in parentheses.

### 7. `legal_concepts`
Semicolon-separated legal issues discussed in the case.
**Verify by**: CATCHWORDS + main body. Are listed concepts actually discussed?
Are major concepts missing?

### 8. `legislation`
Key legislation cited. Migration Act 1958 should appear in nearly every case.
**Verify by**: Scan for Act/Regulation references throughout the text.

### 9. `catchwords`
Summary keywords/topics. Some cases have explicit CATCHWORDS sections from AustLII.
**Verify by**: Compare against original CATCHWORDS section if present.

---

## Grading Scale

| Grade               | Meaning                                                     |
|---------------------|-------------------------------------------------------------|
| CORRECT             | Extraction matches the full text (exact or reasonable)      |
| PARTIALLY_CORRECT   | Mostly right but missing detail or slightly imprecise       |
| INCORRECT           | Wrong — different outcome, wrong visa type, etc.            |
| MISSING_IN_TEXT     | Info genuinely doesn't appear in the full text              |
| MISSING_IN_METADATA | Metadata field is empty but info IS in the full text        |
| NOT_APPLICABLE      | Field doesn't apply to this type of case                    |

---

## Output Format

Return ONLY valid JSON. For each case:

```json
{
  "case_id": "...",
  "citation": "...",
  "audit": {
    "outcome":         { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "case_nature":     { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "judges":          { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "visa_type":       { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "visa_subclass":   { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "visa_class_code": { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "legal_concepts":  { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "legislation":     { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." },
    "catchwords":      { "grade": "...", "extracted": "...", "actual": "...", "evidence": "...", "notes": "..." }
  },
  "overall_accuracy_pct": 88.9,
  "critical_errors": ["outcome is INCORRECT: extracted Refused but actual is Affirmed"],
  "suggestions": ["Check for 'affirms the decision' pattern in tribunal cases"]
}
```

After ALL cases, append a batch summary:

```json
{
  "batch_summary": {
    "total_cases": 25,
    "field_accuracy": {
      "outcome":         { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "case_nature":     { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "judges":          { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "visa_type":       { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "visa_subclass":   { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "visa_class_code": { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "legal_concepts":  { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "legislation":     { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 },
      "catchwords":      { "correct": 0, "partial": 0, "incorrect": 0, "missing": 0 }
    },
    "overall_accuracy_pct": 0.0,
    "most_common_errors": [
      { "field": "outcome", "pattern": "...", "count": 0, "description": "..." }
    ],
    "pipeline_recommendations": ["..."]
  }
}
```

---

## Key Reminders

- Read the ENTIRE full text before judging. Don't skim.
- The ORDER/DECISION section (end of text) is most important for `outcome`.
- Tribunals "affirm"/"set aside"; Courts "dismiss"/"allow"/"remit".
- RRTA/MRTA = old Refugee/Migration Review Tribunals (pre-2015), all immigration.
- AATA merged RRTA/MRTA in 2015; ARTA replaced AATA in late 2024.
- Court hierarchy: FMCA/FCCA/FedCFamC2G → FCA → HCA.
- If ambiguous, note it. Don't guess.

---

## Cases to Audit

""".strip()

# Fields to include in metadata for each case
AUDIT_FIELDS = [
    "case_id", "citation", "title", "court", "court_code", "date", "year",
    "judges", "catchwords", "outcome", "visa_type", "visa_subclass",
    "visa_class_code", "case_nature", "legal_concepts", "legislation",
]


def load_cases():
    """Load all cases from CSV."""
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_full_text(row):
    """Read the full text file for a case row."""
    path = row.get("full_text_path", "")
    if not path:
        return None
    if not os.path.isabs(path):
        path = os.path.join(PROJECT_ROOT, path)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def sample_cases(cases, pct, seed):
    """Stratified random sample: proportional to court distribution."""
    random.seed(seed)
    by_court = {}
    for c in cases:
        court = c.get("court_code", "OTHER")
        by_court.setdefault(court, []).append(c)

    sampled = []
    for court, court_cases in by_court.items():
        n = max(1, int(len(court_cases) * pct / 100))
        sampled.extend(random.sample(court_cases, min(n, len(court_cases))))

    random.shuffle(sampled)
    return sampled


def build_case_block(row, full_text):
    """Format a single case for the audit prompt."""
    metadata = {k: row.get(k, "") for k in AUDIT_FIELDS}
    return (
        "===CASE_START===\n"
        f"METADATA:\n{json.dumps(metadata, indent=2, ensure_ascii=False)}\n\n"
        f"FULL_TEXT:\n{full_text}\n"
        "===CASE_END===\n"
    )


def main():
    parser = argparse.ArgumentParser(description="Generate Gemini audit batches")
    parser.add_argument("--pct", type=float, default=5.0, help="Sample percentage (default: 5)")
    parser.add_argument("--batch-size", type=int, default=25, help="Cases per batch (default: 25)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed (default: 42)")
    parser.add_argument("--output", type=str, default=OUTPUT_DIR, help="Output directory")
    args = parser.parse_args()

    print(f"Loading cases from {CSV_PATH}...")
    all_cases = load_cases()
    print(f"  Total: {len(all_cases):,} cases")

    print(f"Sampling {args.pct}% (stratified by court)...")
    sampled = sample_cases(all_cases, args.pct, args.seed)
    print(f"  Selected: {len(sampled):,} cases")

    # Filter to cases with readable full text
    valid = []
    skipped = 0
    for row in sampled:
        text = read_full_text(row)
        if text and len(text) > 100:
            valid.append((row, text))
        else:
            skipped += 1

    print(f"  With full text: {len(valid):,} | Skipped (no text): {skipped}")

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    # Write batches
    batch_count = 0
    total_tokens_est = 0
    manifest = []

    for i in range(0, len(valid), args.batch_size):
        batch = valid[i : i + args.batch_size]
        batch_count += 1

        # Build the prompt + cases content
        case_blocks = []
        batch_meta = []
        for row, text in batch:
            case_blocks.append(build_case_block(row, text))
            batch_meta.append({
                "case_id": row.get("case_id", ""),
                "citation": row.get("citation", ""),
                "court_code": row.get("court_code", ""),
                "year": row.get("year", ""),
                "text_length": len(text),
            })

        full_content = AUDIT_PROMPT + "\n\n" + "\n".join(case_blocks)
        tokens_est = len(full_content) // 4

        # Write batch file
        batch_file = os.path.join(args.output, f"audit_batch_{batch_count:04d}.txt")
        with open(batch_file, "w", encoding="utf-8") as f:
            f.write(full_content)

        # Write companion metadata
        meta_file = os.path.join(args.output, f"audit_batch_{batch_count:04d}_meta.json")
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump({
                "batch_number": batch_count,
                "cases_count": len(batch),
                "estimated_tokens": tokens_est,
                "cases": batch_meta,
            }, f, indent=2, ensure_ascii=False)

        total_tokens_est += tokens_est
        manifest.append({
            "batch": batch_count,
            "file": os.path.basename(batch_file),
            "cases": len(batch),
            "tokens_est": tokens_est,
        })

        courts = ", ".join(sorted(set(m["court_code"] for m in batch_meta)))
        print(f"  Batch {batch_count:4d}: {len(batch):3d} cases | ~{tokens_est:,} tokens | courts: {courts}")

    # Write manifest
    manifest_file = os.path.join(args.output, "manifest.json")
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump({
            "total_batches": batch_count,
            "total_cases": len(valid),
            "total_tokens_est": total_tokens_est,
            "sample_pct": args.pct,
            "seed": args.seed,
            "batch_size": args.batch_size,
            "batches": manifest,
        }, f, indent=2)

    print(f"\n{'='*60}")
    print(f"  Output: {args.output}/")
    print(f"  Batches: {batch_count}")
    print(f"  Total cases: {len(valid):,}")
    print(f"  Est. total tokens: {total_tokens_est:,} (~{total_tokens_est/1_000_000:.1f}M)")
    print(f"  Avg tokens/batch: {total_tokens_est//batch_count:,}")
    print("\nNext steps:")
    print("  1. Feed each audit_batch_XXXX.txt to Gemini (1M context window)")
    print("  2. Collect JSON responses into audit_results/")
    print("  3. Run: python scripts/aggregate_audit_results.py")


if __name__ == "__main__":
    main()
