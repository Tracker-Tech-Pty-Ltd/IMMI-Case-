package au.gov.immi.cases.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

// 使用 Kotlin extension property 建立單一 DataStore 實例（避免多次建立）
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = "app_preferences"
)

/**
 * Hilt DI Module — 提供 DataStore<Preferences> 實例。
 *
 * 使用 [SingletonComponent] 確保整個 App 生命週期只有一個 DataStore。
 */
@Module
@InstallIn(SingletonComponent::class)
object PreferencesModule {

    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext context: Context): DataStore<Preferences> =
        context.dataStore
}
