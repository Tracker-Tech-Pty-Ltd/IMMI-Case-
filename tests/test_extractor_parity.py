"""Golden-corpus guard for the two case-metadata extractors.

`immi_case_downloader/sources/metadata_extractor.py` (Python) and
`workers/austlii-scraper/src/parser.ts` (TypeScript) extract the same fields
from the same case text. These tests pin the Python side to the corpus in
`tests/fixtures/extractor_parity/`; the Worker side is pinned by
`workers/austlii-scraper/src/__tests__/extractor-parity.test.ts` against the
generated mirror of that same corpus.

The expected values record today's behaviour, warts included. This is a parity
gate, not a quality gate — changing an expectation means changing what 149k
stored records mean.
"""

import json
import os
import subprocess
import sys

import pytest

from immi_case_downloader.sources.metadata_extractor import MetadataExtractor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "extractor_parity")
EXPECTED_PATH = os.path.join(FIXTURE_DIR, "expected.json")
GENERATOR = os.path.join(REPO_ROOT, "scripts", "generate_extractor_corpus.py")

# The Worker returns every key, defaulting to "", and calls Python's "citation"
# key "citation_extracted". Map the Python result onto that shape to compare.
_PLAIN_KEYS = (
    "judges",
    "date",
    "catchwords",
    "outcome",
    "visa_type",
    "legislation",
)


def _load_expected() -> dict:
    with open(EXPECTED_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _to_worker_shape(result: dict) -> dict:
    shaped = {key: result.get(key, "") for key in _PLAIN_KEYS}
    shaped["citation_extracted"] = result.get("citation", "")
    return shaped


@pytest.mark.parametrize("name", sorted(_load_expected()))
def test_python_extractor_matches_golden_corpus(name):
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as handle:
        text = handle.read()
    actual = _to_worker_shape(MetadataExtractor().extract(text))
    assert actual == _load_expected()[name]


def test_generated_worker_corpus_is_not_stale():
    result = subprocess.run(
        [sys.executable, GENERATOR, "--check"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        "extractor-parity-corpus.ts is stale. Run: "
        "python3 scripts/generate_extractor_corpus.py\n" + result.stderr
    )


def test_corpus_covers_the_judge_label_regressions():
    # These three fixtures are the cases where the TypeScript extractor used to
    # disagree with Python: an unanchored /JUSTICE/ dropped the title from
    # "BEFORE: Justice A Nguyen", and a bare /MEMBER|JUDGE/ matched prose.
    expected = _load_expected()
    assert expected["fca_judicial_review_dismissed.txt"]["judges"] == "Justice A Nguyen"
    assert expected["member_label_mid_line.txt"]["judges"] == ""
    assert expected["judge_label_mid_line.txt"]["judges"] == ""
