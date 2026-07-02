import { describe, test, expect } from 'vitest';
import { scoreChangedFile, representativeExecutionSections } from '../../server/utils/ai-context';
import type { ContextLimits } from '#shared/ai-context-limits';

// Minimal limits object — large enough that nothing truncates in these tests.
const limits = {
  sampleErrorChars: 10000,
  testSourceChars: 10000,
  steps: 50,
  maxConsoleWindow: 50,
  consoleEntryChars: 500,
  networkRequests: 20,
  slowRequestMs: 2000,
  serverLogEntries: 20,
  serverLogEntryChars: 500,
  ariaSnapshotChars: 4000,
} as unknown as ContextLimits;

/** Build a representative-execution row with only the fields under test. */
function makeRep(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    testRunId: 42,
    error: null,
    browser: null,
    retries: 0,
    duration: 1000,
    line: 10,
    column: 5,
    steps: null,
    consoleLogs: null,
    ariaSnapshot: null,
    testSource: null,
    webVitals: null,
    testAnnotations: null,
    workerIndex: 0,
    shardIndex: null,
    testCaseId: 7,
    browserName: 'chromium',
    testTitle: 'my test',
    testFilePath: 'tests/checkout.spec.ts',
    testSuitePath: null,
    flakyRootCause: null,
    nrItems: [],
    runEnvironment: null,
    runMetadata: null,
    runIsFullRun: null,
    runFilterDetails: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('representativeExecutionSections — id alignment (Tier 0.2)', () => {
  test('a rep with no error and no source still labels steps/console by their real ids', () => {
    const rep = makeRep({
      error: null,
      testSource: null,
      steps: [{ category: 'test.step', title: 'click Pay', duration: 200 }],
      consoleLogs: [{ type: 'error', text: 'boom' }],
    });

    const sections = representativeExecutionSections(rep, null, limits);
    const byId = new Map(sections.map((s) => [s.id, s.markdown]));

    // Header is always present.
    expect(byId.get('representativeExecution')).toContain('Representative Execution');
    // No error/source were provided, so those ids must be absent (not shifted onto others).
    expect(byId.has('executionError')).toBe(false);
    expect(byId.has('testSource')).toBe(false);
    // Steps and console keep their own ids regardless of the missing earlier sections.
    expect(byId.get('steps')).toContain('click Pay');
    expect(byId.get('console')).toContain('boom');
  });

  test('execution error is included when there is no cluster to dedupe against', () => {
    const rep = makeRep({ error: 'Error: something failed' });
    const sections = representativeExecutionSections(rep, null, limits);
    const err = sections.find((s) => s.id === 'executionError');
    expect(err?.markdown).toContain('something failed');
  });
});

describe('scoreChangedFile — generic relevance (Tier 0.5)', () => {
  test('scores an imported file highest', () => {
    const testSource = "import { CheckoutPage } from '../pages/CheckoutPage';\ntest('x', () => {});";
    const imported = scoreChangedFile('src/pages/CheckoutPage.ts', { testSource });
    const unrelated = scoreChangedFile('src/util/formatDate.ts', { testSource });
    expect(imported).toBeGreaterThan(unrelated);
  });

  test('exact test-file match scores high without any Piwi-specific paths', () => {
    const score = scoreChangedFile('tests/checkout.spec.ts', { testFilePath: 'tests/checkout.spec.ts' });
    expect(score).toBeGreaterThanOrEqual(4);
  });

  test('token overlap with the test title contributes', () => {
    const score = scoreChangedFile('src/CheckoutButton.tsx', { testTitle: 'checkout button is disabled' });
    expect(score).toBeGreaterThan(0);
  });

  test('config/lockfiles are penalised relative to source', () => {
    const lock = scoreChangedFile('package-lock.json', {});
    const src = scoreChangedFile('src/app/main.ts', {});
    expect(src).toBeGreaterThan(lock);
  });
});
