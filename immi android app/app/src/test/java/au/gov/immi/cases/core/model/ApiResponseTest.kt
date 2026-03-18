package au.gov.immi.cases.core.model

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class ApiResponseTest {

    @Test
    fun `successful response has data and no error`() {
        val response = ApiResponse(success = true, data = "test data")
        assertTrue(response.success)
        assertEquals("test data", response.data)
        assertNull(response.error)
    }

    @Test
    fun `error response has null data and error message`() {
        val response = ApiResponse<String>(success = false, error = "Not found")
        assertFalse(response.success)
        assertNull(response.data)
        assertEquals("Not found", response.error)
    }

    @Test
    fun `meta default values are sensible`() {
        val meta = Meta()
        assertEquals(0, meta.total)
        assertEquals(1, meta.page)
        assertEquals(20, meta.limit)
        assertEquals(1, meta.pages)
    }

    @Test
    fun `meta hasNextPage is true when page less than pages`() {
        val meta = Meta(total = 100, page = 1, limit = 20, pages = 5)
        assertTrue(meta.hasNextPage())
    }

    @Test
    fun `meta hasNextPage is false on last page`() {
        val meta = Meta(total = 100, page = 5, limit = 20, pages = 5)
        assertFalse(meta.hasNextPage())
    }
}
