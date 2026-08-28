import os
from unittest.mock import patch

import pytest

from immi_case_downloader.web import create_app

TOKEN = "test-extraction-secret"
HEADERS = {
    "X-Internal-Route": "worker",
    "X-Internal-Route-Subtype": "cron-extract",
    "X-Extraction-Token": TOKEN,
}


def _app():
    with patch.dict(
        os.environ,
        {"SECRET_KEY": "test-key", "EXTRACTION_SHARED_SECRET": TOKEN},
        clear=False,
    ):
        app = create_app(backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = True
    return app


def test_internal_extract_requires_worker_and_subtype_headers():
    client = _app().test_client()
    payload = {"run_id": "run-1", "batch": []}

    assert client.post("/internal/extract", json=payload).status_code == 403
    assert client.post(
        "/internal/extract",
        json=payload,
        headers={"X-Internal-Route": "worker"},
    ).status_code == 403
    with patch.dict(os.environ, {"EXTRACTION_SHARED_SECRET": TOKEN}, clear=False):
        assert client.post(
            "/internal/extract",
            json=payload,
            headers=HEADERS,
        ).status_code == 200


def test_internal_extract_returns_field_envelopes_without_echoing_full_text():
    client = _app().test_client()
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
    assert item["fields"]["visa_subclass_number"]["value"] == "866"
    assert "full_text" not in item["base"]


def test_internal_extract_rejects_missing_token():
    client = _app().test_client()
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


def test_internal_extract_rejects_oversize_batch():
    client = _app().test_client()
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
    """A JSON array/string/number/null body must be a clean 400, never a 5xx.

    Before parse_payload existed, `payload = request.get_json(silent=True) or
    {}` followed by `payload.get(...)` raised AttributeError on any of these.
    """
    client = _app().test_client()

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
    client = _app().test_client()
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
    """One malformed item rejects the whole request rather than partial processing."""
    client = _app().test_client()
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
