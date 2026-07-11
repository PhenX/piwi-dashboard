import { defineConfig } from '@playwright/test';

/** Where the reporter sends results. Override with PIWI_DASHBOARD_URL / PIWI_PROJECT_NAME. */
export const piwiOptions = {
  serverUrl: process.env.PIWI_DASHBOARD_URL ?? 'http://localhost:3000',
  projectName: process.env.PIWI_PROJECT_NAME ?? 'playwright-fixtures-example',
};

/** Base Playwright config shared by both example configs. */
export const baseConfig = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node app/server.mjs',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
