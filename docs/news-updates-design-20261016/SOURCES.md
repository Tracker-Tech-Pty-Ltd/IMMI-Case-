# 新聞頁來源核對（2026-10-16）
首批為人工核對的八則官方消息。發布日採個別原文頁的日期，不用搜尋引擎的相對日期、新聞索引日期、政策生效日或核對日替代。所有中英文摘要均為自行整理；本站不重製全文。

| 項目 | 原文發布日 | 來源及原文 |
|---|---|---|
| 法院介紹語言支援與司法參與措施 | 2026-10-15 | [fcfcoa](https://www.fcfcoa.gov.au/news-and-media-centre/media-releases/mr151026) |
| 學生簽證改革公告 | 2026-10-02 | [home-affairs](https://minister.homeaffairs.gov.au/JulianHill/Pages/student-visa-integrity-reforms-take-effect-today.aspx) |
| 部長說明下一階段移民政策方向 | 2026-09-17 | [home-affairs](https://minister.homeaffairs.gov.au/TonyBurke/Pages/migration-reform-end-rorts-bring-skills-australia-needs-strong-economy.aspx) |
| ART 發布審裁程序的生成式 AI 指引 | 2026-08-24 | [art](https://www.art.gov.au/about/news-and-updates/new-generative-ai-practice-direction-available) |
| ART 公告申請費用調整 | 2026-07-01 | [art](https://www.art.gov.au/about/news-and-updates/increased-application-fees-now-apply) |
| 法院更新庭審逐字稿申請方式 | 2026-06-22 | [fcfcoa](https://www.fcfcoa.gov.au/news-and-media-centre/updates-profession/recording-transcription-220626) |
| ART 說明學生簽證覆核程序變更 | 2026-06-01 | [art](https://www.art.gov.au/about/news-and-updates/changes-conduct-student-visa-reviews) |
| 法院發布人工智慧使用實務指引 | 2026-05-29 | [fcfcoa](https://www.fcfcoa.gov.au/news-and-media-centre/updates-profession/pd-ai) |

原文逐頁核對日期：2026-10-16。原文可達且標示日期已人工讀取，資料中的 `verifiedAt` 表示此核對日，不是即時連線狀態。

政府學生簽證公告的個別頁標示 Friday, 02 October 2026；另一改革聲明標示 Thursday, 17 September 2026。新聞索引仍列 1 October／16 September，因此採個別原文頁的 2 October／17 September，避免以索引蓋過原文。
ART 三則分別標示 24/08/2026、1/07/2026、1/06/2026；FCFCOA 三則明示 Published: 15 October, 2026、22 June, 2026、29 May, 2026。
未採用僅能確認裁決日期、無法明確核對發布日期的判決作為新聞，以免混用日期。法院類別因此使用「法院動態」，內容是法院公開消息。

## 維護
編輯 `frontend/src/data/news.json`，逐頁核對原始網址、發布日、範圍與目前文字，再補上英文與繁體中文摘要，更新該項 `verifiedAt` 及整批 `reviewedAt`。重新執行新聞資料與前台測試，建置後循原部署流程審查。修改資料檔不會自動改變線上版本；此輪沒有建立排程、爬蟲、訂閱或通知服務。

保持既有欄位與來源 ID；新增發布機構時加入 `sources`，並同步擴充資料來源驗證測試的允許網域。不可填入無法核對的日期、示範消息或預測個案結果。不要把新聞寫入既有案例資料庫。
