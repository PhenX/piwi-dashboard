import { describe, test, expect, afterEach } from 'vitest';
import { DEFAULT_INGEST_LIMITS, INGEST_LIMIT_FIELDS, clampIngestLimit } from '#shared/ingest-limits';
import type { IngestLimits } from '#shared/ingest-limits';
import { resolveIngestLimits } from '~~/server/utils/ingest-limits';
import { capArray, capConsoleLogs, capErrorText, capSourceFrames, capText } from '~~/server/utils/sanitize';

const limits: IngestLimits = { ...DEFAULT_INGEST_LIMITS, consoleEntries: 30, consoleEntryChars: 50 };

describe('clampIngestLimit', () => {
  const field = INGEST_LIMIT_FIELDS.find((f) => f.key === 'consoleEntries')!;

  test('passes values inside the range through, floored', () => {
    expect(clampIngestLimit(field, 100)).toBe(100);
    expect(clampIngestLimit(field, '250.9')).toBe(250);
  });

  test('clamps to min/max and rejects non-numbers', () => {
    expect(clampIngestLimit(field, 1)).toBe(field.min);
    expect(clampIngestLimit(field, 1e9)).toBe(field.max);
    expect(clampIngestLimit(field, 'abc')).toBeNull();
    expect(clampIngestLimit(field, undefined)).toBeNull();
  });
});

describe('resolveIngestLimits', () => {
  afterEach(() => {
    delete process.env.PIWI_INGEST_MAX_ARIA_CHARS;
    delete process.env.PIWI_INGEST_MAX_STEPS;
  });

  test('returns defaults when no env vars are set', () => {
    expect(resolveIngestLimits()).toEqual(DEFAULT_INGEST_LIMITS);
  });

  test('env vars override defaults, clamped to the field range', () => {
    process.env.PIWI_INGEST_MAX_ARIA_CHARS = '5000';
    process.env.PIWI_INGEST_MAX_STEPS = '999999';
    const resolved = resolveIngestLimits();
    expect(resolved.ariaSnapshotChars).toBe(5000);
    expect(resolved.steps).toBe(INGEST_LIMIT_FIELDS.find((f) => f.key === 'steps')!.max);
    expect(resolved.errorChars).toBe(DEFAULT_INGEST_LIMITS.errorChars);
  });
});

describe('capText', () => {
  test('returns short strings unchanged and null for non-strings', () => {
    expect(capText('hello', 10)).toBe('hello');
    expect(capText(null, 10)).toBeNull();
    expect(capText(undefined, 10)).toBeNull();
  });

  test('truncates with a marker noting dropped characters', () => {
    const result = capText('a'.repeat(120), 100)!;
    expect(result.startsWith('a'.repeat(100))).toBe(true);
    expect(result).toContain('[truncated 20 chars]');
  });
});

describe('capErrorText', () => {
  test('keeps both the head (message) and tail (innermost frames)', () => {
    const error = `AssertionError: HEAD${'x'.repeat(2000)}TAIL: at test.spec.ts:42`;
    const result = capErrorText(error, 1000)!;
    expect(result.length).toBeLessThan(error.length);
    expect(result).toContain('AssertionError: HEAD');
    expect(result).toContain('TAIL: at test.spec.ts:42');
    expect(result).toMatch(/\[truncated \d+ chars\]/);
  });

  test('returns short errors unchanged', () => {
    expect(capErrorText('boom', 1000)).toBe('boom');
  });
});

describe('capArray', () => {
  test('slices arrays over the cap and passes everything else through', () => {
    expect(capArray([1, 2, 3], 2)).toEqual([1, 2]);
    expect(capArray([1, 2], 5)).toEqual([1, 2]);
    expect(capArray(undefined, 5)).toBeNull();
    expect(capArray('not-an-array', 5)).toBe('not-an-array');
  });
});

describe('capConsoleLogs', () => {
  test('keeps the first 20 and the newest entries with a drop marker between', () => {
    const logs = Array.from({ length: 100 }, (_, i) => ({ type: 'error', text: `entry ${i}` }));
    const result = capConsoleLogs(logs, limits)!;
    expect(result).toHaveLength(limits.consoleEntries + 1);
    expect(result[0]!.text).toBe('entry 0');
    expect(result[19]!.text).toBe('entry 19');
    expect(result[20]!.text).toBe('[70 console entries dropped]');
    expect(result[21]!.text).toBe('entry 90');
    expect(result.at(-1)!.text).toBe('entry 99');
  });

  test('caps each entry text and leaves short lists unsliced', () => {
    const logs = [{ type: 'error', text: 'x'.repeat(200) }];
    const result = capConsoleLogs(logs, limits)!;
    expect(result).toHaveLength(1);
    expect((result[0]!.text as string).length).toBeLessThanOrEqual(limits.consoleEntryChars + ' [truncated]'.length);
    expect(result[0]!.text).toContain('[truncated]');
  });

  test('returns null for missing input', () => {
    expect(capConsoleLogs(null, limits)).toBeNull();
  });
});

describe('capSourceFrames', () => {
  test('caps frame count, snippet chars and file length; drops junk entries', () => {
    const frames = [
      ...Array.from({ length: 12 }, (_, i) => ({ file: `f${i}.ts`, line: i, snippet: 's'.repeat(9000) })),
      'junk',
      null,
    ];
    const result = capSourceFrames(frames, limits) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(limits.sourceFrames);
    expect((result[0]!.snippet as string).length).toBeLessThanOrEqual(
      limits.sourceFrameChars + '\n[truncated 99999 chars]'.length,
    );
    expect(result[0]!.file).toBe('f0.ts');
    expect(result[0]!.line).toBe(0);
  });

  test('passes non-arrays through and nulls empty results', () => {
    expect(capSourceFrames(undefined, limits)).toBeNull();
    expect(capSourceFrames(['junk'], limits)).toBeNull();
  });
});
