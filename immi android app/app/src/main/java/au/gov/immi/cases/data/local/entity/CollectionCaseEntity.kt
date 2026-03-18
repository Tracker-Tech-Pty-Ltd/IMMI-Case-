package au.gov.immi.cases.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

/** 集合與案件的多對多關聯表。删除 Collection 時 CASCADE 刪除所有關聯 */
@Entity(
    tableName = "collection_cases",
    primaryKeys = ["collectionId", "caseId"],
    foreignKeys = [
        ForeignKey(
            entity = CollectionEntity::class,
            parentColumns = ["id"],
            childColumns = ["collectionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index("collectionId"),
        Index("caseId")
    ]
)
data class CollectionCaseEntity(
    val collectionId: Long,
    val caseId: String,
    val addedAt: Long = System.currentTimeMillis()
)
