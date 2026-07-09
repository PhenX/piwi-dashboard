import { describe, test, expect } from 'vitest';
import { percentile, durationStats } from '#shared/utils/stats';

describe('percentile', () => {
  test('returns 0 for an empty array', () => {
    expect(percentile([], 90)).toBe(0);
    expect(percentile([], 0)).toBe(0);
  });

  test('returns the only element regardless of p for a single-element array', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  test('p=0 returns the first (smallest) element', () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
  });

  test('p=100 returns the last (largest) element', () => {
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });

  test('lands on the exact index when p*n is a whole number', () => {
    // p/100 * n = 1 -> ceil(1) - 1 = index 0
    expect(percentile([10, 20, 30, 40, 50], 20)).toBe(10);
    // p/100 * n = 2 -> ceil(2) - 1 = index 1
    expect(percentile([10, 20, 30, 40, 50], 40)).toBe(20);
  });

  test('rounds up to the nearest rank between elements (no linear interpolation)', () => {
    // p/100 * n = 1.5 -> ceil(1.5) - 1 = index 1
    expect(percentile([10, 20, 30, 40, 50], 30)).toBe(20);
    // p/100 * n = 4.5 -> ceil(4.5) - 1 = index 4
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(50);
    // p/100 * n = 2.5 -> ceil(2.5) - 1 = index 2
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
});

describe('durationStats', () => {
  test('returns null for an empty array', () => {
    expect(durationStats([])).toBeNull();
  });

  test('returns null when all entries are null/undefined', () => {
    expect(durationStats([null, undefined, null])).toBeNull();
  });

  test('computes avg and p90 for a plain list', () => {
    expect(durationStats([10, 20, 30, 40, 50])).toEqual({ avg: 30, p90: 50 });
  });

  test('filters out null/undefined before computing', () => {
    // valid = [30, 10, 20] -> avg 20, sorted [10,20,30], p90 -> 30
    expect(durationStats([30, null, 10, undefined, 20])).toEqual({ avg: 20, p90: 30 });
  });

  test('rounds the average to the nearest integer', () => {
    // valid = [10, 15] -> avg round(12.5) = 13, p90 -> 15
    expect(durationStats([10, 15])).toEqual({ avg: 13, p90: 15 });
  });
});
