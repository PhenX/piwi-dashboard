/**
 * Gather what a reproduction needs from a run and its history, then hand it to
 * the pure generators in `#shared/reproduce`. Lives in `shared/handlers` so the
 * server (the fix plan, the execution endpoint) and the demo mirror compute it
 * the same way — the generators stay pure and testable, this does the reads.
 *
 * The bisect window's `good` end is the last green run before this one on the
 * same branch (falling back to any branch), and its `bad` end is the failing
 * run's own commit. When either commit is missing the bisect degrades to a
 * plain reason, so a demo with no SCM metadata still renders the recipe.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { testCases, testRuns, testRunsCases } from '../../server/database/schema';
import { buildBisectScript, buildReproRecipe, type BisectResult, type ReproRecipe } from '#shared/reproduce';
import { buildRetryCommand, type RetryCase } from '#shared/retry-command';
import type { BrowserConfig } from '#shared/types';
import type { DrizzleDB } from './db';

export interface ReproduceContext {
  reproduce: ReproRecipe;
  bisect: BisectResult;
}

export interface ReproduceInput {
  /** The run whose commit, Playwright version and environment describe the failure. */
  runId: number;
  /** The failing tests, for the exact `playwright test` invocation. */
  cases: RetryCase[];
  /** Browser binary to install (`chromium` / `firefox` / `webkit`). */
  browserName: string | null;
  /** The command that verifies a fix — the `bad`/`good` probe for the bisect. */
  verifyCommand: string;
  /** Base URL the run targeted, when known. */
  baseUrl?: string | null;
}

/** Minimal view of the metadata JSON this reader needs. */
type RunScm = { scm?: { commit?: string | null } | null } | null;

/**
 * Compute the reproduction recipe and the bisect for one run. Always returns a
 * recipe; the bisect is `available: false` when the window cannot be built.
 */
export async function computeReproduceContext(db: DrizzleDB, input: ReproduceInput): Promise<ReproduceContext> {
  const [run] = await db
    .select({
      projectId: testRuns.projectId,
      startTime: testRuns.startTime,
      branch: testRuns.branch,
      environment: testRuns.environment,
      metadata: testRuns.metadata,
      playwrightVersion: testRuns.playwrightVersion,
    })
    .from(testRuns)
    .where(eq(testRuns.id, input.runId));

  const commit = (run?.metadata as RunScm)?.scm?.commit ?? null;

  let lastGreenCommit: string | null = null;
  if (run) {
    lastGreenCommit = await lastGreenCommitBefore(db, run.projectId, run.startTime, run.branch);
  }

  const projectName = input.cases.find((c) => c.projectName)?.projectName ?? null;

  const reproduce = buildReproRecipe({
    commit,
    playwrightVersion: run?.playwrightVersion ?? null,
    browserName: input.browserName,
    projectName,
    environment: run?.environment ?? null,
    baseUrl: input.baseUrl ?? null,
    cases: input.cases,
  });

  const bisect = buildBisectScript({ good: lastGreenCommit, bad: commit, verifyCommand: input.verifyCommand });

  return { reproduce, bisect };
}

/**
 * The reproduction recipe and bisect for a single execution — the version the
 * execution page's Fix card renders. Returns null when the execution is gone.
 */
export async function buildExecutionReproduce(db: DrizzleDB, executionId: number): Promise<ReproduceContext | null> {
  const [row] = await db
    .select({
      testRunId: testRunsCases.testRunId,
      line: testRunsCases.line,
      browser: testRunsCases.browser,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.id, executionId));

  if (!row) return null;

  const browser = row.browser as BrowserConfig | null;
  const cases: RetryCase[] = [
    { filePath: row.filePath, title: row.title, line: row.line, projectName: browser?.projectName ?? null },
  ];
  const verifyCommand = buildRetryCommand(cases, { mode: 'file-line' }) || 'npx playwright test';

  return computeReproduceContext(db, {
    runId: row.testRunId,
    cases,
    browserName: browser?.browserName ?? null,
    verifyCommand,
  });
}

/**
 * The commit of the last green run before `before`, preferring the same branch
 * (a fresh branch's history) and falling back to any branch when it has none.
 */
async function lastGreenCommitBefore(
  db: DrizzleDB,
  projectId: number,
  before: Date,
  branch: string | null,
): Promise<string | null> {
  const pick = async (branchFilter: boolean): Promise<string | null> => {
    const conditions = [
      eq(testRuns.projectId, projectId),
      eq(testRuns.status, 'passed'),
      lt(testRuns.startTime, before),
    ];
    if (branchFilter && branch) conditions.push(eq(testRuns.branch, branch));
    const [green] = await db
      .select({ metadata: testRuns.metadata })
      .from(testRuns)
      .where(and(...conditions))
      .orderBy(desc(testRuns.startTime))
      .limit(1);
    return (green?.metadata as RunScm)?.scm?.commit ?? null;
  };

  const sameBranch = await pick(true);
  if (sameBranch) return sameBranch;
  return branch ? pick(false) : null;
}
