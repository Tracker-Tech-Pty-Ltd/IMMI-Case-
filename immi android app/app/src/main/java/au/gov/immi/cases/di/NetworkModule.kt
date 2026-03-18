package au.gov.immi.cases.di

import au.gov.immi.cases.BuildConfig
import au.gov.immi.cases.data.preferences.AppPreferences
import au.gov.immi.cases.network.RetrofitFactory
import au.gov.immi.cases.network.api.AnalyticsApiService
import au.gov.immi.cases.network.api.CasesApiService
import au.gov.immi.cases.network.api.LegislationsApiService
import au.gov.immi.cases.network.api.SearchApiService
import au.gov.immi.cases.network.api.SystemApiService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import retrofit2.Retrofit
import javax.inject.Singleton

/**
 * Hilt DI Module — 提供所有網路層依賴。
 *
 * 關鍵設計：所有 5 個 API Service 共用同一個 [Retrofit] 實例（因此共用同一個
 * OkHttpClient 和同一個 CsrfInterceptor token 快取）。若各自建立 Retrofit，
 * 每個 Service 會有獨立的 CSRF token 快取，導致不必要的重複請求。
 *
 * 注意：[provideServerUrl] 使用 runBlocking，因為 Hilt @Provides 不支援 suspend 函數。
 * 此方法僅在 App 啟動時執行一次，是可接受的模式。
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /**
     * 從 [AppPreferences] 讀取伺服器 URL。
     * 使用 runBlocking 是因為 Dagger @Provides 函數不能是 suspend。
     */
    @Provides
    @Singleton
    fun provideServerUrl(appPreferences: AppPreferences): String =
        runBlocking { appPreferences.serverUrl.first() }

    /**
     * 建立共享的 [Retrofit] 實例。所有 API Service 都從這個實例建立，
     * 確保共用同一個 OkHttpClient、CsrfInterceptor 和連線池。
     */
    @Provides
    @Singleton
    fun provideRetrofit(serverUrl: String): Retrofit =
        RetrofitFactory.create(serverUrl, enableLogging = BuildConfig.ENABLE_LOGGING)

    @Provides
    @Singleton
    fun provideCasesApiService(retrofit: Retrofit): CasesApiService =
        retrofit.create(CasesApiService::class.java)

    @Provides
    @Singleton
    fun provideAnalyticsApiService(retrofit: Retrofit): AnalyticsApiService =
        retrofit.create(AnalyticsApiService::class.java)

    @Provides
    @Singleton
    fun provideSearchApiService(retrofit: Retrofit): SearchApiService =
        retrofit.create(SearchApiService::class.java)

    @Provides
    @Singleton
    fun provideLegislationsApiService(retrofit: Retrofit): LegislationsApiService =
        retrofit.create(LegislationsApiService::class.java)

    @Provides
    @Singleton
    fun provideSystemApiService(retrofit: Retrofit): SystemApiService =
        retrofit.create(SystemApiService::class.java)
}
