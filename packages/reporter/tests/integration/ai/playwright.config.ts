import * as fs from 'node:fs';
import { defineConfig } from '@playwright/test';

// The sandbox pre-installs a plain chromium here but not the chrome-headless-shell
// revision this package's peer would otherwise resolve; point at it when present.
// In CI (and anywhere it is absent) fall back to Playwright's own resolution, which
// finds the `npx playwright install`-provided browser — so this config runs in both.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;

/**
 * Standalone Playwright project for the AI-step integration spec. Kept separate
 * from the capture spec's config (which uses `verify-reporter.ts`, a reporter
 * that asserts capture attachments this spec deliberately does not produce) and
 * from the application's own E2E suite.
 *
 * The mode (`resolve` / `replay`), the stub dashboard URL and the artifact
 * directory are all supplied through the environment by the orchestrator in
 * `run.mjs`, which runs this config twice. Plain `list` reporter — the spec's
 * own `expect()` assertions are the verification.
 */
export default defineConfig({
  testDir: '.',
  // Serial: the two tests share one committed-artifact directory and, in resolve
  // mode, author into it; a stable order keeps the stub's canned decisions simple.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
});
