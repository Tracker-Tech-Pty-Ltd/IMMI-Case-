"""Tests for /api/v1/llm-council/run endpoint."""

from __future__ import annotations

from immi_case_downloader.models import ImmigrationCase
import immi_case_downloader.web.routes.api as api_module


def test_llm_council_rejects_missing_question(client):
    resp = client.post("/api/v1/llm-council/run", json={})
    assert resp.status_code == 400
    data = resp.get_json()
    assert "question is required" in data["error"]


def test_llm_council_health_defaults_to_config_only_probe(client, monkeypatch):
    observed: dict = {}

    def _fake_validate(*, live: bool):
        observed["live"] = live
        return {"ok": True, "live_probe": live, "providers": {}}

    monkeypatch.setattr(api_module, "validate_council_connectivity", _fake_validate)

    resp = client.get("/api/v1/llm-council/health")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["ok"] is True
    assert payload["live_probe"] is False
    assert observed["live"] is False


def test_llm_council_health_accepts_live_query_flag(client, monkeypatch):
    observed: dict = {}

    def _fake_validate(*, live: bool):
        observed["live"] = live
        return {"ok": True, "live_probe": live, "providers": {}}

    monkeypatch.setattr(api_module, "validate_council_connectivity", _fake_validate)

    resp = client.get("/api/v1/llm-council/health?live=1")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["live_probe"] is True
    assert observed["live"] is True


def test_llm_council_rejects_invalid_case_id(client):
    resp = client.post(
        "/api/v1/llm-council/run",
        json={"question": "test question", "case_id": "bad-id"},
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert "Invalid case ID" in data["error"]


def test_llm_council_rejects_missing_case(client, monkeypatch):
    class _Repo:
        def get_by_id(self, _case_id):
            return None

    monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())

    resp = client.post(
        "/api/v1/llm-council/run",
        json={"question": "test question", "case_id": "aaaaaaaaaaaa"},
    )
    assert resp.status_code == 404
    data = resp.get_json()
    assert "Case not found" in data["error"]


def test_llm_council_runs_and_passes_compact_case_context(client, monkeypatch):
    case = ImmigrationCase(
        case_id="aaaaaaaaaaaa",
        citation="[2024] AATA 999",
        title="Applicant v Minister",
        court_code="AATA",
        outcome="Dismissed",
        visa_subclass="866",
        case_nature="Protection",
        legal_concepts="Credibility",
        text_snippet="Tribunal did not accept key evidence.",
    )

    class _Repo:
        def get_by_id(self, _case_id):
            return case

    observed: dict = {}

    def _fake_run(*, question, case_context):
        observed["question"] = question
        observed["case_context"] = case_context
        return {
            "question": question,
            "case_context": case_context,
            "models": {},
            "opinions": [],
            "moderator": {"success": True, "ranking": []},
        }

    monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
    monkeypatch.setattr(api_module, "run_immi_council", _fake_run)

    resp = client.post(
        "/api/v1/llm-council/run",
        json={
            "question": "What are the strongest grounds for review?",
            "case_id": "aaaaaaaaaaaa",
            "context": "Focus on procedural fairness.",
        },
    )
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["question"] == "What are the strongest grounds for review?"
    assert "Citation: [2024] AATA 999" in observed["case_context"]
    assert "User Context: Focus on procedural fairness." in observed["case_context"]
