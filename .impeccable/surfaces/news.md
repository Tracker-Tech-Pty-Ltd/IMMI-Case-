# 新聞更新頁
Mode: Read
Target: `frontend/src/pages/NewsPage.tsx`
Related: `frontend/src/lib/news.ts`, `frontend/src/data/news.json`, `frontend/src/components/shared/CodexSticker.tsx`, `frontend/src/components/shared/NewsPagination.tsx`
Approved comp: `.impeccable/mocks/news-updates-approved-desktop.png`
Original board: `docs/news-updates-design-20261016/news-updates-v1.png`
Approval: 使用者 2026-10-16：「可以，就照這版開始製作新聞更新頁，沿用 Legal Codex 風格並保留現有資料與功能。新聞請使用可核對的真實來源，附上發布日期和原文連結。」
Follow-up: 原稿整圖與60張透明素材已交付；本輪收尾寬版單一比例，唯一 shipping 程式更動為 `frontend/src/styles/news-codex.css`。
Native imagegen prompt: `docs/news-updates-design-20261016/PROMPT.md`
Sticker provenance: `docs/news-updates-design-20261016/sticker-assets/source-map.json`
The comparison crop excludes the presentation board labels and separate mobile comp; the original image remains intact.

## Direction contract

2026-10-17 互動更新：使用者要求搜尋及採用 21st 的 UI、動畫、圖示與過渡。已取回 Spotlight 35180、Animated Tabs 1115、Animated Icon Buttons 28541，改編為新聞頁的 CodexSpotlight、CodexFilterRail 與現有貼圖／箭頭過渡；來源與完整證據見 `docs/21st-motion-20261017.md`。不改 Legal Codex 或原版型；60 張貼圖與 10 個保留檔案雜湊不變。16 項新聞測試及 114 項操作測試通過，1440 整圖仍 80.31% MATCH。原生摘要、減少動態效果及中英手機定位已確認。
THESIS: 以可核對的消息摘要連到原始公告；不把新聞變成案件結果預測。人工整理八則日期明確的官方消息，不宣稱自動更新或完整涵蓋。
OWN-WORLD: 沿用 DESIGN.md 的 Legal Codex、既有調色盤與間距尺度；紙面、海軍藍、琥珀金與襯線語氣。新增自託管 Codex Serif TC 繁中後備、CodexSticker 及新聞專用分頁，僅記錄真實系統擴充，不改產品定位。
STORY: 讀者先辨認最近核對日期，搜尋或選擇分類、日期、來源；讀重點或展開摘要，再開啟官方原文；可回到案例與分析。
FIRST VIEWPORT: 依原稿整圖調整新聞頁限定的側欄、頂欄、主閱讀區及輔助欄比例；手機單欄與折疊閱讀工具保留。英文全文允許正常延伸；22 組尺寸及英文展開已有操作驗證，不承諾所有語言都同屏。
FORM: 保留真實公告、發布日、核對日及原文。透明貼圖用於導覽、分類、搜尋、日期、原文、摘要、研究及狀態；文件圖使用獨立生成的 document-v2 單張折角紙。介面仍由真實文字及控制項構成，不嵌入整張設計圖充當頁面。
FINISH: fresh-context 獨立評估對寬版單一 CSS 修正批次給出 ship；完整寬版80.31% MATCH正常通過、無force。後續只修正選單測試的動畫等待，先前指定三份操作測試已114通過／0失敗／0跳過；不是整站所有測試重跑。

## 本輪交付與證據

- 唯一 shipping 更動是新聞桌面根基準 `clamp(100%, calc(100vw * 16 / 1127), 150%)`；既有 rem 按單一比例變化，預設16px、上限24px，手機及其他路由維持原基準。沒有 transform、zoom 或個別標題／文件位移。
- 正式完整視窗1440×1400，原始畫格1413×1373單一比例正規化為1440×1399；`wide-round3/diff-tall/report.json` 及正式 `diff/final/report.json` 均80.31% MATCH，19區無missing／contradicted。首屏1127×911視窗、1127×912圖，精確79.33%。
- 固定原稿、spec、區域框及門檻保持。`responsive` 正常closed、gate.ok true、forced null；review已關閉，正式finish為ship。新獨立複核見 `.impeccable/review/news/wide-round3/finish-review.md`，範圍為此次修正批次，不是全站重審。
- 1280、1600、英文深色及手機全圖均保留raw與normalized，屬視覺／操作回歸檢查，不是各自獨立機械gate。`proportional-1440` 僅短視窗擷取診斷，沒有替代正式完整寬版。
- `wide-round2` 全前端763項及針對性16項通過；最後純CSS修正的 `wide-round3/build.log` 建置成功。最新搜尋、直接第3頁與返回、英文完整摘要及手機選單退場見 `functional-checks.json`；不宣稱最後CSS修改後重跑全部測試。
- 寬版驗收時E2E為113通過／1失敗，原始兩次失敗日誌保留。後續使用者要求修正後，只有close_mobile_menu加入dialog隱藏等待；原斷言與網站動畫保留，同一組114項全部通過，另有單項、重複檢查與Ruff通過。新證據在 `.impeccable/review/news/menu-wait-fix/RESULT.md`；305個前端程式／公開素材檔核對完全不變。
- 60張正式素材與4個核心資料／程式檔全數雜湊不變；新素材稽核仍為30主題、60透明圖、2封存，總1,140,872bytes。八則官方新聞、日期、原文、雙語、分頁、手機工具及主題動畫保留。
- 正式交付圖已由wide-round3直接複製至docs的final-*：完整寬版1440×1399、首屏1127×912、1280×1260、1600×1550、英文深色、手機完整頁390×1847及首屏390×843。視窗與圖檔的取整尾差公開，未裁切、遮罩或替換內容。
- 僅本機5194預覽，案例API使用隔離十筆fixture；未部署、提交或推送。詳細當前結論與歷史分界見 `docs/news-updates-design-20261016/VERIFICATION.md`。

## 前輪歷史

前輪 `density-round3` 已完成指定繁中密度目標，當時重點高度 226.22→166.25px、分頁底端 989.92→885.97px，英文當時分頁底端 999.70px；67.6%／63.09% 比對及 26 項重驗屬該輪。更早 64.6%／66.1% 與 762 項全前端結果也僅保留歷史，不代表本輪現況。


素材交付輪的78.40%同尺寸通過、63.27%寬版未過、8項最末重驗與responsive open也僅為歷史；目前以wide-round3完整寬版80.31%及新獨立ship為準。素材逐張來源、60／60載入與字型授權證據仍在sticker-assets及assets-round2，不因本輪CSS改動重寫。
