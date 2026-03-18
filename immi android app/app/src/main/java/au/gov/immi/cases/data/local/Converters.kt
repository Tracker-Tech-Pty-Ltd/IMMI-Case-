package au.gov.immi.cases.data.local

import androidx.room.TypeConverter

/**
 * Room TypeConverter — 目前 entities 只用基本型別，
 * 此類別預留給未來需要的複雜型別轉換（如 List<String>、Date 等）
 */
class Converters {

    @TypeConverter
    fun fromStringList(value: List<String>?): String? =
        value?.joinToString(",")

    @TypeConverter
    fun toStringList(value: String?): List<String>? =
        value?.split(",")?.filter { it.isNotEmpty() }
}
