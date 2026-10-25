# 選單動畫等待修正（2026-10-16）

先前指定的 114 項瀏覽器操作測試已全部通過：**114 passed、0 failed、0 errors、0 skipped**。這組測試包含煙霧、導覽及響應式三份檔案，沒有擴張宣稱整個專案的全部測試都重新執行。

## 修正內容

只修改 `tests/e2e/react/react_helpers.py` 的 `close_mobile_menu`。輔助函式先定位具名 `IMMI-Case` dialog、點擊它的 `Close menu`，再等待同一個 dialog 真正隱藏，最多等待 5 秒。Radix 在退場動畫期間仍保留 dialog，因此點擊後立即檢查可能過早。

沒有固定睡眠、跳過測試、放寬原有斷言或修改動畫。原測試的關閉結果斷言保留。該檔原有導覽及快捷鍵修改也保留；本次差異僅見 [change.patch](change.patch)，修改前完整副本為 [react_helpers.before.py](react_helpers.before.py)。

## 實際驗證

| 檢查 | 結果 | 原始證據 |
|---|---|---|
| 修正前重現 | 同一選單測試失敗 | [before.log](before.log) |
| 修正後單項 | 1 passed | [single.log](single.log)、[single.xml](single.xml) |
| 重複選單檢查 | 通過，保留最後一次原始輸出 | [repeat-.log](repeat-.log) |
| 先前同一組操作測試 | 114 passed，0 failed/errors/skipped，114.05 秒 | [suite.log](suite.log)、[suite.xml](suite.xml) |
| Ruff | All checks passed | [ruff.log](ruff.log) |
| 前端程式與公開素材 | 305／305 檔雜湊保持 | [ui-preservation.json](ui-preservation.json) |
| 60 張正式貼圖 | 60／60 檔保持 | [asset-preservation.json](asset-preservation.json) |
| 新聞資料、篩選邏輯、共用分頁與 Worker | 4／4 檔保持 | [core-preservation.json](core-preservation.json) |

GitNexus 在修改前執行影響分析：唯一直接呼叫者為 `test_close_mobile_drawer`，LOW，0 個受影響流程；並以原始碼搜尋交叉核對。發現索引過期後，以外部隔離索引及 `--index-only` 刷新，再次取得相同 LOW／單一呼叫者結果。證據：[impact.log](impact.log)、[gitnexus-refresh.log](gitnexus-refresh.log)、[impact-refreshed.log](impact-refreshed.log)。圖譜的整體推斷限制仍保留於原始日誌。

測試指令在 WSL 執行：

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/immi-case-review-20261016/ms-playwright \
E2E_BASE_URL=http://127.0.0.1:5194 \
.venv/bin/pytest tests/e2e/react/test_react_smoke.py \
  tests/e2e/react/test_react_navigation.py \
  tests/e2e/react/test_react_responsive.py --timeout=60 -q
```

使用既有本機預覽與隔離的十筆測試案例。網站程式、版面、動畫、透明貼圖與新聞資料完全未改，也未重新建置、部署、提交或推送。原寬版 80.31% 比對與修正前失敗日誌保持原樣。
