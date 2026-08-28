import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

/**
 * i18n contract checks.
 *
 * These are deliberately SOURCE-LEVEL assertions, not behavioural coverage:
 * two greps that a component routes a label through i18n rather than
 * hardcoding English, plus two real data assertions over the locale JSON.
 * Do not add `useCallback` dependency-array string matches here — those pin
 * exact formatting, go red on a Prettier line-wrap, and stay green when the
 * dependency is present but unused. `react-hooks/exhaustive-deps` in
 * frontend/eslint.config.js is the right gate for that.
 */
describe('i18n source-level contract checks', () => {
  it('TimelineChart should not have hardcoded <span>Total</span>', () => {
    const content = readFileSync(
      join(__dirname, '../src/components/lineage/TimelineChart.tsx'),
      'utf8'
    );
    // Should not have the literal pattern with hardcoded Total
    expect(content).not.toMatch(/<span>Total<\/span>/);
  });

  it('TimelineChart should use t("analytics.total")', () => {
    const content = readFileSync(
      join(__dirname, '../src/components/lineage/TimelineChart.tsx'),
      'utf8'
    );
    expect(content).toContain('analytics.total');
  });

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

  it('no new hardcoded aria-label / title / placeholder literals', () => {
    // Baseline ratchet: these exist in files owned by other plans as of this
    // commit. Removing one is fine; adding a new one fails this test.
    // NOTE: the App.tsx::Application error entry that appeared in earlier
    // drafts of this baseline no longer applies -- plans/015 Step 6 replaced
    // App.tsx's own inline ErrorBoundary with the shared
    // RouteErrorBoundary.tsx component (already allowlisted below), and
    // "Application error" no longer appears anywhere in src/.
    const ALLOWED = new Set([
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
      // cannot call the useTranslation hook -- same constraint App.tsx's own
      // ErrorBoundary had before it was consolidated into this component.
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
    // aria-labels actually live. Baseline: 11 entries as of this commit, all in
    // files this plan does not own; each is listed in Maintenance notes as a
    // follow-up. Superset check -- shrink it, never grow it.
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

    // KNOWN BLIND SPOTS -- an AST rule is the real fix; see Maintenance notes.
    expect(quoted('<b aria-label={label} />')).toEqual([]);
    expect(templated('<b aria-label={label} />')).toEqual([]);
    expect(quoted('<span>Delete</span>')).toEqual([]);
  });
});
