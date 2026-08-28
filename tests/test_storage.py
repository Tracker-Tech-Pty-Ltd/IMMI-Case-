"""Tests for immi_case_downloader.storage module."""

import json
import os


from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import (
    CASE_FIELDS,
    ensure_output_dirs,
    save_cases_csv,
    save_cases_json,
    save_case_text,
    load_cases_csv,
    load_all_cases,
    get_case_by_id,
    update_case,
    delete_case,
    add_case_manual,
    get_case_full_text,
    get_statistics,
)


class TestEnsureOutputDirs:
    def test_creates_dirs(self, tmp_path):
        base = str(tmp_path / "output")
        ensure_output_dirs(base)
        assert os.path.isdir(base)
        assert os.path.isdir(os.path.join(base, "case_texts"))

    def test_idempotent(self, tmp_path):
        base = str(tmp_path / "output")
        ensure_output_dirs(base)
        ensure_output_dirs(base)
        assert os.path.isdir(base)


class TestCsvRoundTrip:
    def test_save_and_load(self, tmp_path, sample_cases):
        ensure_output_dirs(str(tmp_path))
        save_cases_csv(sample_cases, str(tmp_path))
        records = load_cases_csv(str(tmp_path))
        assert len(records) == len(sample_cases)

    def test_load_missing_file_returns_empty(self, tmp_path):
        assert load_cases_csv(str(tmp_path)) == []

    def test_preserves_all_columns(self, tmp_path, sample_cases):
        ensure_output_dirs(str(tmp_path))
        save_cases_csv(sample_cases, str(tmp_path))
        records = load_cases_csv(str(tmp_path))
        assert set(records[0].keys()) == set(CASE_FIELDS)

    def test_load_all_cases_returns_objects(self, populated_dir):
        cases = load_all_cases(str(populated_dir))
        assert all(isinstance(c, ImmigrationCase) for c in cases)

    def test_load_all_cases_handles_nan(self, tmp_path):
        """CSV NaN values are cleaned by from_dict()."""
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(
            citation="[2024] AATA 1",
            url="https://example.com/1",
            year=2024,
            source="AustLII",
        )
        case.ensure_id()
        save_cases_csv([case], str(tmp_path))
        loaded = load_all_cases(str(tmp_path))
        assert len(loaded) == 1
        assert loaded[0].judges == ""
        assert loaded[0].year == 2024


class TestSaveJson:
    def test_structure(self, tmp_path, sample_cases):
        ensure_output_dirs(str(tmp_path))
        path = save_cases_json(sample_cases, str(tmp_path))
        with open(path) as f:
            data = json.load(f)
        assert data["total_cases"] == len(sample_cases)
        assert "courts" in data
        assert "year_range" in data
        assert "cases" in data
        assert len(data["cases"]) == len(sample_cases)

    def test_year_range(self, tmp_path, sample_cases):
        ensure_output_dirs(str(tmp_path))
        path = save_cases_json(sample_cases, str(tmp_path))
        with open(path) as f:
            data = json.load(f)
        assert data["year_range"]["min"] == 2024
        assert data["year_range"]["max"] == 2024


class TestSaveCaseText:
    def test_file_content(self, tmp_path, sample_case):
        ensure_output_dirs(str(tmp_path))
        text = "Full judgment text here."
        path = save_case_text(sample_case, text, str(tmp_path))
        assert os.path.exists(path)
        with open(path) as stored_file:
            content = stored_file.read()
        assert "Title: Smith v Minister for Immigration" in content
        assert "Full judgment text here." in content

    def test_filename_sanitization(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="Case/With:Special<Chars>")
        case.ensure_id()
        path = save_case_text(case, "body", str(tmp_path))
        assert os.path.exists(path)
        assert "/" not in os.path.basename(path).replace("/", "")

    def test_long_filename_truncated(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(citation="A" * 200)
        case.ensure_id()
        path = save_case_text(case, "body", str(tmp_path))
        basename = os.path.basename(path)
        assert len(basename) <= 104  # 100 chars + ".txt"

    def test_empty_citation_fallback(self, tmp_path):
        ensure_output_dirs(str(tmp_path))
        case = ImmigrationCase(url="https://example.com/x")
        case.ensure_id()
        path = save_case_text(case, "body", str(tmp_path))
        assert os.path.exists(path)


class TestGetCaseById:
    def test_found(self, populated_dir, sample_cases):
        target = sample_cases[0]
        result = get_case_by_id(target.case_id, str(populated_dir))
        assert result is not None
        assert result.citation == target.citation

    def test_not_found(self, populated_dir):
        assert get_case_by_id("nonexistent", str(populated_dir)) is None


class TestUpdateCase:
    def test_persists_changes(self, populated_dir, sample_cases):
        target = sample_cases[0]
        result = update_case(
            target.case_id, {"user_notes": "Updated!"}, str(populated_dir)
        )
        assert result is True
        reloaded = get_case_by_id(target.case_id, str(populated_dir))
        assert reloaded.user_notes == "Updated!"

    def test_returns_false_for_missing(self, populated_dir):
        assert update_case("nonexistent", {"user_notes": "X"}, str(populated_dir)) is False


class TestDeleteCase:
    def test_removes_case(self, populated_dir, sample_cases):
        target = sample_cases[0]
        original_count = len(load_all_cases(str(populated_dir)))
        result = delete_case(target.case_id, str(populated_dir))
        assert result is True
        assert len(load_all_cases(str(populated_dir))) == original_count - 1

    def test_returns_false_for_missing(self, populated_dir):
        assert delete_case("nonexistent", str(populated_dir)) is False


class TestAddCaseManual:
    def test_assigns_id_and_source(self, populated_dir):
        original_count = len(load_all_cases(str(populated_dir)))
        case = add_case_manual(
            {"citation": "[2024] NEW 1", "url": "https://new.example.com"},
            str(populated_dir),
        )
        assert case.case_id != ""
        assert case.source == "Manual Entry"
        assert len(load_all_cases(str(populated_dir))) == original_count + 1

    def test_preserves_explicit_source(self, populated_dir):
        case = add_case_manual(
            {"citation": "[2024] NEW 2", "url": "https://new2.example.com", "source": "Custom"},
            str(populated_dir),
        )
        assert case.source == "Custom"


class TestGetCaseFullText:
    def test_reads_content(self, tmp_path, sample_case):
        ensure_output_dirs(str(tmp_path))
        save_case_text(sample_case, "Full text content", str(tmp_path))
        result = get_case_full_text(sample_case, base_dir=str(tmp_path))
        assert result is not None
        assert "Full text content" in result

    def test_returns_none_when_no_file(self):
        case = ImmigrationCase(full_text_path="")
        assert get_case_full_text(case) is None

    def test_returns_none_when_path_missing(self):
        case = ImmigrationCase(full_text_path="/nonexistent/path.txt")
        assert get_case_full_text(case) is None


class TestGetStatistics:
    def test_counts(self, populated_dir, sample_cases):
        stats = get_statistics(str(populated_dir))
        assert stats["total"] == len(sample_cases)
        assert isinstance(stats["by_court"], dict)
        assert isinstance(stats["by_year"], dict)
        assert isinstance(stats["by_nature"], dict)
        assert isinstance(stats["visa_types"], list)
        assert 2024 in stats["by_year"]

    def test_empty_dir(self, tmp_path):
        stats = get_statistics(str(tmp_path))
        assert stats["total"] == 0


class TestCaseFieldsConsistency:
    def test_count(self):
        assert len(CASE_FIELDS) == 31

    def test_matches_dataclass(self):
        dataclass_fields = {f.name for f in ImmigrationCase.__dataclass_fields__.values()}
        assert set(CASE_FIELDS) == dataclass_fields
