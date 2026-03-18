package au.gov.immi.cases.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** 儲存的搜尋條件，query 為 JSON 編碼的搜尋參數 */
@Entity(tableName = "saved_searches")
data class SavedSearchEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val query: String,
    val resultCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val lastRunAt: Long = 0
)
