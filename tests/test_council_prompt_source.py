"""The Python council engine must read its prompts from the canonical JSON."""
import json
import re

from immi_case_downloader.llm_council import (
    _COUNCIL_PROMPTS_PATH,
    DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
    DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
    DEFAULT_MODERATOR_SYSTEM_PROMPT,
    DEFAULT_OPENAI_SYSTEM_PROMPT,
)


def test_constants_come_from_the_canonical_json():
    payload = json.loads(_COUNCIL_PROMPTS_PATH.read_text(encoding="utf-8"))
    assert DEFAULT_OPENAI_SYSTEM_PROMPT == payload["base"]["openai"]
    assert DEFAULT_GEMINI_PRO_SYSTEM_PROMPT == payload["base"]["gemini_pro"]
    assert DEFAULT_ANTHROPIC_SYSTEM_PROMPT == payload["base"]["anthropic"]
    assert DEFAULT_MODERATOR_SYSTEM_PROMPT == payload["base"]["moderator"]


def test_base_prompts_claim_no_search_tool():
    """The Python engine attaches no tools (see llm_council.py `del with_grounding`)."""
    for prompt in (
        DEFAULT_OPENAI_SYSTEM_PROMPT,
        DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
        DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
        DEFAULT_MODERATOR_SYSTEM_PROMPT,
    ):
        assert "google_search" not in prompt
        assert "web_search" not in prompt


def test_grounded_anthropic_variant_is_available_for_the_worker():
    payload = json.loads(_COUNCIL_PROMPTS_PATH.read_text(encoding="utf-8"))
    assert "web_search" in payload["grounded"]["anthropic"]


def test_generated_worker_mirror_is_not_stale():
    """`scripts/generate_council_prompts.py --check` must pass in-tree.

    Without this, prompts.js can be hand-edited and nothing notices — the same
    failure mode this whole step exists to remove. Run the generator as a
    subprocess, exactly as tests/test_visa_registry_parity.py does for the visa
    registry generator.

    Also assert the Python and JavaScript COUNCIL_PROMPTS_VERSION values
    agree, reading the JS constant out of workers/llm-council/prompts.js with
    a regex rather than importing it.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "scripts/generate_council_prompts.py", "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    import immi_case_downloader.llm_council as llm_council

    prompts_js = (
        _COUNCIL_PROMPTS_PATH.parent.parent.parent
        / "workers"
        / "llm-council"
        / "prompts.js"
    ).read_text(encoding="utf-8")
    match = re.search(
        r'export const COUNCIL_PROMPTS_VERSION = "([0-9a-f]{12})";', prompts_js
    )
    assert match is not None, "COUNCIL_PROMPTS_VERSION not found in prompts.js"
    assert llm_council.COUNCIL_PROMPTS_VERSION == match.group(1)
