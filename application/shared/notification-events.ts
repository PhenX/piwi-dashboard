/** All notification event keys supported by the subscription system. */
export const NOTIFICATION_EVENTS = [
  'run.finished',
  'run.failed',
  'run.failed.default_branch',
  'cluster.new',
  'flakiness.spike',
  'perf.regression',
  'diagnosis.completed',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** How many failing tests to embed in a run notification. */
export const TOP_FAILURES_LIMIT = 3;
/** Max characters kept from an error message embedded in a notification. */
export const ERROR_EXCERPT_MAX = 300;

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
  topFailures?: TopFailure[];
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
 * Trim, strip ANSI colour codes, and cap an error message so it can be embedded
 * in a notification payload (and rendered in email/Slack) without bloating it.
 * Returns undefined for empty input.
 */
export function truncateExcerpt(text?: string | null, max: number = ERROR_EXCERPT_MAX): string | undefined {
  if (!text) return undefined;
  const esc = String.fromCharCode(27);
  const clean = text.replace(new RegExp(esc + '\\[[0-9;]*m', 'g'), '').trim();
  if (!clean) return undefined;
  return clean.length > max ? clean.slice(0, max).trimEnd() + '…' : clean;
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
 * run notifications: capped to `limit` entries with truncated error excerpts.
 */
export function buildTopFailures(rows: TopFailureInput[], limit: number = TOP_FAILURES_LIMIT): TopFailure[] {
  return rows.slice(0, limit).map((r) => {
    const failure: TopFailure = { title: r.title };
    if (r.filePath) failure.filePath = r.filePath;
    if (r.testCaseId != null) failure.testCaseId = r.testCaseId;
    if (r.executionId != null) failure.executionId = r.executionId;
    const excerpt = truncateExcerpt(r.error);
    if (excerpt) failure.errorExcerpt = excerpt;
    return failure;
  });
}

export interface DiagnosisCompletedPayload {
  clusterId: number;
  projectId: number;
  summary?: string | null;
  rootCause?: string | null;
  category?: string | null;
  confidence?: string | null;
}

export type NotificationPayload = RunFinishedPayload | ClusterNewPayload | DiagnosisCompletedPayload;

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
      return `Performance regression — ${p.projectName}`;
    }
    case 'diagnosis.completed': {
      return 'Diagnosis complete';
    }
  }
}
