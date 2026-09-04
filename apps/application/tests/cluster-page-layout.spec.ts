import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * Failure-cluster detail page layout: one column, read top to bottom. The
 * header carries the triage control; the failure reads as a headline with a
 * "Show raw error" disclosure; the evidence is one tabbed card fed by an
 * affected-test selector; bulk actions live in the header's More menu.
 */

// Two cases sharing one fingerprint (identical error, different spec files) so
// the cluster has two affected test cases → a selector. The stack frame is not
// hashed, so they cluster together.
const sharedError = (frame: string) =>
  `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Submit' })\n    at ${frame}`;

let clusterId = 0;

async function seedCluster(request: APIRequestContext) {
  await retryPost(request, '/api/test-runs/submit', {
    data: {
      projectName: PROJECT.CLUSTER_PAGE_LAYOUT,
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 30000,
      totalTests: 2,
      passedTests: 0,
      failedTests: 2,
      skippedTests: 0,
      testCases: [
        {
          title: 'login submits the form',
          status: 'failed',
          duration: 1000,
          location: 'tests/auth.spec.ts:5:3',
          error: sharedError('tests/auth.spec.ts:5:3'),
        },
        {
          title: 'checkout completes payment',
          status: 'failed',
          duration: 1200,
          location: 'tests/checkout.spec.ts:9:1',
          error: sharedError('tests/checkout.spec.ts:9:1'),
        },
      ],
    },
    timeout: 20000,
  });

  const { items: projects } = await (await request.get('/api/projects')).json();
  const project = projects.find((p: { name: string }) => p.name === PROJECT.CLUSTER_PAGE_LAYOUT);
  expect(project).toBeTruthy();
  const detail = await (await request.get(`/api/projects/${project.id}`)).json();
  const runId = detail.testRuns[0].id as number;
  const run = await (await request.get(`/api/test-runs/${runId}`)).json();
  const failed = (run.testCases as Array<{ status: string; failureClusterId?: number }>).find(
    (c) => c.status === 'failed' && c.failureClusterId,
  );
  expect(failed?.failureClusterId).toBeTruthy();
  return failed!.failureClusterId!;
}

test.describe('Failure cluster page layout', () => {
  // fullyParallel can schedule these tests across multiple workers; beforeAll
  // is scoped per-worker, so without serial mode two workers could each seed
  // their own cluster, doubling the shared data these tests assert against.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  test.beforeAll(async ({ request }) => {
    clusterId = await seedCluster(request);
  });

  test('the header carries the triage control and the cluster facts', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // The segmented triage control (auth is disabled → the virtual admin can write).
    const triage = page.getByRole('group', { name: 'Triage status' });
    await expect(triage).toBeVisible();
    await expect(triage.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(triage.getByRole('button', { name: 'Resolved' })).toBeVisible();
    await expect(triage.getByRole('button', { name: 'Ignored' })).toBeVisible();

    // The facts line states the count of affected tests, not a "Runs" card.
    await expect(page.getByText(/2 tests/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toHaveCount(0);
  });

  test('the evidence card is open by default with an affected-test selector', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // The tabbed evidence card is not folded — its tab strip and the execution
    // link are both visible without any expand.
    await expect(page.getByRole('tablist', { name: 'Evidence sections' })).toBeVisible();
    const link = page.getByRole('link', { name: 'Open execution' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/test-run-cases\/\d+/);

    // The selector offers every affected case; switching it retargets the link.
    const before = await link.getAttribute('href');
    await page.getByRole('combobox', { name: 'Affected test' }).click();
    await expect(page.getByRole('option', { name: 'login submits the form' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'checkout completes payment' })).toBeVisible();
    // Pick the case that is not the current selection so the execution changes.
    await page.getByRole('option', { selected: false }).first().click();
    await expect
      .poll(async () => page.getByRole('link', { name: 'Open execution' }).getAttribute('href'))
      .not.toBe(before);
  });

  test('the raw error is behind a "Show raw error" disclosure', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // Collapsed by default: the signature is not on the first screen.
    const disclosure = page.getByRole('button', { name: 'Show raw error' });
    await expect(disclosure).toBeVisible();
    await expect(page.getByText('TimeoutError: locator.click', { exact: false })).toBeHidden();

    await disclosure.click();
    await expect(page.getByText('TimeoutError: locator.click', { exact: false }).first()).toBeVisible();
  });

  test('what changed is a plain card, not a folded header', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible();
  });

  test('selecting an affected test offers "Move to a new cluster"', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: /Affected tests/ })).toBeVisible();

    // Selecting a row reveals the bulk bar; the move action opens its confirm dialog.
    await page
      .getByRole('checkbox', { name: /^Select / })
      .first()
      .check();
    const move = page.getByRole('button', { name: 'Move to a new cluster' });
    await expect(move).toBeVisible();
    await move.click();
    await expect(page.getByRole('button', { name: /Move \d+ test/ })).toBeVisible();
  });
});
