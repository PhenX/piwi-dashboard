/**
 * Rule registry for the analytics insights feed. Every rule is a pure
 * function over the already-computed widget aggregates — no DB access — so
 * rules are trivially unit-testable and adding one is a single entry here.
 */

import type {
  AnalyticsCiTimeTrend,
  AnalyticsClusterLandscape,
  AnalyticsFlakyRow,
  AnalyticsInsight,
  AnalyticsPortfolioRow,
  AnalyticsWastedTime,
} from './types';
import type { AnalyticsScope } from './scope';

export interface InsightContext {
  scope: AnalyticsScope;
  portfolio: AnalyticsPortfolioRow[];
  ciTime: AnalyticsCiTimeTrend;
  wastedTime: AnalyticsWastedTime;
  clusters: AnalyticsClusterLandscape;
  flakyTests: AnalyticsFlakyRow[];
}

export interface InsightRule {
  id: string;
  evaluate(ctx: InsightContext): AnalyticsInsight[];
}

const SEVERITY_ORDER: Record<AnalyticsInsight['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

function projectDisplay(row: { name: string; label: string | null }): string {
  return row.label || row.name;
}

const passRateDrop: InsightRule = {
  id: 'pass-rate-drop',
  evaluate: ({ portfolio, scope }) =>
    portfolio
      .filter((p) => p.passRateDelta !== null && p.passRateDelta <= -5 && p.runCount >= 3)
      .map((p) => ({
        id: `pass-rate-drop:${p.projectId}`,
        ruleId: 'pass-rate-drop',
        severity: p.passRateDelta! <= -15 ? ('critical' as const) : ('warning' as const),
        message: `${projectDisplay(p)} pass rate dropped ${Math.abs(p.passRateDelta!)} pts vs the previous ${scope.days} days`,
        detail: `Now at ${p.passRate}% over ${p.runCount} runs.`,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const passRateRecovery: InsightRule = {
  id: 'pass-rate-recovery',
  evaluate: ({ portfolio, scope }) =>
    portfolio
      .filter((p) => p.passRateDelta !== null && p.passRateDelta >= 10 && p.runCount >= 3)
      .map((p) => ({
        id: `pass-rate-recovery:${p.projectId}`,
        ruleId: 'pass-rate-recovery',
        severity: 'positive' as const,
        message: `${projectDisplay(p)} pass rate improved ${p.passRateDelta} pts vs the previous ${scope.days} days`,
        detail: `Now at ${p.passRate}% over ${p.runCount} runs.`,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const failingStreak: InsightRule = {
  id: 'failing-streak',
  evaluate: ({ portfolio }) =>
    portfolio
      .filter((p) => p.failingStreak >= 3)
      .map((p) => ({
        id: `failing-streak:${p.projectId}`,
        ruleId: 'failing-streak',
        severity: 'critical' as const,
        message: `${projectDisplay(p)} has failed ${p.failingStreak} runs in a row`,
        detail: p.latestRun ? `Latest run #${p.latestRun.id} ${p.latestRun.status}.` : undefined,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const staleCluster: InsightRule = {
  id: 'stale-cluster',
  evaluate: ({ clusters }) =>
    clusters.clusters
      .filter((c) => c.ageDays >= 14 && c.occurrences >= 10)
      .slice(0, 3)
      .map((c) => ({
        id: `stale-cluster:${c.id}`,
        ruleId: 'stale-cluster',
        severity: c.ageDays >= 30 ? ('critical' as const) : ('warning' as const),
        message: `"${c.title || c.signature}" has been open for ${c.ageDays} days (${c.occurrences} occurrences)`,
        detail: `${projectDisplay({ name: c.projectName, label: c.projectLabel })} · ${c.errorType ?? 'unknown'} error.`,
        to: `/failure-clusters/${c.id}`,
        projectId: c.projectId,
      })),
};

const ciTimeGrowth: InsightRule = {
  id: 'ci-time-growth',
  evaluate: ({ ciTime, scope }) => {
    if (ciTime.deltaPct === null || ciTime.deltaPct < 25 || ciTime.totalMinutes < 30) return [];
    return [
      {
        id: 'ci-time-growth',
        ruleId: 'ci-time-growth',
        severity: ciTime.deltaPct >= 50 ? 'warning' : 'info',
        message: `CI time grew ${ciTime.deltaPct}% vs the previous ${scope.days} days`,
        detail: `${Math.round(ciTime.totalMinutes)} minutes across ${ciTime.runCount} runs this period.`,
      },
    ];
  },
};

const wastedCiTime: InsightRule = {
  id: 'wasted-ci-time',
  evaluate: ({ wastedTime }) => {
    const totalWasted = wastedTime.totalWaitMinutes + wastedTime.totalFailedExecMinutes;
    if (totalWasted < 60) return [];
    const worst = wastedTime.byProject[0];
    const hours = Math.round((totalWasted / 60) * 10) / 10;
    return [
      {
        id: 'wasted-ci-time',
        ruleId: 'wasted-ci-time',
        severity: totalWasted >= 240 ? 'warning' : 'info',
        message: `${hours} h of CI time went to waits and failed attempts this period`,
        detail: worst
          ? `${projectDisplay(worst)} alone accounts for ${Math.round(worst.waitMinutes + worst.failedExecMinutes)} minutes.`
          : undefined,
        to: worst ? `/projects/${worst.projectId}` : undefined,
        projectId: worst?.projectId,
      },
    ];
  },
};

const topFlakyImpact: InsightRule = {
  id: 'top-flaky-impact',
  evaluate: ({ flakyTests }) =>
    flakyTests
      .filter((t) => t.wastedCiMinutes >= 10)
      .slice(0, 2)
      .map((t) => ({
        id: `top-flaky-impact:${t.testCaseId}`,
        ruleId: 'top-flaky-impact',
        severity: 'warning' as const,
        message: `"${t.title}" wasted ${Math.round(t.wastedCiMinutes)} CI minutes on flaky retries`,
        detail: `${projectDisplay({ name: t.projectName, label: t.projectLabel })} · flaked in ${t.retryPassRuns} of ${t.totalRuns} recent runs.`,
        to: `/test-cases/${t.testCaseId}`,
        projectId: t.projectId,
      })),
};

export const INSIGHT_RULES: InsightRule[] = [
  failingStreak,
  passRateDrop,
  staleCluster,
  topFlakyImpact,
  wastedCiTime,
  ciTimeGrowth,
  passRateRecovery,
];

export function evaluateInsightRules(ctx: InsightContext): AnalyticsInsight[] {
  return INSIGHT_RULES.flatMap((rule) => rule.evaluate(ctx)).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
