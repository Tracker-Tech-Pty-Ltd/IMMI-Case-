"""Regression tests for the AI Gateway extraction client's failure handling."""

import io
import json
from unittest.mock import patch

from immi_case_downloader.extraction.llm import extract_llm


def _call(body: bytes):
    # io.BytesIO is already a context manager whose __enter__ returns self and
    # whose read() returns bytes, which is all `with urlopen(...) as response`
    # needs from the stand-in.
    with patch("urllib.request.urlopen", return_value=io.BytesIO(body)):
        return extract_llm(
            "The applicant is a citizen of India.",
            ["country_of_origin"],
            gateway_url="https://gateway.test/compat/chat/completions",
            token="test-token",
        )


def test_non_utf8_body_returns_no_extraction_instead_of_raising():
    values, cost = _call(b"\xff\xfe\x00garbage")

    assert values == {}
    assert cost == 0.0


def test_malformed_json_body_returns_no_extraction():
    values, cost = _call(b"not json at all")

    assert values == {}
    assert cost == 0.0


def test_valid_body_returns_values_and_estimated_cost():
    body = json.dumps(
        {
            "choices": [
                {"message": {"content": '{"country_of_origin": "India"}'}}
            ],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 1000},
        }
    ).encode("utf-8")

    values, cost = _call(body)

    assert values == {"country_of_origin": "India"}
    assert cost == 0.0004
