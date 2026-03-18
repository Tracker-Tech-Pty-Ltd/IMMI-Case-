package au.gov.immi.cases.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import au.gov.immi.cases.data.local.entity.CachedCaseEntity

@Dao
interface CachedCaseDao {

    @Query("SELECT * FROM cached_cases WHERE caseId = :caseId")
    suspend fun getCachedCase(caseId: String): CachedCaseEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCachedCase(case: CachedCaseEntity)

    @Query("DELETE FROM cached_cases WHERE cachedAt < :expiryTime")
    suspend fun deleteExpiredCache(expiryTime: Long)

    @Query("SELECT COUNT(*) FROM cached_cases")
    suspend fun getCacheSize(): Int
}
