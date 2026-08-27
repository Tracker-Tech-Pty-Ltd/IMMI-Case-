"""Basic happy-path tests for immi_case_downloader.csv_repository.

CsvRepository had no dedicated test file before plan 027. This covers the
uncontroversial round-trip behaviour; the regression suite for the bugs
plan 027 fixes lives in test_csv_data_integrity.py.
"""

from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.models import ImmigrationCase


def _case(**overrides) -> ImmigrationCase:
    defaults = dict(
        citation="[2024] AATA 1",
        title="Smith v Minister for Immigration",
        court_code="AATA",
        year=2024,
        url="",
    )
    defaults.update(overrides)
    case = ImmigrationCase(**defaults)
    case.ensure_id()
    return case


class TestCsvRepositorySaveMany:
    def test_save_many_on_empty_store_returns_count_of_added_cases(self, tmp_path):
        repo = CsvRepository(str(tmp_path))
        a = _case(citation="[2024] AATA 1", url="https://example.com/1")
        b = _case(citation="[2024] AATA 2", url="https://example.com/2")

        added = repo.save_many([a, b])

        assert added == 2


class TestCsvRepositoryLoadAll:
    def test_load_all_round_trips_a_saved_case(self, tmp_path):
        repo = CsvRepository(str(tmp_path))
        case = _case(citation="[2024] AATA 3", url="https://example.com/3", title="Round Trip Case")
        repo.save_many([case])

        loaded = repo.load_all()

        assert len(loaded) == 1
        assert loaded[0].citation == "[2024] AATA 3"
        assert loaded[0].title == "Round Trip Case"


class TestCsvRepositoryGetById:
    def test_get_by_id_finds_a_saved_case(self, tmp_path):
        repo = CsvRepository(str(tmp_path))
        case = _case(citation="[2024] AATA 4", url="https://example.com/4")
        repo.save_many([case])

        found = repo.get_by_id(case.case_id)

        assert found is not None
        assert found.case_id == case.case_id
        assert found.citation == "[2024] AATA 4"

    def test_get_by_id_returns_none_for_unknown_id(self, tmp_path):
        repo = CsvRepository(str(tmp_path))

        assert repo.get_by_id("does-not-exist") is None


class TestCsvRepositoryGetExistingUrls:
    def test_get_existing_urls_excludes_blanks(self, tmp_path):
        repo = CsvRepository(str(tmp_path))
        with_url = _case(citation="[2024] AATA 5", url="https://example.com/5")
        blank_url = _case(citation="[2024] AATA 6", url="")
        repo.save_many([with_url, blank_url])

        urls = repo.get_existing_urls()

        assert urls == {"https://example.com/5"}
