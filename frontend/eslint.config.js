import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  // ── jsx-a11y baseline, measured against the live tree per plans/024 Step 2 ─────
  // These 7 files carry the 19 jsx-a11y violations that existed when the
  // gate was switched on. They are pinned to `warn` per-rule so the gate can
  // be an error everywhere else in the tree.
  //
  // DO NOT ADD FILES OR RULES TO THIS LIST. Fix the violation and delete the
  // entry instead. Notes on what is actually wrong, for whoever fixes them:
  //   * heading-has-content / anchor-has-content in the llm-council files are
  //     false positives: they are react-markdown component overrides of the
  //     form `h1: (p) => <h1 ... {...p} />`, so the content arrives via the
  //     spread. Fix with a targeted eslint-disable-next-line + reason.
  //   * no-redundant-roles on DataToolsPage's `<ul role="list">` is a
  //     deliberate Safari/VoiceOver workaround (VoiceOver drops list
  //     semantics when list-style is none). Same treatment.
  //   * The interaction rules on the judges components and no-autofocus on
  //     SortableCaseItem are real defects worth fixing properly.
  {
    files: ['src/components/collections/SortableCaseItem.tsx'],
    rules: { 'jsx-a11y/no-autofocus': 'warn' },
  },
  {
    files: ['src/components/judges/JudgeCard.tsx'],
    rules: { 'jsx-a11y/no-noninteractive-element-interactions': 'warn' },
  },
  {
    files: ['src/components/judges/JudgeLeaderboard.tsx'],
    rules: {
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',
    },
  },
  {
    files: ['src/components/llm-council/StreamingCouncilView.tsx'],
    rules: { 'jsx-a11y/heading-has-content': 'warn' },
  },
  {
    files: ['src/components/llm-council/TurnCard.tsx'],
    rules: {
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
    },
  },
  {
    files: ['src/pages/DataToolsPage.tsx'],
    rules: { 'jsx-a11y/no-redundant-roles': 'warn' },
  },
  {
    files: ['src/pages/DesignTokensPage.tsx'],
    rules: { 'jsx-a11y/role-supports-aria-props': 'warn' },
  },
])
