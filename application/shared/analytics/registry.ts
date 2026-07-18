/**
 * Single source of truth for every cross-project analytics widget.
 *
 * Each entry describes one widget on the `/analytics` page. The generic
 * `GET /api/analytics/[widget]` route dispatches by `id` through the handler
 * map in `shared/handlers/analytics`, and the page maps the same `id` to a Vue
 * component — so adding a widget means: one entry here, one handler file, one
 * component. No routing changes on either the server or the demo mirror.
 */

export interface AnalyticsWidgetMeta {
  id: string;
  /** Card title (sentence case). */
  title: string;
  /** Lucide icon for the card header. */
  icon: string;
  /** Layout hint: `full` spans the grid, `half` shares a row on wide screens. */
  size: 'full' | 'half';
}

export const ANALYTICS_WIDGETS = [
  {
    id: 'insights',
    title: 'Insights',
    icon: 'i-lucide-lightbulb',
    size: 'full',
  },
  {
    id: 'portfolio',
    title: 'Portfolio health',
    icon: 'i-lucide-table-properties',
    size: 'full',
  },
  {
    id: 'pass-rate-heatmap',
    title: 'Pass rate heatmap',
    icon: 'i-lucide-grid-3x3',
    size: 'full',
  },
  {
    id: 'ci-time-trend',
    title: 'CI time',
    icon: 'i-lucide-timer',
    size: 'half',
  },
  {
    id: 'wasted-time',
    title: 'Wasted CI time',
    icon: 'i-lucide-hourglass',
    size: 'half',
  },
  {
    id: 'flaky-leaderboard',
    title: 'Flakiest tests',
    icon: 'i-lucide-repeat',
    size: 'half',
  },
  {
    id: 'cluster-landscape',
    title: 'Failure clusters',
    icon: 'i-lucide-layers',
    size: 'half',
  },
  {
    id: 'regression-velocity',
    title: 'Regression velocity',
    icon: 'i-lucide-git-pull-request-arrow',
    size: 'half',
  },
  {
    id: 'browser-matrix',
    title: 'Browser matrix',
    icon: 'i-lucide-monitor-smartphone',
    size: 'half',
  },
  {
    id: 'slow-endpoints',
    title: 'Slow endpoints',
    icon: 'i-lucide-gauge',
    size: 'full',
  },
] as const satisfies readonly AnalyticsWidgetMeta[];

export type AnalyticsWidgetId = (typeof ANALYTICS_WIDGETS)[number]['id'];

const WIDGET_IDS = new Set<string>(ANALYTICS_WIDGETS.map((w) => w.id));

export function isAnalyticsWidgetId(value: unknown): value is AnalyticsWidgetId {
  return typeof value === 'string' && WIDGET_IDS.has(value);
}
