package au.gov.immi.cases.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import au.gov.immi.cases.data.local.entity.CollectionCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CollectionDao {

    @Query("SELECT * FROM collections ORDER BY updatedAt DESC")
    fun getAllCollections(): Flow<List<CollectionEntity>>

    @Query("SELECT * FROM collections WHERE id = :id")
    suspend fun getCollectionById(id: Long): CollectionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCollection(collection: CollectionEntity): Long

    @Update
    suspend fun updateCollection(collection: CollectionEntity)

    @Delete
    suspend fun deleteCollection(collection: CollectionEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun addCaseToCollection(link: CollectionCaseEntity)

    @Query("DELETE FROM collection_cases WHERE collectionId = :collectionId AND caseId = :caseId")
    suspend fun removeCaseFromCollection(collectionId: Long, caseId: String)

    @Query("SELECT caseId FROM collection_cases WHERE collectionId = :collectionId ORDER BY addedAt DESC")
    fun getCaseIdsInCollection(collectionId: Long): Flow<List<String>>

    @Query("SELECT COUNT(*) FROM collection_cases WHERE collectionId = :collectionId")
    suspend fun getCaseCount(collectionId: Long): Int
}
