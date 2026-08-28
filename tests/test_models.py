"""Tests for immi_case_downloader.models.ImmigrationCase."""



from immi_case_downloader.models import ImmigrationCase


class TestToDict:
    def test_round_trip(self, sample_case):
        """to_dict() output can reconstruct the same object via from_dict()."""
        d = sample_case.to_dict()
        restored = ImmigrationCase.from_dict(d)
        assert restored.to_dict() == d

    def test_contains_all_fields(self):
        """to_dict() includes every dataclass field."""
        case = ImmigrationCase()
        d = case.to_dict()
        expected_keys = {f.name for f in ImmigrationCase.__dataclass_fields__.values()}
        assert set(d.keys()) == expected_keys


class TestEnsureId:
    def test_stability(self):
        """Same input produces the same hash."""
        a = ImmigrationCase(citation="[2024] AATA 1")
        b = ImmigrationCase(citation="[2024] AATA 1")
        a.ensure_id()
        b.ensure_id()
        assert a.case_id == b.case_id

    def test_uniqueness(self):
        """Different inputs produce different hashes."""
        a = ImmigrationCase(citation="[2024] AATA 1")
        b = ImmigrationCase(citation="[2024] AATA 2")
        a.ensure_id()
        b.ensure_id()
        assert a.case_id != b.case_id

    def test_fallback_to_url(self):
        """Falls back to url when citation is empty."""
        case = ImmigrationCase(url="https://example.com/case/1")
        case.ensure_id()
        assert len(case.case_id) == 12

    def test_fallback_to_title(self):
        """Falls back to title when citation and url are empty."""
        case = ImmigrationCase(title="Smith v Minister")
        case.ensure_id()
        assert len(case.case_id) == 12

    def test_no_overwrite(self):
        """Does not overwrite an existing case_id."""
        case = ImmigrationCase(case_id="existing123", citation="ignored")
        case.ensure_id()
        assert case.case_id == "existing123"

    def test_empty_key_hashes_empty_string(self):
        """When all key fields are empty, hashes the empty string."""
        case = ImmigrationCase()
        case.ensure_id()
        assert len(case.case_id) == 12


class TestFromDict:
    def test_clean_data(self):
        """Constructs correctly from clean dictionary."""
        data = {"citation": "[2024] FCA 50", "year": 2024, "court": "Federal Court"}
        case = ImmigrationCase.from_dict(data)
        assert case.citation == "[2024] FCA 50"
        assert case.year == 2024
        assert case.court == "Federal Court"

    def test_nan_float(self):
        """pandas NaN (float) is converted to empty string / 0."""
        data = {
            "citation": float("nan"),
            "year": float("nan"),
            "court": float("nan"),
        }
        case = ImmigrationCase.from_dict(data)
        assert case.citation == ""
        assert case.year == 0
        assert case.court == ""

    def test_nan_string(self):
        """String 'nan' is treated as missing."""
        data = {"citation": "nan", "year": "nan"}
        case = ImmigrationCase.from_dict(data)
        assert case.citation == ""
        assert case.year == 0

    def test_none_values(self):
        """None values become empty string / 0."""
        data = {"citation": None, "year": None}
        case = ImmigrationCase.from_dict(data)
        assert case.citation == ""
        assert case.year == 0

    def test_empty_strings(self):
        """Empty strings stay empty, year becomes 0."""
        data = {"citation": "", "year": ""}
        case = ImmigrationCase.from_dict(data)
        assert case.citation == ""
        assert case.year == 0

    def test_year_valid_int(self):
        assert ImmigrationCase.from_dict({"year": 2024}).year == 2024

    def test_year_valid_string(self):
        assert ImmigrationCase.from_dict({"year": "2024"}).year == 2024

    def test_year_invalid_string(self):
        assert ImmigrationCase.from_dict({"year": "not-a-year"}).year == 0

    def test_year_zero(self):
        assert ImmigrationCase.from_dict({"year": 0}).year == 0

    def test_ignores_unknown_keys(self):
        """Unknown keys are silently dropped."""
        data = {"citation": "X", "unknown_field": "ignored", "extra": 42}
        case = ImmigrationCase.from_dict(data)
        assert case.citation == "X"
        assert not hasattr(case, "unknown_field")

    def test_missing_keys_use_defaults(self):
        """Missing keys get dataclass defaults (empty string, 0)."""
        case = ImmigrationCase.from_dict({})
        assert case.citation == ""
        assert case.year == 0
        assert case.court == ""


class TestDefaults:
    def test_all_string_fields_empty(self):
        """All string fields default to empty string."""
        case = ImmigrationCase()
        for f in ImmigrationCase.__dataclass_fields__.values():
            if f.name == "year":
                continue
            assert getattr(case, f.name) == "", f"Field {f.name} not empty"

    def test_year_default_zero(self):
        assert ImmigrationCase().year == 0
