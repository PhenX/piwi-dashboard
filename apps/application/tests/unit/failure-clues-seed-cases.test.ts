import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { buildFailureClues, type FailureClue, type FailureClueInput } from '#shared/failure-clues';

/**
 * A frozen baseline of the ordered clue ranking for four seeded executions. The
 * inputs are captured verbatim from the seeded dev database (`loadFailureClueInput`
 * on `/api/test-run-cases/:id/clues`) and committed under `fixtures/`, so the
 * test runs the real `buildFailureClues` against real evidence with no database.
 * The expected `(rule, strength)` pairs are written out literally: a change to
 * the ranking rules surfaces here as a readable diff of what each failure now
 * says on its first screen.
 */

function loadInput(executionId: number): FailureClueInput {
  const path = fileURLToPath(new URL(`./fixtures/failure-clues/exec-${executionId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FailureClueInput;
}

/** The ranked clue output reduced to the two fields the baseline pins. */
function ranking(clues: FailureClue[]): Array<[string, string]> {
  return clues.map((clue) => [clue.rule, clue.strength]);
}

describe('buildFailureClues — seeded failure ranking baseline', () => {
  test('#37 — checkout, Pay click timeout', () => {
    expect(ranking(buildFailureClues(loadInput(37)))).toEqual([
      ['page-structure-changed', 'strong'],
      ['element-present-but-blocked', 'strong'],
      ['console-mentions-target', 'medium'],
      ['slow-request-overlapping-failure', 'medium'],
      ['fixed-before', 'weak'],
    ]);
  });

  test('#13 — same cluster, earlier run', () => {
    expect(ranking(buildFailureClues(loadInput(13)))).toEqual([
      ['page-structure-changed', 'strong'],
      ['element-present-but-blocked', 'strong'],
      ['console-mentions-target', 'medium'],
      ['slow-request-overlapping-failure', 'medium'],
      ['environment-changed', 'medium'],
      ['fixed-before', 'weak'],
    ]);
  });

  test("#781 — cluster #10's latest occurrence, toHaveCount on getByRole('row')", () => {
    expect(ranking(buildFailureClues(loadInput(781)))).toEqual([['environment-changed', 'medium']]);
  });

  test("#587 — cluster #5's latest occurrence, .modal.is-open timeout", () => {
    expect(ranking(buildFailureClues(loadInput(587)))).toEqual([]);
  });
});
