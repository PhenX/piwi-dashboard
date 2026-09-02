import { describe, test, expect } from 'vitest';
import { timingSafeEqualStr } from '../../server/utils/timing-safe';

describe('timingSafeEqualStr', () => {
  test('returns true only for identical strings', () => {
    expect(timingSafeEqualStr('pd_abc123', 'pd_abc123')).toBe(true);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });

  test('returns false for differing strings, including near-misses and length differences', () => {
    expect(timingSafeEqualStr('token-a', 'token-b')).toBe(false);
    expect(timingSafeEqualStr('secret', 'secreT')).toBe(false);
    // Length differences must not throw (the SHA-256 digests are equal-length).
    expect(timingSafeEqualStr('short', 'a-much-longer-token')).toBe(false);
    expect(timingSafeEqualStr('prefix', 'prefix-extra')).toBe(false);
  });

  test('coerces a non-string input instead of throwing', () => {
    // Untrusted request bodies can carry non-strings; the helper must not throw.
    expect(() => timingSafeEqualStr(undefined as unknown as string, 'y')).not.toThrow();
    expect(timingSafeEqualStr('x', undefined as unknown as string)).toBe(false);
  });
});
