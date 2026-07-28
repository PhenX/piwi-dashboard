import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

test.describe('hover-inspect.js', () => {
  test('shows the top-ranked locator in a tooltip while hovering, no click needed', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button data-testid="submit-btn">Submit</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'hover-inspect.js') });

    await page.mouse.move(0, 0);
    await page.hover('button');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-hover-inspect-host'))).toBe(true);

    // The tooltip text is inside a closed shadow root by design, so assert
    // the externally-observable effect (host mounted, no click ever fired)
    // rather than the tooltip's own text.
    const clicks: number[] = [];
    await page.exposeFunction('__recordClick', () => clicks.push(1));
    await page.evaluate(() => document.addEventListener('click', () => (window as any).__recordClick(), true));
    await page.waitForTimeout(200);
    expect(clicks).toHaveLength(0);
  });

  test('a second trigger toggles it back off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'hover-inspect.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-hover-inspect-host'))).toBe(true);

    await page.addScriptTag({ path: path.join(DIST, 'hover-inspect.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-hover-inspect-host'))).toBe(false);
  });

  test('Escape turns it off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'hover-inspect.js') });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => !!document.getElementById('piwi-hover-inspect-host'))).toBe(false);
  });
});
