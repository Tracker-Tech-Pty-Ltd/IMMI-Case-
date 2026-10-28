# 2026-10-28 裁決者及新案件續查

## 舊案裁決者

39 案仍沒有可安全補回的原審法官／裁決者姓名，本輪補回 **0 案**。三份本機資料已逐一核對，這 39 個姓名欄仍為空白。前次發現至少 12 案原文不完整，見[前次逐案紀錄](2026-10-27-judge-followup.md)；本輪優先按案號及當事人查詢這些案件，並搜尋其他部分案件。公開搜尋和三個 AustLII 代表性原址的嘗試沒有取得能確認姓名的新文件。這不是已窮盡全部來源或證明判決不存在。

`[2004] MRTA 7356` 的當事人及日期衝突仍未解決；不以相似姓名或後續案件的法官推定原裁決者。本輪沒有提出官方資料申請。[行政審查庭公開裁決說明](https://www.art.gov.au/about-us/our-role/published-decisions)表示公開的裁決屬選刊，並提供 AustLII 連結；這不能用來判定某一指定案件是否曾公開。

## 新案件

核對引註、案名、網址及識別碼後，已將下列 9 宗聯邦法院移民相關判決的基本資料加入 SQLite、CSV 及 JSON。日期、法院、案名及法官取自法院頁面或其官方最新判決索引；不能確認的欄位維持空白。這 9 宗是新案件，不是上述 39 案的姓名修復。

| 判決 | 日期 | 法官 |
| --- | --- | --- |
| [[2026] FCA 1602](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1602) | 27 October 2026 | MCDONALD J |
| [[2026] FCA 1600](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1600) | 27 October 2026 | MCDONALD J |
| [[2026] FCA 1589](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1589) | 23 October 2026 | BANKS-SMITH J |
| [[2026] FCA 1586](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1586) | 26 October 2026 | HILL J |
| [[2026] FCA 1595](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1595) | 23 October 2026 | BENNETT J |
| [[2026] FCA 1548](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1548) | 20 October 2026 | STEWART J |
| [[2026] FCA 1560](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1560) | 21 October 2026 | HALLEY J |
| [[2026] FCA 1561](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1561) | 20 October 2026 | COLVIN J |
| [[2026] FCA 1547](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1547) | 20 October 2026 | RAPER J |

8 宗核對法院正文頁；`1600` 在本次留存時以[法院最新判決索引](https://www.fedcourt.gov.au/digital-law-library/judgments/latest)核對基本資料，直接擷取原文頁未成功。已保存的是網頁工具顯示的內容或摘錄，不宣稱是下載的完整原始檔，因此 9 案的本機全文路徑均留空。未推定判決結果；尤其 `1586` 部分爭點延期，不能簡化為全案駁回。

檢查了高等法院最近判決及部分聯邦巡迴及家事法院判決；已存在的案件未重複新增。另有聯邦法院 `[2026] FCA 1572`、`1550`、`1581`、`1585` 等候選尚待取得足夠資料；沒有將第三方索引當作完整核實。AustLII 直接存取遭拒，行政審查庭近期完整公開清單亦未取得；聯邦法院清單查核有存取限制。故不能聲稱本次已涵蓋所有新判決或所有法院、裁決庭。FCAFC 案件如何與目前法院代碼對應亦待另行核對。

## 備份及驗證

寫入前以 SQLite 備份 API 保存案件資料庫及核對帳冊，並逐位元備份、核對 CSV 和 JSON；備份位於 `D:\Dev\Projects\IMMI-Case-review-evidence-20261028\backup-before\`。先以真實資料的獨立副本演練既有匯入流程：9 案新增，重跑新增 0 案，未發現衝突。

正式寫入後 SQLite／CSV 各由 152,256 增至 152,265，JSON 由 152,263 增至 152,272；JSON 原有額外 7 筆均保留。逐筆比較原有資料及 JSON 其他資料，未發現改動；9 案所有欄位在三份資料一致。SQLite 完整性及搜尋索引檢查通過，39 個既有姓名空白均保留。驗證報告、候選資料、來源摘錄與來源雜湊位於 `D:\Dev\Projects\IMMI-Case-review-evidence-20261028\`；備份版和寫入後資料庫的 SQLite 檔案指紋可能因儲存方式不同，內容以資料庫查詢核對。

本輪沒有修改雲端案件、呼叫付費模型或覆寫任何舊判決原文。

提交前的 GitNexus 變更檢查辨識到兩份文件有差異，但沒有與索引中的符號重疊；不能把這項結果視為完整影響證明。嘗試更新索引時程序長時間未完成，已停止該次更新；本次變更僅為文件，案件資料另以備份及逐筆比對驗證。
