# api.py 模組拆分計劃 (cq-001)

**日期**: 2026-04-16  
**目標檔案**: `immi_case_downloader/web/routes/api.py` (現 ~4900 行, 51 路由, 119 函式)  
**分析基礎**: autopilot 自動掃描 + 全路由 grep  

---

## 目標架構

```
immi_case_downloader/web/routes/
├── api.py                 ← 保留：Blueprint 定義 + 入口 + 共用 helpers (~800 行)
├── api_cases.py           ← 新增：案件 CRUD + 搜尋 (~1200 行)
├── api_analytics.py       ← 新增：分析端點 (~2000 行)
├── api_taxonomy.py        ← 新增：分類/查找端點 (~500 行)
├── api_pipeline.py        ← 新增：Pipeline/Jobs/LLM (~300 行)
├── api_export.py          ← 新增：CSV/JSON 匯出 (~100 行)
└── [現有其他檔案不變]
    ├── legislations.py
    ├── bookmarks.py
    ├── dashboard.py
    └── ...
```

**拆分後 api.py 預計縮減至 ~800 行（目前 4900 行）**

---

## 路由→模組映射表

### 📁 api_cases.py（案件 CRUD + 搜尋）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/cases` | GET | 2230 |
| `/cases/count` | GET | 2408 |
| `/cases/<case_id>` | GET | 2451 |
| `/cases` | POST | 2463 |
| `/cases/<case_id>` | PUT | 2476 |
| `/cases/<case_id>` | DELETE | 2504 |
| `/cases/batch` | POST | 2517 |
| `/cases/compare` | GET | 2566 |
| `/cases/<case_id>/related` | GET | 2590 |
| `/cases/<case_id>/similar` | GET | 2606 |
| `/search` | GET | 2928 |
| `/search/semantic` | GET | 4900 |
| `/filter-options` | GET | 3000 |
**估計行數：~1200 行**

### 📁 api_analytics.py（分析端點）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/stats` | GET | 1857 |
| `/stats/trends` | GET | 2016 |
| `/court-lineage` | GET | 2059 |
| `/analytics/filter-options` | GET | 3169 |
| `/analytics/outcomes` | GET | 3266 |
| `/analytics/judges` | GET | 3326 |
| `/analytics/legal-concepts` | GET | 3390 |
| `/analytics/nature-outcome` | GET | 3430 |
| `/analytics/success-rate` | GET | 3483 |
| `/analytics/judge-leaderboard` | GET | 3625 |
| `/analytics/judge-profile` | GET | 3699 |
| `/analytics/judge-compare` | GET | 3729 |
| `/analytics/concept-effectiveness` | GET | 3783 |
| `/analytics/concept-cooccurrence` | GET | 3833 |
| `/analytics/concept-trends` | GET | 3897 |
| `/analytics/flow-matrix` | GET | 3989 |
| `/analytics/monthly-trends` | GET | 4071 |
| `/analytics/judge-bio` | GET | 4147 |
| `/analytics/visa-families` | GET | 4683 |
| `/judge-photo/<path:filename>` | GET | 4114 |
**估計行數：~2000 行**

### 📁 api_taxonomy.py（分類/查找）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/visa-registry` | GET | 4169 |
| `/taxonomy/visa-lookup` | GET | 4177 |
| `/taxonomy/legal-concepts` | GET | 4282 |
| `/taxonomy/judges/autocomplete` | GET | 4348 |
| `/taxonomy/countries` | GET | 4469 |
| `/taxonomy/guided-search` | POST | 4540 |
| `/data-dictionary` | GET | 4937 |
**估計行數：~500 行**

### 📁 api_pipeline.py（Pipeline/Jobs/LLM）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/job-status` | GET | 3085 |
| `/download/start` | POST | 3092 |
| `/pipeline-status` | GET | 3128 |
| `/pipeline-action` | POST | 3134 |
| `/llm-council/health` | GET | 4742 |
| `/llm-council/run` | POST | 4754 |
| `/cache/invalidate` | POST | 4717 |
**估計行數：~300 行**

### 📁 api_export.py（匯出）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/export/csv` | GET | 3045 |
| `/export/json` | GET | 3064 |
**估計行數：~100 行**

### 📁 api.py（保留：Blueprint + 共用基礎設施）
| 路由 | 方法 | 行號 |
|------|------|------|
| `/csrf-token` | GET | 1848 |
**估計行數：~800 行（含所有共用 helpers）**

---

## 共用 Helpers（留在 api.py）

以下函式被多個模組使用，**必須留在 api.py 或提取到 `helpers.py`**：

| 函式 | 被哪些模組使用 |
|------|--------------|
| `_get_all_cases()` | cases, analytics, pipeline |
| `_get_analytics_cases()` | analytics (主要) |
| `_apply_filters()` | cases, analytics |
| `_analytics_response()` | analytics (全部) |
| `_normalise_outcome()` | analytics |
| `_is_win()` | analytics |
| `_error()` | 全部 |
| `_analytics_cache` | analytics, cache endpoint |
| `_stats_cache_*` | analytics |
| `_filter_options_cache_*` | cases, analytics |
| `CASE_LIST_COLUMNS`, `EDITABLE_FIELDS` | cases |
| 所有 constants (`MAX_*`, `DEFAULT_*`) | 全部 |

---

## 技術方案：避免循環依賴

**問題**：子模組需要 `api_bp` Blueprint 和共用 helpers，但 `api_bp` 定義在 `api.py`。

**解決方案（推薦 — 側效應 import 模式）**：

```python
# api.py（精簡版）
from flask import Blueprint
api_bp = Blueprint("api", __name__, url_prefix="/api/v1")

# 共用 helpers、cache、constants 全在這裡定義
# ...

# 末尾：側效應 import 以觸發路由註冊
from . import api_cases       # noqa: F401, E402
from . import api_analytics   # noqa: F401, E402
from . import api_taxonomy    # noqa: F401, E402
from . import api_pipeline    # noqa: F401, E402
from . import api_export      # noqa: F401, E402
```

```python
# api_cases.py
from .api import api_bp, _get_all_cases, _apply_filters, _error
# ... 只定義路由，不定義 Blueprint
```

**優點**：
- URL 結構完全不變（同一個 api_bp，同一個 `/api/v1` prefix）
- 無循環依賴（子模組單向依賴 api.py）
- Flask 路由註冊機制不變
- 最小化現有 tests 的改動（路由 URL 不變）

---

## 拆分執行順序（建議）

1. **Phase A（低風險，先做）**: 提取 `api_export.py`（2個路由，最獨立）
2. **Phase B（中風險）**: 提取 `api_pipeline.py`（7個路由，LLM council 邏輯複雜）
3. **Phase C（中風險）**: 提取 `api_taxonomy.py`（7個路由，純查詢）
4. **Phase D（高風險，最後做）**: 提取 `api_cases.py` 和 `api_analytics.py`（共用 helpers 多）

每個 Phase 後跑 `python3 -m pytest tests/ -x -q` 確認無退化。

---

## 潛在風險

1. **循環依賴**：子模組 import api.py，api.py import 子模組 → 用側效應 import 解決
2. **共用 cache 物件**：`_analytics_cache` 是模組級別變數，若移動需確保所有路由引用同一物件
3. **Pyright 警告**：`# noqa` 側效應 import 會產生 "imported but unused" 警告，需統一處理
4. **測試覆蓋率**：拆分不影響功能，但 coverage 報告路徑會改變

---

## 預期效益

| 指標 | 目前 | 拆分後 |
|------|------|--------|
| api.py 行數 | ~4900 | ~800 |
| 最大模組行數 | 4900 | ~2000 (analytics) |
| 可測試性 | 差（整體 import） | 好（可個別 import） |
| merge conflict 風險 | 高（單檔） | 低（4個獨立檔案） |
| 新功能開發位置明確性 | 低 | 高 |
