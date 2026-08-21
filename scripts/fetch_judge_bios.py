#!/usr/bin/env python3
"""Fetch public biographical data for top judges using Gemini.

Two modes:
  --mode deep-research  (default for first 20): Interactions API Deep Research agent.
                         Thorough web browsing, ~$2-5/batch, ~8-12 min/batch.
  --mode grounding:      Gemini Pro + Google Search grounding tool.
                         Fast single-call, ~$0.01-0.05/judge, ~5-15s/judge.

Usage:
    # Deep Research mode (default) — top 20 judges, 5 per batch
    python scripts/fetch_judge_bios.py

    # Grounding mode — much cheaper and faster
    python scripts/fetch_judge_bios.py --mode grounding --limit 40

    # All top 200 judges with Deep Research (40 calls ≈ $80-200)
    python scripts/fetch_judge_bios.py --limit 200

    # Specific judges
    python scripts/fetch_judge_bios.py --names "Smith, Jones, Brown"

    # Dry run — show what would be queried without calling API
    python scripts/fetch_judge_bios.py --dry-run

Requirements:
    pip install google-genai   # already installed (v1.47.0)
    export GEMINI_API_KEY=...  # or use gcloud auth application-default login

Cost tracking:
    Deep Research: ~$2-5 per batch of 5 judges.
    Grounding: ~$0.01-0.05 per judge (Gemini Pro + search queries).
    Token usage is tracked per batch and summarised at the end.
"""

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "downloaded_cases"
BIOS_PATH = OUTPUT_DIR / "judge_bios.json"

DEEP_RESEARCH_AGENT = "deep-research-pro-preview-12-2025"
FLASH_MODEL = "gemini-2.5-flash"
GROUNDING_MODEL = "gemini-2.5-pro"

# Pricing estimates (USD per 1M tokens) for cost tracking
# Deep Research: input ~$1.25/1M (50-70% cached at $0.31/1M), output ~$10/1M
DR_INPUT_COST_PER_M = 1.25
DR_CACHED_RATIO = 0.6  # ~60% of input tokens are cache hits
DR_CACHED_COST_PER_M = 0.3125
DR_OUTPUT_COST_PER_M = 10.0
# Flash: input $0.15/1M, output $0.60/1M
FLASH_INPUT_COST_PER_M = 0.15
FLASH_OUTPUT_COST_PER_M = 0.60
# Gemini 2.5 Pro: input $1.25/1M (<=200K), output $10/1M
# Google Search grounding: billed per search query executed by the model
PRO_INPUT_COST_PER_M = 1.25
PRO_OUTPUT_COST_PER_M = 10.0
SEARCH_COST_PER_QUERY = 0.035  # ~$0.035 per search query (Gemini 3 billing)

# Official best-practice prompt template:
# 1. Clearly state what to research and the scope
# 2. Specify constraints and trusted sources
# 3. Explicitly prompt for unknowns ("if not found, state so")
# 4. Request structured output format for easier parsing
RESEARCH_PROMPT = """You are researching Australian court judges and tribunal members who handle immigration and refugee cases.

CONTEXT:
These individuals serve on the Administrative Appeals Tribunal (AAT), Administrative Review Tribunal (ARTA),
Federal Court of Australia (FCA), Federal Circuit and Family Court (FedCFamC2G, formerly FCCA/FMCA),
Migration Review Tribunal (MRTA), Refugee Review Tribunal (RRTA), or High Court of Australia (HCA).

JUDGES TO RESEARCH:
{judge_list}

TASK:
For EACH person listed above, search for their PUBLIC biographical information. Focus on these trusted sources:
- Official court and tribunal websites (e.g. aat.gov.au, fedcourt.gov.au, arta.gov.au)
- Australian Government Gazette and parliament records
- Legal directories (e.g. Australian Legal Directory, Law Society profiles)
- LinkedIn profiles
- University alumni pages
- Published judicial profiles in law journals

For EACH judge, find:
1. Full name with title (e.g. "Senior Member Jane Smith", "Justice John Brown")
2. Current or most recent role and court/tribunal
3. Year of appointment to the tribunal/court (if publicly available)
4. Education background (university, degree)
5. Previous career roles before their current appointment
6. The specific URL where you found the information

IMPORTANT:
- If you CANNOT find information about a specific person, explicitly state "NO PUBLIC RECORD FOUND" for them.
  Do NOT guess or infer — it is better to report nothing than to report inaccurate information.
- Some names may be common; ensure you are finding the CORRECT person who serves on an Australian court/tribunal.
- Present your findings as a clear structured list for each judge, with their name as a heading.
"""

GROUNDING_PROMPT = """Search for DETAILED PUBLIC biographical information about the following Australian court judges / tribunal members
who handle immigration and refugee cases.

They may serve on: Administrative Appeals Tribunal (AAT), Administrative Review Tribunal (ART/ARTA),
Federal Court of Australia (FCA), Federal Circuit and Family Court (FedCFamC2G/FCCA/FMCA),
Migration Review Tribunal (MRTA), Refugee Review Tribunal (RRTA), or High Court of Australia (HCA).

JUDGES:
{judge_list}

For EACH judge, use Google Search THOROUGHLY to find:
1. Full name with title (e.g. "Senior Member Jane Smith")
2. Current or most recent role and court/tribunal
3. Year of appointment (if publicly available)
4. BIRTH YEAR — THIS IS HIGH PRIORITY. Search aggressively:
   - Search "[name] born [year]", "[name] age", "[name] birthday"
   - Check Wikipedia, Who's Who in Australia, Debrett's, AustLII judicial profiles
   - Search "[name] judge biography born", "[name] barrister born"
   - Look for graduation year clues: if LLB in 1985, birth ~1963 (age 22). Report the birth year, NOT the estimated one.
   - Check Federal Court annual reports, AAT annual reports (they sometimes list ages)
   - Only report CONFIRMED birth years from public sources. Do NOT guess or estimate.
5. EDUCATION — Search specifically for university degrees, law school, postgraduate qualifications.
   Check LinkedIn, university alumni directories, court biographies, legal directories, law society profiles.
   Return as a list like: ["University of Melbourne (LLB)", "Australian National University (PhD)"]
6. CAREER HISTORY — detailed chronological career path with years and organisations.
7. Professional profile photo URL (direct image URL from official sources, skip if not found)
8. SOCIAL MEDIA & ONLINE PROFILES — Search thoroughly for:
   - LinkedIn: search "site:linkedin.com/in [name] australia judge" or "[name] linkedin barrister"
   - Twitter/X: search "site:twitter.com [name] judge australia" or "site:x.com [name]"
   - Professional profiles: Law Society pages, bar association listings, university staff pages
   - ResearchGate/Google Scholar (for judges with academic background)
   - Return as an object with platform keys and profile URLs
9. Source URL where you found the information

Return your answer as a JSON object (no markdown fences) where each key is the judge's FULL NAME in lowercase
(exactly as listed above, e.g. "megan hodgkinson", "c packer").
Example format:
{{
  "megan hodgkinson": {{
    "full_name": "Senior Member Megan Hodgkinson",
    "role": "Senior Member",
    "court": "Administrative Review Tribunal (ART)",
    "appointed_year": 2020,
    "birth_year": 1975,
    "education": ["University of Sydney (Bachelor of Laws)", "University of NSW (Master of Laws)"],
    "previously": "Solicitor at ABC Law (2005-2010); Senior Associate at XYZ Partners (2010-2015); Member, Migration Review Tribunal (2015-2020)",
    "photo_url": "https://example.com/photo.jpg",
    "social_media": {{
      "linkedin": "https://www.linkedin.com/in/megan-hodgkinson-12345/",
      "twitter": "https://twitter.com/meghodgkinson"
    }},
    "source_url": "https://..."
  }}
}}

IMPORTANT RULES:
- BIRTH YEAR and SOCIAL MEDIA are the TOP PRIORITY fields for this search. Search multiple queries for each.
- EDUCATION is also critical. Search "[name] university degree", "[name] law school", "[name] LinkedIn".
- For social_media, only include VERIFIED profile URLs that actually belong to this specific judge/member.
  Do NOT include generic search result pages. Include only direct profile URLs.
  Common platforms: "linkedin", "twitter", "google_scholar", "researchgate", "university_page", "bar_association"
- For career history ("previously"), include YEARS and ORGANISATIONS. Be chronological and specific.
- For photo_url, only include direct image URLs from official or professional sources. Skip if not found.
- For birth_year, only include if publicly documented. Do NOT guess.
- If you CANNOT find information for a judge, set "full_name" to null.
Return ONLY valid JSON."""

PARSE_PROMPT = """Parse the following research report about Australian judges into structured JSON.

REPORT:
{report}

Return a JSON object where each key is the judge's name (lowercase) and the value has these fields:
{{
  "judge name lowercase": {{
    "full_name": "full name with title or null",
    "role": "current/recent role or null",
    "court": "court/tribunal name or null",
    "appointed_year": 2015 or null,
    "education": ["University (Degree)", ...] or [],
    "previously": "brief prior roles or null",
    "source_url": "URL where info was found or null"
  }}
}}

For judges where the report says "No public record found", set full_name to null.
Return ONLY valid JSON, no markdown fences."""


def load_existing_bios() -> dict:
    if BIOS_PATH.exists():
        with open(BIOS_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_bios(bios: dict) -> None:
    tmp = BIOS_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(bios, f, indent=2, ensure_ascii=False)
    os.replace(tmp, BIOS_PATH)


def get_top_judges(limit: int) -> list[str]:
    """Extract top judges by case count from CSV data."""
    from immi_case_downloader.storage import load_cases_csv

    cases = load_cases_csv(str(OUTPUT_DIR))
    judge_counter: Counter = Counter()

    blocklist = frozenset({
        "date", "the", "and", "court", "tribunal", "member", "judge",
        "justice", "honour", "federal", "migration", "review",
        "applicant", "respondent", "minister", "decision",
    })

    for case in cases:
        judges_raw = case.get("judges", "") or ""
        if not isinstance(judges_raw, str):
            continue
        for piece in re.split(r"[;,]", judges_raw):
            name = piece.strip()
            lowered = name.lower()
            if not name or len(name) < 3 or lowered in blocklist or name.isdigit():
                continue
            judge_counter[name] += 1

    return [name for name, _ in judge_counter.most_common(limit)]


def estimate_dr_cost(total_tokens: int) -> float:
    """Estimate Deep Research cost from total token count.

    Deep Research typically uses ~80% input, ~20% output tokens.
    ~60% of input tokens are cache hits at reduced rate.
    """
    est_input = int(total_tokens * 0.8)
    est_output = total_tokens - est_input
    cached_input = int(est_input * DR_CACHED_RATIO)
    fresh_input = est_input - cached_input
    cost = (
        fresh_input / 1_000_000 * DR_INPUT_COST_PER_M
        + cached_input / 1_000_000 * DR_CACHED_COST_PER_M
        + est_output / 1_000_000 * DR_OUTPUT_COST_PER_M
    )
    return round(cost, 4)


def deep_research_batch(
    client, names: list[str], batch_num: int, total_batches: int
) -> tuple[str | None, dict]:
    """Run Deep Research for a batch of judges.

    Returns (report_text, usage_info) where usage_info contains token counts.
    """
    judge_list = "\n".join(f"  {i}. {name}" for i, name in enumerate(names, 1))
    prompt = RESEARCH_PROMPT.format(judge_list=judge_list)
    usage_info: dict = {"total_tokens": 0, "estimated_cost": 0.0, "duration_s": 0}

    print(f"\n{'='*60}")
    print(f"Batch {batch_num}/{total_batches}: Researching {len(names)} judges")
    print(f"  Names: {', '.join(names)}")
    print(f"{'='*60}")

    start_time = time.time()
    try:
        interaction = client.interactions.create(
            input=prompt,
            agent=DEEP_RESEARCH_AGENT,
            background=True,
        )
        print(f"  Deep Research started. ID: {interaction.id}")
    except Exception as e:
        print(f"  ERROR starting Deep Research: {e}")
        return None, usage_info

    # Poll for completion with thinking summary display
    poll_count = 0
    max_polls = 120  # 20 minutes max (10s intervals)
    last_summary = ""
    while poll_count < max_polls:
        try:
            interaction = client.interactions.get(interaction.id)
            status = interaction.status
            poll_count += 1

            # Show thinking summaries if available (progress updates)
            if hasattr(interaction, "thinking_summaries") and interaction.thinking_summaries:
                latest = interaction.thinking_summaries[-1]
                summary_text = getattr(latest, "text", str(latest))
                if summary_text != last_summary:
                    # Truncate long summaries
                    display = summary_text[:120] + "..." if len(summary_text) > 120 else summary_text
                    print(f"  [progress] {display}")
                    last_summary = summary_text

            if poll_count % 6 == 0:  # Print every 60 seconds
                elapsed = int(time.time() - start_time)
                print(f"  Status: {status} (poll {poll_count}, {elapsed}s elapsed)")

            if status == "completed":
                duration = round(time.time() - start_time, 1)
                usage_info["duration_s"] = duration

                # Extract token usage
                if hasattr(interaction, "usage") and interaction.usage:
                    total_tok = getattr(interaction.usage, "total_tokens", 0) or 0
                    usage_info["total_tokens"] = total_tok
                    usage_info["estimated_cost"] = estimate_dr_cost(total_tok)
                    print(f"  Tokens: {total_tok:,} | Est. cost: ${usage_info['estimated_cost']:.3f}")

                report = interaction.outputs[-1].text if interaction.outputs else None
                if report:
                    print(f"  Completed in {duration}s! Report: {len(report):,} chars")
                return report, usage_info

            if status in ("failed", "cancelled"):
                print(f"  Research {status}.")
                return None, usage_info

            time.sleep(10)
        except Exception as e:
            print(f"  Poll error: {e}")
            time.sleep(15)
            poll_count += 1

    print(f"  Timeout after {max_polls * 10}s")
    return None, usage_info


def grounding_search_batch(
    client, names: list[str], batch_num: int, total_batches: int
) -> tuple[dict, dict]:
    """Use Gemini Pro + Google Search grounding to find judge bios.

    Returns (parsed_bios, usage_info). No separate parsing step needed —
    the model returns JSON directly grounded by Google Search results.
    """
    from google.genai import types

    judge_list = "\n".join(f"  {i}. {name}" for i, name in enumerate(names, 1))
    prompt = GROUNDING_PROMPT.format(judge_list=judge_list)
    usage_info: dict = {"total_tokens": 0, "estimated_cost": 0.0, "duration_s": 0, "search_queries": 0}

    print(f"\n{'='*60}")
    print(f"Batch {batch_num}/{total_batches}: Grounding search for {len(names)} judges")
    print(f"  Names: {', '.join(names)}")
    print(f"{'='*60}")

    start_time = time.time()
    response = None
    try:
        response = client.models.generate_content(
            model=GROUNDING_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
        duration = round(time.time() - start_time, 1)
        usage_info["duration_s"] = duration

        # Extract token usage
        if response.usage_metadata:
            input_tok = response.usage_metadata.prompt_token_count or 0
            output_tok = response.usage_metadata.candidates_token_count or 0
            total_tok = input_tok + output_tok
            usage_info["total_tokens"] = total_tok

            # Count search queries from grounding metadata
            search_count = 0
            if response.candidates and response.candidates[0].grounding_metadata:
                gm = response.candidates[0].grounding_metadata
                if hasattr(gm, "web_search_queries") and gm.web_search_queries:
                    search_count = len(gm.web_search_queries)
                    usage_info["search_queries"] = search_count

            # Cost = tokens + search queries
            token_cost = (
                input_tok / 1_000_000 * PRO_INPUT_COST_PER_M
                + output_tok / 1_000_000 * PRO_OUTPUT_COST_PER_M
            )
            search_cost = search_count * SEARCH_COST_PER_QUERY
            usage_info["estimated_cost"] = round(token_cost + search_cost, 4)
            print(f"  Tokens: {total_tok:,} (in:{input_tok:,} out:{output_tok:,})")
            print(f"  Searches: {search_count} | Est. cost: ${usage_info['estimated_cost']:.4f}")

        text = response.text.strip()
        print(f"  Completed in {duration}s! Response: {len(text):,} chars")

        # Parse JSON from response — handle markdown wrapping
        # Model sometimes prepends explanatory text before the JSON block
        if text.startswith("```"):
            first_nl = text.index("\n") if "\n" in text else 3
            text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:text.rfind("```")]
        # If there's still non-JSON text before the opening brace, extract it
        brace_idx = text.find("{")
        if brace_idx > 0:
            text = text[brace_idx:]
        # Same for trailing content after closing brace
        last_brace = text.rfind("}")
        if last_brace >= 0 and last_brace < len(text) - 1:
            text = text[:last_brace + 1]

        parsed = json.loads(text.strip())

        # Remap keys: model might use surname-only or slightly different casing.
        # Match parsed keys to the requested names using fuzzy surname matching.
        remapped: dict = {}
        unmatched_keys = set(parsed.keys())
        for name in names:
            key = name.lower()
            if key in parsed:
                remapped[key] = parsed[key]
                unmatched_keys.discard(key)
            else:
                # Try surname match: last word of name
                surname = key.split()[-1] if " " in key else key
                for pkey in list(unmatched_keys):
                    if pkey == surname or pkey.endswith(surname) or surname in pkey:
                        remapped[key] = parsed[pkey]
                        unmatched_keys.discard(pkey)
                        break
        parsed = remapped

        # Extract grounding source URLs and attach to bios
        if response.candidates and response.candidates[0].grounding_metadata:
            gm = response.candidates[0].grounding_metadata
            if hasattr(gm, "grounding_chunks") and gm.grounding_chunks:
                for chunk in gm.grounding_chunks:
                    if hasattr(chunk, "web") and chunk.web:
                        # Try to match chunk to a judge bio that lacks a source_url
                        for key, bio in parsed.items():
                            if bio.get("full_name") and not bio.get("source_url"):
                                bio["source_url"] = chunk.web.uri
                                break

        return parsed, usage_info

    except json.JSONDecodeError as e:
        duration = round(time.time() - start_time, 1)
        usage_info["duration_s"] = duration
        raw = response.text[:300] if response else "(no response)"
        print(f"  JSON parse error: {e}")
        print(f"  Raw response: {raw}...")
        return {
            name.lower(): {"full_name": None, "parse_error": True}
            for name in names
        }, usage_info
    except Exception as e:
        duration = round(time.time() - start_time, 1)
        usage_info["duration_s"] = duration
        print(f"  ERROR: {e}")
        return {}, usage_info


def parse_report_to_json(client, report: str, names: list[str]) -> dict:
    """Use Gemini Flash to parse a text report into structured JSON."""
    prompt = PARSE_PROMPT.format(report=report)
    try:
        response = client.models.generate_content(
            model=FLASH_MODEL,
            contents=prompt,
        )
        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            first_newline = text.index("\n") if "\n" in text else 3
            text = text[first_newline + 1:]
        if text.endswith("```"):
            text = text[:text.rfind("```")]
        parsed = json.loads(text.strip())
        return parsed
    except json.JSONDecodeError as e:
        print(f"  JSON parse error: {e}")
        # Fallback: store raw report for each judge
        return {
            name.lower(): {"full_name": None, "raw_report": report[:500], "parse_error": True}
            for name in names
        }
    except Exception as e:
        print(f"  Flash parse error: {e}")
        return {}


def main():
    parser = argparse.ArgumentParser(description="Fetch judge bios via Gemini")
    parser.add_argument("--limit", type=int, default=20, help="Number of top judges to fetch (default: 20)")
    parser.add_argument("--names", type=str, default="", help="Comma-separated specific names")
    parser.add_argument("--batch-size", type=int, default=5, help="Judges per API call")
    parser.add_argument("--mode", choices=["deep-research", "grounding"], default="deep-research",
                        help="deep-research: thorough but expensive ($2-5/batch). grounding: fast+cheap (~$0.05/batch)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be queried")
    parser.add_argument("--enrich", action="store_true",
                        help="Re-fetch judges with incomplete data (missing education, career, etc.)")
    args = parser.parse_args()

    # Load judge names
    if args.names:
        all_names = [n.strip() for n in args.names.split(",") if n.strip()]
    else:
        print(f"Loading top {args.limit} judges from CSV...")
        all_names = get_top_judges(args.limit)

    bios = load_existing_bios()

    if args.enrich:
        # Re-fetch judges with incomplete data (have bio but missing key fields)
        names_to_fetch = []
        for n in all_names:
            key = n.lower()
            bio = bios.get(key)
            if not bio or not bio.get("full_name"):
                continue  # skip not-found entries
            has_edu = bio.get("education") and len(bio.get("education", [])) > 0
            has_career = bio.get("previously")
            has_birth_year = bio.get("birth_year")
            has_social = bio.get("social_media") and len(bio.get("social_media", {})) > 0
            if not has_edu or not has_career or not has_birth_year or not has_social:
                names_to_fetch.append(n)
        print(f"Enrich mode: {len(names_to_fetch)} judges with incomplete data (missing education, career, birth_year, or social_media)")
    else:
        # Filter out already-fetched judges
        names_to_fetch = [n for n in all_names if n.lower() not in bios]
    print(f"Total judges: {len(all_names)}, already fetched: {len(all_names) - len(names_to_fetch)}, to fetch: {len(names_to_fetch)}")

    if not names_to_fetch:
        print("All judges already have bios. Nothing to do.")
        return

    # Create batches
    batches = []
    for i in range(0, len(names_to_fetch), args.batch_size):
        batches.append(names_to_fetch[i:i + args.batch_size])

    total_batches = len(batches)
    if args.mode == "deep-research":
        est_cost_low = total_batches * 2
        est_cost_high = total_batches * 5
        print("\nMode: Deep Research (thorough, slow)")
        print(f"Plan: {total_batches} calls × {args.batch_size} judges/batch")
        print(f"Estimated cost: ${est_cost_low}-${est_cost_high}")
    else:
        est_cost = total_batches * 0.05
        print("\nMode: Google Search Grounding (fast, cheap)")
        print(f"Plan: {total_batches} calls × {args.batch_size} judges/batch")
        print(f"Estimated cost: ~${est_cost:.2f}")

    if args.dry_run:
        print("\n--- DRY RUN ---")
        for i, batch in enumerate(batches, 1):
            print(f"Batch {i}: {', '.join(batch)}")
        print(f"\nTotal: {total_batches} batches, {len(names_to_fetch)} judges")
        return

    # Initialize client
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # Try gcloud Application Default Credentials
        print("No GEMINI_API_KEY found, trying gcloud ADC...")

    from google import genai

    client_kwargs = {}
    if api_key:
        client_kwargs["api_key"] = api_key

    client = genai.Client(**client_kwargs)
    print(f"Gemini client initialized (API key: {'set' if api_key else 'ADC'})")

    # Process batches with cost tracking
    total_fetched = 0
    total_tokens_all = 0
    total_cost_all = 0.0
    batch_stats: list[dict] = []

    for batch_num, batch in enumerate(batches, 1):
        if args.mode == "grounding":
            parsed, usage = grounding_search_batch(client, batch, batch_num, total_batches)
        else:
            report, usage = deep_research_batch(client, batch, batch_num, total_batches)
            if not report:
                # Mark as not found so we don't retry automatically
                for name in batch:
                    bios[name.lower()] = {"full_name": None, "not_found": True, "research_failed": True}
                # Record stats even for failures
                total_tokens_all += usage["total_tokens"]
                total_cost_all += usage["estimated_cost"]
                batch_stats.append({
                    "batch": batch_num, "names": batch, "tokens": usage["total_tokens"],
                    "cost": usage["estimated_cost"], "duration_s": usage["duration_s"], "success": False,
                })
                save_bios(bios)
                continue
            print("  Parsing report with Gemini Flash...")
            parsed = parse_report_to_json(client, report, batch)

        # Accumulate token/cost stats
        total_tokens_all += usage["total_tokens"]
        total_cost_all += usage["estimated_cost"]
        batch_stats.append({
            "batch": batch_num,
            "names": batch,
            "tokens": usage["total_tokens"],
            "cost": usage["estimated_cost"],
            "duration_s": usage["duration_s"],
            "success": bool(parsed),
        })

        for name in batch:
            key = name.lower()
            bio = parsed.get(key)
            if bio and bio.get("full_name"):
                if args.enrich and key in bios and bios[key].get("full_name"):
                    # Merge: keep existing fields, update with new non-empty fields
                    existing = bios[key]
                    for field, value in bio.items():
                        if value and value != [] and value != "null":
                            existing[field] = value
                    bios[key] = existing
                    print(f"    {name}: enriched")
                else:
                    bios[key] = bio
                    print(f"    {name}: found")
                total_fetched += 1
            elif not args.enrich:
                bios[key] = {"full_name": None, "not_found": True}
                print(f"    {name}: not in parsed output")
            else:
                print(f"    {name}: no new data")

        save_bios(bios)
        print(f"  Saved checkpoint. Total bios: {len(bios)}")

        # Brief pause between batches
        if batch_num < total_batches:
            time.sleep(5)

    # Final cost summary
    print(f"\n{'='*60}")
    print("COST SUMMARY")
    print(f"{'='*60}")
    print(f"Batches completed: {len(batch_stats)}")
    print(f"Judges fetched:    {total_fetched} (with bio data)")
    print(f"Total tokens:      {total_tokens_all:,}")
    print(f"Estimated cost:    ${total_cost_all:.2f}")
    if total_fetched > 0:
        print(f"Cost per judge:    ${total_cost_all / total_fetched:.2f}")
    print(f"Total bios in file: {len(bios)}")
    print()

    for stat in batch_stats:
        success = "OK" if stat["success"] else "FAIL"
        print(
            f"  Batch {stat['batch']}: {stat['tokens']:>8,} tokens "
            f"| ${stat['cost']:.3f} | {stat['duration_s']}s | {success} "
            f"| {', '.join(stat['names'])}"
        )


if __name__ == "__main__":
    main()
