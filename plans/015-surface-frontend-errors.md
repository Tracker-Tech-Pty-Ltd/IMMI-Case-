# Plan 015: Replace infinite spinners and silent failures with real error states

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — if that file does not exist, skip that (it is not your
> job to create the index).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- \
>   frontend/src/App.tsx \
>   frontend/src/contexts/AuthContext.tsx \
>   frontend/src/pages/CaseDetailPage.tsx \
>   frontend/src/pages/DataToolsPage.tsx \
>   frontend/src/pages/LlmCouncilSessionsPage.tsx \
>   frontend/src/pages/LoginPage.tsx \
>   frontend/src/components/auth/TelegramLoginButton.tsx \
>   frontend/src/components/llm-council/StreamingCouncilView.tsx
> ```
>
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Six separate places in the React SPA turn a backend failure into either a
spinner that never stops or a screen that affirmatively claims everything is
fine. The primary user of this product is a self-representing immigration
applicant under real stress — not a developer who will open DevTools. When the
LLM Council stream drops mid-run they watch "Council deliberating" forever;
when a case fetch 404s or the Worker returns its `cloudflare_route_unavailable`
503 they watch a spinner on the single most-visited screen; when one refresh
request fails during sleep/wake the session silently dies while the UI keeps
rendering as signed in; when the pipeline status endpoint fails, the Data Tools
page displays "pipeline idle, no errors" — the exact state an operator reads as
healthy. After this plan every one of those paths shows a bounded, readable
error with a retry affordance, and a single page crash no longer takes down the
whole app shell.

## Current state

### Files and their roles

| File | Role | Defect |
|---|---|---|
| `frontend/src/components/llm-council/StreamingCouncilView.tsx` | `useCouncilStream()` hook + the 3-column live SSE view | writes `state.council.error`, nothing ever reads it; watchdog abort writes no status at all |
| `frontend/src/pages/CaseDetailPage.tsx` | case detail screen at route `cases/:id` | discards `isError`/`refetch`, renders `<PageLoader />` forever on failure |
| `frontend/src/contexts/AuthContext.tsx` | auth provider; owns the pre-expiry refresh timer | `catch { return false; }` — no retry, no reschedule, no sign-out |
| `frontend/src/pages/LlmCouncilSessionsPage.tsx` | session list at `llm-council/sessions` | `deleteSession.mutate(id)` with no error handling at either layer |
| `frontend/src/pages/DataToolsPage.tsx` | `data-tools` screen, polls 2 endpoints | destructures only `data`, synthesises a healthy-looking idle state on failure |
| `frontend/src/App.tsx` | router shell; holds the only `ErrorBoundary` in the tree | boundary wraps everything including `BrowserRouter`, has no reset, no logging, prints raw stacks to end users |
| `frontend/src/components/auth/TelegramLoginButton.tsx` | Telegram widget wrapper | `void onSuccess; void onError;` — advertises two callbacks that can never fire |
| `frontend/src/pages/LoginPage.tsx` | `login` route | passes those dead callbacks; `loginError` state is unreachable |

### Verbatim excerpts (read at commit `42826a3`)

`frontend/src/components/llm-council/StreamingCouncilView.tsx:343-366` — the
only two writers of `council.status`/`council.error`, plus the abort branch
that writes nothing:

```tsx
          if (ev.event === "council.done") {
            update({ ...curr, council: { status: "done", data: ev.data } });
            continue;
          }
          if (ev.event === "council.error") {
            update({ ...curr, council: { status: "error", error: String(ev.data.error ?? "") } });
            continue;
          }
        }
        return curr;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          return curr;
        }
        update({
          ...curr,
          council: { status: "error", error: String((err as Error).message ?? err) },
        });
        return curr;
      } finally {
        clearInterval(watchdog);
        controllerRef.current = null;
        setIsStreaming(false);
      }
```

`frontend/src/components/llm-council/StreamingCouncilView.tsx:593-621` — the
header. `state.council.status === "error"` falls into the *second* arm of both
ternaries only if `allExpertsFinal` is true; when experts are stuck mid-stream
it keeps spinning "Council deliberating" and `state.council.error` is never
rendered anywhere:

```tsx
  const allExpertsFinal =
    state.openai.status !== "pending" &&
    state.openai.status !== "streaming" &&
    state.gemini_pro.status !== "pending" &&
    state.gemini_pro.status !== "streaming" &&
    state.anthropic.status !== "pending" &&
    state.anthropic.status !== "streaming";

  return (
    <div className="space-y-3" data-testid="streaming-council-view">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card px-4 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          {state.council.status === "running" || !allExpertsFinal ? (
            <div className="animate-spin">
              <Loader2 className="h-3.5 w-3.5 text-accent" />
            </div>
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {state.council.status === "running" || !allExpertsFinal
              ? "Council deliberating"
              : "Panel finished — synthesising"}
          </span>
        </div>
        <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-foreground">
          {mm}:{ss}
        </span>
      </div>
```

`frontend/src/components/llm-council/StreamingCouncilView.tsx:466-470` — the
amber error styling to match for the new council-level error strip:

```tsx
        ) : state.status === "error" ? (
          <div className="rounded-md border border-amber-300/40 bg-amber-50/30 p-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300">
            <p className="mb-1 font-semibold">Failed</p>
            <p className="break-words">{state.error || "unknown error"}</p>
          </div>
```

`frontend/src/pages/CaseDetailPage.tsx:39` and `:90`:

```tsx
  const { data, isLoading } = useCase(id ?? "");
```

```tsx
  if (isLoading || !data) {
    return <PageLoader />;
  }
```

`frontend/src/hooks/use-cases.ts:62-68` — `useCase` sets no `retry`, so it
inherits `retry: 1` from the shared client and then parks in the error state
with `data === undefined` forever (this file is **not** in scope; quoted only
so you can see why the page hangs):

```ts
export function useCase(id: string) {
  return useQuery({
    queryKey: ["case", id],
    queryFn: () => fetchCase(id),
    enabled: !!id,
  });
}
```

`frontend/src/contexts/AuthContext.tsx:36-76` — `scheduleRefresh` is the only
thing that re-arms the timer, and it is only reached from `refresh()`'s success
path, `login`, `switchTenant` and the mount effect. The `!res.ok` branch clears
auth state; the `catch` does nothing at all:

```tsx
  const scheduleRefresh = useCallback((token: string) => {
    const payload = parseJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return;
    const msUntilExpiry = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 60_000, 0); // refresh 1min before expiry
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refreshRef.current?.(); }, refreshIn);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // sends httpOnly refresh cookie
      });
      if (!res.ok) {
        setState((s) => ({
          ...s,
          user: null,
          tenant: null,
          tenants: [],
          accessToken: null,
          isAuthenticated: false,
        }));
        clearAuthCookies();
        setApiAccessToken(null);
        return false;
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        accessToken: data.access_token,
        isAuthenticated: true,
      }));
      setApiAccessToken(data.access_token ?? null);
      scheduleRefresh(data.access_token);
      return true;
    } catch {
      return false;
    }
  }, [scheduleRefresh]);
```

`frontend/src/pages/LlmCouncilSessionsPage.tsx:56-63`:

```tsx
  const { data, isLoading, isError } = useLlmCouncilSessions();
  const deleteSession = useDeleteSession();

  const sessions = data?.sessions ?? [];

  function handleDelete(sessionId: string) {
    deleteSession.mutate(sessionId);
  }
```

`frontend/src/pages/DataToolsPage.tsx:83-96` and `:104-113` — both polls throw
away every field except `data`, and the derived values below are
indistinguishable from a healthy idle pipeline:

```tsx
  const { data: pipelineStatus } = useQuery<PipelineStatus>({
    queryKey: ["pipeline-status"],
    queryFn: fetchPipelineStatus,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineStatus | undefined;
      return data?.running ? 2000 : 15000;
    },
  });

  const { data: jobStatus } = useQuery<JobStatus>({
    queryKey: ["job-status"],
    queryFn: fetchJobStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 15000),
  });
```

```tsx
  const running = pipelineStatus?.running ?? false;
  const phase = pipelineStatus?.phase;
  const overallProgress = Math.min(
    100,
    Math.max(0, pipelineStatus?.overall_progress ?? 0),
  );
  const phasesCompleted = pipelineStatus?.phases_completed ?? [];
  const pipelineStats = pipelineStatus?.stats;
  const logs = pipelineStatus?.log ?? [];
  const errors = pipelineStatus?.errors ?? [];
```

`frontend/src/App.tsx:12-44` — the whole boundary. No `componentDidCatch`, no
reset, no logging, raw stack rendered to every user:

```tsx
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <StatePanel
            tone="error"
            align="start"
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Application error"
            description="A rendering error interrupted the current view. The diagnostic details are shown below for debugging."
            className="max-w-3xl"
          >
            <pre className="overflow-x-auto rounded-xl border border-danger/15 bg-background px-4 py-3 font-mono text-xs leading-6 text-danger">
              {err.message}
              {"\n\n"}
              {err.stack}
            </pre>
          </StatePanel>
        </div>
      );
    }
    return this.props.children;
  }
}
```

`frontend/src/App.tsx:163-191` — the shared query client and the top of the
tree. Note `retry: 1`, and that `BrowserRouter` is *inside* the boundary, so a
tripped boundary cannot be escaped by navigating:

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 min — legal DB data doesn't change mid-session
      gcTime: 30 * 60 * 1000, // 30 min — keep cache alive for a full work session
    },
  },
});

export default function App() {
  const basename = resolveRouterBasename(window.location.pathname);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={basename}>
            <Routes>
              <Route
                path="login"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LoginPage />
                  </Suspense>
                }
              />
              <Route element={<AppLayout />}>
```

There are exactly **28** occurrences of the literal line
`                  <Suspense fallback={<PageLoader />}>` in `App.tsx`, each
paired with a `                  </Suspense>` closer. Verify before editing:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -c "<Suspense fallback={<PageLoader />}>" src/App.tsx   # -> 28
```

`frontend/src/components/auth/TelegramLoginButton.tsx:3-8`, `:22-24`, `:43` and
`:49-51`:

```tsx
interface TelegramLoginButtonProps {
  botName: string;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
  size?: "large" | "medium" | "small";
}
```

```tsx
  const ref = useRef<HTMLDivElement>(null);
  void onSuccess;
  void onError;
```

```tsx
    script.setAttribute("data-auth-url", authUrl);
```

```tsx
    return () => {
      ref.current?.querySelector("script[src^='https://telegram.org/js/telegram-widget.js']")?.remove();
    };
```

`data-auth-url` is the **full-page-redirect** flow. Telegram navigates the
browser to `/api/v1/auth/telegram/callback`; no JavaScript callback ever fires.

`frontend/src/pages/LoginPage.tsx:13`, `:21-24` and `:44-48`:

```tsx
  const [loginError, setLoginError] = useState<string | null>(null);
```

```tsx
  const handleSuccess = useCallback(() => navigate("/", { replace: true }), [navigate]);
  const handleError = useCallback((err: Error) => setLoginError(err.message), []);
  const authError = searchParams.get("auth_error");
  const visibleError = loginError || (authError ? "Telegram sign-in failed. Please try again." : null);
```

```tsx
          <TelegramLoginButton
            botName={BOT_NAME}
            onSuccess={handleSuccess}
            onError={handleError}
          />
```

### Corrections to the reported evidence (verified at `42826a3`)

Three things you may have been told that are **wrong** — do not act on them:

1. **Session delete already has a confirmation modal and already has a
   pending-spinner.** `frontend/src/components/llm-council/SessionListItem.tsx:46-58`
   owns `pendingDeleteId` state and renders its own `<ConfirmModal>` at
   `:110-118`; `LlmCouncilSessionsPage.tsx:138-141` already passes
   `isDeleting={deleteSession.isPending && deleteSession.variables === session.session_id}`
   which disables the button. **Do not add a second `ConfirmModal` to the
   page** — it would double-prompt. The only real defect is the missing error
   surface.
2. **`allExpertsFinal` already treats `"error"` as terminal** — the predicate
   excludes only `"pending"` and `"streaming"`. No change is needed there.
3. `useDeleteSession` is declared at `frontend/src/hooks/use-llm-council-sessions.ts:127`
   (not 130). That file is **out of scope** — fix the error surface at the call
   site instead.

### Repo conventions this plan must honour

Inlined from `CLAUDE.md` and observed in the code — the executor has not read
those docs:

- **React**: use `.toSorted()` not `.sort()`; wrap every `localStorage` call in
  try/catch; use `t("key", { defaultValue: "English text" })` for UI strings;
  TanStack Query filter-dependent hooks use `placeholderData`/`keepPreviousData`;
  every Recharts `Tooltip` `contentStyle` must set `color: "var(--color-text)"`;
  put `animate-spin` on a wrapper `<div>`, **not** on the SVG icon; all
  spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
- **Design direction is decided and named "Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. The primary user is a
  self-representing immigration applicant, not a lawyer; the brand is
  authoritative, precise, academic. Error copy must be plain and calm — not
  jokey, not a raw stack trace.
- **Error-state exemplar to copy**: `frontend/src/pages/JudgeDetailPage.tsx:40-88`
  has both an `isError` branch and a distinct not-found branch, both using
  `<ApiErrorState>` with `onRetry={() => { void refetch(); }}`. Match it.
  `frontend/src/components/shared/ApiErrorState.tsx` takes
  `{ title?, message?, onRetry? }` and defaults to
  `t("errors.unable_to_load_data")` / `t("errors.unable_to_load_message")`.
- **i18n keys that already exist in BOTH `src/i18n/locales/en.json` and
  `zh-TW.json`** — use these, do not add new keys (the locale files are out of
  scope): `errors.failed_to_load` (`"Failed to load {{name}}"`),
  `errors.payload_error` (`"No {{name}} payload was returned."`),
  `errors.unable_to_load_data`, `errors.unable_to_load_message`,
  `errors.something_went_wrong`, `errors.try_again`, `common.retry`,
  `cases.title`, `cases.case_details`, `data_tools.pipeline_section_title`,
  `data_tools.recent_job_title`. Anything else must go through
  `t("some.key", { defaultValue: "..." })`.
- **ESLint**: `@typescript-eslint/no-unused-vars` is an **error** (config at
  `frontend/eslint.config.js:24`), so dead props/imports must actually be
  deleted. `no-console` is `['warn', { allow: ['warn', 'error'] }]` —
  `console.error` is permitted.
- **Tests live in `frontend/__tests__/`** (NOT `frontend/src/__tests__/`, which
  does not exist — `CLAUDE.md` is wrong about this). `frontend/vitest.config.ts`
  sets `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]` and a global setup at
  `__tests__/legislations-setup.ts` which mocks `react-i18next` so that
  `t(key, { defaultValue })` returns **the defaultValue**, and `t(key)` returns
  **the key string**. Write assertions accordingly.
- **Test exemplars**: `frontend/__tests__/case-detail-page.test.tsx` (hoisted
  `vi.hoisted` mock factories + `vi.mock("@/hooks/...")` + render inside
  `QueryClientProvider` + `BrowserRouter`) and
  `frontend/__tests__/llm-council-sessions-page.test.tsx` (mocking
  `@/hooks/use-llm-council-sessions` and `sonner`).
- **Commits**: `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.

## Commands you will need

Run every one of these from
`/Users/d/Developer/Active Projects/IMMI-Case-` unless the command itself
`cd`s elsewhere.

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend unit tests (full) | `cd frontend && npx vitest run` | exit 0; **490 passed / 55 files** before your changes, more after |
| One test file | `cd frontend && npx vitest run __tests__/<name>.test.tsx` | exit 0, all pass |
| Typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Lint | `cd frontend && npm run lint` | exit 0; **0 errors**, 25 warnings before your changes, 24 after |
| Production build | `cd frontend && npm run build` | exit 0 |
| Files you changed | `git status --short` | only in-scope paths listed |

**Do NOT use `make typecheck` or bare `npx tsc --noEmit`.** `frontend/tsconfig.json`
is a project-references stub with `files: []`; the bare form exits 0 while
loading **zero** files and will happily "pass" on broken code. Always use
`npx tsc -b --noEmit`. (Plan 001 fixes the Makefile target; this plan does
not.)

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/pages/CaseDetailPage.tsx` (modify)
- `frontend/src/components/llm-council/StreamingCouncilView.tsx` (modify)
- `frontend/src/contexts/AuthContext.tsx` (modify)
- `frontend/src/pages/LlmCouncilSessionsPage.tsx` (modify)
- `frontend/src/pages/DataToolsPage.tsx` (modify)
- `frontend/src/App.tsx` (modify)
- `frontend/src/components/shared/RouteErrorBoundary.tsx` (**create**)
- `frontend/src/components/auth/TelegramLoginButton.tsx` (modify)
- `frontend/src/pages/LoginPage.tsx` (modify)
- `frontend/__tests__/case-detail-error-state.test.tsx` (**create**)
- `frontend/__tests__/council-stream-error-state.test.tsx` (**create**)
- `frontend/__tests__/auth-refresh-recovery.test.tsx` (**create**)
- `frontend/__tests__/session-delete-error.test.tsx` (**create**)
- `frontend/__tests__/data-tools-poll-errors.test.tsx` (**create**)
- `frontend/__tests__/route-error-boundary.test.tsx` (**create**)

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/pages/LlmCouncilPage.tsx`. It owns the `hasStreamed` gate
  (`:788-792`) that decides whether `StreamingCouncilView` mounts at all, and
  the dead `try/catch` around `stream.start()` (`:839-851`) feeding the
  `<ApiErrorState>` at `:956`. Fixing the *pre-stream* HTTP-error path requires
  changing that gate. See "Findings reconsidered" — that remainder is
  deliberately deferred.
- `frontend/src/hooks/use-cases.ts`, `frontend/src/hooks/use-llm-council-sessions.ts`.
  Adding `onError` inside the shared hooks would change behaviour for every
  other caller. Handle errors at the call site instead.
- `frontend/src/components/llm-council/SessionListItem.tsx` — already has the
  confirm modal and the pending-disabled button. Nothing to fix.
- `frontend/src/components/layout/AppLayout.tsx` — another plan's territory.
  The route-level boundary goes in the route *element* (which `App.tsx` owns),
  not inside the layout.
- `frontend/src/i18n/locales/en.json` / `zh-TW.json` — use existing keys or the
  `defaultValue` pattern. Do not add keys.
- `frontend/src/lib/api.ts` — adding a global 401→refresh interceptor is a real
  improvement but belongs to a different plan; it is claimed by plans 005 and
  007.
- `frontend/tsconfig*.json`, `frontend/vitest.config.ts`,
  `frontend/package.json`, `frontend/eslint.config.js` — owned by plan 001/002.
- Any existing file under `frontend/__tests__/` — plan 001 is rewriting a
  specific list of them. Create new test files only.
- The `// eslint-disable-next-line react-refresh/only-export-components` at
  `StreamingCouncilView.tsx:388` that currently reports "Unused eslint-disable
  directive". Leave it; it is not this plan's warning.

## Git workflow

- Branch: `advisor/015-surface-frontend-errors` (create from `main`).
- Commit per step, message style `<type>: <description>`, e.g.
  `fix: show an error state when the case detail fetch fails`.
- Do **NOT** push, do NOT open a PR, do NOT merge. The operator commits and
  ships.

## Steps

### Step 1: Give `CaseDetailPage` real error and not-found branches

In `frontend/src/pages/CaseDetailPage.tsx`:

1. Add the import for the error component immediately after the existing
   `PageLoader` import (which is on **line 26**):
   `import { ApiErrorState } from "@/components/shared/ApiErrorState";`
2. Change line 39 from
   `const { data, isLoading } = useCase(id ?? "");`
   to
   `const { data, isLoading, isError, error, refetch } = useCase(id ?? "");`
3. Replace the single guard at line 90 with three ordered guards. Model the
   shape on `JudgeDetailPage.tsx:44-88`:

```tsx
  if (isLoading) {
    return <PageLoader />;
  }

  if (isError) {
    return (
      <div className="space-y-4" data-testid="case-detail-error">
        <Breadcrumb
          items={[
            { label: t("cases.title"), href: "/cases" },
            { label: t("cases.case_details") },
          ]}
        />
        <ApiErrorState
          title={t("errors.failed_to_load", { name: t("cases.case_details") })}
          message={
            error instanceof Error
              ? error.message
              : t("errors.unable_to_load_message")
          }
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" data-testid="case-detail-not-found">
        <Breadcrumb
          items={[
            { label: t("cases.title"), href: "/cases" },
            { label: t("cases.case_details") },
          ]}
        />
        <ApiErrorState
          title={t("errors.failed_to_load", { name: t("cases.case_details") })}
          message={t("errors.payload_error", { name: t("cases.case_details") })}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }
```

`Breadcrumb` is already imported at line 20; `t` is already in scope from
line 36 (`const { t } = useTranslation();`). Leave everything below
(`const c = data.case;` onward) untouched.

Then create `frontend/__tests__/case-detail-error-state.test.tsx`. Copy the
mock scaffolding verbatim from `frontend/__tests__/case-detail-page.test.tsx`
lines 1-104 (the `vi.hoisted` factories, the four `vi.mock` calls for
`@/hooks/use-cases`, `@/hooks/use-similar-cases`, `@/hooks/use-bookmarks`,
`react-router-dom`, the `CaseTextViewer` / `BookmarkButton` stubs, and
`makeQueryClient` / `renderPage`). Then add three tests:

- `mockUseCase` returns
  `{ data: undefined, isLoading: false, isError: true, error: new Error("HTTP 503: cloudflare_route_unavailable"), refetch: vi.fn() }`
  → `screen.getByTestId("case-detail-error")` exists and
  `screen.getByText(/cloudflare_route_unavailable/)` is in the document.
- Same state, then `fireEvent.click(screen.getByText("Retry"))` → the `refetch`
  mock was called once. (The i18n mock returns the key for `t("common.retry")`,
  so if `"Retry"` is not found, query by `screen.getByText("common.retry")` —
  check which one the render produces and assert on that; do not assert on
  both.)
- `mockUseCase` returns
  `{ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }`
  → `screen.getByTestId("case-detail-not-found")` exists and
  `screen.queryByText("Loading")` is `null`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/case-detail-error-state.test.tsx __tests__/case-detail-page.test.tsx
```
→ exit 0, 3 new tests pass and every pre-existing `case-detail-page` test still
passes.

### Step 2: Make a dead or aborted council stream terminal and visible

In `frontend/src/components/llm-council/StreamingCouncilView.tsx`:

1. **Hook — abort branch.** Replace lines 353-356:

```tsx
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          return curr;
        }
```

with:

```tsx
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          // Watchdog fired (90s of silence) or the connection was cut. Without
          // a terminal status the header spins "Council deliberating" forever.
          // NOTE: update() is a no-op when this run has been superseded by a
          // newer start(), which is exactly what we want — a restart must not
          // paint the fresh run red.
          update({
            ...curr,
            council: {
              status: "error",
              error:
                "The council stream stopped responding (timed out after 90 seconds or the connection dropped). Try sending the question again.",
            },
          });
          return curr;
        }
```

Leave the non-abort arm below it exactly as it is — it already sets
`council.status = "error"`.

2. **Component — surface the error and stop the spinner.** After the
   `allExpertsFinal` block (currently ending at line 599) add:

```tsx
  const councilFailed = state.council.status === "error";
  const councilBusy =
    !councilFailed &&
    (state.council.status === "running" || !allExpertsFinal);
```

3. Replace the header `<div className="flex items-center gap-2">` block
   (lines 604-617) with:

```tsx
        <div className="flex items-center gap-2">
          {councilFailed ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          ) : councilBusy ? (
            <div className="animate-spin">
              <Loader2 className="h-3.5 w-3.5 text-accent" />
            </div>
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {councilFailed
              ? "Council run failed"
              : councilBusy
                ? "Council deliberating"
                : "Panel finished — synthesising"}
          </span>
        </div>
```

4. Immediately after the elapsed-time `<span>` (line 618-620) and still inside
   the same header `<div className="flex flex-wrap …">`, add the error strip.
   It reuses the amber palette already used by `ExpertColumn` at lines 466-470,
   and `w-full` makes it wrap to its own line inside the `flex-wrap` row:

```tsx
        {councilFailed ? (
          <p
            data-testid="council-stream-error"
            className="w-full break-words rounded-md border border-amber-300/40 bg-amber-50/30 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300"
          >
            {state.council.error || "unknown error"}
          </p>
        ) : null}
```

`AlertTriangle`, `Loader2` and `CheckCircle2` are all already imported at line
21. Do not change `allExpertsFinal` — it already treats `"error"` as terminal.

Then create `frontend/__tests__/council-stream-error-state.test.tsx`. This
component takes a plain `state` prop, so no hook mocking is required — build a
`CouncilStreamState` literal and render `<StreamingCouncilView state={...} />`
directly. Cover:

- `council: { status: "error", error: "boom" }` with all three experts left at
  `status: "streaming"` → `screen.getByTestId("council-stream-error")` shows
  `"boom"`, `screen.getByText("Council run failed")` exists, and
  `screen.queryByText("Council deliberating")` is `null`.
- `council: { status: "running" }` with experts `"pending"` →
  `screen.getByText("Council deliberating")` exists and
  `screen.queryByTestId("council-stream-error")` is `null`.
- `council: { status: "done" }` with all three experts `"done"` →
  `screen.getByText("Panel finished — synthesising")` exists and no error strip.

Import the `CouncilStreamState` type from
`@/components/llm-council/StreamingCouncilView` and write a
`makeState(overrides)` helper so each case is one line. The component starts a
500 ms `setInterval` for the elapsed clock — call `vi.useFakeTimers()` in
`beforeEach` and `vi.useRealTimers()` in `afterEach`, or simply let RTL's
`cleanup` unmount it (the global setup already calls `cleanup()` after each
test); prefer the latter and do not advance timers.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/council-stream-error-state.test.tsx
```
→ exit 0, 3 tests pass.

### Step 3: Make `AuthContext.refresh()` retry, then sign out visibly

In `frontend/src/contexts/AuthContext.tsx`:

1. Add a module-level constant just below the imports (after line 11):

```tsx
/** Backoff for transient refresh failures (network down, sleep/wake, Worker
 *  cold start). After the last one is exhausted we sign the user out for real
 *  rather than leaving a UI that renders as signed-in against 401ing APIs. */
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];
```

2. Add a counter ref next to `refreshRef` (after line 34):

```tsx
  const refreshRetryCountRef = useRef(0);
```

3. In `refresh`, reset the counter on **both** definitive outcomes. Inside the
   `if (!res.ok) {` block add `refreshRetryCountRef.current = 0;` as the first
   statement; on the success path add `refreshRetryCountRef.current = 0;`
   immediately before `scheduleRefresh(data.access_token);`.

4. Replace the `catch { return false; }` at lines 73-75 with:

```tsx
    } catch {
      // Transient failure (no HTTP status at all). Retry on a bounded backoff
      // instead of silently abandoning the session — scheduleRefresh() is the
      // ONLY other place that re-arms this timer and it is unreachable from
      // here. Reuse refreshTimerRef so the unmount cleanup still clears it.
      const attempt = refreshRetryCountRef.current;
      if (attempt < REFRESH_RETRY_DELAYS_MS.length) {
        refreshRetryCountRef.current = attempt + 1;
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          refreshRef.current?.();
        }, REFRESH_RETRY_DELAYS_MS[attempt]);
        return false;
      }
      refreshRetryCountRef.current = 0;
      setState((s) => ({
        ...s,
        user: null,
        tenant: null,
        tenants: [],
        accessToken: null,
        isAuthenticated: false,
      }));
      clearAuthCookies();
      setApiAccessToken(null);
      return false;
    }
```

**Do not change the `useCallback` dependency array of `refresh`.** It must stay
`[scheduleRefresh]`; `refresh` is itself a dependency of the mount effect at
line 117, and adding state to its deps would re-run session restore on every
render. Refs are correct here precisely because they do not participate in
deps.

Then create `frontend/__tests__/auth-refresh-recovery.test.tsx`:

- Build a synthetic JWT the way `frontend/__tests__/auth/auth-utils.test.ts:20-32`
  does (`encodeB64url` + `makeToken`), with `exp` far in the future
  (`Math.floor(Date.now() / 1000) + 86400`) so the mount-time
  `scheduleRefresh` parks a long timer that never interferes.
- Stub `global.fetch` with `vi.fn()`. For `/api/v1/auth/me` resolve
  `{ ok: true, json: async () => ({ user: {...}, tenant: {...}, tenants: [], access_token: token }) }`.
  For `/api/v1/auth/refresh` **reject** with `new TypeError("Failed to fetch")`.
- Render `<AuthProvider><Probe /></AuthProvider>` where `Probe` calls
  `useAuth()` and writes the context object into a mutable outer variable, and
  renders `String(ctx.isAuthenticated)` into a `data-testid="is-auth"` node.
- `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`.
- Test A: after mount, `await act(async () => { await ctx.refresh(); })` →
  returns `false`, `is-auth` still reads `"true"`, and
  `vi.getTimerCount()` is greater than 0 (a retry was scheduled).
- Test B: call `refresh()` four times in sequence (three retries + the
  exhausting call) → after the fourth, `is-auth` reads `"false"`.
- Test C: `refresh()` once (fails, counter = 1), then flip the fetch stub so
  `/api/v1/auth/refresh` resolves `{ ok: true, json: async () => ({ access_token: token }) }`,
  call `refresh()` → returns `true`; then flip back to rejecting and call
  `refresh()` three more times → `is-auth` is still `"true"` (the counter was
  reset by the success, so three failures are not yet exhausting).

Import `act` from `@testing-library/react`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/auth-refresh-recovery.test.tsx
```
→ exit 0, 3 tests pass.

### Step 4: Surface session-delete failures

In `frontend/src/pages/LlmCouncilSessionsPage.tsx`:

1. Add `import { toast } from "sonner";` after the `lucide-react` import
   (line 18).
2. Replace `handleDelete` (lines 61-63) with:

```tsx
  function handleDelete(sessionId: string) {
    // SessionListItem already ran its own ConfirmModal before calling us.
    // Without this onError a refused delete is completely silent: the row
    // stays on screen and the user just clicks again.
    deleteSession.mutate(sessionId, {
      onError: (err) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t("llm_council.session_delete_failed", {
                defaultValue: "Failed to delete session.",
              });
        toast.error(message);
      },
    });
  }
```

Do **not** add a `ConfirmModal` here — `SessionListItem` already has one.

Then create `frontend/__tests__/session-delete-error.test.tsx`. Reuse the mock
scaffolding from `frontend/__tests__/llm-council-sessions-page.test.tsx`
lines 19-60 (the `react-router-dom` `useNavigate` mock, the
`@/hooks/use-llm-council-sessions` mock exposing `useLlmCouncilSessions` /
`useDeleteSession`, and `vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))`).
Cover:

- Render the page with one session; make `useDeleteSession` return
  `{ mutate: mockMutate, isPending: false, variables: undefined }`. Click
  `screen.getByTestId("session-delete-btn")`, then click the confirm control
  inside the modal (query it by its label `"Delete"`), and assert `mockMutate`
  was called with `("abc123def456", expect.objectContaining({ onError: expect.any(Function) }))`.
- Take the `onError` callback out of `mockMutate.mock.calls[0][1]`, invoke it
  with `new Error("D1_ERROR: no such table")`, and assert
  `toast.error` was called with `"D1_ERROR: no such table"`.
- Invoke the same `onError` with `new Error("")` and assert `toast.error` was
  called with `"Failed to delete session."` (the i18n mock returns
  `defaultValue`).

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/session-delete-error.test.tsx __tests__/llm-council-sessions-page.test.tsx
```
→ exit 0, 3 new tests pass and every pre-existing sessions-page test still
passes.

### Step 5: Stop `DataToolsPage` from fabricating a healthy pipeline

In `frontend/src/pages/DataToolsPage.tsx`:

1. Add `import { ApiErrorState } from "@/components/shared/ApiErrorState";`
   after the `PageHeader` import (line 23). Do **not** import anything new from
   `@/lib/api` — `frontend/__tests__/system-pages.test.tsx:24-27` mocks that
   module with exactly two exports and any new named import from it would make
   that suite fail.
2. Change the two `useQuery` destructures (lines 83 and 92) to keep the error
   channel:

```tsx
  const {
    data: pipelineStatus,
    isError: pipelineIsError,
    error: pipelineError,
    refetch: refetchPipeline,
  } = useQuery<PipelineStatus>({
```

```tsx
  const {
    data: jobStatus,
    isError: jobIsError,
    refetch: refetchJob,
  } = useQuery<JobStatus>({
```

Leave each query's `queryKey` / `queryFn` / `refetchInterval` untouched.

3. In §2 (the block that currently reads `{running ? ( … ) : ( idle card )}` —
   it opens with `        {running ? (` at line **221** and closes with
   `        )}` at line **360**, immediately before `      </section>` at 361),
   add a leading error arm so the fabricated idle card is never shown while the
   poll is failing:

```tsx
        {pipelineIsError ? (
          <div data-testid="pipeline-status-error">
            <ApiErrorState
              title={t("errors.failed_to_load", {
                name: t("data_tools.pipeline_section_title"),
              })}
              message={
                pipelineError instanceof Error
                  ? pipelineError.message
                  : t("errors.unable_to_load_message")
              }
              onRetry={() => {
                void refetchPipeline();
              }}
            />
          </div>
        ) : running ? (
```

…and leave the existing `running` arm and idle arm as the remaining branches.

4. In §3, wrap the job card in the same shape. The card is exactly
   `src/pages/DataToolsPage.tsx` lines **372-481**: it opens with
   `        <div className="rounded-lg border border-border bg-card p-5">` at
   372 and its matching `        </div>` is at 481, immediately before
   `      </section>` at 482. Wrap those 110 lines unchanged as the `else` arm:

```tsx
        {jobIsError ? (
          <div data-testid="job-status-error">
            <ApiErrorState
              title={t("errors.failed_to_load", {
                name: t("data_tools.recent_job_title"),
              })}
              onRetry={() => {
                void refetchJob();
              }}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            {/* …existing job card, unchanged… */}
          </div>
        )}
```

Then create `frontend/__tests__/data-tools-poll-errors.test.tsx`. Reuse the
scaffolding from `frontend/__tests__/system-pages.test.tsx` lines 1-62
(`vi.hoisted` factories, the `@/hooks/use-stats` and `@/lib/api` mocks, the
`StatCard` stub, `makeQueryClient` with `retry: false`, `renderWithProviders`).
Cover:

- `mockFetchPipelineStatus.mockRejectedValue(new Error("HTTP 503: cloudflare_route_unavailable"))`,
  job status resolving normally → `await screen.findByTestId("pipeline-status-error")`
  exists and `screen.queryByText("data_tools.pipeline_idle_title")` is `null`.
- Both resolving normally → `screen.queryByTestId("pipeline-status-error")` is
  `null` and `screen.getByText("data_tools.pipeline_idle_title")` exists (this
  is the regression guard for the healthy path).
- `mockFetchJobStatus.mockRejectedValue(new Error("boom"))`, pipeline resolving
  normally → `await screen.findByTestId("job-status-error")` exists and
  `screen.queryByText("data_tools.no_recent_job")` is `null`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/data-tools-poll-errors.test.tsx __tests__/system-pages.test.tsx
```
→ exit 0, 3 new tests pass and all pre-existing `system-pages` tests still
pass (in particular "shows pipeline idle state when pipeline is not running"
and "shows no recent job label when no job is active").

### Step 6: Add a route-level error boundary that resets, logs, and hides stacks

Create `frontend/src/components/shared/RouteErrorBoundary.tsx`:

```tsx
/**
 * frontend/src/components/shared/RouteErrorBoundary.tsx
 *
 * Two exports:
 *   ErrorBoundary  — the class boundary. `scope="app"` is the last-resort
 *                    full-screen version at the root of App; `scope="route"`
 *                    is the per-route version that sits INSIDE AppLayout's
 *                    <Outlet>, so a crashed page leaves the nav usable.
 *   RouteBoundary  — <ErrorBoundary scope="route"> + <Suspense> in one
 *                    wrapper, keyed on the pathname so navigating away clears
 *                    a previous crash.
 *
 * Raw stacks are gated behind import.meta.env.DEV — the production user of
 * this app is a self-representing immigration applicant, not a developer.
 */
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { StatePanel } from "@/components/shared/StatePanel";
import { PageLoader } from "@/components/shared/PageLoader";

interface ErrorBoundaryProps {
  children: ReactNode;
  scope?: "app" | "route";
  /** When this value changes and an error is showing, the boundary resets. */
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary:${this.props.scope ?? "app"}]`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isApp = (this.props.scope ?? "app") === "app";

    return (
      <div
        data-testid={isApp ? "app-error-boundary" : "route-error-boundary"}
        className={
          isApp
            ? "flex min-h-screen items-center justify-center bg-background px-6 py-10"
            : "px-1 py-6"
        }
      >
        <StatePanel
          tone="error"
          align="start"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Something went wrong on this screen"
          description="The page could not be displayed. You can try again, or reload the app if the problem persists."
          className="max-w-3xl"
          action={
            <>
              <button
                type="button"
                data-testid="error-boundary-retry"
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-danger/25 bg-background-card px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
              >
                Try again
              </button>
              <button
                type="button"
                data-testid="error-boundary-reload"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface"
              >
                Reload page
              </button>
            </>
          }
        >
          {import.meta.env.DEV ? (
            <pre
              data-testid="error-boundary-stack"
              className="overflow-x-auto rounded-xl border border-danger/15 bg-background px-4 py-3 font-mono text-xs leading-6 text-danger"
            >
              {error.message}
              {"\n\n"}
              {error.stack}
            </pre>
          ) : null}
        </StatePanel>
      </div>
    );
  }
}

export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary scope="route" resetKey={location.pathname}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
```

The `<pre>` is DEV-gated using the same idiom already in the repo at
`frontend/src/pages/DashboardPage.tsx:154` (`if (!import.meta.env.DEV || …) return;`).
The two action buttons reuse the exact button classes from
`frontend/src/components/shared/ApiErrorState.tsx` — no new magic numbers.

Then rewire `frontend/src/App.tsx`:

1. Delete the inline `class ErrorBoundary { … }` (lines 12-44 in full).
2. Delete three whole import lines, each of which imports only a symbol the
   class was the sole user of — line 5 (`import { AlertTriangle } from "lucide-react";`),
   line 7 (`import { PageLoader } from "@/components/shared/PageLoader";`) and
   line 8 (`import { StatePanel } from "@/components/shared/StatePanel";`) —
   and shrink line 1 from
   `import { lazy, Suspense, Component, type ReactNode } from "react";`
   to `import { lazy } from "react";`. Verified at `42826a3`: after Step 6
   nothing else in `App.tsx` references `AlertTriangle`, `StatePanel`,
   `PageLoader`, `Component`, `ReactNode` or `Suspense`.
3. Add
   `import { ErrorBoundary, RouteBoundary } from "@/components/shared/RouteErrorBoundary";`
   after the `AuthProvider` import.
4. Replace all 28 Suspense wrappers mechanically:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  perl -0pi -e 's/<Suspense fallback=\{<PageLoader \/>\}>/<RouteBoundary>/g; s/<\/Suspense>/<\/RouteBoundary>/g' src/App.tsx
```

5. Leave `<ErrorBoundary>` wrapping the whole tree at line 178 (and its closer
   at line 432) exactly where they are — the imported class now defaults to
   `scope="app"`, which reproduces the old full-screen behaviour plus logging,
   a reset button and the DEV gate.

Then create `frontend/__tests__/route-error-boundary.test.tsx` importing
`{ ErrorBoundary, RouteBoundary }` from
`@/components/shared/RouteErrorBoundary` (**not** from `@/App` — importing App
pulls the whole page graph). Use a `Boom` component that throws, and silence
React's expected `console.error` noise with
`vi.spyOn(console, "error").mockImplementation(() => {})` in `beforeEach`.
Cover:

- `<ErrorBoundary scope="route"><Boom /></ErrorBoundary>` →
  `screen.getByTestId("route-error-boundary")` exists and
  `screen.getByText("Something went wrong on this screen")` is present.
- Clicking `screen.getByTestId("error-boundary-retry")` after rendering a
  component that throws only on its first render → the child renders normally
  (proves the reset path works).
- `resetKey` change clears the error: render
  `<ErrorBoundary scope="route" resetKey="/a"><Boom /></ErrorBoundary>`, then
  `rerender(<ErrorBoundary scope="route" resetKey="/b"><span>ok</span></ErrorBoundary>)`
  → `screen.getByText("ok")` is present and
  `screen.queryByTestId("route-error-boundary")` is `null`.
- `console.error` was called with a first argument matching
  `/\[ErrorBoundary:route\]/`.
- `RouteBoundary` renders its children when nothing throws — wrap it in
  `<MemoryRouter>` (it calls `useLocation`) and assert the child text is
  visible.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c "<RouteBoundary>" src/App.tsx && \
  grep -c "Suspense" src/App.tsx && \
  npx vitest run __tests__/route-error-boundary.test.tsx && \
  npx tsc -b --noEmit
```
→ `28`, then `0`, then all boundary tests pass, then `tsc` exits 0 with no
output.

### Step 7: Delete the dead Telegram callbacks and fix the ref-cleanup warning

In `frontend/src/components/auth/TelegramLoginButton.tsx`:

1. Delete `onSuccess` and `onError` from `TelegramLoginButtonProps`
   (lines 5-6), from the destructured parameter list (lines 18-19), and delete
   the two `void` statements (lines 23-24). The props are unfireable because
   the widget is configured with `data-auth-url` at line 43 — the full-page
   redirect flow. Add one comment where the props used to be so nobody
   re-adds them:

```tsx
// NOTE: no onSuccess/onError props. The widget below uses `data-auth-url`
// (full-page redirect to /api/v1/auth/telegram/callback), so Telegram never
// invokes a JS callback. Failures come back as the ?auth_error query param,
// which LoginPage reads. If a popup-mode variant is ever added, callbacks can
// come back with it.
```

2. Fix the `react-hooks/exhaustive-deps` warning at line 50 by copying
   `ref.current` into a local at the top of the effect and using the local in
   the cleanup:

```tsx
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // StrictMode guard: avoid double-mounting the script
    if (host.childElementCount > 0) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", size);
    script.setAttribute("data-auth-url", authUrl);
    script.setAttribute("data-request-access", "write");
    script.async = true;

    host.appendChild(script);

    return () => {
      host
        .querySelector("script[src^='https://telegram.org/js/telegram-widget.js']")
        ?.remove();
    };
  }, [authUrl, botName, size]);
```

In `frontend/src/pages/LoginPage.tsx`:

3. Delete `handleSuccess` (line 21), `handleError` (line 22), the
   `loginError` state (line 13), and the two props on the
   `<TelegramLoginButton>` element (lines 46-47). Simplify line 24 to:

```tsx
  const visibleError = authError
    ? "Telegram sign-in failed. Please try again."
    : null;
```

4. Remove the now-unused `useCallback` and `useState` imports — line 1 becomes
   `import { useEffect } from "react";`. `@typescript-eslint/no-unused-vars` is
   configured as an **error**, so leaving them will fail lint.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c "onSuccess\|onError" src/components/auth/TelegramLoginButton.tsx src/pages/LoginPage.tsx ; \
  npm run lint 2>&1 | tail -3 && npx tsc -b --noEmit
```
→ both `grep -c` counts are `0`; `npm run lint` reports **0 errors** and **24
warnings** (one fewer than the 25 baseline — the `TelegramLoginButton.tsx:50`
ref warning is gone); `tsc -b --noEmit` exits 0.

### Step 8: Full verification sweep

Run everything together and confirm nothing outside the in-scope list moved.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx tsc -b --noEmit && \
  npm run lint 2>&1 | tail -3 && \
  npx vitest run 2>&1 | tail -8 && \
  npm run build 2>&1 | tail -5
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ `tsc` exits 0; lint reports 0 errors / 24 warnings; vitest reports **at least
508 passed** across **61 files** (490 + 18 new across 6 new files — the exact
new-test count may differ slightly if you split a case, but it must be ≥ 490 +
15 and **zero failures**); `npm run build` exits 0; `git status --short` lists
only the 15 in-scope paths plus this plan file.

## Test plan

Six new files, all under `frontend/__tests__/`, all runnable with
`npx vitest run <path>`:

| File | Covers | Cases |
|---|---|---|
| `case-detail-error-state.test.tsx` | FECORR-04 | fetch error renders `ApiErrorState`; Retry calls `refetch`; `data === undefined` with no error renders the not-found branch, not a spinner |
| `council-stream-error-state.test.tsx` | FECORR-02 | `council.status === "error"` with experts still `"streaming"` shows the error strip and *not* "Council deliberating"; running state still spins; done state still shows "Panel finished" |
| `auth-refresh-recovery.test.tsx` | FECORR-07 | one network failure schedules a retry and keeps `isAuthenticated`; four consecutive failures sign the user out; a success in between resets the counter |
| `session-delete-error.test.tsx` | FECORR-13 (delete) | `mutate` is called with an `onError`; a real error message reaches `toast.error`; an empty message falls back to the default copy |
| `data-tools-poll-errors.test.tsx` | FECORR-13 (polling) | failing pipeline poll shows the error card and suppresses the fabricated idle card; healthy path still shows idle (regression guard); failing job poll shows its error card |
| `route-error-boundary.test.tsx` | FECORR-09 | a route crash renders the route-scoped panel; Retry resets; a `resetKey` change resets; `componentDidCatch` logs with the scoped prefix; `RouteBoundary` passes children through |

Structural patterns to copy: `frontend/__tests__/case-detail-page.test.tsx`
(hoisted mock factories + provider wrapper),
`frontend/__tests__/llm-council-sessions-page.test.tsx` (hook + `sonner`
mocks), `frontend/__tests__/system-pages.test.tsx` (`@/lib/api` mock +
`QueryClient` with `retry: false`), `frontend/__tests__/auth/auth-utils.test.ts`
(synthetic JWT construction).

Full-suite verification: `cd frontend && npx vitest run` → 0 failures, count
strictly greater than the 490 baseline.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd frontend && npm run lint` exits 0 with **0 errors** and **24
      warnings** (baseline was 25)
- [ ] `cd frontend && npx vitest run` exits 0 with **0 failures** and a passing
      count strictly greater than 490
- [ ] `cd frontend && npm run build` exits 0
- [ ] `grep -c "<RouteBoundary>" frontend/src/App.tsx` returns `28`
- [ ] `grep -c "Suspense" frontend/src/App.tsx` returns `0`
- [ ] `grep -rn "onSuccess\|onError" frontend/src/components/auth/TelegramLoginButton.tsx frontend/src/pages/LoginPage.tsx` returns no matches
- [ ] `grep -n "isLoading || !data" frontend/src/pages/CaseDetailPage.tsx` returns no matches
- [ ] `grep -n "catch { return false; }" frontend/src/contexts/AuthContext.tsx` returns no matches
- [ ] `grep -rn "council-stream-error\|pipeline-status-error\|job-status-error\|case-detail-error\|route-error-boundary" frontend/src/` returns at least 5 matches
- [ ] `git status --short` lists only the 15 files in the "In scope" list plus
      `plans/015-surface-frontend-errors.md`
- [ ] `plans/README.md` status row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints anything, or any "Current state" excerpt does not
  match the live file byte-for-byte.
- `grep -c "<Suspense fallback={<PageLoader />}>" frontend/src/App.tsx` returns
  anything other than `28` before Step 6's `perl` substitution — a different
  count means the route table changed and the mechanical replacement is unsafe.
- Any **pre-existing** test in `frontend/__tests__/` starts failing. In
  particular `system-pages.test.tsx` ("shows pipeline idle state when pipeline
  is not running", "shows no recent job label when no job is active") and
  `llm-council-sessions-page.test.tsx` (its delete-flow test) are the two
  suites most likely to catch a mistake in Steps 4-5. Do not "fix" them by
  editing them — they belong to plan 001's territory; report instead.
- `npm run lint` reports any **error** (not warning). `no-unused-vars` is an
  error here, so this usually means a leftover import from Step 6 or 7.
- After Step 3, `refresh`'s `useCallback` dependency array is anything other
  than `[scheduleRefresh]`, or the mount effect at `AuthContext.tsx:117` starts
  re-running on every render (symptom: `auth-refresh-recovery.test.tsx` sees
  more `/api/v1/auth/me` fetches than expected).
- The `council.status === "error"` branch you add in Step 2 turns out to fire
  on a normal user-initiated restart (symptom: `council-stream-error-state`
  passes but a manual run shows "Council run failed" immediately after
  re-submitting). The generation guard in `update()` is supposed to prevent
  this — if it does not, stop rather than weakening the guard.
- You discover the assumption **"`state.council.error` is written but never
  read anywhere in `frontend/src/`"** is false — re-check with
  `grep -rn "council\.error\|council\.status" frontend/src/`, which returned
  exactly 8 lines (all in `StreamingCouncilView.tsx` and `LlmCouncilPage.tsx`)
  at commit `42826a3`.
- A fix appears to require editing `frontend/src/pages/LlmCouncilPage.tsx`,
  `frontend/src/hooks/*.ts`, `frontend/src/components/layout/AppLayout.tsx`, or
  the locale JSON files.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **The route boundary's reset depends on `resetKey`.** `RouteBoundary` feeds
  it `useLocation().pathname`. If a future refactor renders `RouteBoundary`
  outside a router, `useLocation` throws and the whole shell breaks. Keep it
  inside `<BrowserRouter>`.
- **The top-level `<ErrorBoundary>` still wraps `BrowserRouter`.** That is
  deliberate — it is the last resort for a crash in `AuthProvider` /
  `QueryClientProvider` themselves. But it means a crash *there* is still
  unrecoverable except by reload; that is what the "Reload page" button is for.
- **Stack traces are now DEV-only.** If you need production diagnostics, wire
  `componentDidCatch` to a real sink (Sentry, Cloudflare Logpush) rather than
  un-gating the `<pre>`.
- **The refresh backoff is 5s / 15s / 45s, then a hard sign-out.** If the
  Worker's cold-start p99 ever exceeds ~65 s, users on a slow link will get
  signed out spuriously — widen `REFRESH_RETRY_DELAYS_MS` rather than removing
  the sign-out, because "signed-in UI + 401ing APIs" is the worse failure.
- **`frontend/src/lib/api.ts` still has no 401 handling and nothing outside
  `AuthContext` consumes `useAuth().refresh`.** A global 401→refresh→retry
  interceptor is the real fix for expired-token requests; it is deliberately
  deferred here because that file is claimed by plans 005 and 007.
- **What a reviewer should scrutinise**: (1) the 28-way `perl` substitution in
  `App.tsx` — diff it line by line, a stray `</Suspense>` left behind will not
  compile but a *mismatched nesting* might; (2) that Step 3 did not change
  `refresh`'s dependency array; (3) that Step 5 did not add a named import from
  `@/lib/api` (it would break `system-pages.test.tsx`).
- **Deferred out of this plan** (see "Findings reconsidered"): the pre-stream
  HTTP-failure path in `LlmCouncilPage`, and `LoginPage`'s remaining hardcoded
  English strings (that page uses no i18n at all today — converting it is a
  separate, self-contained job).

## Findings reconsidered

- **FECORR-02, the pre-stream half — real, but not fixable inside this plan's
  file territory.** When `POST /api/v1/llm-council/stream` returns non-2xx
  *before any provider event arrives*, `start()` sets `council.status = "error"`
  at `StreamingCouncilView.tsx:357-360` and my Step 2 change makes that
  renderable — but `StreamingCouncilView` never mounts, because
  `LlmCouncilPage.tsx:788-792` gates the whole visualisation on
  `hasStreamed = stream.isStreaming || any expert status !== "pending"`, which
  is `false` in exactly that case, and the `<ApiErrorState>` at
  `LlmCouncilPage.tsx:956` is fed only by the `catch` at `:843` — which is dead
  because `start()` swallows everything and returns `curr` instead of
  rethrowing. Both the gate and the dead catch live in
  `frontend/src/pages/LlmCouncilPage.tsx`, which is out of scope. The
  mid-stream-drop and watchdog-abort cases — the ones that actually produce the
  endless "Council deliberating" spinner — **are** fixed by Step 2.
- **FECORR-13's "no confirmation" and "no spinner" claims are false and are
  not acted on.** `SessionListItem.tsx:46-58` already owns a `pendingDeleteId`
  state and renders its own `<ConfirmModal>` at `:110-118`, and
  `LlmCouncilSessionsPage.tsx:138-141` already passes
  `isDeleting={deleteSession.isPending && deleteSession.variables === session.session_id}`,
  which disables the button while the mutation is in flight. Adding a second
  modal at page level, as the original fix sketch proposed, would double-prompt
  the user. Only the missing error surface is real, and Step 4 fixes exactly
  that.
- **The suggested "treat `error` as terminal in `allExpertsFinal`" change is a
  no-op.** `StreamingCouncilView.tsx:593-599` already excludes only `"pending"`
  and `"streaming"`, so `"error"` and `"done"` are both already terminal. No
  edit made there.
- **`useDeleteSession` line number corrected**: it is declared at
  `frontend/src/hooks/use-llm-council-sessions.ts:127`, not 130. Immaterial —
  that file is out of scope either way.
