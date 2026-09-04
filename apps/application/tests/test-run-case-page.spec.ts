import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The single-column execution page: a header, the failure headline, the raw
 * error, then one evidence card with content-level tabs (Timeline, Screen,
 * Source, Network, Console, State, Performance). A passing execution shows the
 * same page with the Timeline tab selected.
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
              {
                title: "page.goto('/checkout')",
                duration: 800,
                category: 'navigation',
                location: 'pages/checkout.ts:11:5',
              },
              {
                title: "getByRole('button', { name: 'Pay' }).click()",
                duration: 5000,
                category: 'action',
                failed: true,
                location: 'pages/checkout.ts:42:5',
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

  test('failing execution leads with the headline, then the error, then the evidence tabs', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    // The one-line headline leads the page, ahead of the raw error.
    const headline = page.getByRole('heading', {
      name: /getByRole\('button', \{ name: 'Pay' \}\) was not found on the page — click timed out after 30 s/,
    });
    await expect(headline).toBeVisible();
    await expect(page.getByText('First failure in this run')).toBeVisible();
    const headlineBox = await headline.boundingBox();
    const errorBox = await page.getByRole('heading', { name: 'Error', exact: true }).boundingBox();
    expect(headlineBox!.y).toBeLessThan(errorBox!.y);

    // One evidence card with content-level tabs — no page-level tab strip.
    const tablist = page.getByRole('tablist', { name: 'Evidence sections' });
    await expect(tablist).toBeVisible();
    for (const name of ['Timeline', 'Screen', 'Source', 'Network', 'Console', 'State', 'Performance']) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible();
    }

    // The verdict and AI-diagnosis blocks stack below the evidence, as they do today.
    await expect(page.getByRole('heading', { name: 'Regression status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI diagnosis' })).toBeVisible();
  });

  test('passing execution opens on the Timeline tab', async ({ page }) => {
    await page.goto(`/test-run-cases/${passedCaseId}`);
    await waitForHydration(page);

    const timelineTab = page.getByRole('tab', { name: /^Timeline/ });
    await expect(timelineTab).toBeVisible();
    await expect(timelineTab).toHaveAttribute('aria-selected', 'true');
    // No failure → no headline, no error card.
    await expect(page.getByRole('heading', { name: 'Error', exact: true })).toHaveCount(0);
  });

  test('the header offers a Copy retry command action', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    // The button keeps its label as accessible name even when icon-only in a narrow header.
    await expect(page.getByRole('button', { name: /Copy retry command/ })).toBeVisible();
  });

  test('the Performance tab opens and shows its Web Vitals block', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Performance/ }).click();
    await expect(page.getByRole('heading', { name: 'Browser performance (Web Vitals)' })).toBeVisible();
  });

  test('GET /api/test-run-cases/:id/timeline places the steps and marks the failure', async ({ request }) => {
    const res = await request.get(`/api/test-run-cases/${failedCaseId}/timeline`);
    expect(res.ok()).toBeTruthy();
    const tl = await res.json();
    // Two steps, neither carrying a start time, so positions are estimated.
    expect(tl.lanes.steps).toHaveLength(2);
    expect(tl.estimated).toBe(true);
    // The step marked failed is the failure; its end is the failure moment.
    expect(tl.failedStep.index).toBe(1);
    expect(tl.failureAt).toBe(5800);
    expect(tl.lanes.steps[1].failed).toBe(true);
    expect(tl.window).toBeDefined();
    // Each step is attributed to its reporter call site (file:line; no trace, so no function).
    expect(tl.lanes.steps[1].origin).toEqual({ file: 'pages/checkout.ts', line: 42, function: null, chain: [] });
  });

  test('the Timeline tab shows the failure timeline and the whole-test step table', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    await page.getByRole('tab', { name: /^Timeline/ }).click();

    await expect(page.getByRole('heading', { name: 'Failure timeline' })).toBeVisible();
    // The chronological list and both window controls are present.
    await expect(page.getByRole('heading', { name: 'What happened in this window' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Around the failure' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Whole test' })).toBeVisible();
    // This run recorded no step start times, so the estimated note shows.
    await expect(page.getByText(/Step positions are derived from durations/)).toBeVisible();
    // The former Steps tab: the whole-test step table lives here now.
    await expect(page.getByRole('heading', { name: /^Steps/ })).toBeVisible();
    await expect(page.getByRole('table').getByText("getByRole('button', { name: 'Pay' }).click()")).toBeVisible();
  });

  test('History block opens populated from the SSR payload, without refetching or a hydration mismatch', async ({
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

    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    const historyCard = page.locator('[data-shot="execution-history"]');
    await expect(historyCard.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await expect(historyCard.getByRole('link', { name: 'Test history' })).toBeVisible();
    expect(historyCalls).toEqual([]);
    expect(hydrationErrors).toEqual([]);
  });
});
