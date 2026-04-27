# IMMI-Case- 改進路線圖

**生成時間**: 2026-04-16（基於 autopilot 掃描結果 + 已完成提交）  
**上次更新**: 2026-04-16（sec-001 QA 驗證完成，perf-001 已合入）

---

## 已完成項目

| ID | 標題 | commit | 完成日期 |
|----|------|--------|---------|
| sec-001 | 移除 /api/v1/debug 資訊洩漏端點 | e0e6e78 + 迴歸測試 | 2026-04-16 |
| perf-001 | monthly-trends 改用 _get_analytics_cases()（節省 44s） | e0e6e78 | 2026-04-16 |
| sec-008 step-1 | export 端點加入 rate_limit(5, 3600) | e0e6e78 | 2026-04-16 |

---

## Sprint 1：立即可做（trivial/small，估計 < 1 天）

### 🔴 Critical / High

| ID | 標題 | 估計 | 前置 | 備註 |
|----|------|------|------|------|
| sec-008 step-2 | 將 MAX_EXPORT_ROWS 從 50,000 降至 5,000 | trivial | — | api.py 單行改動 |
| sec-008 step-3 | export 請求加 logger.info（IP + 過濾條件 + 行數） | trivial | — | 稽核追蹤 |

### 🟡 Medium / Performance

| ID | 標題 | 估計 | 前置 | 備註 |
|----|------|------|------|------|
| perf-003 | App.tsx QueryClient 加 gcTime: 30min | trivial | — | 1 行改動，消除 analytics 重複載入 |
| cq-010 | ESLint 加 no-console + explicit-function-return-type | trivial | — | eslint.config.ts 加 rules block |
| cq-006 | 39 個 broad except 加 exc_info=True | small | — | 不改邏輯，只改 logging |

---

## Sprint 2：短期（small，估計 2–3 天）

### api.py 拆分 — Phase A 和 B（cq-001）

| Phase | 目標 | 路由數 | 風險 | 估計 |
|-------|------|--------|------|------|
| Phase A | 提取 api_export.py | 2 | 低 | 1h |
| Phase B | 提取 api_pipeline.py（含 LLM council） | 7 | 中 | 2h |

> 詳見 `.omc/plans/api-split.md` 及下方 cq-001 更新計畫

### 其他 short-term

| ID | 標題 | 估計 | 前置 |
|----|------|------|------|
| perf-002 | CasesPage 提取 CaseTableRow memo 組件 | small | — |
| sec-004 | FTS5 查詢輸入清理（regex strip + 200 char cap） | small | — |

---

## Sprint 3：中期（medium，估計 1 週）

### api.py 拆分 — Phase C 和 D（cq-001）

| Phase | 目標 | 路由數 | 風險 | 估計 |
|-------|------|--------|------|------|
| Phase C | 提取 api_taxonomy.py | 7 | 中 | 3h |
| Phase D | 提取 api_cases.py + api_analytics.py | 33 | 高 | 1-2 天 |

> Phase D 後 api.py 從 4,900 行降至 ~800 行

### 其他 medium-term

| ID | 標題 | 估計 | 前置 |
|----|------|------|------|
| cq-002 | 抽取 _rpc_with_fallback 消除 4 份重複 | medium | cq-001 Phase D |
| cq-004 | _judge_profile_payload 拆成 6 個子函式 | medium | cq-001 Phase D |
| sec-003 | 加 HSTS + Permissions-Policy headers | small | — |
| cq-003 | FilterParams dataclass 跨 4 個 Repository | medium | — |

---

## Sprint 4：較大工作（medium/large，估計 2 週）

| ID | 標題 | 估計 | 前置 |
|----|------|------|------|
| cq-005 | DesignTokensPage.tsx 拆分（2663 行 → 6 組件） | medium | — |
| cq-009 | frontend/src/lib/api.ts 按 domain 拆分 | medium | — |
| sec-005 | LLM council 加全域每日 500 次預算上限 | medium | — |
| sec-006 | localStorage bookmark 加 30 天 TTL + 清除按鈕 | medium | — |
| sec-002 | X-Hyperdrive-Url header 驗證或移除 | small | — |
| sec-007 | 修正 TRUST_PROXY_HEADERS，限制 CF IP 範圍 | small | — |

---

## 低優先（延後）

| ID | 標題 | 理由 |
|----|------|------|
| cq-007 | LlmCouncilPage.tsx 拆分（1305 行） | 功能可用，非主線 |
| cq-008 | 51 個路由處理函式加 return type hint | 型別安全提升，非緊急 |

---

## 依賴圖

```
sec-001 ✅ → done
perf-001 ✅ → done
sec-008 step-1 ✅ → sec-008 step-2 → sec-008 step-3

cq-001 Phase A → Phase B → Phase C → Phase D
                                      ↓
                                  cq-002 (RPC fallback helper)
                                  cq-004 (_judge_profile_payload)

perf-003 (獨立)
cq-010 (獨立)
cq-006 (獨立，可在 cq-001 前後做)
sec-003 (獨立)
sec-004 (獨立)
cq-003 (獨立)
cq-005 (獨立)
cq-009 (獨立)
sec-005 (獨立)
sec-006 (獨立)
sec-002 (獨立)
sec-007 (獨立)
```

---

## 快速勝利清單（< 30 分鐘各）

1. `sec-008 step-2` — api.py 改 `MAX_EXPORT_ROWS = 5000`
2. `sec-008 step-3` — export 函式加 `logger.info(...)`
3. `perf-003` — App.tsx 加 `gcTime: 30 * 60 * 1000`
4. `cq-010` — eslint.config.ts 加 rules block
5. `cq-001 Phase A` — 提取 api_export.py（2 路由，最安全）
