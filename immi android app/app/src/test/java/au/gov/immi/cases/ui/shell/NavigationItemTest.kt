package au.gov.immi.cases.ui.shell

import au.gov.immi.cases.navigation.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class NavigationItemTest {

    @Test
    fun `NavigationItems has items for all 5 groups`() {
        assertEquals(5, NavigationItems.groups.size)
    }

    @Test
    fun `groups are Cases Search Analytics Legislation System`() {
        val groups = NavigationItems.groups
        assertTrue(groups.contains("Cases"))
        assertTrue(groups.contains("Search"))
        assertTrue(groups.contains("Analytics"))
        assertTrue(groups.contains("Legislation"))
        assertTrue(groups.contains("System"))
    }

    @Test
    fun `Cases group has at least 2 items`() {
        assertTrue(NavigationItems.byGroup("Cases").size >= 2)
    }

    @Test
    fun `Search group has SavedSearches item`() {
        val searchItems = NavigationItems.byGroup("Search")
        assertTrue(searchItems.any { it.route::class == SavedSearches::class })
    }

    @Test
    fun `System group has Settings item`() {
        val systemItems = NavigationItems.byGroup("System")
        assertTrue(systemItems.any { it.route::class == Settings::class })
    }

    @Test
    fun `total navigation items covers all major features`() {
        assertTrue(NavigationItems.allItems.size >= 15)
    }

    @Test
    fun `NavigationItem data class equality works`() {
        // Use the same icon reference for equality check
        val icon = NavigationItems.allItems.first().icon
        val item1 = NavigationItem(route = Dashboard, label = "Home", icon = icon)
        val item2 = NavigationItem(route = Dashboard, label = "Home", icon = icon)
        assertEquals(item1, item2)
    }

    @Test
    fun `all items have non-blank labels`() {
        NavigationItems.allItems.forEach { item ->
            assertTrue(item.label.isNotBlank(), "Label for route ${item.route::class.simpleName} should not be blank")
        }
    }

    @Test
    fun `all items have non-empty group`() {
        NavigationItems.allItems.forEach { item ->
            assertTrue(item.group.isNotBlank(), "Group for ${item.label} should not be blank")
        }
    }

    @Test
    fun `Analytics group has JudgeProfiles item`() {
        val analyticsItems = NavigationItems.byGroup("Analytics")
        assertTrue(analyticsItems.any { it.route::class == JudgeProfiles::class })
    }

    @Test
    fun `Legislation group has Legislations item`() {
        val legItems = NavigationItems.byGroup("Legislation")
        assertTrue(legItems.any { it.route::class == Legislations::class })
    }

    @Test
    fun `byGroup returns empty list for unknown group`() {
        assertTrue(NavigationItems.byGroup("Unknown").isEmpty())
    }

    @Test
    fun `groups preserves insertion order`() {
        val groups = NavigationItems.groups
        // Cases should come before Search which comes before Analytics
        val casesIdx = groups.indexOf("Cases")
        val searchIdx = groups.indexOf("Search")
        val analyticsIdx = groups.indexOf("Analytics")
        assertTrue(casesIdx < searchIdx)
        assertTrue(searchIdx < analyticsIdx)
    }
}
