# Plan 015: Replace infinite spinners and silent failures with real error states

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, report the new status for this plan's
> row in `plans/README.md`. **Do not edit `plans/README.md` yourself if you are
> one of several agents running plans 015–018 in parallel** — all four touch
> adjacent rows of the same table and the integration coordinator writes them.
> Edit it only if you are running this plan alone.
>
> **Drift check (run first)**:
>
> `git diff 42826a3..HEAD` cannot see uncommitted, staged or untracked work, so
> a dirty tree would otherwise give you a false all-clear. Run **all four**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE='frontend/src/App.tsx
> frontend/src/contexts/AuthContext.tsx
> frontend/src/pages/CaseDetailPage.tsx
> frontend/src/pages/DataToolsPage.tsx
> frontend/src/pages/LlmCouncilSessionsPage.tsx
> frontend/src/pages/LoginPage.tsx
> frontend/src/components/auth/TelegramLoginButton.tsx
> frontend/src/components/llm-council/StreamingCouncilView.tsx'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${SCOPE[@]}"          # committed drift
> git diff --stat -- "${SCOPE[@]}"                        # unstaged drift
> git diff --cached --stat -- "${SCOPE[@]}"               # staged drift
> ```
>
> Expected: the last three print nothing, and `git status --short --branch`
> lists no in-scope path. If **any** in-scope file appears in any of the four,
> treat it as a STOP condition: compare the "Current state" excerpts below
> against the live code and report before proceeding.
>
> **Never run `git checkout --` or `git clean -f` to "clean" the tree.** Those
> destroy the operator's or a parallel agent's uncommitted work. Report and stop
> instead.
>
> Also record the pre-existing dirt so the Step 8 scope assertion can subtract
> it rather than mistaking it for your own output:
>
> ```bash
> git status --porcelain=v1 -uall > /tmp/immi-015-baseline-status.txt
> wc -l < /tmp/immi-015-baseline-status.txt
> ```

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

### Sequencing — read before dispatching this plan in parallel

Three hard couplings were found by cross-plan review. Violating any of them
produces a broken merge, not just a conflict:

1. **`frontend/src/components/llm-council/StreamingCouncilView.tsx` has exactly
   one owner at a time.** This plan's Step 2 rewrites the `catch` arm of
   `start()`; `plans/017-fix-frontend-async-and-navigation.md` Steps 7–9 rewrite
   the `finally` arm of the *same* `try/catch/finally` and `RecallCodeCard` in
   the same file. They are not separable by a merge tool. **Run 017 Steps 7–9
   first, then this plan's Step 2**, or give both regions to one agent. Step 2
   below assumes 017's generation-guarded `finally` and its unmount-cleanup
   change may already be present and tells you what to do either way.
2. **`frontend/src/pages/LoginPage.tsx`: this plan runs BEFORE
   `plans/018-complete-the-i18n-catalogue.md`.** Step 7 here deletes the dead
   `onSuccess`/`onError` callbacks; 018 Step 3 adds `useTranslation`,
   `role="alert"` and `font-heading` on top of the callback-free file. 018 has
   been revised to depend on this plan. Do not reorder them — 018's file listing
   is written against the post-Step-7 shape.
3. **`plans/018` runs LAST of the four frontend plans in this group.** Its
   missing-key gate and its hardcoded-attribute ratchet are computed against a
   tree that already contains this plan's new strings. Two specific
   cross-references you must not break:
   - Step 4 below calls `t("llm_council.session_delete_failed", …)`. 018 defines
     that key in both locale files. If 018 lands first without it, 018's gate #2
     fails the moment this plan lands.
   - Step 6 below creates
     `frontend/src/components/shared/RouteErrorBoundary.tsx` with the literal
     `title="Something went wrong on this screen"`. 018's Step 5 ratchet
     allowlists that exact `path::value`. Do not change the wording without
     telling 018.

`plans/README.md` **does exist** (it was created after this plan was written).
Its status table is edited by every plan in this group and is the most likely
merge conflict of all. **Do not edit it yourself when running in parallel** —
report your row's new status and let the integration coordinator write it. Only
edit it if you are running this plan alone.

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
| Frontend unit tests (full) | `cd frontend && npx vitest run` | exit 0, **0 failed**; record the counts as `BEFORE_TESTS` / `BEFORE_FILES` in Step 8 and assert a delta, never an absolute total |
| One test file | `cd frontend && npx vitest run __tests__/<name>.test.tsx` | exit 0, the per-file count named in that step. **Per-file counts are the stable unit here** — they do not move when a sibling plan lands |
| One test by name | `cd frontend && npx vitest run <path> -t "<test name>"` | exit 0, `1 passed` |
| Typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Lint | `cd frontend && npm run lint` | exit 0; **0 errors**; warnings = `BEFORE_WARNINGS - 1` after Step 7 |
| Local-dev build | `cd frontend && npm run build` | exit 0 — writes `../immi_case_downloader/static/react` (Flask surface) |
| **Production build** | `cd frontend && npm run build:cloudflare` | exit 0 — writes `frontend/dist`, which is what `wrangler.toml:15` serves. This is the binding one |
| Files you changed | `git status --porcelain=v1 -uall`, diffed against the Step 0 baseline | only additions, all in-scope paths |

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
  the `try/catch` around `stream.start()` (`:839-851`) feeding the
  `<ApiErrorState>` at `:956`. **That catch is dead only because `start()`
  swallows everything** — Step 2 item 4 makes `start()` rethrow pre-stream
  failures, which brings the existing catch to life with **no edit to this
  file**. Do not edit it; `plans/019` and `plans/023` both claim regions of it.
- `frontend/src/hooks/use-cases.ts`, `frontend/src/hooks/use-llm-council-sessions.ts`.
  Adding `onError` inside the shared hooks would change behaviour for every
  other caller. Handle errors at the call site instead.
- `frontend/src/components/llm-council/SessionListItem.tsx` — already has the
  confirm modal and the pending-disabled button. Nothing to fix.
- `frontend/src/components/layout/AppLayout.tsx` — another plan's territory.
  The route-level boundary goes in the route *element* (which `App.tsx` owns),
  not inside the layout.
- `frontend/src/i18n/locales/en.json` / `zh-TW.json` — use existing keys or the
  `defaultValue` pattern. Do not add keys. This plan introduces exactly **two**
  new key names — `llm_council.session_delete_failed` (Step 4) and
  `errors.stale_data_warning` (Step 5) — both behind `defaultValue`.
  `plans/018-complete-the-i18n-catalogue.md` owns the locale files and has been
  revised to define both. Do not define them yourself.
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

**A correction you must apply — a real 404 never reaches the `!data` branch.**
`useCase` → `fetchCase` (`frontend/src/lib/api.ts:595-599`) → `apiFetch`, and
`apiFetch` **throws an `ApiError`** on any non-OK response
(`frontend/src/lib/api.ts`, the `if (!res.ok) { … throw new ApiError(…) }`
block). So a deleted or mistyped case id lands in `isError` with
`error instanceof ApiError && error.status === 404`, not in
`data === undefined && isError === false`. Branch on the status, not on the
absence of data — otherwise "case not found" is indistinguishable from
"the Worker is down" for the user, and the not-found branch below is only ever
reached by a 2xx with an empty body.

In `frontend/src/pages/CaseDetailPage.tsx`:

1. Add two imports immediately after the existing `PageLoader` import (which is
   on **line 26**):
   ```tsx
   import { ApiErrorState } from "@/components/shared/ApiErrorState";
   import { ApiError } from "@/lib/api";
   ```
   `ApiError` is an exported class (`frontend/src/lib/api.ts:71`), so it is a
   value import, not a type import — do not write `import type`.
2. Change line 39 from
   `const { data, isLoading } = useCase(id ?? "");`
   to
   `const { data, isLoading, isError, error, refetch } = useCase(id ?? "");`
3. Replace the single guard at line 90 with four ordered guards. Model the
   shape on `JudgeDetailPage.tsx:44-88`, plus the 404 discrimination and the
   `role="alert"` live region that exemplar lacks (`ApiErrorState` renders
   through `StatePanel`, which sets **no** ARIA role of its own — verified by
   `grep -n "role=\|aria-" src/components/shared/StatePanel.tsx`, which returns
   nothing — so a dynamically-swapped-in error is otherwise never announced):

```tsx
  if (isLoading) {
    return <PageLoader />;
  }

  const notFound =
    (error instanceof ApiError && error.status === 404) || (!isError && !data);

  if (isError && !notFound) {
    return (
      <div className="space-y-4" data-testid="case-detail-error">
        <Breadcrumb
          items={[
            { label: t("cases.title"), href: "/cases" },
            { label: t("cases.case_details") },
          ]}
        />
        <div role="alert">
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
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-4" data-testid="case-detail-not-found">
        <Breadcrumb
          items={[
            { label: t("cases.title"), href: "/cases" },
            { label: t("cases.case_details") },
          ]}
        />
        <div role="alert">
          <ApiErrorState
            title={t("errors.failed_to_load", { name: t("cases.case_details") })}
            message={t("errors.payload_error", {
              name: t("cases.case_details"),
            })}
            onRetry={() => {
              void refetch();
            }}
          />
        </div>
      </div>
    );
  }

  if (!data) {
    return <PageLoader />;
  }
```

The trailing `if (!data)` guard exists only to narrow `data` for TypeScript
below — every runtime path that could reach it has already returned. Do not
delete it; `strict` is on and `data.case` will not compile without it.

`Breadcrumb` is already imported at line 20; `t` is already in scope from
line 36 (`const { t } = useTranslation();`). Leave everything below
(`const c = data.case;` onward) untouched **except** the `copyCitation` change
in Step 1b.

### Step 1b: Stop `copyCitation` claiming a copy that never happened

Same file, `frontend/src/pages/CaseDetailPage.tsx:79-83` (verbatim at
`42826a3`):

```tsx
  const copyCitation = useCallback(() => {
    if (!data?.case.citation) return;
    navigator.clipboard.writeText(data.case.citation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);
```

Three defects, same family as the recall-code bug that
`plans/017-fix-frontend-async-and-navigation.md` Step 7 fixes in
`StreamingCouncilView`: the promise is never awaited so a rejection is an
unhandled rejection, `setCopied(true)` fires unconditionally so the button lies
in any non-secure context / denied-permission / unfocused-document case, and the
2 s timer is never cleared on unmount or re-copy. **This plan owns this file**,
so fix it here rather than leaving a second behaviour after 017 establishes the
correct shape. Replace with:

```tsx
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    };
  }, []);

  const copyCitation = useCallback(async () => {
    if (!data?.case.citation) return;
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    try {
      await navigator.clipboard.writeText(data.case.citation);
      setCopied(true);
    } catch {
      // navigator.clipboard is undefined outside a secure context, and
      // writeText() rejects on denied permission / unfocused document.
      toast.error(
        t("errors.something_went_wrong", {
          defaultValue: "Could not copy. Select the citation and copy it by hand.",
        }),
      );
    }
    copyResetTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [data, t]);
```

`toast` and `t` are already in scope in this file (it uses both in
`handleDelete`). Add `useRef` / `useEffect` to the existing `react` import if
they are not already there. At the call site, change `onClick={copyCitation}`
to `onClick={() => { void copyCitation(); }}` — the button handler must not
return a promise. The correct shape being reproduced here is
`frontend/src/components/saved-searches/SavedSearchCard.tsx:78-86`, the repo's
one already-correct clipboard call.

Then create `frontend/__tests__/case-detail-error-state.test.tsx`. Copy the
mock scaffolding verbatim from `frontend/__tests__/case-detail-page.test.tsx`
lines 1-104 (the `vi.hoisted` factories, the four `vi.mock` calls for
`@/hooks/use-cases`, `@/hooks/use-similar-cases`, `@/hooks/use-bookmarks`,
`react-router-dom`, the `CaseTextViewer` / `BookmarkButton` stubs, and
`makeQueryClient` / `renderPage`). Then add three tests:

Import `ApiError` from `@/lib/api` in the test too — the 404 case must use a
**real** `ApiError`, not a hand-rolled `{ data: undefined, isError: false }`
state that the production code path can never produce. Cover:

- `mockUseCase` returns
  `{ data: undefined, isLoading: false, isError: true, error: new ApiError("cloudflare_route_unavailable", 503, "cloudflare_route_unavailable"), refetch: vi.fn() }`
  → `screen.getByTestId("case-detail-error")` exists,
  `screen.getByText(/cloudflare_route_unavailable/)` is in the document, and
  `screen.queryByTestId("case-detail-not-found")` is `null`.
- **The real 404 path**: `mockUseCase` returns
  `{ data: undefined, isLoading: false, isError: true, error: new ApiError("Case not found", 404, "not_found"), refetch: vi.fn() }`
  → `screen.getByTestId("case-detail-not-found")` exists and
  `screen.queryByTestId("case-detail-error")` is `null`. This is the assertion
  that fails if someone reverts to branching on `!data`.
- The 503 state again, then `fireEvent.click(screen.getByText("common.retry"))`
  → the `refetch` mock was called once. (The global i18n mock at
  `__tests__/legislations-setup.ts` returns the **key** when there is no
  `defaultValue`, and `ApiErrorState` calls `t("common.retry")` with no
  `defaultValue`, so the rendered text is the literal `common.retry`. Do not
  guess between `"Retry"` and the key — assert on `common.retry`.)
- The error container carries `role="alert"`:
  `expect(screen.getByRole("alert")).toBeTruthy()` in the 503 case.
- `mockUseCase` returns
  `{ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }`
  (a 2xx with an empty body — the only way this state is reachable) →
  `screen.getByTestId("case-detail-not-found")` exists and
  `screen.queryByText("Loading")` is `null`.

Then cover Step 1b in the same file, using the clipboard-stub helper shape from
`plans/017`'s Step 9 test (`Object.defineProperty(navigator, "clipboard", { value, configurable: true, writable: true })`;
jsdom leaves `navigator.clipboard` undefined):

- `writeText` resolves → after `await act(...)` the copy button shows its copied
  state and `toast.error` was **not** called.
- `writeText` rejects with `new Error("denied")` → `toast.error` **was** called
  once and the button did **not** enter its copied state. (Mock `sonner` the way
  `frontend/__tests__/llm-council-sessions-page.test.tsx` does.)

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/case-detail-error-state.test.tsx __tests__/case-detail-page.test.tsx
```
→ exit 0; `case-detail-error-state.test.tsx` reports **7 passed**, and
`case-detail-page.test.tsx` reports the same count it reported before your
change (record it first with
`npx vitest run __tests__/case-detail-page.test.tsx 2>&1 | tail -4`). A per-file
count is stable under parallel plan execution; a whole-suite total is not.

### Step 2: Make a dead or aborted council stream terminal and visible

**A correction you must apply — not every `AbortError` is a timeout.** There are
**three** producers of an `AbortError` in this hook, and they need different
treatment:

| Producer | Location at `42826a3` | Correct outcome |
|---|---|---|
| the 90 s watchdog | `StreamingCouncilView.tsx:220-227`, `controller.abort()` inside the interval | show a terminal timeout error |
| a superseding `start()` | `:194`, `controllerRef.current?.abort()` at the top of the next run | show nothing (`update()` is already a no-op for the superseded generation) |
| **component unmount** | `:372-376`, `return () => { controllerRef.current?.abort(); }` | show nothing, and touch no state |

The unmount case is the one a naive "AbortError means timeout" branch gets
wrong. On unmount the generation is **not** bumped, so `myGen === genRef.current`
still holds and `update()` is **not** a no-op: it would call `setState` on an
unmounting component and, worse, assert a timeout that did not happen. Fix both
halves — record the timeout explicitly, and invalidate the generation on unmount.

In `frontend/src/components/llm-council/StreamingCouncilView.tsx`:

1. **Hook — record that the watchdog, specifically, fired.** Inside `start()`,
   next to `let lastActivityAt = Date.now();` (line 219), add:

```tsx
      let timedOut = false;
```

   and in the watchdog interval body (lines 224-227), set it before aborting:

```tsx
        if (Date.now() - lastActivityAt > WATCHDOG_MS) {
          timedOut = true;
          clearInterval(watchdog);
          controller.abort();
        }
```

2. **Hook — invalidate the generation on unmount, before aborting.** Replace the
   unmount effect at lines 371-376:

```tsx
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);
```

   with:

```tsx
  // Cleanup on unmount. Bump the generation FIRST: the abort below makes the
  // in-flight fetch reject on a later microtask, and every state-touching block
  // in start() is gated on `myGen === genRef.current`. Without this bump the
  // superseded run would setState on an unmounted component and — after the
  // change below — would also claim a timeout that never happened.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);
```

   > If `plans/017` Steps 8–9 have already landed, this effect may already carry
   > the `genRef.current += 1;` line. In that case leave it alone and only make
   > sure the ordering is bump-then-abort. If 017 has **not** landed, make this
   > change here; 017's Step 8 has been revised to expect it.

3. **Hook — abort branch.** Replace lines 353-356:

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
          // Only the watchdog gets an error state. A superseding start() and an
          // unmount both abort too, and both must stay silent — the first
          // because update() is a no-op for a superseded generation, the second
          // because the unmount effect bumps genRef before aborting.
          if (timedOut) {
            update({
              ...curr,
              council: {
                status: "error",
                error:
                  "The council stream stopped responding — no data for 90 seconds. Try sending the question again.",
              },
            });
          }
          return curr;
        }
```

4. **Hook — make a pre-stream HTTP failure reach the page.** This closes the
   half of FECORR-02 that the original plan deferred, **without** editing
   `LlmCouncilPage.tsx`. Today `start()` swallows every error and returns
   `curr`, so the `catch` at `LlmCouncilPage.tsx:842-851` — which already exists
   and already feeds `<ApiErrorState message={submitError} />` at `:956` — is
   dead code. And when the failure happens *before* any event arrives, the
   `hasStreamed` gate at `LlmCouncilPage.tsx:788-792` is `false`, so
   `StreamingCouncilView` never mounts and the error strip you add below is
   never rendered. Net effect at `42826a3`: a 503 from
   `POST /api/v1/llm-council/stream` is **completely invisible**.

   Add a flag next to `let timedOut = false;`:

```tsx
      let streamOpened = false;
```

   set it immediately after the `if (!res.ok || !res.body) { … }` guard
   (line 239-242) succeeds:

```tsx
        streamOpened = true;
```

   and in the **non-abort** arm of the catch, after the existing
   `update({ ...curr, council: { status: "error", … } })` call, rethrow when the
   stream never opened:

```tsx
        update({
          ...curr,
          council: { status: "error", error: String((err as Error).message ?? err) },
        });
        // Nothing ever streamed, so LlmCouncilPage's `hasStreamed` gate keeps
        // StreamingCouncilView unmounted and the state above is unreachable.
        // Rethrow so the page's existing try/catch (LlmCouncilPage.tsx:842)
        // populates submitError and renders <ApiErrorState>. Only the
        // pre-stream case rethrows: a mid-stream drop is already visible in the
        // error strip and must not also raise a second, duplicate surface.
        if (!streamOpened) throw err;
        return curr;
```

   `start()` has exactly **one** caller — `LlmCouncilPage.tsx:839`, verified with
   `grep -rn "\.start(" frontend/src` (the only other hits are `OscillatorNode`
   calls in `lib/council-celebrations.ts`) — and that caller already `await`s it
   inside a `try`. So no other call site can be broken by the new rejection.

5. **Component — surface the error and stop the spinner.** After the
   `allExpertsFinal` block (currently ending at line 599) add:

```tsx
  const councilFailed = state.council.status === "error";
  const councilBusy =
    !councilFailed &&
    (state.council.status === "running" || !allExpertsFinal);
```

6. Replace the header `<div className="flex items-center gap-2">` block
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

7. Immediately after the elapsed-time `<span>` (line 618-620) and still inside
   the same header `<div className="flex flex-wrap …">`, add the error strip.
   It reuses the amber palette already used by `ExpertColumn` at lines 466-470,
   and `w-full` makes it wrap to its own line inside the `flex-wrap` row.
   `role="alert"` is required: this element is swapped in **after** first paint,
   so without a live region a screen-reader user is left on a silent screen that
   simply stopped updating:

```tsx
        {councilFailed ? (
          <p
            role="alert"
            data-testid="council-stream-error"
            className="w-full break-words rounded-md border border-amber-300/40 bg-amber-50/30 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300"
          >
            {state.council.error || "unknown error"}
          </p>
        ) : null}
```

`AlertTriangle`, `Loader2` and `CheckCircle2` are all already imported at line
21. Do not change `allExpertsFinal` — it already treats `"error"` as terminal.

Then create `frontend/__tests__/council-stream-error-state.test.tsx`. It needs
**two** describe blocks: presentation (cheap, `state`-prop only) and behaviour
(the hook, which is where the corrections above actually live). A test that only
renders a hand-built error state proves the markup and nothing else — it never
executes the watchdog, the unmount path, or the rethrow.

**Block A — presentation.** `StreamingCouncilView` takes a plain `state` prop,
so no hook mocking is required. Import the `CouncilStreamState` type from
`@/components/llm-council/StreamingCouncilView` and write a
`makeState(overrides)` helper so each case is one line. The component starts a
500 ms `setInterval` for the elapsed clock — let RTL's `cleanup` unmount it (the
global setup already calls `cleanup()` after each test) and do not advance
timers in this block.

- `council: { status: "error", error: "boom" }` with all three experts left at
  `status: "streaming"` → `screen.getByTestId("council-stream-error")` shows
  `"boom"`, it carries `role="alert"`, `screen.getByText("Council run failed")`
  exists, and `screen.queryByText("Council deliberating")` is `null`.
- `council: { status: "running" }` with experts `"pending"` →
  `screen.getByText("Council deliberating")` exists and
  `screen.queryByTestId("council-stream-error")` is `null`.
- `council: { status: "done" }` with all three experts `"done"` →
  `screen.getByText("Panel finished — synthesising")` exists and no error strip.

**Block B — the hook.** `renderHook(() => useCouncilStream())` with a stubbed
`fetch`. Build the stub so it **honours the `AbortSignal`**, because every case
below depends on the abort actually rejecting the promise:

```tsx
function abortableFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: unknown, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    }),
  );
}
```

Use `vi.useFakeTimers()` / `vi.useRealTimers()` in this block, and
`vi.unstubAllGlobals()` in `afterEach`.

- **Watchdog timeout is terminal and visible.** Start a run, then
  `await act(async () => { await vi.advanceTimersByTimeAsync(95_000); })`. The
  watchdog interval ticks every 5 s and fires at >90 s of silence, so the run
  aborts. Assert `result.current.state.council.status === "error"`,
  `result.current.state.council.error` matches `/90 seconds/`, and
  `result.current.isStreaming === false`. **This is the test the old plan was
  missing** — it is the only one that executes the `timedOut` branch.
- **Unmount is silent.** Start a run, then `unmount()` from `renderHook`, then
  `await act(async () => { await Promise.resolve(); await Promise.resolve(); })`.
  Assert `console.error` was not called with a React `setState`-after-unmount
  warning (spy on it in `beforeEach`) — and, more directly, that the state
  snapshot captured just before unmount still reads
  `council.status !== "error"`. If you bumped `genRef` correctly there is
  nothing to observe; if you did not, React logs and the state flips.
- **A superseding `start()` does not paint the fresh run red.** Start run A,
  start run B, then let A's abort rejection settle. Assert
  `result.current.state.council.status !== "error"` and
  `result.current.isStreaming === true`.
- **A pre-stream HTTP failure rejects.** Swap the stub to resolve
  `{ ok: false, status: 503, body: null, statusText: "Service Unavailable", text: async () => "cloudflare_route_unavailable" }`.
  Assert `await expect(result.current.start({ message: "x" })).rejects.toThrow(/503/)`
  — this is what makes `LlmCouncilPage`'s existing `catch` live.
- **A mid-stream failure does NOT reject.** Resolve `{ ok: true, body: <a ReadableStream that emits one `council.start` SSE frame and then errors> }`.
  Assert `start()` **resolves** (no throw) and
  `result.current.state.council.status === "error"`. This is the regression
  guard that stops someone widening the rethrow to every failure and
  double-surfacing mid-stream drops.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/council-stream-error-state.test.tsx
```
→ exit 0, **8 passed** (3 presentation + 5 hook).

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

**A correction you must apply — the retry must cover HTTP failures, not only
`fetch` rejections.** The original sketch put the backoff only in the `catch`,
which is reached only when `fetch` itself rejects (DNS failure, offline, TLS
error). But the stated motivation — "Worker cold start / transient failure" —
produces an HTTP **status**: 429, 500, 502, 503, 504. Those land in the
`if (!res.ok)` branch at `AuthContext.tsx:48-59`, which **unconditionally
signs the user out**. As written, the plan would leave the exact failure it set
out to fix untouched, while adding a backoff for a rarer one. Split the branch
by status instead:

- **401 / 403** → the refresh cookie is genuinely gone or revoked. Sign out
  immediately, no retry. This is the only definitive rejection.
- **429 and 5xx**, and a `fetch` rejection → transient. Retry on the backoff,
  keep the session.
- **Any other non-OK status** (e.g. a 404 from a mis-deployed route) → treat as
  definitive; retrying a permanent misconfiguration forever is worse.

3. Extract the sign-out into a local helper so both branches share it. Add,
   immediately above `const refresh = useCallback(`:

```tsx
  const clearSession = useCallback(() => {
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
  }, []);

  /** Transient = worth retrying. A 401/403 means the refresh cookie is gone. */
  const isTransientRefreshStatus = (status: number) =>
    status === 429 || status >= 500;

  const scheduleRefreshRetry = useCallback((): boolean => {
    const attempt = refreshRetryCountRef.current;
    if (attempt >= REFRESH_RETRY_DELAYS_MS.length) return false;
    refreshRetryCountRef.current = attempt + 1;
    // Reuse refreshTimerRef so the existing unmount cleanup still clears it.
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshRef.current?.();
    }, REFRESH_RETRY_DELAYS_MS[attempt]);
    return true;
  }, []);
```

4. Replace the whole body of `refresh` (lines 45-75) with:

```tsx
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // sends httpOnly refresh cookie
      });
      if (!res.ok) {
        // A cold-starting or rate-limited Worker must not end the session.
        if (isTransientRefreshStatus(res.status) && scheduleRefreshRetry()) {
          return false;
        }
        clearSession();
        return false;
      }
      const data = await res.json();
      refreshRetryCountRef.current = 0;
      setState((s) => ({
        ...s,
        accessToken: data.access_token,
        isAuthenticated: true,
      }));
      setApiAccessToken(data.access_token ?? null);
      scheduleRefresh(data.access_token);
      return true;
    } catch {
      // No HTTP status at all (offline, DNS, TLS). Same policy as a 5xx.
      if (scheduleRefreshRetry()) return false;
      clearSession();
      return false;
    }
  }, [clearSession, scheduleRefreshRetry, scheduleRefresh]);
```

5. **Fix the half-populated session on the bootstrap path.** At
   `AuthContext.tsx:112-118` the mount effect handles a 401 from
   `/api/v1/auth/me` by calling `refresh()` and, on success, doing only
   `setState((s) => ({ ...s, isLoading: false }))`. But the refresh response
   body carries **only** `access_token` — `user`, `tenant` and `tenants` are
   never filled. The result is `isAuthenticated: true` with `user: null`, which
   crashes or blanks every consumer that reads `auth.user`. Re-fetch `/auth/me`
   once the new access token is installed:

```tsx
        } else if (r.status === 401) {
          // Access cookie expired — try silent refresh before giving up.
          const refreshed = await refresh();
          if (refreshed) {
            // The refresh response carries only access_token; re-read /auth/me
            // so user/tenant/tenants are populated. Without this the app runs
            // as `isAuthenticated: true` with a null user.
            const me = await fetch("/api/v1/auth/me", {
              credentials: "include",
            }).catch(() => null);
            if (me?.ok) {
              const meData = await me.json().catch(() => null);
              if (meData?.user) {
                setState((s) => ({
                  ...s,
                  user: meData.user,
                  tenant: meData.tenant,
                  tenants: meData.tenants || [],
                  isLoading: false,
                }));
                return;
              }
            }
            setState((s) => ({ ...s, isLoading: false }));
            return;
          }
        }
```

   Do **not** call `setApiAccessToken` or `scheduleRefresh` again here —
   `refresh()` already did both with the token it received.

**The `refresh` dependency array becomes
`[clearSession, scheduleRefreshRetry, scheduleRefresh]` — and every one of those
three must be a `useCallback` with an empty (`[]`) dependency array**, so all
three are referentially stable for the component's lifetime. That is what keeps
`refresh` stable, which matters because `refresh` is itself a dependency of the
mount effect at line 117: an unstable `refresh` would re-run session restore on
every render. **Never put `state` (or anything derived from it) into any of
these four dependency arrays.** Refs are used here precisely because they do not
participate in deps.

Guard it with an assertion in the test below: after mount, a forced re-render
must not fire a second `GET /api/v1/auth/me`.

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
- Count refresh calls with a helper:
  `const refreshCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/auth/refresh")).length;`

**`vi.getTimerCount() > 0` is NOT a valid assertion here and must not be used.**
The mount effect calls `scheduleRefresh()` with an `exp` 24 h out, so a
long-lived timer is already pending before any test body runs; the assertion is
true whether or not a retry was scheduled. Assert on the **backoff schedule**
instead — advance the clock and count actual calls. That is a check that can
fail.

- Test A — **a network rejection retries on the exact 5 s / 15 s / 45 s
  schedule.** With `/api/v1/auth/refresh` rejecting
  `new TypeError("Failed to fetch")`: `await act(async () => { await ctx.refresh(); })`
  → returns `false` and `is-auth` still reads `"true"`. Then
  `await act(async () => { await vi.advanceTimersByTimeAsync(4_999); })` →
  `refreshCalls()` is still 1. Then `advanceTimersByTimeAsync(2)` →
  `refreshCalls()` is 2. Then `14_999` → still 2; `+2` → 3. Then `44_999` →
  still 3; `+2` → 4. After that fourth attempt fails, `is-auth` reads `"false"`.
- Test B — **HTTP 503 retries and does NOT sign the user out.** Resolve
  `{ ok: false, status: 503, json: async () => ({}) }`. One `refresh()` →
  returns `false`, `is-auth` still `"true"`, and advancing 5 s issues a second
  call. This is the assertion that fails against the pre-fix code, where
  `!res.ok` signs out unconditionally.
- Test C — **HTTP 401 signs out immediately, with no retry.** Resolve
  `{ ok: false, status: 401, json: async () => ({}) }`. One `refresh()` →
  `is-auth` reads `"false"` and advancing 60 s issues **no** further
  `/auth/refresh` call.
- Test D — **a success resets the counter.** `refresh()` once against a
  rejecting stub (counter = 1), flip the stub so `/api/v1/auth/refresh` resolves
  `{ ok: true, json: async () => ({ access_token: token }) }`, call `refresh()`
  → returns `true`; flip back to rejecting and call `refresh()` three more times
  → `is-auth` is still `"true"`.
- Test E — **the bootstrap path populates the user.** Stub `/api/v1/auth/me` to
  return `{ ok: false, status: 401 }` on the **first** call and
  `{ ok: true, json: async () => ({ user: {...}, tenant: {...}, tenants: [], access_token: token }) }`
  on the second; stub `/api/v1/auth/refresh` to resolve
  `{ ok: true, json: async () => ({ access_token: token }) }`. After mount
  settles, assert `ctx.isAuthenticated === true` **and `ctx.user !== null`**.
  Against the pre-fix code `user` is `null` — that is the defect this proves.
- Test F — **`refresh` is referentially stable.** After mount settles, capture
  `const first = ctx.refresh;`, force a re-render (e.g. `rerender(...)` with a
  changed child prop), then assert `ctx.refresh === first` and that
  `fetchMock.mock.calls.filter(([u]) => String(u).includes("/auth/me")).length`
  is unchanged. This is the machine check for the dependency-array rule above.

Import `act` from `@testing-library/react`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/auth-refresh-recovery.test.tsx
```
→ exit 0, **6 passed**.

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
        // The raw message is whatever the Worker put in the JSON `error` field
        // — it can be a bare D1 string like "D1_ERROR: no such table". The
        // primary user of this app is a self-representing applicant under
        // stress, not an operator: show translated, actionable copy and send
        // the raw detail to the console for diagnosis. `no-console` allows
        // `console.error` (frontend/eslint.config.js).
        console.error("[llm-council] session delete failed", err);
        toast.error(
          t("llm_council.session_delete_failed", {
            defaultValue: "Could not delete this session. Please try again.",
          }),
        );
      },
    });
  }
```

Do **not** add a `ConfirmModal` here — `SessionListItem` already has one.

**Do not** interpolate `err.message` into the toast. The earlier draft of this
plan asserted that a literal `D1_ERROR: no such table` should reach the user;
that is a leak of backend internals into a stress-context UI and it is the one
place in this plan where the "match the JudgeDetailPage exemplar" rule is
deliberately **not** followed — a toast is not a diagnostics panel and offers no
retry affordance to make the detail useful.

**Cross-plan dependency**: `llm_council.session_delete_failed` does not exist in
either locale file at `42826a3`. `plans/018-complete-the-i18n-catalogue.md` has
been revised to define it in both `en.json` and `zh-TW.json`, and 018 runs after
this plan. The `defaultValue` above keeps this correct in the meantime. If you
change the wording here, tell 018 — its `en.json` value and this `defaultValue`
must match.

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
  with `new Error("D1_ERROR: no such table")`, and assert `toast.error` was
  called with `"Could not delete this session. Please try again."` (the i18n
  mock returns `defaultValue`) — and, crucially, that **no** `toast.error`
  argument contains `"D1_ERROR"`:
  `expect(vi.mocked(toast.error).mock.calls.flat().join(" ")).not.toContain("D1_ERROR")`.
  That is the assertion that fails if someone reintroduces `err.message`.
- Assert the raw error still reached diagnostics: spy on `console.error` in
  `beforeEach` and check it was called with the original `Error` instance.
- Invoke the same `onError` with `new Error("")` and assert the same translated
  copy is shown (the fallback must not depend on the message being non-empty).

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/session-delete-error.test.tsx __tests__/llm-council-sessions-page.test.tsx
```
→ exit 0; `session-delete-error.test.tsx` reports **4 passed**, and
`llm-council-sessions-page.test.tsx` reports the same count as before your
change (record it first).

### Step 5: Stop `DataToolsPage` from fabricating a healthy pipeline

In `frontend/src/pages/DataToolsPage.tsx`:

1. Add `import { ApiErrorState } from "@/components/shared/ApiErrorState";`
   after the `PageHeader` import (line 23). Do **not** import anything new from
   `@/lib/api` — `frontend/__tests__/system-pages.test.tsx:24-27` mocks that
   module with exactly two exports and any new named import from it would make
   that suite fail.
**A correction you must apply — do not use `isError` as the gate.** Both queries
poll on a `refetchInterval`. In TanStack Query v5 (`@tanstack/react-query`
5.90.21 in this repo) a **background refetch failure** sets
`status === "error"`, so `isError` becomes `true` **while the last good `data`
is still present**; the library distinguishes the two cases with
`isLoadingError` (first load failed, no data) and `isRefetchError` (a refetch
failed, data retained) — both are declared in
`node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts`. Gating the
whole section on `isError` therefore **blanks a running pipeline's phase,
progress bar, stats and logs the moment one 15-second poll blips** — which is
strictly worse than the fabricated-idle bug being fixed, because it happens to
operators mid-run.

Use `isLoadingError` for the full-panel error, and a non-destructive staleness
banner for `isRefetchError`.

2. Change the two `useQuery` destructures (lines 83 and 92) to keep the error
   channel:

```tsx
  const {
    data: pipelineStatus,
    isLoadingError: pipelineLoadFailed,
    isRefetchError: pipelineRefetchFailed,
    error: pipelineError,
    refetch: refetchPipeline,
  } = useQuery<PipelineStatus>({
```

```tsx
  const {
    data: jobStatus,
    isLoadingError: jobLoadFailed,
    isRefetchError: jobRefetchFailed,
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
        {pipelineLoadFailed ? (
          <div role="alert" data-testid="pipeline-status-error">
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

3b. Immediately **above** that ternary, and outside it, add the staleness
banner. This is the `isRefetchError` case: we still have valid data from the
last successful poll, so the panel below keeps rendering the real running state,
progress, stats and logs, and the banner only tells the operator that what they
are reading may have moved on. `role="status"` (polite) rather than
`role="alert"` — it is not an interruption:

```tsx
        {pipelineRefetchFailed && pipelineStatus ? (
          <div
            role="status"
            data-testid="pipeline-status-stale"
            className="mb-3 rounded-md border border-amber-300/40 bg-amber-50/30 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/15 dark:text-amber-300"
          >
            {t("errors.stale_data_warning", {
              defaultValue:
                "Live updates paused — this may be out of date. Retrying automatically.",
            })}
          </div>
        ) : null}
```

`errors.stale_data_warning` is a new key. Like
`llm_council.session_delete_failed`, `plans/018` has been revised to define it
in both locale files; the `defaultValue` covers the interval.

4. In §3, wrap the job card in the same shape. The card is exactly
   `src/pages/DataToolsPage.tsx` lines **372-481**: it opens with
   `        <div className="rounded-lg border border-border bg-card p-5">` at
   372 and its matching `        </div>` is at 481, immediately before
   `      </section>` at 482. Wrap those 110 lines unchanged as the `else` arm:

```tsx
        {jobLoadFailed ? (
          <div role="alert" data-testid="job-status-error">
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

`jobRefetchFailed` gets the same `role="status"` staleness banner treatment as
the pipeline one, rendered above the card with
`data-testid="job-status-stale"`.

Then create `frontend/__tests__/data-tools-poll-errors.test.tsx`. Reuse the
scaffolding from `frontend/__tests__/system-pages.test.tsx` lines 1-62
(`vi.hoisted` factories, the `@/hooks/use-stats` and `@/lib/api` mocks, the
`StatCard` stub, `makeQueryClient` with `retry: false`, `renderWithProviders`).
Cover:

- **First load fails** — `mockFetchPipelineStatus.mockRejectedValue(new Error("HTTP 503: cloudflare_route_unavailable"))`,
  job status resolving normally → `await screen.findByTestId("pipeline-status-error")`
  exists and `screen.queryByText("data_tools.pipeline_idle_title")` is `null`.
- **Healthy path unchanged** — both resolving normally →
  `screen.queryByTestId("pipeline-status-error")` is `null` and
  `screen.getByText("data_tools.pipeline_idle_title")` exists (regression guard).
- **A failing refetch must NOT blank a running pipeline.** This is the case the
  old plan got wrong, so it must be tested for real — a hand-built
  `{ isError: true }` render proves nothing. Sequence the mock:
  `mockFetchPipelineStatus.mockResolvedValueOnce({ running: true, phase: "crawl", overall_progress: 42, log: ["started"], errors: [], phases_completed: [] }).mockRejectedValue(new Error("boom"))`.
  Wait for the running state to paint
  (`await screen.findByText(/42/)` or whatever the progress element renders),
  then drive the poll: `vi.useFakeTimers()` before render and
  `await act(async () => { await vi.advanceTimersByTimeAsync(2_500); })` (the
  running-state `refetchInterval` is 2000 ms). Then assert **all three**:
  `screen.queryByTestId("pipeline-status-error")` is `null`, the running content
  is still on screen, and `screen.getByTestId("pipeline-status-stale")` exists.
  Build the `QueryClient` with `retry: false` so one rejection is one failure.
- **A failing job poll shows its error card** —
  `mockFetchJobStatus.mockRejectedValue(new Error("boom"))`, pipeline resolving
  normally → `await screen.findByTestId("job-status-error")` exists and
  `screen.queryByText("data_tools.no_recent_job")` is `null`.
- **The error containers are announced** — in the first-load-failure case,
  `screen.getByRole("alert")` is present.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/data-tools-poll-errors.test.tsx __tests__/system-pages.test.tsx
```
→ exit 0; `data-tools-poll-errors.test.tsx` reports **5 passed**, and
`system-pages.test.tsx` reports the same count as before your change — in
particular "shows pipeline idle state when pipeline is not running" and "shows
no recent job label when no job is active" must both still pass by name:
```bash
npx vitest run __tests__/system-pages.test.tsx -t "shows pipeline idle state when pipeline is not running"
npx vitest run __tests__/system-pages.test.tsx -t "shows no recent job label when no job is active"
```
→ each exits 0 with `1 passed`.

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
        role="alert"
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

**Two strings here are deliberately hardcoded English, and that is a
cross-plan contract, not an oversight.** `ErrorBoundary` is a class component,
so it cannot call the `useTranslation` hook (the same reason
`App.tsx:29`'s `title="Application error"` is untranslated today). The literal
`title="Something went wrong on this screen"` is a `title="…"` attribute and
will therefore be caught by the hardcoded-attribute ratchet that
`plans/018-complete-the-i18n-catalogue.md` Step 5 installs. 018 has been revised
to allowlist exactly
`src/components/shared/RouteErrorBoundary.tsx::Something went wrong on this screen`.
**If you change that wording, 018's gate fails** — tell 018's owner. Translating
it properly needs `withTranslation()` or a functional wrapper and is recorded as
deferred in 018's Maintenance notes.

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

**Ordering with `plans/018`.** 018 Step 3 also rewrites this file (adding
`useTranslation`, `role="alert"` on the error box, and `font-heading` on the
`<h1>`). The two edits are not independent: 018's original draft reproduced the
whole file *including* `handleSuccess`, `handleError`, `loginError` and the two
props on `<TelegramLoginButton>` — i.e. it would have re-added everything this
step deletes. 018 has been revised to depend on this plan and to start from the
callback-free shape. **This plan runs first.** The final file must satisfy all
four properties at once: callback-free, `useTranslation`-based, `role="alert"`
on the error box, `font-heading` on the `<h1>`. Do not attempt to satisfy them
by reordering the plans — reordering alone does not resolve it.

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

**Record the baseline first**, before any of your changes are in the tree
(if you have already started, `git stash` is NOT acceptable here — take the
numbers from a clean checkout of `42826a3` in a scratch worktree, or read them
off the run you did before Step 1):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run 2>&1 | tail -6      # note BEFORE_TESTS and BEFORE_FILES
npm run lint 2>&1 | tail -3        # note BEFORE_WARNINGS
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx tsc -b --noEmit && \
  npm run lint 2>&1 | tail -3 && \
  npx vitest run 2>&1 | tail -8 && \
  npm run build 2>&1 | tail -5 && \
  npm run build:cloudflare 2>&1 | tail -5
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain=v1 -uall > /tmp/immi-015-final-status.txt
diff /tmp/immi-015-baseline-status.txt /tmp/immi-015-final-status.txt
```

Expected:

- `tsc -b --noEmit` exits 0 with no output.
- `npm run lint` reports **0 errors**, and the warning count is exactly
  `BEFORE_WARNINGS - 1` (Step 7 removes the `TelegramLoginButton.tsx:50`
  `react-hooks/exhaustive-deps` warning). **Do not assert an absolute number** —
  a sibling plan landing changes the baseline.
- `npx vitest run` reports **0 failed**, `AFTER_FILES == BEFORE_FILES + 6`, and
  `AFTER_TESTS == BEFORE_TESTS + 33` (7 + 8 + 6 + 4 + 5 + 3 across the six new
  files, per the per-file counts asserted in Steps 1–6). If you split or merged
  a case, the binding requirements are: **0 failed**, six new files, and every
  per-step per-file count in Steps 1–6 met exactly.
- **Both** builds exit 0. `npm run build` writes to
  `../immi_case_downloader/static/react` (the local-dev Flask surface,
  `frontend/vite.config.ts:34`); `npm run build:cloudflare` writes to
  `frontend/dist`, which is what `wrangler.toml:15` (`[assets] directory =
  "./frontend/dist"`) actually serves in production. Only the second one proves
  the artifact users receive still builds — the earlier draft of this plan
  checked only the first.
- `diff` of the two status files shows **only additions**, and every added line
  is one of the 16 in-scope paths (15 source/test files + this plan file). Any
  pre-existing dirt recorded in Step 0's baseline is unchanged. Do not "clean"
  anything you did not create.

## Test plan

Six new files, all under `frontend/__tests__/`, all runnable with
`npx vitest run <path>`:

| File | Tests | Covers | Cases |
|---|---|---|---|
| `case-detail-error-state.test.tsx` | 7 | FECORR-04 | a 503 renders `ApiErrorState` with `role="alert"`; a **real 404 `ApiError`** renders the not-found branch, not the generic error; Retry calls `refetch`; a 2xx-with-no-body renders not-found, not a spinner; `copyCitation` confirms only after `writeText` resolves and toasts on rejection |
| `council-stream-error-state.test.tsx` | 8 | FECORR-02 | presentation: error strip shown with `role="alert"` and *not* "Council deliberating"; running still spins; done still shows "Panel finished". Behaviour: the 90 s watchdog produces a terminal error; unmount produces none; a superseding `start()` produces none; a pre-stream HTTP failure **rejects** so the page's existing catch fires; a mid-stream failure does not reject |
| `auth-refresh-recovery.test.tsx` | 6 | FECORR-07 | a network rejection retries on exactly 5 s / 15 s / 45 s then signs out; a **503 retries** instead of signing out; a **401 signs out with no retry**; a success resets the counter; the bootstrap 401→refresh path populates `user`; `refresh` stays referentially stable |
| `session-delete-error.test.tsx` | 4 | FECORR-13 (delete) | `mutate` is called with an `onError`; the toast shows translated copy; **no raw `D1_ERROR` reaches the toast**; the raw error still reaches `console.error` |
| `data-tools-poll-errors.test.tsx` | 5 | FECORR-13 (polling) | a failed first load shows the error card with `role="alert"` and suppresses the fabricated idle card; the healthy path still shows idle; **a failed refetch keeps the running pipeline's content and shows a `role="status"` staleness banner**; a failing job poll shows its error card |
| `route-error-boundary.test.tsx` | 3 | FECORR-09 | a route crash renders the route-scoped panel with `role="alert"`; Retry and a `resetKey` change both reset; `componentDidCatch` logs with the scoped prefix; `RouteBoundary` passes children through |

Structural patterns to copy: `frontend/__tests__/case-detail-page.test.tsx`
(hoisted mock factories + provider wrapper),
`frontend/__tests__/llm-council-sessions-page.test.tsx` (hook + `sonner`
mocks), `frontend/__tests__/system-pages.test.tsx` (`@/lib/api` mock +
`QueryClient` with `retry: false`), `frontend/__tests__/auth/auth-utils.test.ts`
(synthetic JWT construction).

Full-suite verification: `cd frontend && npx vitest run` → **0 failures**, and
`AFTER_TESTS == BEFORE_TESTS + 33` against the baseline you recorded in Step 8.
Do **not** assert an absolute suite total: plans 016, 017 and 018 add tests to
the same suite and any absolute number would make parallel execution impossible
and train the next executor to edit the yardstick instead of the code.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd frontend && npm run lint` exits 0 with **0 errors** and exactly
      `BEFORE_WARNINGS - 1` warnings (Step 7 removes one; the absolute number
      moves when a sibling plan lands)
- [ ] `cd frontend && npx vitest run` exits 0 with **0 failures** and
      `AFTER_TESTS == BEFORE_TESTS + 33`, `AFTER_FILES == BEFORE_FILES + 6`
- [ ] Each new file hits its own count:
      `npx vitest run __tests__/case-detail-error-state.test.tsx` → 7 passed;
      `__tests__/council-stream-error-state.test.tsx` → 8;
      `__tests__/auth-refresh-recovery.test.tsx` → 6;
      `__tests__/session-delete-error.test.tsx` → 4;
      `__tests__/data-tools-poll-errors.test.tsx` → 5;
      `__tests__/route-error-boundary.test.tsx` → 3
- [ ] These two pre-existing tests still pass **by name**:
      `npx vitest run __tests__/system-pages.test.tsx -t "shows pipeline idle state when pipeline is not running"`
      and `-t "shows no recent job label when no job is active"`
- [ ] `cd frontend && npm run build` exits 0
- [ ] `cd frontend && npm run build:cloudflare` exits 0 — this is the artifact
      production actually serves (`wrangler.toml:15` → `./frontend/dist`)
- [ ] `grep -c "<RouteBoundary>" frontend/src/App.tsx` returns `28`
- [ ] `grep -c "Suspense" frontend/src/App.tsx` returns `0`
- [ ] `grep -rn "onSuccess\|onError" frontend/src/components/auth/TelegramLoginButton.tsx frontend/src/pages/LoginPage.tsx` returns no matches
- [ ] `grep -n "isLoading || !data" frontend/src/pages/CaseDetailPage.tsx` returns no matches
- [ ] `grep -c "error.status === 404" frontend/src/pages/CaseDetailPage.tsx` returns `1`
- [ ] `grep -c "await navigator.clipboard.writeText" frontend/src/pages/CaseDetailPage.tsx` returns `1`
- [ ] `grep -c "catch { return false; }" frontend/src/contexts/AuthContext.tsx` returns `0`
- [ ] `grep -c "isTransientRefreshStatus" frontend/src/contexts/AuthContext.tsx` returns `2` (definition + call)
- [ ] `grep -c "pipelineIsError\|jobIsError" frontend/src/pages/DataToolsPage.tsx` returns `0` — the gate is
      `isLoadingError`, not `isError`
- [ ] `grep -rn "council-stream-error\|pipeline-status-error\|pipeline-status-stale\|job-status-error\|case-detail-error\|case-detail-not-found\|route-error-boundary" frontend/src/` returns at least 7 matches
- [ ] `diff /tmp/immi-015-baseline-status.txt /tmp/immi-015-final-status.txt`
      shows only added lines, all of them in-scope paths
- [ ] The new status for this plan's `plans/README.md` row is **reported**;
      the row is edited only if you are running this plan alone (see Sequencing)

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
- **Deferred out of this plan**: `LoginPage`'s hardcoded English strings — now
  explicitly owned by `plans/018-complete-the-i18n-catalogue.md` Step 3, which
  runs after this plan and starts from the callback-free file Step 7 leaves
  behind. The pre-stream HTTP-failure path is **no longer deferred**; see
  "Findings reconsidered".
- **Still deferred, and the reason**: `ApiErrorState` renders whatever `message`
  its caller passes, and its `StatePanel` sets no ARIA role at all
  (`grep -n "role=\|aria-" src/components/shared/StatePanel.tsx` → nothing). This
  plan wraps its own call sites in `role="alert"` / `role="status"`, but the
  right fix is to put the live region and a safe-message contract inside
  `ApiErrorState`/`StatePanel` so every caller gets it. Those are shared
  components this plan does not own.
- **Two more unawaited clipboard writes remain** after Step 1b and
  `plans/017` Step 7: `frontend/src/pages/DesignTokensPage.tsx:386-389` is the
  last one. The correct shape is
  `frontend/src/components/saved-searches/SavedSearchCard.tsx:78-86`.

## Findings reconsidered

- **FECORR-02, the pre-stream half — NOW FIXED (revised 2026-08-28).** The
  earlier draft deferred this on the grounds that the fix needed
  `LlmCouncilPage.tsx`. That was wrong in one useful direction: the gate at
  `LlmCouncilPage.tsx:788-792` and the `<ApiErrorState>` at `:956` are indeed
  out of scope, **but the reason the page's `catch` at `:842-851` is dead lives
  in `StreamingCouncilView.tsx`** — `start()` swallows the error and returns
  `curr` instead of rethrowing, and that file is in scope. Step 2 item 4 makes
  `start()` rethrow **only** when the stream never opened, which brings the
  page's existing catch and error panel to life with zero out-of-scope edits.
  Verified prerequisite: `grep -rn "\.start(" frontend/src` shows exactly one
  caller of `stream.start` (`LlmCouncilPage.tsx:839`), already inside a
  `try`/`catch` that sets `submitError`. The mid-stream-drop and watchdog-abort
  cases are fixed by the rest of Step 2.
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

## Review points not applied

One point from the 2026-08-28 cross-plan review was checked and **not** turned
into work here, with the evidence:

- **"Step 1 renders `error.message` raw; show a translated safe message
  instead."** Applied for the Step 4 *toast* (a toast has no retry affordance
  and no room for context, so a raw `D1_ERROR` there is pure leakage), and
  applied as `role="alert"` everywhere. **Not** applied to the `ApiErrorState`
  `message` in Steps 1 and 5, because the repo's established error-panel
  contract already surfaces the raw message and doing it differently in one page
  would be worse than doing it consistently: `frontend/src/pages/JudgeDetailPage.tsx:58-62`
  renders `error instanceof Error ? error.message : t(...)` verbatim, and
  `frontend/src/components/shared/ApiErrorState.tsx:15` accepts a free-form
  `message` prop with `t("errors.unable_to_load_message")` only as the fallback.
  Changing that contract means changing `ApiErrorState` and every caller —
  a genuinely worthwhile follow-up, but it is a shared component this plan does
  not own, and a one-page divergence would leave two error dialects. Recorded
  as a follow-up rather than half-done.
- **"Use one worktree per agent."** Sound advice, but it is an operator/dispatch
  decision, not a step this plan can execute — the plan cannot create the
  worktree it is already running inside. The drift check has instead been made
  able to *detect* a shared dirty tree (see Drift check), which is the part a
  plan can own.
