# IMMI-Case Worktree Closeout State

## 2026-10-26 本機整合更新

本次使用者已授權完成未提交工作、審查、測試及合併。最新盤點、衝突處理與驗證請讀 [工作樹整合紀錄](../docs/reviews/2026-10-26-worktree-integration.md)（由儲存庫根目錄為 `docs/reviews/2026-10-26-worktree-integration.md`）。六個舊工作樹已修復成本機路徑；下列 2026-08-28 的進度、測試數字及部署阻塞均為歷史紀錄，不代表目前線上狀態。本次不部署或推送。

Updated: 2026-08-28 Australia/Melbourne

## 2026-08-28 52 份計畫實作 — 46/52 已合併 main

基準 `42826a3` → 現在。全部數字為本機實測，非引用。

### 閘門現況（全綠）
| 閘門 | 基準 | 現在 |
|---|---|---|
| Worker 測試 | 345 / 25 檔 | **511 / 41 檔** |
| 前端測試 | 490 / 55 檔 | **706 / 82 檔** |
| Python 測試 | 1210 passed | **1381 passed**（3 個環境性 pyexpat） |
| 前端型別閘門 | `tsc --noEmit` 載入 **0** 檔 | `tsc -b --noEmit` 170 檔，CI 有非空操作斷言 |
| CI 前端 build | 不存在 | 每次 PR |
| bundle closure | 乾淨安裝下 `ERR_MODULE_NOT_FOUND` | 通過（351,244 bytes） |
| ruff 範圍 | 排除 `tests/`（藏 43 違規） | 含 `tests/`，全過 |
| 覆蓋率門檻 | 宣告 80%，Vitest 4 不認得該欄位 | 28/30/24/29，實地負向測試過 |
| 生產依賴漏洞 | 8（7 high） | **0** |

### 剩餘 6 個計畫
`013 024 046`（Wave 8 執行中）· `012 014`（等 013，Worker 資料路徑硬性串行）· `042`（等 046 讓出 Makefile）

### ⚠️ 唯一的生產阻塞（需要 operator 操作）
LLM Council 在生產環境每個 POST 都回 429。程式碼已修好在 main（計畫 004），
但 **`IMMI_NATIVE_MAIN_WRANGLER_TOML_B64` 這個 GitHub secret 必須先加入
`[[ratelimits]]` 區塊**，否則部署會被計畫 004 新增的閘門擋下（刻意設計）。

```toml
[[ratelimits]]
name = "RL_COUNCIL_TURN"
namespace_id = "1001"
simple = { limit = 30, period = 60 }
```

驗證：`.venv/bin/python scripts/check_cloudflare_native_target.py --main-config <改好的.toml> --pipeline-config <pipeline.toml>`
→ 不得有任何錯誤行提到 `RL_COUNCIL_TURN`。
部署後：第一個 `POST /api/v1/llm-council/sessions` 帶有效 JWT 必須回 **200**（非 429、非 503）。
若仍 429 = 私有 config 沒更新成功，**不要**改回 fail-open（那會拆掉付費額度的唯一防線）。

### 次要待決（本機 only，CI 不受影響）
`npm run lint` 有 1 個 error，來自 `remember` plugin 的 `frontend/.remember/tmp/last-ndc.ts`
（`.ts` = timestamp 不是 TypeScript）。修法是在 `frontend/eslint.config.js` 加 ignore，
但 config-protection hook 擋下了——需 operator 決定是否放行。

### 過程中發現並修復的額外缺陷（不在原 52 計畫內）
1. `_rpc_executor` 是模組層級全域，被所有 Flask app 實例共用 → `/api/v1/stats` 間歇性回空。改為 per-app。
2. **計畫自己的 drift check 從來不會失敗**：`git diff -- $SCOPE` 未加引號，多行 pathspec 塌成一個無效值 → 對每條路徑都靜默回空。19 份計畫已修為 bash 陣列。
3. `esbuild` 未在任何 manifest 宣告，靠 vitest 2 間接帶入；037 升到 vitest 4 後消失 → CI 的 bundle 閘門在乾淨安裝下必掛。已宣告並釘版。
4. `$(wildcard $(VENV_PYTHON))` 在含空白路徑下切成兩個詞，venv fallback 從未生效。改用 `test -x`。
5. `council-prompt-parity.test.js` 洩漏全域 fetch spy；vitest 4 改變了 spy 重用語意 → 跨測試污染。

### 教訓（已寫入 memory）
- `git stash` 掃整個工作樹，多 agent 共用 checkout 時會吃掉別人的未提交編輯
- 共用 checkout 裡 `git switch` 會讓所有人的後續提交落到該分支
- **合併 lockfile 變更後必須 `npm ci`**：陳舊 `node_modules` 讓驗證在與 CI 不同的世界裡進行

## 2026-08-27 `/improve deep` 全倉審計 + 52 份實作計畫 — 審計與計畫階段

基準 commit `42826a3`。全程未改動任何原始碼（僅新增 `plans/`）。

### 驗證基線（本機實測，非引用）
| 閘門 | 指令 | 結果 |
|---|---|---|
| Python 測試 | `make test-py` | 1141 passed / **3 failed** / 7 skipped，coverage 71% |
| 前端測試 | `cd frontend && npx vitest run` | 490 passed / 55 files |
| Worker 測試 | `cd workers && npx vitest run` | 345 passed / 25 files |
| 真實 typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0（169 檔） |
| 假 typecheck（CI 實際跑的） | `npx tsc --noEmit` | exit 0 但**載入 0 檔** |
| Python lint（現行範圍） | `make lint` | All checks passed |
| Python lint（全倉） | `.venv/bin/ruff check .` | **43 errors，全在 `tests/`** |
| 前端依賴 | `npm audit` / `--omit=dev` | 17 項（2 critical）/ **8 項（7 high）** |

3 個 Python 失敗是**環境性**，非程式碼缺陷：Homebrew Python 3.14.7 的 `pyexpat.so` 需要
`_XML_SetAllocTrackerActivationThreshold`，macOS `/usr/lib/libexpat.1.dylib` 沒有該符號 →
`pypdf` import 失敗 → `tests/test_backfill_judge_overrides_from_pdf.py` 整模組載入失敗。Linux CI 不受影響。

### 審計結果
13 類 deep 掃描 + 逐類對抗式驗證（26 agents，3.39M tokens）→ **238 個倖存發現**
（HIGH 144 / MED 69 / LOW 25；effort S 173 / M 54 / L 11），13 個駁回、60 個證據被修正。

四項最高槓桿（皆由 orchestrator 親自機器驗證）：
1. **LLM Council 生產全掛** — `workers/llm-council/cloudflare_handlers.js:40-45` 的 `applyRateLimit`
   在缺 binding 時 fail-closed，而 `wrangler.toml` 從未宣告 `RL_COUNCIL_TURN`。
   退役的 `handlers.js:71` 原本是 fail-open；cloudflare-native 切換時翻轉了預設卻沒補 binding。
2. **前端無編譯閘門** — `ci.yml:64` 跑 `npx tsc --noEmit`，而 `tsconfig.json` 是 `files:[]` + 純
   project references，載入 0 檔；CI 三個 job 也從不 build 前端。
3. **App 主動遷離已決定設計方向** — `use-theme-preset.ts:464-481` 每個分支都回 `"claude"`，
   並把已存的 `"parchment"`（＝Legal Codex 調色盤 `#1b2838`/`#5c4306`/`#f5f4f1`）改寫掉。
4. **Worker 零邊緣快取** — `grep -rn 'caches\.' workers` = 0 次；proxy.js 刪除後 Cache API 全失。

### 計畫
`plans/001`–`plans/052`，238 個發現全部分派、零重複零遺漏。按**檔案領地**切分以支援並行實作。
硬性序列：001 → 002 → 003（共用 `Makefile` + `ci.yml`）。
006 含蓄意破壞性變更（部署後 operator 端點全 403 直到授權）。

### 待辦
codex `gpt-5.6-sol` 審查計畫 → 依審查修訂 → commit → Sonnet 團隊實作 → codex 覆審 → opus 精修（≤3 並行）→ 驗證 → commit。

## 2026-08-25 Repo Completion Pass + VPS Crawler 修復與首輪 2026 回填 — HANDOFF

### A. Repo completion pass（已全部 push 至 origin/main，CI 綠）
- 8 個主題 commit + 3 個 CI fix-forward：`6cf7f7a`(ci 恢復完整套件+ruff step) `65abc6a`(LLM Council 信心分數原生計算) `a1222c1`(mutations-disabled 前端降級) `1b486a5`(Slice H 行動端) `b5a8f00`(docs 對齊 cloudflare-native) `4ec9c73`(ruff 釘 0.15.18) `a8db5d2`(CI 排除 node 依賴測試) `f0a4517`(guard 註解位置)
- CI run 32614730554 全綠：test-python **1134 passed**（原本只跑 11 檔白名單）、fe 490、worker 345
- 驗證基線：本機 make test-py = 1141/5(環境性)/5；fe 490/55；workers 345/25。詳見 memory `immi-local-test-baseline`
- 未決：ruff 0.16 升級（394 findings，138 可 --fix）延至 ~2026-09-23；operator 項（flags、舊 immi-case Worker 刪除、Supabase 除役、租戶隔離測試矩陣）仍封鎖

### B. VPS AustLII crawler（host `hstgr` = Hostinger srv1822588，UTC）
- 路徑 `/opt/austlii-crawler/`（crawler.py + pipeline.sh + venv），以 `austlii-crawler`(UID 995) 執行，流量經 wg1-home → 住宅 IP 175.37.35.150
- Cron `0 14 * * 1` UTC（= 週二 00:00 AEST），只爬當年（2026）四法院：ARTA/FCA/FedCFamC2G/HCA，POST /api/v1/cases 帶 CRAWLER_WRITE_TOKEN，Worker 按 case_id 冪等 upsert
- Log：`/var/log/austlii-crawl.log`（unbuffered，每 25 筆 progress 心跳）
- **2026-08-24 套用的補丁**（備份 `*.bak-20260824` 同目錄）：
  1. 挑戰頁等待上限 120s（原無界 while 迴圈曾致 ~3h 無聲卡死）— listing 層跳過法院、case 層記 failed 續跑
  2. pipeline 用 `python -u`（stdout 原為全緩衝，log 假死）
  3. POST timeout 30s→90s（大 payload 失敗率 24%→~2%）
  4. pipeline.sh 加 flock 防重入（已實戰擋下 08-24 14:00 UTC cron 重疊）
- 已知教訓：`pgrep -f`/`pkill -f` 會匹配自身 ssh cmdline——診斷用 `ps -u austlii-crawler`，kill 用精確 PID

### C. 首輪 2026 回填現況（2026-08-25 05:56 AEST 快照）
- Run #3 進行中（08-24 09:02 UTC 起）：posted=2,325 / skipped=3 / failed=49（~2%）
- ARTA 1,748 筆完成；FCA（列表 1,188）進行中；之後 FedCFamC2G、HCA
- 生產：**151,295 total / 2026 年 2,478 筆**（起點 220）。完成時 log 會有 `完成：posted=…` 行
- 失敗案例（~49，多為挑戰頁卡 120s）由下週 cron 自動重試補上

### D. 資料品質審計結果（2026-08-25，600 筆抽樣 + 5 筆 R2 內文深查）
- ✅ 無重複 citation、無挑戰頁污染、全文 100% 入 R2（checksum 驗證）、內文 17K-125K chars 含真實判決
- ⚠️ 新案結構化欄位全空：date 95% 空（**日期在 title 內可 regex 補**）、judges/outcome/applicant/visa 全空 → 新案在 Analytics/法官檔案/篩選器隱形，需獨立抽取 pass
- ⚠️ 次要：text_snippet 未生成；全文頭尾帶 AustLII 導覽雜訊（inner_text(body) 全抓）
- detail API 的 full_text 在回應**頂層**，不在 case 物件內（勿誤判為空）

### E. TODO（優先序）
- P1-1 確認本輪爬完（log `完成：` 行；各法院 listing 數 vs DB 數對帳）
- P1-2 date 補填：從 title regex 抽日期——(a) crawler.py 加入 payload（一次改，之後每週自動）(b) 對已入庫 ~2,300 筆跑 backfill
- P1-3 對 2026 新案跑結構化欄位抽取 pass（機制待定：本地腳本直寫 vs 遷移中的 extraction pipeline——後者被 PIPELINE_ENABLED=false 閘住）
- P2-4 crawler 加「跳過已知 citation」：起跑先拉現有清單，週跑從 ~10h+ 縮到 <1h、大減挑戰頁觸發
- P2-5 text_snippet 生成；P2-6 全文去 AustLII 頁面雜訊；P2-7 **把 crawler.py/pipeline.sh 納入版控**（現只存在 VPS + .bak）
- P3 ruff 0.16（~09-23）、前端死碼（api-cases.ts、saved-searches.test.ts 永不被 vitest glob 收集）、E2E council skip 測試決策、operator 封鎖項

### F. Watch list
1. 本輪爬完與否（今天內）＋最終 failed 數
2. 下次無人值守 cron：**2026-08-31 14:00 UTC（= 09-01 週二 00:00 AEST）**——看 log 心跳與計數增量
3. wg1-home 隧道：住宅線路斷線/換 IP 會讓爬蟲遇 challenge/封鎖（`wg show wg1-home latest-handshakes`）
4. stats API 偶發空回應（08-24 ~18:42 AEST 出現 2 次）——再現則查 Worker/cache
5. crawl log 的 failed 率 >5% 需調查
6. D1 容量：2026 全年將 +4-5K 案（見 D1 Capacity Migration 章節）
7. Analytics 圖表缺 2026 新案 = 預期行為（抽取未跑），非 bug
8. 文件測試計數（README/CLAUDE/AGENTS）會隨新測試漂移，下次 doc pass 重算

## 2026-08-21 D1 Capacity Migration + Supabase Status — COMPLETE ✓

### Blocker #2 resolved (in-place external-content FTS5 migration)
- `immi-catalog` D1: **9.18 GB → 5.53 GB** (−40%), under the 8 GiB gate.
- Method: in-place migration (not full re-import). VACUUM and single-REBUILD are
  both unsupported in D1 (VACUUM → "cannot VACUUM from within a transaction";
  REBUILD of 150K chunks → "CPU time limit exceeded / reset"), so the migration
  used batched INSERT (5K rows/batch) + FTS5 `ALTER TABLE ... RENAME`.
- Search verified: `MATCH 'migration'` = 146,548 (identical to pre-migration).
- Triggers rebuilt with the FTS5 `'delete'` command.

### Supabase dependency status
- Production route `immi.trackit.today` → `immi-case-standalone`
  (`workers/cloudflare-native.js`, D1-native; deployed 2026-08-11 v6583ae10).
- **NOT fully decommissioned yet**: legacy `immi-case` worker (Supabase/Hyperdrive,
  deployed 2026-05-17) is still deployed; legacy code `workers/proxy.js` +
  `workers/db/getSqlAsUser.js` still import `postgres` (~344 Supabase refs) in the repo.

## 2026-08-11 Codex Review + Fixes — COMPLETE ✓

### Codex review verdict: BLOCK (not cutover-ready)
- "現在適合建立 preview/canary，不適合 production cutover"
- 346K tokens, deep codebase + live-runtime review

### CRITICAL findings + fixes applied
| # | Finding | Status |
|---|---------|--------|
| 1 | SPA serving missing (`/`,`/app/*` → 503 after cutover; no ASSETS binding) | FIXED: `[assets]` + ASSETS fallback + SPA build step |
| 2 | Catalog D1 at 9.17 GB (exceeds 8 GiB gate, ~8-15% headroom vs 10 GB cap) | DONE: in-place external-content FTS5 migration (9.18 GB → 5.53 GB) |
| 3 | No working login (Telegram deferred, bootstrap not UUID, no login route) | FIXED: bootstrap login + UUID admin |
| 4 | Unprotected paid AI endpoints (run/health?live=true fail-open) | FIXED: auth-gated + rate-limit fail-closed |
| 5 | Non-reproducible deploy + CI fails (placeholder test) | FIXED: placeholders restored + tests updated |

### HIGH findings + fixes
| Finding | Status |
|---------|--------|
| requireAuth accepts refresh tokens | FIXED (token-type check) |
| Vectorize 149,017 (test vector) | FIXED (index recreated clean, re-embedding) |
| No metadata indexes | FIXED (verified existing + added case_nature_idx) |
| visa_type/case_nature not in semantic filter | NOT-A-BLOCKER: structured filters via D1 WHERE (normal filter is better); Vectorize not needed |
| Cutover workflow circular dependency | DEFERRED (activation workflow redesign) |

### Fixes implemented
- `workers/auth/request_auth.js`: requireAuth rejects `type:refresh` tokens (401 refresh_token_used_as_access)
- `workers/auth/cloudflare_handlers.js`: added handleBootstrapLogin (BOOTSTRAP_ADMIN_SECRET + BOOTSTRAP_ADMIN_USER_ID env)
- `workers/cloudflare-native.js`: wired POST /api/v1/auth/bootstrap
- `workers/llm-council/cloudflare_handlers.js`: auth-gated handleLegacyRun + handleHealth live probe; applyRateLimit fails closed
- Account D1: bootstrap-admin/tenant replaced with UUIDs (admin 7e6d09e9-..., tenant 4d11f240-...)
- wrangler.toml + pipeline: real IDs reverted to placeholders (deploy uses temp configs from env)
- tests: cloudflare-council-handlers env + RL_COUNCIL_TURN mock; test_effective_native_ci postgres assertion fixed
- D1: added cases_case_nature_idx

### Operational config (real IDs, temp only, NOT committed)
- `/tmp/immi-ops-wrangler.toml` — for wrangler ops against live resources

### IN PROGRESS
- Vectorize re-embedding (index recreated clean, ~1.6K/149K done)

### DEFERRED with rationale (production cutover blockers)
1. **SPA serving (CRITICAL #1)**: standalone worker only handles API; `/`, `/app/*` return 503 without Workers Static Assets / ASSETS binding. Deploy currently points whole custom domain at the worker. MUST add static assets + SPA fallback before cutover.
2. ~~**Catalog D1 capacity (CRITICAL #2)**~~ **RESOLVED (2026-08-21)**: migrated in-place from contentful → external-content FTS5 (9.18 GB → 5.53 GB, −40%). VACUUM + single-REBUILD unsupported in D1; completed via batched INSERT + FTS5 RENAME.
3. **Cutover workflow circular dependency (HIGH)**: deploy workflow requires activation packet proving blue/green switch + shadow + rollback rehearsal + soak BEFORE deploy, but shadow needs a deployed version. NEEDS activation workflow redesign.
4. ~~Vectorize metadata filters (HIGH search)~~ **DOWNGRADED — not a blocker**: visa_type/case_nature are structured metadata columns, not semantic content. Filtering them is best done via D1 WHERE (normal filter), not Vectorize — lexical/hybrid paths already cover this. Re-embedding 149K vectors to add these keys is unnecessary.
5. **Reproducible deploy**: checked-in wrangler.toml restored to placeholders (fail-closed safety). Deploy uses operator-provided temp configs (deploy-worker.yml generates into RUNNER_TEMP). The standalone deploy was from a dirty tree — future deploys must be from a clean Git SHA.

## 2026-08-12 IMMI Data Import — COMPLETE ✓

### All layers imported and verified
| Layer | Status | Details |
|-------|--------|---------|
| R2 | ✅ | 149,016 cases + 103 judges (structure matches content_key) |
| Catalog D1 | ✅ | 149,016 cases, 150,030 chunks, 150,030 FTS rows, all relations + aggregates |
| Vectorize | ✅ | 149,016 vectors, all semantic_ready = 1 |
| Ops D1 | ✅ | import_run `import-20260812-035309` status=completed, reconciliation cases=149016/149016, chunks=150030/150030, all counts 0 |

### Verified working
- Lexical search: FTS5 bm25 returns real cases from D1
- Semantic search: qwen3-embedding 0.6b + Vectorize query returns relevant cases (score 0.71)
- Ops checkpoint recorded

### Remaining (production cutover decisions)
- Route: `immi.trackit.today` still served by legacy `immi-case` worker (Hyperdrive)
- Standalone worker `immi-case-standalone` v6583ae10 deployed, all bindings live
- Cutover: point domain to standalone worker (requires operator approval)
- Legacy decommission: after cutover stability

## 2026-08-11 IMMI Data Import — Vectorize IN PROGRESS

### Import status
1. **R2 upload: DONE** ✓ (cases/ 149,016 + judges/ 103, structure matches content_key)
2. **Catalog D1: DONE** ✓
   - cases: 149,016 | chunks: 150,030 | FTS: 150,030 (auto)
   - judges: 15,335 | concepts: 19,925 | visas: 277
   - case_judges/concepts/visas + all aggregates ✓
3. **Vectorize: IN PROGRESS** (~1,600/149,016 at 6 min)
   - Method: Workers AI embed (@cf/qwen/qwen3-embedding-0.6b, 1024d) via REST + Vectorize upsert via REST
   - 8 parallel workers, checkpointed (/tmp/immi-embed-ckpt-w*.json)
   - Verified: embed + upsert + query all work (test: "visa refusal" → 0.618 score)
   - ETA: ~9 hours at current rate
4. **Ops D1 checkpoint: PENDING**

### Key technical notes
- `wrangler d1 execute --file` fails on large content (SQLITE_TOOBIG ~130KB stmts)
- Solved via **parameterized D1 HTTP API** (`/d1/database/{id}/query` with bound params)
- Vectorize upsert format: `{"vectors": [{"id": ..., "values": [...]}]}`
- Workers AI embed: POST `/ai/run/@cf/qwen/qwen3-embedding-0.6b` with `{"text": [...]}`
- Query: POST `/vectorize/v2/indexes/case-vectors/query` with `{"vector": [...], "topK": N}`

## 2026-08-11 IMMI Data Import — IN PROGRESS

### Import sequence (fixed order per plan)
1. **R2 upload: DONE** ✓ (verified via rclone lsf)
   - `cases/`: 149,016 objects
   - `judges/`: 103 objects
   - Structure `cases/<case_id>/source/<sha256>.txt` matches D1 `content_key` ✓
2. **Catalog D1: IN PROGRESS**
   - cases: 149,016 ✓
   - case_judges: 447,417 written ✓
   - case_concepts: 685,876 written ✓
   - case_visas: 273,004 written ✓
   - judges: 61,340 written ✓
   - concepts: 59,775 written ✓
   - visas: 831 written ✓
   - all 17 aggregate tables ✓
   - **case_text_chunks: importing via parameterized API** (150,030 rows, ~16K done)
   - FTS auto-populated via triggers
3. **Vectorize: PENDING** (149,016 expected IDs)
4. **Ops D1 checkpoint: PENDING**

### Import method notes
- `wrangler d1 execute --file` fails on large content (SQLITE_TOOBIG, ~130KB statements)
- Solved via **parameterized D1 HTTP API** (`/d1/database/{id}/query` with bound params)
- Script: `/tmp/import_d1_chunks_api.py` (tmux session immi-chunks-api)
- R2 upload via rclone: `immi-r2` remote → `immi-content` bucket

### Judgment bio dedup
- Removed duplicate "r. skaros" judge bio (same person as "rania skaros")
- Source judge_bios: 104 → 103 (matches R2 judges count)

## 2026-08-10 IMMI Data Migration — Local Snapshot + Import (IN PROGRESS)

### Data source resolution
- Direct Supabase PG connection BLOCKED (DNS for `db.<ref>.supabase.co` fails; pooler rejects tenant; mgmt API key rejected)
- **Complete local dataset found** in `downloaded_cases/`:
  - `cases.db` SQLite: 149,016 cases (30 cols matching export schema) + 103 judge_bios (after dedup) + FTS
  - `case_texts/`: 142,966 full-text files
  - `immigration_cases.csv`: 3.1M rows (149K distinct)
  - `judge_bios.json`, `legislations.json`, `judge_photos/`
- Supabase REST API works (service_role key) but direct PG is unreachable from this network

### Snapshot built (local, NDJSON format matching export script)
- `/tmp/immi-snapshot-local-20260811-184635`
- immigration_cases: 149,016 rows + full-text artifacts
- judge_bios: 103 rows (deduplicated "r. skaros" duplicate)
- schema-manifest.json written

### Transform (IN PROGRESS, tmux session immi-transform)
- Output: `/tmp/immi-transform-out`
- catalog.sqlite target: ~8.5 GB (within 8 GiB gate)
- R2 mirror: 149,119 files (cases + judges)
- Run: `/tmp/run-immi-transform.sh`

### Supabase credentials (transient only)
- Operator provided direct connection string + keys
- Used only via env var for connection attempts; NOT stored in repo
- Direct PG blocked; REST works — may use REST for small identity tables

### Next steps after transform completes
1. Reconcile: `reconcile_immi_transform.py` → missing=0, extra=0, orphan=0, checksum_mismatch=0
2. R2 import: upload 149K files to `immi-content` bucket
3. D1 import: catalog.sqlite → immi-catalog (batched, ≤100 params/statement)
4. Vectorize: generate embeddings via Workers AI → CASE_VECTORS (1024d)
5. Ops checkpoint
6. Re-verify search endpoint serves from D1 (not Hyperdrive legacy)

## 2026-08-10 IMMI Data Discovery — Zero-Supabase Path Confirmed

### Data sources OUTSIDE Supabase (verified via R2 API)
| Bucket | Objects | Content |
|--------|---------|---------|
| `austlii-case-results` (legacy) | 5,000 | 4,944 full case results (case_id, url, citation, court_code, title, full_text) + 56 errors |
| `immi-content` (new) | 0 | Empty — target for native pipeline |
| `immi-case-judge-photos` | 4 | 3 judge photos + sentinel |

### Native harvest pipeline (zero-Supabase data path)
- `workers/austlii-scraper/src/index.ts` — Queue consumer, R2 `head()` idempotency, `/enqueue`, `/scrape`, progress endpoints
- `workers/austlii-scraper/src/discover.ts` — `discoverCourt(court, year)`, `runDiscoveryAndEnqueue`, firecrawl/browser fallbacks
- `workers/austlii-scraper/src/pipeline-db.ts` — D1-native state (Catalog read + Ops metrics), NO PostgreSQL
- Cron: `0 2-5 * * 1` weekly
- Writes: `results/{case_id}.json` → R2 CASE_RESULTS (immi-content), metrics → Ops D1

### IMMI 149K cases location
- Remote Supabase (`urntbuqczarkuoaosjxd`) is the only full copy
- No local copy exists (checked: local PG 5432 = Bsmart data; local Supabase 54322 = empty)
- **Path:** Native pipeline harvest from AustLII → R2 + D1 catalog (resumable, idempotent)

### Cloudflare API credentials
- Operator-provided API token + R2 S3 credentials — used transiently for inventory
- NEVER stored in repo files, NEVER echoed, NEVER committed

## 2026-08-10 Phase A — IMMI Zero-Supabase Source Cleanup: COMPLETE ✓

### Files Changed
- `workers/llm-council/handlers.js` — `requireAuth` import: `getSqlAsUser.js` → `request_auth.js`
- `workers/llm-council/storage.js` — Removed `import postgres`, `import getSqlAsUser`, all legacy `withSql*` helpers, all `withSqlAsUser` fallback blocks. Cloudflare-native only.
- `package.json` — Removed `"postgres": "^3.4.5"` devDependency

### Verified Clean (already Cloudflare-native — NO changes needed)
- `workers/auth/request_auth.js` — Pure JWT, no DB dependency
- `workers/auth/jwt.js` — Web Crypto API HS256, no npm
- `workers/llm-council/session_do.js` — DO SQLite storage, not PostgreSQL

### Gates
| Gate | Result |
|------|--------|
| `check_native_effective_references.py` | PASS — 0 hits |
| `check_cloudflare_native_bundle.mjs` | PASS — 311,556 bytes |
| `check_cloudflare_native_target.py` | PASS |
| `run_immi_separation_preflight.sh` | rc=0, all PASS |

### Remaining Supabase References (legacy rollback — decommission in Phase P6)
- `workers/proxy.js` — Legacy proxy, kept as data-plane rollback
- `workers/db/getSqlAsUser.js` — Legacy PostgreSQL helper, used by proxy.js
- `workers/austlii-scraper/scripts/rollback_run.ts` — Rollback script
- `workers/auth/handlers.js` — Dead-code `env.HYPERDRIVE` guards (behind isCloudflareMode)

### Key Insight (from Codex review)
The codebase already had a full Cloudflare-native storage implementation behind `IMMI_STORAGE_MODE=cloudflare`. Every function in storage.js already had `if (storageMode(env) === "cloudflare")` branches calling `createCloudflareStores(env)`. The migration was removing the `else` branch — not building from scratch.

### Next: Bsmart Supabase audit and migration (separate project)

## 2026-08-10 Phase 2 — Materialize and Validate Configs: PASS ✓

- Config digests (immutable):
  - Main: `d56a72445fe758241f3d3c1b47e961257e9f15a6710b07fc57a82da4205a6ca3`
  - Pipeline: `7ba9bb7614a5edd1046f3c57b1a94bd5247ee920401a2e9b22339ef70d6a083b`
  - Separation: `4c98f0534bff448cac7fe775085f18f3bec34e71100f46cb1b0e8ac0cba39416`
  - Combined: `e137746d41d9a652046e0ad385a1cbdcef539d2e0f7bc86862eb7fe16104dc6d`

### Gates
| Gate | Result |
|------|--------|
| Live D1 IDs match wrangler.toml | PASS (3/3) |
| Live R2 bucket matches | PASS |
| Live Vectorize index matches | PASS (1024d, cosine) |
| `check_native_effective_references.py` | PASS — 0 Supabase/PG/pgvector/Hyperdrive |
| `check_cloudflare_native_bundle.mjs` | PASS — 311,556 bytes |
| `check_cloudflare_native_target.py` | PASS |
| Config digests generated | PASS |

### Next: Phase 3 — Fresh Snapshot Export
- Requires operator read-only Supabase credential (out-of-band)
- Source project: urntbuqczarkuoaosjxd
- Script: scripts/export_immi_ndjson.py

## 2026-08-10 Phase 1 — Operator Provisioning Gate: PASS ✓

- Provisioner: Sisyphus (operator-authorized)
- Branch: `chore/immi-migration-phase1-provisioning`
- All 14 preflight checks PASS; 0 BLOCKED

### Resource Inventory (immutable — written 2026-08-10T15:22Z)

| Resource | Binding | Cloudflare ID |
|----------|---------|---------------|
| D1 Catalog | IMMI_CATALOG_DB | `76006284-53a0-4c7e-8b80-9f2ea11fb1a2` (immi-catalog, OC) |
| D1 Account | IMMI_ACCOUNT_DB | `5361d92c-92ee-4bc5-b1d7-7e9a2a0e5c76` (immi-account, OC) |
| D1 Ops | IMMI_OPS_DB | `e156d8f4-9f5d-410c-8a1a-542c3fb746a7` (immi-ops, OC) |
| R2 Content | IMMI_CONTENT / CASE_RESULTS | `immi-content` (OC, Standard) |
| Vectorize | CASE_VECTORS | `case-vectors` (1024d, cosine) |
| KV | PIPELINE_KV | `8f7eca05011946d7972cf21b6b5e0e1e` |
| Queue | CASE_MUTATION_QUEUE | `immi-case-mutation-queue` (351ea05c...) |
| Queue | PIPELINE_CONTROL_QUEUE | `immi-pipeline-control-queue` (530fe25d...) |
| Queue DLQ | — | `immi-case-mutation-dlq` (ff9d5968...) |
| Queue Pipeline | — | `immi-scrape-queue`, `immi-extract-queue` |
| Queue DLQs | — | `immi-scrape-dlq`, `immi-extract-dlq`, `immi-pipeline-control-dlq` |

### Files Changed
- `wrangler.toml` — D1 IDs, R2 name, Vectorize name, KV namespace (all real)
- `workers/austlii-scraper/wrangler.toml` — D1 IDs, R2 name, KV namespace (all real)
- `.claude/STATE.md` — Phase 1 entry

### Gates
| Gate | Result |
|------|--------|
| `check_cloudflare_native_target.py` | PASS |
| `run_immi_separation_preflight.sh` | 14 PASS, 0 BLOCKED |
| `check_native_effective_references.py` | PASS — 0 Supabase/PG/pgvector/Hyperdrive |

### Provider Credentials
- Cloudflare account: 30ffcfbf8c4103048bc38a5398b7ec99
- Auth: OAuth token, full D1/R2/Vectorize/Queues/KV/Workers write scope
- Secrets not saved to Git or chat

### Next: Phase 2 — Materialize and validate configs
- Verify D1/R2/Vectorize IDs match live inventory
- Generate config SHA-256 digest
- Run native effective-reference scanner
- Gate: Supabase/PostgreSQL/pgvector/Hyperdrive effective references = 0

## 2026-08-10 IMMI Cloudflare Migration — Phase 0 Baseline Audit

- Coordinator: Sisyphus (OpenCode)
- Audit scope: read-only; zero external mutations; no Cloudflare API calls
- Branch: `main` (ahead of origin/main by 12 commits)

### Migration Code Assets: PRESENT
- `workers/cloudflare-native.js` — 232 lines ✓
- `migrations/d1/catalog/0001_catalog.sql` — 269 lines ✓
- `migrations/d1/account/0001_account.sql` — 134 lines ✓
- `migrations/d1/ops/0001_ops.sql` — 112 lines ✓
- `migrations/d1/ops/0002_pipeline_control.sql` — 15 lines ✓
- `config/immi-separation.json` — valid, destination_mode=cloudflare-native ✓
- `wrangler.toml` — 85 lines, structure correct ✓
- 14 check scripts ✓
- 23 Cloudflare-native tests (Python + Vitest) ✓
- `wrangler` 4.120.0, `vitest` ^2.0.0 ✓

### Gate Results
| Gate | Result |
|------|--------|
| `check_native_effective_references.py --json` | PASS — 0 Supabase/PG/pgvector/Hyperdrive |
| `check_cloudflare_native_bundle.mjs` | PASS — 311,556 bytes clean |
| `run_immi_separation_preflight.sh` | 13 PASS, 1 BLOCKED |
| Config manifest | PASS |

### BLOCKER: CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED
All Cloudflare resource bindings are placeholders:
- D1: `IMMI_CATALOG_DB`, `IMMI_ACCOUNT_DB`, `IMMI_OPS_DB` → placeholder UUIDs
- R2: `IMMI_CONTENT` → `immi-content-replace`; `CASE_RESULTS` → not in wrangler.toml
- Vectorize: `CASE_VECTORS` → `case-vectors-replace`
- KV: `PIPELINE_KV` → placeholder
- Queues: `immi-case-mutation-queue`, `immi-pipeline-control-queue`, `immi-case-mutation-dlq` → unprovisioned

No live Cloudflare inventory exists. Phases 2-12 are blocked.

### Next: Phase 1 Operator Provisioning Gate
Requires explicit operator authorization to:
1. Create 3 D1 databases (oc, no read replication)
2. Create R2 `IMMI_CONTENT` (versioning, ≥90d retention)
3. Create Vectorize `CASE_VECTORS` (1024d, cosine, qwen3-embedding-0.6b)
4. Create 3 Queues + DLQ + KV namespace
5. Save real resource IDs; never in Git
6. Produce immutable inventory evidence

### Safety Rules (reaffirmed)
- No Cloudflare paid resource creation without operator authorization
- No deployment, route changes, DNS, or Supabase deletion
- No secrets in source, fixtures, logs, or chat
- All blockers fail closed; no automatic fallback

## Previous Closeout State (2026-06-17)

## Current Objective

- Identify unfinished, unstaged, uncommitted, or worktree-local work.
- Check for conflicts.
- Finish safe incomplete work, validate, and report remaining blockers.

## Initial Findings

- Repo root verified: /Users/d/Developer/Active Projects/IMMI-Case-
- Branch: main, ahead of origin/main by 8 commits at start.
- No .git MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD / REVERT_HEAD files found.
- One worktree listed: this repository path.
- Dirty state includes source changes, new tests, new extraction module, auth refresh-session work, austlii-scraper pipeline additions, and rebuilt React static assets.

## Progress Log

- 2026-06-17: Started read-only inventory and conflict scan.
- 2026-06-17: GitNexus detect_changes(scope=all) reported HIGH risk:
  Worker queue/scheduled/fetch, React auth/app route, pipeline DB, and Flask auth flows affected.
- 2026-06-17: No git merge/rebase/cherry-pick/revert state and no unmerged index entries found.
- 2026-06-17: Fixed local test collection blocker in tests/integration/test_revoke_member.py
  by skipping the live integration test when required Supabase/JWT env vars are missing.
- 2026-06-17: Validation completed:
  git diff --check; scoped ruff on changed Python files; make typecheck;
  make build; make test-fe; make test-py; root Worker Vitest; austlii-scraper typecheck/test.
- 2026-06-17: Follow-up lint debt pass started after closeout commit. `make lint`
  found 87 Ruff issues; `ruff --fix` fixed 58 automatically, leaving 29 manual
  items across duplicate dict keys, unused locals, lambda assignments, and import order.
- 2026-06-17: Follow-up lint debt validation completed:
  `make lint` passed; `git diff --check` passed; `.venv/bin/python -m pytest
  tests/ --ignore=tests/e2e -q` passed with 1082 passed, 5 skipped; GitNexus
  CLI detect-changes reported low risk, 36 files, 28 symbols, 0 affected processes.
- 2026-06-17: `make test-py` using global `python3` failed during collection due
  macOS system-policy loading errors in global psycopg2/Pillow binary wheels; the
  repo `.venv` test run succeeded.
- 2026-06-20: Follow-up fix routes Makefile Python commands through
  `PYTHON ?= .venv/bin/python` when the repo venv exists, preventing PATH drift
  back to a broken global Python. Current Homebrew global Python imports
  psycopg2 and PIL successfully, so the old global wheel failure no longer
  reproduces in this shell. Validation: `make -n` confirmed all Python targets
  use `.venv/bin/python`; `make lint` passed; `make test-py` passed with
  1082 passed, 5 skipped.

## Status

- Local worktree closeout commit is complete.
- Follow-up lint debt pass is complete and committed.
- Makefile Python routing fix is complete.
- Remaining external truth not checked here: remote CI, deploy, production smoke.

## Cloudflare-native migration (2026-08-10)

### Objective

- Replace the IMMI production data runtime with Cloudflare D1, R2, Vectorize,
  Durable Objects and Queues, while keeping public IMMI API contracts stable.
- Remove only Bsmart's case-law API surface; retain Bsmart-owned `law.*` data
  and the independent ImmiAccount integration.

### Current truth

- The deployed IMMI Worker still uses Hyperdrive to the shared Supabase
  project.  The existing worker-first separation manifest has no target
  project and correctly blocks source-project reuse.
- This worktree already contains user-owned, uncommitted worker-first changes.
  Do not revert, stage, or overwrite them.
- A local Cloudflare-native storage foundation may be implemented and tested.
  It must not change the deployed runtime until the later shadow and cutover
  gates pass.

### External gates (operator only)

- Workers Paid approval; Cloudflare D1/R2/Vectorize/Queue creation; secret
  writes; remote deploy; traffic or DNS routing; and any Supabase mutation or
  deletion are all blocked pending explicit operator action.
- APP 8/privacy review is required before production data is placed in the
  `oc` location-hinted resources. `oc` is not an Australia-only guarantee.
- Production cutover remains blocked until capacity, reconciliation, search
  quality, 15-minute rollback rehearsal, and 24-hour shadow gates pass.

### 2026-08-10 progress

- Began the local Cloudflare-native storage boundary, D1 schema and local
  migration harness. No external resource, secret, deployment, route, or data
  mutation has been performed.
- Added the six Cloudflare store boundaries, explicit four-state storage mode,
  R2 SHA-256 pointer protocol, FTS5 candidate search, fixed-model Vectorize
  wrapper, and per-session Council Durable Object idempotency ledger.
- Applied catalog/account/ops migrations to isolated local Wrangler state;
  verified catalog FTS5 and foreign-key rejection. The capacity gate script
  currently passes only the empty schema harness, not the source corpus.
- Local validation: Worker Vitest 235 passed; capacity tests 2 passed; Bsmart
  case-law removal/replay tests 47 passed; frontend registry tests 72 passed;
  frontend i18n key check and production build passed.
- Added the Account D1 identity implementation behind `IMMI_STORAGE_MODE=cloudflare`:
  Telegram profile/first personal-tenant creation, live membership snapshot for
  tenant switch, and conditional refresh-token rotation.  Legacy and shadow
  still use Hyperdrive; `freeze` rejects login/refresh/logout writes.  No
  Cloudflare target binding, secret, deploy, route switch, or remote D1 write
  was performed.
- Expanded the Catalog D1 migration and `CaseStore` import projection with the
  legacy case response fields plus normalised judge/concept mapping rebuild.
  This remains a schema/import foundation; the public case router is not yet
  switched to D1.
- Validation 2026-08-10: fresh local Account D1 migration plus FK/user/tenant/
  refresh-session join passed; fresh Catalog D1 migration passed; full Worker
  Vitest passed (13 files, 248 tests); focused Cloudflare contract/auth tests
  passed (18 tests); `git diff --check` passed. An attempted temporary-directory
  cleanup was blocked by the local destructive-command hook before execution;
  a new isolated `/tmp` path was used instead.
- Added the first Cloudflare-native public case-read slice: list, count,
  detail, compare, lexical/semantic/hybrid search, related and similar routes.
  `cloudflare` mode dispatches that slice before legacy routing and rejects
  any unported `/api/v1/*` route with `cloudflare_route_unavailable`; it never
  silently falls back to Hyperdrive/Flask. The default remains `legacy`, so no
  deployed request changes. This is intentionally not an activation approval:
  analytics/taxonomy/export/static frontend routes still need their own
  Cloudflare-native implementations and contract fixtures.
- Validation refresh 2026-08-10: full Worker Vitest passed (14 files, 255
  tests); new local catalog relation projection query returned the expected
  judge and concept values; catalog capacity gate passed on the tiny local
  fixture (`logical=176128`, `physical=317056`). A first capacity-script call
  used an unsupported `--database` option and a second used Miniflare's
  display ID rather than its hashed SQLite filename; neither ran a check.
- Added the pipeline storage coordinator foundation without altering the
  existing HIGH-risk Postgres pipeline writer. It claims an immutable event,
  then writes R2 source → Catalog D1 → Vectorize → Ops final checkpoint and
  marks completion only at the end; a completed event is a no-write replay.
  The Ops schema now has pipeline-specific checkpoints and extraction audit
  support. The legacy AustLII pipeline remains disabled and still requires a
  separate explicit adapter/cutover wave before this coordinator is invoked.
- Added `workers/cloudflare-native.js`, a separate, standalone entrypoint that
  does not import the legacy proxy/Flask/Postgres client. Its non-deployable
  operator config template declares only target D1/R2/Vectorize/AI/DO bindings
  with invalid placeholders. It fails closed when mode is not `cloudflare` and
  rejects any unported route rather than reaching the shared source.
- Split pure JWT request parsing from the legacy Postgres/RLS client without
  changing that CRITICAL legacy middleware. Auth handlers now use the pure
  module, permitting the standalone entrypoint to authenticate Cloudflare-mode
  requests without loading `postgres`.
- Hardened the read-only source snapshot script: one `pg_dump` now covers all
  listed IMMI tables, and a 0600 short-lived Docker env-file carries the
  password instead of putting it in a process argument. It remains unrun
  pending operator-supplied read-only credential and approved snapshot window.
- Additional validation 2026-08-10: native-entry/auth/proxy focused tests 23
  passed; pipeline coordinator/Cloudflare storage tests 15 passed; AustLII
  `typecheck` passed and its tests passed (12); snapshot script `bash -n` and
  `git diff --check` passed. Separation preflight remains BLOCKED only by the
  intentionally undeclared target and existing source runtime configuration.
- Final local validation refresh: full Worker Vitest passed (16 files, 262
  tests); AustLII worker typecheck and tests passed (12); `bash -n` for the
  snapshot script and `git diff --check` passed. GitNexus detects HIGH overall
  dirty-worktree risk across 20 files / 13 affected symbols, including prior
  user-owned Council, proxy and pipeline work; nothing was staged, committed,
  pushed or deployed in this migration slice.
- Implemented a local-only, repeatable snapshot transform: source NDJSON now
  maps catalogue data, identities, Council metadata/payloads, pipeline audit,
  104 legacy judge bios, relation tables, FTS chunks and import-time aggregate
  tables into three D1 SQLite mirrors and checksum-addressed R2 paths.  A
  separate reconciliation script fails closed on missing/extra/orphan R2/D1
  keys, checksum mismatch, or a changed source-row manifest.  This has only
  passed synthetic fixtures; it has not run against the 149,016-case source
  snapshot or a Cloudflare resource.
- Added standalone D1+R2 `/api/v1/analytics/judge-bio` compatibility.  It
  searches compact judge metadata in Catalog D1 and reads the preserved source
  JSON through the ObjectStore checksum boundary; it never loads Postgres.
- Focused validation after these additions: transform/reconciliation tests 3
  passed; native case/storage Worker tests 18 passed; `git diff --check`
  passed.  Full-suite, real-source capacity/reconciliation, benchmark, shadow,
  staging rollback and production gates remain mandatory.
- Added native unfiltered `/api/v1/stats` from the catalog summary and
  pre-aggregated D1 tables, including visa-family totals. Filtered dashboard
  stats fail closed with a typed 503 until dimension-specific aggregates exist;
  the native path never scans the corpus in a request.
- Validation refresh 2026-08-10: full Worker Vitest passed (18 files, 277
  tests); native entry bundle passed the no-Postgres/Hyperdrive/Flask closure
  check; focused stats/case/storage tests passed (26 tests). Bsmart's local
  case-law removal tests, route tests, i18n key check, production build and
  `git diff --check` remain green. No external mutation was performed.
- Extended the catalog transform with dimension-complete aggregate tables for
  scoped stats, court/nature flow, concept scope/pairs, and judge outcome/year/
  visa summaries. Native analytics now serves filter-options, flow-matrix,
  success-rate, concept effectiveness/cooccurrence/trends, judge leaderboard/
  profile/compare, and native CSV/JSON exports without reading legacy SQL.
- Added an admin-authenticated native pipeline-runs read through Ops D1 and a
  bounded `aggregate_scope` path for filtered dashboard stats. The native
  Worker still fails closed for unported writes, collection mutations and
  guided-search mutation routes; no automatic fallback was added.
- Validation refresh: full Worker Vitest passed (19 files, 282 tests),
  transform aggregate fixture tests passed (3), native bundle closure passed
  with no Postgres/Hyperdrive/Flask/Supabase runtime references, and
  `git diff --check` passed. Real-source import, Vectorize backfill, 50-query
  quality gate, staging shadow/rollback, production cutover and soak remain
  pending.
- Final local verification after the aggregate concept-pair schema correction:
  full Worker Vitest passed (20 files, 284 tests); transform, capacity,
  benchmark and separation-preflight Python tests passed (13); AustLII worker
  typecheck and tests passed (12); the native bundle closure scan passed; and
  `git diff --check` passed. The separation verifier still reports the two
  expected operator gates: the source project ref remains in local runtime
  config and `IMMI_TARGET_PROJECT_REF` is undeclared. No target resource,
  secret, deploy, route switch, data import or destructive Supabase action was
  performed.
- Corrected the native concept-cooccurrence D1 query to match the bounded
  `aggregate_concept_pair` schema after removing its year dimension; reran full
  Worker Vitest (20 files, 284 tests), native bundle closure, and
  `git diff --check`, all passing. GitNexus impact lookup for this newly added
  symbol returned `Target not found` because the index is stale; this is a
  tooling limitation, not evidence that the route has no consumers.
- Added native authenticated POST actions for cache invalidation, guided
  taxonomy search and collection HTML export, all through live Account D1
  membership plus CSRF; added focused contract coverage. Added a gated case
  mutation boundary for create/update/delete/batch, R2 pointer-first writes,
  child-row cleanup, Vectorize deletion and an explicit `semantic_ready=0`
  state until the mutation Queue runs. Added the Queue consumer, checksum
  verified R2 text reads, and one aggregate rebuild per Queue batch. The case
  mutation flag remains `false` in the operator template until staging proves
  queue/DLQ/aggregate/reindex behaviour.
- Validation after native action/mutation/Queue additions: full Worker Vitest
  passed (23 files, 294 tests); focused action/mutation/Queue tests passed (15);
  AustLII typecheck and tests passed (12); transform/capacity/benchmark/
  separation Python tests passed (13); native bundle closure and
  `git diff --check` passed. No external resource, secret, deploy, route or
  database mutation was performed.
- The current separation verifier remains deterministically `BLOCKED` only on
  the expected external identity gates: source ref `urntbuqczarkuoaosjxd` is
  still present in local runtime config and `IMMI_TARGET_PROJECT_REF` is null.
  All structural, baseline, pipeline-disabled and destructive-migration checks
  remain `PASS`.
- Replaced the AustLII scraper's `pipeline-db.ts` PostgreSQL/Hyperdrive client
  with Catalog D1 discovery and Ops D1 run/metric state. The scraper now has no
  `postgres`, `HYPERDRIVE_SERVICE` or `HYPERDRIVE_SERVICE_URL` source import;
  direct extracted-case upsert is an explicit guard that instructs callers to
  use the native coordinator Queue.
- Added pointer-addressed extraction handoff: scraper extraction writes a
  checksum-bearing `pipeline/{run_id}/{case_id}.json` artifact to the shared
  R2 bucket and sends only a `case.extracted` pointer event to the main native
  Worker Queue. The native queue verifies the R2 pointer, calls the durable
  R2 → Catalog D1 → Vectorize → Ops coordinator, rebuilds aggregates once per
  batch, and retries failures for DLQ handling. The native pipeline remains
  disabled by default in both templates.
- Added `config/wrangler-austlii-native.toml.example` and source-boundary tests;
  scraper typecheck passed, scraper tests passed (15), native pipeline boundary
  tests passed, and separation preflight now reports
  `NATIVE_PIPELINE_SOURCE_DB_CLEAN`.
- Added the read-only `scripts/check_cloudflare_native_target.py` gate and
  three contract tests. The checked-in native Wrangler examples fail closed on
  placeholders; a synthetic operator config passes, while enabled corpus
  mutations or a Hyperdrive key are rejected. No resource IDs or secrets were
  written.
- Updated the Bsmart separation runbook and manifest to reflect the current
  truth: Bsmart no longer serves IMMI case-law or depends on the IMMI corpus;
  Bsmart-owned `law.*` and optional `immiaccount_*` remain. The IMMI target is
  Cloudflare-native D1/R2/Vectorize/Queues/DO, with legacy Supabase/Hyperdrive
  retained only as rollback source.
- Validation refresh 2026-08-10: full Worker Vitest passed (23 files, 295
  tests); AustLII typecheck and tests passed (15); native target gate contract
  tests passed (3); transform/capacity/benchmark/separation Python tests
  passed (15); native bundle closure and `git diff --check` passed. The
  separation verifier remains deterministically `BLOCKED` only on the
  undeclared external target/source runtime identity gates. GitNexus impact for
  the verifier helper returned `Target not found` because the index is stale;
  this is tooling limitation, not impact evidence.
- Closeout rerun: native separation preflight reports identical JSON twice
  with exit `1`; only `SOURCE_PROJECT_IN_RUNTIME_CONFIG` and
  `TARGET_PROJECT_UNDECLARED` remain blocked. Bsmart case-law contract (4),
  frontend route contract (16), i18n key parity (8177/8177), production build
  and both repositories' `git diff --check` passed. No commit, push, deploy,
  secret/resource write, route switch or shared Supabase mutation occurred.
- Final native-runtime closure slice: the active root and scraper Wrangler
  configs are now native-only (D1/R2/Vectorize/Queues/DO/Container bindings),
  while legacy configs are explicitly rollback-only examples. The deploy
  workflow is manual, environment-gated, requires operator-provided native
  config bundles, runs the native target gate and secret preflights, and always
  deploys with an explicit `--config` path. CI now tests this effective
  closure, and `postgres` is development-only in the root package.
- Replaced the active extraction image with a CPU/LLM-only Container and added
  an `ExtractionBackend` bridge that forwards bounded requests without any
  database/object-store credentials. Scraper extraction now requires the
  shared internal token and returns a pointer event to the native coordinator.
  Fresh snapshot export remains read-only and env-gated: it uses a repeatable-
  read PostgreSQL snapshot only as migration input, writes chunked NDJSON,
  excludes vector columns, and requires text artifacts for complete case
  content. Transform/reconciliation now validates exact Vectorize IDs and
  catalog/account/ops relation orphans.
- Validation refresh 2026-08-10: extraction/boundary/export/transform/native
  target/pipeline/separation Python tests passed (22); effective CI/closure and
  separation regression tests passed (8); full Worker Vitest passed (23 files,
  296 tests); AustLII typecheck and tests passed (16); native bundle closure
  passed (276503 bytes); checked-in native target config correctly fails closed
  on placeholder IDs; `git diff --check` passed. No operator resource,
  credential, deployment, traffic switch, source snapshot, vector backfill,
  shadow, rollback, cutover or destructive database action was performed.
- Continued completion audit: generated the checked-in legacy Flask route
  inventory and made every route explicitly `implemented` or
  `unported_fail_closed`; the manifest test now prevents silent route drift.
  Added the native `/api/v1/search/semantic` response contract using Vectorize
  and the fixed Workers AI model, plus native legislation detail metadata with
  an explicit empty/not-scraped sections state. Remaining unported routes are
  still activation blockers rather than hidden fallbacks.
- Strengthened the search benchmark gate to require at least two distinct
  values across court, year, outcome, visa type, keyword and scenario facets,
  and rejects duplicate ranking IDs. Added a p50/p95 performance report gate
  enforcing non-AI p95 <= 1 second and <=120% of baseline, with complete
  measurement-set matching.
- Added `scripts/check_immi_activation_evidence.py`: operator deployment now
  must provide immutable evidence for Workers Paid/privacy approval, fresh
  repeatable-read snapshot, zero missing/extra/orphan/checksum errors, exact
  Vectorize model/dimensions/metric, zero unported routes, 50-query quality,
  p95 performance, 24-hour shadow, <=15-minute rollback, and 24-hour soak.
  Missing or malformed evidence blocks deployment before Wrangler runs.
- Validation refresh: CI-equivalent native Python gates passed (38 tests),
  activation/performance/route/search gates passed on synthetic fixtures,
  full Worker Vitest passed (23 files, 298 tests), AustLII typecheck/tests
  passed (16), native bundle closure passed (278194 bytes), secret preflight
  passed, workflow YAML parsed, and `git diff --check` passed. These are local
  and synthetic checks only; no real snapshot, Cloudflare resource, secret,
  deployment, shadow, rollback, cutover or production soak exists yet.
- Bsmart revalidation: case-law removal contract passed (4), frontend route
  contracts passed (18), i18n parity passed (8177/8177), production frontend
  build passed, and Bsmart `git diff --check` passed. The Bsmart worktree still
  contains user-owned dirty changes; no commit or push was made.
- Added native read-only `/api/v1/job-status` and `/api/v1/pipeline-status`
  contracts backed by the Ops D1 `pipeline_runs` store. They expose the legacy
  progress shape with an explicit `native` marker and return a typed 503 when
  Ops D1 is unavailable; they do not start or stop work. The route manifest
  now has 10 remaining unported routes, all still activation blockers.
- Validation after pipeline status addition: focused Worker tests passed (17),
  route manifest tests passed (3), and `git diff --check` passed. No pipeline
  was enabled and no external or production state was changed.
- Continued native contract coverage: added the full 34-entry legal-concept
  registry with aggregate D1 case counts, and native read-only legislation
  update status (idle until a dedicated update Queue exists). The native
  pipeline/job status routes now read Ops D1; no legacy in-memory job state or
  database client is loaded. The route manifest now has 8 remaining unported
  routes: download start, judge photo, legislation update, pipeline action and
  the four corpus mutations.
- Focused validation after these additions: Worker case/status tests passed
  (18), route manifest tests passed (3), native bundle closure passed (288605
  bytes), and `git diff --check` passed. External activation evidence remains
  absent by design.
- Final current-turn validation: full Worker Vitest passed (24 files, 303
  tests); scraper typecheck and tests passed (16); native route, benchmark,
  performance and activation-evidence gates passed (12); native bundle closure
  passed (288950 bytes); native separation preflight remains blocked only by
  runtime source-project references and an undeclared target project; the
  checked-in Cloudflare target gate correctly fails on placeholder resource
  IDs. The route manifest currently contains 62 implemented routes and 8
  explicitly fail-closed routes. Bsmart case-law removal and frontend/build
  validation remain green. No resource creation, secret write, deployment,
  route switch, source snapshot, cutover, rollback rehearsal or shared
  Supabase mutation was performed.
- Continued route closure: the native mutation dispatcher now returns an
  explicit 503 `case_mutations_disabled` response during freeze and handles
  invalid IDs without legacy fall-through. Judge portraits are served from
  checksum-verified `IMMI_CONTENT` objects under `judge-photos/`. Pipeline
  start/stop and bounded download controls are authenticated operator actions,
  persisted in Ops D1, and delivered through `PIPELINE_CONTROL_QUEUE`; the
  native scraper handles manual discovery, missing-content downloads and stop
  markers. Legislation updates now use the same control Queue and a native
  AustLII R2 importer under `legislations/{law_id}.json`, with status read from
  Ops D1. The transform/reconciliation tools now carry optional legislation
  artifacts and verify their R2 checksums.
- Validation refresh after route closure: full Worker Vitest passed (25 files,
  313 tests); scraper typecheck passed and scraper Vitest passed (6 files, 21
  tests); native Python gates passed (40 tests, plus route/target/activation
  checks); native bundle closure passed (301891 bytes); route manifest has 70
  implemented routes and 0 unported routes; `git diff --check` passed. The
  native target gate still fails only because checked-in configs intentionally
  contain placeholder resource IDs. No external resource, secret, deploy,
  snapshot, route switch, cutover, rollback rehearsal or shared Supabase
  mutation occurred.
- Final audit correction: after adding the legislation artifact transform and
  fail-closed section importer, the complete native Python gate set passed 41
  tests; full Worker Vitest remains 25 files/313 tests; scraper typecheck and
  Vitest remain green at 6 files/21 tests. Bsmart targeted case-law removal
  remains 4 passed and frontend route contracts 18 passed. The separation
  verifier still reports exactly two external blockers: source-project runtime
  references and no declared target project.
- Read-only external refresh (2026-08-10): `https://immi.trackit.today/api/v1/llm-council/health`
  still returns HTTP 200 with the legacy gateway/provider configuration (the
  response reports `live_probe=false`); this is not proof of native cutover.
  `supabase projects list --output-format json` still shows only the linked
  `Bsmart` project `urntbuqczarkuoaosjxd` for this workspace and no IMMI target.
  No Cloudflare deploy identity/resource output was available from the local
  Wrangler read-only probe. These checks changed no external state.
- Separation verifier refinement: active Worker/container configs are now
  checked separately from `.mcp.json` and `.codex/config.toml`. The latter are
  explicitly classified as local tooling evidence, so the verifier now reports
  only one activation blocker: `TARGET_PROJECT_UNDECLARED`. Active runtime
  configs are proven free of the shared project ref; this does not waive the
  requirement to obtain and verify a real Cloudflare target.
- Closeout correction: the verifier summary remains blocked by exactly one
  external gate, `TARGET_PROJECT_UNDECLARED`; the active runtime configs are
  clean, while local MCP/editor references are rollback-tooling evidence only.
  Bsmart's case-law surface is removed and its remaining ImmiAccount/law-owned
  integrations are intentionally retained. No commit, push, deploy, resource
  creation, secret write, route switch, cutover, rollback rehearsal or shared
  Supabase mutation was performed in this closeout.
- Final local revalidation: IMMI separation preflight passed 5 tests; the
  verifier still reports only `TARGET_PROJECT_UNDECLARED`; the native target
  gate correctly rejects placeholder D1/R2/Vectorize identifiers. Bsmart
  case-law removal passed 4 tests, frontend route contracts passed 18 tests,
  i18n parity passed 8177/8177, and the production frontend build completed.
  Both repositories passed `git diff --check`; dirty files remain user-owned
  and uncommitted.
- Continued gate hardening: activation evidence now requires immutable release
  identity (`git_sha`, main/pipeline Worker version IDs, deterministic native
  config digest, and `legacy_runtime_disabled=true`) plus a zero-valued
  `legacy_reference_scan` covering deployed runtime/config/CI. The deployment
  workflow verifies the digest against the materialised operator configs before
  any deploy step. Metadata-only native case updates now enqueue deterministic
  Vectorize reindex events after clearing `semantic_ready`, so they cannot
  remain permanently lexical-only.
- Validation after gate hardening: native Python gate set passed 42 tests;
  Worker Vitest passed 25 files/314 tests; AustLII scraper typecheck passed and
  Vitest passed 6 files/21 tests; native bundle closure passed at 302423 bytes;
  `git diff --check` passed. No external resource, secret, deployment, route
  switch, source snapshot/import, cutover, rollback rehearsal or shared
  Supabase mutation occurred.
- GitNexus maintenance: the IMMI index was rebuilt successfully at the current
  worktree state (17,573 nodes, 41,901 edges). A Bsmart rebuild was attempted
  but interrupted after several minutes because its large dirty/generated
  corpus remained CPU-bound; the Bsmart index is therefore still stale and is
  tooling context only, not evidence about runtime impact.
- Read-only Cloudflare inventory refresh: Wrangler identity is available for
  the operator account, but no dedicated IMMI D1 catalog/account/ops databases,
  `CASE_VECTORS` index, native content bucket, native mutation/control queues,
  or `immi-case-standalone` Worker exists. The existing `immi-case` deployment
  history is the legacy Worker; no mutation was attempted. This confirms the
  native target gate is an external provisioning blocker, not a local config
  issue.
- Final local validation refresh (2026-08-10): native Python gate suite passed
  45 tests; full Worker Vitest passed 25 files/319 tests; AustLII scraper
  typecheck passed and Vitest passed 6 files/21 tests; native bundle closure
  passed at 306328 bytes; Bsmart case-law removal passed 4 tests, frontend
  route contracts passed 2 files/18 tests, i18n parity passed 8177/8177, and
  the production frontend build completed. Both repositories passed
  `git diff --check`. The first direct `node --test` invocation for Bsmart
  route tests was invalid because the ESM imports are extensionless; the
  repository Vitest command was then used and passed. Separation verification
  still has exactly one blocker: `TARGET_PROJECT_UNDECLARED`; the Cloudflare
  target gate still rejects placeholder D1/R2/Vectorize identifiers. No
  resource creation, secret write, deployment, route switch, source
  snapshot/import, cutover, rollback rehearsal or shared Supabase mutation
  occurred.
- Final independence closeout validation (2026-08-10): reconciliation now
  compares exact source/target relation sets for case↔judge/concept/visa,
  collection↔case and Council turn↔session/tenant, with a regression test for
  a missing relation. The CI-equivalent native Python suite passed 43 tests;
  full Worker Vitest passed 25 files/324 tests; AustLII scraper typecheck
  passed and Vitest passed 6 files/21 tests; native bundle closure passed at
  307565 bytes; secret preflight passed. Bsmart case-law removal passed 4
  tests, frontend route contracts passed 2 files/18 tests, i18n parity passed
  8177/8177, and the production frontend build completed. Both repositories
  passed `git diff --check`. Bsmart runtime no longer mounts `/api/law/*` or
  reads the IMMI corpus; Bsmart-owned `law.*` and optional `immiaccount_*`
  integration remain intentionally retained. The only remaining activation
  blockers are operator-owned: `TARGET_PROJECT_UNDECLARED` and placeholder
  Cloudflare D1/R2/Vectorize identifiers. No resource creation, secret write,
  deployment, route switch, source snapshot/import, cutover, rollback
  rehearsal or shared Supabase mutation occurred.
- Continued completion audit (2026-08-10): activation evidence now requires
  Cloudflare API plus creation-record proof for all three D1s (`oc` location
  hint, read replication disabled, real UUIDs), R2 versioning and >=90-day
  lifecycle retention, Vectorize readiness with the fixed model/dimensions/
  metric and exactly the four approved metadata indexes, catalog <=8 GiB,
  max row <=256 KiB and >=20% headroom. The evidence checker also
  cross-compares every D1/R2/Vectorize identity against the operator Wrangler
  configs. Native route inventory now includes Council POST-turn CRUD.
- Separation preflight was corrected for the final architecture: it no longer
  blocks on a nonexistent second Supabase target or target Hyperdrive IDs;
  it delegates to the Cloudflare-native resource gate and reports
  `CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED`. The compatibility deploy checker
  now wraps the native gate. Current Cloudflare read-only inventory still has
  no `immi-case-standalone` Worker or target Vectorize index/bucket/queues;
  D1 listing returned an authentication error, so no D1 inventory claim is
  inferred from that failed probe. No resource, secret, deployment, route,
  snapshot, cutover, rollback or shared Supabase mutation was performed.
- Validation after this slice: native Python gate suite passed 47 tests;
  activation evidence passed 8 tests, route manifest 4, target gate 5 and
  separation/effective-CI 9. The checked-in native target remains correctly
  blocked by placeholder resource IDs (including pipeline bindings).
- Final validation refresh (2026-08-10): native Python gate suite passed 48
  tests; full Worker Vitest passed 25 files/324 tests; AustLII scraper
  typecheck passed and Vitest passed 6 files/21 tests; native bundle closure
  passed at 307565 bytes; secret preflight passed. Bsmart case-law removal
  passed 4 tests, frontend route contracts passed 2 files/18 tests, i18n
  parity passed 8177/8177, and the production frontend build completed.
  Both repositories passed `git diff --check`. The native separation report
  now has no obsolete second-Supabase-target blocker; it is blocked only by
  unprovisioned Cloudflare-native resource IDs. No commit, push, resource,
  secret, deployment, route switch, snapshot/import, cutover, rollback
  rehearsal or shared Supabase mutation occurred.
- Continuation audit (2026-08-10): refreshed read-only Wrangler inventory with
  Wrangler 4.120.0. The operator account is authenticated, but no
  `immi-case-standalone` Worker, `CASE_VECTORS` index, `IMMI_CONTENT` bucket,
  native IMMI queues, or named IMMI D1 databases exist. The D1 list succeeded
  and contained only unrelated databases; no IMMI D1 was inferred from a
  failed probe. Production gate remains
  `CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED`. Moved the AustLII scraper's
  `postgres` package from production `dependencies` to operator/dev-only
  `devDependencies`; added `tests/test_native_dependency_closure.py` to
  prevent legacy DB packages from entering the native scraper runtime.
  Targeted dependency tests passed 2/2 and scraper typecheck passed. No
  external mutation was attempted.
- Post-boundary validation (2026-08-10): native Python gate suite passed 50
  tests including the dependency closure gate; full Worker Vitest passed 25
  files/324 tests; scraper typecheck passed and Vitest passed 6 files/21
  tests; native bundle closure passed at 307565 bytes. Bsmart case-law removal
  passed 4 tests, route contracts passed 2 files/18 tests, i18n parity passed
  8177/8177, and frontend production build passed. CI now runs the native
  dependency closure test. A first scraper test command used unsupported
  Vitest `--runInBand`; the repository command was rerun without that flag and
  passed. `git diff --check` passed; no commit, push or external mutation.
- Cutover-critical hardening (2026-08-10): native extraction now stages each
  R2 pointer in Ops D1 `outbox_events`, increments an attempt before Queue
  publish, and marks it `published` only after the pointer-only
  `case.extracted` event is accepted. Replays skip already-published events;
  the idempotent main coordinator remains the consumer of duplicate retries.
  `assertSchemaConsistent` now requires `outbox_events`, and the scraper CI
  job now installs, typechecks and tests the native pipeline. Scraper tests
  passed 7 files/25 tests; typecheck passed; native Python gate passed 51
  tests; Worker tests passed 25 files/324 tests; bundle closure remained
  307565 bytes.
- Read-only Cloudflare inventory refresh (2026-08-10): D1 list succeeded with
  17 unrelated databases and zero names containing `immi`; Vectorize still
  has only two unrelated 384-dimensional indexes; R2 has no
  `immi-content-replace`; `immi-case-standalone` deployments returns API code
  10007 (Worker absent). No resource, secret, deployment, route, import,
  cutover, rollback rehearsal or shared Supabase mutation occurred.
- DLQ hardening (2026-08-10): main and pipeline native Workers now consume
  their configured dead-letter queues, persist failed message bodies as
  checksum-addressed `imports/dlq/` R2 objects, and record them in Ops D1
  `dead_letter_events`. The native config gate now rejects any declared DLQ
  without an explicit consumer. TOML parsing passed for active and operator
  templates. Native Python gates passed 52 tests; Worker Vitest passed 25
  files/325 tests; scraper typecheck passed and Vitest passed 7 files/26
  tests; bundle closure passed at 309445 bytes. No external mutation occurred.
- Effective native-reference gate (2026-08-10): added
  `scripts/check_native_effective_references.py` to fail closed on active
  Supabase/PostgreSQL/pgvector/Hyperdrive markers across deployed native
  runtime files, pipeline source, effective Wrangler TOML, CI/deploy workflow
  and the bundled Worker graph. CI runs the checked-in scan; operator deploy
  runs it against the materialised secret-supplied configs before any deploy
  step. The scanner regression suite passed 3 tests and the checked-in scan
  returned zero hits with bundle closure true. Full native Python gates passed
  55 tests; Worker Vitest passed 25 files/325 tests; scraper typecheck passed
  and Vitest passed 7 files/26 tests; bundle closure passed at 309445 bytes;
  TOML parsing, `py_compile` and both repositories' `git diff --check` passed.
  Bsmart case-law removal passed 4 tests, frontend route contracts passed
  2 files/18 tests, i18n parity passed 8177/8177 and frontend production
  build passed. Read-only Cloudflare inventory still shows no IMMI Worker,
  target D1s, R2 bucket or Vectorize index; no resource, secret, deploy,
  route switch, import, cutover, rollback rehearsal or shared Supabase
  mutation occurred.
- Activation-proof hardening (2026-08-10): the activation checker now also
  requires immutable public-contract fixture evidence covering success,
  validation, 401, 403, 404, 429 and 503; a seven-scenario cross-tenant attack
  matrix with every attempt denied; explicit pipeline ordering/outbox/event
  idempotency/DLQ/container credential proof; a separate R2 checksum manifest
  with zero missing/extra/orphan/mismatch; bounded blue-green cutover evidence
  with a freeze no longer than 60 minutes; and explicit code-rollback plus
  D1-to-legacy replay rehearsals. The fixture and negative regression tests
  pass, ruff and py_compile pass, and the expanded native Python gate suite
  passed 56 tests. Read-only separation preflight remains deterministic with
  one operator-owned blocker: `CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED` due to
  placeholder D1/R2/Vectorize/KV IDs. Fresh Wrangler inventory still shows 17
  unrelated D1s, only two unrelated 384-dimensional Vectorize indexes, no
  `immi-content-replace` bucket and no `immi-case-standalone` Worker (API
  code 10007). No external mutation occurred.
- Reconciliation gate correction (2026-08-10): activation now rejects any
  non-empty `source_manifest_mismatch`, `relation_missing`, `relation_extra`,
  `vector_missing` or `vector_extra` category, accepting only numeric zero or
  the empty lists emitted by `reconcile_immi_transform.py`. Negative coverage
  proves missing case relations and extra Vectorize IDs block activation;
  activation tests now pass 10/10 and ruff/py_compile remain green.
- Native catalog fidelity correction (2026-08-10): `CloudflareCaseStore`
  now preserves `visa_outcome_reason`, `legal_test_applied`,
  `last_extraction_run_id` and validated `extraction_confidence_json` during
  queue-driven imports/upserts, includes the public outcome fields in the
  shared case projection, and allows the two editable fields through the
  mutation map. Storage contract tests passed 13/13, full Worker Vitest passed
  25 files/325 tests, and native bundle closure passed at 310804 bytes.
- Full-text mutation fidelity correction (2026-08-10): the native case
  mutation record builder now carries existing `visa_outcome_reason` and
  `legal_test_applied` through full-text replacement instead of silently
  clearing them. Regression coverage passed 10/10 mutation tests.
- Council payload cleanup correction (2026-08-10): `CouncilSessionDO.deleteSession`
  now loads tenant-scoped turn metadata, deletes each checksum-validated
  Council R2 payload before soft-deleting Account D1 metadata, and retains the
  metadata when an object delete fails so the operation is safely retryable.
  Durable Object regression coverage passed 3/3 tests.
- Post-fidelity validation (2026-08-10): full Worker Vitest passed 25 files/
  327 tests; native bundle closure passed at 311556 bytes; scraper typecheck
  and 7-file/26-test suite remained green; native Python gate suite passed
  57 tests. No external state was changed.
- Transform fidelity regression (2026-08-10): local snapshot transform tests
  now assert `visa_outcome_reason` and `legal_test_applied` survive into the
  Catalog D1 mirror; all 4 transform/reconciliation tests pass.
- Capacity evidence correction (2026-08-10): `check_cloudflare_catalog_capacity.py`
  now reports calculated headroom percentage from the larger logical/physical
  catalog size, so the activation packet's >=20% headroom claim can be tied to
  the measured local artifact rather than hand-entered only. Capacity tests,
  ruff and py_compile pass.
- Snapshot export contract completion (2026-08-10): `export_immi_ndjson.py`
  now emits deterministic 16 MiB-or-smaller table parts, per-table row hashes,
  primary-key manifests (including composite memberships), and a hashed schema
  manifest with exporter/schema versions. The transformer and reconciler read
  both legacy single-file fixtures and sorted chunked parts. Exporter and
  transform tests passed 13/13; the expanded native migration gate passed
  61/61; Worker Vitest passed 25 files/327 tests; scraper typecheck passed and
  Vitest passed 7 files/26 tests; effective native-reference scan reported zero
  forbidden markers and bundle closure passed at 311556 bytes. `git diff --check`
  passed. No export against the shared database, Cloudflare resource creation,
  deploy, route switch, import, cutover or destructive Supabase action was run.
- Final live blocker recheck (2026-08-10): authenticated Wrangler 4.120.0
  inventory still reports 17 unrelated D1 databases, only unrelated
  384-dimensional Vectorize indexes, no `immi-content-replace` R2 bucket, and
  no `immi-case-standalone` Worker (Cloudflare API code 10007). No paid
  resource creation, secret write, deployment, route switch, import, cutover,
  rollback rehearsal or shared Supabase mutation occurred. The activation goal
  remains blocked until an operator provisions the approved Cloudflare target
  resources and supplies the immutable production evidence packet.
