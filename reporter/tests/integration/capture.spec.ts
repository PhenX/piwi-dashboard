import { test as base } from '@playwright/test';
import * as http from 'node:http';
import { extendPiwiFixtures } from '../../dist/index.js';

/**
 * Drives the REAL, built `@piwitests/reporter` package (not a mock) against a
 * live browser and a tiny local HTTP server, so the Proxy-based locator
 * wrapping, network/console/web-vitals capture, the failure-time ARIA snapshot,
 * and the locator suggestion are all exercised end to end — the things the
 * mocked unit tests in `tests/capture-fixtures.spec.ts` and
 * `tests/locator-healing.spec.ts` cannot do. Assertions live in
 * `verify-reporter.ts`, which inspects the resulting `piwi-*` attachments
 * after each test completes (fixture teardown attaches them after the test
 * body returns, so they aren't readable from within the test itself).
 *
 * Requires `npm run reporter:build` first — run via `npm run reporter:test:integration`.
 */
const test = extendPiwiFixtures(base);

const PAGE_HTML = `<!doctype html>
<html>
  <body>
    <label for="email">Email</label>
    <input id="email" type="email" />
    <button data-testid="save-btn" id="save" name="saveField">Save</button>
    <div id="status">idle</div>
    <script>
      document.getElementById('save').addEventListener('click', async () => {
        console.error('integration-test-console-error: save clicked');
        const res = await fetch('/api/ping');
        await res.json();
        document.getElementById('status').textContent = 'done';
      });
    </script>
  </body>
</html>`;

function startFixtureServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/ping') {
      const body = JSON.stringify({ ok: true });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(PAGE_HTML) });
    res.end(PAGE_HTML);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no addr'));
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

let server: http.Server;
let baseUrl: string;

test.beforeAll(async () => {
  ({ server, url: baseUrl } = await startFixtureServer());
});

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

// The main capture path: a navigation (→ web vitals), a locator action
// (→ locator snapshot), a fetch (→ network), and a console.error (→ console).
test('captures locators, a network request, a console error, and web vitals', async ({ page }) => {
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Save' }).click();

  // The locator capture that follows a click is deliberately fire-and-forget
  // (`capture-fixtures.ts` races it against a 500ms deadline so it can never
  // hang a test) — a polling wait (e.g. waitForFunction) contends with it for
  // the page's single evaluate() channel and can make it lose that race. A
  // plain wait avoids that contention; flushSink's own 2s drain deadline is
  // the real backstop this test is verifying against.
  await page.waitForTimeout(1000);
  const status = await page.locator('#status').textContent();
  if (status !== 'done') throw new Error(`expected #status to read "done", got "${status}"`);
});

// Failure-only capture: the ARIA snapshot and the fresh locator suggestion are
// produced only when a test fails, so this test is expected to fail. It clicks
// a button whose accessible name isn't on the page, so the suggestion resolves
// to the real "Save" button. verify-reporter checks both attachments.
test('captures the failure-time ARIA snapshot and a locator suggestion', async ({ page }) => {
  test.fail();
  await page.goto(baseUrl);
  await page.getByRole('button', { name: 'Nonexistent button' }).click({ timeout: 2000 });
});

// Teardown-race guard: a locator action immediately followed by test end closes
// the page while the capture probe is still in flight. Before the drain-on-close
// fix this raised a global "Object with guid handle@… was not bound in the
// connection" error that failed whichever test was running. Repeating it raises
// the odds of catching a regression; every one must pass.
for (let i = 0; i < 8; i++) {
  test(`teardown race guard ${i}`, async ({ page }) => {
    await page.goto(baseUrl);
    await page.getByRole('button', { name: 'Save' }).click();
    // Return immediately — the page closes while the probe is mid-flight.
  });
}
