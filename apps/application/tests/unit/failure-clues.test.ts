import { describe, test, expect } from 'vitest';
import { buildFailureClues, type FailureClueInput } from '#shared/failure-clues';
import { buildFailureTimeline, type FailureTimelineInput } from '#shared/failure-timeline';
import { parsePlaywrightError } from '#shared/error-parse';

const T0 = 1_700_000_000_000;

/** A failing execution with a navigate step and a failed click on `Pay`. */
function timelineInput(overrides: Partial<FailureTimelineInput> = {}): FailureTimelineInput {
  return {
    startedAt: T0,
    duration: 5_000,
    timeout: 30_000,
    status: 'failed',
    steps: [
      { title: "page.goto('/checkout')", category: 'action', duration: 1_000, startTime: T0 },
      {
        title: "locator.click getByRole('button', { name: 'Pay' })",
        category: 'action',
        duration: 3_500,
        startTime: T0 + 1_500,
        error: 'element is not enabled',
      },
    ],
    ...overrides,
  };
}

const PAY_ERROR = [
  'locator.click: Timeout 30000ms exceeded.',
  'Call log:',
  "  - waiting for getByRole('button', { name: 'Pay' })",
  '  - element is not enabled',
].join('\n');

/** A benign clue input: a valid timeline, no triggering signals. */
function baseInput(overrides: Partial<FailureClueInput> = {}): FailureClueInput {
  const timeline = buildFailureTimeline(timelineInput());
  return {
    execution: { id: 10, testCaseId: 1, status: 'failed', duration: 5_000, browser: 'chromium', startedAt: T0 },
    parsedError: parsePlaywrightError(PAY_ERROR),
    timeline,
    healing: null,
    ariaSnapshot: null,
    appState: null,
    environmentDiff: null,
    networkRequests: [],
    consoleLogs: [],
    browserPeers: [],
    workerExecutions: [],
    cluster: null,
    timeout: 30_000,
    slowRequestMs: 1_500,
    ...overrides,
  };
}

function rules(input: FailureClueInput): string[] {
  return buildFailureClues(input).map((c) => c.rule);
}

describe('buildFailureClues — robustness', () => {
  test('empty input never throws and yields no clues', () => {
    const clues = buildFailureClues({
      execution: { id: 1, testCaseId: 1 },
      parsedError: null,
      timeline: null,
      healing: null,
      ariaSnapshot: null,
      appState: null,
      environmentDiff: null,
      networkRequests: [],
      consoleLogs: [],
      browserPeers: [],
      workerExecutions: [],
      cluster: null,
      timeout: null,
    });
    expect(clues).toEqual([]);
  });

  test('caps the ranked list at 8 clues', () => {
    // Fire many rules at once and assert the cap holds.
    const timeline = buildFailureTimeline(
      timelineInput({
        networkRequests: [{ method: 'GET', url: '/api/quote', status: 504, duration: 2_000, startTime: T0 + 2_000 }],
      }),
    );
    const input = baseInput({
      timeline,
      networkRequests: [
        {
          method: 'GET',
          url: '/api/quote',
          status: 504,
          duration: 2_000,
          startTime: T0 + 2_000,
          serverLogs: [{ level: 'error', message: 'upstream 500', timestamp: T0 + 3_000 }],
        },
      ],
      ariaSnapshot: 'button "Pay" [disabled]',
      appState: { url: 'https://app.test/login' },
      environmentDiff: { status: 'ok', entries: [{ key: 'viewport', label: 'Viewport' }] },
      browserPeers: [
        { browser: 'chromium', status: 'failed' },
        { browser: 'firefox', status: 'passed' },
      ],
      workerExecutions: [
        { id: 9, testCaseId: 2, title: 'prior test', status: 'failed', startedAt: T0 - 1_000 },
        { id: 10, testCaseId: 1, title: 'this test', status: 'failed', startedAt: T0 },
      ],
      cluster: { fixCommit: 'abc1234def', fixLandedRunId: 3, fixVerification: 'regressed' },
      consoleLogs: [{ type: 'error', text: 'Pay button stays disabled', timestamp: T0 + 3_000 }],
    });
    expect(buildFailureClues(input).length).toBeLessThanOrEqual(8);
  });

  test('ranks strong clues before weaker ones', () => {
    const input = baseInput({
      environmentDiff: { status: 'ok', entries: [{ key: 'viewport', label: 'Viewport' }] }, // medium
      cluster: { fixCommit: 'abc1234', fixLandedRunId: 3, fixVerification: 'regressed' }, // weak
      networkRequests: [{ method: 'POST', url: '/api/pay', status: 500, duration: 200, startTime: T0 + 4_500 }], // strong
    });
    const ordered = buildFailureClues(input);
    expect(ordered[0]!.strength).toBe('strong');
    expect(ordered[ordered.length - 1]!.strength).toBe('weak');
  });
});

describe('failed-request-before-failure', () => {
  test('positive: a 5xx request that ended in the lead window', () => {
    const input = baseInput({
      networkRequests: [{ method: 'GET', url: '/api/quote', status: 504, duration: 1_500, startTime: T0 + 2_000 }],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'failed-request-before-failure');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.detail).toContain('/api/quote');
    expect(clue!.detail).toContain('504');
    expect(clue!.citations[0]).toEqual({ section: 'networkRequests', index: 0 });
  });

  test('negative: a 200 request in the same window does not fire', () => {
    const input = baseInput({
      networkRequests: [{ method: 'GET', url: '/api/quote', status: 200, duration: 1_500, startTime: T0 + 2_000 }],
    });
    expect(rules(input)).not.toContain('failed-request-before-failure');
  });
});

describe('slow-request-overlapping-failure', () => {
  test('positive: a request slower than the threshold overlapping the failed step', () => {
    const input = baseInput({
      networkRequests: [{ method: 'GET', url: '/api/slow', status: 200, duration: 3_000, startTime: T0 + 1_800 }],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'slow-request-overlapping-failure');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('medium');
    expect(clue!.detail).toContain('/api/slow');
  });

  test('negative: a fast request does not fire', () => {
    const input = baseInput({
      networkRequests: [{ method: 'GET', url: '/api/fast', status: 200, duration: 200, startTime: T0 + 1_800 }],
    });
    expect(rules(input)).not.toContain('slow-request-overlapping-failure');
  });
});

describe('console-mentions-target', () => {
  test('positive: a console error naming the failing locator', () => {
    const input = baseInput({
      consoleLogs: [{ type: 'error', text: 'The Pay button stays disabled after quote', timestamp: T0 + 3_000 }],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'console-mentions-target');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.citations[0]).toEqual({ section: 'console', index: 0 });
  });

  test('a warning that names the target is medium strength', () => {
    const input = baseInput({
      consoleLogs: [{ type: 'warning', text: 'Pay still pending', timestamp: T0 + 3_000 }],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'console-mentions-target');
    expect(clue?.strength).toBe('medium');
  });

  test('negative: an unrelated console error does not fire', () => {
    const input = baseInput({
      consoleLogs: [{ type: 'error', text: 'favicon.ico failed to load', timestamp: T0 + 3_000 }],
    });
    expect(rules(input)).not.toContain('console-mentions-target');
  });
});

describe('page-structure-changed', () => {
  test('positive: the failing locator maps to a renamed node in the page diff', () => {
    const input = baseInput({
      pageDiff: {
        locatorChange: { type: 'renamed', role: 'button', name: 'Pay now', oldName: 'Pay' },
      },
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'page-structure-changed');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.detail).toContain('"Pay"');
    expect(clue!.citations[0]!.section).toBe('pageDiff');
  });

  test('positive: a removed node the locator names', () => {
    const input = baseInput({
      pageDiff: { locatorChange: { type: 'removed', role: 'button', name: 'Refresh', oldName: null } },
    });
    expect(rules(input)).toContain('page-structure-changed');
  });

  test('negative: a moved node is not a broken-locator signal', () => {
    const input = baseInput({
      pageDiff: { locatorChange: { type: 'moved', role: 'button', name: 'Pay', oldName: null } },
    });
    expect(rules(input)).not.toContain('page-structure-changed');
  });

  test('negative: no locator change means no clue', () => {
    expect(rules(baseInput({ pageDiff: { locatorChange: null } }))).not.toContain('page-structure-changed');
    expect(rules(baseInput())).not.toContain('page-structure-changed');
  });
});

describe('backend-error-attached', () => {
  test('positive: a request in the window with an error-level server log', () => {
    const input = baseInput({
      networkRequests: [
        {
          method: 'POST',
          url: '/api/pay',
          status: 200,
          duration: 300,
          startTime: T0 + 2_000,
          serverLogs: [{ level: 'error', message: 'NullPointer in PaymentService', timestamp: T0 + 2_100 }],
        },
      ],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'backend-error-attached');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.citations[0]).toEqual({ section: 'serverLogs', index: 0 });
  });

  test('negative: only info-level server logs do not fire', () => {
    const input = baseInput({
      networkRequests: [
        {
          method: 'POST',
          url: '/api/pay',
          status: 200,
          duration: 300,
          startTime: T0 + 2_000,
          serverLogs: [{ level: 'info', message: 'handled payment', timestamp: T0 + 2_100 }],
        },
      ],
    });
    expect(rules(input)).not.toContain('backend-error-attached');
  });
});

describe('element-renamed', () => {
  test('positive: healing reports an element-match rename', () => {
    const input = baseInput({
      healing: {
        source: 'element-match',
        failingLocator: { method: 'getByRole', args: {} },
        fromPriorSuccess: null,
        fromElementMatch: [{ locator: "getByTestId('pay')", method: 'getByTestId', args: {}, score: 100 }],
        fromAriaSnapshot: null,
        recommendation: {
          recommended: { locator: "getByTestId('pay')", method: 'getByTestId', args: {}, score: 100 },
          durable: null,
          preservesConvention: false,
          hasDurableAlternative: false,
          suggestAddTestId: false,
        },
        capturedAt: null,
      },
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'element-renamed');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.citations[0]).toEqual({ section: 'locatorHealing' });
  });

  test('negative: a prior-run healing with no stale flag does not fire', () => {
    const input = baseInput({
      healing: {
        source: 'prior-run',
        failingLocator: { method: 'getByRole', args: {} },
        fromPriorSuccess: [{ locator: "getByTestId('pay')", method: 'getByTestId', args: {}, score: 100 }],
        fromElementMatch: null,
        fromAriaSnapshot: null,
        recommendation: {
          recommended: { locator: "getByTestId('pay')", method: 'getByTestId', args: {}, score: 100 },
          durable: null,
          preservesConvention: true,
          hasDurableAlternative: false,
          suggestAddTestId: false,
        },
        capturedAt: null,
      },
    });
    expect(rules(input)).not.toContain('element-renamed');
  });
});

describe('element-present-but-blocked', () => {
  test('positive: a not-enabled state with the element in the ARIA snapshot', () => {
    const input = baseInput({
      ariaSnapshot: '- button "Pay" [disabled]\n- textbox "Card number"',
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'element-present-but-blocked');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.citations.map((c) => c.section)).toContain('ariaSnapshot');
  });

  test('negative: the element is absent from the ARIA snapshot', () => {
    const input = baseInput({
      ariaSnapshot: '- heading "Sign in"\n- textbox "Email"',
    });
    expect(rules(input)).not.toContain('element-present-but-blocked');
  });
});

describe('wrong-page', () => {
  test('positive: the page ended on /login', () => {
    const input = baseInput({ appState: { url: 'https://app.test/login?next=/checkout' } });
    const clue = buildFailureClues(input).find((c) => c.rule === 'wrong-page');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('strong');
    expect(clue!.detail).toContain('/login');
    expect(clue!.citations[0]).toEqual({ section: 'appState' });
  });

  test('positive: the page drifted away from the last navigation target', () => {
    const input = baseInput({ appState: { url: 'https://app.test/session-expired' } });
    const clue = buildFailureClues(input).find((c) => c.rule === 'wrong-page');
    expect(clue).toBeTruthy();
  });

  test('negative: the page stayed on the navigated route', () => {
    const input = baseInput({ appState: { url: 'https://app.test/checkout' } });
    expect(rules(input)).not.toContain('wrong-page');
  });
});

describe('worker-pollution', () => {
  test('positive: the previous execution on the worker failed', () => {
    const input = baseInput({
      workerExecutions: [
        { id: 9, testCaseId: 2, title: 'leaves a modal open', status: 'failed', startedAt: T0 - 2_000 },
        { id: 10, testCaseId: 1, title: 'this test', status: 'failed', startedAt: T0 },
      ],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'worker-pollution');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('medium');
    expect(clue!.detail).toContain('leaves a modal open');
    expect(clue!.citations[0]).toEqual({ section: 'runContext' });
  });

  test('negative: the previous execution on the worker passed', () => {
    const input = baseInput({
      workerExecutions: [
        { id: 9, testCaseId: 2, title: 'passing test', status: 'passed', startedAt: T0 - 2_000 },
        { id: 10, testCaseId: 1, title: 'this test', status: 'failed', startedAt: T0 },
      ],
    });
    expect(rules(input)).not.toContain('worker-pollution');
  });
});

describe('timeout-budget', () => {
  test('positive: the failed step used most of the timeout', () => {
    // Failed step 3500ms of a 4000ms timeout → 87%.
    const input = baseInput({ timeout: 4_000 });
    const clue = buildFailureClues(input).find((c) => c.rule === 'timeout-budget');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('medium');
    expect(clue!.citations[0]).toEqual({ section: 'steps' });
  });

  test('negative: a small share of a generous timeout does not fire', () => {
    const input = baseInput({ timeout: 30_000 });
    expect(rules(input)).not.toContain('timeout-budget');
  });
});

describe('environment-changed', () => {
  test('positive: a non-empty same-environment diff', () => {
    const input = baseInput({
      environmentDiff: { status: 'ok', entries: [{ key: 'viewport', label: 'Viewport' }] },
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'environment-changed');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('medium');
    expect(clue!.citations[0]).toEqual({ section: 'environmentDiff' });
  });

  test('an environment-label-only diff is weak', () => {
    const input = baseInput({
      environmentDiff: { status: 'ok', entries: [{ key: 'environment', label: 'Environment label' }] },
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'environment-changed');
    expect(clue?.strength).toBe('weak');
  });

  test('negative: an identical environment does not fire', () => {
    const input = baseInput({ environmentDiff: { status: 'ok', entries: [] } });
    expect(rules(input)).not.toContain('environment-changed');
  });
});

describe('browser-specific', () => {
  test('positive: the same test passed on another browser', () => {
    const input = baseInput({
      execution: { id: 10, testCaseId: 1, status: 'failed', duration: 5_000, browser: 'chromium', startedAt: T0 },
      browserPeers: [
        { browser: 'chromium', status: 'failed' },
        { browser: 'firefox', status: 'passed' },
      ],
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'browser-specific');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('medium');
    expect(clue!.detail).toContain('firefox');
    expect(clue!.citations[0]).toEqual({ section: 'browserDistribution' });
  });

  test('negative: the test failed on every browser', () => {
    const input = baseInput({
      browserPeers: [
        { browser: 'chromium', status: 'failed' },
        { browser: 'firefox', status: 'failed' },
      ],
    });
    expect(rules(input)).not.toContain('browser-specific');
  });
});

describe('fixed-before', () => {
  test('positive: a cluster with a recorded fix that regressed', () => {
    const input = baseInput({
      cluster: { fixCommit: 'abc1234def567', fixLandedRunId: 3, fixVerification: 'regressed' },
    });
    const clue = buildFailureClues(input).find((c) => c.rule === 'fixed-before');
    expect(clue).toBeTruthy();
    expect(clue!.strength).toBe('weak');
    expect(clue!.detail).toContain('abc1234');
    expect(clue!.citations[0]).toEqual({ section: 'priorDiagnosis' });
  });

  test('negative: a cluster whose fix still holds does not fire', () => {
    const input = baseInput({
      cluster: { fixCommit: 'abc1234def567', fixLandedRunId: 3, fixVerification: 'stopped-failing' },
    });
    expect(rules(input)).not.toContain('fixed-before');
  });
});
