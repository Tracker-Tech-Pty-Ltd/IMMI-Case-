"""HTTP-level tests for the container's own Flask adapter.

tests/test_internal_extract.py covers the blueprint adapter through
create_app(). Both adapters bind to the single implementation in
immi_case_downloader/extraction/service.py, so this module re-runs the same
rejection cases plus the authenticated 200 case against the container app
directly (extract_container.app) — otherwise a passing service.py test suite
would not notice one adapter forgetting to call parse_payload.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

TOKEN = "test-extraction-secret"
HEADERS = {
    "X-Internal-Route": "worker",
    "X-Internal-Route-Subtype": "cron-extract",
    "X-Extraction-Token": TOKEN,
}


def _client():
    # Imported inside the test function rather than at collection time: the
    # module defines app = Flask(__name__) at import time, and importing it
    # eagerly would run that before any test fixture has a chance to act.
    from extract_container import app

    app.config["TESTING"] = True
    return app.test_client()


def test_health_returns_ok():
    client = _client()

    response = client.get("/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_internal_extract_requires_worker_and_subtype_headers():
    client = _client()
    payload = {"run_id": "run-1", "batch": []}

    assert client.post("/internal/extract", json=payload).status_code == 403
    assert (
        client.post(
            "/internal/extract",
            json=payload,
            headers={"X-Internal-Route": "worker"},
        ).status_code
        == 403
    )


def test_internal_extract_rejects_missing_token():
    client = _client()
    payload = {"run_id": "run-1", "batch": []}

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json=payload,
            headers={
                "X-Internal-Route": "worker",
                "X-Internal-Route-Subtype": "cron-extract",
            },
        )

    assert response.status_code == 403
    assert response.get_json()["code"] == "invalid_extraction_token"


def test_internal_extract_authenticated_request_returns_field_envelopes():
    client = _client()
    text = (
        "Applicant v Minister [2026] FCA 42\n"
        "The applicant is a citizen of India and applied for a Subclass 866 visa. "
        "The applicant was represented by Mr Smith. "
        "This body is intentionally longer than fifty characters."
    )

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json={
                "run_id": "run-1",
                "batch": [
                    {
                        "case_id": "abcdef123456",
                        "r2_key": "runs/run-1/FCA/abcdef123456.json",
                        "base": {
                            "title": "Applicant v Minister [2026] FCA 42",
                            "court_code": "FCA",
                            "full_text": text,
                        },
                    }
                ],
            },
            headers=HEADERS,
        )

    assert response.status_code == 200
    body = response.get_json()
    item = body["extracted"][0]
    assert item["case_id"] == "abcdef123456"
    assert item["fields"]["country_of_origin"]["value"] == "India"
    assert "full_text" not in item["base"]


def test_internal_extract_rejects_oversize_batch():
    client = _client()
    payload = {"run_id": "run-1", "batch": [{} for _ in range(21)]}

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json=payload,
            headers=HEADERS,
        )

    assert response.status_code == 400
    assert response.get_json()["code"] == "bad_payload"


@pytest.mark.parametrize("body", [[1, 2], "hello", 7, None])
def test_internal_extract_rejects_non_object_payloads(body):
    client = _client()

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json=body,
            headers=HEADERS,
        )

    assert response.status_code == 400
    assert response.get_json()["code"] == "bad_payload"


@pytest.mark.parametrize(
    "batch",
    [
        ["not-a-dict"],
        [{"base": "not-a-mapping"}],
    ],
)
def test_internal_extract_rejects_bad_item_shapes(batch):
    client = _client()
    payload = {"run_id": "run-1", "batch": batch}

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json=payload,
            headers=HEADERS,
        )

    assert response.status_code == 400
    assert response.get_json()["code"] == "bad_payload"


def test_internal_extract_rejects_mixed_valid_and_invalid_items():
    client = _client()
    payload = {
        "run_id": "run-1",
        "batch": [
            {"case_id": "abcdef123456", "base": {"title": "A v B", "full_text": "text"}},
            [],
        ],
    }

    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        response = client.post(
            "/internal/extract",
            json=payload,
            headers=HEADERS,
        )

    assert response.status_code == 400
    assert response.get_json()["code"] == "bad_payload"
