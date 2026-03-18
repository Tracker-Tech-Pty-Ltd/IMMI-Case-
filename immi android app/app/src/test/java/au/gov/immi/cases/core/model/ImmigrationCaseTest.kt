package au.gov.immi.cases.core.model

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ImmigrationCaseTest {

    @Test
    fun `default instance has empty strings and zero year`() {
        val case = ImmigrationCase()
        assertEquals("", case.caseId)
        assertEquals("", case.citation)
        assertEquals(0, case.year)
        assertEquals("", case.outcome)
    }

    @Test
    fun `copy preserves all fields`() {
        val original = ImmigrationCase(
            caseId = "abc123",
            citation = "[2024] AATA 1234",
            title = "Test Case",
            court = "Administrative Appeals Tribunal",
            courtCode = "AATA",
            year = 2024,
            outcome = "Granted"
        )
        val copy = original.copy(outcome = "Affirmed")
        assertEquals("abc123", copy.caseId)
        assertEquals("Affirmed", copy.outcome)
        assertEquals("[2024] AATA 1234", copy.citation)
    }

    @Test
    fun `judges split by semicolon returns list`() {
        val case = ImmigrationCase(judges = "Smith J; Jones J; Brown J")
        val judgeList = case.judgeList()
        assertEquals(3, judgeList.size)
        assertEquals("Smith J", judgeList[0].trim())
    }

    @Test
    fun `judges split by comma also works`() {
        val case = ImmigrationCase(judges = "Smith J, Jones J")
        val judgeList = case.judgeList()
        assertEquals(2, judgeList.size)
    }

    @Test
    fun `empty judges returns empty list`() {
        val case = ImmigrationCase(judges = "")
        assertTrue(case.judgeList().isEmpty())
    }

    @Test
    fun `legalConceptList splits by semicolon`() {
        val case = ImmigrationCase(legalConcepts = "Refugee Status; Protection Obligations; Well-Founded Fear")
        val concepts = case.legalConceptList()
        assertEquals(3, concepts.size)
    }

    @Test
    fun `tagList splits by comma`() {
        val case = ImmigrationCase(tags = "important,review,2024")
        val tags = case.tagList()
        assertEquals(3, tags.size)
        assertTrue(tags.contains("important"))
    }

    @Test
    fun `isGranted returns true for Granted outcome`() {
        val case = ImmigrationCase(outcome = "Granted")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns true for Allowed outcome`() {
        val case = ImmigrationCase(outcome = "Allowed")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns true for Set Aside outcome`() {
        val case = ImmigrationCase(outcome = "Set Aside")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns false for Dismissed outcome`() {
        val case = ImmigrationCase(outcome = "Dismissed")
        assertFalse(case.isGranted())
    }

    @Test
    fun `isGranted returns true for Remitted outcome`() {
        // Remitted = sent back for reconsideration — counts as applicant win in analytics
        val case = ImmigrationCase(outcome = "Remitted")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns true for Quashed outcome`() {
        // Quashed = judicial review quashing tribunal decision — applicant win
        val case = ImmigrationCase(outcome = "Quashed")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns true for Varied outcome`() {
        // Varied = decision varied in applicant's favour
        val case = ImmigrationCase(outcome = "Varied")
        assertTrue(case.isGranted())
    }

    @Test
    fun `isGranted returns false for Affirmed outcome`() {
        val case = ImmigrationCase(outcome = "Affirmed")
        assertFalse(case.isGranted())
    }

    @Test
    fun `isGranted returns false for Refused outcome`() {
        val case = ImmigrationCase(outcome = "Refused")
        assertFalse(case.isGranted())
    }

    @Test
    fun `displayTitle returns title when not empty`() {
        val case = ImmigrationCase(title = "Smith v Minister", citation = "[2024] AATA 1")
        assertEquals("Smith v Minister", case.displayTitle())
    }

    @Test
    fun `displayTitle falls back to citation when title empty`() {
        val case = ImmigrationCase(title = "", citation = "[2024] AATA 1")
        assertEquals("[2024] AATA 1", case.displayTitle())
    }
}
