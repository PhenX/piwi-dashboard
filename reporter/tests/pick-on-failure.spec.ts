import { describe, it, expect } from 'vitest';
import { applyPickToSnapshots, type UserPickResult } from '../src/internal/capture/pick-on-failure.js';
import { renderFailing, type LocatorSnapshot, type RankedLocator } from '../src/internal/capture/locator-healing.js';
import { inspectionGateFromTestInfo } from '../src/internal/capture/inspect-on-failure.js';
import { resolveOptions, applyOptionsToEnv, PIWI_ENV_KEYS } from '../src/internal/config/env.js';

const LOCATION = 'tests/login.spec.ts:42:5';

function placeholder(location: string | null): LocatorSnapshot {
  return {
    location,
    used: { method: 'getByText', args: ['Pay now'], raw: `getByText(["Pay now"])` },
    element: null,
    alternatives: [],
  };
}

function captured(location: string): LocatorSnapshot {
  return {
    ...placeholder(location),
    element: {
      tagName: 'button',
      attributes: { 'data-testid': 'old' },
      textContent: 'Old',
      accessibleName: 'Old',
      center: { x: 1, y: 2 },
    },
  };
}

function pick(location: string | null, alternativeCount = 2): UserPickResult {
  const picked: RankedLocator = {
    locator: `getByTestId('pay-now')`,
    method: 'getByTestId',
    args: { testId: 'pay-now' },
    score: 100,
    pickedByUser: true,
  };
  const rest: RankedLocator[] = Array.from({ length: alternativeCount - 1 }, (_, i) => ({
    locator: `getByRole('button', { name: 'Pay now ${i}' })`,
    method: 'getByRole',
    args: { role: 'button', name: `Pay now ${i}` },
    score: 90 - i,
  }));
  return {
    failing: { method: 'getByText', args: ['Pay now'], rendered: `getByText('Pay now')`, location },
    picked,
    alternatives: [picked, ...rest],
    element: {
      tagName: 'button',
      attributes: { 'data-testid': 'pay-now' },
      textContent: 'Pay now!',
      accessibleName: 'Pay now!',
      center: { x: 10, y: 20 },
    },
  };
}

describe('applyPickToSnapshots', () => {
  it('fills the failing call site placeholder with the picked element and alternatives', () => {
    const snaps = [captured('tests/login.spec.ts:10:3'), placeholder(LOCATION)];
    expect(applyPickToSnapshots(snaps, pick(LOCATION))).toBe(true);
    expect(snaps[1]!.element?.attributes['data-testid']).toBe('pay-now');
    expect(snaps[1]!.alternatives[0]!.pickedByUser).toBe(true);
    // The failing locator stays the snapshot's `used` — the pick describes the
    // replacement, not what the test currently calls.
    expect(snaps[1]!.used.method).toBe('getByText');
  });

  it('targets the last placeholder for the location, not an element-bearing capture', () => {
    // A loop can capture the same call site successfully before failing.
    const snaps = [captured(LOCATION), placeholder(LOCATION)];
    expect(applyPickToSnapshots(snaps, pick(LOCATION))).toBe(true);
    expect(snaps[0]!.element?.attributes['data-testid']).toBe('old');
    expect(snaps[1]!.element?.attributes['data-testid']).toBe('pay-now');
  });

  it('caps the written alternatives at 10', () => {
    const snaps = [placeholder(LOCATION)];
    applyPickToSnapshots(snaps, pick(LOCATION, 15));
    expect(snaps[0]!.alternatives).toHaveLength(10);
    expect(snaps[0]!.alternatives[0]!.pickedByUser).toBe(true);
  });

  it('is a no-op without a captured failing location', () => {
    const snaps = [placeholder(LOCATION)];
    expect(applyPickToSnapshots(snaps, pick(null))).toBe(false);
    expect(snaps[0]!.element).toBeNull();
  });

  it('is a no-op when no snapshot matches the failing location', () => {
    const snaps = [placeholder('tests/other.spec.ts:1:1')];
    expect(applyPickToSnapshots(snaps, pick(LOCATION))).toBe(false);
    expect(snaps[0]!.element).toBeNull();
  });
});

describe('renderFailing', () => {
  it('renders name-based and role-based failing locators as source', () => {
    expect(renderFailing({ method: 'getByText', args: ['Pay now'] })).toBe(`getByText('Pay now')`);
    expect(renderFailing({ method: 'getByRole', args: ['button', { name: 'Pay' }] })).toBe(
      `getByRole('button', { name: 'Pay' })`,
    );
  });
});

describe('picker gate plumbing', () => {
  it('inspectionGateFromTestInfo arms from the provided flag value', () => {
    const testInfo = {
      status: 'failed',
      expectedStatus: 'passed',
      retry: 0,
      project: { retries: 0, use: { headless: false } },
    } as never;
    expect(inspectionGateFromTestInfo(testInfo, 'true').enabled).toBe('true');
    expect(inspectionGateFromTestInfo(testInfo, undefined).enabled).toBeUndefined();
  });

  it('reads PIWI_PICK_LOCATOR_ON_FAIL and bridges the option into the env', () => {
    const saved = process.env.PIWI_PICK_LOCATOR_ON_FAIL;
    try {
      process.env.PIWI_PICK_LOCATOR_ON_FAIL = 'true';
      expect(resolveOptions({}).pickLocatorOnFailure).toBe(true);
      delete process.env.PIWI_PICK_LOCATOR_ON_FAIL;
      applyOptionsToEnv({ pickLocatorOnFailure: true });
      expect(process.env[PIWI_ENV_KEYS.pickLocatorOnFailure]).toBe('true');
      delete process.env.PIWI_PICK_LOCATOR_ON_FAIL;
      applyOptionsToEnv({});
      expect(process.env[PIWI_ENV_KEYS.pickLocatorOnFailure]).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.PIWI_PICK_LOCATOR_ON_FAIL;
      else process.env.PIWI_PICK_LOCATOR_ON_FAIL = saved;
    }
  });
});
