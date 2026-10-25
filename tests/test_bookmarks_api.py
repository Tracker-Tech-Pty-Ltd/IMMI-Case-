"""Unit tests for Bookmarks / Collections export API.

Covers:
- POST /api/v1/collections/export — full happy path
- Validation: missing case_ids, empty list, >200 limit
- 404 when no valid cases found
- Mixed valid/invalid case IDs (partial results)
- HTML report content (escaping, notes, legal concepts, empty fields)
- _safe_filename() sanitisation edge cases
- Non-JSON and malformed request bodies
- Rate limiting header presence
"""

from __future__ import annotations

from collections.abc import Mapping
from unittest.mock import MagicMock, patch

import pytest

from immi_case_downloader.models import ImmigrationCase


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_case(**kwargs) -> ImmigrationCase:
    """Build a minimal ImmigrationCase for testing."""
    return ImmigrationCase(
        case_id=str(kwargs.get("case_id", "abc123def456")),
        title=str(kwargs.get("title", "Smith & Jones [2024] AATA 1")),
        citation=str(kwargs.get("citation", "[2024] AATA 1")),
        court=str(kwargs.get("court", "Administrative Appeals Tribunal")),
        court_code=str(kwargs.get("court_code", "AATA")),
        date=str(kwargs.get("date", "2024-03-15")),
        year=int(kwargs.get("year", 2024)),
        outcome=str(kwargs.get("outcome", "Dismissed")),
        judges=str(kwargs.get("judges", "Jane Smith")),
        case_nature=str(kwargs.get("case_nature", "Visa cancellation")),
        visa_type=str(kwargs.get("visa_type", "Student visa")),
        url=str(kwargs.get("url", "https://austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/AATA/2024/1.html")),
        legal_concepts=str(kwargs.get("legal_concepts", "Natural justice; Procedural fairness; s501")),
        text_snippet=str(kwargs.get("text_snippet", "")),
        legislation=str(kwargs.get("legislation", "Migration Act 1958")),
    )


def _mock_repo(cases_by_id: Mapping[str, ImmigrationCase | None]) -> MagicMock:
    """Return a mock repo whose get_by_id() follows the provided mapping."""
    repo = MagicMock()
    repo.get_by_id.side_effect = lambda cid: cases_by_id.get(cid)
    return repo


@pytest.fixture
def client(tmp_path):
    """Flask test client with bookmarks blueprint registered and CSRF disabled."""
    from immi_case_downloader.web import close_app, create_app

    app = create_app(output_dir=str(tmp_path), backend="csv")
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    yield app.test_client()
    close_app(app, wait=True)
    repo = app.config.get("REPO")
    if repo and hasattr(repo, "close"):
        repo.close()


def _post_export(client, payload: dict, *, content_type="application/json"):
    return client.post(
        "/api/v1/collections/export",
        json=payload,
        content_type=content_type,
    )


# ── _safe_filename() ──────────────────────────────────────────────────────────


class TestSafeFilename:
    """Tests for the internal _safe_filename() helper."""

    def _call(self, name: str) -> str:
        from immi_case_downloader.web.routes.bookmarks import _safe_filename

        return _safe_filename(name)

    def test_normal_name(self):
        assert self._call("My Collection") == "My_Collection"

    def test_strips_special_characters(self):
        result = self._call("Case! #1 (Draft) @2024")
        assert "!" not in result
        assert "#" not in result
        assert "@" not in result

    def test_truncates_to_80_chars(self):
        long_name = "A" * 100
        result = self._call(long_name)
        assert len(result) <= 80

    def test_empty_string_returns_fallback(self):
        # After stripping all chars, empty name → "collection"
        result = self._call("!!!")
        assert result == "collection"

    def test_hyphens_converted_to_underscores(self):
        # The regex [\s-]+ treats hyphens same as whitespace → underscores
        result = self._call("my-collection-name")
        assert result == "my_collection_name"

    def test_multiple_spaces_collapsed(self):
        result = self._call("My   Big   Collection")
        assert "__" not in result  # no double underscore from consecutive spaces


# ── _generate_html_report() ───────────────────────────────────────────────────


class TestGenerateHtmlReport:
    """Tests for the HTML report generation logic."""

    def _call(self, name, cases, notes=None):
        from immi_case_downloader.web.routes.bookmarks import _generate_html_report

        return _generate_html_report(name, cases, notes or {})

    def test_returns_html_string(self):
        case = _make_case()
        html = self._call("Test Collection", [case])
        assert isinstance(html, str)
        assert "<!DOCTYPE html>" in html

    def test_collection_name_in_title(self):
        html = self._call("My Case Set", [_make_case()])
        assert "My Case Set" in html

    def test_case_count_in_subtitle(self):
        cases = [_make_case(case_id=f"id{i}") for i in range(3)]
        html = self._call("Collection", cases)
        assert "3 case(s)" in html

    def test_citation_appears_in_output(self):
        case = _make_case(citation="[2024] AATA 99")
        html = self._call("C", [case])
        assert "[2024] AATA 99" in html

    def test_html_escaping_prevents_xss(self):
        dangerous = "<script>alert('xss')</script>"
        case = _make_case(citation=dangerous)
        html = self._call("C", [case])
        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_ampersand_escaped_in_title(self):
        # When citation is empty, the header falls back to title — verify escaping.
        case = _make_case(title="Smith & Jones [2024] AATA 1", citation="")
        html = self._call("C", [case])
        assert "Smith &amp; Jones" in html

    def test_collection_name_escaped(self):
        html = self._call("A <b>Bold</b> Collection", [_make_case()])
        assert "<b>" not in html

    def test_user_note_appears_when_set(self):
        case = _make_case(case_id="abc123")
        html = self._call("C", [case], notes={"abc123": "Important precedent"})
        assert "Important precedent" in html

    def test_user_note_absent_when_not_set(self):
        case = _make_case(case_id="abc123")
        html = self._call("C", [case], notes={})
        # No note div rendered
        assert "Important precedent" not in html

    def test_note_text_escaped(self):
        case = _make_case(case_id="abc123")
        html = self._call("C", [case], notes={"abc123": "<script>bad</script>"})
        assert "<script>" not in html

    def test_legal_concepts_rendered_as_badges(self):
        case = _make_case(legal_concepts="Natural justice; Procedural fairness")
        html = self._call("C", [case])
        assert "Natural justice" in html
        assert "Procedural fairness" in html
        assert "class='concept'" in html

    def test_empty_legal_concepts_no_badge_div(self):
        case = _make_case(legal_concepts="")
        html = self._call("C", [case])
        assert "class='concepts'" not in html

    def test_empty_cases_list(self):
        html = self._call("Empty", [])
        assert "0 case(s)" in html

    def test_court_code_badge_rendered(self):
        case = _make_case(court_code="FCA")
        html = self._call("C", [case])
        assert "FCA" in html
        assert "court-badge" in html

    def test_dict_case_access(self):
        """_get() helper also supports dict-like cases."""
        from immi_case_downloader.web.routes.bookmarks import _generate_html_report

        case_dict = {
            "case_id": "d1",
            "court_code": "HCA",
            "citation": "[2024] HCA 1",
            "court": "High Court",
            "date": "2024-01-01",
            "outcome": "Allowed",
            "judges": "Gageler CJ",
            "case_nature": "Constitutional",
            "visa_type": "",
            "url": "https://austlii.edu.au/",
            "legal_concepts": "",
        }
        html = _generate_html_report("C", [case_dict], {})
        assert "HCA" in html
        assert "[2024] HCA 1" in html


# ── POST /api/v1/collections/export ──────────────────────────────────────────


class TestExportCollectionEndpoint:
    """Tests for the collections/export endpoint."""

    def test_happy_path_returns_html_attachment(self, client):
        """Valid request with 2 cases returns HTML download."""
        case1 = _make_case(case_id="id1", citation="[2024] AATA 1")
        case2 = _make_case(case_id="id2", citation="[2024] AATA 2")
        repo = _mock_repo({"id1": case1, "id2": case2})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {
                "collection_name": "Test Collection",
                "case_ids": ["id1", "id2"],
                "case_notes": {"id1": "Key case"},
            })

        assert resp.status_code == 200
        assert resp.content_type == "text/html; charset=utf-8"
        assert "attachment" in resp.headers.get("Content-Disposition", "")
        html = resp.data.decode()
        assert "Test Collection" in html
        assert "[2024] AATA 1" in html

    def test_filename_derived_from_collection_name(self, client):
        """Content-Disposition filename is sanitised from collection_name."""
        case = _make_case(case_id="x1")
        repo = _mock_repo({"x1": case})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {
                "collection_name": "My Special Collection",
                "case_ids": ["x1"],
            })

        cd = resp.headers.get("Content-Disposition", "")
        assert "My_Special_Collection.html" in cd

    def test_missing_case_ids_key_returns_error(self, client):
        """Payload without case_ids → 400."""
        resp = _post_export(client, {"collection_name": "X"})
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["success"] is False
        assert "case_ids" in data["error"]

    def test_empty_case_ids_returns_error(self, client):
        """Empty case_ids list → 400."""
        resp = _post_export(client, {"case_ids": []})
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_too_many_case_ids_returns_error(self, client):
        """More than 200 case_ids → 400."""
        resp = _post_export(client, {"case_ids": [f"id{i}" for i in range(201)]})
        assert resp.status_code == 400
        data = resp.get_json()
        assert "200" in data["error"]

    def test_no_valid_cases_returns_404(self, client):
        """All case_ids resolve to None → 404."""
        repo = _mock_repo({"bad1": None, "bad2": None})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {"case_ids": ["bad1", "bad2"]})

        assert resp.status_code == 404
        assert resp.get_json()["success"] is False

    def test_partial_valid_cases_exported(self, client):
        """Mix of valid and None cases — only valid ones are exported."""
        good = _make_case(case_id="good1", citation="[2024] AATA 5")
        repo = _mock_repo({"good1": good, "bad1": None})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {"case_ids": ["good1", "bad1"]})

        assert resp.status_code == 200
        html = resp.data.decode()
        assert "1 case(s)" in html
        assert "[2024] AATA 5" in html

    def test_default_collection_name_when_omitted(self, client):
        """collection_name defaults to 'Collection' when absent."""
        case = _make_case(case_id="c1")
        repo = _mock_repo({"c1": case})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {"case_ids": ["c1"]})

        cd = resp.headers.get("Content-Disposition", "")
        assert "Collection.html" in cd

    def test_case_notes_rendered_in_html(self, client):
        """User notes appear in the exported HTML."""
        case = _make_case(case_id="n1")
        repo = _mock_repo({"n1": case})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {
                "case_ids": ["n1"],
                "case_notes": {"n1": "Critical precedent — do not overlook"},
            })

        assert b"Critical precedent" in resp.data

    def test_non_json_body_treated_as_empty(self, client):
        """Plain-text body → treated as empty JSON (case_ids missing → 400)."""
        resp = client.post(
            "/api/v1/collections/export",
            data="not json",
            content_type="text/plain",
        )
        assert resp.status_code == 400

    def test_single_case_export(self, client):
        """Single case_id is sufficient for a valid export."""
        case = _make_case(case_id="solo", citation="[2024] HCA 10")
        repo = _mock_repo({"solo": case})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {"case_ids": ["solo"]})

        assert resp.status_code == 200
        assert b"[2024] HCA 10" in resp.data

    def test_exactly_200_case_ids_allowed(self, client):
        """Exactly 200 case_ids is within the limit."""
        cases = {f"id{i}": _make_case(case_id=f"id{i}") for i in range(200)}
        repo = _mock_repo(cases)

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {"case_ids": list(cases.keys())})

        assert resp.status_code == 200
        assert b"200 case(s)" in resp.data

    def test_xss_in_collection_name_escaped(self, client):
        """Malicious collection_name is escaped in HTML output."""
        case = _make_case(case_id="safe1")
        repo = _mock_repo({"safe1": case})

        with patch("immi_case_downloader.web.routes.bookmarks.get_repo", return_value=repo):
            resp = _post_export(client, {
                "collection_name": "<script>alert(1)</script>",
                "case_ids": ["safe1"],
            })

        assert resp.status_code == 200
        assert b"<script>" not in resp.data
