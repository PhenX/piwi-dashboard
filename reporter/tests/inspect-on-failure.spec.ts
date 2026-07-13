import { describe, it, expect } from 'vitest';
import { shouldInspectOnFailure, type InspectionGate } from '../src/internal/capture/inspect-on-failure.js';
import { resolveOptions, applyOptionsToEnv, PIWI_ENV_KEYS } from '../src/internal/config/env.js';

/** A gate that passes every check — each test flips exactly one field. */
function openGate(overrides: Partial<InspectionGate> = {}): InspectionGate {
  return {
    enabled: 'true',
    ci: undefined,
    status: 'failed',
    expectedStatus: 'passed',
    headless: false,
    retry: 0,
    retries: 0,
    ...overrides,
  };
}

describe('shouldInspectOnFailure', () => {
  it('opens for a headed local failure when enabled', () => {
    expect(shouldInspectOnFailure(openGate())).toBe(true);
  });

  it('opens for a timed-out test', () => {
    expect(shouldInspectOnFailure(openGate({ status: 'timedOut' }))).toBe(true);
  });

  it('stays closed unless the flag is exactly "true"', () => {
    expect(shouldInspectOnFailure(openGate({ enabled: undefined }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ enabled: 'false' }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ enabled: '1' }))).toBe(false);
  });

  it('never opens under CI, even when enabled', () => {
    expect(shouldInspectOnFailure(openGate({ ci: 'true' }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ ci: '1' }))).toBe(false);
  });

  it('tolerates CI explicitly set to false or empty', () => {
    expect(shouldInspectOnFailure(openGate({ ci: 'false' }))).toBe(true);
    expect(shouldInspectOnFailure(openGate({ ci: '' }))).toBe(true);
  });

  it('requires an explicitly headed browser', () => {
    expect(shouldInspectOnFailure(openGate({ headless: true }))).toBe(false);
    // Unset headless means Playwright's default (headless) — stays closed.
    expect(shouldInspectOnFailure(openGate({ headless: undefined }))).toBe(false);
  });

  it('only opens for failed/timedOut outcomes', () => {
    expect(shouldInspectOnFailure(openGate({ status: 'passed' }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ status: 'skipped' }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ status: 'interrupted' }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ status: undefined }))).toBe(false);
  });

  it('skips an expected failure (test.fail())', () => {
    expect(shouldInspectOnFailure(openGate({ expectedStatus: 'failed' }))).toBe(false);
  });

  it('waits for the final attempt when retries are configured', () => {
    expect(shouldInspectOnFailure(openGate({ retry: 0, retries: 2 }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ retry: 1, retries: 2 }))).toBe(false);
    expect(shouldInspectOnFailure(openGate({ retry: 2, retries: 2 }))).toBe(true);
  });
});

describe('inspectOnFailure option plumbing', () => {
  it('reads PIWI_INSPECT_ON_FAIL as a boolean fallback', () => {
    const saved = process.env.PIWI_INSPECT_ON_FAIL;
    try {
      process.env.PIWI_INSPECT_ON_FAIL = 'true';
      expect(resolveOptions({}).inspectOnFailure).toBe(true);
      process.env.PIWI_INSPECT_ON_FAIL = 'false';
      expect(resolveOptions({}).inspectOnFailure).toBe(false);
      expect(resolveOptions({ inspectOnFailure: true }).inspectOnFailure).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PIWI_INSPECT_ON_FAIL;
      else process.env.PIWI_INSPECT_ON_FAIL = saved;
    }
  });

  it('bridges the option into the worker env', () => {
    const saved = process.env.PIWI_INSPECT_ON_FAIL;
    try {
      delete process.env.PIWI_INSPECT_ON_FAIL;
      applyOptionsToEnv({ inspectOnFailure: true });
      expect(process.env[PIWI_ENV_KEYS.inspectOnFailure]).toBe('true');
      applyOptionsToEnv({ inspectOnFailure: false });
      expect(process.env[PIWI_ENV_KEYS.inspectOnFailure]).toBe('false');
      // Unset option leaves the env untouched (default-off lives in the gate).
      delete process.env.PIWI_INSPECT_ON_FAIL;
      applyOptionsToEnv({});
      expect(process.env[PIWI_ENV_KEYS.inspectOnFailure]).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.PIWI_INSPECT_ON_FAIL;
      else process.env.PIWI_INSPECT_ON_FAIL = saved;
    }
  });
});
