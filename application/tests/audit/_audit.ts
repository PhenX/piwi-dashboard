/**
 * Shared helpers for the usability-audit harness (see playwright.audit.config.ts).
 *
 * Deliberately self-contained: uses only `@playwright/test` + `../utils` so it does
 * NOT depend on `../fixtures` (which imports the not-always-built `reporter/dist`) and
 * adds no locator-capture proxy overhead to a read-only sweep.
 */
import type { Page, Locator, APIRequestContext } from '@playwright/test';

export type PageIssues = {
  consoleErrors: { text: string; location?: string }[];
  pageErrors: string[];
  failedRequests: { method: string; url: string; status: number }[];
};

/**
 * Console/network noise that is expected in this sandboxed dev environment and is
 * NOT a usability defect: font CDNs and brand-icon CDNs are blocked by the proxy
 * (fonts/icons fall back), and Vite HMR chatter.
 */
const CONSOLE_ALLOW = [
  /fontsource|fonts\.bunny|fonts\.googleapis|api\.fontsource/i,
  /simple-?icons|cdn\.simpleicons/i,
  /Failed to load resource/i,
  /\[vite\]/i,
  /favicon/i,
];

/** Attach console/pageerror/failed-response listeners. Call BEFORE page.goto. */
export function collectPageIssues(page: Page): PageIssues {
  const issues: PageIssues = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ALLOW.some((re) => re.test(text))) return;
    issues.consoleErrors.push({ text, location: msg.location()?.url });
  });
  page.on('pageerror', (err) => issues.pageErrors.push(err.message));
  page.on('response', (res) => {
    const url = res.url();
    const status = res.status();
    if (status < 400) return;
    if (!url.includes('/api/')) return; // same-origin API failures only
    if (/fonts|simpleicons|bunny/i.test(url)) return;
    issues.failedRequests.push({
      method: res.request().method(),
      url: url.replace(/^https?:\/\/[^/]+/, ''),
      status,
    });
  });
  return issues;
}

/** Read navigation timing (TTFB / load) for a rough per-page perf signal. */
export async function readNav(page: Page): Promise<{ ttfb: number; load: number } | null> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return null;
    return {
      ttfb: Math.round(nav.responseStart - nav.fetchStart),
      load: Math.round(nav.loadEventEnd - nav.fetchStart),
    };
  });
}

/** Count Tab presses from current focus until `target` is focused. -1 if not reached. */
export async function tabsToReach(page: Page, target: Locator, max = 40): Promise<number> {
  const handle = await target.elementHandle();
  if (!handle) return -1;
  try {
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press('Tab');
      const hit = await page.evaluate((el) => el === document.activeElement, handle).catch(() => false);
      if (hit) return i;
    }
    return -1;
  } finally {
    await handle.dispose();
  }
}

export type AuditTargets = {
  projectId: number;
  projectName: string;
  failedRunId: number;
  failedCaseId: number | null;
  clusterId: number | null;
};

/** Resolve concrete IDs from the live API — prefer a project with a failing run (richest UI). */
export async function resolveTargets(request: APIRequestContext): Promise<AuditTargets> {
  const projects = await (await request.get('/api/projects')).json();
  let chosen = projects[0];
  let detail: { testRuns?: { id: number; failedTests?: number }[] } | null = null;
  let failedRun: { id: number; failedTests?: number } | undefined;

  for (const p of projects) {
    const d = await (await request.get(`/api/projects/${p.id}`)).json();
    const runs = d.testRuns ?? [];
    const fr = runs.find((r: { failedTests?: number }) => (r.failedTests ?? 0) > 0);
    if (fr) {
      chosen = p;
      detail = d;
      failedRun = fr;
      break;
    }
    if (!detail) {
      chosen = p;
      detail = d;
      failedRun = runs[0];
    }
  }

  const run = await (await request.get(`/api/test-runs/${failedRun!.id}`)).json();
  const cases = run.testCases ?? [];
  const failedCase = cases.find((c: { status: string }) => c.status === 'failed') ?? cases[0];

  let clusterId: number | null = failedCase?.failureClusterId ?? null;
  if (!clusterId) {
    try {
      const clusters = await (await request.get(`/api/projects/${chosen.id}/failure-clusters`)).json();
      const arr = Array.isArray(clusters) ? clusters : (clusters.clusters ?? []);
      clusterId = arr[0]?.id ?? null;
    } catch {
      clusterId = null;
    }
  }

  return {
    projectId: chosen.id,
    projectName: chosen.name,
    failedRunId: failedRun!.id,
    failedCaseId: failedCase?.id ?? null,
    clusterId,
  };
}

// Exact `?tab=` slugs (read from the page sources).
export const PROJECT_TABS = [
  'test-runs',
  'failure-clusters',
  'flaky-tests',
  'performance',
  'test-cases',
  'compare',
  'spec-health',
  'timeline',
  'members',
];
export const RUN_TABS = ['test-cases', 'insights', 'failure-groups', 'regression', 'workers', 'compare', 'endpoints'];
export const CASE_TABS = ['diagnosis', 'steps', 'artifacts', 'performance', 'history'];

export const STATIC_ROUTES = [
  '/',
  '/projects',
  '/analytics',
  '/docs',
  '/mcp',
  '/settings',
  '/settings/account',
  '/settings/users',
  '/settings/notifications',
  '/settings/tags',
  '/settings/storage',
  '/settings/wasted-time',
  '/settings/ai',
  '/settings/about',
];

/**
 * Where full-page screenshots land. Deliberately NOT under `audit-report/` (the HTML
 * reporter cleans that folder), so captures survive the run.
 */
export const SCREEN_DIR = 'audit-screens';

export function slug(route: string): string {
  return (
    route
      .replace(/^\//, '')
      .replace(/\?/, '__')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'home'
  );
}
