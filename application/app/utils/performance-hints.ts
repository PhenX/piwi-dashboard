import { hasSlowMark } from '#shared/analytics/timeout-hygiene';

interface PerformanceHint {
  type: 'warning' | 'info';
  message: string;
  details: string;
}

interface TestCaseData {
  duration?: number | null;
  retries?: number | null;
  status?: string;
  steps?: Array<{ title: string; duration: number; category: string }> | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  /** Effective per-test timeout in ms (`TestCase.timeout`); `0`/null = unbounded/unknown. */
  timeout?: number | null;
  testAnnotations?: Array<{ type?: string; description?: string }> | null;
}

/**
 * Generate performance hints based on test case data
 */
export function getPerformanceHints(testCase: TestCaseData): PerformanceHint[] {
  const hints: PerformanceHint[] = [];

  if (!testCase) return hints;

  const steps = testCase.steps || [];

  // Slow navigation hint
  const navigationSteps = steps.filter((s) => s.category === 'navigation');
  const slowNavigations = navigationSteps.filter((s) => s.duration > 3000);
  if (slowNavigations.length > 0) {
    const slowest = slowNavigations.sort((a, b) => b.duration - a.duration)[0]!;
    hints.push({
      type: 'warning',
      message: 'Slow navigation detected',
      details: `"${slowest.title}" took ${(slowest.duration / 1000).toFixed(1)}s. The tested page may have performance issues (slow server response, heavy JS bundles, etc.).`,
    });
  }

  // Many sequential actions
  if (steps.length > 20) {
    hints.push({
      type: 'info',
      message: 'Many sequential actions',
      details: `This test has ${steps.length} steps. Consider splitting it into smaller, focused tests for better isolation and faster feedback.`,
    });
  }

  // Unstable locator (flaky test)
  if (testCase.status === 'passed' && (testCase.retries || 0) > 0) {
    hints.push({
      type: 'warning',
      message: 'Flaky test — passed after retries',
      details: `This test needed ${testCase.retries} ${testCase.retries === 1 ? 'retry' : 'retries'} to pass. Consider reviewing locator strategies, adding explicit waits, or checking for race conditions.`,
    });
  }

  // Slow assertions
  const slowAssertions = steps.filter((s) => s.category === 'assertion' && s.duration > 2000);
  if (slowAssertions.length > 0) {
    const slowest = slowAssertions.sort((a, b) => b.duration - a.duration)[0]!;
    hints.push({
      type: 'info',
      message: 'Slow assertions detected',
      details: `"${slowest.title}" took ${(slowest.duration / 1000).toFixed(1)}s. The UI may be slow to render or the assertion timeout may need tuning.`,
    });
  }

  // Stale test.slow() — marked slow but finished quickly
  if (hasSlowMark(testCase.testAnnotations) && typeof testCase.duration === 'number' && testCase.duration < 10000) {
    hints.push({
      type: 'info',
      message: 'test.slow() may be unnecessary',
      details: `This run finished in ${(testCase.duration / 1000).toFixed(1)}s, yet the test is marked test.slow(), which triples its timeout budget. If it is consistently this fast, removing test.slow() lets a failure surface sooner.`,
    });
  }

  // Oversized per-test timeout — the budget dwarfs the real runtime
  if (
    typeof testCase.timeout === 'number' &&
    testCase.timeout > 0 &&
    typeof testCase.duration === 'number' &&
    testCase.duration > 0 &&
    testCase.timeout >= 4 * testCase.duration &&
    testCase.timeout - testCase.duration >= 30000
  ) {
    hints.push({
      type: 'info',
      message: 'Oversized timeout',
      details: `The timeout is ${(testCase.timeout / 1000).toFixed(0)}s but this run took ${(testCase.duration / 1000).toFixed(1)}s. A large timeout means a hang or failure waits far longer than necessary — consider lowering it toward the test's real duration.`,
    });
  }

  return hints;
}
