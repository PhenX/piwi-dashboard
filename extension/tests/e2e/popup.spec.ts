import { test, expect } from './fixtures.js';

/**
 * Playwright has no API to click the browser's own toolbar icon, so this
 * opens `popup.html` directly (the standard way to test an MV3 popup's own
 * rendering) rather than simulating a real toolbar click end-to-end — a
 * page opened this way becomes the active tab itself, which would make
 * `chrome.tabs.query({ active: true })` target the popup page instead of a
 * real tab, so the injection buttons aren't exercised here (see
 * `pick.spec.ts` / `hover-inspect.spec.ts` for the content scripts they
 * inject, tested directly).
 */
test.describe('popup.html', () => {
  test('renders the pick, hover-inspect, locator console, multi-pick, and lint overlay actions', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole('button', { name: /Pick an element/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Toggle hover-inspect/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Locator console/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Multi-pick pattern/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lint overlay/ })).toBeVisible();
    await expect(page.getByText('Ctrl+Shift+E')).toBeVisible();
  });
});
