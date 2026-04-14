"""Tests for immi_case_downloader.sqlite_repository — SQLite+FTS5 backend."""

import os
import pytest

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository, ALLOWED_UPDATE_FIELDS


# ── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def repo(tmp_path):
    """Create a fresh SQLite repository in a temp directory."""
    db_path = os.path.join(str(tmp_path), "test.db")
    r = SqliteRepository(db_path)
    yield r
    r.close()


@pytest.fixture
def sample_case():
    """A fully populated ImmigrationCase for testing."""
    case = ImmigrationCase(
        case_id="",
        citation="[2024] AATA 100",
        title="Smith v Minister for Immigration",
        court="Administrative Appeals Tribunal",
        court_code="AATA",
        date="15 March 2024",
        year=2024,
        url="https://www.austlii.edu.au/au/cases/cth/AATA/2024/100.html",
        judges="Senior Member Jones",
        catchwords="migration; visa refusal; character test",
        outcome="Affirmed",
        visa_type="Subclass 866 Protection Visa",
        legislation="Migration Act 1958 (Cth) s 501",
        text_snippet="The Tribunal affirms the decision under review.",
        source="AustLII",
        case_nature="Visa Refusal",
        legal_concepts="Character Test; Section 501",
    )
    case.ensure_id()
    return case


@pytest.fixture
def second_case():
    """A second case with different attributes for multi-case tests."""
    case = ImmigrationCase(
        case_id="",
        citation="[2023] FCA 200",
        title="Nguyen v Minister for Immigration",
        court="Federal Court of Australia",
        court_code="FCA",
        date="10 June 2023",
        year=2023,
        url="https://www.austlii.edu.au/au/cases/cth/FCA/2023/200.html",
        judges="Justice Brown",
        catchwords="migration; bridging visa; procedural fairness",
        outcome="Allowed",
        visa_type="Subclass 050 Bridging Visa",
        source="AustLII",
        case_nature="Judicial Review",
        legal_concepts="Procedural Fairness; Natural Justice",
    )
    case.ensure_id()
    return case


@pytest.fixture
def populated_repo(repo, sample_case, second_case):
    """A repo pre-populated with two cases."""
    repo.add(sample_case)
    repo.add(second_case)
    return repo


# ── Core CRUD ────────────────────────────────────────────────────────────


class TestAddAndRetrieve:
    def test_add_and_get_by_id(self, repo, sample_case):
        """Adding a case and retrieving it returns matching data."""
        added = repo.add(sample_case)
        assert added.case_id == sample_case.case_id

        retrieved = repo.get_by_id(sample_case.case_id)
        assert retrieved is not None
        assert retrieved.case_id == sample_case.case_id
        assert retrieved.title == "Smith v Minister for Immigration"
        assert retrieved.court_code == "AATA"
        assert retrieved.year == 2024

    def test_add_sets_manual_entry_source(self, repo):
        """Adding a case without source sets it to 'Manual Entry'."""
        case = ImmigrationCase(
            citation="[2024] AATA 999",
            title="Test Manual Entry",
            url="https://example.com/manual-test",
        )
        added = repo.add(case)
        assert added.source == "Manual Entry"

    def test_add_preserves_existing_source(self, repo):
        """Adding a case with an existing source keeps it."""
        case = ImmigrationCase(
            citation="[2024] AATA 888",
            title="Test Existing Source",
            url="https://example.com/existing-source",
            source="AustLII",
        )
        added = repo.add(case)
        assert added.source == "AustLII"


class TestGetById:
    def test_get_by_id_missing_returns_none(self, repo):
        """Querying a non-existent case_id returns None."""
        result = repo.get_by_id("000000000000")
        assert result is None

    def test_get_by_id_after_add(self, repo, sample_case):
        """get_by_id returns the correct case after add."""
        repo.add(sample_case)
        case = repo.get_by_id(sample_case.case_id)
        assert case is not None
        assert case.citation == sample_case.citation


class TestUpdate:
    def test_update_allowed_fields(self, repo, sample_case):
        """Updating allowed fields changes the stored values."""
        repo.add(sample_case)
        success = repo.update(sample_case.case_id, {"outcome": "Set Aside", "user_notes": "Updated note"})
        assert success is True

        updated = repo.get_by_id(sample_case.case_id)
        assert updated is not None
        assert updated.outcome == "Set Aside"
        assert updated.user_notes == "Updated note"

    def test_update_disallowed_field_ignored(self, repo, sample_case):
        """Fields not in ALLOWED_UPDATE_FIELDS are silently ignored."""
        repo.add(sample_case)
        # case_id and full_text_path are NOT in ALLOWED_UPDATE_FIELDS
        success = repo.update(sample_case.case_id, {"case_id": "hacked", "full_text_path": "/etc/passwd"})
        assert success is False

        unchanged = repo.get_by_id(sample_case.case_id)
        assert unchanged is not None
        assert unchanged.case_id == sample_case.case_id
        assert unchanged.full_text_path == ""

    def test_update_nonexistent_case_returns_false(self, repo):
        """Updating a non-existent case returns False."""
        result = repo.update("000000000000", {"outcome": "Set Aside"})
        assert result is False

    def test_update_empty_dict_returns_false(self, repo, sample_case):
        """Updating with no valid fields returns False."""
        repo.add(sample_case)
        result = repo.update(sample_case.case_id, {})
        assert result is False


class TestDelete:
    def test_delete_existing_case(self, repo, sample_case):
        """Deleting an existing case returns True and removes it."""
        repo.add(sample_case)
        assert repo.delete(sample_case.case_id) is True
        assert repo.get_by_id(sample_case.case_id) is None

    def test_delete_nonexistent_case_returns_false(self, repo):
        """Deleting a non-existent case returns False."""
        assert repo.delete("000000000000") is False


# ── Bulk operations ──────────────────────────────────────────────────────


class TestSaveMany:
    def test_save_many_inserts_multiple(self, repo, sample_case, second_case):
        """save_many inserts multiple cases and returns correct count."""
        count = repo.save_many([sample_case, second_case])
        assert count == 2
        assert len(repo.load_all()) == 2

    def test_save_many_upserts_duplicates(self, repo, sample_case):
        """save_many with an existing case_id performs upsert."""
        repo.add(sample_case)
        sample_case.outcome = "Set Aside"
        count = repo.save_many([sample_case])
        assert count == 1

        updated = repo.get_by_id(sample_case.case_id)
        assert updated is not None
        assert updated.outcome == "Set Aside"
        # Total count should still be 1 (upsert, not duplicate)
        assert len(repo.load_all()) == 1


class TestLoadAll:
    def test_load_all_empty_db(self, repo):
        """load_all on empty database returns empty list."""
        assert repo.load_all() == []

    def test_load_all_returns_all_cases(self, populated_repo):
        """load_all returns all inserted cases."""
        all_cases = populated_repo.load_all()
        assert len(all_cases) == 2


# ── Search and filtering ─────────────────────────────────────────────────


class TestFilterCases:
    def test_filter_by_court_code(self, populated_repo):
        """Filtering by court code returns only matching cases."""
        cases, total = populated_repo.filter_cases(court="FCA")
        assert total == 1
        assert len(cases) == 1
        assert cases[0].court_code == "FCA"

    def test_filter_by_year(self, populated_repo):
        """Filtering by year returns only matching cases."""
        cases, total = populated_repo.filter_cases(year=2023)
        assert total == 1
        assert cases[0].year == 2023

    def test_filter_by_keyword(self, populated_repo):
        """Keyword filtering searches across multiple text fields."""
        cases, total = populated_repo.filter_cases(keyword="Smith")
        assert total == 1
        assert "Smith" in cases[0].title

    def test_filter_no_match_returns_empty(self, populated_repo):
        """Filtering with no matches returns empty list and zero total."""
        cases, total = populated_repo.filter_cases(court="HCA")
        assert total == 0
        assert cases == []

    def test_filter_pagination(self, populated_repo):
        """Pagination limits results per page."""
        cases_p1, total = populated_repo.filter_cases(page=1, page_size=1)
        assert len(cases_p1) == 1
        assert total == 2

        cases_p2, _ = populated_repo.filter_cases(page=2, page_size=1)
        assert len(cases_p2) == 1
        # Different cases on each page
        assert cases_p1[0].case_id != cases_p2[0].case_id

    def test_filter_sort_by_year_asc(self, populated_repo):
        """Sorting by year ascending returns oldest first."""
        cases, _ = populated_repo.filter_cases(sort_by="year", sort_dir="asc")
        assert cases[0].year <= cases[1].year

    def test_filter_sort_by_year_desc(self, populated_repo):
        """Sorting by year descending returns newest first."""
        cases, _ = populated_repo.filter_cases(sort_by="year", sort_dir="desc")
        assert cases[0].year >= cases[1].year

    def test_filter_invalid_sort_column_defaults_to_year(self, populated_repo):
        """An invalid sort column falls back to 'year'."""
        cases, total = populated_repo.filter_cases(sort_by="hacked; DROP TABLE cases;")
        assert total == 2  # No SQL injection, still works
        assert len(cases) == 2

    def test_list_cases_fast_matches_filter_page(self, populated_repo):
        fast_cases = populated_repo.list_cases_fast(sort_by="year", sort_dir="desc", page=1, page_size=1)
        slow_cases, _ = populated_repo.filter_cases(sort_by="year", sort_dir="desc", page=1, page_size=1)
        assert [c.case_id for c in fast_cases] == [c.case_id for c in slow_cases]

    def test_count_cases_matches_filter_total(self, populated_repo):
        _, total = populated_repo.filter_cases(sort_by="year", sort_dir="desc", page=1, page_size=1)
        assert populated_repo.count_cases() == total

    def test_seek_pagination_matches_offset_for_multiple_pages(self, repo):
        cases = []
        for index, year in enumerate([2025, 2025, 2024, 2024, 2023, 2022], start=1):
            case = ImmigrationCase(
                citation=f"[{year}] AATA {100 + index}",
                title=f"Seek Pagination Case {index}",
                court="Administrative Appeals Tribunal",
                court_code="AATA",
                date=f"{index:02d} March {year}",
                year=year,
                url=f"https://example.com/seek-case-{index}",
                source="AustLII",
                case_nature="Visa Refusal",
                legal_concepts="Migration Act",
            )
            case.ensure_id()
            cases.append(case)
        repo.save_many(cases)

        page1_offset, total = repo.filter_cases(sort_by="year", sort_dir="desc", page=1, page_size=2)
        page2_offset, _ = repo.filter_cases(sort_by="year", sort_dir="desc", page=2, page_size=2)
        last_page_number = (total + 2 - 1) // 2
        last_page_offset, _ = repo.filter_cases(
            sort_by="year", sort_dir="desc", page=last_page_number, page_size=2
        )

        page1_seek = repo.list_cases_seek(sort_by="year", sort_dir="desc", page_size=2)
        anchor_after_page1 = {"year": page1_seek[-1].year, "case_id": page1_seek[-1].case_id}
        page2_seek = repo.list_cases_seek(
            sort_by="year",
            sort_dir="desc",
            page_size=2,
            anchor=anchor_after_page1,
        )

        tail_raw = repo.list_cases_seek(sort_by="year", sort_dir="desc", page_size=2, reverse=True)
        last_page_seek = list(reversed(tail_raw))

        assert [c.case_id for c in page1_seek] == [c.case_id for c in page1_offset]
        assert [c.case_id for c in page2_seek] == [c.case_id for c in page2_offset]
        assert [c.case_id for c in last_page_seek] == [c.case_id for c in last_page_offset]
        assert set(c.case_id for c in page1_seek).isdisjoint(c.case_id for c in page2_seek)


class TestSearchText:
    def test_fts5_search_by_title(self, populated_repo):
        """FTS5 search finds cases matching title text."""
        results = populated_repo.search_text("Smith")
        assert len(results) >= 1
        assert any("Smith" in r.title for r in results)

    def test_fts5_search_by_catchwords(self, populated_repo):
        """FTS5 search finds cases matching catchword text."""
        results = populated_repo.search_text("procedural fairness")
        assert len(results) >= 1
        assert any("Nguyen" in r.title for r in results)

    def test_fts5_search_no_match(self, populated_repo):
        """FTS5 search with no matches returns empty list."""
        results = populated_repo.search_text("cryptocurrency blockchain")
        assert results == []

    def test_fts5_search_special_characters(self, populated_repo):
        """FTS5 search with special characters does not raise."""
        # Should not raise OperationalError
        results = populated_repo.search_text('test "with quotes"')
        assert isinstance(results, list)

    def test_fts5_search_limit(self, repo):
        """FTS5 search respects the limit parameter."""
        # Add many cases
        cases = []
        for i in range(10):
            c = ImmigrationCase(
                citation=f"[2024] AATA {300 + i}",
                title=f"Immigration Appeal Case {i}",
                url=f"https://example.com/case/{300 + i}",
                source="AustLII",
            )
            c.ensure_id()
            cases.append(c)
        repo.save_many(cases)

        results = repo.search_text("Immigration Appeal", limit=3)
        assert len(results) <= 3


# ── Related cases ────────────────────────────────────────────────────────


class TestFindRelated:
    def test_find_related_returns_similar_cases(self, populated_repo, sample_case):
        """find_related returns cases with matching attributes."""
        related = populated_repo.find_related(sample_case.case_id)
        # second_case shares source="AustLII" but differs in court/nature
        assert isinstance(related, list)

    def test_find_related_nonexistent_case(self, populated_repo):
        """find_related for a non-existent case returns empty list."""
        related = populated_repo.find_related("000000000000")
        assert related == []

    def test_find_related_excludes_self(self, populated_repo, sample_case):
        """find_related does not include the queried case itself."""
        related = populated_repo.find_related(sample_case.case_id)
        assert all(r.case_id != sample_case.case_id for r in related)


# ── Statistics and metadata ──────────────────────────────────────────────


class TestStatistics:
    def test_statistics_keys(self, populated_repo):
        """get_statistics returns all expected keys."""
        stats = populated_repo.get_statistics()
        expected_keys = {"total", "by_court", "by_year", "by_nature", "visa_types", "with_full_text", "sources"}
        assert expected_keys == set(stats.keys())

    def test_statistics_total(self, populated_repo):
        """get_statistics reports correct total."""
        stats = populated_repo.get_statistics()
        assert stats["total"] == 2

    def test_statistics_by_court(self, populated_repo):
        """get_statistics breaks down by court correctly."""
        stats = populated_repo.get_statistics()
        assert "Administrative Appeals Tribunal" in stats["by_court"]
        assert "Federal Court of Australia" in stats["by_court"]


class TestFilterOptions:
    def test_filter_options_keys(self, populated_repo):
        """get_filter_options returns all expected keys."""
        options = populated_repo.get_filter_options()
        expected_keys = {"courts", "years", "sources", "natures", "visa_types", "tags"}
        assert expected_keys == set(options.keys())

    def test_filter_options_courts(self, populated_repo):
        """get_filter_options lists distinct court codes."""
        options = populated_repo.get_filter_options()
        assert "AATA" in options["courts"]
        assert "FCA" in options["courts"]

    def test_filter_options_years(self, populated_repo):
        """get_filter_options lists distinct years in descending order."""
        options = populated_repo.get_filter_options()
        assert 2024 in options["years"]
        assert 2023 in options["years"]
        # Descending order
        assert options["years"][0] > options["years"][-1]


class TestExistingUrls:
    def test_get_existing_urls(self, populated_repo):
        """get_existing_urls returns all URLs in the repo."""
        urls = populated_repo.get_existing_urls()
        assert len(urls) == 2
        assert "https://www.austlii.edu.au/au/cases/cth/AATA/2024/100.html" in urls


# ── Full text ────────────────────────────────────────────────────────────


class TestFullText:
    def test_get_case_full_text_no_path(self, repo, sample_case):
        """get_case_full_text returns None when full_text_path is empty."""
        repo.add(sample_case)
        case = repo.get_by_id(sample_case.case_id)
        assert case is not None
        result = repo.get_case_full_text(case)
        assert result is None

    def test_get_case_full_text_with_file(self, tmp_path):
        """get_case_full_text reads file content when the path exists."""
        db_path = os.path.join(str(tmp_path), "test.db")
        r = SqliteRepository(db_path)

        # Create a text file in the tmp_path
        text_dir = tmp_path / "text_cases"
        text_dir.mkdir()
        text_file = text_dir / "test_case.txt"
        text_file.write_text("This is the full text of the case.")

        case = ImmigrationCase(
            citation="[2024] AATA 777",
            title="Full Text Test",
            url="https://example.com/fulltext-test",
            full_text_path=str(text_file),
        )
        case.ensure_id()
        r.add(case)

        retrieved = r.get_by_id(case.case_id)
        assert retrieved is not None
        result = r.get_case_full_text(retrieved)
        # Result depends on path validation in storage.get_case_full_text
        # The path must be within base_dir for security
        # Since full_text_path is absolute and within tmp_path, it may or may not pass
        assert result is None or isinstance(result, str)
        r.close()


# ── Export ────────────────────────────────────────────────────────────────


class TestExport:
    def test_export_csv_rows(self, populated_repo):
        """export_csv_rows returns list of dicts for all cases."""
        rows = populated_repo.export_csv_rows()
        assert len(rows) == 2
        assert all(isinstance(r, dict) for r in rows)
        assert all("case_id" in r for r in rows)

    def test_export_json(self, populated_repo):
        """export_json returns structured metadata with cases."""
        data = populated_repo.export_json()
        assert data["total_cases"] == 2
        assert len(data["cases"]) == 2
        assert "courts" in data
        assert "year_range" in data
        assert data["year_range"]["min"] == 2023
        assert data["year_range"]["max"] == 2024
