import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The diagnosis-first test-run-case page: a failing execution opens on the
 * Diagnosis tab (verdict + evidence funnel), a passing one on Steps with an
 * Artifacts tab, and legacy ?tab= links keep working.
 */
test.describe('Test-run-case page', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;
  let passedCaseId: number;

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.TEST_RUN_CASE_PAGE,
        status: 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: 30000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout completes',
            status: 'failed',
            duration: 8000,
            location: 'tests/checkout.spec.ts:42:18',
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
            retries: 1,
            workerIndex: 0,
            startedAt: startTime,
            steps: [
              { title: "page.goto('/checkout')", duration: 800, category: 'navigation' },
              {
                title: "getByRole('button', { name: 'Pay' }).click()",
                duration: 5000,
                category: 'action',
                failed: true,
              },
            ],
          },
          {
            title: 'homepage loads',
            status: 'passed',
            duration: 1500,
            location: 'tests/home.spec.ts:3:1',
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
            steps: [{ title: "page.goto('/')", duration: 700, category: 'navigation' }],
          },
        ],
      },
    });

    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const runId = proj.testRuns[0].id;
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    failedCaseId = run.testCases.find((c: { status: string }) => c.status === 'failed').executionId;
    passedCaseId = run.testCases.find((c: { status: string }) => c.status === 'passed').executionId;
  });

  test('failing execution opens on the Diagnosis tab', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    await expect(page.getByRole('tab', { name: 'Diagnosis' })).toBeVisible();
    // The verdict and AI-diagnosis rail cards are the diagnosis-tab signature.
    await expect(page.getByRole('heading', { name: 'Verdict' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI diagnosis' })).toBeVisible();
    // The URL is normalized to the diagnosis tab.
    await expect(page).toHaveURL(/tab=diagnosis/);
  });

  test('legacy ?tab=error redirects to the Diagnosis tab', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}?tab=error`);
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Verdict' })).toBeVisible();
  });

  test('passing execution opens on Steps and offers an Artifacts tab', async ({ page }) => {
    await page.goto(`/test-run-cases/${passedCaseId}`);
    await waitForHydration(page);

    await expect(page.getByRole('tab', { name: 'Artifacts' })).toBeVisible();
    // No error → no Diagnosis tab.
    await expect(page.getByRole('tab', { name: 'Diagnosis' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Steps/ })).toBeVisible();
  });

  test('the header offers a Copy retry command action', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    // NavbarActions keeps the label as accessible name even when icon-only on mobile.
    await expect(page.getByRole('button', { name: /Copy retry command/ })).toBeVisible();
  });

  test('Performance tab is always available and shows an empty state when nothing captured', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}?tab=performance`);
    await waitForHydration(page);
    await expect(page.getByRole('tab', { name: 'Performance' })).toBeVisible();
  });

  test('History tab opens populated from the SSR payload, without refetching or a hydration mismatch', async ({
    page,
  }) => {
    // A client-side call to the history endpoint means the rows are missing from
    // the payload, which is what tears the server and client renders apart.
    const historyCalls: string[] = [];
    page.on('request', (req) => {
      if (/\/api\/test-cases\/\d+\/history/.test(req.url())) historyCalls.push(req.url());
    });
    // Vue only reports mismatches in a dev build; in a production run this stays empty.
    const hydrationErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Hydration completed but contains mismatches')) hydrationErrors.push(msg.text());
    });

    await page.goto(`/test-run-cases/${failedCaseId}?tab=history`);
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: 'Duration trend' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /History \(\d+\)/ })).toBeVisible();
    expect(historyCalls).toEqual([]);
    expect(hydrationErrors).toEqual([]);
  });
});
