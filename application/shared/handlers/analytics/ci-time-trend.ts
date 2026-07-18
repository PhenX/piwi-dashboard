import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsCiTimeTrend } from '../../analytics/types';
import { fetchScopedRuns, firstNonEmptyIndex, makeTimeBuckets, minutes, periodStart, type ProjectAccess } from './common';

/**
 * Total CI minutes consumed by test runs over time, with the previous
 * equal-length period as a growth baseline — the capacity/budget view.
 */
export async function getAnalyticsCiTimeTrend(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsCiTimeTrend> {
  const runs = await fetchScopedRuns(db, scope, access, scope.days * 2);
  const cutoff = periodStart(scope.days);
  const buckets = makeTimeBuckets(scope.days);

  const byBucket = new Map<string, { totalMs: number; runCount: number }>();
  let totalMs = 0;
  let runCount = 0;
  let prevTotalMs = 0;
  let hasPrevious = false;

  for (const run of runs) {
    const durationMs = run.duration ?? 0;
    if (run.startTime.getTime() < cutoff) {
      hasPrevious = true;
      prevTotalMs += durationMs;
      continue;
    }
    totalMs += durationMs;
    runCount++;
    const key = buckets.keyFor(run.startTime);
    if (!key) continue;
    const bucket = byBucket.get(key) ?? { totalMs: 0, runCount: 0 };
    bucket.totalMs += durationMs;
    bucket.runCount++;
    byBucket.set(key, bucket);
  }

  const deltaPct =
    hasPrevious && prevTotalMs > 0 ? Math.round(((totalMs - prevTotalMs) / prevTotalMs) * 1000) / 10 : null;

  const points = buckets.keys.map((date) => {
    const bucket = byBucket.get(date);
    return { date, totalMinutes: minutes(bucket?.totalMs ?? 0), runCount: bucket?.runCount ?? 0 };
  });

  return {
    points: points.slice(firstNonEmptyIndex(points, (p) => p.runCount === 0)),
    bucketDays: buckets.bucketDays,
    totalMinutes: minutes(totalMs),
    runCount,
    prevTotalMinutes: hasPrevious ? minutes(prevTotalMs) : null,
    deltaPct,
    avgRunMinutes: runCount > 0 ? minutes(totalMs / runCount) : null,
  };
}
