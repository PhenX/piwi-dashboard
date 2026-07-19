import { defineConfig, devices } from '@playwright/test';

/**
 * Isolated Playwright config for the usability-audit harness.
 *
 * Deliberately separate from `playwright.config.ts` so this read-only audit never:
 *   - triggers the `@piwitests/reporter` upload wrapper (`wrapConfig`),
 *   - runs `tests/globalSetup` (which DELETEs seeded projects via `/api/tests/cleanup`),
 *   - or collides with the functional `*.spec.ts` suite (this one only matches `*.audit.ts`).
 *
 * Expects a dev server already running against the SEEDED dev DB:
 *   npm run app:seed:demo
 *   mkdir -p .data && npm run db:migrate && npm run app:seed:dev
 *   NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002
 * then:
 *   npx playwright test --config=playwright.audit.config.ts
 *
 * Override the target with PIWI_AUDIT_URL (e.g. the auth-enabled pass on another port).
 */
const BASE_URL = process.env.PIWI_AUDIT_URL ?? 'http://localhost:3002';

// Optional explicit Chromium binary. Leave unset in CI / normal use (Playwright then
// uses its bundled browser); set PIWI_CHROMIUM_PATH when the bundled build isn't present
// (e.g. a sandbox that ships a different Chromium revision).
const CHROMIUM_PATH = process.env.PIWI_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests/audit',
  testMatch: '**/*.audit.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Dev-mode first-visit route compilation can be slow; keep a generous per-test budget
  // so a cold Vite compile never aborts a page before its screenshot is captured.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // No globalSetup/globalTeardown on purpose — the audit must not mutate seeded data.
  reporter: [
    ['list'],
    ['html', { outputFolder: 'audit-report', open: 'never' }],
    ['json', { outputFile: 'audit-report/audit-results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Fixed desktop viewport so screenshots are comparable across runs.
    viewport: { width: 1440, height: 900 },
    ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
