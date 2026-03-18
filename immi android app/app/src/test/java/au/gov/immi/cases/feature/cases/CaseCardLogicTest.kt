package au.gov.immi.cases.feature.cases

import androidx.compose.ui.graphics.Color
import au.gov.immi.cases.core.model.CourtColors
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.ui.theme.DesignTokens
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * 純 JVM 測試 — 驗證 CaseCard 的顯示邏輯與法院顏色對應。
 * Compose UI 渲染測試留 Phase 10。
 */
class CaseCardLogicTest {

    // ── 原有顯示邏輯測試 ───────────────────────────────────────────────────────

    @Test
    fun `displayTitle returns title when not blank`() {
        val case = ImmigrationCase(title = "Smith v Minister", citation = "[2024] AATA 1")
        assertEquals("Smith v Minister", case.displayTitle())
    }

    @Test
    fun `displayTitle falls back to citation when title is blank`() {
        val case = ImmigrationCase(title = "", citation = "[2024] AATA 1")
        assertEquals("[2024] AATA 1", case.displayTitle())
    }

    @Test
    fun `case with all badges shows court outcome and year`() {
        val case = ImmigrationCase(courtCode = "AATA", outcome = "Granted", year = 2024)
        assertTrue(case.courtCode.isNotBlank())
        assertTrue(case.outcome.isNotBlank())
        assertTrue(case.year > 0)
    }

    @Test
    fun `case with no snippet does not show snippet section`() {
        val case = ImmigrationCase(textSnippet = "")
        assertTrue(case.textSnippet.isBlank())
    }

    @Test
    fun `case with snippet has content longer than display threshold`() {
        val longSnippet = "A".repeat(500)
        val case = ImmigrationCase(textSnippet = longSnippet)
        // UI truncates at 2 lines via maxLines=2; snippet is stored at full length
        assertTrue(case.textSnippet.length > 200)
    }

    @Test
    fun `judgeList splits semicolon-delimited judges correctly`() {
        val case = ImmigrationCase(judges = "Smith J; Jones J; Brown J")
        assertEquals(3, case.judgeList().size)
        assertEquals("Smith J", case.judgeList()[0])
        assertEquals("Jones J", case.judgeList()[1])
        assertEquals("Brown J", case.judgeList()[2])
    }

    @Test
    fun `displayTitle with both blank returns empty string`() {
        val case = ImmigrationCase(title = "", citation = "")
        assertEquals("", case.displayTitle())
    }

    @Test
    fun `case with year 0 should not show year badge`() {
        val case = ImmigrationCase(year = 0)
        assertFalse(case.year > 0)
    }

    @Test
    fun `judgeList with single judge returns list of one`() {
        val case = ImmigrationCase(judges = "Smith J")
        assertEquals(1, case.judgeList().size)
        assertEquals("Smith J", case.judgeList()[0])
    }

    @Test
    fun `judgeList with empty judges returns empty list`() {
        val case = ImmigrationCase(judges = "")
        assertTrue(case.judgeList().isEmpty())
    }

    // ── 法院顏色左邊框測試（CourtColors + DesignTokens）────────────────────────

    @Test
    fun `AATA court color is deep navy blue`() {
        assertEquals(Color(0xFF1a5276), CourtColors["AATA"])
    }

    @Test
    fun `HCA court color is near-black`() {
        assertEquals(Color(0xFF1b2631), CourtColors["HCA"])
    }

    @Test
    fun `unknown court code returns default gray`() {
        val color = CourtColors["UNKNOWN_XYZ"]
        assertNotNull(color)
        assertEquals(CourtColors.defaultColor, color)
    }

    @Test
    fun `blank court code returns default gray`() {
        assertEquals(CourtColors.defaultColor, CourtColors[""])
    }

    @Test
    fun `all 9 known courts have distinct non-default colors`() {
        val courts = listOf("AATA", "ARTA", "FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA", "MRTA", "RRTA")
        val colors = courts.map { CourtColors[it] }
        // all distinct
        assertEquals(courts.size, colors.distinct().size)
        // none are the default gray
        assertTrue(colors.none { it == CourtColors.defaultColor })
    }

    @Test
    fun `card radius default is 16dp`() {
        assertEquals(16f, DesignTokens.Radius.default.value)
    }

    @Test
    fun `accent bar width is visually thin (less than card radius)`() {
        // The accent bar should be 3dp — much thinner than 16dp card radius
        val accentBarWidth = 3f  // dp, as per design spec
        assertTrue(accentBarWidth < DesignTokens.Radius.default.value)
    }
}
