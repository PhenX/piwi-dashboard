import { eq, and, inArray } from 'drizzle-orm';

/** Failures scanned for ownership; well past what any comment or digest lists. */
const OWNER_LOOKUP_LIMIT = 200;
import { projects, testRuns, failureClusters, testRunsCases, testCases } from '../../database/schema';
import { emitNotification } from './emit';
import { buildTopFailures, truncateExcerpt, TOP_FAILURES_LIMIT } from '#shared/notification-events';
import { resolveOwners } from '../scm/ownership';
import type { DbClient } from '../../database';

/**
 * Emit run.finished / run.failed / run.failed.default_branch notifications for a completed run,
 * plus cluster.new for any failure clusters first seen in this run.
 * Call this after the run status is finalized.
 */
export async function emitRunNotifications(db: DbClient, runId: number): Promise<void> {
  try {
    const [runRow] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
    if (!runRow) return;

    const [project] = await db.select().from(projects).where(eq(projects.id, runRow.projectId));
    if (!project) return;

    const meta = (runRow.metadata as Record<string, unknown> | null) ?? {};
    const branch = (meta.branch as string | undefined) || (meta.gitBranch as string | undefined) || undefined;
    const defaultBranch = (meta.defaultBranch as string | undefined) || 'main';
    const isDefaultBranch = branch ? branch === defaultBranch : false;

    // A few failing tests (title + error excerpt + deep-link ids) so a
    // notification carries enough context to start debugging without opening
    // the dashboard first.
    const failedRows = await db
      .select({
        title: testCases.title,
        filePath: testCases.filePath,
        error: testRunsCases.error,
        testCaseId: testRunsCases.testCaseId,
        executionId: testRunsCases.id,
        owner: testCases.owner,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(and(eq(testRunsCases.testRunId, runId), inArray(testRunsCases.status, ['failed', 'timedout'])))
      .limit(OWNER_LOOKUP_LIMIT);

    // The notification still names only the first few failures, but ownership
    // is resolved across all of them — a subscription scoped to one team must
    // not miss a run just because that team's failure ranked seventh.
    const topFailures = buildTopFailures(failedRows.slice(0, TOP_FAILURES_LIMIT));
    const resolvedOwners = await resolveOwners(db, runRow.projectId, failedRows).catch(() => new Map());
    const owners = [
      ...new Set(
        failedRows.map((row) => resolvedOwners.get(row)?.owner).filter((owner): owner is string => Boolean(owner)),
      ),
    ];

    const runPayload = {
      runId,
      projectId: runRow.projectId,
      projectName: project.label || project.name,
      status: runRow.status,
      totalTests: runRow.totalTests,
      failedTests: runRow.failedTests,
      passedTests: runRow.passedTests,
      flakyTests: runRow.flakyTests,
      branch,
      isDefaultBranch,
      topFailures,
      owners,
    };

    await emitNotification(db, 'run.finished', runPayload);

    if (runRow.status === 'failed' || runRow.failedTests > 0) {
      await emitNotification(db, 'run.failed', runPayload);
      if (isDefaultBranch) {
        await emitNotification(db, 'run.failed.default_branch', runPayload);
      }
    }

    // Emit cluster.new for any clusters first seen in this run
    const newClusters = await db
      .select({
        id: failureClusters.id,
        signature: failureClusters.signature,
        sampleError: failureClusters.sampleError,
      })
      .from(failureClusters)
      .where(and(eq(failureClusters.firstSeenRunId, runId), eq(failureClusters.projectId, runRow.projectId)));

    for (const cluster of newClusters) {
      const affected = await db
        .select({ id: testRunsCases.id })
        .from(testRunsCases)
        .where(and(eq(testRunsCases.testRunId, runId), eq(testRunsCases.failureClusterId, cluster.id)));

      await emitNotification(db, 'cluster.new', {
        clusterId: cluster.id,
        projectId: runRow.projectId,
        projectName: project.label || project.name,
        signature: cluster.signature,
        runId,
        sampleErrorExcerpt: truncateExcerpt(cluster.sampleError),
        affectedCases: affected.length,
      });
    }
  } catch (e) {
    console.error('[notifications] emitRunNotifications error', e);
  }
}
