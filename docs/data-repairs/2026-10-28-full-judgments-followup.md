# 2026-10-28 判決原文與新案件續查

## 39 宗待確認裁決者

本輪續查未找到足以確認原審裁決者姓名的新證據，39 個原有姓名欄繼續留白。優先檢查 12 宗已知本機原文不完整的案件：其歷史封存索引各找到一個已去重的 2015 年 HTML 捕獲；成功取回的 `[2004] FCA 1381` 頁面可核對案號和標題，但正文空白。其餘嘗試遭限流或連線拒絕，不能據此認定完整判決不存在。索引及可讀快照保存在 `D:\Dev\Projects\IMMI-Case-review-evidence-20261029\judge-wayback-snapshots\`；目錄中的日期字串僅為資料夾名稱，本輪實際日期為 10 月 28 日。

`[2004] MRTA 7356` 的歷史頁面仍有當事人和日期衝突；其他精確案號及案名搜尋未帶來可歸屬原審的姓名。先前 39 案和分類見[續查紀錄](2026-10-27-judge-followup.md)。

## 九宗法院判決文字

[上輪新增的九宗案件](2026-10-28-judge-and-new-case-followup.md)均已取得法院網頁可讀正文，分段重組成文字副本並接入本機案件資料。這些檔案保留原始法院網址和轉錄方式說明，**不是原始 HTML、Word 或 PDF**；原始 Word 的直接下載曾回應 403，故不能保證原始格式、所有超連結、附表或未呈現在網頁中的內容已保存。

逐案核對標題、判決日期、法官、來源行連續性、重疊區域一致、法院認證尾段及法院標示的編號段落；另由獨立複核再次比對分段。特別是 `[2026] FCA 1548` 的法院頁面以「4 2」顯示總段數，已確認正文第 1 至 42 段齊全。文字檔與來源分段、校驗指紋和逐案結果保存在 `D:\Dev\Projects\IMMI-Case-review-evidence-20261029\fulltext-staging\`；正式使用的文字檔另存於 `downloaded_cases/case_texts/`，沒有覆寫舊原文。

## 其他法院及裁決庭

核對官方來源並比對三份本機資料後，新增 3 宗聯邦法院全院的移民相關判決：

| 判決 | 日期 |
| --- | --- |
| [Manebona [2026] FCAFC 130](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/full/2026/2026fcafc0130) | 24 September 2026 |
| [Deyanti [2026] FCAFC 126](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/full/2026/2026fcafc0126) | 23 September 2026 |
| [VRRQ [2026] FCAFC 117](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/full/2026/2026fcafc0117) | 8 September 2026 |

[法院移民判決指南](https://www.fedcourt.gov.au/law-and-practice/guides/migration)把這些判決列為聯邦法院全院判決。為符合本專案現有法院分類，三案歸入 `FCA`，但引用編號保留 `FCAFC`，官方網址亦保留 `full` 路徑；統計上因此計入聯邦法院而非獨立全院類別。既有聯邦法院下載器對 FCAFC 引註的自動擷取尚未驗證。

高等法院及聯邦巡迴及家事法院的部分近期案件、部分行政審查庭裁決已在本機，未重複新增。AustLII 存取受限，並未取得完整的裁決庭近期清單，不能宣稱所有新案件都已同步。

## 備份與核對

新增案件前及補入全文位置前分別備份 SQLite、CSV、JSON 和核對帳冊；備份位於 `D:\Dev\Projects\IMMI-Case-review-evidence-20261029\backup-before\` 和 `backup-before-fulltext\`。兩項更新先在完整獨立副本演練，重跑皆無重複新增或更新；相關候選、來源及演練報告保存在同目錄 `newcase-staging\`。

本機 SQLite／CSV 各由 152,265 筆增至 152,268 筆，JSON 由 152,272 筆增至 152,275 筆，原有 JSON 額外 7 筆保留。3 宗新案三份欄位一致；九個全文位置接入後再次核對三份資料、原有欄位與檔案指紋。39 個舊案姓名維持空白；SQLite 完整性及獨立副本的全文索引檢查通過。

本輪沒有修改雲端案件或呼叫付費模型。

提交前的程式關聯檢查辨識到兩份文件變更，但沒有與既有索引中的符號重疊；索引仍落後，不能把零重疊當成完整影響證明。案件資料及讀取功能另按上述方式核對。
