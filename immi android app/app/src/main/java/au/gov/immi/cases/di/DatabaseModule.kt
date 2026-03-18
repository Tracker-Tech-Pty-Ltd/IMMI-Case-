package au.gov.immi.cases.di

import android.content.Context
import androidx.room.Room
import au.gov.immi.cases.data.local.AppDatabase
import au.gov.immi.cases.data.local.dao.CachedCaseDao
import au.gov.immi.cases.data.local.dao.CollectionDao
import au.gov.immi.cases.data.local.dao.SavedSearchDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt DI Module — 提供 Room 資料庫及其 DAO 依賴。
 *
 * 使用 [SingletonComponent] 確保整個 App 生命週期內只有一個資料庫實例。
 * fallbackToDestructiveMigration()：schema 版本升級時清除並重建資料庫。
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            AppDatabase.DATABASE_NAME
        )
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides
    fun provideCollectionDao(db: AppDatabase): CollectionDao = db.collectionDao()

    @Provides
    fun provideSavedSearchDao(db: AppDatabase): SavedSearchDao = db.savedSearchDao()

    @Provides
    fun provideCachedCaseDao(db: AppDatabase): CachedCaseDao = db.cachedCaseDao()
}
