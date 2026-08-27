# IMMI-Case 系統整合主計畫

日期：2026-03-15  
狀態：可作為多個 session 的主待辦清單  
方法：Test-Driven + Subagent-Driven + Browser Visual Verification

## 1. 這份計畫涵蓋什麼

這份文件把下列來源整合成單一執行藍圖：

- `docs/archive/IMPROVEMENT_PLAN.md`
- `frontend/I18N_IMPLEMENTATION_PLAN.md`
- `.auto-claude/roadmap/roadmap.json`
- `.auto-claude/roadmap/roadmap_discovery.json`
- `.auto-claude/specs/*/spec.md`
- `.auto-claude/specs/*/implementation_plan.json`
- `README.md` 內的 TODO 截圖項
- 目前實際驗證結果：建置、測試、瀏覽器視覺操作

已完成但不列為新整合項：

- Court Lineage Timeline Visualization
- Webapp Split / Data Layer Refactor 的已完成部分

## 2. 目前基線與已驗證事實

### 2.1 已通過

- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd workers/austlii-scraper && npm exec tsc -- --noEmit -p tsconfig.json`

### 2.2 已失敗

- `cd frontend && npm run test -- --run`
- `python3 -m pytest tests/e2e/react/test_react_batch.py -k 'select_multiple or deselect_reduces_count' -vv`

### 2.3 實際瀏覽器驗證結果

以真實瀏覽器操作驗證：

- `http://127.0.0.1:8080/` 可正常載入 Dashboard
- `http://127.0.0.1:8080/cases` 可正常載入 Cases 清單
- `http://127.0.0.1:8080/analytics` 可正常載入 Analytics
- 在 `/cases` 手動勾選前兩筆可見案件，畫面可進入 `2 selected`，並出現 `Compare Cases`

### 2.4 已確認的現況問題

1. `/app/` 入口與目前 React Router 基底不一致  
   現象：瀏覽器 console 出現 `No routes matched location "/app/"`

2. E2E 批次勾選測試不是單純「功能壞掉」，而是測試定位策略已漂移  
   現象：Playwright 用 `tbody input[type='checkbox']` 的 `nth(1)`，實際抓到的不是畫面上第二列可見案件，而是隱藏或非預期 DOM checkbox，例如 `[2024] FedCFamC2G 250`  
   結論：這是一個高優先的測試穩定性問題

3. 前端單元測試有多處預期值落後於現行實作  
   這會阻塞 CI，也會讓後續重構缺乏可信防護網

4. README 與實際行為/設定存在漂移  
   例子：
   - README 還指向 `/app/`
   - README 的 `BACKEND_PORT` 預設值與 `.env.example` 不一致
   - README 截圖 manifest 還有 3 張 TODO 截圖未完成

## 3. 執行規則

## 3.1 Subagent-Driven 規則

此環境沒有真正的「子代理派發器」，所以這份文件採用「subagent-ready session cards」形式。  
做法是：每一個任務由一個新的 session 負責，避免上下文污染，完成後交回 review，再開始下一個任務。

每個 fresh subagent/session 必須遵守：

1. 先讀對應任務卡與指定檔案，不擴散範圍
2. 先寫或修正失敗測試，再動實作
3. 實作後跑最小必要測試集
4. 做瀏覽器視覺驗證
5. 交付簡短 handoff：
   - 改了什麼
   - 測試結果
   - 還剩什麼

## 3.2 TDD 規則

每個任務都用同一個節奏：

1. 寫一個能重現問題或定義需求的測試
2. 確認測試先失敗
3. 寫最小修改讓測試通過
4. 補強邊界案例
5. 重構
6. 重新驗證

## 3.3 Browser Visual Verification 規則

每個 UI 相關任務收尾都必做：

1. 啟動本地站點：`python3 web.py --port 8080`
2. 開啟目標頁面
3. 等待主標題與主要資料元件出現
4. 檢查 console/network 是否有新錯誤
5. 完成目標互動
6. 截圖或快照記錄結果

建議最低驗證頁面：

- `/`
- `/cases`
- `/analytics`
- 任務影響到的專屬頁面

## 4. 多 session 執行順序

| Queue | Task ID | 任務 | 依賴 |
|---|---|---|---|
| 01 | T01 | 路由/入口/README 漂移修正 | 無 |
| 02 | T02 | Cases 批次勾選 E2E 穩定化 | T01 |
| 03 | T03 | 前端 Vitest 漂移修正 | T02 |
| 04 | T04 | Security Hardening | T01 |
| 05 | T05 | API 輸入驗證與錯誤模型 | T04 |
| 06 | T06 | JobManager 與背景工作狀態收斂 | T05 |
| 07 | T07 | SmartPipeline 狀態封裝與 config 解耦 | T06 |
| 08 | T08 | `api.py` 拆分與 migration 基礎 | T05 |
| 09 | T09 | Scraper 統一介面 + Federal Court 修復 | T08 |
| 10 | T10 | 自動排程、資料新鮮度監控、通知骨架 | T09 |
| 11 | T11 | 結構化欄位、法官標準化、代表人資料補全 | T09 |
| 12 | T12 | Search taxonomy + transparent scoring | T08 |
| 13 | T13 | Saved searches + Collections + Bookmarks | T12 |
| 14 | T14 | External REST API + rate limiting + docs | T04, T08 |
| 15 | T15 | Judge analytics reports + legal submission reports | T14 |
| 16 | T16 | Citation network + legislation cross-reference + visa dashboards | T15 |
| 17 | T17 | Auth / accounts / notifications / collaboration foundation | T14 |
| 18 | T18 | Outcome prediction + representative effectiveness analytics | T11, T17 |
| 19 | T19 | i18n 全面補完 | T03 |
| 20 | T20 | CI/CD + production infra + observability | T04, T08, T14 |

## 5. 任務卡

### T01. 路由、入口、README 與截圖 TODO 收斂

來源：

- README TODO 截圖
- README `/app/` 啟動說明
- 瀏覽器驗證 `/app/` 路由不匹配

目標：

- 定義唯一正式入口
- 消除文件與實作漂移
- 補齊缺失截圖

實作步驟：

1. 決定正式站點入口是 `/` 還是 `/app/`
2. 對齊 React Router `basename`、Flask catch-all 與 README
3. 若保留舊入口，新增相容 redirect 或明確錯誤頁
4. 修正 README 的 `BACKEND_PORT` 說明
5. 補拍並加入：
   - `docs/screenshots/TODO_analytics.png`
   - `docs/screenshots/TODO_case_detail.png`
   - `docs/screenshots/TODO_judge_profile.png`
6. 新增一段「如何做視覺回歸驗證」文件

測試：

- 單元測試：若抽出 router/base path helper，驗證 path 組裝
- 整合測試：Flask 對 `/`、舊入口、SPA 路由回傳正確內容
- E2E：首頁、Cases、Analytics、Case Detail、Judge Profile 都能從正式入口進入
- 瀏覽器視覺驗證：確認沒有 `No routes matched location`

### T02. Cases 批次勾選 E2E 穩定化

來源：

- `tests/e2e/react/test_react_batch.py`
- 真實瀏覽器手動勾選成功
- Playwright `nth(1)` 選到非可見 checkbox

目標：

- 讓批次勾選測試反映真實使用者行為

實作步驟：

1. 不再用脆弱的 `nth()` + 原始 CSS selector 當主要定位方式
2. 改成以可見 row 為範圍，使用 role、label 或 `data-testid`
3. 若 DOM 含隱藏 checkbox，替可操作列加入穩定標記
4. 將：
   - `select_multiple`
   - `deselect_reduces_count`
   - `select_all_shows_batch_bar`
   一起重構
5. 補一個 regression test，明確驗證「只能操作可見列」
6. 補一個 visual smoke：勾選兩列後必須出現 `Compare Cases`

測試：

- 單元測試：若抽出 selection state helper，驗證 selected IDs 變化
- E2E：批次勾選、取消勾選、select all、compare button 出現
- 瀏覽器視覺驗證：Cases 頁面手動點前兩筆可見列後，確認 `2 selected` 和 `Compare Cases`

### T03. 前端 Vitest 漂移修正

來源：

- `PageLoader`
- `PageHeader`
- `fetchStats()` fallback 行為
- 目前 5 個前端測試失敗

目標：

- 讓測試跟實作重新同步，恢復可信 CI

實作步驟：

1. 逐個比對失敗測試與目前 UI/API 行為
2. 修正舊字串預期，例如 loading copy
3. 修正結構假設，例如 `p` 改成 `div/span`
4. 對 degraded fallback 改用 partial match，而不是過度嚴格的完全相等
5. 對共享元件建立更穩定的查詢模式
6. 補齊測試命名，標明是 rendering contract 還是 behavior contract

測試：

- 單元測試：所有既有 Vitest 套件
- 整合測試：API fallback contract
- 瀏覽器視覺驗證：Dashboard 與共用 loading/header 元件在真實頁面正確顯示

### T04. Security Hardening

來源：

- `docs/archive/IMPROVEMENT_PLAN.md` Phase 0
- roadmap 缺少 rate limiting / auth layer

範圍：

- 強制 `SECRET_KEY`
- CSRF on React write endpoints
- secure cookie flags
- API rate limiting

實作步驟：

1. 讓 production 環境缺少 `SECRET_KEY` 時直接 fail fast
2. 列出所有修改資料的 API 端點
3. 將 CSRF 驗證納入所有 state-changing requests
4. 設定 `Secure`、`HttpOnly`、`SameSite`
5. 加入基礎 rate limiting，至少保護搜尋與高成本 analytics/API
6. 補 environment 說明與 deployment checklist

測試：

- 單元測試：security config helper
- 整合測試：無 token 時寫入請求被拒絕；有 token 時通過
- 安全測試：rate limit exceeded 回應、cookie flags 檢查
- 瀏覽器視覺驗證：登入前後或帶 token 的操作流程不被錯誤阻塞

### T05. API 輸入驗證與錯誤模型

來源：

- `docs/archive/IMPROVEMENT_PLAN.md` Phase 1
- `api.py` monolith 與高風險參數解析

目標：

- 全面收斂 query/body/path 參數驗證

實作步驟：

1. 找出所有 `int()`、`float()`、自由字串拼接點
2. 建立共用 validator，例如 `safe_int`、`safe_float`、enum parser
3. 對所有 API 端點統一錯誤格式
4. 補 parameter boundary checks
5. 為 analytics/search 端點定義 max/min page size、limit、year range

測試：

- 單元測試：validator 邊界值
- 整合測試：非法參數回 `400` 並含可讀訊息
- E2E：前端輸入異常條件時顯示友善錯誤
- 瀏覽器視覺驗證：篩選器輸入無效值時狀態正確

### T06. JobManager 與背景工作狀態收斂

來源：

- `docs/archive/IMPROVEMENT_PLAN.md` Phase 1
- roadmap technical debt：daemon threads + dict-based status

目標：

- 用明確的 manager 物件取代可變全域 dict

實作步驟：

1. 找出 `_job_status` 和相關 thread 管理流程
2. 抽出 `JobManager`，封裝建立、取消、查詢、清理
3. 統一 job state schema
4. 對外只暴露讀取 API 與明確操作方法
5. 補可觀測欄位：started_at、updated_at、error、progress

測試：

- 單元測試：job lifecycle
- 整合測試：啟動/查詢/取消 job
- E2E：Pipeline / Jobs 頁面狀態刷新
- 瀏覽器視覺驗證：Jobs 頁面狀態更新、錯誤顯示、完成狀態

### T07. SmartPipeline 狀態封裝與 config 解耦

來源：

- `docs/archive/IMPROVEMENT_PLAN.md` Phase 6

目標：

- 移除 `_pipeline_status` 全域狀態與對 Flask request object 的耦合

實作步驟：

1. 抽出 pipeline state model
2. 將 config 由 request-time 讀取改為注入式設定
3. 將 pipeline 執行與 web layer 分離
4. 為 pipeline 定義 restart / retry / failure policy

測試：

- 單元測試：pipeline state transitions
- 整合測試：pipeline API 與 background execution
- E2E：Pipeline 頁面啟動、刷新、錯誤回報
- 瀏覽器視覺驗證：Pipeline 頁面各階段狀態顯示正確

### T08. `api.py` 拆分與 migration 基礎

來源：

- roadmap technical debt：`api.py` 約 4493 行
- roadmap technical debt：No migration system

目標：

- 降低維護成本，為後續功能鋪路

實作步驟：

1. 按領域拆分 routes：
   - search
   - analytics
   - judges
   - collections
   - pipeline/jobs
   - legislations
2. 建立 service layer，避免 route 直接持有商業邏輯
3. 導入 migration 方案，至少處理 schema versioning
4. 補 repository interface contract tests

測試：

- 單元測試：service layer
- 整合測試：各 blueprint endpoint 維持舊 contract
- 架構測試：import 邊界、循環依賴檢查
- 瀏覽器視覺驗證：Dashboard / Cases / Analytics 主頁面不回歸

### T09. Scraper 統一介面 + Federal Court 修復

來源：

- `docs/archive/IMPROVEMENT_PLAN.md` Phase 5
- roadmap known gap：Federal Court scraper broken

目標：

- 建立一致的 scraper contract 並修復已知來源缺陷

實作步驟：

1. 定義 `CaseScraper` protocol
2. 把現有 scraper 全部對齊同一介面
3. 抽出共用 `MetadataExtractor`
4. 修復 Federal Court scraper
5. 對來源錯誤加入 retry/backoff/structured logs

測試：

- 單元測試：單一 scraper parser fixtures
- 整合測試：多來源 contract tests
- 資料品質測試：欄位覆蓋率、去重
- 瀏覽器視覺驗證：新抓資料能在 Cases / Case Detail 正常呈現

### T10. 自動排程、資料新鮮度監控、通知骨架

來源：

- roadmap known gaps：No scheduled scraping、No automated data freshness monitoring、No notification system

目標：

- 系統不依賴人工更新

實作步驟：

1. 定義 scrape schedule
2. 建立 freshness metadata：last_success、source_age、staleness threshold
3. 建立 alert channel 抽象層
4. 先做內部通知，再擴充 email/webhook
5. 在 Dashboard / Pipeline 顯示 freshness badge

測試：

- 單元測試：freshness calculator
- 整合測試：排程觸發、監控狀態更新
- E2E：stale 資料時 UI 顯示警示
- 瀏覽器視覺驗證：Dashboard/Pipeline 顯示最新更新狀態

### T11. 結構化欄位、法官標準化、代表人資料補全

來源：

- roadmap known gaps：judge name standardization incomplete、representative/lawyer data limited、structured field fill rates low
- spec 009 Enhanced Structured Field Extraction

目標：

- 提升資料可分析性

實作步驟：

1. 定義欄位 coverage target
2. 改善 extraction pipeline 與 fallback strategy
3. 建立 judge canonicalization table
4. 建立 representative/lawyer normalization 流程
5. 回填既有資料並輸出品質報表

測試：

- 單元測試：normalizer / parser fixtures
- 整合測試：回填流程不破壞現有資料
- 資料品質測試：coverage before/after、dedupe rate
- 瀏覽器視覺驗證：Judge Profile、Analytics filters、Cases metadata 顯示更完整

### T12. Search taxonomy + transparent scoring

來源：

- spec 001 Immigration-Specific Search Taxonomy
- spec 010 Advanced Search with Transparent Result Scoring
- roadmap Phase 1

目標：

- 讓搜尋結果更可解釋、更可操作

實作步驟：

1. 定義移民法領域 taxonomy
2. 對查詢與案件建立 taxonomy mapping
3. 在搜尋結果顯示 score breakdown
4. 提供 lexical / semantic / hybrid 的可視化原因
5. 與 Guided Search、Taxonomy page 互通

測試：

- 單元測試：taxonomy mapper、score combiner
- 整合測試：search API 回 score explanation
- E2E：Guided Search 套用 taxonomy filter 後結果正確
- 瀏覽器視覺驗證：Search/Guided Search 頁面顯示 score breakdown

### T13. Saved searches + Collections + Bookmarks

來源：

- spec 003 Saved Searches with Quick Re-Execution
- spec 004 Case Bookmarks & Collections

目標：

- 支援研究工作流的持久化

實作步驟：

1. 定義 saved search schema
2. 定義 collections/bookmarks schema
3. 加入 create/update/delete/re-run API
4. 在 Cases、Collections、Saved Searches 頁面串接
5. 補 compare/export 與 selection flow 整合

測試：

- 單元測試：serialization / query restoration
- 整合測試：saved search CRUD、collection CRUD
- E2E：儲存搜尋、重新執行、加入收藏、比較案件
- 瀏覽器視覺驗證：Saved Searches、Collections 頁面完整流程

### T14. External REST API + rate limiting + docs

來源：

- spec 011 External REST API with Rate Limiting & Documentation
- roadmap Phase 4 public API

目標：

- 提供對外可用、可控、可說明的 API

實作步驟：

1. 決定公開 API 範圍
2. 建立 versioned endpoints
3. 補 OpenAPI / human docs / examples
4. 與 auth、quota、rate limiting 整合
5. 加入 API smoke checks 與 compatibility tests

測試：

- 單元測試：schema serialization
- 整合測試：OpenAPI contract、auth、rate limit
- E2E：API explorer 或 docs 頁面若存在則驗證
- 瀏覽器視覺驗證：文件頁、範例 request/response 呈現

### T15. Public judge analytics reports + legal submission reports

來源：

- spec 005 Public-Facing Judge Analytics Reports
- spec 007 Report Generation for Legal Submissions
- roadmap Phase 2 report generation

目標：

- 將分析輸出成可交付成果

實作步驟：

1. 定義報表模板
2. 抽出報表資料聚合層
3. 先支援 judge analytics report
4. 再支援 legal submission report
5. 支援 PDF/HTML/print-friendly export

測試：

- 單元測試：report formatter
- 整合測試：report data pipeline
- E2E：從 UI 產生報表
- 瀏覽器視覺驗證：列印版面、下載前預覽、圖表完整性

### T16. Citation network + legislation cross-reference + visa dashboards

來源：

- spec 012 Case Citation Network Visualization
- roadmap Phase 3 legislation-case cross-reference
- roadmap Phase 3 visa subclass dashboards

目標：

- 提升研究深度與探索能力

實作步驟：

1. 建 citation graph data model
2. 對案件與法條建立 cross-reference
3. 製作 visa subclass dashboard
4. 將 Case Detail / Analytics / Legislation Detail 串接

測試：

- 單元測試：graph builder、cross-reference linker
- 整合測試：graph API、legislation linking API
- E2E：從 case 進入 citation network，再進 legislation detail
- 瀏覽器視覺驗證：network visualization、dashboard、cross-link navigation

### T17. Auth / accounts / notifications / collaboration foundation

來源：

- roadmap Phase 2 user accounts
- roadmap known gaps：No user authentication / multi-tenant access、No real-time collaboration

目標：

- 為個人化與多人使用打基礎

實作步驟：

1. 先做最小 auth model：users、roles、ownership
2. 將 saved searches / collections / bookmarks 與 user 關聯
3. 建 notification preferences
4. 區分單人版與團隊版能力
5. collaboration 先做資料模型與權限，不急著做即時同步

測試：

- 單元測試：permission checks
- 整合測試：user-scoped queries、multi-tenant isolation
- E2E：登入後只能看到自己的收藏/搜尋
- 瀏覽器視覺驗證：auth flow、empty states、permission denied states

### T18. Outcome prediction + representative effectiveness analytics

來源：

- roadmap Phase 3 outcome prediction
- roadmap Phase 3 representative effectiveness analytics

目標：

- 從 descriptive analytics 進一步走向 predictive analytics

實作步驟：

1. 先定義不可越界的使用說明與 disclaimer
2. 建 baseline model 與 feature set
3. 做 offline evaluation
4. 僅在內部模式或 beta 顯示 prediction
5. 建 representative effectiveness aggregation

測試：

- 單元測試：feature pipeline
- 整合測試：prediction service contract
- 模型測試：offline metrics、data leakage checks
- 瀏覽器視覺驗證：prediction card、confidence/disclaimer 呈現

### T19. i18n 全面補完

來源：

- `frontend/I18N_IMPLEMENTATION_PLAN.md`

待補頁面：

- 高優先：
  - `DashboardPage.tsx`
  - `CasesPage.tsx`
  - `CaseDetailPage.tsx`
  - `AnalyticsPage.tsx`
  - `JudgeProfilesPage.tsx`
  - `JudgeDetailPage.tsx`
- 中低優先：
  - `DownloadPage.tsx`
  - `PipelinePage.tsx`
  - `JobStatusPage.tsx`
  - `CaseComparePage.tsx`
  - `JudgeComparePage.tsx`
  - `DataDictionaryPage.tsx`
  - `DesignTokensPage.tsx`
  - `CaseEditPage.tsx`
  - `CaseAddPage.tsx`

待補共享元件與圖表：

- Shared：
  - `Pagination.tsx`
  - `GlobalSearch.tsx`
  - `ConfirmModal.tsx`
  - `ApiErrorState.tsx`
  - `OutcomeBadge.tsx`
  - `EmptyState.tsx`
  - `AnalyticsFilters.tsx`
  - `CourtBadge.tsx`
  - `Breadcrumb.tsx`
  - `FilterPill.tsx`
  - `NatureBadge.tsx`
- Analytics：
  - `ChartCard.tsx`
  - `SuccessRateCalculator.tsx`
  - `TopJudgesChart.tsx`
  - `OutcomeByCourtChart.tsx`
  - `LegalConceptsChart.tsx`
  - 其餘計畫內列出的圖表元件
- Judges：
  - `JudgeLeaderboard.tsx`
  - `JudgeBioCard.tsx`
  - `CourtComparisonCard.tsx`
  - `RepresentationCard.tsx`
  - `ConceptEffectivenessTable.tsx`
  - `CountryOriginChart.tsx`
  - `VisaBreakdownChart.tsx`
  - `JudgeProfileHeader.tsx`
- Dashboard：
  - `StatCard.tsx`
  - `CourtChart.tsx`
  - `NatureChart.tsx`
  - `TrendChart.tsx`
  - `SubclassChart.tsx`
- Cases：
  - `CaseCard.tsx`
  - `CaseTextViewer.tsx`

實作步驟：

1. 先完成高流量頁面
2. 抽出重複字串與共用翻譯 key
3. 建立 i18n lint/check 腳本
4. 補語系切換 E2E
5. 補空字串、fallback、插值與 plural 測試

測試：

- 單元測試：translation key rendering
- 整合測試：語系切換後內容更新
- E2E：中文/英文切換與主要流程不回歸
- 瀏覽器視覺驗證：`/`、`/cases`、`/analytics`、`/judge-profiles` 切換語系後版面不爆

### T20. CI/CD + production infra + observability

來源：

- spec 008 Production Infrastructure with CI/CD
- roadmap Phase 4 legacy retirement / production-grade infra

目標：

- 讓系統能穩定部署、監控與回滾

實作步驟：

1. 建正式 CI pipeline：
   - lint
   - unit/integration tests
   - E2E smoke
   - build
2. 分 environment 管理 secrets/config
3. 加入 migration step
4. 建 deploy 與 rollback 流程
5. 加入 logs/metrics/alerts
6. 建 data freshness 與 scraper health dashboard

測試：

- 單元測試：CI helper scripts
- 整合測試：staging deploy smoke
- E2E：deploy 後 smoke routes
- 瀏覽器視覺驗證：staging smoke on `/`, `/cases`, `/analytics`

## 6. 我另外建議納入的補強項

這些不是單一藍圖明寫，但從維護角度應該一併納入：

### S01. 視覺回歸基線

原因：

- 現在有大量資料導向頁面與圖表頁，只靠 DOM 斷言不夠

步驟：

1. 為 `/`、`/cases`、`/analytics`、`/judge-profiles` 建立 baseline screenshot
2. 在 CI 中做有限度視覺差異檢查
3. 對圖表與大量資料頁建立固定 seed / fixture

測試：

- 視覺回歸測試
- console/network smoke

### S02. 測試資料層分離

原因：

- E2E 目前受到真實大資料 DOM 結構影響，容易漂移

步驟：

1. 建立固定 fixture dataset
2. 讓 E2E 可切換 fixture mode
3. 把 full-data smoke 與 fixture behavioral tests 分開

測試：

- 整合測試：fixture bootstrapping
- E2E：固定資料集下的 deterministic flows

### S03. Architecture Decision Records

原因：

- 路由基底、公開 API 範圍、auth 模式、資料儲存策略都屬長期決策

步驟：

1. 為 base path、storage、auth、public API、prediction policy 建 ADR
2. 所有重大架構變更先寫 ADR 再實作

測試：

- 無程式測試
- 文件一致性檢查

## 7. Fresh Subagent Prompt 模板

每個新 session 可直接用這段作為起手式：

```text
任務：執行 Txx

你只能處理這一張任務卡，不要擴張範圍。
先讀：
- docs/plans/2026-03-15-system-integration-roadmap.md 中的 Txx
- 該任務指定檔案

工作規則：
1. 先讓一個測試失敗，證明需求或 bug 存在
2. 再做最小實作
3. 跑最小必要測試集
4. 做瀏覽器視覺驗證
5. 最後輸出：
   - 修改摘要
   - 測試結果
   - 視覺驗證結果
   - 後續風險
```

## 8. 第一波建議先做什麼

若只能先做一小段，我建議順序固定為：

1. `T01` 路由/README/截圖漂移
2. `T02` Cases 批次勾選 E2E 穩定化
3. `T03` Vitest 漂移修正
4. `T04` Security Hardening
5. `T06` JobManager
6. `T08` `api.py` 拆分

原因：

- 這六項會先恢復 deploy 信心
- 也會讓後面功能開發有可維護的基底

