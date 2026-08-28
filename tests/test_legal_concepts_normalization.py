"""Test suite for legal concepts normalization"""

from immi_case_downloader.normalize_legal_concepts import normalize_concept


class TestNormalizeConceptBasic:
    """Test basic concept normalization to title case"""

    def test_simple_lowercase_concept(self):
        """Convert simple lowercase concept to title case"""
        assert normalize_concept("refugee status") == "Refugee Status"

    def test_simple_uppercase_concept(self):
        """Convert uppercase concept to title case"""
        assert normalize_concept("REFUGEE STATUS") == "Refugee Status"

    def test_mixed_case_concept(self):
        """Handle mixed case concept"""
        assert normalize_concept("natural JUSTICE") == "Natural Justice"

    def test_single_word_concept(self):
        """Handle single word concept"""
        assert normalize_concept("asylum") == "Asylum"

    def test_empty_string(self):
        """Handle empty string"""
        assert normalize_concept("") == ""

    def test_whitespace_only(self):
        """Handle whitespace only string"""
        assert normalize_concept("   ") == ""


class TestNormalizeConceptArticles:
    """Test handling of articles and prepositions"""

    def test_articles_lowercase(self):
        """Articles should remain lowercase except first word"""
        assert normalize_concept("the rule of law") == "The Rule of Law"

    def test_article_at_beginning(self):
        """Article at beginning should be capitalized"""
        assert normalize_concept("a natural justice principle") == "A Natural Justice Principle"

    def test_multiple_articles(self):
        """Multiple articles should remain lowercase"""
        assert normalize_concept("the rule and the law") == "The Rule and the Law"

    def test_preposition_lowercase(self):
        """Prepositions should remain lowercase"""
        assert normalize_concept("natural justice in proceedings") == "Natural Justice in Proceedings"

    def test_conjunction_lowercase(self):
        """Conjunctions should remain lowercase"""
        assert normalize_concept("refugee status or protection visa") == "Refugee Status or Protection Visa"


class TestNormalizeConceptSpecialCases:
    """Test special cases and edge cases"""

    def test_concept_with_hyphen(self):
        """Handle concepts with hyphens"""
        assert normalize_concept("well-founded fear") == "Well-Founded Fear"

    def test_concept_with_apostrophe(self):
        """Handle concepts with apostrophes"""
        assert normalize_concept("applicant's rights") == "Applicant's Rights"

    def test_concept_with_numbers(self):
        """Handle concepts with numbers"""
        assert normalize_concept("section 36 protection") == "Section 36 Protection"

    def test_extra_spaces(self):
        """Handle extra spaces between words"""
        assert normalize_concept("refugee  status") == "Refugee Status"

    def test_leading_trailing_spaces(self):
        """Handle leading and trailing spaces"""
        assert normalize_concept("  refugee status  ") == "Refugee Status"

    def test_none_input(self):
        """Handle None input gracefully"""
        assert normalize_concept(None) == ""


class TestNormalizeConceptRealWorld:
    """Test with real-world legal concepts"""

    def test_visa_class_concept(self):
        """Real visa concept"""
        assert normalize_concept("skilled independent visa") == "Skilled Independent Visa"

    def test_legal_principle_concept(self):
        """Real legal principle"""
        assert normalize_concept("procedural fairness and natural justice") == "Procedural Fairness and Natural Justice"

    def test_case_type_concept(self):
        """Real case type concept"""
        assert normalize_concept("administrative law appeal") == "Administrative Law Appeal"

    def test_complex_legal_concept(self):
        """Complex real legal concept"""
        assert normalize_concept("protection of minor children and best interests of the child") == "Protection of Minor Children and Best Interests of the Child"
