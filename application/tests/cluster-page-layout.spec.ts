import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * Failure-cluster detail page layout: the left column folds each evidence
 * section to a header + peek by default, the top summary drops the old "Runs"
 * card, and the test-evidence section exposes one tab per affected case with a
 * link through to the test-run case.
 */

// Two cases sharing one fingerprint (identical error, different spec files) so
// the cluster has two affected test cases → tabs. The stack frame is not
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

  const projects = await (await request.get('/api/projects')).json();
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
  test.setTimeout(90000);

  test.beforeAll(async ({ request }) => {
    clusterId = await seedCluster(request);
  });

  test('left sections fold by default and reveal a peek', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // Section headers are present…
    await expect(page.getByRole('heading', { name: 'Error message' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test evidence' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible();

    // …but their bodies are folded: the case link (inside the evidence body) is hidden.
    await expect(page.getByRole('link', { name: 'Open test run case' })).toBeHidden();

    // The evidence peek carries the key info while folded (the toggle's accessible
    // name includes the peek; occurrence count varies so match loosely).
    await expect(page.getByRole('button', { name: /Test evidence.*2 tests.*occurrences/ })).toBeVisible();
  });

  test('expanding a section persists across reload', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    await page.getByRole('heading', { name: 'Test evidence' }).click();
    await expect(page.getByRole('link', { name: 'Open test run case' }).first()).toBeVisible();

    await page.reload();
    await waitForHydration(page);
    // Cookie kept it expanded.
    await expect(page.getByRole('link', { name: 'Open test run case' }).first()).toBeVisible();
  });

  test('summary shows Triage and no longer has a Runs card', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: 'Triage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toHaveCount(0);
  });

  test('test evidence has a tab per case linking to the test-run case', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    await page.getByRole('heading', { name: 'Test evidence' }).click();

    // One tab per affected case.
    const tab1 = page.getByRole('button', { name: 'login submits the form' });
    const tab2 = page.getByRole('button', { name: 'checkout completes payment' });
    await expect(tab1).toBeVisible();
    await expect(tab2).toBeVisible();

    // Switching tab updates the case header (file path) and the link target.
    await tab2.click();
    await expect(page.getByText('tests/checkout.spec.ts').first()).toBeVisible();

    const link = page.getByRole('link', { name: 'Open test run case' }).first();
    await expect(link).toHaveAttribute('href', /\/test-run-cases\/\d+/);
  });

  test('extract action is reachable while the section is folded', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // Section starts folded; the header action still works.
    const extract = page.getByRole('button', { name: 'Extract' });
    await expect(extract).toBeVisible();
    await extract.click();
    await expect(page.getByText('Extract test cases')).toBeVisible();
  });
});
