package au.gov.immi.cases.core.model

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class CasesFilterTest {

    @Test
    fun `default filter has no constraints`() {
        val filter = CasesFilter()
        assertNull(filter.court)
        assertNull(filter.year)
        assertNull(filter.keyword)
        assertEquals("date", filter.sortBy)
        assertEquals("desc", filter.sortDir)
        assertEquals(1, filter.page)
        assertEquals(20, filter.pageSize)
    }

    @Test
    fun `filter copy immutably updates fields`() {
        val filter = CasesFilter(court = "AATA")
        val updated = filter.copy(year = 2024)
        assertEquals("AATA", updated.court)
        assertEquals(2024, updated.year)
        assertEquals("AATA", filter.court)   // original unchanged
        assertNull(filter.year)               // original unchanged
    }

    @Test
    fun `toQueryMap includes non-null values only`() {
        val filter = CasesFilter(court = "FCA", year = 2023, keyword = null)
        val map = filter.toQueryMap()
        assertTrue(map.containsKey("court"))
        assertTrue(map.containsKey("year"))
        assertFalse(map.containsKey("keyword"))
    }

    @Test
    fun `toQueryMap always includes page and page_size`() {
        val filter = CasesFilter()
        val map = filter.toQueryMap()
        assertTrue(map.containsKey("page"))
        assertTrue(map.containsKey("page_size"))
    }

    @Test
    fun `isFiltered returns false for default filter`() {
        assertFalse(CasesFilter().isFiltered())
    }

    @Test
    fun `isFiltered returns true when court set`() {
        assertTrue(CasesFilter(court = "FCA").isFiltered())
    }
}
