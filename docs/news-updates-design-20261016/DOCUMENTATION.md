# 新聞頁沿用與擴充設計記錄

日期：2026-10-16。本輪以桌面新聞限定的單一比例修正寬版對齊，保留既有 Legal Codex、30 個主題／60 張正式透明貼圖、新聞日期與原文，以及既有案例資料。唯一 shipping 程式更動為 `frontend/src/styles/news-codex.css`。

## 設計依據與改動邊界

依據是根目錄 `DESIGN.md`、`.impeccable/design.json`、`frontend/src/tokens/tokens.json`、`CLAUDE.md` 的 Design Context，以及 `.impeccable/surfaces/news.md` 的核准方向。原始設計圖片 [news-updates-v1.png](news-updates-v1.png) 與 [PROMPT.md](PROMPT.md) 完整保留，桌面比對使用獨立裁切，不把圖片嵌成可操作頁面。

文件依 Impeccable `reference/document.md` 的普通擴充原則，保留已記錄的繁中字型後備、`CodexSticker` 與 `NewsPagination`，只補充實際採用的桌面新聞單一比例規則。調色盤、間距尺度、品牌定位與 `PRODUCT.md` 不重建；本頁規則不提升成所有路由都必須採用的版型。

桌面新聞的根基準為 `clamp(100%, calc(100vw * 16 / 1127), 150%)`。以 rem 定義的元素共同按比例變化，預設基準 16px、最高 24px；手機及其他路由維持原基準。不是各區域分別縮放，也沒有 transform、zoom 或個別標題／文件位移。

## 既有系統與本輪實作

| 項目 | 沿用或擴充方式 | 實作依據 |
|---|---|---|
| 紙面、海軍藍與琥珀金 | 沿用原色彩、明暗主題及法院識別色，沒有新增替代調色盤 | `frontend/src/tokens/tokens.json` |
| 襯線標題 | 西文仍優先 Crimson Text；新增自行託管的 Codex Serif TC 繁中後備，後續仍有系統字型 | `tokens.json` 的 heading、`frontend/src/styles/news-codex.css` |
| 桌面與手機框架 | 沿用已存在的新聞限定 layout hooks；本輪僅在 CSS 中讓桌面 rem 共同按同一比例變化，手機單欄與閱讀工具保持 | `frontend/src/styles/news-codex.css` |
| 間距與控制範圍 | 原尺度不變，新聞桌面精細指標依原稿採緊湊操作；窄畫面及粗略指標裝置維持較大操作範圍。前輪「所有控制皆為 44px」不再當作本輪桌面結論 | `news-codex.css` 的桌面與 pointer: coarse 規則 |
| 雙主題貼圖 | `CodexSticker` 選用各主題的淺／深兩張原生透明圖，圖像裝飾以 `aria-hidden`／空 alt 處理，旁邊真實文字保留操作名稱 | `frontend/src/components/shared/CodexSticker.tsx`、`frontend/src/lib/codex-stickers.ts` |
| 新聞分頁 | 新增專用 `NewsPagination`，保留前後頁、直接選頁、完整結果範圍與停用狀態；原共用 `Pagination` 不變 | `frontend/src/components/shared/NewsPagination.tsx` |
| 新聞閱讀 | 搜尋、分類、來源、發布日期、網址參數及原生展開摘要均保留；英文長內容允許正常延伸，不以截斷全文對齊 | `NewsPage.tsx`、`frontend/src/lib/news.ts` |
| 來源與案例 | 八則真實官方消息獨立存於新聞 JSON，未寫入案例庫；原文新分頁連結保留安全屬性 | `frontend/src/data/news.json`、[SOURCES.md](SOURCES.md) |

上述是設計與程式的對照，不代表所有瀏覽器或裝置都已全面驗收。

## 貼圖與字型來源

內建 image_gen 產生 62 個獨立輸出：60 張正式素材為 30 主題 × 淺／深雙版本，另 2 張舊文件圖封存。複核後 `document` 已指向單張折角紙的 `document-v2` 雙版本。正式檔案、原始 PNG、逐張提示、工具來源與檔案雜湊均可在 [素材說明](sticker-assets/README.md) 與 [source-map.json](sticker-assets/source-map.json) 核對。

素材目錄實際 60/60 載入；實際淺、深主題操作各為 30/30 個主題載入，包含新版文件圖，見 `assets-round2/catalog-status.json` 與 `usage-light.json`／`usage-dark.json`。全部正式 PNG／WebP 的透明度與雜湊由讀檔稽核核實。補入 PNG tEXt 及 WebP XMP 的逐張完整提示後，120 個檔案的解碼 RGBA 像素雜湊仍一致；原工具生成檔未修改。

繁中字型來源為 [Google Fonts 的 Noto Serif TC](https://github.com/google/fonts/tree/main/ofl/notoseriftc)，以 `Codex Serif TC` 名稱自行託管。此輪精簡包含 841 個輸入字元，WOFF2 為 307,640 bytes，並非完整中文字庫。來源、原始雜湊及精簡輸入記錄於 [fonts/provenance.json](fonts/provenance.json)，授權保留於 [NotoSerifTC-OFL.txt](../../frontend/public/fonts/NotoSerifTC-OFL.txt)。

## 本輪驗證與交付範圍

最新完整寬版的實際視窗為 **1440×1400**，原始畫格 1413×1373 以單一比例正規化為 **1440×1399**；整圖比對為 **80.31% MATCH**，19 區均為 match／drift，無 missing 或 contradicted。首屏實際視窗 1127×911，正規化圖為 1127×912，比對 **79.33%**。固定原稿、spec、區域與門檻沒有更改，沒有 force。

`responsive` 已正常通過，獨立複核與文件完成後，`review` 已關閉並正式記錄 `finish: ship`。1280、1600、英文深色與手機是本次實際畫面及操作回歸檢查，不是另有機械 gate 的宣稱。額外 proportional-1440 僅是短視窗擷取診斷，沒有取代完整寬版報告。

新的獨立評估以單一 CSS 修正批次給出 `ship`，沒有再要求 UI 修正；不代表整站重新審查。寬版第二輪全前端 763 項與針對性 16 項通過，最後純 CSS 修正建置成功。當時另跑的瀏覽器套件為 113 通過／1 失敗；後續依使用者要求，只為 `close_mobile_menu` 加入真實隱藏狀態等待，原有斷言與網站動畫保留。同一組煙霧、導覽與響應式測試已重跑為 **114 通過、0 失敗、0 跳過**，單項與重複檢查及 Ruff 也通過。305 個前端程式／公開素材檔與四個核心檔案均核對保留。正式複核、修正前失敗及後續通過證據見 [VERIFICATION.md](VERIFICATION.md)。

新聞 JSON、新聞篩選與分頁邏輯、原共用 `Pagination` 及正式 Worker 入口四檔前後雜湊相同；60 張正式貼圖亦全部相同。layout hooks、導覽貼圖、繁中標題後備與新聞專用分頁是先前交付的擴充，本輪只修改新聞 CSS 的單一比例，未重新製作或更動素材、資料、測試與門檻。

本機為 `localhost:5194/news` 的建置版；案例 API 使用隔離十筆測試案例，新聞則是八則真實官方消息。未部署、提交或推送；尺寸模擬不等於實體手機、Safari 或全面無障礙驗收。

## 前輪歷史與保存記錄

先前密度輪 `density-round3` 已獨立結案：繁中 1127×911 重點高度 226.22→166.25px、分頁底端 989.92→885.97px；英文當時分頁底端 999.70px。該輪 67.6%／63.09% 比對、26 項重驗與更早 762 項全前端測試均為歷史數字，不能代表本輪。

當時 `DESIGN.md` 雜湊為 `87EB6B9B704F77B21BAE8B1503CAB07223B1A982AAD2B6F1379DA4372AE19E79`，`.impeccable/design.json` 為 `E26A54841E80FF5B442528FA657B83217F8E5C3B429D39D87BDF27C01493D0E4`。本輪在原內容上追加真實系統擴充，這些值只保留作歷史紀錄。既有 frontmatter 的 `borderRadius`／規格 `rounded` 格式差異未順帶改寫。


素材交付輪曾取得同尺寸 78.40%、寬版 63.27% 未過，當時 responsive 開啟；這些已是歷史狀態。本輪以 wide-round3 的完整寬版 80.31% 及新獨立複核為準。
