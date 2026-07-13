import { describe, it, expect } from 'vitest';
import {
  applyPickToSnapshots,
  deriveFailedLocator,
  generateAnchoredAlternatives,
  mergeCandidates,
  parseLeafLocatorExpression,
  type PickedAnchorInfo,
  type UserPickResult,
} from '../src/internal/capture/pick-on-failure.js';
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

  it('is a no-op for a pure inspect pick (no failing locator)', () => {
    const snaps = [placeholder(LOCATION)];
    const inspectPick = { ...pick(LOCATION), failing: null };
    expect(applyPickToSnapshots(snaps, inspectPick)).toBe(false);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.element).toBeNull();
  });

  it('appends a snapshot when no placeholder exists (assertion failure)', () => {
    // An expect(...) failure captured no action, so there is no placeholder —
    // the pick must still land in a snapshot, keyed to the failing locator.
    const snaps = [placeholder('tests/other.spec.ts:1:1')];
    expect(applyPickToSnapshots(snaps, pick(LOCATION))).toBe(true);
    expect(snaps).toHaveLength(2);
    const appended = snaps[1]!;
    expect(appended.location).toBe(LOCATION);
    expect(appended.element?.attributes['data-testid']).toBe('pay-now');
    expect(appended.alternatives[0]!.pickedByUser).toBe(true);
    // The appended snapshot's `used` is the failing locator (for signature lookup).
    expect(appended.used.method).toBe('getByText');
    expect(appended.used.args).toEqual(['Pay now']);
  });
});

describe('parseLeafLocatorExpression', () => {
  it('parses simple name-based and testid locators', () => {
    expect(parseLeafLocatorExpression(`getByText('Pay now')`)).toEqual({ method: 'getByText', args: ['Pay now'] });
    expect(parseLeafLocatorExpression(`getByTestId('pay')`)).toEqual({ method: 'getByTestId', args: ['pay'] });
  });

  it('parses getByRole with an options object (name, level, exact)', () => {
    expect(parseLeafLocatorExpression(`getByRole('button', { name: 'Pay now', exact: true })`)).toEqual({
      method: 'getByRole',
      args: ['button', { name: 'Pay now', exact: true }],
    });
    expect(parseLeafLocatorExpression(`getByRole('heading', { name: 'Cart', level: 2 })`)).toEqual({
      method: 'getByRole',
      args: ['heading', { name: 'Cart', level: 2 }],
    });
  });

  it('takes the leaf of a chained locator', () => {
    expect(
      parseLeafLocatorExpression(`getByRole('row', { name: 'Acme' }).getByRole('button', { name: 'Delete' })`),
    ).toEqual({ method: 'getByRole', args: ['button', { name: 'Delete' }] });
  });

  it('unescapes quotes inside string args', () => {
    expect(parseLeafLocatorExpression(`getByText('It\\'s here')`)).toEqual({ method: 'getByText', args: ["It's here"] });
  });

  it('returns null for non-locator text', () => {
    expect(parseLeafLocatorExpression('not a locator')).toBeNull();
  });
});

describe('deriveFailedLocator', () => {
  const errText = (locator: string) =>
    `Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n\nLocator: ${locator}\nExpected: visible\nReceived: hidden`;

  it('reads the Locator line and the error call site (cwd-relative)', () => {
    const file = `${process.cwd()}/tests/pay.spec.ts`;
    const testInfo = {
      errors: [{ message: errText(`getByRole('button', { name: 'Pay' })`), location: { file, line: 20, column: 34 } }],
    } as never;
    expect(deriveFailedLocator(testInfo)).toEqual({
      method: 'getByRole',
      args: ['button', { name: 'Pay' }],
      location: 'tests/pay.spec.ts:20:34',
    });
  });

  it('strips ANSI colour codes from the error before matching', () => {
    const colored = `[2mLocator:[22m getByText('Pay now')`;
    const testInfo = { errors: [{ message: colored }] } as never;
    expect(deriveFailedLocator(testInfo)).toEqual({ method: 'getByText', args: ['Pay now'], location: null });
  });

  it('falls back to testInfo.error and returns null when no Locator line is present', () => {
    expect(deriveFailedLocator({ error: { message: `Locator: getByTestId('x')` } } as never)).toEqual({
      method: 'getByTestId',
      args: ['x'],
      location: null,
    });
    expect(deriveFailedLocator({ errors: [{ message: 'plain assertion failure' }] } as never)).toBeNull();
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

function anchor(overrides: Partial<PickedAnchorInfo>): PickedAnchorInfo {
  return {
    tag: 'div',
    depth: 1,
    testId: null,
    id: null,
    ariaLabel: null,
    role: null,
    scopedLeafCount: 1,
    ...overrides,
  };
}

describe('generateAnchoredAlternatives', () => {
  const leaf = { role: 'button', level: null };

  it('emits a testid-anchored chain in the standard flat-args shape', () => {
    const alts = generateAnchoredAlternatives(leaf, [
      anchor({ tag: 'form', testId: 'signup-form', testIdCount: 1 }),
    ]);
    expect(alts).toHaveLength(1);
    expect(alts[0]!.locator).toBe(`getByTestId('signup-form').getByRole('button')`);
    expect(alts[0]!.method).toBe('getByRole');
    expect(alts[0]!.args).toEqual({ role: 'button', anchorTestId: 'signup-form' });
    expect(alts[0]!.score).toBe(80);
  });

  it('falls through the hook ladder: id, then labeled role, then bare role', () => {
    const byId = generateAnchoredAlternatives(leaf, [anchor({ id: 'sidebar', idCount: 1 })]);
    expect(byId[0]!.locator).toBe(`locator('#sidebar').getByRole('button')`);
    expect(byId[0]!.args).toEqual({ role: 'button', anchorSelector: '#sidebar' });
    expect(byId[0]!.score).toBe(74);

    const byLabel = generateAnchoredAlternatives(leaf, [
      anchor({ tag: 'nav', role: 'navigation', ariaLabel: 'Main', labeledRoleCount: 1, roleCount: 3 }),
    ]);
    expect(byLabel[0]!.locator).toBe(`getByRole('navigation', { name: 'Main' }).getByRole('button')`);
    // The anchor's label must never ride under `name` — the server's
    // fingerprint reader reserves that for the leaf's accessible name.
    expect(byLabel[0]!.args).toEqual({ role: 'button', anchorRole: 'navigation', anchorName: 'Main' });
    expect(byLabel[0]!.score).toBe(68);

    const byRole = generateAnchoredAlternatives(leaf, [anchor({ tag: 'nav', role: 'navigation', roleCount: 1 })]);
    expect(byRole[0]!.locator).toBe(`getByRole('navigation').getByRole('button')`);
    expect(byRole[0]!.score).toBe(62);
  });

  it('carries the heading level into the leaf part', () => {
    const alts = generateAnchoredAlternatives({ role: 'heading', level: 2 }, [
      anchor({ testId: 'panel', testIdCount: 1 }),
    ]);
    expect(alts[0]!.locator).toBe(`getByTestId('panel').getByRole('heading', { level: 2 })`);
    expect(alts[0]!.args).toEqual({ role: 'heading', level: 2, anchorTestId: 'panel' });
  });

  it('drops anchors whose subtree does not isolate the leaf, or with no unique hook', () => {
    expect(
      generateAnchoredAlternatives(leaf, [anchor({ testId: 'list', testIdCount: 1, scopedLeafCount: 4 })]),
    ).toEqual([]);
    expect(generateAnchoredAlternatives(leaf, [anchor({ testId: 'dup', testIdCount: 3 })])).toEqual([]);
    // Auto-generated ids never anchor.
    expect(generateAnchoredAlternatives(leaf, [anchor({ id: 'radix-3f9a2b1c', idCount: 1 })])).toEqual([]);
  });

  it('adds a combined chain when several anchors isolate exactly one element', () => {
    const outer = anchor({ tag: 'main', depth: 5, role: 'main', roleCount: 1, scopedLeafCount: 6 });
    const inner = anchor({ tag: 'form', depth: 2, testId: 'signup-form', testIdCount: 1, scopedLeafCount: 1 });
    const alts = generateAnchoredAlternatives(leaf, [inner, outer], 1);
    const chain = alts.find((a) => Array.isArray(a.args.anchorChain));
    expect(chain).toBeDefined();
    expect(chain!.locator).toBe(`getByRole('main').getByTestId('signup-form').getByRole('button')`);
    // Flat args describe the innermost anchor; chain scores as its weakest segment.
    expect(chain!.args.anchorTestId).toBe('signup-form');
    expect(chain!.score).toBe(62);
    // No combined chain without the whole-chain uniqueness proof.
    const without = generateAnchoredAlternatives(leaf, [inner, outer], 3);
    expect(without.find((a) => Array.isArray(a.args.anchorChain))).toBeUndefined();
  });

  it('returns nothing for a role-less leaf', () => {
    expect(generateAnchoredAlternatives({ role: null, level: null }, [anchor({ id: 'x', idCount: 1 })])).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('dedupes by locator (first list wins) and re-sorts by score', () => {
    const base = [
      { locator: `getByTestId('a')`, method: 'getByTestId', args: { testId: 'a' }, score: 100 },
      { locator: `getByText('Pay')`, method: 'getByText', args: { text: 'Pay' }, score: 75 },
    ];
    const extra = [
      { locator: `getByText('Pay')`, method: 'getByText', args: { text: 'Pay' }, score: 99 },
      { locator: `locator('#f').getByRole('button')`, method: 'getByRole', args: { role: 'button' }, score: 74 },
    ];
    const merged = mergeCandidates(base, extra);
    expect(merged.map((m) => m.locator)).toEqual([
      `getByTestId('a')`,
      `getByText('Pay')`,
      `locator('#f').getByRole('button')`,
    ]);
    expect(merged[1]!.score).toBe(75);
  });
});
