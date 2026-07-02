import { describe, test, expect } from 'vitest';
import { formatFailingActionSection } from '../../server/utils/trace-parser';
import type { ParsedTraceData, TraceAction } from '../../server/utils/trace-parser';

// Large limits so nothing truncates in these tests.
const MAX_TRACE_ACTIONS = 10;
const TRACE_DOM_CHARS = 6000;

/** Build a minimal TraceAction with only the fields under test. */
function makeAction(overrides: Partial<TraceAction> = {}): TraceAction {
  return {
    callId: 'call@1',
    apiName: 'locator.click',
    startTime: 1000,
    ...overrides,
  };
}

/** Build a ParsedTraceData whose single action is the failing one. */
function makeData(overrides: Partial<ParsedTraceData> = {}): ParsedTraceData {
  const failingAction = overrides.failingAction ?? makeAction();
  return {
    actions: [failingAction],
    consoleEntries: [],
    networkRequests: [],
    failingAction,
    failingActionIndex: 0,
    eventCount: 0,
    timeoutFallback: false,
    traceEndTime: 0,
    ...overrides,
  };
}

describe('formatFailingActionSection — timeout-fallback duration', () => {
  test('renders "ran ≥ Nms" from the trace timebase, with no Date.now artifacts', () => {
    const action = makeAction({ startTime: 1000, endTime: undefined });
    const data = makeData({
      failingAction: action,
      timeoutFallback: true,
      // Same timebase as startTime; last timestamp seen in the trace.
      traceEndTime: 4500,
    });

    const out = formatFailingActionSection(data, MAX_TRACE_ACTIONS, TRACE_DOM_CHARS);
    expect(out).not.toBeNull();

    // N = traceEndTime - startTime = 3500.
    expect(out).toContain('- Duration: ran ≥ 3500ms before the test was killed');

    // Guard against the old Date.now()-based, seconds-vs-ms bug.
    expect(out).not.toContain('timed out after');
    expect(out).not.toContain('ms+');
    // No wall-clock leakage: the buggy code produced a ~1.7e9 second value.
    expect(out).not.toMatch(/Duration: timed out/);
    expect(out).not.toMatch(/ran ≥ \d{7,}ms/);
  });

  test('rounds the trace-timebase delta to whole milliseconds', () => {
    const action = makeAction({ startTime: 1000.2, endTime: undefined });
    const data = makeData({
      failingAction: action,
      timeoutFallback: true,
      traceEndTime: 4501.9, // delta 3501.7 → rounds to 3502
    });

    const out = formatFailingActionSection(data, MAX_TRACE_ACTIONS, TRACE_DOM_CHARS);
    expect(out).toContain('- Duration: ran ≥ 3502ms before the test was killed');
  });

  test('renders no duration line when traceEndTime <= startTime', () => {
    const action = makeAction({ startTime: 5000, endTime: undefined });

    // Equal timestamps (no later event observed).
    const equal = formatFailingActionSection(
      makeData({ failingAction: action, timeoutFallback: true, traceEndTime: 5000 }),
      MAX_TRACE_ACTIONS,
      TRACE_DOM_CHARS,
    );
    expect(equal).not.toBeNull();
    expect(equal).not.toContain('Duration:');

    // No timestamp found anywhere in the trace (traceEndTime === 0).
    const none = formatFailingActionSection(
      makeData({ failingAction: action, timeoutFallback: true, traceEndTime: 0 }),
      MAX_TRACE_ACTIONS,
      TRACE_DOM_CHARS,
    );
    expect(none).not.toContain('Duration:');
  });
});

describe('formatFailingActionSection — non-fallback duration (unchanged)', () => {
  test('uses endTime - startTime when the action completed', () => {
    const action = makeAction({ startTime: 1000, endTime: 1250 });
    const data = makeData({ failingAction: action, timeoutFallback: false, traceEndTime: 9999 });

    const out = formatFailingActionSection(data, MAX_TRACE_ACTIONS, TRACE_DOM_CHARS);
    // Duration comes from endTime, not traceEndTime.
    expect(out).toContain('- Duration: 250ms');
    expect(out).not.toContain('ran ≥');
  });
});
