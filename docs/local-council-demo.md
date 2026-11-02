# 本機 Council 示範與 OpenAI 格式假 API

這個示範供介面開發和測試使用：所有模型回答都是固定的示範內容，並沒有呼叫任何真實模型，也不分析問題或載入真實案件。示範工作階段存於本機服務的記憶體，停止服務後會消失；瀏覽器可能為示範對話保留隨機的假工作階段識別資料。

## 啟動

在 PowerShell 執行以下指令，並保持視窗開啟：

```powershell
cd D:\Dev\Projects\IMMI-Case-
.\.venv\Scripts\python.exe scripts\run_council_demo.py
```

啟動成功後開啟程式顯示的本機網址（預設 `http://127.0.0.1:5188/llm-council`）。輸入虛構問題並按送出，即可查看固定回應；請勿輸入個人資料。按 **Ctrl+C** 會關閉三個示範服務。啟動需要已有專案 `.venv`、Node 及前端依賴。

示範中的「登出」只會登出這個記憶體內的示範身分；要再次使用示範，請停止並重新啟動服務。

若預設連接埠已被使用，程式會停止並提示，不會連到該服務。可改用其他未佔用的埠：

```powershell
.\.venv\Scripts\python.exe scripts\run_council_demo.py --mock-port 28666 --bridge-port 28667 --ui-port 5196
```

## 內容與限制

- 假 API 預設地址為 `http://127.0.0.1:8766/v1/chat/completions`，支援一般 JSON 回應及 `stream: true` 的 SSE 分段；回應內容標示為模擬。此為 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat) 格式的有限子集，並不支援 Responses API、工具呼叫或所有 OpenAI 選項。
- 一鍵程式把 Council 前端連到獨立本機橋接；橋接只將固定的虛構訊息送往本機假 API，再轉成畫面需要的事件。它不會將輸入文字或金鑰送往模型；未支援路徑不會轉發到正式系統。
- 示範畫面有獨立標示，案件 ID 及取回舊對話的操作不在示範中啟用；不記錄示範成就。原有 `.env` 及正式服務設定不會被修改。
- 示範中的應用程式 API 請求不攜帶瀏覽器登入 Cookie。瀏覽器載入網頁與其他資源時仍遵守自己的 Cookie 規則，同一主機的 Cookie 不會因連接埠不同而自動隔離；需要完全獨立的瀏覽環境時，應使用獨立瀏覽器設定檔。
- 這不是正式 Council Worker 的端到端驗證。正式服務包含不同供應商的原生連線，不能只更換其中一個網址就假定所有模型均已離線。

假 API 可接收以下格式的本機測試請求：

```json
{"model":"demo-local","messages":[{"role":"user","content":"Example question"}],"stream":false}
```

它會回傳 `object: "chat.completion"`，固定回答位於 `choices[0].message.content`。將 `stream` 設為 `true`，則依序回傳 `chat.completion.chunk` 事件，最後以 `[DONE]` 結束。未實作的請求選項會明確報錯；回答不依問題改變。

本輪驗證：23 項本機 Python 測試、787 項前端測試、型別檢查與正式建置通過；亦以瀏覽器實際送出示範問題、打開對話並追問。隔離瀏覽器中的測試 Cookie 沒有出現在該流程的 5 個 API 請求；示範專用前端控制未出現在正式建置中。

正常結束請使用 Ctrl+C；直接強制結束終端或電腦時，不能保證所有子程序均已自行關閉。
