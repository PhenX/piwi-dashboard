import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STEP_MAX_OUTPUT_TOKENS,
  DEFAULT_STEP_MAX_SNAPSHOT_CHARS,
  resolveStepLimits,
} from '../../server/utils/ai-step-resolver';

describe('resolveStepLimits', () => {
  it('returns the defaults when no env override is set', () => {
    const limits = resolveStepLimits({});
    expect(limits.maxSnapshotChars).toBe(DEFAULT_STEP_MAX_SNAPSHOT_CHARS);
    expect(limits.maxOutputTokens).toBe(DEFAULT_STEP_MAX_OUTPUT_TOKENS);
  });

  it('honors env overrides', () => {
    const limits = resolveStepLimits({
      PIWI_AI_STEP_MAX_SNAPSHOT_CHARS: '5000',
      PIWI_AI_STEP_MAX_OUTPUT_TOKENS: '2048',
    });
    expect(limits.maxSnapshotChars).toBe(5000);
    expect(limits.maxOutputTokens).toBe(2048);
  });

  it('clamps out-of-range values and ignores junk (falling back to the default)', () => {
    expect(resolveStepLimits({ PIWI_AI_STEP_MAX_OUTPUT_TOKENS: '999999' }).maxOutputTokens).toBe(8192);
    expect(resolveStepLimits({ PIWI_AI_STEP_MAX_OUTPUT_TOKENS: '1' }).maxOutputTokens).toBe(256);
    expect(resolveStepLimits({ PIWI_AI_STEP_MAX_SNAPSHOT_CHARS: 'abc' }).maxSnapshotChars).toBe(
      DEFAULT_STEP_MAX_SNAPSHOT_CHARS,
    );
  });
});
