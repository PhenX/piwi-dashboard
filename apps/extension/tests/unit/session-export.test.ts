import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isValidPickName, renderFixture, renderMarkdown, renderJson } from '../../src/shared/session-export.js';
import type { SessionPick } from '../../src/shared/session-storage.js';

const PICKS: SessionPick[] = [
  { name: 'submitButton', locator: `getByRole('button', { name: 'Submit' })`, pageUrl: 'https://example.com/checkout' },
  { name: 'emailInput', locator: `getByTestId('email-input')`, pageUrl: 'https://example.com/checkout' },
];

describe('isValidPickName', () => {
  it('accepts a plain identifier', () => {
    expect(isValidPickName('submitButton')).toBe(true);
  });

  it('accepts leading underscore/dollar and digits after the first character', () => {
    expect(isValidPickName('_foo2')).toBe(true);
    expect(isValidPickName('$foo2')).toBe(true);
  });

  it('rejects a name starting with a digit', () => {
    expect(isValidPickName('2fast')).toBe(false);
  });

  it('rejects names with spaces or punctuation', () => {
    expect(isValidPickName('submit button')).toBe(false);
    expect(isValidPickName('submit-button')).toBe(false);
    expect(isValidPickName('')).toBe(false);
  });
});

describe('renderFixture', () => {
  it('renders one readonly field per pick against this.page', () => {
    const out = renderFixture(PICKS);
    expect(out).toContain(`import type { Page } from '@playwright/test';`);
    expect(out).toContain(`export class PickedElements {`);
    expect(out).toContain(`  readonly submitButton = this.page.getByRole('button', { name: 'Submit' });`);
    expect(out).toContain(`  readonly emailInput = this.page.getByTestId('email-input');`);
  });

  it('renders a syntactically plausible empty class for no picks', () => {
    const out = renderFixture([]);
    expect(out).toContain(`export class PickedElements {`);
    expect(out).toContain(`constructor(private readonly page: Page) {}`);
  });
});

describe('renderMarkdown', () => {
  it('renders a table with one row per pick', () => {
    const out = renderMarkdown(PICKS);
    const lines = out.split('\n');
    expect(lines[0]).toBe('| Name | Locator | Page |');
    expect(lines[1]).toBe('|---|---|---|');
    expect(lines).toContain(
      "| submitButton | `getByRole('button', { name: 'Submit' })` | https://example.com/checkout |",
    );
    expect(lines).toContain("| emailInput | `getByTestId('email-input')` | https://example.com/checkout |");
  });
});

describe('renderJson', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps the picks with an exportedAt timestamp', () => {
    const out = JSON.parse(renderJson(PICKS));
    expect(out.exportedAt).toBe('2026-07-28T12:00:00.000Z');
    expect(out.picks).toEqual(PICKS);
  });
});
