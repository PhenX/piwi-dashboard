import type { Page, TestInfo } from '@playwright/test';

/**
 * Failure-time inspection: when enabled (opt-in via the `inspectOnFailure`
 * reporter option / `PIWI_INSPECT_ON_FAIL`), a failing test's page is handed
 * to the Playwright Inspector (`page.pause()`) just before it would close, so
 * the failing page can be examined live — including the Inspector's
 * "Pick locator" tool to choose a replacement for a broken locator.
 *
 * Local-only by design: inspection needs a human and a visible browser, so the
 * gate requires a headed browser and refuses to run under CI regardless of the
 * flag. It also waits for the final attempt when retries are configured — an
 * attempt that is about to be retried closes without pausing.
 */

/** Everything the gate reads, as plain values so it stays unit-testable. */
export interface InspectionGate {
  /** Raw `PIWI_INSPECT_ON_FAIL` env value — only the string `'true'` enables. */
  enabled: string | undefined;
  /** Raw `CI` env value. Anything except unset/empty/`'false'` counts as CI. */
  ci: string | undefined;
  /** `testInfo.status` at teardown. */
  status: string | undefined;
  /** `testInfo.expectedStatus` — an expected failure (test.fail()) never pauses. */
  expectedStatus: string | undefined;
  /** `testInfo.project.use.headless` — must be explicitly `false` (headed). */
  headless: unknown;
  /** Zero-based attempt index (`testInfo.retry`). */
  retry: number;
  /** Configured retry count for the project (`testInfo.project.retries`). */
  retries: number;
}

/** Decide whether the failing page should be handed to the Inspector. */
export function shouldInspectOnFailure(gate: InspectionGate): boolean {
  if (gate.enabled !== 'true') return false;
  if (gate.ci !== undefined && gate.ci !== '' && gate.ci !== 'false') return false;
  if (gate.headless !== false) return false;
  if (gate.status !== 'failed' && gate.status !== 'timedOut') return false;
  if (gate.status === gate.expectedStatus) return false;
  // Another attempt is coming — inspect the final failure, not each retry.
  return gate.retry >= gate.retries;
}

/** Project the live TestInfo + process env into the plain gate shape. */
export function inspectionGateFromTestInfo(testInfo: TestInfo): InspectionGate {
  const use = (testInfo.project?.use ?? {}) as { headless?: unknown };
  return {
    enabled: process.env.PIWI_INSPECT_ON_FAIL,
    ci: process.env.CI,
    status: testInfo.status,
    expectedStatus: testInfo.expectedStatus,
    headless: use.headless,
    retry: testInfo.retry,
    retries: testInfo.project?.retries ?? 0,
  };
}

/**
 * Open the Playwright Inspector on the failing page and wait for the human to
 * resume. Lifts the test timeout first — the run stays paused indefinitely —
 * and never throws (a broken inspector must not mask the test's own failure).
 */
export async function pauseForInspection(page: Page, testInfo: TestInfo): Promise<void> {
  try {
    testInfo.setTimeout(0);
    console.log(
      `\n[piwi] "${testInfo.title}" ${testInfo.status} — opening the Playwright Inspector on the failing page. ` +
        'Use "Pick locator" to choose a replacement locator, then resume (▶) to finish the run.',
    );
    await page.pause();
  } catch {
    // Inspection is best-effort — teardown continues either way.
  }
}
