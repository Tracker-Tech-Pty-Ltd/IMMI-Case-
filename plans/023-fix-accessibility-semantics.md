# Plan 023: Labels, focus management, table semantics and heading hierarchy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **Do NOT edit `plans/README.md`.** That index is
> maintained by the integration owner; several plans run in parallel and a
> shared status file is a guaranteed conflict. Report your status instead.
>
> **Drift check (run first)**. A commit-range diff cannot see uncommitted,
> staged or untracked work, so run all four commands:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="frontend/src/pages/CaseEditPage.tsx \
>    frontend/src/pages/CaseAddPage.tsx \
>    frontend/src/pages/CaseComparePage.tsx \
>    frontend/src/components/layout/MobileNav.tsx \
>    frontend/src/components/shared/Pagination.tsx \
>    frontend/src/components/shared/FilterPill.tsx \
>    frontend/src/components/shared/CourtBadge.tsx \
>    frontend/src/components/cases/CasesTable.tsx \
>    frontend/src/components/judges/ComparisonTable.tsx \
>    frontend/src/components/judges/ConceptEffectivenessTable.tsx \
>    frontend/src/components/analytics/ConceptComboTable.tsx \
>    frontend/src/components/lineage/CourtVolumeTable.tsx"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P    # committed since the plan was written
> git diff --stat -- $P                  # unstaged
> git diff --cached --stat -- $P         # staged
> ```
> Expected: the last three print nothing, and `git status --short` lists no
> in-scope path — **with one allowed exception**, below. If any other in-scope
> file appears in any of them, compare the "Current state" excerpts against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.
>
> **`CasesTable.tsx` is the known collision.** `plans/020-fix-render-performance.md`
> Step 5 restructures the same `return` block this plan's Step 8 edits: it wraps
> the mobile note + card grid in a `{!isDesktop && ( … )}` guard and adds a
> `useSyncExternalStore` media-query subscription. The two changes are
> compatible but **must not be applied concurrently**: plan 020's Step 5 lands
> first, then this plan's Step 8 on top, or a single executor applies both in
> that order. So `CasesTable.tsx` appearing in the committed diff with 020's
> changes is **expected and fine** — verify it contains `useSyncExternalStore`
> and still contains `overflow-x-auto`, re-locate the `<th>` lines in Step 8 by
> reading the file (their line numbers will have moved), and continue. Never
> revert 020's work to make this plan's line numbers match.
>
> Never run `git checkout --` or `git clean -f` to "clean up" a dirty tree.
> Those destroy the operator's work. Stop and report instead.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md` — **soft, but
  real.** Every verification command below already uses the working
  `npx tsc -b --noEmit` form, which passes at `42826a3` regardless, so this plan
  is executable standalone. What 001 adds is `frontend/tsconfig.test.json`:
  without it, files under `frontend/__tests__/` are **not** type-checked by any
  project, so the three new test files this plan creates compile only inside
  Vitest's esbuild transform (which strips types without checking them). Prefer
  running after 001; if you run before it, say so in your report.
- **Must run AFTER**: `plans/020-fix-render-performance.md` — both edit
  `frontend/src/components/cases/CasesTable.tsx`. See the drift-check note above.
- **Must run BEFORE**: `plans/024-add-accessibility-gates.md`. Step 7a of this
  plan gives `FilterPill`'s remove button an `aria-label`, which is precisely
  the defect 024's axe suite pins as
  `expect(await violationIds(container)).toEqual(["button-name"])`. Once this
  plan lands, that expectation must become `[]`. If 024 runs first it will bake
  in a stale expectation and then fail the moment this plan lands.
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

The primary user of this product is a self-representing immigration applicant
filling in case records under stress — not a lawyer with a paralegal. Three
things are broken for anyone using a keyboard or a screen reader. First, every
`<select>` and `<textarea>` on the two data-entry pages is nameless: the visible
label is a detached `<label>` sibling with no `htmlFor`, so a screen reader
announces the control with no field name and clicking the label never focuses
the control. Second, the mobile navigation drawer claims `aria-modal="true"`
but has no focus trap, no focus move on open and no focus restore on close — on
every viewport under 1024px, where it is the *only* navigation, a keyboard user
tabs straight out of the open drawer into invisible page content. Third, the
two comparison matrices mark their row-header column as `<td>`, so a screen
reader reads each cell without the field name it belongs to.

After this plan lands: every form control on the add/edit pages has a
programmatic name, the drawer is a real modal built on the same Radix Dialog
primitive the rest of the app already uses, the comparison matrices have real
row headers, the icon-only remove-filter buttons are individually
distinguishable, pagination stops overflowing at 320px and announces its result
range, and both `CaseEditPage` and `CaseComparePage` have exactly one stable
`<h1>`.

## Current state

### Files this plan changes, and their role

| File | Role |
|---|---|
| `frontend/src/pages/CaseAddPage.tsx` | Case creation form. Local `Field` / `SelectField` components + one inline notes textarea. No `<h1>` problem here (it has one), but every label is detached. |
| `frontend/src/pages/CaseEditPage.tsx` | Case edit form. Local `Field` / `SelectField` / `TextareaField` components render **every** field of the form. Page has **no** `<h1>` at all. |
| `frontend/src/pages/CaseComparePage.tsx` | Side-by-side case comparison matrix. Renders two *different* `<h1>` texts depending on how many cases are selected; row-header column is `<td>`. |
| `frontend/src/components/layout/MobileNav.tsx` | The only navigation below 1024px. Hand-rolled drawer with fake modal semantics. |
| `frontend/src/components/shared/Pagination.tsx` | Shared pager used by CasesPage, LegislationsPage, GuidedSearchPage. Unwrappable flex row; plain `<p>` summary. |
| `frontend/src/components/shared/FilterPill.tsx` | Active-filter chip on the cases list. Its remove button has no accessible name. |
| `frontend/src/components/shared/CourtBadge.tsx` | Court abbreviation chip used across cases, dashboard, compare, detail, collections. Full court name reachable only via `title`. |
| `frontend/src/components/cases/CasesTable.tsx` | Main browse table. |
| `frontend/src/components/judges/ComparisonTable.tsx` | Judge-vs-judge comparison matrix; row-header column is `<td>`. |
| `frontend/src/components/judges/ConceptEffectivenessTable.tsx` | Simple concept table. |
| `frontend/src/components/analytics/ConceptComboTable.tsx` | Simple concept-combination table. |
| `frontend/src/components/lineage/CourtVolumeTable.tsx` | Court volume table. |

### Excerpt 1 — detached labels, `frontend/src/pages/CaseEditPage.tsx:404-433`

```tsx
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  span2,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-muted-text">
        {label}
      </label>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
```

`SelectField` (`:435-473`) and `TextareaField` (`:475-499`) in the same file
repeat this exact shape — `<label>` at `:449` / `:488`, control at `:452` /
`:491`, no `htmlFor`, no `id`, no `aria-label`.

`frontend/src/pages/CaseAddPage.tsx` is the same: `Field` label `:302` /
input `:309`; `SelectField` label `:335` / select `:338`; and the inline notes
block at `:228-238`:

```tsx
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-muted-text">
                  {t("case_detail.notes")}
                </label>
                <textarea
                  value={form.user_notes ?? ""}
                  onChange={(e) => updateField("user_notes", e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
```

**The repo already has the correct pattern.** `frontend/src/components/collections/CollectionEditor.tsx:158-170`:

```tsx
              <label
                htmlFor="coll-desc"
                className="mb-1 block text-xs font-medium text-muted-text"
              >
                {t(
                  "bookmarks.collection_description",
                  "Description (optional)",
                )}
              </label>
              <input
                id="coll-desc"
```

Match it — but because `Field` / `SelectField` / `TextareaField` render many
times per page, use `useId()` instead of a hard-coded string id. `useId` is
currently used nowhere in `frontend/src` (`grep -rn 'useId' src/` → no matches);
this plan introduces it. React is `^19.2.4`, so `useId` is available from `react`.

### Excerpt 2 — fake modal, `frontend/src/components/layout/MobileNav.tsx:1-46`

```tsx
import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { APP_NAV_GROUPS } from "@/components/layout/nav-config";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { t } = useTranslation();
  const { savedSearches } = useSavedSearches();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-40 bg-[var(--color-overlay)]/65 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-label={t("common.close_menu")}
      />
      {/* Drawer */}
      <div
        className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-nav-title"
      >
```

There is no focus trap, no focus move, no focus restore, and no `inert` /
`aria-hidden` on sibling content anywhere in this file (`grep` for `inert` and
`aria-hidden` in it returns nothing). `frontend/src/components/layout/AppLayout.tsx:32`
gates the desktop `Sidebar` behind `hidden lg:block` and `:37` renders
`MobileNav`, so below 1024px this drawer is the only navigation.

**The repo already has the correct pattern.** `frontend/src/components/shared/ConfirmModal.tsx:27-47`
uses `@radix-ui/react-dialog` (`"@radix-ui/react-dialog": "^1.1.15"` in
`frontend/package.json`) and gets focus trapping, focus restore and sibling
inertness for free:

```tsx
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]/65 data-[state=open]:animate-in ..." />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md ..."
```

`frontend/src/components/shared/GlobalSearch.tsx:4` and
`frontend/src/components/collections/CollectionEditor.tsx:104-112` use the same
primitive.

### Excerpt 3 — unnamed icon button, `frontend/src/components/shared/FilterPill.tsx:9-22`

```tsx
export function FilterPill({ label, value, onRemove }: FilterPillProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent">
      <span className="text-accent/60">{label}:</span>
      {value}
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
```

The button's only child is the icon; no `aria-label`, no `title`, no `sr-only`
text, no `type="button"`. It renders once per active filter
(`frontend/src/pages/CasesPage.tsx:480`), so several identical bare "button"
controls appear in a row. Note this file uses **no semicolons** — match that.

By contrast `frontend/src/components/shared/Pagination.tsx:35-48` already does
it right (`type="button"` + `aria-label` + `title`), as does
`frontend/src/components/layout/MobileNav.tsx:54-58`.

### Excerpt 4 — court expansion behind `title` only, `frontend/src/components/shared/CourtBadge.tsx:32-48`

```tsx
export function CourtBadge({ court, className }: CourtBadgeProps) {
  const bg = courtColorMap[court] ?? "bg-primary-lighter"
  const fullName = courtNameMap[court]

  return (
    <span
      title={fullName}
      className={cn(
        "inline-flex shrink-0 cursor-default items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium text-white",
        bg,
        className
      )}
    >
      {court}
    </span>
  )
}
```

`courtNameMap` at `:15-25` holds all nine expansions, including
`FedCFamC2G: "Federal Circuit and Family Court of Australia (Division 2)"`.
`title` on a non-interactive `<span>` is unreliable in screen readers and
simply unavailable on touch. This file also uses **no semicolons**.

`fullName` is `undefined` for any court code not in the map — guard for that.

### Excerpt 5 — unwrappable pager, `frontend/src/components/shared/Pagination.tsx:29-34` and `:97-108`

```tsx
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-text">
        {t("pagination.showing", { start, end, total: totalItems })}
      </p>
      <div className="flex items-center gap-1">
```

```tsx
function getVisiblePages(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}
```

The window is at most **seven** entries, so with prev/next the control group is
at most nine elements — roughly 280px of min-content. Available content width is
288px at a 320px viewport (`frontend/src/components/layout/AppLayout.tsx:46` —
`<main id="main-content" className="mx-auto max-w-7xl p-4 sm:p-6">`) and 358px at
390px. **This overflows at 320px and fits at 390px**, which is why the existing
E2E mobile class at 390x844 (`tests/e2e/react/test_react_responsive.py:78`)
passes today. Do not describe this as breaking every phone.

The summary `<p>` at `:31` is not a live region. The correct idiom already
exists at `frontend/src/pages/GuidedSearchPage.tsx:502-506`:

```tsx
                  <div
                    className="mt-4 flex items-center gap-2 text-sm text-muted-text"
                    role="status"
                    aria-live="polite"
                  >
```

### Excerpt 6 — row header as `<td>`, `frontend/src/pages/CaseComparePage.tsx:166-180`

```tsx
                <tr
                  key={key}
                  className={cn(
                    "border-b border-border-light",
                    isDiffering && "bg-warning/5",
                  )}
                >
                  <td className="sticky left-0 z-10 bg-card p-3 font-medium text-muted-text whitespace-nowrap">
                    {label}
                    {isDiffering && (
                      <span className="ml-1 text-[10px] text-warning">
                        {t("pages.case_comparison.differs")}
                      </span>
                    )}
                  </td>
```

Same shape in `frontend/src/components/judges/ComparisonTable.tsx:99-101`:

```tsx
                <td className="px-4 py-3 font-medium text-foreground">
                  {row.metric}
                </td>
```

Across all of `frontend/src`, `grep -rn -- 'scope=' .` returns **0** and
`grep -rn -- '<caption' .` returns **0**; 17 files contain `<th`.

**Important styling consequence**: Tailwind v4's preflight
(`frontend/node_modules/tailwindcss/preflight.css`) contains **no** `th` reset,
so a `<th>` keeps the user-agent defaults `font-weight: bold` and
`text-align: center`. Both cells above already carry `font-medium` (a utility
class beats the UA sheet), but **neither carries a text-align class** — you must
add `text-left` when converting, or the column visibly re-centres.

### Excerpt 7 — heading hierarchy

`frontend/src/pages/CaseEditPage.tsx` contains **no** `<h1>` and does not import
`PageHeader`. Its headings start at `<h2>` (`:212`, `:311`, `:359`), below the
`Breadcrumb` at `:191`:

```tsx
      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Main fields (2 cols) */}
          <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
            <h2 className="mb-3 font-heading text-base font-semibold">
              {t("pages.case_edit.case_metadata")}
            </h2>
```

`frontend/src/pages/CaseComparePage.tsx` renders two **different** `<h1>` texts
depending on state — `:48-50` in the fewer-than-two branch:

```tsx
        <h1 className="sr-only">
          {t("cases.comparison", { defaultValue: "Case Comparison" })}
        </h1>
```

and `:123-128` in the main branch:

```tsx
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        {t("cases.comparison", { defaultValue: "Case Comparison" })}
        <span className="ml-2 text-base font-normal text-muted-text">
          ({cases.length})
        </span>
      </h1>
```

The shared header component is `frontend/src/components/shared/PageHeader.tsx`
(read-only for this plan — do **not** edit it). Its props are
`{ title, description?, eyebrow?, icon?, actions?, meta?, className? }` and its
`<h1>` at `:39` is:

```tsx
              <h1 className="break-words font-heading text-[clamp(1.5rem,4vw,2.75rem)] font-semibold leading-tight tracking-tight text-foreground">
```

### i18n conventions that apply here

- Always use the object form: `t("key", { defaultValue: "English text" })`.
  The two-argument form `t("key", "text")` is **not** understood by the test
  mock in `frontend/__tests__/legislations-setup.ts:64-82`, which returns
  `options.defaultValue` when present and otherwise the key string.
- `frontend/src/i18n/locales/en.json` and `zh-TW.json` are at exact key parity
  (1187 keys each) and are **out of scope** for this plan. Introduce new user
  strings as `defaultValue`-only, which is an established pattern in this repo —
  e.g. `frontend/src/pages/SemanticSearchPage.tsx:169-171` uses
  `t("semantic_search.results_region_label", { defaultValue: "Search results" })`
  and that key does not exist in `en.json`.
- Keys that **do** exist and that you should reuse verbatim:
  `common.close_menu` ("Close menu"), `pages.case_edit.title` ("Edit Case" /
  "編輯案件"), `cases.comparison` ("Case Comparison" / "案例對照"),
  `pagination.showing` ("Showing {{start}}-{{end}} of {{total}}").
- `filters.remove_filter` does **not** exist — use `defaultValue` only.

### Other repo conventions you must match

- Use `.toSorted()` not `.sort()` — never mutate arrays in React.
- Wrap every `localStorage` call in try/catch.
- TanStack Query filter-dependent hooks use `placeholderData` / `keepPreviousData`.
- Every Recharts `Tooltip` `contentStyle` must set `color: "var(--color-text)"`.
- Put `animate-spin` on a wrapper `<div>`, not on the SVG icon.
- All spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers. **This plan adds no new
  visual values**: every class it introduces (`flex-wrap`, `gap-2`, `w-full`,
  `sm:w-auto`, `text-left`, `font-normal`, `sr-only`) is a layout or semantic
  utility with no design value baked in. If you find yourself typing a pixel,
  colour or radius literal, you have gone outside this plan.
- The design direction is decided and named **"Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, nine court-specific colour codes. Do not restyle anything.
- `.tsx` files in `components/shared/` are inconsistent about semicolons —
  `FilterPill.tsx` and `CourtBadge.tsx` have none, `Pagination.tsx` and
  `PageHeader.tsx` do. Match each file's existing style; do not reformat.

### E2E coupling you must not break

`tests/e2e/react/` is **out of scope**, but two of its locators are coupled to
files you are editing. Read this before Step 5 and Step 8.

- `tests/e2e/react/test_react_navigation.py:83`, `:92`, `:101` and
  `tests/e2e/react/test_react_responsive.py:90` locate the drawer by the CSS
  class chain `.fixed.inset-y-0.left-0`. The rewritten `Dialog.Content` **must**
  keep the exact class string `fixed inset-y-0 left-0 z-50 flex w-64 flex-col
  bg-sidebar shadow-lg lg:hidden`.
- `tests/e2e/react/test_react_navigation.py:84` asserts
  `drawer.get_by_text("IMMI-Case", exact=True).is_visible()`. Keep the drawer
  title text exactly `IMMI-Case`.
- `frontend/__tests__/case-detail-page.test.tsx:218` and
  `tests/e2e/react/test_react_rapid_nav.py:101` match court codes by **exact**
  text. This is why Step 7 puts the screen-reader expansion in a *sibling*
  element rather than inside the badge — see that step for the mechanics.

## Commands you will need

Run all frontend commands from `/Users/d/Developer/Active Projects/IMMI-Case-/frontend`.

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (**use this form**) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` | exit 0, no output |
| Frontend unit tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | **0 failed**, `Tests passed` == `FE_BEFORE + <it count in the 3 new files>`, `Test Files passed` == `FEFILES_BEFORE + 3`. Record both baselines in Step 10 before editing. |
| Single test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/a11y-mobile-nav.test.tsx` | all pass |
| ESLint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint src` | **0 errors**. The warning count is not a gate — `plans/024-add-accessibility-gates.md` deliberately adds ~19 jsx-a11y warnings, and other plans land more. |
| Worker tests (regression only) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run` | 0 failed, `Tests passed` unchanged from `WK_BEFORE` (this plan touches no Worker code) |
| Git status | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope paths listed |

Absolute suite totals are deliberately absent from this table and from "Done
criteria". Several frontend plans run in parallel; a hard-coded
`490 passed / 55 files` turns any sibling plan landing first into a false STOP
and teaches the executor to edit the yardstick.

**Do NOT use `make typecheck` or a bare `npx tsc --noEmit`.** At commit
`42826a3` those exit 0 while loading **zero** files, because
`frontend/tsconfig.json` is `files: []` plus project references. `npx tsc -b
--noEmit` is the form that actually compiles the 169 source files.

`make test-py` is irrelevant to this plan — it is Python-only and, at this
commit, 3 of its tests fail for an environmental reason (a Homebrew Python
3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks a `pypdf` import in
`tests/test_backfill_judge_overrides_from_pdf.py`). Do not run it, do not try
to fix it.

## Scope

**In scope** (the only files you may modify):

Source:
- `frontend/src/pages/CaseEditPage.tsx`
- `frontend/src/pages/CaseAddPage.tsx`
- `frontend/src/pages/CaseComparePage.tsx`
- `frontend/src/components/layout/MobileNav.tsx`
- `frontend/src/components/shared/Pagination.tsx`
- `frontend/src/components/shared/FilterPill.tsx`
- `frontend/src/components/shared/CourtBadge.tsx`
- `frontend/src/components/cases/CasesTable.tsx`
- `frontend/src/components/judges/ComparisonTable.tsx`
- `frontend/src/components/judges/ConceptEffectivenessTable.tsx`
- `frontend/src/components/analytics/ConceptComboTable.tsx`
- `frontend/src/components/lineage/CourtVolumeTable.tsx`

New test files (create):
- `frontend/__tests__/a11y-form-labels.test.tsx`
- `frontend/__tests__/a11y-mobile-nav.test.tsx`
- `frontend/__tests__/a11y-controls-and-tables.test.tsx`

**Out of scope** (do NOT touch, even though they look related). Each of these is
owned by a different plan or a different territory; editing them creates a merge
conflict with work running in parallel:

- `frontend/src/components/shared/PageHeader.tsx` — you *import and use* it in
  Steps 3 and 4; you do not edit it.
- `frontend/src/components/layout/Topbar.tsx` and
  `frontend/src/components/layout/AppLayout.tsx` — the hamburger at
  `Topbar.tsx:21-27` has `aria-label` but no `aria-expanded` / `aria-controls`.
  Fixing that needs the drawer's open state threaded down from `AppLayout` as a
  new prop, i.e. edits to two files outside this territory. Deferred; recorded
  in "Maintenance notes".
- `frontend/src/components/shared/GlobalSearch.tsx` (bare `<X>` close button at
  `:92-97`) and `frontend/src/components/collections/CollectionEditor.tsx`
  (same at `:127-132`) — same defect class as `FilterPill`, different territory.
- `frontend/src/components/shared/TagInputModal.tsx` and
  `frontend/src/components/analytics/SuccessRateCalculator.tsx` — more unnamed
  controls, different territory.
- `frontend/src/pages/CasesPage.tsx`, `JudgeProfilesPage.tsx`,
  `LegislationsPage.tsx`, `CollectionsPage.tsx` — these need a live region
  around their results block. Only the `Pagination` half of that work is in this
  territory (Step 6).
- `frontend/src/pages/LlmCouncilPage.tsx` (`:1326`, hand-rolled `<h1>` at
  `clamp(1.75rem,4vw,3rem)`) and `frontend/src/pages/GuidedSearchPage.tsx`
  (`:414`, `text-2xl font-semibold` with no `font-heading`, so it drops the
  Crimson Text brand face) — heading consolidation for those pages is deferred.
- `frontend/eslint.config.js` — adding `eslint-plugin-jsx-a11y` would make this
  whole class of defect a lint error and is the right long-term fix, but it is a
  separate change with its own dependency install and its own baseline to
  negotiate. Do not add it here.
- `frontend/src/i18n/locales/*.json` — key parity is enforced elsewhere; use
  `defaultValue` instead.
- `tests/e2e/react/**` — Playwright suite; needs a running server and a built
  SPA. Read-only for you.
- Any visual restyling. No colour, spacing, radius or font changes.

## Git workflow

- Branch: `advisor/023-fix-accessibility-semantics`
  (`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git checkout -b advisor/023-fix-accessibility-semantics`)
- One commit per step, or per logical group of steps. Message style is
  conventional commits, `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`.
- No AI attribution lines in commit messages.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Wire `CaseAddPage` labels to their controls

Edit `frontend/src/pages/CaseAddPage.tsx`.

1. Add `useId` to the existing React import on line 4:
   `import { useState, useCallback, useId } from "react";`
2. In `Field` (`:281-319`), add `const id = useId();` as the first line of the
   function body, then put `htmlFor={id}` on the `<label>` at `:302` and
   `id={id}` on the `<input>` at `:309`.
3. In `SelectField` (`:321-351`), add `const id = useId();` next to the existing
   `const { t } = useTranslation();`, then `htmlFor={id}` on the `<label>` at
   `:335` and `id={id}` on the `<select>` at `:338`.
4. For the inline notes block at `:228-238`, give the pair a static id — it
   renders once. Use `htmlFor="case-add-user-notes"` on the `<label>` and
   `id="case-add-user-notes"` on the `<textarea>`, matching the
   `CollectionEditor.tsx:158-170` exemplar.

Change nothing else — no class changes, no reordering.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'htmlFor=' src/pages/CaseAddPage.tsx && \
  grep -c 'useId' src/pages/CaseAddPage.tsx && \
  npx tsc -b --noEmit && echo TSC_OK
```
→ `3`, then `3` (one import + two call sites), then `TSC_OK`.

### Step 2: Wire `CaseEditPage` labels to their controls

Edit `frontend/src/pages/CaseEditPage.tsx`. Same treatment, three components:

1. Line 4 becomes `import { useState, useEffect, useCallback, useId } from "react";`
2. `Field` (`:404-433`): `const id = useId();` at the top of the body;
   `htmlFor={id}` on the `<label>` at `:421`; `id={id}` on the `<input>` at `:424`.
3. `SelectField` (`:435-473`): `const id = useId();` beside
   `const { t } = useTranslation();`; `htmlFor={id}` on the `<label>` at `:449`;
   `id={id}` on the `<select>` at `:452`.
4. `TextareaField` (`:475-499`): `const id = useId();` at the top of the body;
   `htmlFor={id}` on the `<label>` at `:488`; `id={id}` on the `<textarea>` at `:491`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'htmlFor=' src/pages/CaseEditPage.tsx && \
  npx tsc -b --noEmit && echo TSC_OK
```
→ `3`, then `TSC_OK`.

### Step 3: Give `CaseEditPage` an `<h1>`

Still in `frontend/src/pages/CaseEditPage.tsx`.

1. Add the import next to the other shared-component imports (after line 10):
   `import { PageHeader } from "@/components/shared/PageHeader";`
2. Insert a `PageHeader` between the breadcrumb row (which currently ends at
   `:206` with `</div>`) and `<form onSubmit={handleSubmit}>` at `:208`:

```tsx
      <PageHeader title={t("pages.case_edit.title")} />

      <form onSubmit={handleSubmit}>
```

`pages.case_edit.title` already exists in both locales ("Edit Case" /
"編輯案件"), so no `defaultValue` is needed. Leave the existing `<h2>`s at
`:212`, `:311` and `:359` exactly as they are — with an `<h1>` above them the
outline is now correct.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'PageHeader' src/pages/CaseEditPage.tsx && \
  npx tsc -b --noEmit && echo TSC_OK
```
→ `2` (import + usage), then `TSC_OK`.

### Step 4: Make `CaseComparePage` render one stable `<h1>`

Edit `frontend/src/pages/CaseComparePage.tsx`. The goal is that both rendered
states expose exactly one `<h1>` with the **same text**; the selection count
moves out of the heading into the header's `meta` slot.

1. Add `import { PageHeader } from "@/components/shared/PageHeader";` next to
   the other shared imports (after line 11).
2. Leave the `sr-only` `<h1>` at `:48-50` untouched. It is the fewer-than-two
   branch, where `EmptyState` already supplies the visible messaging.
3. Replace the visible `<h1>` block at `:123-128` with:

```tsx
      <PageHeader
        title={t("cases.comparison", { defaultValue: "Case Comparison" })}
        meta={<span>({cases.length})</span>}
      />
```

Do not touch the `Breadcrumb` at `:116-121` — it already carries the count.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c '<h1' src/pages/CaseComparePage.tsx && \
  npx tsc -b --noEmit && echo TSC_OK
```
→ `1` (only the `sr-only` one remains in this file; the other now comes from
`PageHeader`), then `TSC_OK`.

### Step 5: Rebuild `MobileNav` on Radix Dialog

Rewrite `frontend/src/components/layout/MobileNav.tsx`. Target shape — the
`<nav>` body from `:63-104` is copied across **verbatim**, only the shell changes:

⚠️ **`lg:hidden` alone is not enough once this is a real modal.** Today the
drawer is a plain `<div>` behind `if (!open) return null`, so when the viewport
crosses to `lg` the CSS simply hides it and nothing else happens. A Radix
`Dialog.Root` with `open={true}` keeps its focus trap, its `aria-hidden` on
sibling content and its outside-pointer blocking **regardless of whether the
content is visually hidden** — so a user who opens the drawer on a narrow
viewport and then widens the window (rotate a tablet, un-split a window, resize
a browser) is left with an invisible modal that swallows every click and traps
Tab on the desktop layout. That is a worse bug than the one being fixed.

`mobileOpen` lives in `frontend/src/components/layout/AppLayout.tsx:13`, which
is **out of scope**, so the guard has to live inside this component: watch the
`lg` media query and call `onClose()` when it matches. Detail 6 below.

```tsx
import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { APP_NAV_GROUPS } from "@/components/layout/nav-config";

/** Tailwind `lg`. Above this width AppLayout renders the desktop Sidebar. */
const DESKTOP_QUERY = "(min-width: 1024px)";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const { t } = useTranslation();
  const { savedSearches } = useSavedSearches();

  // A Radix dialog keeps its focus trap and pointer blocking even while
  // `lg:hidden` hides it, so an open drawer that survives a resize to desktop
  // becomes an invisible modal over the desktop layout. Close it instead.
  // `mobileOpen` is owned by AppLayout (out of scope), so this component asks
  // to be closed rather than closing itself.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    if (mql.matches) {
      onClose();
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--color-overlay)]/65 backdrop-blur-sm lg:hidden" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden"
          aria-describedby={undefined}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-accent" />
              <Dialog.Title asChild>
                <span className="font-heading text-lg font-semibold">
                  IMMI-Case
                </span>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-text hover:bg-surface"
                aria-label={t("common.close_menu")}
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            {/* ...unchanged from lines 64-103 of the original file... */}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Six details that are load-bearing — get each of them right:

1. **Delete the original keydown effect** (`:18-27`). Radix handles Escape.
   **Keep the `useEffect` import** — it is now used by the media-query guard in
   detail 6. (An earlier draft of this step said to delete the import and made
   `grep -c 'useEffect'` → `0` a done-criterion; that is no longer correct.
   What must not survive is the *keydown listener*, not the import.)
2. **Delete the `<button>` backdrop** (original `:34-39`). `Dialog.Overlay`
   replaces it and closes on outside pointer-down by default. The old backdrop
   was a focusable duplicate of the real close button.
3. **Delete `if (!open) return null`** (original `:29`). `Dialog.Root` owns
   mount/unmount now, and it needs to render on both sides of the transition to
   restore focus.
4. **Remove `id="mobile-nav-title"`** from the title span. With `asChild`,
   Radix's `Slot` lets the child's own `id` win over the generated one, which
   would leave `aria-labelledby` pointing at a non-existent element and destroy
   the dialog's accessible name. Let Radix generate the id. Nothing in the repo
   references `mobile-nav-title` (`grep -rn 'mobile-nav-title' frontend/src
   tests/` returns only the file itself).
5. **Keep the `Dialog.Content` class string byte-identical** to the original
   drawer div's: `fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar
   shadow-lg lg:hidden`. Four Playwright tests locate the drawer by
   `.fixed.inset-y-0.left-0` (see "E2E coupling" above). Keep `lg:hidden` too —
   it is still the right *visual* rule; detail 6 handles the *behavioural* half
   that a CSS class cannot.
6. **Close the dialog when the viewport reaches `lg`** — the `useEffect` shown
   in the target shape above. Three sub-points, all deliberate:
   - It checks `mql.matches` **immediately**, not only on `change`, so a drawer
     whose `open` prop is set while already on desktop (a stale state after a
     reload, or a future `Dialog.Trigger`) closes on the next commit rather than
     waiting for a resize that may never come.
   - It guards `typeof window === "undefined" || !window.matchMedia`. jsdom does
     **not** implement `matchMedia` in this repo's shared test setup
     (`frontend/__tests__/legislations-setup.ts` mocks `localStorage`,
     `ResizeObserver` and `IntersectionObserver`, but not `matchMedia`), so
     without the guard every existing test that renders `AppLayout` would throw.
     With it, the effect is a no-op in jsdom and the drawer behaves exactly as
     before — which is why test 9b can still open it.
   - It calls `onClose()` rather than managing its own state, because
     `mobileOpen` lives in `AppLayout.tsx`, which this plan does not own.

`aria-describedby={undefined}` is the documented way to tell Radix you
deliberately have no `Dialog.Description`; without it Radix logs a dev-mode
console warning on every open.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'window.addEventListener("keydown"' src/components/layout/MobileNav.tsx; \
  grep -c 'radix-ui/react-dialog' src/components/layout/MobileNav.tsx; \
  grep -c 'matchMedia' src/components/layout/MobileNav.tsx; \
  grep -c 'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden' src/components/layout/MobileNav.tsx; \
  npx tsc -b --noEmit && npx eslint src/components/layout/MobileNav.tsx && echo LINT_OK
```
→ `0` (the hand-rolled Escape listener is gone), `1`, `1` (the media-query
guard is present), `1`, then `LINT_OK` with no error output.

Note the first grep targets the **keydown listener**, not the `useEffect`
import: counting `useEffect` cannot distinguish "the Escape handler was removed"
from "the resize guard was never added", and both are required.

### Step 6: Let `Pagination` wrap, and announce its summary

Edit `frontend/src/components/shared/Pagination.tsx`.

1. Line `:30` becomes:
   `<div className="flex flex-wrap items-center justify-between gap-2">`
2. Lines `:31-33` become:

```tsx
      <p
        role="status"
        aria-live="polite"
        className="w-full text-sm text-muted-text sm:w-auto"
      >
        {t("pagination.showing", { start, end, total: totalItems })}
      </p>
```

`w-full sm:w-auto` drops the summary onto its own line below the `sm`
breakpoint, which is what lets the button group fit at 320px. `role="status"` +
`aria-live="polite"` mirrors the existing idiom at
`frontend/src/pages/GuidedSearchPage.tsx:502-506`. Change nothing else in the
file — `getVisiblePages` stays exactly as it is.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'flex flex-wrap items-center justify-between gap-2' src/components/shared/Pagination.tsx; \
  grep -c 'role="status"' src/components/shared/Pagination.tsx; \
  npx tsc -b --noEmit && echo TSC_OK
```
→ `1`, `1`, `TSC_OK`.

### Step 7: Name the remove-filter button and expose court names

Two small shared components. **Neither file uses semicolons — keep it that way.**

**7a. `frontend/src/components/shared/FilterPill.tsx`** — replace the whole file body:

```tsx
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

interface FilterPillProps {
  label: string
  value: string
  onRemove: () => void
}

export function FilterPill({ label, value, onRemove }: FilterPillProps) {
  const { t } = useTranslation()
  const removeLabel = t("filters.remove_filter", {
    defaultValue: "Remove filter",
  })

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent">
      <span className="text-accent/60">{label}:</span>
      {value}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${removeLabel}: ${label}: ${value}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
```

The accessible name is composed in JavaScript rather than through i18next
interpolation on purpose: the test mock returns `defaultValue` **without**
interpolating, so an interpolated `"Remove {{label}} filter"` would collapse to
one identical string for every pill under test — exactly the defect being fixed.
Composing in JS gives `"Remove filter: Court: FCA"` in production *and* in tests.

**7b. `frontend/src/components/shared/CourtBadge.tsx`** — change only the
`return` of `CourtBadge` (`:36-47`), leaving both maps untouched:

```tsx
  return (
    <>
      <span
        title={fullName}
        className={cn(
          "inline-flex shrink-0 cursor-default items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium text-white",
          bg,
          className
        )}
      >
        {court}
      </span>
      {fullName ? <span className="sr-only">{fullName}</span> : null}
    </>
  )
```

The expansion goes in a **sibling** of the badge, not a child. That is
deliberate and is the whole reason this change is safe:

- The badge element's own `textContent` stays exactly `"FCA"`, so
  `frontend/__tests__/case-detail-page.test.tsx:218`
  (`getAllByText("AATA")`) and Playwright's
  `get_by_text("FCA", exact=True)` in `tests/e2e/react/test_react_rapid_nav.py:101`
  keep matching the badge. A *child* span would have changed the badge's
  `textContent` to `"FCA Federal Court of Australia"` and silently broken both.
- Tailwind v4's `sr-only` is `position: absolute; width: 1px; height: 1px;
  margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
  border-width: 0` (confirmed in `frontend/node_modules/tailwindcss`). An
  absolutely positioned element is out of flow, so it is not a flex item and
  adds no `gap` in any of the flex rows that host a `CourtBadge`. Layout is
  unchanged.
- The `fullName ? … : null` guard matters: `courtNameMap` has no entry for
  unknown court codes, and rendering `undefined` would produce an empty
  `sr-only` span.

`title={fullName}` stays — it is still useful on a mouse.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c 'aria-label' src/components/shared/FilterPill.tsx; \
  grep -c 'type="button"' src/components/shared/FilterPill.tsx; \
  grep -c 'sr-only' src/components/shared/CourtBadge.tsx; \
  npx tsc -b --noEmit && npx eslint src && echo LINT_OK
```
→ `1`, `1`, `1`, then `LINT_OK` with **0 errors**. Do not gate on the warning
count: `plans/024-add-accessibility-gates.md` intentionally makes ~19 existing
jsx-a11y violations visible as warnings, and other plans in this batch add more.

### Step 8: Fix table semantics

Six files. Two distinct changes — do not conflate them.

**8a. Real row headers (the actual defect).** In the two comparison matrices the
first column of each body row is a row header marked up as `<td>`. Convert it,
and add `text-left` to preserve the current appearance (see "Excerpt 6" for why).

`frontend/src/pages/CaseComparePage.tsx:173` — the opening tag becomes:

```tsx
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card p-3 text-left font-medium text-muted-text whitespace-nowrap"
                  >
```

and its closing `</td>` at `:180` becomes `</th>`. The children (`{label}` and
the conditional "differs" span) are unchanged.

`frontend/src/components/judges/ComparisonTable.tsx:99-101` becomes:

```tsx
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-foreground"
                >
                  {row.metric}
                </th>
```

**8b. Column scope + accessible table names (hygiene).** Add `scope="col"` to
every `<th>` that sits inside a `<thead>` row, and add a visually hidden
`<caption>` as the **first child** of each `<table>`. `scope="col"` on a simple
one-header-row table changes nothing an assistive-tech user perceives — modern
screen readers infer column association from position, and `scope` is a
*sufficient* technique under WCAG 1.3.1, not a requirement. Do it anyway,
because it is one attribute per line and it makes the pattern mechanically
checkable. The `<caption>` is the part with real value: these tables currently
have **no** accessible name at all.

Exact `<th>` lines to touch (each is on its own line, so this is one attribute
insertion per line):

| File | `<th>` lines in `<thead>` |
|---|---|
| `frontend/src/components/cases/CasesTable.tsx` | 82, 94, 97, 100, 103, 110, 113, 116 |
| `frontend/src/components/judges/ComparisonTable.tsx` | 68, 71, 74, 77 |
| `frontend/src/components/judges/ConceptEffectivenessTable.tsx` | 37, 38, 39, 40 |
| `frontend/src/components/analytics/ConceptComboTable.tsx` | 32, 33, 34, 35 |
| `frontend/src/components/lineage/CourtVolumeTable.tsx` | 76, 79, 84, 87, 92, 95, 98 |
| `frontend/src/pages/CaseComparePage.tsx` | 134, 138 |

Captions — insert immediately after each `<table …>` opening tag, using the
existing i18n key where one exists and `defaultValue` otherwise:

| File | `<table>` line | Caption to insert |
|---|---|---|
| `CasesTable.tsx` | 79 | `<caption className="sr-only">{t("cases.title")}</caption>` |
| `ComparisonTable.tsx` | 65 | `<caption className="sr-only">{t("judges.comparison_table_caption", { defaultValue: "Judge comparison metrics" })}</caption>` |
| `ConceptEffectivenessTable.tsx` | 34 | `<caption className="sr-only">{t("judges.concept_effectiveness_caption", { defaultValue: "Legal concept effectiveness by judge" })}</caption>` |
| `ConceptComboTable.tsx` | 29 | `<caption className="sr-only">{t("analytics.concept_combo_caption", { defaultValue: "Legal concept combinations" })}</caption>` |
| `CourtVolumeTable.tsx` | 73 | `<caption className="sr-only">{t("lineage.court_volume_caption", { defaultValue: "Case volume by court" })}</caption>` |
| `CaseComparePage.tsx` | 131 | `<caption className="sr-only">{t("cases.comparison", { defaultValue: "Case Comparison" })}</caption>` |

All six files already have `const { t } = useTranslation();` in scope — confirm
that before inserting, and if any does not, STOP and report rather than adding
the hook.

`<caption>` must be the first child of `<table>`; browsers hoist it anyway but
React will warn if you place it after `<thead>`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend/src" && \
for f in components/cases/CasesTable.tsx \
         components/judges/ComparisonTable.tsx \
         components/judges/ConceptEffectivenessTable.tsx \
         components/analytics/ConceptComboTable.tsx \
         components/lineage/CourtVolumeTable.tsx \
         pages/CaseComparePage.tsx; do
  printf '%-50s th=%s scope=%s caption=%s\n' "$f" \
    "$(grep -c -- '</th>' "$f")" "$(grep -c -- 'scope=' "$f")" "$(grep -c -- '<caption' "$f")"
done
```
Counting `</th>` rather than `<th` is deliberate: `grep -c '<th'` also matches
the `<thead>` line and inflates every count by exactly one, while `</th>` never
matches `</thead>`. Expected output — `th` and `scope` equal on every row,
`caption` exactly 1:
```
components/cases/CasesTable.tsx                    th=8 scope=8 caption=1
components/judges/ComparisonTable.tsx              th=5 scope=5 caption=1
components/judges/ConceptEffectivenessTable.tsx    th=4 scope=4 caption=1
components/analytics/ConceptComboTable.tsx         th=4 scope=4 caption=1
components/lineage/CourtVolumeTable.tsx            th=7 scope=7 caption=1
pages/CaseComparePage.tsx                          th=3 scope=3 caption=1
```
(Before your edits the same loop prints `scope=0 caption=0` and `th=` one lower
in `ComparisonTable.tsx` and `CaseComparePage.tsx`, which is the row header you
are about to add. Run it once before editing to confirm the baseline.)

Then:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && echo TSC_OK
```

### Step 9: Write the regression tests

Create three files under `frontend/__tests__/`. Vitest config
(`frontend/vitest.config.ts`) uses `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`,
`environment: "jsdom"`, `globals: true`, and the global setup
`./__tests__/legislations-setup.ts` — which already mocks `react-i18next`
(so `t("k")` → `"k"` and `t("k", { defaultValue: "D" })` → `"D"`),
`localStorage`, `ResizeObserver` and `IntersectionObserver`. You do not need to
re-mock any of those.

Model the structure on `frontend/__tests__/case-add-page-mutations-disabled.test.tsx`
— it shows the `vi.hoisted` + `vi.mock("@/hooks/use-cases", …)` +
`QueryClientProvider` + `BrowserRouter` render helper this repo uses, and it
sets the precedent for `container.querySelector(...)` where a role query would
be brittle (`:64`).

**9a. `frontend/__tests__/a11y-form-labels.test.tsx`**

Mock `@/hooks/use-cases` and assert that the previously nameless controls now
resolve by label. With the i18n mock, `t("cases.court_code")` returns the key
string, so the accessible names under test are the raw keys.

- `CaseAddPage` (mock `useCreateCase` → `{ mutateAsync: vi.fn(), isPending: false }`):
  - `screen.getByLabelText("cases.court_code")` has `tagName === "SELECT"`.
  - `screen.getByLabelText("cases.case_title *")` has `tagName === "INPUT"`.
  - `screen.getByLabelText("case_detail.notes")` has `tagName === "TEXTAREA"`.
- `CaseEditPage` (mock `useCase` → `{ data: { case: { case_id: "abc", title: "T", citation: "[2024] FCA 1", court_code: "FCA" } }, isLoading: false, isError: false, error: null, refetch: vi.fn() }` and `useUpdateCase` → `{ mutateAsync: vi.fn(), isPending: false }`).
  Render inside `<MemoryRouter initialEntries={["/cases/abc/edit"]}>` with
  `<Routes><Route path="/cases/:id/edit" element={<CaseEditPage />} /></Routes>`
  so `useParams` resolves `id`.
  - `screen.getByLabelText("cases.court_code")` has `tagName === "SELECT"`.
  - `screen.getByLabelText("case_detail.catchwords")` has `tagName === "TEXTAREA"`.
  - `screen.getByRole("heading", { level: 1, name: "pages.case_edit.title" })`
    is in the document (this is Step 3's regression guard).

**9b. `frontend/__tests__/a11y-mobile-nav.test.tsx`**

Render `<MobileNav open onClose={onClose} />` inside a `<MemoryRouter>`
(`NavLink` needs a router; `useSavedSearches` needs nothing beyond the mocked
`localStorage`). Assert:

- `screen.getByRole("dialog")` exists and its accessible name is `"IMMI-Case"`
  (`screen.getByRole("dialog", { name: "IMMI-Case" })`). This is the assertion
  that catches detail 4 of Step 5 — a hand-merged `id` would break it.
- Focus moved into the drawer on open:
  `const dialog = screen.getByRole("dialog"); expect(dialog === document.activeElement || dialog.contains(document.activeElement)).toBe(true);`
- The E2E selector survives:
  `expect(dialog).toHaveClass("fixed", "inset-y-0", "left-0", "lg:hidden");`
- Escape closes: `await userEvent.keyboard("{Escape}")` (import
  `userEvent from "@testing-library/user-event"`, already a devDependency) then
  `expect(onClose).toHaveBeenCalled()`.
- Rendering with `open={false}` yields `screen.queryByRole("dialog") === null`.
- **Resizing to desktop closes the drawer** — the regression guard for Step 5
  detail 6, and the assertion that would have caught the invisible-modal bug.
  jsdom has no `matchMedia`, so stub a controllable one before rendering:

  ```tsx
  function stubMatchMedia(initialMatches: boolean) {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = {
      matches: initialMatches,
      media: "(min-width: 1024px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => { listeners.add(l); },
      removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => { listeners.delete(l); },
      dispatchEvent: () => false,
    };
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true, value: () => mql,
    });
    return {
      goDesktop() {
        mql.matches = true;
        listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
      },
    };
  }
  ```

  Delete the stub in `afterEach` (`delete (window as { matchMedia?: unknown }).matchMedia;`)
  so the other tests keep the jsdom default and the guard's no-op path.

  Three assertions:
  1. Mobile start (`stubMatchMedia(false)`), render `<MobileNav open />` →
     `screen.getByRole("dialog")` exists and `onClose` has **not** been called.
  2. `act(() => controls.goDesktop())` → `expect(onClose).toHaveBeenCalled()`.
     Without detail 6 this fails: the dialog stays open with its focus trap
     live, which is the invisible-modal bug.
  3. Opening while **already** desktop (`stubMatchMedia(true)`, then render
     `<MobileNav open />`) also calls `onClose` — the immediate `mql.matches`
     check, not just the `change` listener.
- **Do not** assert that the dialog is absent from the DOM after `goDesktop()`.
  This component only *requests* a close; `open` is owned by `AppLayout`, so in
  isolation the dialog stays mounted. The contract under test is that `onClose`
  fires. Asserting on unmounting here would be asserting on the test harness,
  not on the component.

**9c. `frontend/__tests__/a11y-controls-and-tables.test.tsx`**

- `FilterPill`: render two pills — `label="Court" value="FCA"` and
  `label="Nature" value="Migration"` — and assert both
  `screen.getByRole("button", { name: "Remove filter: Court: FCA" })` and
  `screen.getByRole("button", { name: "Remove filter: Nature: Migration" })`
  resolve, and that the first has `type === "button"`.
- `CourtBadge`: render `<CourtBadge court="FedCFamC2G" />` and assert
  `screen.getByText("Federal Circuit and Family Court of Australia (Division 2)")`
  is in the document, **and** that the badge itself still matches exactly:
  `expect(screen.getByText("FedCFamC2G")).toBeInTheDocument();`. The second
  assertion is the guard against re-nesting the expansion inside the badge.
- `Pagination`: render with `currentPage={2} totalPages={10} totalItems={200} pageSize={20}`
  and assert `screen.getByRole("status")` is in the document, and that the
  outer container carries `flex-wrap`:
  `expect(container.querySelector("div.flex-wrap")).not.toBeNull();`
- `ComparisonTable` row headers: render with two rows and assert
  `container.querySelectorAll('tbody th[scope="row"]').length === 2` and
  `container.querySelector("caption")?.textContent === "Judge comparison metrics"`.
- Table hygiene, as a source-text check in the style of
  `frontend/__tests__/i18n-hardcoded.test.ts` (`readFileSync` + regex): for each
  of the six files listed in Step 8, assert the file's count of `<th` lines
  equals its count of `scope=` lines, and that it contains `<caption`.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx vitest run __tests__/a11y-form-labels.test.tsx __tests__/a11y-mobile-nav.test.tsx __tests__/a11y-controls-and-tables.test.tsx
```
→ 3 test files, all pass, 0 failed.

### Step 10: Run the full gate

Record the baseline **before** you start editing (do this as your very first
action, alongside the drift check):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
#   FE_BEFORE      = "Tests  N passed"
#   FEFILES_BEFORE = "Test Files  N passed"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -5
#   WK_BEFORE = "Tests  N passed"
```

Then, at the end:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit && echo TSC_OK && \
  npx eslint src && echo LINT_OK && \
  npx vitest run 2>&1 | tail -5 && \
  npx vitest run __tests__/a11y-form-labels.test.tsx __tests__/a11y-mobile-nav.test.tsx __tests__/a11y-controls-and-tables.test.tsx 2>&1 | tail -5
```

Expected:
- `TSC_OK`.
- `LINT_OK` with **0 errors**. The warning count is not a gate — sibling plans
  land warnings in parallel.
- Full Vitest: **0 failed**, `Tests passed` == `FE_BEFORE + <the number of `it`
  blocks you wrote across the three new files>`, `Test Files passed` ==
  `FEFILES_BEFORE + 3`. State that arithmetic explicitly in your report. Do not
  compare against any number written into this plan.
- Three-file run: all pass, 0 failed — a per-file result that stays valid
  however many sibling plans land.

Then confirm nothing outside the territory moved:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ only the 12 in-scope source files (`M`) and the 3 new test files (`??`).
If anything else appears, **stop and report** — do not run `git checkout --` or
`git clean`, which cannot tell your mistake from the operator's own work.

## Test plan

New tests, all under `frontend/__tests__/`, all written in Step 9:

| File | Cases |
|---|---|
| `a11y-form-labels.test.tsx` | CaseAddPage select / input / textarea resolve by `getByLabelText`; CaseEditPage select / textarea resolve by `getByLabelText`; CaseEditPage exposes exactly one level-1 heading. |
| `a11y-mobile-nav.test.tsx` | Open drawer exposes `role="dialog"` named "IMMI-Case"; focus lands inside on open; the `.fixed.inset-y-0.left-0` E2E class chain survives; Escape calls `onClose`; closed drawer renders no dialog. |
| `a11y-controls-and-tables.test.tsx` | Two FilterPills expose two *distinct* button names and `type="button"`; CourtBadge exposes the full court name while the badge's own text stays exactly the code; Pagination exposes `role="status"` and a `flex-wrap` container; ComparisonTable has one `th[scope="row"]` per body row and an `sr-only` caption; all six table files have `<th` count == `scope=` count and contain `<caption`. |

Structural patterns to copy:
- Hook mocking, provider wrapper, `container.querySelector` precedent:
  `frontend/__tests__/case-add-page-mutations-disabled.test.tsx`.
- Source-text assertions: `frontend/__tests__/i18n-hardcoded.test.ts`.

Regression surface to re-run unchanged:
- `cd frontend && npx vitest run` — every pre-existing file must still pass.
  `frontend/__tests__/case-detail-page.test.tsx` and
  `frontend/__tests__/court-sparkline-grid.test.tsx` are the two that assert on
  court-code text; both must stay green (Step 7b is designed so they do). Run
  those two by name so the check does not depend on a whole-suite total.
- `cd workers && npx vitest run` — 0 failed and the count unchanged from
  `WK_BEFORE`. This plan touches no Worker code; run it once at the end as a
  sanity check.

Playwright E2E (`tests/e2e/react/`) is **not** part of this gate — it needs a
running Flask server and a built SPA bundle. Do not attempt to run it. The two
coupling points it has with this change are pinned by unit assertions instead
(the `.fixed.inset-y-0.left-0` class check in 9b, the exact-text check in 9c).

### What jsdom cannot prove, and who owns proving it

Be honest about this in your report. The three new files run in jsdom, which has
no layout engine, no real focus ring, and no viewport. They can assert that an
attribute exists and that a callback fires; they **cannot** assert any of the
following, and none of it is covered anywhere in this repo today:

| Claim this plan makes | Why jsdom cannot check it |
|---|---|
| Pagination no longer overflows at 320px | jsdom computes no layout; `flex-wrap` has no effect on any measurable box |
| Tab cycles within the open drawer and does not escape into page content | Radix's focus trap depends on real focusability and `inert`/`aria-hidden` behaviour |
| Focus is restored to the hamburger after the drawer closes | needs a real focus stack |
| Background content is genuinely non-interactive while the drawer is open | needs real hit-testing |
| Resizing mobile → desktop leaves no invisible modal blocking clicks | 9b proves `onClose` fires; only a browser proves the page is clickable afterwards |
| `<th scope="row">` conversions did not visibly re-centre a column | needs rendering |

**HANDOFF to `plans/040-revive-the-e2e-suites.md`.** That plan owns the E2E job.
Ask it to add these six scenarios against a built SPA:

1. At 320px and 390px, load `/cases` and assert
   `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal
   overflow) with the pager visible.
2. At 390px, open the drawer, press Tab 20 times, assert
   `document.activeElement` is always inside `[role="dialog"]`.
3. Press Escape → drawer closes **and** focus returns to the hamburger button.
4. With the drawer open, assert a link in the page behind it is not clickable
   (`page.click` on it times out or the click lands on the overlay).
5. Open the drawer at 390px, resize the viewport to 1280px, then click a
   sidebar link — it must work. This is the invisible-modal regression.
6. Screenshot `/cases` and `/judges/compare` before/after to confirm no column
   re-centred after the `<td>` → `<th scope="row">` conversion.

Until those exist, the accessibility claims in this plan rest on attribute
presence, not on behaviour. Say so rather than implying browser-level
verification happened.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx eslint src` reports **0 errors** (warning count is
      explicitly not a gate)
- [ ] `cd frontend && npx vitest run` reports **0 failed**, `Tests passed` ==
      `FE_BEFORE + <it count across the 3 new files>`, `Test Files passed` ==
      `FEFILES_BEFORE + 3`
- [ ] `cd frontend && npx vitest run __tests__/a11y-form-labels.test.tsx __tests__/a11y-mobile-nav.test.tsx __tests__/a11y-controls-and-tables.test.tsx`
      reports 3 files passed, 0 failed
- [ ] `cd frontend && npx vitest run __tests__/case-detail-page.test.tsx __tests__/court-sparkline-grid.test.tsx`
      reports 0 failed (the two suites coupled to `CourtBadge`'s exact text)
- [ ] `cd workers && npx vitest run` reports 0 failed with `Tests passed`
      unchanged from `WK_BEFORE`
- [ ] `cd frontend && grep -c 'htmlFor=' src/pages/CaseAddPage.tsx` returns `3`
- [ ] `cd frontend && grep -c 'htmlFor=' src/pages/CaseEditPage.tsx` returns `3`
- [ ] `cd frontend && grep -c 'PageHeader' src/pages/CaseEditPage.tsx` returns `2`
- [ ] `cd frontend && grep -c '<h1' src/pages/CaseComparePage.tsx` returns `1`
- [ ] `cd frontend && grep -c 'window.addEventListener("keydown"' src/components/layout/MobileNav.tsx` returns `0`
- [ ] `cd frontend && grep -c 'matchMedia' src/components/layout/MobileNav.tsx` returns `1`
- [ ] `cd frontend && grep -c 'radix-ui/react-dialog' src/components/layout/MobileNav.tsx` returns `1`
- [ ] `cd frontend && grep -c 'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar shadow-lg lg:hidden' src/components/layout/MobileNav.tsx` returns `1`
- [ ] `cd frontend && grep -c 'role="status"' src/components/shared/Pagination.tsx` returns `1`
- [ ] `cd frontend && grep -c 'aria-label' src/components/shared/FilterPill.tsx` returns `1`
- [ ] `cd frontend && grep -c 'sr-only' src/components/shared/CourtBadge.tsx` returns `1`
- [ ] The Step 8 verification loop prints `th=N scope=N caption=1` on all six rows
- [ ] `cd frontend && git diff --stat -- src/i18n/locales/` is empty (no locale files touched)
- [ ] The report names the five new `defaultValue`-only i18n keys and hands them
      to `plans/018-complete-the-i18n-catalogue.md` (see Maintenance notes) —
      shipping them untranslated is a known, disclosed gap, not an oversight
- [ ] The report states which accessibility claims are **not** verified by these
      tests and hands the six browser scenarios to
      `plans/040-revive-the-e2e-suites.md` (see "What jsdom cannot prove")
- [ ] `git status --short` lists only the 12 in-scope source files and the 3 new test files
- [ ] `plans/README.md` is **unchanged** — the integration owner maintains it

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file shows any in-scope file changed since
  `42826a3`, and the "Current state" excerpts no longer match the live code.
- Any line number in Step 8's `<th>` table does not actually contain a `<th`
  when you open the file. Do not guess a nearby line — the file has drifted.
- `npx vitest run` reports any failure, or `Tests passed` is not
  `FE_BEFORE + <it count across the 3 new files>`. In particular, if
  `frontend/__tests__/case-detail-page.test.tsx` or
  `frontend/__tests__/court-sparkline-grid.test.tsx` fails after Step 7b, you
  have nested the `sr-only` expansion *inside* the badge instead of beside it —
  re-read Step 7b before touching the tests.
- The `MobileNav` Radix test in 9b cannot be made to pass in jsdom after two
  genuine fix attempts. Radix Dialog is not currently exercised in jsdom
  anywhere in this repo (`frontend/__tests__/collection-pages.test.tsx:42`
  explicitly mocks `CollectionEditor` out to "avoid portal / dialog
  complexity"), so this is the one step with real unknowns. Keep the component
  change, report exactly which assertion fails and its error, and do **not**
  weaken the assertion to make it pass.
- `npx eslint src` reports any **error** (not warning). The most likely cause in
  `MobileNav.tsx` is an unused import left behind by the rewrite — note that
  `useEffect` is still **used** (Step 5 detail 6), so removing it is the error,
  not the fix.
- The Step 5 detail-6 media-query effect cannot be made to pass 9b's resize
  assertions after two genuine attempts. Keep the component change and report
  the failing assertion verbatim. Do **not** delete the effect to get a green
  suite: without it an open drawer that survives a resize to desktop leaves an
  invisible modal blocking every click on the desktop layout, which is worse
  than the missing focus trap this plan set out to fix.
- The drift check shows `frontend/src/components/cases/CasesTable.tsx` changed
  **and** it does not contain `useSyncExternalStore`. That is not plan 020's
  change; something else edited the file. Report and stop.
- Converting `<td>` to `<th scope="row">` visibly re-centres a column in a
  screenshot or in a snapshot test. You forgot `text-left`.
- The fix appears to require editing any file in the "Out of scope" list.
- You discover the assumption "`frontend/vitest.config.ts` picks up new files
  under `frontend/__tests__/` automatically" is false — verify by running the
  single-file command in Step 9 before writing all three.

## Maintenance notes

For the human or agent who owns this code next:

- **What a reviewer should scrutinise**: (1) that `Dialog.Content`'s class
  string in `MobileNav.tsx` is byte-identical to the old drawer div's — four
  Playwright tests select on `.fixed.inset-y-0.left-0` and there is no unit test
  that would catch a typo in the *other* classes; (2) that the `sr-only` court
  expansion is a **sibling** of the badge span, not a child; (3) that every
  `<td>` → `<th>` conversion also gained `text-left`; (4) that the media-query
  effect in `MobileNav.tsx` is still there and still guards
  `!window.matchMedia` — deleting it turns a resize into an invisible modal, and
  deleting the guard breaks every jsdom test that renders `AppLayout`.
- **HANDOFF — five new i18n keys ship untranslated.** This plan introduces the
  following, and **none of them exists in `frontend/src/i18n/locales/en.json` or
  `zh-TW.json`** (verified: `grep -c` → 0 in both for all five). They ship as
  `defaultValue`-only, which means a zh-TW user — including a zh-TW screen-reader
  user, who is exactly the person these strings exist for — gets English. Locale
  JSON is owned by `plans/018-complete-the-i18n-catalogue.md`; hand it this
  table:

  | key | en | zh-TW |
  |---|---|---|
  | `filters.remove_filter` | `Remove filter` | `移除篩選條件` |
  | `judges.comparison_table_caption` | `Judge comparison metrics` | `法官比較指標` |
  | `judges.concept_effectiveness_caption` | `Legal concept effectiveness by judge` | `各法官的法律概念成效` |
  | `analytics.concept_combo_caption` | `Legal concept combinations` | `法律概念組合` |
  | `lineage.court_volume_caption` | `Case volume by court` | `各法院案件量` |

  Note that `filters.remove_filter` is composed in JS at the call site
  (`` `${removeLabel}: ${label}: ${value}` ``) rather than interpolated through
  i18next — see Step 7a for why. The catalogue entry is therefore the bare
  prefix, with no `{{}}` placeholders. Do not "improve" it into an interpolated
  string without re-reading that rationale, or every pill's accessible name
  collapses to one identical string under the test mock.
- **Deliberately deferred, and why** — each of these is a real remaining gap in
  the same finding family, left out only because it lives in a file territory
  another plan owns:
  - The hamburger at `frontend/src/components/layout/Topbar.tsx:21-27` still has
    no `aria-expanded` / `aria-controls`. Wiring it needs the drawer's open state
    threaded from `AppLayout.tsx` as a new prop. Now that `MobileNav` is a Radix
    dialog, the cleanest version is a `Dialog.Trigger` moved into `Topbar` —
    which is a bigger refactor than this plan's territory allows.
  - `GlobalSearch.tsx:92-97` and `CollectionEditor.tsx:127-132` still have bare
    `<X>` close buttons with no accessible name. Same one-line fix as Step 7a.
  - `CasesPage.tsx`, `JudgeProfilesPage.tsx`, `LegislationsPage.tsx` and
    `CollectionsPage.tsx` still have no live region around their results block.
    Only four pages in the app have one today: `DataToolsPage`,
    `GuidedSearchPage`, `LlmCouncilPage`, `SemanticSearchPage`. The idiom to
    copy is `SemanticSearchPage.tsx:168-173`. Consider extracting a
    `<ResultsRegion>` so the next list page gets it by default.
  - `LlmCouncilPage.tsx:1326` and `GuidedSearchPage.tsx:414` still hand-roll
    their `<h1>` at different type scales; `GuidedSearchPage`'s drops
    `font-heading` entirely, so that page loses the Crimson Text brand face.
    Both should move to `PageHeader`.
  - `TagInputModal.tsx` and `SuccessRateCalculator.tsx:90-105` still have
    unnamed controls (the latter is a bare `<span>` before an unnamed
    `<select>`, twice).
  - `eslint-plugin-jsx-a11y` is still not installed. With
    `label-has-associated-control`, `control-has-associated-label` and the
    `scope` rule enabled, every defect in this plan becomes a lint error and
    cannot drift back. That is the durable fix; this plan is the one-time
    cleanup that makes enabling it feasible.
- **What will interact with this later**: if anyone adds a `Dialog.Description`
  to `MobileNav`, remove the `aria-describedby={undefined}` escape hatch at the
  same time or the description will not be announced. If `PageHeader`'s prop
  signature changes, `CaseEditPage` and `CaseComparePage` are now two more call
  sites. If the pagination window in `getVisiblePages` is ever widened past
  seven entries, re-check the 320px fit — the `w-full sm:w-auto` summary buys
  roughly 50px of headroom and no more.
- **Not addressed, by design**: `CaseComparePage`'s `isLoading` and `isError`
  branches return `<PageLoader />` / `<ApiErrorState>` with no `<h1>` at all.
  Fixing that means restructuring the component's early returns around a shared
  header, which is out of proportion to the benefit and would collide with any
  concurrent work on that page.

## Findings reconsidered

Corrections made while verifying the audit against the code at `42826a3`. Every
item below still resulted in work — none of the findings was dropped — but the
claims were narrowed or their evidence re-pinned.

- **Table semantics severity narrowed.** The claim that zero `scope` attributes
  across ~100 `<th>` elements leaves the tables "unnavigable by screen reader"
  does not hold. The counts are exact (`scope=` → 0 matches, `<caption` → 0
  matches, 17 files with `<th>`), but for a simple table with one `<thead>` row
  of `<th>`, every major screen reader infers column-header association from
  position; `scope="col"` is a *sufficient* technique under WCAG 1.3.1, not a
  requirement. The genuine, unrecoverable defect is narrower: the comparison
  matrices mark their row-header column as `<td>`. Step 8 therefore splits into
  8a (the real fix, two files) and 8b (hygiene, six files) and says so.
- **Pagination width arithmetic corrected.** The audit asserted "7 page buttons
  + 2 ellipses" needing ~540px, which would have broken 390px too. Reading
  `getVisiblePages` at `Pagination.tsx:97-108`: for `total > 7` it returns at
  most **seven** entries, of which at most five are numbers. With prev/next that
  is nine elements, ~280px min-content, ~330px total against 288px available at
  320px and 358px at 390px. So it overflows at 320px **only** — which is exactly
  why `tests/e2e/react/test_react_responsive.py`'s 390x844 class passes today.
  The fix in Step 6 is unchanged; the blast radius is smaller than claimed.
- **Court-badge severity downgraded, and the fix shape changed.** The
  `title`-only expansion is real (`CourtBadge.tsx:38`; no `sr-only`, no `abbr`,
  no `aria-label` anywhere in the 48-line file). But no information is lost —
  `CourtLineagePage` explains both succession chains, and the abbreviations are
  the standard citation form in any Australian case reference. This is
  progressive disclosure, not an access barrier. Separately, the audit's
  suggested `<span className="sr-only">` *inside* the badge would have changed
  the badge's `textContent` and silently broken
  `frontend/__tests__/case-detail-page.test.tsx:218` and Playwright's
  `get_by_text("FCA", exact=True)` in `tests/e2e/react/test_react_rapid_nav.py:101`.
  Step 7b uses a sibling instead.
- **Two of the five "nameless control" sites are not nameless.** The
  `GlobalSearch` input (`GlobalSearch.tsx:50-91`) and the `TagInputModal` input
  both carry a `placeholder`, which per HTML-AAM is a valid accessible-name
  fallback for a text input. They announce a weak name, not "blank". The
  `<select>` and `<textarea>` elements on the add/edit forms have no such
  fallback and are genuinely nameless — that is where Steps 1 and 2 focus. Both
  of those files are outside this plan's territory in any case.
- **Live-region gap is slightly wider than reported, and mostly out of
  territory.** Grepping `frontend/src/pages/` for `aria-live` and `role="status"`
  finds **four** files, not six: `DataToolsPage`, `GuidedSearchPage`,
  `LlmCouncilPage`, `SemanticSearchPage`. Every page the audit named as lacking
  one genuinely does lack one. Only the `Pagination` summary is inside this
  plan's file territory (Step 6); the `CasesPage` results-block live region is
  recorded in "Maintenance notes" for whichever plan owns that page.
- **Line-number corrections** (the audit's citations had drifted; the code is
  as described at the corrected lines):
  - `CaseEditPage.tsx` `SelectField` label: 447 → **449**; `TextareaField`
    label: 486 → **488**.
  - `CaseComparePage.tsx` row-header `<td>`: 172 → **173**.
  - `CasesTable.tsx` `<CourtBadge>`: 106 → **200**. Line 106 is part of a
    `<th>`'s date sub-label. The `<thead>` block is `:80-120`, and the first
    header cell is at `:82`, not `:93`.
  - `Topbar.tsx` hamburger button: opens at **:21**, not :22.
