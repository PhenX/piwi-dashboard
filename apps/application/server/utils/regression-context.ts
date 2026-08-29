import { eq } from 'drizzle-orm';
import { projects, testRunsCases } from '../database/schema';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';
import { buildCompareUrl, computeMetadataDiff, type MetaDiffEntry } from '#shared/utils/run-metadata';
import { FAILED_STATUS_KEYS } from '#shared/utils/test-counts';
import { normalizeGitUrl } from './scm/git-url';
import { resolveRunBranch } from './run-branch';
import { resolveDefaultBranch } from './scm/default-branch';
import { FALLBACK_DEFAULT_BRANCH } from './scm/git-url';
import { selectBaselineRun } from './branch-baseline';

export interface RunForRegression {
  id: number;
  projectId: number;
  status: string;
  startTime: Date;
  environment: string | null;
  metadata: unknown;
}

export type RegressionContextResult =
  | { hasGreen: false }
  | {
      hasGreen: true;
      lastGreenRunId: number;
      lastGreenRunAt: Date;
      lastGreenCommit: string | null;
      lastGreenBranch: string | null;
      currentCommit: string | null;
      currentBranch: string | null;
      commitRange: {
        fromSha: string;
        toSha: string;
        fromShort: string;
        toShort: string;
        repositoryUrl: string | null;
        compareUrl: string | null;
        gitCommand: string;
      } | null;
      metadataDiff: MetaDiffEntry[];
      newFailures: number;
    };

const FAIL_STATUSES = new Set<string>(FAILED_STATUS_KEYS);

export async function computeRegressionContext(db: DbClient, run: RunForRegression): Promise<RegressionContextResult> {
  // Prefer the last green run on this run's own branch, falling back to the
  // default branch (what a fresh branch forked from), so "what changed since
  // last green" is a diff within one line of history, not across unrelated ones.
  const branch = resolveRunBranch(run.metadata);
  const [project] = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, run.projectId));
  const defaultBranch = project ? await resolveDefaultBranch(db, project, run.metadata) : FALLBACK_DEFAULT_BRANCH;

  const lastGreen = await selectBaselineRun(db, {
    projectId: run.projectId,
    before: run.startTime,
    branch,
    defaultBranch,
  });
  if (!lastGreen) return { hasGreen: false };

  const currMeta = run.metadata as RunMetadata | null;
  const greenMeta = lastGreen.metadata as RunMetadata | null;
  const currentCommit: string | null = currMeta?.scm?.commit ?? null;
  const lastGreenCommit: string | null = greenMeta?.scm?.commit ?? null;
  const remoteUrl: string | null = currMeta?.scm?.remoteUrl ?? greenMeta?.scm?.remoteUrl ?? null;

  const repositoryUrl = normalizeGitUrl(remoteUrl);

  let commitRange = null;
  if (currentCommit && lastGreenCommit && currentCommit !== lastGreenCommit) {
    const compareUrl = repositoryUrl ? buildCompareUrl(repositoryUrl, lastGreenCommit, currentCommit) : null;
    commitRange = {
      fromSha: lastGreenCommit,
      toSha: currentCommit,
      fromShort: lastGreenCommit.slice(0, 7),
      toShort: currentCommit.slice(0, 7),
      repositoryUrl,
      compareUrl,
      gitCommand: `git log --oneline ${lastGreenCommit}..${currentCommit}`,
    };
  }

  const metadataDiff = computeMetadataDiff(greenMeta, currMeta, lastGreen.environment, run.environment);

  const [greenCases, currentCases] = await Promise.all([
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, lastGreen.id)),
    db
      .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, run.id)),
  ]);

  const greenBestStatus = new Map<number, string>();
  for (const c of greenCases) {
    if (!greenBestStatus.has(c.testCaseId) || c.status === 'passed') {
      greenBestStatus.set(c.testCaseId, c.status);
    }
  }

  const currentWorstStatus = new Map<number, string>();
  for (const c of currentCases) {
    const existing = currentWorstStatus.get(c.testCaseId);
    if (!existing || (FAIL_STATUSES.has(c.status) && !FAIL_STATUSES.has(existing))) {
      currentWorstStatus.set(c.testCaseId, c.status);
    }
  }

  let newFailures = 0;
  for (const [tcId, status] of currentWorstStatus) {
    if (FAIL_STATUSES.has(status) && greenBestStatus.get(tcId) === 'passed') newFailures++;
  }

  return {
    hasGreen: true,
    lastGreenRunId: lastGreen.id,
    lastGreenRunAt: lastGreen.startTime,
    lastGreenCommit,
    lastGreenBranch: greenMeta?.scm?.branch ?? null,
    currentCommit,
    currentBranch: currMeta?.scm?.branch ?? null,
    commitRange,
    metadataDiff,
    newFailures,
  };
}
