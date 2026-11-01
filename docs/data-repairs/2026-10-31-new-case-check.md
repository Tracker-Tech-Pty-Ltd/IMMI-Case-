# 2026-10-31 新案件查核

本輪查核法院及裁決庭的公開資料，與本機資料依案號、網址及案件識別碼比對後，新增六宗可由法院資料確認的案件。這是有限範圍內找到的案件，並非各法院及裁決庭近期案件的完整同步；部分裁決庭來源無法完整查閱。

| 官方判決 | 日期 | 判決者 |
| --- | --- | --- |
| [Singh [2026] FCA 1638](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1638) | 30 October 2026 | Moshinsky J |
| [Cheng [2026] FCA 1631](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1631) | 30 October 2026 | Colvin J |
| [FDB17 [2026] FCA 1612](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1612) | 29 October 2026 | O'Callaghan J |
| [Jamdar [2026] FCA 1620](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1620) | 28 October 2026 | Rofe J |
| [Kearney [2026] FCA 1615](https://www.judgments.fedcourt.gov.au/judgments/Judgments/fca/single/2026/2026fca1615) | 28 October 2026 | Dowling J |
| [CZQL [2026] HCASJ 36](https://www.hcourt.gov.au/cases-and-judgments/judgments/single-justice-judgments/czql-v-minister-immigration-citizenship-and-multicultural-affairs-ors) | 30 October 2026 | Edelman J |

其中 Jamdar 涉及入籍，Kearney 涉及移民代理註冊。CZQL 為高等法院單一法官案件，所列裁決涉及因未推進程序而駁回申請；不應據此推斷簽證實體結果。未經確認的結果、簽證種類等欄位保持空白。

## 判決文字與來源限制

五宗聯邦法院案件保存法院網頁的可讀文字。接合來源分段時檢查行號連續、重疊內容一致、案件身分、日期、法官、認證尾段及各編號段落。這些是網頁文字副本，並非原始 HTML、Word 或 PDF；排版、超連結、附件或未呈現在網頁的內容可能未保存。

高等法院案件保存由[法院 PDF](https://www.hcourt.gov.au/sites/default/files/eresources/2026-10-30/HCA/CZQL%20v%20Minister%20for%20Immigration%2C%20Citizenship%20and%20Multicultural%20Affairs%20%26%20Ors%20%28S63-2024%29%20%5B2026%5D%20HCASJ%2036.pdf)五頁擷取的可讀文字；本輪未取得原始 PDF 檔案，頁面、註腳及排版可能有差異。官方頁面、PDF 文字及來源網址用來核對案件和法官。

高等法院案件以既有法院分類 `HCA` 保存，原始引註仍為 `[2026] HCASJ 36`。現有自動來源辨識尚不支援 `HCASJ`，因此其內部來源紀錄顯示 `identity_unverified`，未列為可自動重用；本輪依官方來源另行核對，並在匯入前依完整引註、網址和識別碼檢查重複。五宗聯邦法院案件的內部來源紀錄均為 `checked`。此限制不應被描述為六宗均已通過同一套自動辨識。

## 備份與驗證

修改前已備份本機 SQLite、CSV、JSON 及核對帳冊至 `downloaded_cases/updates/new-cases-20261031/backup-before/`，SQLite 使用資料庫備份方式，保留尚在寫入紀錄中的資料。來源分段、文字副本、指紋、匯入演練與實際核對報告保存在同一 `new-cases-20261031/` 目錄；正式文字副本另存於 `downloaded_cases/case_texts/`。這些均為本機備份，並非異地備份。

先在獨立副本演練，六宗匯入成功，重複執行新增零宗且無身分衝突。實際匯入後，SQLite／CSV 各由 152,268 宗增至 152,274 宗，JSON 由 152,275 宗增至 152,281 宗；JSON 原本多出的七宗保留。逐筆比對既有資料和六宗新增資料，三份新資料欄位一致；六份文字均能透過既有讀取方式開啟，與保存時的指紋一致。資料庫及全文索引檢查在實際資料的獨立備份副本上通過。

本輪沒有重新搜尋先前待查的 39 宗舊案；已核對它們的裁決者欄在三份本機資料中仍保持空白，詳見[上輪紀錄](2026-10-28-full-judgments-followup.md)。本輪只更新本機資料，沒有同步雲端案件資料。
