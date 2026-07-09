/**
 * Pure presentation helpers for the Workers timeline (colors, time formatting,
 * and SVG layout constants). Kept dependency-free so the timeline composables
 * and the presentational sub-components can all share one source of truth.
 */

/** Fixed pixel geometry for the timeline SVG. */
export const TIMELINE_LAYOUT = {
  barHeight: 24,
  rowGap: 8,
  labelWidth: 80,
  sidePadding: 16,
  axisHeight: 28,
  /** Derived: a full row is a bar plus the gap below it. */
  get rowHeight(): number {
    return this.barHeight + this.rowGap;
  },
} as const;

const STATUS_HEX: Record<string, string> = {
  passed: '#16a34a',
  failed: '#dc2626',
  timedOut: '#ea580c',
  running: '#2563eb',
  initialising: '#2563eb',
  skipped: '#9ca3af',
  cancelled: '#a1a1aa',
  interrupted: '#ea580c',
  flaky: '#ca8a04',
};

/**
 * Amber palette for wasted-wait bars, shared by the bar renderer and the
 * tooltip swatch.
 */
export const TIMELINE_WAIT_COLORS = {
  fill: '#facc15',
  stroke: '#ca8a04',
  swatch: '#f59e0b',
} as const;

/** Bar fill color for a test-case status (falls back to neutral gray). */
export function timelineStatusHex(status: string): string {
  return STATUS_HEX[status] || '#a1a1aa';
}

/** Fill for a hook/fixture bar: the status color at 40% alpha. */
export function timelineHookFill(status: string): string {
  return timelineStatusHex(status) + '66';
}

/** Stroke for a hook/fixture bar's dashed outline: the full status color. */
export function timelineHookStroke(status: string): string {
  return timelineStatusHex(status);
}

/** Human-readable duration used for timeline ticks, bar labels and tooltips. */
export function formatTimelineTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
