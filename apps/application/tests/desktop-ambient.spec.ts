import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';

/**
 * The desktop shell's ambient unread state: the Notification shim (installed
 * by the desktop plugin whenever the IPC bridge exists) shows native
 * notifications and, while the window is hidden or unfocused, bumps
 * `desktop_set_activity`; focusing the window clears it. Driven against the
 * web build with a faked bridge.
 */

interface FakeInvocation {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

declare global {
  interface Window {
    __piwiAmbientInvocations: FakeInvocation[];
  }
}

async function installFakeBridge(page: Page) {
  await page.addInitScript(() => {
    const invocations: FakeInvocation[] = [];
    Object.assign(window, { __piwiAmbientInvocations: invocations });
    Object.assign(window, {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            invocations.push({ cmd, args });
            if (cmd === 'desktop_take_pending_open_files') return [];
            return null;
          },
        },
        event: {
          listen: async () => () => {},
        },
      },
    });
  });
}

test.describe('Desktop ambient unread state', () => {
  test('notifications bump the badge while unfocused and focus clears it', async ({ page }) => {
    await installFakeBridge(page);
    await page.goto('/');
    await waitForHydration(page);

    // The shim replaced the Notification API and always reports granted.
    const permission = await page.evaluate(() => window.Notification.permission);
    expect(permission).toBe('granted');

    // Two notifications while the document reads as hidden.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      new Notification('Piwi Dashboard', { body: 'acme-web on main: 3/120 tests failed' });
      new Notification('Piwi Dashboard', { body: 'acme-web: new failure cluster' });
    });

    let invocations = await page.evaluate(() => window.__piwiAmbientInvocations);
    const notifies = invocations.filter((i) => i.cmd === 'desktop_notify');
    expect(notifies).toHaveLength(2);
    const activity = invocations.filter((i) => i.cmd === 'desktop_set_activity');
    expect(activity.map((i) => i.args?.count)).toEqual([1, 2]);
    expect(activity[0]?.args?.status).toBe('acme-web on main: 3/120 tests failed');

    // Focus clears the badge.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      window.dispatchEvent(new Event('focus'));
    });
    invocations = await page.evaluate(() => window.__piwiAmbientInvocations);
    const last = invocations.filter((i) => i.cmd === 'desktop_set_activity').at(-1);
    expect(last?.args?.count).toBe(0);
  });

  test('a notification while focused shows natively but does not bump the badge', async ({ page }) => {
    await installFakeBridge(page);
    await page.goto('/');
    await waitForHydration(page);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      Object.defineProperty(document, 'hasFocus', { value: () => true, configurable: true });
      new Notification('Piwi Dashboard', { body: 'focused — no badge' });
    });

    const invocations = await page.evaluate(() => window.__piwiAmbientInvocations);
    expect(invocations.filter((i) => i.cmd === 'desktop_notify')).toHaveLength(1);
    expect(invocations.filter((i) => i.cmd === 'desktop_set_activity')).toHaveLength(0);
  });
});
