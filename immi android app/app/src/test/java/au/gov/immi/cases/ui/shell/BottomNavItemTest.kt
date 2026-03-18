package au.gov.immi.cases.ui.shell

import au.gov.immi.cases.navigation.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class BottomNavItemTest {

    @Test
    fun `BottomNavItem has exactly 5 entries`() {
        assertEquals(5, BottomNavItem.entries.size)
    }

    @Test
    fun `DASHBOARD item targets Dashboard route`() {
        assertEquals(Dashboard::class, BottomNavItem.DASHBOARD.route::class)
    }

    @Test
    fun `CASES item targets Cases route`() {
        assertEquals(Cases::class, BottomNavItem.CASES.route::class)
    }

    @Test
    fun `SEARCH item targets Search route`() {
        assertEquals(Search::class, BottomNavItem.SEARCH.route::class)
    }

    @Test
    fun `ANALYTICS item targets Analytics route`() {
        assertEquals(Analytics::class, BottomNavItem.ANALYTICS.route::class)
    }

    @Test
    fun `fromRoute returns correct item for Dashboard`() {
        val item = BottomNavItem.fromRoute(Dashboard)
        assertEquals(BottomNavItem.DASHBOARD, item)
    }

    @Test
    fun `fromRoute returns correct item for Cases`() {
        val item = BottomNavItem.fromRoute(Cases)
        assertEquals(BottomNavItem.CASES, item)
    }

    @Test
    fun `fromRoute returns correct item for Search`() {
        val item = BottomNavItem.fromRoute(Search)
        assertEquals(BottomNavItem.SEARCH, item)
    }

    @Test
    fun `fromRoute returns correct item for Analytics`() {
        val item = BottomNavItem.fromRoute(Analytics)
        assertEquals(BottomNavItem.ANALYTICS, item)
    }

    @Test
    fun `fromRoute returns null for non-bottom-nav route`() {
        val item = BottomNavItem.fromRoute(CaseDetail("abc"))
        assertNull(item)
    }

    @Test
    fun `fromRoute returns null for null input`() {
        val item = BottomNavItem.fromRoute(null)
        assertNull(item)
    }

    @Test
    fun `all items have distinct labels`() {
        val labels = BottomNavItem.entries.map { it.label }
        assertEquals(5, labels.distinct().size)
    }

    @Test
    fun `all items have non-blank labels`() {
        BottomNavItem.entries.forEach { item ->
            assertTrue(item.label.isNotBlank(), "Label for $item should not be blank")
        }
    }

    @Test
    fun `MORE item is the last entry`() {
        assertEquals(BottomNavItem.MORE, BottomNavItem.entries.last())
    }

    @Test
    fun `DASHBOARD item is the first entry`() {
        assertEquals(BottomNavItem.DASHBOARD, BottomNavItem.entries.first())
    }
}
