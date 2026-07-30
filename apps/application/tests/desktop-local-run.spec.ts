import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The desktop-only "Run locally" flow, driven against the regular web build
 * with a faked Tauri IPC bridge. The UI gates itself purely on the bridge's
 * presence, so installing `window.__TAURI__` before the app boots exercises the
 * real components, composables and event plumbing end to end — everything but
 * the Rust process spawn itself (covered by `desktop/e2e/`).
 */

interface FakeInvocation {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

declare global {
  interface Window {
    __piwiFakeTauri: { invocations: FakeInvocation[] };
  }
}

/** Install a fake `window.__TAURI__` before any app script runs. */
async function installFakeBridge(page: Page, options: { linked: boolean; missingSpecs?: string[] }) {
  await page.addInitScript((opts: { linked: boolean; missingSpecs?: string[] }) => {
    const listeners: ((event: { payload: unknown }) => void)[] = [];
    const state = {
      link: opts.linked ? { path: '/home/dev/acme', exists: true } : null,
      invocations: [] as { cmd: string; args: Record<string, unknown> | undefined }[],
    };
    Object.assign(window, { __piwiFakeTauri: state });
    Object.assign(window, {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            state.invocations.push({ cmd, args });
            switch (cmd) {
              case 'desktop_get_project_link':
                return state.link;
              case 'desktop_pick_folder':
                return '/home/dev/acme';
              case 'desktop_set_project_link':
                state.link = { path: '/home/dev/acme', exists: true };
                return null;
              case 'desktop_check_local_specs':
                return { folder: '/home/dev/acme', missing: opts.missingSpecs ?? [] };
              case 'desktop_run_local_tests':
                setTimeout(() => {
                  for (const emit of listeners) {
                    emit({ payload: { id: 7, kind: 'stdout', line: 'Running 1 test using 1 worker', code: null } });
                    emit({ payload: { id: 7, kind: 'stdout', line: '  1 passed (2.0s)', code: null } });
                    emit({ payload: { id: 7, kind: 'exit', line: null, code: 0 } });
                  }
                }, 50);
                return 7;
              case 'desktop_stop_local_tests':
                return null;
              default:
                throw new Error(`unexpected command: ${cmd}`);
            }
          },
        },
        event: {
          listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
            if (name === 'piwi:local-run') listeners.push(cb);
            return () => {};
          },
        },
      },
    });
  }, options);
}

test.describe('Desktop local run', () => {
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.DESKTOP_LOCAL_RUN,
        status: 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: 12000,
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
            browser: { name: 'chromium', projectName: 'chromium' },
            error: 'TimeoutError: locator.click: Timeout 30000ms exceeded.',
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
          },
          {
            title: 'homepage loads',
            status: 'passed',
            duration: 1000,
            location: 'tests/home.spec.ts:5:1',
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    runId = proj.testRuns[0].id;
  });

  test('without the bridge the button does not exist', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);
    // The copyable Retry button proves the summary (where "Run locally" would
    // sit) has rendered with failed cases.
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run locally' })).toHaveCount(0);
  });

  test('runs the failed tests in the linked folder and streams output', async ({ page }) => {
    await installFakeBridge(page, { linked: true });
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Run locally' }).click();
    const dialog = page.getByRole('dialog');

    // The linked folder and the exact command are shown before anything runs.
    await expect(dialog.getByText('/home/dev/acme')).toBeVisible();
    await expect(dialog.getByText('playwright test tests/checkout.spec.ts:42 --project=chromium')).toBeVisible();

    await dialog.getByRole('button', { name: 'Run', exact: true }).click();

    await expect(dialog.getByText('Running 1 test using 1 worker')).toBeVisible();
    await expect(dialog.getByText('1 passed (2.0s)')).toBeVisible();
    await expect(dialog.getByText('Passed', { exact: true })).toBeVisible();

    const runInvocation = await page.evaluate(() =>
      window.__piwiFakeTauri.invocations.find((i) => i.cmd === 'desktop_run_local_tests'),
    );
    expect(runInvocation).toBeTruthy();
    expect(runInvocation!.args!.args).toEqual(['tests/checkout.spec.ts:42', '--project=chromium']);
    expect(String(runInvocation!.args!.projectId)).toMatch(/^\d+$/);
  });

  test('warns before running when the linked folder holds none of the tests', async ({ page }) => {
    await installFakeBridge(page, { linked: true, missingSpecs: ['tests/checkout.spec.ts'] });
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Run locally' }).click();
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByText('None of these tests are in the linked folder')).toBeVisible();
    await expect(dialog.getByText('tests/checkout.spec.ts', { exact: true })).toBeVisible();
    await expect(dialog.getByText('linked to a different checkout')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Choose the right folder…' })).toBeVisible();

    // A warning, never a block: the config may put specs elsewhere.
    await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  });

  test('prompts to link a folder when none is linked yet', async ({ page }) => {
    await installFakeBridge(page, { linked: false });
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Run locally' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Choose folder…' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Choose folder…' }).click();

    await expect(dialog.getByText('/home/dev/acme')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();

    const setInvocation = await page.evaluate(() =>
      window.__piwiFakeTauri.invocations.find((i) => i.cmd === 'desktop_set_project_link'),
    );
    expect(setInvocation!.args!.path).toBe('/home/dev/acme');
  });
});
