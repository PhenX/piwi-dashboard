import { defineConfig } from '@playwright/test';

/**
 * E2E config for the desktop shell. Only the real-app "tauri" project exists —
 * see `fixtures.ts` for why there is no browser-only mode. The fixture launches
 * and tears down the app itself, so there is no Playwright `webServer` here.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // one app instance / one socket at a time
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  // Booting the shell + sidecar is slow; keep per-test timeouts roomy.
  timeout: 120_000,
  projects: [
    {
      name: 'tauri',
      use: {
        // @ts-expect-error — custom fixture option consumed by createTauriTest
        mode: 'tauri',
        // Traces/screenshots would capture the empty Playwright page, not the
        // real Tauri webview, so they are off (the fixture attaches native
        // screenshots on failure).
        trace: 'off',
        screenshot: 'off',
      },
    },
  ],
});
