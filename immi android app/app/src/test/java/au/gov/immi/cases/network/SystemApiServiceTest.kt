package au.gov.immi.cases.network

import au.gov.immi.cases.network.api.SystemApiService
import au.gov.immi.cases.network.interceptor.CsrfInterceptor
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

class SystemApiServiceTest {

    private lateinit var server: MockWebServer
    private lateinit var service: SystemApiService

    @BeforeEach
    fun setUp() {
        server = MockWebServer()
        server.start()
        val moshi = Moshi.Builder().addLast(KotlinJsonAdapterFactory()).build()
        val retrofit = Retrofit.Builder()
            .baseUrl(server.url("/api/v1/"))
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
        service = retrofit.create(SystemApiService::class.java)
    }

    @AfterEach
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `getCsrfToken returns token`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                        "success": true,
                        "data": {"csrf_token": "test-csrf-token-xyz123"}
                    }
                    """.trimIndent()
                )
        )

        val response = service.getCsrfToken()

        assertTrue(response.isSuccessful)
        val body = response.body()
        assertNotNull(body)
        assertTrue(body!!.success)
        val token = body.data?.get("csrf_token")
        assertNotNull(token)
        assertFalse(token!!.isBlank(), "CSRF token should not be blank")
    }

    @Test
    fun `getStats returns data map`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{"total_cases": 149016, "courts": {"AATA": 39203, "FCA": 14987}}"""
                )
        )

        val response = service.getStats()

        assertTrue(response.isSuccessful)
        val body = response.body()
        assertNotNull(body)
        // getStats() returns Map<String, Any> (no standard envelope) — check map keys directly
        assertTrue(body!!.containsKey("total_cases"))
        assertNotNull(body["total_cases"])
    }

    @Test
    fun `CsrfInterceptor injects X-CSRFToken header on POST`() {
        // 設置 MockWebServer：
        // 1. 第一個請求：返回 CSRF token（由 interceptor 自動獲取）
        // 2. 第二個請求：實際 POST，interceptor 注入 X-CSRFToken 標頭
        val baseUrl = server.url("/").toString().dropLast(1)

        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": {"csrf_token": "csrf-abc-123"}}""")
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": null}""")
        )

        val csrfInterceptor = CsrfInterceptor(baseUrl)
        val client = OkHttpClient.Builder()
            .addInterceptor(csrfInterceptor)
            .build()

        val jsonBody = """{"courts": "AATA"}"""
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("$baseUrl/api/v1/pipeline/start")
            .post(jsonBody)
            .build()
        client.newCall(request).execute()

        // 第一個請求：interceptor 自動獲取 CSRF token
        val firstRequest = server.takeRequest()
        assertTrue(
            firstRequest.path!!.contains("csrf-token"),
            "First request should fetch CSRF token, path was: ${firstRequest.path}"
        )

        // 第二個請求：實際 POST，應帶有 X-CSRFToken 標頭
        val secondRequest = server.takeRequest()
        val csrfHeader = secondRequest.getHeader("X-CSRFToken")
        assertNotNull(csrfHeader, "POST request should have X-CSRFToken header")
        assertEquals("csrf-abc-123", csrfHeader)
    }

    @Test
    fun `CsrfInterceptor does not add header to GET requests`() {
        val baseUrl = server.url("/").toString().dropLast(1)

        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": {"total_cases": 100}}""")
        )

        val csrfInterceptor = CsrfInterceptor(baseUrl)
        val client = OkHttpClient.Builder()
            .addInterceptor(csrfInterceptor)
            .build()

        val getRequest = Request.Builder()
            .url("$baseUrl/api/v1/stats")
            .get()
            .build()
        client.newCall(getRequest).execute()

        val recordedRequest = server.takeRequest()
        val csrfHeader = recordedRequest.getHeader("X-CSRFToken")
        // GET 請求不應有 CSRF token
        assertNull(csrfHeader, "GET request should NOT have X-CSRFToken header")
    }

    @Test
    fun `CsrfInterceptor caches token and reuses it`() {
        val baseUrl = server.url("/").toString().dropLast(1)

        // 只需 enqueue 一次 CSRF token 回應 + 兩次 POST 回應
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": {"csrf_token": "cached-token-456"}}""")
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": null}""")
        )
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("""{"success": true, "data": null}""")
        )

        val csrfInterceptor = CsrfInterceptor(baseUrl)
        val client = OkHttpClient.Builder()
            .addInterceptor(csrfInterceptor)
            .build()

        val jsonBody = """{}""".toRequestBody("application/json".toMediaType())

        // 第一個 POST
        client.newCall(
            Request.Builder()
                .url("$baseUrl/api/v1/pipeline/start")
                .post(jsonBody)
                .build()
        ).execute()

        // 第二個 POST：應重用快取 token，不再重新獲取
        client.newCall(
            Request.Builder()
                .url("$baseUrl/api/v1/download/start")
                .post(jsonBody)
                .build()
        ).execute()

        // 應有 3 個請求：csrf + post1 + post2
        val req1 = server.takeRequest()
        val req2 = server.takeRequest()
        val req3 = server.takeRequest()

        assertTrue(req1.path!!.contains("csrf-token"), "First request should be csrf-token")
        assertEquals("cached-token-456", req2.getHeader("X-CSRFToken"), "First POST should have cached token")
        assertEquals("cached-token-456", req3.getHeader("X-CSRFToken"), "Second POST should reuse cached token")
    }

    @Test
    fun `getJobs returns job status map`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """
                    {
                        "success": true,
                        "data": {
                            "pipeline": {"status": "idle"},
                            "download": {"status": "idle"}
                        }
                    }
                    """.trimIndent()
                )
        )

        val response = service.getJobs()

        assertTrue(response.isSuccessful)
        val body = response.body()
        assertNotNull(body)
        assertTrue(body!!.success)
    }
}
