import type { RankedLocator } from '@piwitests/picker-dom';

export const COPY_MODES = ['bare', 'action', 'expect'] as const;
export type CopyMode = (typeof COPY_MODES)[number];

export const COPY_MODE_LABELS: Record<CopyMode, string> = {
  bare: 'Locator',
  action: 'Action',
  expect: 'Assertion',
};

/** Render a ranked locator as source in the requested copy mode. */
export function renderCopyMode(locator: RankedLocator, mode: CopyMode): string {
  switch (mode) {
    case 'bare':
      return `page.${locator.locator}`;
    case 'action':
      return `await page.${locator.locator}.click();`;
    case 'expect':
      return `await expect(page.${locator.locator}).toBeVisible();`;
  }
}
