import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('Run page test-case filters', () => {
  const loginTimeout = (ms: number) =>
    `TimeoutError: locator.click: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting for getByTestId('login-button')`;
  const cartAssertion = `Error: expect(locator).toHaveText(expected)\n\nLocator: getByTestId('cart-total')\nExpected string: "3 items"\nReceived string: "0 items"`;

  let runId = 0;
  let loginClusterId = 0;

  // The flat list's title links — the desktop table is the visible copy at the
  // test viewport (the mobile card is display:none from `md` up).
  const visibleTitles = (page: import('@playwright/test').Page) => page.locator('a[href^="/test-run-cases/"]:visible');

  async function submitRun(request: APIRequestContext) {
    const response = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_PAGE_FILTERS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 4,
        passedTests: 1,
        failedTests: 3,
        skippedTests: 0,
        testCases: [
          {
            title: 'login via header',
            status: 'failed',
            duration: 31000,
            location: 'tests/auth.spec.ts:10:5',
            error: loginTimeout(30000),
          },
          {
            title: 'login via modal',
            status: 'failed',
            duration: 16000,
            location: 'tests/auth.spec.ts:30:5',
            error: loginTimeout(15000),
          },
          {
            title: 'cart shows items',
            status: 'failed',
            duration: 2000,
            location: 'tests/cart.spec.ts:12:5',
            error: cartAssertion,
          },
          { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' },
        ],
      },
      timeout: 20000,
    });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { runId: number; projectId: number };
    runId = body.runId;
  }

  test('seeds a failed run with two failure clusters', async ({ request }) => {
    await submitRun(request);

    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    const loginHeader = run.testCases.find((tc: { title: string }) => tc.title === 'login via header');
    const cart = run.testCases.find((tc: { title: string }) => tc.title === 'cart shows items');
    expect(loginHeader.failureClusterId).toEqual(expect.any(Number));
    expect(cart.failureClusterId).toEqual(expect.any(Number));
    expect(cart.failureClusterId).not.toBe(loginHeader.failureClusterId);
    loginClusterId = loginHeader.failureClusterId;
  });

  test('lists failures first with their error text and a cluster badge', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Failure-first default order, stable within each group
    await expect(visibleTitles(page)).toHaveCount(4);
    await expect(visibleTitles(page).nth(0)).toHaveText('login via header');
    await expect(visibleTitles(page).nth(1)).toHaveText('login via modal');
    await expect(visibleTitles(page).nth(2)).toHaveText('cart shows items');
    await expect(visibleTitles(page).nth(3)).toHaveText('homepage loads');

    // The one-line headline under each failed title, with the raw error as its
    // tooltip (visible copy only — the mobile card below `md` duplicates the same DOM)
    const loginHeadline = page
      .getByText("getByTestId('login-button') was not found on the page — click timed out after 30 s")
      .filter({ visible: true });
    await expect(loginHeadline).toBeVisible();
    await expect(loginHeadline).toHaveAttribute('title', /TimeoutError: locator\.click: Timeout 30000ms exceeded\./);
    await expect(
      page
        .getByText('Expected text "3 items", got "0 items" — getByTestId(\'cart-total\') toHaveText')
        .filter({ visible: true }),
    ).toBeVisible();

    // A cluster badge on every failing row links to the cluster page
    const clusterLinks = page.locator('a[href^="/failure-clusters/"]:visible');
    await expect(clusterLinks).toHaveCount(3, { timeout: 15000 });
    await expect(clusterLinks.first()).toHaveAttribute('href', `/failure-clusters/${loginClusterId}`);
  });

  test('summary tiles toggle into the same status set and zero tiles are disabled', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Zero-count tiles are disabled (Skipped is 0 on this run)
    await expect(page.getByRole('button', { name: 'Skipped 0' })).toBeDisabled();

    // Clicking a tile toggles its status in the set the chips share
    await page.getByRole('button', { name: 'Failed 3' }).click();
    await expect(visibleTitles(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Failed 3' }).click();
    await expect(visibleTitles(page)).toHaveCount(4);

    // Two tiles combine instead of replacing each other
    await page.getByRole('button', { name: 'Passed 1' }).click();
    await expect(visibleTitles(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Failed 3' }).click();
    await expect(visibleTitles(page)).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Passed 1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Failed 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('cluster filter is named, counted, deep-linkable and clearable', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    await page
      .getByRole('button', { name: /Failure clusters/ })
      .first()
      .click();
    const loginGroupRow = page.locator('table').getByRole('row').filter({ hasText: 'Timeout' }).first();
    await loginGroupRow.getByRole('button', { name: 'Show failing tests' }).click();

    // The chip names the cluster and its matched count
    await expect(page.getByText(/Cluster: .* · 2 tests/)).toBeVisible();
    await expect(visibleTitles(page)).toHaveCount(2);
    await expect(visibleTitles(page).first()).toHaveText('login via header');

    // The filter is deep-linkable: reload keeps the chip and the rows
    await expect(page).toHaveURL(/cluster=\d+/);
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByText(/Cluster: .* · 2 tests/)).toBeVisible();
    await expect(visibleTitles(page)).toHaveCount(2);

    // Clearing restores the full list and drops the query param
    await page.getByRole('button', { name: 'Clear filter' }).click();
    await expect(visibleTitles(page)).toHaveCount(4);
    await expect(page).not.toHaveURL(/cluster=/);
  });
});
