---

> 2026-10-26 整合更新：本頁保留原輪次的歷史驗證。後續程式碼審查、修正、提交與合併狀態以 [工作樹整合紀錄](docs/reviews/2026-10-26-worktree-integration.md) 為準；本次未部署或推送。

name: IMMI-Case Legal Codex
description: 澳洲移民案例研究介面的既有設計系統
colors:
  deep-navy: "#1b2838"
  parchment: "#f5f4f1"
  paper: "#ffffff"
  ink-amber: "#5c4306"
  highlight-amber: "#d4a017"
  secondary-ink: "#4a5568"
  muted-ink: "#6e6a65"
typography:
  display:
    fontFamily: "Crimson Text, Codex Serif TC, PMingLiU, MingLiU, Songti TC, Georgia, Times New Roman, serif"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Merriweather, Georgia, serif"
    lineHeight: 1.5
  data:
    fontFamily: "DM Sans, IBM Plex Sans, system-ui, sans-serif"
  mono:
    fontFamily: "SF Mono, Fira Code, Consolas, monospace"
rounded:
  sm: "0.670rem"
  md: "1rem"
  lg: "1.330rem"
  pill: "2rem"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.25rem"
  6: "1.5rem"
  8: "2rem"
  11: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.ink-amber}"
    textColor: "{colors.paper}"
    borderRadius: "{rounded.md}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.deep-navy}"
    borderRadius: "{rounded.md}"
  navigation-active:
    textColor: "{colors.ink-amber}"
    borderRadius: "{rounded.md}"
---

# Design System: IMMI-Case

## Overview

**Creative North Star: "Legal Codex（法律典籍）"**

以法律典籍的沉穩、精準與學術感呈現公開案例。介面首先讓使用者辨認所在位置、搜尋範圍與資料來源，再閱讀分析結果。此文件記錄現有品牌與實作，不另立替代風格。

**Key Characteristics:**
- 暖米白紙面、深海軍藍文字、節制的琥珀金提示。
- 襯線標題配合清楚的資料標籤與表格。
- 圖表優先呈現資料與範圍，保留九種法院識別色。
- 共用操作、狀態與尺寸規則，讓不同頁面可以預期。

## Colors

深海軍藍是主要文字，暖紙色是閱讀背景，琥珀金用於重點與當前狀態。所有顏色的實作來源是 `frontend/src/tokens/tokens.json`；此文件只描述其用途。

- **Deep Navy**：主要文字與法律典籍識別。
- **Parchment / Paper**：頁面底色與內容區。
- **Ink Amber**：淺色模式中可閱讀的小字與實心按鈕。
- **Highlight Amber**：品牌亮點；不是所有背景上都適合搭配白字。
- **Secondary / Muted Ink**：說明、日期與中繼資料。

**The Paired Contrast Rule.** 實心重點底色搭配 `--color-on-solid`，由主題決定前景，不將白字固定套用到深色模式的亮琥珀底色。

深色模式使用既有 `color.dark` 值；`use-theme-preset.ts` 是目前的主題入口。不得改變一般明暗主題的既有切換速度。

## Typography

**Display Font:** 西文優先 Crimson Text；繁中字形後備為自行託管的 Codex Serif TC，再依序使用 PMingLiU、MingLiU、Songti TC、Georgia、Times New Roman。

Codex Serif TC 來自 Google Fonts 官方 Noto Serif TC，採 SIL Open Font License 1.1；本輪精簡為 841 個輸入字元、307,640 bytes 的 WOFF2，並非完整中文字庫。既有西文字體不替換，未收錄字形仍依後備順序顯示。來源、精簡輸入與原始雜湊見 `docs/news-updates-design-20261016/fonts/provenance.json`，本機授權檔為 `frontend/public/fonts/NotoSerifTC-OFL.txt`。

**Body Font:** Merriweather，後備 Georgia。

**Label/Mono Font:** DM Sans / IBM Plex Sans 用於資料與操作；SF Mono / Fira Code / Consolas 用於代碼及鍵盤提示。

標題保留典籍感；篩選、導覽與數字應容易快速辨認。長標題與案例引用可以換行，不讓文字把相鄰操作推出畫面。資料數字採等寬數字，避免更新時左右跳動。

## Layout

桌面在 `lg`（1024px）以上顯示側邊導覽；較窄畫面使用可關閉且管理焦點的導覽抽屜。頁面內容沿用置中的 `max-w-7xl` 範圍。

間距使用 JSON 中既有尺度。篩選群組能換行，手機的主要操作需可點按；寬表格保留區域捲動或既有手機卡片視圖，不以隱藏資料處理溢出。短螢幕的對話框與抽屜需可捲動。

新聞頁透過既有框架新增的 layout hooks 及 `news-codex.css`，在桌面限定範圍縮合側欄、頂欄、閱讀欄位與操作，依核准原稿排列；這不是所有頁面的新密度規則。窄畫面仍為單欄，粗略指標裝置的操作保留既有較大範圍。完整字句及展開內容允許頁面延伸，不用固定高度截斷。

新聞桌面以 `clamp(100%, calc(100vw * 16 / 1127), 150%)` 設定根基準，讓既有 rem 文字、間距與欄位共同按同一比例變化；預設 16px、上限 24px。其他路由與手機維持原基準。保留基準版型，不用 transform、zoom 或個別標題／文件位移補償寬度。

## Elevation & Depth

以紙面與細分隔線區分區域。保留既有 `shadow-xs`、`shadow-sm`、`shadow`、`shadow-lg`；陰影只用於必要的內容層次或浮層，不增加裝飾性光暈。對話框與導覽抽屜的遮罩用來表明受保護的操作焦點。

## Shapes

採用 JSON 的 sm、預設與 lg 圓角；pill 用於小型標籤及切換控制。表單與內容容器沿用現有形狀，不建立與品牌無關的新元件外觀。

## Components

### Buttons

主要按鈕使用重點色與對應前景；次要按鈕使用紙面與邊線。鍵盤焦點可見、停用狀態清楚，觸控裝置提供足夠點按範圍。

### Inputs

以標籤說明用途，placeholder 只補充輸入方式。保持既有搜尋、篩選與取消行為；錯誤時呈現可理解的下一步。

### Navigation

保留所有既有路由、權限判斷與收藏提示。當前頁以底色及文字共同標示。手機抽屜沿用 Radix 的焦點管理與 Escape 關閉。

已有對照的導覽項目使用 `CodexSticker` 的透明雙主題素材，文字名稱仍保留；未對照項目保留既有圖示，不以圖片取代路由或權限判斷。

### Chips

法院色、裁決色與選取狀態各有用途，不互相代替。可移除篩選的控制需有可讀名稱與點按範圍。

### Cards / Containers

資料容器的邊框、圓角與間距由 tokens 提供。保持可比較的圖表尺度與清楚標題，圖表 tooltip 明確指定 `--color-text`。

### CodexSticker

以透明、節制的紙張與法律文具圖像輔助導覽及操作，每個主題使用分別生成的 light／dark 雙版本。`CodexSticker` 保持 `aria-hidden` 與空 alt，由相鄰真實文字提供名稱；裝飾不取代可讀標籤，也不作為官方徽章或來源證明。

實作與 ID 對照為 `frontend/src/components/shared/CodexSticker.tsx`、`frontend/src/lib/codex-stickers.ts`。本批 30 主題／60 張正式圖、2 張封存舊文件圖的提示、原始 PNG、透明度及雜湊見 `docs/news-updates-design-20261016/sticker-assets/`。`document` ID 使用單張折角紙 `document-v2`；不得將封存舊圖重新計入正式交付。

### NewsPagination

新聞專用分頁使用前後頁按鈕與直接選頁，保留完整結果範圍的可讀狀態及首／末頁停用行為。桌面採新聞頁的緊湊排列，窄畫面與粗略指標裝置使用原較大操作範圍；當下頁碼與網址狀態一致。

實作為 `frontend/src/components/shared/NewsPagination.tsx`。原共用 `Pagination` 保持，其他頁面不隨新聞排列一起替換。

### Motion

動畫服務於搜尋開啟、導覽抽屜進出及狀態回饋。沿用 fast 150ms、normal 300ms、slow 500ms 與現有 easing；不對整頁重複播放進場動畫。降低動態效果時改用溫和透明度或靜態狀態；不要把所有回饋縮成瞬間閃動。一般明暗切換的 0.7 秒保持不變。

2026-10-17 新聞互動層採用 21st 目錄的共用選取底片、游標聚光及箭頭微互動模式，改編為 `CodexFilterRail`、`CodexSpotlight` 與現有貼圖的 CSS 過渡。只在實際操作時回饋，不持續自動播放；聚光使用既有琥珀色與間距 tokens，正常靜止畫面及原版型保持。觸控不追蹤聚光，減少動態效果時取消新增位移、旋轉與底片動畫。來源與驗證見 `docs/21st-motion-20261017.md`。

## Do's and Don'ts

2026-10-17 案例與法官檔案延伸 Legal Codex 的檔案閱讀語言：`CodexSectionNav` 以真正頁內連結呈現章節，`CodexDisclosure` 以原生收合承載預設展開的文字資料。姓名、來源、照片／縮寫及原有統計保持真實資料來源。手機全文目錄改在內文上方，章節定位避開頂欄；深色及減少動態效果沿用既有規則。元件來源與驗證見 `docs/21st-details-judges-20261017.md`。

2026-10-17 首頁、案例列表及數據分析頁延伸採用同一套 21st 互動語言：核心指標先行、透明明暗貼圖、滑動檢視底片及短內容過渡。分析章節捷徑使用頁內連結，保留全部圖表與篩選範圍；手機的定位留白需避開兩列頂欄。所有新效果限縮於 `codex-research-page`，不改變新聞頁核准版型。來源與預覽見 `docs/21st-core-pages-20261017.md`。

### Do:
- **Do** 保留資料、來源連結、法院分類與所有主要操作。
- **Do** 從 `tokens.json` 取得顏色、間距、圓角與陰影。
- **Do** 在英文、繁體中文及明暗主題下檢查窄螢幕與鍵盤操作。

### Don't:
- **Don't** 用通用行銷頁模板取代現有研究介面。
- **Don't** 隱藏主要功能來掩飾手機版溢出。
- **Don't** 編造新聞、案例數量、來源或驗證結果。
