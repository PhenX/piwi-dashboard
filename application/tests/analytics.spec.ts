/**
 * Tests for the cross-project analytics platform:
 *   GET /api/analytics/:widget — generic widget dispatch (registry-driven)
 *   /analytics                 — page with scope bar and widget grid
 */
import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('Analytics API', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const passing = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.ANALYTICS_TEST,
        status: 'passed',
        startTime: new Date(Date.now() - 60_000).toISOString(),
        duration: 30_000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          { title: 'stable test', status: 'passed', duration: 500, location: 'tests/a.spec.ts:1:1' },
          { title: 'other test', status: 'passed', duration: 700, location: 'tests/a.spec.ts:9:1' },
        ],
      },
    });
    expect(passing.ok()).toBeTruthy();
    projectId = (await passing.json()).projectId;

    const failing = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.ANALYTICS_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 45_000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          { title: 'stable test', status: 'passed', duration: 500, location: 'tests/a.spec.ts:1:1' },
          {
            title: 'other test',
            status: 'failed',
            duration: 900,
            location: 'tests/a.spec.ts:9:1',
            error: 'Error: expect(received).toBe(expected)',
          },
        ],
      },
    });
    expect(failing.ok()).toBeTruthy();
  });

  test('GET /api/analytics/portfolio aggregates the project over the period', async ({ request }) => {
    const response = await request.get('/api/analytics/portfolio?days=7');
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();

    const row = rows.find((r: { projectId: number }) => r.projectId === projectId);
    expect(row).toBeTruthy();
    expect(row.runCount).toBe(2);
    expect(row.passRate).toBe(75); // 3 of 4 tests passed across both runs
    expect(row.latestRun.status).toBe('failed');
    expect(row.recentRuns).toHaveLength(2);
  });

  test('GET /api/analytics/ci-time-trend sums run minutes', async ({ request }) => {
    const response = await request.get('/api/analytics/ci-time-trend?days=7&projects=' + projectId);
    expect(response.ok()).toBeTruthy();
    const trend = await response.json();
    expect(trend.runCount).toBe(2);
    expect(trend.totalMinutes).toBeCloseTo(1.3, 1); // 30s + 45s
  });

  test('scope filters apply: an environment with no runs empties the result', async ({ request }) => {
    const response = await request.get('/api/analytics/portfolio?days=7&environment=nonexistent-env');
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();
    const row = rows.find((r: { projectId: number }) => r.projectId === projectId);
    expect(row.runCount).toBe(0);
  });

  test('GET /api/analytics/:widget 404s on an unknown widget id', async ({ request }) => {
    const response = await request.get('/api/analytics/not-a-widget');
    expect(response.status()).toBe(404);
  });

  test('every registered widget responds', async ({ request }) => {
    for (const widget of [
      'insights',
      'portfolio',
      'pass-rate-heatmap',
      'ci-time-trend',
      'wasted-time',
      'flaky-leaderboard',
      'cluster-landscape',
    ]) {
      const response = await request.get(`/api/analytics/${widget}?days=7`);
      expect(response.ok(), `widget ${widget} should respond`).toBeTruthy();
    }
  });
});

test.describe('Analytics page', () => {
  test('renders every registered widget card', async ({ page }) => {
    await page.goto('/analytics');

    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Portfolio health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pass rate heatmap' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^CI time/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wasted CI time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flakiest tests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Failure clusters' })).toBeVisible();
  });

  test('is reachable from the sidebar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Analytics' }).first().click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: 'Portfolio health' })).toBeVisible();
  });
});
