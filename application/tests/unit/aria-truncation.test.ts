import { describe, test, expect } from 'vitest';
import { selectAriaForBudget } from '../../server/utils/ai-context';

/**
 * Exercises the REAL content-aware ARIA truncation used when building the AI
 * diagnosis context (`selectAriaForBudget` in `server/utils/ai-context.ts`),
 * so drift in the production function is caught here rather than silently
 * passing against a copy.
 */

const TRUNCATION_MARKER = /elided|\[truncated\]/;

function buildSnapshot(navItems: number): string {
  const nav = ['- navigation "Primary":', '  - list:'];
  for (let i = 1; i <= navItems; i++) nav.push(`    - listitem: "Item ${i}"`);
  const main = ['- main "Page":', '  - heading "Report title"', '  - paragraph: "Some important body content here."'];
  return [...nav, ...main].join('\n');
}

describe('selectAriaForBudget', () => {
  test('returns the snapshot unchanged when it already fits the budget', () => {
    const snapshot = '- main "Page":\n  - heading "Title"';
    expect(selectAriaForBudget(snapshot, 1000)).toBe(snapshot);
  });

  test('hard-slices a snapshot with no top-level blocks', () => {
    const snapshot = 'x'.repeat(100);
    const out = selectAriaForBudget(snapshot, 20);
    expect(out).toBe('x'.repeat(20));
    expect(out).not.toMatch(TRUNCATION_MARKER);
  });

  test('shrinks an over-budget snapshot within the budget (+ marker)', () => {
    const snapshot = buildSnapshot(40);
    const budget = 400;
    const out = selectAriaForBudget(snapshot, budget);
    expect(out.length).toBeLessThan(snapshot.length);
    expect(out.length).toBeLessThanOrEqual(budget + '\n[truncated]'.length);
  });

  test('keeps the content region and the headers of collapsed regions', () => {
    const out = selectAriaForBudget(buildSnapshot(40), 400);
    // The content region ("main") is prioritized and its header survives…
    expect(out).toContain('main "Page"');
    // …and the collapsed nav region still announces that it existed.
    expect(out).toContain('navigation');
  });

  test('collapses a long repetitive region rather than dumping every sibling', () => {
    const out = selectAriaForBudget(buildSnapshot(40), 400);
    expect(out).toContain('Item 1');
    expect(out).not.toContain('Item 40');
    expect(out).toMatch(TRUNCATION_MARKER);
  });
});
