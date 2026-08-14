import { and, desc, eq, lt } from 'drizzle-orm';
import { testRuns } from '../database/schema';
import type { TestRun } from '../database/schema';
import type { DrizzleDB } from '../../shared/handlers/db';

export interface BaselineQuery {
  projectId: number;
  /** The run whose baseline we want — only strictly-earlier runs qualify. */
  before: Date;
  /** The current run's branch, or null when it is unknown. */
  branch: string | null;
  /** The project's resolved default branch. */
  defaultBranch: string;
  /** Restrict the baseline to full-suite runs (partial/--grep runs skew a diff). */
  fullRunOnly?: boolean;
}

async function firstPassing(db: DrizzleDB, conditions: any[]): Promise<TestRun | null> {
  const [row] = await db
    .select()
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.startTime))
    .limit(1);
  return (row as TestRun | undefined) ?? null;
}

/**
 * The most relevant passing run to compare against, made branch-aware:
 *
 *   1. The most recent passing run **on the same branch** — the branch's own
 *      history, so "new failure" means new relative to this branch.
 *   2. Failing that (a fresh branch, the common case for a new pull request),
 *      the most recent passing run **on the default branch** — the state the
 *      branch forked from.
 *   3. Failing that (a near-empty project with no trunk history yet), the most
 *      recent passing run on **any** branch — today's branch-blind behavior,
 *      preserved so a baseline still exists whenever one exists at all.
 *
 * A run whose branch is unknown keeps today's behavior (step 3 only), so local
 * runs and pre-migration archives compare exactly as before.
 */
export async function selectBaselineRun(db: DrizzleDB, q: BaselineQuery): Promise<TestRun | null> {
  const base: any[] = [
    eq(testRuns.projectId, q.projectId),
    eq(testRuns.status, 'passed'),
    lt(testRuns.startTime, q.before),
  ];
  if (q.fullRunOnly) base.push(eq(testRuns.isFullRun, 1));

  if (!q.branch) return firstPassing(db, base);

  const sameBranch = await firstPassing(db, [...base, eq(testRuns.branch, q.branch)]);
  if (sameBranch) return sameBranch;

  if (q.defaultBranch && q.defaultBranch !== q.branch) {
    const onDefault = await firstPassing(db, [...base, eq(testRuns.branch, q.defaultBranch)]);
    if (onDefault) return onDefault;
  }

  return firstPassing(db, base);
}
