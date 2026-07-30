import { describe, it, expect } from 'vitest';
import { computeCoreVitals } from '../src/internal/capture/capture-fixtures.js';

describe('computeCoreVitals', () => {
  it('returns null when every entry list is null (non-Chromium)', () => {
    expect(computeCoreVitals(null, null, null)).toBeNull();
  });

  it('uses the last LCP candidate', () => {
    const vitals = computeCoreVitals([{ startTime: 810.4 }, { startTime: 1502.6 }], null, null);
    expect(vitals).toEqual({ lcp: 1503, cls: null, inp: null });
  });

  it('sums layout shifts excluding those with recent input', () => {
    const vitals = computeCoreVitals(
      null,
      [
        { value: 0.05, hadRecentInput: false },
        { value: 0.4, hadRecentInput: true },
        { value: 0.0301, hadRecentInput: false },
      ],
      null,
    );
    expect(vitals).toEqual({ lcp: null, cls: 0.0801, inp: null });
  });

  it('reports CLS 0 (not null) when layout-shift is supported but nothing shifted', () => {
    const vitals = computeCoreVitals(null, [], null);
    expect(vitals).toEqual({ lcp: null, cls: 0, inp: null });
  });

  it('takes the max duration per interaction and the worst interaction as INP', () => {
    const vitals = computeCoreVitals(null, null, [
      { interactionId: 1, duration: 120 },
      { interactionId: 1, duration: 80 },
      { interactionId: 2, duration: 48 },
    ]);
    expect(vitals).toEqual({ lcp: null, cls: null, inp: 120 });
  });

  it('ignores entries without an interaction id (plain events)', () => {
    expect(computeCoreVitals(null, null, [{ interactionId: 0, duration: 300 }, { duration: 500 }])).toBeNull();
  });

  it('uses the p98 interaction when there are more than 50 interactions', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ interactionId: i + 1, duration: i + 1 }));
    const vitals = computeCoreVitals(null, null, events);
    expect(vitals?.inp).toBe(99);
  });

  it('combines all three metrics', () => {
    const vitals = computeCoreVitals(
      [{ startTime: 900 }],
      [{ value: 0.12, hadRecentInput: false }],
      [{ interactionId: 7, duration: 210 }],
    );
    expect(vitals).toEqual({ lcp: 900, cls: 0.12, inp: 210 });
  });
});
