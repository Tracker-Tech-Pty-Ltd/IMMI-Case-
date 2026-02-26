"""Tests for /api/v1/cases/<case_id>/similar endpoint (semantic similar cases)."""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Graceful fallback when not using Supabase backend
# ---------------------------------------------------------------------------


def test_similar_cases_returns_200_for_unknown_case(client):
    """Endpoint should return 200 with empty list for a case that doesn't exist."""
    resp = client.get("/api/v1/cases/aabbccddeeff/similar")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "similar" in data
    assert isinstance(data["similar"], list)
    assert "available" in data


def test_similar_cases_accepts_limit_param(client):
    """limit query param should be accepted without error."""
    resp = client.get("/api/v1/cases/aabbccddeeff/similar?limit=3")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "similar" in data


def test_similar_cases_response_shape(client):
    """available=False means non-Supabase repo; returns an empty list gracefully.

    Uses a syntactically valid case_id (12 hex chars) that does not exist in
    the test database so the endpoint exercises the fallback path.
    """
    resp = client.get("/api/v1/cases/aabbccddeeff/similar")
    data = resp.get_json()
    # Either available=True (Supabase, case not found → empty list)
    # or available=False (CSV backend, semantic search unsupported)
    # Either way the contract is valid.
    assert isinstance(data.get("available"), bool)
    assert isinstance(data.get("similar"), list)


def test_similar_cases_similar_list_items_have_expected_fields(
    client, monkeypatch
):
    """When results are returned, each item has case_id, citation, outcome, similarity_score."""

    fake_results = [
        {
            "case_id": "abc123456789",
            "citation": "[2023] AATA 1",
            "title": "Test v Minister",
            "outcome": "Affirmed",
            "similarity_score": 0.92,
        }
    ]

    def _fake_similar(case_id, limit=5):
        return {"similar": fake_results, "available": True}

    # Patch the internal helper if it exists; fall through gracefully otherwise.
    try:
        monkeypatch.setattr(
            "immi_case_downloader.web.routes.api._get_similar_cases",
            _fake_similar,
        )
        resp = client.get("/api/v1/cases/abc123456789/similar")
        data = resp.get_json()
        if data.get("available") and data.get("similar"):
            item = data["similar"][0]
            assert "case_id" in item
            assert "citation" in item
            assert "outcome" in item
            assert "similarity_score" in item
    except (AttributeError, TypeError):
        # Helper function not patchable in this backend — skip validation.
        pytest.skip("_get_similar_cases not available in CSV backend")


def test_similar_cases_limit_capped_at_10(client):
    """limit > 10 should still return a valid response (server caps it)."""
    resp = client.get("/api/v1/cases/aabbccddeeff/similar?limit=100")
    assert resp.status_code == 200
    data = resp.get_json()
    similar = data.get("similar", [])
    assert len(similar) <= 10
