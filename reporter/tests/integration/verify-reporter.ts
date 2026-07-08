import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Inspects the real `piwi-*` testInfo attachments produced by the capture
 * fixtures (`dashboardFixtures`) at the end of each test and fails the whole
 * `playwright test` run (non-zero exit code) on a mismatch. This is the
 * integration-level counterpart to the unit tests in `tests/capture-fixtures.spec.ts`
 * and `tests/locator-healing.spec.ts` — it exercises the real Proxy-wrapped
 * locator, network, and console capture end to end against a live browser,
 * which those unit tests (necessarily mocked) cannot.
 */
export default class VerifyCaptureReporter implements Reporter {
  private failures: string[] = [];
  private checkedAtLeastOne = false;

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'passed') {
      this.fail(`test "${test.title}" did not pass (status: ${result.status})`);
      return;
    }

    const byName = (name: string) => result.attachments.find((a) => a.name === name);
    const assert = (cond: boolean, msg: string) => {
      if (!cond) this.fail(msg);
    };

    const locators = byName('piwi-locators');
    assert(!!locators, 'expected a piwi-locators attachment');
    if (locators?.body) {
      const snapshots = JSON.parse(locators.body.toString('utf8')) as Array<{
        location: string;
        element: { tagName: string; attributes: Record<string, unknown> } | null;
        alternatives: unknown[];
      }>;
      assert(Array.isArray(snapshots) && snapshots.length > 0, 'piwi-locators body should be a non-empty array');
      const saveBtn = snapshots.find((s) => s.element?.attributes?.['data-testid'] === 'save-btn');
      assert(!!saveBtn, 'expected a captured snapshot for the save-btn locator');
      assert(saveBtn?.element?.tagName === 'button', 'captured element should record its tag name');
      assert(typeof saveBtn?.location === 'string' && saveBtn.location.length > 0, 'snapshot should record a location');
      assert(
        Array.isArray(saveBtn?.alternatives) && saveBtn!.alternatives.length > 0,
        'captured element should have generated locator alternatives',
      );
    }

    const network = byName('piwi-network');
    assert(!!network, 'expected a piwi-network attachment');
    if (network?.body) {
      const requests = JSON.parse(network.body.toString('utf8')) as Array<{
        url: string;
        method: string;
        status: number;
      }>;
      const ping = requests.find((r) => r.url.includes('/api/ping'));
      assert(!!ping, 'expected a captured network request for /api/ping');
      assert(ping?.method === 'GET', 'captured request should record its method');
      assert(ping?.status === 200, 'captured request should record its response status');
    }

    const console_ = byName('piwi-console');
    assert(!!console_, 'expected a piwi-console attachment');
    if (console_?.body) {
      const entries = JSON.parse(console_.body.toString('utf8')) as Array<{ type: string; text: string }>;
      const errorEntry = entries.find((e) => e.type === 'error' && e.text.includes('integration-test-console-error'));
      assert(!!errorEntry, 'expected a captured console.error entry');
    }

    this.checkedAtLeastOne = true;
  }

  onEnd(): void {
    if (!this.checkedAtLeastOne) this.fail('no test ran to completion — nothing was verified');
    if (this.failures.length > 0) {
      console.error(`\n[verify-reporter] ${this.failures.length} check(s) FAILED:`);
      for (const f of this.failures) console.error(`  ✗ ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\n[verify-reporter] all capture-fixtures integration checks passed.');
    }
  }

  private fail(msg: string): void {
    this.failures.push(msg);
  }
}
