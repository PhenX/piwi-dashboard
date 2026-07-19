/**
 * Keyboard-navigation & a11y diagnostics.
 *
 * Each test RECORDS a metric and soft-asserts the DESIRED (post-fix) state, so the same
 * spec is red on the pre-fix build (documenting the gap) and green after the quick-win
 * fixes land — a built-in before/after. Nothing here is a hard failure that would abort
 * the sweep.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { waitForHydration } from '../utils';
import { tabsToReach, resolveTargets, SCREEN_DIR, type AuditTargets } from './_audit';

let targets: AuditTargets;

test.beforeAll(async ({ request }) => {
  targets = await resolveTargets(request);
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
});

async function note(name: string, value: unknown) {
  await test.info().attach(name, { contentType: 'text/plain', body: Buffer.from(String(value)) });
  // eslint-disable-next-line no-console
  console.log(`[audit:kbd] ${name} = ${value}`);
}

test('command palette (Cmd/Ctrl+K) opens, searches, and closes', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 3000 });
  await page.keyboard.type(targets.projectName.slice(0, 4));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SCREEN_DIR}/kbd_command_palette.png` }).catch(() => {});
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('g-chord shortcuts navigate (regression: useDashboard is never called)', async ({ page }) => {
  await page.goto('/projects');
  await waitForHydration(page);
  await page.locator('body').click({ position: { x: 2, y: 2 } }); // focus out of any input
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await page.waitForTimeout(500);
  const path = new URL(page.url()).pathname;
  await note('after "g h" pathname (want /)', path);
  expect.soft(path, '"g h" should navigate home').toBe('/');
});

test('g p / g a chords (new shortcuts)', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  const path = new URL(page.url()).pathname;
  await note('after "g p" pathname (want /projects)', path);
  expect.soft(path, '"g p" should navigate to /projects').toBe('/projects');
});

test('skip link is the first Tab stop and reveals on focus', async ({ page }) => {
  await page.goto('/');
  await waitForHydration(page);
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName, text: (el?.textContent || '').trim(), href: el?.getAttribute('href') };
  });
  await note('first Tab focus (want a "skip to main content" link)', JSON.stringify(info));
  await page.screenshot({ path: `${SCREEN_DIR}/kbd_skiplink.png` }).catch(() => {});
  expect.soft(info.text, 'first Tab stop should be the skip link').toMatch(/skip to main content/i);
});

test('tabsToReach: keystrokes to first Projects table action', async ({ page }) => {
  await page.goto('/projects');
  await waitForHydration(page);
  const firstRowLink = page.locator('table a, [role=row] a').first();
  const n = await tabsToReach(page, firstRowLink);
  await note('tabs from page top to first project row link', n);
});

test('collapsible section toggle exposes a focus ring', async ({ page }) => {
  test.skip(!targets.failedCaseId, 'no failed case resolved');
  await page.goto(`/test-run-cases/${targets.failedCaseId}`);
  await waitForHydration(page);
  const toggle = page.locator('[role=button][aria-expanded]').first();
  await expect(toggle).toBeVisible({ timeout: 5000 });
  const cls = (await toggle.getAttribute('class')) || '';
  await note('collapsible toggle class has focus-visible outline', /focus-visible:outline/.test(cls));
  expect.soft(cls, 'collapsible toggle should declare a focus-visible ring').toMatch(/focus-visible:outline/);
});

test('screenshot thumbnails are keyboard-operable (role/tabindex)', async ({ page }) => {
  test.skip(!targets.failedCaseId, 'no failed case resolved');
  await page.goto(`/test-run-cases/${targets.failedCaseId}?tab=artifacts`);
  await waitForHydration(page);
  await page.waitForTimeout(600);
  // A screenshot thumbnail wrapper that opens the lightbox should be reachable & activatable.
  const thumb = page.locator('[aria-label*="screenshot" i], [role=button]:has(img)').first();
  const count = await thumb.count();
  await note('keyboard-operable screenshot thumbnails found', count);
  if (count) {
    const info = await thumb.evaluate((el) => ({
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      tabindex: el.getAttribute('tabindex'),
    }));
    await note('first thumbnail role/tabindex', JSON.stringify(info));
    expect
      .soft(info.role === 'button' || info.tabindex != null, 'screenshot thumbnail should be a focusable button')
      .toBeTruthy();
  }
});

test('in-viewport images carry non-empty alt text', async ({ page }) => {
  test.skip(!targets.failedCaseId, 'no failed case resolved');
  await page.goto(`/test-run-cases/${targets.failedCaseId}?tab=artifacts`);
  await waitForHydration(page);
  await page.waitForTimeout(600);
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 8 && r.height > 8; // ignore tracking/spacer pixels
      })
      .filter((img) => !(img.getAttribute('alt') || '').trim())
      .map((img) => img.getAttribute('src')?.slice(0, 80) || '(no src)'),
  );
  await note('visible images missing alt', JSON.stringify(missing));
  expect.soft(missing, 'all visible images should have alt text').toEqual([]);
});
