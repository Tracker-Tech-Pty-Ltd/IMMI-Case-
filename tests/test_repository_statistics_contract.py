"""Cross-backend contract test for get_statistics().

Loads the same case list into a CsvRepository and a SqliteRepository and
asserts the two payloads agree — key set, values, and (for the visa-subclass
top-N cut) tie-break order. Covers PYCORR-24.

Supabase and Hyperdrive delegate get_statistics() to a server-side SQL
function and are out of scope here (see plans/028's "Maintenance notes").
"""

import os

import pytest

from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import TOP_VISA_SUBCLASS_LIMIT
from immi_case_downloader.webapp import create_app

EXPECTED_KEYS = {
    "total", "by_court", "by_year", "by_nature", "by_visa_subclass",
    "by_source", "visa_types", "with_full_text", "sources",
}


def _varied_cases() -> list[ImmigrationCase]:
    """Enough variety to make every get_statistics() field non-empty:
    two courts, two years, two natures, two sources, two visa types, and
    one case with a full_text_path.
    """
    specs = [
        dict(court_code="AATA", year=2024, case_nature="Protection", source="AustLII",
             visa_type="Subclass 866 Protection Visa", visa_subclass="866", full_text_path=""),
        dict(court_code="AATA", year=2024, case_nature="Protection", source="AustLII",
             visa_type="Subclass 866 Protection Visa", visa_subclass="866", full_text_path=""),
        dict(court_code="FCA", year=2023, case_nature="Judicial Review", source="FederalCourt",
             visa_type="Subclass 050 Bridging Visa", visa_subclass="050",
             full_text_path="case_texts/one.txt"),
    ]
    cases = []
    for i, spec in enumerate(specs):
        case = ImmigrationCase(
            case_id="",
            citation=f"[{spec['year']}] {spec['court_code']} {100 + i}",
            title=f"Applicant {i} v Minister for Immigration",
            court=spec["court_code"],
            court_code=spec["court_code"],
            date="15 March 2024",
            year=spec["year"],
            url=f"https://www.austlii.edu.au/au/cases/cth/{spec['court_code']}/{spec['year']}/{100 + i}.html",
            case_nature=spec["case_nature"],
            source=spec["source"],
            visa_type=spec["visa_type"],
            visa_subclass=spec["visa_subclass"],
            full_text_path=spec["full_text_path"],
        )
        case.ensure_id()
        cases.append(case)
    return cases


def _tied_subclass_cases(n: int = 25) -> list[ImmigrationCase]:
    """25 distinct visa subclasses, each with exactly one case (tied count).

    Inserted in reverse-subclass order so a backend that fell back to
    first-seen order (rather than the documented count-desc/subclass-asc
    tie-break) would keep a different 20 and fail the comparison.
    """
    cases = []
    subclasses = [f"{600 + i:03d}" for i in range(n)]
    for i, subclass in enumerate(reversed(subclasses)):
        case = ImmigrationCase(
            case_id="",
            citation=f"[2024] AATA {200 + i}",
            title=f"Tie Case {i} v Minister for Immigration",
            court="AATA",
            court_code="AATA",
            date="15 March 2024",
            year=2024,
            url=f"https://www.austlii.edu.au/au/cases/cth/AATA/2024/{200 + i}.html",
            case_nature="Protection",
            source="AustLII",
            visa_subclass=subclass,
        )
        case.ensure_id()
        cases.append(case)
    return cases, sorted(subclasses)[:TOP_VISA_SUBCLASS_LIMIT]


@pytest.fixture
def csv_repo(tmp_path):
    repo = CsvRepository(str(tmp_path / "csv_backend"))
    repo.save_many(_varied_cases())
    return repo


@pytest.fixture
def sqlite_repo(tmp_path):
    repo = SqliteRepository(str(tmp_path / "sqlite_backend.db"))
    repo.save_many(_varied_cases())
    yield repo
    repo.close()


class TestStatisticsContract:
    def test_key_sets_are_identical(self, csv_repo, sqlite_repo):
        csv_stats = csv_repo.get_statistics()
        sqlite_stats = sqlite_repo.get_statistics()
        assert set(csv_stats.keys()) == EXPECTED_KEYS
        assert set(sqlite_stats.keys()) == EXPECTED_KEYS

    def test_totals_match(self, csv_repo, sqlite_repo):
        assert csv_repo.get_statistics()["total"] == sqlite_repo.get_statistics()["total"]

    def test_by_court_is_keyed_on_court_code(self, csv_repo, sqlite_repo):
        csv_stats = csv_repo.get_statistics()
        sqlite_stats = sqlite_repo.get_statistics()
        assert "AATA" in csv_stats["by_court"]
        assert "AATA" in sqlite_stats["by_court"]
        assert "Administrative Appeals Tribunal" not in csv_stats["by_court"]
        assert "Administrative Appeals Tribunal" not in sqlite_stats["by_court"]

    def test_by_source_counts_match(self, csv_repo, sqlite_repo):
        csv_stats = csv_repo.get_statistics()
        sqlite_stats = sqlite_repo.get_statistics()
        assert csv_stats["by_source"] == sqlite_stats["by_source"]
        assert all(v > 0 for v in csv_stats["by_source"].values())

    def test_by_visa_subclass_counts_match(self, csv_repo, sqlite_repo):
        csv_stats = csv_repo.get_statistics()
        sqlite_stats = sqlite_repo.get_statistics()
        assert csv_stats["by_visa_subclass"] == sqlite_stats["by_visa_subclass"]

    def test_stats_endpoint_populates_visa_charts_on_sqlite(self, tmp_path):
        from immi_case_downloader.storage import ensure_output_dirs

        output_dir = str(tmp_path / "sqlite_app")
        ensure_output_dirs(output_dir)
        repo = SqliteRepository(os.path.join(output_dir, "cases.db"))
        repo.save_many(_varied_cases())
        repo.close()

        app = create_app(output_dir, backend="sqlite")
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        resp = app.test_client().get("/api/v1/stats")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["visa_subclasses"]
        assert data["visa_families"]
        assert all(v > 0 for v in data["sources"].values())

    def test_full_statistics_payloads_are_equal(self, csv_repo, sqlite_repo):
        csv_stats = csv_repo.get_statistics()
        sqlite_stats = sqlite_repo.get_statistics()
        # Every field must be non-empty first — otherwise {} == {} would pass
        # while proving nothing about the fields that matter.
        for key in EXPECTED_KEYS:
            assert csv_stats[key], f"csv_stats[{key!r}] is empty"
            assert sqlite_stats[key], f"sqlite_stats[{key!r}] is empty"
        assert csv_stats == sqlite_stats

    def test_visa_subclass_tie_break_is_deterministic(self, tmp_path):
        cases, expected_top20 = _tied_subclass_cases(25)

        csv_repo = CsvRepository(str(tmp_path / "csv_tie"))
        csv_repo.save_many(cases)
        sqlite_repo = SqliteRepository(str(tmp_path / "sqlite_tie.db"))
        sqlite_repo.save_many(cases)
        try:
            csv_stats = csv_repo.get_statistics()
            sqlite_stats = sqlite_repo.get_statistics()
        finally:
            sqlite_repo.close()

        assert csv_stats["by_visa_subclass"] == sqlite_stats["by_visa_subclass"]
        assert len(csv_stats["by_visa_subclass"]) == TOP_VISA_SUBCLASS_LIMIT
        assert len(sqlite_stats["by_visa_subclass"]) == TOP_VISA_SUBCLASS_LIMIT
        assert set(csv_stats["by_visa_subclass"].keys()) == set(expected_top20)
