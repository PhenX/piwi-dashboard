/**
 * Fix verification, end to end through the ingest API.
 *
 * The behaviour under test is the one the product promises but never answered
 * before: a cluster that stops failing gets a recorded fix, with the commit and
 * how long it was open — and a fix that does not hold is marked as such rather
 * than left looking successful.
 */

import { test, expect, type APIRequestContext } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

interface Cluster {
  id: number;
  signature: string;
  status: string;
  fixLandedRunId: number | null;
  fixCommit: string | null;
  timeToResolutionMs: number | null;
  fixVerification: string | null;
}

let clock = Date.now() - 6 * 60 * 60 * 1000;
function nextStartTime(): string {
  clock += 10 * 60 * 1000;
  return new Date(clock).toISOString();
}

/**
 * A token unique to the current attempt, mixed into the failing error so each
 * attempt clusters on its own fingerprint.
 *
 * Retrying a `describe.serial` block re-runs it from the top against a project
 * that already exists — and this suite's whole subject is state accumulated
 * across runs, so the second attempt would otherwise inspect the first
 * attempt's recorded fix and fail on it. Letters, not digits: the fingerprint
 * normalizer collapses numbers to a placeholder, which would make every
 * attempt cluster together again.
 */
let attemptTag = 'attemptA';
const failingError = () => `Error: card declined ${attemptTag}`;

async function submitRun(
  request: APIRequestContext,
  cases: Array<{ title: string; status: string; error?: string }>,
  options: { commit?: string; isFullRun?: boolean } = {},
): Promise<number> {
  const failedTests = cases.filter((c) => c.status === 'failed').length;
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.FIX_VERIFICATION,
      status: failedTests > 0 ? 'failed' : 'passed',
      startTime: nextStartTime(),
      duration: 1000,
      totalTests: cases.length,
      passedTests: cases.length - failedTests,
      failedTests,
      skippedTests: 0,
      isFullRun: options.isFullRun ?? true,
      metadata: options.commit ? { scm: { commit: options.commit, branch: 'main' } } : undefined,
      testCases: cases.map((c) => ({ ...c, duration: 10, location: 'tests/checkout.spec.ts:3:1' })),
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { testRunId: number };
  return body.testRunId;
}

/** This attempt's clusters only — see `attemptTag`. */
async function clusters(request: APIRequestContext, projectId: number): Promise<Cluster[]> {
  const res = await request.get(`/api/projects/${projectId}/failure-clusters`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { items?: Cluster[] };
  const all = body.items ?? [];
  return all.filter((c) => c.signature.includes(attemptTag));
}

async function projectIdFor(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/projects');
  const list = (await res.json()) as Array<{ id: number; name: string }>;
  const project = list.find((p) => p.name === PROJECT.FIX_VERIFICATION);
  expect(project, 'project should exist after the first submission').toBeTruthy();
  return project!.id;
}

test.describe.serial('Fix verification', () => {
  let projectId: number;

  test.beforeAll(({}, testInfo) => {
    attemptTag = `attempt${String.fromCharCode(65 + Math.min(testInfo.retry, 25))}`;
  });

  test('a cluster is not marked fixed while it is still failing', async ({ request }) => {
    await submitRun(request, [{ title: 'checkout pays', status: 'failed', error: failingError() }], {
      commit: 'aaaaaaa1',
    });
    projectId = await projectIdFor(request);

    await submitRun(request, [{ title: 'checkout pays', status: 'failed', error: failingError() }], {
      commit: 'aaaaaaa2',
    });

    const open = await clusters(request, projectId);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((c) => c.fixLandedRunId === null)).toBe(true);
  });

  test('a run where every affected test passes records the fix', async ({ request }) => {
    const runId = await submitRun(request, [{ title: 'checkout pays', status: 'passed' }], { commit: 'bbbbbbb1' });

    // The verification runs in the background after the run is stored.
    await expect
      .poll(async () => (await clusters(request, projectId)).find((c) => c.fixLandedRunId != null)?.fixLandedRunId, {
        timeout: 15_000,
      })
      .toBe(runId);

    const fixed = (await clusters(request, projectId)).find((c) => c.fixLandedRunId != null)!;
    expect(fixed.fixCommit).toBe('bbbbbbb1');
    // No SCM is reachable in this test, so the diff cannot corroborate the
    // diagnosis — "stopped failing" is the honest verdict.
    expect(fixed.fixVerification).toBe('stopped-failing');
    expect(fixed.timeToResolutionMs).toBeGreaterThan(0);
  });

  test('a fix that does not hold is marked regressed', async ({ request }) => {
    await submitRun(request, [{ title: 'checkout pays', status: 'failed', error: failingError() }], {
      commit: 'ccccccc1',
    });

    await expect
      .poll(async () => (await clusters(request, projectId)).find((c) => c.fixVerification === 'regressed')?.id, {
        timeout: 15_000,
      })
      .toBeTruthy();
  });

  test('a partial run never records a fix', async ({ request }) => {
    // The cluster is failing again after the regression above. A filtered run
    // that happens to exclude the failing test must not be read as a fix: a
    // test that did not execute has not been shown to pass.
    const before = (await clusters(request, projectId)).find((c) => c.fixVerification === 'regressed')!;

    await submitRun(request, [{ title: 'unrelated smoke test', status: 'passed' }], {
      commit: 'ddddddd1',
      isFullRun: false,
    });

    const after = (await clusters(request, projectId)).find((c) => c.id === before.id)!;
    expect(after.fixVerification).toBe('regressed');
  });

  // The verdict is only worth recording if someone can see it: for most of its
  // life this feature wrote columns no page ever read.
  test('the cluster page shows the verdict and how long the cluster was open', async ({ page, request }) => {
    const cluster = (await clusters(request, projectId)).find((c) => c.fixVerification === 'regressed')!;

    await page.goto(`/failure-clusters/${cluster.id}`);
    await expect(page.getByText('Regressed').first()).toBeVisible();
    await expect(page.getByText(/open for /).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`run #${cluster.fixLandedRunId}`)).first()).toBeVisible();
  });

  test('the project cluster list shows the verdict next to the triage status', async ({ page, request }) => {
    const cluster = (await clusters(request, projectId)).find((c) => c.fixVerification === 'regressed')!;

    await page.goto(`/projects/${projectId}?tab=failure-clusters`);
    // Anchor on the row's own link rather than its text: the signature cell
    // renders the cluster title when it has one, so matching on error text
    // finds nothing the moment a cluster gets named.
    const row = page.locator('tr').filter({ has: page.locator(`a[href="/failure-clusters/${cluster.id}"]`) });
    // Asserted separately so a failure says whether the row or the badge is
    // missing — the table loads client-side, after the page itself is ready.
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText('Regressed')).toBeVisible();
  });
});
