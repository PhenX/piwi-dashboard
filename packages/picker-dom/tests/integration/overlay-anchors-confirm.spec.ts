import { test, expect } from '@playwright/test';
import { showAnchorPicker } from '../../src/overlay-anchors.js';
import { showPickerChoices } from '../../src/overlay-confirm.js';

test.describe('showAnchorPicker', () => {
  test('lists ancestor rows and resolves the selection with a live match count', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form">
        <button id="target">Join</button>
      </form>
      <button>Elsewhere</button>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    });

    const row = page.locator('label').first();
    await expect(row).toContainText('data-testid="signup-form"');
    await row.locator('input[type="checkbox"]').check();

    await expect(page.getByText('Selection matches exactly 1 element')).toBeVisible();
    await page.getByRole('button', { name: 'Use selected parents' }).click();

    const state = await page.evaluate(() => (globalThis as any).__piwiAnchorState);
    expect(state).toBe('done');
    const anchors = await page.evaluate(() => (globalThis as any).__piwiPickAnchors);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].testId).toBe('signup-form');
  });

  test('Escape resolves as skipped', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form"><button id="target">Join</button></form>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (globalThis as any).__piwiAnchorState)).toBe('skipped');
  });
});

test.describe('showPickerChoices', () => {
  test('renders ranked choices and resolves the clicked index', async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(showPickerChoices, {
      failing: `getByText('Pay now')`,
      choices: [
        { locator: `getByTestId('pay-now')`, score: 100 },
        { locator: `getByRole('button', { name: 'Pay now' })`, score: 90 },
      ],
    });
    const buttons = page.locator('button');
    // Two choices plus the trailing "skip" control.
    await expect(buttons).toHaveCount(3);
    await buttons.nth(1).click();
    expect(await page.evaluate(() => (globalThis as any).__piwiPickChoice)).toBe(1);
  });

  test('skip resolves to -1', async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(showPickerChoices, {
      failing: null,
      choices: [{ locator: `getByTestId('x')`, score: 100 }],
    });
    await page.getByText('Skip — keep the failure as-is').click();
    expect(await page.evaluate(() => (globalThis as any).__piwiPickChoice)).toBe(-1);
  });
});
