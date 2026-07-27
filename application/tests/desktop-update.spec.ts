import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';

/**
 * The desktop-only update card on Settings → About, driven against the web
 * build with a faked Tauri bridge. The updater itself lives in the shell;
 * this covers the dashboard side: the three check outcomes render, install
 * streams progress, and the restart is only ever user-initiated.
 */

declare global {
  interface Window {
    __piwiUpdateInvocations: string[];
    __piwiEmitProgress: (downloaded: number, total: number | null) => void;
  }
}

async function installFakeBridge(
  page: Page,
  outcome: 'unsupported' | 'uptodate' | 'available',
  exitsOnInstall = false,
) {
  await page.addInitScript(
    ([state, exits]: [string, boolean]) => {
      const listeners: ((event: { payload: unknown }) => void)[] = [];
      const invocations: string[] = [];
      Object.assign(window, {
        __piwiUpdateInvocations: invocations,
        __piwiEmitProgress: (downloaded: number, total: number | null) => {
          for (const cb of listeners) cb({ payload: { downloaded, total } });
        },
      });
      Object.assign(window, {
        __TAURI__: {
          core: {
            invoke: async (cmd: string) => {
              invocations.push(cmd);
              switch (cmd) {
                case 'desktop_check_update':
                  return state === 'available'
                    ? { state, version: '99.0.0', notes: 'feat: everything', date: null, exits_on_install: exits }
                    : { state, version: null, notes: null, date: null, exits_on_install: exits };
                case 'desktop_install_update':
                  // Windows never returns here — the installer kills the app
                  // mid-call, so the promise simply never settles.
                  if (exits) return new Promise(() => {});
                  // Resolves after a beat so the progress event lands mid-install.
                  return new Promise((resolve) => setTimeout(resolve, 150));
                case 'desktop_restart_app':
                  return null;
                case 'desktop_take_pending_open_files':
                  return [];
                default:
                  throw new Error(`unexpected command: ${cmd}`);
              }
            },
          },
          event: {
            listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
              if (name === 'piwi:update-progress') listeners.push(cb);
              return () => {};
            },
          },
        },
      });
    },
    [outcome, exitsOnInstall] as [string, boolean],
  );
}

test.describe('Desktop update card', () => {
  test('does not exist without the bridge', async ({ page }) => {
    await page.goto('/settings/about');
    await waitForHydration(page);
    await expect(page.getByText('Application', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Check for updates')).toHaveCount(0);
  });

  test('reports an unsupported build honestly', async ({ page }) => {
    await installFakeBridge(page, 'unsupported');
    await page.goto('/settings/about');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText('This build has no update channel')).toBeVisible();
  });

  test('reports being up to date', async ({ page }) => {
    await installFakeBridge(page, 'uptodate');
    await page.goto('/settings/about');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText("You're on the latest version.")).toBeVisible();
  });

  test('installs an available update and restarts on demand', async ({ page }) => {
    await installFakeBridge(page, 'available');
    await page.goto('/settings/about');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText('Version 99.0.0 is available')).toBeVisible();
    await expect(page.getByText('feat: everything')).toBeVisible();

    await page.getByRole('button', { name: 'Install update' }).click();
    await page.evaluate(() => window.__piwiEmitProgress(50, 100));

    await expect(page.getByRole('button', { name: 'Restart now' })).toBeVisible();
    await expect(page.getByText('applies the next time the app starts')).toBeVisible();

    await page.getByRole('button', { name: 'Restart now' }).click();
    const invocations = await page.evaluate(() => window.__piwiUpdateInvocations);
    expect(invocations).toContain('desktop_install_update');
    expect(invocations).toContain('desktop_restart_app');
  });

  test('promises a quit, not a restart, when the installer closes the app', async ({ page }) => {
    await installFakeBridge(page, 'available', true);
    await page.goto('/settings/about');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.getByText('Piwi closes while the installer runs')).toBeVisible();

    await page.getByRole('button', { name: 'Install and quit' }).click();

    // The shell dies mid-install here, so the call never settles and the
    // restart step must never be offered — it could not be clicked anyway.
    await expect(page.getByText('applies the next time the app starts')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restart now' })).toHaveCount(0);
    const invocations = await page.evaluate(() => window.__piwiUpdateInvocations);
    expect(invocations).toContain('desktop_install_update');
    expect(invocations).not.toContain('desktop_restart_app');
  });
});
