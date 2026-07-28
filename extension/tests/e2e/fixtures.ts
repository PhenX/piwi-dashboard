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
    // Not a check-then-await-the-event pattern: the service worker can
    // register in the gap between checking serviceWorkers() and attaching
    // a waitForEvent listener, missing the event entirely and hanging until
    // timeout. Polling re-checks the live state instead, so there's no gap
    // to lose the registration in.
    //
    // Deadline is kept comfortably below playwright.config.ts's own 60s
    // per-test timeout so this throw can actually surface instead of losing
    // a race against Playwright's own generic "Test timeout exceeded".
    const deadline = Date.now() + 45_000;
    let sw = context.serviceWorkers()[0];
    while (!sw && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      sw = context.serviceWorkers()[0];
    }
    if (!sw) throw new Error("the extension's service worker never registered within 45s");
    await use(sw.url().split('/')[2]!);
  },
});

export const expect = test.expect;
