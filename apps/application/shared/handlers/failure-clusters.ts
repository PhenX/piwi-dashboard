import {
  failureClusters,
  failureDiagnoses,
  testRuns,
  testRunsCases,
  testCases,
  projects,
} from '../../server/database/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';

import type { DrizzleDB } from './db';
import { recomputeClusterOccurrences } from './failure-cluster-ops';

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

export async function getFailureCluster(db: DrizzleDB, clusterId: number) {
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const [[countRow], [lastRun], [firstSeenRun], [diag], [project], affectedTestCases] = await Promise.all([
    db
      .select({ affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})` })
      .from(testRunsCases)
      .where(eq(testRunsCases.failureClusterId, clusterId)),

    db
      .select({ status: testRuns.status, startTime: testRuns.startTime })
      .from(testRuns)
      .where(eq(testRuns.id, cluster.lastSeenRunId)),

    db.select({ startTime: testRuns.startTime }).from(testRuns).where(eq(testRuns.id, cluster.firstSeenRunId)),

    db
      .select()
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster'))),

    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(eq(projects.id, cluster.projectId)),

    db
      .select({
        testCaseId: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        runCount: sql<number>`count(${testRunsCases.id})`,
        recentTestRunsCaseId: sql<number>`max(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.failureClusterId, clusterId))
      .groupBy(testCases.id, testCases.title, testCases.filePath)
      .orderBy(desc(sql`count(${testRunsCases.id})`))
      .limit(50),
  ]);

  return {
    ...cluster,
    affectedTests: Number(countRow?.affectedTests ?? 0),
    lastSeenRunStatus: lastRun?.status ?? null,
    lastSeenAt: lastRun?.startTime ?? null,
    firstSeenAt: firstSeenRun?.startTime ?? null,
    diagnosis: diag
      ? {
          status: diag.status,
          category: diag.category,
          confidence: diag.confidence,
          summary: diag.summary,
        }
      : null,
    project: project ?? null,
    affectedTestCases: affectedTestCases.map((t: any) => ({ ...t, runCount: Number(t.runCount) })),
  };
}

export async function getClusterDiagnosis(db: DrizzleDB, clusterId: number) {
  const [diag] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster')));
  const [cluster] = await db
    .select({ manualBaseCommit: failureClusters.manualBaseCommit })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  return {
    diagnosis: diag ?? null,
    manualBaseCommit: cluster?.manualBaseCommit ?? null,
  };
}

/**
 * The stored execution-scoped AI diagnosis for a single test-run case, if any.
 * Mirrors `getClusterDiagnosis` but keyed on the execution instead of a cluster,
 * so the test-run-case page can restore a diagnosis after a reload. Shared by the
 * server endpoint and the demo router so the two never drift.
 */
export async function getExecutionDiagnosis(db: DrizzleDB, testRunsCaseId: number) {
  const [diag] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.testRunsCaseId, testRunsCaseId), eq(failureDiagnoses.scope, 'execution')));
  return { diagnosis: diag ?? null };
}

export async function patchClusterStatus(db: DrizzleDB, clusterId: number, status: string, triageNote?: string | null) {
  if (!status || !VALID_STATUSES.includes(status)) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const note = triageNote ?? null;
  await db
    .update(failureClusters)
    .set({ status, triageNote: note, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  return { success: true, id: clusterId, status, triageNote: note };
}

export async function patchClusterBaseCommit(db: DrizzleDB, clusterId: number, commit?: string | null) {
  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const manualBaseCommit = typeof commit === 'string' && commit.trim() ? commit.trim() : null;
  await db
    .update(failureClusters)
    .set({ manualBaseCommit, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  return { success: true, manualBaseCommit };
}

// NOTE: The demo SCM (commits/branches/commit-diff) and AI-context endpoints used
// to be no-op stubs here. They now have real, data-grounded demo implementations in
// `app/demo/api/scm.ts` and `app/demo/api/diagnosis-context.ts` (kept out of shared/
// so the canned SCM data never leaks into the server bundle).

export async function extractClusterCases(
  db: DrizzleDB,
  clusterId: number,
  testCaseIds: number[],
  triageNote?: string,
) {
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  await db
    .update(testRunsCases)
    .set({ failureClusterId: null })
    .where(and(eq(testRunsCases.failureClusterId, clusterId), inArray(testRunsCases.testCaseId, testCaseIds)));

  const remainingOccurrences = await recomputeClusterOccurrences(db, clusterId);

  if (triageNote !== undefined) {
    await db
      .update(failureClusters)
      .set({ triageNote, updatedAt: new Date() })
      .where(eq(failureClusters.id, clusterId));
  }

  return { success: true, extractedCount: testCaseIds.length, remainingOccurrences };
}
