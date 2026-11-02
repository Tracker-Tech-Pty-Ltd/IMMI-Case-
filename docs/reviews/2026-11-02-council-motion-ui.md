# Council 動態介面調整（2026-11-02）

本次調整 Council 的標題、生成過程和回答呈現，沿用 Legal Codex 的暖白、海軍藍及琥珀色。標題以旋轉軌道及柔和光影營造層次；生成中的專家卡片顯示對應狀態；回答及追問區加強區分與互動回饋。動畫只是視覺效果，不能表示模型已成功呼叫、內容正確或案件結果。系統設定減少動態時，新增的持續動畫會停止。

## 21st 元件搜尋

使用 21st CLI 搜尋並取得以下元件程式碼以評估適用性：

- [Thinking Loader](https://21st.dev/@flohoeller_5a53e102/components/thinking-loader)
- [AI Response](https://21st.dev/@educalvolpz/components/ai-response)
- [Animated Text](https://21st.dev/@builduilabs/components/animated-text)
- [Animated Background](https://21st.dev/@ibelick/components/animated-background)
- [AI Message Bubble](https://21st.dev/@elements-/components/message-bubble)

這次的等待動畫參考 Thinking Loader 的設計概念，使用本專案自行撰寫的程式，未複製上述元件程式碼，也未為這些效果新增套件。標題視覺亦為本專案自行設計。

## 已驗證與限制

- 標題區相關的兩組頁面測試共 59 項通過；TypeScript 檢查及該頁 ESLint 檢查通過。
- 整合後前端測試共 790 項通過；TypeScript 檢查通過。測試過程出現既有 jsdom 頁面導覽提示，但測試結果成功。
- 本機示範以桌面及 390px 手機寬度檢視；已操作固定示範回應、開啟對話及追問。示範完成狀態明確標示為「示範回應已完成」。
- 本機示範使用固定的模擬回覆，不能作為真實模型回應、引用正確性或法律結果的驗證。
- 在瀏覽器模擬減少動態設定時，已確認標題軌道動畫停止；設定及視窗尺寸於測試後還原。未在實體手機上測試。

## 提交前程式碼審查（2026-11-02）

- 串流開始綜合後若中斷，主席區會顯示綜合不可用並停止轉圈；若串流在沒有完成或失敗訊號時結束，顯示中斷錯誤，不會一直顯示分析中。已完成或失敗的狀態保留原狀。
- 新增實際模擬串流中斷與缺少終止訊號的回歸測試；相關串流、認證與本機示範四個測試檔共 33 項通過。
- 本機示範登出後，示範服務的身分及更新驗證會回傳 401；重新啟動示範後可恢復。相關 Python 測試共 24 項通過。
