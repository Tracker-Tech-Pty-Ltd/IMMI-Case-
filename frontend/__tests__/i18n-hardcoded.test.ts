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
});
