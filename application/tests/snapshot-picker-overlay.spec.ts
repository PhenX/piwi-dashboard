import { test, expect, type Page } from './fixtures';
import { buildPickerDocument } from '../app/utils/snapshot-picker-script';

/**
 * Drives the REAL picker document (buildPickerDocument) in a blob iframe with
 * the exact production hardening — sandbox="allow-scripts", opaque origin — and
 * asserts two things the picker must guarantee:
 *   1. it installs even when the snapshot markup is truncated/unbalanced, and
 *   2. once installed the snapshot is inert: clicks never navigate/activate, a
 *      field can't be focused or typed into, yet a click still picks an element.
 *
 * These run in a browser because the behaviour is preventDefault-in-a-sandbox —
 * not observable from jsdom/unit tests.
 */

const CONFIG = { probedAttrs: ['id', 'data-testid', 'name', 'class', 'type', 'role', 'placeholder', 'aria-label'] };

const SNAPSHOT = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif">
  <div style="height:180px"></div>
  <a href="#navigated" id="lnk" style="display:block;padding:16px">Go to link</a>
  <label style="display:block;padding:16px"><input type="checkbox" id="chk"> Checkbox</label>
  <input type="text" id="txt" value="orig" style="margin:16px;padding:8px">
</body></html>`;

/** Mount the picker document in a sandboxed blob iframe, mirroring SnapshotLocatorPicker.vue. */
async function mountPicker(page: Page, snapshotHtml: string): Promise<void> {
  const doc = buildPickerDocument(snapshotHtml, CONFIG);
  await page.setContent('<!doctype html><body style="margin:0"><div id="stage"></div>');
  await page.evaluate((d) => {
    (window as unknown as { __msgs: unknown[] }).__msgs = [];
    window.addEventListener('message', (e) => (window as unknown as { __msgs: unknown[] }).__msgs.push(e.data?.type));
    const url = URL.createObjectURL(new Blob([d], { type: 'text/html' }));
    const f = document.createElement('iframe');
    f.id = 'pf';
    f.src = url;
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = 'width:720px;height:560px;border:0';
    document.getElementById('stage')!.appendChild(f);
  }, doc);
}

const installed = (page: Page): Promise<boolean> =>
  page
    .waitForFunction(() => (window as unknown as { __msgs?: unknown[] }).__msgs?.includes('pickerReady'), null, {
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);

const messages = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => ((window as unknown as { __msgs?: unknown[] }).__msgs || []).slice());

const blobFrameUrl = (page: Page): string =>
  page
    .frames()
    .find((f) => f.url().startsWith('blob:'))
    ?.url() ?? '';

test.describe('DOM snapshot picker overlay', () => {
  test('installs, and a link click is swallowed (no navigation) while still picking', async ({ page }) => {
    await mountPicker(page, SNAPSHOT);
    expect(await installed(page)).toBe(true);

    await page.frameLocator('#pf').locator('#lnk').click({ force: true });
    await page.waitForTimeout(150);

    expect(blobFrameUrl(page)).not.toContain('#navigated'); // navigation blocked
    expect(await messages(page)).toContain('elementPicked'); // the click picked instead
  });

  test('a checkbox does not toggle and a text field cannot be focused or typed into', async ({ page }) => {
    await mountPicker(page, SNAPSHOT);
    expect(await installed(page)).toBe(true);
    const frame = page.frameLocator('#pf');

    await frame.locator('#chk').click({ force: true });
    await page.waitForTimeout(120);
    expect(await frame.locator('#chk').isChecked()).toBe(false);

    await frame.locator('#txt').click({ force: true });
    await page.keyboard.type('XYZ');
    await page.waitForTimeout(120);
    expect(await frame.locator('#txt').inputValue()).toBe('orig');
  });

  test('still installs when the snapshot is truncated mid-tag, so the page never stays live', async ({ page }) => {
    // Mirrors sanitizeDomSnapshot cutting at the hard cap inside an open tag —
    // a trailing <script> would be swallowed, but the picker is front-loaded.
    const truncated =
      `<!DOCTYPE html><html><body style="margin:0"><div style="height:180px"></div>` +
      `<a href="#navigated" id="lnk" style="display:block;padding:16px">Go</a><div class="x\n<!-- [truncated] -->`;
    await mountPicker(page, truncated);
    expect(await installed(page)).toBe(true);

    await page.frameLocator('#pf').locator('#lnk').click({ force: true });
    await page.waitForTimeout(150);
    expect(blobFrameUrl(page)).not.toContain('#navigated');
  });
});
