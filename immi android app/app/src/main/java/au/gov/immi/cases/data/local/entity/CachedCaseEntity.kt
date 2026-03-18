package au.gov.immi.cases.data.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 本地快取的案件資料，只儲存常用欄位（不需全 31 欄）。
 * caseId 有 unique 索引，確保不重複快取同一案件。
 */
@Entity(
    tableName = "cached_cases",
    indices = [Index("caseId", unique = true)]
)
data class CachedCaseEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val caseId: String,
    val citation: String,
    val title: String,
    val court: String,
    val courtCode: String,
    val year: Int,
    val outcome: String,
    val judges: String,
    val caseNature: String,
    val visaType: String,
    val tags: String,
    val textSnippet: String,
    val cachedAt: Long = System.currentTimeMillis()
)
