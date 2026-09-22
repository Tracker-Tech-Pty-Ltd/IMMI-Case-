# 第三輪獨立驗證 — commit 11393fb（失敗風暴 / 下限 / TOCTOU）

日期：2026-09-11（Australia/Melbourne）
評審員：第三輪獨立 subagent（唯讀，無 push / 無 deploy / 無雲端寫入）
方法：重用前一位評審員已存在嘅 `/tmp/immi-verify2/` harness（build.mjs + probe.mjs，真實 handler + 真實 SQLite + 模擬時鐘，15 情境）＋ repo 測試。**未寫任何新 harness**。

---

## 一、修正內容（commit 11393fb）

| # | 機制 | 改動位置 |
|---|---|---|
| 1 | 失敗風暴 → attempt-start disarm | `workers/storage/cloudflare.js:1024-1027`（rebuildAggregates 第一步寫 `rebuild_dirty_since=0`）；`:1247` interval 成為 max-staleness 嘅硬 backstop |
| 2 | 下限 | `workers/storage/cloudflare.js:1218-1220`（quiet>=30、maxStaleness>=300）；`workers/cloudflare-native.js`（`positiveIntOr` + `MIN_QUIET_FLOOR_SECONDS=30`、`MIN_MAX_STALENESS_FLOOR_SECONDS=300`）；`scripts/check_cloudflare_native_target.py` 加 floor + 只收 `\d+`（拒 `21_600`） |
| 3 | TOCTOU → post-lease re-check | `workers/cloudflare-native.js:182,200`（`rebuildUnderLease` 取得 lease 後呼叫 `aggregatesStillPending()`，`pending<=applied` 則 skip）；`workers/storage/cloudflare.js:1208` 新增窄讀方法 |

---

## 二、逐項驗證結果（實跑原文）

### A. 前評審員 harness（15 情境）— build + probe

```
$ cd /tmp/immi-verify2 && node build.mjs    # BUILD_EXIT=0 → built worker.mjs
$ node probe.mjs
```

probe.mjs 內建斷言（line 135、151：`assert.equal(f.stats.commits.length,1)`；line 93 斷言失敗訊息 `/review2 deterministic/`），probe 以 exit 0 完成並輸出全部 15 行 ⇒ **15/15 全過**。

關鍵情境實測（節錄原文）：

| 情境 | 期望 | 實測 | 判定 |
|---|---|---|---|
| `continuous-2s-cron-first` | 24h = 3 次重建 | `"attempts":3,"completed":3`，`firstStarts`=[21600,43232,64864]（cron/queue×2） | ✅ |
| `continuous-2s-queue-first` | 3 | `"attempts":3,"completed":3` | ✅ |
| `continuous-2s-no-cron` | 3 | `"attempts":3,"completed":3` | ✅ |
| `continuous-60s-cron-offset-7` | 3 | `"attempts":3,"completed":3` | ✅ |
| `four-hour-import-then-quiet` | 1（quiet 收斂）| `"attempts":1,"completed":1` | ✅ |
| `failure-after-6h-defaults-2s` | 3 次嘗試（非 2025/1080）| `"attempts":3,"completed":0,"failedChunks":3,"retries":3` | ✅ |
| `failure-after-6h-defaults-30s` | 3 | `"attempts":3,"completed":0,"failedChunks":3` | ✅ |
| `operator-max-staleness-1s` | 6/小時（非 106）| `"attempts":6,"completed":6,"minStartGap":600`（已 floor 到 300s） | ✅ |
| `operator-max-staleness-underscore`（`21_600`）| 6/小時、唔會被讀成 21 | `"attempts":6,"completed":6,"minStartGap":600` | ✅ |
| `D1-only-real-scheduled` | cron 路徑可跑 | `"clean":"clean","dirty":"dirty","completed":1` | ✅ |
| `TOCTOU-delayed-queue-decision-after-cron-success` | 1 次重建 | `commits=1`（內建斷言過），`firstStarts`=[winner-cron] | ✅ |
| `TOCTOU-20-delayed-queue-decisions` | 1 次重建（非 21）| `"completed":1`，`firstStarts`=[winner-cron]，斷言 `commits===1` 過；`attempts=21` = 21 次 *lease claim*（attempt 戳記），但只有 1 次真重建 | ✅ |

> 註：`attempts` 定義為「寫入 `rebuild_last_attempt_at` 嘅語句數」（probe.mjs:34），即 lease claim 次數；`completed` = 真正 commit 嘅重建數（probe.mjs:69）。TOCTOU-20 顯示 20 次 stale 決策各自 claim 到 lease 後被 re-check 攔下，冇做重建、冇 partial write（`failedChunks:0`）。

### B. repo 測試

```
$ npm run test:workers
      Tests  396 passed (396)

$ env -u PYTHONPATH .venv/bin/python -m pytest tests/test_cloudflare_native_target.py -q
============================== 7 passed in 0.88s ==============================

$ node work/capture-statements.mjs && LANG=en_US.UTF-8 /usr/bin/python3 work/verify-rebuild-sql.py
  ok   the attempt-start disarm is the rebuild's first statement
  ...（共 28 行 ok）
  "failures": []
（exit 0）

$ node scripts/check_cloudflare_native_bundle.mjs
Cloudflare-native bundle closure passed (345838 bytes)
```

全部與 commit 聲稱一致（396/396、28/28、7/7、bundle 閉合）。

### C. 反證嘗試（確認修正真喺 code path 上，唔係只喺測試）

1. **`aggregatesStillPending` 真被呼叫、且失敗時唔會默認 true**：
   - `grep -rn aggregatesStillPending workers/` 只喺 `cloudflare-native.js:200`（rebuildUnderLease 內）被 **呼叫**，別無他途。
   - `cloudflare.js:1208` 定義：`pending = state.get("rebuild_generation") > state.get("rebuild_applied_generation")`。若讀唔到 row → 兩者皆 0 → `0>0 = false` → **skip**（保守方向，唔會誤重建）。
   - 呼叫點（`:195-201`）先 `claimRebuildLease`，`if(!recheck.pending) return {skipped:"not_due_under_lease"}`，之後才 `rebuildAggregates`。
   - 反證：`cloudflare-native-scheduled-rebuild.test.js` 新測試「skips the rebuild when another invocation already applied the work」斷言 `rebuildAggregates` **未被呼叫**；若移除 `:197-201` 呢段，該斷言即 fail → 修正確被打樁。
2. **interval 真喺 bound 之前/一齊判斷**：`cloudflare.js:1247` 為 `if (maxStaleness>0 && staleness>=maxStaleness && elapsedSeconds>=interval)`，`1251` 才係純 debounce，`1257` 才 quiet。即三條路徑（max-staleness / debounce / quiet）全部先過 interval ⇒ interval 係唯一 backstop。
   - 反證：guard test:496「keeps the interval in front of the staleness bound」——`attemptAt=now-10` 期望 `due:false, reason:"debounced"`；若回復舊寫法（interval 只喺 debounce 分支），該斷言 fail。
3. **attempt-start disarm 真喺第一步**：`verify-rebuild-sql.py` 第 1 個 check =「the attempt-start disarm is the rebuild's first statement」；guard test:482「disarms the staleness clock when an attempt starts, so a failing rebuild cannot retry per batch」。若刪 `:1024-1027`，兩者皆 fail。
4. **下限真被 enforce**：`cloudflare.js:1218-1220` 數字低於 floor 會被當 0（等同停用該旋鈕，保守）；guard test:507「ignores knob values below the floors instead of rebuilding per minute」；gate `re.fullmatch(r"\d+", text)` 令 Python 與 Worker 解析一致。

---

## 三、新發現

1. **[LOW / 純註釋]** `workers/cloudflare-native.js:190-201`：`rebuildUnderLease` 內新加嘅「Re-validate with the lease held…」註釋**重複咗一整段**（同一段意思寫咗兩次，第二段才補上「Only the pending question is asked」）。無功能影響，建議清一次。
2. **[INFO / 既有設計]** `quiet-windows-batch-every-600s`：每 600s 一批寫 → 144 次重建/日（`documentedRebuildOnlyCostUSD:84.096`）。呢個係 quiet-window 設計本身嘅上限，非本 commit 引入；但若真實流量改成每 10 分鐘一批，成本曲線會偏高（已由 interval 300s 封頂，最少 5 分鐘一次）。屬 operator 需知嘅成本特性，非缺陷。
3. **[INFO / 部署前提]** `no-cron-30min-import-then-quiet`：`attempts:0`——冇 cron 時，匯入完結後冇 mutation 觸發，analytics 會一直 stale（成本反而係 0）。deploy gate 強制 `triggers.crons` 含 `*/5 * * * *`，故正式部署下唔會發生；但屬「若有人剝掉 cron 就靜默 stale」嘅殘餘風險。
4. **[INFO]** `continuous-2s-48h-steady-day`：第二個 24h 窗完成 4 次（`completedBy24hWindow:[3,4]`），較 3 稍多；仍受 interval 封頂，非風暴。

**未有發現任何新嘅成本風暴、partial-write 洩漏或 guard bypass。**

---

## 四、殘餘風險

- 上述四項皆為 LOW/INFO，均非阻斷部署級別。
- harness 為模擬時鐘 + 真實 SQLite；未在真實 D1 + 真實 cron 下量測（本次限制：禁 deploy / 禁雲端寫入）。故雲端計費曲線仍屬「由真實 handler 邏輯推導」，非雲端實測。
- 未覆蓋 Cloudflare Queue 實際 retry 語意（backoff 由平台控制）；但守衛對 max(interval) 敏感，已由 harness 以每 2s/30s/60s 重放覆蓋。

---

## 五、裁決

三個修正均**真實有效且被測試打樁**：失敗風暴 3 次/日（非 2025/1080）、operator 下限 6/小時（非 106）、TOCTOU 1 次重建（非 21）。前評審員 harness 15/15、repo 396/396 + 7/7 + 28/28 + bundle 全過，與 commit 聲稱一致。新發現只有一段重複註釋（LOW）及既有設計/部署前提備註。

**VERDICT: SAFE-WITH-CAVEATS** — caveat：(a) `cloudflare-native.js:190-201` 重複註釋待清理；(b) 高頻批次（~10 分鐘一批）流量下重建次數約 144/日、成本約 $84/日，屬既有 quiet-window 特性，部署前宜確認實際寫入節奏；(c) 正式部署**必須**保留 `triggers.crons` 含 `*/5 * * * *`，否則匯入後 analytics 會靜默 stale（成本為 0）；(d) 尚未在真實 D1 雲端實測，成本曲線由真實 handler 邏輯推導。
