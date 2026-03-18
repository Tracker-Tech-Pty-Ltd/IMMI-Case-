# IMMI Android App — 完整實作計劃

**目標**：建立 IMMI-Case 的 Android Native Kotlin 版本，完整復刻所有功能
**後端**：連接現有 Flask REST API (`/api/v1/*`)
**架構**：MVVM + Clean Architecture + Jetpack Compose
**計劃日期**：2026-03-17

---

## Phase 0: 文件探勘結果 (已完成)

### 0.1 現有 API 清單 (45 個端點)

| 域 | 數量 | 路徑前綴 |
|----|------|---------|
| Cases CRUD | 9 | `/api/v1/cases/` |
| Search | 2 | `/api/v1/search/` |
| Stats & Filters | 5 | `/api/v1/stats/`, `/api/v1/filter-options` |
| Analytics | 15 | `/api/v1/analytics/` |
| Legislations | 4 | `/api/v1/legislations/` |
| Taxonomy | 4 | `/api/v1/taxonomy/` |
| Jobs & Pipeline | 4 | `/api/v1/job-status`, `/api/v1/download/`, `/api/v1/pipeline-*` |
| LLM Council | 2 | `/api/v1/llm-council/` |
| Export | 2 | `/api/v1/export/` |
| Court Lineage | 1 | `/api/v1/court-lineage` |

### 0.2 ImmigrationCase 資料模型 (32 個欄位)

```
case_id, citation, title, court, court_code, date, year, url, judges,
catchwords, outcome, visa_type, legislation, text_snippet, full_text_path,
source, user_notes, tags, case_nature, legal_concepts, visa_subclass,
visa_class_code, applicant_name, respondent, country_of_origin,
visa_subclass_number, hearing_date, is_represented, representative,
visa_outcome_reason, legal_test_applied
```

### 0.3 26 個 Screen (對應 Android Destination)

```
Dashboard, CasesList, CaseDetail, CaseEdit, CaseAdd, CaseCompare,
Analytics, JudgeProfiles, JudgeDetail, JudgeCompare,
Legislations, LegislationDetail, Collections, CollectionDetail,
SavedSearches, Download, JobStatus, Pipeline,
GuidedSearch, SemanticSearch, CourtLineage, DataDictionary, LlmCouncil,
Settings, ServerConfig, DesignSystem (dev only)
```

### 0.4 本地儲存需求

Collections 和 Bookmarks 在 web 版使用 localStorage，Android 需改用 **Room Database**。
Saved Searches 同樣需要 Room。Server URL 設定使用 **DataStore Preferences**。

### 0.5 技術選型決策

| 需求 | 選擇 | 理由 |
|------|------|------|
| UI Framework | Jetpack Compose | 聲明式 UI，原生 Android 現代標準 |
| 網路 | Retrofit 2 + OkHttp | 業界標準，支援 Coroutines |
| JSON 解析 | Moshi (Kotlin 代碼生成) | 優於 Gson (null 安全)；優於 kotlinx.serialization (Retrofit 整合更簡單) |
| DI | Hilt | 官方推薦，與 ViewModel 整合最佳 |
| 狀態管理 | ViewModel + StateFlow + Compose State | MVVM 標準 |
| 本地 DB | Room 2.6 | 取代 localStorage；支援 Coroutines Flow |
| 使用者偏好 | DataStore Preferences | 取代 sessionStorage |
| 分頁 | Paging 3 | 案例列表最多 50K 筆，必須分頁 |
| 圖表 | Vico (patrykandpatrick/vico) | Compose-first 圖表庫；支援線圖、柱圖、堆疊圖 |
| 圖片 | Coil 3 | Compose-first 圖片載入（法官照片） |
| 導航 | Navigation Compose + Type-safe routes | 類型安全路由，支援 deep links |
| 非同步 | Coroutines + Flow | Kotlin 原生 |
| Markdown | Compose Markdown (Jetpack) | 法律文本可能含 HTML |
| 測試 | JUnit5 + MockK + Turbine + Compose UI Test | 完整測試金字塔 |

---

## Phase 1: 專案骨架 (Project Setup)

### 目標
建立 Android 專案，配置所有依賴，定義基礎架構層。

### 1.1 建立 Android 專案

**位置**：`/Users/d/Developer/IMMI-Case-/immi android app/`
**專案名稱**：`ImmiAndroid`
**Package**：`au.gov.immi.cases`
**Min SDK**：26 (Android 8.0，覆蓋 98% 設備)
**Target SDK**：35 (Android 15)
**Build System**：Gradle (Kotlin DSL)

```
immi android app/
├── app/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/au/gov/immi/cases/
│   │   │   │   ├── core/
│   │   │   │   │   ├── api/          # Retrofit interfaces
│   │   │   │   │   ├── db/           # Room database
│   │   │   │   │   ├── di/           # Hilt modules
│   │   │   │   │   ├── model/        # Data classes
│   │   │   │   │   └── util/         # Extensions, helpers
│   │   │   │   ├── feature/
│   │   │   │   │   ├── cases/        # CasesList, CaseDetail, CaseEdit...
│   │   │   │   │   ├── analytics/    # Analytics, JudgeProfiles...
│   │   │   │   │   ├── legislations/ # Legislations, LegislationDetail
│   │   │   │   │   ├── collections/  # Collections, CollectionDetail
│   │   │   │   │   ├── search/       # GuidedSearch, SemanticSearch
│   │   │   │   │   ├── dashboard/    # Dashboard
│   │   │   │   │   ├── pipeline/     # Download, JobStatus, Pipeline
│   │   │   │   │   └── llm/          # LlmCouncil
│   │   │   │   ├── navigation/       # NavGraph, Routes
│   │   │   │   ├── ui/
│   │   │   │   │   ├── theme/        # Colors, Typography, Shapes
│   │   │   │   │   └── component/    # Shared composables
│   │   │   │   └── MainActivity.kt
│   │   │   ├── res/
│   │   │   └── AndroidManifest.xml
│   │   └── test/ & androidTest/
│   └── build.gradle.kts
├── gradle/
│   └── libs.versions.toml    # Version catalog
└── build.gradle.kts
```

### 1.2 libs.versions.toml (Version Catalog)

```toml
[versions]
kotlin = "2.0.21"
agp = "8.7.3"
compose-bom = "2024.12.01"
hilt = "2.52"
retrofit = "2.11.0"
okhttp = "4.12.0"
moshi = "1.15.1"
room = "2.7.0"
datastore = "1.1.1"
paging = "3.3.4"
navigation = "2.8.4"
vico = "2.0.0"
coil = "3.0.4"
coroutines = "1.9.0"
lifecycle = "2.8.7"
turbine = "1.2.0"
mockk = "1.13.13"

[libraries]
compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "compose-bom" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }
compose-material3 = { group = "androidx.compose.material3", name = "material3" }
compose-navigation = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigation" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-android-compiler", version.ref = "hilt" }
hilt-navigation-compose = { group = "androidx.hilt", name = "hilt-navigation-compose", version = "1.2.0" }
retrofit = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
retrofit-moshi = { group = "com.squareup.retrofit2", name = "converter-moshi", version.ref = "retrofit" }
okhttp-logging = { group = "com.squareup.okhttp3", name = "logging-interceptor", version.ref = "okhttp" }
moshi-kotlin = { group = "com.squareup.moshi", name = "moshi-kotlin", version.ref = "moshi" }
moshi-codegen = { group = "com.squareup.moshi", name = "moshi-kotlin-codegen", version.ref = "moshi" }
room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
room-paging = { group = "androidx.room", name = "room-paging", version.ref = "room" }
paging-compose = { group = "androidx.paging", name = "paging-compose", version.ref = "paging" }
vico-compose = { group = "com.patrykandpatrick.vico", name = "compose-m3", version.ref = "vico" }
coil-compose = { group = "io.coil-kt.coil3", name = "coil-compose", version.ref = "coil" }
coil-network = { group = "io.coil-kt.coil3", name = "coil-network-okhttp", version.ref = "coil" }
datastore-preferences = { group = "androidx.datastore", name = "datastore-preferences", version.ref = "datastore" }
```

### 1.3 核心資料模型

**檔案**：`core/model/ImmigrationCase.kt`

```kotlin
@JsonClass(generateAdapter = true)
data class ImmigrationCase(
    @Json(name = "case_id") val caseId: String = "",
    val citation: String = "",
    val title: String = "",
    val court: String = "",
    @Json(name = "court_code") val courtCode: String = "",
    val date: String = "",
    val year: Int = 0,
    val url: String = "",
    val judges: String = "",
    val catchwords: String = "",
    val outcome: String = "",
    @Json(name = "visa_type") val visaType: String = "",
    val legislation: String = "",
    @Json(name = "text_snippet") val textSnippet: String = "",
    val source: String = "",
    @Json(name = "user_notes") val userNotes: String = "",
    val tags: String = "",
    @Json(name = "case_nature") val caseNature: String = "",
    @Json(name = "legal_concepts") val legalConcepts: String = "",
    @Json(name = "visa_subclass") val visaSubclass: String = "",
    @Json(name = "visa_class_code") val visaClassCode: String = "",
    @Json(name = "applicant_name") val applicantName: String = "",
    val respondent: String = "",
    @Json(name = "country_of_origin") val countryOfOrigin: String = "",
    @Json(name = "hearing_date") val hearingDate: String = "",
    @Json(name = "is_represented") val isRepresented: String = "",
    val representative: String = "",
    @Json(name = "visa_outcome_reason") val visaOutcomeReason: String = "",
    @Json(name = "legal_test_applied") val legalTestApplied: String = ""
)
```

### 1.4 Retrofit API Interfaces (按域分割)

**5 個 Retrofit Interface 檔案**：

```
core/api/
├── CasesApiService.kt        # /cases/* (9 端點)
├── AnalyticsApiService.kt    # /analytics/* (15 端點)
├── LegislationsApiService.kt # /legislations/* (4 端點)
├── SearchApiService.kt       # /search/*, /taxonomy/* (6 端點)
├── SystemApiService.kt       # stats, jobs, pipeline, export, llm (11 端點)
└── ApiResponse.kt            # 通用回應封裝
```

**ApiResponse.kt**:
```kotlin
@JsonClass(generateAdapter = true)
data class ApiResponse<T>(
    val success: Boolean = true,
    val data: T? = null,
    val error: String? = null,
    val meta: Meta? = null
)

@JsonClass(generateAdapter = true)
data class Meta(val total: Int = 0, val page: Int = 1, val limit: Int = 20, val pages: Int = 1)
```

### 1.5 Hilt Modules

```kotlin
// NetworkModule.kt  — OkHttpClient, Retrofit, 所有 ApiService
// DatabaseModule.kt — Room Database, DAO instances
// RepositoryModule.kt — 綁定 Repository 介面到實作
```

### 1.6 Server Config (DataStore)

```kotlin
object ServerConfig {
    val DEFAULT_URL = "http://10.0.2.2:8080" // Android emulator → localhost
    // key: "server_url" in DataStore
}
```

### 驗證清單
- [ ] `./gradlew assembleDebug` 成功
- [ ] Hilt 注入無錯誤
- [ ] Retrofit 可呼叫 `/api/v1/csrf-token`
- [ ] Room 資料庫可建立並插入測試資料
- [ ] DataStore 可讀寫 server_url

---

## Phase 2: 基礎 UI 框架

### 2.1 導航架構

**型別安全路由（Navigation Compose 2.8）**：

```kotlin
@Serializable object Dashboard
@Serializable object CasesList
@Serializable data class CaseDetail(val caseId: String)
@Serializable data class CaseEdit(val caseId: String)
@Serializable object CaseAdd
@Serializable data class CaseCompare(val caseIds: String)
@Serializable object Analytics
@Serializable object JudgeProfiles
@Serializable data class JudgeDetail(val judgeName: String)
@Serializable data class JudgeCompare(val judgeNames: String)
@Serializable object Legislations
@Serializable data class LegislationDetail(val legislationId: String)
@Serializable object Collections
@Serializable data class CollectionDetail(val collectionId: String)
@Serializable object SavedSearches
@Serializable object Download
@Serializable object JobStatus
@Serializable object Pipeline
@Serializable object GuidedSearch
@Serializable object SemanticSearch
@Serializable object CourtLineage
@Serializable object DataDictionary
@Serializable object LlmCouncil
@Serializable object Settings
```

### 2.2 主題系統 (Material 3)

```kotlin
val ImmiLightColors = lightColorScheme(
    primary = Color(0xFF1e40af),       // --color-primary (藍)
    secondary = Color(0xFF0e7490),     // --color-accent (青)
    surface = Color(0xFFf8fafc),
    background = Color(0xFFf1f5f9),
    error = Color(0xFFdc2626)
)

// Outcome Colors
val OutcomeColors = mapOf(
    "Granted" to Color(0xFF22c55e),    // 綠
    "Affirmed" to Color(0xFF64748b),   // 灰
    "Dismissed" to Color(0xFFef4444),  // 紅
    "Allowed" to Color(0xFF3b82f6),    // 藍
    "Set Aside" to Color(0xFFf59e0b),  // 橙
    "Refused" to Color(0xFFdc2626),    // 深紅
    "Remitted" to Color(0xFF8b5cf6)    // 紫
)
```

### 2.3 Bottom Navigation (5 個主要 Tab)

```
首頁 (Dashboard) | 案件 (Cases) | 分析 (Analytics) | 法律 (Legislations) | 更多 (More)
```

**更多選單展開**：Collections, Saved Searches, Judges, Guided Search,
Semantic Search, Court Lineage, Download, Pipeline, Job Status, LLM Council,
Data Dictionary, Settings

### 2.4 共用元件清單

```
CourtBadge, OutcomeBadge, NatureBadge, CaseCard, StatCard,
FilterChip, PaginationBar, EmptyState, LoadingOverlay,
ErrorBanner, SearchBar, BottomFilterSheet
```

### 驗證清單
- [ ] 所有 26 個 Destination 可導航
- [ ] Light/Dark 主題切換正常
- [ ] Bottom Navigation active state 正確
- [ ] Back Stack 行為符合預期

---

## Phase 3: 案件核心功能

### 3.1 Cases List Screen

**功能**：Paging 3 無限滾動 + 篩選底部抽屜 + 多選批量操作

```kotlin
class CasesViewModel : ViewModel() {
    val filterState: StateFlow<CasesFilter>
    val casesFlow: Flow<PagingData<ImmigrationCase>>  // flatMapLatest pattern
    val totalCount: StateFlow<Int>
    val filterOptions: StateFlow<FilterOptions>

    fun updateFilter(filter: CasesFilter)
    fun batchDelete(caseIds: List<String>)
}

// Paging Source
class CasesPagingSource(
    private val api: CasesApiService,
    private val filter: CasesFilter
) : PagingSource<Int, ImmigrationCase>()
```

**API**：`GET /api/v1/cases`, `/cases/count`, `/filter-options`

### 3.2 Case Detail Screen

**32 個欄位按語義分組**：
```
身份: citation, title, court, date, judges
申請: applicant_name, respondent, country_of_origin, is_represented
簽證: visa_type, visa_subclass, visa_outcome_reason
案件: case_nature, legal_concepts, legal_test_applied, outcome
文件: catchwords, legislation, text_snippet → 全文閱讀器
```

**特色功能**：相關案件橫向列表、語義相似案件、書籤、分享 AustLII 連結

**API**：`GET /cases/<id>`, `/cases/<id>/related`, `/cases/<id>/similar`

### 3.3 Case Edit Screen
`PUT /api/v1/cases/<id>` — 18 個可編輯欄位表單

### 3.4 Case Add Screen
`POST /api/v1/cases` — 建立新案件表單

### 3.5 Case Compare Screen
`GET /api/v1/cases/compare?case_ids=id1,id2,...` — 橫向並排，14 個欄位差異高亮

### 3.6 Collections (Room Database)

```kotlin
@Entity(tableName = "collections")
data class CollectionEntity(
    @PrimaryKey val id: String, val name: String,
    val description: String, val createdAt: Long, val color: String
)

@Entity(tableName = "collection_cases")
data class CollectionCaseEntity(
    @PrimaryKey val id: String, val collectionId: String,
    val caseId: String, val notes: String,
    val sortOrder: Int, val addedAt: Long
)
```

匯出：`POST /api/v1/collections/export` → 下載 HTML 報告

### 驗證清單
- [ ] Cases List Paging 無限滾動正常
- [ ] 篩選/排序即時更新
- [ ] Case Detail 全欄位正確顯示
- [ ] Case Compare 差異高亮正確
- [ ] Collection Room CRUD 持久化

---

## Phase 4: 搜尋功能

### 4.1 Global Search
Top App Bar 整合，debounce 300ms，`GET /api/v1/search?q=...&mode=lexical/semantic/hybrid`

### 4.2 Semantic Search Screen
自然語言輸入 + 提供者選擇 + 相似度評分顯示
`GET /api/v1/search/semantic?q=...&provider=openai`

### 4.3 Guided Search Screen (多步驟)

```
Step 1: 簽證子類別 → GET /api/v1/taxonomy/visa-lookup
Step 2: 法律概念多選 → GET /api/v1/taxonomy/legal-concepts
Step 3: 法官自動完成 → GET /api/v1/taxonomy/judges/autocomplete
Step 4: 提交 → POST /api/v1/taxonomy/guided-search
Step 5: 顯示結果
```

### 4.4 Saved Searches (Room)

```kotlin
@Entity(tableName = "saved_searches")
data class SavedSearchEntity(
    @PrimaryKey val id: String, val name: String,
    val query: String, val filters: String,  // JSON
    val createdAt: Long, val lastUsed: Long
)
```

---

## Phase 5: 分析功能 (Analytics)

### 5.1 Analytics Screen — 8 個圖表區塊

| 區塊 | 圖表類型 | API 端點 | 技術 |
|------|---------|---------|------|
| 結果分佈 | 水平柱狀圖 | `/analytics/outcomes` | Vico CartesianChart |
| 法官排行 | 排名列表 | `/analytics/judge-leaderboard` | LazyColumn |
| 法律概念 | 水平柱狀圖 | `/analytics/legal-concepts` | Vico CartesianChart |
| 案件性質×結果 | 熱力圖 | `/analytics/nature-outcome` | 自製 Canvas Grid |
| 月度趨勢 | 折線圖 | `/analytics/monthly-trends` | Vico CartesianChart |
| 簽證家族 | 圓餅圖 | `/analytics/visa-families` | 自製 Canvas |
| 概念共現矩陣 | 矩陣熱力圖 | `/analytics/concept-cooccurrence` | 自製 Canvas |
| Sankey 流程 | Sankey 圖 | `/analytics/flow-matrix` | 自製 DrawScope |

**篩選參數**：court, year_from, year_to, case_natures, visa_subclasses, outcome_types

### 5.2 Judge Profiles Screen
排行榜 LazyColumn，排序/篩選，多選比較（最多 4 位）

### 5.3 Judge Detail Screen — 9 個區塊
法官 Hero 卡片（Coil 圖片）→ 結果堆疊圖 → 年度趨勢 → 法院比較 →
簽證類別 → 案件性質 → 法律代理 → 國家起源 → 近期案件

**API**：`/analytics/judge-profile`, `/analytics/judge-bio`, `/judge-photo/<filename>`

### 5.4 Dashboard Screen
4 個 StatCard + Vico 圖表 + 快速搜尋 + 5 筆近期案件

### 驗證清單
- [ ] 所有 8 個 Analytics 圖表正確渲染
- [ ] Analytics Filters 更新後圖表即時重載
- [ ] Judge Detail 9 個區塊完整顯示
- [ ] Dashboard 統計數字與 API 一致

---

## Phase 6: 法律法規

### 6.1 Legislations List Screen
分頁列表 + 搜尋（最少 2 字）+ shortcode badge
`GET /api/v1/legislations`, `/legislations/search?q=...`

### 6.2 Legislation Detail Screen
全文閱讀 + Section 目錄 + 錨點導航 + 本地內文搜尋
`GET /api/v1/legislations/<id>`

---

## Phase 7: 工作與管道管理

### 7.1 Download Screen
資料庫多選 + 年份範圍 + 批次大小 → `POST /api/v1/download/start`

### 7.2 Job Status Screen
2 秒輪詢（`repeatOnLifecycle` + Flow），進度條 + 日誌
`GET /api/v1/job-status`

### 7.3 Pipeline Screen
法院爬取狀態 + Quick/Full 按鈕
`GET /api/v1/pipeline-status`, `POST /api/v1/pipeline-action`

---

## Phase 8: 進階功能

### 8.1 LLM Council Screen
問題輸入（8K 上限）+ 案例上下文選擇器 + LLM 健康狀態 + Markdown 回應
`GET /api/v1/llm-council/health`, `POST /api/v1/llm-council/run`

### 8.2 Court Lineage Screen
法院演變時間線（自製 Canvas）+ 案件量 Vico 柱狀圖
`GET /api/v1/court-lineage`

### 8.3 Data Dictionary Screen
31 個欄位定義表格 + 本地搜尋
`GET /api/v1/data-dictionary`

### 8.4 Export Feature
`GET /api/v1/export/csv`, `/export/json` → Android DownloadManager

---

## Phase 9: 設定與 UX 優化

### 9.1 Settings Screen
```
伺服器設定: Server URL + 連線測試
外觀: 跟隨系統/淺色/深色
快取: 清除 API 快取 + 大小顯示
關於: 版本號、開源授權
```

### 9.2 離線支援 (Room Cache)

```kotlin
@Entity(tableName = "cached_cases")
data class CachedCaseEntity(
    @PrimaryKey val caseId: String,
    val caseJson: String,      // JSON serialized
    val cachedAt: Long,
    val accessCount: Int       // LRU eviction
)
```
快取最近 500 筆；無網路時顯示離線橫幅，仍可瀏覽快取案件

### 9.3 效能優化
- Paging 預載（prefetchDistance = 3 pages）
- Coil + OkHttp 圖片快取
- `key {}` 最佳化 Compose 列表重組

### 9.4 無障礙
- 所有元素 `contentDescription`
- TalkBack 支援
- 最小觸控目標 48dp × 48dp
- 色彩對比度 ≥ 4.5:1

---

## Phase 10: 測試套件

### 10.1 單元測試 (JUnit 5 + MockK + Turbine)

```
tests/
├── api/    CasesApiServiceTest, AnalyticsApiServiceTest  (MockWebServer)
├── vm/     CasesViewModelTest, AnalyticsViewModelTest    (Turbine Flow)
└── db/     CollectionsRepositoryTest                      (Room in-memory)
```

### 10.2 UI 測試 (Compose UI Test)

```kotlin
@Test
fun casesScreen_showsListAndFilters() {
    composeTestRule.setContent { CasesScreen(viewModel = fakeCasesViewModel) }
    composeTestRule.onNodeWithText("Affirmed").assertIsDisplayed()
}
```

### 10.3 覆蓋率目標

| 層 | 目標 |
|----|------|
| ViewModel | ≥ 80% |
| Repository | ≥ 75% |
| API Service | ≥ 70% |
| UI Composables | ≥ 40% (關鍵流程) |

---

## Phase 11: 打包與發佈準備

### BuildConfig

```kotlin
buildTypes {
    debug {
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:8080\"")
        buildConfigField("Boolean", "ENABLE_LOGGING", "true")
    }
    release {
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://your-server.com\"")
        minifyEnabled = true
        proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
}
```

### ProGuard 規則
```
-keepclassmembers class ** { @com.squareup.moshi.Json <fields>; }
-keepattributes Signature, Exceptions
-keep class * extends androidx.room.RoomDatabase
```

### 發佈 Checklist
- [ ] Adaptive Icon (12 尺寸)
- [ ] SplashScreen API
- [ ] Edge-to-Edge 支援
- [ ] 平板橫屏布局
- [ ] Release APK 簽名
- [ ] ProGuard 不破壞 Moshi 反射

---

## 關鍵技術挑戰

### 挑戰 1: Paging 3 + 篩選組合
```kotlin
// CasesViewModel 正確模式
val casesFlow: Flow<PagingData<ImmigrationCase>> = filterState
    .flatMapLatest { filter -> Pager(config) { CasesPagingSource(api, filter) }.flow }
    .cachedIn(viewModelScope)
```

### 挑戰 2: Analytics 圖表（熱力圖、Sankey）
Vico 不支援熱力圖和 Sankey。需要用 Compose `Canvas` + `DrawScope` 自製。
資料在 ViewModel 預處理為矩陣格式，再傳入 Composable。

### 挑戰 3: CSRF Token OkHttp Interceptor
```kotlin
class CsrfInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Chain): Response {
        val request = chain.request().newBuilder()
            .addHeader("X-CSRF-Token", tokenStore.getToken())
            .build()
        return chain.proceed(request)
    }
}
```

### 挑戰 4: Collections 離線優先
web 版純 localStorage → Android 用 Room 作為 single source of truth。
Collections Export 才呼叫 API（`POST /api/v1/collections/export`）。

### 挑戰 5: 全文閱讀器智慧渲染
仿照 web 版 CaseTextViewer 的 7 種行分類：
```kotlin
enum class LineType { SEPARATOR, METADATA, MAJOR_HEADING, DIALOGUE, FOOTNOTE, BLANK, BODY }

fun classifyLine(line: String): LineType = when {
    line.startsWith("====") -> LineType.SEPARATOR
    line.startsWith("Title:") || line.startsWith("Date:") -> LineType.METADATA
    line.uppercase() == line && line.length > 5 -> LineType.MAJOR_HEADING
    line.startsWith("Member:") || line.startsWith("Applicant:") -> LineType.DIALOGUE
    line.matches(Regex("\\[\\d+\\].*")) -> LineType.FOOTNOTE
    line.isBlank() -> LineType.BLANK
    else -> LineType.BODY
}
```

---

## 實作優先順序

| 優先級 | Phase | 複雜度 |
|--------|-------|--------|
| P0 | Phase 1: 專案骨架 | 中 |
| P0 | Phase 2: UI 框架 | 中 |
| P1 | Phase 3: Cases CRUD | 高 |
| P1 | Phase 4: 搜尋 | 中 |
| P1 | Phase 5: Analytics | 高 |
| P1 | Phase 6: Legislations | 低 |
| P2 | Phase 7: 工作管理 | 中 |
| P2 | Phase 9: 設定 & UX | 低 |
| P3 | Phase 8: 進階功能 | 高 |
| P3 | Phase 10: 測試 | 中 |
| P4 | Phase 11: 打包 | 低 |

---

## 參考文件

- Retrofit: https://square.github.io/retrofit/
- Vico Charts: https://patrykandpatrick.com/vico/wiki/
- Navigation Compose (Type-safe): https://developer.android.com/guide/navigation/design/type-safety
- Paging 3: https://developer.android.com/topic/libraries/architecture/paging/v3-overview
- Room + Coroutines: https://developer.android.com/training/data-storage/room
- Hilt: https://developer.android.com/training/dependency-injection/hilt-android
- Compose Material 3: https://developer.android.com/jetpack/compose/designsystems/material3
- Moshi: https://github.com/square/moshi
