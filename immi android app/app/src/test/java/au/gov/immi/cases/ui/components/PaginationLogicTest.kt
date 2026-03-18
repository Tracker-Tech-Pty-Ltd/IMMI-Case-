package au.gov.immi.cases.ui.components

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PaginationLogicTest {

    @Test
    fun `first page has no previous`() {
        val state = PaginationState(currentPage = 1, totalPages = 10, totalItems = 100)
        assertFalse(state.hasPrevious)
        assertTrue(state.hasNext)
    }

    @Test
    fun `last page has no next`() {
        val state = PaginationState(currentPage = 10, totalPages = 10, totalItems = 100)
        assertTrue(state.hasPrevious)
        assertFalse(state.hasNext)
    }

    @Test
    fun `single page has neither prev nor next`() {
        val state = PaginationState(currentPage = 1, totalPages = 1, totalItems = 5)
        assertFalse(state.hasPrevious)
        assertFalse(state.hasNext)
    }

    @Test
    fun `visiblePages returns all pages when totalPages is 7 or less`() {
        val state = PaginationState(currentPage = 3, totalPages = 7, totalItems = 70)
        assertEquals(listOf(1, 2, 3, 4, 5, 6, 7), state.visiblePages())
    }

    @Test
    fun `visiblePages includes ellipsis for large page count`() {
        val state = PaginationState(currentPage = 5, totalPages = 20, totalItems = 200)
        val pages = state.visiblePages()
        assertTrue(pages.contains(null), "Should contain null (ellipsis) for large page ranges")
        assertTrue(pages.contains(1), "Should always include first page")
        assertTrue(pages.contains(20), "Should always include last page")
    }

    @Test
    fun `isFirstPage and isLastPage flags are accurate`() {
        val first = PaginationState(currentPage = 1, totalPages = 5, totalItems = 50)
        assertTrue(first.isFirstPage)
        assertFalse(first.isLastPage)
        val last = PaginationState(currentPage = 5, totalPages = 5, totalItems = 50)
        assertFalse(last.isFirstPage)
        assertTrue(last.isLastPage)
    }

    @Test
    fun `visiblePages for page 1 of 20 has ellipsis near end`() {
        val state = PaginationState(currentPage = 1, totalPages = 20, totalItems = 200)
        val pages = state.visiblePages()
        assertTrue(pages.last() == 20)
        assertTrue(pages.contains(null))
    }

    @Test
    fun `visiblePages for middle page shows current and neighbors`() {
        val state = PaginationState(currentPage = 10, totalPages = 20, totalItems = 200)
        val pages = state.visiblePages().filterNotNull()
        assertTrue(pages.contains(9), "Should include currentPage - 1")
        assertTrue(pages.contains(10), "Should include currentPage")
        assertTrue(pages.contains(11), "Should include currentPage + 1")
    }
}
