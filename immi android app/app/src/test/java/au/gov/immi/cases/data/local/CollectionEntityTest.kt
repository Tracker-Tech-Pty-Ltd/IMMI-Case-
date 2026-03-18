package au.gov.immi.cases.data.local

import au.gov.immi.cases.data.local.dao.CollectionDao
import au.gov.immi.cases.data.local.dao.SavedSearchDao
import au.gov.immi.cases.data.local.dao.CachedCaseDao
import au.gov.immi.cases.data.local.entity.CachedCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionEntity
import au.gov.immi.cases.data.local.entity.SavedSearchEntity
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CollectionEntityTest {

    // ─── CollectionEntity ──────────────────────────────────────────────────────

    @Test
    fun `CollectionEntity has correct defaults`() {
        val entity = CollectionEntity(name = "Test")
        assertEquals("Test", entity.name)
        assertEquals("", entity.description)
        assertEquals("#3b82f6", entity.color)
        assertEquals(0L, entity.id)
    }

    @Test
    fun `CollectionEntity stores custom color`() {
        val entity = CollectionEntity(name = "Red Collection", color = "#ef4444")
        assertEquals("#ef4444", entity.color)
    }

    @Test
    fun `CollectionEntity timestamps are positive`() {
        val entity = CollectionEntity(name = "Timestamped")
        assertTrue(entity.createdAt > 0L)
        assertTrue(entity.updatedAt > 0L)
    }

    @Test
    fun `CollectionEntity data class equality`() {
        val a = CollectionEntity(id = 1L, name = "Same", color = "#3b82f6")
        val b = CollectionEntity(id = 1L, name = "Same", color = "#3b82f6")
        assertEquals(a, b)
    }

    // ─── CollectionCaseEntity ──────────────────────────────────────────────────

    @Test
    fun `CollectionCaseEntity has composite primary key fields`() {
        val link = CollectionCaseEntity(collectionId = 1L, caseId = "abc")
        assertEquals(1L, link.collectionId)
        assertEquals("abc", link.caseId)
    }

    @Test
    fun `CollectionCaseEntity addedAt is positive`() {
        val link = CollectionCaseEntity(collectionId = 2L, caseId = "xyz")
        assertTrue(link.addedAt > 0L)
    }

    @Test
    fun `CollectionCaseEntity different caseIds are not equal`() {
        val link1 = CollectionCaseEntity(collectionId = 1L, caseId = "abc")
        val link2 = CollectionCaseEntity(collectionId = 1L, caseId = "def")
        assertTrue(link1 != link2)
    }

    // ─── SavedSearchEntity ────────────────────────────────────────────────────

    @Test
    fun `SavedSearchEntity stores query as string`() {
        val search = SavedSearchEntity(
            name = "AATA 2024",
            query = """{"court_code":"AATA","year":"2024"}"""
        )
        assertEquals("AATA 2024", search.name)
        assertTrue(search.query.contains("AATA"))
    }

    @Test
    fun `SavedSearchEntity has correct defaults`() {
        val search = SavedSearchEntity(name = "My Search", query = "{}")
        assertEquals(0L, search.id)
        assertEquals(0, search.resultCount)
        assertEquals(0L, search.lastRunAt)
        assertTrue(search.createdAt > 0L)
    }

    @Test
    fun `SavedSearchEntity accepts JSON query with special chars`() {
        val json = """{"keyword":"visa subclass 189","court_code":"AATA","year_from":2020}"""
        val search = SavedSearchEntity(name = "Visa 189", query = json)
        assertEquals(json, search.query)
    }

    // ─── CachedCaseEntity ────────────────────────────────────────────────────

    @Test
    fun `CachedCaseEntity stores essential fields`() {
        val cached = CachedCaseEntity(
            caseId = "abc123",
            citation = "[2024] AATA 1",
            title = "Test v Minister",
            court = "AATA",
            courtCode = "AATA",
            year = 2024,
            outcome = "Granted",
            judges = "Smith J",
            caseNature = "Protection",
            visaType = "protection",
            tags = "",
            textSnippet = "..."
        )
        assertEquals("abc123", cached.caseId)
        assertEquals("Granted", cached.outcome)
        assertEquals(2024, cached.year)
    }

    @Test
    fun `CachedCaseEntity has auto-generated id default`() {
        val cached = CachedCaseEntity(
            caseId = "id1",
            citation = "[2024] AATA 2",
            title = "Title",
            court = "AATA",
            courtCode = "AATA",
            year = 2024,
            outcome = "Dismissed",
            judges = "",
            caseNature = "",
            visaType = "",
            tags = "",
            textSnippet = ""
        )
        assertEquals(0L, cached.id)
        assertTrue(cached.cachedAt > 0L)
    }

    @Test
    fun `CachedCaseEntity can store empty optional fields`() {
        val cached = CachedCaseEntity(
            caseId = "id2",
            citation = "[2024] FCA 100",
            title = "",
            court = "FCA",
            courtCode = "FCA",
            year = 2024,
            outcome = "",
            judges = "",
            caseNature = "",
            visaType = "",
            tags = "",
            textSnippet = ""
        )
        assertEquals("", cached.title)
        assertEquals("", cached.outcome)
    }

    // ─── AppDatabase ─────────────────────────────────────────────────────────

    @Test
    fun `AppDatabase has correct database name`() {
        assertEquals("immi_cases.db", AppDatabase.DATABASE_NAME)
    }

    /**
     * @Database 的 Kotlin Retention = BINARY（CLASS-level），不在 runtime 可見。
     * 改用 Java reflection 驗證 AppDatabase 繼承 RoomDatabase。
     */
    @Test
    fun `AppDatabase extends RoomDatabase`() {
        val superclass = AppDatabase::class.java.superclass
        assertNotNull(superclass)
        assertEquals(
            "androidx.room.RoomDatabase",
            superclass!!.name,
            "AppDatabase must extend RoomDatabase"
        )
    }

    @Test
    fun `AppDatabase is abstract`() {
        assertTrue(
            java.lang.reflect.Modifier.isAbstract(AppDatabase::class.java.modifiers),
            "AppDatabase must be abstract"
        )
    }

    @Test
    fun `AppDatabase has CollectionDao abstract method`() {
        val methods = AppDatabase::class.java.declaredMethods
        val hasCollectionDao = methods.any { it.name == "collectionDao" }
        assertTrue(hasCollectionDao, "AppDatabase must declare collectionDao()")
    }

    @Test
    fun `AppDatabase has SavedSearchDao abstract method`() {
        val methods = AppDatabase::class.java.declaredMethods
        val hasSavedSearchDao = methods.any { it.name == "savedSearchDao" }
        assertTrue(hasSavedSearchDao, "AppDatabase must declare savedSearchDao()")
    }

    @Test
    fun `AppDatabase has CachedCaseDao abstract method`() {
        val methods = AppDatabase::class.java.declaredMethods
        val hasCachedCaseDao = methods.any { it.name == "cachedCaseDao" }
        assertTrue(hasCachedCaseDao, "AppDatabase must declare cachedCaseDao()")
    }

    @Test
    fun `AppDatabase collectionDao returns CollectionDao type`() {
        val method = AppDatabase::class.java.getDeclaredMethod("collectionDao")
        assertEquals(CollectionDao::class.java, method.returnType)
    }

    @Test
    fun `AppDatabase savedSearchDao returns SavedSearchDao type`() {
        val method = AppDatabase::class.java.getDeclaredMethod("savedSearchDao")
        assertEquals(SavedSearchDao::class.java, method.returnType)
    }

    @Test
    fun `AppDatabase cachedCaseDao returns CachedCaseDao type`() {
        val method = AppDatabase::class.java.getDeclaredMethod("cachedCaseDao")
        assertEquals(CachedCaseDao::class.java, method.returnType)
    }

    // ─── DAO interface contract ───────────────────────────────────────────────

    @Test
    fun `CollectionDao is an interface`() {
        assertTrue(CollectionDao::class.java.isInterface)
    }

    @Test
    fun `SavedSearchDao is an interface`() {
        assertTrue(SavedSearchDao::class.java.isInterface)
    }

    @Test
    fun `CachedCaseDao is an interface`() {
        assertTrue(CachedCaseDao::class.java.isInterface)
    }
}
