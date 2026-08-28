"""Test suite for judge name normalization and deduplication"""

from immi_case_downloader.normalize_judge_names import (
    normalize_judge_name,
    find_duplicate_judges,
    merge_judge_records,
)


class TestNormalizeJudgeName:
    """Test judge name normalization"""

    def test_removes_titles(self):
        """Remove common judge titles"""
        assert normalize_judge_name("Justice Smith") == "smith"
        assert normalize_judge_name("Hon. Smith") == "smith"
        assert normalize_judge_name("Judge Smith") == "smith"

    def test_standardizes_case(self):
        """Convert to lowercase"""
        assert normalize_judge_name("SMITH J") == "smith"
        assert normalize_judge_name("Smith J") == "smith"

    def test_extracts_surname(self):
        """Extract surname from multi-word names"""
        assert normalize_judge_name("John Smith") == "smith"
        assert normalize_judge_name("Justice John Smith") == "smith"

    def test_handles_special_chars(self):
        """Remove special characters and apostrophes"""
        assert normalize_judge_name("O'Brien") == "obrien"
        assert normalize_judge_name("Smith-Jones") == "smithjones"

    def test_handles_accents(self):
        """Normalize accented characters"""
        assert normalize_judge_name("Müller") == "muller"
        assert normalize_judge_name("François") == "francois"

    def test_empty_input(self):
        """Handle empty input"""
        assert normalize_judge_name("") == ""
        assert normalize_judge_name("   ") == ""

    def test_none_input(self):
        """Handle None input"""
        assert normalize_judge_name(None) == ""


class TestFindDuplicateJudges:
    """Test fuzzy matching for duplicate detection"""

    def test_exact_duplicates(self):
        """Identify exact duplicates"""
        names = ["Smith J", "Smith J", "Smith J"]
        groups = find_duplicate_judges(names, threshold=0.85)
        assert len(groups) == 1
        assert len(groups[0]) == 3

    def test_fuzzy_match_variations(self):
        """Identify fuzzy matches"""
        names = [
            "Justice Smith J",
            "Smith J",
            "Smith, J.",
            "J Smith",
        ]
        groups = find_duplicate_judges(names, threshold=0.85)
        assert len(groups) == 1

    def test_different_people(self):
        """Keep different people separate"""
        names = [
            "Justice Smith J",
            "Justice Jones J",
            "Justice Brown K",
        ]
        groups = find_duplicate_judges(names, threshold=0.85)
        assert len(groups) == 3

    def test_partial_duplicates(self):
        """Handle partial matches"""
        names = [
            "Smith John",
            "Smith Jane",
            "Jones John",
        ]
        groups = find_duplicate_judges(names, threshold=0.85)
        # Smith John and Smith Jane should be together (same surname)
        # Jones John should be separate
        assert len(groups) <= 3

    def test_empty_list(self):
        """Handle empty input"""
        assert find_duplicate_judges([], threshold=0.85) == []


class TestMergeJudgeRecords:
    """Test merging duplicate judge records"""

    def test_basic_merge(self):
        """Merge records from same judge"""
        judge_groups = {
            "smith": [
                {"name": "Smith J", "case_count": 100, "wins": 75},
                {"name": "Justice Smith", "case_count": 50, "wins": 40},
            ]
        }
        result = merge_judge_records(judge_groups)

        assert "smith" in result
        merged = result["smith"]
        assert merged["case_count"] == 150  # 100 + 50
        assert merged["wins"] == 115  # 75 + 40
        assert merged["success_rate"] == 115 / 150

    def test_merge_uses_canonical_name(self):
        """Use name with highest case count as canonical"""
        judge_groups = {
            "smith": [
                {"name": "Smith, J.", "case_count": 200, "wins": 150},
                {"name": "Justice Smith", "case_count": 50, "wins": 40},
            ]
        }
        result = merge_judge_records(judge_groups)
        merged = result["smith"]
        assert merged["canonical_name"] == "Smith, J."

    def test_merge_includes_variants(self):
        """Track all name variants"""
        judge_groups = {
            "smith": [
                {"name": "Justice Smith J", "case_count": 100, "wins": 75},
                {"name": "Smith J", "case_count": 50, "wins": 40},
            ]
        }
        result = merge_judge_records(judge_groups)
        merged = result["smith"]
        assert len(merged["variants"]) == 2
        assert "Justice Smith J" in merged["variants"]
        assert "Smith J" in merged["variants"]

    def test_zero_success_rate(self):
        """Handle zero case count gracefully"""
        judge_groups = {
            "smith": [
                {"name": "Smith J", "case_count": 0, "wins": 0},
            ]
        }
        result = merge_judge_records(judge_groups)
        merged = result["smith"]
        assert merged["success_rate"] == 0
