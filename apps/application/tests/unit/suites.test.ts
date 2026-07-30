import { describe, test, expect } from 'vitest';
import { splitSuitePath, joinSuitePath, SUITE_PATH_SEP } from '#shared/utils/suites';

describe('splitSuitePath / joinSuitePath', () => {
  test('round-trips a multi-level suite path', () => {
    const path = ['Login', 'with valid credentials'];
    expect(splitSuitePath(joinSuitePath(path))).toEqual(path);
  });

  test('splitSuitePath returns [] for null, undefined, or empty string', () => {
    expect(splitSuitePath(null)).toEqual([]);
    expect(splitSuitePath(undefined)).toEqual([]);
    expect(splitSuitePath('')).toEqual([]);
  });

  test('joinSuitePath returns "" for null, undefined, or an empty array', () => {
    expect(joinSuitePath(null)).toBe('');
    expect(joinSuitePath(undefined)).toBe('');
    expect(joinSuitePath([])).toBe('');
  });

  test('splitSuitePath filters out empty segments', () => {
    const dirty = `Login${SUITE_PATH_SEP}${SUITE_PATH_SEP}nested`;
    expect(splitSuitePath(dirty)).toEqual(['Login', 'nested']);
  });

  test('joinSuitePath uses the \\x1f separator', () => {
    expect(joinSuitePath(['a', 'b'])).toBe(`a${SUITE_PATH_SEP}b`);
  });

  test('handles a single-element path', () => {
    expect(splitSuitePath(joinSuitePath(['solo']))).toEqual(['solo']);
  });
});
