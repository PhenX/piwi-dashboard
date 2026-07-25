/**
 * Post a finished run's verdict back to the pull request that triggered it.
 *
 * This is the one place a run's analysis reaches a developer without them
 * opening the dashboard, so it carries the things only Piwi knows: which
 * failures are *new* versus already broken, the failure clusters behind them,
 * the locator to use instead of the one that broke, and the CI minutes the run
 * wasted.
 *
 * Every step is best-effort. The run is already stored by the time this runs;
 * a missing token, a closed pull request or an SCM outage must never turn into
 * an ingest error, so failures are logged and swallowed.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { failureClusters, projects, testCases, testRuns, testRunsCases } from '../../database/schema';
import { getAppSetting } from '../app-settings';
import { createScmProvider } from './index';
import { normalizeGitUrl } from '../regression-context';
import { getLocatorHealingBatch } from '../locator-healing';
import { resolveOwners } from './ownership';
import { computeRunInsights } from '#shared/handlers/run-insights';
import {
  buildCommitStatus,
  buildPrComment,
  DEFAULT_PR_FEEDBACK,
  PR_COMMENT_MARKER,
  PR_FEEDBACK_KEY,
  resolvePrFeedbackSettings,
  type PrFailureEntry,
  type PrFeedbackSettings,
  type PrSummaryInput,
} from '#shared/pr-feedback';
import type { RunMetadata } from '../run-json-types';
import type { DbClient } from '../../database';

/** Read the resolved settings, falling back to the (disabled) defaults. */
export async function getPrFeedbackSettings(db: DbClient): Promise<PrFeedbackSettings> {
  const stored = await getAppSetting<Partial<PrFeedbackSettings>>(db, PR_FEEDBACK_KEY);
  return stored ? resolvePrFeedbackSettings(stored) : { ...DEFAULT_PR_FEEDBACK };
}

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

/** First line of an error, capped so a comment stays readable. */
function excerpt(error: string | null): string | null {
  if (!error) return null;
  const firstLine = error.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return null;
  const trimmed = firstLine.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

/** What the dashboard is reachable at, for the links inside the comment. */
function resolveSiteUrl(): string | null {
  const configured = process.env.PIWI_SITE_URL?.trim();
  if (!configured) return null;
  return configured.replace(/\/$/, '');
}

interface CaseRow {
  id: number;
  testCaseId: number;
  status: string;
  retries: number | null;
  duration: number | null;
  wastedTimeMs: number | null;
  error: string | null;
  failureClusterId: number | null;
  title: string;
  filePath: string;
  tags: unknown;
  owner: string | null;
}

/**
 * Turn the run's failing executions into comment entries, split by whether the
 * baseline was already failing them. Locator suggestions are resolved in one
 * batch and only for the failures actually listed.
 */
async function buildFailureEntries(
  db: DbClient,
  projectId: number,
  rows: CaseRow[],
  newRegressionIds: Set<number>,
): Promise<{ newRegressions: PrFailureEntry[]; preExisting: PrFailureEntry[] }> {
  const clusterIds = [...new Set(rows.map((r) => r.failureClusterId).filter((id): id is number => id != null))];
  const clusterSignatures = new Map<number, string>();
  if (clusterIds.length > 0) {
    const clusterRows = await db
      .select({ id: failureClusters.id, signature: failureClusters.signature })
      .from(failureClusters)
      .where(inArray(failureClusters.id, clusterIds));
    for (const cluster of clusterRows) clusterSignatures.set(cluster.id, cluster.signature);
  }

  const healing = await getLocatorHealingBatch(
    db,
    rows.map((r) => r.id),
  ).catch(() => new Map());

  // Falls back to CODEOWNERS when a test carries no `piwi:owner`, so a comment
  // can name the owning team on a suite nobody has annotated.
  const owners = await resolveOwners(db, projectId, rows).catch(() => new Map());

  const toEntry = (row: CaseRow): PrFailureEntry => ({
    title: row.title,
    filePath: row.filePath,
    errorExcerpt: excerpt(row.error),
    executionId: row.id,
    clusterId: row.failureClusterId,
    clusterSignature: row.failureClusterId ? (clusterSignatures.get(row.failureClusterId) ?? null) : null,
    suggestedLocator: healing.get(row.id)?.recommendation?.recommended?.locator ?? null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
    owner: owners.get(row)?.owner ?? row.owner,
  });

  const newRegressions: PrFailureEntry[] = [];
  const preExisting: PrFailureEntry[] = [];
  for (const row of rows) {
    (newRegressionIds.has(row.id) ? newRegressions : preExisting).push(toEntry(row));
  }
  return { newRegressions, preExisting };
}

/**
 * Build the summary for a finished run. Exported so the gate endpoint and the
 * tests can read the same numbers the comment shows.
 */
export async function buildRunPrSummary(db: DbClient, runId: number, siteUrl: string): Promise<PrSummaryInput | null> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return null;

  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));
  if (!project) return null;

  const caseRows: CaseRow[] = await db
    .select({
      id: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      duration: testRunsCases.duration,
      wastedTimeMs: testRunsCases.wastedTimeMs,
      error: testRunsCases.error,
      failureClusterId: testRunsCases.failureClusterId,
      title: testCases.title,
      filePath: testCases.filePath,
      tags: testCases.tags,
      owner: testCases.owner,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.testRunId, runId));

  const failingRows = caseRows.filter((row) => FAIL_STATUSES.includes(row.status));
  const flakyRows = caseRows.filter((row) => row.status === 'passed' && (row.retries ?? 0) > 0);

  // `computeRunInsights` owns the baseline comparison; reuse it rather than
  // re-deriving "new versus pre-existing" with a second, divergent rule.
  const insights = await computeRunInsights(db, runId).catch(() => null);
  const newRegressionIds = new Set<number>((insights?.newRegressions ?? []).map((entry) => entry.testRunsCaseId));

  const { newRegressions, preExisting } = await buildFailureEntries(db, run.projectId, failingRows, newRegressionIds);

  const newClusters = await db
    .select({ id: failureClusters.id, signature: failureClusters.signature })
    .from(failureClusters)
    .where(and(eq(failureClusters.firstSeenRunId, runId), eq(failureClusters.projectId, run.projectId)));

  const clusterCaseCounts = new Map<number, number>();
  for (const row of failingRows) {
    if (row.failureClusterId == null) continue;
    clusterCaseCounts.set(row.failureClusterId, (clusterCaseCounts.get(row.failureClusterId) ?? 0) + 1);
  }

  // Wasted CI time, same definition the analytics widget uses: time inside wait
  // steps, plus the whole duration of any attempt that ended failed.
  const wastedTotalMs = caseRows.reduce((total, row) => {
    const waits = row.wastedTimeMs ?? 0;
    const failedAttempt = FAIL_STATUSES.includes(row.status) ? (row.duration ?? 0) : 0;
    return total + waits + failedAttempt;
  }, 0);

  return {
    runId,
    runUrl: `${siteUrl}/test-runs/${runId}`,
    projectName: project.label || project.name,
    status: run.status,
    totalTests: run.totalTests,
    passedTests: run.passedTests,
    failedTests: run.failedTests,
    flakyTests: run.flakyTests,
    durationMs: run.duration ?? null,
    newRegressions,
    preExisting,
    flaky: flakyRows.map((row) => ({
      title: row.title,
      filePath: row.filePath,
      errorExcerpt: null,
      executionId: row.id,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
      owner: row.owner,
    })),
    newClusters: newClusters.map((cluster) => ({
      id: cluster.id,
      signature: cluster.signature,
      caseCount: clusterCaseCounts.get(cluster.id) ?? 0,
    })),
    wastedMinutes: wastedTotalMs > 0 ? wastedTotalMs / 60000 : null,
    hasBaseline: insights?.hasBaseline ?? false,
  };
}

/**
 * Resolve the pull request for a finished run and post the comment and/or the
 * commit status. Returns what it managed to do, for logs and tests.
 */
export async function postRunPrFeedback(
  db: DbClient,
  runId: number,
): Promise<{ posted: boolean; comment: boolean; status: boolean; reason?: string }> {
  const none = (reason: string) => ({ posted: false, comment: false, status: false, reason });

  const settings = await getPrFeedbackSettings(db);
  if (!settings.enabled) return none('disabled');

  const siteUrl = resolveSiteUrl();
  if (!siteUrl) return none('PIWI_SITE_URL is not set, so comment links would be unusable');

  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return none('run not found');

  const meta = (run.metadata as RunMetadata | null) ?? null;
  const branch = meta?.scm?.branch?.trim() || null;
  const commit = meta?.scm?.commit?.trim() || null;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
  if (!repositoryUrl) return none('run has no repository URL in its SCM metadata');
  if (!branch && !commit) return none('run has neither a branch nor a commit');

  const provider = await createScmProvider(repositoryUrl, db, run.projectId);
  if (!provider) return none(`unsupported SCM host for ${repositoryUrl}`);

  const summary = await buildRunPrSummary(db, runId, siteUrl);
  if (!summary) return none('could not build the run summary');

  const quiet = settings.onlyOnFailure && summary.failedTests === 0;

  let commentPosted = false;
  if (settings.comment && branch && !quiet) {
    const pullRequest = await provider.findPullRequestForBranch(branch);
    if (pullRequest) {
      commentPosted = await provider.upsertPullRequestComment(
        pullRequest.number,
        PR_COMMENT_MARKER,
        buildPrComment(summary),
      );
    }
  }

  // A commit status is a state rather than a message, so it is still worth
  // setting on a green run that `onlyOnFailure` silences the comment for.
  let statusPosted = false;
  if (settings.status && commit) {
    statusPosted = await provider.postCommitStatus(commit, buildCommitStatus(summary, settings.statusContext));
  }

  return { posted: commentPosted || statusPosted, comment: commentPosted, status: statusPosted };
}

/** Fire-and-forget wrapper for the run-finalize paths. */
export function postRunPrFeedbackInBackground(db: DbClient, runId: number): void {
  postRunPrFeedback(db, runId)
    .then((result) => {
      if (!result.posted && result.reason && result.reason !== 'disabled') {
        console.warn(`[pr-feedback] nothing posted for run #${runId}: ${result.reason}`);
      }
    })
    .catch((e) => console.error('[pr-feedback] postRunPrFeedback failed', e));
}
