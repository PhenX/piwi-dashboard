/**
 * Quarantine proposals.
 *
 * A quarantine list nobody maintains is a list nobody trusts, so the candidates
 * are derived rather than remembered: the flaky analysis already scores every
 * intermittent test and prices it in wasted CI minutes, and the tests worth
 * quarantining are simply the expensive end of that list.
 *
 * Ranking by wasted CI time rather than by flakiness score is deliberate. A
 * test that flakes constantly but finishes in 200ms costs nothing; one that
 * flakes weekly and burns a four-minute timeout each time is what actually
 * hurts the pipeline.
 */
import { getProjectFlakyTests } from '#shared/handlers/projects';
import type { DbClient } from '../database';

/** Below this, quarantining costs more attention than it saves. */
const MIN_WASTED_CI_MINUTES = 2;
const MIN_FLAKY_SCORE = 40;
const MAX_CANDIDATES = 10;

export interface QuarantineCandidate {
  testCaseId: number;
  title: string;
  filePath: string;
  flakyScore: number;
  wastedCiMinutes: number;
  rootCause: string | null;
  owner: string | null;
  /** Why this test is being proposed, ready to store as the quarantine reason. */
  rationale: string;
}

/**
 * Tests worth quarantining, excluding those already quarantined. Returns an
 * empty list when the project has no flaky history — proposing nothing is the
 * correct answer for a healthy suite.
 */
export async function proposeQuarantineCandidates(
  db: DbClient,
  projectId: number,
  alreadyQuarantined: Set<number>,
): Promise<QuarantineCandidate[]> {
  let flaky: any[] = [];
  try {
    flaky = (await getProjectFlakyTests(db, projectId, 50)) as any[];
  } catch {
    return [];
  }

  return flaky
    .filter(
      (test) =>
        !alreadyQuarantined.has(test.testCaseId) &&
        (test.wastedCiMinutes ?? 0) >= MIN_WASTED_CI_MINUTES &&
        (test.score ?? 0) >= MIN_FLAKY_SCORE,
    )
    .slice(0, MAX_CANDIDATES)
    .map((test) => ({
      testCaseId: test.testCaseId,
      title: test.title,
      filePath: test.filePath,
      flakyScore: test.score,
      wastedCiMinutes: test.wastedCiMinutes ?? 0,
      rootCause: test.rootCause ?? null,
      owner: test.owner ?? null,
      rationale: `Flaky score ${test.score}, wasting ~${(test.wastedCiMinutes ?? 0).toFixed(1)} CI minutes${
        test.rootCause ? ` (${test.rootCause})` : ''
      }`,
    }));
}
