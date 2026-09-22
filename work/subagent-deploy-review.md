# 獨立部署前評審報告 — IMMI-Case- aggregate-rebuild 修復

- **評審對象**：`/Volumes/Storm Breaker/Developer/IMMI-Case-`，branch `fix/aggregate-rebuild-debounce`，HEAD `576b312`（= `origin/fix/aggregate-rebuild-debounce`，已確認本地與 remote 同 commit）
- **評審人**：獨立評審 subagent（唯一評審，未參與此 branch 開發）
- **評審日期**：2026-09-11（Australia/Melbourne）
- **部署目標**：Cloudflare Worker `immi-case-standalone`（operator-gated GitHub Actions），queue `immi-case-mutation-queue`
- **限制遵守**：全程唯讀。未執行任何 git commit/push、未執行 wrangler deploy、未對 Cloudflare 或任何雲端發出寫入請求。只跑了測試與唯讀模擬。**不在 repo 內新增／修改任何檔案**；唯一在 repo 內被寫入的檔案是 `work/rebuild-statements.json`，那是任務明文要求我執行的 `node work/capture-statements.mjs` 所產生的 scratch 檔。另外在 `/tmp` 建立兩個臨時 harness（`/tmp/immi-review-sim.mjs`、`/tmp/operator-main.toml`）作驗證用，不屬 repo。

---

## 0. 執行摘要（先講結論）

| 項目 | 結果 |
|---|---|
| 4 個指定驗證命令 | 全部通過（27 files / 390 tests、27 checks failures=[]、bundle closure 343684 bytes、pytest 6 passed） |
| 主要修復（queue 不再每 batch 重建） | **已正確實作並經實證**：queue 只寫 3 行 control row；正常 import 只需 1 次重建（實測 ~$0.58） |
| **發現 1 個 HIGH（會令成本事故重演）** | `max-staleness` 分支繞過 interval debounce，一旦越過 6 小時上限，「每一批 queue」都會觸發一次完整重建。以生產真實 SQL + 真實 JS 決策碼 + 模擬時鐘實測：24 小時連續寫入 = **2161 次重建 ≈ US$1,262/日**；每 60 秒一批 = **1081 次 ≈ US$631/日**。文件聲稱「≤4 次/日 ≈ $2.30」是錯的（低估約 270 倍） |
| **最終裁決** | **NOT-SAFE-TO-DEPLOY**（as-shipped defaults）。需先套用 HIGH-1 的最小修正，或由 operator 把 `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` 設成實際上永遠不會到的值（見 §6） |

---

## 1. 逐項檢查清單結果

### 檢查 1：讀關鍵代碼 — 完成

已完整讀取：
- `workers/storage/cloudflare.js`（2122 行）重點區段：`AGGREGATE_BOOKKEEPING_KEYS`（:53-57）、`leaseToken`（:63-67）、`rebuildAggregates`（:1015-1128）、`markAggregatesDirty`（:1138-1165）、`readAggregateState`（:1167-1175）、`aggregatesNeedRebuild`（:1183-1238）、`claimRebuildLease`（:1246-1264）、`renewRebuildLease`（:1267-1274）、`releaseRebuildLease`（:1278-1284）、`createCloudflareStores`（:2093-2104）
- `workers/cloudflare-native.js`（388 行）：`handleCaseMutationQueue`（:104-132）、`rebuildUnderLease`（:164-184）、`handleScheduledRebuild`（:193-232）、`markStaleAndMaybeRebuild`（:243-268）、`scheduled`（:338-340）、defaults（:134-143）
- Diff 統計（`git diff --stat 42826a3...HEAD`）：10 個檔案、+1469/-14 — **已全部覆蓋**（2 個 worker 檔、3 個測試檔、2 個 toml、2 個 docs、1 個 STATE.md）

### 檢查 2a：重建能否被永久餓死？max-staleness 是否可達？— 可達，而且會「過度觸發」（HIGH-1）

- `rebuild_dirty_since` 在 clean→dirty 邊緣被設為 now，只有 rebuild 完結時「期間無新 mutation」才會歸零（`cloudflare.js:1157-1162` 設值；`:1111-1114` 條件歸零）。連續寫入時它永遠保持 armed。
- `max-staleness` 檢查（`cloudflare.js:1213-1215`）排在 interval debounce（`:1217-1219`）**之前**，所以越過上限後，interval 與 quiet window 全部被繞過 → 每次呼叫 `aggregatesNeedRebuild` 都回 `due:true`。
- queue 側 `markStaleAndMaybeRebuild`（`cloudflare-native.js:243-268`）是**每個 batch 都呼叫**一次，因此越過上限後變成「每個 queue batch 觸發一次完整重建」＝ 原始事故機制重演。
- 實測（真代碼）：`aggregatesNeedRebuild` 在 `rebuild_last_at = now-60`（1 分鐘前才重建完）且 `dirty_since` 陳舊時仍回 `due:true, reason:"max-staleness"` → 證明 interval 完全失效。

**結論**：不會被餓死（反而是相反）；max-staleness 可達且可持續觸發。此為 HIGH-1，詳見 §3。

### 檢查 2b：兩個 isolate 可否同時重建？lease/fencing 失效窗口？中途寫一半？— 互相排斥成立，殘餘風險低

- `claimRebuildLease`（`cloudflare.js:1253-1257`）為單一 conditional upsert（`... DO UPDATE ... WHERE catalog_summary.value_int < ?`），expiry 與 fencing token 同一 statement 寫入（token 存 `updated_at`）；以真 SQLite 驗證：`claim wins when free` / `second claim loses while the lease holds` / `claim wins again after expiry` 全部 ok（見 §2 實跑輸出）。
- `renewRebuildLease`（`:1270-1272`）為 token-conditional；`releaseRebuildLease`（`:1280-1282`）同樣帶 token，過期 holder 無法釋放或延長新持有者的 lease（真 SQLite 驗證 ok）。
- **無「lease 遺失後仍寫入一批」的窗口**：`rebuildAggregates` 的 chunk 迴圈（`:1116-1126`）是「先 renew，成功才 batch」，renew 失敗即 throw（`:1120-1124`），所以失去 lease 後不會再提交任何 chunk。註解所講「At most one chunk can overlap」指的是新持有者可能與「已提交的上一批」交錯，屬可接受。
- 單一 chunk 存活時間遠超 lease（900s）才可能出現交錯；D1 單一 statement 不可能跑 900 秒，故此窗口實際上不可達。
- **失敗會留半成品**：整個重建不是單一 transaction（44 個 statement 分 3 個 chunk 提交），任何中途 throw 都會留下「部分表空／部分表新」的狀態，直到下一次成功重建才收斂（下一次 cron 最多 5-10 分鐘內到）。屬既有設計，評級 LOW。

### 檢查 2c：cron 缺失或 vars 缺失時的行為？會否變成每 batch 重建？— default 安全，但缺 cron 完全沒有自動防守（MED-1）

- 缺 `[triggers]`：`scheduled()` 永不被呼叫 → 只剩 queue 側 fallback，`AGGREGATE_REBUILD_FALLBACK_SECONDS` default 3600s（`cloudflare-native.js:135`、`:245-248`）。不會回到每 batch 重建。
- 缺 vars：`positiveIntOr`（`:145-148`）會退回安全 default（300/3600/300/21600），`"0"`、`"-5"`、`"not-a-number"` 一律退回 default（測試 `cloudflare-native-scheduled-rebuild.test.js:79-86` 已覆蓋）。
- 唯一例外：`AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "1"` 之類的小正數會被接受，等同每 batch 重建；屬 operator 誤設，非 default（LOW-3）。
- **但**：`scripts/check_cloudflare_native_target.py`（部署 gate，`:131-158`）**完全沒有檢查 `[triggers]` 或 4 個 AGGREGATE_REBUILD_* var**；整個 repo 只有 worker 與測試檔出現過 `AGGREGATE_REBUILD`（grep 已證）。即 operator 就算忘記合併 config，pipeline 也一路綠燈出貨 → 修復的主機制靜默缺席，且**沒有任何自動警號**（MED-1）。

### 檢查 2d：queue 側 fallback 會否令成本重新失控？— 正常情況下不會；進入 >6 小時連續寫入狀態時會（= HIGH-1）

- 正常：fallback interval 3600s + quiet 300s，實測「4 小時 import 後歸於安靜」= **1 次重建 ≈ $0.58**（§2 模擬 A）。
- 例外：越過 max-staleness 後，fallback 的 3600s 也被繞過，變成每個 batch 一次（模擬 B/C 的重建全部由 `queue/max-staleness` 路徑拿走，因為 batch 比 cron tick 密）。
- 注意 first-deploy 殘餘風險：`lastAt = 0` 時 `elapsedSeconds` 被當成 `interval`（`:1201`），所以第一次 fallback 不需等 interval，只需等 quiet 300s。一次性、可接受。

### 檢查 2e：bookkeeping 行會被 rebuild 的 DELETE 清走嗎？— 不會（已驗證）

- `DELETE FROM catalog_summary WHERE summary_key NOT IN (7 keys)`（`cloudflare.js:1021`、`:1030-1032`），7 個 key 列於 `:53-57`。
- 真 SQLite 驗證：`bookkeeping rows exist after the rebuild`、`keeps the bookkeeping keys alive across the rebuild delete`（測試 `cloudflare-aggregate-rebuild-guard.test.js:365-375`）皆 ok。
- 副作用（LOW）：若日後有程式在 `catalog_summary` 寫入其他 key（例如 transform 新增 summary 欄位），會被重建無聲刪除。
- **另有一個獨立隱患**：`scripts/transform_immi_snapshot.py:325` 是**無條件** `DELETE FROM catalog_summary`。若在生產 cron 運作期間對生產 D1 執行該離線 transform，會清走 generation／applied／lease → 進行中的重建 renew 失敗而中止，且 dirty 狀態遺失。此檔不在部署路徑上（部署不用它），但 operator 手上若有這個 import 流程就要留意（LOW-2）。

### 檢查 2f：需唔需要 D1 migration？— 不需要（已驗證）

- `catalog_summary` 已存在於 `migrations/d1/catalog/0001_catalog.sql:184-188`：`summary_key TEXT PRIMARY KEY, value_int INTEGER NOT NULL CHECK(value_int >= 0), updated_at TEXT NOT NULL`，非 STRICT。
- 新 key 只是新 row，不需 schema 變更；lease token（UUID 字串）寫入 `updated_at`（TEXT），expiry（正整數）寫入 `value_int`，`releaseRebuildLease` 寫 0 → 符合 `CHECK(value_int >= 0)`。
- `verify-rebuild-sql.py` 實跑：`schema tables: 30 | missing: []`，整個重建 44 個 statement 全部在真 schema 上執行成功、`failures: []`。
- 部署 workflow 亦不執行 migration（`.github/workflows/deploy-worker.yml:101` 只 `wrangler deploy`）。

### 檢查 3a：quiet window 期間 aggregate 較舊／重建中空窗，有冇 API／前端會報錯？— 不會報錯，只會短暫顯示 0／空（LOW-1）

- 所有 aggregate 讀取都集中在 `workers/storage/cloudflare.js`（grep `FROM aggregate_` 在 workers 其他檔案 = 0 命中），全部 null-safe：`rows(...)`、`Number(x?.total || 0)`、`Object.fromEntries`。
  - `getStats`（:792-816）空表 → 全部 0／`{}`；`analyticsConcepts`（:818-824）、`analyticsJudges`（:826-834）空表 → `[]`；`getCourtYearTrends`（:561-586）、`getFilterOptions`（:552-559）、`analyticsScopeTotals`（:687-691）同樣安全。
- 重建的 17 個 DELETE 集中在 chunk 1（與 3 個 INSERT 同 transaction），之後仍有 2 個 chunk 才補齊 → 中間數秒至數十秒，儀表板可能顯示 0 或空圖表。**不會 throw、不會 5xx、不會無限重試**，只影響可視性。
- 若重建中途失敗，空／半新狀態會維持到下一次成功重建（cron 最多 5-10 分鐘內）。

### 檢查 3b：部署一刻 queue 已 paused 且 mutations disabled，scheduled handler 會否崩潰／無限重試／大量寫入？— 不會

- 部署後首個 cron tick：`readAggregateState` 讀不到任何 `rebuild_*` row → `pending = 0`、`applied = 0` → `pending <= applied` → `{due:false, reason:"clean"}`（`cloudflare.js:1192`；實測 case E）。零寫入、零 throw。
- `IMMI_CASE_MUTATIONS_ENABLED` 只影響 `workers/case-api/cloudflare_mutations.js:302`（寫 API gate）；grep 顯示 `createCloudflareStores`／scheduled 路徑完全不理它 → 不會因 mutations disabled 而崩潰。
- 唯一新風險（MED-2）：`handleScheduledRebuild`（`cloudflare-native.js:194`）用重量級 `createCloudflareStores(env)`，它會 `assertCloudflareBindings` 要求 **R2（put/get）+ Vectorize（queryById/query）+ AI（run）** 齊全（`storage/contracts.js:163-183`）。cron 其實只需要 catalog D1（已有輕量工廠 `createCloudflareCaseStore`，`cloudflare.js:2111-2115`）。若 Vectorize／AI／R2 binding 有問題，每 5 分鐘的 cron 會全部失敗，重建靜默停擺；queue 側 fallback 也會 throw，令整個 batch 進入 retry（最多 5 次後入 DLQ），即 mutation 被重複處理（重複 embedding 有成本）。

### 檢查 4：實際驗證（必須）— 全部通過，但測試數字與文件不符

見 §2，四條命令原文輸出齊全。

### 檢查 5：operator-deploy-checklist.md 逐條核對 — 3 個真實路徑問題（MED-3/MED-4、LOW-5）

| 檢查項 | 結果 |
|---|---|
| `scripts/check_cloudflare_native_bundle.mjs` 存在 | ✅ 存在，實跑通過 |
| `scripts/check_cloudflare_native_target.py` 存在、`--main-config` flag 存在 | ✅ 存在（`:198-202`） |
| `npm run test:workers` script 存在 | ✅ `package.json` 有 |
| `make test-workers` 存在（cost-guard doc §Deploy requirements） | ✅ `Makefile:70` |
| workflow 名稱 `Deploy IMMI Workers (Cloudflare-native, operator-only)` | ✅ `.github/workflows/deploy-worker.yml:1` 完全一致 |
| `docs/ops/operator-deploy-checklist.md:61` 期望「27 files / 388 tests」 | ❌ **實際 27 files / 390 tests**（見 §2）→ 文件數字過時（LOW-4） |
| `:37-46` 的 TOML 合併驗證 snippet | ✅ 邏輯正確（`tomllib` + assert crons + 4 個 var） |
| `:21-32` 警告 `[triggers]` 必須在所有 `[vars]` 之後 | ✅ 正確 TOML 語義；`wrangler.toml`（:114-118）與 `config/wrangler-cloudflare-native.toml.example`（:72-73）都排在 `[vars]` 之後，✅ |
| `:60` `python3 scripts/check_cloudflare_native_target.py --main-config <file>` | ❌ **只給 main、冇 `--pipeline-config`**，script 會改用 checked-in 的 `workers/austlii-scraper/wrangler.toml`（仍是 placeholder）→ **必然失敗**（實跑 exit=1，見 §2）。另外 macOS 內建 `python3` 是 3.9 冇 `tomllib`，同一命令直接報「Python 3.11+ with tomllib is required」（實跑 exit=1）（MED-3） |
| `:62` 「same checks the workflow runs」 | ⚠️ 部分不準：deploy workflow（:56-73）**不跑** bundle check 與 `npm run test:workers`；那兩個在 `ci.yml:91,94` 才跑（LOW-5） |
| `:75` 期望 control keys 清單 | ⚠️ 只列 6 個，漏了 `rebuild_last_mutation_at`（實作有 7 個，`cloudflare.js:53-57`）（LOW-4） |
| `:84-91` §6 解鎖順序 | ❌ **列成「1. 開 mutations、2. resume queue」**；正確應為「先 resume queue，再開 mutations」。理由：queue 仍 paused 時開 mutations，寫 API 會接受寫入並 enqueue，但冇 consumer → 訊息累積，超過 4 天 retention 直接過期消失（文件自己在 `:94` 寫了這個後果）。operator 照編號做就有資料遺失風險（MED-4） |
| `:96-104` rollback 建議 | ✅ 合理：不回到 per-batch、優先修 cron、可調 interval／max-staleness、可用 `crons = []` 退回 fallback |

### 檢查 6：成本數學 — 584k 行 × $1/M 合理；但「最壞成本」文件寫錯

- $12,060 = 12.06B 行 × $1/M ✅ 與事故敘述自洽。
- 每次重建 584k 行 → $0.584 ✅ 與 `docs/ops/aggregate-rebuild-cost-guard.md:16` 自洽。
- 重建 statement 集合已核對：17 張表、44 個 statement（1 state read + 17 DELETE + 17 INSERT…SELECT + 7 filter_options + 3 bookkeeping）；測試 `cloudflare-aggregate-rebuild-guard.test.js:349-363` 斷言 `1 + 17*2 + 7 + 3 = 45` 個 prepared。
- 584k 這個數字**我無法獨立覆核**（唯讀、不能查生產 D1 的行數分佈），只能確認它與 statement 集合、與事故的 query insights 敘述一致。屬「沿用、未獨立驗證」的假設。
- **一次 153k 案件 import 的最壞成本**：
  - 連續寫入 < 6 小時（文件假設的 ~4 小時）：**1 次重建 ≈ $0.58** + ~23k control rows ≈ $0.02（實測模擬 A）。
  - 連續寫入 > 6 小時：**文件寫「每 window 一次」，實際是每 batch 一次**。實測模擬：24h 連續（每 2s 一批）= 2161 次 ≈ **$1,262**；24h 每 60s 一批 = 1081 次 ≈ **$631**。
  - 亦即 `cost-guard.md:91`（「a run longer than the staleness bound adds one rebuild per window」）與 `:92`（「≤ 4 rebuilds/day ≈ $2.30」）**都是錯的**，實測低估約 270 倍 — 這正是 operator 唯一可依賴的成本模型，必須修正。

---

## 2. 實際執行驗證（原文輸出）

### 2.1 `npm run test:workers`

```
$ cd "/Volumes/Storm Breaker/Developer/IMMI-Case-" && npm run test:workers 2>&1 | tail -25
 ✓ __tests__/llm-council-runner.test.js (29 tests) 7111ms
 ...
 Test Files  27 passed (27)
      Tests  390 passed (390)
   Start at  03:47:22
   Duration  7.56s (transform 900ms, setup 0ms, collect 2.23s, tests 7.41s, environment 3ms, prepare 2.06s)
```

→ **27 檔 / 390 測試全過，0 fail**。注意：checklist `:61` 寫「expect 27 files / 388 tests」，實際 390（LOW-4）。

### 2.2 `node work/capture-statements.mjs && verify-rebuild-sql.py`

```
$ node work/capture-statements.mjs
{"statements":56}

$ LANG=en_US.UTF-8 /usr/bin/python3 work/verify-rebuild-sql.py
  schema tables: 30 | missing: []
  ok   rebuild writes total_cases
  ok   rebuild writes with_full_text
  ok   rebuild stamps last rebuild time
  ok   rebuild applies the generation it observed
  ok   aggregates are populated
  ok   bookkeeping rows exist after the rebuild
  ok   a clean rebuild disarms the staleness clock
  ok   a mutation arms the staleness clock
  ok   mid-rebuild mutation stays pending
  ok   applied generation equals the pre-scan snapshot
  ok   a mid-scan mutation keeps the staleness clock armed
  ok   decision query sees the pending generation
  ok   claim writes expiry and token in one statement
  ok   lease claim wins when free
  ok   second claim loses while the lease holds
  ok   lease row carries the fencing token
  ok   claim stamps the attempt time
  ok   renew wins for the owner token
  ok   renew loses for a stale token
  ok   stale release cannot free someone else's lease
  ok   owner release frees the lease
  ok   claim wins again after expiry
  ok   staleness clock arms on the first mutation only
  ok   mutation timestamp is refreshed
  ok   rebuild with nothing new disarms the staleness clock
  ok   generation upsert stays a single row
  ok   dirty writes do not clobber other summaries

{ "failures": [], ... }
```

→ **27/27 ok、failures=[]**。此 harness 用真 SQLite + 真 schema 執行捕獲到的生產 SQL，是本次評審最有力的 SQL 層證據。

### 2.3 `node scripts/check_cloudflare_native_bundle.mjs`

```
$ node scripts/check_cloudflare_native_bundle.mjs 2>&1 | tail -3
Cloudflare-native bundle closure passed (343684 bytes): /tmp/immi-cloudflare-native-bundle.mjs
```

### 2.4 `env -u PYTHONPATH .venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q`

```
$ env -u PYTHONPATH .venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q 2>&1 | tail -3
TOTAL                                                  7115   6381    10%
============================== 6 passed in 0.85s ==============================
```

→ **6 passed**。

### 2.5 額外：真代碼決策邏輯探測（node 直接 import 生產模組）

用 `createCloudflareStores` 載入**生產代碼**，餵入各種 `catalog_summary` 狀態，觀察 `aggregatesNeedRebuild` 的實際判決：

```
A rebuilt 300s ago, continuous writes, dirty_since 21900s old => {"due":true,"reason":"max-staleness","seconds_since_first_pending":21900,...}
B dirty_since exactly 21600                                  => {"due":true,"reason":"max-staleness",...}
C below bound by 1 (21599), last rebuild 300s ago             => {"due":false,"reason":"awaiting-quiet",...}
D rebuilt only 60s ago, dirty_since 22000s old                 => {"due":true,"reason":"max-staleness","seconds_since_last_rebuild":60}
E clean                                                        => {"due":false,"reason":"clean"}
F queue-fallback params (interval 3600), same state as A       => {"due":true,"reason":"max-staleness",...}
```

→ **case D 是關鍵證據**：上一次重建只過了 60 秒，仍回 `due:true`。interval debounce 對 max-staleness 路徑完全無效。**case F** 證明 queue fallback（interval 3600）同樣被繞過。

### 2.6 額外：24 小時決定性模擬（真代碼 + 模擬時鐘 + 真 SQLite）

Harness：`/tmp/immi-review-sim.mjs`（不屬 repo）。手法：
- 注入模擬時鐘（覆寫 `Date.now`），令真實生產函式 `aggregatesNeedRebuild` / `claimRebuildLease` / `renewRebuildLease` / `releaseRebuildLease` 走到模擬時間；
- D1 binding 用 `node:sqlite` 包裝，載入**真 schema**；
- 重建與 mark-dirty 用 §2.2 捕獲的**真生產 SQL** 重播（重建期間照樣有 mutation 落地，即真實 race）。

```
[A. perfect quiet: one 1000-batch import then silence 8h]
  simulated 4.7h | rebuilds=1 | rows written ≈ 584,000 | cost ≈ $0.58
  #1 at t=0.83h via queue/dirty applied=4 dirty_since=... (age=3000s)

[B. sustained writes, batch every 2s, 24h, rebuild 30s]
  simulated 24.0h | rebuilds=2161 | rows written ≈ 1,262,024,000 | cost ≈ $1262.02
  #1 at t=6.00h via queue/max-staleness applied=10801 dirty_since=1789016800 (age=21602s)
  #2 at t=6.01h via queue/max-staleness applied=10831 dirty_since=1789016800 (age=21632s)
  #200 ... #2000 at t=22.66h via queue/max-staleness (age=81572s)

[C. sustained writes but each batch 60s apart, 24h]
  simulated 24.0h | rebuilds=1081 | rows written ≈ 631,304,000 | cost ≈ $631.30
  final generation=2522 applied=2521 dirty_since=1789103202
```

→ 模擬 A 證明**正常路徑完全達成設計目標**（1 次重建、$0.58）。B/C 證明 HIGH-1：重建在 t=6h 準時開始，之後**每批 queue 一次**，且全部由 `queue/max-staleness` 路徑觸發，`dirty_since` 一直保持 armed（age 由 21602s 一路升到 81572s）。這不是被 cron 節流，是被 queue batch 節流。註：B/C 是「每批都有 mutation 落在重建期間」的悲觀上界；實際比率取決於寫入密度，但只要寫入夠密（長 import），就會趨近此上界。

### 2.7 額外：checklist §3 命令實跑

```
$ env -u PYTHONPATH .venv/bin/python scripts/check_cloudflare_native_target.py --main-config /tmp/operator-main.toml
Cloudflare-native IMMI deploy blocked:
- d1_databases[IMMI_CATALOG_DB].database_id is missing or still a placeholder
- d1_databases[IMMI_OPS_DB].database_id is missing or still a placeholder
- kv_namespaces[PIPELINE_KV].id is missing or still a placeholder
- main and pipeline IMMI_CATALOG_DB IDs must match
- main and pipeline IMMI_OPS_DB IDs must match
EXIT=1
```
（`/tmp/operator-main.toml` = repo `wrangler.toml` 的 placeholder 已換成假 UUID 的副本，模擬一份「正確的 operator main config」。）

```
$ /usr/bin/python3 scripts/check_cloudflare_native_target.py      # macOS 內建 python3 = 3.9.6
Cloudflare-native IMMI deploy blocked:
- Python 3.11+ with tomllib is required
- Python 3.11+ with tomllib is required
```

→ checklist `:60` 的命令照抄會失敗（缺 `--pipeline-config` + macOS python3 版本），operator 會被假警報卡住（MED-3）。

---

## 3. Findings

### HIGH-1 — 越過 max-staleness 上限後，重建退化為「每個 queue batch 一次」，成本事故機制重演

- **Severity**：HIGH（成本／可用性；不會即刻弄壞資料，但會重現 2026-08 事故的成本曲線）
- **位置**
  - `workers/storage/cloudflare.js:1213-1215`（max-staleness 分支，排在 interval gate 之前）
  - `workers/storage/cloudflare.js:1217-1219`（interval gate，被繞過）
  - `workers/storage/cloudflare.js:1111-1114`（條件式歸零 `rebuild_dirty_since`，令陳舊狀態持續 armed）
  - `workers/cloudflare-native.js:123`（queue 每 batch 呼叫）→ `:243-268`（per-batch fallback 決策）→ `:164-184`（lease 只互斥、不限流）
  - 文件錯述：`docs/ops/aggregate-rebuild-cost-guard.md:91-92`
- **成因**：`aggregatesNeedRebuild` 先判 max-staleness（`>= 21600` 即 `due`），再判 interval。`rebuild_dirty_since` 只在「rebuild 期間無新 mutation」時歸零（`:1111-1114`），所以在連續寫入下永遠 armed。於是重建完成後的下一個 queue batch 立即再判 `due:true`；cron 與 queue fallback 都會命中，lease 只能防止同時並發，不能限流。
- **可重現步驟**
  1. `cd "/Volumes/Storm Breaker/Developer/IMMI-Case-" && node work/capture-statements.mjs`
  2. `node /tmp/immi-review-sim.mjs`（harness 見 §2.6；用真生產函式 + 真 SQLite + 模擬時鐘）→ 讀 B/C 兩段輸出
  3. 或最小重現（真代碼，無需 SQLite）：以 `createCloudflareStores` 餵 `{pending:100, applied:99, last_at:now-60, last_attempt_at:now-60, last_mutation_at:now-5, dirty_since:now-22000}` 呼叫 `aggregatesNeedRebuild({minIntervalSeconds:300,quietSeconds:300,maxStalenessSeconds:21600})` → 實測回 `{"due":true,"reason":"max-staleness","seconds_since_last_rebuild":60}`（§2.5 case D/F）
- **影響量化**：24h 連續寫入 = 2161 次 × 584k 行 ≈ $1,262/日（模擬 B）；每 60s 一批 = 1081 次 ≈ $631/日（模擬 C）。事故本身約 $1,206/日，即最壞情況可回到事故同一個數量級。
- **觸發條件**：同一段連續寫入不得安靜 300 秒，且持續超過 6 小時（`AGGREGATE_REBUILD_MAX_STALENESS_SECONDS`）。部署當刻 queue paused／mutations off **不會**觸發；operator 解鎖（resume queue + 開 mutations）後，一個 >6 小時的 import／backfill 就會中招。文件假設 153k import ≈ 4 小時，故文件情境安全，但多個 import 連續跑、或更大 backfill 就會越界。
- **最小修正（建議，二選一）**
  1. **首選**：令 `rebuild_dirty_since` 在每次重建結束時無條件歸零（`cloudflare.js:1111-1114` 移除那個相關子查詢條件）。待辦狀態由 generation 保證（`:1019-1020`、`:1104-1105`），時鐘只負責 staleness 上限；歸零後下一個 mutation 會重新 arm，上限仍然可達。效果：>6h 連續寫入的最高頻率回到每 6 小時 1 次 ≈ $2.30/日，正正符合文件模型。需同步更新 `cloudflare-aggregate-rebuild-guard.test.js:377-402` 與 `:144-145`。
  2. 或：在 max-staleness 分支上加 interval 節流（把 `:1213-1215` 移到 `:1217-1219` 之後）。此舉只把上界由「每 batch」變成「每 300 秒」（288 次/日 ≈ $167/日），仍不符文件承諾，故不建議單獨使用。
- **若必須即時部署的過渡做法（無需改碼）**：operator 把 `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` 設為實際上永遠到不了的值（例如 `"604800"`，7 日），並在 checklist 明示「此 value 一經到達即會退化成 per-batch 重建」。代價：連續寫入超過 7 日期間 analytics 會持續陳舊。

### MED-1 — 部署 pipeline 完全沒有檢查 cron 與 4 個 AGGREGATE_REBUILD_* var

- **位置**：`scripts/check_cloudflare_native_target.py:131-158`（`_validate_main` 只檢查 name/main/storage_mode/mutations_enabled/bindings/queues，無 `triggers.crons`，無 AGGREGATE_REBUILD_*）；`.github/workflows/deploy-worker.yml:56-73`（三道 gate 都冇檢查）；`docs/ops/operator-deploy-checklist.md:6-8` 只有散文警告
- **證據**：`grep -rn "AGGREGATE_REBUILD\|triggers\|crons" scripts/*.py`（除 worker/測試外）零命中；`scripts/check_cloudflare_native_target.py` 全文無 "trigger" 字樣
- **後果**：operator 忘記把 `[triggers] crons = ["*/5 * * * *"]` 與 4 個 var 合併入 `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64`，pipeline 仍全綠出貨。系統會退到 queue fallback：正常寫入模式下仍安全（≤1 次/小時），但「5 分鐘新鮮度 + 每 import $0.58」的核心保證靜默消失，且**無任何自動警號**。
- **建議**：在 `check_cloudflare_native_target.py::_validate_main` 加 `_check_required(errors, config, "triggers.crons", ["*/5 * * * *"])` 與 4 個 var 的存在性／正整數檢查（fail closed）。這是本次最高性價比的補強。

### MED-2 — scheduled handler 依賴 R2／Vectorize／AI binding，令 cron 有額外失效面

- **位置**：`workers/cloudflare-native.js:194`（`createCloudflareStores(env)`）→ `workers/storage/cloudflare.js:2093-2095` → `workers/storage/contracts.js:163-183`
- **後果**：cron 只需要 catalog D1，卻要求 R2 + Vectorize + AI 全部可用。任一 binding 異常（例如 Vectorize index 問題、AI binding 未設）→ 每 5 分鐘的 cron 全部失敗，重建靜默停擺；同一次 binding 異常亦令 queue batch 在 `createCloudflareStores` 直接 throw（該呼叫在 `try` 之外，`cloudflare-native.js:106`），整個 batch 進 retry 最多 5 次後入 DLQ → mutation 被重複處理（重複 embedding 有費用）。
- **建議**：`handleScheduledRebuild` 改用已有輕量工廠 `createCloudflareCaseStore(env)`（`cloudflare.js:2111-2115`，只需 catalog D1）。

### MED-3 — checklist §3 的 gate 命令照抄會失敗（缺 `--pipeline-config`；macOS `python3` 版本）

- **位置**：`docs/ops/operator-deploy-checklist.md:60`
- **證據**：§2.7 兩段實跑輸出（缺 pipeline config → 5 個 placeholder 錯誤、exit 1；`/usr/bin/python3` = 3.9.6 → `Python 3.11+ with tomllib is required`，exit 1）。本機 `python3 --version` = 3.9.6，venv = 3.14.7。
- **後果**：operator 依指示在本機跑 gate 會被假警報擋住（或誤以為部署設定有問題）。真正部署在 ubuntu-latest 上跑、且 workflow 兩份 config 都傳，所以 pipeline 本身不受影響。
- **建議**：改為 `--main-config /path/to/operator-main.toml --pipeline-config /path/to/operator-pipeline.toml`，並註明需 Python 3.11+／用 `.venv/bin/python`。

### MED-4 — checklist §6 解鎖順序列成「先開 mutations、後 resume queue」，有訊息過期風險（正確順序與 parent 的理解一致：先 resume queue）

- **位置**：`docs/ops/operator-deploy-checklist.md:84-91`（編號 1 = 重開寫 API，編號 2 = `queues resume-delivery`），同檔 `:94` 自己寫明「otherwise mutations queue up with no consumer and expire after four days」
- **後果**：若 operator 依編號先開 mutations，而之後 resume queue 之間有延遲／遺忘，寫 API 接受的 mutation 會 enqueue 到 paused queue，超過 retention（預設 4 日）直接消失 → 無聲資料遺失（catalog 與實際寫入不一致）。
- **建議**：把編號對調（1. `queues resume-delivery`，2. 開 mutations），或明示「兩步之間不得有明顯延遲，且完成後必須確認 queue 有 consumer 在跑」。

### MED-5 — deploy gate 硬性要求 `IMMI_CASE_MUTATIONS_ENABLED = "false"`，與 §6「部署後開返 mutations」互相打架

- **位置**：`scripts/check_cloudflare_native_target.py:140`（`_check_required(..., "vars.IMMI_CASE_MUTATIONS_ENABLED", "false")`）
- **後果**：operator 依 §6 用 dashboard／API 把線上 var 改成 `"true"` 後，**下一次** operator deploy（例如 rollback 或下一個修復）會由 operator config 把該 var 覆寫回 `"false"`（gate 也照樣通過，因為 secret 內仍是 false）→ mutations 靜默再次關閉，只留下寫 API 403 的症狀，容易誤判為新事故。
- **建議**：把這個 gate 改成「必須明確存在且 operator 已聲明」，或改以獨立的 unwind 步驟在每次部署後核對線上 var（加入 §5 post-deploy 檢查）。此問題並非本 branch 引入，但本 branch 的部署流程一定會踩到。

### LOW-1 — 重建期間 aggregate 表短暫空／半新，儀表板會顯示 0

- 位置：`workers/storage/cloudflare.js:1023-1033`（17 個 DELETE 集中在 chunk 1）、`:1116-1126`（分 3 個 chunk 提交）
- 讀取端全部 null-safe（§3a），不會 5xx；只是數秒至數十秒內數字為 0／空圖。
- 建議：可接受；若想避免，可在 chunk 1 之後才 DELETE（先 INSERT 到 temp 再 swap），或在 API 層加 `rebuild_last_at` 新鮮度標示。

### LOW-2 — `transform_immi_snapshot.py` 無條件 `DELETE FROM catalog_summary`

- 位置：`scripts/transform_immi_snapshot.py:325`
- 若在生產運行此離線 transform，會清走 generation／applied／lease 全部 bookkeeping → 進行中的重建 renew 失敗中止、dirty 狀態遺失。部署路徑不用它，但屬 operator 手上既有流程的隱患。
- 建議：改成 `DELETE ... WHERE summary_key NOT IN (<7 keys>)`，與 `cloudflare.js:1021` 一致。

### LOW-3 — interval 沒有下限，`AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS = "1"` 會被接受

- 位置：`workers/cloudflare-native.js:145-148`（`positiveIntOr` 只要求 > 0）
- 誤設小正數等同回到 per-batch 重建。建議加下限（例如 `Math.max(60, ...)`）。

### LOW-4 — 文件數字過時

- `docs/ops/operator-deploy-checklist.md:61`：寫「expect 27 files / 388 tests」，實測 **390**（§2.1）。
- `docs/ops/operator-deploy-checklist.md:75`：control key 清單漏 `rebuild_last_mutation_at`（實作共 7 個 key，`cloudflare.js:53-57`）。
- `tests/.../cloudflare-aggregate-rebuild-guard.test.js:59`: 測試 helper 仍引用不存在的 key `rebuild_lease_token`（死碼，無害）。

### LOW-5 — §3「same checks the workflow runs」不完全準確

- `docs/ops/operator-deploy-checklist.md:55-62`：deploy workflow（`.github/workflows/deploy-worker.yml:56-73`）不跑 bundle check 與 `npm run test:workers`；那兩者在 `ci.yml:91,94`。措辭改為「與 CI 相同的檢查」較準確。

---

## 4. 殘餘風險（部署後仍存在，需接受或監控）

1. **HIGH-1 觸發條件未消除前**：任何 >6 小時不中斷的寫入期都會進入 per-batch 重建狀態。部署後必須有 D1 writes/day 監控（checklist §5 已有 `d1 insights` 步驟，但要明確加上閾值告警）。
2. 重建不是單一 transaction：中途 throw 會留下部分空表，靠下一次重建收斂（最多 5-10 分鐘）。屬既有設計。
3. 首次部署後第一個 mutation 可能觸發一次 fallback 重建（`lastAt=0` 時 interval 被視為已滿足）— 一次性、lease 保護、成本 ~$0.58。
4. binding 異常時重建靜默停擺（MED-2），且 queue 會被 retry 至 DLQ。
5. `rebuild_last_attempt_at` 的節流依賴 `updated_at` 同時存放 lease token，令 `catalog_summary.updated_at` 語義不一致（同一欄有時是 timestamp、有時是 UUID）。功能無礙，但任何未來的分析／維運查詢若把 `updated_at` 當時間用會出錯。
6. Codex 8 輪評審已綠燈，卻全部漏掉 HIGH-1；其中一輪更把錯誤行為寫成測試（`cloudflare-aggregate-rebuild-guard.test.js:179-188`「lets the staleness bound win over a just-stamped attempt」）。修 HIGH-1 時要一併改這個測試，否則會被既有斷言擋住。

---

## 5. 部署就緒裁決

### NOT-SAFE-TO-DEPLOY（as-shipped defaults）

理由：修復的主機制（queue 不再 per-batch 重建、quiet window、generation 語義、lease/fencing）**已正確實作並經真 SQLite + 真代碼實證**，正常情境（<6 小時連續寫入）成本由 ~$4,500/import 降到 ~$0.58，全部指定測試通過。但 `max-staleness` 分支繞過所有節流，令一段 >6 小時的連續寫入即可把重建頻率推回「每個 queue batch 一次」，實測 $631–$1,262/日（事故約 $1,206/日），而唯一給 operator 的成本模型（`aggregate-rebuild-cost-guard.md:91-92`）把同一情境寫成 $2.30/日（低估約 270 倍）。

**解除條件（任一）**
1. 套用 HIGH-1 的首選修正（`rebuild_dirty_since` 於每次重建後無條件歸零）並重跑 §2 全部驗證；或
2. operator 先把 `AGGREGATE_REBUILD_MAX_STALENESS_SECONDS` 設為實際上不會到達的值（例如 `"604800"`），並在 checklist 明示該 value 的退化行為；或
3. operator 明確接受「任何 >6 小時不中斷寫入期會出現 per-batch 重建的帳單」風險，並加設 D1 writes/day 告警。

**同時建議（非阻斷但成本極低）**：MED-4 的交換解鎖順序、MED-3 的 gate 命令修正、MED-1 的 gate 補強（可另開 PR）。

---

## 6. 附錄：驗證環境與手法

- Node v26.5.1、vitest 2.x、wrangler 4.120.0（devDependency）；`node:sqlite` 用於模擬。
- Python：`/usr/bin/python3` = 3.9.6、`.venv/bin/python` = 3.14.7（跑 pytest 用後者、加 `env -u PYTHONPATH`）；跑含中文的 `verify-rebuild-sql.py` 用 `/usr/bin/python3` + `LANG=en_US.UTF-8`。
- 模擬 harness 全文：`/tmp/immi-review-sim.mjs`（注入模擬時鐘、`node:sqlite` 包成 D1 adapter、重播 `work/rebuild-statements.json` 的生產 SQL）。此檔在 repo 之外，屬臨時驗證工具。
- 額外產物：`/tmp/operator-main.toml`（placeholder 換成假 UUID 的 main config 副本，用於重現 MED-3）；`/tmp/immi-sim.out`（模擬完整輸出）。
- 未驗證項（誠實聲明）：生產 D1 的實際行數分佈（584k 行／重建）、實際 `meta.changes` 在生產 D1 上對 conditional upsert 的回報（本機只用真 SQLite 的 changes() 驗證）、以及 operator secret 內實際存放的 config 內容（我無權讀取）。
