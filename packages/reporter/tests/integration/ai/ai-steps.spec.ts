import { test as base, expect } from '@playwright/test';
import { extendPiwiAi } from '../../../dist/index.js';

/**
 * Drives the REAL, built AI-step pipeline (`page.piwiLocator` / `page.piwiRun`)
 * against a live browser end to end — resolve → compile → execute → verify →
 * commit — with **zero real LLM calls**. A local stub stands in for the
 * dashboard's `/api/ai/step-resolution` endpoint and returns canned, deterministic
 * decisions (see `run.mjs`), so the whole reporter-side machinery exercised here
 * is the production code, not a mock: the Proxy fixtures, the `@piwitests/core`
 * locator compiler, the interpreter's `waitForResponse` arming, the drift guard
 * and the postcondition oracle.
 *
 * This one spec runs twice (orchestrated by `run.mjs`): first in `resolve` mode
 * (authors the artifacts, hitting the stub), then in `replay` mode (executes the
 * committed artifacts, and the stub asserts it is never called). Its own
 * assertions verify the browser actually reached the expected state in both
 * modes; `run.mjs` verifies the compile-once / replay-with-zero-LLM contract.
 *
 * Requires `npm run reporter:build` first — run via `npm run reporter:test:integration:ai`.
 */
const test = extendPiwiAi(base);

/** The app-under-test URL, served by the orchestrator and passed through the env. */
const APP_URL = process.env.PIWI_E2E_APP_URL;
if (!APP_URL) throw new Error('PIWI_E2E_APP_URL is not set — run this spec via tests/integration/ai/run.mjs');

test('piwiLocator resolves a described element to a working locator', async ({ page }) => {
  await page.goto(APP_URL);

  const email = page.piwiLocator('the email address field');
  await email.fill('ada@example.com');
  expect(await email.inputValue()).toBe('ada@example.com');
});

test('piwiRun compiles and replays a multi-step flow with an Ajax wait', async ({ page }) => {
  await page.goto(APP_URL);

  // Fill the email, click Sign in, wait for the /api/login response, then assert
  // the "Welcome" heading (the flow's postcondition oracle). The waited-for
  // response URL is chosen by the resolver from the calls the click triggered.
  await page.piwiRun('sign in as {email}', { email: 'ada@example.com' });

  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
