# 案例詳細頁與法官檔案：21st 升級

> 2026-10-26 整合更新：本頁保留原輪次的歷史驗證。後續程式碼審查、修正、提交與合併狀態以 [工作樹整合紀錄](reviews/2026-10-26-worktree-integration.md) 為準；本次未部署或推送。


2026-10-17。本輪涵蓋案例詳細頁、法官列表及個別法官檔案，沿用 Legal Codex、既有資料及 30 組／60 張透明明暗素材。只更新本機原始碼與預覽，沒有提交、推送或部署。

## 搜尋與來源

使用指定的 `21st-cli-use` skill 和已安裝的 21st CLI，實際搜尋 `document detail tabs`、`profile card`、`accordion animated` 並取得以下完整程式。沒有呼叫 hosted AI generation，也沒有新增套件。

| 21st 來源 | 實際改編 |
|---|---|
| [Project Detail View · kavikatiyar · 8248](https://21st.dev/@kavikatiyar/components/project-detail-view) | 詳細資料的頁首、狀態、欄位網格與短進場模式，套用於案例檔案；保留原始欄位、資料及動作。 |
| [Profile Card · ravikatiyar162 · 4314](https://21st.dev/@ravikatiyar162/components/profile-card-1) | 姓名、身分及主要資訊的卡片層次，搭配原有法官資料、照片／縮寫與既有貼圖；沿用紙面及海軍藍配色。 |
| [Animated Line Accordion · shadcnspace · 27711](https://21st.dev/@shadcnspace/components/accordion-09) | 改編為原生 `details/summary` 的 `CodexDisclosure`，含加／減圖示與展開回饋；關鍵詞、教育、經歷及重要案例預設展開。 |
| [Tabs · shugar · 3903](https://21st.dev/@shugar/components/tabs-1) | 次要選取狀態改編為真正的頁內章節連結 `CodexSectionNav`，保留全頁資料、鍵盤焦點、網址片段及選取提示。 |

法官列表亦沿用上一輪來自 [ibelick/animated-tabs](https://21st.dev/@ibelick/components/animated-tabs) 的 `CodexFilterRail`，原元件程式未變更。完整搜尋、原始程式與影響分析保存在[本輪證據資料夾](../.impeccable/review/detail-judges-21st-20261017/)。

## 主要變更

- 案例詳細頁：典籍式頁首、透明貼圖、章節捷徑、分隔清楚的欄位與可收合關鍵詞。保留來源、複製引用、收藏、加入收藏集、編輯、刪除確認、委員會入口、相關／相似案例與全文工具。
- 法官列表：頁首貼圖、滑動檢視底片、卡片進場、姓名卡片、較清楚的比較區。保留法院、期間、姓名搜尋、排序、比較選取及所有鍵盤操作。
- 法官檔案：保留原有照片／縮寫、歷史數據、履歷、來源及全部圖表；改善統計區、九個章節捷徑與履歷收合。年份趨勢改用現有主題色 token，深色模式可讀。
- 手機全文：工具列可換行，目錄移到內文上方，內文取得完整寬度；原搜尋、命中提示、目錄、下載、列印及展開功能保持。
- 觸控不依賴懸停；鍵盤焦點可見。減少動態效果時取消新增動畫。原 0.7 秒明暗切換保持。

## 預覽與資料界線

[案例詳細頁](http://localhost:5194/cases/96ebc92e9afa) · [法官列表](http://localhost:5194/judge-profiles) · [個別法官檔案](http://localhost:5194/judge-profiles/Senior%20Member%20Jones)

本機預覽仍使用獨立測試案例，不代表正式資料庫數量或真實人物的個別統計。全文及豐富履歷測試以瀏覽器攔截注入明確標示的虛構測試內容；沒有存入產品資料。

本輪應用程式的瀏覽器操作工具被 Work 設定停用，因此使用獨立 Chromium 測試程序完成驗證及截圖，沒有操控使用者原有分頁。Linux 測試環境原缺繁中文字型，已從本機 Windows 字型複製微軟正黑體到測試專用目錄，以 `fonts.conf` 供這次測試使用；網站字型與素材檔未變更。

| 頁面 | 桌面淺色 | 桌面深色 | 手機淺色 | 手機深色 |
|---|---|---|---|---|
| 案例詳細頁 | [查看](../.impeccable/review/detail-judges-21st-20261017/case-desktop-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/case-desktop-dark.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/case-mobile-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/case-mobile-dark.png) |
| 法官列表 | [查看](../.impeccable/review/detail-judges-21st-20261017/judges-desktop-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judges-desktop-dark.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judges-mobile-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judges-mobile-dark.png) |
| 個別法官檔案 | [查看](../.impeccable/review/detail-judges-21st-20261017/judge-desktop-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judge-desktop-dark.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judge-mobile-light.png) | [查看](../.impeccable/review/detail-judges-21st-20261017/judge-mobile-dark.png) |

[法官卡片](../.impeccable/review/detail-judges-21st-20261017/judges-desktop-light-cards.png) · [手機卡片深色](../.impeccable/review/detail-judges-21st-20261017/judges-mobile-dark-cards.png) · [手機全文與減少動畫](../.impeccable/review/detail-judges-21st-20261017/case-mobile-reader-reduced.png)

這些是獨立桌面 Chromium 與 390px 手機尺寸模擬結果，未宣稱實體手機或 Safari 驗證。

## 驗證資料

- 建置與 TypeScript 通過：[build.log](../.impeccable/review/detail-judges-21st-20261017/build.log)。
- 60 項相關前端測試通過，包含案例、法官、錯誤狀態、委員會連結、相似案例及首頁／新聞回歸：[unit.json](../.impeccable/review/detail-judges-21st-20261017/unit.json)。
- 64 項操作測試全部通過（119.34 秒）：[最後完整結果](../.impeccable/review/detail-judges-21st-20261017/e2e-final.xml)、[完整輸出](../.impeccable/review/detail-judges-21st-20261017/e2e-final.log)。涵蓋明暗、手機、來源連結、章節鍵盤定位、收合、列表切換、比較選取、全文搜尋與履歷來源。
- ESLint 無錯誤；原法官卡片的比較標籤仍有一項既有互動警告，保留原事件隔離以免勾選時誤開檔案。Python 測試檔 Ruff 通過。
- 60 張正式貼圖雜湊全數一致：[素材結果](../.impeccable/review/detail-judges-21st-20261017/assets-result.json)。
- 2,826 個受保護檔案無變更，包含資料、hooks、Worker、既有首頁／案例列表／分析／新聞、60 張素材、全文閱讀器程式、比較頁、共用分頁與主題切換：[保留結果](../.impeccable/review/detail-judges-21st-20261017/preservation-result.json)。
- GitNexus 對 JSX 呼叫未完整解析，結果為 UNKNOWN；已補查 App 路由、JudgeCard／JudgeHero 的實際使用位置，沒有把無呼叫邊視為無影響。
- 舊麵包屑測試原以「所有含 Cases 的 nav」定位，新增章節後匹配到兩個導覽；改用正確的 `Breadcrumb` 可讀名稱，並核對其案例列表連結。

較早的失敗輸出保留作診斷，僅以最後完整結果作通過證據。
