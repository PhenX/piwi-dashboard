import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import { isAnalyticsWidgetId, type AnalyticsWidgetId } from '../../analytics/registry';
import type { ProjectAccess } from './common';
import { getAnalyticsPortfolio } from './portfolio';
import { getAnalyticsPassRateHeatmap } from './pass-rate-heatmap';
import { getAnalyticsCiTimeTrend } from './ci-time-trend';
import { getAnalyticsWastedTime } from './wasted-time';
import { getAnalyticsFlakyLeaderboard } from './flaky-leaderboard';
import { getAnalyticsClusterLandscape } from './cluster-landscape';
import { getAnalyticsInsights } from './insights';

export { isAnalyticsWidgetId };
export type { AnalyticsWidgetId, ProjectAccess };

type AnalyticsWidgetHandler = (db: DrizzleDB, scope: AnalyticsScope, access: ProjectAccess) => Promise<unknown>;

/**
 * Widget id → handler. Keyed by the registry union, so forgetting a handler
 * for a registered widget (or vice versa) is a compile error.
 */
const ANALYTICS_WIDGET_HANDLERS: Record<AnalyticsWidgetId, AnalyticsWidgetHandler> = {
  insights: getAnalyticsInsights,
  portfolio: getAnalyticsPortfolio,
  'pass-rate-heatmap': getAnalyticsPassRateHeatmap,
  'ci-time-trend': getAnalyticsCiTimeTrend,
  'wasted-time': getAnalyticsWastedTime,
  'flaky-leaderboard': getAnalyticsFlakyLeaderboard,
  'cluster-landscape': getAnalyticsClusterLandscape,
};

export function runAnalyticsWidget(
  db: DrizzleDB,
  widget: AnalyticsWidgetId,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<unknown> {
  return ANALYTICS_WIDGET_HANDLERS[widget](db, scope, access);
}
