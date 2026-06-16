import os
from unittest.mock import patch

from immi_case_downloader.web import create_app


def _app():
    with patch.dict(os.environ, {"SECRET_KEY": "test-key"}, clear=False):
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
    assert client.post(
        "/internal/extract",
        json=payload,
        headers={
            "X-Internal-Route": "worker",
            "X-Internal-Route-Subtype": "cron-extract",
        },
    ).status_code == 200


def test_internal_extract_returns_field_envelopes_without_echoing_full_text():
    client = _app().test_client()
    text = (
        "Applicant v Minister [2026] FCA 42\n"
        "The applicant is a citizen of India and applied for a Subclass 866 visa. "
        "The applicant was represented by Mr Smith. "
        "This body is intentionally longer than fifty characters."
    )

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
        headers={
            "X-Internal-Route": "worker",
            "X-Internal-Route-Subtype": "cron-extract",
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    item = body["extracted"][0]
    assert item["case_id"] == "abcdef123456"
    assert item["fields"]["country_of_origin"]["value"] == "India"
    assert item["fields"]["visa_subclass_number"]["value"] == "866"
    assert "full_text" not in item["base"]
