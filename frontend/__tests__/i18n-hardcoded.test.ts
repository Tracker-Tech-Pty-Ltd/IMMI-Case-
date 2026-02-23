import { readFileSync } from 'fs';
import { join } from 'path';

describe('i18n hardcoded string checks', () => {
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

  it('CasesPage handleBatch should include t in useCallback deps', () => {
    const content = readFileSync(
      join(__dirname, '../src/pages/CasesPage.tsx'),
      'utf8'
    );
    // The handleBatch should have t in its deps
    // Check that there's a useCallback that mentions both batchMutation and t in deps
    expect(content).toMatch(/handleBatch.*useCallback[\s\S]*?\[.*batchMutation.*t.*\]|handleBatch.*useCallback[\s\S]*?\[.*t.*batchMutation.*\]/);
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
