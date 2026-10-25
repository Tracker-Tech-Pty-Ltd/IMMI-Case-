# Legal Codex 透明素材交付

日期：2026-10-16。這批是使用者要求的 **30 個主題 × 淺色／深色雙版本，共 60 張正式透明貼圖**，用於既有 Legal Codex 導覽、新聞操作及閱讀狀態。全部正式素材都有實際載入紀錄，不只存在檔案目錄。

## 數量與版本

| 項目 | 數量與用途 |
|---|---|
| 內建 image_gen 獨立輸出 | 62 張；每張有自己的提示、來源及雜湊 |
| 正式素材 | 60 張，即 30 主題各有 light／dark 版本 |
| 封存版本 | 2 張舊 document 圖，保留來源及原 PNG；不計入正式 60 張 |
| 新版文件圖 | `document-v2-light`／`document-v2-dark`，單張折角紙；`CodexSticker` 的 `document` ID 指向此雙版本 |
| 網頁用正式 WebP | 最長邊 256px；文件雙版本為 213×256，其餘 58 張為 256×256，保留原比例。合計 1,140,872 bytes，約 1.14 MB，含最終來源 metadata |

初版 document 的證書冊形狀經複核後改用單張折角紙，沒有把封存版本重算成更多主題。62 張原始 PNG 與來源記錄均保留。

## 主題與實際用途

| 區域 | 主題 ID |
|---|---|
| 品牌與核心導覽 | `codex`、`dashboard`、`cases`、`analytics`、`judges`、`news`、`collections`、`saved-searches` |
| 查找與參考導覽 | `taxonomy`、`guided-search`、`semantic-search`、`council`、`data-tools`、`courts`、`legislation`、`dictionary` |
| 新聞分類及重點 | `document`、`government`、`tribunal`、`court-update` |
| 核對、日期與研究 | `source-check`、`calendar`、`scope`、`research` |
| 操作及狀態 | `search`、`filter`、`clear`、`original`、`summary`、`empty` |

實作入口為 `frontend/src/components/shared/CodexSticker.tsx`，ID 與導覽對照在 `frontend/src/lib/codex-stickers.ts`。裝飾圖片不取代文字標籤或控制項的可讀名稱；明暗版本由主題選用，不能用濾色或反相代替已交付的另一張素材。

## 來源與逐張提示

- [source-map.json](source-map.json) 是逐檔對照：`assets` 為正式 60 張，`archivedVariants` 為封存 2 張，`unresolved` 為空。每筆保留工具生成檔位置、完整提示、原始 PNG、網頁檔案及各自 SHA-256。
- [prompts.json](prompts.json) 保存初始 30 主題／60 張的完整提示；[document-v2-prompts.json](document-v2-prompts.json) 保存後來重新生成的 2 張文件圖。現行正式版本以 source-map 為準。
- `originals/` 保留 PNG。工具原始輸出另由每筆 `source` 與 `generatedFileSha256` 指向，未修改原工具生成檔。
- 正式網站檔案位於 `frontend/public/assets/legal-codex-stickers/`。[catalog.html](../../../frontend/public/assets/legal-codex-stickers/catalog.html) 是實際 60 張的檢視目錄；[目錄截圖](../sticker-catalog.png)保留本輪畫面。

## 透明度、metadata 與像素保存

[audit_assets.py](audit_assets.py) 直接讀取正式 PNG／WebP，檢查 RGBA、透明及不透明像素、尺寸與雜湊，輸出 [alpha-and-size-checks.json](alpha-and-size-checks.json)。正式 60 張均通過；透明背景來自原生 alpha，並非把棋盤格當成透明。

正式 PNG 以 tEXt、WebP 以標準 XMP 保存逐張完整提示，標準圖片讀取工具可讀出。補入 metadata 會改變容器檔案雜湊，因此已同步更新 source-map 與新版文件圖記錄；它沒有更改圖像內容。[metadata-pixel-preservation.json](metadata-pixel-preservation.json) 的 120 筆 PNG／WebP 解碼 RGBA 像素雜湊前後全部相同，透明度與已取得畫面保持。

## 全部使用的證據

本輪證據位於 `.impeccable/review/news/assets-round2/`：

- [catalog-status.json](../../../.impeccable/review/news/assets-round2/catalog-status.json)：60 張皆已載入，目錄無水平溢出。
- [usage-light.json](../../../.impeccable/review/news/assets-round2/usage-light.json)／[usage-dark.json](../../../.impeccable/review/news/assets-round2/usage-dark.json)：實際操作各確認 30/30 主題載入，包含 `document-v2`；清除、空結果等素材有其對應狀態。

素材目錄載入與實際介面使用分別提供證據，不以展示頁代替操作驗證。

## 後續維護

1. 保留主題 ID、light／dark 配對與實際用途。需更換圖像時，使用內建 image_gen 產生符合 Legal Codex 的透明版本，再補齊逐張提示及來源，不能用相似的舊圖冒充新輸出。
2. 保留被取代版本為封存，更新 source-map 的正式／封存分界；不要覆寫工具原始生成檔。
3. 使用專案既有 Python／Pillow 環境執行讀檔稽核，更新透明度、尺寸、雜湊與總容量。metadata 變更也要確認解碼像素未變，不能只信指令成功訊息。
4. 重新確認實際淺／深介面的全部主題、目錄載入、英文長文、手機及各尺寸，再依既有建置和發布流程處理。

整頁最新寬版比對為 80.31% MATCH，新的獨立複核已 ship；既有瀏覽器自動套件仍有一項失敗，範圍見 [VERIFICATION.md](../VERIFICATION.md)。本輪 60 張正式素材全數雜湊不變，已在本機介面使用；未正式部署、提交或推送。
