package au.gov.immi.cases.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import au.gov.immi.cases.data.local.entity.SavedSearchEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SavedSearchDao {

    @Query("SELECT * FROM saved_searches ORDER BY createdAt DESC")
    fun getAllSavedSearches(): Flow<List<SavedSearchEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSavedSearch(search: SavedSearchEntity): Long

    @Delete
    suspend fun deleteSavedSearch(search: SavedSearchEntity)

    @Query("UPDATE saved_searches SET lastRunAt = :timestamp, resultCount = :count WHERE id = :id")
    suspend fun updateLastRun(id: Long, timestamp: Long, count: Int)
}
