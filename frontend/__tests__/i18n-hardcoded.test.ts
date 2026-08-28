import { readFileSync } from 'fs';
import { join } from 'path';

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
});
