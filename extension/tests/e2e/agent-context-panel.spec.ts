import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * Drives the real built `agent-context-panel.js`, the same way
 * `chrome.scripting.executeScript({ files: ['agent-context-panel.js'] })`
 * would (see `pick.spec.ts` for why the popup→injection wiring itself
 * isn't simulated here). The panel lives in a closed shadow root by design
 * (same reasoning as `results-panel.ts`), so these tests assert only
 * externally-observable effects — `buildAgentContext`'s own content is
 * covered directly in `agent-context.spec.ts`.
 */
test.describe('agent-context-panel.js', () => {
  test('picks an element and opens the context panel', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" data-testid="submit-btn">Submit</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();

    await page.hover('#target');
    await page.click('#target');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-agent-context-host'))).toBe(true);
  });

  test('Escape at the element step ends the flow with no panel', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (globalThis as any).__piwiPicking)).toBe(false);
    expect(await page.evaluate(() => !!document.getElementById('piwi-agent-context-host'))).toBe(false);
  });

  test('re-injecting while a pick is already in progress does not double-install the overlay', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(1);
  });

  test('Escape closes the context panel once open', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" data-testid="submit-btn">Submit</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
    await page.hover('#target');
    await page.click('#target');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-agent-context-host'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-agent-context-host'))).toBe(false);
  });
});
