import { describe, it, expect } from 'vitest';
import { renderCopyMode } from '../../src/shared/copy-modes.js';
import type { RankedLocator } from '@piwitests/picker-dom';

const locator: RankedLocator = {
  locator: `getByRole('button', { name: 'Pay now' })`,
  method: 'getByRole',
  args: { role: 'button', name: 'Pay now' },
  score: 90,
};

describe('renderCopyMode', () => {
  it('renders the bare locator prefixed with page.', () => {
    expect(renderCopyMode(locator, 'bare')).toBe(`page.getByRole('button', { name: 'Pay now' })`);
  });

  it('renders a full click action line', () => {
    expect(renderCopyMode(locator, 'action')).toBe(`await page.getByRole('button', { name: 'Pay now' }).click();`);
  });

  it('renders a visibility assertion skeleton', () => {
    expect(renderCopyMode(locator, 'expect')).toBe(
      `await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible();`,
    );
  });
});
