import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe('Dashboard UI Tests', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ request }) => {
    // Create test data before each UI test
    await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.UI_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 90000,
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'UI test case 1',
            status: 'passed',
            duration: 1000,
            location: 'tests/ui.spec.ts:10:5',
            retries: 0,
          },
        ],
      },
      timeout: 20000,
    });
  });

  test('should display dashboard home page', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/Piwi Dashboard/);

    // Check for stat strip
    await expect(page.getByText('failing now')).toBeVisible();
    await expect(page.getByText('runs today')).toBeVisible();

    // Check for projects section
    await expect(page.getByText('Project health')).toBeVisible();
  });

  test('should display projects list page', async ({ page }) => {
    await page.goto('/projects');

    // Check for at least one project - scope to page content
    await expect(page.getByRole('link', { name: PROJECT.UI_TEST }).first()).toBeVisible();

    // Check for test run count
    await expect(page.getByText(/\d+ runs/).first()).toBeVisible(); // There may be multiple projects
  });

  test('should navigate to project details page', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);

    // Click on a project - scope to page content to avoid sidebar duplicate
    await page.getByRole('link', { name: PROJECT.UI_TEST }).first().click();

    await page.waitForURL(/\/projects\/\d+/);

    // Wait for main content to confirm page loaded
    await expect(page.getByRole('heading', { name: 'Run trend' })).toBeVisible({ timeout: 30000 });

    // Project name should be visible in the breadcrumb/pill
    await expect(page.getByRole('button', { name: PROJECT.UI_TEST })).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to test run details page', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);

    // Click on a project - scope to page content to avoid sidebar duplicate
    await page.getByRole('link', { name: PROJECT.UI_TEST }).first().click();
    await page.waitForURL(/\/projects\/\d+/);
    await waitForHydration(page);

    // Click on first test run - wait for table to be interactive before clicking
    const viewButton = page.locator('table').getByRole('link', { name: 'View' }).first();
    await expect(viewButton).toBeVisible({ timeout: 10000 });
    await Promise.all([page.waitForURL(/\/test-runs\/\d+/), viewButton.click()]);

    // Check test run details are displayed
    await expect(page.locator('h2').first()).toContainText('Run #');
  });

  test('should switch between tabs on test run detail page', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);
    await page.getByRole('link', { name: PROJECT.UI_TEST }).first().click();
    await page.waitForURL(/\/projects\/\d+/);
    await waitForHydration(page);
    const viewButton = page.locator('table').getByRole('link', { name: 'View' }).first();
    await expect(viewButton).toBeVisible({ timeout: 10000 });
    await Promise.all([page.waitForURL(/\/test-runs\/\d+/), viewButton.click()]);
    await waitForHydration(page);

    await expect(page.getByRole('columnheader', { name: 'Test case' }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Timeline/ }).click();
    await page.getByRole('button', { name: /^Compare$/ }).click();
    await expect(page.getByText('Run A (baseline)')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Slow endpoints/ }).click();
  });

  test('should show project switcher dropdown', async ({ page }) => {
    await page.goto('/');

    // Find and click the project switcher - use first() to get the header one, not sidebar
    const projectSwitcher = page.getByRole('button', { name: /All projects|ui-test-project/ }).first();
    await expect(projectSwitcher).toBeVisible();

    // Click to open dropdown
    await projectSwitcher.click();

    // Check dropdown options
    await expect(page.getByText('All projects').first()).toBeVisible();
  });

  test('should navigate using sidebar', async ({ page }) => {
    await page.goto('/');

    // Click on Projects in sidebar
    await page.getByRole('link', { name: 'Projects' }).click();

    // Check navigation
    await page.waitForURL('/projects');

    // Click on Home in sidebar
    await page.locator('#dashboard-sidebar-default').getByRole('link', { name: 'Home' }).click();

    // Check navigation
    await page.waitForURL('/');
    await expect(page.getByText('Project health')).toBeVisible();
  });

  test('should display test status badges correctly', async ({ page }) => {
    await page.goto('/projects');

    // Check for status badge
    const statusBadge = page.locator('[class*="passed"]').or(page.locator('[class*="success"]')).first();
    await expect(statusBadge).toBeVisible();
  });

  test('should handle empty state gracefully', async ({ page }) => {
    await page.goto('/');

    // The dashboard should still load without errors
    await expect(page.getByText('Project health')).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await expect(page.getByText('Project health')).toBeVisible();

    // Test mobile view
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.getByText('Project health')).toBeVisible();
  });

  test('should refresh data when clicking refresh button', async ({ page }) => {
    await page.goto('/projects');

    // Click refresh button
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();
    await refreshButton.click();

    // Data should still be visible after refresh - use link to target table
    await expect(page.getByRole('link', { name: PROJECT.UI_TEST }).first()).toBeVisible();
  });

  test('should display storage settings page', async ({ page }) => {
    await page.goto('/settings/storage');
    await waitForHydration(page);

    // Check heading and stats section
    await expect(page.getByText('Storage statistics')).toBeVisible();
    await expect(page.getByText('Test runs', { exact: true })).toBeVisible();
    await expect(page.getByText('Cleanup old test runs')).toBeVisible();

    // Verify the cleanup button exists
    await expect(page.getByRole('button', { name: 'Run cleanup' })).toBeVisible();
  });

  test('should show delete confirmation modal on test run page', async ({ page, request }) => {
    // Ensure there is a test run
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.UI_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'delete-ui-test', status: 'passed', duration: 500, location: 'tests/x.spec.ts:1:1' }],
      },
    });
    const { runId } = await submitRes.json();

    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Delete button should be visible in the navbar
    const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteButton).toBeVisible();

    // Click it — confirmation modal should appear
    await deleteButton.click();
    await expect(page.getByText('Delete test run', { exact: true })).toBeVisible({ timeout: 10000 });

    // Close the modal
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Delete test run', { exact: true })).not.toBeVisible();
  });

  test('run metadata renders every fact group in the summary meta strip', async ({ page, request }) => {
    // Submit a run with CI, SCM, tags and environment so every fact group renders
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.BLOCK_LAYOUT,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 2,
        passedTests: 0,
        failedTests: 2,
        skippedTests: 0,
        environment: 'staging',
        testCases: [
          {
            title: 'block-layout-test-a',
            status: 'failed',
            duration: 1000,
            location: 'tests/a.spec.ts:1:1',
            error: 'Error: failure',
          },
          { title: 'block-layout-test-b', status: 'passed', duration: 500, location: 'tests/b.spec.ts:1:1' },
        ],
        metadata: {
          ci: { provider: 'GitHub Actions', buildNumber: '42' },
          scm: { commit: 'abc123def456', branch: 'main', author: 'test' },
          tags: ['smoke', 'regression'],
          projectDescription: 'Block layout verification',
        },
      },
    });
    const { runId } = await submitRes.json();

    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Each MetaStripGroup carries its label as a title attribute
    const ciGroup = page.locator('[role="group"][aria-label="CI & environment"]');
    await expect(ciGroup).toBeVisible();
    await expect(ciGroup).toContainText('staging');
    await expect(ciGroup).toContainText('GitHub Actions');
    await expect(ciGroup).toContainText('Build #42');

    const sourceGroup = page.locator('[role="group"][aria-label="Source"]');
    await expect(sourceGroup).toContainText('main');
    await expect(sourceGroup).toContainText('abc123de');

    const tagsGroup = page.locator('[role="group"][aria-label="Tags"]');
    await expect(tagsGroup).toContainText('smoke');
    await expect(tagsGroup).toContainText('regression');
  });

  test('tooling versions render in the meta strip without CI metadata', async ({ page, request }) => {
    // A run with no ci/environment but with Playwright/reporter versions still
    // gets a versions fact group — a regression guard: the old layout once
    // dropped the versions from the block count and broke the row.
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.BLOCK_LAYOUT_VERSIONS,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 30000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        playwrightVersion: '1.51.0',
        reporterVersion: '0.7.0',
        testCases: [{ title: 'versions-only-case', status: 'passed', duration: 500, location: 'tests/v.spec.ts:1:1' }],
        metadata: {
          scm: { commit: 'abc123def456', branch: 'main', author: 'test' },
          tags: ['smoke'],
        },
      },
    });
    const { runId } = await submitRes.json();

    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    const versionsGroup = page.locator('[role="group"][aria-label="Tooling versions"]');
    await expect(versionsGroup).toBeVisible();
    await expect(versionsGroup).toContainText('Playwright v1.51.0');
    await expect(versionsGroup).toContainText('Piwi v0.7.0');

    await expect(page.locator('[role="group"][aria-label="Source"]')).toContainText('main');
    await expect(page.locator('[role="group"][aria-label="Tags"]')).toContainText('smoke');
  });
});

test.describe('Foldable Summary', () => {
  // The run this test owns. `fullyParallel` spreads the block over several
  // workers, each seeding the same project, so "the newest run of
  // PROJECT.SUMMARY_FOLD" can belong to another worker's test — take the id the
  // submit returned instead.
  let runId = 0;

  test.beforeEach(async ({ page, request }) => {
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.SUMMARY_FOLD,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 90000,
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'fold test case',
            status: 'passed',
            duration: 1000,
            location: 'tests/fold.spec.ts:1:1',
            retries: 0,
            steps: [{ title: 'page.goto(url)', duration: 500, category: 'navigation' }],
            slowestStep: 'page.goto(url)',
            slowestStepDuration: 500,
            wastedTimeMs: 0,
          },
        ],
      },
      timeout: 20000,
    });
    runId = (await submitRes.json()).runId;
    await page.context().clearCookies();
  });

  test('should start expanded on test run detail page', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);

    await expect(page.getByTitle('Collapse summary')).toBeVisible();
    await expect(page.locator('h2').filter({ hasText: /Run #/ })).toBeVisible();
  });

  test('should collapse and expand test run summary', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await expect(page.getByTitle('Collapse summary')).toBeVisible();

    await page.getByTitle('Collapse summary').click({ force: true });
    await expect(page.locator('h2').filter({ hasText: /Run #/ })).not.toBeVisible();
    await expect(page.locator('span:has-text("T:")').first()).toBeVisible();

    await page.locator('span:has-text("T:")').first().click({ force: true });
    await expect(page.getByTitle('Collapse summary')).toBeVisible();
  });

  test('should show key info in folded state', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await page.getByTitle('Collapse summary').click({ force: true });

    await expect(page.locator('span:has-text("T:")').first()).toBeVisible();
    await expect(page.locator('span:has-text("P:")').first()).toBeVisible();
    await expect(page.locator('span:has-text("F:")').first()).toBeVisible();
    await expect(page.locator('span:has-text("S:")').first()).toBeVisible();
  });

  test('should start expanded on test case detail page', async ({ page, request }) => {
    const runRes = await request.get(`/api/test-runs/${runId}`);
    const runData = await runRes.json();
    const testCaseId = runData.testCases[0].executionId;

    await page.goto(`/test-run-cases/${testCaseId}`);
    await page.waitForURL(/\/test-run-cases\/\d+/);

    await expect(page.getByTitle('Collapse summary')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'fold test case', exact: true })).toBeVisible();
  });

  test('should collapse and expand test case summary', async ({ page, request }) => {
    const runRes = await request.get(`/api/test-runs/${runId}`);
    const runData = await runRes.json();
    const testCaseId = runData.testCases[0].executionId;

    await page.goto(`/test-run-cases/${testCaseId}`);
    await page.waitForURL(/\/test-run-cases\/\d+/);
    await waitForHydration(page);

    await expect(page.getByTitle('Collapse summary')).toBeVisible();

    await page.getByTitle('Collapse summary').click({ force: true });
    await expect(page.getByRole('heading', { name: 'fold test case', exact: true })).not.toBeVisible();
    await expect(page.locator('span:has-text("Dur:")').first()).toBeVisible();

    await page.locator('span:has-text("Dur:")').first().click({ force: true });
    await expect(page.getByTitle('Collapse summary')).toBeVisible();
  });

  test('should persist fold state across navigation', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await expect(page.getByTitle('Collapse summary')).toBeVisible({ timeout: 10000 });
    await page.getByTitle('Collapse summary').click({ force: true });
    await expect(page.locator('h2').filter({ hasText: /Run #/ })).not.toBeVisible();

    await page.reload();
    await expect(page.locator('h2').filter({ hasText: /Run #/ })).not.toBeVisible();
    await expect(page.locator('span:has-text("T:")').first()).toBeVisible();
  });
});

test.describe('Run Label', () => {
  // These tests edit the label of the run they seed. `fullyParallel` spreads
  // them over several workers, so "the newest run of PROJECT.RUN_LABEL" can be
  // another worker's run and two tests then fight over one label — take the id
  // the submit returned instead.
  let runId = 0;

  test.beforeEach(async ({ page, request }) => {
    const submitRes = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_LABEL,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 90000,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'label test case',
            status: 'passed',
            duration: 500,
            location: 'tests/label.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
      timeout: 20000,
    });
    runId = (await submitRes.json()).runId;
    await page.context().clearCookies();
  });

  test('shows + label button when no label exists', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    // Expanded summary should have the + label button
    const addLabelBtn = page.locator('h2').getByTitle('Add a label');
    await expect(addLabelBtn).toBeVisible();
    await expect(addLabelBtn).toHaveText('+ label');
  });

  test('clicking + label shows an inline input', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await page.locator('h2').getByTitle('Add a label').click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test('pressing Enter saves the label and displays it', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await page.locator('h2').getByTitle('Add a label').click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await input.fill('v1.0');
    await input.press('Enter');

    // Label should now be displayed
    await expect(page.locator('h2')).toContainText('— v1.0');
  });

  test('label persists after page reload', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await page.locator('h2').getByTitle('Add a label').click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await input.fill('persistent-label');
    await input.press('Enter');
    await expect(page.locator('h2')).toContainText('— persistent-label');

    await page.reload();
    await expect(page.locator('h2')).toContainText('— persistent-label');
  });

  test('clicking label text re-enters edit mode', async ({ page, request }) => {
    // Submit a run with a label via API
    await request.patch(`/api/test-runs/${runId}`, {
      data: { label: 'edit-me' },
    });

    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await expect(page.locator('h2')).toContainText('— edit-me');

    // Click the label text to start editing
    await page.locator('h2').locator('span', { hasText: '— edit-me' }).click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('edit-me');
  });

  test('pressing Escape cancels label edit', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    await page.locator('h2').getByTitle('Add a label').click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await input.fill('cancel-this');
    await input.press('Escape');

    // Label should not appear (no save was triggered)
    await expect(page.locator('h2').getByTitle('Add a label')).toBeVisible();
  });

  test('saving an empty label clears it', async ({ page, request }) => {
    // Set a label first via API
    await request.patch(`/api/test-runs/${runId}`, {
      data: { label: 'will-be-cleared' },
    });

    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    // Click the label
    await page.locator('h2').locator('span', { hasText: '— will-be-cleared' }).click();
    const input = page.locator('h2').getByPlaceholder('Add a label...');
    await expect(input).toHaveValue('will-be-cleared');

    // Clear and save
    await input.fill('');
    await input.press('Enter');
    await waitForHydration(page);

    // + label button should return
    await expect(page.locator('h2').getByTitle('Add a label')).toBeVisible();
  });

  test('label appears in breadcrumb on test run page', async ({ page, request }) => {
    await request.patch(`/api/test-runs/${runId}`, {
      data: { label: 'breadcrumb-label' },
    });

    await page.goto(`/test-runs/${runId}`);
    await page.waitForURL(/\/test-runs\/\d+/);
    await waitForHydration(page);

    // Wait for the summary and breadcrumb to render
    await expect(page.locator('h2')).toContainText('Run #');
    await expect(page.locator('h2')).toContainText('— breadcrumb-label');
    await expect(page.getByText('breadcrumb-label').first()).toBeVisible();
  });
});
