import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The Home "Open failures" card: open clusters across the visible projects, the
 * row opens the cluster, and keyboard triage (j/k move, o opens).
 */
test.describe.serial('Home — Open failures card', () => {
  test.setTimeout(90000);

  // A distinctive selector so this project's cluster is identifiable among the
  // other clusters the card lists across projects.
  const SELECTOR = "getByTestId('home-open-failures-btn')";
  const failure = (ms: number) =>
    `TimeoutError: locator.click: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting for ${SELECTOR}`;

  let clusterId: number | null = null;

  async function submitFailingRun(request: APIRequestContext): Promise<{ runId: number }> {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.HOME_OPEN_FAILURES,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'opens the account menu',
            status: 'failed',
            duration: 31000,
            location: 'tests/account.spec.ts:12:5',
            error: failure(30000),
          },
          { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' },
        ],
      },
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as { runId: number };
  }

  test.beforeAll(async ({ request }) => {
    const { runId } = await submitFailingRun(request);
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    const failed = run.testCases.find((tc: { title: string }) => tc.title === 'opens the account menu');
    clusterId = failed.failureClusterId as number;
    expect(clusterId).toEqual(expect.any(Number));
  });

  test('row opens the failure cluster', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const card = page.locator('[data-shot="open-failures"]');
    await expect(card.getByRole('heading', { name: 'Open failures' })).toBeVisible();

    // Reveal every row in case newer clusters from other suites push this one
    // past the 10-row preview.
    const showAll = card.getByRole('button', { name: /Show all/ });
    if (await showAll.count()) await showAll.first().click();

    const row = card.getByRole('link', { name: new RegExp('home-open-failures-btn') });
    await expect(row).toBeVisible();
    await row.click();

    await page.waitForURL(`/failure-clusters/${clusterId}`);
  });

  test('keyboard: j selects a row and o opens it', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    const card = page.locator('[data-shot="open-failures"]');
    await expect(card.getByRole('heading', { name: 'Open failures' })).toBeVisible();

    // j moves the selection onto the first row.
    await page.keyboard.press('j');
    await expect(card.locator('[aria-current="true"]')).toBeVisible();

    // o opens the selected cluster.
    await page.keyboard.press('o');
    await page.waitForURL(/\/failure-clusters\/\d+/);
  });
});
