/**
 * Behavioral tests for the run-insights, spec-health and flaky-classify
 * endpoints. Seeds a two-run history (a clean baseline followed by a run where
 * one test regresses with a timeout) and asserts the actual computed output —
 * not just status codes.
 */
import { test, expect, type APIRequestContext } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

interface SpecHealthRow {
  prefix: string;
  passRate: number;
  flakyRate: number;
  failureCount: number;
  testCount: number;
  avgDuration: number;
}

// Fixture run times are relative to now so the seeded runs always fall inside
// spec-health's default 30-day look-back window; a hardcoded date silently ages
// out of range and drops the specs from the aggregation.
const BASELINE_START = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const REGRESSION_START = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

async function submit(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post('/api/test-runs/submit', {
    data: { projectName: PROJECT.INSIGHTS_SPEC_HEALTH, ...body },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ testRunId: number; projectId: number }>;
}

test.describe.serial('Insights, spec health & flaky classification', () => {
  let projectId = 0;
  let regressionRunId = 0;

  test('seeds a baseline run and a regression run', async ({ request }) => {
    // Baseline: both tests pass, across two spec prefixes.
    const baseline = await submit(request, {
      status: 'passed',
      startTime: BASELINE_START,
      duration: 3000,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      skippedTests: 0,
      testCases: [
        { title: 'login works', status: 'passed', duration: 500, location: 'tests/auth/login.spec.ts:1:1' },
        { title: 'checkout works', status: 'passed', duration: 700, location: 'tests/checkout/pay.spec.ts:1:1' },
      ],
    });
    projectId = baseline.projectId;

    // Current: checkout regresses with a timeout error.
    const current = await submit(request, {
      status: 'failed',
      startTime: REGRESSION_START,
      duration: 3000,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 0,
      testCases: [
        { title: 'login works', status: 'passed', duration: 520, location: 'tests/auth/login.spec.ts:1:1' },
        {
          title: 'checkout works',
          status: 'failed',
          duration: 30000,
          location: 'tests/checkout/pay.spec.ts:1:1',
          error:
            'TimeoutError: Timeout 30000ms exceeded waiting for locator to be visible\n    at tests/checkout/pay.spec.ts:5:3',
        },
      ],
    });
    regressionRunId = current.testRunId;
    expect(projectId).toBeGreaterThan(0);
    expect(regressionRunId).toBeGreaterThan(0);
  });

  test('insights reports the regression against the baseline', async ({ request }) => {
    const res = await request.get(`/api/test-runs/${regressionRunId}/insights`);
    expect(res.ok()).toBeTruthy();
    const insights = await res.json();

    expect(insights.hasBaseline).toBe(true);
    const regressed = (insights.newRegressions as Array<{ title: string }>).map((r) => r.title);
    expect(regressed).toContain('checkout works');
    expect(regressed).not.toContain('login works');
    // The passing test that was already passing is not a regression or recovery.
    expect(insights.passRate).toBeLessThan(insights.baselinePassRate);
  });

  test('spec-health groups by spec prefix with pass/failure stats', async ({ request }) => {
    const res = await request.get(`/api/projects/${projectId}/spec-health`);
    expect(res.ok()).toBeTruthy();
    const { specs } = (await res.json()) as { specs: SpecHealthRow[] };

    const auth = specs.find((s) => s.prefix === 'tests/auth');
    const checkout = specs.find((s) => s.prefix === 'tests/checkout');
    expect(auth, 'tests/auth prefix present').toBeTruthy();
    expect(checkout, 'tests/checkout prefix present').toBeTruthy();

    // auth passed in both runs; checkout passed once and failed once.
    expect(auth!.passRate).toBe(1);
    expect(auth!.failureCount).toBe(0);
    expect(checkout!.failureCount).toBe(1);
    expect(checkout!.passRate).toBeLessThan(1);
  });

  test('flaky-classify labels a timeout failure as "timing"', async ({ request }) => {
    const tcRes = await request.get(`/api/projects/${projectId}/test-cases`);
    expect(tcRes.ok()).toBeTruthy();
    const { items: cases } = (await tcRes.json()) as { items: Array<{ id: number; title: string }> };
    const checkout = cases.find((c) => c.title === 'checkout works');
    expect(checkout, 'checkout test case exists').toBeTruthy();

    const res = await request.post(`/api/projects/${projectId}/flaky-classify`, {
      data: { testCaseId: checkout!.id },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).rootCause).toBe('timing');
  });

  test('validates input and unknown ids', async ({ request }) => {
    // Missing testCaseId → 400
    expect((await request.post(`/api/projects/${projectId}/flaky-classify`, { data: {} })).status()).toBe(400);
    // Unknown test case for classify → 404
    expect(
      (await request.post(`/api/projects/${projectId}/flaky-classify`, { data: { testCaseId: 9999999 } })).status(),
    ).toBe(404);
    // Unknown run for insights → 404
    expect((await request.get('/api/test-runs/9999999/insights')).status()).toBe(404);
    // Unknown project for spec-health → 404
    expect((await request.get('/api/projects/9999999/spec-health')).status()).toBe(404);
  });
});
