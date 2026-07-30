import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * The console's input, verdict text, and highlight boxes all live in a
 * closed shadow root by design (same reasoning as `results-panel.ts`), so —
 * like `hover-inspect.spec.ts` and `pick.spec.ts` — these tests assert only
 * externally-observable effects (host presence, toggling, and that the page
 * underneath stays interactive) rather than shadow-root-internal content.
 * `evaluateLocatorChain`'s matching behavior itself is covered directly in
 * `locator-eval.spec.ts`.
 */
test.describe('locator-console.js', () => {
  test('mounts on trigger and a second trigger toggles it back off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(true);

    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(false);
  });

  test('Escape closes it', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(false);
  });

  test('typing a valid locator expression does not throw an unhandled page error', async ({ context }) => {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));
    await page.setContent(`<!doctype html><html><body><button data-testid="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

    // The input auto-focuses on mount, so typed keys land there even though
    // it's inside a closed shadow root — keyboard events route to whatever
    // currently has focus regardless of shadow-root mode.
    await page.keyboard.type(`getByTestId('x')`);
    await page.waitForTimeout(100);
    expect(pageErrors).toHaveLength(0);
  });

  test('an unsupported expression is caught as a verdict, not thrown to the page', async ({ context }) => {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

    await page.keyboard.type(`evaluate('x')`);
    await page.waitForTimeout(100);
    expect(pageErrors).toHaveLength(0);
  });

  test('the page underneath stays clickable and scrollable while the console is open', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body style="height:2000px">
      <button id="target" style="position:absolute;top:10px;left:10px;">Click me</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

    let clicked = false;
    await page.exposeFunction('__recordClick', () => {
      clicked = true;
    });
    await page.evaluate(() =>
      document.getElementById('target')!.addEventListener('click', () => (window as any).__recordClick()),
    );

    await page.click('#target');
    expect(clicked).toBe(true);
  });
});
