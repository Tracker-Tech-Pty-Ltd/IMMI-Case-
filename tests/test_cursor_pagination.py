"""Tests for next_cursor token exposure in /api/v1/cases API response.

TDD: these tests are written BEFORE implementation and must fail initially.
"""

import base64
import json


# ── helpers ──────────────────────────────────────────────────────────────────


def _decode_cursor(cursor: str) -> dict | None:
    """Decode a base64url cursor token into its payload dict."""
    try:
        padded = cursor + "=" * (4 - len(cursor) % 4)
        payload = base64.urlsafe_b64decode(padded).decode()
        return json.loads(payload)
    except Exception:
        return None


# ── tests ─────────────────────────────────────────────────────────────────────


def test_cases_response_has_next_cursor_field(client, sample_cases):
    """API response must include a next_cursor field."""
    resp = client.get("/api/v1/cases?page=1&page_size=5")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "next_cursor" in data, "Response must contain 'next_cursor' key"


def test_next_cursor_is_present_when_more_pages_exist(client, sample_cases):
    """next_cursor is non-None when there is at least one more page."""
    # sample_cases fixture has 5 cases; page_size=2 means 3 pages
    resp = client.get("/api/v1/cases?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "next_cursor" in data
    # With 5 cases and page_size=2, page 1 has more pages → cursor should be set
    assert data["next_cursor"] is not None, (
        "next_cursor should be non-None when additional pages exist"
    )


def test_next_cursor_is_none_on_last_page(client, sample_cases):
    """next_cursor must be None (or absent) on the last page."""
    # 5 cases, page_size=5 → only 1 page, no next cursor
    resp = client.get("/api/v1/cases?page=1&page_size=5")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "next_cursor" in data
    # Single page: no next cursor
    total_pages = data.get("total_pages", 1)
    if total_pages == 1:
        assert data["next_cursor"] is None, (
            "next_cursor should be None on the last/only page"
        )


def test_next_cursor_is_none_when_no_cases(client):
    """next_cursor must be None when the result set is empty."""
    # Filter for a court that doesn't exist in fixtures
    resp = client.get("/api/v1/cases?court=NONEXISTENT&page=1")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "next_cursor" in data
    assert data["next_cursor"] is None


def test_next_cursor_is_valid_base64url(client, sample_cases):
    """When non-None, the cursor must be a valid base64url-encoded JSON."""
    resp = client.get("/api/v1/cases?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.get_json()
    cursor = data.get("next_cursor")
    if cursor is not None:
        decoded = _decode_cursor(cursor)
        assert decoded is not None, "Cursor must decode to valid JSON"
        assert "year" in decoded, "Cursor payload must contain 'year'"
        assert "case_id" in decoded, "Cursor payload must contain 'case_id'"


def test_next_cursor_case_id_matches_last_case(client, sample_cases):
    """The cursor's case_id must match the last case returned on that page."""
    resp = client.get("/api/v1/cases?page=1&page_size=2")
    assert resp.status_code == 200
    data = resp.get_json()
    cursor = data.get("next_cursor")
    cases = data.get("cases", [])
    if cursor is not None and cases:
        decoded = _decode_cursor(cursor)
        assert decoded is not None
        last_case_id = cases[-1].get("case_id")
        assert decoded["case_id"] == last_case_id, (
            f"Cursor case_id {decoded['case_id']!r} must match last case {last_case_id!r}"
        )


def test_next_cursor_roundtrip(client, sample_cases):
    """Page 2 response is reachable; response is valid JSON with next_cursor field."""
    resp1 = client.get("/api/v1/cases?page=1&page_size=2")
    assert resp1.status_code == 200
    data1 = resp1.get_json()
    assert "next_cursor" in data1

    # Page 2 via normal pagination should also have the field
    resp2 = client.get("/api/v1/cases?page=2&page_size=2")
    assert resp2.status_code == 200
    data2 = resp2.get_json()
    assert "next_cursor" in data2
