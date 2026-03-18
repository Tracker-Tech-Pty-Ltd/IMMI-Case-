package au.gov.immi.cases.navigation

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class RouteTest {

    @Test
    fun `Dashboard is a singleton object`() {
        assertSame(Dashboard, Dashboard)
    }

    @Test
    fun `CaseDetail holds caseId`() {
        val route = CaseDetail(caseId = "abc123")
        assertEquals("abc123", route.caseId)
    }

    @Test
    fun `CaseCompare holds two case IDs`() {
        val route = CaseCompare(caseId1 = "id1", caseId2 = "id2")
        assertEquals("id1", route.caseId1)
        assertEquals("id2", route.caseId2)
    }

    @Test
    fun `CollectionDetail holds Long collectionId`() {
        val route = CollectionDetail(collectionId = 42L)
        assertEquals(42L, route.collectionId)
    }

    @Test
    fun `JudgeDetail holds judgeName`() {
        val route = JudgeDetail(judgeName = "Smith J")
        assertEquals("Smith J", route.judgeName)
    }

    @Test
    fun `JudgeCompare holds comma-separated names`() {
        val route = JudgeCompare(judgeNames = "Smith J,Jones J")
        assertTrue(route.judgeNames.contains(","))
    }

    @Test
    fun `LegislationDetail holds legislationId`() {
        val route = LegislationDetail(legislationId = "migration-act-1958")
        assertEquals("migration-act-1958", route.legislationId)
    }

    @Test
    fun `CaseDetail data class equality works`() {
        val a = CaseDetail("xyz")
        val b = CaseDetail("xyz")
        assertEquals(a, b)
        assertNotSame(a, b)
    }

    @Test
    fun `all object routes are singletons`() {
        // object routes should be referentially equal
        assertSame(Dashboard, Dashboard)
        assertSame(Cases, Cases)
        assertSame(Settings, Settings)
        assertSame(Analytics, Analytics)
    }

    @Test
    fun `CaseEdit is independent from CaseDetail`() {
        val edit = CaseEdit(caseId = "abc")
        val detail = CaseDetail(caseId = "abc")
        assertNotEquals(edit::class, detail::class)
    }
}
