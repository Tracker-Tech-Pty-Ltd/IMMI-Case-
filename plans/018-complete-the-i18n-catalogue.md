# Plan 018: Define the 88 missing keys and translate the hardcoded strings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- frontend/src/i18n/locales/en.json frontend/src/i18n/locales/zh-TW.json frontend/src/pages/LoginPage.tsx frontend/__tests__/i18n-hardcoded.test.ts
> ```
> Expected: **no output** (no in-scope file has changed since this plan was
> written). If any in-scope file changed, compare the "Current state" excerpts
> against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

**Dependency note**: this plan edits one `.tsx` file. At commit `42826a3` the
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
| Full frontend test suite | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | baseline before this plan: `490 passed`, 55 files |
| Just this plan's test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/i18n-hardcoded.test.ts` | baseline before this plan: `7 passed` |
| Lint frontend | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm run lint` | exit 0 |
| Count keys in a locale file | see the `flatten` snippet in Step 1 | 1187 before, 1278 after |
| Working-tree check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope files listed |

**Do NOT** use `npx tsc --noEmit` (without `-b`) to verify anything. In this
repo that command exits 0 while loading **zero** source files, because
`frontend/tsconfig.json` contains `files: []` plus project references only. It
will happily "pass" on broken code.

## Scope

**In scope** (the only files you may modify):

- `frontend/src/i18n/locales/en.json`
- `frontend/src/i18n/locales/zh-TW.json`
- `frontend/src/pages/LoginPage.tsx`
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
| `analytics.outcome_funnel_aria` | `win`, `loss`, `winPct` | `Wins: {{win}} ({{winPct}}%), Losses: {{loss}}` |
| `analytics.outcome_distribution_aria` | `summary` | `Outcome distribution: {{summary}}` |
| `semantic_search.results_count` | `count` | plural pair, see Trap B |
| `judges.load_more` | **none** | **do not define — see Trap C** |

Note `analytics.outcome_funnel_aria`: its inline `defaultValue` also renders a
loss percentage, but `lossPct` is **not** in the options object passed at
`frontend/src/components/analytics/OutcomeFunnelChart.tsx:18-22`. Referencing
`{{lossPct}}` would render the literal braces. The catalogue value deliberately
omits it. This is a small, reviewed reduction in the aria-label's content.

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
| `outcome_funnel_aria` | `Wins: {{win}} ({{winPct}}%), Losses: {{loss}}` |
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
| `unavailable` | `Semantic search is not available. Ensure the Supabase backend is configured and an API key is set.` |
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

Leaf arithmetic: 20 + 2 + 1 + 4 + 2 + 3 + 2 + 2 + 39 + 1 + 12 = **88**, plus 3
`login.*` = **91** new leaves. 1187 + 91 = **1278**.

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
"
```
→ `keys: 1278` / `formatting preserved: True` / `judges.load_more absent: True` /
`raw-key fix: Pick two or more judges from the profiles list to see their outcomes side by side.` /
`siblings intact: Select at least two judges to compare.`

### Step 2: Mirror all 91 keys into `zh-TW.json` with Traditional Chinese values

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
| `outcome_funnel_aria` | `勝訴：{{win}} 件（{{winPct}}%），敗訴：{{loss}} 件` |
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
| `unavailable` | `語意搜尋目前無法使用。請確認 Supabase 後端已設定且已提供 API 金鑰。` |
| `no_results_title` | `查無結果` |
| `no_results_desc` | `請嘗試換個說法或使用不同的用語。` |
| `results_count_one` | `{{count}} 筆結果` |
| `results_count_other` | `{{count}} 筆結果` |

`login`: `description` = `澳洲移民法庭案件研究平台。以 Telegram 登入即可儲存搜尋與收藏集。`;
`telegram_failed` = `Telegram 登入失敗，請再試一次。`;
`public_access_note` = `所有案例無須登入即可公開瀏覽。僅在儲存搜尋與收藏集時才需登入。`

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
→ `en: 1278 zh: 1278` / `en-only: []` / `zh-only: []` /
`formatting preserved: True` / `interp vars match: True`

Then confirm nothing else broke:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -6
```
→ `490 passed`, 55 files (unchanged — no test reads these keys yet).

### Step 3: Translate `LoginPage.tsx`, announce its error, and use the heading font

Replace `frontend/src/pages/LoginPage.tsx` with the version below. Five changes
against the current file, and nothing else:

1. Import `useTranslation` from `react-i18next` and destructure `t`.
2. Route the three user-facing strings through the `login.*` keys added in Steps 1–2, each with an inline `defaultValue` matching the `en.json` value (the repo convention, and it keeps the Vitest mock rendering readable English).
3. Add `role="alert"` to the error container so assistive tech announces a sign-in failure.
4. `font-serif` → `font-heading` on the `<h1>`, so the login heading renders in Crimson Text like every other heading in the app.
5. Drop the hardcoded `149,016`. The replacement copy is deliberately non-numeric — do **not** wire in `useStats()`; that would fire an analytics API request on the unauthenticated login screen purely to print a number, and the number drifts.

`"IMMI Case"` in the `<h1>` stays a bare literal: it is the product name, not
copy, and product names are not translated.

`t` is used only in the render body, not inside any `useCallback`/`useMemo`, so
no dependency array changes are needed. Leave the two existing `useCallback`
deps exactly as they are.

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoader } from "@/components/shared/PageLoader";

const BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME || "immi_case_bot";

export function LoginPage() {
  const { t } = useTranslation();
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
  const visibleError =
    loginError ||
    (authError
      ? t("login.telegram_failed", {
          defaultValue: "Telegram sign-in failed. Please try again.",
        })
      : null);

  if (isLoading) return <PageLoader />;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full p-8 rounded-xl shadow-lg bg-card border border-border">
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
        <div className="flex justify-center">
          <TelegramLoginButton
            botName={BOT_NAME}
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </div>
        <p className="mt-6 text-xs text-muted-text text-center">
          {t("login.public_access_note", {
            defaultValue:
              "All cases are publicly accessible without login. Login is only required to save searches and collections.",
          })}
        </p>
      </div>
    </main>
  );
}
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && echo TSC_OK && npm run lint >/dev/null 2>&1 && echo LINT_OK && grep -c 'font-serif\|149,016' src/pages/LoginPage.tsx; grep -c 'role="alert"\|useTranslation' src/pages/LoginPage.tsx
```
→ `TSC_OK`, `LINT_OK`, then `0` (no `font-serif`, no `149,016`), then `3`
(`useTranslation` import + call, plus `role="alert"`).

Also confirm `font-serif` is now absent from the whole app:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -rn "font-serif" --include='*.tsx' src | wc -l
```
→ `0`

### Step 4: Gate locale parity and missing translation keys

Append two `it(...)` blocks inside the existing
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
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/i18n-hardcoded.test.ts 2>&1 | tail -8
```
→ `9 passed` (7 pre-existing + 2 new), `Test Files 1 passed`.

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
→ `9 passed`. If `git checkout --` does not restore it (because Step 1 is not
yet committed), re-apply Step 1's merge instead and re-verify.

### Step 5: Ratchet the hardcoded accessibility literals

Append one more `it(...)` block to the same file. It fails on **any new**
English literal in an `aria-label`, `title`, or `placeholder` attribute, while
allowlisting the ones that exist today in files this plan does not own.

The allowlist keys on `path::value`, **not** line numbers, so it survives
unrelated edits that move code. It is a *superset* check: removing an
allowlisted literal (because another plan translated it) does **not** fail the
test. Verified inventory at commit `42826a3` — 15 literals outside
`DesignTokensPage.tsx`:

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

    const ATTR = /\b(?:aria-label|placeholder|title)="([^"]+)"/g;
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = relative(srcRoot, file).split('\\').join('/');
      const key = `src/${rel}`;
      if (SKIPPED_FILES.has(key)) continue;
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(ATTR)) {
        const entry = `${key}::${m[1]}`;
        if (!ALLOWED.has(entry)) offenders.push(entry);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
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
→ `10 passed`.

Confirm the ratchet bites on a new literal (this edits an out-of-scope file
temporarily — restore it immediately):

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

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && npm run lint && npx vitest run 2>&1 | tail -8
```
→ typecheck exit 0, lint exit 0, `493 passed` across 55 files (490 baseline + 3
new tests).

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ only these four paths modified: `frontend/src/i18n/locales/en.json`,
`frontend/src/i18n/locales/zh-TW.json`, `frontend/src/pages/LoginPage.tsx`,
`frontend/__tests__/i18n-hardcoded.test.ts` (plus any pre-existing
`.claude/STATE.md` modification and the untracked `plans/` directory, which are
not yours and must be left alone).

## Test plan

All three new tests go into the existing
`frontend/__tests__/i18n-hardcoded.test.ts`, modelled on that file's existing
static-source-scan style (`readFileSync` + assertion, no rendering, no reliance
on the global `react-i18next` mock).

| # | Test | Covers | Fails today without the fix |
|---|---|---|---|
| 1 | `en.json and zh-TW.json define exactly the same key set` | TEST-12 locale parity. Guards all 1,278 pairs instead of the 1 pair guarded today. | Passes today (files are already in sync) — it is a *regression* guard that keeps Steps 1–2 honest and would catch a translator adding a key to one file only. |
| 2 | `every t("...") key used in src/ is defined in en.json` | FECORR-05. Walks every `.ts`/`.tsx` under `src/`, extracts `t("…")` keys, asserts each resolves in `en.json` (accepting `_other` plural forms), with one documented allowlist entry. | **Yes** — at `42826a3` it reports 88 missing keys, including the user-visible `pages.judge_comparison.description`. |
| 3 | `no new hardcoded aria-label / title / placeholder literals` | FEUX-18 recurrence. Superset allowlist of the 14 baseline entries. | Passes at baseline by construction; fails the moment anyone adds a 15th. Proven to bite by the injection check in Step 5. |

Both gate #2 and gate #3 are proven to actually fail by the deliberate-breakage
checks embedded in Steps 4 and 5 — do not skip those; a gate that cannot fail is
worse than no gate.

`LoginPage.tsx` gets no new rendering test. A render test would exercise the
global i18n mock, which returns `defaultValue` verbatim, so it could only assert
the English text that is already hardcoded today — zero signal. Its changes are
verified by `npx tsc -b --noEmit`, by the `grep` assertions in Step 3, and by
gate #2 (which now requires `login.description`, `login.telegram_failed` and
`login.public_access_note` to exist in `en.json`).

## Done criteria

ALL must hold:

- [ ] `cd frontend && python3 -c "import json;d=json.load(open('src/i18n/locales/en.json'));..."` reports **1278** flattened keys in `en.json` (use the flatten snippet from Step 1)
- [ ] The same count for `zh-TW.json` is **1278**, and the symmetric difference between the two key sets is empty in both directions
- [ ] Both locale files still satisfy `json.dumps(data, ensure_ascii=False, indent=2) + "\n" == file_contents`
- [ ] `grep -c 'judges.load_more' frontend/src/i18n/locales/en.json` → `0` (the key is deliberately absent)
- [ ] `grep -rn "font-serif" --include='*.tsx' frontend/src | wc -l` → `0`
- [ ] `grep -c '149,016' frontend/src/pages/LoginPage.tsx` → `0`
- [ ] `grep -c 'role="alert"' frontend/src/pages/LoginPage.tsx` → `1`
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npm run lint` exits 0
- [ ] `cd frontend && npx vitest run __tests__/i18n-hardcoded.test.ts` → `10 passed`
- [ ] `cd frontend && npx vitest run` → `493 passed`, 55 files, 0 failed
- [ ] `git status --short` shows no modified file outside the four in-scope paths
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back — do not improvise — if:

- **The drift check produces output.** Any in-scope file changed since `42826a3`; the key counts, the 88-key list, and the ratchet allowlist in this plan are all pinned to that commit and may no longer be accurate.
- **The missing-key count is not 88.** Re-run the extraction and report what you found. If it is *lower*, another plan already backfilled some keys and merging this plan's data verbatim could overwrite better translations. If it is *higher*, new untranslated call sites landed and the extra keys are not covered by the data tables here.
- **A key you are about to add already exists in `en.json` with a different value.** Never overwrite an existing translation; report the conflict.
- **Any locale file fails the `json.dumps(...) == raw` formatting check after your merge.** Something re-serialised the file differently (wrong `indent`, `ensure_ascii=True`, missing trailing newline) and the diff will be thousands of lines instead of ~91. Fix the dump parameters rather than committing the reformatted file.
- **`npx vitest run` drops below 490 pre-existing passes.** The locale keys are consumed by 55 test files through the global mock; if defining a key changed rendered output somewhere, a previously-green assertion may now compare against a catalogue value instead of a `defaultValue`. Report which test and which key.
- **Gate #2 or gate #3 passes during its deliberate-breakage check** (Step 4 and Step 5). A gate that cannot fail is not a gate; the regex or the walk is wrong. Do not proceed with a non-functional gate.
- **`git status --short` shows `frontend/src/components/layout/TenantSwitcher.tsx` modified after Step 5.** The temporary injection was not restored. Restore it from `/tmp/ts.bak` or `git checkout --` it before continuing.
- **You conclude the fix requires editing `JudgeComparePage.tsx`, `JudgeLeaderboard.tsx`, any `llm-council/` component, `TenantSwitcher.tsx`, `ConfirmModal.tsx`, `AnalyticsFilters.tsx`, or `legislations-setup.ts`.** It does not. Those files belong to other plans; report instead.

## Maintenance notes

**For the reviewer.** Scrutinise three things: (1) that the six interpolated
values in Step 1 use exactly the variable names their call sites pass — a
mismatch renders literal `{{braces}}` to users and no test catches it; (2) that
the locale diff is ~91 added lines per file and contains **no** modifications to
existing lines; (3) that `judges.load_more` is genuinely absent from both files.

**Deliberate content changes, both reviewed.** `analytics.outcome_funnel_aria`
drops the loss percentage its old inline `defaultValue` rendered, because
`lossPct` is not among the variables passed at
`frontend/src/components/analytics/OutcomeFunnelChart.tsx:18-22`. And
`login.public_access_note` no longer states a case count; the previous copy
hardcoded `149,016`, which drifts as the corpus grows.

**Explicitly deferred out of this plan** — the call-site half of FEUX-18, all in
files owned by other plans. Each is captured by the Step 5 allowlist, which is a
superset check, so any of these can be fixed later without touching this test:

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
  verified inventory at `42826a3` is **15** English literals outside
  `DesignTokensPage.tsx` (which holds 15 more, all Chinese sample content in a
  dev-only token showcase). The audit's regex likely skipped
  `placeholder="K3Q9XM"` at `LlmCouncilPage.tsx:698`, which is a format example
  rather than prose. The Step 5 allowlist has 14 entries covering all 15
  occurrences, because `Delete session` appears twice in `SessionListItem.tsx`
  (`:101` and `:114`) and the set keys on the value.
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
