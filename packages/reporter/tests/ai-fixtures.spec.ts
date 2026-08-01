import { describe, it, expect } from 'vitest';
import { extendPiwiAi, missMessage, parseAiMode, piwiAiFixtures, readPositiveInt } from '../src/internal/ai/ai-fixtures.js';

describe('parseAiMode', () => {
  it('recognizes resolve and heal', () => {
    expect(parseAiMode('resolve')).toBe('resolve');
    expect(parseAiMode('heal')).toBe('heal');
  });
  it('defaults everything else to the read-only replay mode', () => {
    expect(parseAiMode(undefined)).toBe('replay');
    expect(parseAiMode('')).toBe('replay');
    expect(parseAiMode('yes')).toBe('replay');
  });
});

describe('missMessage', () => {
  it('names the entry file and gives the exact resolve command', () => {
    const message = missMessage('log in as {email}', 'checkout › pays by card', 'tests/__piwi__/x.json');
    expect(message).toContain('no committed entry for "log in as {email}"');
    expect(message).toContain('tests/__piwi__/x.json');
    expect(message).toContain('piwi ai resolve --grep "checkout › pays by card"');
  });
});

describe('readPositiveInt', () => {
  it('parses non-negative integers from configurable-cap env values', () => {
    expect(readPositiveInt('20')).toBe(20);
    expect(readPositiveInt('0')).toBe(0);
    expect(readPositiveInt('12.9')).toBe(12);
  });
  it('returns undefined (fall back to default) for unset or invalid values', () => {
    expect(readPositiveInt(undefined)).toBeUndefined();
    expect(readPositiveInt('')).toBeUndefined();
    expect(readPositiveInt('-5')).toBeUndefined();
    expect(readPositiveInt('abc')).toBeUndefined();
  });
});

describe('exports', () => {
  it('exposes the fixtures object and the extend helper', () => {
    expect(typeof extendPiwiAi).toBe('function');
    expect(piwiAiFixtures).toHaveProperty('page');
  });
});
