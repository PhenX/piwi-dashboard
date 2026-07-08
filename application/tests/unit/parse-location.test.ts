import { describe, test, expect } from 'vitest';
import { parseLocation } from '../../server/utils/parse-location';

describe('parseLocation', () => {
  test('parses filePath:line:column', () => {
    expect(parseLocation('tests/login.spec.ts:12:5')).toEqual({
      filePath: 'tests/login.spec.ts',
      line: 12,
      column: 5,
    });
  });

  test('parses filePath:line with no column', () => {
    expect(parseLocation('tests/login.spec.ts:12')).toEqual({
      filePath: 'tests/login.spec.ts',
      line: 12,
      column: null,
    });
  });

  test('returns the input unchanged with null line/column when there is no trailing position', () => {
    expect(parseLocation('tests/login.spec.ts')).toEqual({
      filePath: 'tests/login.spec.ts',
      line: null,
      column: null,
    });
  });

  test('handles a Windows-style path with a drive letter', () => {
    expect(parseLocation('C:\\repo\\tests\\login.spec.ts:10:5')).toEqual({
      filePath: 'C:\\repo\\tests\\login.spec.ts',
      line: 10,
      column: 5,
    });
  });

  test('does not misparse a non-numeric trailing segment', () => {
    expect(parseLocation('tests/weird:file.spec.ts')).toEqual({
      filePath: 'tests/weird:file.spec.ts',
      line: null,
      column: null,
    });
  });
});
