import { describe, test, expect } from 'vitest';
import { demoImportLimitFor } from '../../app/demo/api/import';

/**
 * The demo writes imports into IndexedDB, so its ceiling comes from the
 * browser's reported free space rather than a number chosen in advance —
 * exceeding a quota fails mid-write, and the pre-flight exists to turn that
 * into a clean refusal.
 */
describe('demoImportLimitFor', () => {
  test('claims a quarter of free space', () => {
    expect(demoImportLimitFor(1024 * 1024 * 1024)).toBe(256 * 1024 * 1024);
  });

  test('never refuses a modest archive, however little is free', () => {
    expect(demoImportLimitFor(1024)).toBe(25 * 1024 * 1024);
    expect(demoImportLimitFor(0)).toBe(25 * 1024 * 1024);
    expect(demoImportLimitFor(Number.NaN)).toBe(25 * 1024 * 1024);
  });

  test('caps well below a large disk, since it all passes through memory', () => {
    expect(demoImportLimitFor(500 * 1024 * 1024 * 1024)).toBe(1024 * 1024 * 1024);
  });
});
