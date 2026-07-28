import { defineConfig } from '@playwright/test';

/** An already-installed Chromium to use instead of the revision Playwright pins — see application/playwright.config.ts's own copy of this. */
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim() || '';

/**
 * Standalone Playwright project for the picker overlay's interactive DOM
 * behavior — hover/highlight/snap/tree-walk/pick/escape and the anchors and
 * confirm panels. Separate from the Vitest unit suite (which cannot drive a
 * real browser). Run with `npm run picker-dom:test:integration`.
 */
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  reporter: [['line']],
  use: {
    headless: true,
    ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
  },
});
