# IMMI-Case — Frontend (React SPA)

澳洲移民司法案件情報平台的前端。React 19 + TypeScript + Vite 7 + Tailwind CSS v4
+ TanStack Query v5 + react-i18next（English / 繁體中文雙語）。26 個 lazy-loaded
頁面，正式環境由 Cloudflare Workers Static Assets 提供。

專案總覽、後端與資料層請見上層的 [`../README.md`](../README.md)；
架構真相來源是 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)。

## Commands

```bash
npm install            # 或在 repo 根目錄跑 make install（同時裝根目錄 node_modules）

npm run dev            # Vite dev server（先跑 tokens），proxy 到 http://127.0.0.1:8080
npm run build          # tokens → tsc -b → vite build，輸出 ../immi_case_downloader/static/react
npm run build:cloudflare   # 同上但輸出到 dist/
npm run lint           # eslint .
npx tsc -b --noEmit    # 真正的型別檢查（見下方 tsconfig 說明）

npx vitest run                              # 全部單元測試
npx vitest run __tests__/judge-pages.test.tsx   # 單一檔案
npm run test:coverage                       # v8 coverage；門檻是逐步墊高的 ratchet
                                             # （見 vitest.config.ts 的 thresholds，
                                             # 目前 lines 29 / functions 24 / branches 30 /
                                             # statements 28 —— 不是 80%，只能墊高不能調低）
```

> **前端已經沒有自己的 E2E 套件。** `frontend/e2e/`（TypeScript Playwright）與
> `frontend/playwright.config.ts` 已刪除：它跟 repo 根目錄的 Python Playwright
> 套件測同一個 SPA，最後一次更新是 2026-03-09，而且還在打兩條早就不存在的
> 路由（`/search`、`/update-db`）。全專案唯一的 E2E 套件是 `../tests/e2e/`，
> 用 `make test-e2e` 跑（先 `make install-e2e`）。
>
> `package.json` 裡的 `e2e`、`e2e:ui`、`e2e:headed` script 與
> `@playwright/test` devDependency 目前**還沒清掉**（那個檔案有其他 plan 在改，
> 避免衝突）。`npm run e2e` 現在會直接失敗，這是預期行為，不是壞掉。

## Layout

```
frontend/
├── src/
│   ├── pages/          26 個頁面，全部 lazy-loaded
│   ├── components/     共用元件 + chart 元件 + layout
│   ├── hooks/          TanStack Query hooks
│   ├── contexts/       AuthContext 等
│   ├── lib/
│   │   ├── api.ts      CSRF-aware fetch wrapper；各類端點的 timeout 常數也在這
│   │   └── router.ts   resolveRouterBasename()：自動判斷 / 或 /app/
│   └── tokens/tokens.json   設計令牌的單一來源
├── scripts/build-tokens.ts  tokens.json → CSS + TS（npm run tokens）
├── __tests__/          Vitest 單元測試（本目錄唯一的測試）
├── vite.config.ts      dev server / proxy / build.outDir
├── vitest.config.ts    測試設定（include glob、jsdom、coverage 門檻）
└── tsconfig.app.json   ← 路徑 alias 只在這裡
```

### 測試放在哪裡（容易踩雷）

- 單元測試由 `vitest.config.ts` 的 `include` glob 決定，目前是
  `__tests__/**/*.{test,spec}.{ts,tsx}` 和 `src/**/*.{test,spec}.{ts,tsx}`
  兩個 glob（後者是為了 colocate 在模組旁邊的測試，例如
  `src/lib/__tests__/saved-searches.test.ts`）。
- **`frontend/src/__tests__/` 不存在。** 任何指向
  `src/__tests__/components/...` 的指令都是錯的；用
  `npx vitest run __tests__/judge-pages.test.tsx` 這種真實路徑。
- **E2E 不在這裡。** 全專案唯一的 E2E 套件是 repo 根目錄的
  `../tests/e2e/`（pytest + pytest-playwright，`make test-e2e`）。它會自己啟動
  一個帶種子資料的 Flask fixture server，不需要你先開 server；只有設了
  `E2E_BASE_URL` 才會改打外部伺服器。前端曾經有第二套 TypeScript Playwright
  測試（`frontend/e2e/`），已刪除。

### tsconfig（容易踩雷）

- `tsconfig.json` 只有 `files: []` + project references。**`npx tsc --noEmit`
  會 exit 0 但一個檔案都沒載入** —— 真正的型別檢查是 `npx tsc -b --noEmit`。
- 路徑 alias（`@/*`）只定義在 `tsconfig.app.json`。不要在 root `tsconfig.json`
  加 `baseUrl` / `paths` / `compilerOptions`，重複的 `baseUrl` 會觸發 TS5101。

## Design system

視覺方向已經定案，代號 **Legal Codex**，不要另起爐灶：

- 暖米白背景 `#f5f4f1`、深海軍藍 `#1b2838`、琥珀金 accent `#d4a017`
- Crimson Text 襯線標題、9 種法院專屬色碼
- 主要使用者是**自助辦理的移民申請人**，不是律師；品牌調性是權威、精準、學術

所有間距 / 陰影 / 圓角 / 顏色一律取自 `src/tokens/tokens.json`（`npm run tokens`
會產出 CSS 變數與 TS 型別）。**不得出現魔法數字。**

## Conventions（送審會被擋的項目）

- 陣列用 `.toSorted()`，不要用 `.sort()`（React 內禁止就地變異）。
- 每一個 `localStorage` 讀寫都要包 try/catch —— 無痕模式與配額用盡都會 throw。
- UI 字串一律 `t("key", { defaultValue: "English text" })`；測試裡的 i18n mock
  只回傳 key，所以斷言要用 key 字串。
- 依賴 filter 的 TanStack Query hook 要設 `placeholderData` / `keepPreviousData`，
  否則快速換頁會閃空狀態。
- 每個 Recharts `<Tooltip contentStyle={...}>` 都必須帶
  `color: "var(--color-text)"`，否則深色模式下文字看不見。
- `animate-spin` 放在外層 `<div>`，不要直接放在 SVG icon 上。
- 呼叫 `t()` 的 `useCallback` / `useMemo`，依賴陣列要包含 `t`。

更完整的踩雷清單見 `../CLAUDE.md` 的 "React Frontend Gotchas"。

---

最後更新：2026-08-28。這份檔案原本是 `npm create vite` 的樣板，已於此次改寫為專案文件。
