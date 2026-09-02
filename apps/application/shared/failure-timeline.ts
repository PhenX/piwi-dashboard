/**
 * The failure timeline: one time axis per execution that places the steps, the
 * console entries, the network requests and the backend log entries on the same
 * clock, marks the moment of failure, and picks a default window around the
 * failed step. It turns "console (1) / network (3)" — two unrelated lists — into
 * "what the app was doing when the test gave up".
 *
 * Pure assembly over rows the caller already loaded (the same rows the execution
 * detail returns), so the server route and the demo mirror build the same
 * object. Every timestamp the builder reads is epoch ms; items are positioned in
 * ms relative to `origin`. It never throws: partial, missing or malformed input
 * yields a valid (possibly empty) timeline, and anything without a usable
 * timestamp is listed in `unplaced` with a reason rather than guessed at.
 */

/** The rows a lane groups. `backend` holds log entries attached to a request. */
export type TimelineLane = 'steps' | 'console' | 'network' | 'backend';

/** What an item stands for; the card colors and formats each kind differently. */
export type TimelineItemKind = 'step' | 'console' | 'network' | 'backend';

/** The page section (and index within it) an item was read from, for click-through. */
export interface TimelineRef {
  section: 'steps' | 'console' | 'networkRequests' | 'backendLogs';
  /** Index within the source list; backend logs carry their parent request's index. */
  index: number;
}

/** One placed item, positioned at `at` ms relative to the timeline `origin`. */
export interface TimelineItem {
  id: string;
  lane: TimelineLane;
  /** Start, in ms relative to `origin`. */
  at: number;
  /** Span in ms for bars (steps, network); absent for point marks (console, backend). */
  duration?: number;
  label: string;
  /** Console type, HTTP status, or step/log status — kind-specific. */
  status?: string;
  kind: TimelineItemKind;
  ref: TimelineRef;
  /** The failed step, or a request that errored — drawn in the critical color. */
  failed?: boolean;
}

/** Something that exists but carries no usable timestamp, so it cannot be placed. */
export interface TimelineUnplaced {
  section: TimelineRef['section'];
  label: string;
  reason: string;
}

/** A view window, in ms relative to `origin`. */
export interface TimelineWindow {
  start: number;
  end: number;
}

/** The placed items grouped by lane, in the card's row order. */
export interface TimelineLanes {
  steps: TimelineItem[];
  console: TimelineItem[];
  network: TimelineItem[];
  backend: TimelineItem[];
}

export interface FailureTimeline {
  /** Epoch ms of the axis start (the earliest activity, at or before `startedAt`). */
  origin: number;
  /** Epoch ms of the axis end (the latest activity end, at or after the failure). */
  end: number;
  /** The moment of failure, in ms relative to `origin`. */
  failureAt: number;
  /** The failed step, when one was identified. */
  failedStep: { index: number; label: string; at: number; duration: number } | null;
  lanes: TimelineLanes;
  unplaced: TimelineUnplaced[];
  /** True when step positions were derived from durations because start times were missing. */
  estimated: boolean;
  /** The default view: the failed step plus lead/trail, or the whole execution. */
  window: TimelineWindow;
}

/** Optional trace anchor (epoch ms): the failing action's window, used only for `failureAt`. */
export interface TimelineTraceAnchor {
  failingActionStart?: number | null;
  failingActionEnd?: number | null;
}

export interface FailureTimelineInput {
  startedAt?: number | null;
  duration?: number | null;
  timeout?: number | null;
  status?: string | null;
  steps?: unknown;
  stepEvents?: unknown;
  consoleLogs?: unknown;
  networkRequests?: unknown;
  traceAnchor?: TimelineTraceAnchor | null;
}

/** The default window reaches this far before the failed step… */
export const TIMELINE_WINDOW_LEAD_MS = 10_000;
/** …and this far after it, both clamped to the execution. */
export const TIMELINE_WINDOW_TRAIL_MS = 2_000;

/** Longest label the merged list shows before the card truncates it. */
const MAX_LABEL_CHARS = 200;

type StepRow = {
  title?: unknown;
  duration?: unknown;
  category?: unknown;
  location?: unknown;
  startTime?: unknown;
  error?: unknown;
  failed?: unknown;
};

type ConsoleRow = { type?: unknown; text?: unknown; timestamp?: unknown; location?: unknown };

type ServerLogRow = { timestamp?: unknown; level?: unknown; message?: unknown };

type NetworkRow = {
  method?: unknown;
  url?: unknown;
  status?: unknown;
  duration?: unknown;
  startTime?: unknown;
  serverLogs?: unknown;
};

type StepEventRow = { startedAt?: unknown; duration?: unknown };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Coerce a list of unknowns into row objects, dropping non-object entries to `{}`. */
function rows<T>(value: unknown): T[] {
  return asArray(value).map((entry) => (entry != null && typeof entry === 'object' ? (entry as T) : ({} as T)));
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function clampLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_CHARS ? `${trimmed.slice(0, MAX_LABEL_CHARS - 1)}…` : trimmed;
}

/** A step is "failed" when it carries an error or a truthy `failed` flag. */
function stepFailed(step: StepRow): boolean {
  if (step.failed === true) return true;
  const error = step.error;
  if (typeof error === 'string') return error.trim().length > 0;
  return error != null && typeof error === 'object';
}

const FAILED_STATUSES = new Set(['failed', 'timedout', 'timedOut', 'interrupted']);

export function buildFailureTimeline(input: FailureTimelineInput): FailureTimeline {
  const steps = rows<StepRow>(input.steps);
  const consoleLogs = rows<ConsoleRow>(input.consoleLogs);
  const networkRequests = rows<NetworkRow>(input.networkRequests);
  const stepEvents = rows<StepEventRow>(input.stepEvents);

  const startedAt = isFiniteNumber(input.startedAt) ? input.startedAt : null;
  const duration = isFiniteNumber(input.duration) && input.duration >= 0 ? input.duration : null;

  // Steps have reliable start times only when *every* step carries one; a mixed
  // list cannot be interleaved, so it is placed cumulatively and flagged estimated.
  const stepsHaveStartTimes = steps.length > 0 && steps.every((s) => isFiniteNumber(s.startTime));

  // The origin is the earliest epoch timestamp anywhere in the execution, so no
  // item ever lands before t+0. `startedAt` anchors it; captured timestamps that
  // predate it (or stand in when it is missing) pull it earlier.
  const originCandidates: number[] = [];
  if (startedAt != null) originCandidates.push(startedAt);
  if (stepsHaveStartTimes) for (const s of steps) originCandidates.push(s.startTime as number);
  for (const e of stepEvents) if (isFiniteNumber(e.startedAt)) originCandidates.push(e.startedAt);
  for (const c of consoleLogs) if (isFiniteNumber(c.timestamp)) originCandidates.push(c.timestamp);
  for (const n of networkRequests) if (isFiniteNumber(n.startTime)) originCandidates.push(n.startTime);
  for (const n of networkRequests)
    for (const log of rows<ServerLogRow>(n.serverLogs))
      if (isFiniteNumber(log.timestamp)) originCandidates.push(log.timestamp);
  const origin = originCandidates.length > 0 ? Math.min(...originCandidates) : 0;

  const lanes: TimelineLanes = { steps: [], console: [], network: [], backend: [] };
  const unplaced: TimelineUnplaced[] = [];
  let latestEnd = 0;
  const noteEnd = (at: number, dur = 0) => {
    if (at + dur > latestEnd) latestEnd = at + dur;
  };

  // ── Steps lane ─────────────────────────────────────────────────────────────
  // Real start times when present; otherwise cumulative from `startedAt` and the
  // step durations, which is an estimate the UI is told about.
  const estimated = steps.length > 0 && !stepsHaveStartTimes;
  let cursor = startedAt ?? origin;
  const failedStepIndex = (() => {
    const explicit = steps.findIndex((s) => stepFailed(s));
    if (explicit !== -1) return explicit;
    // The last step of a failed execution is the failure when nothing is marked.
    if (steps.length > 0 && FAILED_STATUSES.has(str(input.status))) return steps.length - 1;
    return null;
  })();

  let failedStep: FailureTimeline['failedStep'] = null;
  steps.forEach((step, index) => {
    const dur = isFiniteNumber(step.duration) && step.duration >= 0 ? step.duration : 0;
    const absStart = stepsHaveStartTimes ? (step.startTime as number) : cursor;
    if (!stepsHaveStartTimes) cursor += dur;
    const at = absStart - origin;
    const failed = index === failedStepIndex;
    const label = clampLabel(str(step.title, `Step ${index + 1}`));
    lanes.steps.push({
      id: `step-${index}`,
      lane: 'steps',
      at,
      duration: dur,
      label,
      status: failed ? 'failed' : 'passed',
      kind: 'step',
      ref: { section: 'steps', index },
      ...(failed ? { failed: true } : {}),
    });
    noteEnd(at, dur);
    if (failed) failedStep = { index, label, at, duration: dur };
  });

  // ── Console lane ───────────────────────────────────────────────────────────
  consoleLogs.forEach((entry, index) => {
    const label = clampLabel(str(entry.text));
    if (!isFiniteNumber(entry.timestamp)) {
      unplaced.push({ section: 'console', label: label || `Console entry ${index + 1}`, reason: 'no timestamp' });
      return;
    }
    const at = entry.timestamp - origin;
    lanes.console.push({
      id: `console-${index}`,
      lane: 'console',
      at,
      label,
      status: str(entry.type, 'log'),
      kind: 'console',
      ref: { section: 'console', index },
    });
    noteEnd(at);
  });

  // ── Network + backend lanes ────────────────────────────────────────────────
  networkRequests.forEach((req, index) => {
    const method = str(req.method, 'GET');
    const url = str(req.url);
    const label = clampLabel(`${method} ${url}`.trim());
    const httpStatus = isFiniteNumber(req.status) ? req.status : 0;
    const dur = isFiniteNumber(req.duration) && req.duration >= 0 ? req.duration : 0;

    if (isFiniteNumber(req.startTime)) {
      const at = req.startTime - origin;
      lanes.network.push({
        id: `network-${index}`,
        lane: 'network',
        at,
        duration: dur,
        label,
        status: String(httpStatus),
        kind: 'network',
        ref: { section: 'networkRequests', index },
        ...(httpStatus >= 400 || httpStatus <= 0 ? { failed: true } : {}),
      });
      noteEnd(at, dur);
    } else {
      unplaced.push({
        section: 'networkRequests',
        label: label || `Request ${index + 1}`,
        reason: 'no start time recorded',
      });
    }

    // Backend log entries carry their own epoch timestamp and hang off the
    // request; a click on one reveals the network card the request lives in.
    rows<ServerLogRow>(req.serverLogs).forEach((log, logIndex) => {
      const message = clampLabel(str(log.message));
      if (!isFiniteNumber(log.timestamp)) {
        unplaced.push({
          section: 'backendLogs',
          label: message || `Backend log ${logIndex + 1}`,
          reason: 'no timestamp',
        });
        return;
      }
      const at = log.timestamp - origin;
      lanes.backend.push({
        id: `backend-${index}-${logIndex}`,
        lane: 'backend',
        at,
        label: message,
        status: str(log.level, 'info'),
        kind: 'backend',
        ref: { section: 'backendLogs', index },
      });
      noteEnd(at);
    });
  });

  // ── Failure moment ─────────────────────────────────────────────────────────
  // The failed step's end, else the trace anchor's end, else startedAt+duration.
  const anchorEnd = isFiniteNumber(input.traceAnchor?.failingActionEnd)
    ? (input.traceAnchor!.failingActionEnd as number)
    : null;
  let failureAt: number;
  if (failedStep) {
    failureAt = (failedStep as { at: number; duration: number }).at + (failedStep as { duration: number }).duration;
  } else if (anchorEnd != null) {
    failureAt = anchorEnd - origin;
  } else if (startedAt != null && duration != null) {
    failureAt = startedAt + duration - origin;
  } else {
    failureAt = latestEnd;
  }
  failureAt = Math.max(0, failureAt);
  noteEnd(failureAt);

  // ── Axis bounds and default window ─────────────────────────────────────────
  if (startedAt != null && duration != null) noteEnd(startedAt + duration - origin);
  const span = Math.max(latestEnd, failureAt, 0);
  const end = origin + span;

  const clamp = (value: number) => Math.max(0, Math.min(span, value));
  const window: TimelineWindow = failedStep
    ? {
        start: clamp((failedStep as { at: number }).at - TIMELINE_WINDOW_LEAD_MS),
        end: clamp(
          (failedStep as { at: number; duration: number }).at +
            (failedStep as { duration: number }).duration +
            TIMELINE_WINDOW_TRAIL_MS,
        ),
      }
    : { start: 0, end: span };

  return { origin, end, failureAt, failedStep, lanes, unplaced, estimated, window };
}
