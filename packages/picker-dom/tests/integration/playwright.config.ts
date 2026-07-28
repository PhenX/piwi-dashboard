import { defineConfig } from '@playwright/test';

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
    launchOptions: {
      // This package's @playwright/test peer resolves to a browser revision
      // this sandbox doesn't have pre-installed (only the regular chromium
      // binary is, not the separate chrome-headless-shell variant that
      // `headless: true` otherwise resolves to). Point at the pre-installed
      // binary directly instead of downloading a new one.
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
});
