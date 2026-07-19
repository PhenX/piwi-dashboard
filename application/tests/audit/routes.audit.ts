/**
 * Route + tab-panel sweep. Visits every core route and every `?tab=` panel with a
 * fresh page (isolated console/network listeners), captures a full-page screenshot to
 * audit-report/screens/, records TTFB, and soft-asserts no uncaught page errors or
 * failed same-origin API calls. Soft assertions keep the whole sweep running so one bad
 * page doesn't hide the rest.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { waitForHydration } from '../utils';
import {
  collectPageIssues,
  readNav,
  resolveTargets,
  slug,
  SCREEN_DIR,
  STATIC_ROUTES,
  PROJECT_TABS,
  RUN_TABS,
  CASE_TABS,
  type AuditTargets,
} from './_audit';

let targets: AuditTargets;

test.beforeAll(async ({ request }) => {
  targets = await resolveTargets(request);
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  // eslint-disable-next-line no-console
  console.log('[audit] resolved targets:', JSON.stringify(targets));
});

async function auditRoute(page: Page, route: string, label = route) {
  const issues = collectPageIssues(page);
  const resp = await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await waitForHydration(page);
  await page.waitForTimeout(500); // let async panels/charts settle
  const nav = await readNav(page);
  await page
    .screenshot({ path: `${SCREEN_DIR}/${slug(label)}.png`, fullPage: true })
    // eslint-disable-next-line no-console
    .catch((e) => console.warn(`[audit] screenshot failed for ${label}: ${e}`));

  const summary = {
    route,
    http: resp?.status() ?? 0,
    ttfb: nav?.ttfb ?? null,
    load: nav?.load ?? null,
    consoleErrors: issues.consoleErrors,
    pageErrors: issues.pageErrors,
    failedRequests: issues.failedRequests,
  };
  await test.info().attach(`audit__${slug(label)}`, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(summary, null, 2)),
  });

  expect.soft(issues.pageErrors, `uncaught page error on ${route}`).toEqual([]);
  expect.soft(issues.failedRequests, `failed API request on ${route}`).toEqual([]);
  expect.soft(resp?.status() ?? 0, `HTTP status for ${route}`).toBeLessThan(400);
}

for (const route of STATIC_ROUTES) {
  test(`static ${route}`, async ({ page }) => {
    await auditRoute(page, route);
  });
}

for (const tab of PROJECT_TABS) {
  test(`project ?tab=${tab}`, async ({ page }) => {
    await auditRoute(page, `/projects/${targets.projectId}?tab=${tab}`, `project_${tab}`);
  });
}

for (const tab of RUN_TABS) {
  test(`run ?tab=${tab}`, async ({ page }) => {
    await auditRoute(page, `/test-runs/${targets.failedRunId}?tab=${tab}`, `run_${tab}`);
  });
}

for (const tab of CASE_TABS) {
  test(`case ?tab=${tab}`, async ({ page }) => {
    test.skip(!targets.failedCaseId, 'no failed case resolved');
    await auditRoute(page, `/test-run-cases/${targets.failedCaseId}?tab=${tab}`, `case_${tab}`);
  });
}

test('failure cluster detail', async ({ page }) => {
  test.skip(!targets.clusterId, 'no cluster resolved');
  await auditRoute(page, `/failure-clusters/${targets.clusterId}`, 'cluster_detail');
});

test('project edit form', async ({ page }) => {
  await auditRoute(page, `/projects/${targets.projectId}/edit`, 'project_edit');
});

test('standalone test-cases catalog', async ({ page }) => {
  await auditRoute(page, `/projects/${targets.projectId}/test-cases`, 'project_test_cases_standalone');
});
