import { describe, test, expect } from 'vitest';
import {
  detectTimeoutOpportunity,
  hasSlowMark,
  resolveTimeoutThresholds,
  DEFAULT_TIMEOUT_THRESHOLDS,
  type TestTimeoutAggregate,
} from '../../shared/analytics/timeout-hygiene';

function agg(overrides: Partial<TestTimeoutAggregate>): TestTimeoutAggregate {
  return {
    testCaseId: 1,
    title: 'a test',
    filePath: 'tests/a.spec.ts',
    durations: [],
    timeout: null,
    hasSlowAnnotation: false,
    failCount: 0,
    ...overrides,
  };
}

const dur = (value: number, n = 10) => Array.from({ length: n }, () => value);

describe('detectTimeoutOpportunity', () => {
  test('returns null without enough runs', () => {
    expect(detectTimeoutOpportunity(agg({ durations: [1000, 1000, 1000], timeout: 120_000 }))).toBeNull();
  });

  test('flags an oversized timeout and recommends a lower value', () => {
    const opp = detectTimeoutOpportunity(agg({ durations: dur(2000), timeout: 120_000, failCount: 2 }));
    expect(opp).not.toBeNull();
    expect(opp!.kind).toBe('oversized-timeout');
    expect(opp!.p95).toBe(2000);
    expect(opp!.recommendedTimeout).toBe(5000); // max(recommendedFloor 5000, p95*2 = 4000)
    expect(opp!.headroomRatio).toBe(60);
    expect(opp!.estimatedSavingMs).toBe(115_000); // 120000 - 5000
    expect(opp!.impact).toBeGreaterThan(0);
  });

  test('does not flag when the factor threshold is not met', () => {
    // 12000 < 3 × 5000 → not oversized
    expect(detectTimeoutOpportunity(agg({ durations: dur(5000), timeout: 12_000 }))).toBeNull();
  });

  test('does not flag when the absolute headroom is below the floor', () => {
    // 18000 ≥ 3 × 5000 but headroom 13000 < 20000 floor
    expect(detectTimeoutOpportunity(agg({ durations: dur(5000), timeout: 18_000 }))).toBeNull();
  });

  test('treats timeout 0 (unbounded) as no numeric budget', () => {
    expect(detectTimeoutOpportunity(agg({ durations: dur(2000), timeout: 0 }))).toBeNull();
  });

  test('flags a stale test.slow() mark on a consistently fast test', () => {
    const opp = detectTimeoutOpportunity(
      agg({ durations: dur(1000), timeout: 90_000, hasSlowAnnotation: true, failCount: 1 }),
    );
    expect(opp).not.toBeNull();
    expect(opp!.kind).toBe('stale-slow');
    expect(opp!.recommendedTimeout).toBeNull();
    expect(opp!.estimatedSavingMs).toBe(60_000); // ~2/3 of 90000
  });

  test('a slow-marked test that is genuinely slow is reported as oversized, not stale', () => {
    const opp = detectTimeoutOpportunity(agg({ durations: dur(15_000), timeout: 90_000, hasSlowAnnotation: true }));
    expect(opp).not.toBeNull();
    expect(opp!.kind).toBe('oversized-timeout');
  });

  test('returns null for a well-sized timeout', () => {
    expect(detectTimeoutOpportunity(agg({ durations: dur(8000), timeout: 20_000 }))).toBeNull();
  });
});

describe('hasSlowMark', () => {
  test('detects the slow annotation case-insensitively', () => {
    expect(hasSlowMark([{ type: 'slow' }])).toBe(true);
    expect(hasSlowMark([{ type: 'SLOW' }])).toBe(true);
    expect(hasSlowMark([{ type: 'fixme' }, { type: 'slow' }])).toBe(true);
  });

  test('is false for non-slow / empty / null', () => {
    expect(hasSlowMark([{ type: 'fixme' }])).toBe(false);
    expect(hasSlowMark([])).toBe(false);
    expect(hasSlowMark(null)).toBe(false);
    expect(hasSlowMark(undefined)).toBe(false);
  });
});

describe('resolveTimeoutThresholds', () => {
  test('returns defaults for null / non-object', () => {
    expect(resolveTimeoutThresholds(null)).toEqual(DEFAULT_TIMEOUT_THRESHOLDS);
    expect(resolveTimeoutThresholds(undefined)).toEqual(DEFAULT_TIMEOUT_THRESHOLDS);
  });

  test('merges valid overrides and ignores invalid ones', () => {
    const merged = resolveTimeoutThresholds({ factor: 5, floorMs: -1, minRuns: Number.NaN, safety: 3 });
    expect(merged.factor).toBe(5);
    expect(merged.safety).toBe(3);
    expect(merged.floorMs).toBe(DEFAULT_TIMEOUT_THRESHOLDS.floorMs); // negative ignored
    expect(merged.minRuns).toBe(DEFAULT_TIMEOUT_THRESHOLDS.minRuns); // NaN ignored
  });
});
