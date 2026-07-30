import { describe, test, expect } from 'vitest';
import { jsonArrayContains, jsonArrayContainsAll, parseTagFilter } from '#shared/utils/tag-filter';
import { sql } from 'drizzle-orm';
import { testCases } from '../../server/database/schema';

/** The bound parameters drizzle would send for a predicate. */
function paramsOf(fragment: ReturnType<typeof sql>): unknown[] {
  // `queryChunks` holds a mix of SQL chunks and bound params; the params are
  // the plain values, which is all these assertions care about.
  const chunks = (fragment as unknown as { queryChunks: unknown[] }).queryChunks;
  return chunks.filter((chunk) => typeof chunk === 'string' || typeof chunk === 'number');
}

describe('parseTagFilter', () => {
  test('splits on commas and trims', () => {
    expect(parseTagFilter('smoke, regression ,critical')).toEqual(['smoke', 'regression', 'critical']);
  });

  test('accepts a leading @ so the query param matches how tags are written', () => {
    expect(parseTagFilter('@smoke,regression')).toEqual(['smoke', 'regression']);
  });

  test('drops blanks and duplicates', () => {
    expect(parseTagFilter('smoke,,  ,smoke,@smoke')).toEqual(['smoke']);
  });

  test('returns an empty list for nothing', () => {
    expect(parseTagFilter(undefined)).toEqual([]);
    expect(parseTagFilter(null)).toEqual([]);
    expect(parseTagFilter('')).toEqual([]);
    expect(parseTagFilter(' , ')).toEqual([]);
  });
});

describe('jsonArrayContains', () => {
  test('matches the JSON-encoded element, so a tag cannot match a prefix of another', () => {
    const [pattern] = paramsOf(jsonArrayContains(testCases.tags, 'smoke')).filter((p) => typeof p === 'string');
    // `"smoke"` with its quotes — `smoke-test` serializes as `"smoke-test"`,
    // which does not contain `"smoke"`.
    expect(pattern).toBe('%"smoke"%');
    expect('["smoke-test"]'.includes('"smoke"')).toBe(false);
    expect('["smoke"]'.includes('"smoke"')).toBe(true);
  });

  test('escapes LIKE wildcards in the tag so they match literally', () => {
    const [pattern] = paramsOf(jsonArrayContains(testCases.tags, 'a%b_c')).filter((p) => typeof p === 'string');
    expect(pattern).toBe('%"a\\%b\\_c"%');
  });

  test('a tag containing a quote still matches its stored encoding', () => {
    const [pattern] = paramsOf(jsonArrayContains(testCases.tags, 'he"llo')).filter((p) => typeof p === 'string');
    // JSON.stringify escapes the quote as \" and the backslash is then escaped
    // again for LIKE, so the pattern matches the bytes the driver wrote.
    expect(JSON.stringify(['he"llo'])).toContain('"he\\"llo"');
    expect(pattern).toBe('%"he\\\\"llo"%');
  });

  test('builds one predicate per tag, so all of them must match', () => {
    expect(jsonArrayContainsAll(testCases.tags, ['a', 'b', 'c'])).toHaveLength(3);
    expect(jsonArrayContainsAll(testCases.tags, [])).toEqual([]);
  });
});
