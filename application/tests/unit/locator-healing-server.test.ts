import { describe, test, expect } from 'vitest';
import { extractErrorLocation, parseFailingSourceLine } from '~~/server/utils/locator-healing';

/**
 * Pure server-side helpers behind the locator-healing lookup: the failing call
 * site extracted from an error stack, and the failing source line pulled from
 * the reporter's captured `testSource` snippet.
 */

describe('extractErrorLocation', () => {
  test('returns the first app frame, skipping node internals and node_modules', () => {
    const err = [
      'Error: locator not found',
      '    at Object.<anonymous> (node:internal/foo:1:1)',
      '    at Proxy._expect (/repo/node_modules/@playwright/test/lib/x.js:10:5)',
      '    at /repo/tests/checkout.spec.ts:42:15',
    ].join('\n');
    expect(extractErrorLocation(err)).toBe('/repo/tests/checkout.spec.ts:42:15');
  });

  test('handles named frames and normalizes backslashes', () => {
    const err = '    at Object.run (C:\\proj\\tests\\a.spec.ts:7:3)';
    expect(extractErrorLocation(err)).toBe('C:/proj/tests/a.spec.ts:7:3');
  });

  test('returns null when no app frame is present', () => {
    expect(extractErrorLocation('Error: boom\n    at node:internal/x:1:1')).toBeNull();
  });
});

describe('parseFailingSourceLine', () => {
  // The reporter formats each line as `<marker><padded no> | <code>`, marking
  // the failing line with `> ` (reporter source-snippet.ts).
  const snippet = [
    '   40 |   await page.goto("/checkout");',
    '   41 |',
    '>  42 |   await page.getByRole("button", { name: "Pay" }).click();',
    '   43 | });',
  ].join('\n');

  test('returns the > marked failing line and its code', () => {
    expect(parseFailingSourceLine(snippet, null)).toEqual({
      line: 42,
      text: '  await page.getByRole("button", { name: "Pay" }).click();',
    });
  });

  test('falls back to the line matching the error location when unmarked', () => {
    const unmarked = ['   40 |   a();', '   41 |   b();', '   42 |   c();'].join('\n');
    expect(parseFailingSourceLine(unmarked, '/repo/x.spec.ts:41:5')).toEqual({ line: 41, text: '  b();' });
  });

  test('preserves pipes inside the code after the separator', () => {
    expect(parseFailingSourceLine('>  9 |   const x = a || b;', null)).toEqual({
      line: 9,
      text: '  const x = a || b;',
    });
  });

  test('returns null for empty input or when nothing matches', () => {
    expect(parseFailingSourceLine(null, null)).toBeNull();
    expect(parseFailingSourceLine('no line markers here', null)).toBeNull();
    expect(parseFailingSourceLine('   40 |   a();', '/repo/x.spec.ts:99:1')).toBeNull();
  });
});
