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
const ACTION_BUTTON_NAMES = [
  /Record actions/,
  /Pick an element/,
  /Hover-inspect/,
  /Locator console/,
  /Multi-pick/,
  /Lint overlay/,
  /Assertions/,
  /Session/,
  /Agent context/,
  /Test functions/,
];

test.describe('popup.html', () => {
  test('renders every action button and the keyboard-shortcut hint', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    for (const name of ACTION_BUTTON_NAMES) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.getByText('Ctrl+Shift+E')).toBeVisible();
  });
});
