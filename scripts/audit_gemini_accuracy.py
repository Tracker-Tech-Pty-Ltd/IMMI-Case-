"""
Audit Gemini extraction accuracy using Gemini 2.5 Flash as auditor.

Randomly samples 100 cases, sends full text + Gemini-extracted results
to a stronger model, asks it to rate accuracy (1-5) for each field.

Usage:
    python scripts/audit_gemini_accuracy.py
    python scripts/audit_gemini_accuracy.py --sample 50
    python scripts/audit_gemini_accuracy.py --court MRTA --sample 20
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

import aiohttp
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

# Use gemini-2.5-flash as auditor (stronger than 2.0-flash-lite used for extraction)
AUDIT_MODEL = "gemini-2.5-flash"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

AUDIT_PROMPT = """You are an expert Australian immigration law auditor. I will show you the full text of a legal case and the AI-extracted metadata. Rate the ACCURACY of each extracted field.

For each case, provide:
1. **catchwords_score** (1-5): How accurate are the catchwords? 5=perfect, 4=good, 3=acceptable, 2=partially wrong, 1=completely wrong
2. **case_nature_score** (1-5): Is the case_nature category correct? 5=exact match, 3=close but not ideal, 1=wrong category
3. **legal_concepts_score** (1-5): Are the legal concepts relevant? 5=all correct, 3=some correct, 1=irrelevant
4. **issues** (string): Brief note on any errors found, or "none" if all good

Respond with a JSON array matching input order. Each element:
{"catchwords_score": N, "case_nature_score": N, "legal_concepts_score": N, "issues": "..."}"""


def build_audit_prompt(cases: list[dict]) -> str:
    parts = []
    for i, c in enumerate(cases):
        text = c["text"][:4000]  # More context for auditor
        parts.append(
            f"--- Case {i+1} ---\n"
            f"Citation: {c['citation']}\n"
            f"Court: {c['court']}\n\n"
            f"FULL TEXT (truncated):\n{text}\n\n"
            f"AI-EXTRACTED FIELDS:\n"
            f"  catchwords: {c['catchwords']}\n"
            f"  case_nature: {c['case_nature']}\n"
            f"  legal_concepts: {c['legal_concepts']}\n"
        )
    return "\n".join(parts)


async def call_auditor(
    session, api_key: str, cases: list[dict], semaphore: asyncio.Semaphore,
) -> list[dict]:
    """Call Gemini 2.5 Flash to audit a batch of cases."""
    prompt = build_audit_prompt(cases)
    url = f"{API_BASE}/{AUDIT_MODEL}:generateContent?key={api_key}"

    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": AUDIT_PROMPT}]},
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 4096,
        },
    }

    async with semaphore:
        for attempt in range(3):
            try:
                async with session.post(
                    url, json=body,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status == 429:
                        await asyncio.sleep(15 * (attempt + 1))
                        continue
                    if resp.status >= 500:
                        await asyncio.sleep(5 * (attempt + 1))
                        continue
                    if resp.status != 200:
                        if attempt < 2:
                            await asyncio.sleep(2 ** attempt)
                            continue
                        return []

                    data = await resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                    results = json.loads(text)

                    if isinstance(results, list):
                        return results
                    if isinstance(results, dict):
                        return [results]
                    return []

            except json.JSONDecodeError:
                try:
                    m = re.search(r'\[.*\]', text, re.DOTALL)
                    if m:
                        results = json.loads(m.group())
                        if isinstance(results, list):
                            return results
                except Exception:
                    pass
                if attempt < 2:
                    await asyncio.sleep(2)
                    continue
                return []
            except Exception as e:
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                print(f"  ERROR: {str(e)[:100]}")
                return []

    return []


async def run_audit(
    cases_list: list[dict], api_key: str, batch_size: int, concurrency: int,
) -> list[dict]:
    """Run full audit with async concurrency."""
    semaphore = asyncio.Semaphore(concurrency)

    batches = [cases_list[i:i + batch_size] for i in range(0, len(cases_list), batch_size)]
    all_results = []

    start = time.time()
    processed = 0

    chunk_size = concurrency * 2
    connector = aiohttp.TCPConnector(limit=concurrency + 5)

    async with aiohttp.ClientSession(connector=connector) as session:
        for chunk_start in range(0, len(batches), chunk_size):
            chunk = batches[chunk_start:chunk_start + chunk_size]
            tasks = [call_auditor(session, api_key, batch, semaphore) for batch in chunk]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for batch, result in zip(chunk, results):
                if isinstance(result, BaseException):
                    print(f"  Batch error: {result}")
                    for c in batch:
                        all_results.append({"case_id": c["case_id"], "error": True})
                elif result:
                    for j, c in enumerate(batch):
                        if j < len(result):
                            r = result[j]
                            r["case_id"] = c["case_id"]
                            r["citation"] = c["citation"]
                            r["court"] = c["court"]
                            r["case_nature"] = c["case_nature"]
                            all_results.append(r)
                        else:
                            all_results.append({"case_id": c["case_id"], "error": True})
                else:
                    for c in batch:
                        all_results.append({"case_id": c["case_id"], "error": True})

                processed += len(batch)

            elapsed = time.time() - start
            print(f"  {processed}/{len(cases_list)} audited ({elapsed:.0f}s)")

    return all_results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", type=int, default=100, help="Number of cases to audit")
    parser.add_argument("--court", type=str, help="Filter by court code")
    parser.add_argument("--batch-size", type=int, default=5, help="Cases per Sonnet call")
    parser.add_argument("--concurrency", type=int, default=5, help="Parallel Sonnet calls")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    # Check API key
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable")
        sys.exit(1)

    # Load CSV
    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    print(f"Loaded {len(df):,} records")

    # Filter to cases with Gemini extractions
    has_all = (
        df["catchwords"].notna() & (df["catchwords"].astype(str).str.strip() != "") &
        df["case_nature"].notna() & (df["case_nature"].astype(str).str.strip() != "") &
        df["legal_concepts"].notna() & (df["legal_concepts"].astype(str).str.strip() != "")
    )
    pool = df[has_all].copy()

    if args.court:
        pool = pool[pool["court_code"] == args.court]

    print(f"Pool with all 3 fields: {len(pool):,}")

    # Random sample
    sample = pool.sample(n=min(args.sample, len(pool)), random_state=args.seed)
    print(f"Sampled: {len(sample)} cases")

    # Build case list
    cases_list = []
    for _, row in sample.iterrows():
        ftp = str(row["full_text_path"]) if pd.notna(row["full_text_path"]) else ""
        if not ftp or not os.path.exists(ftp):
            continue
        try:
            with open(ftp, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except Exception:
            continue

        cases_list.append({
            "case_id": str(row["case_id"]),
            "citation": str(row["citation"]) if pd.notna(row["citation"]) else "",
            "court": str(row["court_code"]) if pd.notna(row["court_code"]) else "",
            "catchwords": str(row["catchwords"]) if pd.notna(row["catchwords"]) else "",
            "case_nature": str(row["case_nature"]) if pd.notna(row["case_nature"]) else "",
            "legal_concepts": str(row["legal_concepts"]) if pd.notna(row["legal_concepts"]) else "",
            "text": text,
        })

    print(f"Cases with text: {len(cases_list)}")
    print(f"\nAuditing with Gemini 2.5 Flash ({args.batch_size} cases/call, {args.concurrency} concurrent)...\n")

    # Run audit
    results = asyncio.run(run_audit(cases_list, api_key, args.batch_size, args.concurrency))

    # Analyze results
    errors = [r for r in results if r.get("error")]
    valid = [r for r in results if not r.get("error")]

    print(f"\n{'=' * 70}")
    print(f"AUDIT RESULTS — {len(valid)} cases successfully audited")
    print(f"{'=' * 70}")

    if not valid:
        print("No valid results!")
        return

    # Score analysis
    for field in ["catchwords_score", "case_nature_score", "legal_concepts_score"]:
        scores = [r[field] for r in valid if field in r and isinstance(r.get(field), (int, float))]
        if not scores:
            continue
        avg = sum(scores) / len(scores)
        dist = {}
        for s in scores:
            dist[int(s)] = dist.get(int(s), 0) + 1

        label = field.replace("_score", "")
        print(f"\n  {label:20s}: avg {avg:.2f}/5.00")
        for s in sorted(dist.keys(), reverse=True):
            bar = "#" * dist[s]
            pct = dist[s] / len(scores) * 100
            print(f"    {s}/5: {dist[s]:>3} ({pct:5.1f}%) {bar}")

    # Overall accuracy
    all_scores = []
    for r in valid:
        for field in ["catchwords_score", "case_nature_score", "legal_concepts_score"]:
            if field in r and isinstance(r.get(field), (int, float)):
                all_scores.append(r[field])

    if all_scores:
        overall = sum(all_scores) / len(all_scores)
        pct_4plus = sum(1 for s in all_scores if s >= 4) / len(all_scores) * 100
        pct_3plus = sum(1 for s in all_scores if s >= 3) / len(all_scores) * 100
        print(f"\n  {'OVERALL':20s}: {overall:.2f}/5.00")
        print(f"  Score >= 4 (good+): {pct_4plus:.1f}%")
        print(f"  Score >= 3 (acceptable+): {pct_3plus:.1f}%")

    # By court breakdown
    print("\n  By court:")
    court_scores = {}
    for r in valid:
        court = r.get("court", "?")
        if court not in court_scores:
            court_scores[court] = []
        for field in ["catchwords_score", "case_nature_score", "legal_concepts_score"]:
            if field in r and isinstance(r.get(field), (int, float)):
                court_scores[court].append(r[field])

    for court in sorted(court_scores.keys()):
        scores = court_scores[court]
        avg = sum(scores) / len(scores)
        n = len(scores) // 3
        print(f"    {court:15s}: {avg:.2f}/5 (n={n})")

    # Issues
    issues = [r for r in valid if r.get("issues", "none").lower() not in ("none", "no issues", "")]
    if issues:
        print(f"\n  Issues found ({len(issues)} cases):")
        for r in issues[:15]:
            cit = r.get("citation", "?")[:40]
            iss = r.get("issues", "?")[:80]
            print(f"    {cit:42s} {iss}")

    if errors:
        print(f"\n  API errors: {len(errors)} cases")

    # Save detailed results
    out_path = Path("downloaded_cases/gemini_audit_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nDetailed results: {out_path}")


if __name__ == "__main__":
    main()
