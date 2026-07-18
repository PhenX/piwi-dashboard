import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsHeatmap } from '../../analytics/types';
import {
  fetchScopedProjects,
  fetchScopedRuns,
  firstNonEmptyIndex,
  makeTimeBuckets,
  roundRate,
  type ProjectAccess,
} from './common';

/**
 * Projects × time-buckets grid of pass rates — shows at a glance who degraded
 * and when. Buckets grow with the period (daily up to a month, weekly beyond)
 * so the grid stays readable.
 */
export async function getAnalyticsPassRateHeatmap(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsHeatmap> {
  const scopedProjects = await fetchScopedProjects(db, scope, access);
  const runs = await fetchScopedRuns(db, scope, access, scope.days);
  const buckets = makeTimeBuckets(scope.days);

  // passed/total per (project, bucket)
  const totals = new Map<number, Map<string, { passed: number; total: number }>>();
  for (const run of runs) {
    const key = buckets.keyFor(run.startTime);
    if (!key) continue;
    let byBucket = totals.get(run.projectId);
    if (!byBucket) {
      byBucket = new Map();
      totals.set(run.projectId, byBucket);
    }
    const cell = byBucket.get(key) ?? { passed: 0, total: 0 };
    cell.passed += run.passedTests ?? 0;
    cell.total += run.totalTests ?? 0;
    byBucket.set(key, cell);
  }

  const rows = scopedProjects
    .map((project) => {
      const byBucket = totals.get(project.id);
      return {
        projectId: project.id,
        name: project.name,
        label: project.label,
        cells: buckets.keys.map((key) => {
          const cell = byBucket?.get(key);
          return cell ? roundRate(cell.passed, cell.total) : null;
        }),
      };
    })
    // Projects with no runs in the period would render an all-gray row — drop them.
    .filter((row) => row.cells.some((c) => c !== null))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Trim leading all-empty columns so "All time" starts at the first real data.
  const firstDataIndex = firstNonEmptyIndex(
    buckets.keys.map((_, index) => index),
    (index) => rows.every((row) => row.cells[index] === null),
  );

  return {
    buckets: buckets.keys.slice(firstDataIndex),
    bucketDays: buckets.bucketDays,
    rows: rows.map((row) => ({ ...row, cells: row.cells.slice(firstDataIndex) })),
  };
}
