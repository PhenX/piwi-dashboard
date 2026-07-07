/**
 * Demo-mode SCM endpoints (commit list, commit diff, branches).
 *
 * These mirror the real server endpoints under server/api/failure-clusters/[id]/
 * but read from the canned history in `app/demo/demo-scm.ts` instead of talking to
 * a live GitHub/GitLab provider. They resolve the cluster's project from the demo
 * DB, then look up that project's fake repository.
 *
 * (Demo-only — the server has its own real implementations. Kept out of the shared
 * handlers so the browser bundle never pulls in the canned data on the server.)
 */

import { eq } from 'drizzle-orm';
import { failureClusters } from '../../../server/database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import {
  getDemoScmProject,
  listDemoCommits,
  getDemoCommitDiff,
  getDemoAggregate,
} from '../demo-scm';

async function clusterProjectId(db: DrizzleDB, clusterId: number): Promise<number | null> {
  const [cluster] = await db
    .select({ projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  return cluster?.projectId ?? null;
}

/** GET /api/failure-clusters/:id/commits */
export async function getClusterCommits(db: DrizzleDB, clusterId: number, query?: URLSearchParams) {
  const projectId = await clusterProjectId(db, clusterId);
  const proj = projectId != null ? getDemoScmProject(projectId) : null;
  if (!proj || projectId == null) {
    return { commits: [], repositoryUrl: null, aggregate: null, error: null, hasMore: false };
  }

  const branch = query?.get('branch') || undefined;
  const baseline = query?.get('baseline') || undefined;
  const limit = Math.min(Math.max(parseInt(query?.get('limit') || '50', 10) || 50, 1), 200);

  const commits = listDemoCommits(projectId, limit, branch);
  const aggregate = baseline ? getDemoAggregate(projectId, baseline) : null;

  return {
    commits,
    repositoryUrl: proj.repositoryUrl,
    aggregate,
    error: null,
    hasMore: false,
  };
}

/** GET /api/failure-clusters/:id/branches */
export async function getClusterBranches(db: DrizzleDB, clusterId: number) {
  const projectId = await clusterProjectId(db, clusterId);
  const proj = projectId != null ? getDemoScmProject(projectId) : null;
  return { branches: proj?.branches ?? [] };
}

/** GET /api/failure-clusters/:id/commit-diff?sha= */
export async function getClusterCommitDiff(db: DrizzleDB, clusterId: number, query?: URLSearchParams) {
  const sha = query?.get('sha');
  const projectId = await clusterProjectId(db, clusterId);
  if (!sha || projectId == null) return null;
  return getDemoCommitDiff(projectId, sha);
}
