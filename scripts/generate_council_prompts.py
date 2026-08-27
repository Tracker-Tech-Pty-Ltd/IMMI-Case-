#!/usr/bin/env python3
"""Generate workers/llm-council/prompts.js from the canonical council prompts JSON.

immi_case_downloader/data/council_prompts.json is the single source of truth
for the four base LLM Council system prompts plus the grounded Anthropic
variant. The Cloudflare Worker engine cannot read a Python-side JSON file at
import time in the way llm_council.py does, so this script mirrors it into a
plain JS module of exported string constants.

Usage:
    python scripts/generate_council_prompts.py            # regenerate prompts.js
    python scripts/generate_council_prompts.py --check     # verify prompts.js is not stale

Never hand-edit workers/llm-council/prompts.js — regenerate it from the JSON
instead. workers/__tests__/council-prompt-parity.test.js fails if the two
ever diverge, and tests/test_council_prompt_source.py runs this script with
--check as part of the Python suite so a forgotten regenerate fails loudly.
"""

import argparse
import difflib
import hashlib
import json
import pathlib
import sys

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMPTS_JSON_PATH = PROJECT_ROOT / "immi_case_downloader" / "data" / "council_prompts.json"
PROMPTS_JS_PATH = PROJECT_ROOT / "workers" / "llm-council" / "prompts.js"


def _lit(s: str) -> str:
    """Render a Python string as a JSON (and therefore valid JS) string literal."""
    return json.dumps(s, ensure_ascii=False)


def render_prompts_js() -> str:
    """Build the full contents of workers/llm-council/prompts.js from the canonical JSON."""
    raw = PROMPTS_JSON_PATH.read_bytes()
    payload = json.loads(raw.decode("utf-8"))
    version = hashlib.sha256(raw).hexdigest()[:12]
    return f"""/**
 * Council system prompts for the Cloudflare Worker engine.
 *
 * GENERATED MIRROR — the canonical text lives in
 * immi_case_downloader/data/council_prompts.json, which the Python engine
 * loads directly. workers/__tests__/council-prompt-parity.test.js fails if
 * this file and that JSON ever diverge, so edit the JSON and regenerate,
 * never edit the strings here.
 *
 * DEFAULT_* are the tool-free variants used on every path that attaches no
 * provider search tool (the OpenAI-compat gateway path, which is all three
 * experts in runCouncil and the OpenAI + Gemini experts in streamCouncil).
 * ANTHROPIC_GROUNDED_SYSTEM_PROMPT is used only by streamAnthropicNative,
 * the one path that actually sends a web_search tool block.
 */

export const DEFAULT_OPENAI_SYSTEM_PROMPT = {_lit(payload["base"]["openai"])};

export const DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = {_lit(payload["base"]["gemini_pro"])};

export const DEFAULT_ANTHROPIC_SYSTEM_PROMPT = {_lit(payload["base"]["anthropic"])};

export const DEFAULT_MODERATOR_SYSTEM_PROMPT = {_lit(payload["base"]["moderator"])};

export const ANTHROPIC_GROUNDED_SYSTEM_PROMPT = {_lit(payload["grounded"]["anthropic"])};

/** sha256(council_prompts.json)[:12] — identifies the exact prompt set in logs. */
export const COUNCIL_PROMPTS_VERSION = {_lit(version)};
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify workers/llm-council/prompts.js is up to date; exit 1 with a diff if not",
    )
    args = parser.parse_args()

    generated = render_prompts_js()

    if args.check:
        if not PROMPTS_JS_PATH.exists():
            print(f"MISSING: {PROMPTS_JS_PATH} does not exist", file=sys.stderr)
            return 1
        on_disk = PROMPTS_JS_PATH.read_text(encoding="utf-8")
        if on_disk == generated:
            print("OK: generated council prompts are up to date")
            return 0
        diff = difflib.unified_diff(
            on_disk.splitlines(keepends=True),
            generated.splitlines(keepends=True),
            fromfile=str(PROMPTS_JS_PATH),
            tofile="<generated>",
        )
        sys.stdout.writelines(diff)
        return 1

    PROMPTS_JS_PATH.write_text(generated, encoding="utf-8")
    print(f"Wrote {PROMPTS_JS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
