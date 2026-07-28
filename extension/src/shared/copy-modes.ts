export const COPY_MODES = ['bare', 'action', 'expect'] as const;
export type CopyMode = (typeof COPY_MODES)[number];

export const COPY_MODE_LABELS: Record<CopyMode, string> = {
  bare: 'Locator',
  action: 'Action',
  expect: 'Assertion',
};

/** Render a locator string as source in the requested copy mode. Takes just `{ locator }` (not the full `RankedLocator`) since that's the only field this ever reads — any locator-bearing candidate can reuse this, ranked or not. */
export function renderCopyMode(locator: { locator: string }, mode: CopyMode): string {
  switch (mode) {
    case 'bare':
      return `page.${locator.locator}`;
    case 'action':
      return `await page.${locator.locator}.click();`;
    case 'expect':
      return `await expect(page.${locator.locator}).toBeVisible();`;
  }
}
