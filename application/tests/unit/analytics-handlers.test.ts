import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel (server/database/schema.ts) picks the PostgreSQL schema at
// import time when PIWI_DATABASE_URL is set, so clear it before the handler
// modules (which import the barrel) are loaded.
delete process.env.PIWI_DATABASE_URL;
const { runAnalyticsWidget, isAnalyticsWidgetId } = await import('../../shared/handlers/analytics');
const { getAnalyticsPortfolio } = await import('../../shared/handlers/analytics/portfolio');
const { getAnalyticsPassRateHeatmap } = await import('../../shared/handlers/analytics/pass-rate-heatmap');
const { getAnalyticsCiTimeTrend } = await import('../../shared/handlers/analytics/ci-time-trend');
const { getAnalyticsWastedTime } = await import('../../shared/handlers/analytics/wasted-time');
const { getAnalyticsClusterLandscape } = await import('../../shared/handlers/analytics/cluster-landscape');
const { evaluateInsightRules } = await import('../../shared/analytics/insight-rules');
const { parseAnalyticsScope } = await import('../../shared/analytics/scope');
const { ANALYTICS_WIDGETS } = await import('../../shared/analytics/registry');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

let db: ReturnType<typeof drizzle<typeof schema>>;

interface RunSeed {
  projectId: number;
  status?: string;
  daysAgo: number;
  duration?: number;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  flakyTests?: number;
  isFullRun?: number;
  environment?: string;
}

async function seedRun(seed: RunSeed): Promise<number> {
  const inserted = await db
    .insert(schema.testRuns)
    .values({
      projectId: seed.projectId,
      status: seed.status ?? 'passed',
      startTime: daysAgo(seed.daysAgo),
      duration: seed.duration ?? 60_000,
      totalTests: seed.totalTests ?? 10,
      passedTests: seed.passedTests ?? 10,
      failedTests: seed.failedTests ?? 0,
      flakyTests: seed.flakyTests ?? 0,
      isFullRun: seed.isFullRun ?? 1,
      environment: seed.environment,
    })
    .returning({ id: schema.testRuns.id });
  return inserted[0]!.id;
}

const DEFAULT_SCOPE = parseAnalyticsScope({ days: '30' });

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });

  await db.insert(schema.projects).values([
    { id: 1, name: 'checkout' },
    { id: 2, name: 'search', label: 'Search suite' },
    { id: 3, name: 'idle-project' },
  ]);

  // Project 1: previous period healthy (100%), current period degraded and
  // ending on a 3-run failing streak.
  await seedRun({ projectId: 1, daysAgo: 45, passedTests: 10 });
  await seedRun({ projectId: 1, daysAgo: 40, passedTests: 10 });
  await seedRun({ projectId: 1, daysAgo: 10, passedTests: 8, failedTests: 2, status: 'failed' });
  const failingRunId = await seedRun({ projectId: 1, daysAgo: 5, passedTests: 7, failedTests: 3, status: 'failed' });
  await seedRun({ projectId: 1, daysAgo: 2, passedTests: 7, failedTests: 3, status: 'failed' });

  // Project 2: healthy in the current period, staging environment, one flaky run.
  await seedRun({ projectId: 2, daysAgo: 8, environment: 'staging', flakyTests: 2 });
  await seedRun({ projectId: 2, daysAgo: 3, environment: 'staging' });
  // Partial run — must be excluded when fullRunsOnly (the default).
  await seedRun({ projectId: 2, daysAgo: 1, isFullRun: 0, passedTests: 1, totalTests: 1 });
  // Non-terminal run — never counted.
  await seedRun({ projectId: 2, daysAgo: 1, status: 'running' });

  // Wasted time on project 1's latest failing run.
  await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'checkout.spec.ts', title: 'pays' });
  await db.insert(schema.testRunsCases).values([
    { testRunId: failingRunId, testCaseId: 1, status: 'failed', duration: 120_000, wastedTimeMs: 60_000 },
    { testRunId: failingRunId, testCaseId: 1, status: 'passed', duration: 30_000, retries: 1, wastedTimeMs: 0 },
  ]);

  // Clusters: one old open on project 1, one fresh open + one resolved on project 2.
  await db.insert(schema.failureClusters).values([
    {
      projectId: 1,
      fingerprint: 'fp-1',
      signature: 'TimeoutError: locator.click',
      errorType: 'timeout',
      firstSeenRunId: 1,
      lastSeenRunId: failingRunId,
      status: 'open',
      occurrences: 25,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(2),
    },
    {
      projectId: 2,
      fingerprint: 'fp-2',
      signature: 'expect(received).toBe',
      errorType: 'assertion',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
      status: 'open',
      occurrences: 3,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    },
    {
      projectId: 2,
      fingerprint: 'fp-3',
      signature: 'net::ERR_CONNECTION_REFUSED',
      errorType: 'navigation',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
      status: 'resolved',
      occurrences: 5,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(4),
    },
  ]);
});

describe('analytics registry', () => {
  test('recognizes registered widget ids and rejects unknown ones', () => {
    for (const widget of ANALYTICS_WIDGETS) {
      expect(isAnalyticsWidgetId(widget.id)).toBe(true);
    }
    expect(isAnalyticsWidgetId('nope')).toBe(false);
    expect(isAnalyticsWidgetId(undefined)).toBe(false);
  });

  test('runAnalyticsWidget dispatches every registered widget', async () => {
    for (const widget of ANALYTICS_WIDGETS) {
      const result = await runAnalyticsWidget(db, widget.id, DEFAULT_SCOPE, 'all');
      expect(result).toBeDefined();
    }
  });
});

describe('analytics scope parsing', () => {
  test('applies defaults and clamps values', () => {
    expect(parseAnalyticsScope(undefined)).toEqual({
      days: 30,
      projectIds: undefined,
      environment: null,
      fullRunsOnly: true,
    });
    expect(parseAnalyticsScope({ days: '99999' }).days).toBe(3650);
    expect(
      parseAnalyticsScope(new URLSearchParams('days=7&projects=1,2&environment=staging&fullRunsOnly=false')),
    ).toEqual({
      days: 7,
      projectIds: [1, 2],
      environment: 'staging',
      fullRunsOnly: false,
    });
  });
});

describe('getAnalyticsPortfolio', () => {
  test('computes pass rate, delta vs previous period, and failing streak', async () => {
    const rows = await getAnalyticsPortfolio(db, DEFAULT_SCOPE, 'all');
    const checkout = rows.find((r) => r.projectId === 1)!;

    // Current period: 22 passed / 30 total = 73.3%; previous period 100%.
    expect(checkout.runCount).toBe(3);
    expect(checkout.passRate).toBeCloseTo(73.3, 1);
    expect(checkout.passRateDelta).toBeCloseTo(-26.7, 1);
    expect(checkout.failingStreak).toBe(3);
    expect(checkout.openClusters).toBe(1);
    expect(checkout.latestRun?.status).toBe('failed');

    // Worst health sorts first; the idle project sorts last.
    expect(rows[0]!.projectId).toBe(1);
    expect(rows[rows.length - 1]!.projectId).toBe(3);
  });

  test('excludes partial and non-terminal runs by default', async () => {
    const rows = await getAnalyticsPortfolio(db, DEFAULT_SCOPE, 'all');
    const search = rows.find((r) => r.projectId === 2)!;
    expect(search.runCount).toBe(2);
    expect(search.passRate).toBe(100);
    expect(search.flakyTests).toBe(2);
  });

  test('includes partial runs when fullRunsOnly is off', async () => {
    const rows = await getAnalyticsPortfolio(db, parseAnalyticsScope({ days: '30', fullRunsOnly: 'false' }), 'all');
    const search = rows.find((r) => r.projectId === 2)!;
    expect(search.runCount).toBe(3);
  });

  test('respects the access scope and the requested project filter', async () => {
    const restricted = await getAnalyticsPortfolio(db, DEFAULT_SCOPE, new Set([2]));
    expect(restricted.map((r) => r.projectId)).toEqual([2]);

    // Requested projects outside the access scope are dropped.
    const scope = parseAnalyticsScope({ days: '30', projects: '1,2' });
    const intersected = await getAnalyticsPortfolio(db, scope, new Set([2]));
    expect(intersected.map((r) => r.projectId)).toEqual([2]);
  });

  test('filters by environment', async () => {
    const scope = parseAnalyticsScope({ days: '30', environment: 'staging' });
    const rows = await getAnalyticsPortfolio(db, scope, 'all');
    expect(rows.find((r) => r.projectId === 2)!.runCount).toBe(2);
    expect(rows.find((r) => r.projectId === 1)!.runCount).toBe(0);
  });
});

describe('getAnalyticsPassRateHeatmap', () => {
  test('buckets pass rates per project and drops run-less projects', async () => {
    const heatmap = await getAnalyticsPassRateHeatmap(db, DEFAULT_SCOPE, 'all');
    expect(heatmap.bucketDays).toBe(1);
    // Leading all-empty columns are trimmed: the oldest seeded run is 10 days old.
    expect(heatmap.buckets.length).toBeLessThanOrEqual(30);
    expect(heatmap.rows.some((r) => r.cells[0] !== null)).toBe(true);
    expect(heatmap.rows.map((r) => r.projectId).sort()).toEqual([1, 2]);

    const checkout = heatmap.rows.find((r) => r.projectId === 1)!;
    const values = checkout.cells.filter((c) => c !== null);
    expect(values).toHaveLength(3);
    expect(values).toContain(70); // 7/10 on the latest failing runs
  });

  test('widens buckets for long periods', async () => {
    const heatmap = await getAnalyticsPassRateHeatmap(db, parseAnalyticsScope({ days: '365' }), 'all');
    expect(heatmap.bucketDays).toBeGreaterThan(1);
    expect(heatmap.buckets.length).toBeLessThanOrEqual(32);
  });
});

describe('getAnalyticsCiTimeTrend', () => {
  test('sums minutes for the period and compares with the previous one', async () => {
    const trend = await getAnalyticsCiTimeTrend(db, DEFAULT_SCOPE, 'all');
    // 5 full terminal runs in the current period × 1 min each.
    expect(trend.runCount).toBe(5);
    expect(trend.totalMinutes).toBe(5);
    expect(trend.prevTotalMinutes).toBe(2);
    expect(trend.deltaPct).toBe(150);
    expect(trend.avgRunMinutes).toBe(1);
    expect(trend.points.reduce((sum, p) => sum + p.runCount, 0)).toBe(5);
  });
});

describe('getAnalyticsWastedTime', () => {
  test('aggregates wait time and failed-attempt time', async () => {
    const wasted = await getAnalyticsWastedTime(db, DEFAULT_SCOPE, 'all');
    expect(wasted.totalWaitMinutes).toBe(1); // 60s of wait steps
    expect(wasted.totalFailedExecMinutes).toBe(2); // one 120s failed attempt
    expect(wasted.byProject[0]!.projectId).toBe(1);
    expect(wasted.points.reduce((sum, p) => sum + p.waitMinutes, 0)).toBe(1);
  });

  test('returns an empty shape when the access scope has no projects', async () => {
    const wasted = await getAnalyticsWastedTime(db, DEFAULT_SCOPE, new Set<number>());
    expect(wasted.totalWaitMinutes).toBe(0);
    expect(wasted.byProject).toEqual([]);
  });
});

describe('getAnalyticsClusterLandscape', () => {
  test('counts open clusters, resolved-in-period, and error-type mix', async () => {
    const landscape = await getAnalyticsClusterLandscape(db, DEFAULT_SCOPE, 'all');
    expect(landscape.totalOpen).toBe(2);
    expect(landscape.resolvedInPeriod).toBe(1);
    expect(landscape.byErrorType).toEqual([
      { errorType: 'timeout', count: 1 },
      { errorType: 'assertion', count: 1 },
    ]);

    const top = landscape.clusters[0]!;
    expect(top.occurrences).toBe(25);
    expect(top.ageDays).toBeGreaterThanOrEqual(39);
    expect(top.projectName).toBe('checkout');
  });

  test('respects the access scope', async () => {
    const landscape = await getAnalyticsClusterLandscape(db, DEFAULT_SCOPE, new Set([2]));
    expect(landscape.totalOpen).toBe(1);
    expect(landscape.clusters[0]!.projectId).toBe(2);
  });
});

describe('insight rules', () => {
  test('fires on the seeded data through the full pipeline', async () => {
    const insights = (await runAnalyticsWidget(db, 'insights', DEFAULT_SCOPE, 'all')) as Array<{
      ruleId: string;
      severity: string;
    }>;
    const ruleIds = insights.map((i) => i.ruleId);
    expect(ruleIds).toContain('failing-streak');
    expect(ruleIds).toContain('pass-rate-drop');
    expect(ruleIds).toContain('stale-cluster');
    // Critical findings sort before informational ones.
    const severities = insights.map((i) => i.severity);
    expect(severities.indexOf('critical')).toBe(0);
  });

  test('rules are pure and independently evaluable', () => {
    const insights = evaluateInsightRules({
      scope: DEFAULT_SCOPE,
      portfolio: [],
      ciTime: {
        points: [],
        bucketDays: 1,
        totalMinutes: 100,
        runCount: 10,
        prevTotalMinutes: 50,
        deltaPct: 100,
        avgRunMinutes: 10,
      },
      wastedTime: {
        points: [],
        bucketDays: 1,
        totalWaitMinutes: 0,
        totalFailedExecMinutes: 0,
        byProject: [],
      },
      clusters: { totalOpen: 0, resolvedInPeriod: 0, byErrorType: [], clusters: [] },
      flakyTests: [],
    });
    expect(insights).toHaveLength(1);
    expect(insights[0]!.ruleId).toBe('ci-time-growth');
    expect(insights[0]!.severity).toBe('warning');
  });
});
