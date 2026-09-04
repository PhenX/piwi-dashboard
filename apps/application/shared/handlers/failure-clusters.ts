import {
  failureClusters,
  failureDiagnoses,
  testRuns,
  testRunsCases,
  testCases,
  projects,
  entityLinks,
} from '../../server/database/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';

import type { DrizzleDB } from './db';
import type { OpenFailureCluster } from '../../types/api';
import { recomputeClusterOccurrences } from './failure-cluster-ops';
import { getQuarantinedCaseIds } from './quarantine';

type ProjectScope = 'all' | Set<number>;

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
        owner: testCases.owner,
        runCount: sql<number>`count(${testRunsCases.id})`,
        recentTestRunsCaseId: sql<number>`max(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.failureClusterId, clusterId))
      .groupBy(testCases.id, testCases.title, testCases.filePath, testCases.owner)
      .orderBy(desc(sql`count(${testRunsCases.id})`))
      .limit(50),
  ]);

  // Which affected tests are currently quarantined — drives the "Quarantined"
  // chip and the per-test / "Quarantine all affected" actions on the page.
  const quarantinedIds = await getQuarantinedCaseIds(db, cluster.projectId);

  // Known-issue links pinned to this cluster (Jira / GitHub issue, etc.).
  const links = await db.select().from(entityLinks).where(eq(entityLinks.failureClusterId, clusterId));

  // The cluster's owner from the representative test's `piwi:owner` annotation
  // (the most-affected test wins). The server route layers CODEOWNERS on top when
  // no annotation exists, the same as the execution page's verdict owner.
  const annotationOwner = (affectedTestCases[0] as { owner?: string | null } | undefined)?.owner ?? null;
  const owner = annotationOwner
    ? { name: annotationOwner, source: 'annotation' as const }
    : (null as { name: string; source: 'annotation' | 'codeowners' } | null);

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
    affectedTestCases: affectedTestCases.map((t: any) => ({
      testCaseId: t.testCaseId,
      title: t.title,
      filePath: t.filePath,
      runCount: Number(t.runCount),
      recentTestRunsCaseId: t.recentTestRunsCaseId,
      quarantined: quarantinedIds.has(t.testCaseId),
    })),
    links,
    owner,
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

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
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

  const [updated] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  return { success: true, cluster: updated };
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

/**
 * Open failure clusters across every project the caller can see, newest first
 * by last seen — the Home "Open failures" card. Each row carries what the card
 * shows: the fields `describeCluster` names a cluster from, the owning project,
 * the affected-test count, when it was last seen, the annotation owner when one
 * exists (the most-affected test wins, mirroring `getFailureCluster`) and the
 * pinned known-issue link when one is set.
 */
export async function getOpenFailureClusters(
  db: DrizzleDB,
  scope: ProjectScope = 'all',
  limit = 50,
): Promise<OpenFailureCluster[]> {
  const allowed = scope === 'all' ? 'all' : [...scope];
  if (allowed !== 'all' && allowed.length === 0) return [];

  const where =
    allowed === 'all'
      ? eq(failureClusters.status, 'open')
      : and(eq(failureClusters.status, 'open'), inArray(failureClusters.projectId, allowed));

  const clusters: any[] = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      title: failureClusters.title,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      sampleError: failureClusters.sampleError,
      status: failureClusters.status,
      lastSeenRunId: failureClusters.lastSeenRunId,
      occurrences: failureClusters.occurrences,
    })
    .from(failureClusters)
    .where(where)
    .orderBy(desc(failureClusters.lastSeenRunId))
    .limit(Math.min(200, Math.max(1, limit)));

  if (clusters.length === 0) return [];

  const clusterIds: number[] = clusters.map((c) => c.id);
  const projectIds: number[] = [...new Set(clusters.map((c) => c.projectId))];
  const lastSeenRunIds: number[] = [...new Set(clusters.map((c) => c.lastSeenRunId))];

  const [projectRows, counts, lastSeenRuns, ownerRows, linkRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(inArray(projects.id, projectIds)),

    db
      .select({
        clusterId: testRunsCases.failureClusterId,
        affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
      })
      .from(testRunsCases)
      .where(inArray(testRunsCases.failureClusterId, clusterIds))
      .groupBy(testRunsCases.failureClusterId),

    db
      .select({ id: testRuns.id, status: testRuns.status, startTime: testRuns.startTime })
      .from(testRuns)
      .where(inArray(testRuns.id, lastSeenRunIds)),

    // One row per (cluster, test): the most-affected test names the cluster when
    // the sample error has no frame and supplies the `piwi:owner` annotation.
    db
      .select({
        clusterId: testRunsCases.failureClusterId,
        filePath: testCases.filePath,
        owner: testCases.owner,
        runCount: sql<number>`count(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(inArray(testRunsCases.failureClusterId, clusterIds))
      .groupBy(testRunsCases.failureClusterId, testCases.id, testCases.filePath, testCases.owner),

    db
      .select({
        clusterId: entityLinks.failureClusterId,
        url: entityLinks.url,
        provider: entityLinks.provider,
        key: entityLinks.key,
      })
      .from(entityLinks)
      .where(inArray(entityLinks.failureClusterId, clusterIds))
      .orderBy(desc(entityLinks.id)),
  ]);

  const projectById = new Map(projectRows.map((p: any) => [p.id, p]));
  const affectedById = new Map(counts.map((c: any) => [c.clusterId, Number(c.affectedTests)]));
  const runById = new Map(lastSeenRuns.map((r: any) => [r.id, { status: r.status, startTime: r.startTime }]));

  // Keep the most-affected test per cluster for the name fallback and owner.
  const repByCluster = new Map<number, { filePath: string | null; owner: string | null; runCount: number }>();
  for (const row of ownerRows as any[]) {
    const prev = repByCluster.get(row.clusterId);
    if (!prev || Number(row.runCount) > prev.runCount) {
      repByCluster.set(row.clusterId, {
        filePath: row.filePath ?? null,
        owner: row.owner ?? null,
        runCount: Number(row.runCount),
      });
    }
  }

  // Newest known-issue link wins (rows come back id-descending).
  const issueByCluster = new Map<number, { url: string; provider: string; key: string | null }>();
  for (const row of linkRows as any[]) {
    if (row.clusterId != null && !issueByCluster.has(row.clusterId)) {
      issueByCluster.set(row.clusterId, { url: row.url, provider: row.provider, key: row.key ?? null });
    }
  }

  return clusters.map((c): OpenFailureCluster => {
    const project = projectById.get(c.projectId);
    const run = runById.get(c.lastSeenRunId) as { status: string; startTime: Date } | undefined;
    const rep = repByCluster.get(c.id);
    return {
      id: c.id,
      projectId: c.projectId,
      projectName: project?.name ?? `Project ${c.projectId}`,
      projectLabel: project?.label ?? null,
      title: c.title ?? null,
      signature: c.signature,
      errorType: c.errorType ?? null,
      selector: c.selector ?? null,
      sampleError: c.sampleError ?? null,
      filePath: rep?.filePath ?? null,
      status: c.status,
      affectedTests: affectedById.get(c.id) ?? 0,
      occurrences: c.occurrences ?? 0,
      lastSeenAt: run?.startTime ?? null,
      lastSeenRunStatus: run?.status ?? null,
      owner: rep?.owner ? { name: rep.owner, source: 'annotation' } : null,
      issueLink: issueByCluster.get(c.id) ?? null,
    };
  });
}
