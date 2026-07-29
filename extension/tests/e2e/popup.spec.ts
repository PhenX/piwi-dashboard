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

  test('every action tile carries a digit shortcut, 1 through 0, in render order', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const keys = await page.locator('.actions button').evaluateAll((buttons) =>
      buttons.map((b) => ({
        id: b.id,
        badge: b.querySelector('.key')?.textContent ?? null,
        announced: b.getAttribute('aria-keyshortcuts'),
      })),
    );
    expect(keys.map((k) => k.badge)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    // The visible badge and the announced shortcut must agree, or screen-reader
    // users get told a key that does nothing.
    for (const k of keys) expect(k.announced, `${k.id}`).toBe(k.badge);
  });

  test('pressing a digit runs that tile, and a modified digit is left to the browser', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(() => {
      (globalThis as unknown as { clicked: string[] }).clicked = [];
      for (const b of document.querySelectorAll<HTMLElement>('.actions button')) {
        b.addEventListener('click', () => (globalThis as unknown as { clicked: string[] }).clicked.push(b.id));
      }
    });

    await page.keyboard.press('3');
    await page.keyboard.press('0');
    await page.keyboard.press('Control+5');

    expect(await page.evaluate(() => (globalThis as unknown as { clicked: string[] }).clicked)).toEqual([
      'hover-inspect',
      'test-function-panel',
    ]);
  });

  test('digits typed into the project select drive its own typeahead, not the shortcuts', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              piwiConnection: {
                instanceUrl: 'https://piwi.test',
                apiKey: '',
                projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: '2024 release' }],
              },
            },
            resolve,
          );
        }),
    );
    await page.reload();
    await page.evaluate(() => {
      (globalThis as unknown as { clicked: string[] }).clicked = [];
      for (const b of document.querySelectorAll<HTMLElement>('.actions button')) {
        b.addEventListener('click', () => (globalThis as unknown as { clicked: string[] }).clicked.push(b.id));
      }
      document.getElementById('active-project')!.focus();
    });
    await page.keyboard.press('2');
    expect(await page.evaluate(() => (globalThis as unknown as { clicked: string[] }).clicked)).toEqual([]);
  });

  test('shows a config button that opens the options page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole('button', { name: 'Configure Piwi connection' })).toBeVisible();
  });

  test('hides the active-project row when not connected to a Piwi instance', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('#active-project-row')).toBeHidden();
  });

  test('shows the active-project row with the mapped project once connected', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              piwiConnection: {
                instanceUrl: 'https://piwi.test',
                apiKey: '',
                projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Demo project' }],
              },
            },
            resolve,
          );
        }),
    );
    await page.reload();

    await expect(page.locator('#active-project-row')).toBeVisible();
    await expect(page.locator('#active-project')).toHaveValue('');
    const optionTexts = await page.locator('#active-project option').allTextContents();
    expect(optionTexts).toContain('Demo project');
  });

  test('dedupes multiple URL patterns mapped to the same project into one option', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              piwiConnection: {
                instanceUrl: 'https://piwi.test',
                apiKey: '',
                projectMappings: [
                  { urlPattern: 'https://shop.example.com/**', projectId: 1, projectLabel: 'Demo project' },
                  { urlPattern: 'https://admin.example.com/**', projectId: 1, projectLabel: 'Demo project' },
                ],
              },
            },
            resolve,
          );
        }),
    );
    await page.reload();

    await expect(page.locator('#active-project-row')).toBeVisible();
    const optionTexts = await page.locator('#active-project option').allTextContents();
    expect(optionTexts.filter((t) => t === 'Demo project')).toHaveLength(1);
  });
});
