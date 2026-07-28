import { test, expect } from './fixtures.js';
import { liveCount } from '../../src/content/live-count.js';
import { domRoleOf, domHeadingLevel } from '@piwitests/picker-dom';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import type { Page } from '@playwright/test';

const MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

/**
 * `liveCount` isn't self-contained (unlike picker-dom's overlay functions) —
 * it's normal extension source, real imports resolved by Vite at build time
 * in production. Testing it via `page.evaluate` (which only ever serializes
 * one function's own source, no imports) needs its two dependencies
 * installed as page globals first, same as `__piwiProbe` in picker-dom's own
 * overlay-element tests.
 */
async function evalLiveCount(page: Page, locator: unknown): Promise<{ count: number | null }> {
  await page.evaluate(
    ([roleSrc, levelSrc]) => {
      (globalThis as any).domRoleOf = new Function(`return (${roleSrc})`)();
      (globalThis as any).domHeadingLevel = new Function(`return (${levelSrc})`)();
    },
    [domRoleOf.toString(), domHeadingLevel.toString()],
  );
  return page.evaluate(([fnSrc, loc, maps]) => new Function(`return (${fnSrc})`)()(loc, maps), [
    liveCount.toString(),
    locator,
    MAPS,
  ] as const);
}

test.describe('liveCount', () => {
  test('counts getByTestId and locator(css) exactly', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="a">A</button>
      <button class="btn">B</button>
      <button class="btn">C</button>
    </body></html>`);

    expect(await evalLiveCount(page, { locator: '', method: 'getByTestId', args: { testId: 'a' }, score: 0 })).toEqual({
      count: 1,
    });
    expect(await evalLiveCount(page, { locator: '', method: 'locator', args: { selector: '.btn' }, score: 0 })).toEqual(
      { count: 2 },
    );
  });

  test('counts a bare getByRole by role and heading level', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h2>One</h2>
      <h2>Two</h2>
      <h3>Three</h3>
    </body></html>`);

    expect(
      await evalLiveCount(page, { locator: '', method: 'getByRole', args: { role: 'heading', level: 2 }, score: 0 }),
    ).toEqual({ count: 2 });
    expect(
      await evalLiveCount(page, { locator: '', method: 'getByRole', args: { role: 'heading', level: 3 }, score: 0 }),
    ).toEqual({ count: 1 });
  });

  test('does not re-check anchor-scoped or name-based shapes (count: null)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><body><button>X</button></body></html>');

    expect(
      await evalLiveCount(page, {
        locator: '',
        method: 'getByRole',
        args: { role: 'button', anchorTestId: 'form' },
        score: 0,
      }),
    ).toEqual({ count: null });
    expect(await evalLiveCount(page, { locator: '', method: 'getByText', args: { text: 'X' }, score: 0 })).toEqual({
      count: null,
    });
  });
});
