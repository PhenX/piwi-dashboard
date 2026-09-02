import { extractMessageHead, stripAnsi } from '#shared/error-fingerprint';

/** All notification event keys supported by the subscription system. */
export const NOTIFICATION_EVENTS = [
  'run.finished',
  'run.failed',
  'run.failed.default_branch',
  'cluster.new',
  'flakiness.spike',
  'perf.regression',
  'diagnosis.completed',
  'auto_heal.pr_opened',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** How many failing tests to embed in a run notification. */
export const TOP_FAILURES_LIMIT = 3;
/** Max characters kept from an error message embedded in a notification. */
export const ERROR_EXCERPT_MAX = 300;
/** How many prior completed runs the perf-regression baseline is computed from. */
export const PERF_BASELINE_RUNS = 5;
/** Minimum prior runs required before a perf-regression baseline is trusted. */
export const PERF_BASELINE_MIN_RUNS = 2;
/** How much slower than baseline (percent) a run must be to emit perf.regression. */
export const PERF_REGRESSION_MIN_PCT = 20;

/** A single failing test embedded in a run notification for debugging context. */
export interface TopFailure {
  title: string;
  filePath?: string;
  errorExcerpt?: string;
  testCaseId?: number;
  executionId?: number;
}

export interface RunFinishedPayload {
  runId: number;
  projectId: number;
  projectName: string;
  status: string;
  totalTests: number;
  failedTests: number;
  passedTests: number;
  flakyTests: number;
  branch?: string;
  isDefaultBranch?: boolean;
  flakinessRate?: number; // 0-1
  /** Duration of the run in milliseconds. */
  durationMs?: number;
  /** Median duration (ms) of the prior runs a perf regression was measured against. */
  baselineDurationMs?: number;
  /** How much slower this run is than the baseline, in percent. */
  regressionPct?: number;
  topFailures?: TopFailure[];
  /**
   * Distinct owners of the run's failing tests — from `piwi:owner` where a test
   * declares one, otherwise CODEOWNERS. Lets a subscription route a run only to
   * the team responsible for what broke.
   */
  owners?: string[];
}

export interface ClusterNewPayload {
  clusterId: number;
  projectId: number;
  projectName: string;
  signature: string;
  runId: number;
  sampleErrorExcerpt?: string;
  affectedCases?: number;
}

/**
 * Trim, strip ANSI colour codes, and cap a text so it can be embedded in a
 * notification payload (and rendered in email/Slack) without bloating it.
 * Returns undefined for empty input.
 */
export function truncateExcerpt(text?: string | null, max: number = ERROR_EXCERPT_MAX): string | undefined {
  if (!text) return undefined;
  const clean = stripAnsi(text).trim();
  if (!clean) return undefined;
  return clean.length > max ? clean.slice(0, max).trimEnd() + '…' : clean;
}

/** A message head that says nothing but that a timeout elapsed. */
const BARE_TIMEOUT_RE = /^(?:\w*Error:\s*)?(?:[\w.]+:\s*)?(?:Test )?[Tt]imeout(?: of)? \d+m?s exceeded\.?$/;
/** Call-log lines that say where Playwright was when the timeout hit. */
const CALL_LOG_STATE_RE = /^\s*-\s*((?:waiting for|locator resolved to)\b.*)$/;

/**
 * The part of an error worth quoting outward — in a notification, a
 * pull-request comment, a digest: the message head (the lines before the
 * Playwright call log and the stack trace, at most five), with the last
 * `waiting for …` / `locator resolved to …` call-log line appended when the
 * head is only a bare timeout. ANSI codes are stripped and the result is
 * capped at `max` characters. Returns undefined for empty input.
 */
export function errorExcerpt(text?: string | null, max: number = ERROR_EXCERPT_MAX): string | undefined {
  if (!text) return undefined;
  const clean = stripAnsi(text).trim();
  if (!clean) return undefined;
  let head = extractMessageHead(clean) || clean.split('\n')[0]!.trim();
  if (BARE_TIMEOUT_RE.test(head)) {
    const state = lastCallLogState(clean);
    if (state) head = `${head}\n${state}`;
  }
  return truncateExcerpt(head, max);
}

function lastCallLogState(text: string): string | null {
  const start = text.indexOf('Call log:');
  if (start === -1) return null;
  let last: string | null = null;
  for (const line of text.slice(start).split('\n')) {
    const match = CALL_LOG_STATE_RE.exec(line);
    if (match) last = match[1]!.trim();
  }
  return last;
}

/**
 * Dashboard path for one failing test: the execution with its evidence when
 * the payload carries one, otherwise the test's history page.
 */
export function failureTargetPath(failure: Pick<TopFailure, 'testCaseId' | 'executionId'>): string | null {
  if (failure.executionId != null) return `/test-run-cases/${failure.executionId}`;
  if (failure.testCaseId != null) return `/test-cases/${failure.testCaseId}`;
  return null;
}

/** Raw failing-case row shape consumed by {@link buildTopFailures}. */
export interface TopFailureInput {
  title: string;
  filePath?: string | null;
  error?: string | null;
  testCaseId?: number | null;
  executionId?: number | null;
}

/**
 * Map raw failing-case rows to the compact {@link TopFailure} shape embedded in
 * run notifications: capped to `limit` entries, each error cut to its
 * {@link errorExcerpt}.
 */
export function buildTopFailures(rows: TopFailureInput[], limit: number = TOP_FAILURES_LIMIT): TopFailure[] {
  return rows.slice(0, limit).map((r) => {
    const failure: TopFailure = { title: r.title };
    if (r.filePath) failure.filePath = r.filePath;
    if (r.testCaseId != null) failure.testCaseId = r.testCaseId;
    if (r.executionId != null) failure.executionId = r.executionId;
    const excerpt = errorExcerpt(r.error);
    if (excerpt) failure.errorExcerpt = excerpt;
    return failure;
  });
}

export interface DiagnosisCompletedPayload {
  clusterId: number;
  projectId: number;
  /** Epoch ms of this completion — distinguishes re-diagnoses of the same cluster. */
  completedAt?: number;
  summary?: string | null;
  rootCause?: string | null;
  category?: string | null;
  confidence?: string | null;
}

export interface AutoHealPrOpenedPayload {
  projectId: number;
  projectName: string;
  /** The run whose failures triggered the heal. */
  runId: number;
  prNumber: number;
  prUrl: string;
  branch: string;
  /** How many locator edits the PR carries. */
  editCount: number;
}

export type NotificationPayload =
  | RunFinishedPayload
  | ClusterNewPayload
  | DiagnosisCompletedPayload
  | AutoHealPrOpenedPayload;

/** Per-subscription delivery filters, stored as JSON on the subscription row. */
export interface SubscriptionFilters {
  branches?: string[];
  tags?: string[];
  statuses?: string[];
  defaultBranchOnly?: boolean;
  /** Only deliver when one of these owns a failing test in the run. */
  owners?: string[];
  /** Minimum flakiness rate (0-1) for flakiness.spike deliveries. */
  flakinessThreshold?: number;
  /** Minimum slowdown percent for perf.regression deliveries. */
  perfRegressionPct?: number;
}

/** Whether an event/payload passes a subscription's delivery filters. */
export function passesSubscriptionFilters(
  filters: SubscriptionFilters | null | undefined,
  event: NotificationEvent,
  payload: NotificationPayload,
): boolean {
  if (!filters) return true;

  const runPayload = payload as RunFinishedPayload;

  if (filters.defaultBranchOnly && event.startsWith('run.')) {
    if (!runPayload.isDefaultBranch) return false;
  }
  if (filters.branches?.length && event.startsWith('run.') && runPayload.branch) {
    if (!filters.branches.includes(runPayload.branch)) return false;
  }
  if (filters.statuses?.length && event.startsWith('run.') && runPayload.status) {
    if (!filters.statuses.includes(runPayload.status)) return false;
  }
  if (filters.owners?.length && event.startsWith('run.')) {
    // No owner on the payload means nothing failed, or ownership could not be
    // resolved. Either way an owner-scoped subscription has nothing to say.
    const runOwners = runPayload.owners ?? [];
    if (!runOwners.some((owner) => filters.owners!.includes(owner))) return false;
  }
  if (filters.flakinessThreshold != null && event === 'flakiness.spike') {
    const rate = runPayload.flakinessRate ?? 0;
    if (rate < filters.flakinessThreshold) return false;
  }
  if (filters.perfRegressionPct != null && event === 'perf.regression') {
    const pct = runPayload.regressionPct ?? 0;
    if (pct < filters.perfRegressionPct) return false;
  }

  return true;
}

/**
 * Idempotency key for one logical notification to one channel. Keyed on the
 * entity the event is about — the run for run-scoped events, the cluster for
 * cluster.new (one run can surface several new clusters), and the cluster plus
 * completion time for diagnosis.completed (the same cluster can be re-diagnosed).
 */
export function buildNotificationDedupeKey(
  event: NotificationEvent,
  payload: NotificationPayload,
  channelId: number,
): string {
  if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    return `${event}:c${p.clusterId}:${channelId}`;
  }
  if (event === 'diagnosis.completed') {
    const p = payload as DiagnosisCompletedPayload;
    return `${event}:c${p.clusterId}:${p.completedAt ?? 'x'}:${channelId}`;
  }
  const runId = (payload as RunFinishedPayload).runId;
  return `${event}:r${runId ?? 'x'}:${channelId}`;
}

/**
 * Perf-regression baseline: the median duration of prior completed runs, and how
 * much slower the current run is. Returns null when there are fewer than
 * {@link PERF_BASELINE_MIN_RUNS} usable prior durations or the current duration
 * is not positive.
 */
export function computePerfBaseline(
  priorDurationsMs: number[],
  currentDurationMs: number,
): { baselineDurationMs: number; regressionPct: number } | null {
  const usable = priorDurationsMs.filter((d) => d > 0);
  if (currentDurationMs <= 0 || usable.length < PERF_BASELINE_MIN_RUNS) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const baselineDurationMs = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  if (baselineDurationMs <= 0) return null;
  const regressionPct = ((currentDurationMs - baselineDurationMs) / baselineDurationMs) * 100;
  return { baselineDurationMs, regressionPct };
}

/** Dashboard path the notification links to, or null when it has no target. */
export function notificationTargetPath(event: NotificationEvent, payload: NotificationPayload): string | null {
  if (event === 'cluster.new' || event === 'diagnosis.completed') {
    const clusterId = (payload as ClusterNewPayload).clusterId;
    return clusterId ? `/failure-clusters/${clusterId}` : null;
  }
  const runId = (payload as RunFinishedPayload).runId;
  return runId ? `/test-runs/${runId}` : null;
}

/** Subject / title line for each event type. */
export function renderEventSubject(event: NotificationEvent, payload: NotificationPayload): string {
  switch (event) {
    case 'run.finished':
    case 'run.failed':
    case 'run.failed.default_branch': {
      const p = payload as RunFinishedPayload;
      return `Test run ${p.status} — ${p.projectName}${p.branch ? ` (${p.branch})` : ''}`;
    }
    case 'cluster.new': {
      const p = payload as ClusterNewPayload;
      return `New failure cluster — ${p.projectName}`;
    }
    case 'flakiness.spike': {
      const p = payload as RunFinishedPayload;
      return `Flakiness spike — ${p.projectName}`;
    }
    case 'perf.regression': {
      const p = payload as RunFinishedPayload;
      const pct = p.regressionPct != null ? ` (+${Math.round(p.regressionPct)}% slower)` : '';
      return `Performance regression — ${p.projectName}${pct}`;
    }
    case 'diagnosis.completed': {
      return 'Diagnosis complete';
    }
    case 'auto_heal.pr_opened': {
      const p = payload as AutoHealPrOpenedPayload;
      return `Auto-heal opened PR #${p.prNumber} — ${p.projectName}`;
    }
  }
}
