package au.gov.immi.cases.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** 案件集合（類似播放清單），儲存使用者建立的案件分組 */
@Entity(tableName = "collections")
data class CollectionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String = "",
    val color: String = "#3b82f6",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)
