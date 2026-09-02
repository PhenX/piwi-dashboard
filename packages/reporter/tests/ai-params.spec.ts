import { describe, it, expect } from 'vitest';
import {
  extractPlaceholders,
  isParametric,
  marker,
  maskValues,
  substituteArgs,
  substituteMarkers,
  validateParams,
} from '../src/internal/ai/params.js';
import type { LocatorArg } from '../src/internal/ai/artifact.js';

describe('extractPlaceholders', () => {
  it('returns distinct names in first-appearance order', () => {
    expect(extractPlaceholders('log in as {email} with {password}, retry {email}')).toEqual(['email', 'password']);
  });
  it('returns none for a plain template', () => {
    expect(extractPlaceholders('the submit button')).toEqual([]);
  });
});

describe('validateParams', () => {
  it('passes when every placeholder has a value', () => {
    expect(() => validateParams('row for {name}', { name: 'Alice' })).not.toThrow();
  });
  it('throws listing the missing placeholders', () => {
    expect(() => validateParams('{a} and {b}', { a: '1' })).toThrow(/missing parameter\(s\): b/);
  });
  it('needs no params object for a plain template', () => {
    expect(() => validateParams('plain', undefined)).not.toThrow();
  });
});

describe('substitution', () => {
  it('replaces {{name}} markers in a string', () => {
    expect(substituteMarkers('hello {{name}}', { name: 'Alice' })).toBe('hello Alice');
  });
  it('leaves an unknown marker untouched', () => {
    expect(substituteMarkers('{{x}}', {})).toBe('{{x}}');
  });
  it('walks nested locator args', () => {
    const args: LocatorArg[] = ['row', { name: '{{name}}', nested: [{ label: '{{label}}' }] }];
    expect(substituteArgs(args, { name: 'Alice', label: 'Email' })).toEqual([
      'row',
      { name: 'Alice', nested: [{ label: 'Email' }] },
    ]);
  });
});

describe('maskValues', () => {
  it('replaces parameter values with their markers, longest first', () => {
    const masked = maskValues('Welcome, alice@example.com (alice)', { email: 'alice@example.com', user: 'alice' });
    expect(masked).toBe(`Welcome, ${marker('email')} (${marker('user')})`);
  });
  it('ignores empty values', () => {
    expect(maskValues('unchanged', { blank: '' })).toBe('unchanged');
  });
});

describe('parametricity', () => {
  it('accepts compiled text that carries every placeholder as a marker', () => {
    expect(isParametric('row for {name}', 'getByRole("row", {"name":"{{name}}"})')).toBe(true);
  });
  it('rejects a positional grounding that dropped a placeholder marker', () => {
    expect(isParametric('row for {name}', 'getByRole("row", {"name":"Alice"})')).toBe(false);
  });
});
