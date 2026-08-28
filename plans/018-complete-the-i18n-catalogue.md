# Plan 018: Define the 88 missing keys and translate the hardcoded strings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, report the new status for this plan's
> row in `plans/README.md`. That file **does** exist, and all four of plans
> 015–018 touch adjacent rows of the same table, so **do not edit it yourself
> when running in parallel** — report your row and let the integration
> coordinator write it.
>
> **Drift check (run first)**:
>
> `git diff 42826a3..HEAD` cannot see uncommitted, staged or untracked work, so
> on a dirty tree it gives a false all-clear. Run all four:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE='frontend/src/i18n/locales/en.json
> frontend/src/i18n/locales/zh-TW.json
> frontend/src/pages/LoginPage.tsx
> frontend/src/components/analytics/OutcomeFunnelChart.tsx
> frontend/__tests__/i18n-hardcoded.test.ts'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${SCOPE[@]}"          # committed drift
> git diff --stat -- "${SCOPE[@]}"                        # unstaged drift
> git diff --cached --stat -- "${SCOPE[@]}"               # staged drift
> git status --porcelain=v1 -uall > /tmp/immi-018-baseline-status.txt
> ```
>
> **`frontend/src/pages/LoginPage.tsx` is the deliberate exception.** This plan
> now **depends on** `plans/015-surface-frontend-errors.md`, whose Step 7
> rewrites that file. Seeing it changed is expected and correct — see
> "Sequencing" below for what the post-015 file must look like. For every other
> path, any appearance in any of the four commands is a **STOP** condition:
> compare the "Current state" excerpts against the live code and report.
>
> **Never run `git checkout --` or `git clean -f`** to make the tree "clean" —
> that destroys the operator's or a parallel agent's uncommitted work. (Step 4
> and Step 5 each contain a deliberate-breakage check that does a scoped
> `git checkout -- <one specific file>` to undo a change **you** just made
> seconds earlier; those are fine because the file was clean immediately before
> and you verified it. Nothing else.)
> Keep `/tmp/immi-018-baseline-status.txt` — Step 6 diffs against it.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`,
  `plans/015-surface-frontend-errors.md`, `plans/016-fix-query-cache-correctness.md`,
  `plans/017-fix-frontend-async-and-navigation.md`
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

### Sequencing — this plan runs LAST of plans 015–018

Not a preference. Both gates this plan installs are computed over the **whole**
of `frontend/src/`, so they see every string its siblings add. Running it early
means the gates go green, a sibling lands, and the suite breaks with a failure
that looks like the sibling's fault. Three concrete couplings, all verified:

1. **`plans/015` adds two new `t()` keys behind `defaultValue`** —
   `llm_council.session_delete_failed` (015 Step 4) and
   `errors.stale_data_warning` (015 Step 5). Gate #2 (Step 4 below) requires
   every `t("…")` key in `src/` to exist in `en.json`. This plan therefore
   **defines both**, and they are counted in the totals below. If 015 has not
   landed yet, defining them early is harmless — an unused catalogue key breaks
   nothing.
2. **`plans/015` Step 6 creates
   `frontend/src/components/shared/RouteErrorBoundary.tsx` with the literal
   `title="Something went wrong on this screen"`.** It cannot be translated —
   the boundary is a class component and cannot call the `useTranslation` hook.
   Gate #3 (Step 5 below) allowlists that exact `path::value`. The allowlist is
   a superset check, so the entry is harmless if 015 has not landed.
3. **`plans/015` Step 7 rewrites `LoginPage.tsx` first.** It deletes the dead
   `onSuccess`/`onError` callbacks, `handleSuccess`, `handleError` and the
   `loginError` state, because `TelegramLoginButton` uses `data-auth-url`
   (full-page redirect) and Telegram never invokes a JS callback. **Step 3 below
   has been rewritten against that post-015 file.** The earlier draft of this
   plan reproduced the whole file *including* the callbacks, which would have
   silently reverted 015's Step 7. Reordering the two plans does not fix that —
   the final file has to be callback-free **and** translated **and** have
   `role="alert"` **and** use `font-heading`, all at once.

`plans/016` and `plans/017` do not add `t()` calls or attribute literals, so
they only need to be *finished*, not specially coordinated.

**Dependency note**: this plan edits `.tsx` files. At commit `42826a3` the
repo's own typecheck gate (`make typecheck`, and CI) runs `tsc --noEmit`, which
in this project **exits 0 while loading zero files** because
`frontend/tsconfig.json` is a project-references stub with `files: []`. Plan 001
fixes that gate. This plan does not strictly block on 001 because every
verification below calls the working form, `npx tsc -b --noEmit`, directly. Run
001 first if it is available; otherwise proceed and rely on the explicit
commands in this file.

## Why this matters

The app ships two locale files that are in **perfect 1187/1187 parity**, which
makes the translation discipline look complete — but 88 translation keys are
called from `src/` and defined in **neither** file. One of them,
`pages.judge_comparison.description`, has no `defaultValue`, so the
judge-comparison empty state renders the literal string
`pages.judge_comparison.description` as body text to users right now. The other
87 are masked by inline `defaultValue` fallbacks, which silently force English
onto zh-TW readers across the LLM Council, Semantic Search and analytics chart
labels — including screen-reader-only `aria-label` text, the one class of string
a user cannot infer from context. Separately, `LoginPage.tsx` is 100% hardcoded
English with no `useTranslation` import at all, so a zh-TW user meets an entirely
English screen at the moment of sign-in, and its auth-failure message is rendered
in a plain `<div>` that assistive tech never announces.

The primary user of this product is a **self-representing immigration applicant**
under stress, not a lawyer. Showing them a raw dot-notation key, or an
untranslated sign-in screen, directly undermines the product's stated brand of
*authoritative, precise, academic*. None of this is visible to typecheck, lint,
or any of the 490 frontend tests, because `react-i18next` is globally mocked in
the Vitest setup file. After this plan lands: the raw key is gone, zh-TW readers
get real translations on those surfaces, the login screen is bilingual and
announces its error, and a test gate makes a missing key fail the build instead
of shipping.

## Current state

### Files in play

- `frontend/src/i18n/locales/en.json` — 1295 lines, 1187 flattened keys. English catalogue.
- `frontend/src/i18n/locales/zh-TW.json` — 1295 lines, 1187 flattened keys. Traditional Chinese catalogue. Symmetric difference against `en.json` is **empty** — the two are already in perfect sync, and this plan must keep them that way.
- `frontend/src/pages/LoginPage.tsx` — 57 lines. The `/login` route. Fully hardcoded English.
- `frontend/__tests__/i18n-hardcoded.test.ts` — 68 lines, 7 tests. Already a **static source-scanner** test file (it `readFileSync`s source files and regex-asserts on their text). This plan extends it in the same style.
- `frontend/__tests__/legislations-setup.ts` — the global Vitest setup file. **Read but do not modify** (see Out of scope).
- `frontend/src/i18n/index.ts` — i18next init. Read for context, not modified.

### i18next configuration (verified at `frontend/src/i18n/index.ts:19-37`)

```ts
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      'zh-TW': { common: zhTW },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  })
```

Installed versions (verified): `i18next 25.8.11`, `react-i18next 16.5.4`,
`react 19.2.4`, `vitest 4.0.18`, `typescript 5.9.3`.

### The one user-visible raw key — `frontend/src/pages/JudgeComparePage.tsx:69-73`

```tsx
      {names.length < 2 ? (
        <EmptyState
          title={t("pages.judge_comparison.min_judges")}
          description={t("pages.judge_comparison.description")}
        />
      ) : isLoading ? (
```

`pages.judge_comparison.min_judges` **is** defined in both locale files.
`pages.judge_comparison.description` is defined in neither and has no
`defaultValue`, so i18next returns the key itself. Verified empirically against
the installed i18next: `t("zz.nope2")` with no `defaultValue` and no resource
returns the string `"zz.nope2"`.

**This plan fixes it by adding the key to both locale files** —
`JudgeComparePage.tsx` itself is NOT modified and is out of scope.

### `frontend/src/pages/LoginPage.tsx` — the complete file as it exists today

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/shared/PageLoader";

const BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME || "immi_case_bot";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleSuccess = useCallback(() => navigate("/", { replace: true }), [navigate]);
  const handleError = useCallback((err: Error) => setLoginError(err.message), []);
  const authError = searchParams.get("auth_error");
  const visibleError = loginError || (authError ? "Telegram sign-in failed. Please try again." : null);

  if (isLoading) return <PageLoader />;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full p-8 rounded-xl shadow-lg bg-card border border-border">
        <h1 className="text-2xl font-bold text-foreground mb-2 font-serif">
          IMMI Case
        </h1>
        <p className="text-muted-text mb-8 text-sm">
          Australian immigration tribunal case research platform. Sign in with
          Telegram to save searches and collections.
        </p>
        {visibleError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {visibleError}
          </div>
        )}
        <div className="flex justify-center">
          <TelegramLoginButton
            botName={BOT_NAME}
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </div>
        <p className="mt-6 text-xs text-muted-text text-center">
          All 149,016 cases are publicly accessible without login. Login is only
          required to save searches and collections.
        </p>
      </div>
    </main>
  );
}
```

Four defects in that file:
1. `:24`, `:34-37`, `:51-53` — hardcoded English; the file never imports `useTranslation` (see the import block at `:1-5`).
2. `:38-42` — the error box is a plain `<div>` with no `role="alert"` and no `aria-live`, so a screen reader never announces the sign-in failure.
3. `:31` — `font-serif` is Tailwind's **default** serif stack. The project's Crimson Text heading font is bound to the `font-heading` utility. Verified: `frontend/src/tokens/tokens.css:41` defines `--font-heading: "Crimson Text", Georgia, "Times New Roman", serif;`, and `frontend/src/index.css:50` re-exports it as the `--font-heading` theme token. `LoginPage.tsx:31` is the **only** `font-serif` usage in the whole of `src/`; every other heading uses `font-heading` (e.g. `frontend/src/components/shared/PageHeader.tsx:39`). So the login `<h1>` is the one heading in the app not rendering in Crimson Text.
4. `:51` — the literal `149,016` is a hardcoded record count that will drift out of date.

### Existing test file style — `frontend/__tests__/i18n-hardcoded.test.ts:49-67`

```ts
  it('analytics.total key should exist in en.json', () => {
    const content = readFileSync(
      join(__dirname, '../src/i18n/locales/en.json'),
      'utf8'
    );
    const data = JSON.parse(content);
    expect(data.analytics).toBeDefined();
    expect(data.analytics.total).toBe('Total');
  });

  it('analytics.total key should exist in zh-TW.json', () => {
    const content = readFileSync(
      join(__dirname, '../src/i18n/locales/zh-TW.json'),
      'utf8'
    );
    const data = JSON.parse(content);
    expect(data.analytics).toBeDefined();
    expect(data.analytics.total).toBe('合計');
  });
```

These two are the **only** key-existence assertions anywhere in the repo. They
guard 1 key pair; 1,186 pairs are unguarded. The file uses single quotes, 2-space
indent, `describe`/`it` globals (Vitest `globals: true`), and CommonJS `__dirname`.
Match that style.

### Why no test can currently catch a missing key — `frontend/__tests__/legislations-setup.ts:64-81`

```ts
// Mock useTranslation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (
        options &&
        typeof options === "object" &&
        "defaultValue" in options &&
        typeof (options as { defaultValue?: unknown }).defaultValue === "string"
      ) {
        return (options as { defaultValue: string }).defaultValue;
      }
      return key;
    },
```

`frontend/vitest.config.ts` loads this via
`setupFiles: ["./__tests__/legislations-setup.ts"]`, so the mock applies to **all
55 collected test files**. No rendering test can ever observe a missing key.
That is why the gates added by this plan are **static source scans** over the
JSON and `.tsx` files, not rendering assertions.

### Locale file formatting (verified — this matters for Step 1)

Both files are byte-for-byte equal to
`json.dumps(data, ensure_ascii=False, indent=2) + "\n"`. A Python
load → merge → dump round-trip therefore reproduces the exact current formatting
and produces a diff containing **only** the added keys. Use that mechanism; do
not hand-edit two 1295-line JSON files.

### Repo conventions this plan must honour

Quoted from `CLAUDE.md` (the executor has not read it):

- **React / i18n**: *"i18n defaultValue pattern — always use `t("key", { defaultValue: "English text" })` for UI text; i18n mock in tests returns the key string without `defaultValue`, causing test assertion failures."*
- **React**: *"localStorage must be try-catch wrapped"*; *"Use `.toSorted()` not `.sort()` — never mutate arrays in React"*; *"useCallback deps must include `t`"* — `const { t } = useTranslation()` must appear in the dependency array of every `useCallback`/`useMemo` that calls it.
- **Design direction is decided and named "Legal Codex"**: warm off-white `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, **Crimson Text serif headings**, 9 court-specific colour codes. *"所有間距、陰影、圓角必須從 `tokens.json` 取值，不得出現魔法數字"* (all spacing/shadow/radius values come from `tokens.json`; no magic numbers).
- **Primary user**: a self-representing immigration applicant, not a lawyer. Brand: authoritative, precise, academic.
- **Commit convention**: `<type>: <description>`, type ∈ `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real example from `git log`: `fix: install root node_modules in make install`.

### zh-TW terminology already established in the catalogue

Match these when writing new translations (all verified present in both files):

| en | zh-TW | source key |
|---|---|---|
| LLM IMMI Council | LLM 移民評議會 | `llm_council.title` |
| Expert Model Opinions | 專家模型意見 | `llm_council.expert_title` |
| Council Ranking | 評議排序 | `llm_council.ranking_label` |
| Relevant Law Sections | 可參考法條條文 | `llm_council.law_sections_label` |
| Consensus | 共識 | `llm_council.consensus_label` |
| Sources | 資料來源 | `llm_council.sources_label` |
| Total | 合計 | `analytics.total` |
| Win Rate | 勝訴率 | `analytics.win_rate` |
| Cases (judge count) | 案件數 | `judges.cases` |
| cases (unit) | 件案例 | `common.cases` |
| Confirm | 確認 | `common.confirm` |
| No results found | 查無結果 | `common.no_results` |
| Searching... | 搜尋中⋯ | `common.searching` |
| Judge Profiles | 法官檔案 | `judges.title` |

Note the catalogue uses the full-width ellipsis `⋯` (U+22EF), not `...`, in
zh-TW strings.

## Commands you will need

All frontend commands run from `/Users/d/Developer/Active Projects/IMMI-Case-/frontend`.

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (working form) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` | exit 0, no output |
| Full frontend test suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | `0 failed`, and `AFTER_TESTS == BEFORE_TESTS + 7` with `AFTER_FILES == BEFORE_FILES`. **Never an absolute total** — `490 / 55 files` was the state at `42826a3`, before plans 015–017 (which this plan runs after) added tests |
| Just this plan's test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/i18n-hardcoded.test.ts` | `7 passed` before this plan, **`14 passed`** after. This per-file count is stable no matter what else landed, so it is the binding assertion |
| Lint frontend | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm run lint` | exit 0 |
| Count keys in a locale file | see the `flatten` snippet in Step 1 | 1187 before, **1280** after (88 missing + 3 `login.*` + 2 imported from `plans/015`) |
| **Production build** | `cd "…/frontend" && npm run build:cloudflare` | exit 0 — writes `frontend/dist`, which `wrangler.toml:15` serves. `npm run build` writes the local-dev Flask surface and is not the gate |
| Working-tree check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope files listed |

**Do NOT** use `npx tsc --noEmit` (without `-b`) to verify anything. In this
repo that command exits 0 while loading **zero** source files, because
`frontend/tsconfig.json` contains `files: []` plus project references only. It
will happily "pass" on broken code.

## Scope

**In scope** (the only files you may modify):

- `frontend/src/i18n/locales/en.json`
- `frontend/src/i18n/locales/zh-TW.json`
- `frontend/src/pages/LoginPage.tsx` — four targeted edits on the **post-plan-015**
  file; never a whole-file paste (see Step 3)
- `frontend/src/components/analytics/OutcomeFunnelChart.tsx` — **exactly one
  added line** (`lossPct: lossPct.toFixed(1),`, Step 1a). No other plan modifies
  this file; `plans/024` only names it inside a hex-colour debt allowlist.
- `frontend/__tests__/i18n-hardcoded.test.ts`

**Out of scope** (do NOT touch, even though they look directly related):

- `frontend/__tests__/legislations-setup.ts` — it is tempting to "fix" TEST-12 by removing or weakening the global `vi.mock("react-i18next")` at `:64`. **Do not.** That mock is loaded via `setupFiles` for all 55 test files and 490 tests; unmocking it would require every one of them to wrap components in an `I18nextProvider`. The correct fix, and the one this plan implements, is static source scanning that does not depend on the mock at all.
- `frontend/src/pages/JudgeComparePage.tsx` — the raw-key bug is fixed by defining `pages.judge_comparison.description` in the locale files. No call-site change is needed or wanted.
- `frontend/src/components/judges/JudgeLeaderboard.tsx`, `frontend/src/components/llm-council/*`, `frontend/src/components/layout/TenantSwitcher.tsx`, `frontend/src/components/shared/ConfirmModal.tsx`, `frontend/src/components/shared/AnalyticsFilters.tsx`, `frontend/src/pages/LlmCouncilPage.tsx` — these are owned by other plans running in parallel. Editing them causes merge conflicts. Their untranslated literals are captured by the Step 5 ratchet allowlist and listed in "Maintenance notes" as deferred follow-up.
- `frontend/src/i18n/index.ts` — no config change is required.
- The `judges.load_more` key — see Step 1, it must **not** be defined. Defining it is an active regression.
- Any Python, Worker, or `immi_case_downloader/` file.

## Git workflow

- Branch: `advisor/018-complete-the-i18n-catalogue`
  ```bash
  cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git checkout -b advisor/018-complete-the-i18n-catalogue
  ```
- One commit per step, conventional-commit style. Suggested messages:
  - Step 1–2: `fix: define the 88 i18n keys used but missing from both locales`
  - Step 3: `fix: translate LoginPage and announce its auth error`
  - Steps 4–5: `test: gate locale parity, missing i18n keys, and a11y literals`
- No AI attribution lines in commit messages.
- **Do NOT push, do NOT open a PR, do NOT merge.** The operator commits and ships.

## Steps

### Step 1: Add the 88 missing catalogue keys plus 3 new `login.*` keys to `en.json`

Create a throwaway merge script at `/tmp/immi-i18n-merge.py` (outside the repo —
do not add a script file to the repository) and run it. The script must
load → deep-merge → dump with `ensure_ascii=False, indent=2` and a trailing
newline, which reproduces the files' existing formatting exactly.

**Three traps this data set contains. Read them before writing the script.**

**Trap A — six keys receive interpolation variables.** Their call sites pass a
JS template literal as `defaultValue` with the values already substituted. Once
the key exists in the catalogue, i18next uses the catalogue value and the
`defaultValue` is ignored — so the catalogue value must use i18next `{{var}}`
syntax with the **exact variable names the call site passes**, or the numbers
vanish. Verified empirically against installed i18next 25.8.11:

| key | vars actually passed | catalogue value must be |
|---|---|---|
| `dashboard.court_sparkline_aria` | `court`, `total` | `{{court}}: {{total}} total cases` |
| `dashboard.peak_year` | `year` | `Peak: {{year}}` |
| `analytics.outcome_funnel_aria` | `win`, `loss`, `winPct` **+ `lossPct` after Step 1a** | `Wins: {{win}} ({{winPct}}%), Losses: {{loss}} ({{lossPct}}%)` |
| `analytics.outcome_distribution_aria` | `summary` | `Outcome distribution: {{summary}}` |
| `semantic_search.results_count` | `count` | plural pair, see Trap B |
| `judges.load_more` | **none** | **do not define — see Trap C** |

**Step 1a — pass `lossPct`, do not drop it.** The earlier draft of this plan
resolved `analytics.outcome_funnel_aria` by writing a catalogue value **without**
the loss percentage, because `lossPct` is not in the options object at
`frontend/src/components/analytics/OutcomeFunnelChart.tsx:18-22`. Verified: the
options are `win`, `loss`, `winPct` and `defaultValue`, while the `defaultValue`
template renders `Losses: … (${lossPct.toFixed(1)}%)`. So defining the key as
drafted would **silently delete information from a screen-reader-only label** —
the one class of string a sighted user cannot recover from context, on the chart
that answers "how often does this argument lose?". That is a regression dressed
as a translation.

The value is already computed one line above, at
`OutcomeFunnelChart.tsx:13` (`const lossPct = total > 0 ? (lossCount / total) * 100 : 0;`).
Pass it. Add **one line** to the options object:

```tsx
        lossPct: lossPct.toFixed(1),
```

immediately after the existing `winPct: winPct.toFixed(1),`, and leave the
`defaultValue` exactly as it is. `frontend/src/components/analytics/OutcomeFunnelChart.tsx`
is added to this plan's In-scope list for this single line and nothing else. No
other plan modifies that file — `plans/024-add-accessibility-gates.md` only
names it inside a hex-colour debt allowlist, which one interpolation option
cannot affect.

**Trap B — `semantic_search.results_count` passes `count`, which triggers
i18next pluralisation.** Define it as a `_one` / `_other` pair, not a single key.
Verified: with `results_count_one` + `results_count_other` defined, `count=1`
renders `1 result` and `count=5` renders `5 results`; under `zh-TW` both counts
render the single Chinese form. Defining only the base key also works but
produces the ungrammatical `1 results` in English.

**Trap C — `judges.load_more` must NOT be defined.** Its call site
(`frontend/src/components/judges/JudgeLeaderboard.tsx:88-90`) passes **no**
interpolation variables at all — the numbers are baked into the template literal
`defaultValue`. Verified empirically: with a catalogue value of
`Load {{nextBatch}} more`, i18next renders the literal string
`Load {{nextBatch}} more` to the user. Defining this key is strictly worse than
leaving it. It stays English-only until the call site is changed, which is a
different plan's file. **Total keys added: 88, not 89.**

**The data.** Add exactly these leaves. Existing sibling keys in these
namespaces must be preserved — deep-merge, never replace a namespace object.

`analytics` (20):

| key | en |
|---|---|
| `deep_analysis_description` | `Success rate analysis` |
| `flow_cases` | `Cases` |
| `flow_sankey_aria` | `Flow diagram showing case nature and outcome distribution` |
| `flow_source` | `Source` |
| `flow_target` | `Target` |
| `judge_profile_hint` | `Win rate data on Judge Profile page` |
| `legal_concepts_aria` | `Bar chart of top legal concepts by case count` |
| `legend` | `Legend` |
| `losses` | `Losses` |
| `most_active_judges` | `Most Active Judges` |
| `outcome_distribution_aria` | `Outcome distribution: {{summary}}` |
| `outcome_funnel_aria` | `Wins: {{win}} ({{winPct}}%), Losses: {{loss}} ({{lossPct}}%)` |
| `sankey_view` | `Flow View` |
| `show_count` | `Count` |
| `show_pct` | `% of row` |
| `table_view` | `Table View` |
| `top_judges_aria` | `Bar chart of most active judges by case count` |
| `trend_legend_note` | `Affirmed Rate = tribunal upholds decision \| Applicant Win Rate = Set Aside + Remitted` |
| `vs_avg` | `vs avg` |
| `wins` | `Wins` |

(`trend_legend_note` contains a literal pipe character `|` between the two
clauses — it is escaped in this markdown table only.)

`auth` (2, new namespace): `logout` = `Sign out`; `sign_in` = `Sign in`

`bookmarks` (1): `collection_not_found_description` = `This collection could not be found. It may have been deleted or renamed.`

`cases` (4):

| key | en |
|---|---|
| `no_similar_cases` | `No similar cases found.` |
| `page_subtitle` | `Review, compare, and manage immigration case records from one workspace.` |
| `similar_cases` | `Similar Cases` |
| `similarity_score` | `Similarity score` |

`common` (2): `clear` = `Clear`; `loading_message` = `Preparing the latest data and interface state.`

`components.charts` (3 — nested two deep under the existing `components` namespace):

| key | en |
|---|---|
| `court_bar_aria` | `Bar chart: cases by court` |
| `nature_bar_aria` | `Horizontal bar chart: case categories by volume` |
| `subclass_bar_aria` | `Horizontal bar chart: top visa subclasses by volume` |

`dashboard` (2): `court_sparkline_aria` = `{{court}}: {{total}} total cases`; `peak_year` = `Peak: {{year}}`

`judges` (2 — **not** `load_more`): `cases_unit` = `cases`; `dual_metric_chart` = `Dual metric comparison chart`

`llm_council` (39):

| key | en |
|---|---|
| `awaiting_label` | `Awaiting panel` |
| `case_id_help` | `If provided, the case context is auto-included in the prompt.` |
| `chairman_label` | `Council Chairman` |
| `citation_confidence` | `Citation overlap` |
| `deliberating` | `Council deliberating` |
| `elapsed` | `Elapsed` |
| `experts_ok_label` | `OK` |
| `eyebrow` | `Multi-Model Legal Research` |
| `follow_up_input_label` | `Follow-up question` |
| `follow_up_label` | `Follow-up Questions` |
| `follow_up_placeholder` | `Ask a follow-up question — drill into a specific ground, request more case citations, or test counter-arguments...` |
| `ios_send_hint` | `Tap Send button (no Cmd+Enter on iOS)` |
| `kbd_hint` | `to send` |
| `law_section_col` | `Statute / Regulation` |
| `law_sections_table_title` | `Statute Citations Cross-Reference` |
| `moderator_section_title` | `Moderator Synthesis` |
| `new_session_btn` | `New Council Session` |
| `no_sessions_yet` | `No past sessions yet.` |
| `past_sessions_heading` | `Past Sessions` |
| `running_moderator_label` | `Moderator` |
| `select_session_hint` | `Select a session to view it.` |
| `send_btn` | `Send` |
| `session_load_failed` | `Failed to load session` |
| `session_not_found` | `Session not found` |
| `sessions_load_error` | `Failed to load sessions.` |
| `sessions_subtitle` | `Browse and continue past council sessions.` |
| `sessions_title` | `LLM Council Sessions` |
| `shared_col` | `All Agree` |
| `sidebar_panel_title` | `Panel Composition` |
| `sidebar_sample_prompts` | `Sample Prompts` |
| `sidebar_tips_title` | `Quick Tips` |
| `start_new_btn` | `Start a new session` |
| `swipe_to_send_label` | `Swipe right, or tap, to submit your question` |
| `tip_label` | `Tip` |
| `turn_count_label` | `Turn` |
| `turn_label` | `Turn` |
| `turn_limit_placeholder` | `Turn limit reached (15/15)` |
| `turn_limit_reached` | `You have reached the maximum of 15 turns for this session.` |
| `turn_your_question` | `Your question` |

`pages.judge_comparison` (1 — nested under the existing `pages.judge_comparison`
object, which already holds `min_judges`, `title`, `cases` and 8 more; do not
disturb them):

`description` = `Pick two or more judges from the profiles list to see their outcomes side by side.`

`semantic_search` (11 logical keys → **12 leaves**, new namespace):

| key | en |
|---|---|
| `title` | `Semantic Search` |
| `description` | `Search by meaning, not just keywords. Uses AI embeddings to find semantically similar cases.` |
| `placeholder` | `Describe the case situation… (min 3 chars)` |
| `searching` | `Searching…` |
| `search_btn` | `Search` |
| `model_label` | `Model:` |
| `results_region_label` | `Search results` |
| `unavailable` | `Semantic search is temporarily unavailable. Keyword search still works — try the search box at the top of the page.` |
| `no_results_title` | `No results found` |
| `no_results_desc` | `Try rephrasing or using different terminology.` |
| `results_count_one` | `{{count}} result` |
| `results_count_other` | `{{count}} results` |

`login` (3 — **new namespace**, consumed by Step 3):

| key | en |
|---|---|
| `description` | `Australian immigration tribunal case research platform. Sign in with Telegram to save searches and collections.` |
| `telegram_failed` | `Telegram sign-in failed. Please try again.` |
| `public_access_note` | `All cases are publicly accessible without login. Login is only required to save searches and collections.` |

**Two keys imported from `plans/015-surface-frontend-errors.md`** (see
Sequencing). 015 calls both behind a `defaultValue`, so they are invisible today
but become gate-#2 failures the moment 015 lands without them. The `en` value
must match 015's `defaultValue` **exactly**:

| key | en |
|---|---|
| `llm_council.session_delete_failed` | `Could not delete this session. Please try again.` |
| `errors.stale_data_warning` | `Live updates paused — this may be out of date. Retrying automatically.` |

(`llm_council` is an existing namespace; `errors` is too — both already hold
sibling keys, so deep-merge, never replace.)

Leaf arithmetic: 20 + 2 + 1 + 4 + 2 + 3 + 2 + 2 + 39 + 1 + 12 = **88** missing
keys, plus 3 `login.*` and 2 imported from plan 015 = **93** new leaves.
1187 + 93 = **1280**.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 -c "
import json
def flat(o,p=''):
    out={}
    if isinstance(o,dict):
        for k,v in o.items(): out.update(flat(v,f'{p}.{k}' if p else k))
    else: out[p]=o
    return out
raw=open('src/i18n/locales/en.json').read()
d=json.loads(raw)
f=flat(d)
print('keys:', len(f))
print('formatting preserved:', json.dumps(d,ensure_ascii=False,indent=2)+chr(10)==raw)
print('judges.load_more absent:', 'judges.load_more' not in f)
print('raw-key fix:', f.get('pages.judge_comparison.description'))
print('siblings intact:', f.get('pages.judge_comparison.min_judges'))
print('plan-015 keys:', f.get('llm_council.session_delete_failed') is not None,
                        f.get('errors.stale_data_warning') is not None)
print('lossPct present:', '{{lossPct}}' in f.get('analytics.outcome_funnel_aria',''))
print('no supabase in semantic_search.unavailable:',
      'Supabase' not in f.get('semantic_search.unavailable',''))
"
```
→ `keys: 1280` / `formatting preserved: True` / `judges.load_more absent: True` /
`raw-key fix: Pick two or more judges from the profiles list to see their outcomes side by side.` /
`siblings intact: Select at least two judges to compare.` /
`plan-015 keys: True True` / `lossPct present: True` /
`no supabase in semantic_search.unavailable: True`

And confirm the Step 1a call-site change landed, because the catalogue value is
useless without it:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -c 'lossPct: lossPct.toFixed(1)' src/components/analytics/OutcomeFunnelChart.tsx
```
→ `1`

### Step 2: Mirror all 93 keys into `zh-TW.json` with Traditional Chinese values

**Steps 1 and 2 must land as ONE commit.** Between them the two catalogues are
out of parity, and the very first gate this plan installs (Step 4's parity test)
asserts they never are. A commit that fails a gate the same branch adds is a
broken commit, not a stylistic one. Do the two steps back to back and commit
once: `fix: define the i18n keys used but missing from both locales`.

Same merge mechanism, same key paths, translated values. Match the terminology
table in "Current state" and use the full-width ellipsis `⋯` where the English
uses `…`/`...`.

`analytics`:

| key | zh-TW |
|---|---|
| `deep_analysis_description` | `勝訴率分析` |
| `flow_cases` | `案件數` |
| `flow_sankey_aria` | `顯示案件性質與結果分布的流向圖` |
| `flow_source` | `來源` |
| `flow_target` | `目標` |
| `judge_profile_hint` | `勝訴率資料請見法官檔案頁面` |
| `legal_concepts_aria` | `依案件數排序之主要法律概念長條圖` |
| `legend` | `圖例` |
| `losses` | `敗訴` |
| `most_active_judges` | `最活躍法官` |
| `outcome_distribution_aria` | `結果分布：{{summary}}` |
| `outcome_funnel_aria` | `勝訴：{{win}} 件（{{winPct}}%），敗訴：{{loss}} 件（{{lossPct}}%）` |
| `sankey_view` | `流向檢視` |
| `show_count` | `件數` |
| `show_pct` | `列百分比` |
| `table_view` | `表格檢視` |
| `top_judges_aria` | `依案件數排序之最活躍法官長條圖` |
| `trend_legend_note` | `維持原判率＝法庭維持原決定｜申請人勝訴率＝撤銷＋發回重審` |
| `vs_avg` | `對比平均` |
| `wins` | `勝訴` |

`auth`: `logout` = `登出`; `sign_in` = `登入`

`bookmarks`: `collection_not_found_description` = `找不到此收藏集，可能已被刪除或更名。`

`cases`: `no_similar_cases` = `查無相似案例。`; `page_subtitle` = `於單一工作區檢閱、比較並管理移民案件紀錄。`; `similar_cases` = `相似案例`; `similarity_score` = `相似度分數`

`common`: `clear` = `清除`; `loading_message` = `正在準備最新資料與介面狀態。`

`components.charts`: `court_bar_aria` = `長條圖：各法院案件數`; `nature_bar_aria` = `橫向長條圖：各案件類別數量`; `subclass_bar_aria` = `橫向長條圖：主要簽證類別數量`

`dashboard`: `court_sparkline_aria` = `{{court}}：共 {{total}} 件案例`; `peak_year` = `高峰：{{year}}`

`judges`: `cases_unit` = `件案例`; `dual_metric_chart` = `雙指標比較圖`

`llm_council`:

| key | zh-TW |
|---|---|
| `awaiting_label` | `等待評議中` |
| `case_id_help` | `若已填寫，系統會自動將案件內容納入提示。` |
| `chairman_label` | `評議會主席` |
| `citation_confidence` | `引用重疊度` |
| `deliberating` | `評議會審議中` |
| `elapsed` | `已耗時` |
| `experts_ok_label` | `正常` |
| `eyebrow` | `多模型法律研究` |
| `follow_up_input_label` | `追問問題` |
| `follow_up_label` | `追問問題` |
| `follow_up_placeholder` | `提出追問——深入特定理由、要求更多案例引用，或檢驗反面論點⋯` |
| `ios_send_hint` | `請點擊送出按鈕（iOS 不支援 Cmd+Enter）` |
| `kbd_hint` | `送出` |
| `law_section_col` | `法條／法規` |
| `law_sections_table_title` | `法條引用交叉對照` |
| `moderator_section_title` | `Moderator 綜合整理` |
| `new_session_btn` | `新增評議會工作階段` |
| `no_sessions_yet` | `尚無歷史工作階段。` |
| `past_sessions_heading` | `歷史工作階段` |
| `running_moderator_label` | `Moderator` |
| `select_session_hint` | `請選擇欲檢視的工作階段。` |
| `send_btn` | `送出` |
| `session_load_failed` | `工作階段載入失敗` |
| `session_not_found` | `查無此工作階段` |
| `sessions_load_error` | `工作階段清單載入失敗。` |
| `sessions_subtitle` | `瀏覽並接續過往的評議會工作階段。` |
| `sessions_title` | `LLM 評議會工作階段` |
| `shared_col` | `三方一致` |
| `sidebar_panel_title` | `評議小組組成` |
| `sidebar_sample_prompts` | `範例提問` |
| `sidebar_tips_title` | `快速提示` |
| `start_new_btn` | `開始新的工作階段` |
| `swipe_to_send_label` | `向右滑動或點擊以送出問題` |
| `tip_label` | `提示` |
| `turn_count_label` | `回合` |
| `turn_label` | `回合` |
| `turn_limit_placeholder` | `已達回合上限（15/15）` |
| `turn_limit_reached` | `此工作階段已達 15 回合上限。` |
| `turn_your_question` | `你的提問` |

`pages.judge_comparison`: `description` = `請從法官檔案清單挑選兩位以上法官，即可並列比較其裁決結果。`

`semantic_search`:

| key | zh-TW |
|---|---|
| `title` | `語意搜尋` |
| `description` | `以語意而非僅關鍵字搜尋。運用 AI 向量嵌入找出語意相近的案例。` |
| `placeholder` | `描述案件情境⋯（至少 3 個字元）` |
| `searching` | `搜尋中⋯` |
| `search_btn` | `搜尋` |
| `model_label` | `模型：` |
| `results_region_label` | `搜尋結果` |
| `unavailable` | `語意搜尋暫時無法使用。關鍵字搜尋仍可正常運作，請改用頁面上方的搜尋框。` |
| `no_results_title` | `查無結果` |
| `no_results_desc` | `請嘗試換個說法或使用不同的用語。` |
| `results_count_one` | `{{count}} 筆結果` |
| `results_count_other` | `{{count}} 筆結果` |

`login`: `description` = `澳洲移民法庭案件研究平台。以 Telegram 登入即可儲存搜尋與收藏集。`;
`telegram_failed` = `Telegram 登入失敗，請再試一次。`;
`public_access_note` = `所有案例無須登入即可公開瀏覽。僅在儲存搜尋與收藏集時才需登入。`

Imported from `plans/015`: `llm_council.session_delete_failed` =
`無法刪除此工作階段，請再試一次。`; `errors.stale_data_warning` =
`即時更新已暫停，畫面內容可能非最新。系統將自動重試。`

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 -c "
import json
def flat(o,p=''):
    out={}
    if isinstance(o,dict):
        for k,v in o.items(): out.update(flat(v,f'{p}.{k}' if p else k))
    else: out[p]=o
    return out
en=flat(json.load(open('src/i18n/locales/en.json')))
raw=open('src/i18n/locales/zh-TW.json').read()
zh=flat(json.loads(raw))
print('en:',len(en),'zh:',len(zh))
print('en-only:', sorted(set(en)-set(zh)))
print('zh-only:', sorted(set(zh)-set(en)))
print('formatting preserved:', json.dumps(json.loads(raw),ensure_ascii=False,indent=2)+chr(10)==raw)
print('interp vars match:', all(
    sorted(__import__('re').findall(r'{{(\w+)}}',en[k]))==sorted(__import__('re').findall(r'{{(\w+)}}',zh[k]))
    for k in en if isinstance(en[k],str) and '{{' in en[k]))
"
```
→ `en: 1280 zh: 1280` / `en-only: []` / `zh-only: []` /
`formatting preserved: True` / `interp vars match: True`

The `interp vars match` line is a **one-shot shell probe**, not a gate. Step 4
turns the same check into a permanent test — do not treat this run as the
regression guard.

Then confirm nothing else broke:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -6
```
→ **0 failed**, and the pass count is unchanged from the baseline you recorded
before Step 1 (no test reads these keys yet). Assert "unchanged from the
baseline you recorded", not an absolute number — plans 015–017 add tests to this
same suite.

### Step 3: Translate `LoginPage.tsx`, announce its error, and use the heading font

**Read this before you touch the file.** The "complete file as it exists today"
quoted in Current state is the file at `42826a3`, **before**
`plans/015-surface-frontend-errors.md` Step 7. 015 deletes `handleSuccess`,
`handleError`, the `loginError` state, the `useCallback`/`useState` imports, and
the two `onSuccess`/`onError` props on `<TelegramLoginButton>` — because the
widget is configured with `data-auth-url`
(`frontend/src/components/auth/TelegramLoginButton.tsx:43`), the full-page
redirect flow, so Telegram never invokes a JS callback and those props are
unfireable. An earlier draft of this step pasted the whole pre-015 file back,
which would have silently reverted that. **Do not paste a whole file. Make the
four targeted edits below against whatever is on disk.**

First confirm which shape you are looking at:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -c "onSuccess\|onError\|loginError" src/pages/LoginPage.tsx
```

- `0` → 015 has landed. Apply the four edits to the post-015 file. This is the
  expected path.
- non-zero → 015 has **not** landed. **STOP and report**; do not proceed. Running
  this step first and 015 second is fine on paper, but 015's Step 7 verification
  asserts `grep -c "onSuccess\|onError" … → 0` on a file that will by then also
  contain your `useTranslation` edits, and the two agents will be editing the
  same twelve lines. The dependency is declared for a reason.

Four changes, and nothing else:

1. Add `import { useTranslation } from "react-i18next";` after the
   `react-router-dom` import, and `const { t } = useTranslation();` as the first
   line of the component body.
2. Route the three user-facing strings through the `login.*` keys added in Steps 1–2, each with an inline `defaultValue` matching the `en.json` value (the repo convention, and it keeps the Vitest mock rendering readable English).
3. Add `role="alert"` to the error container so assistive tech announces a sign-in failure.
4. `font-serif` → `font-heading` on the `<h1>`, so the login heading renders in Crimson Text like every other heading in the app. (This is the only `font-serif` in `src/`; every other heading already uses `font-heading`.)

Also drop the hardcoded `149,016` — that is carried by the new
`login.public_access_note` copy, which is deliberately non-numeric. Do **not**
wire in `useStats()`; that would fire an analytics API request on the
unauthenticated login screen purely to print a number, and the number drifts.

`"IMMI Case"` in the `<h1>` stays a bare literal: it is the product name, not
copy, and product names are not translated.

`t` is used only in the render body, not inside any `useCallback`/`useMemo`, so
no dependency array changes are needed.

After 015 has landed, the post-015 file has no `useCallback`, no `useState` and
no `loginError`, so `visibleError` is simply:

```tsx
  const authError = searchParams.get("auth_error");
  const visibleError = authError
    ? t("login.telegram_failed", {
        defaultValue: "Telegram sign-in failed. Please try again.",
      })
    : null;
```

and the three JSX edits are:

```tsx
        <h1 className="text-2xl font-bold text-foreground mb-2 font-heading">
          IMMI Case
        </h1>
        <p className="text-muted-text mb-8 text-sm">
          {t("login.description", {
            defaultValue:
              "Australian immigration tribunal case research platform. Sign in with Telegram to save searches and collections.",
          })}
        </p>
        {visibleError && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {visibleError}
          </div>
        )}
```

```tsx
        <p className="mt-6 text-xs text-muted-text text-center">
          {t("login.public_access_note", {
            defaultValue:
              "All cases are publicly accessible without login. Login is only required to save searches and collections.",
          })}
        </p>
```

Leave `<TelegramLoginButton botName={BOT_NAME} />` exactly as 015 left it —
**no `onSuccess`, no `onError`.** Those props no longer exist on the component's
prop type, so re-adding them would not even compile.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && echo TSC_OK && npm run lint >/dev/null 2>&1 && echo LINT_OK && grep -c 'font-serif\|149,016\|onSuccess\|onError' src/pages/LoginPage.tsx; grep -c 'role="alert"\|useTranslation' src/pages/LoginPage.tsx
```
→ `TSC_OK`, `LINT_OK`, then `0` (no `font-serif`, no `149,016`, and 015's
callback deletion is still intact), then `3` (`useTranslation` import + call,
plus `role="alert"`).

All four properties must hold **simultaneously** — that combined grep is the
check that catches a paste of the pre-015 file, which would otherwise typecheck
fine only until `TelegramLoginButtonProps` no longer has the props.

Also confirm `font-serif` is now absent from the whole app:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -rn "font-serif" --include='*.tsx' src | wc -l
```
→ `0`

### Step 4: Gate locale parity, missing translation keys, and interpolation parity

**Say what these gates cover, and do not oversell them.** These are regex scans
over source text, not an AST walk, so they are sound (no false positives) but
not complete. Measured against `frontend/src/` at `42826a3`:

| Form | Detected? | Live instances |
|---|---|---|
| `t("a.b.c")`, `t('a.b.c')`, `` t(`a.b.c`) `` | yes | all of them |
| `i18n.t("a.b.c")` | **no** | **0** — the pattern does not appear in `src/` (`grep -rn "i18n\.t(" src \| wc -l` → 0) |
| `<Trans i18nKey="…">` | **no** | **0** — the only `<Trans` match in `src/` is the component `<TransitionEvents`, a substring false positive |
| a key built at runtime (`t(\`x.${v}\`)`) | **no** | **0** — `grep -rEn '[^A-Za-z0-9_$.]t\(\s*`' src \| wc -l` → 0 |

So the gate is complete **for the code as it stands**, and the two theoretical
bypasses (`i18n.t`, `<Trans>`) have zero live instances. That is worth writing
down rather than claiming completeness the regex does not have: if someone
introduces `<Trans>` later, this gate will not see it, and the fixture test
below documents exactly that boundary so the next reader is not misled.

Append **four** `it(...)` blocks inside the existing
`describe('i18n hardcoded string checks', ...)` in
`frontend/__tests__/i18n-hardcoded.test.ts`. Keep the file's existing style:
single quotes, 2-space indent, `readFileSync`/`join`/`__dirname`, Vitest globals
(no imports of `describe`/`it`/`expect` — `globals: true` is set in
`frontend/vitest.config.ts`).

Add `readdirSync` to the existing `fs` import and `extname`/`relative` to the
`path` import as needed.

```ts
  it('en.json and zh-TW.json define exactly the same key set', () => {
    const flatten = (obj: unknown, prefix = ''): Record<string, string> => {
      const out: Record<string, string> = {};
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
        }
      } else {
        out[prefix] = String(obj);
      }
      return out;
    };
    const load = (name: string) =>
      flatten(
        JSON.parse(
          readFileSync(join(__dirname, `../src/i18n/locales/${name}`), 'utf8')
        )
      );
    const en = load('en.json');
    const zh = load('zh-TW.json');
    expect(Object.keys(en).filter((k) => !(k in zh))).toEqual([]);
    expect(Object.keys(zh).filter((k) => !(k in en))).toEqual([]);
  });

  it('every t("...") key used in src/ is defined in en.json', () => {
    // Keys deliberately left undefined so their call-site defaultValue wins.
    // judges.load_more: JudgeLeaderboard.tsx passes NO interpolation vars with
    // its template-literal defaultValue, so a catalogue entry would render the
    // literal "{{nextBatch}}" to users. Defining it requires a call-site change.
    const INTENTIONALLY_UNDEFINED = new Set(['judges.load_more']);

    const flatten = (obj: unknown, prefix = ''): Record<string, string> => {
      const out: Record<string, string> = {};
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
        }
      } else {
        out[prefix] = String(obj);
      }
      return out;
    };
    const en = flatten(
      JSON.parse(
        readFileSync(join(__dirname, '../src/i18n/locales/en.json'), 'utf8')
      )
    );

    const srcRoot = join(__dirname, '../src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return /\.tsx?$/.test(e.name) ? [full] : [];
      });

    // Matches t("a.b.c"  — not obj.t(, not someT(.
    const T_CALL = /(?<![A-Za-z0-9_$.])t\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
    const missing: string[] = [];
    for (const file of walk(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(T_CALL)) {
        const key = m[1];
        if (INTENTIONALLY_UNDEFINED.has(key)) continue;
        // i18next plural keys live as <key>_one / <key>_other.
        const defined = key in en || `${key}_other` in en;
        if (!defined) {
          missing.push(`${relative(srcRoot, file)} -> ${key}`);
        }
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('en and zh-TW agree on interpolation variables and plural forms', () => {
    // Step 2 checked this once from a shell. A one-shot probe is not a gate:
    // the failure mode it guards (a translator drops {{winPct}}, or defines
    // _one without _other) is silent at runtime — i18next renders the literal
    // braces or the wrong grammatical form and nothing throws.
    const flatten = (obj: unknown, prefix = ''): Record<string, string> => {
      const out: Record<string, string> = {};
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
        }
      } else {
        out[prefix] = String(obj);
      }
      return out;
    };
    const load = (name: string) =>
      flatten(
        JSON.parse(
          readFileSync(join(__dirname, `../src/i18n/locales/${name}`), 'utf8')
        )
      );
    const en = load('en.json');
    const zh = load('zh-TW.json');

    const vars = (s: string) =>
      [...s.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1]).sort();

    const mismatched: string[] = [];
    for (const key of Object.keys(en)) {
      const a = vars(en[key]);
      const b = vars(zh[key] ?? '');
      if (a.join(',') !== b.join(',')) {
        mismatched.push(`${key}: en[${a}] zh[${b}]`);
      }
    }
    expect(mismatched.sort()).toEqual([]);

    // Plural completeness: _one without _other (or vice versa) is a runtime
    // fallback to the raw key on whichever count is missing.
    const lonelyPlurals: string[] = [];
    for (const catalogue of [en, zh]) {
      for (const key of Object.keys(catalogue)) {
        if (key.endsWith('_one') && !(`${key.slice(0, -4)}_other` in catalogue)) {
          lonelyPlurals.push(key);
        }
        if (
          key.endsWith('_other') &&
          !(`${key.slice(0, -6)}_one` in catalogue)
        ) {
          lonelyPlurals.push(key);
        }
      }
    }
    expect([...new Set(lonelyPlurals)].sort()).toEqual([]);
  });

  it('the key scanner detects every t() quoting form it claims to', () => {
    // A gate that has never been shown to fire on each syntax it claims to
    // cover is a guess. These fixtures pin the T_CALL regex's real behaviour —
    // including the two forms it does NOT cover, so nobody later assumes it
    // does. Keep this regex byte-identical to the one above.
    const T_CALL = /(?<![A-Za-z0-9_$.])t\(\s*["'`]([A-Za-z0-9_.]+)["'`]/g;
    const found = (src: string) =>
      [...src.matchAll(T_CALL)].map((m) => m[1]);

    // Detected:
    expect(found('t("a.b")')).toEqual(['a.b']);
    expect(found("t('a.b')")).toEqual(['a.b']);
    expect(found('t(`a.b`)')).toEqual(['a.b']);
    expect(found('{t(  "a.b", { defaultValue: "x" })}')).toEqual(['a.b']);
    // Not confused by a lookalike:
    expect(found('obj.t("a.b")')).toEqual([]);
    expect(found('someT("a.b")')).toEqual([]);
    // KNOWN BLIND SPOTS — zero live instances in src/ at 42826a3. If either of
    // these ever returns a key, the gate got stronger and this expectation
    // should be updated, not deleted.
    expect(found('i18n.t("a.b")')).toEqual([]);
    expect(found('<Trans i18nKey="a.b" />')).toEqual([]);
  });
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | tail -8
```
→ `11 passed` (7 pre-existing + 4 new), `Test Files 1 passed`.

Then prove the second gate actually bites — temporarily break it and confirm a
failure, then restore:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 -c "
import json
p='src/i18n/locales/en.json'
d=json.load(open(p)); saved=d['pages']['judge_comparison'].pop('description')
open(p,'w').write(json.dumps(d,ensure_ascii=False,indent=2)+chr(10))
" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | grep -c "pages.judge_comparison.description"
```
→ a count **≥ 1** (the gate names the missing key). Now restore:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git checkout -- frontend/src/i18n/locales/en.json && cd frontend && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | tail -5
```
→ `11 passed`. This scoped `git checkout --` targets one specific file whose
only uncommitted change is the one you made two commands earlier, so it is safe;
it is the single exception to the "never `git checkout --`" rule in the drift
check. **If Step 1 is not yet committed, `git checkout --` will discard Step 1's
work too** — in that case re-apply Step 1's merge script and re-verify rather
than assuming the restore worked. Confirm either way:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 -c "
import json
d=json.load(open('src/i18n/locales/en.json'))
print('restored:', 'description' in d['pages']['judge_comparison'])"
```
→ `restored: True`

### Step 5: Ratchet the hardcoded accessibility literals

**The draft regex missed a whole syntax, and real untranslated English is
hiding in it.** `\b(?:aria-label|placeholder|title)="([^"]+)"` matches only the
plain double-quoted form. Measured over `frontend/src/**/*.tsx` at `42826a3`:

| Attribute form | Draft regex | Live instances (excl. `DesignTokensPage.tsx`) |
|---|---|---|
| `attr="Text"` | matched | 15 occurrences / 14 distinct values |
| `attr='Text'` | missed | 0 |
| `attr={"Text"}` / `attr={'Text'}` | missed | 0 |
| ``attr={`Text ${v}`}`` | **missed** | **11 distinct, and 7 of them contain untranslated English prose** |

The template-literal form is not hypothetical. Among the 11:
`aria-label={\`Open case ${c.citation || c.case_id}\`}`
(`components/cases/CasesTable.tsx:151`),
`aria-label={\`Compare ${displayName}\`}` (`components/judges/JudgeCard.tsx:107`
and `components/judges/JudgeLeaderboard.tsx:139`),
`title={\`Jump to section ${ref}\`}` (`components/legislation/LegislationTextViewer.tsx:185`),
`aria-label={\`Turn ${turnNumber}\`}` (`components/llm-council/TurnCard.tsx:548`).
So a gate that claims to "fail on any new hardcoded aria-label" while missing
that form is a gate whose green is misleading — the very failure the ratchet
exists to prevent can be added, today, in one keystroke's worth of different
syntax.

Two detectors then, both allowlisted, both proven by fixtures. Together they
fail on **any new** English literal in an `aria-label`, `title` or `placeholder`
attribute written in any of the five quoting forms above.

**What they still do not cover** — write this down rather than implying
completeness: visible text nodes (`<span>Delete</span>`), strings composed by a
helper and passed as a variable (`aria-label={label}`), and attributes assembled
across multiple lines. Those need an AST/ESLint rule
(`eslint-plugin-jsx-a11y` + a custom `no-literal-props`), which is a separate
piece of work; it is recorded in Maintenance notes as the real end state.

The allowlists key on `path::value`, **not** line numbers, so they survive
unrelated edits that move code. Both are *superset* checks: removing an
allowlisted literal (because another plan translated it) does **not** fail the
test. Verified inventory at commit `42826a3` — 15 quoted occurrences / 14
distinct values outside `DesignTokensPage.tsx`:

```ts
  it('no new hardcoded aria-label / title / placeholder literals', () => {
    // Baseline ratchet: these exist at commit 42826a3 in files owned by other
    // plans. Removing one is fine; adding a new one fails this test.
    const ALLOWED = new Set([
      // App.tsx is a class ErrorBoundary and cannot call the useTranslation hook.
      'src/App.tsx::Application error',
      'src/components/layout/TenantSwitcher.tsx::Switch workspace',
      'src/components/llm-council/AchievementToast.tsx::Dismiss achievement',
      'src/components/llm-council/SessionListItem.tsx::Delete session',
      'src/components/llm-council/StreamingCouncilView.tsx::Copy recall code',
      'src/components/llm-council/TurnCard.tsx::Not cited',
      'src/components/taxonomy/JudgeAutocomplete.tsx::Judge results',
      'src/pages/LlmCouncilPage.tsx::Council deliberating',
      'src/pages/LlmCouncilPage.tsx::Clear input',
      'src/pages/LlmCouncilPage.tsx::K3Q9XM',
      'src/pages/LlmCouncilPage.tsx::6-character recall code',
      'src/pages/LlmCouncilPage.tsx::12-char hex id',
      'src/pages/LlmCouncilPage.tsx::Council emblem',
      'src/pages/LlmCouncilSessionsPage.tsx::Loading sessions',
      // Added by plans/015 Step 6. RouteErrorBoundary is a class component and
      // cannot call the useTranslation hook — same constraint as App.tsx above.
      // Harmless if 015 has not landed: this is a superset check.
      'src/components/shared/RouteErrorBoundary.tsx::Something went wrong on this screen',
    ]);
    // Design-token showcase page: its literals are illustrative sample content,
    // already in Chinese, and churn with every token demo added.
    const SKIPPED_FILES = new Set(['src/pages/DesignTokensPage.tsx']);

    const srcRoot = join(__dirname, '../src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return e.name.endsWith('.tsx') ? [full] : [];
      });

    // Every quoting form a plain string literal can take in JSX. The earlier
    // draft matched only the first alternative.
    const ATTR =
      /\b(?:aria-label|placeholder|title)=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\}|\{'([^']+)'\})/g;
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = relative(srcRoot, file).split('\\').join('/');
      const key = `src/${rel}`;
      if (SKIPPED_FILES.has(key)) continue;
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(ATTR)) {
        const value = m[1] ?? m[2] ?? m[3] ?? m[4];
        const entry = `${key}::${value}`;
        if (!ALLOWED.has(entry)) offenders.push(entry);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it('no new hardcoded English inside template-literal a11y attributes', () => {
    // Second ratchet. `attr={`Open case ${id}`}` is invisible to the quoted-
    // literal scan above and is where most of the app's remaining untranslated
    // aria-labels actually live. Baseline: 11 entries at commit 42826a3, all in
    // files this plan does not own; each is listed in Maintenance notes as a
    // follow-up. Superset check — shrink it, never grow it.
    const ALLOWED_TEMPLATES = new Set([
      'src/components/analytics/ConceptCooccurrenceHeatmap.tsx::${rowConcept} (self)',
      'src/components/analytics/ConceptCooccurrenceHeatmap.tsx::${rowConcept} + ${colConcept}: ${count.toLocaleString()} cases, ${winRate.toFixed(1)}%',
      'src/components/cases/CasesTable.tsx::Open case ${c.citation || c.case_id}',
      'src/components/judges/JudgeCard.tsx::Compare ${displayName}',
      'src/components/judges/JudgeLeaderboard.tsx::Compare ${displayName}',
      'src/components/judges/SpecializationBadge.tsx::${specialty}: ${caseCount} cases, ${(successRate * 100).toFixed(1)}% success rate',
      'src/components/legislation/LegislationTextViewer.tsx::Jump to section ${ref}',
      'src/components/llm-council/TurnCard.tsx::${providerLabels[p] || p} cited',
      'src/components/llm-council/TurnCard.tsx::Turn ${turnNumber}',
      'src/pages/LlmCouncilPage.tsx::${stats.totalRuns} council runs · ${stats.streak}-day streak',
      'src/pages/SemanticSearchPage.tsx::Open case ${result.title || result.citation}',
    ]);
    const SKIPPED_FILES = new Set(['src/pages/DesignTokensPage.tsx']);

    const srcRoot = join(__dirname, '../src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return walk(full);
        return e.name.endsWith('.tsx') ? [full] : [];
      });

    const ATTR_TPL =
      /\b(?:aria-label|placeholder|title)=\{`([^`]*)`\}/g;
    // A run of 3+ Latin letters OUTSIDE any ${...} is prose, not a variable.
    const englishOutsideInterpolation = (raw: string) => {
      const literalOnly = raw
        .replace(/\$\{[^}]*\}/g, ' ')
        .replace(/\\u[0-9a-fA-F]{4}/g, ' ');
      return /[A-Za-z]{3,}/.test(literalOnly);
    };

    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = relative(srcRoot, file).split('\\').join('/');
      const key = `src/${rel}`;
      if (SKIPPED_FILES.has(key)) continue;
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(ATTR_TPL)) {
        if (!englishOutsideInterpolation(m[1])) continue;
        const entry = `${key}::${m[1]}`;
        if (!ALLOWED_TEMPLATES.has(entry)) offenders.push(entry);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  it('the a11y attribute scanners detect every quoting form they claim to', () => {
    // Fixtures pinning both detectors' real behaviour, including the forms
    // they do NOT cover. Keep these regexes byte-identical to the ones above.
    const ATTR =
      /\b(?:aria-label|placeholder|title)=(?:"([^"]+)"|'([^']+)'|\{"([^"]+)"\}|\{'([^']+)'\})/g;
    const ATTR_TPL = /\b(?:aria-label|placeholder|title)=\{`([^`]*)`\}/g;
    const quoted = (s: string) =>
      [...s.matchAll(ATTR)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
    const templated = (s: string) => [...s.matchAll(ATTR_TPL)].map((m) => m[1]);

    expect(quoted('<b aria-label="Hi" />')).toEqual(['Hi']);
    expect(quoted("<b aria-label='Hi' />")).toEqual(['Hi']);
    expect(quoted('<b aria-label={"Hi"} />')).toEqual(['Hi']);
    expect(quoted("<b title={'Hi'} />")).toEqual(['Hi']);
    expect(quoted('<b placeholder="Hi" />')).toEqual(['Hi']);
    expect(templated('<b aria-label={`Open ${id}`} />')).toEqual(['Open ${id}']);

    // KNOWN BLIND SPOTS — an AST rule is the real fix; see Maintenance notes.
    expect(quoted('<b aria-label={label} />')).toEqual([]);
    expect(templated('<b aria-label={label} />')).toEqual([]);
    expect(quoted('<span>Delete</span>')).toEqual([]);
  });
```

Note `SessionListItem.tsx` contributes a single allowlist entry even though the
literal `Delete session` appears twice in that file (once as `aria-label` at
`:101`, once as `title` at `:114`) — the set keys on the value, so one entry
covers both.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | tail -6
```
→ `14 passed` (7 pre-existing + 4 from Step 4 + 3 from Step 5).

Confirm **both** ratchets bite. The quoted-literal injection is below; run the
template-literal one too, because that is the form the earlier draft missed
entirely and an untested detector is a guess:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && cp src/components/layout/TenantSwitcher.tsx /tmp/ts2.bak && python3 -c "
p='src/components/layout/TenantSwitcher.tsx'
s=open(p).read().replace('aria-label=\"Switch workspace\"','aria-label={\`Brand New Template Literal \${x}\`}')
open(p,'w').write(s)" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | grep -c "Brand New Template Literal"; cp /tmp/ts2.bak src/components/layout/TenantSwitcher.tsx
```
→ a count **≥ 1**. If it is `0`, the template-literal detector does not work and
you must stop: a gate that cannot fail is worse than no gate.

Now the quoted-literal injection (this edits an out-of-scope file temporarily —
restore it immediately):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && cp src/components/layout/TenantSwitcher.tsx /tmp/ts.bak && python3 -c "
p='src/components/layout/TenantSwitcher.tsx'
s=open(p).read().replace('aria-label=\"Switch workspace\"','aria-label=\"Switch workspace\" title=\"Brand New Untranslated String\"')
open(p,'w').write(s)" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | grep -c "Brand New Untranslated String"; cp /tmp/ts.bak src/components/layout/TenantSwitcher.tsx
```
→ a count **≥ 1**, then the file is restored. Confirm restoration:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short frontend/src/components/layout/TenantSwitcher.tsx
```
→ **no output** (file is byte-identical to HEAD).

### Step 6: Full-suite regression check

Record the baseline **before** your first edit (or read it off the run you did
during the drift check): `BEFORE_TESTS`, `BEFORE_FILES`, `BEFORE_WARNINGS`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && npm run lint && npx vitest run 2>&1 | tail -8 && npm run build:cloudflare 2>&1 | tail -5
```
→ typecheck exit 0; lint exit 0 with no more warnings than `BEFORE_WARNINGS`;
vitest **0 failed** with `AFTER_FILES == BEFORE_FILES` (this plan creates no new
test file) and `AFTER_TESTS == BEFORE_TESTS + 7` (4 from Step 4, 3 from Step 5);
`npm run build:cloudflare` exit 0.

**Do not assert an absolute suite total.** If you run after plans 015–017 as
required, the baseline is theirs, not `42826a3`'s. The binding per-file
assertion is `npx vitest run __tests__/i18n-hardcoded.test.ts` → **14 passed**,
which is stable regardless of what else landed.

`npm run build:cloudflare` is the **production** build — it writes
`frontend/dist`, which `wrangler.toml:15` (`[assets] directory =
"./frontend/dist"`) actually serves. `npm run build` writes
`../immi_case_downloader/static/react` (`frontend/vite.config.ts:34`), the
local-dev Flask surface, and proves nothing about what users receive. This plan
rewrites both locale bundles, which are imported into the entry chunk
(`frontend/src/i18n/index.ts:19-37`), so the production build is the one that
matters.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain=v1 -uall > /tmp/immi-018-final-status.txt
diff /tmp/immi-018-baseline-status.txt /tmp/immi-018-final-status.txt
```
→ only **added** lines, and every one of them is one of these five paths:
`frontend/src/i18n/locales/en.json`, `frontend/src/i18n/locales/zh-TW.json`,
`frontend/src/pages/LoginPage.tsx`,
`frontend/src/components/analytics/OutcomeFunnelChart.tsx`,
`frontend/__tests__/i18n-hardcoded.test.ts`. Any pre-existing dirt recorded in
the drift check must be unchanged — leave it alone, do not "clean" it.

Also confirm the two temporary injections from Steps 4 and 5 were fully undone:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat -- frontend/src/components/layout/TenantSwitcher.tsx
```
→ no output.

## Test plan

All three new tests go into the existing
`frontend/__tests__/i18n-hardcoded.test.ts`, modelled on that file's existing
static-source-scan style (`readFileSync` + assertion, no rendering, no reliance
on the global `react-i18next` mock).

| # | Test | Covers | Fails today without the fix |
|---|---|---|---|
| 1 | `en.json and zh-TW.json define exactly the same key set` | TEST-12 locale parity. Guards all 1,280 pairs instead of the 1 pair guarded today. | Passes today (files are already in sync) — it is a *regression* guard that keeps Steps 1–2 honest and would catch a translator adding a key to one file only. |
| 2 | `every t("...") key used in src/ is defined in en.json` | FECORR-05. Walks every `.ts`/`.tsx` under `src/`, extracts `t("…")` keys, asserts each resolves in `en.json` (accepting `_other` plural forms), with one documented allowlist entry. | **Yes** — at `42826a3` it reports 88 missing keys, including the user-visible `pages.judge_comparison.description`. |
| 3 | `en and zh-TW agree on interpolation variables and plural forms` | Makes Step 2's one-shot shell probe permanent. A dropped `{{winPct}}` or a lonely `_one` is silent at runtime — i18next renders literal braces or the wrong grammatical form and nothing throws. | Passes once Steps 1–2 are correct; catches every later translation edit. |
| 4 | `the key scanner detects every t() quoting form it claims to` | Pins the `T_CALL` regex's real behaviour on fixtures, **including its two blind spots** (`i18n.t(`, `<Trans>`), so the next reader is not misled about coverage. | Would fail if someone "simplifies" the regex and silently narrows it. |
| 5 | `no new hardcoded aria-label / title / placeholder literals` | FEUX-18 recurrence, quoted forms. Superset allowlist of the 15 baseline entries (14 from `42826a3` + `RouteErrorBoundary.tsx` from `plans/015`), now matching `="…"`, `='…'`, `={"…"}` and `={'…'}`. | Passes at baseline by construction; fails the moment anyone adds another. Proven to bite by the injection check in Step 5. |
| 6 | `no new hardcoded English inside template-literal a11y attributes` | The form the draft ratchet **missed entirely** — 11 live instances, 7 of them untranslated English prose. Superset allowlist. | Passes at baseline by construction; fails on a new `` aria-label={`New English ${v}`} ``. Proven to bite by the second injection check in Step 5. |
| 7 | `the a11y attribute scanners detect every quoting form they claim to` | Fixtures for both attribute detectors, again including the blind spots (`aria-label={variable}`, visible text nodes). | Would fail if either regex is narrowed. |

Gates #2, #5 and #6 are each proven to actually fail by the deliberate-breakage
checks embedded in Steps 4 and 5 — **run all three**; a gate that cannot fail is
worse than no gate. Gates #4 and #7 are the fixture pins that make the other
gates' coverage claims checkable rather than asserted.

`LoginPage.tsx` gets no new rendering test. A render test would exercise the
global i18n mock, which returns `defaultValue` verbatim, so it could only assert
the English text that is already hardcoded today — zero signal. Its changes are
verified by `npx tsc -b --noEmit`, by the `grep` assertions in Step 3, and by
gate #2 (which now requires `login.description`, `login.telegram_failed` and
`login.public_access_note` to exist in `en.json`).

## Done criteria

ALL must hold:

- [ ] `cd frontend && python3 -c "import json;d=json.load(open('src/i18n/locales/en.json'));..."` reports **1280** flattened keys in `en.json` (use the flatten snippet from Step 1)
- [ ] The same count for `zh-TW.json` is **1280**, and the symmetric difference between the two key sets is empty in both directions
- [ ] Both locale files still satisfy `json.dumps(data, ensure_ascii=False, indent=2) + "\n" == file_contents`
- [ ] `grep -c 'judges.load_more' frontend/src/i18n/locales/en.json` → `0` (the key is deliberately absent — see Trap C and the blocking follow-up in Maintenance notes)
- [ ] `grep -c '{{lossPct}}' frontend/src/i18n/locales/en.json` → `1` and
      `grep -c 'lossPct: lossPct.toFixed(1)' frontend/src/components/analytics/OutcomeFunnelChart.tsx` → `1`
      (the catalogue value and its call site must land together, or the aria-label renders literal braces)
- [ ] `grep -ci 'supabase' frontend/src/i18n/locales/en.json` → `0` — production
      is D1 + Vectorize + Workers AI; no user-facing string may tell a user to
      configure a Supabase backend
- [ ] `grep -c 'session_delete_failed\|stale_data_warning' frontend/src/i18n/locales/en.json` → `2`
      and the same for `zh-TW.json` (the two keys `plans/015` calls)
- [ ] `grep -rn "font-serif" --include='*.tsx' frontend/src | wc -l` → `0`
- [ ] `grep -c '149,016\|onSuccess\|onError' frontend/src/pages/LoginPage.tsx` → `0`
- [ ] `grep -c 'role="alert"' frontend/src/pages/LoginPage.tsx` → `1`
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npm run lint` exits 0 with no more warnings than the recorded baseline
- [ ] `cd frontend && npx vitest run __tests__/i18n-hardcoded.test.ts` → **`14 passed`**
- [ ] `cd frontend && npx vitest run` → **0 failed**, `AFTER_TESTS == BEFORE_TESTS + 7`,
      `AFTER_FILES == BEFORE_FILES` (never an absolute total)
- [ ] Both deliberate-breakage checks produced a failure (Step 4's missing key,
      Step 5's **two** injections — quoted and template-literal), and both
      injected files were restored: `git diff --stat -- frontend/src/components/layout/TenantSwitcher.tsx` → no output
- [ ] `cd frontend && npm run build:cloudflare` exits 0 (the artifact `wrangler.toml:15` actually serves)
- [ ] `diff /tmp/immi-018-baseline-status.txt /tmp/immi-018-final-status.txt` shows only added lines, all five of them in-scope paths
- [ ] The new status for this plan's `plans/README.md` row is **reported**; the
      row is edited only if you are running this plan alone (see Sequencing)

## STOP conditions

Stop and report back — do not improvise — if:

- **The drift check produces output for anything other than `LoginPage.tsx`.** The key counts, the 88-key list, and both ratchet allowlists in this plan are pinned to `42826a3` and may no longer be accurate. `LoginPage.tsx` changing is *expected* — `plans/015` Step 7 rewrites it and this plan depends on that.
- **`grep -c "onSuccess\|onError\|loginError" frontend/src/pages/LoginPage.tsx` is non-zero at Step 3.** `plans/015` has not landed. Stop and report; do not run Step 3 against the pre-015 file.
- **`plans/016` or `plans/017` has not landed.** They add no `t()` calls and no attribute literals, so they cannot break these gates — but running last is the whole point of this plan's ordering, and running early means a sibling's landing looks like this plan's regression. Report and wait.
- **The missing-key count is not 88.** Re-run the extraction and report what you found. If it is *lower*, another plan already backfilled some keys and merging this plan's data verbatim could overwrite better translations. If it is *higher*, new untranslated call sites landed and the extra keys are not covered by the data tables here.
- **A key you are about to add already exists in `en.json` with a different value.** Never overwrite an existing translation; report the conflict.
- **Any locale file fails the `json.dumps(...) == raw` formatting check after your merge.** Something re-serialised the file differently (wrong `indent`, `ensure_ascii=True`, missing trailing newline) and the diff will be thousands of lines instead of ~91. Fix the dump parameters rather than committing the reformatted file.
- **`npx vitest run` reports any pre-existing test failing.** The locale keys are consumed by every test file through the global mock; if defining a key changed rendered output somewhere, a previously-green assertion may now compare against a catalogue value instead of a `defaultValue`. Report which test and which key. (Compare against the baseline you recorded, not against `490` — that number is from `42826a3`, before three sibling plans added tests.)
- **Gate #2, #5 or #6 passes during its deliberate-breakage check** (one injection in Step 4, **two** in Step 5). A gate that cannot fail is not a gate; the regex or the walk is wrong. Do not proceed with a non-functional gate. In particular, if the **template-literal** injection does not produce a failure, the second detector is inert and the ratchet's coverage claim is false.
- **`git status --short` shows `frontend/src/components/layout/TenantSwitcher.tsx` modified after Step 5.** The temporary injection was not restored. Restore it from `/tmp/ts.bak` or `git checkout --` it before continuing.
- **You conclude the fix requires editing `JudgeComparePage.tsx`, `JudgeLeaderboard.tsx`, any `llm-council/` component, `TenantSwitcher.tsx`, `ConfirmModal.tsx`, `AnalyticsFilters.tsx`, or `legislations-setup.ts`.** It does not. Those files belong to other plans; report instead. (`OutcomeFunnelChart.tsx` **is** in scope — for the one line in Step 1a and nothing else.)

## Maintenance notes

**For the reviewer.** Scrutinise three things: (1) that the six interpolated
values in Step 1 use exactly the variable names their call sites pass — a
mismatch renders literal `{{braces}}` to users and no test catches it; (2) that
the locale diff is ~93 added lines per file and contains **no** modifications to
existing lines; (3) that `judges.load_more` is genuinely absent from both files.

**Deliberate content changes, all reviewed.**
`login.public_access_note` no longer states a case count; the previous copy
hardcoded `149,016`, which drifts as the corpus grows.
`semantic_search.unavailable` no longer tells the user to configure a Supabase
backend and an API key: production has **no Supabase** — the semantic path is
D1 + Vectorize `CASE_VECTORS` + Workers AI embeddings inside
`workers/case-api/cloudflare.js`, and the message rendered at
`frontend/src/pages/SemanticSearchPage.tsx:179-182` is shown to end users, not
operators. It is now a neutral "temporarily unavailable, keyword search still
works" with an actionable alternative.
`analytics.outcome_funnel_aria` **keeps** its loss percentage: Step 1a adds
`lossPct` to the options object rather than dropping the value from the
screen-reader label. An earlier draft dropped it, which would have quietly
removed information from the one string class a sighted user cannot recover from
context.

**BLOCKING follow-up, not a permanent exemption — `judges.load_more`.** It is in
gate #2's `INTENTIONALLY_UNDEFINED` set because its call site
(`frontend/src/components/judges/JudgeLeaderboard.tsx:88-90`) passes **no**
interpolation options, so a catalogue value would render literal `{{nextBatch}}`
to users. That makes the allowlist entry correct **today** and wrong the moment
anyone touches that file. The fix is two lines at the call site (pass
`nextBatch` and `remaining` as options) plus one key pair. Whoever owns
`JudgeLeaderboard.tsx` next must do it and delete the allowlist entry in the same
commit — the entry's comment says so. Do not let it calcify into "this string is
English forever".

**The end state for gate #5/#6 is an ESLint rule, not a regex.** Both scanners
are sound but incomplete: they cannot see visible text nodes
(`<span>Delete</span>`), a string composed by a helper and passed as a variable
(`aria-label={label}`), or an attribute assembled across lines. Gates #4 and #7
pin those blind spots as fixtures so nobody mistakes green for complete. The real
fix is `eslint-plugin-jsx-a11y` plus a custom `no-literal-props` rule operating
on the AST; that belongs with `plans/024-add-accessibility-gates.md`, which
already owns `frontend/eslint.config.js`.

**Explicitly deferred out of this plan** — the call-site half of FEUX-18, all in
files owned by other plans. Each is captured by the Step 5 allowlists, which are
superset checks, so any of these can be fixed later without touching this test.
The 11 template-literal entries baselined in gate #6 are part of this list:
`CasesTable.tsx::Open case …`, `JudgeCard.tsx` / `JudgeLeaderboard.tsx::Compare …`,
`LegislationTextViewer.tsx::Jump to section …`, `TurnCard.tsx::Turn …` and
`::… cited`, `SpecializationBadge.tsx::… cases, … success rate`,
`LlmCouncilPage.tsx::… council runs · …-day streak`,
`SemanticSearchPage.tsx::Open case …`, and the two
`ConceptCooccurrenceHeatmap.tsx` tooltips.

- `frontend/src/components/llm-council/SessionListItem.tsx:113-116` — a `variant="danger"` `ConfirmModal` asks a zh-TW user, in English, to confirm an irreversible session delete (`title="Delete session"`, an interpolated English `message`, `confirmLabel="Delete"`). This is the instance with real teeth and should be first in the follow-up.
- `frontend/src/components/shared/ConfirmModal.tsx:19` — `confirmLabel = "Confirm"` default. `common.confirm` (`確認`) already exists in both locales; the default should be `t("common.confirm")`.
- `frontend/src/components/shared/AnalyticsFilters.tsx:23-28` — `TIME_PRESETS` holds literal `label` fields (`"All Time"`, `"Last 5y"`, `"Last 10y"`, `"2020–<year>"`) rendered as **visible button text** at `:67`. Fix by switching to a `labelKey` field. (The audit cited this file at `src/components/analytics/AnalyticsFilters.tsx`; the real path is `src/components/shared/AnalyticsFilters.tsx`.)
- `frontend/src/components/judges/JudgeLeaderboard.tsx:88-90` — pass `nextBatch` and `remaining` as interpolation options, then define `judges.load_more` as `Load {{nextBatch}} more ({{remaining}} remaining)` / `再載入 {{nextBatch}} 筆（尚餘 {{remaining}} 筆）` and delete it from the `INTENTIONALLY_UNDEFINED` set in gate #2.
- `frontend/src/components/layout/TenantSwitcher.tsx:17,30` — `aria-label="Switch workspace"` plus an untranslated `toast.error(...)` string at `:17`. **Footgun**: line `:32` is `{tenants.map((t) => (`, which shadows the `t` translation function. Whoever wires `useTranslation()` into this file must rename that map parameter.
- `frontend/src/components/llm-council/*` and `frontend/src/pages/LlmCouncilPage.tsx` — the remaining screen-reader-only `aria-label` strings.
- `frontend/src/App.tsx:29` — `title="Application error"` on `StatePanel`. This one needs a different approach: `App.tsx`'s `ErrorBoundary` is a **class** component and cannot call the `useTranslation` hook; it needs `withTranslation()` or a functional wrapper.

**What will interact with this later.** Gate #2 is now a hard build gate: anyone
adding a `t("new.key", { defaultValue: … })` call must also add the key to
`en.json` and `zh-TW.json`, or the frontend suite fails. That is the intent, but
it will surprise the first person it catches — the failure message names the file
and the key, so it is self-explanatory. If a new key legitimately needs to stay
`defaultValue`-only, add it to `INTENTIONALLY_UNDEFINED` with a comment
explaining why, as `judges.load_more` does.

**The global i18n mock remains in place** at
`frontend/__tests__/legislations-setup.ts:64`. Nothing in this plan depends on
changing it, and it should not be changed casually: 55 test files and 490 tests
rely on `t()` returning either the `defaultValue` or the raw key.

## Findings reconsidered

Two corrections and one scope split. All four findings are addressed; none were
dropped.

- **FEUX-18 — scope split, not rejected.** The finding asks for two things: move
  14 hardcoded `aria-label`/`title`/`placeholder` literals and the LLM-council
  confirm dialog into the locale files, *and* extend
  `__tests__/i18n-hardcoded.test.ts` into a scan that fails on new ones. Every
  call site involved lives in a file this plan does not own
  (`llm-council/*`, `TenantSwitcher.tsx`, `ConfirmModal.tsx`,
  `AnalyticsFilters.tsx`, `App.tsx`) and is owned by other plans running in
  parallel; editing them would cause merge conflicts. This plan therefore lands
  the **enforcement** half (Step 5's ratchet) and documents the call-site half as
  deferred, with the exact file:line inventory, in "Maintenance notes". The
  ratchet is a superset check precisely so those follow-ups can land later
  without editing this test.
- **FEUX-18 — path correction.** The finding cites
  `frontend/src/components/analytics/AnalyticsFilters.tsx:23-28`. That file does
  not exist. The real path is
  `frontend/src/components/shared/AnalyticsFilters.tsx`; `TIME_PRESETS` is
  genuinely at `:23-28` there, with the literal `label` fields rendered as
  visible button text at `:67`. The defect is real; only the directory was wrong.
- **FEUX-18 — count correction.** The finding says "14 hardcoded strings". The
  verified inventory at `42826a3` is **15** quoted English literals outside
  `DesignTokensPage.tsx` (which holds more, all Chinese sample content in a
  dev-only token showcase). The audit's regex likely skipped
  `placeholder="K3Q9XM"` at `LlmCouncilPage.tsx:698`, which is a format example
  rather than prose. The Step 5 quoted allowlist has 14 baseline entries covering
  all 15 occurrences, because `Delete session` appears twice in
  `SessionListItem.tsx` (`:101` and `:114`) and the set keys on the value —
  plus one entry for `plans/015`'s `RouteErrorBoundary.tsx`.

- **FEUX-18 — coverage correction, added 2026-08-28.** Both the finding and the
  first draft of this plan measured "hardcoded a11y strings" with a
  double-quoted-attribute regex. That undercounts: re-measured over
  `frontend/src/**/*.tsx`, the **template-literal** form
  (``attr={`Text ${v}`}``) holds **11** more values, **7 of which contain
  untranslated English prose** — e.g. `aria-label={\`Open case ${c.citation || c.case_id}\`}`
  (`components/cases/CasesTable.tsx:151`) and
  `title={\`Jump to section ${ref}\`}`
  (`components/legislation/LegislationTextViewer.tsx:185`). A ratchet claiming to
  catch "any new hardcoded aria-label" while blind to that form gives false
  assurance in the exact direction that matters. Step 5 now installs a second
  detector with its own 11-entry baseline, extends the quoted regex to all four
  literal quoting forms (`='…'` and `={"…"}` have 0 live instances but cost
  nothing to cover), and adds fixture tests that pin **both** detectors'
  behaviour and their remaining blind spots.

- **`semantic_search.unavailable` named the wrong backend — corrected.** The
  string drafted from the call-site `defaultValue` told users to "Ensure the
  Supabase backend is configured and an API key is set"
  (`frontend/src/pages/SemanticSearchPage.tsx:179-182`). Production has no
  Supabase at all — semantic search runs on D1 + Vectorize + Workers AI inside
  `workers/case-api/cloudflare.js`, per `CLAUDE.md`'s Worker Architecture
  section. Worse, it is shown to the **end user** (a self-representing
  applicant), not to an operator, so even a correct backend name would be the
  wrong register. Replaced with a neutral temporary-unavailability message that
  points at keyword search. Copying a `defaultValue` verbatim into the catalogue
  copies its factual errors too — that is the general lesson.

- **FECORR-05 — fix-sketch correction.** The finding proposes backfilling "all 88
  keys into en.json and zh-TW.json using each call site's existing defaultValue
  as the en value". That is unsafe for 6 of the 88, and actively wrong for 1.
  Once a key exists in the catalogue, i18next ignores the `defaultValue`, so any
  key whose `defaultValue` is a JS template literal loses its interpolated
  values. Five of the six can be rewritten with i18next `{{var}}` syntax because
  their call sites do pass the variables. The sixth, `judges.load_more`
  (`frontend/src/components/judges/JudgeLeaderboard.tsx:88-90`), passes **no**
  options at all; verified empirically against installed i18next 25.8.11, a
  catalogue value of `Load {{nextBatch}} more` renders the literal braces to the
  user. It is excluded from the backfill and allowlisted in gate #2. **88 keys
  are missing; 87 are defined by this plan** (88 leaves, because
  `semantic_search.results_count` splits into a `_one`/`_other` plural pair).
- **FECORR-05 — line-number drift.** The finding cites
  `frontend/src/pages/SemanticSearchPage.tsx:95` for
  `semantic_search.description`. At `42826a3`, `:95` is
  `semantic_search.title`; `semantic_search.description` is at `:96`. The other
  two cited lines are exact: `JudgeComparePage.tsx:72` is
  `description={t("pages.judge_comparison.description")}`, and
  `LlmCouncilPage.tsx:949` is `llm_council.send_btn`.
- **TEST-12 — approach correction, finding confirmed.** The global
  `vi.mock("react-i18next")` really does make every missing key invisible to all
  490 tests, exactly as claimed. But the fix is *not* to remove or weaken the
  mock: it is loaded via `setupFiles` for all 55 test files, and unmocking it
  would require every one of them to provide an `I18nextProvider`. The finding's
  own fix sketch already points the right way — static scans over the JSON and
  source files, which is what Steps 4 and 5 implement. `legislations-setup.ts` is
  therefore listed as out of scope rather than modified.

## Review points not applied

Two points from the 2026-08-28 cross-plan review were checked and **not** turned
into work here, with the evidence:

- **"The `t()` scan misses `i18n.t()`, `<Trans>` and dynamic keys."** The
  reasoning is right but the premise does not hold for this repo, so no detector
  was added for the first two: `grep -rn "i18n\.t(" frontend/src | wc -l` → **0**,
  and the only `<Trans` match in `frontend/src` is the component
  `<TransitionEvents` at `components/lineage/LineageExplainer.tsx:226` — a
  substring false positive, not a `<Trans>` usage. Dynamic keys likewise:
  ``grep -rEn '[^A-Za-z0-9_$.]t\(\s*`' frontend/src | wc -l`` → **0**. Building
  and maintaining detectors for three forms with zero live instances would add
  surface without adding signal. What the review is right about — that the gate
  should not *claim* completeness it lacks — is applied: gate #4's fixtures pin
  all three as explicit, commented blind spots, and the Step 4 preamble states
  the coverage table with measured counts. The template-literal form, which does
  have live instances, **is** now covered (see above).
- **"Translate the remaining Council/error/copy strings from plans 015 and 017
  rather than allowlisting them."** Applied where possible and refused where it
  would be wrong. `llm_council.session_delete_failed` and
  `errors.stale_data_warning` are fully translated here in both locales. The two
  that stay English are constrained by code, not by effort:
  `RouteErrorBoundary.tsx`'s `title` cannot use `t()` because
  `ErrorBoundary` is a **class** component and `useTranslation` is a hook (the
  same reason `src/App.tsx:29`'s `title="Application error"` has always been
  hardcoded), and `StreamingCouncilView.tsx` has **no** i18n import at all —
  `plans/017` explicitly forbids adding one there, because introducing
  `useTranslation` into that file mid-flight would collide with `plans/015`,
  which is editing the same `try/catch/finally`. Both need
  `withTranslation()`/a functional wrapper and a single owner for that file;
  they are recorded in Maintenance notes with the exact constraint rather than
  half-done.
