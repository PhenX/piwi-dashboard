import { describe, test, expect } from 'vitest';
import { textSimilarity, parseAriaCandidates } from '#shared/locator-fingerprint';
// Imported from the reporter's *source* (vitest transpiles it), not dist/ —
// `npm run app:test:unit` must pass without a prior `npm run reporter:build`.
import { nameSimilarity, parseAriaRoleName } from '../../../reporter/src/internal/capture/locator-healing';

/**
 * Drift guard: the reporter package publishes standalone to npm and cannot
 * import application/shared, so it hand-mirrors two pure helpers. These tests
 * feed both implementations the same fixtures and require identical output —
 * silent drift (which has bitten this pairing before) becomes a red test.
 */

describe('reporter ↔ shared drift guard', () => {
  const SIMILARITY_FIXTURES: Array<[string | null, string | null]> = [
    ['Go to page', 'Open page'],
    ['Submit order', 'Submit order'],
    ['Submit', 'Cancel'],
    ['', ''],
    [null, 'Delete'],
    ['Delete', null],
    ['  Mixed-CASE, punctuation!  ', 'mixed case punctuation'],
    ['one two three', 'three two one'],
    ['a1 b2', 'a1 c3'],
  ];

  test('nameSimilarity (reporter) matches textSimilarity (shared) on all fixtures', () => {
    for (const [a, b] of SIMILARITY_FIXTURES) {
      expect(nameSimilarity(a, b), `similarity("${a}", "${b}")`).toBe(textSimilarity(a, b));
    }
  });

  const ARIA_FIXTURES = [
    '- button "Open page"\n- heading "Welcome" [level=1]\n- textbox "Email"\n- generic',
    '- list\n  - listitem "First"\n  - listitem "Second"',
    '- group\n- paragraph\n- link "Docs \\"quoted\\""',
    '',
    '- button\n- checkbox "Remember me" [checked]',
  ];

  test('parseAriaRoleName (reporter) matches parseAriaCandidates (shared) on all fixtures', () => {
    for (const snapshot of ARIA_FIXTURES) {
      expect(parseAriaRoleName(snapshot), `parse(${JSON.stringify(snapshot)})`).toEqual(parseAriaCandidates(snapshot));
    }
  });
});
