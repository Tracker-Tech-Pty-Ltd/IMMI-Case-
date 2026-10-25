# 新聞更新頁驗證紀錄（2026-10-16）

> 2026-10-26 整合更新：本頁保留原輪次的歷史驗證。後續程式碼審查、修正、提交與合併狀態以 [工作樹整合紀錄](../reviews/2026-10-26-worktree-integration.md) 為準；本次未部署或推送。


## 後續選單等待修正：目前結果

使用者要求排除剩餘選單等待失敗後，只修改 `tests/e2e/react/react_helpers.py` 的 `close_mobile_menu`：保留點擊與測試原有斷言，在點擊後等待同一個具名 dialog 隱藏，最多等待 5 秒。沒有固定睡眠、跳過測試、放寬斷言或更改網站動畫。

原失敗單項重新重現後修正，單項及重複檢查通過；先前同一組 `test_react_smoke.py`、`test_react_navigation.py`、`test_react_responsive.py` 重跑為 **114 通過、0 失敗、0 跳過**，Ruff 通過。這是該三份操作測試的完成結果，沒有宣稱重跑整個專案。305 個前端程式與公開素材檔、60 張正式貼圖及四個核心檔案均保持，沒有重新建置或更改已通過的寬版畫面。

修正、原始日誌及 JUnit 結果見 [menu-wait-fix/RESULT.md](../../.impeccable/review/news/menu-wait-fix/RESULT.md)。下列寬版驗收當時的 113／1 與兩次失敗紀錄仍保留為歷史；剩餘失敗已由本次後續修正排除。

## 本輪交付與界線

本輪寬版收尾的唯一 shipping 程式更動是 `frontend/src/styles/news-codex.css`：桌面新聞限定的根基準使用 `clamp(100%, calc(100vw * 16 / 1127), 150%)`，讓基準 rem 規則共同按同一比例變化，預設 16px、上限 24px。其他路由與手機維持原基準；沒有 transform、zoom 或個別標題／文件位移。

新的獨立評估以本次單一 CSS 修正批次給出 **Disposition: ship**；三項修正／保留檢查均 resolved，未再要求 UI 修正。正式紀錄見 [finish-review.md](../../.impeccable/review/news/wide-round3/finish-review.md)。範圍是本次修正批次，不代表整站無回歸。

**完整寬版整圖 80.31% MATCH、首屏 79.33%，機械比對均通過；該輪額外瀏覽器套件的一項失敗已在上述後續修正中排除。** 本機預覽為 `localhost:5194/news`，案例 API 是隔離十筆測試案例，新聞為八則真實官方消息。未部署、提交或推送。

## 原稿整圖比對

| 比較 | 實際視窗／正規化圖 | 本輪結果 |
|---|---|---|
| 首屏 hero | 視窗 1127×911；圖 1127×912 | 79.33%，通過首屏門檻；19 區無 missing／contradicted |
| 正式完整寬版 | 視窗 1440×1400；原始畫格 1413×1373，以單一比例正規化為 1440×1399 | 80.31% MATCH，通過寬版門檻；19 區均為 match／drift，無 missing／contradicted |
| 1280／1600 寬度 | 分別保留 1280×1260、1600×1550 畫面及操作檢查 | 本次視覺與操作回歸證據，不宣稱另有各自的機械 gate |

正式報告：[wide-round3 首屏](../../.impeccable/review/news/wide-round3/diff-hero/report.json)、[wide-round3 完整寬版](../../.impeccable/review/news/wide-round3/diff-tall/report.json)、[final 正式報告](../../.impeccable/review/diff/final/report.json)。最後兩份的 overall 均為 0.8031，沒有用較短畫面取代完整寬版。

原稿、spec、19 個區域框與門檻不變，沒有 force。`responsive` 已正常關閉、gate.ok 為 true、forced 為 null；獨立複核與文件完成後，`review` 也已關閉，正式記錄 `finish: ship`（2026-10-16 05:15:21 UTC）。這是正常通過的狀態遷移；`.impeccable/build/state.json` 保留完整紀錄，不將獨立 ship 結論擴張成所有自動套件通過。

`proportional-1440` 是額外短視窗擷取診斷，使用 1440×1165 視窗時內容仍多約 27px；它沒有作為正式完整 gate 的替代品。瀏覽器視窗與 PNG 高度的取整尾差均公開，原始畫格保留；沒有裁切、遮罩或內容替換。

## 測試、實際操作及保留項目

| 檢查 | 結果與執行輪次 |
|---|---|
| 全前端測試 | 寬版第 2 輪 763／763 通過，見 `wide-round2/tests-all.json` |
| 針對性測試 | 寬版第 2 輪 16 項通過，見 `wide-round2/tests-focused.json` |
| 最後純 CSS 建置 | `wide-round3/build.log` 顯示 Cloudflare 前端建置成功；沒有宣稱最後 CSS 修改後重跑全套前端測試 |
| 新聞搜尋 | 最新同一建置搜尋「法院」為 3 則（重點 1、列表 2），見 `wide-round3/functional-checks.json` |
| 分頁 | 直接第 3 頁、最後結果 1 則及返回第 1 頁均確認 |
| 英文深色與摘要 | 完整摘要、編輯說明及無水平溢出均確認 |
| 手機選單 | 390 寬度無水平溢出，選單可開啟；等退場動畫結束後確實隱藏 |
| 幾何實測 | 1440×1400 根基準 20.4489px、1127×911 為 16.006px；另有 1280、1600、390 寬度實測，均無水平溢出，見 `geometry.json` |
| 正式素材 | 60／60 檔雜湊不變；新跑素材稽核為 30 主題、60 張透明素材、2 張封存，合計 1,140,872 bytes |
| 核心資料／程式 | 新聞 JSON、新聞篩選邏輯、原共用 Pagination、正式 Worker 四檔雜湊相同 |

本輪操作與尺寸原始資料：[functional-checks.json](../../.impeccable/review/news/wide-round3/functional-checks.json)、[geometry.json](../../.impeccable/review/news/wide-round3/geometry.json)、[asset-preservation.json](../../.impeccable/review/news/wide-round3/asset-preservation.json)、[preserved.json](../../.impeccable/review/news/wide-round3/preserved.json)、[asset-audit.log](../../.impeccable/review/news/wide-round3/asset-audit.log)。

先前素材輪的中英 22 組尺寸、8 項最後重驗、lint 與其他互動紀錄仍保留於 `assets-round2`，不能冒稱最後 CSS 修改後全部重跑。自動尺寸模擬與局部操作也不等於實體手機、Safari、原生日期選擇器或全面無障礙驗收。

## 修正前瀏覽器自動套件的兩次失敗紀錄（歷史）

| 執行 | 真實結果 |
|---|---|
| 完整既有瀏覽器套件 | 113 項通過、1 項失敗；[e2e-existing-suite.log](../../.impeccable/review/news/wide-round3/e2e-existing-suite.log) |
| 同一失敗單項重跑 | 1 項失敗，再次重現；[e2e-drawer-reproduced.log](../../.impeccable/review/news/wide-round3/e2e-drawer-reproduced.log) |

當時失敗是 `test_close_mobile_drawer` 在點關閉後立即檢查選單，既有退場動畫尚未完成；該輪只確認實際操作，尚未修改測試。因此當時是 113／1，不能回寫為全數通過。後續才修正等待輔助函式並重新取得 114／0／0 的實際結果；兩次歷史失敗日誌保持原樣。

## 透明素材與來源證據

- 內建 image_gen 共 62 個獨立輸出：60 張正式素材為 30 主題 × 2 模式，另 2 張舊文件圖封存。正式 `document` 已換成單張折角紙 `document-v2`，舊證書冊形狀未列入正式 60 張。
- [source-map.json](sticker-assets/source-map.json) 分別記錄 `assets` 60 筆、`archivedVariants` 2 筆、來源工具生成檔、原始 PNG、完整提示及各檔案雜湊。初始提示與新版文件提示分別見 [prompts.json](sticker-assets/prompts.json)、[document-v2-prompts.json](sticker-assets/document-v2-prompts.json)。
- 正式 60 張經讀檔稽核為原生透明 RGBA，PNG／WebP 透明度涵蓋 0–255，雜湊全數相符，見 [alpha-and-size-checks.json](sticker-assets/alpha-and-size-checks.json)。加入來源 metadata 後，正式 WebP 合計 **1,140,872 bytes**（約 1.14 MB）。
- PNG 使用 tEXt、WebP 使用標準 XMP 保存逐張完整提示，可由標準圖片讀取工具讀出。補入 metadata 前後，120 筆 PNG／WebP 的解碼 RGBA 像素雜湊全部一致，見 [metadata-pixel-preservation.json](sticker-assets/metadata-pixel-preservation.json)。原工具生成檔未改，沒有因 metadata 變更畫面或透明度。
- 實際素材目錄 60/60 張載入，`catalog-status.json` 未見水平溢出；實際淺色與深色操作的 `usage-light.json`／`usage-dark.json` 各為 30/30 主題載入，包含 `document-v2`。因此「全部使用」同時有實際介面使用與素材目錄的證據。
- 最後含 metadata 的建置完成後，`built-asset-hashes.json` 確認 dist 中 60 張正式素材與 source-map 雜湊全相同；5194 實際取回的 `served-document-v2-light.webp`／`served-document-v2-dark.webp` 亦與正式來源相同。這項證據是本機供應內容，不能當作已正式部署。

維護方式與主題用途見 [sticker-assets/README.md](sticker-assets/README.md)。繁中字型來源、307,640 bytes 精簡檔、841 字元輸入及授權另見 [fonts/provenance.json](fonts/provenance.json)，不將字型與 image_gen 素材混列。

## 實際畫面

本輪正式圖直接由 `wide-round3` 的正規化畫格複製，逐檔來源與交付副本雜湊相同；原始畫格、原稿及舊輪證據保留。

| 畫面 | 實際交付圖尺寸與範圍 |
|---|---|
| [原稿寬度首屏](final-narrow-desktop.png) | 1127×912；實際視窗為 1127×911，尾差來自等比例正規化取整 |
| [1440 正式完整寬版](final-desktop.png) | 1440×1399；實際視窗 1440×1400，是本輪 80.31% 正式比對圖 |
| [1280 寬版](final-desktop-1280.png) | 1280×1260；視覺及操作回歸檢查 |
| [1600 寬版](final-desktop-1600.png) | 1600×1550；視覺及操作回歸檢查 |
| [英文深色版](final-english-dark.png) | 1440×1399，保留真實英文及明暗素材 |
| [手機完整頁](final-mobile.png) | 390×1847，完整內容可見，沒有強制拉成預設視窗高度 |
| [手機首屏](final-mobile-viewport.png) | 390×843；實際視窗為 390×845，保留原畫格取整差異 |
| [60 張素材目錄](sticker-catalog.png) | 沿用素材輪 60／60 實際載入畫面，本輪素材全數雜湊不變 |

畫面由實際瀏覽器 screencast 畫格取得，只有單一比例的寬度正規化，未重畫、裁切、遮罩或替換內容。原始寬版與手機畫格保留於 `wide-round3`；素材目錄證據仍在 `assets-round2`。核准原圖 [news-updates-v1.png](news-updates-v1.png) 與八則來源核對 [SOURCES.md](SOURCES.md) 未改。

## 前輪歷史

| 輪次 | 當時結果；僅供歷史查核 |
|---|---|
| 早期兩批修正 | 首屏 64.6%、桌面 66.1%；原操作／文件清單多項 resolved，整圖仍 partial |
| `density-round3` | 繁中 1127×911 重點高度 226.22→166.25px、分頁底端 989.92→885.97px，英文當時分頁底端 999.70px；獨立確認該次密度目標可結案 |
| 密度輪比對與測試 | 首屏 67.6%、桌面 63.09%，當時 `hero` 開啟；26 項重驗及更早 762 項全前端紀錄均不代表本輪現況 |

素材交付輪另有同尺寸 78.40%、1440 跨尺寸 63.27% 未過及最末 8 項重驗，當時 responsive 開啟；這些也已是歷史。寬版前兩輪未通過的報告、畫面與前述兩次 E2E 失敗均保留。該交付輪以 wide-round3 的完整寬版 80.31% 正常通過、新獨立 ship 及當時自動套件仍有 1 項失敗為歷史結論。後續選單等待修正已取得 114／0／0，見本頁開頭；2026-10-26 的提交與合併另見整合紀錄。
