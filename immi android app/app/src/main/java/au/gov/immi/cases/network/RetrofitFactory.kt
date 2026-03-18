package au.gov.immi.cases.network

import au.gov.immi.cases.network.api.AnalyticsApiService
import au.gov.immi.cases.network.api.CasesApiService
import au.gov.immi.cases.network.api.LegislationsApiService
import au.gov.immi.cases.network.api.SearchApiService
import au.gov.immi.cases.network.api.SystemApiService
import au.gov.immi.cases.network.interceptor.CsrfInterceptor
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Retrofit 工廠物件，負責建立所有 API Service 實例。
 *
 * 配置：
 * - Base URL: [serverUrl]/api/v1/
 * - Moshi（含 KotlinJsonAdapterFactory）
 * - HttpLoggingInterceptor（debug 模式下記錄 BODY）
 * - CsrfInterceptor（自動注入 X-CSRFToken 標頭）
 * - 30 秒 connect/read/write timeout
 */
object RetrofitFactory {

    private const val TIMEOUT_SECONDS = 30L

    /**
     * 建立配置完整的 Retrofit 實例
     *
     * @param serverUrl 伺服器根 URL（例如 "http://10.0.2.2:8080"）
     * @param enableLogging 是否啟用詳細 HTTP 日誌（debug build 使用）
     */
    fun create(
        serverUrl: String,
        enableLogging: Boolean = false
    ): Retrofit {
        val moshi = buildMoshi()
        val client = buildOkHttpClient(serverUrl, enableLogging)

        return Retrofit.Builder()
            .baseUrl("$serverUrl/api/v1/")
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    fun createCasesApi(serverUrl: String, enableLogging: Boolean = false): CasesApiService =
        create(serverUrl, enableLogging).create(CasesApiService::class.java)

    fun createAnalyticsApi(serverUrl: String, enableLogging: Boolean = false): AnalyticsApiService =
        create(serverUrl, enableLogging).create(AnalyticsApiService::class.java)

    fun createSearchApi(serverUrl: String, enableLogging: Boolean = false): SearchApiService =
        create(serverUrl, enableLogging).create(SearchApiService::class.java)

    fun createLegislationsApi(serverUrl: String, enableLogging: Boolean = false): LegislationsApiService =
        create(serverUrl, enableLogging).create(LegislationsApiService::class.java)

    fun createSystemApi(serverUrl: String, enableLogging: Boolean = false): SystemApiService =
        create(serverUrl, enableLogging).create(SystemApiService::class.java)

    // ─── 私有輔助方法 ─────────────────────────────────────────────────────────────

    private fun buildMoshi(): Moshi =
        Moshi.Builder()
            .addLast(KotlinJsonAdapterFactory())
            .build()

    private fun buildOkHttpClient(
        serverUrl: String,
        enableLogging: Boolean
    ): OkHttpClient {
        val csrfInterceptor = CsrfInterceptor(serverUrl)

        return OkHttpClient.Builder()
            .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(csrfInterceptor)
            .apply {
                if (enableLogging) {
                    val loggingInterceptor = HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BODY
                    }
                    addInterceptor(loggingInterceptor)
                }
            }
            .build()
    }
}
