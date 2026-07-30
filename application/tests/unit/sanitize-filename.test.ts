import { describe, test, expect } from 'vitest';
import { safeStorageSegment, sanitizeFilename } from '../../server/utils/sanitize-filename';

describe('safeStorageSegment', () => {
  test('preserves a legitimate single segment exactly', () => {
    // Playwright trace source resources are named `src@<sha1>.txt` — the `@`
    // must survive or the trace events can no longer reference the resource.
    expect(safeStorageSegment('src@0123456789abcdef.txt')).toBe('src@0123456789abcdef.txt');
    expect(safeStorageSegment('0123456789abcdef0123456789abcdef01234567')).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    expect(safeStorageSegment('a.b-c_d')).toBe('a.b-c_d');
    // Dots that are not a whole traversal segment, and spaces, are kept.
    expect(safeStorageSegment('a..b')).toBe('a..b');
    expect(safeStorageSegment('a b')).toBe('a b');
  });

  test('rejects traversal and separator names', () => {
    expect(safeStorageSegment('')).toBeNull();
    expect(safeStorageSegment('.')).toBeNull();
    expect(safeStorageSegment('..')).toBeNull();
    expect(safeStorageSegment('../../../etc/cron.d/pwn')).toBeNull();
    expect(safeStorageSegment('foo/bar')).toBeNull();
    expect(safeStorageSegment('foo\\bar')).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  test('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('a/b c@d')).toBe('a_b_c_d');
    expect(sanitizeFilename('keep.this-name_1')).toBe('keep.this-name_1');
  });
});
