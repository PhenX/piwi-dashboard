/**
 * The clue engine: a small, deterministic, rule-based correlation pass over one
 * failing execution's evidence. Each rule looks at facts the dashboard already
 * stores — the parsed error, the failure timeline, the network requests, the
 * ARIA snapshot, the locator-healing result, the app state, the environment
 * diff, the run's sibling and same-worker executions, and the cluster's fix
 * history — and, when its signal is present, emits a ranked, cited *clue*: a
 * one-line finding that points the reader (and the model) straight at the
 * correlation the raw error never spells out.
 *
 * Pure assembly over rows the caller has already loaded, so the server route,
 * the demo mirror, the AI-context builder and the MCP tools all build the same
 * clues. It never throws: a missing input simply disables the rules that need
 * it, and the ranked list is capped so the card and the prompt stay readable.
 *
 * Every citation's `section` uses the ids of `#shared/diagnosis-sections`, so a
 * clue doubles as an entry in the evidence list the AI result already renders —
 * a click on a citation reveals the same section the model's citations point to.
 */
import type { ParsedPlaywrightError, CallLogState } from '#shared/error-parse';
import type { FailureTimeline } from '#shared/failure-timeline';
import { TIMELINE_WINDOW_LEAD_MS } from '#shared/failure-timeline';
import type { LocatorHealingResult } from '#shared/locator-healing.types';
import type { PageStateLike } from '#shared/page-state';

/** The environment-diff facts the engine reads — the pure subset of the server result. */
export interface FailureClueEnvironmentDiff {
  status: 'ok' | 'no-baseline' | 'not-found';
  /** Changed keys only; empty means the environment matched the last pass. */
  entries?: Array<{ key: string; label?: string | null }> | null;
}

/** The page-diff facts the engine reads — the change (if any) at the failing locator's node. */
export interface FailureCluePageDiff {
  /** The hunk the failing locator maps to, or null when the locator maps to no change. */
  locatorChange: { type: string; role: string; name: string | null; oldName?: string | null } | null;
}

/** The rule that produced a clue — stable ids, used for ordering and tests. */
export type FailureClueRule =
  | 'failed-request-before-failure'
  | 'slow-request-overlapping-failure'
  | 'console-mentions-target'
  | 'backend-error-attached'
  | 'element-renamed'
  | 'page-structure-changed'
  | 'element-present-but-blocked'
  | 'wrong-page'
  | 'worker-pollution'
  | 'timeout-budget'
  | 'environment-changed'
  | 'browser-specific'
  | 'fixed-before';

/** How strongly a clue points at the cause; drives ranking and the strength chip. */
export type FailureClueStrength = 'strong' | 'medium' | 'weak';

/** A pointer from a clue to the evidence section that backs it. */
export interface FailureClueCitation {
  /** A `#shared/diagnosis-sections` id — the same ids the AI citations use. */
  section: string;
  /** Index within that section's list, when the clue points at one entry. */
  index?: number;
}

export interface FailureClue {
  /** Stable, unique per execution (the rule id, suffixed when a rule fires twice). */
  id: string;
  rule: FailureClueRule;
  strength: FailureClueStrength;
  /** The finding in a few words. */
  title: string;
  /** The supporting detail — names, values, and the timing when anchored. */
  detail: string;
  citations: FailureClueCitation[];
  /** When anchored in time: ms relative to the execution start (the timeline origin). */
  at?: number;
}

/** One network request, as the handler loads it (epoch ms `startTime`). */
export interface FailureClueNetworkRequest {
  method?: string | null;
  url?: string | null;
  status?: number | null;
  duration?: number | null;
  startTime?: number | null;
  serverLogs?: Array<{ level?: string | null; message?: string | null; timestamp?: number | null }> | null;
}

/** One console entry in the execution, with its epoch-ms timestamp. */
export interface FailureClueConsoleEntry {
  type?: string | null;
  text?: string | null;
  timestamp?: number | null;
}

/** One sibling execution of the same test in this run, on a given browser. */
export interface FailureClueBrowserPeer {
  browser?: string | null;
  browserName?: string | null;
  status?: string | null;
}

/** One execution on the same worker in this run, ordered by `startedAt`. */
export interface FailureClueWorkerExecution {
  id: number;
  testCaseId: number;
  title?: string | null;
  status?: string | null;
  /** Epoch ms; used only to order executions around this one. */
  startedAt?: number | null;
}

/** The cluster's recorded fix history, when this failure belongs to a cluster. */
export interface FailureClueClusterFix {
  fixCommit?: string | null;
  fixLandedRunId?: number | null;
  fixVerification?: string | null;
}

export interface FailureClueInput {
  /** This execution's id and identity — anchors the worker/browser rules. */
  execution: {
    id: number;
    testCaseId: number;
    status?: string | null;
    duration?: number | null;
    browser?: string | null;
    browserName?: string | null;
    startedAt?: number | null;
  };
  parsedError: ParsedPlaywrightError | null;
  timeline: FailureTimeline | null;
  healing: LocatorHealingResult | null;
  ariaSnapshot: string | null;
  appState: PageStateLike | null;
  environmentDiff: FailureClueEnvironmentDiff | null;
  /** The structural page diff against the last green sample, when one exists. */
  pageDiff?: FailureCluePageDiff | null;
  networkRequests: FailureClueNetworkRequest[];
  consoleLogs: FailureClueConsoleEntry[];
  /** Sibling executions of this test in this run, one per browser. */
  browserPeers: FailureClueBrowserPeer[];
  /** Executions on the same worker in this run, ordered by `startedAt`. */
  workerExecutions: FailureClueWorkerExecution[];
  cluster: FailureClueClusterFix | null;
  /** Effective per-test timeout in ms; 0/nullish disables the budget rule. */
  timeout: number | null;
  /** The slow-request threshold; defaults to 1500 ms. */
  slowRequestMs?: number | null;
}

/** The most a clue list ever carries — keeps the card and the prompt readable. */
const MAX_CLUES = 8;

const DEFAULT_SLOW_REQUEST_MS = 1500;

/** Rule precedence for the final tiebreak, in the order the rules are declared. */
const RULE_ORDER: FailureClueRule[] = [
  'failed-request-before-failure',
  'slow-request-overlapping-failure',
  'console-mentions-target',
  'backend-error-attached',
  'element-renamed',
  'page-structure-changed',
  'element-present-but-blocked',
  'wrong-page',
  'worker-pollution',
  'timeout-budget',
  'environment-changed',
  'browser-specific',
  'fixed-before',
];

const STRENGTH_RANK: Record<FailureClueStrength, number> = { strong: 0, medium: 1, weak: 2 };

/** Call-log states that mean the element resolved but could not be acted on. */
const BLOCKED_STATES = new Set<CallLogState>(['not-enabled', 'hidden', 'not-visible', 'intercepts-pointer']);

/** Path prefixes that mean the test ended somewhere other than the app it drives. */
const WRONG_PAGE_PATHS = ['/login', '/signin', '/auth', '/error', '/404', '/not-found'];

const FAILED_PEER_STATUSES = new Set(['failed', 'timedout', 'timedOut', 'interrupted']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The pathname of a captured URL, tolerant of relative or malformed values. */
function pathOf(url: string | null | undefined): string | null {
  const raw = str(url).trim();
  if (!raw) return null;
  try {
    return new URL(raw, 'http://x').pathname || null;
  } catch {
    const noQuery = raw.split(/[?#]/)[0] ?? raw;
    const afterHost = noQuery.replace(/^[a-z]+:\/\/[^/]+/i, '');
    return afterHost.startsWith('/') ? afterHost : `/${afterHost}`;
  }
}

/** `t-1.1 s` style lead, or empty when the anchor is at/after the failure. */
function formatLead(at: number, failureAt: number): string {
  const lead = failureAt - at;
  if (!Number.isFinite(lead) || lead <= 0) return '';
  return `${(lead / 1000).toFixed(1)} s before the failure`;
}

/** A short, single-line form of the failing locator's identity. */
interface LocatorTarget {
  /** The accessible name / text the locator was built around, lower-cased. */
  name: string | null;
  /** The role, when the error names one. */
  role: string | null;
  /** The test id, when the error names one. */
  testId: string | null;
}

/** Pull the name/role/testId the failing locator was built from. */
function readLocatorTarget(parsed: ParsedPlaywrightError | null): LocatorTarget {
  const locator = parsed?.leafLocator ?? parsed?.locator ?? null;
  if (!locator) return { name: null, role: null, testId: null };
  const role = /getByRole\(\s*['"`]([^'"`]+)['"`]/.exec(locator)?.[1] ?? null;
  const name =
    /\bname:\s*['"`]([^'"`]+)['"`]/.exec(locator)?.[1] ??
    /getBy(?:Text|Label|Placeholder|AltText|Title)\(\s*['"`]([^'"`]+)['"`]/.exec(locator)?.[1] ??
    null;
  const testId = /getByTestId\(\s*['"`]([^'"`]+)['"`]/.exec(locator)?.[1] ?? null;
  return { name: name ? name.toLowerCase() : null, role, testId };
}

export function buildFailureClues(input: FailureClueInput): FailureClue[] {
  const clues: FailureClue[] = [];
  const add = (clue: FailureClue) => clues.push(clue);

  const timeline = input.timeline;
  const origin = timeline?.origin ?? null;
  const failureAt = timeline ? timeline.failureAt : null;
  const slowMs =
    isFiniteNumber(input.slowRequestMs) && input.slowRequestMs > 0 ? input.slowRequestMs : DEFAULT_SLOW_REQUEST_MS;
  const parsed = input.parsedError;

  // Requests positioned in the timeline frame (ms relative to origin), keeping
  // the raw index so a citation can point back at the network card entry.
  const positionedRequests =
    origin != null
      ? input.networkRequests.map((req, index) => {
          const startAt = isFiniteNumber(req.startTime) ? req.startTime - origin : null;
          const dur = isFiniteNumber(req.duration) && req.duration >= 0 ? req.duration : 0;
          return { req, index, startAt, endAt: startAt != null ? startAt + dur : null, dur };
        })
      : [];

  const windowStart = timeline ? timeline.window.start : null;
  const windowEnd = timeline ? timeline.window.end : null;
  const inWindow = (at: number | null): boolean =>
    at != null && windowStart != null && windowEnd != null && at >= windowStart && at <= windowEnd;

  // ── failed-request-before-failure (strong) ─────────────────────────────────
  // A 5xx/aborted request that ended within the lead window before the failure.
  if (failureAt != null) {
    const leadStart = failureAt - TIMELINE_WINDOW_LEAD_MS;
    const failedRequests = positionedRequests
      .filter((p) => {
        const status = isFiniteNumber(p.req.status) ? p.req.status : 0;
        const bad = status >= 500 || status <= 0;
        return bad && p.endAt != null && p.endAt <= failureAt && p.endAt >= leadStart;
      })
      .sort((a, b) => (b.endAt ?? 0) - (a.endAt ?? 0));
    failedRequests.slice(0, 2).forEach((p, i) => {
      const method = str(p.req.method) || 'GET';
      const path = pathOf(p.req.url) ?? str(p.req.url) ?? '(unknown)';
      const status = isFiniteNumber(p.req.status) ? p.req.status : 0;
      const statusText = status <= 0 ? 'was aborted' : `returned ${status}`;
      const lead = p.endAt != null && failureAt != null ? formatLead(p.endAt, failureAt) : '';
      add({
        id: i === 0 ? 'failed-request-before-failure' : `failed-request-before-failure-${i}`,
        rule: 'failed-request-before-failure',
        strength: 'strong',
        title: `${method} ${path} ${statusText}`,
        detail: `${method} ${path} ${statusText}${lead ? `, ${lead}` : ''}.`,
        citations: [{ section: 'networkRequests', index: p.index }],
        ...(p.endAt != null ? { at: p.endAt } : {}),
      });
    });
  }

  // ── slow-request-overlapping-failure (medium) ──────────────────────────────
  // A request slower than the threshold that was in flight during the failed step.
  const failedStep = timeline?.failedStep ?? null;
  if (failedStep && positionedRequests.length > 0) {
    const stepStart = failedStep.at;
    const stepEnd = failedStep.at + failedStep.duration;
    const slow = positionedRequests
      .filter(
        (p) => p.startAt != null && p.endAt != null && p.dur >= slowMs && p.startAt <= stepEnd && p.endAt >= stepStart,
      )
      .sort((a, b) => b.dur - a.dur);
    const p = slow[0];
    if (p) {
      const method = str(p.req.method) || 'GET';
      const path = pathOf(p.req.url) ?? str(p.req.url) ?? '(unknown)';
      add({
        id: 'slow-request-overlapping-failure',
        rule: 'slow-request-overlapping-failure',
        strength: 'medium',
        title: `${method} ${path} was still in flight`,
        detail: `${method} ${path} took ${(p.dur / 1000).toFixed(1)} s and was still in flight during the failed step.`,
        citations: [{ section: 'networkRequests', index: p.index }],
        ...(p.startAt != null ? { at: p.startAt } : {}),
      });
    }
  }

  // ── console-mentions-target (strong error / medium warning) ────────────────
  // A console entry in the window that names the failing locator or route.
  const target = readLocatorTarget(parsed);
  const routePath = pathOf(input.appState?.url) ?? pathOf(parsed?.url);
  const needles = [target.name, target.testId, routePath].filter((n): n is string => Boolean(n && n.length >= 3));
  if (needles.length > 0 && input.consoleLogs.length > 0 && origin != null) {
    const match = input.consoleLogs
      .map((entry, index) => ({ entry, index, at: isFiniteNumber(entry.timestamp) ? entry.timestamp - origin : null }))
      .filter((c) => inWindow(c.at))
      .find((c) => {
        const text = str(c.entry.text).toLowerCase();
        return needles.some((n) => text.includes(n.toLowerCase()));
      });
    if (match) {
      const type = str(match.entry.type).toLowerCase();
      const isError = type === 'error';
      const isWarning = type === 'warning' || type === 'warn';
      if (isError || isWarning) {
        add({
          id: 'console-mentions-target',
          rule: 'console-mentions-target',
          strength: isError ? 'strong' : 'medium',
          title: `Console ${isError ? 'error' : 'warning'} names the failing target`,
          detail: `A console ${isError ? 'error' : 'warning'} in the failure window mentions ${
            target.name ? `"${target.name}"` : (target.testId ?? routePath)
          }: "${str(match.entry.text).slice(0, 140)}".`,
          citations: [{ section: 'console', index: match.index }],
          ...(match.at != null ? { at: match.at } : {}),
        });
      }
    }
  }

  // ── backend-error-attached (strong) ────────────────────────────────────────
  // A request in the window whose backend logs carry an error-level entry.
  if (origin != null) {
    for (const p of positionedRequests) {
      if (!inWindow(p.startAt) && !inWindow(p.endAt)) continue;
      const logs = Array.isArray(p.req.serverLogs) ? p.req.serverLogs : [];
      const errorLog = logs.find((l) => str(l?.level).toLowerCase() === 'error');
      if (errorLog) {
        const method = str(p.req.method) || 'GET';
        const path = pathOf(p.req.url) ?? str(p.req.url) ?? '(unknown)';
        add({
          id: 'backend-error-attached',
          rule: 'backend-error-attached',
          strength: 'strong',
          title: `Backend error on ${method} ${path}`,
          detail: `The backend logged an error while serving ${method} ${path}: "${str(errorLog.message).slice(0, 140)}".`,
          citations: [{ section: 'serverLogs', index: p.index }],
          ...(p.startAt != null ? { at: p.startAt } : {}),
        });
        break;
      }
    }
  }

  // ── element-renamed (strong) ───────────────────────────────────────────────
  // Healing found the element under a new identity, or flagged the stored name
  // as stale while still recommending a fix.
  const healing = input.healing;
  if (healing) {
    const renamed =
      healing.source === 'element-match' ||
      (healing.priorNameMayBeStale === true && healing.recommendation?.recommended != null);
    if (renamed) {
      const rec = healing.recommendation?.recommended;
      add({
        id: 'element-renamed',
        rule: 'element-renamed',
        strength: 'strong',
        title: 'The element was renamed or moved',
        detail: rec
          ? `The failing locator no longer matches; the same element is now reachable as \`${rec.locator}\`.`
          : 'The failing locator no longer matches — the element it named appears to have been renamed or moved.',
        citations: [{ section: 'locatorHealing' }],
      });
    }
  }

  // ── page-structure-changed (strong) ────────────────────────────────────────
  // The page diff against the last green sample shows the failing locator's node
  // was removed or renamed — a structural change that explains the broken locator.
  const locatorChange = input.pageDiff?.locatorChange;
  if (locatorChange && (locatorChange.type === 'removed' || locatorChange.type === 'renamed')) {
    const node = locatorChange.name ? `${locatorChange.role} "${locatorChange.name}"` : locatorChange.role;
    add({
      id: 'page-structure-changed',
      rule: 'page-structure-changed',
      strength: 'strong',
      title: 'The page structure changed near the failing locator',
      detail:
        locatorChange.type === 'renamed'
          ? `Since the last passing run the ${locatorChange.role} the locator names was renamed from "${locatorChange.oldName}" to "${locatorChange.name}".`
          : `Since the last passing run the ${node} the locator names was removed from the page.`,
      citations: [{ section: 'pageDiff' }],
    });
  }

  // ── element-present-but-blocked (strong) ───────────────────────────────────
  // The call log says the element resolved but was not actionable, and the ARIA
  // snapshot still shows one with the failing role and name.
  if (parsed && BLOCKED_STATES.has(parsed.lastState)) {
    const aria = str(input.ariaSnapshot).toLowerCase();
    const roleName = target.role ? target.role.toLowerCase() : null;
    const nameNeedle = target.name;
    const present =
      aria.length > 0 &&
      (!roleName || aria.includes(roleName)) &&
      (!nameNeedle || aria.includes(nameNeedle)) &&
      (roleName != null || nameNeedle != null);
    if (present) {
      const stateLabel: Record<string, string> = {
        'not-enabled': 'disabled',
        hidden: 'hidden',
        'not-visible': 'not visible',
        'intercepts-pointer': 'covered by another element',
      };
      const label = stateLabel[parsed.lastState] ?? parsed.lastState;
      add({
        id: 'element-present-but-blocked',
        rule: 'element-present-but-blocked',
        strength: 'strong',
        title: `The element is present but ${label}`,
        detail: `The ${target.role ?? 'element'}${target.name ? ` "${target.name}"` : ''} is in the accessibility tree, but the action failed because it was ${label} — not because it was missing.`,
        citations: [{ section: 'ariaSnapshot' }, { section: 'executionError' }],
      });
    }
  }

  // ── wrong-page (strong) ────────────────────────────────────────────────────
  // The page ended on an auth/error route, or somewhere other than the last
  // navigation the test asked for.
  const endedPath = pathOf(input.appState?.url);
  if (endedPath) {
    const onKnownWrong = WRONG_PAGE_PATHS.find((p) => endedPath === p || endedPath.startsWith(`${p}/`));
    const lastNav = lastNavigationPath(timeline);
    const driftedFromNav = lastNav && pathsDiffer(endedPath, lastNav);
    if (onKnownWrong || driftedFromNav) {
      add({
        id: 'wrong-page',
        rule: 'wrong-page',
        strength: 'strong',
        title: `The test ended on ${endedPath}`,
        detail: onKnownWrong
          ? `At the moment of failure the page was on ${endedPath} — an authentication or error page, not the app under test.`
          : `At the moment of failure the page was on ${endedPath}, not ${lastNav} where the last navigation went.`,
        citations: [{ section: 'appState' }],
      });
    }
  }

  // ── worker-pollution (medium) ──────────────────────────────────────────────
  // The execution that ran just before this one on the same worker failed.
  if (input.workerExecutions.length > 1) {
    const ordered = [...input.workerExecutions]
      .filter((e) => isFiniteNumber(e.startedAt))
      .sort((a, b) => (a.startedAt as number) - (b.startedAt as number));
    const selfIdx = ordered.findIndex((e) => e.id === input.execution.id);
    const previous = selfIdx > 0 ? ordered[selfIdx - 1] : null;
    if (previous && FAILED_PEER_STATUSES.has(str(previous.status))) {
      add({
        id: 'worker-pollution',
        rule: 'worker-pollution',
        strength: 'medium',
        title: 'The previous test on this worker failed',
        detail: `"${str(previous.title) || 'the previous test'}" ran just before this one on the same worker and ${
          str(previous.status) === 'timedout' || str(previous.status) === 'timedOut' ? 'timed out' : 'failed'
        } — shared state it left behind is a classic cross-test cause.`,
        citations: [{ section: 'runContext' }],
      });
    }
  }

  // ── timeout-budget (medium) ────────────────────────────────────────────────
  // The failed step, or the whole execution, spent most of the timeout budget.
  const timeout = isFiniteNumber(input.timeout) && input.timeout > 0 ? input.timeout : null;
  if (timeout) {
    const stepDur = failedStep?.duration ?? null;
    const execDur = isFiniteNumber(input.execution.duration) ? input.execution.duration : null;
    const stepRatio = stepDur != null ? stepDur / timeout : 0;
    const execRatio = execDur != null ? execDur / timeout : 0;
    if (stepRatio >= 0.8 || execRatio >= 0.95) {
      const pct = Math.round(Math.max(stepRatio, execRatio) * 100);
      add({
        id: 'timeout-budget',
        rule: 'timeout-budget',
        strength: 'medium',
        title: `The failure used ${pct}% of the timeout budget`,
        detail:
          stepRatio >= 0.8
            ? `The failed step ran ${Math.round(stepRatio * 100)}% of the ${timeout} ms timeout — a slow operation, not necessarily a wrong one.`
            : `The execution used ${Math.round(execRatio * 100)}% of the ${timeout} ms timeout before failing.`,
        citations: [{ section: 'steps' }],
        ...(failedStep ? { at: failedStep.at } : {}),
      });
    }
  }

  // ── environment-changed (medium / weak) ────────────────────────────────────
  // The same-environment baseline differs from this run's environment.
  const envDiff = input.environmentDiff;
  if (envDiff && envDiff.status === 'ok' && envDiff.entries && envDiff.entries.length > 0) {
    const onlyEnvLabel = envDiff.entries.length === 1 && envDiff.entries[0]!.key === 'environment';
    const shown = envDiff.entries
      .slice(0, 3)
      .map((e) => e.label ?? e.key)
      .join(', ');
    add({
      id: 'environment-changed',
      rule: 'environment-changed',
      strength: onlyEnvLabel ? 'weak' : 'medium',
      title: 'The environment changed since the last pass',
      detail: `Compared to the last passing run in the same environment: ${shown}.`,
      citations: [{ section: 'environmentDiff' }],
    });
  }

  // ── browser-specific (medium) ──────────────────────────────────────────────
  // The same test passed on at least one other browser in this run.
  const selfBrowser = input.execution.browser ?? input.execution.browserName ?? null;
  const passedElsewhere = input.browserPeers.filter(
    (peer) =>
      str(peer.status) === 'passed' &&
      (peer.browser ?? peer.browserName ?? null) !== selfBrowser &&
      (peer.browser ?? peer.browserName ?? null) != null,
  );
  if (passedElsewhere.length > 0) {
    const names = passedElsewhere.map((p) => str(p.browser) || str(p.browserName)).filter(Boolean);
    add({
      id: 'browser-specific',
      rule: 'browser-specific',
      strength: 'medium',
      title: 'The test passed on another browser',
      detail: `The same test passed on ${names.join(', ') || 'another browser'} in this run — the failure is browser-specific, not a universal break.`,
      citations: [{ section: 'browserDistribution' }],
    });
  }

  // ── fixed-before (weak) ────────────────────────────────────────────────────
  // A cluster that recorded a fix has regressed.
  const cluster = input.cluster;
  if (
    cluster &&
    cluster.fixVerification === 'regressed' &&
    (str(cluster.fixCommit).length > 0 || cluster.fixLandedRunId != null)
  ) {
    const commit = str(cluster.fixCommit);
    add({
      id: 'fixed-before',
      rule: 'fixed-before',
      strength: 'weak',
      title: 'This failure was fixed before and has come back',
      detail: commit
        ? `This cluster was verified fixed by commit ${commit.slice(0, 7)} and has regressed — the earlier fix did not hold.`
        : 'This cluster was verified fixed in an earlier run and has regressed — the earlier fix did not hold.',
      citations: [{ section: 'priorDiagnosis' }],
    });
  }

  // Rank: strength first, then proximity to the failure moment (anchored clues
  // closest to the failure win; unanchored clues sort after them), then the
  // fixed rule order. Cap so the card and the prompt stay readable.
  const ruleRank = new Map(RULE_ORDER.map((r, i) => [r, i]));
  clues.sort((a, b) => {
    const strengthDelta = STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength];
    if (strengthDelta !== 0) return strengthDelta;
    const aAnchored = a.at != null && failureAt != null;
    const bAnchored = b.at != null && failureAt != null;
    if (aAnchored && bAnchored) {
      const proximity = Math.abs(failureAt! - a.at!) - Math.abs(failureAt! - b.at!);
      if (proximity !== 0) return proximity;
    } else if (aAnchored !== bAnchored) {
      return aAnchored ? -1 : 1;
    }
    return (ruleRank.get(a.rule) ?? 99) - (ruleRank.get(b.rule) ?? 99);
  });

  return clues.slice(0, MAX_CLUES);
}

/** The path of the last navigation step the test performed, from the timeline. */
function lastNavigationPath(timeline: FailureTimeline | null): string | null {
  if (!timeline) return null;
  const steps = timeline.lanes.steps;
  for (let i = steps.length - 1; i >= 0; i--) {
    const label = steps[i]!.label;
    const m = /(?:goto|waitForURL)\(\s*['"`]([^'"`]+)['"`]/.exec(label) ?? /https?:\/\/[^\s'"`)]+/.exec(label);
    if (m) return pathOf(m[1] ?? m[0]);
  }
  return null;
}

/** Two paths differ once trailing slashes are ignored. */
function pathsDiffer(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  return norm(a) !== norm(b);
}
