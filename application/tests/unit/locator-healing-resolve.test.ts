import { describe, test, expect } from 'vitest';
import { resolveHealingForCase } from '~~/server/utils/locator-healing';
import { locatorSignatureFromExpression } from '#shared/locator-healing';
import type { LocatorSnapshotRow } from '~~/server/database/schema';
import type { RankedLocator } from '#shared/locator-healing.types';

/**
 * The shared healing ladder used by both the single-case and batch entry
 * points: location → signature → cross-test → ARIA fallback, plus the
 * healed-run signal. Driven with fabricated snapshot rows and an injected
 * cross-test lookup, so no DB is needed.
 */

const chainError = (chain: string, loc = 'tests/checkout.spec.ts:42:5') =>
  `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for ${chain}\n    at ${loc}`;

const PAY_TESTID: RankedLocator = {
  locator: "getByTestId('pay-btn')",
  method: 'getByTestId',
  args: { testId: 'pay-btn' },
  score: 100,
};

function snap(o: Partial<LocatorSnapshotRow>): LocatorSnapshotRow {
  return {
    id: 1,
    testCaseId: 10,
    location: null,
    usedMethod: 'getByRole',
    usedArgs: '[]',
    usedArgsFp: 'fp-x',
    elementTag: 'button',
    elementAttrs: '{}',
    elementText: 'Pay',
    alternatives: JSON.stringify([PAY_TESTID]),
    lastSeenRunId: 1,
    lastSeenAt: new Date(0),
    ...o,
  } as LocatorSnapshotRow;
}

const FAILING = "getByRole('button', { name: 'Pay' })";

describe('resolveHealingForCase — ladder', () => {
  test('no error → source none', async () => {
    const r = await resolveHealingForCase({ error: null }, [], null);
    expect(r.source).toBe('none');
  });

  test('ladder 1: call-site location match → prior-run, with location + sourceLine stamped', async () => {
    const rows = [snap({ location: 'tests/checkout.spec.ts:42:5' })];
    const r = await resolveHealingForCase(
      {
        error: chainError(FAILING),
        testSource: '>  42 |   await page.getByRole("button", { name: "Pay" }).click();',
      },
      rows,
      null,
    );
    expect(r.source).toBe('prior-run');
    expect(r.location).toBe('tests/checkout.spec.ts:42:5');
    expect(r.sourceLine).toEqual({ line: 42, text: '  await page.getByRole("button", { name: "Pay" }).click();' });
    expect(r.recommendation?.recommended?.locator).toBe("getByTestId('pay-btn')");
  });

  test('ladder 2: signature match (no location) → fingerprint', async () => {
    const sig = await locatorSignatureFromExpression(FAILING);
    // Snapshot at a different line, so only the signature can match.
    const rows = [snap({ location: 'tests/checkout.spec.ts:99:1', usedArgsFp: sig, usedMethod: 'getByRole' })];
    const r = await resolveHealingForCase({ error: chainError(FAILING) }, rows, null);
    expect(r.source).toBe('fingerprint');
  });

  test('ladder 2.5: cross-test lookup via the injected callback → cross-test', async () => {
    const sig = await locatorSignatureFromExpression(FAILING);
    let askedSig: string | null = null;
    const crossRow = snap({ testCaseId: 77, usedArgsFp: sig });
    const r = await resolveHealingForCase({ error: chainError(FAILING) }, [], (s) => {
      askedSig = s;
      return Promise.resolve(crossRow);
    });
    expect(askedSig).toBe(sig);
    expect(r.source).toBe('cross-test');
  });

  test('ladder 3: ARIA fallback when nothing is stored', async () => {
    const r = await resolveHealingForCase({ error: chainError(FAILING), ariaSnapshot: '- button "Pay"' }, [], () =>
      Promise.resolve(null),
    );
    expect(r.source).toBe('aria-snapshot');
  });
});

describe('resolveHealingForCase — healed detection', () => {
  const healedRows = async (recSig: string, healedRunId: number) => [
    // The failing call site, matched by location; its recommendation is PAY_TESTID.
    snap({ id: 1, location: 'tests/checkout.spec.ts:42:5', lastSeenRunId: 5 }),
    // A later capture at another call site now using the recommended locator.
    snap({ id: 2, location: 'tests/checkout.spec.ts:80:3', usedArgsFp: recSig, lastSeenRunId: healedRunId }),
  ];

  test('flags healedInRunId when the recommended locator now passes in another run', async () => {
    const recSig = await locatorSignatureFromExpression(PAY_TESTID.locator);
    const r = await resolveHealingForCase(
      { error: chainError(FAILING), failingRunId: 1 },
      await healedRows(recSig, 42),
      null,
    );
    expect(r.recommendation?.recommended?.locator).toBe("getByTestId('pay-btn')");
    expect(r.healedInRunId).toBe(42);
  });

  test('does not flag when the only matching capture is the failing run itself', async () => {
    const recSig = await locatorSignatureFromExpression(PAY_TESTID.locator);
    const r = await resolveHealingForCase(
      { error: chainError(FAILING), failingRunId: 7 },
      await healedRows(recSig, 7),
      null,
    );
    expect(r.healedInRunId).toBeUndefined();
  });

  test('does not flag when the recommendation is the original locator (flaky pass)', async () => {
    // Recommendation equals the failing locator → a flaky pass, nothing was fixed.
    const failingSig = await locatorSignatureFromExpression(FAILING);
    const rows = [
      snap({
        location: 'tests/checkout.spec.ts:42:5',
        alternatives: JSON.stringify([
          { locator: FAILING, method: 'getByRole', args: { role: 'button', name: 'Pay' }, score: 90 },
        ]),
      }),
      snap({ id: 2, location: 'tests/checkout.spec.ts:80:3', usedArgsFp: failingSig, lastSeenRunId: 99 }),
    ];
    const r = await resolveHealingForCase({ error: chainError(FAILING), failingRunId: 1 }, rows, null);
    expect(r.healedInRunId).toBeUndefined();
  });
});
