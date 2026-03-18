package au.gov.immi.cases.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import au.gov.immi.cases.data.local.dao.CachedCaseDao
import au.gov.immi.cases.data.local.dao.CollectionDao
import au.gov.immi.cases.data.local.dao.SavedSearchDao
import au.gov.immi.cases.data.local.entity.CachedCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionEntity
import au.gov.immi.cases.data.local.entity.SavedSearchEntity

@Database(
    entities = [
        CollectionEntity::class,
        CollectionCaseEntity::class,
        SavedSearchEntity::class,
        CachedCaseEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun collectionDao(): CollectionDao
    abstract fun savedSearchDao(): SavedSearchDao
    abstract fun cachedCaseDao(): CachedCaseDao

    companion object {
        const val DATABASE_NAME = "immi_cases.db"
    }
}
