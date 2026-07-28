import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(here, '..', '..', 'dist');

/** An already-installed Chromium to use instead of the revision Playwright pins — see application/playwright.config.ts's own copy of this. Extensions need the full browser, not the headless-shell variant `--only-shell` installs, so CI installs plain `chromium` here and leaves this unset. */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || '';

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(path.join(tmpdir(), 'piwi-picker-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`, '--headless=new'],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]!);
  },
});

export const expect = test.expect;
