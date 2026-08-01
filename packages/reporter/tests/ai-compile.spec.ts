import { describe, it, expect } from 'vitest';
import type { ElementAttributes } from '@piwitests/core';
import { compileLocator, fingerprintOf, rankedToStructured } from '../src/internal/ai/compile.js';

const NO_ATTRS: Record<string, string | null> = {
  id: null,
  class: null,
  name: null,
  'data-testid': null,
  placeholder: null,
  alt: null,
  title: null,
  'aria-label': null,
  'aria-level': null,
  role: null,
  type: null,
  href: null,
  multiple: null,
};

function attrs(overrides: Partial<ElementAttributes> & { attributes?: Record<string, string | null> }): ElementAttributes {
  const { attributes, ...rest } = overrides;
  return {
    tagName: 'button',
    textContent: null,
    accessibleName: null,
    center: null,
    ...rest,
    attributes: { ...NO_ATTRS, ...attributes },
  };
}

describe('compileLocator', () => {
  it('prefers a unique data-testid, expressed positionally', () => {
    const compiled = compileLocator(
      attrs({ attributes: { 'data-testid': 'submit-btn' }, textContent: 'Submit', accessibleName: 'Submit', selectorCounts: { testId: 1 } }),
    );
    expect(compiled?.locator).toEqual({ method: 'getByTestId', args: ['submit-btn'] });
  });

  it('falls back to role + accessible name', () => {
    const compiled = compileLocator(attrs({ textContent: 'Submit', accessibleName: 'Submit' }));
    expect(compiled?.locator).toEqual({ method: 'getByRole', args: ['button', { name: 'Submit' }] });
  });

  it('carries a role/name fingerprint for drift detection', () => {
    const compiled = compileLocator(attrs({ textContent: 'Submit', accessibleName: 'Submit' }));
    expect(compiled?.fingerprint).toMatchObject({ role: 'button', name: 'Submit' });
  });
});

describe('rankedToStructured', () => {
  it('maps each builder method to positional Playwright args', () => {
    expect(rankedToStructured({ locator: '', method: 'getByLabel', args: { label: 'Email' }, score: 85 })).toEqual({
      method: 'getByLabel',
      args: ['Email'],
    });
    expect(
      rankedToStructured({ locator: '', method: 'getByRole', args: { role: 'heading', name: 'Hi', level: 2 }, score: 90 }),
    ).toEqual({ method: 'getByRole', args: ['heading', { name: 'Hi', level: 2 }] });
  });

  it('declines anchored-chain candidates (flattened in a later phase)', () => {
    expect(
      rankedToStructured({ locator: '', method: 'getByRole', args: { role: 'button', anchorTestId: 'bar' }, score: 70 }),
    ).toBeNull();
  });
});

describe('fingerprintOf', () => {
  it('includes the heading level when present', () => {
    const fp = fingerprintOf(attrs({ tagName: 'h2', attributes: { 'aria-level': '2' }, textContent: 'Title', accessibleName: 'Title' }));
    expect(fp.role).toBe('heading');
    expect(fp.level).toBe(2);
  });
});
