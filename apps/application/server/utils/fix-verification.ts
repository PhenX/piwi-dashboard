/**
 * Fix verification — closing the loop on "did my fix work?".
 *
 * Piwi already knows a cluster's failing tests, its diagnosis, the files the
 * suggested patch touches, and the last commit it failed at. Until now nothing
 * consumed that afterwards: a cluster went quiet and stayed open forever.
 *
 * After every run this asks two questions about each cluster:
 *
 * - **Did it stop failing?** Every test the cluster covers ran in this run and
 *   passed. That records a fix landing, with the commit and the time it took.
 * - **Did the diagnosis predict it?** The commits between the last failing run
 *   and this one touch a file the suggested patch named. That upgrades the
 *   verdict from "stopped failing" (which a flaky test does by accident) to
 *   "the change we pointed at is the change that fixed it".
 *
 * And one more, in the other direction: a cluster that had a fix recorded and
 * is failing again is marked `regressed`, because a fix that did not hold is
 * worth more than no record at all.
 *
 * Every step is best-effort — the run is already stored, and SCM being
 * unreachable must never turn into an ingest error.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { failureClusters, failureDiagnoses, testRuns, testRunsCases } from '../database/schema';
import { createScmProvider } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { parseUnifiedDiff, stripAbPrefix } from '#shared/patch';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

/** How a cluster's fix was corroborated. */
export type FixVerification = 'stopped-failing' | 'diagnosis-verified' | 'regressed';

/** One cluster whose fix landed in the run just processed. */
export interface VerifiedFix {
  clusterId: number;
  signature: string;
  title: string | null;
  verification: Exclude<FixVerification, 'regressed'>;
  timeToResolutionMs: number | null;
  /** Tests that were failing and now pass. */
  testCount: number;
}

/** The files a cluster's completed diagnosis proposed changing, if any. */
async function diagnosedFiles(db: DbClient, clusterId: number): Promise<string[]> {
  const rows = await db
    .select({ details: failureDiagnoses.details })
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.status, 'completed')))
    .limit(5);

  const files = new Set<string>();
  for (const row of rows) {
    const details = row.details as { suggestedFix?: { patch?: unknown } } | null;
    const patch = details?.suggestedFix?.patch;
    if (typeof patch !== 'string' || !patch.trim()) continue;
    for (const file of parseUnifiedDiff(patch).files) {
      const path = stripAbPrefix(file.newPath) ?? stripAbPrefix(file.oldPath);
      if (path) files.add(path);
    }
  }
  return [...files];
}

/**
 * True when the commits between `fromSha` and `toSha` touch any of `paths`.
 * Returns false on any failure, which downgrades the verdict to
 * "stopped-failing" rather than claiming a verification we could not make.
 */
async function changeTouchedFiles(
  db: DbClient,
  projectId: number,
  repositoryUrl: string,
  fromSha: string,
  toSha: string,
  paths: string[],
): Promise<boolean> {
  if (paths.length === 0 || fromSha === toSha) return false;
  try {
    const provider = await createScmProvider(repositoryUrl, db, projectId);
    if (!provider) return false;
    const changes = await provider.fetchChanges(fromSha, toSha);
    if (!changes?.files?.length) return false;

    const changed = new Set(changes.files.map((file) => file.filename));
    // Compare on suffixes too: the reporter records repo-relative paths, but a
    // monorepo diagnosis may name a path relative to a package root.
    return paths.some((path) => {
      for (const candidate of changed) {
        if (candidate === path || candidate.endsWith(`/${path}`) || path.endsWith(`/${candidate}`)) return true;
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * Record fixes and regressions for one finished run. Returns the fixes that
 * landed, so the pull-request comment can report them.
 */
export async function verifyClusterFixes(db: DbClient, runId: number): Promise<VerifiedFix[]> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return [];

  // A partial run proves nothing: a test that did not execute has not been
  // shown to pass, and treating silence as success would close clusters that
  // are still broken.
  if (run.isFullRun === 0) return [];

  const meta = (run.metadata as RunMetadata | null) ?? null;
  const currentCommit = meta?.scm?.commit ?? null;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);

  // What this run saw, per test case: any pass, and any failure.
  const caseRows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      clusterId: testRunsCases.failureClusterId,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));

  const passedCaseIds = new Set<number>();
  const executedCaseIds = new Set<number>();
  const clustersSeenNow = new Set<number>();
  for (const row of caseRows) {
    executedCaseIds.add(row.testCaseId);
    if (row.status === 'passed') passedCaseIds.add(row.testCaseId);
    if (row.clusterId != null && FAIL_STATUSES.includes(row.status)) clustersSeenNow.add(row.clusterId);
  }

  // ── Regressions: a recorded fix that did not hold ─────────────────────────
  if (clustersSeenNow.size > 0) {
    await db
      .update(failureClusters)
      .set({ fixVerification: 'regressed', updatedAt: new Date() })
      .where(
        and(
          inArray(failureClusters.id, [...clustersSeenNow]),
          isNotNull(failureClusters.fixLandedRunId),
          ne(failureClusters.fixVerification, 'regressed'),
        ),
      );
  }

  // ── Candidates: clusters that were failing and are quiet in this run ──────
  const candidates = await db
    .select({
      id: failureClusters.id,
      signature: failureClusters.signature,
      title: failureClusters.title,
      createdAt: failureClusters.createdAt,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
      status: failureClusters.status,
    })
    .from(failureClusters)
    .where(
      and(
        eq(failureClusters.projectId, run.projectId),
        ne(failureClusters.lastSeenRunId, runId),
        or(isNull(failureClusters.fixLandedRunId), eq(failureClusters.fixVerification, 'regressed')),
      ),
    );

  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((cluster) => cluster.id);
  const affected = await db
    .select({ clusterId: testRunsCases.failureClusterId, testCaseId: testRunsCases.testCaseId })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, candidateIds));

  const casesByCluster = new Map<number, Set<number>>();
  for (const row of affected) {
    if (row.clusterId == null) continue;
    let set = casesByCluster.get(row.clusterId);
    if (!set) casesByCluster.set(row.clusterId, (set = new Set()));
    set.add(row.testCaseId);
  }

  // The commit the cluster last failed at — the "from" end of the diff that
  // supposedly fixed it.
  const referencedRunIds = [...new Set(candidates.flatMap((c) => [c.lastSeenRunId, c.firstSeenRunId]))];
  const referencedRuns = referencedRunIds.length
    ? await db
        .select({ id: testRuns.id, metadata: testRuns.metadata, startTime: testRuns.startTime })
        .from(testRuns)
        .where(inArray(testRuns.id, referencedRunIds))
    : [];
  const commitByRunId = new Map<number, string | null>(
    referencedRuns.map((row) => [row.id, ((row.metadata as RunMetadata | null)?.scm?.commit ?? null) as string | null]),
  );
  const startTimeByRunId = new Map<number, Date | null>(
    referencedRuns.map((row) => [row.id, row.startTime instanceof Date ? row.startTime : null]),
  );

  const fixed: VerifiedFix[] = [];

  for (const cluster of candidates) {
    const clusterCases = casesByCluster.get(cluster.id);
    if (!clusterCases || clusterCases.size === 0) continue;

    // Every affected test must have run here and passed. One unexecuted test
    // is enough to say nothing.
    let allGreen = true;
    for (const caseId of clusterCases) {
      if (!executedCaseIds.has(caseId) || !passedCaseIds.has(caseId)) {
        allGreen = false;
        break;
      }
    }
    if (!allGreen) continue;

    let verification: VerifiedFix['verification'] = 'stopped-failing';
    const fromCommit = commitByRunId.get(cluster.lastSeenRunId) ?? null;
    if (repositoryUrl && fromCommit && currentCommit) {
      const files = await diagnosedFiles(db, cluster.id);
      if (await changeTouchedFiles(db, run.projectId, repositoryUrl, fromCommit, currentCommit, files)) {
        verification = 'diagnosis-verified';
      }
    }

    // Both ends are run start times, so the number means "how long the suite
    // was broken" rather than mixing a wall-clock row timestamp with a reported
    // run time — which goes negative the moment runs are backfilled or imported.
    // The cluster's own createdAt is the fallback, since runs are deleted
    // independently and clusters outlive them.
    const landedAt = run.startTime instanceof Date ? run.startTime : new Date();
    const brokeAt =
      startTimeByRunId.get(cluster.firstSeenRunId) ?? (cluster.createdAt instanceof Date ? cluster.createdAt : null);
    const timeToResolutionMs = brokeAt ? Math.max(0, landedAt.getTime() - brokeAt.getTime()) : null;

    await db
      .update(failureClusters)
      .set({
        fixLandedRunId: runId,
        fixLandedAt: landedAt,
        fixCommit: currentCommit,
        timeToResolutionMs,
        fixVerification: verification,
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, cluster.id));

    fixed.push({
      clusterId: cluster.id,
      signature: cluster.signature,
      title: cluster.title,
      verification,
      timeToResolutionMs,
      testCount: clusterCases.size,
    });
  }

  return fixed;
}
